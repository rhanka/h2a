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
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

/** Reused by daemon composition: no unchecked selection bypasses the lock. */
export function validateBridgeLock(lock: BridgeLock, memoryEntry?: RegistryEntry): BridgeLock {
  const known = new Map(
    [...registryPackageManifest.entries, ...trackRegistryPackageManifest.entries].map((entry) => [(entry as RegistryEntry).id, entry as RegistryEntry])
  );
  if (lock.selection.some(selected => selected.id === MEMORY_PROVIDER_ID)) {
    const memory = memoryEntry ?? missingMemoryBuiltin();
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
