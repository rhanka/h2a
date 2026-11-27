/**
 * Interim h2a-side bridge lock (`h2a.registry-bridge-lock/v1`).
 *
 * Until the later R7a `sentropic-registry` executable ships the
 * `sentropic.registry-lock/v1` format with its installer, the h2a bridge
 * reads this deployment-owned lock provisioned by `registry bootstrap
 * install` next to the host config (`<config>.h2a-lock.json`, overridable
 * with `--lock`). Same rules as the contract lock in miniature: closed
 * fields, pinned entry digests rechecked against the packed descriptors at
 * serve time, no secrets, no URLs to execute. R7a supersedes this file; the
 * format string keeps them distinct so no reader confuses the two.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { canonicalJson, normalizeConfiguration, sha256Hex, validateRegistryEntry, type RegistryEntry } from "./descriptors.js";
import { registryPackageManifest } from "./manifest.js";
import { MEMORY_PROVIDER_ID, missingMemoryBuiltin } from "./memory-provider.js";
import { RegistryError } from "./descriptors.js";

export const BRIDGE_LOCK_FORMAT = "h2a.registry-bridge-lock/v1";

export interface BridgeLockSelection {
  kind: string;
  id: string;
  entryVersion: string;
}

export interface BridgeLock {
  format: typeof BRIDGE_LOCK_FORMAT;
  lockVersion: 1;
  revision: 1;
  host: string;
  profile: string;
  bridge: { command: string; args: string[] };
  selection: BridgeLockSelection[];
  entries: Record<string, { digest: string; config: Record<string, unknown>; configDigest: string }>;
  compatibility: { hostFeatures: string[]; protocolVersions: string[] };
}

export function bridgeLockDigest(lock: BridgeLock): string {
  return sha256Hex(canonicalJson(lock));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultBridgeLockPath(configPath: string): string {
  return `${configPath}.h2a-lock.json`;
}

/**
 * Config base for plugin-mechanism defaults (RQ-17): XDG_CONFIG_HOME, else
 * `~/.config`. Never baked into a packed declaration: the default lock
 * resolves at serve time from the serving environment.
 */
export function pluginBridgeConfigBase(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg && isAbsolute(xdg)) return xdg;
  const home = process.env.HOME?.trim();
  if (home && isAbsolute(home)) return join(home, ".config");
  throw Object.assign(
    new Error("missing_lock: cannot resolve the plugin default lock location without an absolute XDG_CONFIG_HOME or HOME"),
    { code: "missing_lock" }
  );
}

/**
 * Default lock location for the plugin mechanism, provisioned by
 * `bootstrap install --mechanism plugin`:
 * `<config-base>/sentropic/h2a/registry-bridge/<host>/<profile>.lock.json`
 * (interim mirror of the registry v8 §7.3 default layout). Host/profile are
 * restricted to path-safe tokens so argv can never escape the directory.
 */
export function defaultPluginBridgeLockPath(host: string, profile: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(host) || !/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw Object.assign(
      new Error(`invalid_parameters: refusing path-unsafe host/profile ${JSON.stringify(host)}/${JSON.stringify(profile)} for the plugin default lock`),
      { code: "invalid_parameters" }
    );
  }
  return join(pluginBridgeConfigBase(), "sentropic", "h2a", "registry-bridge", host, `${profile}.lock.json`);
}

