import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireLlmMeshSessionEnv,
  gatewayScriptPath,
  llmMeshSeedPath,
  llmMeshTokenPath,
  localGatewaySessionProvider,
  readOrCreateLlmMeshSeed,
  refreshAccountToken,
} from "./llm-mesh.js";

const SCRATCH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "llm-mesh",
);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("llm-mesh seed", () => {
  it("persists only the seed as the durable token secret with 0600 mode", () => {
    const seed = readOrCreateLlmMeshSeed(SCRATCH);
    expect(seed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readOrCreateLlmMeshSeed(SCRATCH)).toBe(seed);
    expect(statSync(llmMeshSeedPath(SCRATCH)).mode & 0o777).toBe(0o600);
  });
});

describe("gateway runtime path", () => {
  it("uses the remote-cli embedded gateway runtime, not apps/llm-gateway", () => {
    expect(gatewayScriptPath()).toMatch(/\/(src|dist)\/llm-gateway-runtime\/index\.js$/);
    expect(gatewayScriptPath()).not.toContain("apps/llm-gateway");
  });

  it("preflights a supported local provider before spawning", () => {
    const account = {
      id: "account",
      label: "Account",
      token: "token",
    };

    expect(
      localGatewaySessionProvider([
        { ...account, provider: "google" },
      ]),
    ).toBeUndefined();
    expect(
      localGatewaySessionProvider([
        { ...account, provider: "anthropic" },
      ]),
    ).toBe("anthropic");
    expect(
      localGatewaySessionProvider([
        { ...account, provider: "anthropic" },
        { ...account, id: "codex", provider: "openai" },
      ]),
    ).toBe("codex");
  });
});

describe("Google OAuth refresh", () => {
  it("refreshes an opaque Google access token when expiresAt is past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-google-client-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "fresh-google-token", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshAccountToken({
        id: "gemini-code",
        provider: "google",
        label: "Gemini Code Assist (OAuth)",
        token: "opaque-expired-google-token",
        refreshToken: "google-refresh-token",
        expiresAt: "2026-07-17T11:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      token: "fresh-google-token",
      refreshToken: "google-refresh-token",
      expiresAt: "2026-07-17T13:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("google-refresh-token");
    expect(body.get("client_id")).toBe("test-google-client-id");
    expect(body.get("client_secret")).toBe("test-google-client-secret");
  });

  it("does not refresh an opaque Google access token before expiresAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const account = {
      id: "gemini-code",
      provider: "google" as const,
      label: "Gemini Code Assist (OAuth)",
      token: "opaque-active-google-token",
      refreshToken: "google-refresh-token",
      expiresAt: "2026-07-17T13:00:00.000Z",
    };

    await expect(refreshAccountToken(account)).resolves.toBe(account);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears a stale expiry when Google omits expires_in", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-google-client-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-google-client-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "fresh-google-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await refreshAccountToken({
      id: "gemini-code",
      provider: "google",
      label: "Gemini Code Assist (OAuth)",
      token: "opaque-expired-google-token",
      refreshToken: "google-refresh-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    expect(refreshed.token).toBe("fresh-google-token");
    expect(refreshed).not.toHaveProperty("expiresAt");
  });

  it("never sends an expired Claude refresh token to another provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const account = {
      id: "claude-code",
      provider: "anthropic" as const,
      label: "Claude Code (OAuth)",
      token: "opaque-expired-claude-token",
      refreshToken: "claude-refresh-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
    };

    await expect(refreshAccountToken(account)).resolves.toBe(account);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a revoked Google refresh token for re-enrollment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshAccountToken({
        id: "gemini-code",
        provider: "google",
        label: "Gemini Code Assist (OAuth)",
        token: "opaque-expired-google-token",
        refreshToken: "revoked-google-refresh-token",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/Google token refresh failed \(400\).*invalid_grant/);
  });

  it("does not attempt network refresh without a refresh token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const account = {
      id: "gemini-code",
      provider: "google" as const,
      label: "Gemini Code Assist (OAuth)",
      token: "opaque-expired-google-token",
      expiresAt: "2020-01-01T00:00:00.000Z",
    };

    await expect(refreshAccountToken(account)).resolves.toBe(account);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("acquireLlmMeshSessionEnv", () => {
  it("reacquires the deterministic gateway token and rewrites runtime metadata", async () => {
    writeFileSync(
      llmMeshTokenPath(SCRATCH),
      JSON.stringify({
        gatewayToken: "gw-stale",
        baseUrl: "http://localhost:3002",
        pid: process.pid,
        provider: "codex",
      }),
      "utf8",
    );
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://localhost:3002/v1/session");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        sessionId: "local-dev",
        provider: "codex",
      });
      return new Response(JSON.stringify({ gatewayToken: "gw-v1-local-dev.fixed" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = await acquireLlmMeshSessionEnv(SCRATCH);

    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "gw-v1-local-dev.fixed",
      ANTHROPIC_API_KEY: "gw-v1-local-dev.fixed",
    });
    expect(JSON.parse(readFileSync(llmMeshTokenPath(SCRATCH), "utf8"))).toEqual({
      gatewayToken: "gw-v1-local-dev.fixed",
      baseUrl: "http://localhost:3002",
      pid: process.pid,
      provider: "codex",
    });
  });
});
