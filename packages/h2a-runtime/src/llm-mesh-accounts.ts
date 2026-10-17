/** Account enrollment and public CLI presentation through cluster-mesh. */
import { homedir, hostname } from "node:os";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLlmMeshFacade, type LlmMeshAdministrativeFacade, type LlmMeshFacade } from "@sentropic/cluster-mesh/llm-mesh/facade";
import type { AccountPublic } from "@sentropic/cluster-mesh/llm-mesh/enrollment";
import { readPrivateSeatFile, resolveSeatEnrollmentProvider } from "./cli-seat-codecs.js";
import { SeatMaterializationError, validateSeatBundleForMaterialization } from "./cli-seat-materialization.js";
import { SEAT_BUNDLE_MAX_BYTES, SEAT_PACKAGE_PROVIDER_ID, type SeatCli5, type SyntheticSeatBundleV1 } from "./cli-seat-fixtures.js";

import {
  MAX_CLAUDE_INPUT_BYTES,
  readMaskedInput,
  readPipedCredentialInput,
  ClaudeSeatInputError,
} from "./claude-seat-input.js";

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

/**
 * Enrollment source (owner decision 2026-10-13): OAuth by default, `cli`
 * imports from the provider's official CLI store, `token` imports a
 * serialized credential from a secret manager. Exposed on the CLI as
 * `--from oauth|cli|token` (canonical) with `--cli` / `--token` booleans
 * kept for convention fit.
 */
export type LlmMeshEnrollmentMode = "oauth" | "cli" | "token";

export interface FacadeEnrollmentOptions {
  configRef?: string;
  ownerScope?: string;
  redirectUri?: string;
  /** Canonical source selector; legacy booleans below map onto it. */
  from?: LlmMeshEnrollmentMode;
  /**
   * Select the provider's local CLI-store import instead of the OAuth flow.
   * Owner decision 2026-10-10: OAuth is the default enrollment for every
   * provider; importing credentials from an already-logged-in CLI is an
   * explicit opt-in (`--cli` / `--from cli`) and only exists for providers
   * that actually keep a local CLI store (muse, claude-code).
   */
  cliImport?: boolean;
  /**
   * Serialized token import mode for Claude (`--token` / `--from token`):
   * a renewable credential JSON from a secret manager. Never argv, never
   * logged: piped stdin when stdin is not a TTY, masked prompt otherwise.
   */
  tokenImport?: boolean;
  /**
   * HOME the Claude CLI-store import reads
   * (`<home>/.claude/.credentials.json`). Injection seam for tests;
   * production uses the real home directory.
   */
  cliStoreHome?: string;
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
    "Claude token entry timed out",
    "Claude token entry received EOF",
    "Claude token entry received empty input",
    "Claude token entry input stream error",
    "Claude token input exceeded maximum allowed size",
    "Claude CLI store not found",
    "Claude CLI store unreadable",
    "Claude CLI store holds no renewable credential",
    "trusted local terminal required for Claude credential entry",
    "trusted local input required for Claude token entry",
    "piped input required for Claude token entry",
    "ownerScope is required and cannot be blank",
    "Invalid H2A_LLM_MESH_CONFIG_JSON",
    "--cli and --token cannot be combined",
    "--from cannot be combined with --cli",
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
  // Owner opt-out: skip the argv exposure entirely (the URL is visible in
  // /proc/*/cmdline while the opener runs); print the URL directly to the
  // terminal so the user can complete authorization manually without argv exposure.
  if (process.env.H2A_NO_BROWSER === "1") {
    process.stdout.write(
      `[h2a] llm-mesh: browser launch skipped (H2A_NO_BROWSER=1). Open this URL to authorize:\n${url}\n`,
    );
    return;
  }
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    // A missing opener reports asynchronously: without this listener Node
    // crashes printing spawnargs, which carry the full authorization URL.
    child.on("error", () => {});
    child.unref();
  } catch {
    // Manual flow continues; failures here never carry the URL.
  }
}

const ENROLLMENT_MODES: readonly string[] = ["oauth", "cli", "token"];

/**
 * Resolve the effective enrollment source from the canonical `--from`
 * selector and the legacy `--cli` / `--token` booleans. Static errors
 * only; nothing secret-adjacent is echoed.
 */
