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
} from "./claude-seat-mesh-contract.js";
import {
  buildClaudeQualificationRef,
  buildClaudeToolsQualificationRef,
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
  child.pid = 99999999;
  child.kill = vi.fn();
  return child;
}

const TOOLS_SCRATCH = join(tmpdir(), `h2a-claude-tools-test-${Date.now()}-${process.pid}`);

beforeEach(() => {
  mkdirSync(TOOLS_SCRATCH, { recursive: true });
});

afterEach(() => {
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
    killProcessTreeFn: vi.fn(),
    reapProcessTreeFn: vi.fn().mockResolvedValue(undefined),
  };

  const textRequest: ClaudeCodeCliRequest = {
    modelId: "claude-3-5-sonnet-20241022",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Hello Claude" }],
      },
    ],
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

  it("passes empty --tools when no tools are requested", async () => {
    let capturedArgs: string[] = [];
    const mockChild = createMockChild();
    const spawnFn = vi.fn((_cmd: string, args: string[]) => {
      capturedArgs = args;
      setTimeout(() => {
        mockChild.stdout.write(
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Hello" }] },
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
      capabilities: textOnlyCaps,
      sandboxRootDir: TOOLS_SCRATCH,
      spawnFn: spawnFn as any,
    });

    const events = [];
    for await (const event of runner.run({
      access: fakeAccess,
      request: textRequest,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(capturedArgs).toContain("--tools");
    const toolsIndex = capturedArgs.indexOf("--tools");
    expect(capturedArgs[toolsIndex + 1]).toBe("");
    expect(capturedArgs).toContain("--disable-slash-commands");
    expect(capturedArgs).toContain("--strict-mcp-config");
  });

  it("refuses spawn when caller requests tools because client tool transport is not available", async () => {
    const spawnFn = vi.fn(() => createMockChild());

    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedBase,
      capabilities: textOnlyCaps,
      sandboxRootDir: TOOLS_SCRATCH,
      spawnFn: spawnFn as any,
    });
    const iter = runner.run({
      access: fakeAccess,
      request: toolRequest,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(
      "requests with tools are rejected (client tool transport is not available; tools would be ignored)",
    );

    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("refuses spawn when caller requests built-in tool names (Bash, Edit, WebSearch, etc.)", async () => {
    const spawnFn = vi.fn(() => createMockChild());
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedBase,
      capabilities: textOnlyCaps,
      sandboxRootDir: TOOLS_SCRATCH,
      spawnFn: spawnFn as any,
    });

    for (const builtinName of [
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
    ]) {
      const maliciousRequest: ClaudeCodeCliRequest = {
        modelId: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: [{ type: "text", text: "run bash" }] }],
        tools: [{ name: builtinName, description: "exploit", inputSchema: {} }],
      };
      const iter = runner.run({
        access: fakeAccess,
        request: maliciousRequest,
        signal: new AbortController().signal,
      })[Symbol.asyncIterator]();
      await expect(iter.next()).rejects.toThrow("built-in tool names cannot be requested by caller");
    }

    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("refuses spawn fail-closed when caller requests tools even with candidate qualification (no silent dropping of tools)", async () => {
    const spawnFn = vi.fn(() => createMockChild());
    const qualifiedToolsRef = buildClaudeToolsQualificationRef(PINNED_TEST_DIGEST);
    const runner = new OfficialClaudeCodeCliRunner({
      ...qualifiedBase,
      capabilities: { ...textOnlyCaps, tools: qualifiedToolsRef },
      sandboxRootDir: TOOLS_SCRATCH,
      spawnFn: spawnFn as any,
    });

    const iter = runner.run({
      access: fakeAccess,
      request: toolRequest,
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    await expect(iter.next()).rejects.toThrow(
      "requests with tools are rejected (client tool transport is not available; tools would be ignored)",
    );
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
