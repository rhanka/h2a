/**
 * Per-account remote-control session exclusions and catalogue-id index (LH-06).
 *
 * Stored under `<resolveNodeKeyDir({ configDir, env })>/remote-control/`:
 * - `exclusions.json` (0600, versioned v1, atomic rename under `withLockSync`)
 * - `catalogue-ids.json` (0600, admissible canonical sids only, atomic rename on change)
 * - `.exclusions.lock` (shared lock between `off`, `on`, alias promotion and `withShareAllowed`)
 *
 * Directory mode is 0700. Missing files mean an empty set. Corrupt, unreadable
 * or lock-timed-out exclusion state fails closed with `exclusion-state-unavailable`.
 */

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

import { LockTimeoutError, withLock, withLockSync } from "../local-files/locks.js";
import { listPresenceWithDiagnostics } from "../local-files/presence.js";
import { resolveNodeKeyDir } from "./node-key.js";
import {
  isCanonicalCatalogueSid,
  nativeCatalogueSid,
  normalizeCatalogueSid,
  presenceCatalogueSid
} from "./wire-ids.js";
import { isInternalCompanionNativeId } from "./catalogue.js";

const REMOTE_CONTROL_SUBDIR = "remote-control";
const EXCLUSIONS_FILENAME = "exclusions.json";
const CATALOGUE_IDS_FILENAME = "catalogue-ids.json";
const EXCLUSIONS_LOCK_FILENAME = ".exclusions.lock";
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;

export interface StoredExclusionEntry {
  readonly sid: string;
  readonly aliases?: readonly string[];
  readonly updatedAt: string;
}

export interface StoredExclusionsFile {
  readonly version: 2;
  readonly entries: readonly StoredExclusionEntry[];
}

interface StoredCatalogueIdsFile {
  readonly version: 2;
  readonly sids: readonly string[];
}

export interface ExclusionsLocationOptions {
  readonly configDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ExclusionMutationOptions extends ExclusionsLocationOptions {
  readonly root: string;
  readonly now?: () => number;
}

export type ExclusionReadResult =
  | { readonly ok: true; readonly file: StoredExclusionsFile }
  | { readonly ok: false; readonly reason: "exclusion-state-unavailable"; readonly message: string };

export type ExclusionMutationResult =
  | { readonly ok: true; readonly sessionId: string; readonly excluded: boolean }
  | {
      readonly ok: false;
      readonly reason: "invalid-session" | "unknown-session" | "exclusion-state-unavailable";
      readonly message: string;
    };

export type ShareAllowedResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "excluded" | "exclusion-state-unavailable" };

export function resolveExclusionsDir(options: ExclusionsLocationOptions = {}): string {
  return join(resolveNodeKeyDir({ configDir: options.configDir, env: options.env }), REMOTE_CONTROL_SUBDIR);
}

export function resolveExclusionsFilePath(options: ExclusionsLocationOptions = {}): string {
  return join(resolveExclusionsDir(options), EXCLUSIONS_FILENAME);
}

export function resolveCatalogueIdsFilePath(options: ExclusionsLocationOptions = {}): string {
  return join(resolveExclusionsDir(options), CATALOGUE_IDS_FILENAME);
}

function resolveLockPath(options: ExclusionsLocationOptions = {}): string {
  return join(resolveExclusionsDir(options), EXCLUSIONS_LOCK_FILENAME);
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // mode already requested on creation
  }
}