export function resolveEnrollmentMode(
  options: Pick<FacadeEnrollmentOptions, "from" | "cliImport" | "tokenImport">,
): LlmMeshEnrollmentMode {
  const legacy: LlmMeshEnrollmentMode[] = [
    ...(options.cliImport ? (["cli"] as const) : []),
    ...(options.tokenImport ? (["token"] as const) : []),
  ];
  if (options.from !== undefined && legacy.length > 0) {
    throw new Error("--from cannot be combined with --cli or --token");
  }
  if (legacy.length > 1) {
    throw new Error("--cli and --token cannot be combined");
  }
  const mode = options.from ?? legacy[0] ?? "oauth";
  if (!ENROLLMENT_MODES.includes(mode)) {
    throw new Error("--from must be one of oauth, cli, token");
  }
  return mode;
}

/**
 * Read the official Claude CLI store credential for `--from cli`.
 * Returns the raw store document for the credential-import leg (the mesh
 * accepts the store shape: `{claudeAiOauth: {...}}` or the inner renewable
 * grant with access + refresh tokens). Only the static store PATH ever
 * appears in errors — file content never does.
 *
 * Platform scope: only the Linux file path below is read. Where the
 * official CLI keeps credentials outside that file (for example the
 * macOS keychain, unverified here), `--from cli` fails closed with
 * "store not found" — re-authenticate the official CLI or enroll with
 * OAuth instead.
 */
export async function readClaudeCliStoreCredential(homeDir?: string): Promise<string> {
  const storePath = join(homeDir ?? homedir(), ".claude", ".credentials.json");
  let raw: string;
  try {
    raw = await readFile(storePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `Claude CLI store not found at ${storePath} (run the official Claude CLI login first, or enroll with OAuth)`,
      );
    }
    throw new Error(
      `Claude CLI store unreadable at ${storePath} (check permissions on the official CLI store)`,
    );
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_CLAUDE_INPUT_BYTES) {
    throw new Error(
      `Claude token input exceeded maximum allowed size (${Math.round(MAX_CLAUDE_INPUT_BYTES / 1024)} KiB)`,
    );
  }
  const trimmed = raw.trim();
  let grant: unknown;
  try {
    const parsed: unknown = trimmed ? JSON.parse(trimmed) : undefined;
    grant =
      parsed && typeof parsed === "object"
        ? ((parsed as Record<string, unknown>).claudeAiOauth ?? parsed)
        : undefined;
  } catch {
    grant = undefined;
  }
  const renewable =
    grant !== null &&
    typeof grant === "object" &&
    typeof (grant as Record<string, unknown>).accessToken === "string" &&
    typeof (grant as Record<string, unknown>).refreshToken === "string";
  if (!renewable) {
    throw new Error(
      "Claude CLI store holds no renewable credential (reauthenticate the official CLI, or enroll with OAuth)",
    );
  }
  return trimmed;
}

/**
 * Default token-mode reader: masked TTY prompt for an interactive owner,
 * piped stdin for secret-manager output redirected into the command.
 * No secret-bearing argv; nothing is logged.
 */
function defaultTokenReader(
  prompt: string,
  _options?: { multiline?: boolean },
): Promise<string> {
  if (process.stdin.isTTY) {
    return readMaskedInput(prompt, { multiline: true });
  }
  return readPipedCredentialInput();
}

/** Structural L1 boundary pinned to sentropic PR 681@7293130ee3f6.
 * Published 0.26.1 predates it: absence fails closed before secret input.
 * The receiver owns persistence, lineage and the external refresh policy.
 */
export interface LlmMeshSeatImporter {
  importSeatBundle(input: { bundle: unknown; ownerScope: string }): Promise<{ accountId: string; seatRef: string; generation: number; idempotent: boolean }>;
}
/** Structural copy of L1 CliSeatProfileInput at the same pin. */
export interface SeatConsumerProfileInput {
  cli: SeatCli5;
  seatRef: string;
  refreshFamilyRef?: string;
  ownerScope: string;
  issuingClientRef: string;
  endpointFamily: string;
  accountBinding: string;
  entitlementClass: string;
  epoch: number;
  generation: number;
  operationId: string;
  issuedAt: string;
  providerExpiry?: string;
  accessRef?: string;
  accessKind?: "access" | "static-key" | "unavailable";
  credentialFormatVersion?: string;
  nativeCliVersion?: string;
  os?: "linux" | "macos" | "windows";
}
export interface SeatConsumerParsers {
  parseCliSeatProfile(input: SeatConsumerProfileInput): unknown;
  parseTokenSeatEnvelope(input: { raw: string; ownerScope: string }): unknown;
}
export interface SeatConsumerEnrollmentOptions extends Pick<FacadeEnrollmentOptions, "ownerScope" | "readInput"> {
  from: "cli" | "token";
  /** Explicit private L1 CliSeatProfileInput, never an ambient daily store. */
  seatProfile?: string;
  facade?: LlmMeshFacade & Partial<LlmMeshSeatImporter>;
  /** Trusted SDK/test seam for the same L1 parser exports. */
  parsers?: Partial<SeatConsumerParsers>;
}