/** Frozen CLI binding refs for a full-tuple bridge lock (guide §4). */
export function defaultBridgeConfigs(): Record<string, Record<string, unknown>> {
  return {
    "sentropic.h2a": { mode: "shared-central", serviceBindingRef: "h2a-local-central" },
    "sentropic.track": { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" }
  };
}

export interface ProvisionBridgeLockOptions {
  lockPath: string;
  host?: string;
  profile?: string;
  bridge?: { command: string; args: string[] };
  h2aEntry?: RegistryEntry;
  trackEntry?: RegistryEntry;
  memory?: { entry: RegistryEntry; config: Record<string, unknown> };
}

/**
 * Provision the default full-tuple lock when absent. An existing lock is
 * never rewritten here (rotation is an explicit later operator action).
 * Uses atomic write-temp + hardlink (`linkSync`) so parallel startups never
 * observe a partial lock or overwrite an existing lock.
 */
export function provisionBridgeLock(
  optionsOrPath: ProvisionBridgeLockOptions | string
): { lockPath: string; action: "provisioned" | "already-present" } {
  const options: ProvisionBridgeLockOptions = typeof optionsOrPath === "string"
    ? { lockPath: optionsOrPath }
    : optionsOrPath;
  const lockPath = options.lockPath;
  if (existsSync(lockPath)) return { lockPath, action: "already-present" };
  const host = options.host ?? "claude";
  const profile = options.profile ?? "default";
  const bridge = options.bridge ?? {
    command: "h2a",
    args: ["registry-bridge", "serve", "--host", host, "--profile", profile, "--wake", "auto", "--auto-open", "--auto-upgrade"]
  };
  const h2aEntry = options.h2aEntry ?? (registryPackageManifest.entries[0] as unknown as RegistryEntry);
  const trackEntry = options.trackEntry ?? (trackRegistryPackageManifest.entries[0] as unknown as RegistryEntry);
  const configs = defaultBridgeConfigs();
  const entries: BridgeLock["entries"] = {};
  if (options.memory) configs[MEMORY_PROVIDER_ID] = options.memory.config;
  const selectedEntries = [h2aEntry, trackEntry, ...(options.memory ? [options.memory.entry] : [])];
  for (const entry of selectedEntries) {
    const { digest } = validateRegistryEntry(entry);
    const config = configs[entry.id] as Record<string, unknown>;
    const normalized = normalizeConfiguration(entry, config);
    entries[entry.id] = { digest, config, configDigest: sha256Hex(canonicalJson(normalized)) };
  }
  const lock: BridgeLock = {
    format: BRIDGE_LOCK_FORMAT,
    lockVersion: 1,
    revision: 1,
    host,
    profile,
    bridge,
    selection: selectedEntries.map(entry => ({ kind: entry.kind, id: entry.id, entryVersion: entry.entryVersion })),
    entries,
    compatibility: { hostFeatures: [...new Set(["stdio", "streamable-http", ...(options.memory?.entry.compatibility.requiredHostFeatures ?? [])])], protocolVersions: ["2025-06-18"] }
  };
  mkdirSync(dirname(lockPath), { recursive: true });
  const tmpPath = `${lockPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmpPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    linkSync(tmpPath, lockPath);
    return { lockPath, action: "provisioned" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
      return { lockPath, action: "already-present" };
    }
    throw err;
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

/** Read and closed-validate a bridge lock; rechecks pinned digests. */
export function readBridgeLock(lockPath: string, memoryEntry?: RegistryEntry): BridgeLock {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
  } catch (error) {
    throw Object.assign(new Error(`missing_lock: unreadable bridge lock at ${lockPath} (${(error as Error).message}); run h2a registry bootstrap install`), { code: "missing_lock" });
  }
  if (!isRecord(raw) || raw["format"] !== BRIDGE_LOCK_FORMAT) {
    throw Object.assign(new Error(`missing_lock: no ${BRIDGE_LOCK_FORMAT} lock at ${lockPath}; run h2a registry bootstrap install`), { code: "missing_lock" });
  }
  const lock = raw as unknown as BridgeLock;
  if (lock.lockVersion !== 1 || !Array.isArray(lock.selection) || !isRecord(lock.entries) || !isRecord(lock.compatibility)) {
    throw Object.assign(new Error("invalid_entry: bridge lock has malformed version/selection/entries"), { code: "invalid_entry" });
  }
  return validateBridgeLock(lock, memoryEntry);
}

export function bridgeLockJournalPath(lockPath: string): string {
  return `${lockPath}.rotations.jsonl`;
}

const PUBLISHED_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function isPublishedPackageVersion(version: unknown): version is string {
  return typeof version === "string" && PUBLISHED_SEMVER_RE.test(version);
}

export interface PriorShippedEntryDescriptor {
  readonly id: string;
  readonly packageName: string;
  readonly packageVersion: string;
}

/**
 * Cryptographic SHA-256 digests of prior published `@sentropic/h2a` and
 * `@sentropic/track` descriptor releases where tool lists or assets evolved
 * across upgrades. Used only when verifying a same-publisher upgrade.
 */
export const PRIOR_SHIPPED_ENTRY_DIGESTS: ReadonlyMap<string, PriorShippedEntryDescriptor> = new Map([
  // sentropic.h2a (@sentropic/h2a) historical published digests
  ["19ef6ae787924a4965e7fdaf2180fdb174861076cb98c51ae38c30760d12ea92", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.11" }],
  ["9451fa7f46bd00d9b19d54459446442003c8d2304461edff7af6ef2384596c76", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.11-rc.15" }],
  ["38e1244358ff2f46cdb93bb77bec82649fc09c9486783aa1168d1d90fe9b9558", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.11-rc.15" }],
  ["2d0e8908c2f04db1b9ea650dde4cdb213fd6b556b94069db4cc7dd0340f8ff0b", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.11" }],
  ["cff260bcc91f35adb6ce000cfceee2f1901b5492faace84f6d5e714d6f35912d", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.11" }],
  ["696e69bd40ef48b031945567fe08619aee93bcaf40d797ec6d68ac5c618aa370", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.11-rc.1" }],
  ["a9c5ce69927ced6c122ef6701ef95203b31e5fb4f0e79a22c8319f3546311bfb", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.10" }],
  ["05dbec96687a7591592de3deec3f859cede5aefa9b7b2b6c10cec8b42b94dcc8", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.9" }],
  ["2e6bdcccd6a54ea68297d40e041abd1694e56b9a2a5842f0ab9071f2981b5de9", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.9" }],
  ["55cd0be7e976bb892ad6f9c9ae2e5c35372d2e7cd96f60719914100a3ee85db8", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.8" }],
  ["7cb7fc68b8fa984c4a8022d25ed1932337dc100aa72f6fc27380868bb093226f", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.7" }],
  ["ba7f91bf40ef991c00478a264c90fbba508d93823948634305fb5873cb9843a9", { id: "sentropic.h2a", packageName: "@sentropic/h2a", packageVersion: "0.98.7" }],
  // sentropic.track (@sentropic/track) historical published digests
  ["32acd594c83516f9bbcf994d6743ae59a484c1c33f2c2f188e888fd1434ab630", { id: "sentropic.track", packageName: "@sentropic/track", packageVersion: "0.98.11" }],
  ["582318b1c07ef35ce52d6f0091e279e1af5e7eee999f6417936852c82149ba8c", { id: "sentropic.track", packageName: "@sentropic/track", packageVersion: "0.98.10" }],
  ["cc4c77e4670fd73211cfccc24134507c190109732278ff15ee24b3f53017eaa1", { id: "sentropic.track", packageName: "@sentropic/track", packageVersion: "0.98.9" }],
  ["46743d065e189b8be17d260ea0daa2dadc819e01755026e279723d6cdaa34955", { id: "sentropic.track", packageName: "@sentropic/track", packageVersion: "0.98.8" }],
  ["43de4a6e80eb6914ea2b559976ac100aa233720fda8208c117e74c0c2abbb324", { id: "sentropic.track", packageName: "@sentropic/track", packageVersion: "0.98.7" }],
  ["98449c959a0bc8cf6e7929f72f8da08dee537348077025440fc4d2d4f331fd78", { id: "sentropic.track", packageName: "@sentropic/track", packageVersion: "0.98.5" }]
]);

export interface RotateBridgeLockVerificationInput {
  id: string;
  priorDigest: string;
  packed: RegistryEntry;
  lock: BridgeLock;
}

export interface RotateBridgeLockOptions {
  lockPath: string;
  host?: string;
  profile?: string;
  bridge?: { command: string; args: string[] };
  h2aEntry?: RegistryEntry;
  trackEntry?: RegistryEntry;
  memory?: { entry: RegistryEntry; config: Record<string, unknown> };
  dryRun?: boolean;
  actor?: string;
  reason?: string;
  journalPath?: string;
  verifyPriorDigest?: (input: RotateBridgeLockVerificationInput) => { priorVersion: string; reason: string } | null;
}

export interface RotatedEntryRecord {
  id: string;
  packageName: string;
  priorDigest: string;
  newDigest: string;
  priorVersion: string | null;
  newVersion: string;
  verificationReason?: string;
}

export interface RotateBridgeLockResult {
  rotated: boolean;
  action: "rotated" | "would-rotate" | "unchanged";
  lockPath: string;
  backupPath?: string;
  journalPath?: string;
  priorLockDigest: string;
  newLockDigest: string;
  rotatedEntries: RotatedEntryRecord[];
}

function buildKnownEntriesMap(
  lockSelection: readonly BridgeLockSelection[],
  options: { h2aEntry?: RegistryEntry; trackEntry?: RegistryEntry; memoryEntry?: RegistryEntry }
): Map<string, RegistryEntry> {
  const h2a = options.h2aEntry ?? (registryPackageManifest.entries[0] as RegistryEntry);
  const track = options.trackEntry ?? (trackRegistryPackageManifest.entries[0] as RegistryEntry);
  const known = new Map<string, RegistryEntry>([
    [h2a.id, h2a],
    [track.id, track]
  ]);
  if (lockSelection.some((selected) => selected.id === MEMORY_PROVIDER_ID)) {
    const memory = options.memoryEntry ?? missingMemoryBuiltin();
    if (
      memory.kind !== "mcp" ||
      memory.id !== MEMORY_PROVIDER_ID ||
      memory.publisher.packageName !== "@sentropic/engram" ||
      memory.mcp?.connectorIds.length !== 1 ||
      memory.mcp.connectorIds[0] !== "engram-memory" ||
      !memory.mcp.transportProfiles.some((profile) => profile.id === "sentropic.engram.memory-wire/v1" && profile.mode === "in-process")
    ) {
      throw new RegistryError("invalid_entry", "step=bridge-lock-selection-verification: memory entry must name sentropic.engram.memory / engram-memory");
    }
    known.set(MEMORY_PROVIDER_ID, memory);
  }
  return known;
}

function writeAndFsyncFile(path: string, content: string | Buffer, mode: number, flag: "wx" | "w" = "wx"): void {
  const fd = openSync(path, flag === "wx" ? "wx" : "w", mode);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Reused by daemon composition: no unchecked selection bypasses the lock. */
export function validateBridgeLock(lock: BridgeLock, memoryEntry?: RegistryEntry): BridgeLock {
  const known = buildKnownEntriesMap(lock.selection, { memoryEntry });
  const seen = new Set<string>();
  for (const selected of lock.selection) {
    const packed = known.get(selected.id);
    if (!packed) {
      throw Object.assign(
        new Error(`invalid_entry: step=bridge-lock-selection-verification: bridge lock selects unknown provider ${selected.id}`),
        { code: "invalid_entry" }
      );
    }
    if (seen.has(selected.id)) {
      throw new RegistryError("invalid_entry", `step=bridge-lock-selection-verification: duplicate bridge selection ${selected.id}`);
    }
    seen.add(selected.id);
    if (selected.kind !== packed.kind || selected.entryVersion !== packed.entryVersion) {
      throw new RegistryError("incompatible_version", `step=bridge-lock-version-verification: bridge selection version differs for ${selected.id}`);
    }
    const record = lock.entries[selected.id];
    if (!isRecord(record) || typeof record["digest"] !== "string") {
      throw Object.assign(
        new Error(`invalid_entry: step=bridge-lock-digest-presence: bridge lock has no pinned digest for ${selected.id}`),
        { code: "invalid_entry" }
      );
    }
    validateRegistryEntry(packed, {
      expectedDigest: record["digest"] as string,
      stage: "bridge-lock-descriptor-verification"
    });
    const normalized = normalizeConfiguration(packed, record.config);
    if (record.configDigest !== sha256Hex(canonicalJson(normalized))) {
      throw new RegistryError("integrity_mismatch", `step=bridge-lock-config-verification: configuration digest differs for ${selected.id}`);
    }
  }
  if (Object.keys(lock.entries).some((id) => !seen.has(id))) {
    throw new RegistryError("invalid_entry", "step=bridge-lock-selection-verification: unselected bridge entry");
  }
  return lock;
}

/**
 * Rotate/re-pin an existing bridge lock to the current verified descriptors of
 * this installation. Refuses closed on missing/malformed locks, host/profile
 * mismatches, unknown descriptor providers, tampered config digests, or (when
 * `verifyPriorDigest` is supplied) unproven prior digests. Before replacing
 * `lockPath`, durably writes and verifies an exact `<lockPath>.quarantine-*`
 * backup, atomically renames the updated lock over `lockPath`, and appends an
 * entry to `<lockPath>.rotations.jsonl`.
 */
export function rotateBridgeLock(options: RotateBridgeLockOptions): RotateBridgeLockResult {
  const lockPath = options.lockPath;
  if (!existsSync(lockPath)) {
    throw new RegistryError(
      "missing_lock",
      `step=bridge-lock-read: no ${BRIDGE_LOCK_FORMAT} lock at ${lockPath}; run h2a registry bootstrap install`
    );
  }
  let originalBytes: Buffer;
  let parsed: unknown;
  try {
    originalBytes = readFileSync(lockPath);
    parsed = JSON.parse(originalBytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new RegistryError(
      "invalid_entry",
      `step=bridge-lock-parse: unreadable or malformed JSON lock at ${lockPath}: ${(error as Error).message}`
    );
  }
  if (!isRecord(parsed) || parsed["format"] !== BRIDGE_LOCK_FORMAT) {
    throw new RegistryError(
      "invalid_entry",
      `step=bridge-lock-format: lock at ${lockPath} does not declare format ${BRIDGE_LOCK_FORMAT}`
    );
  }
  const existing = parsed as unknown as BridgeLock;
  if (
    existing.lockVersion !== 1 ||
    !Array.isArray(existing.selection) ||
    existing.selection.length === 0 ||
    !isRecord(existing.entries) ||
    !isRecord(existing.compatibility)
  ) {
    throw new RegistryError(
      "invalid_entry",
      `step=bridge-lock-structure: bridge lock at ${lockPath} has malformed version/selection/entries`
    );
  }
  if (options.host !== undefined && existing.host !== options.host) {
    throw new RegistryError(
      "invalid_entry",
      `step=bridge-lock-scope-verification: lock at ${lockPath} binds host=${existing.host}, not host=${options.host}`
    );
  }
  if (options.profile !== undefined && existing.profile !== options.profile) {
    throw new RegistryError(
      "invalid_entry",
      `step=bridge-lock-scope-verification: lock at ${lockPath} binds profile=${existing.profile}, not profile=${options.profile}`
    );
  }

  const known = buildKnownEntriesMap(existing.selection, {
    h2aEntry: options.h2aEntry,
    trackEntry: options.trackEntry,
    memoryEntry: options.memory?.entry
  });

  const seen = new Set<string>();
  const rotatedEntries: RotatedEntryRecord[] = [];
  const nextEntries: BridgeLock["entries"] = {};

  for (const selected of existing.selection) {
    if (!isRecord(selected) || typeof selected.id !== "string") {
      throw new RegistryError("invalid_entry", "step=bridge-lock-selection-verification: malformed selection entry");
    }
    const packed = known.get(selected.id);
    if (!packed) {
      throw new RegistryError(
        "invalid_entry",
        `step=bridge-lock-selection-verification: bridge lock selects unknown provider ${selected.id}`
      );
    }
    if (seen.has(selected.id)) {
      throw new RegistryError(
        "invalid_entry",
        `step=bridge-lock-selection-verification: duplicate bridge selection ${selected.id}`
      );
    }
    seen.add(selected.id);
    if (selected.kind !== packed.kind || selected.entryVersion !== packed.entryVersion) {
      throw new RegistryError(
        "incompatible_version",
        `step=bridge-lock-version-verification: bridge selection version differs for ${selected.id}`
      );
    }
    const record = existing.entries[selected.id];
    if (!isRecord(record) || typeof record["digest"] !== "string" || !isRecord(record["config"])) {
      throw new RegistryError(
        "invalid_entry",
        `step=bridge-lock-digest-presence: bridge lock has no valid entry record for ${selected.id}`
      );
    }
    const { digest: currentDigest } = validateRegistryEntry(packed, {
      stage: "bridge-lock-packed-descriptor-verification"
    });
    const normalized = normalizeConfiguration(packed, record["config"]);
    const expectedConfigDigest = sha256Hex(canonicalJson(normalized));
    if (record["configDigest"] !== expectedConfigDigest) {
      throw new RegistryError(
        "integrity_mismatch",
        `step=bridge-lock-config-verification: configuration digest differs for ${selected.id}`
      );
    }
    const priorDigest = record["digest"] as string;
    if (priorDigest !== currentDigest) {
      let verification: { priorVersion: string; reason: string } | null = null;
      if (options.verifyPriorDigest) {
        verification = options.verifyPriorDigest({
          id: selected.id,
          priorDigest,
          packed,
          lock: existing
        });
        if (!verification) {
          throw new RegistryError(
            "integrity_mismatch",
            `step=bridge-lock-descriptor-verification: prior descriptor digest for ${selected.id} (${packed.publisher.packageName}@${packed.publisher.packageVersion}) does not match any verified published version (pinned=${priorDigest}, actual=${currentDigest})`
          );
        }
      } else {
        const knownPrior = PRIOR_SHIPPED_ENTRY_DIGESTS.get(priorDigest);
        verification =
          knownPrior &&
          knownPrior.id === packed.id &&
          knownPrior.packageName === packed.publisher.packageName
            ? { priorVersion: knownPrior.packageVersion, reason: "shipped-descriptor-history" }
            : { priorVersion: "unknown", reason: "operator-explicit-rotation" };
      }
      rotatedEntries.push({
        id: selected.id,
        packageName: packed.publisher.packageName,
        priorDigest,
        newDigest: currentDigest,
        priorVersion: verification.priorVersion,
        newVersion: packed.publisher.packageVersion,
        verificationReason: verification.reason
      });
    }
    nextEntries[selected.id] = {
      digest: currentDigest,
      config: record["config"] as Record<string, unknown>,
      configDigest: expectedConfigDigest
    };
  }

  if (Object.keys(existing.entries).some((id) => !seen.has(id))) {
    throw new RegistryError(
      "invalid_entry",
      "step=bridge-lock-selection-verification: unselected bridge entry"
    );
  }

  const nextLock: BridgeLock = {
    ...existing,
    ...(options.bridge ? { bridge: options.bridge } : {}),
    entries: nextEntries
  };
  const priorLockDigest = bridgeLockDigest(existing);
  const newLockDigest = bridgeLockDigest(nextLock);
  const bridgeChanged = options.bridge !== undefined && canonicalJson(existing.bridge) !== canonicalJson(nextLock.bridge);
  if (rotatedEntries.length === 0 && !bridgeChanged) {
    return {
      rotated: false,
      action: "unchanged",
      lockPath,
      priorLockDigest,
      newLockDigest,
      rotatedEntries: []
    };
  }

  if (options.dryRun) {
    return {
      rotated: true,
      action: "would-rotate",
      lockPath,
      priorLockDigest,
      newLockDigest,
      rotatedEntries
    };
  }

  const backupPath = `${lockPath}.quarantine-${Date.now()}-${randomUUID().slice(0, 8)}`;
  try {
    writeAndFsyncFile(backupPath, originalBytes, 0o600, "wx");
    if (!readFileSync(backupPath).equals(originalBytes)) {
      throw new RegistryError("restore_failed", `step=bridge-lock-backup: backup copy verification failed for ${backupPath}`);
    }
  } catch (err) {
    if (err instanceof RegistryError) throw err;
    throw new RegistryError(
      "restore_failed",
      `step=bridge-lock-backup: failed to back up stale bridge lock at ${lockPath}: ${(err as Error).message ?? "unknown error"}`
    );
  }

  mkdirSync(dirname(lockPath), { recursive: true });
  const tmpPath = `${lockPath}.tmp-${process.pid}-${randomUUID()}`;
  writeAndFsyncFile(tmpPath, `${JSON.stringify(nextLock, null, 2)}\n`, 0o600, "wx");
  try {
    renameSync(tmpPath, lockPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }

  const journalPath = options.journalPath ?? bridgeLockJournalPath(lockPath);
  const journalRecord = {
    schemaVersion: 1,
    rotatedAt: new Date().toISOString(),
    lockPath,
    host: existing.host,
    profile: existing.profile,
    actor: options.actor ?? "rotateBridgeLock",
    reason: options.reason ?? "descriptor-rotation",
    backupPath,
    priorLockDigest,
    newLockDigest,
    entries: rotatedEntries
  };
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${JSON.stringify(journalRecord)}\n`, { mode: 0o600 });

  return {
    rotated: true,
    action: "rotated",
    lockPath,
    backupPath,
    journalPath,
    priorLockDigest,
    newLockDigest,
    rotatedEntries
  };
}

