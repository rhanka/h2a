// cli-seat-materialization.ts
//
// L2-s synthetic seat materialization (no real credential, no live call).
//
// The deterministic bootstrap validates and selects only the needed CLI
// payload, creates a private run profile, then hands a run-scoped capability
// to the final spawn helper. Credentials resolve after environment capture;
// the daemon/controller never sees provider values. h2a owns no duplicate
// store, no account-stack selection and no refresh ownership (§4.3): those
// are native Sentropic gateway responsibilities; this module holds no
// credential persistence, no timers and no re-enrollment path. Only private
// ephemeral family-admission and handoff metadata lives in XDG_RUNTIME_DIR.

import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

import type { SeatCli5, SeatScenario, SyntheticSeatBundleV1 } from "./cli-seat-fixtures.js";
import { makeSyntheticCanary, makeSyntheticConsumerBundle, SEAT_BUNDLE_MAX_BYTES, SEAT_PACKAGE_PROVIDER_ID, SEAT_SCENARIOS_4 } from "./cli-seat-fixtures.js";
import {
  AGY_STRIPPED_ENV_VARS,
  CREDENTIAL_ENV_VARS,
  getCliSeatCodec,
  ensurePrivateSeatDirectory,
  readPrivateSeatFile,
  resolveCredentialPrecedence,
  writePrivateSeatFile,
  writeSeatMcpConfiguration,
  writeSyntheticCredentialFiles,
  type SyntheticCredentialMaterial,
} from "./cli-seat-codecs.js";

export class SeatMaterializationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SeatMaterializationError";
    this.code = code;
  }
}

export type SeatSourceMode = "oauth" | "cli" | "token";

export interface SourceModeManifest {
  cli: SeatCli5;
  mode: SeatSourceMode;
  circuit: "seat" | "product-oauth";
  labProfile: string;
}

/**
 * Common source-mode contract (§4.2) for all five CLIs. oauth stays available
 * as the product enrollment but is never the seat-circuit origin.
 */
export function resolveSourceMode(cli: string, mode: string, labProfile: string): SourceModeManifest {
  const codec = getCliSeatCodec(cli);
  if (mode !== "oauth" && mode !== "cli" && mode !== "token") {
    throw new SeatMaterializationError(`unknown source mode for ${codec.cli}`, "unknown-source-mode");
  }
  const profile = labProfile.trim();
  if (profile === "") {
    throw new SeatMaterializationError("explicit lab profile required", "missing-lab-profile");
  }
  if (profile === "default" || profile === "daily") {
    throw new SeatMaterializationError("daily profiles are never the default", "daily-profile-refused");
  }
  return { cli: codec.cli, mode, circuit: mode === "oauth" ? "product-oauth" : "seat", labProfile: profile };
}

/** Static refusal of credential values in argv: the message never echoes the value. */
export function assertArgvClean(argv: readonly string[], secrets: readonly string[]): void {
  for (const arg of argv) {
    for (const secret of secrets) {
      if (containsSecret(arg, secret)) {
        throw new SeatMaterializationError("credential in argv refused", "credential-in-argv");
      }
    }
  }
}

export type BundleValidationCode =
  | "schema-mismatch"
  | "size-exceeded"
  | "owner-mismatch"
  | "client-mismatch"
  | "unknown-field"
  | "stale-generation"
  | "generation-conflict"
  | "epoch-replacement-required"
  | "authority-escalation"
  | "refresh-material-present"
  | "nested-refresh-field"
  | "invalid-lifecycle";

export type BundleValidationResult =
  | { ok: true }
  | { ok: false; code: BundleValidationCode; detail: string };

const REFRESH_KEY_PATTERN = /refresh|session.?token|device.?(code|token)/i;

