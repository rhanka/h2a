import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  doctorHostInstallations,
  findLiveSessionsPredatingHostConfig,
  runCli
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

test("doctor treats a cached enabled Codex plugin from a vanished marketplace as false healthy and repairs it idempotently", () => {
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
    const report = doctorHostInstallations({
      home,
      version: VERSION,
      repair: true,
      runHostCommand: () => ({ ok: false, message: "host CLI unavailable" })
    });
    assert.equal(report.ok, false);
    assert.ok(
      report.hosts.some((host) => host.unrepaired.some((entry) => entry.code === "host-command-failed")),
      JSON.stringify(report, null, 2)
    );
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
    const io = streams(home);
    assert.equal(runCli(["doctor", "--root", root], io), 0, io.stderrText);
    const report = JSON.parse(io.stdoutText);
    assert.equal(report.ok, true);
    assert.equal(report.checks.hostInstallations.skipped, true);
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
