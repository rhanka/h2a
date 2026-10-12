import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeCodeAccessProjection,
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliRequest,
} from "@sentropic/llm-mesh";
import {
  buildClaudeQualificationRef,
  OfficialClaudeCodeCliRunner,
} from "./claude-code-cli-runner.js";

const PINNED_TEST_BINARY = "/usr/bin/node";
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

const TOOLS_SCRATCH = join(tmpdir(), `h2a-claude-tools-test-${Date.now()}-${process.pid}`);

beforeEach(() => {
  mkdirSync(TOOLS_SCRATCH, { recursive: true });
  process.env.H2A_CLAUDE_EGRESS_ENFORCED = "1";
});

afterEach(() => {
  delete process.env.H2A_CLAUDE_EGRESS_ENFORCED;
  rmSync(TOOLS_SCRATCH, { recursive: true, force: true });
});

describe("claude-code-cli-tools", () => {
  const fakeAccess: ClaudeCodeAccessProjection = {
    accessToken: "test-token",
    expiresAt: Date.now() + 3600000,
    scopes: ["user:inference"],
  };

  const textOnlyCaps: ClaudeCodeCliCapabilities = {
    protocol: "claude-code-stream-json-v1",
    cliVersion: "2.1.296",
    source: "official",
    qualificationRef: buildClaudeQualificationRef(PINNED_TEST_DIGEST),
    // tools and history intentionally omitted
  };

  const qualifiedBase = {
    binaryPath: PINNED_TEST_BINARY,
    expectedDigest: PINNED_TEST_DIGEST,
    egressEnforcement: { mechanism: "test-host-firewall", inferenceHost: "api.anthropic.com" },
  };

  const toolRequest: ClaudeCodeCliRequest = {
    modelId: "claude-3-5-sonnet-20241022",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Look up weather in Boston" }],
      },
    ],
    tools: [
      {
        name: "get_weather",
        description: "Get current weather",
        inputSchema: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
    ],
  };

  it("default absence of tools capability passes empty --tools and no callable tool", async () => {
    let capturedArgs: string[] = [];
    const mockChild = createMockChild();
    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      capturedArgs = args;
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Tools not available" }] },
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
      ...qualifiedBase,
      capabilities: textOnlyCaps, // No tools capability
      sandboxRootDir: TOOLS_SCRATCH,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: toolRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    // Default configuration passes empty --tools
    expect(capturedArgs).toContain("--tools");
    const toolsIndex = capturedArgs.indexOf("--tools");
    expect(capturedArgs[toolsIndex + 1]).toBe("");

    // Verifies built-in tool execution is disabled
    expect(capturedArgs).toContain("--disable-slash-commands");
    expect(capturedArgs).toContain("--strict-mcp-config");
  });

  it("when tools capability is present, forwards declared tool names without built-in Bash/Edit tools", async () => {
    let capturedArgs: string[] = [];
    const mockChild = createMockChild();
    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      capturedArgs = args;
      setTimeout(() => {
        // Emit tool call as a real assistant content block
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "call_abc123",
                  name: "get_weather",
                  input: { location: "Boston" },
                },
              ],
            },
          }) + "\n",
        );
        mockChild.stdout.write(
          JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n",
        );
        mockChild.emit("close", 0);
      }, 10);
      return mockChild;
    });

    const capsWithTools: ClaudeCodeCliCapabilities = {
      ...textOnlyCaps,
      tools: "qual-tools-ref-1",
    };

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedBase,
      capabilities: capsWithTools,
      sandboxRootDir: TOOLS_SCRATCH,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: toolRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    // Declared tool names passed
    const toolsIndex = capturedArgs.indexOf("--tools");
    expect(capturedArgs[toolsIndex + 1]).toBe("get_weather");

    // Must NOT contain built-in tools (Bash, Read, Edit, Agent)
    expect(capturedArgs[toolsIndex + 1]).not.toContain("Bash");
    expect(capturedArgs[toolsIndex + 1]).not.toContain("Edit");
    expect(capturedArgs[toolsIndex + 1]).not.toContain("Read");

    expect(events).toEqual([
      {
        type: "tool_use",
        id: "call_abc123",
        name: "get_weather",
        input: { location: "Boston" },
      },
      {
        type: "result",
        finishReason: "tool_calls",
      },
    ]);
  });
});