/** Shared-seat consumer path. Product OAuth/legacy import APIs stay separate. */
export async function enrollSeatConsumerViaFacade(rawProvider: string, options: SeatConsumerEnrollmentOptions): Promise<LlmMeshEnrollmentAccount> {
  const provider = resolveSeatEnrollmentProvider(rawProvider);
  const ownerScope = (options.ownerScope ?? llmMeshOwnerScopeRef()).trim();
  if (!ownerScope) throw new SeatMaterializationError("verified seat owner required", "owner-mismatch");
  if (options.from !== "cli" && options.from !== "token") throw new SeatMaterializationError("seat source must be cli or token", "unknown-source-mode");
  let facade: LlmMeshFacade & Partial<LlmMeshSeatImporter>;
  try { facade = options.facade ?? createCliLlmMeshFacade(); }
  catch { throw new SeatMaterializationError("L1 seat receiver unavailable", "seat-import-unavailable"); }
  if (typeof facade.importSeatBundle !== "function") throw new SeatMaterializationError("L1 seat consumer import unavailable; requires importSeatBundle", "seat-import-unavailable");
  let parsers: Partial<SeatConsumerParsers>;
  try { parsers = options.parsers ?? await import("@sentropic/cluster-mesh/llm-mesh/enrollment") as Partial<SeatConsumerParsers>; }
  catch { throw new SeatMaterializationError("L1 seat source parser unavailable", "seat-import-unavailable"); }
  if (typeof parsers[options.from === "cli" ? "parseCliSeatProfile" : "parseTokenSeatEnvelope"] !== "function") throw new SeatMaterializationError("L1 seat source parser unavailable", "seat-import-unavailable");
  let bundle: unknown;
  try {
    if (options.from === "cli") {
      if (!options.seatProfile) throw new Error("missing selected profile");
      const profile = JSON.parse(readPrivateSeatFile(options.seatProfile, SEAT_BUNDLE_MAX_BYTES));
      if (!profile || typeof profile !== "object" || profile.ownerScope !== ownerScope) throw new Error("profile owner mismatch");
      // This is the private parser-only profile/manifest specified by L1,
      // including for CLIs whose native access-only profile is unavailable.
      bundle = parsers.parseCliSeatProfile!(profile);
    } else {
      const readInput = options.readInput ?? (process.stdin.isTTY
        ? () => readMaskedInput("[h2a] llm-mesh: paste consumer SeatBundle JSON: ", { multiline: true, maxBytes: SEAT_BUNDLE_MAX_BYTES })
        : () => readPipedCredentialInput({ maxBytes: SEAT_BUNDLE_MAX_BYTES }));
      const raw = await readInput("[h2a] llm-mesh: read consumer SeatBundle JSON: ", { multiline: true });
      if (Buffer.byteLength(raw, "utf8") > SEAT_BUNDLE_MAX_BYTES) throw new Error("oversize envelope");
      bundle = parsers.parseTokenSeatEnvelope!({ raw, ownerScope });
    }
  } catch { throw new SeatMaterializationError("seat consumer input refused", "seat-input-refused"); }
  const validation = validateSeatBundleForMaterialization(bundle, { ownerScope, trustedAuthority: "consumer" });
  if (!validation.ok) throw new SeatMaterializationError("seat consumer projection refused", validation.code);
  const projection = bundle as SyntheticSeatBundleV1;
  if (SEAT_PACKAGE_PROVIDER_ID[projection.identity.cli] !== provider || projection.authority !== "consumer" || !["access-only", "static-key"].includes(projection.credentialClass) || !projection.lifecycle.providerExpiry || !["access", "static-key"].includes(projection.meshUse.kind) || !projection.meshUse.accessRef?.trim()) throw new SeatMaterializationError("seat consumer projection unavailable", "seat-projection-unavailable");
  try {
    const result = await facade.importSeatBundle({ bundle, ownerScope });
    return { accountId: result.accountId, provider, label: `Seat ${projection.identity.cli}` };
  } catch { throw new SeatMaterializationError("seat consumer import failed", "seat-import-failed"); }
}

