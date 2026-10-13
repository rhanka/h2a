/**
 * Claude Code CLI Runner: executes pinned official binary with NDJSON streaming,
 * strict isolation, process reaping, credential read-back, and static error handling.
 */
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import type {
  ClaudeCodeAccessProjection,
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliContent,
  ClaudeCodeCliEvent,
  ClaudeCodeCliRequest,
  ClaudeCodeCliRunner,
} from "./claude-seat-mesh-contract.js";
import {
  buildIsolatedEnvironment,
  cleanClaudeRunSandbox,
  createClaudeRunSandbox,
  recordChildPidInSandbox,
  verifyCredentialNotRewritten,
} from "./claude-code-cli-isolation.js";
import {
  checkTokenTtlAdmission,
  reapProcessTree,
  sweepOrphanSandboxes,
} from "./claude-code-cli-lifecycle.js";

export const DEFAULT_PINNED_CLI_VERSION = "2.1.296";

/**
 * Build the only accepted qualification reference for a pinned binary:
 * an attestation binding the sha256 fingerprint to the pinned version.
 * A nonempty invented reference is not qualification and is refused.
 */
export function buildClaudeQualificationRef(
  digest: string,
  version: string = DEFAULT_PINNED_CLI_VERSION,
): string {
  return `attest:sha256:${digest}@${version}`;
}
export function buildClaudeToolsQualificationRef(
  digest: string,
  version: string = DEFAULT_PINNED_CLI_VERSION,
): string {
  return `${buildClaudeQualificationRef(digest, version)}:tools`;
}

export const DEFAULT_MAX_FRAME_BYTES = 65536; // 64 KiB
export const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MiB
export const DEFAULT_RUN_DEADLINE_MS = 120_000; // 2 minutes

/**
 * Strict allowlist of typed tool identifiers permitted for the CLI --tools flag.
 * Caller-provided tool names are never passed to --tools.
 */
export const ALLOWED_TYPED_TOOL_IDENTIFIERS: readonly string[] = [] as const;

/**
 * Known built-in tools of the Claude CLI. Callers cannot request these names.
 */
export const BUILTIN_CLI_TOOLS = new Set([
  "Bash",
  "BashOutput",
  "Edit",
  "MultiEdit",
  "Read",
  "Write",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Agent",
  "Skill",
  "TodoWrite",
  "NotebookEdit",
  "KillShell",
  "ExitPlanMode",
]);

/**
 * Top-level NDJSON frame types emitted by the official CLI 2.1.296 stream-json
 * output that are known transport or lifecycle events and should not be failed as unknown.
 */
export const KNOWN_IGNORED_TOP_LEVEL_TYPES = new Set([
  "system",
  "rate_limit_event",
  "tool_use_summary",
  "user",
  "auth_status",
  "keep_alive",
  "control_request",
]);