function atomicWriteJson0600(dir: string, targetPath: string, payload: unknown): void {
  ensurePrivateDir(dir);
  const tmpPath = join(dir, `.tmp-${process.pid}-${randomUUID()}.json`);
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  try {
    writeFileSync(tmpPath, body, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // mode already requested at write
    }
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

function pickMostRecentTimestamp(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    return tb >= ta ? b : a;
  }
  return b >= a ? b : a;
}

function parseExclusionsFile(raw: string): StoredExclusionsFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const topKeys = Object.keys(obj);
  for (const key of topKeys) {
    if (key !== "version" && key !== "entries") return null;
  }
  const version = obj["version"];
  if ((version !== 1 && version !== 2) || !Array.isArray(obj["entries"])) return null;

  const bySid = new Map<string, { aliases: Set<string>; updatedAt: string }>();
  const entries: StoredExclusionEntry[] = [];
  for (const item of obj["entries"] as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (k !== "sid" && k !== "aliases" && k !== "updatedAt") return null;
    }
    if (typeof rec["sid"] !== "string") return null;
    const sid = version === 1 ? normalizeCatalogueSid(rec["sid"]) : (isCanonicalCatalogueSid(rec["sid"]) ? rec["sid"] : null);
    if (sid === null) return null;
    if (typeof rec["updatedAt"] !== "string" || rec["updatedAt"].length === 0) return null;
    const updatedAt = rec["updatedAt"];
    let aliases: string[] | undefined;
    if (rec["aliases"] !== undefined) {
      if (!Array.isArray(rec["aliases"])) return null;
      aliases = [];
      for (const a of rec["aliases"] as unknown[]) {
        if (typeof a !== "string") return null;
        const normAlias = version === 1 ? normalizeCatalogueSid(a) : (isCanonicalCatalogueSid(a) ? a : null);
        if (normAlias === null) return null;
        if (normAlias !== sid) aliases.push(normAlias);
      }
    }
    if (version === 1) {
      const existing = bySid.get(sid);
      if (existing) {
        existing.updatedAt = pickMostRecentTimestamp(existing.updatedAt, updatedAt);
        for (const a of aliases ?? []) existing.aliases.add(a);
      } else {
        bySid.set(sid, { aliases: new Set(aliases ?? []), updatedAt });
      }
    } else {
      entries.push({
        sid,
        ...(aliases !== undefined && aliases.length > 0 ? { aliases } : {}),
        updatedAt
      });
    }
  }
  if (version === 1) {
    const mergedEntries: StoredExclusionEntry[] = [];
    for (const [sid, data] of bySid.entries()) {
      const sortedAliases = [...data.aliases].filter((a) => a !== sid).sort();
      mergedEntries.push({
        sid,
        ...(sortedAliases.length > 0 ? { aliases: sortedAliases } : {}),
        updatedAt: data.updatedAt
      });
    }
    mergedEntries.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
    return { version: 2, entries: mergedEntries };
  }
  return { version: 2, entries };
}

function readExclusionsUnlocked(filePath: string): ExclusionReadResult {
  if (!existsSync(filePath)) {
    return { ok: true, file: { version: 2, entries: [] } };
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "exclusion-state-unavailable",
      message: `exclusion-state-unavailable: cannot read exclusions (${err instanceof Error ? err.message : String(err)})`
    };
  }
  const parsed = parseExclusionsFile(raw);
  if (!parsed) {
    return {
      ok: false,
      reason: "exclusion-state-unavailable",
      message: "exclusion-state-unavailable: exclusions file is corrupt or unsupported"
    };
  }
  return { ok: true, file: parsed };
}

export function readExclusions(options: ExclusionsLocationOptions = {}): ExclusionReadResult {
  const filePath = resolveExclusionsFilePath(options);
  return readExclusionsUnlocked(filePath);
}

