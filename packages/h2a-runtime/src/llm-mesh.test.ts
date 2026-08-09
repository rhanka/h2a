import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmMeshFacade } from "@sentropic/llm-mesh/facade";

import {
  LlmMeshManager,
  acquireLlmMeshSessionEnv,
  enrollViaFacade,
  gatewayScriptPath,
  llmMeshTokenPath,
} from "./llm-mesh.js";

const SCRATCH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "llm-mesh",
);

beforeEach(() => mkdirSync(SCRATCH, { recursive: true }));

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gateway runtime boundary", () => {
  it("uses the embedded Sentropic-backed gateway runtime", () => {
    expect(gatewayScriptPath()).toMatch(/\/(src|dist)\/llm-gateway-runtime\/index\.js$/);
    expect(gatewayScriptPath()).not.toContain("apps/llm-gateway");
  });

});

describe("facade enrollment", () => {
  it("waits for Cloud Code callback without receiving provider credentials", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-cloud",
        url: "https://accounts.example/authorize",
        expiresAt: "2026-08-07T01:00:00.000Z",
      }),
      waitForCallback: vi.fn().mockResolvedValue({
        accountId: "account-cloud",
        label: "Cloud Code",
      }),
      pollForCompletion: vi.fn(),
    } as unknown as LlmMeshFacade;
    const openBrowser = vi.fn();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("cloud-code", {
      facade,
      openBrowser,
      configRef: "config-v1",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1/callback",
    })).resolves.toEqual({
      accountId: "account-cloud",
      provider: "cloud-code",
      label: "Cloud Code",
    });

    expect(facade.enroll).toHaveBeenCalledWith("cloud-code", {
      configRef: "config-v1",
      mode: "cli",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1/callback",
    });
    expect(openBrowser).toHaveBeenCalledWith("https://accounts.example/authorize");
    expect(facade.waitForCallback).toHaveBeenCalledWith("enroll-cloud");
  });

  it("polls the opaque facade for Codex device enrollment", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "device-code",
        enrollmentId: "enroll-codex",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.example/device",
        expiresAt: "2026-08-07T01:00:00.000Z",
        intervalSeconds: 5,
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn().mockResolvedValue({
        accountId: "account-codex",
        label: "Codex",
      }),
    } as unknown as LlmMeshFacade;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("codex", { facade })).resolves.toEqual({
      accountId: "account-codex",
      provider: "codex",
      label: "Codex",
    });
    expect(facade.pollForCompletion).toHaveBeenCalledWith("enroll-codex");
    expect(facade.waitForCallback).not.toHaveBeenCalled();
  });

});

describe("gateway session acquisition", () => {
  it("requests an unpinned mesh session with a caller-provided affinity", async () => {
    writeFileSync(llmMeshTokenPath(SCRATCH), JSON.stringify({
      gatewayToken: "gw-stale",
      baseUrl: "http://localhost:3002",
      pid: process.pid,
    }));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        sessionId: "h2a-proj-alpha",
        clientSessionId: "h2a-proj-alpha",
        workspaceId: SCRATCH,
      });
      return new Response(JSON.stringify({ gatewayToken: "gw-v2-opaque" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(acquireLlmMeshSessionEnv(SCRATCH, "h2a-proj-alpha"))
      .resolves.toEqual({
        ANTHROPIC_BASE_URL: "http://localhost:3002",
        ANTHROPIC_AUTH_TOKEN: "gw-v2-opaque",
      });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses a fresh affinity when the caller has none", async () => {
    writeFileSync(llmMeshTokenPath(SCRATCH), JSON.stringify({
      gatewayToken: "gw-stale",
      baseUrl: "http://localhost:3002",
      pid: process.pid,
    }));
    const sessionIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { sessionId: string };
      sessionIds.push(body.sessionId);
      return new Response(JSON.stringify({ gatewayToken: `gw-${body.sessionId}` }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }));

    await acquireLlmMeshSessionEnv(SCRATCH);
    await acquireLlmMeshSessionEnv(SCRATCH);
    expect(sessionIds).toEqual([
      expect.stringMatching(/^local-[a-f0-9]{32}$/),
      expect.stringMatching(/^local-[a-f0-9]{32}$/),
    ]);
    expect(new Set(sessionIds).size).toBe(2);
  });
});

describe("public config migration", () => {
  it("drops every legacy credential field", () => {
    const manager = new LlmMeshManager();
    manager.SaveConfig({
      accounts: [{ token: "must-not-survive", refreshToken: "nor-this" }],
      meshAccounts: [{
        accountId: "account-codex",
        provider: "codex",
        label: "Codex",
      }],
    }, SCRATCH);

    expect(manager.GetActiveConfig(SCRATCH)).toEqual({});
    expect(readFileSync(join(SCRATCH, "llm-mesh.json"), "utf8"))
      .not.toMatch(/must-not-survive|nor-this/);
  });
});
