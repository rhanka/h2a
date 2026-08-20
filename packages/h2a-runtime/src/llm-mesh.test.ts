import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmMeshFacade } from "@sentropic/llm-mesh/facade";

import {
  LlmMeshManager,
  acquireLlmMeshSessionEnv,
  enrollViaFacade,
  gatewayScriptPath,
  listAccountsViaFacade,
  llmMeshLogPath,
  llmMeshPidPath,
  llmMeshTokenPath,
  removeAccountViaFacade,
  replaceAnthropicGatewayEnvironment,
  startGateway,
} from "./llm-mesh.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

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

describe("Anthropic child environment", () => {
  it("keeps native Claude authentication while removing stale gateway state", () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "stale-gateway-token",
      ANTHROPIC_API_KEY: "user-owned-api-key",
    };

    const restore = replaceAnthropicGatewayEnvironment(env);

    expect(env).toEqual({ ANTHROPIC_API_KEY: "user-owned-api-key" });
    restore();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "stale-gateway-token",
      ANTHROPIC_API_KEY: "user-owned-api-key",
    });
  });

  it("uses only the opaque gateway lane and restores the exact parent env", () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_BASE_URL: "https://parent.example",
      ANTHROPIC_AUTH_TOKEN: "parent-token",
      ANTHROPIC_API_KEY: "user-owned-api-key",
      UNRELATED: "preserved",
    };

    const restore = replaceAnthropicGatewayEnvironment(env, {
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "opaque-gateway-token",
    });

    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "opaque-gateway-token",
      UNRELATED: "preserved",
    });
    restore();
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: "https://parent.example",
      ANTHROPIC_AUTH_TOKEN: "parent-token",
      ANTHROPIC_API_KEY: "user-owned-api-key",
      UNRELATED: "preserved",
    });
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

describe("facade account administration", () => {
  it("lists only public account metadata in the requested owner scope", async () => {
    const accounts = [{
      accountId: "acct-codex",
      providerId: "codex",
      accountLabel: "Codex local",
      status: "active",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    }];
    const facade = {
      listAccounts: vi.fn().mockResolvedValue(accounts),
    };

    await expect(listAccountsViaFacade({
      facade: facade as never,
      ownerScope: "cli:test-host",
    })).resolves.toEqual(accounts);
    expect(facade.listAccounts).toHaveBeenCalledWith({
      ownerScope: "cli:test-host",
    });
  });

  it("removes one account through the facade in the requested owner scope", async () => {
    const facade = {
      removeAccount: vi.fn().mockResolvedValue({
        accountId: "acct-codex",
        removed: true,
      }),
    };

    await expect(removeAccountViaFacade("acct-codex", {
      facade: facade as never,
      ownerScope: "cli:test-host",
    })).resolves.toEqual({ accountId: "acct-codex", removed: true });
    expect(facade.removeAccount).toHaveBeenCalledWith("acct-codex", {
      ownerScope: "cli:test-host",
    });
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

describe("isolated gateway state", () => {
  it("keeps an isolated gateway's PID, metadata, and log out of the live state root", async () => {
    const stateDir = join(SCRATCH, "isolated-state");
    const liveLog = join(SCRATCH, "would-be-live.log");
    const unref = vi.fn();
    const realExistsSync = vi.mocked(existsSync).getMockImplementation()!;
    vi.mocked(existsSync).mockImplementation((path) =>
      path === gatewayScriptPath() || realExistsSync(path),
    );
    vi.mocked(spawn).mockReturnValue({ pid: 43210, unref } as never);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return new Response(null, { status: 200 });
      return new Response(JSON.stringify({ gatewayToken: "gw-isolated" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }));

    await expect(startGateway({ port: 32109, logFile: liveLog }, {
      stateDir,
      clientSessionId: "claude-uat",
    })).resolves.toEqual({ pid: 43210, port: 32109, gatewayToken: "gw-isolated" });

    expect(readFileSync(llmMeshPidPath(stateDir), "utf8")).toBe("43210\n");
    expect(JSON.parse(readFileSync(llmMeshTokenPath(stateDir), "utf8"))).toEqual({
      baseUrl: "http://localhost:32109",
      pid: 43210,
    });
    expect(existsSync(llmMeshLogPath(undefined, stateDir))).toBe(true);
    expect(existsSync(liveLog)).toBe(false);
    expect(unref).toHaveBeenCalledOnce();
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
