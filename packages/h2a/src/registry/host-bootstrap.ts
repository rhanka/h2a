/**
 * R5 host bootstrap through the registry (h2a side).
 *
 * One bridge declaration per host, always under the stable server key `h2a`
 * (contract §7, RC2-M2 continuity): JSON `mcpServers.h2a` for
 * claude/codex/agy/muse, one `[[mcp_servers]]` entry named `h2a` for vibe.
 * The bridge command is the h2a-owned interim
 * `h2a registry-bridge serve --host <host> --profile <profile>` until the
 * later R7a `sentropic-registry` executable ships; the installation receipt
 * records the bridge identity so that swap stays explicit.
 *
 * Only an explicit operator invocation of `installBridgeEntry`,
 * `uninstallBridgeEntry` (or the CLI verbs wiring them) writes a host
 * config or a receipt. Rendering, preview and every launch path write
 * nothing. Migrating a legacy direct entry (including Vibe's interim direct
 * entry from PR #346) is one previewed atomic transaction: failure restores
 * the original bytes pre-acceptance, and there is never a window with two
 * `h2a` entries.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { replaceJsonEntry } from "../hosts/json-entry.js";
import { RegistryError, type RegistryEntry } from "./descriptors.js";
import { provisionBridgeLock } from "./bridge-lock.js";
import {
  isBridgeServer as isCodexBridgeServer,
  isH2aServerName as isCodexH2aServerName,
  isLegacyDirectServer as isCodexLegacyDirectServer,
  legacyCodexDeviation,
  parseCodexToml,
  readCodexServers,
  removeCodexH2a,
  upsertCodexH2a,
  type CodexServer
} from "./codex-toml.js";
import { isBridgeServer, isH2aServerName, isLegacyDirectServer, readVibeServers, removeVibeH2a, upsertVibeH2a } from "./vibe-toml.js";

export const BRIDGE_SERVER_KEY = "h2a";
export const SUPPORTED_HOSTS = ["claude", "codex", "agy", "muse", "vibe"] as const;
export type RegistryHost = (typeof SUPPORTED_HOSTS)[number];
export type RegistryMechanism = "plugin" | "file";

function fail(message: string): never {
  throw new RegistryError("invalid_entry", message);
}

export function assertRegistryHost(host: string): asserts host is RegistryHost {
  if (!(SUPPORTED_HOSTS as readonly string[]).includes(host)) {
    throw new RegistryError("unsupported_host", `unknown registry host ${JSON.stringify(host)}: expected one of ${SUPPORTED_HOSTS.join(", ")}`);
  }
}

/** Plugin mechanism exists for claude/codex; agy/muse/vibe migrate file-first. */
export function defaultMechanism(host: RegistryHost): RegistryMechanism {
  void host;
  return "file";
}

export function bridgeArgs(host: RegistryHost, profile: string): string[] {
  if (!profile || /[\s]/.test(profile)) fail("profile must be a nonempty token without whitespace");
  return ["registry-bridge", "serve", "--host", host, "--profile", profile];
}

export interface BridgeEndpoint {
  command: string;
  args: string[];
}

/** Exactly one bridge declaration, always keyed `h2a`. */
export function renderBridgeEntry(
  host: RegistryHost,
  options: { profile?: string; command?: string; lockPath?: string } = {}
): { entry: { h2a: BridgeEndpoint }; args: string[] } {
  assertRegistryHost(host);
  const profile = options.profile ?? "default";
  const args = bridgeArgs(host, profile);
  if (options.lockPath !== undefined) args.push("--lock", options.lockPath);
  return { entry: { h2a: { command: options.command ?? "h2a", args } }, args };
}

/** Default bridge-lock path provisioned next to the host config (see bridge-lock.ts). */
export function defaultInstallLockPath(configPath: string): string {
  return `${configPath}.h2a-lock.json`;
}