export function resolveClaudeConfigRoot(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override && isAbsolute(override)) return override;
  return join(home, ".claude");
}

export function resolveClaudeConfigPath(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override && isAbsolute(override)) return join(override, ".claude.json");
  return join(home, ".claude.json");
}

export function resolveCodexConfigRoot(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEX_HOME?.trim();
  if (override && isAbsolute(override)) return override;
  return join(home, ".codex");
}

export interface BridgeLockLivenessOptions {
  home?: string;
  configPath?: string;
  ignoreConfigPath?: string;
  checkPresence?: (host: string) => boolean | readonly string[];
}

export interface BridgeLockQuarantineOptions extends BridgeLockLivenessOptions {
  reason?: string;
  forceQuarantineCorrupt?: boolean;
}

export interface BridgeLockQuarantineResult {
  action: "absent" | "preserved-live" | "quarantined" | "error";
  lockPath: string;
  quarantinePath?: string;
  reason?: string;
  error?: string;
}

export function compareSemverDesc(a: string, b: string): number {
  const parse = (raw: string) => {
    const withoutBuild = raw.replace(/^v/i, "").split("+")[0] ?? "";
    const dashAt = withoutBuild.indexOf("-");
    const coreStr = dashAt === -1 ? withoutBuild : withoutBuild.slice(0, dashAt);
    const preStr = dashAt === -1 ? null : withoutBuild.slice(dashAt + 1);
    const core = coreStr.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    const pre = preStr !== null ? preStr.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : null;
    return { core, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  const maxCore = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < maxCore; i++) {
    const va = pa.core[i] ?? 0;
    const vb = pb.core[i] ?? 0;
    if (va === vb) continue;
    if (typeof va === "number" && typeof vb === "number") return vb - va;
    return String(vb).localeCompare(String(va));
  }
  if (pa.pre === null && pb.pre === null) return b.localeCompare(a);
  if (pa.pre === null) return -1;
  if (pb.pre === null) return 1;
  const maxPre = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < maxPre; i++) {
    const va = pa.pre[i];
    const vb = pb.pre[i];
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    if (va === vb) continue;
    if (typeof va === "number" && typeof vb === "number") return vb - va;
    if (typeof va === "number") return 1;
    if (typeof vb === "number") return -1;
    return String(vb).localeCompare(String(va));
  }
  return b.localeCompare(a);
}

