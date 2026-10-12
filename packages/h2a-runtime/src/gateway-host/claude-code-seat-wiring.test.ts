import { describe, expect, it, vi } from "vitest";
import type {
  ClaudeCodeCliCapabilities,
  ClaudeCodeCliEvent,
  ClaudeCodeCliRunner,
} from "../claude-seat-mesh-contract.js";
import {
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
    expect(handoff.targetPackage).toContain("pinned 0.25.0");
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

  it("releases the lease only after inner reaping and cleanup settle", async () => {
    const order: string[] = [];
    const fakeLease = {
      ownerScope: "cli:owner-1",
      accountId: "acct_claude_1",
      acquiredAt: Date.now(),
      async release() {
        order.push("lease-release");
      },
    };

    const mockRunner: ClaudeCodeCliRunner = {
      async *run() {
        try {
          yield { type: "error" };
        } finally {
          order.push("inner-cleanup"); // Stands for reaping + file cleanup.
        }
      },
    };

    const boundRunner = createBoundAttemptRunner({
      lease: fakeLease,
      runner: mockRunner,
      capabilities: fakeCapabilities,
    });

    const iterator = boundRunner.run({
      access: { accessToken: "tok", expiresAt: Date.now() + 3600000, scopes: ["user:inference"] },
      request: { modelId: "claude-3-5-sonnet-20241022", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: { type: "error" },
      done: false,
    });
    expect(order).toEqual([]);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(order).toEqual(["inner-cleanup", "lease-release"]);
  });

  it("passes the projected access through to the runner untouched", async () => {
    // The no-refresh guarantee at this boundary is structural: the seat
    // access shape carries no refresh field, and the binding forwards the
    // projection opaquely. Mesh-side projection is the mesh suite's own
    // coverage; child-observable absence is proven by the refresh probe
    // with real subprocesses (claude-code-cli-refresh-probe.test.ts).
    let capturedAccess: any;
    const mockRunner: ClaudeCodeCliRunner = {
      async *run(input) {
        capturedAccess = input.access;
        yield { type: "text_delta", text: "Hello" };
        yield { type: "result", finishReason: "stop" };
      },
    };

    const boundRunner = createBoundAttemptRunner({
      lease: {
        ownerScope: "cli:owner-1",
        accountId: "acct_claude_1",
        acquiredAt: Date.now(),
        release: async () => {},
      },
      runner: mockRunner,
      capabilities: fakeCapabilities,
    });

    const seatAccess = {
      accessToken: "seat-access-tok",
      expiresAt: Date.now() + 3600000,
      scopes: ["user:inference"],
    };
    const events = [];
    for await (const event of boundRunner.run({
      access: seatAccess,
      request: {
        modelId: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      },
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(capturedAccess).toEqual(seatAccess);
    expect(capturedAccess).not.toHaveProperty("refreshToken");
    expect(capturedAccess).not.toHaveProperty("refresh_token");
    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "result", finishReason: "stop" },
    ]);
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