/**
 * Legacy product enrollment API. Shared-seat CLI commands use
 * enrollSeatConsumerViaFacade instead, including the --cli/--token aliases.
 * Enroll through the sentropic-owned OAuth state machine. H2A never receives
 * an authorization code or a provider token. Account records remain owned by
 * the facade/keyring and are not copied into h2a config.
 *
 * Provider semantics (owner decision 2026-10-10): "muse" enrolls via the
 * native Meta OAuth device flow by default; passing cliImport selects the
 * Muse CLI-store import instead. "muse-code" is no longer a user entry — it
 * survives only as the mesh-side provider id for the device flow.
 *
 * Import semantics (owner decision 2026-10-13): `--from cli` imports from
 * the provider's official CLI store; `--from token` imports a serialized
 * credential from a secret manager (claude-code only — other seats record
 * the gap, they are not changed here).
 *
 * Lifecycle note (differs from muse, mesh 0.25.0): muse lets the mesh
 * read its CLI store at enroll AND at each refresh, so the official CLI
 * stays the sole writer. The mesh ships no such store leg for Claude, so
 * h2a reads the official store once into the mesh credential-import leg:
 * a point-in-time COPY. The mesh never writes the official store file —
 * the official CLI stays its sole writer — but the mesh copy refreshes
 * independently through the token endpoint afterwards. If the provider
 * rotates the refresh grant, the side that refreshes second loses it:
 * re-run `--from cli` (re-authenticate the official CLI first when its
 * own copy lapsed). A mesh-side Claude store leg (mesh re-reads the
 * official file at each refresh, never writes it) is a recorded
 * follow-up, not built here.
 */
export async function enrollViaFacade(
  rawProvider: "cloud-code" | "codex" | "muse" | "mistral-vibe" | "claude-code" | SeatCli5,
  options: FacadeEnrollmentOptions = {},
): Promise<LlmMeshEnrollmentAccount> {
  const provider = resolveSeatEnrollmentProvider(rawProvider);
  const rawOwner = options.ownerScope ?? llmMeshOwnerScopeRef();
  const ownerScope = rawOwner.trim();
  if (!ownerScope) {
    throw new Error("ownerScope is required and cannot be blank");
  }
  const mode = resolveEnrollmentMode(options);
  if (mode === "cli" && provider !== "muse" && provider !== "claude-code") {
    throw new SeatMaterializationError(
      `provider "${provider}" has no CLI-store import; --cli/--from cli is only valid for providers with a local CLI import (muse, claude-code)`,
      "seat-import-unavailable",
    );
  }
  if (mode === "token" && provider !== "claude-code") {
    throw new SeatMaterializationError(
      `--token/--from token is only valid for claude-code`,
      "seat-import-unavailable",
    );
  }

  if (provider === "claude-code") {
    validateClaudeConfigJson();
    const facade = options.facade ?? createCliLlmMeshFacade();

    if (mode === "token") {
      if (typeof facade.completeClaudeCredentialImport !== "function") {
        throw new Error(
          "Claude credential import requires facade.completeClaudeCredentialImport — upgrade @sentropic/cluster-mesh/llm-mesh " +
          "to a version with Claude support",
        );
      }
      const readInput = options.readInput ?? defaultTokenReader;
      let credentialJson: string;
      try {
        credentialJson = await readInput(
          "[h2a] llm-mesh: paste renewable credential JSON (or pipe secret-manager output): ",
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

    if (mode === "cli") {
      if (typeof facade.completeClaudeCredentialImport !== "function") {
        throw new Error(
          "Claude credential import requires facade.completeClaudeCredentialImport — upgrade @sentropic/cluster-mesh/llm-mesh " +
          "to a version with Claude support",
        );
      }
      let credentialJson: string;
      try {
        credentialJson = await readClaudeCliStoreCredential(options.cliStoreHome);
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

    if (process.env.H2A_NO_BROWSER !== "1") {
      process.stdout.write(
        `[h2a] llm-mesh: opening Claude authorization in your browser; authorize and paste the returned code\n`,
      );
    }
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
  const museCli = provider === "muse" && mode === "cli";
  const facadeProvider = provider === "muse" && !museCli ? "muse-code" : provider;
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

  if (museCli) {
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