function readCatalogueIdsSet(options: ExclusionsLocationOptions = {}): Set<string> {
  const filePath = resolveCatalogueIdsFilePath(options);
  if (!existsSync(filePath)) return new Set();
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown; sids?: unknown };
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.sids)) {
      return new Set();
    }
    const out = new Set<string>();
    for (const sid of parsed.sids) {
      if (typeof sid !== "string") continue;
      if (parsed.version === 1) {
        const norm = normalizeCatalogueSid(sid);
        if (norm !== null) out.add(norm);
      } else if (isCanonicalCatalogueSid(sid)) {
        out.add(sid);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

export function writeCatalogueIdsIndex(
  sids: readonly string[],
  options: ExclusionsLocationOptions = {}
): void {
  const dir = resolveExclusionsDir(options);
  const filePath = resolveCatalogueIdsFilePath(options);
  const lockPath = resolveLockPath(options);
  const normalized = [...new Set(sids.filter((s) => isCanonicalCatalogueSid(s)))].sort();
  ensurePrivateDir(dir);
  withLockSync(lockPath, () => {
    const existing = readCatalogueIdsSet(options);
    if (
      existing.size === normalized.length &&
      normalized.every((sid) => existing.has(sid))
    ) {
      return;
    }
    const payload: StoredCatalogueIdsFile = { version: 2, sids: normalized };
    atomicWriteJson0600(dir, filePath, payload);
  });
}

function entryMatchesAny(entry: StoredExclusionEntry, candidates: ReadonlySet<string>): boolean {
  if (candidates.has(entry.sid)) return true;
  if (entry.aliases) {
    for (const alias of entry.aliases) {
      if (candidates.has(alias)) return true;
    }
  }
  return false;
}

export function isSidExcluded(
  file: StoredExclusionsFile,
  sid: string,
  aliases: readonly string[] = []
): boolean {
  const candidates = new Set<string>([sid, ...aliases]);
  for (const entry of file.entries) {
    if (entryMatchesAny(entry, candidates)) return true;
  }
  return false;
}

export function validateSessionTarget(target: unknown): target is string {
  if (typeof target !== "string") return false;
  if (target.length === 0 || target.trim().length === 0) return false;
  if (target !== target.trim()) return false;
  if (CONTROL_CHAR_RE.test(target)) return false;
  return true;
}

interface ResolvedTarget {
  readonly ok: true;
  readonly sid: string;
  readonly aliases: readonly string[];
}

type TargetResolution =
  | ResolvedTarget
  | { readonly ok: false; readonly reason: "invalid-session" | "unknown-session"; readonly message: string };

function resolveTarget(
  target: string,
  root: string,
  existingExclusions: StoredExclusionsFile,
  catalogueIds: ReadonlySet<string>
): TargetResolution {
  if (!validateSessionTarget(target)) {
    return {
      ok: false,
      reason: "invalid-session",
      message: "invalid-session: session target must be a non-empty string"
    };
  }
  if (isInternalCompanionNativeId(target)) {
    return {
      ok: false,
      reason: "unknown-session",
      message: `unknown-session: "${target}" is not an admissible session`
    };
  }

  let presences: ReturnType<typeof listPresenceWithDiagnostics>["sessions"] = [];
  try {
    presences = listPresenceWithDiagnostics(root, { includeExpired: true, sweep: false }).sessions;
  } catch {
    presences = [];
  }

  const localPresences = presences.filter((p) => p.mirroredAt === undefined);
  const companionSids = new Set<string>();
  const companionPresenceIds = new Set<string>();
  const admissiblePresences: typeof localPresences = [];

  for (const p of localPresences) {
    const nativeId = p.launchContext?.nativePty?.session;
    if (nativeId && isInternalCompanionNativeId(nativeId)) {
      companionPresenceIds.add(p.sessionId);
      companionSids.add(nativeCatalogueSid(nativeId));
      companionSids.add(presenceCatalogueSid(p.sessionId));
      continue;
    }
    admissiblePresences.push(p);
  }

  const normalizedTarget = normalizeCatalogueSid(target) ?? target;

  if (companionPresenceIds.has(target) || companionSids.has(normalizedTarget)) {
    return {
      ok: false,
      reason: "unknown-session",
      message: `unknown-session: "${target}" is not an admissible session`
    };
  }

  if (isCanonicalCatalogueSid(normalizedTarget)) {
    // 1. Check admissible local presences
    for (const p of admissiblePresences) {
      const pSid = presenceCatalogueSid(p.sessionId);
      const nativeId = p.launchContext?.nativePty?.session;
      const nSid = nativeId ? nativeCatalogueSid(nativeId) : undefined;
      if (nSid && (normalizedTarget === nSid || normalizedTarget === pSid)) {
        return { ok: true, sid: nSid, aliases: [pSid] };
      }
      if (!nSid && normalizedTarget === pSid) {
        return { ok: true, sid: pSid, aliases: [] };
      }
    }
    // 2. Check existing exclusions (entry.sid or alias)
    for (const entry of existingExclusions.entries) {
      if (entry.sid === normalizedTarget || entry.aliases?.includes(normalizedTarget)) {
        return {
          ok: true,
          sid: entry.sid,
          aliases: entry.aliases ? [...entry.aliases] : []
        };
      }
    }
    // 3. Check persisted admissible catalogue-ids index
    if (catalogueIds.has(normalizedTarget)) {
      return { ok: true, sid: normalizedTarget, aliases: [] };
    }
    // Never fall through to raw name hashing for an unknown canonical hash.
    return {
      ok: false,
      reason: "unknown-session",
      message: `unknown-session: unknown canonical session id "${target}"`
    };
  }

  // Raw string: exact match on presence sessionId first (no fuzzy/label match).
  for (const p of admissiblePresences) {
    if (p.sessionId === target) {
      const nativeId = p.launchContext?.nativePty?.session;
      if (nativeId) {
        if (isInternalCompanionNativeId(nativeId)) {
          return {
            ok: false,
            reason: "unknown-session",
            message: `unknown-session: "${target}" is not an admissible session`
          };
        }
        return {
          ok: true,
          sid: nativeCatalogueSid(nativeId),
          aliases: [presenceCatalogueSid(p.sessionId)]
        };
      }
      return {
        ok: true,
        sid: presenceCatalogueSid(p.sessionId),
        aliases: []
      };
    }
  }

  // Otherwise treat raw string as an exact native PTY session name (even if
  // the agent is stopped). Companion suffix was already rejected above.
  return {
    ok: true,
    sid: nativeCatalogueSid(target),
    aliases: []
  };
}

function mergeAliases(existing: readonly string[] | undefined, extra: readonly string[], primarySid: string): string[] {
  const set = new Set<string>();
  for (const a of existing ?? []) {
    if (a !== primarySid && isCanonicalCatalogueSid(a)) set.add(a);
  }
  for (const a of extra) {
    if (a !== primarySid && isCanonicalCatalogueSid(a)) set.add(a);
  }
  return [...set].sort();
}

function applyExclusionLocked(
  target: string,
  excluded: boolean,
  options: ExclusionMutationOptions,
  dir: string,
  filePath: string,
  nowIso: string
): ExclusionMutationResult {
  const current = readExclusionsUnlocked(filePath);
  if (!current.ok) return current;
  const catalogueIds = readCatalogueIdsSet(options);
  const resolved = resolveTarget(target, options.root, current.file, catalogueIds);
  if (!resolved.ok) return resolved;

  const matchSet = new Set<string>([resolved.sid, ...resolved.aliases]);
  const remaining: StoredExclusionEntry[] = [];
  let mergedAliases: string[] = [...resolved.aliases];

  for (const entry of current.file.entries) {
    if (entryMatchesAny(entry, matchSet)) {
      mergedAliases = mergeAliases(mergedAliases, [entry.sid, ...(entry.aliases ?? [])], resolved.sid);
    } else {
      remaining.push(entry);
    }
  }

  if (excluded) {
    const finalAliases = mergeAliases(mergedAliases, [], resolved.sid);
    const nextEntry: StoredExclusionEntry = {
      sid: resolved.sid,
      ...(finalAliases.length > 0 ? { aliases: finalAliases } : {}),
      updatedAt: nowIso
    };
    remaining.push(nextEntry);
    remaining.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
  }

  const nextFile: StoredExclusionsFile = {
    version: 2,
    entries: remaining
  };
  atomicWriteJson0600(dir, filePath, nextFile);
  return { ok: true, sessionId: resolved.sid, excluded };
}

function preflightExclusionMutation(
  target: string,
  options: ExclusionMutationOptions
): { ok: true; dir: string; filePath: string; lockPath: string; nowIso: string } | ExclusionMutationResult {
  if (!validateSessionTarget(target)) {
    return {
      ok: false,
      reason: "invalid-session",
      message: "invalid-session: session target must be a non-empty string"
    };
  }
  if (isInternalCompanionNativeId(target)) {
    return {
      ok: false,
      reason: "unknown-session",
      message: `unknown-session: "${target}" is not an admissible session`
    };
  }

  // Pre-flight read-only check before creating any directory or lock file so
  // refusals (`unknown-session`, corrupt file) perform zero writes.
  const preRead = readExclusions(options);
  if (!preRead.ok) return preRead;
  const preCatalogueIds = readCatalogueIdsSet(options);
  const preResolved = resolveTarget(target, options.root, preRead.file, preCatalogueIds);
  if (!preResolved.ok) return preResolved;

  return {
    ok: true,
    dir: resolveExclusionsDir(options),
    filePath: resolveExclusionsFilePath(options),
    lockPath: resolveLockPath(options),
    nowIso: new Date((options.now ?? Date.now)()).toISOString()
  };
}

function exclusionMutationError(err: unknown): ExclusionMutationResult {
  if (err instanceof LockTimeoutError) {
    return {
      ok: false,
      reason: "exclusion-state-unavailable",
      message: "exclusion-state-unavailable: lock timeout on exclusions"
    };
  }
  return {
    ok: false,
    reason: "exclusion-state-unavailable",
    message: `exclusion-state-unavailable: ${err instanceof Error ? err.message : String(err)}`
  };
}

function mutateExclusion(
  target: string,
  excluded: boolean,
  options: ExclusionMutationOptions
): ExclusionMutationResult {
  const pre = preflightExclusionMutation(target, options);
  if (!("dir" in pre)) return pre;
  try {
    ensurePrivateDir(pre.dir);
    return withLockSync(pre.lockPath, (): ExclusionMutationResult =>
      applyExclusionLocked(target, excluded, options, pre.dir, pre.filePath, pre.nowIso)
    );
  } catch (err) {
    return exclusionMutationError(err);
  }
}

async function mutateExclusionAsync(
  target: string,
  excluded: boolean,
  options: ExclusionMutationOptions
): Promise<ExclusionMutationResult> {
  const pre = preflightExclusionMutation(target, options);
  if (!("dir" in pre)) return pre;
  try {
    ensurePrivateDir(pre.dir);
    return await withLock(pre.lockPath, (): ExclusionMutationResult =>
      applyExclusionLocked(target, excluded, options, pre.dir, pre.filePath, pre.nowIso)
    );
  } catch (err) {
    return exclusionMutationError(err);
  }
}

export function setSessionExcluded(
  target: string,
  options: ExclusionMutationOptions
): ExclusionMutationResult {
  return mutateExclusion(target, true, options);
}

export function setSessionExcludedAsync(
  target: string,
  options: ExclusionMutationOptions
): Promise<ExclusionMutationResult> {
  return mutateExclusionAsync(target, true, options);
}

export function clearSessionExcluded(
  target: string,
  options: ExclusionMutationOptions
): ExclusionMutationResult {
  return mutateExclusion(target, false, options);
}

export function clearSessionExcludedAsync(
  target: string,
  options: ExclusionMutationOptions
): Promise<ExclusionMutationResult> {
  return mutateExclusionAsync(target, false, options);
}

/**
 * Promote an existing `p-` exclusion entry to carry its newly discovered `n-`
 * target as primary `sid` while keeping the `p-` sid as an alias in the same
 * entry, under the shared exclusions lock.
 */
export function linkExclusionAlias(
  presenceSid: string,
  nativeSid: string,
  options: ExclusionsLocationOptions & { readonly now?: () => number } = {}
): ExclusionReadResult {
  const dir = resolveExclusionsDir(options);
  const filePath = resolveExclusionsFilePath(options);
  const lockPath = resolveLockPath(options);
  const nowIso = new Date((options.now ?? Date.now)()).toISOString();

  try {
    ensurePrivateDir(dir);
    return withLockSync(lockPath, (): ExclusionReadResult => {
      const current = readExclusionsUnlocked(filePath);
      if (!current.ok) return current;
      const matchSet = new Set<string>([presenceSid, nativeSid]);
      let found = false;
      const remaining: StoredExclusionEntry[] = [];
      let aliases: string[] = [presenceSid];

      for (const entry of current.file.entries) {
        if (entryMatchesAny(entry, matchSet)) {
          found = true;
          aliases = mergeAliases(aliases, [entry.sid, ...(entry.aliases ?? [])], nativeSid);
        } else {
          remaining.push(entry);
        }
      }
      if (!found) return current;

      const finalAliases = mergeAliases(aliases, [], nativeSid);
      remaining.push({
        sid: nativeSid,
        ...(finalAliases.length > 0 ? { aliases: finalAliases } : {}),
        updatedAt: nowIso
      });
      remaining.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
      const nextFile: StoredExclusionsFile = { version: 2, entries: remaining };
      atomicWriteJson0600(dir, filePath, nextFile);
      return { ok: true, file: nextFile };
    });
  } catch (err) {
    return {
      ok: false,
      reason: "exclusion-state-unavailable",
      message: `exclusion-state-unavailable: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Re-reads exclusions under the SAME `withLockSync` lock used by `off`/`on`
 * and executes the synchronous `enqueue()` callback BEFORE releasing the lock.
 * Guarantees that once `off` confirms, no further terminal bytes (even an
 * already in-flight host read finishing concurrently) can be enqueued.
 * Never performs network I/O under the lock.
 */
export function withExclusionShareAllowed(
  input: ExclusionsLocationOptions & { readonly sid: string; readonly aliases?: readonly string[] },
  enqueue: () => void
): ShareAllowedResult {
  const dir = resolveExclusionsDir(input);
  const filePath = resolveExclusionsFilePath(input);
  const lockPath = resolveLockPath(input);
  try {
    ensurePrivateDir(dir);
    return withLockSync(lockPath, (): ShareAllowedResult => {
      const current = readExclusionsUnlocked(filePath);
      if (!current.ok) {
        return { allowed: false, reason: "exclusion-state-unavailable" };
      }
      if (isSidExcluded(current.file, input.sid, input.aliases ?? [])) {
        return { allowed: false, reason: "excluded" };
      }
      enqueue();
      return { allowed: true };
    });
  } catch {
    return { allowed: false, reason: "exclusion-state-unavailable" };
  }
}