export function findVerifiedPluginVersionDir(
  cacheDir: string,
  host: string,
  verifyCandidate?: (dir: string) => boolean
): string | null {
  const manifestSubdir = host === "claude" ? ".claude-plugin" : ".codex-plugin";
  const check = verifyCandidate ?? ((dir: string) => existsSync(join(dir, manifestSubdir, "registry.mcp.json")));
  try {
    const versions = readdirSync(cacheDir).sort(compareSemverDesc);
    for (const ver of versions) {
      const candidate = join(cacheDir, ver);
      if (check(candidate)) return candidate;
    }
  } catch {
    /* absent */
  }
  return null;
}

function hasActivePluginCacheForHost(home: string, host: string): boolean {
  if (host === "claude") {
    const claudeRoot = resolveClaudeConfigRoot(home);
    const installedPath = join(claudeRoot, "plugins", "installed_plugins.json");
    try {
      const installed = JSON.parse(readFileSync(installedPath, "utf8")) as Record<string, unknown>;
      const plugins = isRecord(installed["plugins"]) ? installed["plugins"] : {};
      const entries = plugins["h2a@sentropic"];
      if (Array.isArray(entries)) {
        for (const item of entries) {
          if (isRecord(item) && typeof item["installPath"] === "string" && existsSync(item["installPath"])) {
            return true;
          }
        }
      }
    } catch {
      /* fall through to cache scan */
    }
    const cacheDir = join(claudeRoot, "plugins", "cache", "sentropic", "h2a");
    if (findVerifiedPluginVersionDir(cacheDir, "claude") !== null) return true;
  }
  if (host === "codex") {
    const codexRoot = resolveCodexConfigRoot(home);
    const cacheDir = join(codexRoot, "plugins", "cache", "sentropic", "h2a");
    if (findVerifiedPluginVersionDir(cacheDir, "codex") !== null) return true;
  }
  return false;
}