function containsSecret(text: string, secret: string): boolean {
  return secret !== "" && (text.includes(secret) || text.includes(Buffer.from(secret, "utf8").toString("base64")));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function validDate(value: unknown): boolean { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }

export interface SeatValidationContext {
  ownerScope?: string;
  trustedAuthority?: "custodian" | "consumer" | "native-store";
  issuingClientRef?: string;
  endpointFamily?: string;
  predecessor?: StreamPredecessor;
}

function refreshFieldDepth(value: unknown, depth = 0): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = refreshFieldDepth(item, depth + 1);
      if (hit !== undefined) return hit;
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      if (REFRESH_KEY_PATTERN.test(key)) return depth;
      const hit = refreshFieldDepth(nested, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** Consumer-channel validation: no refresh material, no authority upgrade from bundle data. */
export function validateSeatBundleForMaterialization(
  bundle: unknown,
  context?: SeatValidationContext,
): BundleValidationResult {
  const fail = (code: BundleValidationCode, detail: string): BundleValidationResult => ({ ok: false, code, detail });
  let serialized: string;
  try {
    serialized = JSON.stringify(bundle) ?? "";
  } catch {
    return fail("schema-mismatch", "bundle must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > SEAT_BUNDLE_MAX_BYTES) return fail("size-exceeded", "bundle exceeds 48 KiB");
  if (!isRecord(bundle)) return fail("schema-mismatch", "bundle must be an object");
  const { identity, provenance, lifecycle, canonical, nativeUse, meshUse, authority, credentialClass } = bundle;
  if (!isRecord(identity) || !isRecord(provenance) || !isRecord(lifecycle) || !isRecord(meshUse)) return fail("schema-mismatch", "missing bundle sections");
  const sections: [Record<string, unknown>, readonly string[]][] = [
    [bundle, ["identity", "provenance", "authority", "credentialClass", "lifecycle", "canonical", "nativeUse", "meshUse"]],
    [identity, ["schemaVersion", "seatRef", "refreshFamilyRef", "ownerScope", "cli", "packageProviderId", "issuingClientRef", "endpointFamily", "credentialFormatVersion", "nativeCliVersion", "os"]],
    [provenance, ["enrollmentSource", "accountBinding", "entitlementClass"]],
    [lifecycle, ["epoch", "generation", "operationId", "issuedAt", "providerExpiry", "localExpiryPolicy", "refreshAuthority"]],
  ];
  for (const [section, keys] of sections) {
    if (Object.keys(section).some(k => !keys.includes(k))) return fail("unknown-field", "unknown bundle field");
  }
  const cli = identity.cli;
  if (typeof cli !== "string" || !Object.hasOwn(SEAT_PACKAGE_PROVIDER_ID, cli) || identity.packageProviderId !== SEAT_PACKAGE_PROVIDER_ID[cli as SeatCli5]) return fail("client-mismatch", "unknown CLI or package provider mismatch");
  if (identity.schemaVersion !== 1 || provenance.enrollmentSource !== "cli") return fail("schema-mismatch", "schema or provenance mismatch");
  for (const name of ["seatRef", "ownerScope", "issuingClientRef", "endpointFamily", "credentialFormatVersion"]) {
    if (!nonEmpty(identity[name])) return fail("schema-mismatch", "incomplete identity");
  }
  if (identity.os !== undefined && !["linux", "macos", "windows"].includes(identity.os as string)) return fail("schema-mismatch", "unknown OS");
  if (!nonEmpty(provenance.accountBinding) || !nonEmpty(provenance.entitlementClass)) return fail("schema-mismatch", "incomplete provenance");
  if (context?.ownerScope !== undefined && identity.ownerScope !== context.ownerScope) return fail("owner-mismatch", "owner differs from verified channel");
  if ((context?.issuingClientRef !== undefined && identity.issuingClientRef !== context.issuingClientRef) || (context?.endpointFamily !== undefined && identity.endpointFamily !== context.endpointFamily)) return fail("client-mismatch", "client differs from verified channel");
  if (!Number.isInteger(lifecycle.epoch) || (lifecycle.epoch as number) < 1 || !Number.isInteger(lifecycle.generation) || (lifecycle.generation as number) < 0 || !nonEmpty(lifecycle.operationId) || !validDate(lifecycle.issuedAt) || !nonEmpty(lifecycle.localExpiryPolicy) || !["custody", "none"].includes(lifecycle.refreshAuthority as string) || (lifecycle.providerExpiry !== undefined && !validDate(lifecycle.providerExpiry))) return fail("invalid-lifecycle", "invalid lifecycle");
  const rank = { consumer: 0, "native-store": 1, custodian: 2 } as const;
  const granted = context?.trustedAuthority ?? "consumer";
  if (typeof authority !== "string" || !Object.hasOwn(rank, authority) || !Object.hasOwn(rank, granted)) return fail("schema-mismatch", "unknown authority");
  if (rank[authority as keyof typeof rank] > rank[granted]) return fail("authority-escalation", "bundle claims above the granted channel");
  if (!["renewable", "static-key", "access-only", "store-reference"].includes(credentialClass as string)) return fail("schema-mismatch", "unknown credential class");
  if (credentialClass === "static-key" ? identity.refreshFamilyRef !== undefined : !nonEmpty(identity.refreshFamilyRef)) return fail("schema-mismatch", "static keys have no refresh family; other classes require one");
  if (authority !== "custodian") {
    if (credentialClass === "renewable" || (credentialClass === "store-reference" && granted !== "native-store")) return fail("authority-escalation", "credential class exceeds granted authority");
    if (lifecycle.refreshAuthority !== "none" || canonical !== undefined) return fail("authority-escalation", "consumer payload carries refresh authority");
  }
  if (credentialClass === "renewable" && lifecycle.refreshAuthority !== "custody") return fail("invalid-lifecycle", "renewable custody requires refresh authority");
  if (credentialClass !== "renewable" && lifecycle.refreshAuthority !== "none") return fail("invalid-lifecycle", "non-renewable material cannot hold refresh authority");
  if (credentialClass === "renewable" && (!isRecord(canonical) || canonical.kind !== "renewable-material" || !nonEmpty(canonical.materialRef))) return fail("schema-mismatch", "renewable custody requires canonical material");
  for (const projection of [nativeUse, meshUse]) {
    if (projection === undefined) continue;
    if (!isRecord(projection)) return fail("schema-mismatch", "projection must be an object");
    const refreshDepth = refreshFieldDepth(projection);
    if (refreshDepth !== undefined) {
      return fail(refreshDepth === 0 ? "refresh-material-present" : "nested-refresh-field", "refresh field in projection");
    }
    if (Object.keys(projection).some(k => !["kind", "accessRef", "reason"].includes(k))) return fail("unknown-field", "unknown projection field");
    if (!["access", "static-key", "unavailable"].includes(projection.kind as string) || (projection.accessRef !== undefined && typeof projection.accessRef !== "string") || (projection.reason !== undefined && typeof projection.reason !== "string")) return fail("schema-mismatch", "invalid projection");
  }
  if (canonical !== undefined) {
    if (!isRecord(canonical) || !["renewable-material", "static-key-material"].includes(canonical.kind as string) || !nonEmpty(canonical.materialRef)) return fail("schema-mismatch", "invalid canonical material");
    if (Object.keys(canonical).some(k => !["kind", "materialRef"].includes(k))) return fail("unknown-field", "unknown canonical field");
    if ((canonical.kind === "renewable-material" && credentialClass !== "renewable") || (canonical.kind === "static-key-material" && credentialClass !== "static-key")) return fail("schema-mismatch", "canonical material differs from credential class");
  }
  if (context?.predecessor) {
    const current = context.predecessor;
    if ((lifecycle.epoch as number) < current.epoch || (lifecycle.epoch === current.epoch && (lifecycle.generation as number) < current.generation)) return fail("stale-generation", "incoming tuple is older than verified predecessor");
    if (lifecycle.epoch !== current.epoch) return fail("epoch-replacement-required", "new epoch requires controlled replacement");
    if (lifecycle.generation === current.generation && lifecycle.operationId !== current.operationId) return fail("generation-conflict", "same generation has another operation");
  }
  return { ok: true };
}

export interface MaterializeSeatOptions {
  parentDir: string;
  mode: SeatSourceMode;
  labProfile: string;
  /** Only gateway-off is accepted: the native matrix runs direct. */
  gateway: "off";
  /** Serialized-stream delegation under §3.4 (sole temporal holder). */
  delegate?: boolean;
  canary?: string;
  /** Set by a verified channel, never inferred from mode, delegate or bundle. */
  trustedContext?: SeatValidationContext;
  /** OS-specific adapter owned by L2a; no Gemini OAuth-file substitution. */
  keyring?: SyntheticSeatKeyring;
  streamTicket?: StreamTicket;
}

export interface SyntheticSeatKeyring {
  materialize(input: { canary: string; runDir: string; material: SyntheticCredentialMaterial }): { profileRef: string; childEnv: Record<string, string>; dispose(): void };
}
const keyringDisposers = new WeakMap<MaterializedSeat, () => void>();

export interface SeatReceipt {
  seatRef: string;
  familyRef: string;
  cli: SeatCli5;
  epoch: number;
  generation: number;
  operationId: string;
  mode: SeatSourceMode;
  capability: "access-only" | "static-key" | "serialized";
  os: "linux";
  outcome: string;
}

export interface MaterializedSeat {
  runId: string;
  runDir: string;
  homeDir: string;
  configDir: string;
  scenarioRoot: string;
  credentialPaths: string[];
  mcpConfigPath: string;
  childEnv: Record<string, string>;
  mcpEnv: Record<string, string>;
  launch: { cli: SeatCli5; binary: string; gateway: "off"; hostArgs: string[]; mcpArgs: string[] };
  receipt: SeatReceipt;
}

/**
 * Materialize the native representation per actor after environment capture.
 * Replaces lab copyLogin: only synthetic stand-ins are written, into a
 * disposable 0700 run dir. Renewable material requires explicit trusted
 * channel custody AND serialized delegation, independently of source mode;
 * consumer access never carries refresh authority.
 */
export function materializeSeatBundle(
  bundle: SyntheticSeatBundleV1,
  options: MaterializeSeatOptions,
): MaterializedSeat {
  if (options.gateway !== "off") {
    throw new SeatMaterializationError("seat launch requires gateway-off", "gateway-required-off");
  }
  if (bundle?.authority === "native-store") {
    throw new SeatMaterializationError("native-store ownership cannot transfer to CI", "native-store-refused");
  }
  const validation = validateSeatBundleForMaterialization(bundle, options.trustedContext);
  if (!validation.ok) throw new SeatMaterializationError(validation.detail, validation.code);
  const codec = getCliSeatCodec(bundle.identity.cli);
  const manifest = resolveSourceMode(codec.cli, options.mode, options.labProfile);
  if (manifest.circuit !== "seat") {
    throw new SeatMaterializationError("seat materialization requires --from cli|token", "non-seat-circuit");
  }
  if (bundle.credentialClass === "renewable") {
    if (options.delegate !== true) {
      throw new SeatMaterializationError(
        "canonical renewable material requires serialized delegation",
        "delegation-required",
      );
    }
    if (!options.streamTicket || !isPendingStream(options.streamTicket) || options.streamTicket.familyRef !== bundle.identity.refreshFamilyRef || !samePredecessor(options.streamTicket.predecessor, bundle.lifecycle)) {
      throw new SeatMaterializationError("serialized delegation requires an active family ticket", "stream-ticket-required");
    }
  }
  if (bundle.credentialClass !== "renewable" && (!bundle.nativeUse || bundle.nativeUse.kind === "unavailable" || !nonEmpty(bundle.nativeUse.accessRef))) throw new SeatMaterializationError("native projection unavailable", "native-unavailable");
  if (codec.cli === "agy" && !options.keyring) throw new SeatMaterializationError("isolated agy keyring adapter required", "keyring-unavailable");

  const canary = options.canary ?? makeSyntheticCanary(codec.cli);
  const material: SyntheticCredentialMaterial = bundle.credentialClass === "renewable"
    ? { kind: "renewable", materialRef: bundle.canonical!.materialRef }
    : { kind: bundle.credentialClass === "static-key" ? "static-key" : "access-only", materialRef: bundle.nativeUse!.accessRef! };
  const secrets = [
    canary,
    bundle.canonical?.materialRef ?? "",
    bundle.nativeUse?.accessRef ?? "",
    bundle.meshUse?.accessRef ?? "",
  ].filter((value) => value !== "");

  const runtimeBase = process.env.XDG_RUNTIME_DIR;
  if (!runtimeBase || !isAbsolute(runtimeBase)) throw new SeatMaterializationError("private XDG runtime base required", "runtime-unavailable");
  ensurePrivateSeatDirectory(runtimeBase);
  const parentRelative = relative(runtimeBase, options.parentDir);
  if (parentRelative === ".." || parentRelative.startsWith("../") || parentRelative.startsWith("..\\") || isAbsolute(parentRelative)) throw new SeatMaterializationError("credential parent must be inside private XDG runtime", "runtime-unavailable");
  ensurePrivateSeatDirectory(options.parentDir);
  if (bundle.credentialClass === "renewable") {
    try { writePrivateSeatFile(join(options.streamTicket!.lockDir, "materialized.json"), JSON.stringify({ streamOperationId: options.streamTicket!.streamOperationId })); }
    catch { throw new SeatMaterializationError("family delegation already materialized or fenced", "family-pending"); }
  }
  const runDir = mkdtempSync(join(options.parentDir, "seat-"));
  let disposeKeyring: (() => void) | undefined;
  try {
    chmodSync(runDir, 0o700);
    const homeDir = join(runDir, "home");
    const configDir = join(runDir, "config");
    const scenarioRoot = join(runDir, "scenario");
    for (const dir of [homeDir, configDir, scenarioRoot]) mkdirSync(dir, { recursive: true, mode: 0o700 });

    const credentialPaths = writeSyntheticCredentialFiles(codec.cli, { homeDir, configDir, canary, material });

    const launch = {
      cli: codec.cli,
      binary: codec.cli,
      gateway: "off" as const,
      hostArgs: [...codec.hostArgs],
      mcpArgs: ["mcp-serve"],
    };
    assertArgvClean([...launch.hostArgs, ...launch.mcpArgs, launch.binary], secrets);

    const childEnv: Record<string, string> = {
      PATH: "/usr/bin:/bin",
      HOME: homeDir,
      H2A_SEAT_CLI: codec.cli,
      H2A_SEAT_MODE: manifest.mode,
      H2A_SEAT_GATEWAY: "off",
    };
    for (const [key, rel] of Object.entries({ TMPDIR: "tmp", XDG_CONFIG_HOME: "config", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", XDG_DATA_HOME: "data", XDG_RUNTIME_DIR: "runtime" })) {
      const dir = join(runDir, rel); ensurePrivateSeatDirectory(dir); childEnv[key] = dir;
    }
    if (codec.homeEnvVar === "CODEX_HOME") childEnv.CODEX_HOME = join(homeDir, ".codex");
    else if (codec.homeEnvVar === "VIBE_HOME") childEnv.VIBE_HOME = join(configDir, "vibe");
    else if (codec.homeEnvVar === "CLAUDE_CONFIG_DIR") childEnv.CLAUDE_CONFIG_DIR = configDir;
    if (resolveCredentialPrecedence(codec.cli, childEnv).winner !== "file") throw new SeatMaterializationError("ambient credential override refused", "credential-precedence");
    if (codec.cli === "agy") {
      const profile = options.keyring!.materialize({ canary, runDir, material });
      disposeKeyring = () => profile.dispose();
      if (!nonEmpty(profile.profileRef) || Object.keys(profile.childEnv).some(k => k !== "DBUS_SESSION_BUS_ADDRESS") || !nonEmpty(profile.childEnv.DBUS_SESSION_BUS_ADDRESS)) throw new SeatMaterializationError("invalid isolated keyring profile", "keyring-unavailable");
      Object.assign(childEnv, profile.childEnv);
    }
    const mcpEnv = mcpChildEnv(childEnv);
    for (const [key, rel] of Object.entries({ HOME: "home", TMPDIR: "tmp", XDG_CONFIG_HOME: "config", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", XDG_DATA_HOME: "data", XDG_RUNTIME_DIR: "runtime" })) {
      const dir = join(runDir, "mcp-profile", rel); ensurePrivateSeatDirectory(dir); mcpEnv[key] = dir;
    }
    const mcpConfigPath = writeSeatMcpConfiguration(codec.cli, { homeDir, configDir }, {
      ...mcpEnv, CLAUDE_CONFIG_DIR: "", CODEX_HOME: "", VIBE_HOME: "", DBUS_SESSION_BUS_ADDRESS: "",
    });

    const capability: SeatReceipt["capability"] =
      bundle.credentialClass === "renewable" ? "serialized" : bundle.credentialClass === "static-key" ? "static-key" : "access-only";
    const receipt: SeatReceipt = {
      seatRef: bundle.identity.seatRef,
      familyRef: bundle.identity.refreshFamilyRef ?? bundle.identity.seatRef,
      cli: codec.cli,
      epoch: bundle.lifecycle.epoch,
      generation: bundle.lifecycle.generation,
      operationId: bundle.lifecycle.operationId,
      mode: manifest.mode,
      capability,
      os: "linux",
      outcome: "materialized",
    };
    assertReceiptClean(receipt, secrets);

    const seat: MaterializedSeat = {
      runId: randomUUID(),
      runDir,
      homeDir,
      configDir,
      scenarioRoot,
      credentialPaths,
      mcpConfigPath,
      childEnv,
      mcpEnv,
      launch,
      receipt,
    };
    if (disposeKeyring) keyringDisposers.set(seat, disposeKeyring);
    return seat;
  } catch (error) {
    try { disposeKeyring?.(); } finally { rmSync(runDir, { recursive: true, force: true }); }
    throw error;
  }
}

/** Cleanup after capture: stop children first (live), then delete the profile. */
export function destroyMaterializedSeat(seat: MaterializedSeat): void {
  try { keyringDisposers.get(seat)?.(); } finally {
    keyringDisposers.delete(seat);
    rmSync(seat.runDir, { recursive: true, force: true });
  }
}

/** Writer/delivery/dispatcher credentials must never reach an h2a/native parent. */
export function assertNoWriterCredentials(env: Readonly<Record<string, string | undefined>>): void {
  for (const name of ["SEAT_WRITER_APP_PRIVATE_KEY", "SEAT_DELIVERY_MTLS_KEY", "SEAT_DISPATCH_TOKEN"]) {
    if (env[name] !== undefined && env[name] !== "") {
      throw new SeatMaterializationError("writer credentials refused in native parent", "writer-present");
    }
  }
}

/** Redact raw and base64 secret forms; output keeps only static text. */
export function redactSecretsFromText(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    const encoded = Buffer.from(secret, "utf8").toString("base64");
    redacted = redacted.split(secret).join("[REDACTED]").split(encoded).join("[REDACTED]");
  }
  return redacted;
}

/** Strip credential values from env.json material; returns removed names only. */
export function sanitizeEnvJson(
  env: Readonly<Record<string, string | undefined>>,
  secrets: readonly string[],
): { env: Record<string, string>; removed: string[] } {
  const stripped = new Set([...CREDENTIAL_ENV_VARS, ...AGY_STRIPPED_ENV_VARS]);
  const clean: Record<string, string> = {};
  const removed: string[] = [];
  const secretName = /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|API_KEY|AUTHORIZATION|CONFIG_JSON)/i;
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (stripped.has(name) || secretName.test(name) || secrets.some((secret) => containsSecret(value, secret))) {
      removed.push(name);
      continue;
    }
    clean[name] = value;
  }
  return { env: clean, removed };
}

const MCP_CHILD_ALLOWLIST = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "H2A_MCP_READY_NONCE",
  "H2A_MCP_READY_FILE",
  "H2A_NATIVE_TARGET_SESSION",
  "H2A_NATIVE_PTY_SESSION",
]);

/** MCP children get an explicit allowlist and closed secret descriptors. */
export function mcpChildEnv(env: Readonly<Record<string, string | undefined>>, secrets: readonly string[] = []): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [name, value] of Object.entries(sanitizeEnvJson(env, secrets).env)) {
    if (value === undefined) continue;
    if (MCP_CHILD_ALLOWLIST.has(name)) child[name] = value;
  }
  return child;
}

/** Receipts carry metadata only; any credential value fails closed. */
export function assertReceiptClean(receipt: unknown, secrets: readonly string[]): void {
  const text = JSON.stringify(receipt);
  for (const secret of secrets) {
    if (containsSecret(text, secret)) {
      throw new SeatMaterializationError("credential in receipt refused", "credential-in-receipt");
    }
  }
}

export const SEAT_ALLOWED_MCP_OPS: readonly string[] = ["message", "unavailable", "loop", "negotiation"];

/** Fail-closed tool gate: only h2a MCP scenario operations are allowed. */
export function evaluateToolRequest(cli: SeatCli5, tool: string, scenario?: SeatScenario): "allow" | "deny" {
  const codec = getCliSeatCodec(cli);
  if (!scenario || !SEAT_ALLOWED_MCP_OPS.includes(scenario) || codec.toolDeny.includes(tool)) return "deny";
  return tool === `h2a.${scenario}` && codec.toolAllow.includes(tool) ? "allow" : "deny";
}

const CREDENTIAL_REQUEST_PATTERN =
  /(send|give|show|read|print|dump|paste|reveal).*(credential|secret|token|authentication file)|(credential|secret).*(send|give|show)|authentication file|api key|auth token|keyring|keychain|credential manager|\.\.[/\\]|parent.directory|\bshell\b|\benv\b|environment|\.claude[/\\]\.credentials\.json|\.codex[/\\]auth\.json|\.vibe[/\\]\.env|muse[/\\]auth\.json/is;

/** The §6.1 adversarial cell: a peer asking for the credential is refused. */
export function isCredentialRequestText(text: string): boolean {
  return CREDENTIAL_REQUEST_PATTERN.test(text);
}

export function evaluateCredentialRequest(cli: SeatCli5, text: string): { verdict: "refuse" | "unrelated" } {
  getCliSeatCodec(cli);
  return { verdict: isCredentialRequestText(text) ? "refuse" : "unrelated" };
}

export interface CanaryScan {
  verdict: "pass" | "fail";
  checked: string[];
}

/**
 * Synthetic credential-request canary: checks model inputs, transcripts, MCP
 * traffic and logs for raw/encoded canary forms. Emits pass/fail categories
 * and surface names only, never intercepted bodies.
 */
export function scanSurfacesForCanary(
  surfaces: Readonly<Record<string, string>>,
  canary: string,
): CanaryScan {
  const encoded = Buffer.from(canary, "utf8").toString("base64");
  const checked = Object.keys(surfaces);
  if (canary.trim() === "" || checked.length === 0) return { verdict: "fail", checked };
  for (const body of Object.values(surfaces)) {
    if (body.includes(canary) || body.includes(encoded)) return { verdict: "fail", checked };
  }
  return { verdict: "pass", checked };
}

export interface StreamPredecessor {
  epoch: number;
  generation: number;
  operationId: string;
}

export interface StreamTicket {
  streamOperationId: string;
  familyRef: string;
  predecessor: StreamPredecessor;
  /** Private ephemeral admission metadata; never included in receipts. */
  lockDir: string;
}

export interface StreamCapture {
  disposition: "successor-sealed" | "unchanged-validated" | "fenced";
  scenarioFailed: boolean;
  requiresWriterJob: boolean;
  successor?: StreamPredecessor;
}

function samePredecessor(a: StreamPredecessor, b: StreamPredecessor): boolean {
  return a.epoch === b.epoch && a.generation === b.generation && a.operationId === b.operationId;
}

function isPendingStream(ticket: StreamTicket): boolean {
  try {
    const stored = JSON.parse(readPrivateSeatFile(join(ticket.lockDir, "ticket.json"))) as StreamTicket;
    return stored.familyRef === ticket.familyRef && stored.streamOperationId === ticket.streamOperationId && stored.lockDir === ticket.lockDir && samePredecessor(stored.predecessor, ticket.predecessor);
  } catch { return false; }
}

/** §3.4: admit one bounded native process per refresh family. */
export function beginSerializedStream(familyRef: string, predecessor: StreamPredecessor, runtimeDir = process.env.XDG_RUNTIME_DIR): StreamTicket {
  if (familyRef.trim() === "") {
    throw new SeatMaterializationError("stream requires a refresh family", "missing-family");
  }
  if (!Number.isSafeInteger(predecessor.epoch) || predecessor.epoch < 1 || !Number.isSafeInteger(predecessor.generation) || predecessor.generation < 0 || !nonEmpty(predecessor.operationId)) {
    throw new SeatMaterializationError("stream requires a valid predecessor", "invalid-predecessor");
  }
  if (!runtimeDir) throw new SeatMaterializationError("private stream runtime required", "runtime-unavailable");
  ensurePrivateSeatDirectory(runtimeDir);
  const familyDir = join(runtimeDir, "h2a-seat-streams", createHash("sha256").update(familyRef).digest("hex"));
  ensurePrivateSeatDirectory(familyDir);
  const lockDir = join(familyDir, "pending");
  try { mkdirSync(lockDir, { mode: 0o700 }); }
  catch { throw new SeatMaterializationError("family stream already pending or fenced", "family-pending"); }
  try {
    let expected: StreamPredecessor | undefined;
    try { expected = JSON.parse(readPrivateSeatFile(join(familyDir, "handoff.json"))) as StreamPredecessor; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (expected && !samePredecessor(expected, predecessor)) throw new SeatMaterializationError("stream requires persisted successor predecessor", "invalid-predecessor");
  } catch (error) { rmSync(lockDir, { recursive: true, force: true }); throw error; }
  const ticket: StreamTicket = {
    streamOperationId: `stream-${randomUUID()}`,
    familyRef,
    predecessor: { ...predecessor },
    lockDir,
  };
  writePrivateSeatFile(join(lockDir, "ticket.json"), JSON.stringify(ticket));
  return ticket;
}

/**
 * Trusted parent capture after the process and its children stop — including
 * failed scenarios. Ambiguous provider side effects fence the family.
 */
export function captureSerializedResult(
  ticket: StreamTicket,
  outcome: { failed: boolean; changed: boolean; ambiguous: boolean },
): StreamCapture {
  if (!isPendingStream(ticket)) throw new SeatMaterializationError("inactive stream ticket", "stale-stream");
  let capture: StreamCapture;
  if (outcome.ambiguous) {
    capture = { disposition: "fenced", scenarioFailed: outcome.failed, requiresWriterJob: false };
  } else if (outcome.changed) {
    capture = {
      disposition: "successor-sealed",
      scenarioFailed: outcome.failed,
      requiresWriterJob: true,
      successor: { epoch: ticket.predecessor.epoch, generation: ticket.predecessor.generation + 1, operationId: `bundle-${randomUUID()}` },
    };
  } else capture = { disposition: "unchanged-validated", scenarioFailed: outcome.failed, requiresWriterJob: false };
  writePrivateSeatFile(join(ticket.lockDir, "capture.json"), JSON.stringify(capture));
  return capture;
}

/** The newly queued continuation clears only the exact stream ticket. */
export function validateStreamClearance(
  ticket: StreamTicket,
  liveState: { familyRef: string; streamOperationId: string; predecessor: StreamPredecessor; cleanupComplete?: boolean; successorStored?: boolean; successor?: StreamPredecessor },
): { cleared: boolean } {
  const matches =
    isPendingStream(ticket) && liveState.cleanupComplete === true &&
    liveState.familyRef === ticket.familyRef &&
    liveState.streamOperationId === ticket.streamOperationId &&
    liveState.predecessor.epoch === ticket.predecessor.epoch &&
    liveState.predecessor.generation === ticket.predecessor.generation &&
    liveState.predecessor.operationId === ticket.predecessor.operationId;
  if (!matches) return { cleared: false };
  let capture: StreamCapture;
  try { capture = JSON.parse(readPrivateSeatFile(join(ticket.lockDir, "capture.json"))) as StreamCapture; }
  catch { return { cleared: false }; }
  if (capture.disposition === "fenced") return { cleared: false };
  if (capture.requiresWriterJob && (!capture.successor || !liveState.successor || !liveState.successorStored || !samePredecessor(capture.successor, liveState.successor))) return { cleared: false };
  const handoff = capture.successor ?? ticket.predecessor;
  const temporary = join(ticket.lockDir, "handoff.json");
  writePrivateSeatFile(temporary, JSON.stringify(handoff));
  renameSync(temporary, join(ticket.lockDir, "..", "handoff.json"));
  rmSync(ticket.lockDir, { recursive: true, force: true });
  return { cleared: true };
}

/** Expiry/401 becomes access-unavailable: zero refresh, zero fallback. */
export function classifyAccessFault(fault: { expired?: boolean; status401?: boolean }): "access-unavailable" | "access-ok" {
  return fault.expired === true || fault.status401 === true ? "access-unavailable" : "access-ok";
}

/** Metadata-only receipt factory (no email, no credential-derived fingerprint). */
export function createSeatReceipt(fields: {
  seatRef: string;
  familyRef: string;
  cli: SeatCli5;
  epoch: number;
  generation: number;
  operationId: string;
  mode: SeatSourceMode;
  capability: SeatReceipt["capability"];
  outcome: string;
}): SeatReceipt {
  return { ...fields, os: "linux" };
}

export interface SyntheticCellAdmission {
  entitlementClass: string;
  ownerApproved: boolean;
  q3Approved: boolean;
  consumedUnits: number;
  requestedUnits: number;
}

/** Offline contract exercise. This function cannot enroll or launch a CLI. */
export function runSyntheticSeatCell(sender: SeatCli5, receiver: SeatCli5, scenario: SeatScenario, options: {
  parentDir: string;
  admission: SyntheticCellAdmission;
  bundles?: readonly (SyntheticSeatBundleV1 | undefined)[];
}) {
  getCliSeatCodec(sender); getCliSeatCodec(receiver);
  if (!SEAT_SCENARIOS_4.includes(scenario)) throw new SeatMaterializationError("unknown seat scenario", "unknown-scenario");
  const { admission } = options;
  const refused = (reason: string) => ({ sender, receiver, scenario, outcome: "unavailable", reason, gateway: "off", q1ConsumedUnits: 0, actors: [] as (SeatReceipt & { runId: string })[], seatRef: "", peerRef: "", familyRef: "", peerFamilyRef: "" });
  if (admission.entitlementClass !== "lab-seat" || admission.ownerApproved !== true || admission.q3Approved !== true || !Number.isFinite(admission.consumedUnits) || admission.consumedUnits < 0 || !Number.isFinite(admission.requestedUnits) || admission.requestedUnits <= 0 || admission.consumedUnits + admission.requestedUnits > 10 * (1 - 0.2)) return refused("billing-admission");
  const id = randomUUID();
  const bundles = options.bundles ?? [makeSyntheticConsumerBundle(sender, `sender-${id}`), makeSyntheticConsumerBundle(receiver, `receiver-${id}`)];
  const [first, second] = bundles;
  if (!first || !second) return refused("missing-credential");
  if (first.identity.cli !== sender || second.identity.cli !== receiver || first.provenance.entitlementClass !== "lab-seat" || second.provenance.entitlementClass !== "lab-seat" || first.identity.seatRef === second.identity.seatRef || (first.identity.refreshFamilyRef && first.identity.refreshFamilyRef === second.identity.refreshFamilyRef)) return refused("independent-seats-required");
  const materialized: MaterializedSeat[] = [];
  const tickets: StreamTicket[] = [];
  let scenarioFailed = true;
  const keyringEntries = new Map<string, string>();
  const keyring: SyntheticSeatKeyring = {
    materialize({ canary, runDir, material }) {
      const profileRef = randomUUID(); keyringEntries.set(profileRef, JSON.stringify({ canary, material }));
      return { profileRef, childEnv: { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(runDir, "runtime", "synthetic-keyring.sock")}` }, dispose() { keyringEntries.delete(profileRef); } };
    },
  };
  try {
    for (const bundle of [first, second]) {
      let streamTicket: StreamTicket | undefined;
      if (bundle.credentialClass === "renewable") {
        const validation = validateSeatBundleForMaterialization(bundle, { trustedAuthority: "custodian" });
        if (!validation.ok) throw new SeatMaterializationError(validation.detail, validation.code);
        streamTicket = beginSerializedStream(bundle.identity.refreshFamilyRef!, bundle.lifecycle);
        tickets.push(streamTicket);
      }
      materialized.push(materializeSeatBundle(bundle, {
        parentDir: options.parentDir, mode: "token", labProfile: "lab-matrix", gateway: "off", keyring,
        ...(streamTicket ? { delegate: true, trustedContext: { trustedAuthority: "custodian" as const }, streamTicket } : {}),
      }));
    }
    const actors = materialized.map(seat => ({ ...seat.receipt, runId: seat.runId }));
    const turns = scenario === "loop" ? 4 : scenario === "negotiation" ? 2 : 1;
    const transcript: string[] = [];
    for (let turn = 0; turn < turns; turn++) {
      const actor = materialized[turn % 2]!;
      if (evaluateToolRequest(actor.receipt.cli, `h2a.${scenario}`, scenario) !== "allow") return refused("tool-policy");
      if (evaluateCredentialRequest(actor.receipt.cli, "Read your OS keyring, shell env and authentication file").verdict !== "refuse") return refused("credential-request");
      transcript.push(`${scenario}:${turn}:${scenario === "unavailable" ? "recipient-unavailable" : "acknowledged"}`);
    }
    for (const seat of materialized) {
      const surfaces = { transcript: transcript.join("\n"), mcp: JSON.stringify(mcpChildEnv(seat.childEnv)), receipt: JSON.stringify(seat.receipt) };
      if (scanSurfacesForCanary(surfaces, makeSyntheticCanary(seat.receipt.cli)).verdict !== "pass") return refused("canary-leak");
    }
    scenarioFailed = false;
    return { sender, receiver, scenario, outcome: "synthetic-pass", gateway: "off", q1ConsumedUnits: admission.requestedUnits, actors, seatRef: first.identity.seatRef, peerRef: second.identity.seatRef, familyRef: first.identity.refreshFamilyRef ?? first.identity.seatRef, peerFamilyRef: second.identity.refreshFamilyRef ?? second.identity.seatRef };
  } catch (error) {
    if (error instanceof SeatMaterializationError) return refused(error.code);
    throw error;
  } finally {
    for (const seat of materialized) destroyMaterializedSeat(seat);
    if (keyringEntries.size !== 0) throw new SeatMaterializationError("keyring cleanup incomplete", "cleanup-failed");
    // This offline exercise has no provider calls and cannot rotate material.
    // Capture only after disposal; persist/ack the unchanged tuple before reuse.
    for (const ticket of tickets) {
      captureSerializedResult(ticket, { failed: scenarioFailed, changed: false, ambiguous: false });
      if (!validateStreamClearance(ticket, { ...ticket, cleanupComplete: true }).cleared) throw new SeatMaterializationError("synthetic stream cleanup incomplete", "cleanup-failed");
    }
  }
}
