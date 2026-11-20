import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudCodeRuntimeClient,
  GeminiAdapter,
  InMemoryRoutePlanner,
  createLlmMesh,
  createProviderRegistry,
  type RoutePlanner,
} from "@sentropic/cluster-mesh/llm-mesh";
import {
  createLocalGatewayApp,
  GatewayAlreadyRunningError,
  handleGatewayStartupError,
  startServer,
} from "./host.js";
import {
  acquireLlmMeshSessionEnv,
  llmMeshPidPath,
  llmMeshTokenPath,
  startGateway,
} from "./daemon.js";
import {
  createObservedUpstreamFetch,
  extractSanitizedUpstreamError,
  parseRetryDelaySeconds,
  type GatewayRequestLogEntry,
} from "./request-log.js";
import { resetSessions } from "./sessions.js";
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

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function buildSyntheticCloudCodePlanner(fetchFn: typeof fetch): RoutePlanner {
  const runtime = createLlmMesh({
    registry: createProviderRegistry([
      new GeminiAdapter({ client: new CloudCodeRuntimeClient(fetchFn) }),
    ]),
  });

  return new InMemoryRoutePlanner({
    directory: {
      async listEligible() {
        return [
          {
            accountRef: "secret-raw-account-id-do-not-log",
            diagnosticAccountRef: "acct_cloud_redacted",
            ownerScopeRef: "cli:test-owner",
            targetProviderId: "gemini",
            transportProviderId: "cloud-code",
            supportedModelIds: [
              "gemini-4-neon",
              "gemini-4-hydrogen",
              "gemini-4-argon",
              "gemini-4-carbon",
            ],
            enrollmentCompletedAt: "2026-11-15T00:00:00.000Z",
            readiness: "ready" as const,
            revision: "r1",
          },
        ];
      },
      async prepareAttempt({ target }) {
        const auth = {
          material: {
            type: "account-transport" as const,
            provider: "cloud-code" as const,
            accessToken: "ya29.super-secret-oauth-token",
            accountId: "secret-raw-account-id-do-not-log",
            metadata: {
              stableSessionId: "s1",
              leaseId: "l1",
              cloudaicompanionProject: "proj-secret-123",
            },
          },
          descriptor: {
            sourceType: "account-transport" as const,
            accountProviderId: "cloud-code" as const,
          },
        };
        const withRoute = <T extends Parameters<typeof runtime.generate>[0]>(req: T): T => ({
          ...req,
          providerId: target.providerId,
          modelId: target.modelId,
          auth,
          ...(target.effort
            ? { reasoning: { ...req.reasoning, effort: target.effort as never } }
            : {}),
        });
        return {
          attemptRef: "attempt-1",
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
}

function parseRequestLogLines(lines: string[]): GatewayRequestLogEntry[] {
  const prefix = "[gateway-host] request ";
  return lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length).trim()) as GatewayRequestLogEntry);
}

let tempBase = "";

beforeEach(() => {
  tempBase = mkdtempSync(join(tmpdir(), "h2a-gw-upstream-err-"));
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  tempBase = "";
});

describe("sanitized upstream error extraction", () => {
  it("parses Google error envelope (object and array) with status, reason, RetryInfo, and QuotaFailure without leaking secrets", () => {
    const googleArrayBody = JSON.stringify([
      {
        error: {
          code: 429,
          message: "Quota exceeded for user alice@example.com with Bearer ya29.secret_token and prompt SUPER_SECRET_PROMPT",
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "RATE_LIMIT_EXCEEDED",
              domain: "cloudcode-pa.googleapis.com",
              metadata: {
                model: "gemini-4-argon-high",
                quotaResetDelay: "38s",
                userEmail: "alice@example.com",
              },
            },
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "42.5s",
            },
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  subject: "project:secret-proj-123",
                  quotaMetric: "cloudaicompanion.googleapis.com/generate_content_requests",
                  quotaId: "GenerateContentRequestsPerMinutePerUser",
                },
              ],
            },
          ],
        },
      },
    ]);

    const parsed = extractSanitizedUpstreamError({
      status: 429,
      url: "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse&key=AIzaSecretKey",
      bodyText: googleArrayBody,
    });

    expect(parsed).toEqual({
      status: 429,
      endpoint: "/v1internal:streamGenerateContent",
      errorStatus: "RESOURCE_EXHAUSTED",
      errorCode: 429,
      reasons: ["RATE_LIMIT_EXCEEDED"],
      retryDelay: "42.5s",
      retryAfterSeconds: 43,
      quotaMetrics: [
        "cloudaicompanion.googleapis.com/generate_content_requests",
        "GenerateContentRequestsPerMinutePerUser",
      ],
      model: "gemini-4-argon-high",
    });

    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("ya29.secret_token");
    expect(serialized).not.toContain("SUPER_SECRET_PROMPT");
    expect(serialized).not.toContain("AIzaSecretKey");
    expect(serialized).not.toContain("secret-proj-123");
  });

  it("parses protobuf and Go duration formats into seconds", () => {
    expect(parseRetryDelaySeconds("38s")).toBe(38);
    expect(parseRetryDelaySeconds("42.1s")).toBe(43);
    expect(parseRetryDelaySeconds("500ms")).toBe(1);
    expect(parseRetryDelaySeconds("1h2m3s")).toBe(3723);
    expect(parseRetryDelaySeconds("2m15s")).toBe(135);
    expect(parseRetryDelaySeconds("not-a-duration")).toBeUndefined();
  });
});

