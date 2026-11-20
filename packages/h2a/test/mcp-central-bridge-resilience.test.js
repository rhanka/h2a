import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../dist/index.js";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";
import { defaultPluginBridgeLockPath, provisionBridgeLock } from "../dist/registry/bridge-lock.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { centralOperator } from "../dist/runtime/mcp-central-operator.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const SHIM_SCRIPT = fileURLToPath(new URL("../scripts/h2a-bridge-shim.mjs", import.meta.url));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write(text) { stdout += text; } },
    stderr: { write(text) { stderr += text; } },
    text: () => ({ stdout, stderr })
  };
}

function createIsolatedEnv() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-bridge-resilience-"));
  chmodSync(dir, 0o700);
  const home = join(dir, "home");
  const xdgConfig = join(home, ".config");
  const xdgRuntime = join(dir, "runtime");
  const root = join(home, "h2a-workspace", ".h2a");
  const repo = join(dir, "repo");
  const prefix = join(dir, "prefix");
  const binDir = join(home, ".npm-global", "bin");
  for (const d of [home, xdgConfig, xdgRuntime, root, repo, prefix]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  chmodSync(binDir, 0o755);
  writeFileSync(
    join(binDir, "h2a"),
    `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`,
    { mode: 0o755 }
  );
  const env = {
    PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_RUNTIME_DIR: xdgRuntime,
    H2A_ROOT: root,
    H2A_MCP_CENTRAL: "1",
    TMPDIR: tmpdir(),
    TMP: tmpdir(),
    TEMP: tmpdir()
  };
  return {
    dir,
    home,
    xdgConfig,
    xdgRuntime,
    root,
    repo,
    prefix,
    binDir,
    env,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function withProcessEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function writeClaudePluginCache(home, version) {
  const claudeRoot = join(home, ".claude");
  const pluginDir = join(claudeRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, "scripts"), { recursive: true });
  writeFileSync(
    join(pluginDir, "scripts", "h2a-bridge-shim.mjs"),
    readFileSync(SHIM_SCRIPT, "utf8"),
    { mode: 0o755 }
  );
  const args = [
    "${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs",
    "registry-bridge", "serve", "--host", "claude", "--profile", "default",
    "--wake", "auto", "--auto-open", "--auto-upgrade"
  ];
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "h2a",
    version,
    mcpServers: "./.claude-plugin/registry.mcp.json"
  }, null, 2));
  writeFileSync(join(pluginDir, ".claude-plugin", "registry.mcp.json"), JSON.stringify({
    mcpServers: { h2a: { command: "node", args } }
  }, null, 2));
  const installedPath = join(claudeRoot, "plugins", "installed_plugins.json");
  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(installedPath, JSON.stringify({
    version: 2,
    plugins: { "h2a@sentropic": [{ scope: "user", installPath: pluginDir, version }] }
  }, null, 2));
  return pluginDir;
}

function writeFakeProtocol2Marker(runtimeBase, root) {
  const parent = join(runtimeBase, "h2a-mcp-central");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  writeFileSync(join(parent, "marker.json"), JSON.stringify({
    endpoint: "http://127.0.0.1:9/mcp",
    generation: "resilience-fixture-gen",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: "resilience-fixture-token",
    protocol: 2,
    root
  }), { mode: 0o600 });
}

function spawnBridge(iso, sessionId, extraEnv = {}) {
  const child = spawn(
    process.execPath,
    [
      SHIM_SCRIPT,
      "registry-bridge", "serve", "--host", "claude", "--profile", "default",
      "--wake", "auto", "--auto-open", "--auto-upgrade"
    ],
    {
      cwd: iso.repo,
      env: { ...iso.env, CLAUDE_CODE_SESSION_ID: sessionId, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const frames = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try { frames.push(JSON.parse(line)); } catch { /* ignore non-JSON diagnostic */ }
  });
  let nextId = 0;
  return {
    child,
    frames,
    getStderr: () => stderr,
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) })}\n`);
    },
    async call(method, params, timeoutMs = 10_000) {
      const id = ++nextId;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })}\n`);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = frames.find((f) => f.id === id);
        if (found) return found;
        if (child.exitCode !== null) {
          throw new Error(`bridge exited (${child.exitCode}) waiting for ${method}: ${stderr}`);
        }
        await delay(25);
      }
      throw new Error(`timeout waiting for ${method} (id=${id}), exit=${child.exitCode}, stderr=${stderr}`);
    },
    async waitIdentityReady(timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        const res = await this.call("tools/call", { name: "h2a_identity_status", arguments: {} }, 5_000);
        if (!res.error) {
          last = JSON.parse(res.result.content[0].text);
          if (last.state === "identity_ready") return last;
          if (last.state === "identity_failed") {
            throw new Error(`identity_failed: ${JSON.stringify(last)}`);
          }
        }
        await delay(150);
      }
      throw new Error(`identity never became ready (last=${JSON.stringify(last)}, stderr=${stderr})`);
    },
    async close() {
      rl.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }
  };
}

