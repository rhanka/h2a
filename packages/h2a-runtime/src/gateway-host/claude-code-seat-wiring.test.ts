import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_SEAT_CAPABILITIES, createClaudeSeatClient } from "./claude-seat-client.js";
import { createGatewayHost } from "./host.js";

vi.mock("../claude-code-cli-lifecycle.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../claude-code-cli-lifecycle.js")>();
  return {
    ...mod,
    sweepOrphanSandboxes: vi
      .fn()
      .mockResolvedValue({ swept: 0, retained: 0, skippedAlive: 0 }),
  };
});

let tempBase = "";

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), "h2a-claude-wiring-"));
  vi.stubEnv("HOME", join(tempBase, "home"));
  vi.stubEnv("XDG_RUNTIME_DIR", join(tempBase, "run"));
  vi.stubEnv("H2A_ROOT", join(tempBase, "h2a-root"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  tempBase = "";
});

describe("claude-seat-client (gateway host composition, common seat model)", () => {
  it("exposes honest unpinned descriptors, never attestation", () => {
    expect(CLAUDE_SEAT_CAPABILITIES.protocol).toBe("claude-code-stream-json-v1");
    expect(Object.values(CLAUDE_SEAT_CAPABILITIES).every((value) => value.length > 0)).toBe(true);
  });

  it("builds the mesh runtime client on the h2a runner", () => {
    const client = createClaudeSeatClient();
    // Mesh AnthropicAdapterClient surface: stream + generate, like every seat.
    expect(typeof (client as { stream?: unknown }).stream).toBe("function");
    expect(typeof (client as { generate?: unknown }).generate).toBe("function");
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

  it("serves readiness with the default PATH-resolved seat (no configuration)", async () => {
    const host = createGatewayHost();
    await host.ready;
    expect((await host.app.request("/readyz")).status).toBe(200);
    expect((await host.app.request("/health")).status).toBe(200);
  });
});
