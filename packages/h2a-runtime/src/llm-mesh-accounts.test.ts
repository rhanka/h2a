import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLlmMeshFacade,
  type LlmMeshFacade,
} from "@sentropic/cluster-mesh/llm-mesh/facade";
import { InMemoryKeyring } from "@sentropic/cluster-mesh/llm-mesh/node";

import { readLlmMeshConfig, writeLlmMeshConfig } from "./gateway-host/config-file.js";
import {
  acquireLlmMeshSessionEnv,
  gatewayScriptPath,
  llmMeshLogPath,
  llmMeshPidPath,
  llmMeshTokenPath,
  replaceAnthropicGatewayEnvironment,
  startGateway,
} from "./gateway-host/daemon.js";
import {
  enrollViaFacade,
  formatLlmMeshAccountList,
  formatLlmMeshAccountError,
  listAccountsViaFacade,
  removeAccountViaFacade,
} from "./llm-mesh-accounts.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const SCRATCH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "accounts",
);

beforeEach(() => mkdirSync(SCRATCH, { recursive: true }));

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("opens the Mistral Vibe sign-in URL and polls the facade (mistral-vibe)", async () => {
    // The Mistral Vibe native browser sign-in: start() returns the console
    // sign-in URL (authorization-url) but completion is POLL-based — the
    // provider polls its sign-in process internally, so there is no OAuth
    // callback leg for waitForCallback to catch.
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-mistral-vibe",
        url: "https://console.mistral.ai/codestral/cli/authenticate?process_id=p1",
        expiresAt: "2026-10-08T01:00:00.000Z",
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn().mockResolvedValue({
        accountId: "account-mistral-vibe",
        label: "Mistral Vibe (Pro plan)",
      }),
    } as unknown as LlmMeshFacade;
    const openBrowser = vi.fn();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("mistral-vibe", {
      facade,
      openBrowser,
      configRef: "config-v1",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1",
    })).resolves.toEqual({
      accountId: "account-mistral-vibe",
      provider: "mistral-vibe",
      label: "Mistral Vibe (Pro plan)",
    });

    expect(facade.enroll).toHaveBeenCalledWith("mistral-vibe", {
      configRef: "config-v1",
      mode: "cli",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1",
    });
    expect(openBrowser).toHaveBeenCalledWith(
      "https://console.mistral.ai/codestral/cli/authenticate?process_id=p1",
    );
    expect(facade.pollForCompletion).toHaveBeenCalledWith("enroll-mistral-vibe");
    expect(facade.waitForCallback).not.toHaveBeenCalled();
  });

  it("rejects a mistral-vibe session that is not an authorization URL", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "device-code",
        enrollmentId: "enroll-mistral-vibe-bad",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.example/device",
        expiresAt: "2026-10-08T01:00:00.000Z",
        intervalSeconds: 5,
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn(),
    } as unknown as LlmMeshFacade;
    const openBrowser = vi.fn();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("mistral-vibe", {
      facade,
      openBrowser,
      configRef: "config-v1",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1",
    })).rejects.toThrow(/Mistral Vibe enrollment did not return a sign-in URL/);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(facade.pollForCompletion).not.toHaveBeenCalled();
  });

  it("enrolls muse via the OAuth device flow by default (mesh-side id muse-code)", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "device-code",
        enrollmentId: "enroll-muse-code",
        userCode: "WXYZ-1234",
        verificationUrl: "https://auth.meta.com/device",
        expiresAt: "2026-08-07T01:00:00.000Z",
        intervalSeconds: 5,
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn(),
      completeMuseDeviceImport: vi.fn().mockResolvedValue({
        accountId: "account-muse-code",
        label: "Muse",
      }),
    } as unknown as LlmMeshFacade;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("muse", {
      facade,
      ownerScope: "cli:test-host",
    })).resolves.toEqual({
      accountId: "account-muse-code",
      provider: "muse",
      label: "Muse",
    });
    // OAuth is the default: the facade session starts under the historical
    // mesh-side provider id, but the user-facing provider stays "muse".
    expect(facade.enroll).toHaveBeenCalledWith("muse-code", {
      configRef: "default",
      mode: "cli",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1",
    });
    expect(facade.completeMuseDeviceImport).toHaveBeenCalledWith(
      "enroll-muse-code",
      "cli:test-host",
    );
    // The generic poll is hard-wired to the codex provider mesh-side and
    // must never receive a muse enrollment id.
    expect(facade.pollForCompletion).not.toHaveBeenCalled();
    expect(facade.waitForCallback).not.toHaveBeenCalled();
  });

  it("fails closed when the facade predates Muse device-flow support", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "device-code",
        enrollmentId: "enroll-muse-code",
        userCode: "WXYZ-1234",
        verificationUrl: "https://auth.meta.com/device",
        expiresAt: "2026-08-07T01:00:00.000Z",
        intervalSeconds: 5,
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn(),
    } as unknown as LlmMeshFacade;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("muse", { facade })).rejects.toThrow(
      "completeMuseDeviceImport",
    );
  });

  it("completes a Muse CLI-store import without browser or device round-trip (--cli)", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "local-import",
        enrollmentId: "enroll-muse",
        source: "muse-cli-auth-file",
        expiresAt: "2026-08-07T01:00:00.000Z",
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn(),
      completeMuseImport: vi.fn().mockResolvedValue({
        accountId: "acct_muse_abc123",
        label: "Muse (owner@example.com)",
      }),
    } as unknown as LlmMeshFacade;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("muse", {
      facade,
      ownerScope: "cli:test-host",
      cliImport: true,
    })).resolves.toEqual({
      accountId: "acct_muse_abc123",
      provider: "muse",
      label: "Muse (owner@example.com)",
    });

    expect(facade.enroll).toHaveBeenCalledWith("muse", {
      configRef: "default",
      mode: "cli",
      ownerScope: "cli:test-host",
      redirectUri: "http://127.0.0.1",
    });
    expect(facade.completeMuseImport).toHaveBeenCalledWith(
      "enroll-muse",
      "cli:test-host",
      "cli:test-host",
    );
    expect(facade.waitForCallback).not.toHaveBeenCalled();
    expect(facade.pollForCompletion).not.toHaveBeenCalled();
  });

  it("rejects --cli for providers without a local CLI-store import", async () => {
    const facade = {
      enroll: vi.fn(),
    } as unknown as LlmMeshFacade;
    await expect(enrollViaFacade("codex", { facade, cliImport: true })).rejects.toThrow(
      /codex.*no CLI-store import.*--cli.*muse/,
    );
    await expect(enrollViaFacade("mistral-vibe", { facade, cliImport: true })).rejects.toThrow(
      /mistral-vibe.*no CLI-store import.*--cli.*muse/,
    );
    expect(facade.enroll).not.toHaveBeenCalled();
  });

  it("fails closed when the facade predates Muse import support", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "local-import",
        enrollmentId: "enroll-muse",
        source: "muse-cli-auth-file",
        expiresAt: "2026-08-07T01:00:00.000Z",
      }),
      waitForCallback: vi.fn(),
      pollForCompletion: vi.fn(),
    } as unknown as LlmMeshFacade;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("muse", { facade, cliImport: true })).rejects.toThrow(
      "completeMuseImport",
    );
  });

  // llm-mesh 0.19 prerequisite (bumped from 0.17): Cloud Code acquisition now
  // REQUIRES `cloudaicompanionProject` — fetchAvailableModels throws on an empty
  // project where 0.17 tolerated its absence. That throw is raised inside the
  // sentropic-owned facade during callback/acquisition, and the full real path only
  // fires behind a live Google OAuth loopback callback, i.e. a real account (the
  // sentropic-side Antigravity enrollment fix is that prerequisite). We cannot drive
  // the real throw here without an account — a written limit, not a workaround. What
  // we DO own and pin is that our wrapper never SWALLOWS the failure: the operator
  // must see it, not receive a bogus account. This is the red arm; the green arm is
  // "waits for Cloud Code callback without receiving provider credentials" above.
  it("surfaces a Cloud Code acquisition failure instead of masking it (0.19 cloudaicompanionProject prerequisite)", async () => {
    const prerequisite = new Error(
      "Cloud Code fetchAvailableModels requires cloudaicompanionProject",
    );
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-cloud",
        url: "https://accounts.example/authorize",
        expiresAt: "2026-08-07T01:00:00.000Z",
      }),
      waitForCallback: vi.fn().mockRejectedValue(prerequisite),
      pollForCompletion: vi.fn(),
    } as unknown as LlmMeshFacade;
    const openBrowser = vi.fn();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(enrollViaFacade("cloud-code", { facade, openBrowser }))
      .rejects.toThrow("Cloud Code fetchAvailableModels requires cloudaicompanionProject");
    // The failure fired at the acquisition step, AFTER the browser was opened — it is
    // the callback/acquisition that surfaces it, not a pre-flight guard we added.
    expect(openBrowser).toHaveBeenCalledWith("https://accounts.example/authorize");
    expect(facade.waitForCallback).toHaveBeenCalledWith("enroll-cloud");
  });

});