test("registry-bridge serve --auto-upgrade refreshes a verified prior-version plugin lock while tampered locks fail closed", async () => {
  const iso = createIsolatedEnv();
  try {
    const configPath = join(iso.home, ".claude.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
    writeClaudePluginCache(iso.home, "0.98.10");
    writeFakeProtocol2Marker(iso.xdgRuntime, iso.root);

    const h2aEntryCurrent = structuredClone(registryPackageManifest.entries[0]);
    const trackEntryCurrent = structuredClone(trackRegistryPackageManifest.entries[0]);
    const h2aEntryPrior = structuredClone(h2aEntryCurrent);
    const trackEntryPrior = structuredClone(trackEntryCurrent);
    h2aEntryPrior.publisher.packageVersion = "0.98.10";
    trackEntryPrior.publisher.packageVersion = "0.98.10";

    await withProcessEnv({
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime,
      H2A_ROOT: iso.root,
      H2A_MCP_CENTRAL: "1",
      CLAUDE_CODE_SESSION_ID: "upgrade-lock-session",
      CLAUDE_CONFIG_DIR: undefined,
      CLAUDE_PLUGIN_ROOT: undefined
    }, async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({
        lockPath,
        host: "claude",
        profile: "default",
        h2aEntry: h2aEntryPrior,
        trackEntry: trackEntryPrior
      });
      const priorLockBytes = readFileSync(lockPath, "utf8");

      // Without --auto-upgrade: must refuse integrity_mismatch and leave lock untouched
      const noUpgradeIo = streams();
      const noUpgradeCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--runtime-base", iso.xdgRuntime
      ], noUpgradeIo, { delegateServe: async () => 0 });
      assert.equal(noUpgradeCode, 2);
      assert.match(noUpgradeIo.text().stdout, /integrity_mismatch/);
      assert.equal(readFileSync(lockPath, "utf8"), priorLockBytes, "without --auto-upgrade, prior-version lock must not be rewritten");

      // With --auto-upgrade: cryptographically verified 0.98.10 digests refresh to current version
      const upgradeIo = streams();
      let delegated = 0;
      const upgradeCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade", "--runtime-base", iso.xdgRuntime
      ], upgradeIo, {
        delegateServe: async () => {
          delegated++;
          return 0;
        }
      });
      assert.equal(upgradeCode, 0, `expected upgrade refresh to succeed: ${upgradeIo.text().stderr}`);
      assert.equal(delegated, 1);
      assert.match(upgradeIo.text().stderr, /refreshed plugin lock .* for version upgrade \(0\.98\.10 -> /);
      assert.doesNotMatch(upgradeIo.text().stderr, /drive-consent\.full-verification/, "bridge preflight must not spin up a throwaway LocalStore");
      assert.notEqual(readFileSync(lockPath, "utf8"), priorLockBytes, "default plugin lock updated to current digests");
      assert.equal(existsSync(`${configPath}.h2a-registry.json`), false, "serve --auto-upgrade never writes receipt");

      // Tampered digest must STILL fail closed and never be overwritten
      const tampered = JSON.parse(readFileSync(lockPath, "utf8"));
      tampered.entries["sentropic.h2a"].digest = "0".repeat(64);
      const tamperedBytes = JSON.stringify(tampered, null, 2) + "\n";
      writeFileSync(lockPath, tamperedBytes, { mode: 0o600 });

      const tamperIo = streams();
      let tamperDelegated = 0;
      const tamperCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade", "--runtime-base", iso.xdgRuntime
      ], tamperIo, {
        delegateServe: async () => {
          tamperDelegated++;
          return 0;
        }
      });
      assert.equal(tamperCode, 2, "tampered digest must fail closed");
      assert.equal(tamperDelegated, 0);
      assert.match(tamperIo.text().stdout, /integrity_mismatch/);
      assert.equal(readFileSync(lockPath, "utf8"), tamperedBytes, "tampered lock bytes must remain untouched");
    });
  } finally {
    iso.cleanup();
  }
});

