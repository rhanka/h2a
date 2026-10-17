import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLlmMeshFacade,
  type LlmMeshFacade,
} from "@sentropic/cluster-mesh/llm-mesh/facade";
import { InMemoryKeyring } from "@sentropic/cluster-mesh/llm-mesh/node";
import { EncryptedFileKeyring } from "@sentropic/cluster-mesh/llm-mesh/node";

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
  readClaudeCliStoreCredential,
  removeAccountViaFacade,
  resolveEnrollmentMode,
  sanitizeClaudeEnrollmentError,
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

describe("claude-code enrollment", () => {
  it("dispatches browser enrollment with exact empty redirect and claude-code profile", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-claude-1",
        url: "https://claude.com/cai/oauth/authorize?state=xyz",
        expiresAt: "2026-10-12T20:00:00.000Z",
      }),
      completeClaudeEnrollment: vi.fn().mockResolvedValue({
        accountId: "acct_claude_123",
        label: "Claude (test@example.com)",
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    } as unknown as LlmMeshFacade;

    const openBrowser = vi.fn();
    const readInput = vi.fn().mockResolvedValue("code123#xyz");
    let stdoutData = "";
    vi.spyOn(process.stdout, "write").mockImplementation((str) => {
      stdoutData += String(str);
      return true;
    });

    const result = await enrollViaFacade("claude-code", {
      facade,
      openBrowser,
      readInput,
      ownerScope: "cli:test-host",
    });

    expect(result).toEqual({
      accountId: "acct_claude_123",
      provider: "claude-code",
      label: "Claude (test@example.com)",
    });

    expect(facade.enroll).toHaveBeenCalledWith("claude-code", {
      configRef: "claude-code",
      mode: "cli",
      ownerScope: "cli:test-host",
      redirectUri: "",
    });
    expect(openBrowser).toHaveBeenCalledWith(
      "https://claude.com/cai/oauth/authorize?state=xyz",
    );
    expect(stdoutData).not.toContain("https://claude.com");
    expect(stdoutData).not.toContain("code123#xyz");
    expect(readInput).toHaveBeenCalled();
    expect(facade.completeClaudeEnrollment).toHaveBeenCalledWith(
      "enroll-claude-1",
      "code123#xyz",
      "cli:test-host",
    );
  });

  it("fails closed when facade lacks completeClaudeEnrollment before secret input", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-claude-1",
        url: "https://claude.com/cai/oauth/authorize?state=xyz",
      }),
    } as unknown as LlmMeshFacade;

    const readInput = vi.fn();

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        readInput,
        ownerScope: "cli:test-host",
      }),
    ).rejects.toThrow(
      /Claude enrollment requires facade\.completeClaudeEnrollment/,
    );

    expect(readInput).not.toHaveBeenCalled();
  });

  it("cancels enrollment session if input collection is cancelled", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-claude-cancel",
        url: "https://claude.com/cai/oauth/authorize",
      }),
      completeClaudeEnrollment: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    } as unknown as LlmMeshFacade;

    const readInput = vi.fn().mockRejectedValue(new Error("Claude enrollment cancelled"));

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        readInput,
        ownerScope: "cli:test-host",
      }),
    ).rejects.toThrow("Claude enrollment cancelled");

    expect(facade.cancel).toHaveBeenCalledWith("enroll-claude-cancel");
    expect(facade.completeClaudeEnrollment).not.toHaveBeenCalled();
  });

  it("cancels enrollment session if completion fails", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-claude-err",
        url: "https://claude.com/cai/oauth/authorize",
      }),
      completeClaudeEnrollment: vi.fn().mockRejectedValue(new Error("invalid_grant")),
      cancel: vi.fn().mockResolvedValue(undefined),
    } as unknown as LlmMeshFacade;

    const readInput = vi.fn().mockResolvedValue("bad-code#state");

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        readInput,
        ownerScope: "cli:test-host",
      }),
    ).rejects.toThrow();

    expect(facade.cancel).toHaveBeenCalledWith("enroll-claude-err");
  });

  it("rejects session that is not authorization-url", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "device-code",
        enrollmentId: "enroll-claude-bad",
      }),
      completeClaudeEnrollment: vi.fn(),
    } as unknown as LlmMeshFacade;

    const readInput = vi.fn();

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        readInput,
        ownerScope: "cli:test-host",
      }),
    ).rejects.toThrow("Claude enrollment did not return an authorization URL");

    expect(readInput).not.toHaveBeenCalled();
  });

  it("completes renewable credential import without starting browser or polling", async () => {
    const facade = {
      completeClaudeCredentialImport: vi.fn().mockResolvedValue({
        accountId: "acct_claude_import_1",
        label: "Claude (imported)",
      }),
      enroll: vi.fn(),
      pollForCompletion: vi.fn(),
      waitForCallback: vi.fn(),
    } as unknown as LlmMeshFacade;

    const fakeJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: 1800000000000,
        scopes: ["user:inference"],
      },
    });

    const openBrowser = vi.fn();
    const readInput = vi.fn().mockResolvedValue(fakeJson);

    const result = await enrollViaFacade("claude-code", {
      facade,
      tokenImport: true,
      openBrowser,
      readInput,
      ownerScope: "cli:test-host",
    });

    expect(result).toEqual({
      accountId: "acct_claude_import_1",
      provider: "claude-code",
      label: "Claude (imported)",
    });

    expect(facade.enroll).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
    expect(facade.pollForCompletion).not.toHaveBeenCalled();
    expect(facade.waitForCallback).not.toHaveBeenCalled();
    expect(readInput).toHaveBeenCalledWith(
      expect.stringContaining("paste renewable credential JSON"),
      { multiline: true },
    );
    expect(facade.completeClaudeCredentialImport).toHaveBeenCalledWith(
      fakeJson,
      "cli:test-host",
    );
  });

  it("fails closed when facade lacks completeClaudeCredentialImport before input", async () => {
    const facade = {
      enroll: vi.fn(),
    } as unknown as LlmMeshFacade;

    const readInput = vi.fn();

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        tokenImport: true,
        readInput,
        ownerScope: "cli:test-host",
      }),
    ).rejects.toThrow(
      /Claude credential import requires facade\.completeClaudeCredentialImport/,
    );

    expect(readInput).not.toHaveBeenCalled();
  });

  it("rejects blank or whitespace ownerScope before secret collection", async () => {
    const facade = {
      completeClaudeEnrollment: vi.fn(),
      completeClaudeCredentialImport: vi.fn(),
      enroll: vi.fn(),
    } as unknown as LlmMeshFacade;
    const readInput = vi.fn();

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        readInput,
        ownerScope: "   ",
      }),
    ).rejects.toThrow("ownerScope is required and cannot be blank");

    expect(readInput).not.toHaveBeenCalled();
    expect(facade.enroll).not.toHaveBeenCalled();
  });

  it("rejects incompatible flag combinations", async () => {
    const facade = {
      completeClaudeEnrollment: vi.fn(),
      completeClaudeCredentialImport: vi.fn(),
      enroll: vi.fn(),
    } as unknown as LlmMeshFacade;

    await expect(
      enrollViaFacade("codex", { facade, cliImport: true }),
    ).rejects.toThrow(/codex.*no CLI-store import.*muse, claude-code/);

    await expect(
      enrollViaFacade("muse", { facade, tokenImport: true }),
    ).rejects.toThrow(/--token\/--from token is only valid for claude-code/);

    await expect(
      enrollViaFacade("codex", { facade, from: "token" }),
    ).rejects.toThrow(/--token\/--from token is only valid for claude-code/);

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        cliImport: true,
        tokenImport: true,
      }),
    ).rejects.toThrow(/--cli and --token cannot be combined/);

    await expect(
      enrollViaFacade("claude-code", { facade, from: "cli", cliImport: true }),
    ).rejects.toThrow(/--from cannot be combined with --cli/);

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        from: "bogus" as never,
      }),
    ).rejects.toThrow(/--from must be one of oauth, cli, token/);
  });

  it("resolves the canonical --from selector and legacy booleans to one mode", () => {
    expect(resolveEnrollmentMode({})).toBe("oauth");
    expect(resolveEnrollmentMode({ from: "oauth" })).toBe("oauth");
    expect(resolveEnrollmentMode({ from: "cli" })).toBe("cli");
    expect(resolveEnrollmentMode({ from: "token" })).toBe("token");
    expect(resolveEnrollmentMode({ cliImport: true })).toBe("cli");
    expect(resolveEnrollmentMode({ tokenImport: true })).toBe("token");
    expect(() =>
      resolveEnrollmentMode({ from: "cli", tokenImport: true }),
    ).toThrow(/--from cannot be combined/);
    expect(() =>
      resolveEnrollmentMode({ cliImport: true, tokenImport: true }),
    ).toThrow(/--cli and --token cannot be combined/);
  });

  it("never echoes --from values in errors (m4 canary)", () => {
    const canary = "canary-from-value-9f8e7d6c5b";
    let message = "";
    try {
      resolveEnrollmentMode({ from: canary as never });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe("--from must be one of oauth, cli, token");
    expect(message).not.toContain(canary);
  });

  it("validates H2A_LLM_MESH_CONFIG_JSON for claude-code and refuses malformed JSON", async () => {
    const facade = {
      completeClaudeEnrollment: vi.fn(),
      enroll: vi.fn(),
    } as unknown as LlmMeshFacade;

    process.env.H2A_LLM_MESH_CONFIG_JSON = "malformed { json string";

    await expect(
      enrollViaFacade("claude-code", { facade, ownerScope: "cli:test-host" }),
    ).rejects.toThrow("Invalid H2A_LLM_MESH_CONFIG_JSON: configuration must be valid JSON");

    // Scoped test: non-Claude provider ignores malformed config and collapses to {}
    const codexFacade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "device-code",
        enrollmentId: "enroll-1",
        userCode: "1234",
        verificationUrl: "https://auth.example",
      }),
      pollForCompletion: vi.fn().mockResolvedValue({
        accountId: "acct-1",
        label: "Codex",
      }),
    } as unknown as LlmMeshFacade;

    await expect(
      enrollViaFacade("codex", { facade: codexFacade, ownerScope: "cli:test-host" }),
    ).resolves.toBeDefined();

    delete process.env.H2A_LLM_MESH_CONFIG_JSON;
  });

  it("persists Claude account across restart using EncryptedFileKeyring and enforces owner isolation", async () => {
    const keyringDir = join(SCRATCH, "isolated-keyring");
    mkdirSync(keyringDir, { recursive: true });

    const createIsolatedFacade = (owner: string) => {
      return createLlmMeshFacade({
        configResolver: { async resolveConfig() { return {}; } },
        keyring: new EncryptedFileKeyring(keyringDir),
        mode: "cli",
        legacyAccountOwnerScopeRef: owner,
      });
    };

    const facade1 = createIsolatedFacade("cli:claude-owner-1");
    const validJson = JSON.stringify({
      claudeAiOauth: {
        accessToken: "valid-access-token-1",
        refreshToken: "valid-refresh-token-1",
        expiresAt: Date.now() + 3600000,
        scopes: ["user:inference", "user:profile"],
      },
    });

    const enrolled = await facade1.completeClaudeCredentialImport!(
      validJson,
      "cli:claude-owner-1",
    );
    expect(enrolled.accountId).toMatch(/^acct_claude_/);

    // Restart: simulate by creating a new facade instance pointing to same keyringDir
    const facadeRestarted = createIsolatedFacade("cli:claude-owner-1");
    const accounts = await facadeRestarted.listAccounts({
      ownerScope: "cli:claude-owner-1",
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.accountId).toBe(enrolled.accountId);
    expect(accounts[0]?.providerId).toBe("claude-code");
    expect(JSON.stringify(accounts)).not.toContain("valid-access-token-1");
    expect(JSON.stringify(accounts)).not.toContain("valid-refresh-token-1");

    // Foreign owner isolation: foreign owner cannot see or remove account
    const foreignFacade = createIsolatedFacade("cli:foreign-owner");
    const foreignAccounts = await foreignFacade.listAccounts({
      ownerScope: "cli:foreign-owner",
    });
    expect(foreignAccounts).toHaveLength(0);

    await expect(
      foreignFacade.removeAccount(enrolled.accountId, {
        ownerScope: "cli:foreign-owner",
      }),
    ).rejects.toThrow(`Account '${enrolled.accountId}' not found`);

    // Duplicate import refusal for same owner
    await expect(
      facadeRestarted.completeClaudeCredentialImport!(
        validJson,
        "cli:claude-owner-1",
      ),
    ).rejects.toThrow();

    // Owner removal succeeds
    await expect(
      facadeRestarted.removeAccount(enrolled.accountId, {
        ownerScope: "cli:claude-owner-1",
      }),
    ).resolves.toEqual({ accountId: enrolled.accountId, removed: true });

    const accountsAfterRemoval = await facadeRestarted.listAccounts({
      ownerScope: "cli:claude-owner-1",
    });
    expect(accountsAfterRemoval).toHaveLength(0);
  });
});

