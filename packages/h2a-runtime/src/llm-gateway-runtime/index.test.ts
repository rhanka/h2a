import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalGatewayApp } from "./index.js";
import { lookupToken, resetSessions } from "./sticky.js";
import { resetSessionLedger } from "./session-ledger.js";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("H2A_LLM_MESH_OWNER_SCOPE", "cli:test-owner");
  resetSessions();
  resetSessionLedger();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("embedded consumer-neutral gateway host", () => {
  it("mints an opaque local bearer without selecting or serializing an account route", async () => {
    const app = createLocalGatewayApp();
    const response = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "gateway-session",
        clientSessionId: "claude-session",
        workspaceId: "/workspace",
        // Legacy body routing fields are deliberately ignored.
        provider: "cloud-code",
        requiredTransport: "cloud-code",
        model: "invented-model",
      }),
    });
    expect(response.status).toBe(201);
    const result = await response.json() as { gatewayToken: string };
    expect(result.gatewayToken).toMatch(/^gw-v2-/);
    const session = await lookupToken(result.gatewayToken);
    expect(session).toMatchObject({
      sessionId: "gateway-session",
      clientSessionId: "claude-session",
      workspaceId: "/workspace",
    });
    expect(JSON.stringify(session)).not.toMatch(/account|provider|model|route|token.*token/i);
  });

  it("requires the minted bearer on the canonical Sentropic gateway routes", async () => {
    const app = createLocalGatewayApp();
    const response = await app.request("/v1/models");
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("account");
  });

  it("keeps the status endpoint redacted until the mesh has planned a request", async () => {
    const app = createLocalGatewayApp();
    const created = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gateway-session", clientSessionId: "claude-session" }),
    });
    expect(created.status).toBe(201);
    const status = await app.request("/v1/status/client/claude-session");
    expect(status.status).toBe(404);
  });
});