describe("structured request logging and 429 preservation", () => {
  const ALLOW_EQUIV_ROUTING = {
    policy: {
      strategy: { kind: "last-enrolled" as const },
      rules: [],
      fallbackMode: "retest-preferred" as const,
      negativeCacheTtlMs: 300_000,
      maxAttempts: 3,
      preferSameTransport: true,
      stickyAccount: true,
      rotateEquivalentAccounts: false,
      allowEquivalentModels: true,
    },
  };

  it("logs one sanitized structured line per request and keeps 429 (with Retry-After) instead of 503 No route on cooldown", async () => {
    const rawLogs: string[] = [];
    const upstreamFetch = createObservedUpstreamFetch(
      vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("fetchAvailableModels")) {
          return new Response(
            JSON.stringify({
              models: { "gemini-4-neon-medium": {}, "gemini-4-argon-high": {} },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // Google 429 with JSON RetryInfo.retryDelay and NO HTTP Retry-After header
        return new Response(
          JSON.stringify([
            {
              error: {
                code: 429,
                status: "RESOURCE_EXHAUSTED",
                message: "Rate limit exceeded for secret-prompt-text",
                details: [
                  {
                    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                    reason: "MODEL_CAPACITY_EXHAUSTED",
                    metadata: { model: "gemini-4-argon-high" },
                  },
                  {
                    "@type": "type.googleapis.com/google.rpc.RetryInfo",
                    retryDelay: "38s",
                  },
                  {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    violations: [
                      {
                        quotaMetric: "cloudaicompanion.googleapis.com/generate_requests",
                      },
                    ],
                  },
                ],
              },
            },
          ]),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const planner = buildSyntheticCloudCodePlanner(upstreamFetch);
    const app = await createLocalGatewayApp({
      ownerScopeRef: "cli:test-owner",
      routing: ALLOW_EQUIV_ROUTING,
      routePlanner: planner,
      writeLog: (line) => rawLogs.push(line),
    });

    const sessionRes = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gw-sess-429" }),
    });
    const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };

    const sendMessages = () =>
      app.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": gatewayToken,
        },
        body: JSON.stringify({
          model: "claude-opus-5-5",
          stream: true,
          max_tokens: 64,
          messages: [{ role: "user", content: "TOP_SECRET_PROMPT_BODY" }],
        }),
      });

    // Request 1: hits upstream -> Google 429 (no HTTP Retry-After, only JSON RetryInfo 38s)
    const first = await sendMessages();
    expect(first.status).toBe(429);
    expect(first.headers.get("retry-after")).toBe("38");
    expect(first.headers.get("x-should-retry")).toBeNull();
    expect(await first.json()).toMatchObject({
      type: "error",
      error: { type: "rate_limit_error" },
    });

    // Request 2: immediately after — InMemoryRouteHealth suppresses the lone candidate
    // and InMemoryRoutePlanner throws RoutePlanError('no-route').
    // Must STILL return 429 rate_limit_error with Retry-After, NOT 503 No route!
    const second = await sendMessages();
    expect(second.status).toBe(429);
    const secondRetryAfter = Number(second.headers.get("retry-after"));
    expect(secondRetryAfter).toBeGreaterThanOrEqual(1);
    expect(secondRetryAfter).toBeLessThanOrEqual(38);
    expect(second.headers.get("x-should-retry")).toBeNull();
    expect(await second.json()).toMatchObject({
      type: "error",
      error: { type: "rate_limit_error" },
    });

    const entries = parseRequestLogLines(rawLogs);
    expect(entries).toHaveLength(2);

    // Log 1: direct upstream 429 with full sanitized Google details
    expect(entries[0]).toMatchObject({
      route: "/v1/messages",
      method: "POST",
      requestedModel: "claude-opus-5-5",
      provider: "gemini",
      model: "gemini-4-neon",
      transport: "cloud-code",
      accountId: "acct_cloud_redacted",
      status: 429,
      retryAfterSeconds: 38,
      upstream: {
        status: 429,
        endpoint: "/v1internal:streamGenerateContent",
        errorStatus: "RESOURCE_EXHAUSTED",
        reasons: ["MODEL_CAPACITY_EXHAUSTED"],
        retryDelay: "38s",
        quotaMetrics: ["cloudaicompanion.googleapis.com/generate_requests"],
      },
    });
    expect(typeof entries[0]!.time).toBe("string");
    expect(typeof entries[0]!.latencyMs).toBe("number");

    // Log 2: remapped 503 -> 429 during cooldown, carrying the recorded upstream reason
    expect(entries[1]).toMatchObject({
      route: "/v1/messages",
      requestedModel: "claude-opus-5-5",
      status: 429,
      remappedFrom: 503,
      upstream: {
        status: 429,
        errorStatus: "RESOURCE_EXHAUSTED",
        reasons: ["MODEL_CAPACITY_EXHAUSTED"],
      },
    });

    // Sanitization proof: zero prompt content, zero tokens, zero raw account IDs
    const allLogs = rawLogs.join("");
    expect(allLogs).not.toContain("TOP_SECRET_PROMPT_BODY");
    expect(allLogs).not.toContain(gatewayToken);
    expect(allLogs).not.toContain("ya29.super-secret-oauth-token");
    expect(allLogs).not.toContain("secret-raw-account-id-do-not-log");
    expect(allLogs).not.toContain("secret-prompt-text");
  });

  it("remaps 503 to 429 when fetchAvailableModels fails with upstream 429", async () => {
    const rawLogs: string[] = [];
    const upstreamFetch = createObservedUpstreamFetch(
      vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "RATE_LIMIT_EXCEEDED",
                },
                {
                  "@type": "type.googleapis.com/google.rpc.RetryInfo",
                  retryDelay: "15s",
                },
              ],
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const planner = buildSyntheticCloudCodePlanner(upstreamFetch);
    const app = await createLocalGatewayApp({
      ownerScopeRef: "cli:test-owner",
      routing: ALLOW_EQUIV_ROUTING,
      routePlanner: planner,
      writeLog: (line) => rawLogs.push(line),
    });

    const sessionRes = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gw-sess-cat-429" }),
    });
    const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };

    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": gatewayToken },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        stream: true,
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(await res.json()).toMatchObject({
      type: "error",
      error: { type: "rate_limit_error" },
    });

    const entries = parseRequestLogLines(rawLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      status: 429,
      remappedFrom: 503,
      upstream: {
        status: 429,
        endpoint: "/v1internal:fetchAvailableModels",
        errorStatus: "RESOURCE_EXHAUSTED",
        reasons: ["RATE_LIMIT_EXCEEDED"],
        retryDelay: "15s",
      },
    });
  });

  it("keeps 503 No route available when there is genuinely no route (zero accounts)", async () => {
    const rawLogs: string[] = [];
    const app = await createLocalGatewayApp({
      ownerScopeRef: "cli:test-owner",
      writeLog: (line) => rawLogs.push(line),
    });

    const sessionRes = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gw-sess-noroute" }),
    });
    const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };

    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": gatewayToken },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        stream: true,
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(res.headers.get("x-should-retry")).toBe("false");
    expect(await res.json()).toMatchObject({
      type: "error",
      error: { type: "api_error" },
    });

    const entries = parseRequestLogLines(rawLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      route: "/v1/messages",
      requestedModel: "claude-opus-5-5",
      status: 503,
      planError: "no-route",
    });
    expect(entries[0]!.remappedFrom).toBeUndefined();
  });

  it("keeps 503 authentication_error for reauth-required diagnostics and never masks as 429", async () => {
    const rawLogs: string[] = [];
    const reauthPlanner = new InMemoryRoutePlanner({
      directory: {
        async listEligible() {
          return [];
        },
        async listDiagnostics() {
          return [
            {
              code: "reauth-required",
              transportProviderId: "cloud-code",
              message: "cloud-code credential expired; reauthenticate the cloud-code account to restore routing",
            },
          ];
        },
        async prepareAttempt(): Promise<never> {
          throw new Error("should not dispatch");
        },
      },
    });
    const app = await createLocalGatewayApp({
      ownerScopeRef: "cli:test-owner",
      routing: ALLOW_EQUIV_ROUTING,
      routePlanner: reauthPlanner,
      writeLog: (line) => rawLogs.push(line),
    });

    const sessionRes = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gw-sess-reauth" }),
    });
    const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };

    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": gatewayToken },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        stream: true,
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("x-sentropic-route-action")).toBe("reauthenticate-cloud-code");
    expect(await res.json()).toMatchObject({
      type: "error",
      error: { type: "authentication_error" },
    });

    const entries = parseRequestLogLines(rawLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      status: 503,
      planError: "no-route",
      planDiagnostics: [{ code: "reauth-required", transport: "cloud-code" }],
    });
    expect(entries[0]!.remappedFrom).toBeUndefined();
  });
});