export interface ClaudeBinaryProbeResult {
  readonly stage: string;
  readonly status: "qualified" | "not-qualified";
  readonly reason?: string;
  readonly digestReceipt?: {
    readonly stage: string;
    readonly kind: "digest";
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly versionReceipt?: {
    readonly stage: string;
    readonly kind: "version";
    readonly path: string;
    readonly pinnedVersion: string;
    readonly versionStringPresent: boolean;
  };
}

/**
 * Pinned binary probe: reads real binary bytes into separate receipts without executing.
 * Reads in streaming chunks to avoid loading 245+ MiB into memory.
 */
export function probeClaudeBinary(
  binaryPath: string,
  pinnedVersion = DEFAULT_PINNED_CLI_VERSION,
  pinnedDigest?: string,
): ClaudeBinaryProbeResult {
  if (!existsSync(binaryPath)) {
    return {
      stage: "M5-probe",
      status: "not-qualified",
      reason: "pinned_binary_probe_unconfigured_or_binary_absent",
    };
  }

  try {
    const hash = createHash("sha256");
    const versionNeedle = Buffer.from(pinnedVersion, "utf8");
    let versionStringPresent = false;
    let totalBytes = 0;

    const fd = openSync(binaryPath, "r");
    const chunkSize = 65536;
    const buf = Buffer.alloc(chunkSize);
    let overlap = Buffer.alloc(0);

    try {
      let bytesRead: number;
      while ((bytesRead = readSync(fd, buf, 0, chunkSize, null)) > 0) {
        totalBytes += bytesRead;
        const currentChunk = buf.subarray(0, bytesRead);
        hash.update(currentChunk);

        if (!versionStringPresent) {
          const combined = overlap.length > 0 ? Buffer.concat([overlap, currentChunk]) : currentChunk;
          if (combined.includes(versionNeedle)) {
            versionStringPresent = true;
            overlap = Buffer.alloc(0);
          } else {
            const keep = Math.min(combined.length, versionNeedle.length - 1);
            overlap = Buffer.from(combined.subarray(combined.length - keep));
          }
        }
      }
    } finally {
      closeSync(fd);
    }

    const digest = hash.digest("hex");
    const digestMatches = pinnedDigest ? digest === pinnedDigest : false;
    const isQualified = versionStringPresent && digestMatches;
    let failureReason: string | undefined;
    if (!versionStringPresent) {
      failureReason = "version_string_absent";
    } else if (!pinnedDigest) {
      failureReason = "digest_unpinned";
    } else if (!digestMatches) {
      failureReason = "digest_mismatch";
    }

    return {
      stage: "M5-probe",
      status: isQualified ? "qualified" : "not-qualified",
      ...(failureReason ? { reason: failureReason } : {}),
      digestReceipt: {
        stage: "M5-probe",
        kind: "digest",
        path: binaryPath,
        sha256: digest,
        bytes: totalBytes,
      },
      versionReceipt: {
        stage: "M5-probe",
        kind: "version",
        path: binaryPath,
        pinnedVersion,
        versionStringPresent,
      },
    };
  } catch (err) {
    return {
      stage: "M5-probe",
      status: "not-qualified",
      reason: `probe_read_failed: ${(err as Error)?.message || err}`,
    };
  }
}

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
  /** Test seam directing sandbox roots away from the per-user runtime base. */
  readonly sandboxRootDir?: string;
  /** Allowlist of typed tool identifiers authorized for the CLI --tools flag. */
  readonly allowedCliTools?: readonly string[];
  /** Test seam injecting process group killer instead of process.kill(-childPid). */
  readonly killProcessTreeFn?: (pid: number, signal?: NodeJS.Signals) => void;
  /** Test seam injecting process tree reaper instead of reapProcessTree(childPid). */
  readonly reapProcessTreeFn?: (pid: number, signal?: NodeJS.Signals, gracePeriodMs?: number) => Promise<void>;
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
  private readonly sandboxRootDir: string | undefined;
  private readonly allowedCliTools: readonly string[] | undefined;
  private readonly killProcessTreeFn: ((pid: number, signal?: NodeJS.Signals) => void) | undefined;
  private readonly reapProcessTreeFn:
    | ((pid: number, signal?: NodeJS.Signals, gracePeriodMs?: number) => Promise<void>)
    | undefined;

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
    this.sandboxRootDir = options.sandboxRootDir;
    this.allowedCliTools = options.allowedCliTools;
    this.killProcessTreeFn = options.killProcessTreeFn;
    this.reapProcessTreeFn = options.reapProcessTreeFn;
  }

  /**
   * Validate that the candidate binary is absolute, exists, matches the
   * pinned version, and carries a mandatory fingerprint plus a digest-bound
   * qualification attestation. Anything less is refused before spawn.
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
    if (this.expectedVersion !== DEFAULT_PINNED_CLI_VERSION) {
      throw new Error("Claude CLI candidate unqualified: version pin mismatch (2.1.296 required)");
    }
    if (this.capabilities.cliVersion !== DEFAULT_PINNED_CLI_VERSION) {
      throw new Error("Claude CLI candidate unqualified: CLI version attestation mismatch");
    }
    if (!this.expectedDigest || !/^[0-9a-f]{64}$/.test(this.expectedDigest)) {
      throw new Error("Claude CLI candidate unqualified: binary fingerprint required");
    }
    const bytes = readFileSync(this.binaryPath);
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (actualDigest !== this.expectedDigest) {
      throw new Error("Claude CLI candidate unqualified: binary digest mismatch");
    }
    if (
      this.capabilities.qualificationRef !==
      buildClaudeQualificationRef(this.expectedDigest, DEFAULT_PINNED_CLI_VERSION)
    ) {
      throw new Error("Claude CLI candidate unqualified: qualification attestation required");
    }
  }

  run(input: {
    access: ClaudeCodeAccessProjection;
    request: ClaudeCodeCliRequest;
    signal: AbortSignal;
  }): AsyncIterable<ClaudeCodeCliEvent> {
    const runController = new AbortController();
    const abortHandler = () => runController.abort();
    input.signal.addEventListener("abort", abortHandler, { once: true });
    const runState = { earlyClosed: false };

    const gen = this.runInternal(input, runController, abortHandler, runState);
    const iterator: AsyncGenerator<ClaudeCodeCliEvent, void, unknown> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return gen.next();
      },
      return(val?: unknown) {
        runState.earlyClosed = true;
        runController.abort();
        return gen.return(val as never);
      },
      throw(err?: unknown) {
        runState.earlyClosed = true;
        runController.abort();
        return gen.throw(err);
      },
    };
    return iterator;
  }

  private async *runInternal(
    input: {
      access: ClaudeCodeAccessProjection;
      request: ClaudeCodeCliRequest;
      signal: AbortSignal;
    },
    runController: AbortController,
    abortHandler: () => void,
    runState: { earlyClosed: boolean },
  ): AsyncGenerator<ClaudeCodeCliEvent, void, unknown> {
    // 1. Candidate qualification preflight
    this.qualifyBinary();

    // Caller abort before any work: refuse without spawning.
    if (input.signal.aborted || runController.signal.aborted) {
      yield { type: "error" };
      return;
    }

    // Tool preflight: requests with tools are refused because caller tools would be silently
    // ignored without client-side tool transport (local MCP qualification).
    if (input.request.tools && input.request.tools.length > 0) {
      for (const t of input.request.tools) {
        if (BUILTIN_CLI_TOOLS.has(t.name)) {
          throw new Error("Claude seat spawn refused: built-in tool names cannot be requested by caller");
        }
      }
      throw new Error(
        "Claude seat spawn refused: requests with tools are rejected (client tool transport is not available; tools would be ignored)",
      );
    }

    // Orphan sweep at each runner start (brief invariant 6): stale dead
    // runs are reaped before a new sandbox is created. Best-effort: a
    // sweep failure never blocks the run.
    try {
      const sweepResult = await sweepOrphanSandboxes(this.sandboxRootDir, {
        onUnprovenChild: (unproven) => {
          process.stderr.write(
            `[claude-orphan-sweep] unproven child ${unproven.childPid} in ${unproven.runDir} skipped: ${unproven.reason}\n`,
          );
        },
      });
      if (sweepResult.skippedUnprovenChild) {
        process.stderr.write(
          `[claude-orphan-sweep] skipped ${sweepResult.skippedUnprovenChild} unproven child process(es)\n`,
        );
      }
    } catch {
      // Sweep is hygiene, not admission.
    }

    // 2. Admission and TTL checks
    const admission = checkTokenTtlAdmission(input.access.expiresAt, this.now());
    if (!admission.admitted) {
      yield { type: "error" };
      return;
    }

    // 3. Create isolated sandbox
    const sandbox = createClaudeRunSandbox({
      access: input.access,
      ...(this.sandboxRootDir ? { rootDir: this.sandboxRootDir } : {}),
    });
    const env = buildIsolatedEnvironment(sandbox, process.env, {
      binaryPath: this.binaryPath,
    });

    // 4. Construct candidate arguments. No --include-partial-messages:
    // partial stream_event deltas would duplicate the final assistant
    // message text. The parser still accepts stream_event envelopes
    // defensively, but steady state carries each text once via assistant
    // message.content[].
    let toolsArg = "";
    if (this.allowedCliTools && this.allowedCliTools.length > 0) {
      const allowed = this.allowedCliTools.filter((t) => ALLOWED_TYPED_TOOL_IDENTIFIERS.includes(t));
      toolsArg = allowed.join(",");
    }

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--setting-sources", "",
      "--settings", sandbox.settingsPath,
      "--strict-mcp-config",
      "--mcp-config", sandbox.mcpConfigPath,
      "--tools", toolsArg,
      "--disable-slash-commands",
      "--permission-mode", "dontAsk",
      "--model", input.request.modelId,
    ];

    let childPid = 0;
    let terminalResultEmitted = false;
    let streamFailed = false;

    let onRunAbort: (() => void) | null = null;

    // Check for abort that fired during preflight, sweep, or sandbox creation
    if (input.signal.aborted || runController.signal.aborted) {
      runController.abort();
      try { cleanClaudeRunSandbox(sandbox); } catch {}
      yield { type: "error" };
      return;
    }

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
      recordChildPidInSandbox(sandbox, childPid);

      // Drain stderr so a verbose child can never block on a full pipe.
      // Stderr is bounded and never forwarded to the caller.
      let stderrBytes = 0;
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > this.maxTotalBytes) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already dead; reaping below settles the run.
          }
        }
      });

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

      // Abort, deadline, and early-close must end work even while a read is
      // pending: kill the whole child tree and wake the consumer loop.
      const killChildTree = () => {
        if (this.killProcessTreeFn && childPid > 0) {
          this.killProcessTreeFn(childPid, "SIGKILL");
          try {
            child.kill("SIGKILL");
          } catch {
            // Already dead
          }
          return;
        }
        if (childPid > 0) {
          try {
            process.kill(-childPid, "SIGKILL");
            return;
          } catch {
            // Not our group leader (mocks) or already dead: fall through.
          }
        }
        try {
          child.kill("SIGKILL");
        } catch {
          // Already dead; reaping below settles the run.
        }
      };
      onRunAbort = () => {
        killChildTree();
        if (notifyNext) {
          const wake = notifyNext;
          notifyNext = null;
          wake();
        }
      };
      runController.signal.addEventListener("abort", onRunAbort);

      // Stream request NDJSON onto stdin: one stream-json line per message
      // ({type:"user",message:{role,content}}), the documented --input-format
      // stream-json shape (binary shows message.role user + content; the
      // assistant leg is symmetric). Never argv, never env.
      for (const message of input.request.messages) {
        const role = message.role === "assistant" ? "assistant" : "user";
        child.stdin?.write(
          JSON.stringify({ type: role, message: { role, content: message.content } }) + "\n",
        );
      }
      child.stdin?.end();

      // Read stdout stream
      let stdoutBuffer = "";
      let totalBytesReceived = 0;
      let pendingResult: ClaudeCodeCliEvent | null = null;
      let terminalSeen = false;
      let toolUseSeen = false;
      const partialToolInputs = new Map<number, { id: string; name: string; json: string }>();
      const blockKinds = new Map<number, string>();

      // Frame shapes of the pinned CLI 2.1.296 --output-format stream-json
      // (verified statically against the local binary: stream_event x72 with
      // content_block_start/delta/stop and message_start/delta/stop inner
      // events, assistant frames carrying message.content[], result frames
      // carrying subtype/is_error/usage/total_cost_usd; no live call made).
      // Unknown top-level types, second terminals, and post-terminal frames
      // are refused: an invented shape is never silently accepted.
      const failFrame = () => {
        streamFailed = true;
        pushQueue({ event: { type: "error" } });
      };

      const parseAssistantMessage = (message: unknown) => {
        if (!message || typeof message !== "object") return failFrame();
        const content = (message as { content?: unknown }).content;
        if (!Array.isArray(content)) return failFrame();
        for (const block of content) {
          if (!block || typeof block !== "object") return failFrame();
          const typed = block as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown };
          if (typed.type === "text" && typeof typed.text === "string") {
            if (typed.text) pushQueue({ event: { type: "text_delta", text: typed.text } });
          } else if (
            typed.type === "tool_use" &&
            typeof typed.id === "string" &&
            typeof typed.name === "string"
          ) {
            toolUseSeen = true;
            pushQueue({
              event: { type: "tool_use", id: typed.id, name: typed.name, input: typed.input ?? {} },
            });
          } else if (typed.type === "thinking" || typed.type === "redacted_thinking") {
            // Reasoning traces are never forwarded.
          } else {
            return failFrame();
          }
        }
      };

      const parseStreamEvent = (event: unknown) => {
        if (!event || typeof event !== "object") return failFrame();
        const inner = event as { type?: unknown; index?: unknown; delta?: unknown; content_block?: unknown };
        if (inner.type === "content_block_delta") {
          const delta = inner.delta as { type?: unknown; text?: unknown; partial_json?: unknown } | undefined;
          const index = typeof inner.index === "number" ? inner.index : -1;
          if (!delta || typeof delta.type !== "string") return;
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            if (delta.text) pushQueue({ event: { type: "text_delta", text: delta.text } });
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            const slot = partialToolInputs.get(index);
            if (slot) slot.json += delta.partial_json;
          }
          // thinking/signature/citation deltas are hints only; the terminal
          // result frame governs the outcome.
        } else if (inner.type === "content_block_start") {
          const block = inner.content_block as { type?: unknown; id?: unknown; name?: unknown } | undefined;
          const index = typeof inner.index === "number" ? inner.index : -1;
          if (!block || typeof block.type !== "string" || index < 0) return;
          blockKinds.set(index, block.type);
          if (
            block.type === "tool_use" &&
            typeof block.id === "string" &&
            typeof block.name === "string"
          ) {
            partialToolInputs.set(index, { id: block.id, name: block.name, json: "" });
          }
        } else if (inner.type === "content_block_stop") {
          const index = typeof inner.index === "number" ? inner.index : -1;
          const slot = index >= 0 ? partialToolInputs.get(index) : undefined;
          if (slot) {
            partialToolInputs.delete(index);
            // Empty streamed input means no partials were observed (partials
            // stay off at this seam): the assistant message carries the
            // complete block, so nothing is emitted here.
            if (slot.json) {
              let parsed: unknown;
              try {
                parsed = JSON.parse(slot.json);
              } catch {
                return failFrame();
              }
              toolUseSeen = true;
              pushQueue({ event: { type: "tool_use", id: slot.id, name: slot.name, input: parsed } });
            }
          }
          if (index >= 0) blockKinds.delete(index);
        } else if (
          inner.type === "message_start" ||
          inner.type === "message_delta" ||
          inner.type === "message_stop"
        ) {
          // Transport bookkeeping (incremental usage lives here); the
          // terminal result frame carries the canonical outcome.
        }
        // Unknown inner SSE events are ignored: they are hints, never the
        // terminal contract. Unknown TOP-LEVEL types are refused below.
      };

      const parseResult = (frame: { subtype?: unknown; is_error?: unknown; usage?: unknown }) => {
        if (terminalSeen) return failFrame();
        terminalSeen = true;
        if (frame.subtype !== "success" || frame.is_error === true) {
          return failFrame();
        }
        let usage: { inputTokens?: number; outputTokens?: number } | undefined;
        if (frame.usage !== undefined) {
          const raw = frame.usage as { input_tokens?: unknown; output_tokens?: unknown };
          if (!raw || typeof raw !== "object") return failFrame();
          usage = {};
          if (typeof raw.input_tokens === "number") usage.inputTokens = raw.input_tokens;
          if (typeof raw.output_tokens === "number") usage.outputTokens = raw.output_tokens;
          if (Object.keys(usage).length === 0) return failFrame();
        }
        // Stage pending terminal result: emitted only on exit agreement.
        pendingResult = {
          type: "result",
          finishReason: toolUseSeen ? "tool_calls" : "stop",
          ...(usage ? { usage } : {}),
        };
      };

      const parseLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let frame: unknown;
        try {
          frame = JSON.parse(trimmed);
        } catch {
          // Malformed frame rejects
          failFrame();
          return;
        }
        if (!frame || typeof frame !== "object") {
          failFrame();
          return;
        }
        const typed = frame as { type?: unknown; message?: unknown; event?: unknown };
        if (terminalSeen) {
          // No frame of any kind is legal after the terminal result.
          failFrame();
          return;
        }
        if (KNOWN_IGNORED_TOP_LEVEL_TYPES.has(typed.type as string)) {
          // Known lifecycle/transport frames: accepted as valid, not forwarded.
          return;
        } else if (typed.type === "assistant") {
          parseAssistantMessage(typed.message);
        } else if (typed.type === "stream_event") {
          parseStreamEvent(typed.event);
        } else if (typed.type === "result") {
          parseResult(typed as { subtype?: unknown; is_error?: unknown; usage?: unknown });
        } else if (typed.type === "error") {
          failFrame();
        } else {
          // Unknown top-level frame (including invented delta shapes): refuse.
          failFrame();
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
        let cleanupOk = true;
        if (childPid > 0) {
          if (this.reapProcessTreeFn) {
            await this.reapProcessTreeFn(childPid, "SIGTERM", 50);
          } else {
            await reapProcessTree(childPid, "SIGTERM", 50);
          }
        }
        try {
          cleanClaudeRunSandbox(sandbox);
        } catch {
          cleanupOk = false;
        }
        const exitAgreement =
          exitCode === 0 && !streamFailed && pendingResult !== null && cleanupOk;

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
        if (runState.earlyClosed) {
          return;
        }
        if (runController.signal.aborted) {
          yield { type: "error" };
          return;
        }
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            notifyNext = r;
            // Abort may fire between the check above and this wait.
            if (runController.signal.aborted || runState.earlyClosed) {
              notifyNext = null;
              r();
            }
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
      if (onRunAbort) {
        runController.signal.removeEventListener("abort", onRunAbort);
      }
      runController.abort();
      if (childPid > 0) {
        if (this.killProcessTreeFn) {
          this.killProcessTreeFn(childPid, "SIGKILL");
        }
        if (this.reapProcessTreeFn) {
          await this.reapProcessTreeFn(childPid, "SIGKILL", 50);
        } else {
          await reapProcessTree(childPid, "SIGKILL", 50);
        }
      }
      try {
        cleanClaudeRunSandbox(sandbox);
      } catch {
        // Terminal outcome already decided in the close handler; retry is best-effort.
      }
    }
  }
}
