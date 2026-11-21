/**
 * Automatic post-upgrade host-installation convergence (self-heal).
 *
 * Why a runtime startup check instead of an npm `postinstall` script:
 * - Global upgrades (`npm i -g @sentropic/h2a@<version>`) frequently run under
 *   `--ignore-scripts`, elevated/root `HOME`, or non-interactive environments
 *   where the operator's user-scoped host roots (`~/.claude`, `~/.codex`,
 *   `~/.vibe`, `~/.config/muse`, `~/.gemini`) and native CLIs (`claude`,
 *   `codex`) are either unreachable or point to the wrong user account.
 * - Running the convergence check at CLI/MCP startup (`mcp-serve` and the
 *   plugin/registry-bridge MCP shim) executes under the real operator `HOME`
 *   and `PATH` on the very first launch of the newly installed binary.
 *
 * Invariants:
 * 1. Fast no-op when already in sync: pure synchronous filesystem reads check
 *    whether any installed host plugin/native manifest differs from the running
 *    CLI version; when in sync (or no host is installed), zero locks, zero
 *    writes, and zero subprocesses run.
 * 2. Single execution per `(version, home)` with a file lock
 *    (`<root>/.host-auto-repair.lock`) and stale-lock recovery so concurrent
 *    MCP startups serialize and repair at most once.
 * 3. Bounded wall-clock time (`timeoutMs`, default 15 000 ms) enforced across
 *    all native host CLI invocations.
 * 4. Never blocks MCP startup on failure: any repair error or timeout is
 *    recorded durably in `<root>/host-auto-repair.json` and appended to
 *    `<root>/host-auto-repair.jsonl`, then surfaced as a `hostAutoRepair`
 *    warning by `h2a doctor`.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { currentCliVersion } from "../runtime/upgrade/index.js";
import {
  doctorHostInstallations,
  H2A_MARKETPLACE_NAME,
  H2A_MARKETPLACE_REPOSITORY,
  H2A_PLUGIN_SELECTOR,
  type HostCommandResult,
  type HostCommandRunner,
  type HostInstallationDoctorReport
} from "./installation-doctor.js";
import { NATIVE_HOSTS, nativeRoot, stateRoot, vibeHome, type NativeHost } from "./native-paths.js";

export const DEFAULT_AUTO_REPAIR_TIMEOUT_MS = 15_000;
export const DEFAULT_AUTO_REPAIR_LOCK_TIMEOUT_MS = 15_000;
export const DEFAULT_AUTO_REPAIR_LOCK_STALE_MS = 60_000;

export const HOST_AUTO_REPAIR_LOCK_FILENAME = ".host-auto-repair.lock";
export const HOST_AUTO_REPAIR_STATE_FILENAME = "host-auto-repair.json";
export const HOST_AUTO_REPAIR_LOG_FILENAME = "host-auto-repair.jsonl";

export interface HostVersionDriftResult {
  readonly drifted: boolean;
  readonly pluginHosts: readonly ("claude" | "codex")[];
  readonly nativeHosts: readonly NativeHost[];
}

export interface HostAutoRepairRecord {
  readonly schema: 1;
  readonly version: string;
  readonly home: string;
  readonly attemptedAt: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly status: "repaired" | "failed" | "resolved-by-manual-repair";
  readonly driftedHosts: readonly string[];
  readonly repairedHosts: readonly string[];
  readonly failedHosts: readonly string[];
  readonly errors: readonly string[];
}

export interface AutoRepairHostInstallationsOptions {
  readonly root: string;
  readonly home?: string;
  readonly version?: string;
  readonly timeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly lockStaleMs?: number;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runHostCommand?: HostCommandRunner;
  readonly repairDelayMs?: number;
  readonly forceRetry?: boolean;
  readonly repairNativeHost?: (
    host: NativeHost,
    options: { home: string; version: string; cwd?: string; root: string }
  ) => { ok: boolean; changed?: readonly string[]; error?: string };
}

export interface AutoRepairHostInstallationsResult {
  readonly ok: boolean;
  readonly action: "noop" | "repaired" | "failed" | "skipped-locked" | "skipped-disabled";
  readonly version: string;
  readonly home: string;
  readonly driftedHosts: readonly string[];
  readonly repairedHosts: readonly string[];
  readonly failedHosts: readonly string[];
  readonly errors: readonly string[];
  readonly durationMs: number;
  readonly doctorReport?: HostInstallationDoctorReport;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonSafe(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function listSubdirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function cachedPluginVersion(pluginRoot: string): string | undefined {
  for (const manifest of [
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    join(pluginRoot, ".codex-plugin", "plugin.json")
  ]) {
    const parsed = readJsonSafe(manifest);
    if (typeof parsed?.version === "string") return parsed.version;
  }
  return undefined;
}

function isOwnedPluginDir(pluginRoot: string, expectedName = "h2a"): boolean {
  for (const manifest of [
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    join(pluginRoot, ".codex-plugin", "plugin.json")
  ]) {
    const parsed = readJsonSafe(manifest);
    if (parsed?.name === expectedName) return true;
  }
  return false;
}

function isOwnedMarketplaceDir(location: string): boolean {
  const parsed = readJsonSafe(join(location, ".claude-plugin", "marketplace.json"));
  return Boolean(
    parsed?.name === H2A_MARKETPLACE_NAME &&
      Array.isArray(parsed.plugins) &&
      parsed.plugins.some(
        (plugin) => isPlainObject(plugin) && plugin.name === "h2a" && plugin.source === "./packages/h2a"
      )
  );
}

function resolveClaudeRoot(home: string, env: NodeJS.ProcessEnv): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured && configured.length > 0 ? configured : join(home, ".claude");
}

function resolveCodexRoot(home: string, env: NodeJS.ProcessEnv): string {
  const configured = env.CODEX_HOME?.trim();
  return configured && configured.length > 0 ? configured : join(home, ".codex");
}

function detectClaudeVersionDrift(home: string, version: string, env: NodeJS.ProcessEnv): boolean {
  const cRoot = resolveClaudeRoot(home, env);
  const installedPath = join(cRoot, "plugins", "installed_plugins.json");
  const knownPath = join(cRoot, "plugins", "known_marketplaces.json");
  const cacheRoot = join(cRoot, "plugins", "cache");
  const sentropicCacheDir = join(cacheRoot, H2A_MARKETPLACE_NAME, "h2a");

  const installed = readJsonSafe(installedPath);
  const plugins = isPlainObject(installed?.plugins) ? installed.plugins : {};
  const canonicalRaw = plugins[H2A_PLUGIN_SELECTOR];
  const canonicalEntries = Array.isArray(canonicalRaw) ? canonicalRaw.filter(isPlainObject) : [];
  const legacyPluginNames = Object.keys(plugins).filter(
    (name) => /^h2a-local-/i.test(name) || /^h2a@sentropic-local-/i.test(name) || /^track@sentropic$/i.test(name)
  );

  const cacheVersions = listSubdirectories(sentropicCacheDir).filter((v) =>
    isOwnedPluginDir(join(sentropicCacheDir, v))
  );
  const legacyCacheDirs = listSubdirectories(cacheRoot).filter((name) => /^sentropic-local-/i.test(name));

  const known = readJsonSafe(knownPath);
  const hasKnownSentropic =
    isPlainObject(known?.[H2A_MARKETPLACE_NAME]) ||
    Object.keys(known ?? {}).some((name) => /^sentropic-local-/i.test(name));

  const isH2aInstalledOnClaude =
    canonicalEntries.length > 0 ||
    legacyPluginNames.length > 0 ||
    cacheVersions.length > 0 ||
    legacyCacheDirs.length > 0 ||
    hasKnownSentropic;

  if (!isH2aInstalledOnClaude) return false;

  const hasCurrentEntry = canonicalEntries.some(
    (entry) =>
      entry.version === version &&
      typeof entry.installPath === "string" &&
      isOwnedPluginDir(entry.installPath) &&
      cachedPluginVersion(entry.installPath) === version
  );
  if (!hasCurrentEntry) return true;

  const marketplaceEntry = known?.[H2A_MARKETPLACE_NAME];
  const hasCanonicalMarketplace =
    isPlainObject(marketplaceEntry) &&
    isPlainObject(marketplaceEntry.source) &&
    marketplaceEntry.source.source === "github" &&
    marketplaceEntry.source.repo === H2A_MARKETPLACE_REPOSITORY &&
    typeof marketplaceEntry.installLocation === "string" &&
    isOwnedMarketplaceDir(marketplaceEntry.installLocation);
  if (!hasCanonicalMarketplace) return true;

  if (cacheVersions.some((v) => v !== version)) return true;
  if (legacyPluginNames.length > 0 || legacyCacheDirs.length > 0) return true;

  return false;
}

function detectCodexVersionDrift(home: string, version: string, env: NodeJS.ProcessEnv): boolean {
  const xRoot = resolveCodexRoot(home, env);
  const configPath = join(xRoot, "config.toml");
  const cacheRoot = join(xRoot, "plugins", "cache");
  const sentropicCacheDir = join(cacheRoot, H2A_MARKETPLACE_NAME, "h2a");

  let configRaw = "";
  if (existsSync(configPath)) {
    try {
      configRaw = readFileSync(configPath, "utf8");
    } catch {
      return false;
    }
  }

  const cacheVersions = listSubdirectories(sentropicCacheDir).filter((v) =>
    isOwnedPluginDir(join(sentropicCacheDir, v))
  );
  const legacyCacheDirs = listSubdirectories(cacheRoot).filter((name) => /^sentropic-local-/i.test(name));
  const mentionsH2aInConfig =
    configRaw.includes("h2a@sentropic") ||
    configRaw.includes("marketplaces.sentropic") ||
    configRaw.includes("sentropic-local-");

  const isH2aInstalledOnCodex =
    cacheVersions.length > 0 || legacyCacheDirs.length > 0 || mentionsH2aInConfig;

  if (!isH2aInstalledOnCodex) return false;

  const currentCachePath = join(sentropicCacheDir, version);
  if (
    !cacheVersions.includes(version) ||
    !isOwnedPluginDir(currentCachePath) ||
    cachedPluginVersion(currentCachePath) !== version
  ) {
    return true;
  }
  if (cacheVersions.some((v) => v !== version) || legacyCacheDirs.length > 0) return true;
  if (!configRaw.includes('h2a@sentropic') || configRaw.includes("sentropic-local-")) return true;

  return false;
}

function detectNativeHostsVersionDrift(
  home: string,
  version: string,
  env: NodeJS.ProcessEnv
): NativeHost[] {
  const drifted: NativeHost[] = [];
  for (const host of NATIVE_HOSTS) {
    const root = host === "vibe" ? vibeHome(home, env) : nativeRoot(host, home);
    const state = stateRoot(host, root);
    const manifestPath = join(state, host === "agy" ? "shared-owner.json" : "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const parsed = readJsonSafe(manifestPath);
    if (!parsed || parsed.version !== version) {
      drifted.push(host);
    }
  }
  return drifted;
}

/**
 * Pure synchronous filesystem check for version mismatch between installed
 * host plugins/manifests under `home` and the running CLI `version`.
 */
