import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testScratch: string;

beforeEach(() => {
  vi.resetModules();
  testScratch = mkdtempSync(join(tmpdir(), "gateway-index-test-"));
  vi.stubEnv("LLM_GATEWAY_STICKY_FILE", join(testScratch, "sticky.json"));
  vi.stubEnv("LLM_GATEWAY_TOKEN_SEED", "test-seed");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(testScratch, { recursive: true, force: true });
});

describe("embedded gateway reporting session attestation", () => {
  it("attests the requested Opus alias and canonical Terra Codex transport before use", async () => {
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
    ]));
    const { app } = await import("./index.js");

    const created = await app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "track-report-alias",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
          profile: "track-report-ai",
        }),
      }),
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      accountId: "codex-oauth",
      requestedModel: "claude-opus-4-8",
      modelId: "gpt-5.6-terra",
      upstreamModel: "gpt-5.6-terra",
      reasoningEffort: "xhigh",
      provider: "openai",
      authType: "bearer",
      transport: "codex-responses",
      routeReason: "catalog-alias",
    });
  });

  it("rejects a raw API-key route before any report context can egress", async () => {
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-api",
        provider: "openai",
        label: "Codex API key",
        token: "sk-test-raw-key",
      },
    ]));
    const upstreamFetch = vi.fn(() => {
      throw new Error("must not contact an upstream provider");
    });
    vi.stubGlobal("fetch", upstreamFetch);
    const { app } = await import("./index.js");

    const created = await app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "track-report-raw-key",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
          profile: "track-report-ai",
        }),
      }),
    );

    expect(created.status).toBe(400);
    await expect(created.json()).resolves.toMatchObject({
      error: expect.stringMatching(/codex-responses/),
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("refuses to attest a constrained session without durable sticky storage", async () => {
    vi.stubEnv("LLM_GATEWAY_STICKY_FILE", "");
    vi.stubEnv("K8S_TOKEN", "");
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
    ]));
    const { app } = await import("./index.js");
    const response = await app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "no-durable-store",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/durable sticky backend/),
    });
  });

  it("never downgrades an attested Codex session to a raw key after quota exhaustion", async () => {
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-raw",
        provider: "openai",
        label: "Raw API key",
        token: "sk-must-not-receive-context",
      },
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
    ]));
    const { app } = await import("./index.js");
    const created = await app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "track-report-quota",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
        }),
      }),
    );
    const session = await created.json() as { gatewayToken: string };
    expect(created.status).toBe(201);

    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "quota exhausted" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const response = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 58_192,
          thinking: { type: "enabled", budget_tokens: 50_000 },
          messages: [{ role: "user", content: "sensitive report context" }],
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(upstreamFetch.mock.calls)).not.toContain(
      "sk-must-not-receive-context",
    );
  });

  it("keeps a session transport claim immutable across re-acquisition", async () => {
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-raw",
        provider: "openai",
        label: "Raw API key",
        token: "sk-raw",
      },
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
    ]));
    const { app } = await import("./index.js");
    const requestSession = (requiredTransport?: string) => app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "transport-immutable",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          ...(requiredTransport ? { requiredTransport } : {}),
        }),
      }),
    );

    const original = await requestSession("codex-responses");
    const originalBody = await original.json() as { gatewayToken: string };
    expect(original.status).toBe(201);

    const downgrade = await requestSession("openai-chat-completions");
    expect(downgrade.status).toBe(400);
    await expect(downgrade.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already codex-responses/),
    });

    const unchanged = await requestSession();
    expect(unchanged.status).toBe(201);
    await expect(unchanged.json()).resolves.toMatchObject({
      gatewayToken: originalBody.gatewayToken,
      accountId: "codex-oauth",
      transport: "codex-responses",
    });
  });

  it("allows only one transport claim for concurrent acquisitions", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "gateway-concurrent-claim-"));
    try {
      vi.stubEnv("LLM_GATEWAY_STICKY_FILE", join(scratch, "sticky.json"));
      vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
        {
          id: "codex-raw",
          provider: "openai",
          label: "Raw API key",
          token: "sk-raw",
        },
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex OAuth",
          token: "codex.header.signature",
        },
      ]));
      const { app: firstApp } = await import("./index.js");
      vi.resetModules();
      const { app: secondApp } = await import("./index.js");
      const request = (
        targetApp: { fetch(request: Request): Response | Promise<Response> },
        requiredTransport: string,
      ) => targetApp.fetch(
        new Request("http://localhost/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "concurrent-transport",
            model: "claude-opus-4-8",
            reasoningEffort: "xhigh",
            requiredTransport,
          }),
        }),
      );

      const [codex, raw] = await Promise.all([
        request(firstApp, "codex-responses"),
        request(secondApp, "openai-chat-completions"),
      ]);
      expect([codex.status, raw.status].sort()).toEqual([201, 400]);
      const winner = codex.status === 201 ? codex : raw;
      const loser = codex.status === 400 ? codex : raw;
      const winnerBody = await winner.json() as { transport: string };
      await expect(loser.json()).resolves.toMatchObject({
        error: expect.stringMatching(/concurrently|already/),
      });
      expect(winnerBody.transport).toBe(
        codex.status === 201 ? "codex-responses" : "openai-chat-completions",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("prevents a concurrent legacy acquisition from overwriting a Codex claim", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "gateway-legacy-race-"));
    try {
      const stickyPath = join(scratch, "sticky.json");
      vi.stubEnv("LLM_GATEWAY_STICKY_FILE", stickyPath);
      vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
        {
          id: "codex-raw",
          provider: "openai",
          label: "Raw API key",
          token: "sk-racing-raw",
        },
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex OAuth",
          token: "codex.header.signature",
        },
      ]));
      const { app: constrainedApp } = await import("./index.js");
      vi.resetModules();
      const { app: legacyApp } = await import("./index.js");
      writeFileSync(`${stickyPath}.lock`, "held\n", { mode: 0o600 });
      const request = (
        targetApp: { fetch(request: Request): Response | Promise<Response> },
        constrained: boolean,
      ) => targetApp.fetch(
        new Request("http://localhost/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "legacy-race",
            model: "claude-opus-4-8",
            ...(constrained
              ? {
                  reasoningEffort: "xhigh",
                  requiredTransport: "codex-responses",
                }
              : {}),
          }),
        }),
      );
      const constrainedPromise = request(constrainedApp, true);
      const legacyPromise = request(legacyApp, false);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      rmSync(`${stickyPath}.lock`, { force: true });
      const [constrained, legacy] = await Promise.all([
        constrainedPromise,
        legacyPromise,
      ]);

      expect(constrained.status).toBe(201);
      expect(legacy.status).toBe(400);
      const constrainedSession = await constrained.json() as {
        gatewayToken: string;
      };
      const stored = JSON.parse(readFileSync(stickyPath, "utf8")) as Record<string, string>;
      expect(JSON.parse(stored["legacy-race"]!)).toEqual({
        accountId: "codex-oauth",
        requiredTransport: "codex-responses",
      });

      const upstreamFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "quota exhausted" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", upstreamFetch);
      const response = await constrainedApp.fetch(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: {
            authorization: `Bearer ${constrainedSession.gatewayToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-opus-4-8",
            thinking: { type: "enabled", budget_tokens: 50_000 },
            messages: [{ role: "user", content: "legacy-race-sensitive" }],
          }),
        }),
      );
      expect(response.status).toBe(429);
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
      expect(String(upstreamFetch.mock.calls[0]![0])).toContain("responses");
      expect(JSON.stringify(upstreamFetch.mock.calls)).not.toContain(
        "sk-racing-raw",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("revalidates stale legacy caches and refuses stale rebinds after promotion", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "gateway-stale-cache-"));
    try {
      const stickyPath = join(scratch, "sticky.json");
      writeFileSync(
        stickyPath,
        `${JSON.stringify({ "stale-session": "codex-raw" })}\n`,
      );
      vi.stubEnv("LLM_GATEWAY_STICKY_FILE", stickyPath);
      vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
        {
          id: "codex-raw",
          provider: "openai",
          label: "Raw API key",
          token: "sk-stale-raw",
        },
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex OAuth",
          token: "codex.header.signature",
        },
      ]));
      const { app: staleApp } = await import("./index.js");
      const staleSticky = await import("./sticky.js");
      const staleAccounts = await import("./accounts.js");
      const legacy = await staleApp.fetch(
        new Request("http://localhost/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "stale-session",
            model: "claude-opus-4-8",
          }),
        }),
      );
      const legacySession = await legacy.json() as { gatewayToken: string };
      expect(legacy.status).toBe(201);

      vi.resetModules();
      const { app: promotingApp } = await import("./index.js");
      const promoted = await promotingApp.fetch(
        new Request("http://localhost/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "stale-session",
            model: "claude-opus-4-8",
            reasoningEffort: "xhigh",
            requiredTransport: "codex-responses",
          }),
        }),
      );
      expect(promoted.status).toBe(201);

      const rawAccount = staleAccounts.findAccount("codex-raw");
      expect(rawAccount).toBeDefined();
      await expect(
        staleSticky.rebindGatewaySession(
          legacySession.gatewayToken,
          rawAccount!,
        ),
      ).rejects.toThrow(/stale gateway session/);
      const stored = JSON.parse(readFileSync(stickyPath, "utf8")) as Record<string, string>;
      expect(JSON.parse(stored["stale-session"]!)).toEqual({
        accountId: "codex-oauth",
        requiredTransport: "codex-responses",
      });

      const upstreamFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "quota exhausted" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", upstreamFetch);
      const response = await staleApp.fetch(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: {
            authorization: `Bearer ${legacySession.gatewayToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-opus-4-8",
            thinking: { type: "enabled", budget_tokens: 50_000 },
            messages: [{ role: "user", content: "stale-cache-sensitive" }],
          }),
        }),
      );
      expect(response.status).toBe(429);
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
      expect(String(upstreamFetch.mock.calls[0]![0])).toContain("responses");
      expect(JSON.stringify(upstreamFetch.mock.calls)).not.toContain("sk-stale-raw");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("migrates a legacy binding to an immutable claim before attesting", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "gateway-legacy-claim-"));
    try {
      const stickyPath = join(scratch, "sticky.json");
      writeFileSync(
        stickyPath,
        `${JSON.stringify({ "legacy-session": "codex-oauth" })}\n`,
      );
      vi.stubEnv("LLM_GATEWAY_STICKY_FILE", stickyPath);
      vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
        {
          id: "codex-raw",
          provider: "openai",
          label: "Raw API key",
          token: "sk-raw",
        },
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex OAuth",
          token: "codex.header.signature",
        },
      ]));
      const sessionRequest = (
        targetApp: { fetch(request: Request): Response | Promise<Response> },
        requiredTransport: string,
      ) =>
        targetApp.fetch(
          new Request("http://localhost/v1/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId: "legacy-session",
              model: "claude-opus-4-8",
              reasoningEffort: "xhigh",
              requiredTransport,
            }),
          }),
        );

      const { app } = await import("./index.js");
      expect((await sessionRequest(app, "codex-responses")).status).toBe(201);
      const stored = JSON.parse(readFileSync(stickyPath, "utf8")) as Record<string, string>;
      expect(JSON.parse(stored["legacy-session"]!)).toEqual({
        accountId: "codex-oauth",
        requiredTransport: "codex-responses",
      });
      expect((await sessionRequest(app, "openai-chat-completions")).status).toBe(400);

      vi.resetModules();
      const { app: restartedApp } = await import("./index.js");
      expect(
        (await sessionRequest(restartedApp, "openai-chat-completions")).status,
      ).toBe(400);
      await expect(
        (await sessionRequest(restartedApp, "codex-responses")).json(),
      ).resolves.toMatchObject({
        accountId: "codex-oauth",
        transport: "codex-responses",
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("rejects a signed gateway token when its durable binding disappeared", async () => {
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
      {
        id: "codex-raw",
        provider: "openai",
        label: "Raw API key",
        token: "sk-must-not-receive-context",
      },
    ]));
    const { app } = await import("./index.js");
    const created = await app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "missing-binding",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
        }),
      }),
    );
    const session = await created.json() as { gatewayToken: string };
    expect(created.status).toBe(201);
    rmSync(join(testScratch, "sticky.json"), { force: true });

    vi.resetModules();
    const upstreamFetch = vi.fn(() => {
      throw new Error("missing binding must fail before upstream egress");
    });
    vi.stubGlobal("fetch", upstreamFetch);
    const { app: restartedApp } = await import("./index.js");
    const response = await restartedApp.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          messages: [{ role: "user", content: "must remain local" }],
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("creates missing ConfigMap data atomically under resourceVersion CAS", async () => {
    vi.stubEnv("LLM_GATEWAY_STICKY_FILE", "");
    vi.stubEnv("K8S_TOKEN", "test-k8s-token");
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
    ]));
    const binding = JSON.stringify({
      accountId: "codex-oauth",
      requiredTransport: "codex-responses",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ metadata: { resourceVersion: "1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          metadata: { resourceVersion: "2" },
          data: { "k8s-empty-data": binding },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { app } = await import("./index.js");
    const response = await app.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "k8s-empty-data",
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const patchInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((patchInit.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json-patch+json",
    );
    expect(JSON.parse(String(patchInit.body))).toEqual([
      {
        op: "test",
        path: "/metadata/resourceVersion",
        value: "1",
      },
      {
        op: "add",
        path: "/data",
        value: { "k8s-empty-data": binding },
      },
    ]);
  });

  it("retries ConfigMap resourceVersion conflicts for distinct sessions", async () => {
    vi.stubEnv("LLM_GATEWAY_STICKY_FILE", "");
    vi.stubEnv("K8S_TOKEN", "test-k8s-token");
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
      {
        id: "codex-oauth",
        provider: "openai",
        label: "Codex OAuth",
        token: "codex.header.signature",
      },
    ]));
    let resourceVersion = 1;
    let data: Record<string, string> = {};
    let initialReads = 0;
    let releaseInitialReads!: () => void;
    const initialReadBarrier = new Promise<void>((resolveBarrier) => {
      releaseInitialReads = resolveBarrier;
    });
    let conflicts = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") {
        const snapshot = JSON.stringify({
          metadata: { resourceVersion: String(resourceVersion) },
          data: { ...data },
        });
        if (initialReads < 2) {
          initialReads++;
          if (initialReads === 2) releaseInitialReads();
          await initialReadBarrier;
        }
        return new Response(snapshot, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const operations = JSON.parse(String(init.body)) as Array<{
        op: string;
        path: string;
        value: unknown;
      }>;
      if (operations[0]?.value !== String(resourceVersion)) {
        conflicts++;
        return new Response("{}", { status: 409 });
      }
      const mutation = operations[1]!;
      if (mutation.path === "/data") {
        data = { ...(mutation.value as Record<string, string>) };
      } else {
        const encoded = mutation.path.slice("/data/".length);
        const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
        data[key] = String(mutation.value);
      }
      resourceVersion++;
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { app: firstApp } = await import("./index.js");
    vi.resetModules();
    const { app: secondApp } = await import("./index.js");
    const request = (
      targetApp: { fetch(request: Request): Response | Promise<Response> },
      sessionId: string,
    ) => targetApp.fetch(
      new Request("http://localhost/v1/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          model: "claude-opus-4-8",
          reasoningEffort: "xhigh",
          requiredTransport: "codex-responses",
        }),
      }),
    );

    const [first, second] = await Promise.all([
      request(firstApp, "distinct-a"),
      request(secondApp, "distinct-b"),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(conflicts).toBeGreaterThanOrEqual(1);
    expect(Object.keys(data).sort()).toEqual(["distinct-a", "distinct-b"]);
  });

  it("rehydrates the transport claim fail-closed after a gateway restart", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "gateway-transport-claim-"));
    try {
      vi.stubEnv("LLM_GATEWAY_STICKY_FILE", join(scratch, "sticky.json"));
      vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Codex OAuth",
          token: "codex.header.signature",
        },
      ]));
      const { app } = await import("./index.js");
      const created = await app.fetch(
        new Request("http://localhost/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "restart-safe",
            model: "claude-opus-4-8",
            reasoningEffort: "xhigh",
            requiredTransport: "codex-responses",
          }),
        }),
      );
      const session = await created.json() as { gatewayToken: string };
      expect(created.status).toBe(201);

      vi.resetModules();
      vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify([
        {
          id: "codex-oauth",
          provider: "openai",
          label: "Credential replaced with raw key",
          token: "sk-replaced-after-restart",
        },
      ]));
      const upstreamFetch = vi.fn(() => {
        throw new Error("raw fallback must not receive context");
      });
      vi.stubGlobal("fetch", upstreamFetch);
      const { app: restartedApp } = await import("./index.js");
      const response = await restartedApp.fetch(
        new Request("http://localhost/v1/messages", {
          method: "POST",
          headers: {
            authorization: `Bearer ${session.gatewayToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-opus-4-8",
            messages: [{ role: "user", content: "restart-sensitive context" }],
          }),
        }),
      );

      expect(response.status).toBe(403);
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
