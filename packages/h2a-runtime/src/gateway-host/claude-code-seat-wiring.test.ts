import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_BINARY_DIGEST_ENV,
  CLAUDE_BINARY_PATH_ENV,
  claudeSeatClientConfigFromEnv,
  createClaudeSeatClient,
  createClaudeSeatClientFromEnv,
} from "./claude-seat-client.js";
import { createGatewayHost } from "./host.js";

const TEST_DIGEST = "a".repeat(64);

function withSeatEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const savedPath = process.env[CLAUDE_BINARY_PATH_ENV];
  const savedDigest = process.env[CLAUDE_BINARY_DIGEST_ENV];
  try {
    if (env.path === undefined) delete process.env[CLAUDE_BINARY_PATH_ENV];
    else process.env[CLAUDE_BINARY_PATH_ENV] = env.path;
    if (env.digest === undefined) delete process.env[CLAUDE_BINARY_DIGEST_ENV];
    else process.env[CLAUDE_BINARY_DIGEST_ENV] = env.digest;
    fn();
  } finally {
    if (savedPath === undefined) delete process.env[CLAUDE_BINARY_PATH_ENV];
    else process.env[CLAUDE_BINARY_PATH_ENV] = savedPath;
    if (savedDigest === undefined) delete process.env[CLAUDE_BINARY_DIGEST_ENV];
    else process.env[CLAUDE_BINARY_DIGEST_ENV] = savedDigest;
  }
}

describe("claude-seat-client (gateway host composition, common seat model)", () => {
  it("reads seat qualification from the environment, never hardcoded", () => {
    withSeatEnv({ path: undefined, digest: undefined }, () => {
      expect(claudeSeatClientConfigFromEnv()).toBeUndefined();
    });
    withSeatEnv({ path: "  ", digest: TEST_DIGEST }, () => {
      expect(claudeSeatClientConfigFromEnv()).toBeUndefined();
    });
    withSeatEnv({ path: "/opt/claude/bin/claude", digest: "not-hex" }, () => {
      expect(claudeSeatClientConfigFromEnv()).toBeUndefined();
    });
    withSeatEnv({ path: "/opt/claude/bin/claude", digest: TEST_DIGEST }, () => {
      expect(claudeSeatClientConfigFromEnv()).toEqual({
        binaryPath: "/opt/claude/bin/claude",
        expectedDigest: TEST_DIGEST,
      });
    });
  });

  it("builds the mesh runtime client on the h2a runner with a digest-bound attestation", () => {
    const client = createClaudeSeatClient({
      binaryPath: "/opt/claude/bin/claude",
      expectedDigest: TEST_DIGEST,
    });
    // Mesh AnthropicAdapterClient surface: stream + generate, like every seat.
    expect(typeof (client as { stream?: unknown }).stream).toBe("function");
    expect(typeof (client as { generate?: unknown }).generate).toBe("function");
  });

  it("composes nothing when the seat is unconfigured (fail-closed per attempt downstream)", () => {
    withSeatEnv({ path: undefined, digest: undefined }, () => {
      expect(createClaudeSeatClientFromEnv()).toBeUndefined();
    });
  });

  it("serves readiness with an explicitly composed Claude seat client", async () => {
    const mockClaudeClient = {
      stream: vi.fn(),
      generate: vi.fn(),
    };

    const host = createGatewayHost({
      claudeClient: mockClaudeClient as never,
    });

    await host.ready;
    expect((await host.app.request("/readyz")).status).toBe(200);
    expect((await host.app.request("/health")).status).toBe(200);
  });

  it("serves readiness without any Claude seat when unconfigured", async () => {
    let host: ReturnType<typeof createGatewayHost> | undefined;
    withSeatEnv({ path: undefined, digest: undefined }, () => {
      host = createGatewayHost();
    });
    if (!host) throw new Error("gateway host was not created");
    await host.ready;
    expect((await host.app.request("/readyz")).status).toBe(200);
    expect((await host.app.request("/health")).status).toBe(200);
  });
});
