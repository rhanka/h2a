import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  autoRepairHostInstallations,
  detectHostVersionDrift,
  runCli,
  runMcpServe
} from "../dist/index.js";

const OLD_VERSION = "0.98.8";
const NEW_VERSION = "0.98.9";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeOwnedPlugin(pluginRoot, version) {
  writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
    name: "h2a",
    version
  });
  writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name: "h2a",
    version
  });
}

function writeOwnedMarketplace(marketplaceRoot) {
  writeJson(join(marketplaceRoot, ".claude-plugin", "marketplace.json"), {
    name: "sentropic",
    plugins: [{ name: "h2a", source: "./packages/h2a" }]
  });
}

function createHostFixture(t, initialVersion = OLD_VERSION) {
  const base = mkdtempSync(join(tmpdir(), "h2a-auto-repair-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "home");
  const root = join(base, "bus");
  mkdirSync(home, { recursive: true });

  // Initialize bus root with schema sentinel
  runCli(["init", "--root", root], {
    stdout: { write() {} },
    stderr: { write() {} }
  });

  // Seed Claude plugin installation at initialVersion
  const claudeRoot = join(home, ".claude");
  const claudeMarketplace = join(claudeRoot, "plugins", "marketplaces", "sentropic");
  const claudePluginPath = join(claudeRoot, "plugins", "cache", "sentropic", "h2a", initialVersion);
  writeOwnedMarketplace(claudeMarketplace);
  writeOwnedPlugin(claudePluginPath, initialVersion);
  writeJson(join(claudeRoot, "plugins", "known_marketplaces.json"), {
    sentropic: {
      source: { source: "github", repo: "rhanka/h2a" },
      installLocation: claudeMarketplace
    }
  });
  writeJson(join(claudeRoot, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "h2a@sentropic": [
        {
          scope: "user",
          installPath: claudePluginPath,
          version: initialVersion
        }
      ]
    }
  });

  // Seed Vibe native host installation at initialVersion
  const vibeRoot = join(home, ".vibe");
  mkdirSync(vibeRoot, { recursive: true });
  writeFileSync(
    join(vibeRoot, "config.toml"),
    '[[mcp_servers]]\nname = "h2a"\ntransport = "stdio"\ncommand = "h2a"\nargs = ["mcp-serve", "--auto-open", "--host", "vibe"]\n'
  );
  writeJson(join(vibeRoot, ".h2a-install", "manifest.json"), {
    schema: 1,
    host: "vibe",
    root: vibeRoot,
    version: initialVersion,
    files: {}
  });

  return { base, home, root, claudeRoot, vibeRoot };
}

function makeClaudeRepairRunner(home, targetVersion, calls, options = {}) {
  return (command, args) => {
    calls.push([command, ...args]);
    if (options.fail) {
      return { ok: false, message: options.failMessage ?? "simulated native CLI failure" };
    }
    if (command === "claude") {
      const claudeRoot = join(home, ".claude");
      const marketplacePath = join(claudeRoot, "plugins", "marketplaces", "sentropic");
      const pluginPath = join(claudeRoot, "plugins", "cache", "sentropic", "h2a", targetVersion);
      writeOwnedMarketplace(marketplacePath);
      writeOwnedPlugin(pluginPath, targetVersion);
      writeJson(join(claudeRoot, "plugins", "known_marketplaces.json"), {
        sentropic: {
          source: { source: "github", repo: "rhanka/h2a" },
          installLocation: marketplacePath
        }
      });
      writeJson(join(claudeRoot, "plugins", "installed_plugins.json"), {
        version: 2,
        plugins: {
          "h2a@sentropic": [
            {
              scope: "user",
              installPath: pluginPath,
              version: targetVersion
            }
          ]
        }
      });
    }
    return { ok: true };
  };
}

test("auto-repair after upgrade: version mismatch is repaired once and logged to the bus", async (t) => {
  const { home, root, claudeRoot, vibeRoot } = createHostFixture(t, OLD_VERSION);
  const calls = [];
  const nativeCalls = [];
  const runHostCommand = makeClaudeRepairRunner(home, NEW_VERSION, calls);
  const repairNativeHost = (host, opts) => {
    nativeCalls.push(host);
    writeJson(join(vibeRoot, ".h2a-install", "manifest.json"), {
      schema: 1,
      host: "vibe",
      root: vibeRoot,
      version: opts.version,
      files: {}
    });
    return { ok: true, changed: [join(vibeRoot, ".h2a-install", "manifest.json")] };
  };

  const driftBefore = detectHostVersionDrift(home, NEW_VERSION, { HOME: home });
  assert.equal(driftBefore.drifted, true);
  assert.deepEqual(driftBefore.pluginHosts, ["claude"]);
  assert.deepEqual(driftBefore.nativeHosts, ["vibe"]);

  const first = await autoRepairHostInstallations({
    root,
    home,
    version: NEW_VERSION,
    runHostCommand,
    repairNativeHost
  });
  assert.equal(first.ok, true);
  assert.equal(first.action, "repaired");
  assert.deepEqual(first.repairedHosts, ["claude", "vibe"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["claude", "plugin", "update", "h2a@sentropic"]);
  assert.deepEqual(nativeCalls, ["vibe"]);

  // Installed Claude plugin cache and installed_plugins.json are now at NEW_VERSION, stale 0.98.8 cache removed
  const installedPlugins = JSON.parse(
    readFileSync(join(claudeRoot, "plugins", "installed_plugins.json"), "utf8")
  );
  assert.equal(installedPlugins.plugins["h2a@sentropic"][0].version, NEW_VERSION);
  assert.equal(
    existsSync(join(claudeRoot, "plugins", "cache", "sentropic", "h2a", OLD_VERSION)),
    false
  );
  assert.equal(
    existsSync(join(claudeRoot, "plugins", "cache", "sentropic", "h2a", NEW_VERSION)),
    true
  );

  // Bus log and state recorded
  const logLines = readFileSync(join(root, "host-auto-repair.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0].status, "repaired");
  assert.equal(logLines[0].version, NEW_VERSION);

  // Second run is a no-op (repaired once)
  const second = await autoRepairHostInstallations({
    root,
    home,
    version: NEW_VERSION,
    runHostCommand,
    repairNativeHost
  });
  assert.equal(second.ok, true);
  assert.equal(second.action, "noop");
  assert.equal(calls.length, 1);
  assert.equal(nativeCalls.length, 1);
});

test("auto-repair after upgrade: already in sync is a fast no-op", async (t) => {
  const { home, root } = createHostFixture(t, NEW_VERSION);
  const calls = [];
  const nativeCalls = [];

  const drift = detectHostVersionDrift(home, NEW_VERSION, { HOME: home });
  assert.equal(drift.drifted, false);
  assert.deepEqual(drift.pluginHosts, []);
  assert.deepEqual(drift.nativeHosts, []);

  const result = await autoRepairHostInstallations({
    root,
    home,
    version: NEW_VERSION,
    runHostCommand: makeClaudeRepairRunner(home, NEW_VERSION, calls),
    repairNativeHost: (host) => {
      nativeCalls.push(host);
      return { ok: true };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, "noop");
  assert.equal(calls.length, 0);
  assert.equal(nativeCalls.length, 0);
  assert.equal(existsSync(join(root, "host-auto-repair.jsonl")), false);
});

test("auto-repair after upgrade: concurrent starts run a single repair under lock", async (t) => {
  const { home, root, vibeRoot } = createHostFixture(t, OLD_VERSION);
  const calls = [];
  const nativeCalls = [];
  const runHostCommand = makeClaudeRepairRunner(home, NEW_VERSION, calls);
  const repairNativeHost = (host, opts) => {
    nativeCalls.push(host);
    writeJson(join(vibeRoot, ".h2a-install", "manifest.json"), {
      schema: 1,
      host: "vibe",
      root: vibeRoot,
      version: opts.version,
      files: {}
    });
    return { ok: true, changed: [join(vibeRoot, ".h2a-install", "manifest.json")] };
  };

  const results = await Promise.all([
    autoRepairHostInstallations({
      root,
      home,
      version: NEW_VERSION,
      repairDelayMs: 60,
      runHostCommand,
      repairNativeHost
    }),
    autoRepairHostInstallations({
      root,
      home,
      version: NEW_VERSION,
      repairDelayMs: 60,
      runHostCommand,
      repairNativeHost
    }),
    autoRepairHostInstallations({
      root,
      home,
      version: NEW_VERSION,
      repairDelayMs: 60,
      runHostCommand,
      repairNativeHost
    })
  ]);

  assert.equal(results.every((r) => r.ok), true);
  const repairedCount = results.filter((r) => r.action === "repaired").length;
  const noopCount = results.filter((r) => r.action === "noop").length;
  assert.equal(repairedCount, 1);
  assert.equal(noopCount, 2);
  assert.equal(calls.length, 1);
  assert.equal(nativeCalls.length, 1);
  assert.equal(existsSync(join(root, ".host-auto-repair.lock")), false);
});

test("auto-repair after upgrade: repair failure never blocks MCP startup and doctor reports it", async (t) => {
  const { home, root } = createHostFixture(t, OLD_VERSION);
  const calls = [];
  const runHostCommand = makeClaudeRepairRunner(home, NEW_VERSION, calls, {
    fail: true,
    failMessage: "marketplace unreachable during post-upgrade repair"
  });

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  stdout.on("data", (chunk) => {
    stdoutText += chunk.toString("utf8");
  });

  const servePromise = runMcpServe(
    { root, host: "claude" },
    {
      stdin,
      stdout,
      stderr,
      cwd: () => root,
      env: { ...process.env, HOME: home },
      autoRepair: {
        root,
        home,
        version: NEW_VERSION,
        timeoutMs: 2_000,
        runHostCommand,
        repairNativeHost: () => ({ ok: false, error: "vibe native repair failed" })
      }
    }
  );

  stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    })}\n`
  );

  for (let i = 0; i < 60 && !stdoutText.includes('"serverInfo"'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  stdin.end();
  const rc = await servePromise;
  assert.equal(rc, 0);
  assert.match(stdoutText, /"serverInfo"/);

  // Doctor reports the failed auto-repair in warnings[]
  let doctorOut = "";
  const doctorRc = runCli(["doctor", "--root", root, "--skip-hosts"], {
    stdout: { write: (s) => { doctorOut += s; } },
    stderr: { write: () => {} },
    cwd: () => root
  });
  assert.equal(doctorRc, 0);
  const doctorReport = JSON.parse(doctorOut);
  const autoRepairWarning = doctorReport.warnings.find(
    (w) => w.check === "hostAutoRepair"
  );
  assert.ok(autoRepairWarning, "doctor warnings must include hostAutoRepair after failed auto-repair");
  assert.equal(autoRepairWarning.version, NEW_VERSION);
  assert.match(autoRepairWarning.message, /h2a doctor --repair/);
});

test("auto-repair after upgrade: enforces bounded timeoutMs and recovers stale dead-PID lock", async (t) => {
  const { home, root } = createHostFixture(t, OLD_VERSION);

  // Leave a stale lock from a provably dead PID and old mtime
  const lockPath = join(root, ".host-auto-repair.lock");
  writeJson(lockPath, {
    pid: 999_999_999,
    startedAt: "2000-01-01T00:00:00.000Z",
    version: NEW_VERSION,
    home
  });

  const timedOut = await autoRepairHostInstallations({
    root,
    home,
    version: NEW_VERSION,
    timeoutMs: 10,
    lockStaleMs: 1,
    runHostCommand: () => {
      const until = Date.now() + 30;
      while (Date.now() < until) {
        // simulate slow host CLI exceeding timeoutMs
      }
      return { ok: true };
    },
    repairNativeHost: () => ({ ok: true })
  });

  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.action, "failed");
  assert.equal(timedOut. errors.some((e) => e.includes("time budget")), true);
  assert.equal(existsSync(lockPath), false);
});