test("registry-bridge serve --auto-open auto-starts an absent central while still refusing an operator-paused central", async () => {
  const iso = createIsolatedEnv();
  try {
    await withProcessEnv({
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime,
      H2A_ROOT: iso.root,
      H2A_MCP_CENTRAL: "1",
      CLAUDE_CODE_SESSION_ID: "autostart-session",
      CLAUDE_CONFIG_DIR: undefined,
      CLAUDE_PLUGIN_ROOT: undefined
    }, async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default" });

      // Absent marker + --auto-open: invokes ensureCentral and delegates once marker is published
      let ensured = 0;
      let delegated = 0;
      const io = streams();
      const code = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--runtime-base", iso.xdgRuntime
      ], io, {
        ensureCentral: async (paths) => {
          ensured++;
          writeFakeProtocol2Marker(paths.runtimeBase ?? iso.xdgRuntime, iso.root);
        },
        delegateServe: async () => {
          delegated++;
          return 0;
        }
      });
      assert.equal(code, 0, `expected auto-start admission to succeed: ${io.text().stderr}`);
      assert.equal(ensured, 1, "ensureCentral called once on missing marker");
      assert.equal(delegated, 1, "bridge delegated after central became ready");

      // Operator-paused central: must NOT auto-start and must refuse with central_unavailable
      const pausedBase = join(iso.dir, "paused-runtime");
      mkdirSync(pausedBase, { recursive: true, mode: 0o700 });
      chmodSync(pausedBase, 0o700);
      const stopIo = streams();
      assert.equal(await runCli(["central", "stop", "--runtime-base", pausedBase], stopIo, {}), 0, stopIo.text().stderr);

      let pausedEnsured = 0;
      const pausedIo = streams();
      const pausedCode = await cmdRegistryBridge([
        "serve", "--host", "claude", "--profile", "default",
        "--wake", "auto", "--auto-open", "--auto-upgrade",
        "--runtime-base", pausedBase
      ], pausedIo, {
        ensureCentral: async () => { pausedEnsured++; },
        delegateServe: async () => 0
      });
      assert.equal(pausedCode, 2, "operator-paused central must refuse");
      assert.equal(pausedEnsured, 0, "must never auto-start an operator-paused central");
      assert.match(pausedIo.text().stderr, /operator-stop\.json/);
    });
  } finally {
    iso.cleanup();
  }
});

test("connected registry-bridge keeps central alive past idleTimeoutMs even while host is idle", { timeout: 30_000 }, async () => {
  const iso = createIsolatedEnv();
  let central;
  let bridge;
  try {
    await withProcessEnv({
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime
    }, async () => {
      provisionBridgeLock({ lockPath: defaultPluginBridgeLockPath("claude", "default"), host: "claude", profile: "default" });
    });

    central = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 2_500,
      sessionLeaseMs: 8_000
    });
    assert.equal(central.kind, "started");
    let centralClosed = false;
    central.closed.then(() => { centralClosed = true; });

    bridge = spawnBridge(iso, "keepalive-session");
    const init = await bridge.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1.0" }
    });
    assert.ok(init.result, `initialize failed: ${JSON.stringify(init)}`);
    bridge.notify("notifications/initialized");
    const tools = await bridge.call("tools/list", {});
    assert.ok(tools.result.tools.length > 0);

    // Stay completely idle for > idleTimeoutMs (2500ms) with zero tool calls
    await delay(3_800);
    assert.equal(centralClosed, false, "connected bridge must keep central alive past idleTimeoutMs");
    assert.equal(bridge.child.exitCode, null, "bridge stdio must remain open");
    assert.doesNotMatch(bridge.getStderr(), /drive-consent\.full-verification/, "bridge stderr must stay free of throwaway consent-verification spam");

    const status = await centralOperator("status", { runtimeBase: iso.xdgRuntime });
    assert.equal(status.running, true);
    assert.equal(status.attachments, 1);

    // Once the last bridge disconnects, central must idle-exit cleanly
    await bridge.close();
    bridge = undefined;
    const deadline = Date.now() + 8_000;
    while (!centralClosed && Date.now() < deadline) await delay(50);
    assert.equal(centralClosed, true, "central should idle-exit once all bridges disconnect");
    central = undefined;
  } finally {
    await bridge?.close();
    await central?.stop();
    iso.cleanup();
  }
});

