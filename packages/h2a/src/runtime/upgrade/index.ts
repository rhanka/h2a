/**
 * DEC-107 — EVO-8: CLI auto-upgrade. Three levels:
 *  (1) `h2a upgrade [--check]` — explicit, user-invoked;
 *  (2) `mcp-serve` boot version-check notice — non-blocking, cached, opt-out;
 *  (3) `mcp-serve --auto-upgrade` — self-install `@latest` at boot (the new
 *      version applies on the NEXT launch — a running Node process cannot
 *      replace its own binary in flight).
 *
 * Pure version logic + an injectable `UpgradeRuntime` (network/exec/clock/cache)
 * so everything is testable without npm or the network.
 *
 * Staged auto-upgrade path (no in-place `npm i -g`): fetch tarball to a staging
 * area under the global prefix (zero global mutation), install self-contained
 * under a staging prefix with `npm i -g --prefix` (nested deps + bin), probe
 * the staged binary version, load the staged native module, then atomic rename
 * swap with same-filesystem gate, rollback, and repairable marker. All side
 * effects go through `UpgradeRuntime`.
 *
 * The installed layout is NESTED and self-contained: an installed version
 * brings its own deps under
 * `<prefix>/lib/node_modules/@sentropic/h2a/node_modules/` (node-pty included).
 * The top level only holds other global packages. There is no dep-range gate:
 * the prepared autonomous folder is always switched.
 *
 * Prefix lock (v4): single-machine succession protocol. At most one holder:
 * atomic publication via `link(2)` (I1), a no-false-positive liveness predicate
 * (I3), a one-shot `SUCC(t)` succession chain (Lemmas B/C), token monotonicity
 * (I2). No age or mtime ever decides acquisition — `at` is diagnostic only
 * (I7). See `../local-files/succession-lock.ts`.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const H2A_CLI_PACKAGE = "@sentropic/h2a";
/** Re-check at most once per this window for the passive `--upgrade-check` notice. */
export const H2A_UPGRADE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Shorter throttle for `--auto-upgrade`: it is opt-in to *stay current*, so a
 * 24h notice cache must not make it lag a same-day release (the bug that left
 * agents on 0.39.0 after a restart). 1h still dedups a mass restart through the
 * shared per-root cache (only the first booting host hits the network).
 */
