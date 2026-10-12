import { describe, expect, it, vi } from "vitest";
import {
  ClaudeCodeRuntimeClient,
  type ClaudeCodeCliCapabilities,
  type ClaudeCodeCliEvent,
  type ClaudeCodeCliRunner,
} from "@sentropic/llm-mesh";
import {
  bindClaudeCodeAttemptRunner,
  createBoundAttemptRunner,
  getClaudeSeatSeamDependencyHandoff,
  isClaudeSeatGatewaySeamAvailable,
} from "./claude-code-seat-attempt.js";
import { createGatewayHost } from "./host.js";

describe("claude-code-seat-wiring (gateway host integration)", () => {
  const fakeCapabilities: ClaudeCodeCliCapabilities = {
    protocol: "claude-code-stream-json-v1",
    cliVersion: "2.1.296",
    source: "official",
    qualificationRef: "qual-wiring-test",
  };

  it("gate 3A: recognizes absent pre-acquire seam on llm-mesh 0.25.0 and emits structured dependency handoff", () => {
    // 0.25.0 baseline facade has no pre-acquire attempt seam
    const baselineFacade = {
      enroll: vi.fn(),
      acquire: vi.fn(),
      createRoutePlanner: vi.fn(),
    } as any;

    expect(isClaudeSeatGatewaySeamAvailable(baselineFacade)).toBe(false);

    const handoff = getClaudeSeatSeamDependencyHandoff();
    expect(handoff.status).toBe("blocked_pending_mesh_seam");
    expect(handoff.targetPackage).toBe("@sentropic/llm-mesh");
    expect(handoff.pinnedBaseline).toBe("0.25.0");
    expect(handoff.requiredSeam).toContain("Pre-acquire account attempt lease hook");
  });

  it("binds lease to runner and holds it until terminal result", async () => {
    let leaseReleased = false;
    const fakeLease = {
      ownerScope: "cli:owner-1",
      accountId: "acct_claude_1",
      acquiredAt: Date.now(),
      async release() {
        leaseReleased = true;
      },
    };

    const mockRunner: ClaudeCodeCliRunner = {
      async *run() {
        yield { type: "text_delta", text: "Hello" };
        expect(leaseReleased).toBe(false); // Lease held during streaming
        yield { type: "result", finishReason: "stop" };
      },
    };

    const boundRunner = createBoundAttemptRunner({
      lease: fakeLease,
      runner: mockRunner,
      capabilities: fakeCapabilities,
    });

    const events: ClaudeCodeCliEvent[] = [];
    for await (const event of boundRunner.run({
      access: { accessToken: "tok", expiresAt: Date.now() + 3600000, scopes: ["user:inference"] },
      request: { modelId: "claude-3-5-sonnet-20241022", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "result", finishReason: "stop" },
    ]);
    expect(leaseReleased).toBe(true); // Lease released upon completion
  });

  it("releases lease on early termination or stream error", async () => {
    let leaseReleased = false;
    const fakeLease = {
      ownerScope: "cli:owner-1",
      accountId: "acct_claude_1",
      acquiredAt: Date.now(),
      async release() {
        leaseReleased = true;
      },
    };

    const mockRunner: ClaudeCodeCliRunner = {
      async *run() {
        yield { type: "text_delta", text: "Partial" };
        throw new Error("Stream crash");
      },
    };

    const boundRunner = createBoundAttemptRunner({
      lease: fakeLease,
      runner: mockRunner,
      capabilities: fakeCapabilities,
    });

    try {
      for await (const _ of boundRunner.run({
        access: { accessToken: "tok", expiresAt: Date.now() + 3600000, scopes: ["user:inference"] },
        request: { modelId: "claude-3-5-sonnet-20241022", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
        signal: new AbortController().signal,
      })) {
        // consume
      }
    } catch {
      // Expected crash
    }

    expect(leaseReleased).toBe(true);
  });

  it("projects access without refresh token, headers, or owner metadata", async () => {
    let capturedAccess: any;
    const mockRunner: ClaudeCodeCliRunner = {
      async *run(input) {
        capturedAccess = input.access;
        yield { type: "text_delta", text: "Hello" };
        yield { type: "result", finishReason: "stop" };
      },
    };

    const client = new ClaudeCodeRuntimeClient({
      runner: mockRunner,
      capabilities: fakeCapabilities,
    });

    const stream = await client.stream({
      modelId: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    }, {
      auth: {
        type: "account-transport",
        provider: "claude-code",
        accessToken: "seat-access-tok",
        refreshToken: "secret-refresh-tok", // Must NOT be projected
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        metadata: { scopes: ["user:inference"] },
      } as any,
    });

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(capturedAccess).toBeDefined();
    expect(capturedAccess.accessToken).toBe("seat-access-tok");
    expect(capturedAccess.scopes).toEqual(["user:inference"]);
    // Must NOT leak refresh token
    expect(capturedAccess).not.toHaveProperty("refreshToken");
    expect(capturedAccess).not.toHaveProperty("refresh_token");
  });

  it("delegates direct API-key auth only to explicitly supplied direct client and refuses if none exists", async () => {
    const mockFallback = {
      stream: vi.fn().mockResolvedValue((async function* () {
        yield { type: "content_delta", data: { delta: "from-fallback" } };
      })()),
      generate: vi.fn(),
    };

    const clientWithFallback = new ClaudeCodeRuntimeClient({
      runner: { async *run() {} },
      capabilities: fakeCapabilities,
      fallback: mockFallback as any,
    });

    // Request with direct API key auth
    const stream = await clientWithFallback.stream({
      modelId: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Direct key" }],
      auth: { type: "bearer", token: "sk-ant-user-key" } as any,
    });

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(mockFallback.stream).toHaveBeenCalled();
    expect(events).toEqual([{ type: "content_delta", data: { delta: "from-fallback" } }]);

    // Without fallback client: direct API key throws static auth failure
    const clientNoFallback = new ClaudeCodeRuntimeClient({
      runner: { async *run() {} },
      capabilities: fakeCapabilities,
    });

    await expect(
      clientNoFallback.stream({
        modelId: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Direct key" }],
        auth: { type: "bearer", token: "sk-ant-user-key" } as any,
      }),
    ).rejects.toThrow();
  });

  it("integrates Claude adapter into gateway host and exposes readiness", async () => {
    const mockClaudeClient = {
      stream: vi.fn(),
      generate: vi.fn(),
    };

    const host = createGatewayHost({
      claudeClient: mockClaudeClient as any,
    });

    await host.ready;
    expect((await host.app.request("/readyz")).status).toBe(200);
    expect((await host.app.request("/health")).status).toBe(200);
  });
});