describe("claude-code import modes (--from cli|token)", () => {
  const CANARY_ACCESS = "canary-access-token-9f8e7d";
  const CANARY_REFRESH = "canary-refresh-token-1a2b3c";

  function writeStore(home: string, content: string): void {
    const dir = join(home, ".claude");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.json"), content);
  }

  function storeHome(name: string): string {
    const home = join(SCRATCH, name);
    mkdirSync(home, { recursive: true });
    return home;
  }

  function credentialImportFacade() {
    return {
      completeClaudeCredentialImport: vi.fn().mockResolvedValue({
        accountId: "acct_claude_import_2",
        label: "Claude (imported)",
      }),
      enroll: vi.fn(),
    } as unknown as LlmMeshFacade;
  }

  it("imports from the official CLI store without browser or prompt (--from cli)", async () => {
    const home = storeHome("cli-home");
    const stored = JSON.stringify({
      claudeAiOauth: {
        accessToken: CANARY_ACCESS,
        refreshToken: CANARY_REFRESH,
        expiresAt: 1800000000000,
        scopes: ["user:inference"],
      },
    });
    writeStore(home, stored);
    const facade = credentialImportFacade();
    const readInput = vi.fn();

    const result = await enrollViaFacade("claude-code", {
      facade,
      from: "cli",
      cliStoreHome: home,
      readInput,
      ownerScope: "cli:test-host",
    });

    expect(result).toEqual({
      accountId: "acct_claude_import_2",
      provider: "claude-code",
      label: "Claude (imported)",
    });
    expect(facade.enroll).not.toHaveBeenCalled();
    expect(readInput).not.toHaveBeenCalled();
    expect(facade.completeClaudeCredentialImport).toHaveBeenCalledWith(
      stored,
      "cli:test-host",
    );
  });

  it("treats legacy --cli as --from cli for claude-code", async () => {
    const home = storeHome("cli-legacy-home");
    const stored = JSON.stringify({
      accessToken: CANARY_ACCESS,
      refreshToken: CANARY_REFRESH,
      expiresAt: 1800000000000,
      scopes: ["user:inference"],
    });
    writeStore(home, stored);
    const facade = credentialImportFacade();

    const result = await enrollViaFacade("claude-code", {
      facade,
      cliImport: true,
      cliStoreHome: home,
      ownerScope: "cli:test-host",
    });

    expect(result.provider).toBe("claude-code");
    expect(facade.completeClaudeCredentialImport).toHaveBeenCalledWith(
      stored,
      "cli:test-host",
    );
  });

  it("treats --from token and legacy --token as the token import leg", async () => {
    for (const options of [{ from: "token" as const }, { tokenImport: true }]) {
      const facade = credentialImportFacade();
      const fakeJson = JSON.stringify({
        claudeAiOauth: {
          accessToken: CANARY_ACCESS,
          refreshToken: CANARY_REFRESH,
          expiresAt: 1800000000000,
          scopes: ["user:inference"],
        },
      });
      const result = await enrollViaFacade("claude-code", {
        facade,
        ...options,
        readInput: vi.fn().mockResolvedValue(fakeJson),
        ownerScope: "cli:test-host",
      });
      expect(result.provider).toBe("claude-code");
      expect(facade.completeClaudeCredentialImport).toHaveBeenCalledWith(
        fakeJson,
        "cli:test-host",
      );
    }
  });

  it("fails closed on a missing store without leaking anything", async () => {
    const home = storeHome("cli-missing-home");
    const facade = credentialImportFacade();

    await expect(
      enrollViaFacade("claude-code", {
        facade,
        from: "cli",
        cliStoreHome: home,
        ownerScope: "cli:test-host",
      }),
    ).rejects.toThrow(/Claude CLI store not found/);
    expect(facade.completeClaudeCredentialImport).not.toHaveBeenCalled();
    expect(facade.enroll).not.toHaveBeenCalled();
  });

  it("refuses non-renewable or malformed store documents with static errors", async () => {
    const facade = credentialImportFacade();
    const cases: Array<[string, string]> = [
      ["garbage", "not json at all {{{"],
      ["access-only", JSON.stringify({ claudeAiOauth: { accessToken: CANARY_ACCESS } })],
      ["empty", "   \n  "],
    ];
    for (const [name, content] of cases) {
      const home = storeHome(`cli-bad-${name}`);
      writeStore(home, content);
      await expect(
        enrollViaFacade("claude-code", {
          facade,
          from: "cli",
          cliStoreHome: home,
          ownerScope: "cli:test-host",
        }),
        name,
      ).rejects.toThrow(/Claude CLI store holds no renewable credential/);
    }
    expect(facade.completeClaudeCredentialImport).not.toHaveBeenCalled();
  });

  it("reads the store shape directly and never surfaces canary material", async () => {
    const home = storeHome("cli-shape-home");
    const stored = JSON.stringify({
      claudeAiOauth: {
        accessToken: CANARY_ACCESS,
        refreshToken: CANARY_REFRESH,
        expiresAt: 1800000000000,
        scopes: ["user:inference"],
        extraField: "ignored",
      },
    });
    writeStore(home, stored);
    expect(await readClaudeCliStoreCredential(home)).toBe(stored);

    const missing = await readClaudeCliStoreCredential(
      join(SCRATCH, "definitely-absent-home"),
    ).catch((err: unknown) => String(err));
    expect(missing).toContain("Claude CLI store not found");
    expect(missing).not.toContain(CANARY_ACCESS);
    expect(missing).not.toContain(CANARY_REFRESH);
  });

  it("selects the muse CLI-store leg through --from cli like --cli", async () => {
    const facade = {
      enroll: vi.fn().mockResolvedValue({
        kind: "local-import",
        enrollmentId: "enroll-muse-from",
        source: "muse-cli-auth-file",
        expiresAt: "2026-08-07T01:00:00.000Z",
      }),
      completeMuseImport: vi.fn().mockResolvedValue({
        accountId: "acct_muse_from",
        label: "Muse (owner@example.com)",
      }),
    } as unknown as LlmMeshFacade;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      enrollViaFacade("muse", {
        facade,
        ownerScope: "cli:test-host",
        from: "cli",
      }),
    ).resolves.toEqual({
      accountId: "acct_muse_from",
      provider: "muse",
      label: "Muse (owner@example.com)",
    });
    expect(facade.completeMuseImport).toHaveBeenCalled();
  });
});

