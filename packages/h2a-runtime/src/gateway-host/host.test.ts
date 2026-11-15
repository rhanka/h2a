import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

let tempBase = "";

beforeEach(() => {
  // m4 (r8): every gateway composition runs in temp HOME/XDG/H2A_ROOT with
  // an empty temp PATH — never the owner's real mesh store or real `claude`.
  tempBase = mkdtempSync(join(tmpdir(), "h2a-gateway-host-"));
  const emptyBin = join(tempBase, "bin");
  mkdirSync(emptyBin, { recursive: true });
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("H2A_LLM_MESH_OWNER_SCOPE", "cli:test-owner");
  vi.stubEnv("HOME", join(tempBase, "home"));
  vi.stubEnv("XDG_RUNTIME_DIR", join(tempBase, "run"));
  vi.stubEnv("H2A_ROOT", join(tempBase, "h2a-root"));
  vi.stubEnv("PATH", emptyBin);
  resetSessions();
  resetSessionLedger();
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  tempBase = "";
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

it("starts on an ephemeral loopback port (never 3002), proves /v1/models requires enrolled accounts, and verifies catalogue + X-Sentropic-Served for gemini-4-carbon, gemini-4-argon-low, and muse-ember-1.0", async () => {
  const { GATEWAY_MODEL_IDS, resolveGatewayModelAlias } = await import(
    "../gateway-model-catalog/model-catalog.js"
  );
  expect(GATEWAY_MODEL_IDS).toContain("gemini-4-carbon");
  expect(GATEWAY_MODEL_IDS).toContain("gemini-4-argon-low");
  expect(GATEWAY_MODEL_IDS).toContain("muse-ember-1.0");
  expect(GATEWAY_MODEL_IDS).not.toContain("gemini-4-argon");
  expect(resolveGatewayModelAlias("gemini-4-argon")).toBe("gemini-4-argon-high");
  expect(resolveGatewayModelAlias("gemini-4-argon-low")).toBe("gemini-4-argon-low");

  const {
    CloudCodeRuntimeClient,
    InMemoryRoutePlanner,
    createLlmMesh,
    createProviderRegistry,
    GeminiAdapter,
    MuseAdapter,
  } = await import("@sentropic/cluster-mesh/llm-mesh");
  const { createGatewayRouter } = await import("@sentropic/cluster-mesh/gateway");

  // 1. Ephemeral loopback port proof (never 3002) with zero enrolled accounts:
  // InMemoryRoutePlanner.listModels queries directory.listEligible(subject), so
  // without enrolled accounts GET /v1/models returns an empty list [].
  vi.stubEnv("PORT", "38491");
  let boundPort = 0;
  let boundHost = "";
  const app = await createLocalGatewayApp();
  await startServer({}, ((opts: { port: number; hostname: string }, cb?: () => void) => {
    boundPort = opts.port;
    boundHost = opts.hostname;
    cb?.();
    return { close() {} } as never;
  }) as never);
  expect(boundHost).toBe("127.0.0.1");
  expect(boundPort).toBe(38491);
  expect(boundPort).not.toBe(3002);

  const sessionRes = await app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "catalogue-proof-session" }),
  });
  const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };
  const emptyModelsRes = await app.request("/v1/models", {
    headers: { "x-api-key": gatewayToken },
  });
  expect(emptyModelsRes.status).toBe(200);
  expect(await emptyModelsRes.json()).toEqual({ object: "list", data: [] });

  // 2. Direct catalogue & routing layer proof with synthetic in-memory accounts
  // (no real accounts or credentials): lists gemini-4-carbon, gemini-4-argon-low,
  // and muse-ember-1.0 on /v1/models and sets X-Sentropic-Served on responses.
  const fetchFn = vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("fetchAvailableModels")) {
      return new Response(
        JSON.stringify({
          models: {
            "gemini-4-carbon": {},
            "gemini-4-argon-low": {},
            "gemini-4-argon-medium": {},
            "gemini-4-argon-high": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const sse = `data: ${JSON.stringify({
      response: {
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
      },
    })}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });

  const runtime = createLlmMesh({
    registry: createProviderRegistry([
      new GeminiAdapter({ client: new CloudCodeRuntimeClient(fetchFn) }),
      new MuseAdapter({
        client: {
          async generate(req: { modelId?: string }) {
            return {
              id: "msg_muse",
              providerId: "muse" as const,
              modelId: req.modelId ?? "muse-ember-1.0",
              text: "ok",
              toolCalls: [],
              reasoning: [],
              warnings: [],
              finishReason: "stop" as const,
              usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
            };
          },
          async *stream() {},
        } as never,
      }),
    ]),
  });

  const planner = new InMemoryRoutePlanner({
    directory: {
      async listEligible() {
        return [
          {
            accountRef: "synthetic-cloud-code",
            diagnosticAccountRef: "acct_cloud",
            ownerScopeRef: "cli:test-owner",
            targetProviderId: "gemini",
            transportProviderId: "cloud-code",
            supportedModelIds: ["gemini-4-carbon", "gemini-4-argon", "gemini-4-argon-low"],
            enrollmentCompletedAt: "2026-11-15T00:00:00.000Z",
            readiness: "ready" as const,
            revision: "r1",
          },
          {
            accountRef: "synthetic-muse",
            diagnosticAccountRef: "acct_muse",
            ownerScopeRef: "cli:test-owner",
            targetProviderId: "muse",
            transportProviderId: "muse",
            supportedModelIds: ["muse-ember-1.0"],
            enrollmentCompletedAt: "2026-11-15T00:00:00.000Z",
            readiness: "ready" as const,
            revision: "r1",
          },
        ];
      },
      async prepareAttempt({ target }) {
        const isMuse = target.providerId === "muse";
        const auth = isMuse
          ? {
              material: { type: "account-transport" as const, provider: "muse" as const, accessToken: "synthetic" },
              descriptor: { sourceType: "account-transport" as const, accountProviderId: "muse" as const },
            }
          : {
              material: {
                type: "account-transport" as const,
                provider: "cloud-code" as const,
                accessToken: "synthetic",
                accountId: "synthetic-cloud-code",
                metadata: { stableSessionId: "s1", leaseId: "l1", cloudaicompanionProject: "synthetic-proj" },
              },
              descriptor: { sourceType: "account-transport" as const, accountProviderId: "cloud-code" as const },
            };
        const effort =
          target.effort ??
          (target.requestedModel.endsWith("-low")
            ? "low"
            : target.requestedModel.endsWith("-medium")
              ? "medium"
              : target.requestedModel.endsWith("-high")
                ? "high"
                : undefined);
        const withRoute = <T extends Parameters<typeof runtime.generate>[0]>(req: T): T => ({
          ...req,
          providerId: target.providerId,
          modelId: target.modelId,
          auth,
          ...(effort ? { reasoning: { ...req.reasoning, effort: effort as never } } : {}),
        });
        return {
          attemptRef: "attempt-synthetic",
          generate: (req) => runtime.generate(withRoute(req)),
          stream: (req) => runtime.stream(withRoute(req)),
          async recordOutcome() {},
          async markCommitted() {},
          async complete() {},
          async releaseCancelled() {},
        };
      },
    },
  });

  const router = createGatewayRouter({
    config: {
      ...LEGACY_PORTS_INERT,
      callerAuth: {
        async verify(_headers, ctx) {
          return {
            ok: true as const,
            cost: {
              tenantId: "cli:test-owner",
              principalId: "catalogue-proof-session",
              ownerScopeRef: "cli:test-owner",
              source: "h2a-local-gateway",
              correlationId: ctx.requestId,
            },
          };
        },
      },
    },
    routePlanner: planner,
    routeMetering: { async settleRoute() {} },
  });

  const modelsRes = await router.request("http://127.0.0.1/v1/models", {
    headers: { authorization: "Bearer synthetic" },
  });
  expect(modelsRes.status).toBe(200);
  const modelsBody = (await modelsRes.json()) as { data: Array<{ id: string }> };
  const listedIds = modelsBody.data.map((m) => m.id);
  expect(listedIds).toContain("gemini-4-carbon");
  expect(listedIds).toContain("gemini-4-argon-low");
  expect(listedIds).toContain("muse-ember-1.0");

  for (const [requestedModel, expectedServed] of [
    ["gemini-4-carbon", "provider=gemini; model=gemini-4-carbon; transport=cloud-code"],
    ["gemini-4-argon-low", "provider=gemini; model=gemini-4-argon; transport=cloud-code"],
    ["muse-ember-1.0", "provider=muse; model=muse-ember-1.0; transport=muse"],
  ] as const) {
    const res = await router.request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: requestedModel,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(res.status, requestedModel).toBe(200);
    expect(res.headers.get("x-sentropic-served"), requestedModel).toBe(expectedServed);
  }
});
