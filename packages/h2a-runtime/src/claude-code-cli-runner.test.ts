import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeCodeAccessProjection,
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliRequest,
} from "./claude-seat-mesh-contract.js";
import {
  buildClaudeQualificationRef,
  OfficialClaudeCodeCliRunner,
} from "./claude-code-cli-runner.js";

const PINNED_TEST_BINARY = process.execPath;
const PINNED_TEST_DIGEST = createHash("sha256")
  .update(readFileSync(PINNED_TEST_BINARY))
  .digest("hex");

function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 12345;
  child.kill = vi.fn();
  return child;
}

const RUNNER_SCRATCH = join(tmpdir(), `h2a-claude-runner-test-${Date.now()}-${process.pid}`);

beforeEach(() => {
  mkdirSync(RUNNER_SCRATCH, { recursive: true });
  process.env.H2A_CLAUDE_EGRESS_ENFORCED = "1";
});

afterEach(() => {
  delete process.env.H2A_CLAUDE_EGRESS_ENFORCED;
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
    cliVersion: "2.1.296",
    source: "official",
    qualificationRef: buildClaudeQualificationRef(PINNED_TEST_DIGEST),
  };

  const qualifiedOptions = {
    binaryPath: PINNED_TEST_BINARY,
    expectedDigest: PINNED_TEST_DIGEST,
    capabilities: validCaps,
    sandboxRootDir: RUNNER_SCRATCH,
    egressEnforcement: { mechanism: "test-host-firewall", inferenceHost: "api.anthropic.com" },
    managedSettingsPaths: [] as readonly string[],
  };

  it("refuses relative binary path or missing qualification reference before spawn", async () => {
    const runnerNoAbs = new OfficialClaudeCodeCliRunner({
      binaryPath: "relative/path/claude",
      capabilities: validCaps,
    });

    const iterator = runnerNoAbs.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("absolute binary path required");

    const runnerNoQual = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      capabilities: { ...validCaps, qualificationRef: "" },
    });

    const iter2 = runnerNoQual.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    await expect(iter2.next()).rejects.toThrow("qualification attestation required");
  });

  it("refuses spawn without a mandatory fingerprint, on version drift, or on invented references", async () => {
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

    // No fingerprint: any absolute binary would otherwise pass.
    await expect(runOnce({ expectedDigest: undefined })).rejects.toThrow(
      "binary fingerprint required",
    );
    // Expected-version drift.
    await expect(runOnce({ expectedVersion: "2.1.297" })).rejects.toThrow(
      "version pin mismatch",
    );
    // Attested CLI version drift.
    await expect(
      runOnce({ capabilities: { ...validCaps, cliVersion: "2.1.297" } }),
    ).rejects.toThrow("CLI version attestation mismatch");
    // Nonempty invented reference without digest binding.
    await expect(
      runOnce({ capabilities: { ...validCaps, qualificationRef: "qual-2026-10-12" } }),
    ).rejects.toThrow("qualification attestation required");
    // Wrong fingerprint.
    await expect(
      runOnce({ expectedDigest: "0".repeat(64) }),
    ).rejects.toThrow("binary digest mismatch");

    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("refuses spawn while inference-only egress is not enforced", async () => {
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

    const saved = process.env.H2A_CLAUDE_EGRESS_ENFORCED;
    try {
      // No out-of-band switch, even with an attestation: refuse.
      delete process.env.H2A_CLAUDE_EGRESS_ENFORCED;
      await expect(runOnce({})).rejects.toThrow("egress not enforced");

      process.env.H2A_CLAUDE_EGRESS_ENFORCED = "1";
      // No attestation, even with the switch: refuse.
      await expect(runOnce({ egressEnforcement: undefined })).rejects.toThrow(
        "egress not enforced",
      );
      // Empty mechanism: refuse.
      await expect(
        runOnce({ egressEnforcement: { mechanism: "  ", inferenceHost: "api.anthropic.com" } }),
      ).rejects.toThrow("egress not enforced");
      // Wrong inference host: refuse.
      await expect(
        runOnce({ egressEnforcement: { mechanism: "netns", inferenceHost: "evil.example" } }),
      ).rejects.toThrow("egress not enforced");
    } finally {
      if (saved === undefined) delete process.env.H2A_CLAUDE_EGRESS_ENFORCED;
      else process.env.H2A_CLAUDE_EGRESS_ENFORCED = saved;
    }

    expect(spawnFn).not.toHaveBeenCalled();
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

  it("refuses spawn while managed configuration prevents isolation", async () => {
    const managedFile = join(RUNNER_SCRATCH, "managed-settings.json");
    writeFileSync(managedFile, "{}");
    const mockChild = createMockChild();
    const spawnFn = vi.fn(() => mockChild);
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedOptions,
      spawnFn: spawnFn as any,
      managedSettingsPaths: [managedFile],
    });

    await expect(
      runner
        .run({
          access: fakeAccess,
          request: fakeRequest,
          signal: new AbortController().signal,
        })[Symbol.asyncIterator]()
        .next(),
    ).rejects.toThrow("managed configuration prevents isolation");
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
    const spawnFn = vi.fn(() => {
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Partial" }] },
          }) + "\n",
        );
      }, 10);
      return mockChild;
    });
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
    await expect(iterator.next()).resolves.toEqual({
      value: { type: "text_delta", text: "Partial" },
      done: false,
    });
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
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

  it("abort kills a real silent child before any output", async () => {
    const scriptPath = join(RUNNER_SCRATCH, "silent-fake-claude.sh");
    writeFileSync(scriptPath, "#!/bin/sh\nsleep 60\n");
    chmodSync(scriptPath, 0o755);
    const digest = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");

    let childPid = 0;
    const spawnFn = ((cmd: string, args: string[], opts: object) => {
      const child = spawn(cmd, args, opts as never);
      childPid = child.pid ?? 0;
      return child;
    }) as never;

    const controller = new AbortController();
    const runner = new OfficialClaudeCodeCliRunner({
      binaryPath: scriptPath,
      expectedDigest: digest,
      capabilities: { ...validCaps, qualificationRef: buildClaudeQualificationRef(digest) },
      spawnFn,
      sandboxRootDir: RUNNER_SCRATCH,
      egressEnforcement: { mechanism: "test-host-firewall", inferenceHost: "api.anthropic.com" },
      timeoutMs: 30_000,
    });

    const iterator = runner.run({
      access: fakeAccess,
      request: fakeRequest,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((r) => setTimeout(r, 200));
    expect(childPid).toBeGreaterThan(0);
    expect(() => process.kill(childPid, 0)).not.toThrow();
    controller.abort();

    await expect(pending).resolves.toEqual({
      value: { type: "error" },
      done: false,
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });

    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        process.kill(childPid, 0);
      } catch {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error("aborted child survived SIGKILL");
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }, 15000);
});
