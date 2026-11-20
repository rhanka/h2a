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

function createManualClock(startMs = Date.now()) {
  let currentMs = startMs;
  let nextId = 1;
  const intervals = new Map();
  return {
    now: () => currentMs,
    setInterval(fn, ms) {
      const period = Math.max(1, Number(ms) || 1);
      const id = nextId++;
      intervals.set(id, { fn, period, nextAt: currentMs + period });
      return { id, unref() {} };
    },
    clearInterval(handle) {
      if (handle && typeof handle === "object" && "id" in handle) {
        intervals.delete(handle.id);
      }
    },
    async advance(deltaMs) {
      const target = currentMs + deltaMs;
      while (true) {
        let earliest = null;
        for (const entry of intervals.values()) {
          if (entry.nextAt <= target && (!earliest || entry.nextAt < earliest.nextAt)) {
            earliest = entry;
          }
        }
        if (!earliest) break;
        currentMs = earliest.nextAt;
        earliest.nextAt += earliest.period;
        earliest.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      currentMs = target;
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

async function waitForCentralStatus(
  runtimeBase,
  predicate,
  { timeoutMs = 20_000, pollMs = 50, describe = "central status", assertAlive } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    assertAlive?.();
    last = await centralOperator("status", { runtimeBase });
    if (predicate(last)) return last;
    await delay(pollMs);
  }
  assertAlive?.();
  throw new Error(`timeout waiting for ${describe} (last=${JSON.stringify(last)})`);
}

async function advanceClockUntilClosed(
  clock,
  closedPromise,
  { stepMs = 500, maxVirtualMs = 16_000, realTimeoutMs = 15_000 } = {}
) {
  let isClosed = false;
  closedPromise.then(() => { isClosed = true; });
  const deadline = Date.now() + realTimeoutMs;
  let advanced = 0;
  while (!isClosed && advanced < maxVirtualMs && Date.now() < deadline) {
    await clock.advance(stepMs);
    advanced += stepMs;
    if (isClosed) return;
    await Promise.race([closedPromise, delay(25)]);
  }
  if (!isClosed) {
    const remainingMs = Math.min(5_000, Math.max(0, deadline - Date.now()));
    await Promise.race([
      closedPromise,
      delay(remainingMs).then(() => {
        throw new Error(`central did not idle-exit after advancing ${advanced}ms virtual time`);
      })
    ]);
  }
}

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
  const pending = new Map();
  const rejectPendingOnExit = () => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error(`bridge exited (${child.exitCode ?? child.signalCode}) waiting for ${entry.method}: ${stderr}`));
    }
  };
  child.once("exit", rejectPendingOnExit);
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      const frame = JSON.parse(line);
      frames.push(frame);
      if (frame && frame.id !== undefined && pending.has(frame.id)) {
        const entry = pending.get(frame.id);
        pending.delete(frame.id);
        clearTimeout(entry.timer);
        entry.resolve(frame);
      }
    } catch { /* ignore non-JSON diagnostic */ }
  });
  let nextId = 0;
  return {
    child,
    frames,
    getStderr: () => stderr,
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) })}\n`);
    },
    call(method, params, timeoutMs = 25_000) {
      if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.reject(new Error(`bridge exited (${child.exitCode ?? child.signalCode}) before ${method}: ${stderr}`));
      }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method} (id=${id}), exit=${child.exitCode}, stderr=${stderr}`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, { method, resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })}\n`);
      });
    },
    async waitIdentityReady(timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        const remainingMs = Math.max(1_000, deadline - Date.now());
        const res = await this.call("tools/call", { name: "h2a_identity_status", arguments: {} }, remainingMs);
        if (!res.error) {
          last = JSON.parse(res.result.content[0].text);
          if (last.state === "identity_ready") return last;
          if (last.state === "identity_failed") {
            throw new Error(`identity_failed: ${JSON.stringify(last)}`);
          }
        }
        if (Date.now() >= deadline) break;
        await delay(100);
      }
      throw new Error(`identity never became ready (last=${JSON.stringify(last)}, stderr=${stderr})`);
    },
    async close() {
      rl.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        // Close stdin first so shim-bridge exits cleanly and sends DELETE to central
        // without racing runCentralShim's 750ms SIGTERM force-exit timer.
        try { child.stdin.end(); } catch { /* ignore */ }
        const graceful = await Promise.race([
          exited.then(() => true),
          delay(5_000).then(() => false)
        ]);
        if (!graceful && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
          await exited;
        }
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

test("connected registry-bridge keeps central alive past idleTimeoutMs even while host is idle", { timeout: 60_000 }, async () => {
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

    const clock = createManualClock();
    central = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 2_500,
      sessionLeaseMs: 8_000,
      clock
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

    await waitForCentralStatus(
      iso.xdgRuntime,
      (s) => s.running === true && s.attachments === 1,
      {
        timeoutMs: 20_000,
        describe: "initial bridge attachment on central",
        assertAlive: () => {
          assert.equal(centralClosed, false, "central closed before bridge attached");
          assert.equal(bridge.child.exitCode, null, `bridge exited unexpectedly: ${bridge.getStderr()}`);
        }
      }
    );

    // Stay completely idle for > idleTimeoutMs (2500ms) with zero tool calls
    await clock.advance(3_800);
    await Promise.race([central.closed, delay(50)]);
    assert.equal(centralClosed, false, "connected bridge must keep central alive past idleTimeoutMs");
    assert.equal(bridge.child.exitCode, null, "bridge stdio must remain open");
    assert.doesNotMatch(bridge.getStderr(), /drive-consent\.full-verification/, "bridge stderr must stay free of throwaway consent-verification spam");

    const status = await waitForCentralStatus(
      iso.xdgRuntime,
      (s) => s.running === true && s.attachments === 1,
      { timeoutMs: 15_000, describe: "central alive after idle window" }
    );
    assert.equal(status.running, true);
    assert.equal(status.attachments, 1);

    // Once the last bridge disconnects, central must idle-exit cleanly
    await bridge.close();
    bridge = undefined;
    await advanceClockUntilClosed(clock, central.closed);
    assert.equal(centralClosed, true, "central should idle-exit once all bridges disconnect");
    central = undefined;
  } finally {
    await bridge?.close();
    await central?.stop();
    iso.cleanup();
  }
});

test("connected registry-bridge transparently survives central restart on a new port and generation", { timeout: 60_000 }, async () => {
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

    const c1Clock = createManualClock();
    c1 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 2_500,
      sessionLeaseMs: 8_000,
      clock: c1Clock
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
    const c1Endpoint = c1.endpoint;
    const c1Gen = c1.generation;
    await c1.stop();
    c1 = undefined;
    assert.equal(bridge.child.exitCode, null, "bridge stdio must stay open when central stops");

    const c2Clock = createManualClock();
    c2 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 2_500,
      sessionLeaseMs: 8_000,
      clock: c2Clock
    });
    assert.equal(c2.kind, "started");
    assert.notEqual(c2.generation, c1Gen, "C2 must have a new generation");
    assert.notEqual(c2.endpoint, c1Endpoint, "C2 must bind a new ephemeral port");

    let c2Closed = false;
    c2.closed.then(() => { c2Closed = true; });

    // Do NOT send any host tool calls yet: supervision alone must reconnect to C2 on its new port and generation
    const reconnected = await waitForCentralStatus(
      iso.xdgRuntime,
      (s) => s.running === true && s.generation === c2.generation && s.attachments === 1,
      {
        timeoutMs: 25_000,
        describe: `bridge supervision reconnect to C2 (${c2.generation})`,
        assertAlive: () => {
          assert.equal(bridge.child.exitCode, null, `same stdio session exited during central restart: ${bridge.getStderr()}`);
          assert.equal(c2Closed, false, "C2 closed before bridge reconnected");
        }
      }
    );
    assert.equal(reconnected.attachments, 1);

    // Still with zero host tool calls, advance C2's sweep clock past idleTimeoutMs (2500ms)
    await c2Clock.advance(3_800);
    await Promise.race([c2.closed, delay(50)]);
    assert.equal(bridge.child.exitCode, null, "same stdio session must stay open across central restart");
    assert.equal(c2Closed, false, "reconnected idle bridge must keep new central C2 alive past idleTimeoutMs");

    const after = await bridge.waitIdentityReady();
    assert.equal(after.instance, before.instance, "reconnected bridge must reclaim the exact same identity");
    const status = await waitForCentralStatus(
      iso.xdgRuntime,
      (s) => s.running === true && s.generation === c2.generation && s.attachments === 1,
      { timeoutMs: 15_000, describe: "C2 status after identity reclaim" }
    );
    assert.equal(status.running, true);
    assert.equal(status.generation, c2.generation);
    assert.equal(status.attachments, 1);

    // Prove C2's idleTimeoutMs is armed: disconnecting the reconnected bridge lets C2 idle-exit cleanly
    await bridge.close();
    bridge = undefined;
    await advanceClockUntilClosed(c2Clock, c2.closed);
    assert.equal(c2Closed, true, "C2 should idle-exit once the reconnected bridge disconnects");
    c2 = undefined;
  } finally {
    await bridge?.close();
    await c2?.stop();
    await c1?.stop();
    iso.cleanup();
  }
});

test("connected registry-bridge completes identity cleanly when central restarts before identity_ready landed", { timeout: 60_000 }, async () => {
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

    const c1Clock = createManualClock();
    c1 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 2_500,
      sessionLeaseMs: 8_000,
      clock: c1Clock
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

    // Wait for C1 attachment, then stop C1 before identity_ready is observed by the bridge
    await waitForCentralStatus(
      iso.xdgRuntime,
      (s) => s.running === true && s.generation === c1.generation && s.attachments === 1,
      {
        timeoutMs: 20_000,
        describe: "initial C1 attachment before early restart",
        assertAlive: () => {
          assert.equal(bridge.child.exitCode, null, `bridge exited before early restart: ${bridge.getStderr()}`);
        }
      }
    );
    await c1.stop();
    c1 = undefined;
    assert.equal(bridge.child.exitCode, null, "bridge stdio must stay open on early central restart");

    const c2Clock = createManualClock();
    c2 = await startCentralMcpServer({
      root: iso.root,
      runtimeBase: iso.xdgRuntime,
      physicalPrefix: iso.prefix,
      env: iso.env,
      idleTimeoutMs: 5_000,
      sessionLeaseMs: 10_000,
      clock: c2Clock
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