describe("duplicate gateway start resilience (no unhandled EADDRINUSE)", () => {
  it("reuses an already running gateway in startGateway without spawning or corrupting the PID file", async () => {
    const port = await freePort();
    const stateDir = join(tempBase, "dup-state");
    mkdirSync(stateDir, { recursive: true });
    vi.stubEnv("PORT", String(port));

    // Start a real first gateway server on our ephemeral port
    const server = await startServer({ ownerScopeRef: "cli:test-owner" });
    try {
      // Simulate a stale/dead PID file (like after an old EADDRINUSE crash)
      writeFileSync(llmMeshPidPath(stateDir), "99999999\n");
      writeFileSync(
        llmMeshTokenPath(stateDir),
        JSON.stringify({ baseUrl: `http://localhost:${port}`, pid: 99999999 }),
      );

      // Calling startGateway on the same port must detect and reuse the running gateway
      const result = await startGateway(
        { port },
        { stateDir, clientSessionId: "reuse-test-session" },
      );

      expect(result.port).toBe(port);
      expect(result.pid).toBe(process.pid);
      expect(result.gatewayToken).toMatch(/^gw-v2-/);

      // PID and token metadata healed to the live gateway PID
      expect(readFileSync(llmMeshPidPath(stateDir), "utf8").trim()).toBe(String(process.pid));
      expect(JSON.parse(readFileSync(llmMeshTokenPath(stateDir), "utf8"))).toEqual({
        baseUrl: `http://localhost:${port}`,
        pid: process.pid,
      });

      // acquireLlmMeshSessionEnv also recovers from stale PID
      writeFileSync(llmMeshPidPath(stateDir), "99999999\n");
      writeFileSync(
        llmMeshTokenPath(stateDir),
        JSON.stringify({ baseUrl: `http://localhost:${port}`, pid: 99999999 }),
      );
      const env = await acquireLlmMeshSessionEnv(stateDir, "recover-session");
      expect(env).toEqual({
        ANTHROPIC_BASE_URL: `http://localhost:${port}`,
        ANTHROPIC_AUTH_TOKEN: expect.stringMatching(/^gw-v2-/),
      });
    } finally {
      await new Promise<void>((resolve) => {
        (server as unknown as { close(cb?: () => void): void }).close(() => resolve());
      });
    }
  });

  it("rejects startServer with GatewayAlreadyRunningError instead of an unhandled EADDRINUSE crash", async () => {
    const port = await freePort();
    vi.stubEnv("PORT", String(port));

    const first = await startServer({ ownerScopeRef: "cli:test-owner" });
    try {
      let caught: unknown;
      try {
        await startServer({ ownerScopeRef: "cli:test-owner" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GatewayAlreadyRunningError);
      const out: string[] = [];
      const err: string[] = [];
      const exitCode = handleGatewayStartupError(
        caught,
        (line) => out.push(line),
        (line) => err.push(line),
      );
      expect(exitCode).toBe(0);
      expect(err).toEqual([]);
      expect(out.join("")).toMatch(/already running.*reusing running gateway and exiting cleanly/);
    } finally {
      await new Promise<void>((resolve) => {
        (first as unknown as { close(cb?: () => void): void }).close(() => resolve());
      });
    }
  });

  it("refuses cleanly before spawning when another non-gateway process holds the port", async () => {
    const blocker = createHttpServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const address = blocker.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const stateDir = join(tempBase, "blocked-state");
    try {
      await expect(startGateway({ port }, { stateDir })).rejects.toThrow(
        /already in use/i,
      );
    } finally {
      blocker.closeAllConnections?.();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
