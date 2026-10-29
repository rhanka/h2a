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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { canonicalJson, normalizeConfiguration, sha256Hex, validateRegistryEntry, type RegistryEntry } from "./descriptors.js";
import { registryPackageManifest } from "./manifest.js";
import { MEMORY_PROVIDER_ID, readInstalledMemoryEntry } from "./memory-provider.js";
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
  if (xdg) return xdg;
  const home = process.env.HOME?.trim();
  if (home) return join(home, ".config");
  throw Object.assign(
    new Error("missing_lock: cannot resolve the plugin default lock location without XDG_CONFIG_HOME or HOME"),
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

/**
 * Provision the default full-tuple lock when absent. An existing lock is
 * never rewritten here (rotation is an explicit later operator action).
 */
export function provisionBridgeLock(options: {
  lockPath: string;
  host: string;
  profile: string;
  bridge: { command: string; args: string[] };
  h2aEntry: RegistryEntry;
  trackEntry: RegistryEntry;
  memory?: { entry: RegistryEntry; config: Record<string, unknown> };
}): { lockPath: string; action: "provisioned" | "already-present" } {
  if (existsSync(options.lockPath)) return { lockPath: options.lockPath, action: "already-present" };
  const configs = defaultBridgeConfigs();
  const entries: BridgeLock["entries"] = {};
  if (options.memory) configs[MEMORY_PROVIDER_ID] = options.memory.config;
  const selectedEntries = [options.h2aEntry, options.trackEntry, ...(options.memory ? [options.memory.entry] : [])];
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
    host: options.host,
    profile: options.profile,
    bridge: options.bridge,
    selection: selectedEntries.map(entry => ({ kind: entry.kind, id: entry.id, entryVersion: entry.entryVersion })),
    entries,
    compatibility: { hostFeatures: [...new Set(["stdio", "streamable-http", ...(options.memory?.entry.compatibility.requiredHostFeatures ?? [])])], protocolVersions: ["2025-06-18"] }
  };
  mkdirSync(dirname(options.lockPath), { recursive: true });
  writeFileSync(options.lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  return { lockPath: options.lockPath, action: "provisioned" };
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

/** Reused by daemon composition: no unchecked selection bypasses the lock. */
export function validateBridgeLock(lock: BridgeLock, memoryEntry?: RegistryEntry): BridgeLock {
  const known = new Map(
    [...registryPackageManifest.entries, ...trackRegistryPackageManifest.entries].map((entry) => [(entry as RegistryEntry).id, entry as RegistryEntry])
  );
  if (lock.selection.some(selected => selected.id === MEMORY_PROVIDER_ID)) {
    const memory = memoryEntry ?? readInstalledMemoryEntry();
    if (memory.kind !== "mcp" || memory.id !== MEMORY_PROVIDER_ID || memory.publisher.packageName !== "@sentropic/engram" ||
        memory.mcp?.connectorIds.length !== 1 || memory.mcp.connectorIds[0] !== "engram-memory" ||
        !memory.mcp.transportProfiles.some(profile => profile.id === "sentropic.engram.memory-wire/v1" && profile.mode === "in-process")) {
      throw new RegistryError("invalid_entry", "memory entry must name sentropic.engram.memory / engram-memory");
    }
    known.set(MEMORY_PROVIDER_ID, memory);
  }
  const seen = new Set<string>();
  for (const selected of lock.selection) {
    const packed = known.get(selected.id);
    if (!packed) throw Object.assign(new Error(`invalid_entry: bridge lock selects unknown provider ${selected.id}`), { code: "invalid_entry" });
    if (seen.has(selected.id)) throw new RegistryError("invalid_entry", "duplicate bridge selection");
    seen.add(selected.id);
    if (selected.kind !== packed.kind || selected.entryVersion !== packed.entryVersion) {
      throw new RegistryError("incompatible_version", `bridge selection version differs for ${selected.id}`);
    }
    const record = lock.entries[selected.id];
    if (!isRecord(record) || typeof record["digest"] !== "string") {
      throw Object.assign(new Error(`invalid_entry: bridge lock has no pinned digest for ${selected.id}`), { code: "invalid_entry" });
    }
    validateRegistryEntry(packed, { expectedDigest: record["digest"] as string });
    const normalized = normalizeConfiguration(packed, record.config);
    if (record.configDigest !== sha256Hex(canonicalJson(normalized))) {
      throw new RegistryError("integrity_mismatch", `configuration digest differs for ${selected.id}`);
    }
  }
  if (Object.keys(lock.entries).some(id => !seen.has(id))) throw new RegistryError("invalid_entry", "unselected bridge entry");
  return lock;
}