function hostConfigReferencesBridge(configPath: string): boolean {
  if (existsSync(`${configPath}.h2a-registry.json`)) return true;
  if (!existsSync(configPath)) return false;
  try {
    const raw = readFileSync(configPath, "utf8");
    return raw.includes("registry-bridge");
  } catch {
    return false;
  }
}

function inferHostProfileFromPluginLockPath(lockPath: string): { host: string; profile: string } | null {
  const file = basename(lockPath);
  if (!file.endsWith(".lock.json")) return null;
  const profile = file.slice(0, -".lock.json".length);
  const hostDir = dirname(lockPath);
  const host = basename(hostDir);
  const parent = dirname(hostDir);
  if (basename(parent) !== "registry-bridge") return null;
  if (!/^[A-Za-z0-9_-]+$/.test(host) || !/^[A-Za-z0-9_-]+$/.test(profile)) return null;
  return { host, profile };
}

/**
 * Determine whether a bridge lock is currently live. No cleanup, repair, or
 * uninstall path may delete a live bridge lock.
 */
export function isBridgeLockLive(
  lockPath: string,
  options: BridgeLockLivenessOptions = {}
): { live: boolean; reason?: string } {
  if (!existsSync(lockPath)) return { live: false };
  let host: string | null = null;
  let profile = "default";
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed["host"] === "string") host = parsed["host"];
      if (typeof parsed["profile"] === "string") profile = parsed["profile"];
    }
  } catch {
    /* unreadable lock metadata; fall back to path inspection */
  }
  if (!host) {
    const inferred = inferHostProfileFromPluginLockPath(lockPath);
    if (inferred) {
      host = inferred.host;
      profile = inferred.profile;
    }
  }
  if (options.checkPresence) {
    const candidateHosts = host ? [host] : ["claude", "codex"];
    for (const h of candidateHosts) {
      const presence = options.checkPresence(h);
      if (presence) {
        const sessionDetail = Array.isArray(presence) && presence.length > 0
          ? ` (${presence.join(", ")})`
          : "";
        return {
          live: true,
          reason: `active session presence for host=${h}${sessionDetail}; close the active ${h} session(s) (inspect with: h2a sessions) and re-run the command`
        };
      }
    }
  }
  const home = options.home ?? process.env.HOME?.trim();
  if (host) {
    try {
      const defaultPluginLock = defaultPluginBridgeLockPath(host, profile);
      if (resolve(lockPath) === resolve(defaultPluginLock)) {
        const candidateConfigs = new Set<string>();
        if (options.configPath) candidateConfigs.add(options.configPath);
        if (home) {
          if (host === "claude") {
            candidateConfigs.add(resolveClaudeConfigPath(home));
            candidateConfigs.add(join(home, ".claude.json"));
            try {
              candidateConfigs.add(join(pluginBridgeConfigBase(), "claude", "mcp.json"));
            } catch {
              /* ignore */
            }
          } else if (host === "codex") {
            candidateConfigs.add(join(resolveCodexConfigRoot(home), "config.toml"));
          }
        }
        for (const cfg of candidateConfigs) {
          if (options.ignoreConfigPath && resolve(cfg) === resolve(options.ignoreConfigPath)) continue;
          const receiptPath = `${cfg}.h2a-registry.json`;
          if (!existsSync(receiptPath)) continue;
          try {
            const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
            if (receipt["mechanism"] !== "plugin" || (receipt["profile"] ?? "default") !== profile) continue;
            const pluginMeta = isRecord(receipt["plugin"]) ? receipt["plugin"] : null;
            const manifestPath = pluginMeta && typeof pluginMeta["manifest"] === "string" ? pluginMeta["manifest"] : null;
            if (!manifestPath || existsSync(manifestPath)) {
              return { live: true, reason: `plugin receipt active at ${receiptPath}` };
            }
          } catch {
            /* ignore malformed receipt */
          }
        }
        if (home && hasActivePluginCacheForHost(home, host)) {
          return { live: true, reason: `installed ${host} plugin cache requires ${lockPath}` };
        }
      }
    } catch {
      /* ignore path resolution failure */
    }
  }
  const inferredConfig = options.configPath ?? (lockPath.endsWith(".h2a-lock.json") ? lockPath.slice(0, -".h2a-lock.json".length) : undefined);
  if (
    inferredConfig &&
    (!options.ignoreConfigPath || resolve(inferredConfig) !== resolve(options.ignoreConfigPath)) &&
    hostConfigReferencesBridge(inferredConfig)
  ) {
    return { live: true, reason: `host config at ${inferredConfig} still references registry-bridge` };
  }
  return { live: false };
}

