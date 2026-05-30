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
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export const H2A_CLI_PACKAGE = "@sentropic/h2a-cli";
/** Re-check at most once per this window (level 2 throttle). */
export const H2A_UPGRADE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

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

/** The version of the running `@sentropic/h2a-cli` (from its package.json). */
export function currentCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // dist/runtime/upgrade
    const pkgPath = resolvePath(here, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface UpgradeCacheEntry {
  readonly checkedAt: number;
  readonly latest?: string;
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
}

export const defaultUpgradeRuntime: UpgradeRuntime = {
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
    try {
      writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    } catch {
      // best-effort
    }
  }
};

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
    runtime.writeCache(options.cachePath, { checkedAt: now, ...(latest ? { latest } : {}) });
  }
  return {
    current,
    ...(latest ? { latest } : {}),
    upgradeAvailable: latest ? isNewerVersion(latest, current) : false,
    fromCache: false
  };
}

/** Run the global install of `@latest`. Returns true on success. */
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