export const H2A_AUTO_UPGRADE_CHECK_TTL_MS = 60 * 60 * 1000;

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Parse a strict X.Y.Z triple, or undefined if it is not one. */
export function parseSemver(
  v: string
): { major: number; minor: number; patch: number } | undefined {
  const m = STRICT_SEMVER.exec(v.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** True iff `latest` is a strictly higher X.Y.Z than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

/**
 * The version of the running `@sentropic/h2a` (from its package.json).
 * Robust to a renamed install folder: the primary dist-relative path is tried
 * first, then ancestor package.json files whose `name` matches, so a backup
 * copy (`.h2a-prev-*`) still reports its own version instead of `0.0.0`.
 */
export function currentCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // dist/runtime/upgrade
    const candidates: string[] = [resolvePath(here, "..", "..", "..", "package.json")];
    let dir = here;
    for (let i = 0; i < 6; i++) {
      dir = dirname(dir);
      const p = join(dir, "package.json");
      if (!candidates.includes(p)) candidates.push(p);
    }
    let fallback: string | undefined;
    for (const pkgPath of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
        if (typeof pkg.version !== "string" || !pkg.version) continue;
        if (pkg.name === H2A_CLI_PACKAGE) return pkg.version;
        fallback ??= pkg.version;
      } catch {
        continue;
      }
    }
    return fallback ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Last auto-upgrade attempt outcome, persisted for exponential backoff. */
export type UpgradeThrottleOutcome = "ok" | "deferred-propagation" | "failed";

/** Optional throttle fields stored inside the upgrade cache entry. */
export interface UpgradeThrottle {
  readonly lastAttemptAt?: number;
  readonly consecutiveFailures?: number;
  readonly lastAttemptVersion?: string;
  readonly lastOutcome?: UpgradeThrottleOutcome;
}

export interface UpgradeCacheEntry extends UpgradeThrottle {
  readonly checkedAt: number;
  readonly latest?: string;
}

/** Bounded diagnostics record written per auto-upgrade attempt. */
export interface UpgradeDiagnosticsRecord {
  readonly [key: string]: unknown;
  readonly at?: number;
  readonly durationMs?: number;
  readonly prefix?: string;
  readonly current?: string;
  readonly target?: string;
  readonly outcome?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly status?: number | null;
  readonly signal?: string | null;
  readonly timeout?: boolean;
  readonly npmVersion?: string;
  readonly error?: string;
}

/** I/O the upgrade flow needs — injected so tests supply fakes. */
export interface UpgradeRuntime {
  /** Latest published version of `pkg`, or undefined on any failure. */
  fetchLatest(pkg: string): string | undefined;
  /** `npm i -g pkg@latest`; true on success. */
  runInstall(pkg: string): boolean;
  now(): number;
  readCache(path: string): UpgradeCacheEntry | undefined;
  writeCache(path: string, entry: UpgradeCacheEntry): void;
  /** Resolved global npm prefix (`npm prefix -g`). */
  resolvePrefix?(): string;
  /** Download the tarball for `pkg@version` into `destDir`; zero global mutation. */
  fetchTarball?(pkg: string, version: string, destDir: string): { ok: boolean; file?: string; error?: string };
  /** `npm i -g --prefix <stagingPrefix>` from a local tarball file; bounded. */
  stageInstall?(tarballOrSpec: string, stagingPrefix: string): { ok: boolean; error?: string };
  /** Run the staged binary `--version` and return the observed version. */
  probeStagedVersion?(stagingPrefix: string): string | undefined;
  /**
   * Load the native module (node-pty) from the staged self-contained package
   * dir before swap. Must fail when the native binding cannot load.
   * Injectable so tests can fake the native load without real binaries.
   */
  verifyStagedNative?(stagingPkgDir: string): { ok: boolean; error?: string };
  /** Version of the package at the global root (not PATH resolution). */
  readGlobalPkgVersion?(prefix: string): string | undefined;
  /** Rename current -> unique prev, staging -> place, plus repairable marker. */
  swapPackageDir?(prefix: string, stagingPkgDir: string, version: string): { ok: boolean; repaired?: boolean; error?: string; prevDir?: string | null };
  /** At boot: finish or roll back an interrupted swap via the marker. */
  completeRepairIfPending?(prefix: string): boolean;
  /**
   * Prefix-scoped exclusive lock (link-based succession protocol, v4).
   * `readFirst` can skip publication. Legacy hook arguments remain type-compatible
   * with 0.97.x but are ignored. Never reads the environment.
   */
  acquirePrefixLock?(prefix: string, options?: AcquirePrefixLockOptions & PrefixLockHooks): PrefixLockLease;
  /** Bounded per-attempt diagnostics file. */
  writeDiagnostics?(path: string, record: UpgradeDiagnosticsRecord): void;
  preparePtyUpgrade?(packageDir: string): PtyUpgradePlan;
  switchPtyFrontend?(plan: PtyUpgradePlan, frontendModule: string, rollbackModule: string): PtyUpgradeResult;
}

export type PtyUpgradePlan = { state: "active" | "absent" | "deferred" | "unsupported"; owners: any[]; components: any[]; legacyHosts?: Array<{ socketPath: string; hostPid: number }>; reason?: string };
export type PtyUpgradeResult = { status: "switched" | "absent" | "deferred" | "unsupported"; owners: any[]; components: any[]; reason?: string;
  versions?: Array<{ component: "owner" | "frontend"; pid: number; installedVersion: string; loadedVersion: string; switchedVersion: string | null; deferredVersion: string | null }> };
function withPtyVersions(pty: PtyUpgradeResult | undefined, installed: string, desired = installed): PtyUpgradeResult | undefined {
  if (!pty) return undefined;
  return { ...pty, versions: pty.owners.flatMap(owner => ["owner", "frontend"].flatMap(component => {
    const loaded = owner[component] ?? owner.status?.[component];
    if (!loaded) return [];
    const switched = component === "frontend" && (owner.status === "switched" || pty.status === "switched") && loaded.version === installed;
    return [{ component: component as "owner" | "frontend", pid: loaded.pid, installedVersion: installed,
      loadedVersion: loaded.version, switchedVersion: switched ? installed : null, deferredVersion: switched ? null : desired }];
  })) };
}

function globalPkgDir(prefix: string): string {
  return join(prefix, "lib", "node_modules", H2A_CLI_PACKAGE);
}

function globalPkgDirFallback(prefix: string): string {
  return join(prefix, "node_modules", H2A_CLI_PACKAGE);
}

function resolveGlobalPkgDir(prefix: string): string {
  try {
    if (existsSync(globalPkgDir(prefix))) return globalPkgDir(prefix);
    if (existsSync(globalPkgDirFallback(prefix))) return globalPkgDirFallback(prefix);
  } catch {
    // fall through to canonical layout
  }
  return globalPkgDir(prefix);
}

/** Self-contained staged package dir produced by `npm i -g --prefix <stagingPrefix>`. */
function stagedPkgDirFromPrefix(stagingPrefix: string): string {
  return join(stagingPrefix, "lib", "node_modules", H2A_CLI_PACKAGE);
}

function swapMarkerPath(prefix: string): string {
  return join(prefix, "lib", "node_modules", ".h2a-upgrade-swap.json");
}

function compareParsed(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function satisfiesOneComparator(version: string, comp: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const c = comp.trim();
  if (c === "" || c === "*" || c.toLowerCase() === "x" || c.toLowerCase() === "latest") return true;
  if (c.startsWith("npm:")) return false;
  // Caret and tilde ranges.
  if (c.startsWith("^") || c.startsWith("~")) {
    const base = parseSemver(c.slice(1).trim().replace(/^v/, ""));
    if (!base) return false;
    if (compareParsed(v, base) < 0) return false;
    if (c.startsWith("^")) {
      if (base.major > 0) return v.major === base.major;
      if (base.minor > 0) return v.major === 0 && v.minor === base.minor;
      return v.major === 0 && v.minor === 0 && v.patch === base.patch;
    }
    return v.major === base.major && v.minor === base.minor;
  }
  const m = /^(>=|<=|>|<|=|==?)?\s*v?(\d+\.\d+\.\d+)\s*$/.exec(c);
  if (m) {
    const op = m[1] ?? "";
    const base = parseSemver(m[2]);
    if (!base) return false;
    const cmp = compareParsed(v, base);
    switch (op) {
      case "":
      case "=":
      case "==":
        return cmp === 0;
      case ">":
        return cmp > 0;
      case ">=":
        return cmp >= 0;
      case "<":
        return cmp < 0;
      case "<=":
        return cmp <= 0;
      default:
        return false;
    }
  }
  // Partial wildcards like 1.x / 1.2.x: prefix match on numeric parts.
  const wild = /^v?(\d+)(?:\.(\d+|x|X))?(?:\.(\d+|x|X))?$/.exec(c);
  if (wild) {
    if (wild[2] === undefined) return v.major === Number(wild[1]);
    if (/^[xX]$/.test(wild[2])) return v.major === Number(wild[1]);
    if (wild[3] === undefined) return v.major === Number(wild[1]) && v.minor === Number(wild[2]);
    if (/^[xX]$/.test(wild[3])) return v.major === Number(wild[1]) && v.minor === Number(wild[2]);
    return false;
  }
  return false;
}

function satisfiesRange(version: string, range: string): boolean {
  const r = range.trim();
  if (r === "" || r === "*" || r === "latest") return true;
  // OR groups: any group may satisfy.
  const orGroups = r.split("||").map((s) => s.trim()).filter((s) => s.length > 0);
  if (orGroups.length > 1) return orGroups.some((g) => satisfiesRange(version, g));
  // AND group: comma or space separated comparators must all hold.
  const parts = r.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  if (parts.length === 1) return satisfiesOneComparator(version, parts[0]);
  return parts.every((p) => satisfiesOneComparator(version, p));
}

function readJsonIfExists(path: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Prefix lock (v4): extracted to `../local-files/succession-lock.ts` (Lot 4,
// step 1 — neutral intra-package move). Re-exported here so the module's public
// API is unchanged for existing importers (tests, cli.ts, src/index.ts).
// ---------------------------------------------------------------------------
export {
  STALE_LOCK_ALERT_MS,
  PREFIX_LOCK_MAX_ROUNDS,
  PREFIX_LOCK_MAX_CHAIN,
  PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS,
  UPGRADE_RESIDUE_MAX_AGE_MS,
  readPidNs,
  readTimeNs,
  procStartInfo,
  livenessOf,
  acquirePrefixLock
} from "../local-files/succession-lock.js";
export type {
  AcquirePrefixLockOptions,
  PrefixLockReason,
  PrefixLockLease,
  PrefixLockHookContext,
  PrefixLockHooks
} from "../local-files/succession-lock.js";
import {
  STALE_LOCK_ALERT_MS,
  PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS,
  UPGRADE_RESIDUE_MAX_AGE_MS,
  errnoOf,
  acquirePrefixLock,
  classifyLiveness,
  isOlderThan,
  lockPathFor,
  me,
  readLockHolder,
  readLockRecord,
  procStartInfo,
  safeAtIso
} from "../local-files/succession-lock.js";
import type { AcquirePrefixLockOptions, PrefixLockHooks, PrefixLockLease, LockRec } from "../local-files/succession-lock.js";

export type PtyRollbackFrontend = {
  installDir: string;
  frontendModule: string;
  ownerProtocolVersion: number;
  codeIdentity: { dev: number; ino: number };
};
type PtyRetention = {
  version: 1;
  pins: Record<string, PtyRollbackFrontend>;
  installs: Record<string, { identity: { dev: number; ino: number }; components: LockRec[] }>;
  unknownReferences?: boolean;
};
const ptyRetentionPath = (prefix: string) => join(prefix, ".h2a-pty-retention.json");
function readPtyRetention(prefix: string, create = false): PtyRetention | undefined {
  let value;
  try { value = JSON.parse(readFileSync(ptyRetentionPath(prefix), "utf8")); }
  catch (error) {
    if (errnoOf(error) === "ENOENT") return create ? { version: 1, pins: {}, installs: {} } : undefined;
    throw new Error("PTY retention metadata unreadable; retained installs must be kept");
  }
  if (!value || value.version !== 1 || typeof value.pins !== "object" || !value.pins || Array.isArray(value.pins) ||
      typeof value.installs !== "object" || !value.installs || Array.isArray(value.installs) ||
      (value.unknownReferences !== undefined && typeof value.unknownReferences !== "boolean")) {
    throw new Error("PTY retention metadata invalid; retained installs must be kept");
  }
  return value as PtyRetention;
}
function assertPtyRetentionLock(lock: PrefixLockLease): void {
  if (!lock.acquired || !lock.stillHeld()) throw new Error("PTY retention requires the held upgrade prefix lock");
}
function installIdentity(prefix: string, installDir: string, allowRoot = false): { dev: number; ino: number } {
  const rel = relative(resolvePath(prefix), resolvePath(installDir));
  if ((!rel && !allowRoot) || installDir !== resolvePath(installDir) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) throw new Error("PTY install is outside the upgrade prefix");
  let path = resolvePath(prefix);
  for (const part of ["", ...rel.split(/[\\/]/).filter(Boolean)]) {
    path = join(path, part);
    const parent = lstatSync(path);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("unsafe retained PTY install ancestor");
  }
  const stat = lstatSync(resolvePath(installDir));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe retained PTY install");
  return { dev: stat.dev, ino: stat.ino };
}
function savePtyRetention(prefix: string, lock: PrefixLockLease, state: PtyRetention): void {
  assertPtyRetentionLock(lock);
  const path = ptyRetentionPath(prefix), temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    assertPtyRetentionLock(lock); renameSync(temporary, path);
  } finally { try { unlinkSync(temporary); } catch { /* unique, already renamed */ } }
}

export function recordPtyInstallReferences(prefix: string, lock: PrefixLockLease, installDir: string, components: LockRec[]): void {
  assertPtyRetentionLock(lock);
  const identity = installIdentity(prefix, installDir), state = readPtyRetention(prefix, true)!;
  state.installs[installDir] = { identity, components };
  savePtyRetention(prefix, lock, state);
}

/** Only a handshake receipt for these exact bytes qualifies a replacement.
 * Replacing this protocol's pin and releasing its predecessor is one rename. */
export function pinPtyRollbackFrontend(prefix: string, lock: PrefixLockLease, target: PtyRollbackFrontend,
  qualification: { ownerProtocolVersion: number; codePath: string; codeIdentity: { dev: number; ino: number } }): void {
  assertPtyRetentionLock(lock); installIdentity(prefix, target.installDir);
  const rel = relative(target.installDir, target.frontendModule), stat = lstatSync(target.frontendModule);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !stat.isFile() || stat.isSymbolicLink() ||
      qualification.ownerProtocolVersion !== target.ownerProtocolVersion || qualification.codePath !== target.frontendModule ||
      stat.dev !== target.codeIdentity.dev || stat.ino !== target.codeIdentity.ino ||
      qualification.codeIdentity.dev !== stat.dev || qualification.codeIdentity.ino !== stat.ino) throw new Error("unqualified PTY rollback frontend");
  const state = readPtyRetention(prefix, true)!;
  state.pins[String(target.ownerProtocolVersion)] = target;
  savePtyRetention(prefix, lock, state);
}
export function readPtyRollbackFrontend(prefix: string, protocol: number): PtyRollbackFrontend | undefined {
  const pin = readPtyRetention(prefix)?.pins[String(protocol)];
  return pin === undefined ? undefined : resolvePtyRollbackPin(prefix, pin);
}
function resolvePtyRollbackPin(prefix: string, pin: PtyRollbackFrontend): PtyRollbackFrontend {
  const moduleRelative = relative(pin.installDir, pin.frontendModule), parent = dirname(pin.installDir);
  if (!moduleRelative || moduleRelative.startsWith("..") || isAbsolute(moduleRelative)) throw new Error("invalid rollback module path");
  installIdentity(prefix, parent, true);
  const base = basename(pin.installDir).split(".h2a-prev-", 1)[0]!;
  const candidates = [pin.installDir, ...readdirSync(parent).filter(name => name === base || name.startsWith(`${base}.h2a-prev-`)).map(name => join(parent, name))];
  for (const installDir of new Set(candidates)) {
    try {
      installIdentity(prefix, installDir);
      const frontendModule = join(installDir, moduleRelative), stat = lstatSync(frontendModule);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.dev === pin.codeIdentity.dev && stat.ino === pin.codeIdentity.ino) return { ...pin, installDir, frontendModule };
    } catch { /* Another candidate may still carry this identity after rename. */ }
  }
  throw new Error("pinned PTY rollback code identity unavailable; keep retained installs");
}
function canRemovePtyInstall(prefix: string, installDir: string): boolean {
  try {
    const state = readPtyRetention(prefix), record = state?.installs[installDir];
    if (!state || state.unknownReferences || !record || !Array.isArray(record.components)) return false;
    const current = installIdentity(prefix, installDir);
    if (current.dev !== record.identity.dev || current.ino !== record.identity.ino) return false;
    if (Object.values(state.pins).some(pin => resolvePtyRollbackPin(prefix, pin).installDir === installDir)) return false;
    return record.components.every(component => classifyLiveness(component, me()).verdict === "dead");
  } catch { return false; }
}
export function sweepPtyRetainedInstalls(prefix: string, lock: PrefixLockLease): void {
  assertPtyRetentionLock(lock);
  let state; try { state = readPtyRetention(prefix); } catch { return; }
  if (!state) return;
  for (const installDir of Object.keys(state.installs)) {
    // Only previous-install residues, never the current or staging install.
    if (!basename(installDir).startsWith("h2a.h2a-prev-") || !canRemovePtyInstall(prefix, installDir)) continue;
    assertPtyRetentionLock(lock); rmSyncSafe(installDir);
    if (!existsSync(installDir)) delete state.installs[installDir];
  }
  savePtyRetention(prefix, lock, state);
}

function runtimeFrontendModule(packageDir: string): string | undefined {
  const nested = join(packageDir, "node_modules/@sentropic/h2a-runtime/dist/native-terminal/frontend-process.js");
  if (existsSync(nested)) return nested;
  try {
    const entry = createRequire(join(packageDir, "package.json")).resolve("@sentropic/h2a-runtime");
    const module = join(dirname(entry), "native-terminal/frontend-process.js");
    return existsSync(module) ? module : undefined;
  } catch { return undefined; }
}
function invokePtyRuntime(packageDir: string, input: unknown, phase: "inspect" | "switch"): any {
  let frontend = runtimeFrontendModule(packageDir);
  if (!frontend) {
    try { frontend = join(dirname(fileURLToPath(import.meta.resolve("@sentropic/h2a-runtime"))), "native-terminal/frontend-process.js"); }
    catch { return { state: "deferred", status: "deferred", owners: [], components: [], reason: "PTY runtime unavailable" }; }
  }
  const moduleUrl = new URL("./supervisor.js", pathToFileURL(frontend)).href;
  const source = `import {readFileSync} from 'node:fs';
const runtime=await import(${JSON.stringify(moduleUrl)}),input=JSON.parse(readFileSync(0,'utf8'));
const result=${phase === "inspect" ? "await runtime.inspectNativeTerminalFrontendUpgrade()" : "await runtime.switchNativeTerminalUpgradeFrontends(input.plan,input.frontendModule,input.rollbackModule)"};
process.stdout.write(JSON.stringify(result));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, env: process.env,
  });
  if (result.status !== 0) return { state: "deferred", status: "deferred", owners: [], components: [], reason: "PTY upgrade probe interrupted or unavailable" };
  try { return JSON.parse(result.stdout); }
  catch { return { state: "deferred", status: "deferred", owners: [], components: [], reason: "PTY upgrade probe returned unreadable metadata" }; }
}
function relocatePtyInstall(prefix: string, lock: PrefixLockLease, from: string, to: string): void {
  const state = readPtyRetention(prefix);
  if (!state) return;
  const record = state.installs[from];
  if (record) { state.installs[to] = record; delete state.installs[from]; }
  for (const pin of Object.values(state.pins)) if (pin.installDir === from) {
    pin.frontendModule = join(to, relative(from, pin.frontendModule)); pin.installDir = to;
  }
  savePtyRetention(prefix, lock, state);
}
function preparePtyRetention(prefix: string, lock: PrefixLockLease, packageDir: string, plan: PtyUpgradePlan): void {
  if (plan.state === "deferred") throw new Error(plan.reason ?? "PTY ownership unknown");
  if (plan.state === "unsupported") return;
  const matching = plan.components.filter(component => typeof component.codePath === "string" && component.codePath.startsWith(packageDir + "/"));
  const components: LockRec[] = matching.map(component => ({ ...me(), pid: component.pid,
    start: procStartInfo(component.pid)?.start ?? null, token: "pty-component", at: Date.now() }));
  recordPtyInstallReferences(prefix, lock, packageDir, components);
  const state = readPtyRetention(prefix, true)!;
  state.unknownReferences = (plan.legacyHosts?.length ?? 0) > 0;
  savePtyRetention(prefix, lock, state);
  for (const owner of plan.owners) {
    const protocol = owner.status.ownerProtocolVersion;
    const existing = readPtyRollbackFrontend(prefix, protocol);
    if (existing) {
      installIdentity(prefix, existing.installDir);
      const rel = relative(existing.installDir, existing.frontendModule);
      if (existing.ownerProtocolVersion !== protocol || rel.startsWith("..") || isAbsolute(rel)) throw new Error("invalid pinned PTY rollback target");
      const current = lstatSync(existing.frontendModule);
      if (current.dev !== existing.codeIdentity.dev || current.ino !== existing.codeIdentity.ino) throw new Error("pinned PTY rollback bytes changed");
      continue;
    }
    const frontend = owner.status.frontend;
    if (!frontend || !frontend.codePath?.startsWith(packageDir + "/")) throw new Error("no qualified previous frontend under this install prefix");
    pinPtyRollbackFrontend(prefix, lock, { installDir: packageDir, frontendModule: frontend.codePath,
      ownerProtocolVersion: protocol, codeIdentity: frontend.codeIdentity }, { ...frontend, ownerProtocolVersion: protocol });
  }
}
function legacyPtyUpgradeResult(plan: PtyUpgradePlan, owners: any[] = [],
  reason = "pre-B admission is unfenced; automatic retirement deferred; installs with unknown references retained"): PtyUpgradeResult {
  return { status: "deferred", components: plan.components, owners: [...owners, ...(plan.legacyHosts ?? []).map(legacy => ({
    socketPath: legacy.socketPath, status: "deferred", owner: { pid: legacy.hostPid, version: "unknown" },
    admission: "unfenced", retirement: "deferred",
    reason: "pre-B host has no atomic admission fence; automatic retirement is deferred",
  }))], reason };
}
function finishCurrentPtyUpgrade(prefix: string, lock: PrefixLockLease, runtime: UpgradeRuntime): PtyUpgradeResult | undefined {
  if (!runtime.preparePtyUpgrade) return undefined;
  let plan: PtyUpgradePlan | undefined;
  try {
    const packageDir = resolveGlobalPkgDir(prefix);
    plan = runtime.preparePtyUpgrade(packageDir);
    preparePtyRetention(prefix, lock, packageDir, plan);
    if (plan.state === "unsupported") return { status: "unsupported", owners: [], components: [], ...(plan.reason ? { reason: plan.reason } : {}) };
    if (plan.state === "absent") return { status: "absent", owners: [], components: [] };
    if (plan.owners.length === 0) return legacyPtyUpgradeResult(plan);
    const frontend = runtimeFrontendModule(packageDir), pin = readPtyRollbackFrontend(prefix, plan.owners[0]?.status.ownerProtocolVersion);
    if (!frontend || !pin || !runtime.switchPtyFrontend) throw new Error("compatible frontend or rollback target unavailable");
    const candidate = statSync(frontend);
    if (plan.owners.every(owner => owner.status.frontend?.codeIdentity?.dev === candidate.dev && owner.status.frontend?.codeIdentity?.ino === candidate.ino)) {
      const currentOwners = plan.owners.map(owner => ({ socketPath: owner.socketPath, ...owner.status, status: "switched" }));
      if (plan.legacyHosts?.length) {
        return legacyPtyUpgradeResult(plan, currentOwners);
      }
      return { status: "switched", owners: currentOwners, components: plan.components };
    }
    return runtime.switchPtyFrontend(plan, frontend, pin.frontendModule);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return plan ? legacyPtyUpgradeResult(plan, plan.owners, reason) : { status: "deferred", owners: [], components: [], reason };
  }
}

function pidFromAttemptName(name: string): number | undefined {
  const m = /^\.h2a-upgrade-(?:staging|tarball)-(\d+)-/.exec(name);
  if (!m) return undefined;
  const pid = Number(m[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function pidFromPrevName(name: string): number | undefined {
  // h2a.h2a-prev-<version>-<pid>-<rand>
  const parts = name.split("-");
  if (parts.length < 2) return undefined;
  const pid = Number(parts[parts.length - 2]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * Residue removal rule (debris only, never a lock decision): a live owner is
 * never touched; a certainly-dead owner (ESRCH) is removed; otherwise only
 * entries older than the threshold go.
 */
function shouldRemoveResidue(path: string, pid: number | undefined, now: number): boolean {
  if (pid !== undefined) {
    try {
      process.kill(pid, 0);
      return false; // alive (or un-signalable but present): keep
    } catch (e) {
      const code = errnoOf(e);
      if (code === "ESRCH") return true; // certainly dead
      if (code === "EPERM") return false; // exists: keep
    }
  }
  return isOlderThan(path, now, UPGRADE_RESIDUE_MAX_AGE_MS);
}

/**
 * M4 accumulation sweep, run UNDER the prefix lock after a verified swap:
 * attempt staging and tarball dirs, previous-version backups, orphaned LOCK
 * succ and tmp files, and the no-cachePath prefix log. Never touches a live
 * attempt's staging.
 */
function sweepUpgradeResidues(prefix: string, lockToken?: string): void {
  const now = Date.now();
  const lockPath = lockPathFor(prefix);
  const base = basename(lockPath);
  let lockTok = lockToken;
  if (lockTok === undefined) {
    const cur = readLockRecord(lockPath);
    if (cur !== "absent" && cur !== "corrupt") lockTok = cur.token;
  }
  try {
    for (const n of readdirSync(prefix)) {
      const full = join(prefix, n);
      try {
        if (n.startsWith(".h2a-upgrade-staging-") || n.startsWith(".h2a-upgrade-tarball-")) {
          if (shouldRemoveResidue(full, pidFromAttemptName(n), now)) rmSyncSafe(full);
        } else if (n.startsWith(base) && n.includes(".tmp.")) {
          if (isOlderThan(full, now, PREFIX_LOCK_TMP_DEBRIS_MAX_AGE_MS)) {
            try {
              unlinkSync(full);
            } catch {
              // best-effort
            }
          }
        } else if (n.startsWith(`${base}.succ.`) && !n.includes(".tmp.")) {
          const rec = readLockRecord(full);
          if (rec !== "absent" && rec !== "corrupt" && rec.target !== lockTok) {
            try {
              unlinkSync(full);
            } catch {
              // best-effort
            }
          }
        }
      } catch {
        // best-effort per entry
      }
    }
  } catch {
    // best-effort
  }
  // No-cachePath boot log lives under the prefix: sweep it like other residues.
  try {
    const prefixLog = join(prefix, "h2a-upgrade.log");
    if (isOlderThan(prefixLog, now, UPGRADE_RESIDUE_MAX_AGE_MS)) {
      try {
        unlinkSync(prefixLog);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
  try {
    const parent = dirname(resolveGlobalPkgDir(prefix));
    for (const n of readdirSync(parent)) {
      if (!n.startsWith("h2a.h2a-prev-")) continue;
      const full = join(parent, n);
      try {
        if (shouldRemoveResidue(full, pidFromPrevName(n), now) && canRemovePtyInstall(prefix, full)) rmSyncSafe(full);
      } catch {
        // best-effort per entry
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Boot outcomes that stay QUIET so a mass restart does not spam stderr. Everything else —
 * `upgraded`/`failed`/`deferred-propagation`, and critically `blocked-undecidable` (M-2) and
 * `skipped-locked-stale` (R2) — is actionable and MUST surface at boot. The single source of
 * truth for both the in-process seam and the boot worker, so the two cannot drift and can be
 * tested once. Do NOT add blocked-undecidable or skipped-locked-stale here.
 */
export function isQuietUpgradeOutcome(outcome: string): boolean {
  return outcome === "already-current" || outcome === "skipped-throttled" || outcome === "skipped-locked";
}

/**
 * Human-readable lock failure for `h2a upgrade` / boot diagnostics, so a
 * permission error is never reported as "another installation in progress".
 */
export function describeLockReason(reason: PrefixLockLease["reason"]): string {
  if (reason === undefined || reason === "busy") return "another installation in progress";
  if (reason === "dead-undecidable") {
    // R4: do NOT advise a blanket removal — a holder unreadable here may be alive in
    // another namespace/machine. The performAutoUpgrade path emits the fully-qualified
    // guidance (recorded holder identity + reader ns); this stays generic and safe.
    return "lock held by an owner whose liveness cannot be decided; manual intervention required (inspect the recorded holder before removing the lock — never remove one that may be alive in another namespace or machine)";
  }
  const code = reason.slice("error:".length);
  // Error-specific hint: only permission-class codes warrant the "check permissions"
  // advice; other codes get an accurate, non-misleading message.
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return `cannot access the global prefix (${code}); check directory permissions`;
  }
  if (code === "ENOSPC") {
    return "cannot write to the global prefix (ENOSPC); no space left on device";
  }
  return `cannot access the global prefix (${code})`;
}

export const defaultUpgradeRuntime: UpgradeRuntime = {
  preparePtyUpgrade(packageDir) {
    if (process.platform !== "linux" && process.platform !== "darwin") return { state: "unsupported", owners: [], components: [], reason: `Phase B PTY substrate unsupported on ${process.platform}` };
    return invokePtyRuntime(packageDir, {}, "inspect");
  },
  switchPtyFrontend(plan, frontendModule, rollbackModule) {
    return invokePtyRuntime(dirname(dirname(dirname(frontendModule))), { plan, frontendModule, rollbackModule }, "switch");
  },
  fetchLatest(pkg) {
    try {
      // Bounded, but realistic: `npm view` routinely takes ~5s, so the old 4s
      // timeout fired every time and SILENTLY broke every upgrade check (the
      // global + all hosts stayed pinned — DEC-114). 15s covers a slow registry;
      // the boot check is cached (24h TTL) so this network call is rare.
      const r = spawnSync("npm", ["view", pkg, "version"], { encoding: "utf8", timeout: 15_000 });
      if (r.status !== 0) return undefined;
      const v = r.stdout.trim();
      return parseSemver(v) ? v : undefined;
    } catch {
      return undefined;
    }
  },
  runInstall(pkg) {
    try {
      const r = spawnSync("npm", ["i", "-g", `${pkg}@latest`], { stdio: "ignore", timeout: 120_000 });
      return r.status === 0;
    } catch {
      return false;
    }
  },
  now() {
    return Date.now();
  },
  readCache(path) {
    try {
      if (!existsSync(path)) return undefined;
      return JSON.parse(readFileSync(path, "utf8")) as UpgradeCacheEntry;
    } catch {
      return undefined;
    }
  },
  writeCache(path, entry) {
    // Atomic replace: write a sibling temp then rename, so a concurrent reader (or a
    // crash mid-write) never observes a half-written, unparseable cache file.
    const tmp = `${path}.tmp.${randomBytes(6).toString("hex")}`;
    try {
      writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      renameSync(tmp, path);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // best-effort
      }
    }
  },
  resolvePrefix() {
    try {
      const r = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8", timeout: 10_000 });
      if (r.status === 0) {
        const p = r.stdout.trim();
        if (p) return p;
      }
    } catch {
      // fall through to fallback
    }
    return "/usr/local";
  },
  fetchTarball(pkg, version, destDir) {
    try {
      mkdirSync(destDir, { recursive: true });
      const spec = `${pkg}@${version}`;
      const r = spawnSync("npm", ["pack", spec, "--pack-destination", destDir], {
        encoding: "utf8",
        timeout: 60_000
      });
      if (r.status !== 0) {
        const err = (r.stderr || r.stdout || "npm pack failed").trim().slice(0, 500);
        return { ok: false, error: `npm pack failed: ${err}` };
      }
      let files: string[] = [];
      try {
        files = readdirSync(destDir).filter((f) => f.endsWith(".tgz"));
      } catch {
        return { ok: false, error: "tarball dir unreadable" };
      }
      if (files.length === 0) return { ok: false, error: "tarball not found" };
      const pick = files.find((f) => f.includes(version)) ?? files.sort().pop()!;
      return { ok: true, file: join(destDir, pick) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  stageInstall(tarballOrSpec, stagingPrefix) {
    try {
      mkdirSync(stagingPrefix, { recursive: true });
      // Self-contained global-style staging: produces
      // <stagingPrefix>/lib/node_modules/@sentropic/h2a with nested deps + bin.
      const r = spawnSync("npm", ["i", "-g", "--prefix", stagingPrefix, tarballOrSpec], {
        encoding: "utf8",
        timeout: 180_000
      });
      if (r.status === 0) return { ok: true };
      const err = (r.stderr || r.stdout || "npm install failed").trim().slice(0, 1000);
      return { ok: false, error: `npm install failed: ${err}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  probeStagedVersion(stagingPrefix) {
    try {
      const stagedPkgDir = stagedPkgDirFromPrefix(stagingPrefix);
      const candidates: Array<{ file: string; js: boolean }> = [
        { file: join(stagingPrefix, "bin", "h2a"), js: false },
        { file: join(stagedPkgDir, "dist", "bin.js"), js: true },
        // Legacy flat staging layout — best-effort fallback only.
        { file: join(stagingPrefix, "node_modules", ".bin", "h2a"), js: false },
        { file: join(stagingPrefix, "node_modules", H2A_CLI_PACKAGE, "dist", "bin.js"), js: true }
      ];
      for (const c of candidates) {
        try {
          if (!existsSync(c.file)) continue;
          const r = c.js
            ? spawnSync(process.execPath, [c.file, "--version"], { encoding: "utf8", timeout: 15_000 })
            : spawnSync(c.file, ["--version"], { encoding: "utf8", timeout: 15_000 });
          if (r.status === 0) {
            const v = (r.stdout || "").trim();
            if (parseSemver(v)) return v;
          }
        } catch {
          continue;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  },
  verifyStagedNative(stagingPkgDir) {
    try {
      const nativePath = join(stagingPkgDir, "node_modules", "node-pty");
      // `h2a --version` does NOT load node-pty, so a staged dir can report the
      // right version yet break `h2a run` later. Load the staged native module
      // before swap and fail closed when it cannot load.
      const r = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(nativePath)})`], {
        encoding: "utf8",
        timeout: 15_000
      });
      if (r.status === 0) return { ok: true };
      const err = (r.stderr || r.stdout || "native module load failed").trim().slice(0, 500);
      return { ok: false, error: `node-pty load failed: ${err}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  readGlobalPkgVersion(prefix) {
    const candidates = [
      join(prefix, "lib", "node_modules", H2A_CLI_PACKAGE, "package.json"),
      join(prefix, "node_modules", H2A_CLI_PACKAGE, "package.json")
    ];
    for (const p of candidates) {
      try {
        if (!existsSync(p)) continue;
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
        if (typeof pkg.version === "string" && pkg.version) return pkg.version;
      } catch {
        continue;
      }
    }
    return undefined;
  },
  swapPackageDir(prefix, stagingPkgDir, version) {
    try {
      const currentDir = resolveGlobalPkgDir(prefix);
      const marker = swapMarkerPath(prefix);
      let currentVersion = "unknown";
      try {
        const pkg = readJsonIfExists(join(currentDir, "package.json"));
        if (pkg && typeof pkg["version"] === "string") currentVersion = pkg["version"] as string;
      } catch {
        // keep unknown suffix
      }
      if (!existsSync(stagingPkgDir)) return { ok: false, error: "staging package dir missing" };
      // Same-filesystem gate BEFORE the first rename: both parents must share st_dev.
      try {
        mkdirSync(dirname(currentDir), { recursive: true });
      } catch {
        // best-effort; stat below decides
      }
      try {
        const currentParentDev = statSync(dirname(currentDir)).dev;
        const stagingParentDev = statSync(dirname(stagingPkgDir)).dev;
        if (currentParentDev !== stagingParentDev) return { ok: false, error: "cross-device" };
      } catch {
        return { ok: false, error: "cross-device" };
      }
      if (!existsSync(currentDir)) {
        // Nothing to back up: direct move into place.
        try {
          mkdirSync(dirname(currentDir), { recursive: true });
          writeFileSync(
            marker,
            `${JSON.stringify({ phase: "started", prefix, currentDir, prevDir: null, stagingPkgDir, version, at: Date.now(), pid: process.pid }, null, 2)}\n`,
            "utf8"
          );
          renameSync(stagingPkgDir, currentDir);
          try {
            unlinkSync(marker);
          } catch {
            // best-effort
          }
          return { ok: true, repaired: false, prevDir: null };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      // Unique prev dir per attempt so concurrent lanes never share one artifact.
      const prevDir = `${currentDir}.h2a-prev-${currentVersion}-${process.pid}-${randomUUID().slice(0, 8)}`;
      let backedUp = false;
      try {
        mkdirSync(dirname(currentDir), { recursive: true });
        writeFileSync(
          marker,
          `${JSON.stringify({ phase: "started", prefix, currentDir, prevDir, stagingPkgDir, version, at: Date.now(), pid: process.pid }, null, 2)}\n`,
          "utf8"
        );
        if (existsSync(prevDir)) throw new Error("backup destination already exists; retained installs must not be replaced");
        renameSync(currentDir, prevDir);
        backedUp = true;
        writeFileSync(
          marker,
          `${JSON.stringify({ phase: "backed-up", prefix, currentDir, prevDir, stagingPkgDir, version, at: Date.now(), pid: process.pid }, null, 2)}\n`,
          "utf8"
        );
        renameSync(stagingPkgDir, currentDir);
        // Swap complete: remove the marker so a crash AFTER success cannot be
        // mistaken for an interrupted swap on the next boot.
        try {
          unlinkSync(marker);
        } catch {
          // best-effort
        }
        return { ok: true, repaired: false, prevDir };
      } catch (e) {
        if (backedUp) {
          // Roll back the first rename so the install is never left broken.
          try {
            renameSync(prevDir, currentDir);
            try {
              unlinkSync(marker);
            } catch {
              // best-effort
            }
          } catch {
            // Rollback failed: keep the marker so repair can finish it.
          }
        }
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  completeRepairIfPending(prefix) {
    // LIMIT: when `current` is missing, this repair code (module worker +
    // bin/h2a) lives inside the missing folder, so this function is reachable
    // only while `current` exists. It is NOT a safety mechanism; PREVENTION
    // (same-filesystem gate, rollback, exclusive lock) protects the install.
    // Repair only finishes a marker left by a crashed swap.
    try {
      const marker = swapMarkerPath(prefix);
      if (!existsSync(marker)) return false;
      let state: Record<string, unknown>;
      try {
        state = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
      } catch {
        return false;
      }
      const currentDir = typeof state["currentDir"] === "string" ? (state["currentDir"] as string) : resolveGlobalPkgDir(prefix);
      const prevDir = typeof state["prevDir"] === "string" ? (state["prevDir"] as string) : null;
      const stagingPkgDir = typeof state["stagingPkgDir"] === "string" ? (state["stagingPkgDir"] as string) : null;
      const phase = typeof state["phase"] === "string" ? (state["phase"] as string) : "";
      const currentExists = existsSync(currentDir);
      const prevExists = prevDir ? existsSync(prevDir) : false;
      const stagingExists = stagingPkgDir ? existsSync(stagingPkgDir) : false;
      // Interrupted before any rename: nothing to finish.
      if (phase === "started" && currentExists) {
        try {
          unlinkSync(marker);
        } catch {
          // best-effort
        }
        return true;
      }
      // Missing live dir: finish the pending move or roll back the backup.
      if (!currentExists && prevExists) {
        try {
          if (stagingExists && stagingPkgDir) {
            renameSync(stagingPkgDir, currentDir);
          } else if (prevDir) {
            renameSync(prevDir, currentDir);
          }
          try {
            unlinkSync(marker);
          } catch {
            // best-effort
          }
          return true;
        } catch {
          return false;
        }
      }
      // Live dir present: swap already completed or backup is stale.
      try {
        unlinkSync(marker);
      } catch {
        // best-effort
      }
      return true;
    } catch {
      return false;
    }
  },
  // Forward only the production option; legacy hook values are ignored.
  acquirePrefixLock(prefix, options) {
    return acquirePrefixLock(prefix, { readFirst: options?.readFirst });
  },
  writeDiagnostics(path, record) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const s = JSON.stringify(record);
      const bounded = s.length > 65_536 ? s.slice(0, 65_536) : s;
      writeFileSync(path, `${bounded}\n`, "utf8");
    } catch {
      // best-effort
    }
  }
};

function rmSyncSafe(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export interface UpgradeCheckResult {
  readonly current: string;
  readonly latest?: string;
  readonly upgradeAvailable: boolean;
  /** True if the latest came from a fresh cache hit (no network this call). */
  readonly fromCache: boolean;
}

export interface CheckUpgradeOptions {
  readonly runtime?: UpgradeRuntime;
  /** Cache file path; when set, a fresh entry within TTL skips the network. */
  readonly cachePath?: string;
  readonly ttlMs?: number;
  /** Skip the cache entirely (always hit the network). */
  readonly force?: boolean;
}

/**
 * Determine whether a newer CLI is published. Cached + throttled when a
 * `cachePath` is given (level-2 boot notice); always-fresh otherwise. Never
 * throws — a network failure yields `{ latest: undefined, upgradeAvailable:false }`.
 */
export function checkUpgrade(
  current: string,
  options: CheckUpgradeOptions = {}
): UpgradeCheckResult {
  const runtime = options.runtime ?? defaultUpgradeRuntime;
  const ttlMs = options.ttlMs ?? H2A_UPGRADE_CHECK_TTL_MS;
  const now = runtime.now();

  if (options.cachePath && !options.force) {
    const cached = runtime.readCache(options.cachePath);
    if (cached && now - cached.checkedAt < ttlMs) {
      return {
        current,
        ...(cached.latest ? { latest: cached.latest } : {}),
        upgradeAvailable: cached.latest ? isNewerVersion(cached.latest, current) : false,
        fromCache: true
      };
    }
  }

  const latest = runtime.fetchLatest(H2A_CLI_PACKAGE);
  if (options.cachePath) {
    // Preserve throttle fields across version-check writes (C4: keep
    // lastAttemptVersion so the version-indexed backoff keeps climbing).
    let throttle: UpgradeThrottle = {};
    try {
      const prev = runtime.readCache(options.cachePath);
      if (prev) {
        if (prev.lastAttemptAt !== undefined) throttle = { ...throttle, lastAttemptAt: prev.lastAttemptAt };
        if (prev.consecutiveFailures !== undefined) throttle = { ...throttle, consecutiveFailures: prev.consecutiveFailures };
        if (prev.lastAttemptVersion !== undefined) throttle = { ...throttle, lastAttemptVersion: prev.lastAttemptVersion };
        if (prev.lastOutcome !== undefined && (prev.lastOutcome === "ok" || prev.lastOutcome === "deferred-propagation" || prev.lastOutcome === "failed")) {
          throttle = { ...throttle, lastOutcome: prev.lastOutcome };
        }
      }
    } catch {
      // best-effort
    }
    runtime.writeCache(options.cachePath, { checkedAt: now, ...(latest ? { latest } : {}), ...throttle });
  }
  return {
    current,
    ...(latest ? { latest } : {}),
    upgradeAvailable: latest ? isNewerVersion(latest, current) : false,
    fromCache: false
  };
}

/**
 * @deprecated Kept for compatibility (`h2a upgrade` explicit path). New boot
 * and command flows use `performAutoUpgrade` (staged swap, never in-place).
 * Run the global install of `@latest`. Returns true on success.
 */
export function performUpgrade(runtime: UpgradeRuntime = defaultUpgradeRuntime): boolean {
  return runtime.runInstall(H2A_CLI_PACKAGE);
}

/** Default cache path for the boot check, under the store root. */
export function upgradeCachePath(root: string): string {
  return join(root, "upgrade-check.json");
}

/**
 * Env flag set across an in-place re-exec so the freshly-exec'd process does
 * NOT auto-upgrade + re-exec again this boot (breaks any pathological loop if
 * an install reports success without changing the on-disk version).
 */
export const H2A_REEXEC_GUARD_ENV = "H2A_UPGRADE_REEXECED";

export interface ReexecOptions {
  /** Injectable for tests; defaults to `process.execve` when present. */
  readonly execve?: (file: string, args: readonly string[], env: Record<string, string | undefined>) => never;
  readonly execPath?: string;
  readonly argv?: readonly string[];
  readonly env?: Record<string, string | undefined>;
}

/** True when an in-place re-exec is possible (POSIX `process.execve`, Node ≥ 23.10). */
export function canReexec(): boolean {
  return typeof (process as unknown as { execve?: unknown }).execve === "function";
}

/**
 * Re-exec the current process into the (just-upgraded) binary at the SAME path,
 * preserving PID + stdio fds — so a host-spawned `mcp-serve` picks up the new
 * version immediately without the host seeing a disconnect. On success the
 * process image is replaced and this never returns; returns `false` if re-exec
 * is unavailable or failed (caller falls back to "applies next launch"). The
 * `H2A_REEXEC_GUARD_ENV` flag is set so the new image does not re-upgrade.
 */
export function reexecSelf(options: ReexecOptions = {}): boolean {
  const execve =
    options.execve ??
    (process as unknown as { execve?: ReexecOptions["execve"] }).execve;
  if (typeof execve !== "function") return false;
  const execPath = options.execPath ?? process.execPath;
  // CRITICAL: a failing `process.execve` (e.g. a bad path) aborts the process
  // *natively* — it is NOT a catchable throw — so we must not call it on a
  // target that might fail. Guard on existence first; the real boot path uses
  // `process.execPath` (the running node), which is always valid.
  if (!existsSync(execPath)) return false;
  const argv = options.argv ?? process.argv.slice(1);
  const env = { ...(options.env ?? process.env), [H2A_REEXEC_GUARD_ENV]: "1" };
  try {
    execve(execPath, [execPath, ...argv], env);
    return true; // unreachable when execve truly replaces the image
  } catch {
    return false;
  }
}

export interface AutoUpgradeResult {
  readonly current: string;
  readonly target?: string;
  readonly outcome:
    | "upgraded"
    | "already-current"
    | "pty-deferred"
    | "deferred-propagation"
    | "failed"
    | "skipped-locked"
    | "skipped-throttled"
    // M-2: an UNDECIDABLE lock owner (dead-or-unknown, manual intervention) is a
    // distinct, boot-VISIBLE outcome — never folded into the quiet skipped-locked
    // (a live installer in progress), so the wedge class surfaces at boot.
    | "blocked-undecidable"
    // R2/N1: a live holder whose identity is not confirmable on this kernel (start not
    // comparable) and whose lock is far older than any legitimate upgrade — a distinct,
    // boot-VISIBLE outcome so the (bounded) reuse-detection loss is surfaced, not silent.
    | "skipped-locked-stale";
  readonly verifiedVersion?: string;
  readonly verifiedEntrypoint?: string;
  readonly message: string;
  readonly logPath?: string;
  readonly pty?: PtyUpgradeResult;
}

export interface AutoUpgradeOptions {
  readonly runtime?: UpgradeRuntime;
  readonly cachePath?: string;
  readonly ttlMs?: number;
  readonly prefix?: string;
}

/** Exponential backoff for consecutive failures, based on the auto-upgrade TTL. */
function upgradeThrottleBackoffMs(consecutiveFailures: number): number {
  const base = H2A_AUTO_UPGRADE_CHECK_TTL_MS;
  const exp = Math.pow(2, Math.max(0, consecutiveFailures - 1));
  const capped = Math.min(exp, 24);
  return base * capped;
}

/**
 * Single staged auto-upgrade orchestration used by both the injected-seam path
 * and the worker path. Every bounded side effect goes through `UpgradeRuntime`;
 * this function never spawns or touches the network directly.
 *
 * Fail-safe seam: when an injected runtime is provided, a missing method throws
 * `missing runtime method X` instead of falling back to the real implementation.
 * Only the default path (no runtime provided) uses `defaultUpgradeRuntime`.
 */
export function performAutoUpgrade(
  current: string,
  options: { readonly runtime?: UpgradeRuntime; readonly cachePath?: string; readonly ttlMs?: number; readonly prefix?: string } = {}
): AutoUpgradeResult {
  const injected = options.runtime;
  const need = <K extends keyof UpgradeRuntime>(name: K): NonNullable<UpgradeRuntime[K]> => {
    if (!injected) {
      const fn = defaultUpgradeRuntime[name];
      if (fn == null) throw new Error(`missing runtime method ${String(name)}`);
      return fn as NonNullable<UpgradeRuntime[K]>;
    }
    const fn = injected[name];
    if (fn == null) throw new Error(`missing runtime method ${String(name)}`);
    return fn as NonNullable<UpgradeRuntime[K]>;
  };

  // Fail fast before any side effect when an injected runtime is incomplete.
  const fetchLatestFn = need("fetchLatest") as UpgradeRuntime["fetchLatest"];
  const nowFn = need("now") as UpgradeRuntime["now"];
  const readCacheFn = need("readCache") as UpgradeRuntime["readCache"];
  const writeCacheFn = need("writeCache") as UpgradeRuntime["writeCache"];
  const doResolvePrefix = need("resolvePrefix") as NonNullable<UpgradeRuntime["resolvePrefix"]>;
  const completeRepair = need("completeRepairIfPending") as NonNullable<UpgradeRuntime["completeRepairIfPending"]>;
  const acquireLock = need("acquirePrefixLock") as NonNullable<UpgradeRuntime["acquirePrefixLock"]>;
  const doFetchTarball = need("fetchTarball") as NonNullable<UpgradeRuntime["fetchTarball"]>;
  const doStageInstall = need("stageInstall") as NonNullable<UpgradeRuntime["stageInstall"]>;
  const doProbeStaged = need("probeStagedVersion") as NonNullable<UpgradeRuntime["probeStagedVersion"]>;
  const doVerifyNative = need("verifyStagedNative") as NonNullable<UpgradeRuntime["verifyStagedNative"]>;
  const doSwap = need("swapPackageDir") as NonNullable<UpgradeRuntime["swapPackageDir"]>;
  const doReadGlobal = need("readGlobalPkgVersion") as NonNullable<UpgradeRuntime["readGlobalPkgVersion"]>;
  const doWriteDiag = need("writeDiagnostics") as NonNullable<UpgradeRuntime["writeDiagnostics"]>;

  const runtime: UpgradeRuntime = injected ?? defaultUpgradeRuntime;
  void fetchLatestFn;

  let prefix = options.prefix;
  if (!prefix) {
    try {
      prefix = doResolvePrefix();
    } catch {
      prefix = "/usr/local";
    }
  }
  if (!prefix) prefix = "/usr/local";
  const resolvedPrefix = prefix;
  const cachePath = options.cachePath;
  const ttlMs = options.ttlMs ?? H2A_AUTO_UPGRADE_CHECK_TTL_MS;
  const logPath = cachePath ? `${cachePath}.log` : join(resolvedPrefix, "h2a-upgrade.log");

  const readEntry = (): UpgradeCacheEntry | undefined => {
    if (!cachePath) return undefined;
    try {
      return readCacheFn(cachePath);
    } catch {
      return undefined;
    }
  };
  const writeEntry = (entry: UpgradeCacheEntry): void => {
    if (!cachePath) return;
    try {
      writeCacheFn(cachePath, entry);
    } catch {
      // best-effort
    }
  };
  const diag = (record: UpgradeDiagnosticsRecord): void => {
    try {
      doWriteDiag(logPath, record);
    } catch {
      // best-effort
    }
  };

  // Freshness check (cached + throttled when cachePath is set).
  let check: UpgradeCheckResult;
  try {
    check = checkUpgrade(current, { runtime, ...(cachePath ? { cachePath } : {}), ttlMs });
  } catch (e) {
    const at = nowFn();
    diag({ at, durationMs: 0, prefix: resolvedPrefix, current, outcome: "failed", error: e instanceof Error ? e.message : String(e) });
    return {
      current,
      outcome: "failed",
      message: `auto-upgrade check failed (see ${logPath})`,
      logPath
    };
  }
  if (!check.upgradeAvailable || !check.latest) {
    let pty: PtyUpgradeResult | undefined;
    if (runtime.preparePtyUpgrade) {
      const lease = acquireLock(resolvedPrefix);
      try {
        pty = lease.acquired ? withPtyVersions(finishCurrentPtyUpgrade(resolvedPrefix, lease, runtime), current)
          : { status: "deferred", owners: [], components: [], reason: "upgrade prefix lock unavailable" };
      } finally { lease.release(); }
    }
    if (cachePath) {
      try {
        const prev = readEntry();
        writeEntry({
          checkedAt: prev?.checkedAt ?? nowFn(),
          ...(check.latest ?? prev?.latest ? { latest: (check.latest ?? prev?.latest) as string } : {}),
          lastAttemptAt: nowFn(),
          consecutiveFailures: 0,
          lastAttemptVersion: current,
          lastOutcome: "ok"
        });
      } catch {
        // best-effort
      }
    }
    return {
      current,
      outcome: pty?.status === "deferred" ? "pty-deferred" : "already-current",
      message: `already current (${current})${pty ? `; PTY frontend ${pty.status}${pty.reason ? `: ${pty.reason}` : ""}` : ""}`,
      ...(pty === undefined ? {} : { pty }),
    };
  }

  // Pin the target version for this attempt.
  const target = check.latest as string;
  const startedAt = nowFn();

  const recordFailure = (outcome: "failed" | "deferred-propagation"): void => {
    if (!cachePath) return;
    try {
      const prev = readEntry();
      const sameVersion = prev?.lastAttemptVersion === target;
      const failures = sameVersion ? (prev?.consecutiveFailures ?? 0) + 1 : 1;
      writeEntry({
        checkedAt: prev?.checkedAt ?? startedAt,
        latest: target,
        lastAttemptAt: nowFn(),
        consecutiveFailures: failures,
        lastAttemptVersion: target,
        lastOutcome: outcome
      });
    } catch {
      // best-effort
    }
  };

  // Version-indexed backoff BEFORE any heavy work: the same target that failed
  // or deferred recently must not replay `npm pack` + stage (~130 MB) every boot.
  // A new target resets the counter.
  try {
    const cached = readEntry();
    if (
      cached &&
      (cached.lastOutcome === "failed" || cached.lastOutcome === "deferred-propagation") &&
      cached.lastAttemptVersion === target &&
      (cached.consecutiveFailures ?? 0) > 0 &&
      typeof cached.lastAttemptAt === "number"
    ) {
      const failures = cached.consecutiveFailures as number;
      if (nowFn() - (cached.lastAttemptAt as number) < upgradeThrottleBackoffMs(failures)) {
        return {
          current,
          target,
          outcome: "skipped-throttled",
          message: `auto-upgrade to ${target} throttled after ${failures} attempt(s), retry later`
        };
      }
    }
  } catch {
    // best-effort: continue without throttle
  }

  // Serialize concurrent installers on the global prefix. Production calls
  // with production acquisition controls only.
  let lock: PrefixLockLease;
  let lockThrew: unknown;
  let lockThrewFlag = false;
  try {
    lock = acquireLock(resolvedPrefix);
  } catch (e) {
    lockThrew = e;
    lockThrewFlag = true;
    lock = { acquired: false, stillHeld: () => false, release: () => {}, reason: "dead-undecidable" };
  }
  if (!lock.acquired) {
    const reason = lock.reason ?? "busy";
    if (reason.startsWith("error:")) {
      const code = reason.slice("error:".length);
      // R5: use the error-specific hint (permissions advice only for EACCES/EPERM/EROFS,
      // an ENOSPC message, or a plain code) instead of always blaming permissions.
      const hint = describeLockReason(reason);
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: `prefix lock unavailable (${code}): ${hint} on ${resolvedPrefix}`
      });
      recordFailure("failed");
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: cannot lock prefix ${resolvedPrefix}: ${hint} (see ${logPath})`,
        logPath
      };
    }
    if (reason === "dead-undecidable") {
      // R4: show the RECORDED holder identity and the reader's provenance, and advise
      // removal ONLY after confirming that holder is truly gone in ITS OWN namespace —
      // a live holder in another container/namespace (nsenter -p) or another machine
      // must never be broken on the strength of "PID absent in MY namespace".
      const lockFile = lockPathFor(resolvedPrefix);
      const rec = readLockHolder(lockFile);
      const reader = me();
      const holder =
        rec === "absent" || rec === "corrupt"
          ? `LOCK unreadable (${rec})`
          : rec.kind === "legacy"
            ? `legacy holder pid=${rec.pid} hostname=${JSON.stringify(rec.hostname)} startedAt=${JSON.stringify(rec.startedAt)} protocol=${JSON.stringify(rec.protocol ?? null)} fenceEpoch=${JSON.stringify(rec.fenceEpoch ?? null)} token=${rec.token}`
            : `holder host=${rec.host} hostKind=${rec.hostKind ?? "unknown"} boot=${rec.boot ?? "unknown"} ns=${rec.ns ?? "unknown"} pid=${rec.pid} acquiredAt=${safeAtIso(rec.at)}`;
      const advice =
        rec === "absent" || rec === "corrupt"
          ? `Inspect ${lockFile} and its ${lockFile}.succ.* files before any removal.`
          : rec.kind === "legacy"
            ? `Do not remove ${lockFile} or its ${lockFile}.succ.* files on this process's authority alone: this legacy holder has no boot or namespace provenance. Confirm holder pid ${rec.pid} on host ${JSON.stringify(rec.hostname)} is truly gone in its own execution context; a holder merely absent from yours may be live in another container, namespace, or machine.`
            : `Do not remove ${lockFile} or its ${lockFile}.succ.* files on this process's authority alone: a clone can share the lock directory. Before manual intervention, compare holder boot=${rec.boot ?? "unknown"} with this reader boot=${reader.boot ?? "unknown"}; a PID check is meaningless across different boots. Confirm holder pid ${rec.pid} on host ${rec.host} is truly gone in ITS OWN namespace; a holder merely absent from yours may be live in another container, namespace, or machine.`;
      const thrown = lockThrewFlag
        ? `lock acquisition threw (${lockThrew instanceof Error ? lockThrew.message : String(lockThrew)}); `
        : "";
      const fullError =
        `${thrown}prefix lock owner liveness undecidable (weak or unknown host identity (hostname fallback or record from 0.97.9 or earlier), boot differs or is unknown (reboot or cloned image), platform outside linux/darwin, a different/unreadable PID namespace, a legacy (pre-v4) LOCK record without machine/boot/namespace provenance, another machine, a corrupt LOCK, or succession depth exceeded); manual intervention required. ${holder}; this reader host=${reader.host} hostKind=${reader.hostKind} boot=${reader.boot ?? "unknown"} ns=${reader.ns ?? "unknown"}. ${advice}`;
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "blocked-undecidable",
        reason,
        error: fullError
      });
      return {
        current,
        target,
        outcome: "blocked-undecidable",
        message: `auto-upgrade blocked: ${fullError} (see ${logPath})`,
        logPath
      };
    }
    // reason === "busy": a live holder. R2 staleness alert (DIAGNOSTIC ONLY, never a
    // reclaim): if this lock is far older than any legitimate upgrade AND its holder
    // reads "live" ONLY because its start time is not comparable on this kernel (so a
    // reused PID could be masking a dead holder), surface it as a distinct, boot-VISIBLE
    // outcome (N1: plain skipped-locked is suppressed at boot, which would hide exactly
    // the loss B2's acceptance relies on making visible). `at` informs; it never decides
    // (I7). No removal is advised — an operator killing a live holder on the strength of
    // a message is a hand-made double-holder (the R4 lesson).
    let staleAlert: string | undefined;
    try {
      const rec = readLockRecord(lockPathFor(resolvedPrefix));
      if (rec !== "absent" && rec !== "corrupt") {
        const info = classifyLiveness(rec, me());
        const ageMs = nowFn() - rec.at;
        if (info.verdict === "live" && !info.datable && ageMs > STALE_LOCK_ALERT_MS) {
          staleAlert =
            `prefix lock held ~${Math.round(ageMs / 60000)} min by pid ${rec.pid} (host ${rec.host}); ` +
            `its identity is not confirmable on this kernel (start time not comparable), so a reused PID may be masking a dead holder. ` +
            `Informational only — no action is taken and none is advised automatically; investigate whether pid ${rec.pid} is genuinely the running upgrade.`;
        }
      }
    } catch {
      // best-effort: the staleness check must never affect the outcome
    }
    if (staleAlert !== undefined) {
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "skipped-locked-stale",
        reason,
        error: staleAlert
      });
      return {
        current,
        target,
        outcome: "skipped-locked-stale",
        message: `auto-upgrade skipped (stale lock): ${staleAlert} (see ${logPath})`,
        logPath
      };
    }
    const detail = describeLockReason(reason);
    return {
      current,
      target,
      outcome: "skipped-locked",
      message: `auto-upgrade skipped: ${detail} (${reason})`
    };
  }

  try {
    // Repair under the lock so one lane never repairs while another swaps.
    try {
      completeRepair(resolvedPrefix);
    } catch {
      // best-effort
    }

    // Idempotence under the lock: the version check ran BEFORE acquiring the lock,
    // so a peer lane may have installed `target` while we waited. Re-read the live
    // global version now that we hold the lock; if it already IS target AND its native
    // module actually loads, do not re-stage ~130 MB — report already-current. The lock
    // releases in `finally`. A version-correct install whose native module fails to load
    // is NOT up to date, it is broken (e.g. a manual `npm i -g` interrupted mid-write):
    // we must fall through and re-stage to repair it, never declare it current.
    let installed: string | undefined;
    try {
      installed = doReadGlobal(resolvedPrefix);
    } catch {
      installed = undefined;
    }
    let installedNativeOk = false;
    if (installed === target) {
      try {
        // N2: the LIVE global package dir is layout-dependent (nested on Linux/macOS,
        // flat on Windows). Use resolveGlobalPkgDir, not the always-nested staged path,
        // or the native check would fail forever on Windows and re-stage every lane.
        installedNativeOk = doVerifyNative(resolveGlobalPkgDir(resolvedPrefix)).ok;
      } catch {
        installedNativeOk = false;
      }
    }
    if (installed === target && installedNativeOk) {
      const pty = withPtyVersions(finishCurrentPtyUpgrade(resolvedPrefix, lock, runtime), installed);
      if (cachePath) {
        try {
          const prev = readEntry();
          writeEntry({
            checkedAt: prev?.checkedAt ?? startedAt,
            latest: target,
            lastAttemptAt: nowFn(),
            consecutiveFailures: 0,
            lastAttemptVersion: target,
            lastOutcome: "ok"
          });
        } catch {
          // best-effort
        }
      }
      return {
        current: installed,
        target,
        outcome: pty?.status === "deferred" ? "pty-deferred" : "already-current",
        ...(pty === undefined ? {} : { pty }),
        message: `already current (${installed}); another lane installed ${target} before this one acquired the lock${pty ? `; PTY frontend ${pty.status}${pty.reason ? `: ${pty.reason}` : ""}` : ""}`,
      };
    }

    // Sibling staging dirs under the global prefix (same filesystem, never /tmp).
    // Unique per attempt so lanes never share one artifact.
    const attemptId = `${process.pid}-${startedAt.toString(36)}-${randomUUID().slice(0, 8)}`;
    const stagingTarballDir = join(resolvedPrefix, `.h2a-upgrade-tarball-${attemptId}`);
    const stagingPrefix = join(resolvedPrefix, `.h2a-upgrade-staging-${attemptId}`);
    const stagingPkgDir = stagedPkgDirFromPrefix(stagingPrefix);
    const cleanupAttempt = (): void => {
      try {
        rmSyncSafe(stagingPrefix);
      } catch {
        // best-effort
      }
      try {
        rmSyncSafe(stagingTarballDir);
      } catch {
        // best-effort
      }
    };

    // Bounded, killable tarball fetch with zero global mutation.
    let tarball: { ok: boolean; file?: string; error?: string };
    try {
      tarball = doFetchTarball(H2A_CLI_PACKAGE, target, stagingTarballDir);
    } catch (e) {
      tarball = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!tarball.ok || !tarball.file) {
      const err = tarball.error ?? "fetch failed";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "deferred-propagation",
        error: err
      });
      recordFailure("deferred-propagation");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "deferred-propagation",
        message: `Update ${target} available but not installable right now, retry on next boot`,
        logPath
      };
    }
    const tarballFile = tarball.file as string;

    // Stage self-contained locally, then verify the staged binary reports the target.
    let staged: { ok: boolean; error?: string };
    try {
      staged = doStageInstall(tarballFile, stagingPrefix);
    } catch (e) {
      staged = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!staged.ok) {
      const err = staged.error ?? "stage failed";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    let probed: string | undefined;
    try {
      probed = doProbeStaged(stagingPrefix);
    } catch {
      probed = undefined;
    }
    if (probed !== target) {
      const err = `staged version mismatch: expected ${target}, got ${probed ?? "unknown"}`;
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    // Native validation before swap: `h2a --version` never loads node-pty, so a
    // staged dir can pass the probe yet break `h2a run`. Fail closed here.
    let native: { ok: boolean; error?: string };
    try {
      native = doVerifyNative(stagingPkgDir);
    } catch (e) {
      native = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!native.ok) {
      const err = native.error ?? "staged native module failed to load";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    // Qualify and persist the rollback target before any install can be
    // retired. Unknown ownership/metadata defers without touching the owner.
    let ptyPlan: PtyUpgradePlan | undefined;
    if (runtime.preparePtyUpgrade !== undefined) {
      try {
        ptyPlan = runtime.preparePtyUpgrade(resolveGlobalPkgDir(resolvedPrefix));
        preparePtyRetention(resolvedPrefix, lock, resolveGlobalPkgDir(resolvedPrefix), ptyPlan);
      } catch (error) {
        cleanupAttempt();
        const reason = error instanceof Error ? error.message : String(error);
        return { current, target, outcome: "pty-deferred", message: `PTY upgrade deferred: ${reason}; owner unchanged`,
          pty: withPtyVersions(ptyPlan ? legacyPtyUpgradeResult(ptyPlan, ptyPlan.owners, reason)
            : { status: "deferred", owners: [], components: [], reason }, current, target)! };
      }
    }

    // Atomic rename swap, then verify the global root reports the target.
    // Always switch the prepared autonomous folder (no dep-range gate: a
    // self-contained version brings its own nested deps).
    let swapped: { ok: boolean; repaired?: boolean; error?: string; prevDir?: string | null };
    try {
      swapped = doSwap(resolvedPrefix, stagingPkgDir, target);
    } catch (e) {
      swapped = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!swapped.ok) {
      const err = swapped.error ?? "swap failed";
      diag({
        at: startedAt,
        durationMs: nowFn() - startedAt,
        prefix: resolvedPrefix,
        current,
        target,
        outcome: "failed",
        error: err
      });
      recordFailure("failed");
      cleanupAttempt();
      return {
        current,
        target,
        outcome: "failed",
        message: `auto-upgrade to ${target} failed: ${err} (see ${logPath})`,
        logPath
      };
    }

    let verified: string | undefined;
    try {
      verified = doReadGlobal(resolvedPrefix);
    } catch {
      verified = undefined;
    }
    diag({
      at: startedAt,
      durationMs: nowFn() - startedAt,
      prefix: resolvedPrefix,
      current,
      target,
      outcome: verified === target ? "upgraded" : "failed",
      verifiedVersion: verified
    });
    if (verified === target) {
      let pty: PtyUpgradeResult | undefined;
      if (ptyPlan !== undefined) {
        try {
          if (swapped.prevDir) relocatePtyInstall(resolvedPrefix, lock, resolveGlobalPkgDir(resolvedPrefix), swapped.prevDir);
          if (ptyPlan.state === "unsupported") pty = { status: "unsupported", owners: [], components: [], ...(ptyPlan.reason ? { reason: ptyPlan.reason } : {}) };
          else if (ptyPlan.state === "absent") pty = { status: "absent", owners: [], components: [] };
          else if (ptyPlan.owners.length === 0) pty = legacyPtyUpgradeResult(ptyPlan);
          else {
            const frontendModule = runtimeFrontendModule(resolveGlobalPkgDir(resolvedPrefix));
            const rollback = readPtyRollbackFrontend(resolvedPrefix, ptyPlan.owners[0]?.status.ownerProtocolVersion);
            pty = frontendModule && rollback && runtime.switchPtyFrontend
              ? runtime.switchPtyFrontend(ptyPlan, frontendModule, rollback.frontendModule)
              : legacyPtyUpgradeResult(ptyPlan, ptyPlan.owners, "compatible candidate or retained rollback frontend unavailable");
          }
        } catch (error) {
          pty = legacyPtyUpgradeResult(ptyPlan, ptyPlan.owners, error instanceof Error ? error.message : String(error));
        }
      }
      pty = withPtyVersions(pty, verified);
      // M4: drop the backup and sweep residues UNDER the lock. Inodes stay
      // valid for already-launched processes; the sweep never touches a live
      // attempt's staging (live owner => keep, no age shortcut).
      if (typeof swapped.prevDir === "string" && swapped.prevDir) {
        try {
          if (canRemovePtyInstall(resolvedPrefix, swapped.prevDir)) rmSyncSafe(swapped.prevDir);
        } catch {
          // best-effort: the next sweep retries
        }
      }
      try {
        sweepUpgradeResidues(resolvedPrefix, lock.token);
        if (lock.stillHeld?.()) sweepPtyRetainedInstalls(resolvedPrefix, lock);
      } catch {
        // best-effort
      }
      if (cachePath) {
        try {
          const prev = readEntry();
          writeEntry({
            checkedAt: prev?.checkedAt ?? startedAt,
            latest: target,
            lastAttemptAt: nowFn(),
            consecutiveFailures: 0,
            lastAttemptVersion: target,
            lastOutcome: "ok"
          });
        } catch {
          // best-effort
        }
      }
      cleanupAttempt();
      return {
        current,
        target,
        outcome: pty?.status === "deferred" ? "pty-deferred" : "upgraded",
        verifiedVersion: verified,
        verifiedEntrypoint: join(resolveGlobalPkgDir(resolvedPrefix), 'dist/bin.js'),
        message: `auto-upgraded ${current} → ${target} [verified]${pty ? `; PTY frontend ${pty.status}; owner loaded ${pty.versions?.filter(version => version.component === "owner").map(version => version.loadedVersion).join(",") || "none"}, ${pty.owners.some(owner => owner.admission === "unfenced") ? "pre-B admission unfenced; automatic retirement deferred" : "owner restart deferred until drain"}${pty.reason ? `; ${pty.reason}` : ""}` : " (applies on next launch)"}`,
        ...(pty === undefined ? {} : { pty }),
        logPath
      };
    }
    recordFailure("failed");
    cleanupAttempt();
    return {
      current,
      target,
      outcome: "failed",
      ...(verified ? { verifiedVersion: verified } : {}),
      message: `auto-upgrade to ${target} failed: verification mismatch (got ${verified ?? "unknown"}) (see ${logPath})`,
      logPath
    };
  } finally {
    try {
      lock.release();
    } catch {
      // best-effort
    }
  }
}
