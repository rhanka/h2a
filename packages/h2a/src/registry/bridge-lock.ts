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
}): { lockPath: string; action: "provisioned" | "already-present" } {
  if (existsSync(options.lockPath)) return { lockPath: options.lockPath, action: "already-present" };
  const configs = defaultBridgeConfigs();
  const entries: BridgeLock["entries"] = {};
  for (const entry of [options.h2aEntry, options.trackEntry]) {
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
    selection: [
      { kind: "mcp", id: "sentropic.h2a", entryVersion: options.h2aEntry.entryVersion },
      { kind: "mcp", id: "sentropic.track", entryVersion: options.trackEntry.entryVersion }
    ],
    entries,
    compatibility: { hostFeatures: ["stdio", "streamable-http"], protocolVersions: ["2025-06-18"] }
  };
  mkdirSync(dirname(options.lockPath), { recursive: true });
  writeFileSync(options.lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  return { lockPath: options.lockPath, action: "provisioned" };
}

/** Read and closed-validate a bridge lock; rechecks pinned digests. */
export function readBridgeLock(lockPath: string): BridgeLock {
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
  const known = new Map(
    [...registryPackageManifest.entries, ...trackRegistryPackageManifest.entries].map((entry) => [(entry as RegistryEntry).id, entry as RegistryEntry])
  );
  for (const selected of lock.selection) {
    const packed = known.get(selected.id);
    if (!packed) throw Object.assign(new Error(`invalid_entry: bridge lock selects unknown provider ${selected.id}`), { code: "invalid_entry" });
    const record = lock.entries[selected.id];
    if (!isRecord(record) || typeof record["digest"] !== "string") {
      throw Object.assign(new Error(`invalid_entry: bridge lock has no pinned digest for ${selected.id}`), { code: "invalid_entry" });
    }
    validateRegistryEntry(packed, { expectedDigest: record["digest"] as string });
  }
  return lock;
}
