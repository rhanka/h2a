import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayNamespaceModule } from "@sentropic/cluster-mesh/compose/gateway";
import { createGatewayHost, createLocalGatewayApp, LEGACY_PORTS_INERT, startServer } from "./host.js";
import { lookupToken, resetSessions } from "./sessions.js";
import { resetSessionLedger } from "./ledger.js";

vi.mock("../claude-code-cli-lifecycle.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../claude-code-cli-lifecycle.js")>();
  return {
    ...mod,
    sweepOrphanSandboxes: vi
      .fn()
      .mockResolvedValue({ swept: 0, retained: 0, skippedAlive: 0 }),
  };
});

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
    const app = await createLocalGatewayApp();
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
    const listed = await app.request("/v1/sessions");
    const { data } = await listed.json() as { data: unknown[] };
    expect(data).toContainEqual(expect.objectContaining({ gatewaySessionId: "gateway-session", state: "idle" }));
    expect(JSON.stringify(data)).not.toContain(result.gatewayToken);
  });

  it("requires the minted bearer on the canonical Sentropic gateway routes", async () => {
    const app = await createLocalGatewayApp();
    const response = await app.request("/v1/models");
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("account");
  });

  it("keeps the status endpoint redacted until the mesh has planned a request", async () => {
    const app = await createLocalGatewayApp();
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


it("reports not-ready until composition completes, preserving root URLs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const host = createGatewayHost({
    prepareNamespace: async (...args) => { await gate; return createGatewayNamespaceModule(...args); },
  });
  expect((await host.app.request("/readyz")).status).toBe(503);
  expect((await host.app.request("/health")).status).toBe(200);
  release();
  await host.ready;
  expect((await host.app.request("/readyz")).status).toBe(200);
  expect((await host.app.request("/healthz")).status).toBe(200);
  expect((await host.app.request("/gw/v1/models")).status).toBe(404);
});

it("fails preflight before binding a listener and keeps readiness false", async () => {
  const prepareNamespace = vi.fn().mockRejectedValue(new Error("cluster topology is divergent"));
  const host = createGatewayHost({ prepareNamespace });
  await expect(host.ready).rejects.toThrow("cluster topology is divergent");
  expect((await host.app.request("/readyz")).status).toBe(503);
  const listen = vi.fn();
  await expect(startServer({ prepareNamespace }, listen as never)).rejects.toThrow("cluster topology is divergent");
  expect(listen).not.toHaveBeenCalled();
});

it("never reaches legacy pool, auth resolver or dispatch ports on routed requests (pending upstream U3)", async () => {
  const spies = [
    vi.spyOn(LEGACY_PORTS_INERT.pool, "listEligibleAccounts"),
    vi.spyOn(LEGACY_PORTS_INERT.pool, "select"),
    vi.spyOn(LEGACY_PORTS_INERT.pool, "snapshotModels"),
    vi.spyOn(LEGACY_PORTS_INERT.authResolver, "resolve"),
    vi.spyOn(LEGACY_PORTS_INERT.dispatch, "dispatch"),
    vi.spyOn(LEGACY_PORTS_INERT.dispatch, "dispatchStream"),
  ];
  for (const spy of spies) spy.mockImplementation(() => { throw new Error("Legacy port must stay inert"); });
  try {
    const app = await createLocalGatewayApp();
    const session = await app.request("/v1/session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "no-account-session" }),
    });
    const { gatewayToken } = await session.json() as { gatewayToken: string };
    for (const path of ["/v1/messages", "/v1/chat/completions"]) {
      for (const stream of [false, true]) {
        for (const model of ["unknown-host-test-model", "claude-sonnet-5"]) {
          const response = await app.request(path, {
            method: "POST", headers: { "content-type": "application/json", "x-api-key": gatewayToken },
            body: JSON.stringify({ model, stream, max_tokens: 16, messages: [{ role: "user", content: "hello" }] }),
          });
          expect(response.status).toBe(model === "unknown-host-test-model" ? 404 : 503);
          expect(response.headers.get("retry-after")).toBeNull();
          expect(response.headers.get("x-should-retry")).toBe(model === "unknown-host-test-model" ? null : "false");
          if (path === "/v1/messages" && model === "unknown-host-test-model") {
            expect(await response.json()).toMatchObject({ error: { type: "not_found_error" } });
          }
        }
      }
    }
    expect((await app.request("/v1/models", { headers: { "x-api-key": gatewayToken } })).status).toBe(200);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally { for (const spy of spies) spy.mockRestore(); }
});

it("fails before serving without an enrolled Claude account, like every other seat", async () => {
  const app = await createLocalGatewayApp();
  const session = await app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "unconfigured-claude-session" }),
  });
  const { gatewayToken } = await session.json() as { gatewayToken: string };

  const response = await app.request("/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": gatewayToken,
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  // Without an enrolled account, routing fails safely before serving without crash
  expect([404, 503]).toContain(response.status);
  // The failure carries no seat/runner/lease material.
  const failureText = await response.text();
  expect(failureText).not.toMatch(/seat|runner|lease|credential|x-api-key/i);
  const models = await app.request("/v1/models", {
    headers: { "x-api-key": gatewayToken },
  });
  expect(models.status).toBe(200);
});

it("sweeps Claude orphans on every composition (the seat is always composed)", async () => {
  const { sweepOrphanSandboxes } = await import("../claude-code-cli-lifecycle.js");
  const failingPrepare = async (): Promise<never> => {
    throw new Error("composition probe");
  };
  vi.mocked(sweepOrphanSandboxes).mockClear();

  const plain = createGatewayHost({ prepareNamespace: failingPrepare });
  await expect(plain.ready).rejects.toThrow("composition probe");
  expect(vi.mocked(sweepOrphanSandboxes)).toHaveBeenCalledTimes(1);

  const withClaude = createGatewayHost({
    claudeClient: {} as never,
    prepareNamespace: failingPrepare,
  });
  await expect(withClaude.ready).rejects.toThrow("composition probe");
  expect(vi.mocked(sweepOrphanSandboxes)).toHaveBeenCalledTimes(2);
});
