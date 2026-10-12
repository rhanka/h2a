/** Account enrollment and public CLI presentation through cluster-mesh. */
import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { createLlmMeshFacade, type LlmMeshAdministrativeFacade, type LlmMeshFacade } from "@sentropic/cluster-mesh/llm-mesh/facade";
import type { AccountPublic } from "@sentropic/cluster-mesh/llm-mesh/enrollment";

import { readMaskedInput, ClaudeSeatInputError } from "./claude-seat-input.js";

export interface LlmMeshEnrollmentAccount {
  accountId: string;
  provider: "cloud-code" | "codex" | "muse" | "mistral-vibe" | "claude-code";
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
  /**
   * Select the provider's local CLI-store import instead of the OAuth flow.
   * Owner decision 2026-10-10: OAuth is the default enrollment for every
   * provider; importing credentials from an already-logged-in CLI is an
   * explicit opt-in (`h2a llm-mesh account enroll <provider> --cli`) and only
   * exists for providers that actually keep a local CLI store (muse today).
   */
  cliImport?: boolean;
  /**
   * Explicit sessionless renewable credential import mode for Claude.
   * Accepts no secret value argument on CLI; prompt is masked in-process.
   */
  credentialImport?: boolean;
  /** Injection seam for CLI tests; production uses the opaque facade. */
  facade?: LlmMeshFacade;
  /** Injection seam that keeps enrollment tests from opening a real browser. */
  openBrowser?: (url: string) => void;
  /** Injection seam for trusted local input (browser return code / credential JSON). */
  readInput?: (prompt: string, options?: { multiline?: boolean }) => Promise<string>;
}

export interface FacadeAccountOptions {
  ownerScope?: string;
  /** Injection seam for account-administration tests. */
  facade?: Pick<LlmMeshAdministrativeFacade, "listAccounts" | "removeAccount">;
}

export function validateClaudeConfigJson(): void {
  const raw = process.env.H2A_LLM_MESH_CONFIG_JSON;
  if (raw === undefined || raw === "") return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid H2A_LLM_MESH_CONFIG_JSON: configuration must be a JSON object");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid H2A_LLM_MESH_CONFIG_JSON")) {
      throw error;
    }
    throw new Error("Invalid H2A_LLM_MESH_CONFIG_JSON: configuration must be valid JSON");
  }
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
      } catch (error) {
        if (configRef === "claude-code") {
          throw new Error("Invalid H2A_LLM_MESH_CONFIG_JSON: configuration must be valid JSON");
        }
        return {};
      }
    },
  };
}

