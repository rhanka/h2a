import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeCodeAccessProjection,
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliRequest,
} from "./claude-seat-mesh-contract.js";
import {
  OfficialClaudeCodeCliRunner,
  resolveClaudeBinaryFromPath,
} from "./claude-code-cli-runner.js";

// Explicit override for tests: absolute and present, no pinning involved.
const EXPLICIT_TEST_BINARY = process.execPath;

function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 99999999;
  child.kill = vi.fn();
  return child;
}

const RUNNER_SCRATCH = join(tmpdir(), `h2a-claude-runner-test-${Date.now()}-${process.pid}`);

beforeEach(() => {
  mkdirSync(RUNNER_SCRATCH, { recursive: true });
});

afterEach(() => {
  rmSync(RUNNER_SCRATCH, { recursive: true, force: true });
});

describe("claude-code-cli-runner (protocol)", () => {
  const fakeAccess: ClaudeCodeAccessProjection = {
    accessToken: "test-token",
    expiresAt: Date.now() + 3600000,
    scopes: ["user:inference"],
  };

  const fakeRequest: ClaudeCodeCliRequest = {
    modelId: "claude-3-5-sonnet-20241022",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Hello Claude" }],
      },
    ],
  };

  const validCaps: ClaudeCodeCliCapabilities = {
    protocol: "claude-code-stream-json-v1",
    cliVersion: "unpinned",
    source: "path-resolved-cli",
    qualificationRef: "unpinned:path-resolved-cli",
  };

  const defaultKillProcessTree = vi.fn();
  const defaultReapProcessTree = vi.fn().mockResolvedValue(undefined);

  const qualifiedOptions = {
    binaryPath: EXPLICIT_TEST_BINARY,
    capabilities: validCaps,
    sandboxRootDir: RUNNER_SCRATCH,
    killProcessTreeFn: defaultKillProcessTree,
    reapProcessTreeFn: defaultReapProcessTree,
  };

  it("resolves claude from PATH and refuses when absent, before spawn", async () => {
    const binDir = join(RUNNER_SCRATCH, "path-bin");
    mkdirSync(binDir, { recursive: true });
    const claudePath = join(binDir, "claude");
    writeFileSync(claudePath, "#!/bin/sh\nexit 1\n");
    chmodSync(claudePath, 0o755);

    expect(
      resolveClaudeBinaryFromPath({ PATH: `${binDir}${delimiter}/nonexistent` }),
    ).toBe(claudePath);
    expect(resolveClaudeBinaryFromPath({ PATH: "" })).toBeUndefined();
    expect(resolveClaudeBinaryFromPath({ PATH: "/nonexistent-dir" })).toBeUndefined();

    // Deterministic regardless of the ambient PATH: no candidate exists.
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent-dir-named-h2a";
      const runnerNoPath = new OfficialClaudeCodeCliRunner({
        capabilities: validCaps,
      });
      const iterator = runnerNoPath.run({
        access: fakeAccess,
        request: fakeRequest,
        signal: new AbortController().signal,
      })[Symbol.asyncIterator]();

      await expect(iterator.next()).rejects.toThrow("not found on PATH");
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  });

  it("refuses spawn on a relative override, a missing binary, or an unsupported protocol", async () => {
    const spawnFn = vi.fn(() => createMockChild());

    const runOnce = (options: Record<string, unknown>) => {
      const runner = new OfficialClaudeCodeCliRunner({
        ...qualifiedOptions,
        spawnFn: spawnFn as any,
        ...options,
      });
      return runner
        .run({
          access: fakeAccess,
          request: fakeRequest,
          signal: new AbortController().signal,
        })[Symbol.asyncIterator]()
        .next();
    };

    await expect(
      runOnce({ binaryPath: "relative/path/claude" }),
    ).rejects.toThrow("not found on PATH");
    await expect(
      runOnce({ binaryPath: "/nonexistent-dir-named-h2a/claude" }),
    ).rejects.toThrow("binary does not exist");
    await expect(
      runOnce({ capabilities: { ...validCaps, protocol: "other-protocol" } }),
    ).rejects.toThrow("unsupported protocol");

    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("ignores invented organization fields on the access projection (MAJ-2 source-gap)", async () => {
    // The mesh 0.25.0 projection carries only accessToken/expiresAt/scopes:
    // unknown extra fields never refuse spawn and never pass anywhere.
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => mockChild);
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const iterator = runner.run({
      access: { ...fakeAccess, organizationId: "org-claude-test-1" } as never,
      request: fakeRequest,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();
    const pendingRead = iterator.next();
    await new Promise((r) => setTimeout(r, 20));
    expect(spawnFn).toHaveBeenCalledTimes(1);
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
    await expect(pendingRead).resolves.toMatchObject({ done: true });
    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("formats exact argv and stdin NDJSON without prompt or credentials in argv", async () => {
    let capturedArgs: string[] = [];
    let stdinData = "";

    const mockChild = createMockChild();
    mockChild.stdin.on("data", (chunk: Buffer) => {
      stdinData += chunk.toString("utf8");
    });

    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      capturedArgs = args;
      // Emit a real 2.1.296-shaped response: system init, assistant message,
      // success result.
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({ type: "system", subtype: "init", session_id: "sess-1" }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: {
              id: "msg-1",
              type: "message",
              role: "assistant",
              model: "claude-3-5-sonnet-20241022",
              content: [{ type: "text", text: "Hi there!" }],
              stop_reason: null,
              usage: { input_tokens: 10, output_tokens: 5 },
            },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            usage: { input_tokens: 10, output_tokens: 5 },
            session_id: "sess-1",
          }) + "\n",
        );
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    // Check argv invariants
    expect(capturedArgs).toContain("-p");
    expect(capturedArgs).toContain("--input-format");
    expect(capturedArgs).toContain("stream-json");
    expect(capturedArgs).toContain("--output-format");
    expect(capturedArgs).toContain("stream-json");
    expect(capturedArgs).toContain("--verbose");
    // Partials stay off so assistant text is never emitted twice.
    expect(capturedArgs).not.toContain("--include-partial-messages");
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("claude-3-5-sonnet-20241022");

    // Stdin carries one stream-json line per message, never argv/env-shaped.
    expect(stdinData).toContain("Hello Claude");
    const stdinLines = stdinData.trim().split("\n");
    expect(stdinLines).toHaveLength(1);
    expect(JSON.parse(stdinLines[0]!)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Hello Claude" }],
      },
    });
    expect(stdinData).not.toContain('"messages"');
    // Argv must NOT contain prompt or secret tokens
    expect(capturedArgs.join(" ")).not.toContain("Hello Claude");
    expect(capturedArgs.join(" ")).not.toContain("test-token");

    // Events emitted correctly
    expect(events).toEqual([
      { type: "text_delta", text: "Hi there!" },
      {
        type: "result",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
  });

  it("assembles streamed tool_use input from stream_event envelopes", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        const write = (frame: unknown) => {
          mockChild.stdout.write(JSON.stringify(frame) + "\n");
        };
        write({ type: "system", subtype: "init", session_id: "sess-2" });
        write({
          type: "stream_event",
          event: { type: "message_start", message: { id: "msg-2" } },
        });
        write({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "call_1", name: "get_weather" },
          },
        });
        write({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"location":' },
          },
        });
        write({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '"Boston"}' },
          },
        });
        write({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
        write({
          type: "assistant",
          message: {
            id: "msg-2",
            type: "message",
            role: "assistant",
            content: [
              { type: "tool_use", id: "call_1", name: "get_weather", input: { location: "Boston" } },
            ],
          },
        });
        write({ type: "result", subtype: "success", is_error: false });
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    // Both the streamed assembly and the final message describe the same
    // call: each arrival is forwarded once, in arrival order.
    expect(events).toEqual([
      {
        type: "tool_use",
        id: "call_1",
        name: "get_weather",
        input: { location: "Boston" },
      },
      {
        type: "tool_use",
        id: "call_1",
        name: "get_weather",
        input: { location: "Boston" },
      },
      { type: "result", finishReason: "tool_calls" },
    ]);
  });

  it("refuses invented top-level delta shapes from the pre-2.1.296 draft", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({ type: "text_delta", text: "invented" }) + "\n",
        );
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error" }]);
  });

  it("refuses error results, double terminals, post-terminal, and unknown frames", async () => {
    const runFrames = async (frames: unknown[]) => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => {
        setTimeout(() => {
          for (const frame of frames) {
            mockChild.stdout.write(JSON.stringify(frame) + "\n");
          }
          mockChild.emit("close", 0);
        }, 10);
        return mockChild;
      });
      const runner = new OfficialClaudeCodeCliRunner({
        ...qualifiedOptions,
        spawnFn: spawnFn as any,
      });
      const events = [];
      for await (const event of runner.run({
        access: fakeAccess,
        request: fakeRequest,
        signal: new AbortController().signal,
      })) {
        events.push(event);
      }
      return events;
    };

    // is_error result
    expect(
      await runFrames([{ type: "result", subtype: "success", is_error: true }]),
    ).toEqual([{ type: "error" }]);
    // Non-success subtype
    expect(
      await runFrames([{ type: "result", subtype: "error_during_execution", is_error: true }]),
    ).toEqual([{ type: "error" }]);
    // Double terminal
    expect(
      await runFrames([
        { type: "result", subtype: "success", is_error: false },
        { type: "result", subtype: "success", is_error: false },
      ]),
    ).toEqual([{ type: "error" }]);
    // Post-terminal content
    expect(
      await runFrames([
        { type: "result", subtype: "success", is_error: false },
        { type: "assistant", message: { content: [{ type: "text", text: "late" }] } },
      ]),
    ).toEqual([{ type: "error" }]);
    // Unknown top-level type
    expect(await runFrames([{ type: "frobnicator", text: "x" }])).toEqual([
      { type: "error" },
    ]);
  });

  it("accepts real CLI 2.1.296 frames (rate_limit_event, tool_use_summary, user, auth_status)", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({ type: "system", subtype: "init" }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "auth_status",
            isAuthenticating: false,
            output: "",
            error: null,
            uuid: "test-uuid-1",
            session_id: "test-session-1",
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({ type: "keep_alive" }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({ type: "control_request" }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "user",
            message: { role: "user", content: "Hello" },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "rate_limit_event",
            rate_limit_info: { status: "allowed" },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Hello there!" }] },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "tool_use_summary",
            summary: "no tools used",
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            usage: { input_tokens: 10, output_tokens: 5 },
          }) + "\n",
        );
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello there!" },
      {
        type: "result",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
  });

  it("yields error when exit 0 occurs without terminal result frame", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Cut off" }] },
          }) + "\n",
        );
        mockChild.emit("close", 0); // Exited 0 without emitting "result" frame
      }, 10);
      return mockChild;
    });

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Cut off" },
      { type: "error" },
    ]);
  });

  it("blocks result emission when sandbox cleanup fails", async () => {
    if (process.geteuid?.() === 0) return; // root bypasses permission bits; failure not inducible
    const rootDir = join(tmpdir(), `h2a-claude-cleanup-test-${Date.now()}-${process.pid}`);
    mkdirSync(rootDir, { recursive: true });
    try {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => {
        // Sandbox is created synchronously before spawn: lock the root so
        // removing the run directory fails deterministically in cleanup.
        expect(readdirSync(rootDir).filter((n) => n.startsWith("run_"))).toHaveLength(1);
        chmodSync(rootDir, 0o500);
        setTimeout(() => {
          mockChild.stdout.write(
            JSON.stringify({
              type: "assistant",
              message: { content: [{ type: "text", text: "Hi there!" }] },
            }) + "\n",
          );
          mockChild.stdout.write(
            JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n",
          );
          mockChild.emit("close", 0);
        }, 10);
        return mockChild;
      });

      const runner = new OfficialClaudeCodeCliRunner({
        ...qualifiedOptions,
        spawnFn: spawnFn as any,
        sandboxRootDir: rootDir,
      });

      const events = [];
      for await (const event of runner.run({
        access: fakeAccess,
        request: fakeRequest,
        signal: new AbortController().signal,
      })) {
        events.push(event);
      }

      // Terminal success must NOT be emitted: cleanup failure blocks result.
      expect(events).toEqual([
        { type: "text_delta", text: "Hi there!" },
        { type: "error" },
      ]);
    } finally {
      chmodSync(rootDir, 0o700);
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("fails on malformed or oversized NDJSON frames without leaking raw data", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stdout.write("CANARY_CORRUPTED_NOT_JSON\n");
      }, 10);
      return mockChild;
    });

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error" }]);
  });

  it("refuses caller abort before spawn and never creates child process", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => mockChild);
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error" }]);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("abort during a pending read kills the child and ends the stream", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => mockChild); // Silent: never writes, never closes.
    const controller = new AbortController();
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
      timeoutMs: 30_000,
    });

    const iterator = runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    const first = await pending;
    expect(first.value).toEqual({ type: "error" });
    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it("deadline during a pending read kills the child and ends the stream", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => mockChild); // Silent: never writes, never closes.
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
      timeoutMs: 120,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error" }]);
    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("iterator early-close ends a pending read promptly", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => mockChild); // Silent: pending read in queue
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
      timeoutMs: 30_000,
    });

    const iterator = runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    // Start a read while child has emitted nothing: iterator is suspended waiting for output
    const pendingRead = iterator.next();
    await new Promise((r) => setTimeout(r, 20));

    // Early close while read is pending
    const returnPromise = iterator.return?.();

    await expect(returnPromise).resolves.toMatchObject({ done: true });
    await expect(pendingRead).resolves.toMatchObject({ done: true });
    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("drains child stderr without forwarding it to the caller", async () => {
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stderr.write(Buffer.alloc(65536, 0x41));
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Hi there!" }] },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n",
        );
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hi there!" },
      { type: "result", finishReason: "stop" },
    ]);
  });

  it("sweeps stale dead orphans at runner start", async () => {
    const staleDir = join(RUNNER_SCRATCH, "run-stale-orphan");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(
      join(staleDir, "run-meta.json"),
      JSON.stringify({ pid: 99999996, createdAt: Date.now() - 600_000 }),
    );

    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "fresh" }] },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n",
        );
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "fresh" },
      { type: "result", finishReason: "stop" },
    ]);
    expect(existsSync(staleDir)).toBe(false);
  });

  it("abort kills a real silent child and its grandchildren before any output", async () => {
    const scriptPath = join(RUNNER_SCRATCH, "silent-fake-claude.sh");
    const grandchildPidPath = join(RUNNER_SCRATCH, "grandchild.pid");
    writeFileSync(
      scriptPath,
      `#!/bin/sh
sleep 60 &
echo $! > "${grandchildPidPath}"
wait
`,
    );
    chmodSync(scriptPath, 0o755);

    let childPid = 0;
    const spawnFn = ((cmd: string, args: string[], opts: object) => {
      const child = spawn(cmd, args, opts as never);
      childPid = child.pid ?? 0;
      return child;
    }) as never;

    const controller = new AbortController();
    const runner = new OfficialClaudeCodeCliRunner({
      binaryPath: scriptPath,
      capabilities: validCaps,
      spawnFn,
      sandboxRootDir: RUNNER_SCRATCH,
      timeoutMs: 30_000,
    });

    const iterator = runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();

    let grandchildPid = 0;
    const spawnDeadline = Date.now() + 5000;
    while (Date.now() < spawnDeadline) {
      if (existsSync(grandchildPidPath)) {
        try {
          const raw = readFileSync(grandchildPidPath, "utf8").trim();
          if (raw) {
            grandchildPid = parseInt(raw, 10);
            if (grandchildPid > 0) break;
          }
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(childPid).toBeGreaterThan(0);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(() => process.kill(childPid, 0)).not.toThrow();
    expect(() => process.kill(grandchildPid, 0)).not.toThrow();

    controller.abort();

    await expect(pending).resolves.toEqual({
      value: { type: "error" },
      done: false,
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });

    const deadline = Date.now() + 3000;
    for (;;) {
      let childAlive = true;
      let grandchildAlive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        childAlive = false;
      }
      try {
        process.kill(grandchildPid, 0);
      } catch {
        grandchildAlive = false;
      }
      if (!childAlive && !grandchildAlive) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `aborted child/grandchild survived SIGKILL (child=${childAlive}, grandchild=${grandchildAlive})`,
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }, 15000);
});
