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
  doctorHostInstallations,
  findLiveSessionsPredatingHostConfig,
  runCli,
  writePresence
} from "../dist/index.js";

const VERSION = "9.8.7";

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function currentPlugin(path) {
  mkdirSync(join(path, ".codex-plugin"), { recursive: true });
  writeJson(join(path, ".codex-plugin", "plugin.json"), { name: "h2a", version: VERSION });
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
      'source = "/deleted/tmp/deploy-08518"',
      ""
    ].join("\n")
  );
  // `codex mcp list` may still show this cached enabled plugin even though its
  // only marketplace was a deleted local directory. A current cache therefore
  // cannot certify the installation by itself.
  currentPlugin(join(codex, "plugins", "cache", "sentropic", "h2a", VERSION));
  currentPlugin(join(codex, "plugins", "cache", "sentropic-local-codex-08518", "h2a", "0.85.18"));

  const claudePluginPath = join(claude, "plugins", "cache", "sentropic", "h2a", "0.85.18");
  currentPlugin(claudePluginPath);
  currentPlugin(join(claude, "plugins", "cache", "sentropic-local-claude-08518", "h2a", "0.85.18"));
  writeJson(join(claude, "plugins", "known_marketplaces.json"), {
    "sentropic-local-claude-08518": {
      source: { source: "directory", path: "/deleted/tmp/deploy-08518" },
      installLocation: "/deleted/tmp/deploy-08518"
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

function repairRunner(home, calls) {
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
      currentPlugin(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION));
      currentMarketplace(join(home, ".codex", ".tmp", "marketplaces", "sentropic"));
      return { ok: true };
    }
    const pluginPath = join(home, ".claude", "plugins", "cache", "sentropic", "h2a", VERSION);
    currentPlugin(pluginPath);
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
        "h2a@sentropic": [{ scope: "user", installPath: pluginPath, version: VERSION }]
      }
    });
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

test("doctor treats a cached enabled Codex plugin from a legacy marketplace as false healthy and repairs it idempotently", () => {
  const home = fixtureHome();
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
      "a current Codex cache must still be unhealthy when its marketplace source disappeared"
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
    assert.ok(
      calls.some((call) => call.join(" ") === "codex plugin marketplace add rhanka/h2a --ref main"),
      "a disappeared local source requires a native Git marketplace add"
    );
    assert.equal(
      calls.some((call) => call.join(" ") === "codex plugin marketplace upgrade"),
      false,
      "marketplace upgrade is a no-op for a vanished local source, never its repair"
    );
    assert.ok(calls.some((call) => call[0] === "claude" && (call.includes("install") || call.includes("update"))));

    const codex = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    assert.match(codex, /\[plugins\."h2a@sentropic"\]/);
    assert.match(codex, /source = "https:\/\/github\.com\/rhanka\/h2a\.git"/);
    assert.doesNotMatch(codex, /sentropic-local|\[mcp_servers\.(h2a|track)\]/);
    assert.ok(existsSync(join(home, ".codex", "plugins", "cache", "sentropic", "h2a", VERSION)));

    const claudeMcp = JSON.parse(readFileSync(join(home, ".config", "claude", "mcp.json"), "utf8"));
    assert.deepEqual(claudeMcp.mcpServers, { other: { command: "other-mcp", args: ["serve"] } });
    assert.equal(existsSync(join(home, ".claude", "plugins", "cache", "sentropic", "h2a", "0.85.18")), false);

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
  try {
    for (const path of protectedPaths) {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "third-party.txt"), "must survive repair\n");
    }
    const installedPath = join(home, ".claude", "plugins", "installed_plugins.json");
    const installed = JSON.parse(readFileSync(installedPath, "utf8"));
    installed.plugins["openai-h2a-local-fixture"] = [];
    writeJson(installedPath, installed);

    const calls = [];
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: repairRunner(home, calls)
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    for (const path of protectedPaths) assert.equal(existsSync(path), true, path);
    assert.equal(calls.some((call) => call.join(" ") === "claude plugin uninstall h2a@sentropic"), false);
    assert.equal(calls.some((call) => call.join(" ") === "claude plugin uninstall openai-h2a-local-fixture"), false);
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

test("doctor reports an unreadable declared runtime diagnostically without a restart verdict", () => {
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
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true);
    assert.ok(
      report.checks.hostInstallations.hosts
        .find((host) => host.host === "codex")
        .diagnostics.some((entry) => entry.code === "runtime-artifact-unavailable" && entry.path === runtimePath),
      JSON.stringify(report, null, 2)
    );
    assert.deepEqual(report.checks.liveHostSessions.restartRequired, []);
  } finally {
    chmodSync(privateDirectory, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports a missing declared runtime diagnostically without a restart verdict", () => {
  const { home, loadedCodePath } = cleanCodexHomeWithoutMarker();
  const root = join(home, "bus");
  try {
    writeRepairMarker(home, [loadedCodePath]);
    unlinkSync(loadedCodePath);
    assert.equal(runCli(["init", "--root", root], streams(home)), 0);
    writeLiveCodexSession(root, "sess-before-deleted-runtime");
    const { exitCode, io, report } = runRepairDoctor(home, root);
    assert.equal(exitCode, 0, io.stderrText);
    assert.equal(report.ok, true);
    assert.ok(
      report.checks.hostInstallations.hosts
        .find((host) => host.host === "codex")
        .diagnostics.some((entry) => entry.code === "runtime-artifact-unavailable" && entry.path === loadedCodePath),
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