describe("facade account administration", () => {
  it("keeps unexpected facade errors free of paths and credentials", () => {
    const poisoned = new Error(
      "ENOTDIR: /home/private/.sentropic/llm-mesh-keyring/access-token.json",
    );

    expect(formatLlmMeshAccountError(poisoned, "account inventory unavailable"))
      .toBe("account inventory unavailable");
    expect(formatLlmMeshAccountError(poisoned, "account removal failed"))
      .toBe("account removal failed");
    expect(formatLlmMeshAccountError(
      new Error("Account 'acct-codex_1' not found"),
      "account removal failed",
    )).toBe("Account 'acct-codex_1' not found");
  });

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

  it("renders stable public JSON and table projections without extra fields", () => {
    const accounts = [{
      accountId: "acct-codex",
      providerId: "codex",
      accountLabel: "Codex local",
      status: "active",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T11:00:00.000Z",
      accessToken: "must-not-leak",
    }];

    const json = formatLlmMeshAccountList(accounts, true);
    expect(JSON.parse(json)).toEqual([{
      accountId: "acct-codex",
      providerId: "codex",
      accountLabel: "Codex local",
      status: "active",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T11:00:00.000Z",
    }]);
    expect(json).not.toContain("must-not-leak");

    const table = formatLlmMeshAccountList(accounts, false);
    expect(table).toContain("ID");
    expect(table).toContain("PROVIDER");
    expect(table).toContain("LABEL");
    expect(table).toContain("STATUS");
    expect(table).toContain("ENROLLED");
    expect(table).toContain("acct-codex");
    expect(table).not.toContain("must-not-leak");
  });

  it("exercises enroll, owner-scoped inventory, removal, and ineligibility through the public facade", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/api/accounts/deviceauth/usercode")) {
        return new Response(JSON.stringify({
          device_auth_id: "device-auth-1",
          user_code: "ABCD-EFGH",
          interval: 0,
        }), { status: 200 });
      }
      if (url.endsWith("/api/accounts/deviceauth/token")) {
        return new Response(JSON.stringify({
          authorization_code: "authorization-code-1",
          code_verifier: "code-verifier-1",
        }), { status: 200 });
      }
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({
          access_token: "fixture-access-token",
          refresh_token: "fixture-refresh-token",
          expires_in: 3600,
        }), { status: 200 });
      }
      throw new Error(`unexpected fixture URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const facade = createLlmMeshFacade({
      configResolver: { async resolveConfig() { return {}; } },
      keyring: new InMemoryKeyring(),
      mode: "cli",
    });
    const enrollment = await facade.enroll("codex", {
      configRef: "config-v1",
      mode: "cli",
      ownerScope: "cli:owner-a",
      redirectUri: "http://127.0.0.1/callback",
    });
    const completed = await facade.pollForCompletion(enrollment.enrollmentId);

    const owned = await facade.listAccounts({ ownerScope: "cli:owner-a" });
    expect(owned).toHaveLength(1);
    expect(owned[0]?.accountId).toBe(completed.accountId);
    expect(JSON.stringify(owned)).not.toContain("fixture-access-token");
    await expect(facade.listAccounts({ ownerScope: "cli:owner-b" }))
      .resolves.toEqual([]);
    await expect(facade.removeAccount(completed.accountId, {
      ownerScope: "cli:owner-b",
    })).rejects.toThrow(`Account '${completed.accountId}' not found`);

    await expect(facade.removeAccount(completed.accountId, {
      ownerScope: "cli:owner-a",
    })).resolves.toEqual({ accountId: completed.accountId, removed: true });
    await expect(facade.listAccounts({ ownerScope: "cli:owner-a" }))
      .resolves.toEqual([]);
    await expect(facade.acquire({
      ownerScopeRef: "cli:owner-a",
      targetProviderId: "openai",
      transportProviderId: "codex",
    })).rejects.toThrow("No active codex account transport for openai");
  });
});

