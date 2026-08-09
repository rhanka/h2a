import { afterEach, describe, expect, it } from "vitest";
import { createGatewayApp } from "./index.js";
import { resetSessionLedger } from "./session-ledger.js";
import { resetSessions } from "./sticky.js";

afterEach(() => {
  resetSessions();
  resetSessionLedger();
});

describe("Sentropic-backed gateway host", () => {
  it("serves health without exposing routing state", async () => {
    const app = createGatewayApp({ ownerScopeRef: "owner:test" });
    const response = await app.request("/health");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("mints an opaque bearer without embedding account or route data", async () => {
    const app = createGatewayApp({ ownerScopeRef: "owner:test" });
    const response = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "gateway-session-1",
        clientSessionId: "claude-session-1",
        workspaceId: "workspace-1",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.gatewayToken).toEqual(expect.stringMatching(/^gw-v2-/));
    expect(JSON.stringify(body)).not.toMatch(/account|provider|model|transport/i);
  });

  it("fails caller authentication before invoking the route planner", async () => {
    const app = createGatewayApp({ ownerScopeRef: "owner:test" });
    const response = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-session-token",
      },
      body: JSON.stringify({
        model: "claude-opus-5-xhigh",
        max_tokens: 16,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(response.status).toBe(401);
  });
});