/**
 * Quarantine a retired bridge lock instead of deleting it outright.
 * Refuses to remove a live bridge lock (`action: "preserved-live"`).
 * When a lock is retired, writes a byte-identical recoverable copy at
 * `<lockPath>.quarantine-<ts>-<id>` (`0o600`, `wx`) and verifies the copy before
 * unlinking `<lockPath>`.
 */
export function quarantineBridgeLock(
  lockPath: string,
  options: BridgeLockQuarantineOptions = {}
): BridgeLockQuarantineResult {
  if (!existsSync(lockPath)) {
    return { action: "absent", lockPath };
  }
  try {
    if (statSync(lockPath).isDirectory()) {
      return { action: "preserved-live", lockPath, reason: "lockPath is a directory" };
    }
  } catch (err) {
    return { action: "error", lockPath, error: (err as Error).message };
  }
  if (!options.forceQuarantineCorrupt) {
    const liveness = isBridgeLockLive(lockPath, options);
    if (liveness.live) {
      return { action: "preserved-live", lockPath, reason: liveness.reason };
    }
  }
  try {
    const originalBytes = readFileSync(lockPath);
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const quarantinePath = `${lockPath}.quarantine-${suffix}`;
    writeFileSync(quarantinePath, originalBytes, { mode: 0o600, flag: "wx" });
    const verifiedBytes = readFileSync(quarantinePath);
    if (!verifiedBytes.equals(originalBytes)) {
      throw new RegistryError("restore_failed", `quarantine copy verification failed for ${quarantinePath}`);
    }
    unlinkSync(lockPath);
    return {
      action: "quarantined",
      lockPath,
      quarantinePath,
      ...(options.reason ? { reason: options.reason } : {})
    };
  } catch (err) {
    return {
      action: "error",
      lockPath,
      error: (err as Error).message,
      ...(options.reason ? { reason: options.reason } : {})
    };
  }
}