/** Read the installer receipt for a host config, or null when not registry-managed. */
export function readInstallReceipt(configPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(receiptPathFor(configPath), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Host-visible qualified tool identifiers. The server key stays `h2a` on
 * every renderer, preserving `mcp__h2a__*` (and, where the host generates
 * it, `mcp__plugin_h2a_h2a__*`). A renamed key must fail this mapping even
 * when wire names match.
 */
export function qualifiedToolId(host: RegistryHost, mechanism: RegistryMechanism, toolName: string): string {
  assertRegistryHost(host);
  if (!/^[a-z0-9_]+$/i.test(toolName)) fail(`tool name ${JSON.stringify(toolName)} is not a qualified-name atom`);
  if (mechanism === "plugin") return `mcp__plugin_h2a_h2a__${toolName}`;
  if (mechanism === "file") return `mcp__h2a__${toolName}`;
  fail(`unknown mechanism ${JSON.stringify(mechanism)}`);
}

/**
 * Test-only interposition seam for deterministic transaction tests: the
 * test harness injects faults (concurrent edits, receipt/lock sabotage) at
 * exact transaction phases. Never set outside tests — there is no published
 * fault-injection surface (no CLI flag, no env var reads this field).
 */
export interface HostBootstrapInterpose {
  /** After the original bytes are captured, before staging is written. */
  afterRead?: (target: string) => void;
  /** After the candidate is published (rename), before the receipt write. */
  afterPublish?: (target: string, published: string) => void;
  /** After the receipt write, before the post-publish commit (lock). */
  afterReceipt?: (target: string) => void;
}

export interface InstallOptions {
  host: string;
  configPath: string;
  profile?: string;
  dryRun?: boolean;
  lockPath?: string;
  interpose?: HostBootstrapInterpose;
  /** Packed entries for in-transaction lock provisioning; absent skips it. */
  h2aEntry?: RegistryEntry;
  trackEntry?: RegistryEntry;
}

export interface InstallPreview {
  action: "install" | "migrate-direct" | "reinstall-identical" | "conflict";
  reason: string;
}

export type InstallLockAction = "provisioned" | "already-present" | "skipped-dry-run" | "skipped-no-entries";

export interface InstallResult {
  action: "installed" | "migrate-direct" | "reinstall-identical";
  backupPath?: string;
  receiptPath: string;
  lockAction: InstallLockAction;
}

const H2A_COMMAND = /(^|[\\/])h2a(\.cmd|\.exe)?$/i;
const NON_DEFAULT_FLAGS = ["--no-wake", "--name", "--instance", "--backend"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function receiptPathFor(configPath: string): string {
  return `${configPath}.h2a-registry.json`;
}

function writeReceipt(configPath: string, record: Record<string, unknown>): string {
  const receiptPath = receiptPathFor(configPath);
  writeReceiptRecord(receiptPath, record);
  return receiptPath;
}

export interface AtomicWriteReceipt {
  path: string;
  record: Record<string, unknown>;
  snapshot: FileSnapshot;
}

export interface AtomicWriteLock {
  path: string;
  snapshot: FileSnapshot;
}

export interface AtomicWriteOptions {
  receipt?: AtomicWriteReceipt;
  lock?: AtomicWriteLock;
  interpose?: HostBootstrapInterpose;
  /** Post-receipt commit (lock provisioning): runs inside the transaction. */
  commit?: () => void;
}

function writeReceiptRecord(receiptPath: string, record: Record<string, unknown>): void {
  writeFileSync(receiptPath, `${JSON.stringify({ format: "h2a.registry-install/v1", ...record }, null, 2)}\n`, { mode: 0o600 });
}

/** Prior existence/bytes of a transaction artefact (receipt, lock). */
export interface FileSnapshot {
  exists: boolean;
  bytes: Buffer | null;
}

function snapshotFile(path: string): FileSnapshot {
  try {
    if (statSync(path).isDirectory()) return { exists: true, bytes: null };
    return { exists: true, bytes: readFileSync(path) };
  } catch {
    return { exists: false, bytes: null };
  }
}

/**
 * Restore a snapshotted artefact: pre-existing bytes are rewritten,
 * transaction-created paths are removed. Only the transaction calls this,
 * only for paths it snapshotted at preflight.
 */
function restoreSnapshot(path: string, snapshot: FileSnapshot): void {
  if (snapshot.exists && snapshot.bytes) {
    try {
      if (statSync(path).isDirectory()) rmSync(path, { recursive: true, force: true });
    } catch {
      /* absent: the write below recreates it */
    }
    writeFileSync(path, snapshot.bytes);
    return;
  }
  if (snapshot.exists && !snapshot.bytes) {
    throw new RegistryError("invalid_entry", `cannot snapshot directory at ${path}; refusing to alter it`);
  }
  try {
    if (statSync(path).isDirectory()) rmSync(path, { recursive: true, force: true });
    else unlinkSync(path);
  } catch {
    /* already absent: the pre-install state */
  }
}

/**
 * Compare-and-replace rollback for self-published bytes. Restores the exact
 * pre-install bytes while the target still holds what this transaction
 * published (recreating it when it vanished, removing it when this
 * transaction created it). A concurrent user edit that arrived after
 * publication is preserved and yields the named irrecoverable state instead
 * of being overwritten. A failed restore surfaces distinctly and the
 * transaction record (receipt) names it.
 */
function rollbackPublishedTarget(target: string, published: string, original: Buffer | null, backupPath: string | undefined): void {
  let current: Buffer | null = null;
  try {
    current = existsSync(target) ? readFileSync(target) : null;
  } catch {
    current = null;
  }
  const stillOurs = current !== null && current.toString("utf8") === published;
  if (!stillOurs && current !== null) {
    throw new RegistryError(
      "published_then_edited",
      `host config at ${target} changed after this transaction published; concurrent bytes preserved, ` +
      `pre-install bytes kept at ${backupPath ?? "no backup (target was created by this transaction)"}`
    );
  }
  try {
    if (original) writeFileSync(target, original);
    else if (stillOurs) unlinkSync(target);
    // Created-then-vanished: absence already matches the pre-install state.
  } catch (restoreError) {
    const failure = {
      action: "restore-failed",
      target,
      restoreError: (restoreError as Error)?.message ?? String(restoreError)
    };
    try {
      writeReceiptRecord(receiptPathFor(target), failure);
    } catch {
      /* the receipt itself is unwritable: restore_failed below still carries the cause */
    }
    throw new RegistryError(
      "restore_failed",
      `failed to roll back ${target} (${failure.restoreError}); see ${receiptPathFor(target)}`
    );
  }
}

function atomicWriteWithBackup(target: string, next: string, options: AtomicWriteOptions = {}): { backupPath?: string } {
  const existed = existsSync(target);
  const original = existed ? readFileSync(target) : null;
  if (original && original.toString("utf8") === next) return {};
  const backupPath = existed ? `${target}.backup-${randomUUID()}` : undefined;
  if (backupPath && original) writeFileSync(backupPath, original, { flag: "wx", mode: 0o600 });
  mkdirSync(dirname(target), { recursive: true });
  options.interpose?.afterRead?.(target);
  const staging = `${target}.${randomUUID()}.tmp`;
  let published: string | null = null;
  let commitAttempted = false;
  try {
    writeFileSync(staging, next, { flag: "wx", mode: 0o600 });
    if (existed && readFileSync(target).toString("utf8") !== (original as Buffer).toString("utf8")) {
      throw new RegistryError("invalid_entry", "host config changed while preparing the edit; refusing to overwrite it");
    }
    renameSync(staging, target);
    published = next;
    options.interpose?.afterPublish?.(target, next);
    // The receipt is part of the transaction: a receipt failure after the
    // rename rolls back, never leaving a migrated config without its record.
    if (options.receipt) writeReceiptRecord(options.receipt.path, options.receipt.record);
    options.interpose?.afterReceipt?.(target);
    // Lock provisioning is part of the same transaction: its failure rolls
    // back config and receipt identically.
    if (options.commit) {
      commitAttempted = true;
      options.commit();
    }
  } catch (error) {
    try {
      if (existsSync(staging)) unlinkSync(staging);
    } catch {
      /* staging cleanup is best-effort; the error below carries the failure */
    }
    if (published !== null) {
      // Restore covers only self-published bytes (compare-and-replace). The
      // not-yet-published case never touches the target: a concurrent edit
      // detected before rename stays exactly as the operator left it.
      // Artefact cleanup runs even when the rollback itself reports the
      // named irrecoverable state: the named state takes precedence, a
      // cleanup failure is appended, never silent.
      let rollbackError: unknown = null;
      try {
        rollbackPublishedTarget(target, published, original, backupPath);
      } catch (rollback) {
        rollbackError = rollback;
      }
      let cleanupError: unknown = null;
      try {
        if (options.receipt) restoreSnapshot(options.receipt.path, options.receipt.snapshot);
        if (options.lock && commitAttempted) restoreSnapshot(options.lock.path, options.lock.snapshot);
      } catch (cleanup) {
        cleanupError = cleanup;
      }
      if (rollbackError) {
        if (cleanupError) {
          (rollbackError as Error).message +=
            `; artefact cleanup also failed (${(cleanupError as Error)?.message ?? String(cleanupError)})`;
        }
        throw rollbackError;
      }
      if (cleanupError) throw cleanupError;
    }
    throw error;
  }
  return backupPath ? { backupPath } : {};
}

/** Plugin and file mechanisms for one host/profile are mutually exclusive. */
function refuseConflictingMechanism(host: string, profile: string, configPath: string): void {
  const receipt = readInstallReceipt(configPath);
  if (!receipt) return;
  if (receipt["host"] !== host || (receipt["profile"] ?? "default") !== profile) return;
  const recorded = receipt["mechanism"];
  if (recorded !== undefined && recorded !== "file") {
    throw new RegistryError(
      "invalid_entry",
      `conflicting mechanism ${JSON.stringify(recorded)} recorded for host=${host} profile=${profile} ` +
      `at ${receiptPathFor(configPath)}; file install refused (duplicate mechanism)`
    );
  }
}

export interface InstallPreflight {
  receiptPath: string;
  receiptSnapshot: FileSnapshot;
  lockSnapshot: FileSnapshot;
}

/**
 * Preflight everything preflightable before publishing config bytes: the
 * receipt path must be writable (never a directory) and the lock path must
 * be usable. Preflight failures refuse before publication and are never
 * cited as rollback evidence. Prior receipt/lock bytes are snapshotted for
 * rollback restoration.
 */
function preflightInstall(configPath: string, lockPath: string): InstallPreflight {
  const receiptPath = receiptPathFor(configPath);
  if (existsSync(receiptPath) && statSync(receiptPath).isDirectory()) {
    throw new RegistryError("invalid_entry", `receipt path at ${receiptPath} is a directory; refusing before publication`);
  }
  if (existsSync(lockPath) && statSync(lockPath).isDirectory()) {
    throw new RegistryError("invalid_entry", `lock path at ${lockPath} is a directory; refusing before publication`);
  }
  return { receiptPath, receiptSnapshot: snapshotFile(receiptPath), lockSnapshot: snapshotFile(lockPath) };
}

/** In-transaction lock provisioning for installs carrying packed entries. */
function provisionTxLock(
  lockPath: string,
  host: RegistryHost,
  profile: string,
  h2aEntry: RegistryEntry | undefined,
  trackEntry: RegistryEntry | undefined
): { commit: (() => void) | undefined; getAction: () => InstallLockAction } {
  if (!h2aEntry || !trackEntry) return { commit: undefined, getAction: () => "skipped-no-entries" as const };
  let action: InstallLockAction = "skipped-no-entries";
  const bridge = {
    command: "h2a",
    args: ["registry-bridge", "serve", "--host", host, "--profile", profile, "--lock", lockPath]
  };
  return {
    commit: () => {
      action = provisionBridgeLock({ lockPath, host, profile, bridge, h2aEntry, trackEntry }).action;
    },
    getAction: () => action
  };
}

function legacyJsonDeviation(entry: Record<string, unknown>): string | null {
  const args = entry["args"];
  if (Array.isArray(args)) {
    for (const flag of NON_DEFAULT_FLAGS) {
      if ((args as unknown[]).includes(flag)) {
        return `${flag} is a non-default legacy declaration: migrate it explicitly instead of normalizing it silently`;
      }
    }
  }
  if (entry["env"] !== undefined || entry["url"] !== undefined || entry["type"] !== undefined) {
    return "legacy h2a entry carries env/url/type fields: migrate it explicitly instead of normalizing it silently";
  }
  return null;
}

function isLegacyDirectJson(entry: unknown): boolean {
  if (!isPlainObject(entry)) return false;
  if (typeof entry["command"] !== "string" || !H2A_COMMAND.test(entry["command"] as string)) return false;
  const args = entry["args"];
  if (entry["url"] !== undefined) return false;
  return Array.isArray(args) && (args as unknown[]).includes("mcp-serve");
}

/** Byte-preserving removal of one nested JSON member (complements replaceJsonEntry). */
export function removeJsonEntry(raw: string, path: readonly string[]): string {
  JSON.parse(raw);
  interface Member {
    key: string;
    keyStart: number;
    valueStart: number;
    valueEnd: number;
  }
  const readString = (at: number): { value: string; end: number } => {
    let cursor = at + 1;
    for (;;) {
      const ch = raw[cursor];
      if (ch === "\\") {
        cursor += 2;
        continue;
      }
      if (ch === '"') {
        return { value: JSON.parse(raw.slice(at, cursor + 1)) as string, end: cursor + 1 };
      }
      if (cursor >= raw.length) throw new RegistryError("invalid_entry", "unterminated JSON string");
      cursor++;
    }
  };
  const skipValue = (at: number): number => {
    let cursor = at;
    const ws = (): void => {
      while (cursor < raw.length && /\s/.test(raw[cursor] as string)) cursor++;
    };
    ws();
    const ch = raw[cursor];
    if (ch === '"') return readString(cursor).end;
    if (ch === "{" || ch === "[") {
      cursor++;
      let depth = 1;
      while (cursor < raw.length && depth > 0) {
        const c = raw[cursor] as string;
        if (c === '"') {
          cursor = readString(cursor).end;
          continue;
        }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        cursor++;
      }
      return cursor;
    }
    while (cursor < raw.length && ![",", "}", "]"].includes(raw[cursor] as string)) cursor++;
    return cursor;
  };
  const membersOf = (braceAt: number): { members: Member[]; open: number; close: number } => {
    let cursor = braceAt + 1;
    const members: Member[] = [];
    const seen = new Set<string>();
    for (;;) {
      while (cursor < raw.length && /\s/.test(raw[cursor] as string)) cursor++;
      if (raw[cursor] === "}") return { members, open: braceAt, close: cursor };
      const keyStart = cursor;
      const { value: key, end: keyEnd } = readString(cursor);
      if (seen.has(key)) throw new RegistryError("invalid_entry", `duplicate JSON member ${key}; refusing an ambiguous edit`);
      seen.add(key);
      cursor = keyEnd;
      while (cursor < raw.length && /\s/.test(raw[cursor] as string)) cursor++;
      cursor++; // colon; the whole document already parsed
      while (cursor < raw.length && /\s/.test(raw[cursor] as string)) cursor++;
      const valueStart = cursor;
      const valueEnd = skipValue(cursor);
      members.push({ key, keyStart, valueStart, valueEnd });
      cursor = valueEnd;
      while (cursor < raw.length && /\s/.test(raw[cursor] as string)) cursor++;
      if (raw[cursor] === ",") cursor++;
    }
  };
  const navigate = (braceAt: number, remaining: readonly string[]): { parent: { members: Member[]; open: number; close: number }; member: Member } => {
    const parent = membersOf(braceAt);
    const member = parent.members.find((m) => m.key === remaining[0]);
    if (!member) throw new RegistryError("invalid_entry", `JSON member ${remaining[0]} is absent`);
    if (remaining.length === 1) return { parent, member };
    return navigate(member.valueStart, remaining.slice(1));
  };
  if (path.length === 0) throw new RegistryError("invalid_entry", "JSON entry path is required");
  const { parent, member } = navigate(0, path);
  const siblings = parent.members.filter((m) => m.key !== member.key);
  if (siblings.length === 0) return `${raw.slice(0, parent.open + 1)}${raw.slice(parent.close)}`;
  const index = parent.members.indexOf(member);
  if (index === 0) {
    const next = siblings[0] as Member;
    return raw.slice(0, member.keyStart) + raw.slice(next.keyStart);
  }
  const prevEnd = parent.members[index - 1]?.valueEnd as number;
  return raw.slice(0, prevEnd) + raw.slice(member.valueEnd);
}

function classifyJsonHost(current: unknown, wanted: { h2a: BridgeEndpoint }): InstallPreview {
  if (current === undefined) return { action: "install", reason: "no h2a entry present" };
  if (deepEqualJson(current, wanted.h2a)) return { action: "reinstall-identical", reason: "bridge entry already installed byte-identically" };
  if (isLegacyDirectJson(current)) {
    const deviation = legacyJsonDeviation(current as Record<string, unknown>);
    if (deviation) return { action: "conflict", reason: deviation };
    return { action: "migrate-direct", reason: "legacy direct h2a mcp-serve entry" };
  }
  return { action: "conflict", reason: "unknown same-key h2a ownership: refusing to overwrite it" };
}

function installJsonHost(
  host: RegistryHost,
  configPath: string,
  profile: string,
  dryRun: boolean,
  lockPath: string,
  tx: { interpose?: HostBootstrapInterpose; h2aEntry?: RegistryEntry; trackEntry?: RegistryEntry }
): InstallResult {
  const { entry } = renderBridgeEntry(host, { profile, lockPath });
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf8") : "{}\n";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new RegistryError("invalid_entry", `host config at ${configPath} is not JSON`);
  }
  if (parsed["mcpServers"] !== undefined && !isPlainObject(parsed["mcpServers"])) {
    throw new RegistryError("invalid_entry", "mcpServers must be an object");
  }
  refuseConflictingMechanism(host, profile, configPath);
  const preflight = preflightInstall(configPath, lockPath);
  const preview = classifyJsonHost((parsed["mcpServers"] as Record<string, unknown> | undefined)?.["h2a"], entry);
  if (preview.action === "conflict") throw new RegistryError("invalid_entry", `not migrating ${configPath}: ${preview.reason}`);
  const lockTx = provisionTxLock(lockPath, host, profile, tx.h2aEntry, tx.trackEntry);
  if (preview.action === "reinstall-identical") {
    if (!existsSync(preflight.receiptPath) && !dryRun) {
      writeReceipt(configPath, { host, profile, mechanism: "file", bridge: entry.h2a, lockPath, action: "reinstall-identical" });
    }
    if (dryRun) return { action: "reinstall-identical", receiptPath: preflight.receiptPath, lockAction: "skipped-dry-run" };
    if (lockTx.commit) {
      try {
        lockTx.commit();
      } catch (error) {
        restoreSnapshot(preflight.receiptPath, preflight.receiptSnapshot);
        throw error;
      }
    }
    return { action: "reinstall-identical", receiptPath: preflight.receiptPath, lockAction: lockTx.getAction() };
  }
  const next = replaceJsonEntry(raw, ["mcpServers", BRIDGE_SERVER_KEY], entry.h2a);
  try {
    JSON.parse(next);
  } catch {
    throw new RegistryError("invalid_entry", `rendered candidate for ${configPath} is not JSON; refusing to publish it`);
  }
  const resultAction = preview.action === "install" ? "installed" : preview.action;
  if (dryRun) return { action: resultAction, receiptPath: preflight.receiptPath, lockAction: "skipped-dry-run" };
  const { backupPath } = atomicWriteWithBackup(configPath, next, {
    receipt: {
      path: preflight.receiptPath,
      record: { host, profile, mechanism: "file", bridge: entry.h2a, lockPath, action: preview.action },
      snapshot: preflight.receiptSnapshot
    },
    lock: { path: lockPath, snapshot: preflight.lockSnapshot },
    interpose: tx.interpose,
    commit: lockTx.commit
  });
  return { action: resultAction, ...(backupPath ? { backupPath } : {}), receiptPath: preflight.receiptPath, lockAction: lockTx.getAction() };
}

function classifyCodexHost(current: CodexServer | undefined): InstallPreview {
  if (current === undefined) return { action: "install", reason: "no h2a entry present" };
  if (isCodexBridgeServer(current)) return { action: "reinstall-identical", reason: "bridge entry already installed" };
  if (isCodexLegacyDirectServer(current)) return { action: "migrate-direct", reason: "legacy direct h2a [mcp_servers.h2a] entry" };
  const deviation = legacyCodexDeviation(current);
  if (deviation !== null && (current.args ?? []).includes("mcp-serve")) {
    return { action: "conflict", reason: deviation };
  }
  return { action: "conflict", reason: "unknown same-key h2a ownership: refusing to overwrite it" };
}

function installCodexHost(
  configPath: string,
  profile: string,
  dryRun: boolean,
  lockPath: string,
  tx: { interpose?: HostBootstrapInterpose; h2aEntry?: RegistryEntry; trackEntry?: RegistryEntry }
): InstallResult {
  const { entry } = renderBridgeEntry("codex", { profile, lockPath });
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  // Format is chosen by host: a JSON-shaped config.toml is refused here,
  // before any write is considered.
  const servers = readCodexServers(raw);
  const owned = servers.filter((server) => isCodexH2aServerName(server.name));
  let preview: InstallPreview;
  if (owned.length > 1) {
    preview = { action: "conflict", reason: "duplicate h2a [mcp_servers.*] tables: resolve the conflict by hand" };
  } else {
    preview = classifyCodexHost(owned[0] as CodexServer | undefined);
  }
  refuseConflictingMechanism("codex", profile, configPath);
  const preflight = preflightInstall(configPath, lockPath);
  if (preview.action === "conflict") throw new RegistryError("invalid_entry", `not migrating ${configPath}: ${preview.reason}`);
  const lockTx = provisionTxLock(lockPath, "codex", profile, tx.h2aEntry, tx.trackEntry);
  const { text: next, changed } = upsertCodexH2a(raw, entry.h2a.command, entry.h2a.args);
  if (preview.action === "reinstall-identical" || !changed) {
    if (!existsSync(preflight.receiptPath) && !dryRun) {
      writeReceipt(configPath, { host: "codex", profile, mechanism: "file", bridge: entry.h2a, lockPath, action: "reinstall-identical" });
    }
    if (dryRun) return { action: "reinstall-identical", receiptPath: preflight.receiptPath, lockAction: "skipped-dry-run" };
    if (lockTx.commit) {
      try {
        lockTx.commit();
      } catch (error) {
        restoreSnapshot(preflight.receiptPath, preflight.receiptSnapshot);
        throw error;
      }
    }
    return { action: "reinstall-identical", receiptPath: preflight.receiptPath, lockAction: lockTx.getAction() };
  }
  const resultAction = preview.action === "install" ? "installed" : preview.action;
  if (dryRun) return { action: resultAction, receiptPath: preflight.receiptPath, lockAction: "skipped-dry-run" };
  const { backupPath } = atomicWriteWithBackup(configPath, next, {
    receipt: {
      path: preflight.receiptPath,
      record: { host: "codex", profile, mechanism: "file", bridge: entry.h2a, lockPath, action: preview.action },
      snapshot: preflight.receiptSnapshot
    },
    lock: { path: lockPath, snapshot: preflight.lockSnapshot },
    interpose: tx.interpose,
    commit: lockTx.commit
  });
  return { action: resultAction, ...(backupPath ? { backupPath } : {}), receiptPath: preflight.receiptPath, lockAction: lockTx.getAction() };
}

function installVibeHost(
  configPath: string,
  profile: string,
  dryRun: boolean,
  lockPath: string,
  tx: { interpose?: HostBootstrapInterpose; h2aEntry?: RegistryEntry; trackEntry?: RegistryEntry }
): InstallResult {
  const { entry } = renderBridgeEntry("vibe", { profile, lockPath });
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const servers = readVibeServers(raw);
  const owned = servers.filter((server) => isH2aServerName(server.name));
  let preview: InstallPreview;
  if (owned.length > 1) {
    preview = { action: "conflict", reason: "duplicate h2a [[mcp_servers]] blocks: resolve the conflict by hand" };
  } else if (owned.length === 0) {
    preview = { action: "install", reason: "no h2a entry present" };
  } else {
    const target = owned[0] as (typeof owned)[number];
    if (isBridgeServer(target)) {
      preview = { action: "reinstall-identical", reason: "bridge entry already installed" };
    } else if (isLegacyDirectServer(target)) {
      preview = target.transport !== undefined && target.transport !== "stdio"
        ? { action: "conflict", reason: `legacy h2a entry uses transport ${target.transport}: migrate it explicitly` }
        : { action: "migrate-direct", reason: "interim direct h2a [[mcp_servers]] entry" };
    } else {
      preview = { action: "conflict", reason: "unknown same-key h2a ownership: refusing to overwrite it" };
    }
  }
  refuseConflictingMechanism("vibe", profile, configPath);
  const preflight = preflightInstall(configPath, lockPath);
  if (preview.action === "conflict") throw new RegistryError("invalid_entry", `not migrating ${configPath}: ${preview.reason}`);
  const lockTx = provisionTxLock(lockPath, "vibe", profile, tx.h2aEntry, tx.trackEntry);
  const { text: next, changed } = upsertVibeH2a(raw, entry.h2a.command, entry.h2a.args);
  if (!changed) {
    if (!existsSync(preflight.receiptPath) && !dryRun) {
      writeReceipt(configPath, { host: "vibe", profile, mechanism: "file", bridge: entry.h2a, lockPath, action: "reinstall-identical" });
    }
    if (dryRun) return { action: "reinstall-identical", receiptPath: preflight.receiptPath, lockAction: "skipped-dry-run" };
    if (lockTx.commit) {
      try {
        lockTx.commit();
      } catch (error) {
        restoreSnapshot(preflight.receiptPath, preflight.receiptSnapshot);
        throw error;
      }
    }
    return { action: "reinstall-identical", receiptPath: preflight.receiptPath, lockAction: lockTx.getAction() };
  }
  const resultAction = preview.action === "install" ? "installed" : preview.action;
  if (dryRun) return { action: resultAction, receiptPath: preflight.receiptPath, lockAction: "skipped-dry-run" };
  const { backupPath } = atomicWriteWithBackup(configPath, next, {
    receipt: {
      path: preflight.receiptPath,
      record: { host: "vibe", profile, mechanism: "file", bridge: entry.h2a, lockPath, action: preview.action },
      snapshot: preflight.receiptSnapshot
    },
    lock: { path: lockPath, snapshot: preflight.lockSnapshot },
    interpose: tx.interpose,
    commit: lockTx.commit
  });
  return { action: resultAction, ...(backupPath ? { backupPath } : {}), receiptPath: preflight.receiptPath, lockAction: lockTx.getAction() };
}

export function previewInstall(options: InstallOptions): InstallPreview {
  assertRegistryHost(options.host);
  const profile = options.profile ?? "default";
  if (options.host === "muse") {
    throw new RegistryError("unsupported_host", "muse file install is blocked until generic stdio bridge pickup is proven; supported install hosts: claude, codex, agy, vibe");
  }
  if (options.host === "codex") {
    const raw = existsSync(options.configPath) ? readFileSync(options.configPath, "utf8") : "";
    const servers = readCodexServers(raw);
    const owned = servers.filter((server) => isCodexH2aServerName(server.name));
    if (owned.length > 1) return { action: "conflict", reason: "duplicate h2a [mcp_servers.*] tables" };
    return classifyCodexHost(owned[0] as CodexServer | undefined);
  }
  if (options.host === "vibe") {
    const raw = existsSync(options.configPath) ? readFileSync(options.configPath, "utf8") : "";
    const servers = readVibeServers(raw);
    const owned = servers.filter((server) => isH2aServerName(server.name));
    if (owned.length > 1) return { action: "conflict", reason: "duplicate h2a [[mcp_servers]] blocks" };
    if (owned.length === 0) return { action: "install", reason: "no h2a entry present" };
    const target = owned[0] as (typeof owned)[number];
    if (isBridgeServer(target)) return { action: "reinstall-identical", reason: "bridge entry already installed" };
    if (isLegacyDirectServer(target)) return { action: "migrate-direct", reason: "interim direct h2a [[mcp_servers]] entry" };
    return { action: "conflict", reason: "unknown same-key h2a ownership" };
  }
  // Narrowed to claude|agy by the explicit dispatch above: JSON adapter.
  const { entry } = renderBridgeEntry(options.host, { profile });
  const raw = existsSync(options.configPath) ? readFileSync(options.configPath, "utf8") : "{}\n";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { action: "conflict", reason: "host config is not JSON" };
  }
  return classifyJsonHost((parsed["mcpServers"] as Record<string, unknown> | undefined)?.["h2a"], entry);
}

/** Explicit operator write. Anything else (render/preview/launch) writes nothing. */
export function installBridgeEntry(options: InstallOptions): InstallResult {
  assertRegistryHost(options.host);
  const profile = options.profile ?? "default";
  const dryRun = options.dryRun ?? false;
  // The installer binds the exact caller-resolved lock. A missing lock is
  // never defaulted to a sibling path here: refusing with missing_lock keeps
  // the receipt and the bridge --lock on the lock the caller resolved.
  if (options.lockPath === undefined) {
    throw new RegistryError(
      "missing_lock",
      `no lock path bound for host config at ${options.configPath}; pass the caller-resolved --lock`
    );
  }
  const lockPath = options.lockPath;
  const tx = { interpose: options.interpose, h2aEntry: options.h2aEntry, trackEntry: options.trackEntry };
  // Explicit host dispatch, format chosen by host, never by fallthrough. A
  // host/format pair with no qualified adapter (muse: pickup unproven)
  // returns unsupported_host before any write.
  if (options.host === "vibe") return installVibeHost(options.configPath, profile, dryRun, lockPath, tx);
  if (options.host === "codex") return installCodexHost(options.configPath, profile, dryRun, lockPath, tx);
  if (options.host === "claude" || options.host === "agy") {
    return installJsonHost(options.host, options.configPath, profile, dryRun, lockPath, tx);
  }
  throw new RegistryError("unsupported_host", `muse file install is blocked until generic stdio bridge pickup is proven; supported install hosts: claude, codex, agy, vibe`);
}

export function uninstallBridgeEntry(options: { host: string; configPath: string }): { action: "uninstalled"; backupPath?: string } {
  assertRegistryHost(options.host);
  if (options.host === "muse") {
    throw new RegistryError("unsupported_host", "muse file install is blocked until generic stdio bridge pickup is proven; supported install hosts: claude, codex, agy, vibe");
  }
  if (!existsSync(options.configPath)) throw new RegistryError("invalid_entry", `host config at ${options.configPath} is absent`);
  if (options.host === "codex") {
    const tomlRaw = readFileSync(options.configPath, "utf8");
    const tomlServers = readCodexServers(tomlRaw);
    const tomlOwned = tomlServers.filter((server) => isCodexH2aServerName(server.name));
    if (tomlOwned.length === 0) throw new RegistryError("invalid_entry", "no h2a entry to uninstall");
    if (tomlOwned.length > 1) {
      throw new RegistryError("invalid_entry", "not uninstalling: duplicate h2a [mcp_servers.*] tables (conflict)");
    }
    const tomlTarget = tomlOwned[0] as CodexServer;
    if (!isCodexBridgeServer(tomlTarget)) {
      if (isCodexLegacyDirectServer(tomlTarget)) {
        throw new RegistryError("invalid_entry", "not uninstalling a legacy direct entry here: run the registry migrate transaction instead");
      }
      throw new RegistryError("invalid_entry", "not uninstalling: h2a entry is not the installer-owned bridge entry (conflict)");
    }
    const { text: tomlNext } = removeCodexH2a(tomlRaw);
    const { backupPath: tomlBackup } = atomicWriteWithBackup(options.configPath, tomlNext);
    try {
      unlinkSync(receiptPathFor(options.configPath));
    } catch {
      /* receipt may predate this installer */
    }
    return { action: "uninstalled", ...(tomlBackup ? { backupPath: tomlBackup } : {}) };
  }
  if (options.host === "vibe") {
    const raw = readFileSync(options.configPath, "utf8");
    const servers = readVibeServers(raw);
    const owned = servers.filter((server) => isH2aServerName(server.name));
    if (owned.length === 0) throw new RegistryError("invalid_entry", "no h2a entry to uninstall");
    if (!owned.every((server) => isBridgeServer(server))) {
      throw new RegistryError("invalid_entry", "not uninstalling: h2a entry is not the installer-owned bridge entry (conflict)");
    }
    const { text: next } = removeVibeH2a(raw);
    const { backupPath } = atomicWriteWithBackup(options.configPath, next);
    try {
      unlinkSync(receiptPathFor(options.configPath));
    } catch {
      /* receipt may predate this installer */
    }
    return { action: "uninstalled", ...(backupPath ? { backupPath } : {}) };
  }
  // Narrowed to claude|agy by the explicit dispatch above: JSON adapter.
  const raw = readFileSync(options.configPath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new RegistryError("invalid_entry", `host config at ${options.configPath} is not JSON`);
  }
  const current = (parsed["mcpServers"] as Record<string, unknown> | undefined)?.["h2a"];
  if (current === undefined) throw new RegistryError("invalid_entry", "no h2a entry to uninstall");
  const receipt = readInstallReceipt(options.configPath);
  const expected = (receipt?.["bridge"] as { command: string; args: string[] } | undefined)
    ?? renderBridgeEntry(options.host, { lockPath: defaultInstallLockPath(options.configPath) }).entry.h2a;
  if (isLegacyDirectJson(current)) {
    throw new RegistryError("invalid_entry", "not uninstalling a legacy direct entry here: run the registry migrate transaction instead");
  }
  if (!deepEqualJson(current, expected)) {
    throw new RegistryError("invalid_entry", "not uninstalling: h2a entry is not the installer-owned bridge entry (conflict)");
  }
  const next = removeJsonEntry(raw, ["mcpServers", BRIDGE_SERVER_KEY]);
  const { backupPath } = atomicWriteWithBackup(options.configPath, next);
  try {
    unlinkSync(receiptPathFor(options.configPath));
  } catch {
    /* receipt may predate this installer */
  }
  return { action: "uninstalled", ...(backupPath ? { backupPath } : {}) };
}
