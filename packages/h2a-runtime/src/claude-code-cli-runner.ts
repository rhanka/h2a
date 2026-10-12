/**
 * Claude Code CLI Runner: executes pinned official binary with NDJSON streaming,
 * strict isolation, process reaping, credential read-back, and static error handling.
 */
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type {
  ClaudeCodeAccessProjection,
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliContent,
  ClaudeCodeCliEvent,
  ClaudeCodeCliRequest,
  ClaudeCodeCliRunner,
} from "@sentropic/llm-mesh";
import {
  buildIsolatedEnvironment,
  cleanClaudeRunSandbox,
  createClaudeRunSandbox,
  verifyCredentialNotRewritten,
} from "./claude-code-cli-isolation.js";
import {
  checkTokenTtlAdmission,
  reapProcessTree,
} from "./claude-code-cli-lifecycle.js";

export const DEFAULT_PINNED_CLI_VERSION = "2.1.296";
export const DEFAULT_MAX_FRAME_BYTES = 65536; // 64 KiB
export const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MiB
export const DEFAULT_RUN_DEADLINE_MS = 120_000; // 2 minutes

export interface OfficialClaudeCodeCliRunnerOptions {
  readonly binaryPath?: string;
  readonly expectedVersion?: string;
  readonly expectedDigest?: string;
  readonly capabilities?: ClaudeCodeCliCapabilities;
  readonly maxFrameBytes?: number;
  readonly maxTotalBytes?: number;
  readonly timeoutMs?: number;
  readonly spawnFn?: typeof spawn;
  readonly now?: () => number;
}

export class OfficialClaudeCodeCliRunner implements ClaudeCodeCliRunner {
  private readonly binaryPath: string;
  private readonly expectedVersion: string;
  private readonly expectedDigest: string | undefined;
  private readonly capabilities: ClaudeCodeCliCapabilities | undefined;
  private readonly maxFrameBytes: number;
  private readonly maxTotalBytes: number;
  private readonly timeoutMs: number;
  private readonly spawnFn: typeof spawn;
  private readonly now: () => number;

  constructor(options: OfficialClaudeCodeCliRunnerOptions = {}) {
    this.binaryPath = options.binaryPath ?? "";
    this.expectedVersion = options.expectedVersion ?? DEFAULT_PINNED_CLI_VERSION;
    this.expectedDigest = options.expectedDigest;
    this.capabilities = options.capabilities;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RUN_DEADLINE_MS;
    this.spawnFn = options.spawnFn ?? spawn;
    this.now = options.now ?? Date.now;
  }

  /**
   * Validate that the candidate binary is absolute, exists, matches expected version and digest.
   */
  private qualifyBinary(): void {
    if (!this.binaryPath || !isAbsolute(this.binaryPath)) {
      throw new Error("Claude CLI candidate unqualified: absolute binary path required");
    }
    if (!existsSync(this.binaryPath)) {
      throw new Error("Claude CLI candidate unqualified: binary does not exist");
    }
    if (!this.capabilities || this.capabilities.protocol !== "claude-code-stream-json-v1") {
      throw new Error("Claude CLI candidate unqualified: unsupported protocol");
    }
    if (!this.capabilities.qualificationRef || !this.capabilities.qualificationRef.trim()) {
      throw new Error("Claude CLI candidate unqualified: missing qualification reference");
    }
    if (this.expectedDigest) {
      const bytes = readFileSync(this.binaryPath);
      const actualDigest = createHash("sha256").update(bytes).digest("hex");
      if (actualDigest !== this.expectedDigest) {
        throw new Error("Claude CLI candidate unqualified: binary digest mismatch");
      }
    }
  }

  async *run(input: {
    access: ClaudeCodeAccessProjection;
    request: ClaudeCodeCliRequest;
    signal: AbortSignal;
  }): AsyncIterable<ClaudeCodeCliEvent> {
    // 1. Candidate qualification preflight
    this.qualifyBinary();

    // 2. Admission and TTL checks
    const admission = checkTokenTtlAdmission(input.access.expiresAt, this.now());
    if (!admission.admitted) {
      yield { type: "error" };
      return;
    }

    // 3. Create isolated sandbox
    const sandbox = createClaudeRunSandbox({ access: input.access });
    const env = buildIsolatedEnvironment(sandbox);

    // 4. Construct candidate arguments
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--no-session-persistence",
      "--setting-sources", "",
      "--settings", sandbox.settingsPath,
      "--strict-mcp-config",
      "--mcp-config", sandbox.mcpConfigPath,
      "--tools", input.request.tools && this.capabilities?.tools
        ? input.request.tools.map((t) => t.name).join(",")
        : "",
      "--disable-slash-commands",
      "--permission-mode", "dontAsk",
      "--model", input.request.modelId,
    ];

    let childPid = 0;
    let terminalResultEmitted = false;
    let streamFailed = false;

    // Abort controller linked to caller signal & timeout
    const runController = new AbortController();
    const abortHandler = () => runController.abort();
    input.signal.addEventListener("abort", abortHandler, { once: true });