export function detectHostVersionDrift(
  home: string = homedir(),
  version: string = currentCliVersion(),
  env: NodeJS.ProcessEnv = process.env
): HostVersionDriftResult {
  const pluginHosts: ("claude" | "codex")[] = [];
  if (detectClaudeVersionDrift(home, version, env)) pluginHosts.push("claude");
  if (detectCodexVersionDrift(home, version, env)) pluginHosts.push("codex");
  const nativeHosts = detectNativeHostsVersionDrift(home, version, env);
  return {
    drifted: pluginHosts.length > 0 || nativeHosts.length > 0,
    pluginHosts,
    nativeHosts
  };
}

export function readHostAutoRepairState(root: string): HostAutoRepairRecord | undefined {
  const path = join(root, HOST_AUTO_REPAIR_STATE_FILENAME);
  const parsed = readJsonSafe(path);
  if (
    !parsed ||
    parsed.schema !== 1 ||
    typeof parsed.version !== "string" ||
    typeof parsed.home !== "string" ||
    typeof parsed.attemptedAt !== "string" ||
    typeof parsed.ok !== "boolean"
  ) {
    return undefined;
  }
  return parsed as unknown as HostAutoRepairRecord;
}

function writeHostAutoRepairStateAndLog(root: string, record: HostAutoRepairRecord): void {
  try {
    mkdirSync(root, { recursive: true });
    const statePath = join(root, HOST_AUTO_REPAIR_STATE_FILENAME);
    const tmpPath = join(root, `.${HOST_AUTO_REPAIR_STATE_FILENAME}.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmpPath, statePath);
  } catch {
    // Best-effort state persistence; never throw into MCP startup.
  }
  try {
    const logPath = join(root, HOST_AUTO_REPAIR_LOG_FILENAME);
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Best-effort bus log append; never throw into MCP startup.
  }
}

function isLockStale(lockPath: string, staleMs: number): boolean {
  try {
    const stat = statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) return true;
    const content = readJsonSafe(lockPath);
    const pid = typeof content?.pid === "number" ? content.pid : undefined;
    if (pid && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireAutoRepairLock(
  root: string,
  version: string,
  home: string,
  lockTimeoutMs: number,
  lockStaleMs: number
): Promise<(() => void) | undefined> {
  mkdirSync(root, { recursive: true });
  const lockPath = join(root, HOST_AUTO_REPAIR_LOCK_FILENAME);
  const deadline = Date.now() + lockTimeoutMs;

  while (Date.now() <= deadline) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(
          fd,
          `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), version, home })}\n`,
          "utf8"
        );
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // ignore if already removed
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        return undefined;
      }
      if (isLockStale(lockPath, lockStaleMs)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // another contender may have unlinked it
        }
      }
      await sleep(20);
    }
  }
  return undefined;
}

function boundedHostCommandRunner(
  delegate: HostCommandRunner | undefined,
  deadline: number,
  timeoutMs: number
): HostCommandRunner {
  return (command, args): HostCommandResult => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        ok: false,
        message: `auto-repair time budget (${timeoutMs}ms) exceeded before running ${command} ${args.join(" ")}`
      };
    }
    if (delegate) {
      try {
        const result = delegate(command, args);
        if (Date.now() > deadline) {
          return {
            ok: false,
            message: `auto-repair time budget (${timeoutMs}ms) exceeded during ${command} ${args.join(" ")}`
          };
        }
        return result;
      } catch (error) {
        return { ok: false, message: (error as Error).message };
      }
    }
    try {
      const result = spawnSync(command, [...args], {
        encoding: "utf8",
        timeout: Math.max(100, remainingMs)
      });
      if (result.status === 0) return { ok: true };
      const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
      if (timedOut) {
        return {
          ok: false,
          message: `${command} ${args.join(" ")} timed out after ${timeoutMs}ms`
        };
      }
      const detail = [result.stderr, result.stdout, result.error?.message]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .trim();
      return {
        ok: false,
        message: detail || `${command} ${args.join(" ")} exited ${result.status ?? "without a status"}`
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  };
}

/**
 * Determine whether automatic host repair should be skipped to preserve
 * hermetic test isolation on the developer/CI owner `$HOME`.
 *
 * When `node --test` is running (`NODE_TEST_CONTEXT` or
 * `H2A_TEST_QUALIFICATION_ROOT` is set) and the caller did NOT pass an
 * explicit `options.home` and `env.HOME` still points to the real owner
 * home directory, we skip automatic host inspection so unrelated unit tests
 * never touch the owner's personal `~/.claude` or `~/.codex`.
 */
export function shouldSkipImplicitOwnerHomeInTests(
  explicitHome: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (explicitHome !== undefined) return false;
  const inTest =
    env.NODE_TEST_CONTEXT !== undefined ||
    process.env.NODE_TEST_CONTEXT !== undefined ||
    env.H2A_TEST_QUALIFICATION_ROOT !== undefined ||
    process.env.H2A_TEST_QUALIFICATION_ROOT !== undefined;
  if (!inTest) return false;
  const effectiveHome = env.HOME ?? process.env.HOME ?? homedir();
  const realOwnerHome = process.env.H2A_TEST_OWNER_HOME ?? homedir();
  return effectiveHome === realOwnerHome;
}

/**
 * Self-heal installed host plugins/manifests (`claude`, `codex`, `vibe`,
 * `muse`, `agy`) when their installed version differs from the running CLI
 * version. Runs at most once per `(version, home)` under a bus lock, within a
 * bounded time budget, and never throws.
 */
export async function autoRepairHostInstallations(
  options: AutoRepairHostInstallationsOptions
): Promise<AutoRepairHostInstallationsResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const home = options.home ?? env.H2A_AUTO_REPAIR_HOME ?? env.HOME ?? homedir();
  const version = options.version ?? env.H2A_AUTO_REPAIR_VERSION ?? currentCliVersion();

  if (env.H2A_AUTO_REPAIR_DISABLE === "1" || shouldSkipImplicitOwnerHomeInTests(options.home, env)) {
    return {
      ok: true,
      action: "skipped-disabled",
      version,
      home,
      driftedHosts: [],
      repairedHosts: [],
      failedHosts: [],
      errors: [],
      durationMs: Date.now() - startedAt
    };
  }

  let initialDrift: HostVersionDriftResult;
  try {
    initialDrift = detectHostVersionDrift(home, version, env);
  } catch {
    initialDrift = { drifted: false, pluginHosts: [], nativeHosts: [] };
  }

  if (!initialDrift.drifted) {
    return {
      ok: true,
      action: "noop",
      version,
      home,
      driftedHosts: [],
      repairedHosts: [],
      failedHosts: [],
      errors: [],
      durationMs: Date.now() - startedAt
    };
  }

  const priorState = readHostAutoRepairState(options.root);
  if (
    !options.forceRetry &&
    priorState &&
    priorState.version === version &&
    priorState.home === home &&
    priorState.status === "failed"
  ) {
    return {
      ok: true,
      action: "noop",
      version,
      home,
      driftedHosts: [],
      repairedHosts: [],
      failedHosts: [],
      errors: [],
      durationMs: Date.now() - startedAt
    };
  }

  const timeoutMs =
    options.timeoutMs ??
    (env.H2A_AUTO_REPAIR_TIMEOUT_MS ? Number.parseInt(env.H2A_AUTO_REPAIR_TIMEOUT_MS, 10) : undefined) ??
    DEFAULT_AUTO_REPAIR_TIMEOUT_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_AUTO_REPAIR_LOCK_TIMEOUT_MS;
  const lockStaleMs = options.lockStaleMs ?? DEFAULT_AUTO_REPAIR_LOCK_STALE_MS;

  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = await acquireAutoRepairLock(options.root, version, home, lockTimeoutMs, lockStaleMs);
  } catch {
    releaseLock = undefined;
  }

  if (!releaseLock) {
    return {
      ok: true,
      action: "skipped-locked",
      version,
      home,
      driftedHosts: [...initialDrift.pluginHosts, ...initialDrift.nativeHosts],
      repairedHosts: [],
      failedHosts: [],
      errors: [],
      durationMs: Date.now() - startedAt
    };
  }

  try {
    // Re-check inside the lock so concurrent starts do not repair twice.
    const stateInLock = readHostAutoRepairState(options.root);
    const driftInLock = detectHostVersionDrift(home, version, env);
    if (
      !driftInLock.drifted ||
      (!options.forceRetry &&
        stateInLock &&
        stateInLock.version === version &&
        stateInLock.home === home &&
        (stateInLock.status === "repaired" || stateInLock.status === "failed"))
    ) {
      return {
        ok: true,
        action: "noop",
        version,
        home,
        driftedHosts: [],
        repairedHosts: [],
        failedHosts: [],
        errors: [],
        durationMs: Date.now() - startedAt
      };
    }

    if (options.repairDelayMs && options.repairDelayMs > 0) {
      await sleep(options.repairDelayMs);
    }

    const deadline = Date.now() + timeoutMs;
    const driftedHosts: string[] = [...driftInLock.pluginHosts, ...driftInLock.nativeHosts];
    const repairedHosts: string[] = [];
    const failedHosts: string[] = [];
    const errors: string[] = [];
    let doctorReport: HostInstallationDoctorReport | undefined;

    if (driftInLock.pluginHosts.length > 0) {
      try {
        const runner = boundedHostCommandRunner(options.runHostCommand, deadline, timeoutMs);
        const hasInjectedRunner = options.runHostCommand !== undefined;
        doctorReport = doctorHostInstallations({
          home,
          version,
          repair: true,
          hosts: driftInLock.pluginHosts,
          runHostCommand: runner,
          ...(hasInjectedRunner
            ? {
                testHostCliReachable: () => true,
                testClaudeConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } },
                testCodexConfigurationOracle: { knownGood: { ok: true }, candidate: { ok: true } }
              }
            : {})
        });
        for (const hostReport of doctorReport.hosts) {
          if (hostReport.ok) {
            repairedHosts.push(hostReport.host);
          } else {
            failedHosts.push(hostReport.host);
            const hostErrors =
              hostReport.unrepaired.length > 0 ? hostReport.unrepaired : hostReport.findings;
            for (const entry of hostErrors) {
              errors.push(`${hostReport.host}: ${entry.code}: ${entry.message}`);
            }
          }
        }
      } catch (error) {
        for (const host of driftInLock.pluginHosts) {
          if (!failedHosts.includes(host)) failedHosts.push(host);
        }
        errors.push(`plugin-repair: ${(error as Error).message}`);
      }
    }

    if (driftInLock.nativeHosts.length > 0) {
      for (const host of driftInLock.nativeHosts) {
        if (Date.now() > deadline) {
          failedHosts.push(host);
          errors.push(`${host}: auto-repair time budget (${timeoutMs}ms) exceeded`);
          continue;
        }
        try {
          let outcome: { ok: boolean; changed?: readonly string[]; error?: string };
          if (options.repairNativeHost) {
            outcome = options.repairNativeHost(host, {
              home,
              version,
              cwd: options.cwd,
              root: options.root
            });
          } else {
            const { nativeHostReport } = await import("../cli.js");
            const nRoot = host === "vibe" ? vibeHome(home, env) : nativeRoot(host, home);
            const report = nativeHostReport(
              host,
              { root: options.root },
              true,
              false,
              nRoot,
              options.cwd ?? process.cwd()
            );
            outcome = {
              ok: report.ok,
              changed: "changed" in report ? (report.changed as readonly string[]) : []
            };
          }
          if (outcome.ok) {
            repairedHosts.push(host);
          } else {
            failedHosts.push(host);
            errors.push(`${host}: ${outcome.error ?? "native host convergence reported conflict"}`);
          }
        } catch (error) {
          failedHosts.push(host);
          errors.push(`${host}: ${(error as Error).message}`);
        }
      }
    }

    const ok = failedHosts.length === 0;
    const durationMs = Date.now() - startedAt;
    const record: HostAutoRepairRecord = {
      schema: 1,
      version,
      home,
      attemptedAt: new Date().toISOString(),
      durationMs,
      ok,
      status: ok ? "repaired" : "failed",
      driftedHosts,
      repairedHosts,
      failedHosts,
      errors
    };
    writeHostAutoRepairStateAndLog(options.root, record);

    return {
      ok,
      action: ok ? "repaired" : "failed",
      version,
      home,
      driftedHosts,
      repairedHosts,
      failedHosts,
      errors,
      durationMs,
      ...(doctorReport ? { doctorReport } : {})
    };
  } finally {
    releaseLock();
  }
}

/**
 * Called by `cmdDoctor` to surface any failed automatic post-upgrade host
 * repair in `report.warnings` (or clear it after an explicit `doctor --repair`
 * succeeds).
 */
export function applyHostAutoRepairDoctorStatus(
  root: string,
  flags: Record<string, string>,
  report: Record<string, unknown>,
  warnings: Array<Record<string, unknown>>
): void {
  const state = readHostAutoRepairState(root);
  if (!state) return;

  if (flags.repair === "true" && flags["dry-run"] !== "true" && report.ok === true && !state.ok) {
    writeHostAutoRepairStateAndLog(root, {
      ...state,
      attemptedAt: new Date().toISOString(),
      ok: true,
      status: "resolved-by-manual-repair",
      failedHosts: [],
      errors: []
    });
    return;
  }

  if (!state.ok && state.status === "failed") {
    const failedSummary = state.failedHosts.length > 0 ? state.failedHosts.join(", ") : "hosts";
    const errorDetail = state.errors.length > 0 ? state.errors.join("; ") : "unknown error";
    warnings.push({
      check: "hostAutoRepair",
      version: state.version,
      attemptedAt: state.attemptedAt,
      failedHosts: state.failedHosts,
      errors: state.errors,
      message:
        `Automatic post-upgrade host repair for h2a@${state.version} failed (${failedSummary}): ` +
        `${errorDetail}. Run \`h2a doctor --repair\` to converge host installations.`
    });
  }
}
