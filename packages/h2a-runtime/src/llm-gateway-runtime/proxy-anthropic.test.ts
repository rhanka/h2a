import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REQUEST_BODY = {
  model: "claude-sonnet-4-6",
  max_tokens: 32,
  messages: [{ role: "user", content: "ping" }],
};

describe("proxy-anthropic quota fallback", () => {
  let scratch: string;
  let stickyPath: string;

  beforeEach(() => {
    vi.resetModules();
    scratch = mkdtempSync(join(tmpdir(), "remote-gateway-"));
    stickyPath = join(scratch, "sticky.json");
    vi.stubEnv("LLM_GATEWAY_TOKEN_SEED", "test-seed");
    vi.stubEnv("LLM_GATEWAY_STICKY_FILE", stickyPath);
    vi.stubEnv("OPENAI_UPSTREAM_URL", "https://openai.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(scratch, { recursive: true, force: true });
  });

  async function appWithSession(accounts: unknown[]) {
    vi.stubEnv("GATEWAY_ACCOUNTS", JSON.stringify(accounts));
    const accountsModule = await import("./accounts.js");
    accountsModule.resetAccountsCache();
    const { acquireSession } = await import("./sticky.js");
    const { handleMessages } = await import("./proxy-anthropic.js");
    const session = await acquireSession("sess-429");
    const app = new Hono();
    app.post("/v1/messages", handleMessages);
    return { app, gatewayToken: session.gatewayToken };
  }

  it("refuses an un-routed 429 without rebinding the sticky account", async () => {
    const { app, gatewayToken } = await appWithSession([
      {
        id: "claude-quota",
        provider: "anthropic",
        label: "Claude quota",
        token: "sk-ant-quota",
      },
      {
        id: "openai-ok",
        provider: "openai",
        label: "OpenAI ok",
        token: "sk-openai-ok",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "usage limit reached" }), {
        status: 429,
        headers: { "retry-after": "30", "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewayToken}`,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(REQUEST_BODY),
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    await expect(res.json()).resolves.toEqual({ error: "usage limit reached" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant-quota",
    );
    expect(readFileSync(stickyPath, "utf8")).toContain("claude-quota");
    const { lookupToken } = await import("./sticky.js");
    const stickySession = await lookupToken(gatewayToken);
    expect(stickySession).toMatchObject({
      accountId: "claude-quota",
      provider: "anthropic",
    });
    expect(stickySession).not.toHaveProperty("token");
  });

  it("preserves the upstream 429 when no fallback account is configured", async () => {
    const { app, gatewayToken } = await appWithSession([
      {
        id: "claude-quota",
        provider: "anthropic",
        label: "Claude quota",
        token: "sk-ant-quota",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "usage limit reached" }), {
        status: 429,
        headers: { "retry-after": "30", "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(REQUEST_BODY),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    await expect(res.json()).resolves.toEqual({ error: "usage limit reached" });
  });

  it("refuses an un-routed 429 without selecting a Gemini fallback", async () => {
    const { app, gatewayToken } = await appWithSession([
      {
        id: "claude-quota",
        provider: "anthropic",
        label: "Claude quota",
        token: "sk-ant-quota",
      },
      {
        id: "gemini-fallback",
        provider: "google",
        label: "Gemini Code Assist (OAuth)",
        token: "google-access-token",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "usage limit reached" }), {
        status: 429,
        headers: { "retry-after": "30", "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(REQUEST_BODY),
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    await expect(res.json()).resolves.toEqual({ error: "usage limit reached" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(stickyPath, "utf8")).toContain("claude-quota");
    expect(readFileSync(stickyPath, "utf8")).not.toContain("gemini-fallback");
    const { lookupToken } = await import("./sticky.js");
    const stickySession = await lookupToken(gatewayToken);
    expect(stickySession).toMatchObject({
      accountId: "claude-quota",
      provider: "anthropic",
    });
    expect(stickySession).not.toHaveProperty("token");
  });

  it("refuses an un-routed 429 across UNRECOGNISED providers", async () => {
    // Neither provider is in a recognised pool, so both mapped to undefined and
    // the cross-pool comparison saw them as EQUAL — the refusal did not fire and
    // the session was rebound across providers. Nothing validates this field, so
    // a hand-written GATEWAY_ACCOUNTS reaches this path.
    const { app, gatewayToken } = await appWithSession([
      {
        id: "azure-sticky",
        provider: "azure-openai",
        label: "Azure sticky",
        token: "azure-token",
      },
      {
        id: "vertex-other",
        provider: "vertex",
        label: "Vertex other",
        token: "vertex-token",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "usage limit reached" }), {
        status: 429,
        headers: { "retry-after": "30", "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(REQUEST_BODY),
      }),
    );

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(stickyPath, "utf8")).not.toContain("vertex-other");
    const { lookupToken } = await import("./sticky.js");
    await expect(lookupToken(gatewayToken)).resolves.toMatchObject({
      accountId: "azure-sticky",
      provider: "azure-openai",
    });
  });

  it("rebinds an un-routed 429 to a same-pool Anthropic account", async () => {
    const { app, gatewayToken } = await appWithSession([
      {
        id: "claude-quota",
        provider: "anthropic",
        label: "Claude quota",
        token: "sk-ant-quota",
      },
      {
        id: "claude-backup",
        provider: "anthropic",
        label: "Claude backup",
        token: "sk-ant-backup",
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "usage limit reached" }), {
          status: 429,
          headers: { "retry-after": "30", "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "pong" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(REQUEST_BODY),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "pong" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant-quota",
    );
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((secondInit.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant-backup",
    );
    expect(readFileSync(stickyPath, "utf8")).toContain("claude-backup");
    const { lookupToken } = await import("./sticky.js");
    const stickySession = await lookupToken(gatewayToken);
    expect(stickySession).toMatchObject({
      accountId: "claude-backup",
      provider: "anthropic",
    });
    expect(stickySession).not.toHaveProperty("token");
  });
});