test("connected registry-bridge transparently survives central restart on a new port and generation", { timeout: 35_000 }, async () => {
  const iso = createIsolatedEnv();
  let c1;
  let c2;
  let bridge;
  try {
    await withProcessEnv({
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime
    }, async () => {
      provisionBridgeLock({ lockPath: defaultPluginBridgeLockPath("claude", "default"), host: "claude", profile: "default" });
    });

    c1 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      // Give cold-booting bridge enough headroom under parallel CI shard load;
      // c1 is stopped explicitly below while c2 tests the short idleTimeoutMs.
      idleTimeoutMs: 15_000,
      sessionLeaseMs: 15_000
    });
    assert.equal(c1.kind, "started");

    bridge = spawnBridge(iso, "restart-survive-session");
    const init = await bridge.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1.0" }
    });
    assert.ok(init.result);
    bridge.notify("notifications/initialized");
    const before = await bridge.waitIdentityReady();

    // Stop C1 and bring up C2 on a NEW ephemeral port and NEW generation
    await c1.stop();
    const c1Endpoint = c1.endpoint;
    const c1Gen = c1.generation;
    c1 = undefined;
    assert.equal(bridge.child.exitCode, null, "bridge stdio must stay open when central stops");

    c2 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 2_500,
      sessionLeaseMs: 8_000
    });
    assert.equal(c2.kind, "started");
    assert.notEqual(c2.generation, c1Gen, "C2 must have a new generation");
    assert.notEqual(c2.endpoint, c1Endpoint, "C2 must bind a new ephemeral port");

    let c2Closed = false;
    c2.closed.then(() => { c2Closed = true; });

    // Do NOT send any host tool calls yet: supervision alone must reconnect and keep C2 alive past idleTimeoutMs
    await delay(3_800);
    assert.equal(bridge.child.exitCode, null, "same stdio session must stay open across central restart");
    assert.equal(c2Closed, false, "reconnected idle bridge must keep new central C2 alive past idleTimeoutMs");

    const after = await bridge.waitIdentityReady();
    assert.equal(after.instance, before.instance, "reconnected bridge must reclaim the exact same identity");
    const status = await centralOperator("status", { runtimeBase: iso.xdgRuntime });
    assert.equal(status.running, true);
    assert.equal(status.generation, c2.generation);
    assert.equal(status.attachments, 1);
  } finally {
    await bridge?.close();
    await c2?.stop();
    await c1?.stop();
    iso.cleanup();
  }
});

test("connected registry-bridge completes identity cleanly when central restarts before identity_ready landed", { timeout: 30_000 }, async () => {
  const iso = createIsolatedEnv();
  let c1;
  let c2;
  let bridge;
  try {
    await withProcessEnv({
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime
    }, async () => {
      provisionBridgeLock({ lockPath: defaultPluginBridgeLockPath("claude", "default"), host: "claude", profile: "default" });
    });

    c1 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 15_000,
      sessionLeaseMs: 15_000
    });
    assert.equal(c1.kind, "started");

    bridge = spawnBridge(iso, "early-restart-session");
    const init = await bridge.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2.1.0" }
    });
    assert.ok(init.result);
    bridge.notify("notifications/initialized");

    // Stop C1 immediately before identity_ready is observed by the bridge
    await delay(100);
    await c1.stop();
    c1 = undefined;
    assert.equal(bridge.child.exitCode, null, "bridge stdio must stay open on early central restart");

    c2 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 5_000,
      sessionLeaseMs: 10_000
    });
    assert.equal(c2.kind, "started");

    // Bridge must reconnect to C2 and reach identity_ready (not fail with reclaimOnly error)
    const ready = await bridge.waitIdentityReady();
    assert.equal(ready.state, "identity_ready");
    assert.equal(bridge.child.exitCode, null);
  } finally {
    await bridge?.close();
    await c2?.stop();
    await c1?.stop();
    iso.cleanup();
  }
});
