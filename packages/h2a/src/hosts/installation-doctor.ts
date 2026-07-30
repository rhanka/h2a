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
    | "host-command-failed";
  readonly message: string;
  readonly path?: string;
}

export interface HostInstallationReport {
  readonly host: Host;
  readonly ok: boolean;
  readonly findings: readonly HostInstallationFinding[];
  readonly changed: readonly string[];
  readonly unrepaired: readonly HostInstallationFinding[];
  /** Paths whose mtime establishes whether a live session predates this state. */
  readonly coherencePaths: readonly string[];
}

export interface HostInstallationDoctorReport {
  readonly ok: boolean;
  readonly repair: boolean;
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
  changed: string[];
  unrepaired: HostInstallationFinding[];
  coherencePaths: string[];
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
  return Boolean(name && (/^h2a-local-/i.test(name) || /@sentropic-local-/i.test(name)));
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

function inspectCodex(home: string, version: string): MutableHostReport {
  const configPath = codexConfigPath(home);
  const cachePath = join(home, ".codex", "plugins", "cache");
  const pluginCachePath = join(cachePath, H2A_MARKETPLACE_NAME, "h2a");
  const currentCachePath = join(pluginCachePath, version);
  const marketplacePath = join(home, ".codex", ".tmp", "marketplaces", H2A_MARKETPLACE_NAME);
  const report: MutableHostReport = {
    host: "codex",
    findings: [],
    changed: [],
    unrepaired: [],
    // A live Codex session can keep code loaded from its plugin cache even
    // when config.toml itself is unchanged. Keep the durable cache, plugin,
    // and marketplace artifacts in the freshness proof as well as config.
    coherencePaths: [configPath, cachePath, pluginCachePath, currentCachePath, marketplacePath]
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
    report.findings.push(finding(
      "marketplace-missing",
      "Codex lacks the canonical sentropic Git marketplace; an enabled h2a MCP/plugin cache alone is an orphaned false-healthy signal.",
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
  return report;
}

function inspectClaude(home: string, version: string): MutableHostReport {
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  const report: MutableHostReport = {
    host: "claude",
    findings: [],
    changed: [],
    unrepaired: [],
    coherencePaths: [knownPath, installedPath, ...claudeConfigPaths(home)]
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
  options: { readonly removeInvalidCanonicalMarketplace: boolean }
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
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, rendered.endsWith("\n") ? rendered : `${rendered}\n`);
    pushUnique(report.changed, path);
  } catch (error) {
    report.unrepaired.push(finding("config-invalid", `cannot write Codex config: ${(error as Error).message}`, path));
  }
}

function repairClaudeMcpConfigs(home: string, report: MutableHostReport): void {
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
    const error = writeJson(path, { ...original, mcpServers: retained });
    if (error) report.unrepaired.push(finding("config-invalid", `cannot write Claude MCP config: ${error}`, path));
    else pushUnique(report.changed, path);
  }
}

function runCommand(
  report: MutableHostReport,
  runner: HostCommandRunner,
  command: "claude" | "codex",
  args: readonly string[]
): boolean {
  const result = runner(command, args);
  if (result.ok) return true;
  report.unrepaired.push(
    finding("host-command-failed", `${command} ${args.join(" ")} failed: ${result.message ?? "unknown error"}`)
  );
  return false;
}

function repairCodex(home: string, version: string, runner: HostCommandRunner): MutableHostReport {
  const before = inspectCodex(home, version);
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
  repairCodexConfig(home, before, { removeInvalidCanonicalMarketplace: sourceRecovery });
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
    ]);
  } else if (needsPlugin) {
    runCommand(before, runner, "codex", ["plugin", "marketplace", "upgrade"]);
  }
  if (needsPlugin) {
    runCommand(before, runner, "codex", ["plugin", "add", H2A_PLUGIN_SELECTOR]);
  }
  const cache = join(home, ".codex", "plugins", "cache");
  if (cacheVersionMatches(join(home, ".codex", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a", version), version)) {
    for (const stale of codexCacheVersions(home).filter((entry) => entry !== version)) {
      const path = join(cache, H2A_MARKETPLACE_NAME, "h2a", stale);
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
    }
    for (const legacy of listDirectories(cache).filter(isLegacySentropicName)) {
      const path = join(cache, legacy);
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
    }
  }
  return combineAfterRepair(before, inspectCodex(home, version));
}

function repairClaude(home: string, version: string, runner: HostCommandRunner): MutableHostReport {
  const before = inspectClaude(home, version);
  repairClaudeMcpConfigs(home, before);
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  const known = readJson(knownPath).value ?? {};
  const installed = readJson(installedPath).value ?? {};
  for (const marketplace of Object.keys(known).filter(isLegacySentropicName)) {
    runCommand(before, runner, "claude", ["plugin", "marketplace", "remove", marketplace]);
  }
  const plugins = isPlainObject(installed.plugins) ? installed.plugins : {};
  for (const plugin of Object.keys(plugins).filter((name) => isLegacyH2aPlugin(name) || /^track@sentropic$/i.test(name))) {
    runCommand(before, runner, "claude", ["plugin", "uninstall", plugin]);
  }
  if (before.findings.some((entry) => ["marketplace-missing", "marketplace-stale"].includes(entry.code))) {
    runCommand(before, runner, "claude", ["plugin", "marketplace", "add", H2A_MARKETPLACE_REPOSITORY]);
  }
  const canonical = h2aPluginEntries(plugins[H2A_PLUGIN_SELECTOR]);
  const action = canonical.length === 0 ? "install" : "update";
  if (before.findings.some((entry) => ["plugin-missing", "version-skew", "plugin-stale"].includes(entry.code))) {
    runCommand(before, runner, "claude", ["plugin", action, H2A_PLUGIN_SELECTOR]);
  }
  const cache = join(home, ".claude", "plugins", "cache");
  if (cacheVersionMatches(join(home, ".claude", "plugins", "cache", H2A_MARKETPLACE_NAME, "h2a", version), version)) {
    for (const stale of claudeCacheVersions(home).filter((entry) => entry !== version)) {
      const path = join(cache, H2A_MARKETPLACE_NAME, "h2a", stale);
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
    }
    for (const legacy of listDirectories(cache).filter(isLegacySentropicName)) {
      const path = join(cache, legacy);
      try { rmSync(path, { recursive: true, force: true }); pushUnique(before.changed, path); }
      catch (error) { before.unrepaired.push(finding("orphan-cache", `cannot remove ${path}: ${(error as Error).message}`, path)); }
    }
  }
  return combineAfterRepair(before, inspectClaude(home, version));
}

function combineAfterRepair(before: MutableHostReport, after: MutableHostReport): MutableHostReport {
  const unrepaired = [...before.unrepaired, ...after.findings];
  return {
    ...after,
    changed: before.changed,
    unrepaired,
    coherencePaths: [...new Set([...before.coherencePaths, ...after.coherencePaths])]
  };
}

function freezeReport(report: MutableHostReport): HostInstallationReport {
  return {
    host: report.host,
    ok: report.unrepaired.length === 0 && report.findings.length === 0,
    findings: report.findings,
    changed: report.changed,
    unrepaired: report.unrepaired,
    coherencePaths: report.coherencePaths
  };
}

/** Inspect, and optionally repair, the H2A installation state of both supported hosts. */
export function doctorHostInstallations(
  options: HostInstallationDoctorOptions = {}
): HostInstallationDoctorReport {
  const home = options.home ?? homedir();
  const version = options.version ?? currentCliVersion();
  const repair = options.repair === true;
  const runner = options.runHostCommand ?? defaultHostCommand;
  const mutable = repair
    ? [repairClaude(home, version, runner), repairCodex(home, version, runner)]
    : [inspectClaude(home, version), inspectCodex(home, version)];
  const hosts = mutable.map(freezeReport);
  return { ok: hosts.every((host) => host.ok), repair, version, hosts };
}

/**
 * A config repair cannot rewire an already-open stdio connection. If a live
 * local H2A session predates the relevant host config, doctor must explicitly
 * require a restart instead of certifying the running session as clean.
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
    if (!Number.isFinite(startedAt)) continue;
    for (const path of report.coherencePaths) {
      try {
        if (statSync(path).mtimeMs > startedAt) {
          findings.push({
            host,
            sessionId: session.sessionId,
            startedAt: session.startedAt,
            configPath: path,
            message:
              `live ${host} session ${session.sessionId} started before ${path} changed; ` +
              "it may still run the pre-repair H2A/Track MCP set and must be restarted."
          });
          break;
        }
      } catch {
        // A missing path has no timestamp to compare. The host report already
        // carries the missing/invalid configuration as an unrepaired finding.
      }
    }
  }
  return findings;
}
