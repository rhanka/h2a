/**
 * Host-installation convergence for `h2a doctor`.
 *
 * The h2a plugin is the canonical host integration. A direct `mcp-serve`
 * configuration alongside that plugin starts a second endpoint, and the old
 * standalone Track MCP starts a competing projection of `track_*` tools. This
 * module treats both as an incoherent installation rather than a warning.
 *
 * Host plugin CLIs retain authority over their own installation registries.
 * Doctor repairs their plain configuration/cache residue itself, then asks the
 * native CLI to install/update the canonical `h2a@sentropic` plugin. A command
 * failure is retained as an unrepaired finding; it must never become a clean
 * result merely because a config file was edited.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { H2ASession } from "../session.js";
import { currentCliVersion } from "../runtime/upgrade/index.js";

export const H2A_PLUGIN_SELECTOR = "h2a@sentropic";
export const H2A_MARKETPLACE_NAME = "sentropic";
export const H2A_MARKETPLACE_REPOSITORY = "rhanka/h2a";
export const H2A_MARKETPLACE_GIT_URL = "https://github.com/rhanka/h2a.git";
export const HOST_REPAIR_FRESHNESS_GUARANTEE =
  "doctor guarantees the coherence of the repairs it performed. It does not detect installation changes made by other tools; after changing your installation by hand, restart your sessions.";

type Host = "claude" | "codex";

export interface HostCommandResult {
  readonly ok: boolean;
  readonly message?: string;
}

export type HostCommandRunner = (
  command: "claude" | "codex",
  args: readonly string[]
) => HostCommandResult;

export interface HostInstallationDoctorOptions {
  readonly home?: string;
  /** `false` is inspect-only. `true` performs the documented repair. */
  readonly repair?: boolean;
  /** Injectable for hermetic tests; production uses the running CLI version. */
  readonly version?: string;
  /** Injectable for hermetic tests; production invokes the native host CLI. */
  readonly runHostCommand?: HostCommandRunner;
  /** Injectable for hermetic tests; production writes the durable repair marker. */
  readonly writeRepairMarker?: (path: string, content: string) => void;
  /** Report host repair findings and planned actions without mutating the host. */
  readonly dryRun?: boolean;
  /** Test-only Claude uninstall requests used to exercise the native-command boundary. */
  readonly testClaudePluginUninstalls?: readonly string[];
  /** Test-only fault injection for the atomic configuration-write boundary. */
  readonly testConfigurationWrite?: {
    readonly mutateRendered?: (path: string, format: "json" | "toml", rendered: string) => string;
    readonly beforeRename?: (path: string, temporaryPath: string) => void;
    readonly rename?: (temporaryPath: string, path: string) => void;
  };
}

export interface HostInstallationFinding {
  readonly code:
    | "config-invalid"
    | "marketplace-missing"
    | "marketplace-stale"
    | "plugin-missing"
    | "plugin-stale"
    | "version-skew"
    | "orphan-cache"
    | "h2a-endpoint-count"
    | "standalone-track-mcp"
    | "host-command-failed"
    | "host-command-refused"
    | "ownership-unverified"
    | "repair-marker-unavailable"
    | "runtime-artifact-unavailable";
  readonly message: string;
  readonly path?: string;
}

export interface HostRepairMarker {
  readonly path: string;
  readonly repairedAt: string;
  /** Concrete paths that a completed repair actually changed. */
  readonly repairedPaths: readonly string[];
}

export interface HostInstallationReport {
  readonly host: Host;
  readonly ok: boolean;
  readonly findings: readonly HostInstallationFinding[];
  /** Non-blocking inspection notes; never a host-health or session-freshness verdict. */
  readonly diagnostics: readonly HostInstallationFinding[];
  readonly changed: readonly string[];
  readonly unrepaired: readonly HostInstallationFinding[];
  /** Declared artifacts retained for diagnostics and to determine precisely what a repair rewrote. */
  readonly coherencePaths: readonly string[];
  /** Host changes that --repair --dry-run would perform. */
  readonly plannedActions: readonly string[];
  /** Expected durable repair-marker location, whether or not it currently exists. */
  readonly repairMarkerPath: string;
  /** Durable fact recorded after this host installation was repaired. */
  readonly repairMarker?: HostRepairMarker;
}

export interface HostInstallationDoctorReport {
  readonly ok: boolean;
  readonly repair: boolean;
  readonly dryRun: boolean;
  /** Exact boundary of the live-session restart guarantee. */
  readonly sessionFreshnessGuarantee: string;
  readonly version: string;
  readonly hosts: readonly HostInstallationReport[];
}

export interface LiveHostSessionFinding {
  readonly host: Host;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly configPath: string;
  readonly message: string;
}

interface MutableHostReport {
  host: Host;
  findings: HostInstallationFinding[];
  diagnostics: HostInstallationFinding[];
  changed: string[];
  unrepaired: HostInstallationFinding[];
  coherencePaths: string[];
  plannedActions: string[];
  repairMarkerPath: string;
  repairMarker?: HostRepairMarker;
}

interface TomlTable {
  readonly header: string;
  readonly lines: readonly string[];
}

function defaultHostCommand(command: "claude" | "codex", args: readonly string[]): HostCommandResult {
  try {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      timeout: 120_000
    });
    if (result.status === 0) return { ok: true };
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
}

function finding(
  code: HostInstallationFinding["code"],
  message: string,
  path?: string
): HostInstallationFinding {
  return { code, message, ...(path ? { path } : {}) };
}

function isBlockingFinding(entry: HostInstallationFinding): boolean {
  return entry.code !== "orphan-cache";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): { value?: Record<string, unknown>; error?: string } {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!isPlainObject(value)) return { error: "JSON root is not an object" };
    return { value };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function writeJson(path: string, value: Record<string, unknown>): string | undefined {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

type ConfigurationFormat = "json" | "toml";

type TestConfigurationWrite = NonNullable<HostInstallationDoctorOptions["testConfigurationWrite"]>;

function validateRenderedToml(raw: string): string | undefined {
  const headers = new Set<string>();
  const delimiters: string[] = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;
  const scanValue = (value: string, line: number): string | undefined => {
    let hasValue = quote !== undefined || delimiters.length > 0;
    for (const character of value) {
      if (quote) {
        hasValue = true;
        if (quote === '"' && escaped) {
          escaped = false;
          continue;
        }
        if (quote === '"' && character === "\\") {
          escaped = true;
          continue;
        }
        if (character === quote) quote = undefined;
        continue;
      }
      if (character === "#") break;
      if (!/\s/.test(character)) hasValue = true;
      if (character === '"' || character === "'") quote = character;
      else if (character === "[") delimiters.push("]");
      else if (character === "{") delimiters.push("}");
      else if (character === "]" || character === "}") {
        if (delimiters.pop() !== character) return `line ${line} has unbalanced TOML delimiters`;
      }
    }
    return hasValue ? undefined : `line ${line} has no TOML value`;
  };
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (quote || delimiters.length > 0) {
      const valueError = scanValue(line, index + 1);
      if (valueError) return valueError;
      continue;
    }
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      const header = /^\[([^\]\r\n]+)\]\s*(?:#.*)?$/.exec(trimmed);
      if (!header) return `line ${index + 1} has an invalid table header`;
      if (headers.has(header[1])) return `line ${index + 1} repeats table ${header[1]}`;
      headers.add(header[1]);
      continue;
    }
    if (!/^(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\])+")(?:\.(?:[A-Za-z0-9_-]+|"(?:\\.|[^"\\])+"))*\s*=/.test(trimmed)) {
      return `line ${index + 1} is not a TOML key/value assignment`;
    }
    const valueError = scanValue(trimmed.slice(trimmed.indexOf("=") + 1), index + 1);
    if (valueError) return valueError;
  }
  if (quote) return "TOML has an unterminated string";
  if (delimiters.length > 0) return "TOML has unclosed array or inline-table delimiters";
  return undefined;
}

