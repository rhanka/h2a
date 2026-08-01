import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  doctorHostInstallations as productionDoctorHostInstallations,
  findLiveSessionsPredatingHostConfig,
  H2A_CLI_VERB_CONTRACTS,
  runCli,
  writePresence
} from "../dist/index.js";

const VERSION = "9.8.7";
const fixtureHostCliReachable = () => true;

// Fixtures model installed hosts; presence is an explicit test input rather
// than a fact inherited from the developer or CI runner PATH.
function doctorHostInstallations(options = {}) {
  return productionDoctorHostInstallations({ testHostCliReachable: fixtureHostCliReachable, ...options });
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function currentPlugin(path, version = VERSION) {
  mkdirSync(join(path, ".codex-plugin"), { recursive: true });
  writeJson(join(path, ".codex-plugin", "plugin.json"), { name: "h2a", version });
}

function currentMarketplace(path) {
  writeJson(join(path, ".claude-plugin", "marketplace.json"), {
    name: "sentropic",
    plugins: [{ name: "h2a", source: "./packages/h2a" }]
  });
}

function readShippedJson(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
}

function copyShippedFile(source, destination) {
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, readFileSync(new URL(`../${source}`, import.meta.url)));
}

function cleanShippedLayoutHome() {
  const home = join(tmpdir(), `h2a-host-doctor-shipped-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const version = readShippedJson(".codex-plugin/plugin.json").version;
  const codexPluginPath = join(home, ".codex", "plugins", "cache", "sentropic", "h2a", version);
  const claudePluginPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", version);

  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "config.toml"),
    [
      '[plugins."h2a@sentropic"]',
      "enabled = true",
      "",
      "[marketplaces.sentropic]",
      'source_type = "git"',
      'source = "https://github.com/rhanka/h2a.git"',
      'ref = "main"',
      ""
    ].join("\n")
  );
  copyShippedFile(".codex-plugin/plugin.json", join(codexPluginPath, ".codex-plugin", "plugin.json"));
  copyShippedFile(".mcp.json", join(codexPluginPath, ".mcp.json"));
  currentMarketplace(join(home, ".codex", ".tmp", "marketplaces", "sentropic"));

  copyShippedFile(".claude-plugin/plugin.json", join(claudePluginPath, ".claude-plugin", "plugin.json"));
  writeJson(join(home, ".claude", "plugins", "known_marketplaces.json"), {
    sentropic: {
      source: { source: "github", repo: "rhanka/h2a" },
      installLocation: join(home, ".claude", "plugins", "marketplaces", "sentropic")
    }
  });
  currentMarketplace(join(home, ".claude", "plugins", "marketplaces", "sentropic"));
  writeJson(join(home, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "h2a@sentropic": [{ scope: "user", installPath: claudePluginPath, version }]
    }
  });
  return { home, version };
}

function configurationRewriteFixture() {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const claudePath = join(home, ".claude.json");
  const claudeMcpPath = join(home, ".config", "claude", "mcp.json");
  const codex = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n[mcp_servers.h2a]\ncommand = "h2a"\nargs = ["mcp-serve"]\n`;
  const claude = '{"mcpServers":{"h2a":{"command":"h2a","args":["mcp-serve"]}},"scope":"user"}\n';
  const claudeMcp = '{"mcpServers":{"track":{"command":"h2a","args":["track-mcp"]}},"scope":"project"}\n';
  writeFileSync(codexPath, codex);
  writeFileSync(claudePath, claude);
  mkdirSync(join(claudeMcpPath, ".."), { recursive: true });
  writeFileSync(claudeMcpPath, claudeMcp);
  return {
    home,
    version,
    paths: [codexPath, claudePath, claudeMcpPath],
    original: new Map([[codexPath, codex], [claudePath, claude], [claudeMcpPath, claudeMcp]])
  };
}

function fixtureHome() {
  const home = join(tmpdir(), `h2a-host-doctor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const codex = join(home, ".codex");
  const claude = join(home, ".claude");
  const codexLegacyMarketplacePath = join(codex, ".tmp", "marketplaces", "sentropic-local-codex-08518");
  const claudeLegacyMarketplacePath = join(claude, "plugins", "marketplaces", "sentropic-local-claude-08518");
  mkdirSync(codex, { recursive: true });
  mkdirSync(claude, { recursive: true });
  writeFileSync(
    join(codex, "config.toml"),
    [
      '[plugins."h2a-local-codex-08518@sentropic-local-codex-08518"]',
      "enabled = true",
      "",
      '[plugins."h2a@sentropic"]',
      "enabled = true",
      "",
      "[mcp_servers.h2a]",
      'command = "h2a"',
      'args = ["mcp-serve"]',
      "",
      "[mcp_servers.track]",
      'command = "h2a"',
      'args = ["track-mcp"]',
      "",
      "[marketplaces.sentropic-local-codex-08518]",
      'source_type = "local"',
      `source = "${codexLegacyMarketplacePath}"`,
      ""
    ].join("\n")
  );
  // `codex mcp list` may still show this cached enabled plugin even though its
  // only marketplace is an obsolete local source. A current cache therefore
  // cannot certify the installation by itself.
  currentPlugin(join(codex, "plugins", "cache", "sentropic", "h2a", VERSION));
  currentPlugin(join(codex, "plugins", "cache", "sentropic-local-codex-08518", "h2a", "0.85.18"));
  currentMarketplace(codexLegacyMarketplacePath);

  const claudePluginPath = join(claude, "plugins", "cache", "sentropic", "h2a", "0.85.18");
  currentPlugin(claudePluginPath);
  currentPlugin(join(claude, "plugins", "cache", "sentropic-local-claude-08518", "h2a", "0.85.18"));
  currentMarketplace(claudeLegacyMarketplacePath);
  writeJson(join(claude, "plugins", "known_marketplaces.json"), {
    "sentropic-local-claude-08518": {
      source: { source: "directory", path: claudeLegacyMarketplacePath },
      installLocation: claudeLegacyMarketplacePath
    }
  });
  writeJson(join(claude, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "h2a@sentropic": [{ scope: "user", installPath: claudePluginPath, version: "0.85.18" }],
      "h2a-local-claude-08518@sentropic-local-claude-08518": [
        { scope: "user", installPath: join(claude, "plugins", "cache", "sentropic-local-claude-08518", "h2a", "0.85.18"), version: "0.85.18" }
      ]
    }
  });
  writeJson(join(home, ".config", "claude", "mcp.json"), {
    mcpServers: {
      h2a: { command: "h2a", args: ["mcp-serve"] },
      track: { command: "h2a", args: ["track-mcp"] },
      other: { command: "other-mcp", args: ["serve"] }
    }
  });
  return home;
}

function cacheVersionDriftHome() {
  const home = join(tmpdir(), `h2a-host-doctor-cache-drift-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const codex = join(home, ".codex");
  const configPath = join(codex, "config.toml");
  const claudePluginPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", VERSION);
  mkdirSync(codex, { recursive: true });
  writeFileSync(
    configPath,
    [
      '[plugins."h2a@sentropic"]',
      "enabled = true",
      "",
      "[marketplaces.sentropic]",
      'source_type = "git"',
      'source = "https://github.com/rhanka/h2a.git"',
      'ref = "main"',
      ""
    ].join("\n")
  );
  const beforeRepair = new Date("2000-01-01T00:00:00.000Z");
  utimesSync(configPath, beforeRepair, beforeRepair);
  currentPlugin(join(codex, "plugins", "cache", "sentropic", "h2a", "0.87.0"));
  const marketplacePath = join(codex, ".tmp", "marketplaces", "sentropic");
  currentMarketplace(marketplacePath);
  utimesSync(marketplacePath, beforeRepair, beforeRepair);
  currentPlugin(claudePluginPath);
  writeJson(join(home, ".claude", "plugins", "known_marketplaces.json"), {
    sentropic: { source: { source: "github", repo: "rhanka/h2a" } }
  });
  writeJson(join(home, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "h2a@sentropic": [{ scope: "user", installPath: claudePluginPath, version: VERSION }]
    }
  });
  return home;
}

function inPlaceCacheVersionDriftHome() {
  const home = join(tmpdir(), `h2a-host-doctor-in-place-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const codex = join(home, ".codex");
  const configPath = join(codex, "config.toml");
  const cacheRoot = join(codex, "plugins", "cache");
  const pluginRoot = join(cacheRoot, "sentropic", "h2a", VERSION);
  const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  const loadedCodePath = join(pluginRoot, "loaded-runtime.js");
  const marketplacePath = join(codex, ".tmp", "marketplaces", "sentropic");
  const beforeRepair = new Date("2000-01-01T00:00:00.000Z");
  mkdirSync(codex, { recursive: true });
  writeFileSync(
    configPath,
    [
      '[plugins."h2a@sentropic"]',
      "enabled = true",
      "",
      "[marketplaces.sentropic]",
      'source_type = "git"',
      'source = "https://github.com/rhanka/h2a.git"',
      'ref = "main"',
      ""
    ].join("\n")
  );
  currentPlugin(pluginRoot);
  writeJson(join(pluginRoot, ".mcp.json"), {
    mcpServers: { h2a: { command: "node", args: ["./loaded-runtime.js"] } }
  });
  writeJson(manifestPath, { name: "h2a", version: "0.87.0" });
  writeFileSync(loadedCodePath, "export const loadedVersion = '0.87.0';\n");
  currentMarketplace(marketplacePath);
  for (const path of [configPath, cacheRoot, join(cacheRoot, "sentropic"), join(cacheRoot, "sentropic", "h2a"), pluginRoot, marketplacePath, manifestPath, loadedCodePath]) {
    utimesSync(path, beforeRepair, beforeRepair);
  }
  setTreeTime(pluginRoot, beforeRepair);
  setTreeTime(marketplacePath, beforeRepair);

  const claudePluginPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", VERSION);
  const claudeMarketplacePath = join(home, ".claude", "plugins", "marketplaces", "sentropic");
  currentPlugin(claudePluginPath);
  currentMarketplace(claudeMarketplacePath);
  writeJson(join(home, ".claude", "plugins", "known_marketplaces.json"), {
    sentropic: {
      source: { source: "github", repo: "rhanka/h2a" },
      installLocation: claudeMarketplacePath
    }
  });
  writeJson(join(home, ".claude", "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "h2a@sentropic": [{ scope: "user", installPath: claudePluginPath, version: VERSION }]
    }
  });
  return { home, manifestPath, loadedCodePath };
}

function setTreeTime(path, time) {
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) setTreeTime(entryPath, time);
    else utimesSync(entryPath, time, time);
  }
  utimesSync(path, time, time);
}

function cleanCodexHomeWithoutMarker() {
  const { home, loadedCodePath } = inPlaceCacheVersionDriftHome();
  const pluginRoot = join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION);
  const old = new Date("2000-01-01T00:00:00.000Z");
  currentPlugin(pluginRoot);
  writeFileSync(loadedCodePath, "export const loadedVersion = '9.8.7';\n");
  for (const path of [
    join(home, ".codex", "config.toml"),
    pluginRoot,
    join(home, ".codex", ".tmp", "marketplaces", "sentropic")
  ]) {
    if (statSync(path).isDirectory()) setTreeTime(path, old);
    else utimesSync(path, old, old);
  }
  return { home, manifestPath: join(pluginRoot, ".codex-plugin", "plugin.json"), loadedCodePath };
}

function snapshotTree(path) {
  const entries = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) entries.push([entry.name, snapshotTree(entryPath)]);
    else entries.push([entry.name, readFileSync(entryPath, "utf8")]);
  }
  return entries;
}

function snapshotTreeBytes(path) {
  const entries = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) entries.push([entry.name, snapshotTreeBytes(entryPath)]);
    else entries.push([entry.name, readFileSync(entryPath)]);
  }
  return entries;
}

function repairRunner(home, calls, version = VERSION) {
  return (command, args) => {
    calls.push([command, ...args]);
    if (command === "codex") {
      if (args.join(" ") === "plugin marketplace add rhanka/h2a --ref main") {
        const configPath = join(home, ".codex", "config.toml");
        writeFileSync(
          configPath,
          `${readFileSync(configPath, "utf8").trimEnd()}\n\n[marketplaces.sentropic]\nsource_type = "git"\nsource = "https://github.com/rhanka/h2a.git"\nref = "main"\n`
        );
      }
      currentPlugin(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", version), version);
      currentMarketplace(join(home, ".codex", ".tmp", "marketplaces", "sentropic"));
      return { ok: true };
    }
    const pluginPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", version);
    currentPlugin(pluginPath, version);
    const marketplacePath = join(home, ".claude", "plugins", "marketplaces", "sentropic");
    currentMarketplace(marketplacePath);
    writeJson(join(home, ".claude", "plugins", "known_marketplaces.json"), {
      sentropic: {
        source: { source: "github", repo: "rhanka/h2a" },
        installLocation: marketplacePath
      }
    });
    writeJson(join(home, ".claude", "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: {
        "h2a@sentropic": [{ scope: "user", installPath: pluginPath, version }]
      }
    });
    return { ok: true };
  };
}

function repairRunnerWithoutCodexConfigRewrite(home, calls, version = VERSION) {
  const base = repairRunner(home, calls, version);
  return (command, args) => {
    if (command !== "codex") return base(command, args);
    calls.push([command, ...args]);
    currentPlugin(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", version), version);
    currentMarketplace(join(home, ".codex", ".tmp", "marketplaces", "sentropic"));
    return { ok: true };
  };
}

function inPlaceRepairRunner(home, calls) {
  const base = repairRunner(home, calls);
  return (command, args) => {
    if (command !== "codex") return base(command, args);
    calls.push([command, ...args]);
    const pluginRoot = join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION);
    writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), { name: "h2a", version: VERSION });
    writeFileSync(join(pluginRoot, "loaded-runtime.js"), "export const loadedVersion = '9.8.7';\n");
    return { ok: true };
  };
}

function streams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

function writeLiveCodexSession(root, sessionId, startedAt = "2020-01-01T00:00:00.000Z") {
  writePresence(root, {
    sessionId,
    instance: "codex:plugins:123456789abc",
    host: "codex",
    startedAt,
    heartbeatAt: new Date().toISOString(),
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: []
  });
}

function writeRepairMarker(home, repairedPaths, repairedAt = "2010-01-01T00:00:00.000Z") {
  writeJson(join(home, ".codex", "h2a-repair.json"), { repairedAt, repairedPaths });
}

function runRepairDoctor(home, root, options = {}) {
  const io = streams(home);
  const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
    doctorHostInstallations: () => doctorHostInstallations({ home, version: VERSION, repair: true, ...options })
  });
  return { exitCode, io, report: JSON.parse(io.stdoutText) };
}

function runRepairDoctorWithActualHostPresence(home, root, options = {}) {
  const io = streams(home);
  const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
    doctorHostInstallations: () => productionDoctorHostInstallations({ home, version: VERSION, repair: true, ...options })
  });
  return { exitCode, io, report: JSON.parse(io.stdoutText) };
}

function withoutHostCliOnPath(home, callback) {
  const previousPath = process.env.PATH;
  const previousClaudeRoot = process.env.CLAUDE_CONFIG_DIR;
  const previousCodexRoot = process.env.CODEX_HOME;
  const emptyBin = join(home, "no-host-cli-bin");
  mkdirSync(emptyBin, { recursive: true });
  process.env.PATH = emptyBin;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CODEX_HOME;
  try {
    return callback();
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousClaudeRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeRoot;
    if (previousCodexRoot === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexRoot;
  }
}

test("doctor treats unused hosts absent from PATH as informational", () => {
  const home = join(tmpdir(), `h2a-host-doctor-absent-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = withoutHostCliOnPath(home, () => runRepairDoctorWithActualHostPresence(home, root));

    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    for (const host of report.checks.hostInstallations.hosts) {
      assert.equal(host.ok, true, JSON.stringify(host, null, 2));
      assert.ok(host.findings.some((entry) => entry.code === "host-not-installed"), JSON.stringify(host, null, 2));
      for (const code of ["marketplace-missing", "version-skew", "plugin-missing", "h2a-endpoint-count"]) {
        assert.equal(host.findings.some((entry) => entry.code === code), false, JSON.stringify(host, null, 2));
      }
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports a configured broken host when its CLI is absent from PATH", () => {
  const home = join(tmpdir(), `h2a-host-doctor-unreachable-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const root = join(home, "bus");
  const calls = [];
  try {
    writeJson(join(home, ".claude.json"), { mcpServers: {} });
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const result = withoutHostCliOnPath(home, () => {
      const io = streams(home);
      const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
        doctorHostInstallations: () => productionDoctorHostInstallations({
          home,
          version: VERSION,
          repair: true,
          testHostCliReachable: () => false,
          runHostCommand: (command, args) => {
            calls.push([command, ...args]);
            return { ok: true };
          }
        })
      });
      return { exitCode, io, report: JSON.parse(io.stdoutText) };
    });
    const claude = result.report.checks.hostInstallations.hosts.find((host) => host.host === "claude");

    assert.equal(result.exitCode, 2, result.io.stderrText);
    assert.equal(result.report.ok, false, JSON.stringify(result.report, null, 2));
    assert.match(claude?.diagnostics.find((entry) => entry.code === "host-cli-unreachable")?.message ?? "", /Claude CLI could not be reached/);
    assert.deepEqual(calls, [], "an unreachable configured host must not receive native repair commands");
    assert.ok(claude?.findings.some((entry) => entry.code === "plugin-missing"), JSON.stringify(claude, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor treats an empty PATH segment as the current directory", () => {
  const home = join(tmpdir(), `h2a-host-doctor-empty-path-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const previousPath = process.env.PATH;
  const previousCwd = process.cwd();
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "codex"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(home, "codex"), 0o755);
    process.chdir(home);
    process.env.PATH = ":";

    const report = productionDoctorHostInstallations({ home, version: VERSION });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(codex?.findings.some((entry) => entry.code === "host-not-installed"), false, JSON.stringify(codex, null, 2));
    assert.equal(codex?.diagnostics.some((entry) => entry.code === "host-cli-unreachable"), false, JSON.stringify(codex, null, 2));
  } finally {
    process.chdir(previousCwd);
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when configured roots are broken symlinks", () => {
  const home = join(tmpdir(), `h2a-host-doctor-broken-root-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    symlinkSync(join(home, "missing-claude-root"), join(home, ".claude"));
    symlinkSync(join(home, "missing-codex-root"), join(home, ".codex"));
    const { exitCode, io, report } = withoutHostCliOnPath(home, () => runRepairDoctorWithActualHostPresence(home, root));

    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    for (const host of report.checks.hostInstallations.hosts) {
      assert.equal(host.findings.some((entry) => entry.code === "host-not-installed"), false, JSON.stringify(host, null, 2));
      assert.ok(host.findings.some((entry) => entry.code === "host-config-unavailable"), JSON.stringify(host, null, 2));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports a broken Claude settings symlink as unavailable", () => {
  const { home } = cleanShippedLayoutHome();
  const settingsPath = join(home, ".claude", "settings.json");
  const root = join(home, "bus");
  try {
    symlinkSync(join(home, "missing-settings.json"), settingsPath);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, []) });
    const claude = report.checks.hostInstallations.hosts.find((host) => host.host === "claude");

    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(claude?.ok, false, JSON.stringify(claude, null, 2));
    assert.ok(
      claude?.findings.some((entry) => entry.code === "host-config-unavailable" && entry.path === settingsPath),
      JSON.stringify(claude, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when an explicitly configured host root is inaccessible", () => {
  const home = join(tmpdir(), `h2a-host-doctor-inaccessible-root-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const parent = join(home, "inaccessible-parent");
  const configuredRoot = join(parent, "codex");
  const previousCodexRoot = process.env.CODEX_HOME;
  let restricted = false;
  try {
    mkdirSync(configuredRoot, { recursive: true });
    chmodSync(parent, 0o000);
    restricted = true;
    process.env.CODEX_HOME = configuredRoot;
    const report = productionDoctorHostInstallations({ home, version: VERSION, repair: true, testHostCliReachable: () => false });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.equal(codex?.findings.some((entry) => entry.code === "host-not-installed"), false, JSON.stringify(codex, null, 2));
    assert.ok(codex?.findings.some((entry) => entry.code === "host-config-unavailable" && /EACCES/.test(entry.message)), JSON.stringify(codex, null, 2));
  } finally {
    if (previousCodexRoot === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexRoot;
    if (restricted) chmodSync(parent, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor treats an explicitly configured CODEX_HOME below a file as broken", () => {
  const home = join(tmpdir(), `h2a-host-doctor-declared-root-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const declaredParent = join(home, "not-a-directory");
  const declaredRoot = join(declaredParent, "codex");
  const previousPath = process.env.PATH;
  const previousCodexRoot = process.env.CODEX_HOME;
  const previousClaudeRoot = process.env.CLAUDE_CONFIG_DIR;
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(declaredParent, "not a directory\n");
    process.env.PATH = join(home, "empty-bin");
    process.env.CODEX_HOME = declaredRoot;
    delete process.env.CLAUDE_CONFIG_DIR;

    const report = productionDoctorHostInstallations({ home, version: VERSION, repair: true });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.equal(codex?.findings.some((entry) => entry.code === "host-not-installed"), false, JSON.stringify(codex, null, 2));
    assert.ok(
      codex?.findings.some((entry) => entry.code === "host-config-unavailable" && /CODEX_HOME.*ENOTDIR/.test(entry.message)),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCodexRoot === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexRoot;
    if (previousClaudeRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeRoot;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor treats an unreadable PATH probe as unavailable instead of absent", () => {
  const home = join(tmpdir(), `h2a-host-doctor-unreadable-path-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const inaccessibleBin = join(home, "inaccessible-bin");
  const previousPath = process.env.PATH;
  const previousCodexRoot = process.env.CODEX_HOME;
  const previousClaudeRoot = process.env.CLAUDE_CONFIG_DIR;
  let restricted = false;
  try {
    mkdirSync(inaccessibleBin, { recursive: true });
    writeFileSync(join(inaccessibleBin, "codex"), "#!/bin/sh\nexit 0\n");
    chmodSync(inaccessibleBin, 0o000);
    restricted = true;
    process.env.PATH = inaccessibleBin;
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;

    const report = productionDoctorHostInstallations({ home, version: VERSION, repair: true });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.equal(codex?.findings.some((entry) => entry.code === "host-not-installed"), false, JSON.stringify(codex, null, 2));
    assert.ok(
      codex?.findings.some((entry) => entry.code === "host-cli-unavailable" && /EACCES/.test(entry.message)),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    if (restricted) chmodSync(inaccessibleBin, 0o700);
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousCodexRoot === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexRoot;
    if (previousClaudeRoot === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeRoot;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor inspects a visible empty configured root even when its CLI is unavailable", () => {
  const home = join(tmpdir(), `h2a-host-doctor-empty-root-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const report = productionDoctorHostInstallations({ home, version: VERSION, repair: true, testHostCliReachable: () => false });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.deepEqual(
      codex?.findings.map((entry) => entry.code),
      ["marketplace-missing", "plugin-missing", "version-skew", "h2a-endpoint-count"],
      JSON.stringify(codex, null, 2)
    );
    assert.ok(codex?.unrepaired.some((entry) => entry.code === "host-command-unavailable"), JSON.stringify(codex, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repairs local endpoints when the native CLI is unavailable", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const calls = [];
  try {
    writeFileSync(
      codexPath,
      `${readFileSync(codexPath, "utf8").trimEnd()}\n\n[mcp_servers.local-h2a]\ncommand = "h2a"\nargs = ["mcp-serve"]\n`
    );
    const report = productionDoctorHostInstallations({
      home,
      version,
      repair: true,
      testHostCliReachable: () => false,
      runHostCommand: (command, args) => {
        calls.push([command, ...args]);
        throw new Error("native CLI must not be called");
      }
    });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(calls, []);
    assert.doesNotMatch(readFileSync(codexPath, "utf8"), /\[mcp_servers\.local-h2a\]/);
    assert.ok(codex?.diagnostics.some((entry) => entry.code === "host-cli-unreachable"), JSON.stringify(codex, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor names unreadable dotted Codex MCP keys instead of reporting a false clean state", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  try {
    const config =
      'mcp_servers.local-h2a.command = "h2a"\n' +
      'mcp_servers.local-h2a.args = ["mcp-serve"]\n\n' +
      readFileSync(codexPath, "utf8");
    writeFileSync(codexPath, config);

    const report = doctorHostInstallations({ home, version });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.ok(
      codex?.findings.some((entry) => entry.code === "config-invalid" && /mcp_servers\.local-h2a/.test(entry.message)),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor preserves a visible single-quoted local Codex marketplace", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const marketplace = "sentropic-local-single-quoted";
  const plugin = "h2a-local-single-quoted@sentropic-local-single-quoted";
  const source = join(home, "visible-single-quoted-marketplace");
  try {
    mkdirSync(source, { recursive: true });
    const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
      `[marketplaces.${marketplace}]\n` +
      "source_type = 'local'\n" +
      `source = '${source}'\n` +
      "private_metadata = 'must-remain-private'\n\n" +
      `[plugins."${plugin}"]\n` +
      "enabled = true\n";
    writeFileSync(codexPath, config);

    const report = doctorHostInstallations({ home, version, repair: true, runHostCommand: repairRunner(home, []) });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), config);
    assert.ok(codex?.unrepaired.some((entry) => entry.code === "ownership-unverified"), JSON.stringify(codex, null, 2));
    assert.match(readFileSync(codexPath, "utf8"), /private_metadata = 'must-remain-private'/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed for legacy local marketplace sources it cannot decode", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const tripleMarketplace = "sentropic-local-triple-quoted";
  const escapedMarketplace = "sentropic-local-escaped";
  const triplePlugin = "h2a-local-triple-quoted@sentropic-local-triple-quoted";
  const escapedPlugin = "h2a-local-escaped@sentropic-local-escaped";
  const tripleSource = join(home, "visible-triple-quoted-marketplace");
  const escapedSource = join(home, "visible-escaped-marketplace");
  try {
    mkdirSync(tripleSource, { recursive: true });
    mkdirSync(escapedSource, { recursive: true });
    const escapedTomlSource = escapedSource.replace("visible-escaped-marketplace", "visible\\u002Descaped\\u002Dmarketplace");
    const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
      `[marketplaces.${tripleMarketplace}]\n` +
      'source_type = "local"\n' +
      `source = '''${tripleSource}'''\n` +
      'private_metadata = "must-remain-triple-private"\n\n' +
      `[marketplaces.${escapedMarketplace}]\n` +
      'source_type = "local"\n' +
      `source = "${escapedTomlSource}"\n` +
      'private_metadata = "must-remain-escaped-private"\n\n' +
      `[plugins."${triplePlugin}"]\n` +
      "enabled = true\n\n" +
      `[plugins."${escapedPlugin}"]\n` +
      "enabled = true\n";
    writeFileSync(codexPath, config);

    const root = join(home, "bus");
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, []) });
    const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");

    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), config, "unreadable TOML must not authorize any rewrite");
    assert.ok(
      codex?.unrepaired.some((entry) => entry.code === "ownership-unverified"),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor preserves a legacy table whose multiline value contains a table-shaped line", () => {
  const { home } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const marketplace = "sentropic-local-multiline";
  const plugin = "h2a-local-multiline@sentropic-local-multiline";
  const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
    `[marketplaces.${marketplace}]\n` +
    'source_type = "local"\n' +
    `source = "${join(home, "deleted-multiline-marketplace")}"\n` +
    'private_metadata = """\n' +
    "before\n" +
    "[keep]\n" +
    "after\n" +
    '"""\n\n' +
    `[plugins."${plugin}"]\n` +
    "enabled = true\n";
  try {
    writeFileSync(codexPath, config);
    const root = join(home, "bus");
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, []) });
    const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");

    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), config, "multiline TOML must not authorize a table rewrite");
    assert.ok(
      codex?.unrepaired.some((entry) => entry.code === "ownership-unverified"),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repairs a framed legacy table while preserving and naming an opaque TOML array region", () => {
  const { home } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const marketplace = "sentropic-local-array";
  const missingSource = join(home, "deleted-array-marketplace");
  const privateRegion = "[[private.keep]]\n" +
    'token = "must-remain-private"\n';
  const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
    `[marketplaces.${marketplace}]\n` +
    'source_type = "local"\n' +
    `source = "${missingSource}"\n\n` +
    privateRegion;
  try {
    writeFileSync(codexPath, config);
    const root = join(home, "bus");
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, []) });
    const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");
    const repaired = readFileSync(codexPath, "utf8");

    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.ok(repaired.endsWith(privateRegion), "the opaque private region must remain byte-identical");
    assert.equal(existsSync(missingSource), false, "the legacy marketplace source must be absent");
    assert.doesNotMatch(repaired, new RegExp(`\\[marketplaces\\.${marketplace}\\]`));
    assert.ok(
      codex?.unrepaired.some((entry) =>
        entry.code === "config-invalid" &&
        entry.message.includes("[[private.keep]]") &&
        entry.message.includes("TOML arrays of tables are not framed for targeted rewrite")
      ),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor byte-splices only framed legacy tables around opaque Codex TOML regions", () => {
  const cases = [
    {
      name: "a boundary comment",
      opaque: "# this comment belongs to the private region\n" +
        "[[private.keep]]\n" +
        'token = "must-remain-private"\n',
      regions: ["[[private.keep]]"]
    },
    {
      name: "adjacent arrays",
      opaque: "[[private.first]]\n" +
        'token = "first"\n' +
        "[[private.second]]\n" +
        'token = "second"\n',
      regions: ["[[private.first]]", "[[private.second]]"]
    },
    {
      name: "nested arrays",
      opaque: "[[private.parent]]\n" +
        'token = "parent"\n' +
        "[[private.parent.child]]\n" +
        'token = "child"\n',
      regions: ["[[private.parent]]", "[[private.parent.child]]"]
    },
    {
      name: "an EOF array without a final line feed",
      opaque: "[[private.eof]]\n" +
        'token = "must-not-gain-a-line-feed"',
      regions: ["[[private.eof]]"]
    },
    {
      name: "a CRLF opaque array with indentation, key order, and trailing spaces",
      eol: "\r\n",
      opaque: "[[private.crlf]]\r\n" +
        '  zeta = "last"  # preserve this trailing comment\r\n' +
        '  alpha = "first"   ',
      regions: ["[[private.crlf]]"]
    }
  ];
  for (const fixture of cases) {
    const { home } = cleanShippedLayoutHome();
    const codexPath = join(home, ".codex", "config.toml");
    const marketplace = `sentropic-local-splice-${fixture.name.replace(/[^a-z]+/gi, "-").toLowerCase()}`;
    const missingSource = join(home, `deleted-${marketplace}`);
    const eol = fixture.eol ?? "\n";
    const target = `[marketplaces.${marketplace}]${eol}` +
      `source_type = "local"${eol}` +
      `source = "${missingSource}"${eol}`;
    const before = `${readFileSync(codexPath, "utf8").trimEnd()}${eol}${eol}${target}${fixture.opaque}`;
    const beforeBytes = Buffer.from(before, "utf8");
    const targetBytes = Buffer.from(target, "utf8");
    const targetStart = beforeBytes.indexOf(targetBytes);
    const afterExpected = Buffer.concat([
      beforeBytes.subarray(0, targetStart),
      beforeBytes.subarray(targetStart + targetBytes.length)
    ]);
    try {
      writeFileSync(codexPath, before);
      assert.equal(existsSync(missingSource), false, `${fixture.name}: legacy source must be absent`);
      const root = join(home, "bus");
      assert.equal(runCli(["init", "--root", root], streams(home)), 0);
      const { exitCode, io, report } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, []) });
      const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");
      const after = readFileSync(codexPath);

      assert.equal(exitCode, 2, `${fixture.name}: ${io.stderrText}`);
      assert.deepEqual(after, afterExpected, `${fixture.name}: only the framed legacy table may be spliced out`);
      assert.equal(after.at(-1), beforeBytes.at(-1), `${fixture.name}: must preserve the final byte`);
      assert.doesNotMatch(after.toString("utf8"), new RegExp(`\\[marketplaces\\.${marketplace}\\]`));
      for (const region of fixture.regions) {
        assert.ok(
          codex?.unrepaired.some((entry) =>
            entry.code === "config-invalid" &&
            entry.message.includes(region) &&
            entry.message.includes("TOML arrays of tables are not framed for targeted rewrite") &&
            entry.message.includes("its existing bytes were retained and no rewrite was attempted")
          ),
          `${fixture.name}: ${JSON.stringify(codex, null, 2)}`
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("doctor preserves terminal bytes while appending missing canonical Codex tables", () => {
  const cases = [
    { name: "a CRLF", privateSuffix: "# preserve CRLF\r\n" },
    { name: "trailing spaces", privateSuffix: "# preserve trailing spaces   " }
  ];
  for (const fixture of cases) {
    const { home } = cleanShippedLayoutHome();
    const codexPath = join(home, ".codex", "config.toml");
    const marketplace = `sentropic-local-terminal-${fixture.name.replace(/[^a-z]+/gi, "-").toLowerCase()}`;
    const missingSource = join(home, `deleted-${marketplace}`);
    const target = `[marketplaces.${marketplace}]\n` +
      'source_type = "local"\n' +
      `source = "${missingSource}"\n`;
    const before = `${target}${fixture.privateSuffix}`;
    const privateBytes = Buffer.from(fixture.privateSuffix, "utf8");
    try {
      writeFileSync(codexPath, before);
      const root = join(home, "bus");
      assert.equal(runCli(["init", "--root", root], streams(home)), 0);
      const { exitCode, io, report } = runRepairDoctor(home, root, {
        runHostCommand: repairRunnerWithoutCodexConfigRewrite(home, [])
      });
      const after = readFileSync(codexPath);

      assert.equal(exitCode, 0, `${fixture.name}: ${io.stderrText}`);
      assert.equal(report.ok, true, JSON.stringify(report, null, 2));
      assert.deepEqual(
        after.subarray(0, privateBytes.length),
        privateBytes,
        `${fixture.name}: repair may append canonical tables but must not normalize existing terminal bytes`
      );
      assert.doesNotMatch(after.toString("utf8"), new RegExp(`\\[marketplaces\\.${marketplace}\\]`));
      assert.match(after.toString("utf8"), /\[marketplaces\.sentropic\]/);
      assert.match(after.toString("utf8"), /\[plugins\."h2a@sentropic"\]/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test("doctor preserves a whitespace-only line before a private Codex comment", () => {
  const { home } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const marketplace = "sentropic-local-whitespace-boundary";
  const missingSource = join(home, `deleted-${marketplace}`);
  const target = `[marketplaces.${marketplace}]\n` +
    'source_type = "local"\n' +
    `source = "${missingSource}"\n`;
  const privateRegion = "   \n" +
    "# private comment\n" +
    "[private.keep]\n" +
    'value = "must-remain-private"\n';
  const before = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n${target}${privateRegion}`;
  const targetStart = Buffer.from(before, "utf8").indexOf(Buffer.from(target, "utf8"));
  const expected = Buffer.concat([
    Buffer.from(before, "utf8").subarray(0, targetStart),
    Buffer.from(before, "utf8").subarray(targetStart + Buffer.byteLength(target))
  ]);
  try {
    writeFileSync(codexPath, before);
    const root = join(home, "bus");
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, []) });

    assert.equal(exitCode, 0, io.stderrText);
    assert.deepEqual(
      readFileSync(codexPath),
      expected,
      "only the authorized target span may be removed; whitespace-only trivia belongs to the private region"
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repairs framed legacy tables beside untouched Codex skills and hooks arrays", () => {
  const { home } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const marketplace = "sentropic-local-skills";
  const plugin = "h2a-local-skills@sentropic-local-skills";
  const skillPath = join(home, "skills", "SKILL.md");
  const skillsRegion = "[[skills.config]]\n" +
    `path = "${skillPath}"\n` +
    "enabled = false\n";
  const hooksRegion = "[[hooks.PreToolUse]]\n" +
    'command = "echo keep"\n';
  const opaqueRegions = `${skillsRegion}\n${hooksRegion}`;
  const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
    `[marketplaces.${marketplace}]\n` +
    'source_type = "local"\n' +
    `source = "${join(home, "deleted-skills-marketplace")}"\n\n` +
    `[plugins."${plugin}"]\n` +
    "enabled = true\n\n" +
    opaqueRegions;
  try {
    mkdirSync(join(skillPath, ".."), { recursive: true });
    writeFileSync(skillPath, "---\nname: keep\n---\n");
    writeFileSync(codexPath, config);
    const root = join(home, "bus");
    const calls = [];
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = runRepairDoctor(home, root, { runHostCommand: repairRunner(home, calls) });
    const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");
    const repaired = readFileSync(codexPath, "utf8");

    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, false, JSON.stringify(codex, null, 2));
    assert.doesNotMatch(repaired, new RegExp(`\\[marketplaces\\.${marketplace}\\]`));
    assert.match(repaired, new RegExp(`\\[plugins\\."${plugin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\][\\s\\S]*enabled = false`));
    assert.ok(repaired.endsWith(opaqueRegions), repaired);
    const preservedRegions = codex?.unrepaired
      .filter((entry) => entry.code === "config-invalid")
      .map((entry) => entry.message.match(/opaque Codex TOML region (\[\[[^\]]+\]\])/)?.[1]);
    assert.deepEqual(preservedRegions, ["[[skills.config]]", "[[hooks.PreToolUse]]"], JSON.stringify(codex, null, 2));
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin marketplace upgrade"), JSON.stringify(calls, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor keeps a coherent configured host clean when its native CLI is unavailable", () => {
  const { home, version } = cleanShippedLayoutHome();
  const root = join(home, "bus");
  const calls = [];
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const { exitCode, io, report } = withoutHostCliOnPath(home, () => runRepairDoctorWithActualHostPresence(home, root, {
      version,
      testHostCliReachable: () => false,
      runHostCommand: (command, args) => {
        calls.push([command, ...args]);
        return { ok: true };
      }
    }));

    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(calls, [], "a clean configured host without a reachable CLI needs no native repair");
    for (const host of report.checks.hostInstallations.hosts) {
      assert.ok(host.diagnostics.some((entry) => entry.code === "host-cli-unreachable"), JSON.stringify(host, null, 2));
      assert.deepEqual(host.findings, [], JSON.stringify(host, null, 2));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor accepts the exact shipped plugin layouts as clean", () => {
  const { home, version } = cleanShippedLayoutHome();
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({ home, version, repair: true })
    });
    const report = JSON.parse(io.stdoutText);
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(
      report.checks.hostInstallations.hosts.flatMap((host) => host.diagnostics),
      [],
      JSON.stringify(report, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor names the broken canonical Codex marketplace source", () => {
  const home = join(tmpdir(), `h2a-host-doctor-marketplace-source-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const deadSource = join(home, "deleted-marketplace");
  try {
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      [
        '[plugins."h2a@sentropic"]',
        "enabled = true",
        "",
        "[marketplaces.sentropic]",
        'source_type = "local"',
        `source = "${deadSource}"`,
        ""
      ].join("\n")
    );
    currentPlugin(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION));
    const codex = doctorHostInstallations({ home, version: VERSION }).hosts.find((host) => host.host === "codex");
    assert.match(
      codex?.findings.find((entry) => entry.code === "marketplace-missing")?.message ?? "",
      new RegExp(deadSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repairs a cached enabled Codex plugin from an owned legacy marketplace idempotently", () => {
  const home = fixtureHome();
  const codexLegacyCacheRoot = join(home, ".codex", "plugins", "cache", "sentropic-local-codex-08518");
  const claudeLegacyCacheRoot = join(home, ".claude", "plugins", "cache", "sentropic-local-claude-08518");
  try {
    const before = doctorHostInstallations({ home, version: VERSION });
    assert.equal(before.ok, false, "the deliberately incoherent installation must fail before repair");
    const claudeBefore = before.hosts.find((host) => host.host === "claude");
    const codexBefore = before.hosts.find((host) => host.host === "codex");
    assert.ok(claudeBefore?.findings.some((entry) => entry.code === "version-skew"));
    assert.ok(codexBefore?.findings.some((entry) => entry.code === "marketplace-missing"));
    assert.match(
      codexBefore?.findings.find((entry) => entry.code === "marketplace-missing")?.message ?? "",
      /false-healthy/
    );
    assert.equal(
      codexBefore?.findings.some((entry) => entry.code === "version-skew"),
      false,
      "a current Codex cache must still be unhealthy while an owned legacy marketplace remains configured"
    );
    for (const host of before.hosts) {
      assert.ok(host.findings.some((entry) => entry.code === "orphan-cache"));
      assert.ok(host.findings.some((entry) => entry.code === "h2a-endpoint-count"));
      assert.ok(host.findings.some((entry) => entry.code === "standalone-track-mcp"));
    }

    const calls = [];
    const repaired = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: repairRunner(home, calls)
    });
    assert.equal(repaired.ok, true, JSON.stringify(repaired, null, 2));
    assert.deepEqual(repaired.hosts.flatMap((host) => host.unrepaired), [], JSON.stringify(repaired, null, 2));
    for (const host of repaired.hosts) {
      assert.deepEqual(host.findings.map((entry) => entry.code), ["orphan-cache"], JSON.stringify(host, null, 2));
    }
    assert.ok(
      calls.some((call) => call.join(" ") === "codex plugin marketplace add rhanka/h2a --ref main"),
      "an owned legacy local source requires a native Git marketplace add"
    );
    assert.equal(
      calls.some((call) => call.join(" ") === "codex plugin marketplace upgrade"),
      false,
      "marketplace upgrade is a no-op for an owned legacy local source, never its repair"
    );
    assert.ok(calls.some((call) => call[0] === "claude" && (call.includes("install") || call.includes("update"))));

    const codex = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    assert.match(codex, /\[plugins\."h2a@sentropic"\]/);
    assert.match(codex, /source = "https:\/\/github\.com\/rhanka\/h2a\.git"/);
    assert.doesNotMatch(codex, /\[marketplaces\.sentropic-local|\[mcp_servers\.(h2a|track)\]/);
    assert.match(codex, /\[plugins\."h2a-local-codex-08518@sentropic-local-codex-08518"\]\nenabled = false/);
    assert.ok(existsSync(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION)));
    assert.ok(existsSync(codexLegacyCacheRoot), "v1 retains the owned Codex legacy cache as an informational orphan");

    const claudeMcp = JSON.parse(readFileSync(join(home, ".config", "claude", "mcp.json"), "utf8"));
    assert.deepEqual(claudeMcp.mcpServers, { other: { command: "other-mcp", args: ["serve"] } });
    assert.equal(existsSync(join(home, ".claude", "plugins", "cache", "sentropic", "h2a", "0.85.18")), false);
    assert.ok(existsSync(claudeLegacyCacheRoot), "v1 retains the owned Claude legacy cache as an informational orphan");

    const secondCalls = [];
    const rerun = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: repairRunner(home, secondCalls)
    });
    assert.equal(rerun.ok, true, JSON.stringify(rerun, null, 2));
    assert.deepEqual(rerun.hosts.map((host) => host.changed), [[], []]);
    assert.deepEqual(secondCalls, [], "a converged host must not run native repair commands again");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor leaves a native-host command failure explicitly unrepaired", () => {
  const home = fixtureHome();
  try {
    const calls = [];
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: (command, args) => {
        calls.push([command, ...args]);
        return { ok: false, message: "host CLI unavailable" };
      }
    });
    assert.equal(report.ok, false);
    const failures = report.hosts
      .flatMap((host) => host.unrepaired)
      .filter((entry) => entry.code === "host-command-failed");
    const commands = calls.map(([command, ...args]) => `${command} ${args.join(" ")}`);
    assert.ok(commands.length > 1, "the fixture must require multiple native-host calls");
    assert.equal(new Set(commands).size, commands.length, "the fixture commands must be unique");
    assert.equal(failures.length, commands.length, JSON.stringify(report, null, 2));
    for (const command of commands) {
      assert.equal(
        failures.filter((entry) => entry.message.startsWith(`${command} failed:`)).length,
        1,
        `every failed native-host command must have exactly one unrepaired finding: ${command}`
      );
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor preserves direct endpoints when replacement commands fail", () => {
  const home = fixtureHome();
  const codexPath = join(home, ".codex", "config.toml");
  const claudeMcpPath = join(home, ".config", "claude", "mcp.json");
  try {
    const codexBefore = readFileSync(codexPath, "utf8");
    const claudeBefore = readFileSync(claudeMcpPath, "utf8");
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: () => ({ ok: false, message: "replacement install failed" })
    });

    assert.equal(report.ok, false);
    assert.ok(
      report.hosts.flatMap((host) => host.unrepaired).some((entry) => entry.code === "host-command-failed"),
      JSON.stringify(report, null, 2)
    );
    assert.equal(readFileSync(codexPath, "utf8"), codexBefore);
    assert.equal(readFileSync(claudeMcpPath, "utf8"), claudeBefore);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor preserves third-party MCP entries and custom configuration fields", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const claudeMcpPath = join(home, ".config", "claude", "mcp.json");
  const codexBefore = [
    '[plugins."h2a@sentropic"]',
    "enabled = true",
    'custom_field = "preserve"',
    "",
    "[marketplaces.sentropic]",
    'source_type = "git"',
    'source = "https://github.com/rhanka/h2a.git"',
    'ref = "main"',
    'custom_marketplace_field = "preserve"',
    "",
    "[mcp_servers.h2a]",
    'command = "h2a"',
    'args = ["mcp-serve"]',
    "",
    "[mcp_servers.h2a-helper]",
    'command = "third-party-mcp"',
    'args = ["serve"]',
    'opaque = "preserve"',
    ""
  ].join("\n");
  const codexExpected = [
    '[plugins."h2a@sentropic"]',
    "enabled = true",
    'custom_field = "preserve"',
    "",
    "[marketplaces.sentropic]",
    'source_type = "git"',
    'source = "https://github.com/rhanka/h2a.git"',
    'ref = "main"',
    'custom_marketplace_field = "preserve"',
    "",
    "[mcp_servers.h2a-helper]",
    'command = "third-party-mcp"',
    'args = ["serve"]',
    'opaque = "preserve"',
    ""
  ].join("\n");
  const claudeBefore = '{"custom":{"untouched":[1,2]},"mcpServers":{"h2a":{"command":"h2a","args":["mcp-serve"]},"h2a-helper":{"command":"third-party-mcp","args":["serve"],"opaque":{"x":1}}},"tail":"preserve"}\n';
  const claudeExpected = '{"custom":{"untouched":[1,2]},"mcpServers":{"h2a-helper":{"command":"third-party-mcp","args":["serve"],"opaque":{"x":1}}},"tail":"preserve"}\n';
  try {
    writeFileSync(codexPath, codexBefore);
    mkdirSync(join(claudeMcpPath, ".."), { recursive: true });
    writeFileSync(claudeMcpPath, claudeBefore);

    const report = doctorHostInstallations({ home, version, repair: true, runHostCommand: repairRunner(home, []) });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), codexExpected);
    assert.equal(readFileSync(claudeMcpPath, "utf8"), claudeExpected);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor preserves third-party track-mcp arguments when removing its own endpoints", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const claudeMcpPath = join(home, ".config", "claude", "mcp.json");
  const codexBefore = [
    '[plugins."h2a@sentropic"]',
    "enabled = true",
    "",
    "[marketplaces.sentropic]",
    'source_type = "git"',
    'source = "https://github.com/rhanka/h2a.git"',
    'ref = "main"',
    "",
    "[mcp_servers.track]",
    'command = "h2a"',
    'args = ["track-mcp"]',
    "",
    "[mcp_servers.h2a-helper]",
    'command = "third-party-mcp"',
    'args = ["--profile=track-mcp-helper"]',
    'opaque = "preserve"',
    ""
  ].join("\n");
  const codexExpected = [
    '[plugins."h2a@sentropic"]',
    "enabled = true",
    "",
    "[marketplaces.sentropic]",
    'source_type = "git"',
    'source = "https://github.com/rhanka/h2a.git"',
    'ref = "main"',
    "",
    "[mcp_servers.h2a-helper]",
    'command = "third-party-mcp"',
    'args = ["--profile=track-mcp-helper"]',
    'opaque = "preserve"',
    ""
  ].join("\n");
  const claudeBefore = '{"mcpServers":{"track":{"command":"h2a","args":["track-mcp"]},"h2a-helper":{"command":"third-party-mcp","args":["track-mcp"],"opaque":"preserve"}},"tail":"preserve"}\n';
  const claudeExpected = '{"mcpServers":{"h2a-helper":{"command":"third-party-mcp","args":["track-mcp"],"opaque":"preserve"}},"tail":"preserve"}\n';
  try {
    writeFileSync(codexPath, codexBefore);
    mkdirSync(join(claudeMcpPath, ".."), { recursive: true });
    writeFileSync(claudeMcpPath, claudeBefore);

    const report = doctorHostInstallations({ home, version, repair: true, runHostCommand: repairRunner(home, []) });

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), codexExpected);
    assert.equal(readFileSync(claudeMcpPath, "utf8"), claudeExpected);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor aborts invalid rendered TOML and JSON before replacing host configuration", () => {
  const fixture = configurationRewriteFixture();
  try {
    const report = doctorHostInstallations({
      home: fixture.home,
      version: fixture.version,
      repair: true,
      testConfigurationWrite: {
        mutateRendered: (_path, format) => format === "toml" ? 'opaque = "unterminated\n' : "{"
      }
    });

    assert.equal(report.ok, false);
    for (const path of fixture.paths) assert.equal(readFileSync(path, "utf8"), fixture.original.get(path), path);
    for (const path of fixture.paths) {
      assert.ok(
        report.hosts.flatMap((host) => host.unrepaired).some((entry) => entry.path === path && /rendered .* cannot be parsed/.test(entry.message)),
        JSON.stringify(report, null, 2)
      );
    }
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("doctor leaves host configuration byte-identical when atomic rename fails", () => {
  const fixture = configurationRewriteFixture();
  try {
    const report = doctorHostInstallations({
      home: fixture.home,
      version: fixture.version,
      repair: true,
      testConfigurationWrite: {
        rename: () => { throw new Error("injected rename failure"); }
      }
    });

    assert.equal(report.ok, false);
    for (const path of fixture.paths) assert.equal(readFileSync(path, "utf8"), fixture.original.get(path), path);
    for (const path of fixture.paths) {
      assert.ok(
        report.hosts.flatMap((host) => host.unrepaired).some((entry) => entry.path === path && /injected rename failure/.test(entry.message)),
        JSON.stringify(report, null, 2)
      );
    }
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("doctor aborts an atomic configuration replacement after a concurrent host edit", () => {
  const fixture = configurationRewriteFixture();
  try {
    const report = doctorHostInstallations({
      home: fixture.home,
      version: fixture.version,
      repair: true,
      testConfigurationWrite: {
        beforeRename: (path) => {
          const concurrent = `${readFileSync(path, "utf8")}${path.endsWith(".toml") ? "# concurrent host edit\n" : "\n"}`;
          writeFileSync(path, concurrent);
        }
      }
    });

    assert.equal(report.ok, false);
    for (const path of fixture.paths) {
      const expected = `${fixture.original.get(path)}${path.endsWith(".toml") ? "# concurrent host edit\n" : "\n"}`;
      assert.equal(readFileSync(path, "utf8"), expected, path);
      assert.ok(
        report.hosts.flatMap((host) => host.unrepaired).some((entry) => entry.path === path && /changed concurrently/.test(entry.message)),
        JSON.stringify(report, null, 2)
      );
    }
  } finally {
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("doctor reports unverified legacy artifacts without deleting them", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const legacyRoot = join(home, ".codex", "plugins", "cache", "sentropic-local-unverified");
  const legacyMarketplace = join(home, "unverified-marketplace");
  try {
    mkdirSync(join(legacyRoot, "h2a", "0.1.0"), { recursive: true });
    writeFileSync(join(legacyRoot, "h2a", "0.1.0", "third-party.txt"), "do not delete\n");
    mkdirSync(legacyMarketplace, { recursive: true });
    writeFileSync(
      codexPath,
      `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
        '[plugins."h2a-local-unverified@sentropic-local-unverified"]\n' +
        "enabled = true\n\n" +
        "[marketplaces.sentropic-local-unverified]\n" +
        'source_type = "local"\n' +
        `source = "${legacyMarketplace}"\n`
    );

    const report = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: repairRunner(home, [])
    });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false);
    assert.ok(existsSync(legacyRoot));
    assert.ok(
      codex?.unrepaired.some((entry) => entry.code === "ownership-unverified" && /unverified/.test(entry.message)),
      JSON.stringify(report, null, 2)
    );
    assert.match(readFileSync(codexPath, "utf8"), /sentropic-local-unverified/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor leaves an unproven canonical Codex marketplace untouched", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const config = [
    '[plugins."h2a@sentropic"]',
    "enabled = true",
    'custom_plugin_field = "third-party"',
    "",
    "[marketplaces.sentropic]",
    'source_type = "local"',
    'source = "/third-party/sentropic"',
    'opaque = "preserve"',
    ""
  ].join("\n");
  try {
    writeFileSync(codexPath, config);
    const report = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: () => ({ ok: true })
    });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false);
    assert.ok(
      codex?.unrepaired.some((entry) => entry.code === "ownership-unverified" && /marketplace sentropic/.test(entry.message)),
      JSON.stringify(report, null, 2)
    );
    assert.equal(readFileSync(codexPath, "utf8"), config);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor removes the source-deleted legacy Codex marketplace table after verifying the canonical replacement", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const legacyPlugin = "h2a-local-codex-08518@sentropic-local-codex-08518";
  const legacyMarketplace = "sentropic-local-codex-08518";
  const legacyCache = join(home, ".codex", "plugins", "cache", legacyMarketplace, "h2a-local-codex-08518", "0.85.18");
  try {
    rmSync(join(home, ".codex", "plugins", "cache", "sentropic"), { recursive: true, force: true });
    rmSync(join(home, ".codex", ".tmp", "marketplaces", "sentropic"), { recursive: true, force: true });
    writeFileSync(
      codexPath,
      `[marketplaces.${legacyMarketplace}]\n` +
        'source_type = "local"\n' +
        'source = "/deleted/tmp/deploy-08518"\n\n' +
        `[plugins."${legacyPlugin}"]\n` +
        "enabled = true\n"
    );
    mkdirSync(join(legacyCache, ".codex-plugin"), { recursive: true });
    writeJson(join(legacyCache, ".codex-plugin", "plugin.json"), { name: "h2a-local-codex-08518", version: "0.85.18" });
    writeJson(join(legacyCache, ".mcp.json"), {
      mcpServers: { h2a: { command: "node", args: ["/deleted/tmp/deploy-08518/old-mcp.js"] } }
    });
    const calls = [];
    const report = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: repairRunner(home, calls, version)
    });
    const codex = report.hosts.find((host) => host.host === "codex");
    const repairedConfig = readFileSync(codexPath, "utf8");
    const ownershipRefusals = (codex?.unrepaired ?? []).filter((entry) => entry.code === "ownership-unverified");

    // This asserts configuration state. The native `codex plugin marketplace
    // list` oracle was measured separately: it becomes usable once this dead
    // local table is gone.
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, true, JSON.stringify(codex, null, 2));
    assert.ok(
      calls.some((call) => call.join(" ") === "codex plugin marketplace add rhanka/h2a --ref main"),
      JSON.stringify(calls, null, 2)
    );
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin add h2a@sentropic"), JSON.stringify(calls, null, 2));
    assert.match(repairedConfig, new RegExp(`\\[plugins\\."${legacyPlugin}"\\]\\nenabled = false`));
    assert.doesNotMatch(repairedConfig, new RegExp(`\\[marketplaces\\.${legacyMarketplace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`));
    assert.ok(
      codex?.plannedActions.includes(`disable Codex legacy plugin ${legacyPlugin} (previous value redacted)`),
      JSON.stringify(codex, null, 2)
    );
    assert.ok(
      codex?.plannedActions.some((action) =>
        action.startsWith(`remove Codex legacy marketplace ${legacyMarketplace} table (was `) &&
        action.includes("source = <redacted>") &&
        !action.includes("/deleted/tmp/deploy-08518")
      ),
      JSON.stringify(codex, null, 2)
    );
    assert.ok(existsSync(legacyCache), "the legacy cache must not be deleted without content proof");
    assert.equal(ownershipRefusals.length, 0, JSON.stringify(codex, null, 2));
    assert.equal(
      codex?.unrepaired.some((entry) => entry.code === "ownership-unverified" && /legacy plugin/.test(entry.message)),
      false,
      JSON.stringify(codex, null, 2)
    );
    assert.equal(codex?.findings.some((entry) => entry.code === "plugin-stale"), false, JSON.stringify(codex, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor leaves an inaccessible legacy Codex marketplace config byte-identical", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const legacyMarketplace = "sentropic-local-inaccessible";
  const legacyPlugin = "h2a-local-inaccessible@sentropic-local-inaccessible";
  const inaccessibleParent = join(home, "inaccessible-marketplace-parent");
  const inaccessibleSource = join(inaccessibleParent, "marketplace");
  let restricted = false;
  try {
    mkdirSync(inaccessibleSource, { recursive: true });
    const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
      `[marketplaces.${legacyMarketplace}]\n` +
      'source_type = "local"\n' +
      `source = "${inaccessibleSource}"\n` +
      'private_metadata = "must-remain-private"\n\n' +
      `[plugins."${legacyPlugin}"]\n` +
      "enabled = true\n";
    writeFileSync(codexPath, config);
    chmodSync(inaccessibleParent, 0o000);
    restricted = true;

    const report = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: () => ({ ok: true })
    });
    const codex = report.hosts.find((host) => host.host === "codex");

    // This exercises configuration state, not what the native Codex CLI serves.
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), config);
    assert.ok(
      codex?.unrepaired.some((entry) =>
        entry.code === "ownership-unverified" && /cannot be verified absent \(EACCES\)/.test(entry.message)
      ),
      JSON.stringify(codex, null, 2)
    );
    assert.equal(codex?.plannedActions.some((action) => action.includes(legacyMarketplace)), false);
    assert.equal(codex?.plannedActions.some((action) => action.includes(legacyPlugin)), false);
  } finally {
    if (restricted) chmodSync(inaccessibleParent, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor revalidates a legacy Codex marketplace immediately before atomic replacement", () => {
  const { home, version } = cleanShippedLayoutHome();
  const codexPath = join(home, ".codex", "config.toml");
  const legacyMarketplace = "sentropic-local-race";
  const legacyPlugin = "h2a-local-race@sentropic-local-race";
  const raceParent = join(home, "marketplace-race-parent");
  const raceSource = join(raceParent, "marketplace");
  let restricted = false;
  try {
    const config = `${readFileSync(codexPath, "utf8").trimEnd()}\n\n` +
      `[marketplaces.${legacyMarketplace}]\n` +
      'source_type = "local"\n' +
      `source = "${raceSource}"\n\n` +
      `[plugins."${legacyPlugin}"]\n` +
      "enabled = true\n";
    writeFileSync(codexPath, config);

    const report = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: () => ({ ok: true }),
      testConfigurationWrite: {
        beforeRename: (path) => {
          if (path !== codexPath) return;
          mkdirSync(raceSource, { recursive: true });
          chmodSync(raceParent, 0o000);
          restricted = true;
        }
      }
    });
    const codex = report.hosts.find((host) => host.host === "codex");

    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(readFileSync(codexPath, "utf8"), config);
    assert.ok(
      codex?.unrepaired.some((entry) =>
        entry.code === "ownership-unverified" && /cannot be verified absent \(EACCES\)/.test(entry.message)
      ),
      JSON.stringify(codex, null, 2)
    );
  } finally {
    if (restricted) chmodSync(raceParent, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

function installCanonicalClaudeRoot(root, version) {
  const pluginPath = join(root, "plugins", "cache", "sentropic", "h2a", version);
  copyShippedFile(".claude-plugin/plugin.json", join(pluginPath, ".claude-plugin", "plugin.json"));
  currentMarketplace(join(root, "plugins", "marketplaces", "sentropic"));
  writeJson(join(root, "plugins", "known_marketplaces.json"), {
    sentropic: {
      source: { source: "github", repo: "rhanka/h2a" },
      installLocation: join(root, "plugins", "marketplaces", "sentropic")
    }
  });
  writeJson(join(root, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "h2a@sentropic": [{ scope: "user", installPath: pluginPath, version }]
    }
  });
}

test("doctor finds a configured Claude bare MCP entry in both native config locations", () => {
  const { home, version } = cleanShippedLayoutHome();
  const configuredClaude = join(home, "configured-claude");
  const defaultClaudeConfig = join(home, ".claude.json");
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  try {
    installCanonicalClaudeRoot(configuredClaude, version);
    writeJson(defaultClaudeConfig, { mcpServers: { defaultMarker: { command: "other", args: [] } } });
    process.env.CLAUDE_CONFIG_DIR = configuredClaude;
    for (const configPath of [
      join(configuredClaude, ".claude.json"),
      join(configuredClaude, ".config", "claude", "mcp.json")
    ]) {
      writeJson(configPath, { mcpServers: { h2a: { command: "h2a", args: ["mcp-serve"] } } });
      const report = doctorHostInstallations({ home, version, repair: true, dryRun: true });
      const claude = report.hosts.find((host) => host.host === "claude");
      const endpointCount = claude?.findings.find((entry) => entry.code === "h2a-endpoint-count");

      // This asserts doctor reads the native configuration state; the host
      // serving oracle remains docs/uat/probe-oracle.sh.
      assert.equal(report.ok, false, JSON.stringify(report, null, 2));
      assert.match(endpointCount?.message ?? "", /Claude exposes 2 H2A endpoints/);
      assert.ok(claude?.coherencePaths.includes(configPath), JSON.stringify(claude, null, 2));
      assert.equal(claude?.coherencePaths.includes(defaultClaudeConfig), false, JSON.stringify(claude, null, 2));
      rmSync(configPath, { force: true });
    }
  } finally {
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor keeps detecting a bare Claude MCP entry at the default root", () => {
  const { home, version } = cleanShippedLayoutHome();
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CLAUDE_CONFIG_DIR;
    for (const configPath of [
      join(home, ".claude.json"),
      join(home, ".config", "claude", "mcp.json")
    ]) {
      writeJson(configPath, { mcpServers: { h2a: { command: "h2a", args: ["mcp-serve"] } } });
      const report = doctorHostInstallations({ home, version, repair: true, dryRun: true });
      const claude = report.hosts.find((host) => host.host === "claude");
      const endpointCount = claude?.findings.find((entry) => entry.code === "h2a-endpoint-count");

      assert.equal(report.ok, false, JSON.stringify(report, null, 2));
      assert.match(endpointCount?.message ?? "", /Claude exposes 2 H2A endpoints/);
      assert.ok(claude?.coherencePaths.includes(configPath), JSON.stringify(claude, null, 2));
      rmSync(configPath, { force: true });
    }
  } finally {
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor diagnoses and repairs the configured CODEX_HOME rather than its HOME fallback", () => {
  const { home, version } = cleanShippedLayoutHome();
  const configuredCodex = join(home, "configured-codex");
  const configuredConfig = join(configuredCodex, "config.toml");
  const configuredPlugin = "h2a-local-configured@sentropic-local-configured";
  const configuredMarketplace = "sentropic-local-configured";
  const fallbackConfig = join(home, ".codex", "config.toml");
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    const configuredCache = join(configuredCodex, "plugins", "cache", "sentropic", "h2a", version);
    copyShippedFile(".codex-plugin/plugin.json", join(configuredCache, ".codex-plugin", "plugin.json"));
    copyShippedFile(".mcp.json", join(configuredCache, ".mcp.json"));
    currentMarketplace(join(configuredCodex, ".tmp", "marketplaces", "sentropic"));
    writeFileSync(
      configuredConfig,
      [
        '[plugins."h2a@sentropic"]',
        "enabled = true",
        "",
        "[marketplaces.sentropic]",
        'source_type = "git"',
        'source = "https://github.com/rhanka/h2a.git"',
        'ref = "main"',
        "",
        `[marketplaces.${configuredMarketplace}]`,
        'source_type = "local"',
        'source = "/deleted/configured-codex-marker"',
        "",
        `[plugins."${configuredPlugin}"]`,
        "enabled = true",
        ""
      ].join("\n")
    );
    const fallbackWithDistinctMarker = `${readFileSync(fallbackConfig, "utf8").trimEnd()}\n\n` +
      '[marketplaces.sentropic-local-home-marker]\n' +
      'source_type = "local"\n' +
      'source = "/deleted/home-codex-marker"\n\n' +
      '[plugins."h2a-local-home-marker@sentropic-local-home-marker"]\n' +
      "enabled = true\n";
    writeFileSync(fallbackConfig, fallbackWithDistinctMarker);

    process.env.CODEX_HOME = configuredCodex;
    const calls = [];
    const report = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: (command, args) => {
        calls.push([command, ...args]);
        return { ok: true };
      }
    });
    const codex = report.hosts.find((host) => host.host === "codex");
    const repairedConfiguredConfig = readFileSync(configuredConfig, "utf8");

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(codex?.ok, true, JSON.stringify(codex, null, 2));
    assert.match(repairedConfiguredConfig, new RegExp(`\\[plugins\\."${configuredPlugin}"\\]\\nenabled = false`));
    assert.doesNotMatch(repairedConfiguredConfig, new RegExp(`\\[marketplaces\\.${configuredMarketplace}\\]`));
    assert.equal(readFileSync(fallbackConfig, "utf8"), fallbackWithDistinctMarker);
    assert.ok(codex?.changed.includes(configuredConfig), JSON.stringify(codex, null, 2));
    assert.equal(codex?.changed.includes(fallbackConfig), false, JSON.stringify(codex, null, 2));
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin marketplace upgrade"), JSON.stringify(calls, null, 2));
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin add h2a@sentropic"), JSON.stringify(calls, null, 2));
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repair never targets third-party or canonical plugin caches for deletion", () => {
  const home = fixtureHome();
  const protectedCacheNames = [
    "openai-curated",
    "claude-plugins-official",
    "openai-codex",
    "sentropic",
    "h2a@sentropic",
    "openai-sentropic-local-fixture"
  ];
  const protectedPaths = protectedCacheNames.flatMap((name) => [
    join(home, ".codex", "plugins", "cache", name),
    join(home, ".claude", "plugins", "cache", name)
  ]);
  const thirdPartyCachePath = join(home, ".codex", "plugins", "cache", "sentropic-local-third-party");
  const thirdPartyVersionPaths = [
    join(home, ".codex", "plugins", "cache", "sentropic", "h2a", "third-party-keep"),
    join(home, ".claude", "plugins", "cache", "sentropic", "h2a", "third-party-keep")
  ];
  try {
    const staleClaudeCanonicalPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", "0.85.18");
    const currentClaudeCanonicalPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", VERSION);
    rmSync(staleClaudeCanonicalPath, { recursive: true, force: true });
    currentPlugin(currentClaudeCanonicalPath);
    for (const path of protectedPaths) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "third-party.txt"), "must survive repair\n");
    }
    mkdirSync(thirdPartyCachePath, { recursive: true });
    writeFileSync(join(thirdPartyCachePath, "third-party.txt"), "must never be attributed to H2A\n");
    for (const path of thirdPartyVersionPaths) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "third-party.txt"), "must never be attributed to H2A\n");
    }
    const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
    const installed = JSON.parse(readFileSync(installedPath, "utf8"));
    installed.plugins["h2a@sentropic"] = [{ scope: "user", installPath: currentClaudeCanonicalPath, version: VERSION }];
    installed.plugins["openai-h2a-local-fixture"] = [];
    writeJson(installedPath, installed);
    const protectedContents = new Map(protectedPaths.map((path) => [path, snapshotTreeBytes(path)]));
    const thirdPartyContents = snapshotTreeBytes(thirdPartyCachePath);
    const thirdPartyVersionContents = new Map(thirdPartyVersionPaths.map((path) => [path, snapshotTreeBytes(path)]));

    const calls = [];
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: repairRunner(home, calls)
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.hosts.flatMap((host) => host.unrepaired), [], JSON.stringify(report, null, 2));
    for (const path of protectedPaths) assert.deepEqual(snapshotTreeBytes(path), protectedContents.get(path), path);
    assert.deepEqual(snapshotTreeBytes(thirdPartyCachePath), thirdPartyContents, thirdPartyCachePath);
    for (const path of thirdPartyVersionPaths) assert.deepEqual(snapshotTreeBytes(path), thirdPartyVersionContents.get(path), path);
    assert.equal(calls.some((call) => call.join(" ") === "claude plugin uninstall h2a@sentropic"), false);
    assert.equal(calls.some((call) => call.join(" ") === "claude plugin uninstall openai-h2a-local-fixture"), false);
    assert.equal(calls.some((call) => call.join(" ").includes(thirdPartyCachePath)), false);
    assert.equal(
      calls.some((call) => [thirdPartyCachePath, ...thirdPartyVersionPaths].some((path) => call.join(" ").includes(path))),
      false
    );
    assert.equal(
      report.hosts.flatMap((host) => host.plannedActions).some((action) => [thirdPartyCachePath, ...thirdPartyVersionPaths].some((path) => action.includes(path))),
      false
    );
    assert.equal(
      report.hosts.flatMap((host) => host.findings).some(
        (entry) => [thirdPartyCachePath, ...thirdPartyVersionPaths].some((path) => entry.message.includes(path))
      ),
      false,
      "an unproven third-party cache must not receive a manual removal command"
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair dispatches only the ratified plugin uninstall allowset", () => {
  const { home, version } = cleanShippedLayoutHome();
  const root = join(home, "bus");
  const thirdPartySelectors = ["openai", "anthropic", "foo"].flatMap((owner) =>
    ["@sentropic-local-x", "@sentropic-preview-x", "-local-x", "@sentropic"].map((suffix) => `${owner}${suffix}`)
  );
  const authorizedSelectors = ["h2a-local-claude-08518", "h2a@sentropic-local-claude-08518", "track@sentropic"];
  try {
    const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
    const installed = JSON.parse(readFileSync(installedPath, "utf8"));
    for (const selector of [...thirdPartySelectors, ...authorizedSelectors]) {
      installed.plugins[selector] = [{
        scope: "user",
        installPath: join(home, ".claude", "plugins", "cache", "fixture", selector),
        version: "1.0.0"
      }];
    }
    for (const selector of authorizedSelectors) {
      const installPath = installed.plugins[selector][0].installPath;
      if (selector === "track@sentropic") {
        writeJson(join(installPath, ".claude-plugin", "plugin.json"), { name: "track", version: "1.0.0" });
      } else {
        currentPlugin(installPath);
      }
    }
    writeJson(installedPath, installed);

    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const calls = [];
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({
        home,
        version,
        repair: true,
        runHostCommand: (command, args) => {
          calls.push([command, ...args]);
          if (command === "claude" && args[0] === "plugin" && args[1] === "uninstall") {
            const next = JSON.parse(readFileSync(installedPath, "utf8"));
            delete next.plugins[args[2]];
            writeJson(installedPath, next);
          }
          return { ok: true };
        }
      })
    });
    const report = JSON.parse(io.stdoutText);
    const uninstalls = calls.filter((call) => call[0] === "claude" && call[1] === "plugin" && call[2] === "uninstall");

    assert.deepEqual(
      uninstalls,
      authorizedSelectors.map((selector) => ["claude", "plugin", "uninstall", selector]),
      JSON.stringify(calls, null, 2)
    );
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair reports a refused Claude plugin uninstall", () => {
  const { home, version } = cleanShippedLayoutHome();
  const root = join(home, "bus");
  const selector = "openai@sentropic-local-x";
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const runRepair = (dryRun) => {
      const calls = [];
      const io = streams(home);
      const exitCode = runCli(["doctor", "--root", root, "--repair", ...(dryRun ? ["--dry-run"] : [])], io, {
        doctorHostInstallations: (options) => doctorHostInstallations({
          home,
          version,
          repair: options.repair,
          dryRun: options.dryRun,
          testClaudePluginUninstalls: [selector],
          runHostCommand: (command, args) => {
            calls.push([command, ...args]);
            return { ok: true };
          }
        })
      });
      return { calls, exitCode, report: JSON.parse(io.stdoutText) };
    };

    const actual = runRepair(false);
    const dryRun = runRepair(true);
    const dryClaude = dryRun.report.checks.hostInstallations.hosts.find((host) => host.host === "claude");
    const refusals = (actual.report.unrepaired ?? []).filter((entry) => entry.code === "host-command-refused");
    const dryRunRefusals = (dryRun.report.unrepaired ?? []).filter((entry) => entry.code === "host-command-refused");

    assert.equal(actual.calls.some((call) => call.join(" ") === `claude plugin uninstall ${selector}`), false);
    assert.equal(dryRun.calls.some((call) => call.join(" ") === `claude plugin uninstall ${selector}`), false);
    assert.deepEqual(dryClaude.plannedActions, []);
    assert.equal(refusals.length, 1, JSON.stringify(actual.report, null, 2));
    assert.match(refusals[0].message, /claude plugin uninstall openai@sentropic-local-x/);
    assert.equal(actual.report.ok, false, JSON.stringify(actual.report, null, 2));
    assert.equal(actual.exitCode, 2);
    assert.equal(dryRunRefusals.length, 1, JSON.stringify(dryRun.report, null, 2));
    assert.equal(dryRun.report.ok, false, JSON.stringify(dryRun.report, null, 2));
    assert.equal(dryRun.exitCode, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("h2a doctor remains a bus-only health probe until the explicit repair action", () => {
  const home = fixtureHome();
  const root = join(home, "bus");
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const before = snapshotTree(home);
    const io = streams(home);
    assert.equal(
      runCli(["doctor", "--root", root], io, {
        doctorHostInstallations: () => assert.fail("doctor without --repair must not invoke a native host installation check")
      }),
      0,
      io.stderrText
    );
    const report = JSON.parse(io.stdoutText);
    assert.equal(report.ok, true);
    assert.equal(report.checks.hostInstallations.skipped, true);
    assert.deepEqual(snapshotTree(home), before, "doctor without --repair must not change the host or bus state");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor requires restart when a live session predates a host repair", () => {
  const home = fixtureHome();
  try {
    const repaired = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: repairRunner(home, [])
    });
    const codex = repaired.hosts.find((host) => host.host === "codex");
    assert.ok(codex?.repairMarker, JSON.stringify(repaired, null, 2));
    assert.ok(codex.changed.length > 0, JSON.stringify(repaired, null, 2));
    const live = findLiveSessionsPredatingHostConfig(
      [{
        sessionId: "sess-before-repair",
        instance: "codex:plugins:123456789abc",
        host: "codex",
        startedAt: "2000-01-01T00:00:00.000Z",
        heartbeatAt: new Date().toISOString(),
        state: "live",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: []
      }],
      repaired.hosts
    );
    assert.equal(live.length, 1);
    assert.match(live[0].message, /must be restarted/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair exits 2 when a live Codex session predates a cache version repair", () => {
  const home = cacheVersionDriftHome();
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writePresence(root, {
      sessionId: "sess-before-cache-repair",
      instance: "codex:plugins:123456789abc",
      host: "codex",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: []
    });
    const before = doctorHostInstallations({ home, version: VERSION });
    const codexBefore = before.hosts.find((host) => host.host === "codex");
    assert.deepEqual(codexBefore?.findings.map((entry) => entry.code), ["version-skew", "orphan-cache"]);

    const calls = [];
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({
        home,
        version: VERSION,
        repair: true,
        runHostCommand: repairRunner(home, calls)
      })
    });
    const report = JSON.parse(io.stdoutText);
    const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.equal(codex.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(codex.changed, [
      join(home, ".codex", "plugins", "cache", "sentropic", "h2a", "0.87.0"),
      join(home, ".codex", "h2a-repair.json")
    ]);
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin marketplace upgrade"));
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin add h2a@sentropic"));
    assert.deepEqual(
      report.checks.liveHostSessions.restartRequired.map((entry) => entry.sessionId),
      ["sess-before-cache-repair"]
    );
    assert.ok(report.unrepaired.some((entry) => entry.code === "live-session-restart-required"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair exits 2 when an existing Codex plugin directory is overwritten in place", () => {
  const { home, manifestPath, loadedCodePath } = inPlaceCacheVersionDriftHome();
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writePresence(root, {
      sessionId: "sess-before-in-place-repair",
      instance: "codex:plugins:123456789abc",
      host: "codex",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: []
    });
    const before = doctorHostInstallations({ home, version: VERSION });
    const codexBefore = before.hosts.find((host) => host.host === "codex");
    assert.deepEqual(codexBefore?.findings.map((entry) => entry.code), ["version-skew"]);
    assert.ok(codexBefore?.coherencePaths.every((path) => statSync(path).mtimeMs < Date.parse("2020-01-01T00:00:00.000Z")));
    assert.ok(statSync(manifestPath).mtimeMs < Date.parse("2020-01-01T00:00:00.000Z"));
    assert.ok(statSync(loadedCodePath).mtimeMs < Date.parse("2020-01-01T00:00:00.000Z"));

    const calls = [];
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({
        home,
        version: VERSION,
        repair: true,
        runHostCommand: inPlaceRepairRunner(home, calls)
      })
    });
    const report = JSON.parse(io.stdoutText);
    const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.equal(codex.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(codex.changed, [join(home, ".codex", "h2a-repair.json")]);
    assert.equal(codex.repairMarker.path, join(home, ".codex", "h2a-repair.json"));
    assert.ok(Date.parse(codex.repairMarker.repairedAt) > Date.parse("2020-01-01T00:00:00.000Z"));
    assert.ok(codex.repairMarker.repairedPaths.includes(manifestPath));
    assert.ok(codex.repairMarker.repairedPaths.includes(loadedCodePath));
    assert.equal(codex.repairMarker.repairedPaths.includes(join(home, ".codex", "config.toml")), false);
    assert.equal(
      codex.repairMarker.repairedPaths.includes(join(home, ".codex", ".tmp", "marketplaces", "sentropic", ".claude-plugin", "marketplace.json")),
      false
    );
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin marketplace upgrade"));
    assert.ok(calls.some((call) => call.join(" ") === "codex plugin add h2a@sentropic"));
    assert.ok(statSync(manifestPath).mtimeMs > Date.parse("2020-01-01T00:00:00.000Z"));
    assert.ok(statSync(loadedCodePath).mtimeMs > Date.parse("2020-01-01T00:00:00.000Z"));
    assert.deepEqual(
      report.checks.liveHostSessions.restartRequired.map((entry) => entry.sessionId),
      ["sess-before-in-place-repair"]
    );
    assert.ok(report.unrepaired.some((entry) => entry.code === "live-session-restart-required"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when an existing Codex repair marker cannot be read", () => {
  const { home } = inPlaceCacheVersionDriftHome();
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    currentPlugin(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION));
    writeFileSync(markerPath, "not JSON\n");
    const report = doctorHostInstallations({ home, version: VERSION });
    const codex = report.hosts.find((host) => host.host === "codex");
    assert.equal(report.ok, false);
    assert.equal(codex?.ok, false);
    assert.ok(
      codex?.findings.some((entry) => entry.code === "repair-marker-unavailable" && entry.path === markerPath),
      JSON.stringify(report, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when a Codex repair marker omits repaired paths", () => {
  const { home } = cleanCodexHomeWithoutMarker();
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    writeJson(markerPath, { repairedAt: "2020-01-01T00:00:00.000Z" });
    const report = doctorHostInstallations({ home, version: VERSION });
    const codex = report.hosts.find((host) => host.host === "codex");
    assert.equal(report.ok, false);
    assert.equal(codex?.ok, false);
    assert.ok(
      codex?.findings.some((entry) => entry.code === "repair-marker-unavailable" && entry.path === markerPath),
      JSON.stringify(report, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when a Codex repair marker cannot be written", () => {
  const { home } = inPlaceCacheVersionDriftHome();
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    mkdirSync(markerPath);
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: inPlaceRepairRunner(home, [])
    });
    const codex = report.hosts.find((host) => host.host === "codex");
    assert.equal(report.ok, false);
    assert.equal(codex?.ok, false);
    assert.ok(
      codex?.unrepaired.some((entry) =>
        entry.code === "repair-marker-unavailable" && /cannot write host repair marker/.test(entry.message)
      ),
      JSON.stringify(report, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair exits 2 when a live Codex session has no repair marker", () => {
  const { home } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writePresence(root, {
      sessionId: "sess-without-repair-marker",
      instance: "codex:plugins:123456789abc",
      host: "codex",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: []
    });
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({ home, version: VERSION, repair: true })
    });
    const report = JSON.parse(io.stdoutText);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.equal(existsSync(markerPath), false);
    assert.deepEqual(
      report.checks.liveHostSessions.restartRequired.map((entry) => entry.sessionId),
      ["sess-without-repair-marker"]
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair fails closed when a live Codex session timestamp is invalid", () => {
  const { home } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-with-invalid-started-at", "not-a-timestamp");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.equal(report.checks.liveSessions.count, 1);
    assert.equal(report.checks.liveHostSessions.restartRequired.length, 1);
    assert.match(report.checks.liveHostSessions.restartRequired[0].message, /cannot verify.*start/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor states that an external runtime overwrite is outside its restart guarantee", () => {
  const { home, manifestPath, loadedCodePath } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    writeJson(markerPath, {
      repairedAt: "2010-01-01T00:00:00.000Z",
      repairedPaths: [loadedCodePath]
    });
    const beforeExternalUpdate = doctorHostInstallations({ home, version: VERSION });
    const codexBeforeExternalUpdate = beforeExternalUpdate.hosts.find((host) => host.host === "codex");
    assert.ok(codexBeforeExternalUpdate?.coherencePaths.includes(manifestPath));
    assert.ok(codexBeforeExternalUpdate?.coherencePaths.includes(loadedCodePath));
    writeFileSync(loadedCodePath, "export const loadedVersion = 'externally-reinstalled';\n");
    const externalUpdate = new Date("2021-01-01T00:00:00.000Z");
    utimesSync(loadedCodePath, externalUpdate, externalUpdate);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writePresence(root, {
      sessionId: "sess-before-external-runtime-overwrite",
      instance: "codex:plugins:123456789abc",
      host: "codex",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: []
    });
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({ home, version: VERSION, repair: true })
    });
    const report = JSON.parse(io.stdoutText);
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true);
    assert.equal(
      report.checks.hostInstallations.sessionFreshnessGuarantee,
      "doctor guarantees the coherence of the repairs it performed. It does not detect installation changes made by other tools; after changing your installation by hand, restart your sessions."
    );
    assert.deepEqual(report.checks.liveHostSessions.restartRequired, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor states the native host CLI partial-failure limit", () => {
  const { home, version } = cleanShippedLayoutHome();
  const root = join(home, "bus");
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair"], io, {
      doctorHostInstallations: () => doctorHostInstallations({ home, version, repair: true })
    });
    const report = JSON.parse(io.stdoutText);
    assert.equal(exitCode, 0, io.stderrText);
    const nativeCommandFailureLimit = report.checks.hostInstallations.nativeCommandFailureLimit;
    assert.equal(
      nativeCommandFailureLimit,
      "If a native host CLI fails after it has already changed the installation, doctor reports the failure as host-command-failed and does not undo what that CLI already did. Doctor's own configuration writes are atomic. It has no snapshot of third-party state and does not simulate one: a partial restore would promise a recovery it cannot deliver. After a reported native failure, verify the host installation before relying on it."
    );
    const doctorContract = H2A_CLI_VERB_CONTRACTS.find((contract) => contract.verb === "doctor");
    assert.ok(doctorContract?.description.includes(nativeCommandFailureLimit));
    assert.ok(readFileSync(new URL("../../../docs/uat/doctor-repair.md", import.meta.url), "utf8").includes(nativeCommandFailureLimit));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor does not refresh a Codex repair marker when successful native commands repair nothing", () => {
  const { home } = inPlaceCacheVersionDriftHome();
  const markerPath = join(home, ".codex", "h2a-repair.json");
  const calls = [];
  try {
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: (command, args) => {
        calls.push([command, ...args]);
        return { ok: true };
      }
    });
    const codex = report.hosts.find((host) => host.host === "codex");
    assert.equal(report.ok, false);
    assert.equal(existsSync(markerPath), false);
    assert.deepEqual(codex?.changed, []);
    assert.equal(calls.filter(([command]) => command === "codex").length, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when a post-write repair marker re-read is invalid", () => {
  const { home } = inPlaceCacheVersionDriftHome();
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: inPlaceRepairRunner(home, []),
      writeRepairMarker: (path) => writeFileSync(path, "truncated marker\n")
    });
    const codex = report.hosts.find((host) => host.host === "codex");
    assert.equal(report.ok, false);
    assert.equal(codex?.ok, false);
    assert.equal(codex?.repairMarker, undefined);
    assert.ok(
      codex?.unrepaired.some((entry) =>
        entry.code === "repair-marker-unavailable" && /cannot write host repair marker/.test(entry.message)
      ),
      JSON.stringify(report, null, 2)
    );
    assert.equal(readFileSync(markerPath, "utf8"), "truncated marker\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor identifies an existing but unavailable repair marker for a live Codex session", () => {
  const { home } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    mkdirSync(markerPath);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-with-unavailable-marker");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.match(report.checks.liveHostSessions.restartRequired[0].message, /it is unavailable/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor requires restart from a repair marker even when every declared runtime artifact predates the session", () => {
  const { home, loadedCodePath } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const markerPath = join(home, ".codex", "h2a-repair.json");
  try {
    writeRepairMarker(home, [loadedCodePath], "2021-01-01T00:00:00.000Z");
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-marker-only-repair");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.deepEqual(
      report.checks.liveHostSessions.restartRequired.map((entry) => entry.configPath),
      [markerPath]
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when a declared runtime artifact is unreadable", () => {
  const { home } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const pluginRoot = join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION);
  const privateDirectory = join(pluginRoot, "private-runtime");
  const runtimePath = join(privateDirectory, "runtime.js");
  try {
    mkdirSync(privateDirectory);
    writeFileSync(runtimePath, "export const runtime = 'private';\n");
    writeJson(join(pluginRoot, ".mcp.json"), {
      mcpServers: { h2a: { command: "node", args: ["./private-runtime/runtime.js"] } }
    });
    const beforeSession = new Date("2000-01-01T00:00:00.000Z");
    utimesSync(join(pluginRoot, ".mcp.json"), beforeSession, beforeSession);
    writeRepairMarker(home, [runtimePath]);
    chmodSync(privateDirectory, 0o000);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-unreadable-runtime");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.ok(
      report.checks.hostInstallations.hosts
        .find((host) => host.host === "codex")
        .findings.some((entry) => entry.code === "runtime-artifact-unavailable" && entry.path === runtimePath),
      JSON.stringify(report, null, 2)
    );
    assert.deepEqual(report.checks.liveHostSessions.restartRequired, []);
  } finally {
    chmodSync(privateDirectory, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor fails closed when a declared runtime artifact is missing", () => {
  const { home, loadedCodePath } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  try {
    writeRepairMarker(home, [loadedCodePath]);
    unlinkSync(loadedCodePath);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-deleted-runtime");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.ok(
      report.checks.hostInstallations.hosts
        .find((host) => host.host === "codex")
        .findings.some((entry) => entry.code === "runtime-artifact-unavailable" && entry.path === loadedCodePath),
      JSON.stringify(report, null, 2)
    );
    assert.deepEqual(report.checks.liveHostSessions.restartRequired, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor resolves a symlinked declared runtime only for repair provenance", () => {
  const { home, loadedCodePath } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const runtimeTarget = join(home, "external-runtime.js");
  try {
    writeFileSync(runtimeTarget, "export const runtime = 'external';\n");
    const externalUpdate = new Date("2021-01-01T00:00:00.000Z");
    utimesSync(runtimeTarget, externalUpdate, externalUpdate);
    unlinkSync(loadedCodePath);
    symlinkSync(runtimeTarget, loadedCodePath);
    writeRepairMarker(home, [loadedCodePath]);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-symlink-runtime-update");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true);
    assert.ok(
      report.checks.hostInstallations.hosts
        .find((host) => host.host === "codex")
        .coherencePaths.includes(runtimeTarget),
      JSON.stringify(report, null, 2)
    );
    assert.deepEqual(report.checks.liveHostSessions.restartRequired, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor ignores non-load-bearing plugin cache files changed after a live session", () => {
  const { home, loadedCodePath } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  const pluginRoot = join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION);
  try {
    const noise = [
      join(pluginRoot, "diagnostic.log"),
      join(pluginRoot, "tmp", "download.tmp"),
      join(pluginRoot, "docs-not-loaded", "notes.txt")
    ];
    for (const path of noise) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "not runtime code\n");
      const externalUpdate = new Date("2021-01-01T00:00:00.000Z");
      utimesSync(path, externalUpdate, externalUpdate);
    }
    writeRepairMarker(home, [loadedCodePath]);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-cache-noise");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.checks.liveHostSessions.restartRequired, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --repair --dry-run reports host repair work without mutating host files", () => {
  const home = fixtureHome();
  const root = join(home, "bus");
  const calls = [];
  try {
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-dry-run");
    const before = snapshotTree(home);
    const io = streams(home);
    const exitCode = runCli(["doctor", "--root", root, "--repair", "--dry-run"], io, {
      doctorHostInstallations: (options) => doctorHostInstallations({
        ...options,
        home,
        version: VERSION,
        runHostCommand: repairRunner(home, calls)
      })
    });
    const report = JSON.parse(io.stdoutText);
    assert.equal(exitCode, 2, io.stderrText);
    assert.equal(report.ok, false);
    assert.equal(report.checks.hostInstallations.dryRun, true);
    assert.ok(report.checks.hostInstallations.hosts.some((host) => host.plannedActions.length > 0));
    assert.deepEqual(calls, []);
    assert.deepEqual(snapshotTree(home), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ACCEPTANCE PROPERTY of the v1 form, written by `plugins` BEFORE the implementation and
// EXPECTED TO FAIL until it lands.
//
// CORRECTED after the building lane refused the first version and was right to: that version
// injected a runner returning ok with NO side effect, so nothing was actually repaired and
// `ok=false` was the correct verdict. It demanded that doctor call a still-broken installation
// clean. The lane refused to weaken the product's safety checks for a faulty test — which is
// exactly what it was asked to do.
//
// This version isolates the two rules instead: it starts from a GENUINELY HEALTHY installation
// (the shipped layout) and adds only the two artifacts the v1 repair deliberately leaves behind —
// a DISABLED legacy plugin entry, and an orphan legacy cache on disk. That is the state a
// successful v1 repair produces, so doctor must report it clean.
//
//   1. `plugin-stale` must account for `enabled = false`: a DISABLED legacy entry is
//      NEUTRALISED, not stale.
//   2. `orphan-cache` must be INFORMATIONAL and must not break `ok`, because v1 deliberately
//      does not delete it.
//
// A repair whose own result is still reported as broken is not a repair: an owner told "broken"
// after a successful --repair learns to ignore doctor, and will ignore it on the day the report
// is true.
test("doctor reports clean on the state a successful v1 repair leaves (v1 acceptance, RED until v1 lands)", () => {
  const { home, version } = cleanShippedLayoutHome();
  const root = join(home, "bus");
  assert.equal(runCli(["init", "--root", root], streams(home)), 0);

  // What v1 deliberately leaves behind: our own legacy entry, DISABLED, and its orphan cache.
  const codexPath = join(home, ".codex", "config.toml");
  writeFileSync(
    codexPath,
    `${readFileSync(codexPath, "utf8").trimEnd()}\n\n[plugins."h2a-local-codex-08518@sentropic-local-codex-08518"]\nenabled = false\n`
  );
  const orphan = join(home, ".codex", "plugins", "cache", "sentropic-local-codex-08518", "h2a-local-codex-08518", "0.85.18");
  mkdirSync(orphan, { recursive: true });
  writeJson(join(orphan, ".codex-plugin", "plugin.json"), { name: "h2a-local-codex-08518", version: "0.85.18" });

  // The fixture builds the cache at the SHIPPED version, so doctor must be told that version —
  // otherwise it reports a spurious version-skew against the test placeholder. Found by the
  // building lane, second defect it caught in this test of mine.
  const { exitCode, report } = runRepairDoctor(home, root, { version });
  const codex = report.checks.hostInstallations.hosts.find((host) => host.host === "codex");
  const blocking = (codex?.findings ?? []).filter((finding) => finding.code !== "orphan-cache");
  assert.deepEqual(
    blocking,
    [],
    `a DISABLED legacy entry is neutralised, not stale: ${JSON.stringify(codex?.findings, null, 2)}`
  );
  assert.equal(report.ok, true, `an orphan cache v1 deliberately keeps must not break ok: ${JSON.stringify(report, null, 2)}`);
  assert.equal(exitCode, 0);
});

test("doctor keeps orphan caches informational and gives their exact manual removal command", () => {
  const { home, version } = cleanShippedLayoutHome();
  const orphan = join(home, ".codex", "plugins", "cache", "sentropic-local-codex-08518");
  try {
    currentPlugin(join(orphan, "h2a", "0.85.18"));

    const report = doctorHostInstallations({ home, version });
    const codex = report.hosts.find((host) => host.host === "codex");
    const orphanFinding = codex?.findings.find((entry) => entry.code === "orphan-cache");

    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(
      orphanFinding?.message,
      `Codex has orphan H2A cache directories: sentropic-local-codex-08518. Remove them manually with: rm -rf -- '${orphan}'`
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reads disabled Claude plugins and dead marketplaces from both Claude registries", () => {
  const { home, version } = cleanShippedLayoutHome();
  const settingsPath = join(home, ".claude", "settings.json");
  const knownPath = join(home, ".claude", "plugins", "known_marketplaces.json");
  const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
  const legacyPlugin = "h2a-local-claude-08518@sentropic-local-claude-08518";
  const legacyMarketplace = "sentropic-local-claude-08518";
  try {
    const installed = JSON.parse(readFileSync(installedPath, "utf8"));
    installed.plugins[legacyPlugin] = [{ scope: "user", version: "0.85.18" }];
    writeJson(installedPath, installed);
    writeJson(settingsPath, {
      enabledPlugins: { [legacyPlugin]: false },
      extraKnownMarketplaces: {
        [legacyMarketplace]: { source: { source: "directory", path: "/deleted/tmp/deploy-08518" } }
      }
    });

    const fromSettings = doctorHostInstallations({ home, version }).hosts.find((host) => host.host === "claude");
    assert.equal(fromSettings?.findings.some((entry) => entry.code === "plugin-stale"), false, JSON.stringify(fromSettings, null, 2));
    assert.equal(
      fromSettings?.findings.find((entry) => entry.code === "marketplace-stale")?.path,
      settingsPath,
      JSON.stringify(fromSettings, null, 2)
    );

    const known = JSON.parse(readFileSync(knownPath, "utf8"));
    known[legacyMarketplace] = { source: { source: "directory", path: "/deleted/tmp/deploy-08518" } };
    writeJson(knownPath, known);
    writeJson(settingsPath, { enabledPlugins: { [legacyPlugin]: false } });

    const fromKnown = doctorHostInstallations({ home, version }).hosts.find((host) => host.host === "claude");
    assert.equal(fromKnown?.findings.some((entry) => entry.code === "plugin-stale"), false, JSON.stringify(fromKnown, null, 2));
    assert.equal(
      fromKnown?.findings.find((entry) => entry.code === "marketplace-stale")?.path,
      knownPath,
      JSON.stringify(fromKnown, null, 2)
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor repair removes an owned stale Claude marketplace present only in settings", () => {
  const { home, version } = cleanShippedLayoutHome();
  const settingsPath = join(home, ".claude", "settings.json");
  const legacyMarketplace = "sentropic-local-settings-only";
  const legacyMarketplacePath = join(home, ".claude", "plugins", "marketplaces", legacyMarketplace);
  try {
    currentMarketplace(legacyMarketplacePath);
    writeJson(settingsPath, {
      custom: "preserve",
      extraKnownMarketplaces: {
        [legacyMarketplace]: {
          source: { source: "directory", path: legacyMarketplacePath }
        }
      }
    });

    const calls = [];
    const repaired = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: repairRunner(home, calls, version)
    });
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const rerun = doctorHostInstallations({ home, version });

    assert.equal(repaired.ok, true, JSON.stringify(repaired, null, 2));
    assert.deepEqual(repaired.hosts.flatMap((host) => host.unrepaired), [], JSON.stringify(repaired, null, 2));
    assert.equal(settings.custom, "preserve");
    assert.equal(Object.hasOwn(settings.extraKnownMarketplaces, legacyMarketplace), false);
    assert.ok(
      calls.some((call) => call.join(" ") === "claude plugin marketplace add rhanka/h2a"),
      JSON.stringify(calls, null, 2)
    );
    assert.equal(rerun.ok, true, JSON.stringify(rerun, null, 2));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor leaves an unproven stale Claude settings-only marketplace byte-identical", () => {
  const { home, version } = cleanShippedLayoutHome();
  const settingsPath = join(home, ".claude", "settings.json");
  const legacyMarketplace = "sentropic-local-unproven-settings-only";
  const settings = `${JSON.stringify({
    custom: "preserve",
    extraKnownMarketplaces: {
      [legacyMarketplace]: { source: { source: "directory", path: "/deleted/tmp/deploy-08518" } }
    }
  }, null, 2)}\n`;
  try {
    writeFileSync(settingsPath, settings);

    const repaired = doctorHostInstallations({
      home,
      version,
      repair: true,
      runHostCommand: repairRunner(home, [], version)
    });
    const claude = repaired.hosts.find((host) => host.host === "claude");

    assert.equal(repaired.ok, false, JSON.stringify(repaired, null, 2));
    assert.ok(
      claude?.unrepaired.some((entry) => entry.code === "ownership-unverified" && entry.path === settingsPath),
      JSON.stringify(claude, null, 2)
    );
    assert.equal(readFileSync(settingsPath, "utf8"), settings);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