export function sanitizeClaudeEnrollmentError(error: unknown): Error {
  if (error instanceof ClaudeSeatInputError) {
    return new Error(error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  const allowedPrefixes = [
    "Claude enrollment requires facade.completeClaudeEnrollment",
    "Claude credential import requires facade.completeClaudeCredentialImport",
    "Claude enrollment did not return an authorization URL",
    "Claude enrollment cancelled",
    "Claude credential entry timed out",
    "Claude credential entry received EOF",
    "Claude credential entry received empty input",
    "Claude credential input exceeded maximum allowed size",
    "trusted local terminal required for Claude credential entry",
    "ownerScope is required and cannot be blank",
    "Invalid H2A_LLM_MESH_CONFIG_JSON",
    "provider \"claude-code\" has no CLI-store import",
    "--credential-import is only valid for claude-code",
    "--cli and --credential-import cannot be combined",
  ];
  for (const prefix of allowedPrefixes) {
    if (message.startsWith(prefix)) {
      return new Error(message);
    }
  }

  // Strictly static beyond the allowlisted prefixes: dynamic mesh/storage
  // text may carry token fragments or JSON, and no redactor can prove it
  // does not. Public errors are allowlisted or the generic failure.
  return new Error("Claude enrollment failed");
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
 *
 * Provider semantics (owner decision 2026-10-10): "muse" enrolls via the
 * native Meta OAuth device flow by default; passing cliImport selects the
 * Muse CLI-store import instead. "muse-code" is no longer a user entry — it
 * survives only as the mesh-side provider id for the device flow.
 */
export async function enrollViaFacade(
  provider: "cloud-code" | "codex" | "muse" | "mistral-vibe" | "claude-code",
  options: FacadeEnrollmentOptions = {},
): Promise<LlmMeshEnrollmentAccount> {
  const rawOwner = options.ownerScope ?? llmMeshOwnerScopeRef();
  const ownerScope = rawOwner.trim();
  if (!ownerScope) {
    throw new Error("ownerScope is required and cannot be blank");
  }
  if (options.cliImport && options.credentialImport) {
    throw new Error("--cli and --credential-import cannot be combined");
  }
  if (options.cliImport && provider !== "muse") {
    throw new Error(
      `provider "${provider}" has no CLI-store import; --cli is only valid for providers with a local CLI import (muse)`,
    );
  }
  if (options.credentialImport && provider !== "claude-code") {
    throw new Error(
      `--credential-import is only valid for claude-code`,
    );
  }

  if (provider === "claude-code") {
    validateClaudeConfigJson();
    const facade = options.facade ?? createCliLlmMeshFacade();

    if (options.credentialImport) {
      if (typeof facade.completeClaudeCredentialImport !== "function") {
        throw new Error(
          "Claude credential import requires facade.completeClaudeCredentialImport — upgrade @sentropic/cluster-mesh/llm-mesh " +
          "to a version with Claude support",
        );
      }
      const readInput = options.readInput ?? ((prompt) => readMaskedInput(prompt, { multiline: true }));
      let credentialJson: string;
      try {
        credentialJson = await readInput(
          "[h2a] llm-mesh: paste renewable credential JSON: ",
          { multiline: true },
        );
      } catch (err) {
        throw sanitizeClaudeEnrollmentError(err);
      }
      try {
        const completed = await facade.completeClaudeCredentialImport(
          credentialJson,
          ownerScope,
        );
        return {
          accountId: completed.accountId,
          provider: "claude-code",
          label: completed.label,
        };
      } catch (err) {
        throw sanitizeClaudeEnrollmentError(err);
      }
    }

    if (typeof facade.completeClaudeEnrollment !== "function") {
      throw new Error(
        "Claude enrollment requires facade.completeClaudeEnrollment — upgrade @sentropic/cluster-mesh/llm-mesh " +
        "to a version with Claude support",
      );
    }

    const configRef = options.configRef ?? process.env.H2A_LLM_MESH_CONFIG_REF ?? "claude-code";
    const redirectUri = options.redirectUri !== undefined ? options.redirectUri : "";

    let session: any;
    try {
      session = await facade.enroll("claude-code" as "codex", {
        configRef,
        mode: "cli",
        redirectUri,
        ownerScope,
      });
    } catch (err) {
      throw sanitizeClaudeEnrollmentError(err);
    }

    if (!session || session.kind !== "authorization-url" || typeof session.url !== "string") {
      throw new Error("Claude enrollment did not return an authorization URL");
    }

    process.stdout.write(
      `[h2a] llm-mesh: opening Claude authorization in your browser; authorize and paste the returned code\n`,
    );
    try {
      (options.openBrowser ?? openEnrollmentBrowser)(session.url);
    } catch {
      // safe fallback
    }

    const readInput = options.readInput ?? ((prompt) => readMaskedInput(prompt, { multiline: false }));
    let returnedCode: string;
    try {
      returnedCode = await readInput(
        "[h2a] llm-mesh: paste the authorization code (<code-and-state>): ",
        { multiline: false },
      );
    } catch (inputErr) {
      await facade.cancel?.(session.enrollmentId).catch(() => {});
      throw sanitizeClaudeEnrollmentError(inputErr);
    }

    try {
      const completed = await facade.completeClaudeEnrollment(
        session.enrollmentId,
        returnedCode,
        ownerScope,
      );
      return {
        accountId: completed.accountId,
        provider: "claude-code",
        label: completed.label,
      };
    } catch (completionErr) {
      await facade.cancel?.(session.enrollmentId).catch(() => {});
      throw sanitizeClaudeEnrollmentError(completionErr);
    }
  }

  const facade = options.facade ?? createCliLlmMeshFacade();
  // The facade knows the device flow under its historical mesh-side id.
  const facadeProvider = provider === "muse" && !options.cliImport ? "muse-code" : provider;
  // The installed @sentropic/cluster-mesh/llm-mesh types predate the muse provider, but
  // enroll passes the id through opaquely — a muse-capable facade resolves
  // it, an older one fails with its own unknown-provider error. Cast is
  // load-bearing until the dep bump, not a lie about the contract.
  const session = await facade.enroll(facadeProvider as "codex", {
    configRef: options.configRef ?? process.env.H2A_LLM_MESH_CONFIG_REF ?? "default",
    mode: "cli",
    redirectUri: options.redirectUri ?? "http://127.0.0.1",
    ownerScope,
  });

  if (provider === "muse" && options.cliImport) {
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

  if (provider === "muse") {
    // Native Meta device flow (RFC 8628, MuseCodeEnrollmentProvider
    // mesh-side): print the user code + verification URL, then complete via
    // the muse-specific device import — the muse-code key mint is its own
    // completion contract, not the generic pollForCompletion.
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

  if (provider === "mistral-vibe") {
    // Mistral Vibe native browser sign-in (MistralVibeEnrollmentProvider
    // mesh-side): start() returns the console.mistral.ai sign-in URL
    // (authorization-url); completion is POLL-based — the provider polls the
    // sign-in process internally, so there is no OAuth callback leg for
    // waitForCallback to catch. Verified in-vivo end-to-end: PKCE start →
    // browser approval → poll → exchange mints a long-lived API key billed
    // against the signed-in plan's Vibe Code quota (refresh fails closed).
    const vibeSession = session as unknown as {
      kind: string;
      enrollmentId: string;
      url: string;
    };
    if (vibeSession.kind !== "authorization-url") {
      throw new Error("Mistral Vibe enrollment did not return a sign-in URL");
    }
    process.stdout.write(`[h2a] llm-mesh: open ${vibeSession.url}\n`);
    (options.openBrowser ?? openEnrollmentBrowser)(vibeSession.url);
    const completed = await facade.pollForCompletion(vibeSession.enrollmentId);
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

