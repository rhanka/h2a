/** Account enrollment and public CLI presentation through cluster-mesh. */
import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { createLlmMeshFacade, type LlmMeshAdministrativeFacade, type LlmMeshFacade } from "@sentropic/cluster-mesh/llm-mesh/facade";
import type { AccountPublic } from "@sentropic/cluster-mesh/llm-mesh/enrollment";

export interface LlmMeshEnrollmentAccount {
  accountId: string;
  provider: "cloud-code" | "codex" | "muse" | "muse-code";
  label: string;
}

/**
 * Structural extension for facades that implement Muse CLI-store import
 * (MuseEnrollmentProvider mesh-side, BR75). Declared structurally — not taken
 * from @sentropic/cluster-mesh/llm-mesh types — so h2a keeps working against older
 * facades; the runtime guard below fails closed when the method is absent
 * instead of throwing a bare TypeError.
 */
export interface LlmMeshFacadeWithMuseImport extends LlmMeshFacade {
  completeMuseImport(
    enrollmentId: string,
    code: string,
    ownerScopeRef: string,
  ): Promise<{ accountId: string; label: string }>;
  completeMuseDeviceImport(
    enrollmentId: string,
    ownerScopeRef: string,
    maxAttempts?: number,
  ): Promise<{ accountId: string; label: string }>;
}

export interface FacadeEnrollmentOptions {
  configRef?: string;
  ownerScope?: string;
  redirectUri?: string;
  /** Injection seam for CLI tests; production uses the opaque facade. */
  facade?: LlmMeshFacade;
  /** Injection seam that keeps enrollment tests from opening a real browser. */
  openBrowser?: (url: string) => void;
}

export interface FacadeAccountOptions {
  ownerScope?: string;
  /** Injection seam for account-administration tests. */
  facade?: Pick<LlmMeshAdministrativeFacade, "listAccounts" | "removeAccount">;
}

function facadeConfigResolver() {
  return {
    async resolveConfig(configRef: string): Promise<Record<string, unknown>> {
      const raw = process.env.H2A_LLM_MESH_CONFIG_JSON;
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const scoped = parsed[configRef];
        return scoped && typeof scoped === "object" && !Array.isArray(scoped)
          ? (scoped as Record<string, unknown>)
          : parsed;
      } catch {
        return {};
      }
    },
  };
}

export function createCliLlmMeshFacade(): LlmMeshAdministrativeFacade {
  return createLlmMeshFacade({
    configResolver: facadeConfigResolver(),
    mode: "cli",
    legacyAccountOwnerScopeRef: llmMeshOwnerScopeRef(),
  });
}

/** Stable local owner used both at enrollment and by gateway-authenticated routing. */
export function llmMeshOwnerScopeRef(): string {
  return process.env.H2A_LLM_MESH_OWNER_SCOPE?.trim() || `cli:${hostname()}`;
}

function openEnrollmentBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The URL is always printed, so a headless CLI can continue manually.
  }
}

/**
 * Enroll through the sentropic-owned OAuth state machine. H2A never receives
 * an authorization code or a provider token. Account records remain owned by
 * the facade/keyring and are not copied into h2a config.
 */
