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
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
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

function isDirectH2aMcp(name: string | undefined, table: TomlTable): boolean {
  if (name && /^h2a(?:[-_.]|$)/i.test(name)) return true;
  const command = tomlValue(table, "command");
  const args = tomlValue(table, "args") ?? "";
  return command === "h2a" && /(?:^|[\"\s,])mcp-serve(?:[\"\s,]|$)/.test(args);
}

function isDirectTrackMcp(table: TomlTable): boolean {
  const command = tomlValue(table, "command") ?? "";
  const args = tomlValue(table, "args") ?? "";
  return command === "track-mcp" || /(?:^|[\\/])track-mcp(?:\.cmd|\.exe)?$/i.test(command) || /track-mcp/.test(args);
}

function marketplaceManifestExists(location: string): boolean {
  return existsSync(join(location, ".claude-plugin", "marketplace.json"));
}

function canonicalMarketplace(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const source = value.source;
  return (
    isPlainObject(source) &&
    source.source === "github" &&
    source.repo === H2A_MARKETPLACE_REPOSITORY &&
    typeof value.installLocation === "string" &&
    marketplaceManifestExists(value.installLocation)
  );
}

function canonicalCodexMarketplace(table: TomlTable | undefined, home: string): boolean {
  return Boolean(
    canonicalCodexMarketplaceConfig(table) &&
      marketplaceManifestExists(join(home, ".codex", ".tmp", "marketplaces", H2A_MARKETPLACE_NAME))
  );
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

function claudeConfigPaths(home: string): string[] {
  return [join(home, ".claude.json"), join(home, ".config", "claude", "mcp.json")].filter(existsSync);
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
    .map((table) => tomlQuotedName(table.header, "plugins"))
    .filter(isLegacyH2aPlugin);
  if (stalePlugins.length > 0) {
    report.findings.push(finding("plugin-stale", `Codex has stale H2A plugin entries: ${stalePlugins.join(", ")}.`, configPath));
  }
  const versions = codexCacheVersions(home);
  if (!versions.includes(version) || !cacheVersionMatches(currentCachePath, version)) {
    report.findings.push(finding("version-skew", `Codex h2a cache is not at npm CLI version ${version}.`, cachePath));
  }
  const staleVersions = versions.filter((entry) => entry !== version);
  const legacyCaches = listDirectories(cachePath).filter(isLegacySentropicName);
  if (staleVersions.length > 0 || legacyCaches.length > 0) {
    report.findings.push(finding("orphan-cache", `Codex has orphan H2A cache directories: ${[...staleVersions, ...legacyCaches].join(", ")}.`, cachePath));
  }
  const mcp = tables.filter((table) => tomlQuotedName(table.header, "mcp_servers") !== undefined);
  const directH2a = mcp.filter((table) => isDirectH2aMcp(tomlQuotedName(table.header, "mcp_servers"), table));
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
  if (known.error) {
    report.findings.push(finding("config-invalid", `cannot parse Claude marketplace state: ${known.error}`, knownPath));
  } else if (!canonicalMarketplace(known.value?.[H2A_MARKETPLACE_NAME])) {
    report.findings.push(finding("marketplace-missing", "Claude lacks the canonical sentropic Git marketplace.", knownPath));
  }
  const staleMarketplaces = Object.keys(known.value ?? {}).filter(isLegacySentropicName);
  if (staleMarketplaces.length > 0) {
    report.findings.push(finding("marketplace-stale", `Claude has stale Sentropic marketplaces: ${staleMarketplaces.join(", ")}.`, knownPath));
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
  const stalePlugins = Object.keys(plugins).filter((name) => isLegacyH2aPlugin(name) || /^track@sentropic$/i.test(name));
  if (stalePlugins.length > 0) {
    report.findings.push(finding("plugin-stale", `Claude has stale Sentropic plugin entries: ${stalePlugins.join(", ")}.`, installedPath));
  }
  const cacheVersions = claudeCacheVersions(home);
  const cacheRoot = join(home, ".claude", "plugins", "cache");
  const staleVersions = cacheVersions.filter((entry) => entry !== version);
  const legacyCaches = listDirectories(cacheRoot).filter(isLegacySentropicName);
  if (staleVersions.length > 0 || legacyCaches.length > 0) {
    report.findings.push(finding("orphan-cache", `Claude has orphan H2A cache directories: ${[...staleVersions, ...legacyCaches].join(", ")}.`, cacheRoot));
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
    for (const [name, entry] of Object.entries(servers)) {
      if (isH2aJsonMcp(name, entry)) directH2a++;
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

function isH2aJsonMcp(name: string, value: unknown): boolean {
  if (/^h2a(?:[-_.]|$)/i.test(name)) return true;
  if (!isPlainObject(value) || typeof value.command !== "string") return false;
  return (value.command === "h2a" || /[\\/]h2a(?:\.cmd|\.exe)?$/i.test(value.command)) && jsonArgs(value).includes("mcp-serve");
}

function isTrackJsonMcp(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.command !== "string") return false;
  return value.command === "track-mcp" || /[\\/]track-mcp(?:\.cmd|\.exe)?$/i.test(value.command) || jsonArgs(value).includes("track-mcp");
}

function repairCodexConfig(
  home: string,
  report: MutableHostReport,
  options: { readonly removeInvalidCanonicalMarketplace: boolean; readonly dryRun: boolean }
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
  const needsConfigRepair = tables.some((table) => {
    const marketplace = tomlQuotedName(table.header, "marketplaces");
    if (isLegacySentropicName(marketplace)) return true;
    if (marketplace === H2A_MARKETPLACE_NAME && options.removeInvalidCanonicalMarketplace) return true;
    const plugin = tomlQuotedName(table.header, "plugins");
    if (isLegacyH2aPlugin(plugin)) return true;
    const mcp = tomlQuotedName(table.header, "mcp_servers");
    return mcp !== undefined && (isDirectH2aMcp(mcp, table) || isDirectTrackMcp(table));
  }) || tomlBoolean(canonicalPlugin ?? { header: "", lines: [] }, "enabled") !== true;
  if (!needsConfigRepair) return;
  const next = rewriteTomlTables(raw, (table) => {
    const marketplace = tomlQuotedName(table.header, "marketplaces");
    if (
      isLegacySentropicName(marketplace) ||
      (marketplace === H2A_MARKETPLACE_NAME && options.removeInvalidCanonicalMarketplace)
    ) return undefined;
    const plugin = tomlQuotedName(table.header, "plugins");
    if (plugin === H2A_PLUGIN_SELECTOR || isLegacyH2aPlugin(plugin)) return undefined;
    const mcp = tomlQuotedName(table.header, "mcp_servers");
    if (mcp !== undefined && (isDirectH2aMcp(mcp, table) || isDirectTrackMcp(table))) return undefined;
    return table.lines;
  });
  const rendered = [
    next.trimEnd(),
    "",
    ...tomlTable(`plugins.\"${H2A_PLUGIN_SELECTOR}\"`, ["enabled = true"])
  ].join("\n").replace(/^\n+/, "");
  if (rendered === raw) return;
  if (options.dryRun) {
    planAction(report, `rewrite ${path}`);
    return;
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, rendered.endsWith("\n") ? rendered : `${rendered}\n`);
    pushUnique(report.changed, path);
  } catch (error) {
    report.unrepaired.push(finding("config-invalid", `cannot write Codex config: ${(error as Error).message}`, path));
  }
}

function repairClaudeMcpConfigs(home: string, report: MutableHostReport, dryRun: boolean): void {
  for (const path of claudeConfigPaths(home)) {
    const config = readJson(path);
    if (config.error) {
      report.unrepaired.push(finding("config-invalid", `cannot parse Claude MCP config for repair: ${config.error}`, path));
      continue;
    }
    const original = config.value ?? {};
    const servers = isPlainObject(original.mcpServers) ? original.mcpServers : {};
    const retained = Object.fromEntries(
      Object.entries(servers).filter(([name, entry]) => !isH2aJsonMcp(name, entry) && !isTrackJsonMcp(entry))
    );
    if (Object.keys(retained).length === Object.keys(servers).length) continue;
    if (dryRun) {
      planAction(report, `rewrite ${path}`);
      continue;
    }
    const error = writeJson(path, { ...original, mcpServers: retained });
    if (error) report.unrepaired.push(finding("config-invalid", `cannot write Claude MCP config: ${error}`, path));
    else pushUnique(report.changed, path);
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

function repairCodex(
  home: string,
  version: string,
  runner: HostCommandRunner,
  writeMarker: (path: string, content: string) => void,
  dryRun: boolean
): MutableHostReport {
  const before = inspectCodex(home, version);
  const beforeArtifacts = artifactSnapshots(before.coherencePaths);
  // A vanished local marketplace is a distinct recovery case. Codex reports
  // `plugin marketplace upgrade` success with "No configured Git marketplaces
  // to upgrade", leaving the dead source and its cached plugin untouched.
  // Remove the local entry first, then require a fresh native Git `add`; never
  // treat that no-op upgrade exit status as evidence of repair.
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
  repairCodexConfig(home, before, { removeInvalidCanonicalMarketplace: sourceRecovery, dryRun });
  if (before.unrepaired.some((entry) => entry.code === "config-invalid")) {
    return combineAfterRepair(before, inspectCodex(home, version));
  }
  const needsPlugin = before.findings.some((entry) =>
    ["marketplace-missing", "marketplace-stale", "plugin-missing", "plugin-stale", "version-skew"].includes(entry.code)
  );
  if (sourceRecovery) {
    runCommand(before, runner, "codex", [
      "plugin",
      "marketplace",
      "add",
      H2A_MARKETPLACE_REPOSITORY,
      "--ref",
      "main"
    ], dryRun);
  } else if (needsPlugin) {
    runCommand(before, runner, "codex", ["plugin", "marketplace", "upgrade"], dryRun);
  }
  if (needsPlugin) {
    runCommand(before, runner, "codex", ["plugin", "add", H2A_PLUGIN_SELECTOR], dryRun);
  }
  const cache = join(home, ".codex", "plugins", "cache");
  if (cacheVersionMatches(join(home, ".codex", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a", version), version)) {
    for (const stale of codexCacheVersions(home).filter((entry) => entry !== version)) {
      const path = join(cache, H2A_MARKETPLACE_NAME, "h2a", stale);
      if (dryRun) { planAction(before, `remove ${path}`); continue; }
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
    }
    for (const legacy of listDirectories(cache).filter(isLegacySentropicName)) {
      const path = join(cache, legacy);
      if (dryRun) { planAction(before, `remove ${path}`); continue; }
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
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
  testClaudePluginUninstalls: readonly string[]
): MutableHostReport {
  const before = inspectClaude(home, version);
  const beforeArtifacts = artifactSnapshots(before.coherencePaths);
  repairClaudeMcpConfigs(home, before, dryRun);
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  const known = readJson(knownPath).value ?? {};
  const installed = readJson(installedPath).value ?? {};
  for (const marketplace of Object.keys(known).filter(isLegacySentropicName)) {
    runCommand(before, runner, "claude", ["plugin", "marketplace", "remove", marketplace], dryRun);
  }
  const plugins = isPlainObject(installed.plugins) ? installed.plugins : {};
  for (const plugin of Object.keys(plugins).filter((name) => isLegacyH2aPlugin(name) || /^track@sentropic$/i.test(name))) {
    runCommand(before, runner, "claude", ["plugin", "uninstall", plugin], dryRun);
  }
  for (const plugin of testClaudePluginUninstalls) {
    runCommand(before, runner, "claude", ["plugin", "uninstall", plugin], dryRun);
  }
  if (before.findings.some((entry) => ["marketplace-missing", "marketplace-stale"].includes(entry.code))) {
    runCommand(before, runner, "claude", ["plugin", "marketplace", "add", H2A_MARKETPLACE_REPOSITORY], dryRun);
  }
  const canonical = h2aPluginEntries(plugins[H2A_PLUGIN_SELECTOR]);
  const action = canonical.length === 0 ? "install" : "update";
  if (before.findings.some((entry) => ["plugin-missing", "version-skew", "plugin-stale"].includes(entry.code))) {
    runCommand(before, runner, "claude", ["plugin", action, H2A_PLUGIN_SELECTOR], dryRun);
  }
  const cache = join(home, ".claude", "plugins", "cache");
  if (cacheVersionMatches(join(home, ".claude", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a", version), version)) {
    for (const stale of claudeCacheVersions(home).filter((entry) => entry !== version)) {
      const path = join(cache, H2A_MARKETPLACE_NAME, "h2a", stale);
      if (dryRun) { planAction(before, `remove ${path}`); continue; }
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
    }
    for (const legacy of listDirectories(cache).filter(isLegacySentropicName)) {
      const path = join(cache, legacy);
      if (dryRun) { planAction(before, `remove ${path}`); continue; }
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
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
  const unrepaired = [...before.unrepaired, ...after.findings];
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
    ok: report.unrepaired.length === 0 && report.findings.length === 0,
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
      repairClaude(home, version, runner, writeMarker, dryRun, options.testClaudePluginUninstalls ?? []),
      repairCodex(home, version, runner, writeMarker, dryRun)
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
