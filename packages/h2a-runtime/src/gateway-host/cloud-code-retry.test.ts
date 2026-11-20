import { chmodSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudCodeRuntimeClient,
  InMemoryAccountTransportCoordinator,
  InMemoryRoutePlanner,
} from "@sentropic/cluster-mesh/llm-mesh";
import { EncryptedFileKeyring } from "@sentropic/cluster-mesh/llm-mesh/node";
import {
  classifyCloudCode429,
  createCloudCodeRetryFetch,
  parseGoogleDurationMs,
  parseRetryAfterHeaderMs,
  type CloudCodeRetryLogEvent,
} from "./cloud-code-retry.js";
import { createLocalGatewayApp } from "./host.js";
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

const STREAM_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const MODELS_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

function json429(body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: { "content-type": "application/json", ...headers },
  });
}

function sseOk(text = "ok"): Response {
  const payload = `data: ${JSON.stringify({
    response: {
      candidates: [
        {
          content: { role: "model", parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    },
  })}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("cloud-code 429 classification & duration parsing", () => {
  it("parses Google protobuf and Go compound durations", () => {
    expect(parseGoogleDurationMs("3s")).toBe(3_000);
    expect(parseGoogleDurationMs("1.5s")).toBe(1_500);
    expect(parseGoogleDurationMs("500ms")).toBe(500);
    expect(parseGoogleDurationMs("1m30s")).toBe(90_000);
    expect(parseGoogleDurationMs("0s")).toBeUndefined();
    expect(parseGoogleDurationMs("bogus")).toBeUndefined();
  });

  it("parses HTTP Retry-After delta-seconds and HTTP-date", () => {
    expect(parseRetryAfterHeaderMs("12")).toBe(12_000);
    const now = Date.parse("2026-11-19T22:00:00Z");
    expect(parseRetryAfterHeaderMs("Thu, 19 Nov 2026 22:00:07 GMT", now)).toBe(7_000);
    expect(parseRetryAfterHeaderMs("0")).toBeUndefined();
  });

  it("classifies RATE_LIMIT_EXCEEDED with bounded RetryInfo.retryDelay as transient", () => {
    const info = classifyCloudCode429({
      url: STREAM_URL,
      bodyText: JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Rate limit exceeded",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "RATE_LIMIT_EXCEEDED",
              domain: "cloudcode-pa.googleapis.com",
            },
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "4s",
            },
          ],
        },
      }),
    });
    expect(info.classification).toBe("transient");
    expect(info.reasons).toEqual(["RATE_LIMIT_EXCEEDED"]);
    expect(info.retryDelay).toBe("4s");
    expect(info.retryAfterMs).toBe(4_000);
  });

  it("classifies MODEL_CAPACITY_EXHAUSTED as capacity", () => {
    const info = classifyCloudCode429({
      url: STREAM_URL,
      bodyText: JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "No capacity available for model",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "MODEL_CAPACITY_EXHAUSTED",
              domain: "cloudcode-pa.googleapis.com",
            },
          ],
        },
      }),
    });
    expect(info.classification).toBe("capacity");
    expect(info.reasons).toEqual(["MODEL_CAPACITY_EXHAUSTED"]);
  });

  it("classifies bare 139-byte RESOURCE_EXHAUSTED without details as transient", () => {
    const info = classifyCloudCode429({
      url: STREAM_URL,
      bodyText: JSON.stringify({
        error: {
          code: 429,
          message: "Resource has been exhausted (e.g. check quota).",
          status: "RESOURCE_EXHAUSTED",
        },
      }),
    });
    expect(info.classification).toBe("transient");
    expect(info.errorStatus).toBe("RESOURCE_EXHAUSTED");
    expect(info.retryAfterMs).toBeUndefined();
  });

  it("classifies daily QuotaFailure, QUOTA_EXHAUSTED, limit:0, and huge retryDelay as terminal", () => {
    expect(
      classifyCloudCode429({
        url: STREAM_URL,
        bodyText: JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Daily quota exceeded",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [{ quotaId: "GenerateRequestsPerDayPerProject" }],
              },
            ],
          },
        }),
      }).classification,
    ).toBe("terminal");

    expect(
      classifyCloudCode429({
        url: STREAM_URL,
        bodyText: JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Quota exhausted",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "QUOTA_EXHAUSTED",
                domain: "cloudcode-pa.googleapis.com",
              },
            ],
          },
        }),
      }).classification,
    ).toBe("terminal");

    expect(
      classifyCloudCode429({
        url: STREAM_URL,
        bodyText: JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Quota exceeded for metric, limit: 0",
          },
        }),
      }).classification,
    ).toBe("terminal");

    expect(
      classifyCloudCode429({
        url: STREAM_URL,
        maxRetryDelayMs: 30_000,
        bodyText: JSON.stringify({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Try again in 2 hours",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.RetryInfo",
                retryDelay: "7200s",
              },
            ],
          },
        }),
      }).classification,
    ).toBe("terminal");
  });
});

describe("createCloudCodeRetryFetch", () => {
  it("retries transient 429 honouring RetryInfo.retryDelay and recovers on 200", async () => {
    const sleeps: number[] = [];
    const logs: CloudCodeRetryLogEvent[] = [];
    let calls = 0;

    const baseFetch: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return json429({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Slow down user@example.com ya29.secret-token",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "RATE_LIMIT_EXCEEDED",
                domain: "cloudcode-pa.googleapis.com",
              },
              {
                "@type": "type.googleapis.com/google.rpc.RetryInfo",
                retryDelay: "3s",
              },
            ],
          },
        });
      }
      return sseOk("recovered");
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5, // +10% positive jitter on explicit retryDelay
      onLog: (ev) => logs.push(ev),
    });

    const res = await retryFetch(STREAM_URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([3_300]);
    expect(logs.map((l) => l.event)).toEqual(["retry", "recovered"]);
    // Security: never leaks email, token, or raw upstream prose.
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("ya29.");
    expect(serialized).not.toContain("Slow down");
  });

  it("caps MODEL_CAPACITY_EXHAUSTED at maxCapacityAttempts=3 with 1s then 3s backoff", async () => {
    const sleeps: number[] = [];
    const logs: CloudCodeRetryLogEvent[] = [];
    let calls = 0;

    const baseFetch: typeof fetch = async () => {
      calls += 1;
      return json429({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Model capacity exhausted",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "MODEL_CAPACITY_EXHAUSTED",
              domain: "cloudcode-pa.googleapis.com",
            },
          ],
        },
      });
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      maxAttempts: 5,
      maxCapacityAttempts: 3,
      transientFallbackCooldownSeconds: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
      onLog: (ev) => logs.push(ev),
    });

    const res = await retryFetch(STREAM_URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1_000, 3_000]);
    // Synthesizes bounded Retry-After so llm-mesh does not lock 60s/300s.
    expect(res.headers.get("retry-after")).toBe("5");
    expect(logs.map((l) => l.event)).toEqual(["retry", "retry", "exhausted"]);
  });

  it("fails fast without retry on terminal QUOTA_EXHAUSTED and does not shorten cooldown", async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const baseFetch: typeof fetch = async () => {
      calls += 1;
      return json429({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exhausted",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "QUOTA_EXHAUSTED",
              domain: "cloudcode-pa.googleapis.com",
            },
          ],
        },
      });
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onLog: () => {},
    });

    const res = await retryFetch(STREAM_URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    // Terminal quota without retryDelay keeps Retry-After unset so full cooldown applies.
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("aborts immediately during backoff sleep when AbortSignal fires", async () => {
    const controller = new AbortController();
    let calls = 0;
    const baseFetch: typeof fetch = async () => {
      calls += 1;
      return json429({
        error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted." },
      });
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      initialDelayMs: 10_000,
      onLog: () => {},
    });

    const pending = retryFetch(STREAM_URL, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 15);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("stops retrying when next wait exceeds maxTotalWaitMs", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const baseFetch: typeof fetch = async () => {
      calls += 1;
      return json429({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Slow down",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "4s",
            },
          ],
        },
      });
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      maxAttempts: 5,
      maxTotalWaitMs: 5_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
      onLog: () => {},
    });

    const res = await retryFetch(STREAM_URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    // Attempt 1 waits 4s (total 4s <= 5s); attempt 2 would need 8s (> remaining 1s) -> stop.
    expect(calls).toBe(2);
    expect(sleeps).toEqual([4_000]);
    expect(res.headers.get("retry-after")).toBe("4");
  });

  it("treats Cloud Code RATE_LIMIT_EXCEEDED without retryDelay as terminal (matches Gemini CLI)", () => {
    const info = classifyCloudCode429({
      url: STREAM_URL,
      bodyText: JSON.stringify({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Rate limit exceeded",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "RATE_LIMIT_EXCEEDED",
              domain: "cloudcode-pa.googleapis.com",
            },
          ],
        },
      }),
    });
    expect(info.classification).toBe("terminal");
  });

  it("does not intercept non-Cloud-Code hosts", async () => {
    let calls = 0;
    const baseFetch: typeof fetch = async () => {
      calls += 1;
      return json429({ error: { message: "rate limited" } });
    };
    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      sleep: async () => {},
      onLog: () => {},
    });
    const res = await retryFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
  });
});

describe("llm-mesh cooldown & route-health interaction", () => {
  it("recovered transient 429 leaves account active and route unsuppressed", async () => {
    let streamCalls = 0;
    const baseFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === MODELS_URL) {
        return new Response(
          JSON.stringify({ models: { "gemini-4-argon-high": {} } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      streamCalls += 1;
      if (streamCalls === 1) {
        return json429({
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Resource has been exhausted (e.g. check quota).",
          },
        });
      }
      return sseOk("hello");
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      sleep: async () => {},
      random: () => 0.5,
      onLog: () => {},
    });

    const client = new CloudCodeRuntimeClient(retryFetch);
    let nowMs = 1_700_000_000_000;
    const coordinator = new InMemoryAccountTransportCoordinator([
      {
        accountId: "acct-1",
        targetProviderId: "gemini",
        transportProviderId: "cloud-code",
        accessToken: "test-access-token",
        metadata: { cloudaicompanionProject: "test-proj" },
      },
    ]);
    const planner = new InMemoryRoutePlanner({
      clock: { now: () => new Date(nowMs) },
      directory: {
        async listEligible() {
          return [
            {
              accountRef: "acct-1",
              diagnosticAccountRef: "acct_diag_1",
              targetProviderId: "gemini",
              transportProviderId: "cloud-code",
              supportedModelIds: ["gemini-4-argon"],
              enrollmentCompletedAt: "2026-01-01T00:00:00.000Z",
              readiness: "ready",
              revision: "v1",
            },
          ];
        },
        async prepareAttempt() {
          const acq = await coordinator.acquire({
            targetProviderId: "gemini",
            transportProviderId: "cloud-code",
            modelId: "gemini-4-argon",
            now: nowMs,
          });
          return {
            attemptRef: "attempt_1",
            generate: (req) =>
              client.generate(req, { auth: { material: acq.material, descriptor: acq.descriptor } }),
            stream: (req) =>
              client.stream(req, { auth: { material: acq.material, descriptor: acq.descriptor } }),
            recordOutcome: async (classification) => {
              await acq.recordOutcome({
                status: classification.reason === "rate-limited" ? "rate_limited" : "failed",
                ...(classification.retryAfterMs !== undefined
                  ? { retryAfterMs: classification.retryAfterMs }
                  : {}),
                finishedAt: nowMs,
              });
            },
            markCommitted: async () => {},
            complete: async () => {
              await acq.recordOutcome({ status: "success", finishedAt: nowMs });
            },
            releaseCancelled: async () => {
              await acq.release?.();
            },
          };
        },
      },
    });

    const subject = { ownerScopeRef: "cli:test", principalRef: "sess-1" };
    const plan = await planner.plan(subject, {
      requestedModel: "gemini-4-argon",
      policyOverride: { negativeCacheTtlMs: 300_000 },
    });
    const attempt = await planner.prepareAttempt(subject, plan.planRef, plan.candidateRefs[0]!, "req-1", 0);
    const result = await attempt.generate({
      providerId: "gemini",
      modelId: "gemini-4-argon",
      messages: [{ role: "user", content: "hi" }],
      reasoning: { effort: "high" },
    });
    await attempt.complete();
    expect(result.text).toBe("hello");
    expect(streamCalls).toBe(2);

    // Neither account cooldown nor route-health suppression triggered.
    const nextPlan = await planner.plan(subject, {
      requestedModel: "gemini-4-argon",
      policyOverride: { negativeCacheTtlMs: 300_000 },
    });
    expect(nextPlan.candidateRefs.length).toBe(1);
    const acq2 = await coordinator.acquire({
      targetProviderId: "gemini",
      transportProviderId: "cloud-code",
      modelId: "gemini-4-argon",
      now: nowMs,
    });
    expect(acq2.material.accountId).toBe("acct-1");
    await acq2.release?.();
  });

  it("exhausted bare 429 bounds llm-mesh cooldown and route-health TTL to 5s instead of 60s/300s", async () => {
    const baseFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === MODELS_URL) {
        return new Response(
          JSON.stringify({ models: { "gemini-4-argon-high": {} } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return json429({
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Resource has been exhausted (e.g. check quota).",
        },
      });
    };

    const retryFetch = createCloudCodeRetryFetch(baseFetch, {
      maxAttempts: 2,
      transientFallbackCooldownSeconds: 5,
      sleep: async () => {},
      random: () => 0.5,
      onLog: () => {},
    });

    const client = new CloudCodeRuntimeClient(retryFetch);
    let nowMs = 1_700_000_000_000;
    const coordinator = new InMemoryAccountTransportCoordinator([
      {
        accountId: "acct-1",
        targetProviderId: "gemini",
        transportProviderId: "cloud-code",
        accessToken: "test-access-token",
        metadata: { cloudaicompanionProject: "test-proj" },
      },
    ]);
    const planner = new InMemoryRoutePlanner({
      clock: { now: () => new Date(nowMs) },
      directory: {
        async listEligible() {
          return [
            {
              accountRef: "acct-1",
              diagnosticAccountRef: "acct_diag_1",
              targetProviderId: "gemini",
              transportProviderId: "cloud-code",
              supportedModelIds: ["gemini-4-argon"],
              enrollmentCompletedAt: "2026-01-01T00:00:00.000Z",
              readiness: "ready",
              revision: "v1",
            },
          ];
        },
        async prepareAttempt() {
          const acq = await coordinator.acquire({
            targetProviderId: "gemini",
            transportProviderId: "cloud-code",
            modelId: "gemini-4-argon",
            now: nowMs,
          });
          return {
            attemptRef: "attempt_1",
            generate: (req) =>
              client.generate(req, { auth: { material: acq.material, descriptor: acq.descriptor } }),
            stream: (req) =>
              client.stream(req, { auth: { material: acq.material, descriptor: acq.descriptor } }),
            recordOutcome: async (classification) => {
              await acq.recordOutcome({
                status: classification.reason === "rate-limited" ? "rate_limited" : "failed",
                ...(classification.retryAfterMs !== undefined
                  ? { retryAfterMs: classification.retryAfterMs }
                  : {}),
                finishedAt: nowMs,
              });
            },
            markCommitted: async () => {},
            complete: async () => {
              await acq.recordOutcome({ status: "success", finishedAt: nowMs });
            },
            releaseCancelled: async () => {
              await acq.release?.();
            },
          };
        },
      },
    });

    const subject = { ownerScopeRef: "cli:test", principalRef: "sess-1" };
    const plan = await planner.plan(subject, {
      requestedModel: "gemini-4-argon",
      policyOverride: { negativeCacheTtlMs: 300_000 },
    });
    const attempt = await planner.prepareAttempt(subject, plan.planRef, plan.candidateRefs[0]!, "req-1", 0);

    let caught: { statusCode?: number; retryAfterMs?: number } | undefined;
    try {
      await attempt.generate({
        providerId: "gemini",
        modelId: "gemini-4-argon",
        messages: [{ role: "user", content: "hi" }],
        reasoning: { effort: "high" },
      });
    } catch (err) {
      caught = err as { statusCode?: number; retryAfterMs?: number };
    }

    expect(caught?.statusCode).toBe(429);
    expect(caught?.retryAfterMs).toBe(5_000);

    await attempt.recordOutcome({
      reason: "rate-limited",
      retryable: true,
      healthScope: "provider-model",
      ...(caught?.retryAfterMs !== undefined ? { retryAfterMs: caught.retryAfterMs } : {}),
    });

    // Suppressed at t+4s, unlocked at t+6s (NOT 60s account / 300s route!).
    nowMs += 4_000;
    await expect(
      planner.plan(subject, { requestedModel: "gemini-4-argon" }),
    ).rejects.toThrow(/No eligible route/);
    await expect(
      coordinator.acquire({
        targetProviderId: "gemini",
        transportProviderId: "cloud-code",
        modelId: "gemini-4-argon",
        now: nowMs,
      }),
    ).rejects.toThrow(/No active/);

    nowMs += 2_000; // t+6s
    const recoveredPlan = await planner.plan(subject, { requestedModel: "gemini-4-argon" });
    expect(recoveredPlan.candidateRefs.length).toBe(1);
    const recoveredAcq = await coordinator.acquire({
      targetProviderId: "gemini",
      transportProviderId: "cloud-code",
      modelId: "gemini-4-argon",
      now: nowMs,
    });
    expect(recoveredAcq.material.accountId).toBe("acct-1");
    await recoveredAcq.release?.();
  });
});

describe("gateway host wiring regression (transient Cloud Code 429)", () => {
  let tempBase = "";

  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), "h2a-gw-cc-retry-"));
    const emptyBin = join(tempBase, "bin");
    const keyringDir = join(tempBase, "keyring");
    mkdirSync(emptyBin, { recursive: true });
    mkdirSync(keyringDir, { recursive: true });
    chmodSync(keyringDir, 0o700);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("H2A_LLM_MESH_OWNER_SCOPE", "cli:test-retry-owner");
    vi.stubEnv("HOME", join(tempBase, "home"));
    vi.stubEnv("XDG_RUNTIME_DIR", join(tempBase, "run"));
    vi.stubEnv("H2A_ROOT", join(tempBase, "h2a-root"));
    vi.stubEnv("SENTROPIC_LLM_MESH_KEYRING_DIR", keyringDir);
    vi.stubEnv("PATH", emptyBin);
    resetSessions();
    resetSessionLedger();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (tempBase) rmSync(tempBase, { recursive: true, force: true });
    tempBase = "";
  });

  it("retries transient Cloud Code 429 inside createLocalGatewayApp without triggering 503 No route on the next request", async () => {
    const keyring = new EncryptedFileKeyring(process.env.SENTROPIC_LLM_MESH_KEYRING_DIR);
    const accountId = "acct_cc_test_retry";
    const nowIso = new Date().toISOString();
    const futureIso = new Date(Date.now() + 3_600_000).toISOString();

    await keyring.setSecret(
      "sentropic-llm-mesh:accounts:index",
      JSON.stringify([accountId]),
    );
    await keyring.setSecret(
      `sentropic-llm-mesh:${accountId}:owner`,
      JSON.stringify({ v: 1, accountId, ownerScopeRef: "cli:test-retry-owner" }),
    );
    await keyring.setSecret(
      `sentropic-llm-mesh:${accountId}:envelope`,
      JSON.stringify({
        accountId,
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: futureIso,
        authClientConfigVersion: "v1.0.0",
      }),
    );
    await keyring.setSecret(
      `sentropic-llm-mesh:${accountId}:public`,
      JSON.stringify({
        accountId,
        accountLabel: "Cloud Code Test",
        providerId: "cloud-code",
        status: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
        account: {
          accountId,
          ownerScopeRef: "cli:test-retry-owner",
          accountLabel: "Cloud Code Test",
          targetProviderId: "gemini",
          transportProviderId: "cloud-code",
          status: "active",
          enrollmentCompletedAt: nowIso,
          metadata: { cloudaicompanionProject: "test-project" },
        },
      }),
    );

    let streamCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === MODELS_URL) {
        return new Response(
          JSON.stringify({
            models: {
              "gemini-4-neon-medium": {},
              "gemini-4-neon-high": {},
              "gemini-4-neon-xhigh": {},
              "gemini-4-argon-high": {},
              "gemini-4-argon": {},
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === STREAM_URL) {
        streamCalls += 1;
        if (streamCalls === 1) {
          return json429({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "Rate limit exceeded",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "RATE_LIMIT_EXCEEDED",
                  domain: "cloudcode-pa.googleapis.com",
                },
                {
                  "@type": "type.googleapis.com/google.rpc.RetryInfo",
                  retryDelay: "2s",
                },
              ],
            },
          });
        }
        return sseOk("answer-after-retry");
      }
      throw new Error(`unexpected fetch url: ${url}`);
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const app = await createLocalGatewayApp({
        routing: {
          policy: {
            strategy: { kind: "ordered", preferences: [{ transportProviderId: "cloud-code" }] },
            rules: [],
            fallbackMode: "retest-preferred",
            negativeCacheTtlMs: 300_000,
            maxAttempts: 3,
            preferSameTransport: true,
            stickyAccount: true,
            rotateEquivalentAccounts: false,
            allowEquivalentModels: true,
          },
        },
        cloudCodeRetry: {
          sleep: async () => {},
          random: () => 0,
          onLog: () => {},
        },
      });

      const sessionRes = await app.request("/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "gw-retry-sess", clientSessionId: "client-retry-1" }),
      });
      expect(sessionRes.status).toBe(201);
      const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };

      const first = await app.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          model: "claude-opus-5-5",
          max_tokens: 64,
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(first.status).toBe(200);
      expect(first.headers.get("x-sentropic-served")).toBe(
        "provider=gemini; model=gemini-4-neon; transport=cloud-code",
      );
      expect(streamCalls).toBe(2);

      // Subsequent request succeeds immediately (route & account were never locked).
      const second = await app.request("/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          model: "claude-opus-5-5",
          max_tokens: 64,
          messages: [{ role: "user", content: "second" }],
        }),
      });
      expect(second.status).toBe(200);
      expect(streamCalls).toBe(3);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("recovers streaming /v1/messages with a Read tool call after a transient 429", async () => {
    const keyring = new EncryptedFileKeyring(process.env.SENTROPIC_LLM_MESH_KEYRING_DIR);
    const accountId = "acct_cc_test_stream_tool";
    const nowIso = new Date().toISOString();
    const futureIso = new Date(Date.now() + 3_600_000).toISOString();

    await keyring.setSecret("sentropic-llm-mesh:accounts:index", JSON.stringify([accountId]));
    await keyring.setSecret(
      `sentropic-llm-mesh:${accountId}:owner`,
      JSON.stringify({ v: 1, accountId, ownerScopeRef: "cli:test-retry-owner" }),
    );
    await keyring.setSecret(
      `sentropic-llm-mesh:${accountId}:envelope`,
      JSON.stringify({
        accountId,
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: futureIso,
        authClientConfigVersion: "v1.0.0",
      }),
    );
    await keyring.setSecret(
      `sentropic-llm-mesh:${accountId}:public`,
      JSON.stringify({
        accountId,
        accountLabel: "Cloud Code Stream Tool",
        providerId: "cloud-code",
        status: "active",
        createdAt: nowIso,
        updatedAt: nowIso,
        account: {
          accountId,
          ownerScopeRef: "cli:test-retry-owner",
          accountLabel: "Cloud Code Stream Tool",
          targetProviderId: "gemini",
          transportProviderId: "cloud-code",
          status: "active",
          enrollmentCompletedAt: nowIso,
          metadata: { cloudaicompanionProject: "test-project" },
        },
      }),
    );

    let streamCalls = 0;
    const logs: CloudCodeRetryLogEvent[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === MODELS_URL) {
        return new Response(
          JSON.stringify({
            models: {
              "gemini-4-neon-medium": {},
              "gemini-4-neon-high": {},
              "gemini-4-neon-xhigh": {},
              "gemini-4-argon-high": {},
              "gemini-4-argon": {},
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === STREAM_URL) {
        streamCalls += 1;
        if (streamCalls === 1) {
          return json429({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "No capacity available",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "MODEL_CAPACITY_EXHAUSTED",
                  domain: "cloudcode-pa.googleapis.com",
                },
              ],
            },
          });
        }
        const toolPayload = `data: ${JSON.stringify({
          response: {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        id: "call_read_1",
                        name: "Read",
                        args: { file_path: "package.json" },
                      },
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 },
          },
        })}\n\n`;
        return new Response(toolPayload, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    };

    const app = await createLocalGatewayApp({
      routing: {
        policy: {
          strategy: { kind: "ordered", preferences: [{ transportProviderId: "cloud-code" }] },
          rules: [],
          fallbackMode: "retest-preferred",
          negativeCacheTtlMs: 300_000,
          maxAttempts: 3,
          preferSameTransport: true,
          stickyAccount: true,
          rotateEquivalentAccounts: false,
          allowEquivalentModels: true,
        },
      },
      cloudCodeFetch: mockFetch,
      cloudCodeRetry: {
        sleep: async () => {},
        random: () => 0,
        onLog: (ev) => logs.push(ev),
      },
    });

    const sessionRes = await app.request("/v1/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "gw-stream-tool-sess", clientSessionId: "client-tool-1" }),
    });
    const { gatewayToken } = (await sessionRes.json()) as { gatewayToken: string };

    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        model: "claude-opus-5-5",
        max_tokens: 128,
        stream: true,
        tools: [
          {
            name: "Read",
            description: "Read a file",
            input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
          },
        ],
        messages: [{ role: "user", content: "Read package.json" }],
      }),
    });
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain('"type":"tool_use"');
    expect(sse).toContain('"name":"Read"');
    expect(streamCalls).toBe(2);
    expect(logs.map((l) => l.event)).toEqual(["retry", "recovered"]);
  });
});