export async function enrollViaFacade(
  provider: "cloud-code" | "codex" | "muse" | "muse-code",
  options: FacadeEnrollmentOptions = {},
): Promise<LlmMeshEnrollmentAccount> {
  const facade = options.facade ?? createCliLlmMeshFacade();
  const ownerScope = options.ownerScope ?? llmMeshOwnerScopeRef();
  // The installed @sentropic/cluster-mesh/llm-mesh types predate the muse provider, but
  // enroll passes the id through opaquely — a muse-capable facade resolves
  // it, an older one fails with its own unknown-provider error. Cast is
  // load-bearing until the dep bump, not a lie about the contract.
  const session = await facade.enroll(provider as "codex", {
    configRef: options.configRef ?? process.env.H2A_LLM_MESH_CONFIG_REF ?? "default",
    mode: "cli",
    redirectUri: options.redirectUri ?? "http://127.0.0.1",
    ownerScope,
  });

  if (provider === "muse") {
    // Muse CLI-store import (BR75): no browser or device round-trip — the
    // owner act was the muse login itself. The ownerScope binds the enrolling
    // owner explicitly (never inferred); it doubles as the completion code
    // the mesh provider carries but does not validate.
    // Installed mesh types predate the local-import kind (same load-bearing
    // cast pattern as the enroll call above); runtime shape verified live.
    const museSession = session as unknown as {
      kind: string;
      source: string;
      enrollmentId: string;
    };
    if (museSession.kind !== "local-import") {
      throw new Error("Muse enrollment did not return a local-import session");
    }
    const completeMuseImport = (
      facade as Partial<LlmMeshFacadeWithMuseImport>
    ).completeMuseImport;
    if (typeof completeMuseImport !== "function") {
      throw new Error(
        "Muse enrollment needs facade.completeMuseImport — upgrade @sentropic/cluster-mesh/llm-mesh " +
        "to a version with the Muse enrollment provider",
      );
    }
    process.stdout.write(
      `[h2a] llm-mesh: importing Muse CLI credentials from ${museSession.source} for ${ownerScope}\n`,
    );
    const completed = await completeMuseImport.call(
      facade,
      museSession.enrollmentId,
      ownerScope,
      ownerScope,
    );
    return { accountId: completed.accountId, provider, label: completed.label };
  }

  if (provider === "muse-code") {
    // Native Meta device flow (RFC 8628, MuseCodeEnrollmentProvider
    // mesh-side): print the user code + verification URL, then complete via
    // the muse-specific device import — NOT the generic pollForCompletion,
    // which the mesh service hard-wires to the codex provider.
    const deviceSession = session as unknown as {
      kind: string;
      enrollmentId: string;
      userCode: string;
      verificationUrl: string;
    };
    if (deviceSession.kind !== "device-code") {
      throw new Error("Muse device-flow enrollment did not return a device code");
    }
    const completeMuseDeviceImport = (
      facade as Partial<LlmMeshFacadeWithMuseImport>
    ).completeMuseDeviceImport;
    if (typeof completeMuseDeviceImport !== "function") {
      throw new Error(
        "Muse device-flow enrollment needs facade.completeMuseDeviceImport — upgrade @sentropic/cluster-mesh/llm-mesh " +
        "to a version with the muse-code enrollment provider",
      );
    }
    process.stdout.write(
      `[h2a] llm-mesh: enter code ${deviceSession.userCode} at ${deviceSession.verificationUrl}\n`,
    );
    const completed = await completeMuseDeviceImport.call(
      facade,
      deviceSession.enrollmentId,
      ownerScope,
    );
    return { accountId: completed.accountId, provider, label: completed.label };
  }

  const completed = provider === "cloud-code"
    ? await (async () => {
        if (session.kind !== "authorization-url") {
          throw new Error("Cloud Code enrollment did not return an authorization URL");
        }
        process.stdout.write(`[h2a] llm-mesh: open ${session.url}\n`);
        (options.openBrowser ?? openEnrollmentBrowser)(session.url);
        return facade.waitForCallback(session.enrollmentId);
      })()
    : await (async () => {
        if (session.kind !== "device-code") {
          throw new Error("Codex enrollment did not return a device code");
        }
        process.stdout.write(
          `[h2a] llm-mesh: enter code ${session.userCode} at ${session.verificationUrl}\n`,
        );
        return facade.pollForCompletion(session.enrollmentId);
      })();

  return { accountId: completed.accountId, provider, label: completed.label };
}

export async function listAccountsViaFacade(
  options: FacadeAccountOptions = {},
): Promise<readonly AccountPublic[]> {
  const facade = options.facade ?? createCliLlmMeshFacade();
  return facade.listAccounts({
    ownerScope: options.ownerScope ?? llmMeshOwnerScopeRef(),
  });
}

export async function removeAccountViaFacade(
  accountId: string,
  options: FacadeAccountOptions = {},
): Promise<{ accountId: string; removed: true }> {
  const facade = options.facade ?? createCliLlmMeshFacade();
  return facade.removeAccount(accountId, {
    ownerScope: options.ownerScope ?? llmMeshOwnerScopeRef(),
  });
}

function publicAccountProjection(account: AccountPublic): AccountPublic {
  return {
    accountId: account.accountId,
    ...(account.accountLabel ? { accountLabel: account.accountLabel } : {}),
    providerId: account.providerId,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function formatLlmMeshAccountList(
  accounts: readonly AccountPublic[],
  json: boolean,
): string {
  const publicAccounts = accounts.map(publicAccountProjection);
  if (json) return JSON.stringify(publicAccounts, null, 2);
  if (publicAccounts.length === 0) {
    return "[h2a] llm-mesh account: no accounts enrolled";
  }

  const rows = publicAccounts.map((account) => [
    account.accountId,
    account.providerId,
    account.accountLabel ?? "-",
    account.status,
    account.createdAt,
  ]);
  const headers = ["ID", "PROVIDER", "LABEL", "STATUS", "ENROLLED"];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => row[index]?.length ?? 0),
  ));
  return [headers, ...rows]
    .map((row) => row.map((value, index) => value.padEnd(widths[index] ?? value.length)).join("  ").trimEnd())
    .join("\n");
}

const SAFE_ACCOUNT_NOT_FOUND = /^Account '[A-Za-z0-9][A-Za-z0-9._:-]{0,127}' not found$/;

export function formatLlmMeshAccountError(
  error: unknown,
  fallback: "account inventory unavailable" | "account removal failed",
): string {
  const message = error instanceof Error ? error.message : String(error);
  return SAFE_ACCOUNT_NOT_FOUND.test(message) ? message : fallback;
}