describe("claude browser opener", () => {
  const authUrl = "https://claude.com/cai/oauth/authorize?state=secret-state";
  const claudeFacade = () =>
    ({
      enroll: vi.fn().mockResolvedValue({
        kind: "authorization-url",
        enrollmentId: "enroll-claude-browser",
        url: authUrl,
      }),
      completeClaudeEnrollment: vi.fn().mockResolvedValue({
        accountId: "acct_claude_browser",
        label: "Claude",
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    }) as unknown as LlmMeshFacade;

  it("skips the argv exposure with H2A_NO_BROWSER, prints URL, and still completes", async () => {
    vi.mocked(spawn).mockClear();
    vi.stubEnv("H2A_NO_BROWSER", "1");
    let stdoutOutput = "";
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((str) => {
      stdoutOutput += String(str);
      return true;
    });
    try {
      const result = await enrollViaFacade("claude-code", {
        facade: claudeFacade(),
        readInput: vi.fn().mockResolvedValue("code123#xyz"),
        ownerScope: "cli:test-host",
      });
      expect(result.accountId).toBe("acct_claude_browser");
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
      expect(stdoutOutput).toContain(authUrl);
      expect(stdoutOutput).toContain("browser launch skipped (H2A_NO_BROWSER=1)");
    } finally {
      stdoutSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("handles a missing opener asynchronously without leaking spawnargs", async () => {
    vi.stubEnv("H2A_NO_BROWSER", "");
    const openerChild = new EventEmitter() as EventEmitter & { unref: () => void };
    openerChild.unref = vi.fn();
    vi.mocked(spawn).mockReturnValueOnce(openerChild as never);
    try {
      const result = await enrollViaFacade("claude-code", {
        facade: claudeFacade(),
        readInput: vi.fn().mockResolvedValue("code123#xyz"),
        ownerScope: "cli:test-host",
      });
      expect(result.accountId).toBe("acct_claude_browser");
      // The async spawn failure path is listened to: no crash, no URL dump.
      expect(openerChild.listenerCount("error")).toBe(1);
      openerChild.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { spawnargs: [authUrl] }));
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("claude enrollment error boundary", () => {
  it("keeps allowlisted static errors and collapses everything else", () => {
    expect(
      sanitizeClaudeEnrollmentError(new Error("Claude enrollment cancelled")).message,
    ).toBe("Claude enrollment cancelled");
  });

  it("never surfaces mesh dynamic text carrying token fragments", () => {
    const leaked = new Error(
      "mesh store expired for user:inference: oauth_token sk-ant-canary " +
        "https://auth.example/token?code=secret /var/lib/mesh/keyring.json " +
        "Duplicate enrollment not found",
    );
    const sanitized = sanitizeClaudeEnrollmentError(leaked);
    expect(sanitized.message).toBe("Claude enrollment failed");
    expect(sanitized.message).not.toContain("sk-ant-canary");
    expect(sanitized.message).not.toContain("auth.example");
  });

  it("keeps the import-mode static errors and collapses store-shaped leaks", () => {
    expect(
      sanitizeClaudeEnrollmentError(
        new Error("Claude CLI store not found at /tmp/home/.claude/.credentials.json (run the official Claude CLI login first, or enroll with OAuth)"),
      ).message,
    ).toContain("Claude CLI store not found");
    expect(
      sanitizeClaudeEnrollmentError(
        new Error("Claude token entry received empty input"),
      ).message,
    ).toBe("Claude token entry received empty input");
    const leaked = new Error(
      'import failed: {"claudeAiOauth":{"accessToken":"sk-ant-canary-store"}}',
    );
    const sanitized = sanitizeClaudeEnrollmentError(leaked);
    expect(sanitized.message).toBe("Claude enrollment failed");
    expect(sanitized.message).not.toContain("sk-ant-canary-store");
  });
});