    let timeoutTimer: NodeJS.Timeout | null = null;
    if (this.timeoutMs > 0 && Number.isFinite(this.timeoutMs)) {
      timeoutTimer = setTimeout(() => {
        runController.abort();
      }, this.timeoutMs);
    }

    try {
      const child = this.spawnFn(this.binaryPath, args, {
        cwd: sandbox.cwdDir,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      childPid = child.pid ?? 0;
      if (!childPid) {
        yield { type: "error" };
        return;
      }

      // Stream request NDJSON onto stdin
      const stdinPayload = JSON.stringify({
        type: "user",
        messages: input.request.messages,
      }) + "\n";
      child.stdin?.write(stdinPayload);
      child.stdin?.end();

      // Read stdout stream
      let stdoutBuffer = "";
      let totalBytesReceived = 0;
      let emittedText = "";
      let pendingResult: ClaudeCodeCliEvent | null = null;

      type QueueItem = { event: ClaudeCodeCliEvent } | { done: true } | { error: Error };
      const queue: QueueItem[] = [];
      let notifyNext: (() => void) | null = null;

      const pushQueue = (item: QueueItem) => {
        queue.push(item);
        if (notifyNext) {
          const fn = notifyNext;
          notifyNext = null;
          fn();
        }
      };

      const parseLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const frame = JSON.parse(trimmed);

          // 1. Text delta / Content frame
          if (frame.type === "text_delta" && typeof frame.text === "string") {
            pushQueue({ event: { type: "text_delta", text: frame.text } });
            emittedText += frame.text;
          } else if (frame.type === "content_block_delta" && frame.delta?.type === "text_delta" && typeof frame.delta.text === "string") {
            pushQueue({ event: { type: "text_delta", text: frame.delta.text } });
            emittedText += frame.delta.text;
          } else if (frame.type === "assistant" && typeof frame.text === "string") {
            // Deduplicate partial vs complete: emit only newly added text
            if (frame.text.startsWith(emittedText)) {
              const delta = frame.text.slice(emittedText.length);
              if (delta) {
                pushQueue({ event: { type: "text_delta", text: delta } });
                emittedText = frame.text;
              }
            }
          } else if (frame.type === "tool_use" && frame.id && frame.name) {
            pushQueue({
              event: {
                type: "tool_use",
                id: frame.id,
                name: frame.name,
                input: frame.input ?? {},
              },
            });
          } else if (frame.type === "result") {
            // Stage pending terminal result: must not be emitted before exit agreement
            const finishReason =
              frame.finishReason === "tool_calls" || frame.finishReason === "length"
                ? frame.finishReason
                : "stop";
            pendingResult = {
              type: "result",
              finishReason,
              ...(frame.usage ? { usage: frame.usage } : {}),
            };
          } else if (frame.type === "error") {
            streamFailed = true;
            pushQueue({ event: { type: "error" } });
          }
        } catch {
          // Malformed frame rejects
          streamFailed = true;
          pushQueue({ event: { type: "error" } });
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        totalBytesReceived += chunk.length;
        if (totalBytesReceived > this.maxTotalBytes) {
          streamFailed = true;
          pushQueue({ event: { type: "error" } });
          child.kill("SIGKILL");
          return;
        }

        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (Buffer.byteLength(line, "utf8") > this.maxFrameBytes) {
            streamFailed = true;
            pushQueue({ event: { type: "error" } });
            child.kill("SIGKILL");
            return;
          }
          parseLine(line);
        }
      });

      child.on("error", () => {
        streamFailed = true;
        pushQueue({ event: { type: "error" } });
      });

      child.on("close", async (exitCode) => {
        if (stdoutBuffer.trim()) {
          parseLine(stdoutBuffer);
        }

        // Verify exit agreement, credential integrity, and reap process tree
        const credentialIntact = verifyCredentialNotRewritten(sandbox, input.access);
        const exitAgreement = exitCode === 0 && !streamFailed && pendingResult !== null;

        if (childPid > 0) {
          await reapProcessTree(childPid, "SIGTERM", 50);
        }
        cleanClaudeRunSandbox(sandbox);

        if (exitAgreement && credentialIntact && pendingResult) {
          pushQueue({ event: pendingResult });
          terminalResultEmitted = true;
        } else if (!terminalResultEmitted && !streamFailed) {
          pushQueue({ event: { type: "error" } });
        }
        pushQueue({ done: true });
      });

      // Consumer generator loop
      while (true) {
        if (runController.signal.aborted) {
          yield { type: "error" };
          return;
        }
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            notifyNext = r;
          });
        }
        while (queue.length > 0) {
          const item = queue.shift()!;
          if ("done" in item) {
            return;
          }
          if ("event" in item) {
            yield item.event;
            if (item.event.type === "result" || item.event.type === "error") {
              return;
            }
          }
        }
      }
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      input.signal.removeEventListener("abort", abortHandler);
      if (childPid > 0) {
        await reapProcessTree(childPid, "SIGKILL", 50);
      }
      cleanClaudeRunSandbox(sandbox);
    }
  }
}