function validateRenderedConfiguration(raw: string, format: ConfigurationFormat): string | undefined {
  if (format === "toml") return validateRenderedToml(raw);
  try {
    if (!isPlainObject(JSON.parse(raw))) return "JSON root is not an object";
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

function atomicConfigurationWrite(
  path: string,
  original: string,
  rendered: string,
  format: ConfigurationFormat,
  testHooks?: TestConfigurationWrite
): string | undefined {
  let temporaryPath: string | undefined;
  let descriptor: number | undefined;
  try {
    const candidate = testHooks?.mutateRendered?.(path, format, rendered) ?? rendered;
    const validationError = validateRenderedConfiguration(candidate, format);
    if (validationError) return `rendered ${format.toUpperCase()} cannot be parsed: ${validationError}`;

    mkdirSync(dirname(path), { recursive: true });
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidatePath = join(dirname(path), `.${path.split("/").pop()}.h2a-${process.pid}-${Date.now()}-${attempt}.tmp`);
      try {
        descriptor = openSync(candidatePath, "wx", 0o600);
        temporaryPath = candidatePath;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (descriptor === undefined || temporaryPath === undefined) throw new Error("cannot allocate an atomic temporary file");
    writeFileSync(descriptor, candidate, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    testHooks?.beforeRename?.(path, temporaryPath);
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (current !== original) throw new Error("configuration changed concurrently before atomic rename");
    if (testHooks?.rename) testHooks.rename(temporaryPath, path);
    else renameSync(temporaryPath, path);
    temporaryPath = undefined;
    return undefined;
  } catch (error) {
    return (error as Error).message;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* preserve the original write error */ }
    }
    if (temporaryPath !== undefined) {
      try { unlinkSync(temporaryPath); } catch { /* cleanup must not hide the original write error */ }
    }
  }
}

function listDirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function loadBearingArtifacts(
  report: MutableHostReport,
  roots: readonly string[],
  hostConfigPaths: readonly string[]
): string[] {
  const declared = new Set(hostConfigPaths.filter(existsSync));
  const inspectedMcpConfigs = new Set<string>();

  const inspectMcpConfig = (path: string): void => {
    if (inspectedMcpConfigs.has(path)) return;
    inspectedMcpConfigs.add(path);
    declared.add(path);
    if (!existsSync(path)) return;
    const config = readJson(path);
    if (config.error) {
      report.diagnostics.push(finding("runtime-artifact-unavailable", `cannot inspect declared MCP config: ${config.error}`, path));
      return;
    }
    const servers = isPlainObject(config.value?.mcpServers) ? config.value.mcpServers : {};
    for (const entry of Object.values(servers)) {
      if (!isPlainObject(entry)) continue;
      for (const candidate of [entry.command, ...jsonArgs(entry)]) {
        if (typeof candidate === "string" && candidate.startsWith(".")) {
          declared.add(join(dirname(path), candidate));
        }
      }
    }
  };

  for (const root of roots) {
    for (const manifestPath of [
      join(root, ".codex-plugin", "plugin.json"),
      join(root, ".claude-plugin", "plugin.json")
    ]) {
      if (!existsSync(manifestPath)) continue;
      declared.add(manifestPath);
      const manifest = readJson(manifestPath);
      if (manifest.error) {
        report.diagnostics.push(finding("runtime-artifact-unavailable", `cannot inspect plugin manifest: ${manifest.error}`, manifestPath));
        continue;
      }
      const pluginRoot = dirname(dirname(manifestPath));
      const mcpServers = manifest.value?.mcpServers;
      if (typeof mcpServers === "string" && mcpServers.startsWith(".")) {
        inspectMcpConfig(join(pluginRoot, mcpServers));
      } else if (isPlainObject(mcpServers)) {
        for (const entry of Object.values(mcpServers)) {
          if (!isPlainObject(entry)) continue;
          for (const candidate of [entry.command, ...jsonArgs(entry)]) {
            if (typeof candidate === "string" && candidate.startsWith(".")) {
              declared.add(join(pluginRoot, candidate));
            }
          }
        }
      }
    }
    const conventionalMcpConfig = join(root, ".mcp.json");
    if (existsSync(conventionalMcpConfig)) inspectMcpConfig(conventionalMcpConfig);
  }

  const resolved: string[] = [];
  for (const path of declared) {
    try {
      const target = realpathSync(path);
      const metadata = statSync(target);
      if (!metadata.isFile()) throw new Error("not a regular file");
      pushUnique(resolved, target);
    } catch (error) {
      report.diagnostics.push(
        finding("runtime-artifact-unavailable", `cannot inspect declared artifact: ${(error as Error).message}`, path),
      );
    }
  }
  return resolved;
}

function parseTomlTables(content: string): TomlTable[] {
  const result: TomlTable[] = [];
  let current: { header: string; lines: string[] } | undefined;
  for (const line of content.split(/(?<=\n)/)) {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?(?:\r?\n)?$/.exec(line);
    if (header) {
      if (current) result.push(current);
      current = { header: header[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { header: "", lines: [line] };
    }
  }
  if (current) result.push(current);
  return result;
}

function tomlQuotedName(header: string, prefix: string): string | undefined {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}(?:\\.\\\"([^\"]+)\\\"|\\.([^\\.]+))$`).exec(header);
  return match?.[1] ?? match?.[2];
}

function tomlValue(table: TomlTable, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = table.lines.slice(1).find((entry) => new RegExp(`^\\s*${escaped}\\s*=`).test(entry));
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim().replace(/\s+#.*$/, "");
  const quoted = /^"((?:\\.|[^"\\])*)"$/.exec(value);
  return quoted ? quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : value;
}

function tomlBoolean(table: TomlTable, key: string): boolean | undefined {
  const value = tomlValue(table, key);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function rewriteTomlTables(
  raw: string,
  transform: (table: TomlTable) => readonly string[] | undefined
): string {
  const output: string[] = [];
  for (const table of parseTomlTables(raw)) {
    const replacement = transform(table);
    if (replacement) output.push(...replacement);
  }
  return output.join("");
}

function tomlTable(header: string, lines: readonly string[]): string[] {
  return [`[${header}]\n`, ...lines.map((line) => `${line}\n`), "\n"];
}

function isLegacySentropicName(name: string | undefined): boolean {
  return Boolean(name && /^sentropic-local-/i.test(name));
}

function isLegacyH2aPlugin(name: string | undefined): boolean {
  return Boolean(name && (/^h2a-local-/i.test(name) || /^h2a@sentropic-local-/i.test(name)));
}

function isAuthorizedClaudePluginUninstall(name: string | undefined): boolean {
  return Boolean(
    name && (
      /^h2a-local-/i.test(name) ||
      /^h2a@sentropic-local-/i.test(name) ||
      /^track@sentropic$/i.test(name)
    )
  );
}

function isDirectH2aMcp(table: TomlTable): boolean {
  const command = tomlValue(table, "command");
  const args = tomlValue(table, "args") ?? "";
  return command === "h2a" && /(?:^|[\"\s,])mcp-serve(?:[\"\s,]|$)/.test(args);
}

function isDirectTrackMcp(table: TomlTable): boolean {
  const command = tomlValue(table, "command") ?? "";
  const rawArgs = tomlValue(table, "args") ?? "";
  try {
    const args = JSON.parse(rawArgs);
    return command === "h2a" && Array.isArray(args) && args.includes("track-mcp");
  } catch {
    return false;
  }
}

function isOwnedMarketplace(location: string): boolean {
  const marketplace = readJson(join(location, ".claude-plugin", "marketplace.json")).value;
  return Boolean(
    marketplace?.name === H2A_MARKETPLACE_NAME &&
      Array.isArray(marketplace.plugins) &&
      marketplace.plugins.some((plugin) =>
        isPlainObject(plugin) && plugin.name === "h2a" && plugin.source === "./packages/h2a"
      )
  );
}

function canonicalMarketplace(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const source = value.source;
  return (
    isPlainObject(source) &&
    source.source === "github" &&
    source.repo === H2A_MARKETPLACE_REPOSITORY &&
    typeof value.installLocation === "string" &&
    isOwnedMarketplace(value.installLocation)
  );
}

function canonicalCodexMarketplace(table: TomlTable | undefined, home: string): boolean {
  return Boolean(
    canonicalCodexMarketplaceConfig(table) &&
      isOwnedMarketplace(join(home, ".codex", ".tmp", "marketplaces", H2A_MARKETPLACE_NAME))
  );
}

function isOwnedCodexMarketplace(table: TomlTable, home: string): boolean {
  return canonicalCodexMarketplace(table, home) || isOwnedLegacyCodexMarketplace(table);
}

function hasOwnedCanonicalCodexPlugin(home: string): boolean {
  const cache = join(home, ".codex", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a");
  return listDirectories(cache).some((version) => isOwnedPlugin(join(cache, version)));
}

/** A configured Git source is distinct from its derived local marketplace cache. */
function canonicalCodexMarketplaceConfig(table: TomlTable | undefined): boolean {
  return Boolean(
    table &&
      tomlValue(table, "source_type") === "git" &&
      tomlValue(table, "source") === H2A_MARKETPLACE_GIT_URL &&
      tomlValue(table, "ref") === "main"
  );
}

function h2aPluginEntries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

function pluginEntryIsCurrent(entry: Record<string, unknown>, version: string): boolean {
  return (
    entry.version === version &&
    typeof entry.installPath === "string" &&
    isOwnedPlugin(entry.installPath) &&
    cachedPluginVersion(entry.installPath) === version
  );
}

function cachedPluginVersion(path: string): string | undefined {
  for (const manifest of [
    join(path, ".codex-plugin", "plugin.json"),
    join(path, ".claude-plugin", "plugin.json")
  ]) {
    const parsed = readJson(manifest).value;
    if (typeof parsed?.version === "string") return parsed.version;
  }
  return undefined;
}

function isOwnedPlugin(path: string, expectedName = "h2a"): boolean {
  return [
    join(path, ".codex-plugin", "plugin.json"),
    join(path, ".claude-plugin", "plugin.json")
  ].some((manifest) => readJson(manifest).value?.name === expectedName);
}

function pluginEntriesAreOwned(selector: string, value: unknown): boolean {
  const expectedName = selector === "track@sentropic" ? "track" : "h2a";
  const entries = h2aPluginEntries(value);
  return entries.length > 0 && entries.every(
    (entry) => typeof entry.installPath === "string" && isOwnedPlugin(entry.installPath, expectedName)
  );
}

function isOwnedLegacyCacheRoot(path: string): boolean {
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name !== "h2a") return false;
    const versions = readdirSync(join(path, "h2a"), { withFileTypes: true });
    return versions.length > 0 && versions.every(
      (entry) => entry.isDirectory() && isOwnedPlugin(join(path, "h2a", entry.name))
    );
  } catch {
    return false;
  }
}

function cacheVersionMatches(path: string, version: string): boolean {
  return cachedPluginVersion(path) === version;
}

function codexCacheVersions(home: string): string[] {
  return listDirectories(join(home, ".codex", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a"));
}

function claudeCacheVersions(home: string): string[] {
  return listDirectories(join(home, ".claude", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a"));
}

function codexConfigPath(home: string): string {
  return join(home, ".codex", "config.toml");
}

function claudeSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

function claudeConfigPaths(home: string): string[] {
  return [join(home, ".claude.json"), join(home, ".config", "claude", "mcp.json")].filter(existsSync);
}

function claudeEnabledPlugins(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  return isPlainObject(settings?.enabledPlugins) ? settings.enabledPlugins : {};
}

function claudeExtraKnownMarketplaces(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  return isPlainObject(settings?.extraKnownMarketplaces) ? settings.extraKnownMarketplaces : {};
}

function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function orphanCacheFinding(
  host: "Claude" | "Codex",
  directories: readonly string[],
  paths: readonly string[],
  cacheRoot: string
): HostInstallationFinding {
  return finding(
    "orphan-cache",
    `${host} has orphan H2A cache directories: ${directories.join(", ")}. Remove them manually with: rm -rf -- ${paths.map(shellQuote).join(" ")}`,
    cacheRoot
  );
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function planAction(report: MutableHostReport, action: string): void {
  pushUnique(report.plannedActions, action);
}

function repairMarkerPath(home: string, host: Host): string {
  return join(home, host === "codex" ? ".codex" : ".claude", "h2a-repair.json");
}

function readRepairMarker(path: string): { marker?: HostRepairMarker; error?: string } {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    const repairedAt = isPlainObject(value) ? value.repairedAt : undefined;
    const repairedPaths = isPlainObject(value) ? value.repairedPaths : undefined;
    if (
      typeof repairedAt !== "string" ||
      !Number.isFinite(Date.parse(repairedAt)) ||
      !Array.isArray(repairedPaths) ||
      repairedPaths.length === 0 ||
      !repairedPaths.every((entry): entry is string => typeof entry === "string" && entry.length > 0)
    ) {
      return { error: "missing a valid repairedAt timestamp or repairedPaths" };
    }
    return { marker: { path, repairedAt, repairedPaths } };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function inspectRepairMarker(home: string, report: MutableHostReport): void {
  const path = repairMarkerPath(home, report.host);
  report.repairMarkerPath = path;
  const result = readRepairMarker(path);
  if (result.marker) {
    report.repairMarker = result.marker;
  } else if (result.error) {
    report.findings.push(finding("repair-marker-unavailable", `cannot read host repair marker: ${result.error}`, path));
  }
}

function recordRepairMarker(
  home: string,
  report: MutableHostReport,
  repairedPaths: readonly string[],
  writeMarker: (path: string, content: string) => void
): void {
  const uniquePaths = [...new Set(repairedPaths)];
  if (uniquePaths.length === 0) return;
  const path = repairMarkerPath(home, report.host);
  const repairedAt = new Date().toISOString();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeMarker(path, `${JSON.stringify({ repairedAt, repairedPaths: uniquePaths })}\n`);
    const result = readRepairMarker(path);
    if (!result.marker) throw new Error(result.error ?? "marker disappeared after write");
    report.repairMarker = result.marker;
    pushUnique(report.changed, path);
  } catch (error) {
    report.unrepaired.push(
      finding("repair-marker-unavailable", `cannot write host repair marker: ${(error as Error).message}`, path)
    );
  }
}

function inspectCodex(home: string, version: string): MutableHostReport {
  const configPath = codexConfigPath(home);
  const cachePath = join(home, ".codex", "plugins", "cache");
  const currentCachePath = join(cachePath, H2A_MARKETPLACE_NAME, "h2a", version);
  const report: MutableHostReport = {
    host: "codex",
    findings: [],
    diagnostics: [],
    changed: [],
    unrepaired: [],
    coherencePaths: [],
    plannedActions: [],
    repairMarkerPath: repairMarkerPath(home, "codex")
  };
  let raw = "";
  try {
    raw = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  } catch (error) {
    report.findings.push(finding("config-invalid", `cannot read Codex config: ${(error as Error).message}`, configPath));
    return report;
  }
  const tables = parseTomlTables(raw);
  const marketplaceTables = tables.filter((table) => tomlQuotedName(table.header, "marketplaces") !== undefined);
  const canonical = marketplaceTables.find((table) => tomlQuotedName(table.header, "marketplaces") === H2A_MARKETPLACE_NAME);
  if (!canonicalCodexMarketplace(canonical, home)) {
    const configuredSource = canonical ? tomlValue(canonical, "source") : undefined;
    report.findings.push(finding(
      "marketplace-missing",
      configuredSource
        ? `Codex lacks the canonical sentropic Git marketplace: configured source ${configuredSource} is not the canonical Git source; an enabled h2a MCP/plugin cache alone is an orphaned false-healthy signal.`
        : "Codex lacks the canonical sentropic Git marketplace; an enabled h2a MCP/plugin cache alone is an orphaned false-healthy signal.",
      configPath
    ));
  }
  const staleMarketplaces = marketplaceTables
    .map((table) => tomlQuotedName(table.header, "marketplaces"))
    .filter(isLegacySentropicName);
  if (staleMarketplaces.length > 0) {
    report.findings.push(finding("marketplace-stale", `Codex has stale Sentropic marketplaces: ${staleMarketplaces.join(", ")}.`, configPath));
  }
  const plugins = tables.filter((table) => tomlQuotedName(table.header, "plugins") !== undefined);
  const canonicalPlugin = plugins.find((table) => tomlQuotedName(table.header, "plugins") === H2A_PLUGIN_SELECTOR);
  if (tomlBoolean(canonicalPlugin ?? { header: "", lines: [] }, "enabled") !== true) {
    report.findings.push(finding("plugin-missing", "Codex does not enable the canonical h2a@sentropic plugin.", configPath));
  }
  const stalePlugins = plugins
    .filter((table) => tomlBoolean(table, "enabled") !== false)
    .map((table) => tomlQuotedName(table.header, "plugins"))
    .filter(isLegacyH2aPlugin);
  if (stalePlugins.length > 0) {
    report.findings.push(finding("plugin-stale", `Codex has stale H2A plugin entries: ${stalePlugins.join(", ")}.`, configPath));
  }
  const versions = codexCacheVersions(home);
  if (!versions.includes(version) || !cacheVersionMatches(currentCachePath, version)) {
    report.findings.push(finding("version-skew", `Codex h2a cache is not at npm CLI version ${version}.`, cachePath));
  }
  const staleVersions = versions.filter(
    (entry) => entry !== version && isOwnedPlugin(join(cachePath, H2A_MARKETPLACE_NAME, "h2a", entry))
  );
  const legacyCaches = listDirectories(cachePath).filter(
    (entry) => isLegacySentropicName(entry) && isOwnedLegacyCacheRoot(join(cachePath, entry))
  );
  if (staleVersions.length > 0 || legacyCaches.length > 0) {
    report.findings.push(orphanCacheFinding(
      "Codex",
      [...staleVersions, ...legacyCaches],
      [
        ...staleVersions.map((entry) => join(cachePath, H2A_MARKETPLACE_NAME, "h2a", entry)),
        ...legacyCaches.map((entry) => join(cachePath, entry))
      ],
      cachePath
    ));
  }
  const mcp = tables.filter((table) => tomlQuotedName(table.header, "mcp_servers") !== undefined);
  const directH2a = mcp.filter(isDirectH2aMcp);
  const directTrack = mcp.filter(isDirectTrackMcp);
  const endpointCount = (tomlBoolean(canonicalPlugin ?? { header: "", lines: [] }, "enabled") === true ? 1 : 0) + directH2a.length;
  if (endpointCount !== 1) {
    report.findings.push(finding("h2a-endpoint-count", `Codex exposes ${endpointCount} H2A endpoints; exactly one plugin endpoint is required.`, configPath));
  }
  if (directTrack.length > 0) {
    report.findings.push(finding("standalone-track-mcp", "Codex has a standalone track-mcp endpoint; track_* must be served by h2a.", configPath));
  }
  report.coherencePaths.push(...loadBearingArtifacts(report, [currentCachePath], [configPath]));
  inspectRepairMarker(home, report);
  return report;
}

function inspectClaude(home: string, version: string): MutableHostReport {
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  const settingsPath = claudeSettingsPath(home);
  const report: MutableHostReport = {
    host: "claude",
    findings: [],
    diagnostics: [],
    changed: [],
    unrepaired: [],
    coherencePaths: [],
    plannedActions: [],
    repairMarkerPath: repairMarkerPath(home, "claude")
  };
  const known = readJson(knownPath);
  const settings = readJson(settingsPath);
  if (known.error) {
    report.findings.push(finding("config-invalid", `cannot parse Claude marketplace state: ${known.error}`, knownPath));
  } else if (!canonicalMarketplace(known.value?.[H2A_MARKETPLACE_NAME])) {
    report.findings.push(finding("marketplace-missing", "Claude lacks the canonical sentropic Git marketplace.", knownPath));
  }
  if (settings.error) {
    report.findings.push(finding("config-invalid", `cannot parse Claude settings: ${settings.error}`, settingsPath));
  }
  const staleMarketplaces = [...new Set([
    ...Object.keys(known.value ?? {}).filter(isLegacySentropicName),
    ...Object.keys(claudeExtraKnownMarketplaces(settings.value)).filter(isLegacySentropicName)
  ])];
  if (staleMarketplaces.length > 0) {
    report.findings.push(finding(
      "marketplace-stale",
      `Claude has stale Sentropic marketplaces: ${staleMarketplaces.join(", ")}.`,
      staleMarketplaces.some((name) => Object.hasOwn(claudeExtraKnownMarketplaces(settings.value), name)) ? settingsPath : knownPath
    ));
  }
  const installed = readJson(installedPath);
  if (installed.error) {
    report.findings.push(finding("config-invalid", `cannot parse Claude plugin state: ${installed.error}`, installedPath));
  }
  const plugins = isPlainObject(installed.value?.plugins) ? installed.value.plugins : {};
  const canonicalEntries = h2aPluginEntries(plugins[H2A_PLUGIN_SELECTOR]);
  if (!canonicalEntries.some((entry) => pluginEntryIsCurrent(entry, version))) {
    report.findings.push(finding("version-skew", `Claude h2a plugin does not match npm CLI version ${version}.`, installedPath));
  }
  if (canonicalEntries.length === 0) {
    report.findings.push(finding("plugin-missing", "Claude does not install the canonical h2a@sentropic plugin.", installedPath));
  }
  const enabledPlugins = claudeEnabledPlugins(settings.value);
  const stalePlugins = Object.keys(plugins).filter(
    (name) =>
      (isLegacyH2aPlugin(name) || /^track@sentropic$/i.test(name)) &&
      enabledPlugins[name] !== false
  );
  if (stalePlugins.length > 0) {
    report.findings.push(finding("plugin-stale", `Claude has stale Sentropic plugin entries: ${stalePlugins.join(", ")}.`, installedPath));
  }
  const cacheVersions = claudeCacheVersions(home);
  const cacheRoot = join(home, ".claude", "plugins", "cache");
  const staleVersions = cacheVersions.filter(
    (entry) => entry !== version && isOwnedPlugin(join(cacheRoot, H2A_MARKETPLACE_NAME, "h2a", entry))
  );
  const legacyCaches = listDirectories(cacheRoot).filter(
    (entry) => isLegacySentropicName(entry) && isOwnedLegacyCacheRoot(join(cacheRoot, entry))
  );
  if (staleVersions.length > 0 || legacyCaches.length > 0) {
    report.findings.push(orphanCacheFinding(
      "Claude",
      [...staleVersions, ...legacyCaches],
      [
        ...staleVersions.map((entry) => join(cacheRoot, H2A_MARKETPLACE_NAME, "h2a", entry)),
        ...legacyCaches.map((entry) => join(cacheRoot, entry))
      ],
      cacheRoot
    ));
  }
  let directH2a = 0;
  let directTrack = 0;
  for (const path of claudeConfigPaths(home)) {
    const config = readJson(path);
    if (config.error) {
      report.findings.push(finding("config-invalid", `cannot parse Claude MCP config: ${config.error}`, path));
      continue;
    }
    const servers = isPlainObject(config.value?.mcpServers) ? config.value.mcpServers : {};
    for (const entry of Object.values(servers)) {
      if (isH2aJsonMcp(entry)) directH2a++;
      if (isTrackJsonMcp(entry)) directTrack++;
    }
  }
  const endpointCount = (canonicalEntries.length > 0 ? 1 : 0) + directH2a;
  if (endpointCount !== 1) {
    report.findings.push(finding("h2a-endpoint-count", `Claude exposes ${endpointCount} H2A endpoints; exactly one plugin endpoint is required.`));
  }
  if (directTrack > 0) {
    report.findings.push(finding("standalone-track-mcp", "Claude has a standalone track-mcp endpoint; track_* must be served by h2a."));
  }
  report.coherencePaths.push(...loadBearingArtifacts(
    report,
    canonicalEntries.flatMap((entry) => typeof entry.installPath === "string" ? [entry.installPath] : []),
    claudeConfigPaths(home)
  ));
  inspectRepairMarker(home, report);
  return report;
}

function jsonArgs(value: unknown): string[] {
  return isPlainObject(value) && Array.isArray(value.args)
    ? value.args.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isH2aJsonMcp(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.command !== "string") return false;
  return (value.command === "h2a" || /[\\/]h2a(?:\.cmd|\.exe)?$/i.test(value.command)) && jsonArgs(value).includes("mcp-serve");
}

function isTrackJsonMcp(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.command !== "string") return false;
  return value.command === "h2a" && jsonArgs(value).includes("track-mcp");
}

interface JsonObjectProperty {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

function skipJsonWhitespace(raw: string, index: number): number {
  while (/\s/.test(raw[index] ?? "")) index++;
  return index;
}

function jsonStringEnd(raw: string, index: number): number | undefined {
  if (raw[index] !== '"') return undefined;
  for (let cursor = index + 1; cursor < raw.length; cursor++) {
    if (raw[cursor] === "\\") { cursor++; continue; }
    if (raw[cursor] === '"') return cursor + 1;
  }
  return undefined;
}

function jsonValueEnd(raw: string, index: number): number | undefined {
  if (raw[index] === '"') return jsonStringEnd(raw, index);
  if (raw[index] === "{" || raw[index] === "[") {
    const stack = [raw[index] === "{" ? "}" : "]"];
    for (let cursor = index + 1; cursor < raw.length; cursor++) {
      const char = raw[cursor];
      if (char === '"') {
        const end = jsonStringEnd(raw, cursor);
        if (end === undefined) return undefined;
        cursor = end - 1;
        continue;
      }
      if (char === "{") stack.push("}");
      else if (char === "[") stack.push("]");
      else if (char === "}" || char === "]") {
        if (stack.pop() !== char) return undefined;
        if (stack.length === 0) return cursor + 1;
      }
    }
    return undefined;
  }
  let cursor = index;
  while (cursor < raw.length && !/[\s,}\]]/.test(raw[cursor])) cursor++;
  return cursor > index ? cursor : undefined;
}

function jsonObjectProperties(raw: string, objectStart: number): JsonObjectProperty[] | undefined {
  if (raw[objectStart] !== "{") return undefined;
  const properties: JsonObjectProperty[] = [];
  let cursor = skipJsonWhitespace(raw, objectStart + 1);
  while (raw[cursor] !== "}") {
    const start = cursor;
    const keyEnd = jsonStringEnd(raw, cursor);
    if (keyEnd === undefined) return undefined;
    let key: string;
    try { key = JSON.parse(raw.slice(cursor, keyEnd)); } catch { return undefined; }
    cursor = skipJsonWhitespace(raw, keyEnd);
    if (raw[cursor] !== ":") return undefined;
    const valueStart = skipJsonWhitespace(raw, cursor + 1);
    const valueEnd = jsonValueEnd(raw, valueStart);
    if (valueEnd === undefined) return undefined;
    properties.push({ key, start, end: valueEnd, valueStart, valueEnd });
    cursor = skipJsonWhitespace(raw, valueEnd);
    if (raw[cursor] === ",") {
      cursor = skipJsonWhitespace(raw, cursor + 1);
    } else if (raw[cursor] !== "}") {
      return undefined;
    }
  }
  return properties;
}

function removeOwnedJsonMcpEntries(raw: string): string | undefined {
  const root = jsonObjectProperties(raw, skipJsonWhitespace(raw, 0));
  const mcpServers = root?.find((property) => property.key === "mcpServers");
  if (!mcpServers || raw[mcpServers.valueStart] !== "{") return raw;
  const servers = jsonObjectProperties(raw, mcpServers.valueStart);
  if (!servers) return undefined;
  const removals = servers
    .map((property, index) => {
      try {
        const entry = JSON.parse(raw.slice(property.valueStart, property.valueEnd));
        return isH2aJsonMcp(entry) || isTrackJsonMcp(entry) ? index : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((index): index is number => index !== undefined);
  if (removals.length === 0) return raw;

  const ranges: Array<readonly [number, number]> = [];
  for (let start = 0; start < removals.length;) {
    let end = start;
    while (end + 1 < removals.length && removals[end + 1] === removals[end] + 1) end++;
    const first = removals[start];
    const last = removals[end];
    ranges.push(last < servers.length - 1
      ? [servers[first].start, servers[last + 1].start]
      : first === 0
        ? [servers[first].start, servers[last].end]
        : [servers[first - 1].end, servers[last].end]);
    start = end + 1;
  }
  return ranges.reverse().reduce((rendered, [start, end]) => rendered.slice(0, start) + rendered.slice(end), raw);
}

function removeOwnedClaudeMarketplaceEntries(raw: string): { readonly rendered: string; readonly unverified: string[] } | undefined {
  const root = jsonObjectProperties(raw, skipJsonWhitespace(raw, 0));
  const extraKnownMarketplaces = root?.find((property) => property.key === "extraKnownMarketplaces");
  if (!extraKnownMarketplaces) return { rendered: raw, unverified: [] };
  if (raw[extraKnownMarketplaces.valueStart] !== "{") return undefined;
  const marketplaces = jsonObjectProperties(raw, extraKnownMarketplaces.valueStart);
  if (!marketplaces) return undefined;
  const removals: number[] = [];
  const unverified: string[] = [];
  for (const [index, property] of marketplaces.entries()) {
    if (!isLegacySentropicName(property.key)) continue;
    try {
      if (claudeMarketplaceIsOwned(JSON.parse(raw.slice(property.valueStart, property.valueEnd)))) removals.push(index);
      else unverified.push(property.key);
    } catch {
      return undefined;
    }
  }
  if (removals.length === 0) return { rendered: raw, unverified };

  const ranges: Array<readonly [number, number]> = [];
  for (let start = 0; start < removals.length;) {
    let end = start;
    while (end + 1 < removals.length && removals[end + 1] === removals[end] + 1) end++;
    const first = removals[start];
    const last = removals[end];
    ranges.push(last < marketplaces.length - 1
      ? [marketplaces[first].start, marketplaces[last + 1].start]
      : first === 0
        ? [marketplaces[first].start, marketplaces[last].end]
        : [marketplaces[first - 1].end, marketplaces[last].end]);
    start = end + 1;
  }
  return {
    rendered: ranges.reverse().reduce((rendered, [start, end]) => rendered.slice(0, start) + rendered.slice(end), raw),
    unverified
  };
}

function setTomlValue(table: TomlTable, key: string, value: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let replaced = false;
  const lines = table.lines.map((line, index) => {
    if (index === 0 || !new RegExp(`^\\s*${escaped}\\s*=`).test(line)) return line;
    replaced = true;
    return `${key} = ${value}\n`;
  });
  return replaced ? lines : [...lines, `${key} = ${value}\n`];
}

function canonicalCodexMarketplaceLines(table: TomlTable | undefined): string[] {
  let lines = table?.lines ?? tomlTable(`marketplaces.${H2A_MARKETPLACE_NAME}`, []);
  lines = setTomlValue({ header: "", lines }, "source_type", '"git"');
  lines = setTomlValue({ header: "", lines }, "source", `"${H2A_MARKETPLACE_GIT_URL}"`);
  return setTomlValue({ header: "", lines }, "ref", '"main"');
}

function isOwnedLegacyCodexMarketplace(table: TomlTable): boolean {
  const source = tomlValue(table, "source");
  return typeof source === "string" && isOwnedMarketplace(source);
}

function isOwnedLegacyCodexPlugin(plugin: string, tables: readonly TomlTable[]): boolean {
  const marketplace = plugin.slice(plugin.lastIndexOf("@") + 1);
  if (marketplace === plugin) return false;
  const table = tables.find((candidate) => tomlQuotedName(candidate.header, "marketplaces") === marketplace);
  return Boolean(table && isOwnedLegacyCodexMarketplace(table));
}

function isEnabledLegacyCodexPlugin(table: TomlTable): boolean {
  const plugin = tomlQuotedName(table.header, "plugins");
  return Boolean(plugin && isLegacyH2aPlugin(plugin) && tomlBoolean(table, "enabled") !== false);
}

function reportUnverifiedOwnership(report: MutableHostReport, path: string, artifact: string): void {
  report.unrepaired.push(
    finding(
      "ownership-unverified",
      `cannot remove ${artifact}: its content does not identify it as an H2A-owned artifact.`,
      path
    )
  );
}

function repairCodexConfig(
  home: string,
  report: MutableHostReport,
  options: { readonly dryRun: boolean; readonly testConfigurationWrite?: TestConfigurationWrite }
): void {
  const path = codexConfigPath(home);
  let raw = "";
  try {
    raw = existsSync(path) ? readFileSync(path, "utf8") : "";
  } catch (error) {
    report.unrepaired.push(finding("config-invalid", `cannot read Codex config for repair: ${(error as Error).message}`, path));
    return;
  }
  const tables = parseTomlTables(raw);
  const canonicalPlugin = tables.find(
    (table) => tomlQuotedName(table.header, "plugins") === H2A_PLUGIN_SELECTOR
  );
  const canonicalMarketplace = tables.find(
    (table) => tomlQuotedName(table.header, "marketplaces") === H2A_MARKETPLACE_NAME
  );
  const canonicalMarketplaceOwned = Boolean(
    canonicalMarketplace && isOwnedCodexMarketplace(canonicalMarketplace, home)
  );
  const canonicalPluginOwned = Boolean(
    canonicalPlugin && (canonicalMarketplaceOwned || hasOwnedCanonicalCodexPlugin(home))
  );
  if (canonicalMarketplace && !canonicalMarketplaceOwned) {
    reportUnverifiedOwnership(report, path, `marketplace ${H2A_MARKETPLACE_NAME}`);
    return;
  }
  if (canonicalPlugin && !canonicalPluginOwned) {
    reportUnverifiedOwnership(report, path, `plugin ${H2A_PLUGIN_SELECTOR}`);
    return;
  }
  const ownedLegacyMarketplaces = new Set(
    tables
      .filter((table) => isLegacySentropicName(tomlQuotedName(table.header, "marketplaces")))
      .filter(isOwnedLegacyCodexMarketplace)
      .map((table) => table.header)
  );
  const ownedLegacyPlugins = new Set(
    tables
      .filter((table) => {
        const plugin = tomlQuotedName(table.header, "plugins");
        return Boolean(plugin && isEnabledLegacyCodexPlugin(table) && isOwnedLegacyCodexPlugin(plugin, tables));
      })
      .map((table) => table.header)
  );
  for (const table of tables) {
    const marketplace = tomlQuotedName(table.header, "marketplaces");
    if (isLegacySentropicName(marketplace) && !ownedLegacyMarketplaces.has(table.header)) {
      reportUnverifiedOwnership(report, path, `legacy marketplace ${marketplace}`);
    }
    const plugin = tomlQuotedName(table.header, "plugins");
    if (plugin && isEnabledLegacyCodexPlugin(table) && !ownedLegacyPlugins.has(table.header)) {
      reportUnverifiedOwnership(report, path, `legacy plugin ${plugin}`);
    }
  }
  const needsConfigRepair = tables.some((table) => {
    const marketplace = tomlQuotedName(table.header, "marketplaces");
    if (isLegacySentropicName(marketplace) && ownedLegacyMarketplaces.has(table.header)) return true;
    if (marketplace === H2A_MARKETPLACE_NAME && !canonicalCodexMarketplaceConfig(table)) return true;
    const plugin = tomlQuotedName(table.header, "plugins");
    if (plugin && isEnabledLegacyCodexPlugin(table) && ownedLegacyPlugins.has(table.header)) return true;
    const mcp = tomlQuotedName(table.header, "mcp_servers");
    return mcp !== undefined && (isDirectH2aMcp(table) || isDirectTrackMcp(table));
  }) ||
    !canonicalMarketplace ||
    tomlBoolean(canonicalPlugin ?? { header: "", lines: [] }, "enabled") !== true;
  if (!needsConfigRepair) return;
  const next = rewriteTomlTables(raw, (table) => {
    const marketplace = tomlQuotedName(table.header, "marketplaces");
    if (isLegacySentropicName(marketplace) && ownedLegacyMarketplaces.has(table.header)) return undefined;
    if (marketplace === H2A_MARKETPLACE_NAME) return canonicalCodexMarketplaceLines(table);
    const plugin = tomlQuotedName(table.header, "plugins");
    if (plugin === H2A_PLUGIN_SELECTOR) return setTomlValue(table, "enabled", "true");
    if (plugin && isEnabledLegacyCodexPlugin(table) && ownedLegacyPlugins.has(table.header)) return undefined;
    const mcp = tomlQuotedName(table.header, "mcp_servers");
    if (mcp !== undefined && (isDirectH2aMcp(table) || isDirectTrackMcp(table))) return undefined;
    return table.lines;
  });
  const additions = [
    ...(canonicalMarketplace ? [] : tomlTable(`marketplaces.${H2A_MARKETPLACE_NAME}`, [
      'source_type = "git"',
      `source = "${H2A_MARKETPLACE_GIT_URL}"`,
      'ref = "main"'
    ])),
    ...(canonicalPlugin ? [] : tomlTable(`plugins.\"${H2A_PLUGIN_SELECTOR}\"`, ["enabled = true"]))
  ];
  const rendered = additions.length === 0
    ? next
    : `${next.trimEnd()}\n\n${additions.join("")}`.replace(/^\n+/, "");
  if (rendered === raw) return;
  if (options.dryRun) {
    planAction(report, `rewrite ${path}`);
    return;
  }
  try {
    const error = atomicConfigurationWrite(
      path,
      raw,
      rendered.endsWith("\n") ? rendered : `${rendered}\n`,
      "toml",
      options.testConfigurationWrite
    );
    if (error) throw new Error(error);
    pushUnique(report.changed, path);
  } catch (error) {
    report.unrepaired.push(finding("config-invalid", `cannot write Codex config: ${(error as Error).message}`, path));
  }
}

function repairClaudeMcpConfigs(
  home: string,
  report: MutableHostReport,
  dryRun: boolean,
  testConfigurationWrite?: TestConfigurationWrite
): boolean {
  let failed = false;
  for (const path of claudeConfigPaths(home)) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
      const value = JSON.parse(raw);
      if (!isPlainObject(value)) throw new Error("JSON root is not an object");
    } catch (error) {
      report.unrepaired.push(finding("config-invalid", `cannot parse Claude MCP config for repair: ${(error as Error).message}`, path));
      failed = true;
      continue;
    }
    const rendered = removeOwnedJsonMcpEntries(raw);
    if (rendered === undefined) {
      report.unrepaired.push(finding("config-invalid", "cannot locate Claude MCP entries for safe repair", path));
      failed = true;
      continue;
    }
    if (rendered === raw) continue;
    if (dryRun) {
      planAction(report, `rewrite ${path}`);
      continue;
    }
    try {
      const error = atomicConfigurationWrite(path, raw, rendered, "json", testConfigurationWrite);
      if (error) throw new Error(error);
      pushUnique(report.changed, path);
    } catch (error) {
      failed = true;
      report.unrepaired.push(finding("config-invalid", `cannot write Claude MCP config: ${(error as Error).message}`, path));
    }
  }
  return failed;
}

function repairClaudeSettingsMarketplaces(
  home: string,
  report: MutableHostReport,
  dryRun: boolean,
  testConfigurationWrite?: TestConfigurationWrite
): boolean {
  const path = claudeSettingsPath(home);
  if (!existsSync(path)) return false;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
    if (!isPlainObject(JSON.parse(raw))) throw new Error("JSON root is not an object");
  } catch (error) {
    report.unrepaired.push(finding("config-invalid", `cannot parse Claude settings for repair: ${(error as Error).message}`, path));
    return true;
  }
  const result = removeOwnedClaudeMarketplaceEntries(raw);
  if (!result) {
    report.unrepaired.push(finding("config-invalid", "cannot locate Claude settings marketplaces for safe repair", path));
    return true;
  }
  for (const marketplace of result.unverified) {
    reportUnverifiedOwnership(report, path, `legacy marketplace ${marketplace}`);
  }
  if (result.rendered === raw) return false;
  if (dryRun) {
    planAction(report, `rewrite ${path}`);
    return false;
  }
  try {
    const error = atomicConfigurationWrite(path, raw, result.rendered, "json", testConfigurationWrite);
    if (error) throw new Error(error);
    pushUnique(report.changed, path);
    return false;
  } catch (error) {
    report.unrepaired.push(finding("config-invalid", `cannot write Claude settings: ${(error as Error).message}`, path));
    return true;
  }
}

// runCommand contains the installation doctor's only native runner invocation.
// Claude's native uninstall argv is exactly ["plugin", "uninstall", selector], with no preceding flags.
// Codex has no native uninstall path; its repair rewrites its own configuration and cache.
function runCommand(
  report: MutableHostReport,
  runner: HostCommandRunner,
  command: "claude" | "codex",
  args: readonly string[],
  dryRun: boolean
): boolean {
  if (
    command === "claude" &&
    args[0] === "plugin" &&
    args[1] === "uninstall" &&
    !isAuthorizedClaudePluginUninstall(args[2])
  ) {
    report.unrepaired.push(
      finding(
        "host-command-refused",
        `refused native command: ${command} ${args.join(" ")}; selector ${args[2] ?? "<missing>"} is not authorized for uninstall.`
      )
    );
    return false;
  }
  if (dryRun) {
    planAction(report, `${command} ${args.join(" ")}`);
    return true;
  }
  const result = runner(command, args);
  if (result.ok) return true;
  report.unrepaired.push(
    finding("host-command-failed", `${command} ${args.join(" ")} failed: ${result.message ?? "unknown error"}`)
  );
  return false;
}

function artifactSnapshots(paths: readonly string[]): Map<string, string> {
  const snapshots = new Map<string, string>();
  for (const path of paths) {
    try {
      const metadata = statSync(path);
      snapshots.set(path, `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`);
    } catch {
      // The host inspection already carries an unavailable load-bearing artifact.
    }
  }
  return snapshots;
}

function actualRepairPaths(
  before: MutableHostReport,
  after: MutableHostReport,
  beforeArtifacts: ReadonlyMap<string, string>
): string[] {
  const rewrittenArtifacts = after.coherencePaths.filter((path) => {
    try {
      const metadata = statSync(path);
      const current = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;
      return beforeArtifacts.get(path) !== current;
    } catch {
      return false;
    }
  });
  return [...before.changed, ...rewrittenArtifacts];
}

function removeOwnedCache(
  report: MutableHostReport,
  path: string,
  artifact: string,
  owned: boolean,
  dryRun: boolean
): void {
  if (!owned) {
    reportUnverifiedOwnership(report, path, artifact);
    return;
  }
  if (dryRun) {
    planAction(report, `remove ${path}`);
    return;
  }
  try {
    rmSync(path, { recursive: true, force: true });
    pushUnique(report.changed, path);
  } catch (error) {
    report.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path));
  }
}

function codexReplacementIsReady(home: string, version: string): boolean {
  return (
    cacheVersionMatches(join(home, ".codex", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a", version), version) &&
    isOwnedMarketplace(join(home, ".codex", ".tmp", "marketplaces", H2A_MARKETPLACE_NAME))
  );
}

function claudeMarketplaceIsOwned(value: unknown): boolean {
  return isPlainObject(value) && typeof value.installLocation === "string" && isOwnedMarketplace(value.installLocation);
}

function claudeReplacementIsReady(home: string, version: string): boolean {
  const known = readJson(join(home, ".claude", "plugins", "known_marketplaces.json")).value;
  const installed = readJson(join(home, ".claude", "plugins", "installed_plugins.json")).value;
  const plugins = isPlainObject(installed?.plugins) ? installed.plugins : {};
  return (
    canonicalMarketplace(known?.[H2A_MARKETPLACE_NAME]) &&
    h2aPluginEntries(plugins[H2A_PLUGIN_SELECTOR]).some((entry) => pluginEntryIsCurrent(entry, version))
  );
}

function repairCodex(
  home: string,
  version: string,
  runner: HostCommandRunner,
  writeMarker: (path: string, content: string) => void,
  dryRun: boolean,
  testConfigurationWrite?: TestConfigurationWrite
): MutableHostReport {
  const before = inspectCodex(home, version);
  const beforeArtifacts = artifactSnapshots(before.coherencePaths);
  // A vanished local marketplace is a distinct recovery case. Codex reports
  // `plugin marketplace upgrade` success with "No configured Git marketplaces
  // to upgrade", leaving the dead source and its cached plugin untouched.
  // Install the native replacement first, and leave every old configuration
  // and endpoint intact until that replacement is verified.
  let sourceRecovery = true;
  try {
    const config = existsSync(codexConfigPath(home)) ? readFileSync(codexConfigPath(home), "utf8") : "";
    const canonicalTable = parseTomlTables(config).find(
      (table) => tomlQuotedName(table.header, "marketplaces") === H2A_MARKETPLACE_NAME
    );
    sourceRecovery = !canonicalCodexMarketplaceConfig(canonicalTable);
  } catch {
    // repairCodexConfig below records the unreadable config as unrepaired.
  }
  const needsPlugin = before.findings.some((entry) =>
    ["marketplace-missing", "marketplace-stale", "plugin-missing", "plugin-stale", "version-skew"].includes(entry.code)
  );
  let replacementCommandsSucceeded = true;
  if (sourceRecovery) {
    replacementCommandsSucceeded = runCommand(before, runner, "codex", [
      "plugin",
      "marketplace",
      "add",
      H2A_MARKETPLACE_REPOSITORY,
      "--ref",
      "main"
    ], dryRun);
  } else if (needsPlugin) {
    replacementCommandsSucceeded = runCommand(before, runner, "codex", ["plugin", "marketplace", "upgrade"], dryRun);
  }
  if (needsPlugin && replacementCommandsSucceeded) {
    replacementCommandsSucceeded = runCommand(before, runner, "codex", ["plugin", "add", H2A_PLUGIN_SELECTOR], dryRun);
  }
  const replacementReady = dryRun
    ? replacementCommandsSucceeded
    : replacementCommandsSucceeded && codexReplacementIsReady(home, version);
  if (!replacementReady) {
    if (replacementCommandsSucceeded && !dryRun) {
      before.unrepaired.push(finding(
        "plugin-missing",
        "cannot safely remove existing Codex endpoints because the canonical replacement was not verified."
      ));
    }
    return combineAfterRepair(before, inspectCodex(home, version));
  }
  repairCodexConfig(home, before, { dryRun, testConfigurationWrite });
  if (before.unrepaired.some((entry) => entry.code === "config-invalid")) {
    return combineAfterRepair(before, inspectCodex(home, version));
  }
  // v1 deliberately retains legacy orphan caches. A stale version underneath
  // the canonical, verified cache remains part of the normal version repair.
  const cache = join(home, ".codex", "plugins", "cache");
  if (cacheVersionMatches(join(cache, H2A_MARKETPLACE_NAME, "h2a", version), version)) {
    for (const stale of codexCacheVersions(home).filter(
      (entry) => entry !== version && isOwnedPlugin(join(cache, H2A_MARKETPLACE_NAME, "h2a", entry))
    )) {
      const path = join(cache, H2A_MARKETPLACE_NAME, "h2a", stale);
      removeOwnedCache(before, path, `Codex cache ${path}`, isOwnedPlugin(path), dryRun);
    }
  }
  const afterNativeRepair = inspectCodex(home, version);
  if (dryRun) {
    if (before.plannedActions.length > 0) planAction(before, `record repair marker after verified mutation at ${repairMarkerPath(home, "codex")}`);
  } else {
    recordRepairMarker(home, before, actualRepairPaths(before, afterNativeRepair, beforeArtifacts), writeMarker);
  }
  return combineAfterRepair(before, inspectCodex(home, version));
}

function repairClaude(
  home: string,
  version: string,
  runner: HostCommandRunner,
  writeMarker: (path: string, content: string) => void,
  dryRun: boolean,
  testClaudePluginUninstalls: readonly string[],
  testConfigurationWrite?: TestConfigurationWrite
): MutableHostReport {
  const before = inspectClaude(home, version);
  const beforeArtifacts = artifactSnapshots(before.coherencePaths);
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  const known = readJson(knownPath).value ?? {};
  const installed = readJson(installedPath).value ?? {};
  const initialPlugins = isPlainObject(installed.plugins) ? installed.plugins : {};
  const enabledPlugins = claudeEnabledPlugins(readJson(claudeSettingsPath(home)).value);
  const needsMarketplace = before.findings.some((entry) => ["marketplace-missing", "marketplace-stale"].includes(entry.code));
  const needsPlugin = before.findings.some((entry) => ["plugin-missing", "version-skew", "plugin-stale"].includes(entry.code));
  let replacementCommandsSucceeded = true;
  if (needsMarketplace) {
    replacementCommandsSucceeded = runCommand(
      before,
      runner,
      "claude",
      ["plugin", "marketplace", "add", H2A_MARKETPLACE_REPOSITORY],
      dryRun
    );
  }
  const canonical = h2aPluginEntries(initialPlugins[H2A_PLUGIN_SELECTOR]);
  const action = canonical.length === 0 ? "install" : "update";
  if (needsPlugin && replacementCommandsSucceeded) {
    replacementCommandsSucceeded = runCommand(before, runner, "claude", ["plugin", action, H2A_PLUGIN_SELECTOR], dryRun);
  }
  const replacementReady = dryRun
    ? replacementCommandsSucceeded
    : replacementCommandsSucceeded && claudeReplacementIsReady(home, version);
  if (!replacementReady) {
    if (replacementCommandsSucceeded && !dryRun) {
      before.unrepaired.push(finding(
        "plugin-missing",
        "cannot safely remove existing Claude endpoints because the canonical replacement was not verified."
      ));
    }
    return combineAfterRepair(before, inspectClaude(home, version));
  }

  if (
    repairClaudeMcpConfigs(home, before, dryRun, testConfigurationWrite) ||
    repairClaudeSettingsMarketplaces(home, before, dryRun, testConfigurationWrite)
  ) {
    return combineAfterRepair(before, inspectClaude(home, version));
  }
  const repairedKnown = readJson(knownPath).value ?? {};
  const repairedInstalled = readJson(installedPath).value ?? {};
  for (const marketplace of Object.keys(repairedKnown).filter(isLegacySentropicName)) {
    if (!claudeMarketplaceIsOwned(repairedKnown[marketplace])) {
      reportUnverifiedOwnership(before, knownPath, `legacy marketplace ${marketplace}`);
      continue;
    }
    runCommand(before, runner, "claude", ["plugin", "marketplace", "remove", marketplace], dryRun);
  }
  const plugins = isPlainObject(repairedInstalled.plugins) ? repairedInstalled.plugins : {};
  for (const plugin of Object.keys(plugins).filter(
    (name) =>
      (isLegacyH2aPlugin(name) || /^track@sentropic$/i.test(name)) &&
      enabledPlugins[name] !== false
  )) {
    if (!pluginEntriesAreOwned(plugin, plugins[plugin])) {
      reportUnverifiedOwnership(before, installedPath, `legacy plugin ${plugin}`);
      continue;
    }
    runCommand(before, runner, "claude", ["plugin", "uninstall", plugin], dryRun);
  }
  for (const plugin of testClaudePluginUninstalls) {
    runCommand(before, runner, "claude", ["plugin", "uninstall", plugin], dryRun);
  }
  // v1 deliberately retains legacy orphan caches. A stale version underneath
  // the canonical, verified cache remains part of the normal version repair.
  const cache = join(home, ".claude", "plugins", "cache");
  if (cacheVersionMatches(join(cache, H2A_MARKETPLACE_NAME, "h2a", version), version)) {
    for (const stale of claudeCacheVersions(home).filter(
      (entry) => entry !== version && isOwnedPlugin(join(cache, H2A_MARKETPLACE_NAME, "h2a", entry))
    )) {
      const path = join(cache, H2A_MARKETPLACE_NAME, "h2a", stale);
      removeOwnedCache(before, path, `Claude cache ${path}`, isOwnedPlugin(path), dryRun);
    }
  }
  const afterNativeRepair = inspectClaude(home, version);
  if (dryRun) {
    if (before.plannedActions.length > 0) planAction(before, `record repair marker after verified mutation at ${repairMarkerPath(home, "claude")}`);
  } else {
    recordRepairMarker(home, before, actualRepairPaths(before, afterNativeRepair, beforeArtifacts), writeMarker);
  }
  return combineAfterRepair(before, inspectClaude(home, version));
}

function combineAfterRepair(before: MutableHostReport, after: MutableHostReport): MutableHostReport {
  const unrepaired = [...before.unrepaired, ...after.findings].filter(isBlockingFinding);
  return {
    ...after,
    changed: before.changed,
    unrepaired,
    coherencePaths: [...new Set([...before.coherencePaths, ...after.coherencePaths])],
    plannedActions: [...new Set([...before.plannedActions, ...after.plannedActions])],
    repairMarker: after.repairMarker ?? before.repairMarker
  };
}

function freezeReport(report: MutableHostReport): HostInstallationReport {
  return {
    host: report.host,
    ok: report.unrepaired.every((entry) => !isBlockingFinding(entry)) && report.findings.every((entry) => !isBlockingFinding(entry)),
    findings: report.findings,
    diagnostics: report.diagnostics,
    changed: report.changed,
    unrepaired: report.unrepaired,
    coherencePaths: report.coherencePaths,
    plannedActions: report.plannedActions,
    repairMarkerPath: report.repairMarkerPath,
    ...(report.repairMarker ? { repairMarker: report.repairMarker } : {})
  };
}

/** Inspect, and optionally repair, the H2A installation state of both supported hosts. */
export function doctorHostInstallations(
  options: HostInstallationDoctorOptions = {}
): HostInstallationDoctorReport {
  const home = options.home ?? homedir();
  const version = options.version ?? currentCliVersion();
  const repair = options.repair === true;
  const dryRun = options.dryRun === true;
  const runner = options.runHostCommand ?? defaultHostCommand;
  const writeMarker = options.writeRepairMarker ?? ((path: string, content: string) => writeFileSync(path, content));
  const mutable = repair
    ? [
      repairClaude(home, version, runner, writeMarker, dryRun, options.testClaudePluginUninstalls ?? [], options.testConfigurationWrite),
      repairCodex(home, version, runner, writeMarker, dryRun, options.testConfigurationWrite)
    ]
    : [inspectClaude(home, version), inspectCodex(home, version)];
  const hosts = mutable.map(freezeReport);
  return {
    ok: hosts.every((host) => host.ok),
    repair,
    dryRun,
    sessionFreshnessGuarantee: HOST_REPAIR_FRESHNESS_GUARANTEE,
    version,
    hosts
  };
}

/**
 * A host repair cannot rewire an already-open stdio connection. A recorded
 * repair marker is authoritative for our repairs. Doctor does not infer the
 * complete runtime load graph, so externally modified artifacts are diagnostic
 * only and never become a live-session freshness verdict.
 */
export function findLiveSessionsPredatingHostConfig(
  sessions: readonly H2ASession[],
  hosts: readonly HostInstallationReport[]
): LiveHostSessionFinding[] {
  const byHost = new Map(hosts.map((host) => [host.host, host]));
  const findings: LiveHostSessionFinding[] = [];
  for (const session of sessions) {
    const host = session.host === "claude" || session.host === "codex" ? session.host : undefined;
    if (!host) continue;
    const report = byHost.get(host);
    if (!report) continue;
    const startedAt = Date.parse(session.startedAt);
    if (!Number.isFinite(startedAt)) {
      findings.push({
        host,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        configPath: report.repairMarkerPath,
        message:
          `cannot verify when live ${host} session ${session.sessionId} started; ` +
          "its temporal order relative to host repairs is unknown and it must be restarted."
      });
      continue;
    }
    const marker = report.repairMarker;
    if (!marker) {
      const markerState = existsSync(report.repairMarkerPath) ? "unavailable" : "missing";
      findings.push({
        host,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        configPath: report.repairMarkerPath,
        message:
          `cannot verify host repair marker ${report.repairMarkerPath}: it is ${markerState}; ` +
          `live ${host} session ${session.sessionId} must be restarted.`
      });
      continue;
    }
    const repairedAt = Date.parse(marker.repairedAt);
    if (!Number.isFinite(repairedAt)) {
      findings.push({
        host,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        configPath: marker.path,
        message: `cannot verify host repair marker ${marker.path}; live ${host} session ${session.sessionId} must be restarted.`
      });
      continue;
    }
    if (startedAt < repairedAt) {
      findings.push({
        host,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        configPath: marker.path,
        message:
          `live ${host} session ${session.sessionId} started before repair marker ${marker.path}; ` +
          "it may still run the pre-repair H2A/Track MCP set and must be restarted."
      });
      continue;
    }
  }
  return findings;
}
