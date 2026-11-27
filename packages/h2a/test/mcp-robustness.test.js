import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../dist/index.js";
import {
  bridgeLockJournalPath,
  defaultPluginBridgeLockPath,
  provisionBridgeLock,
  readBridgeLock,
  rotateBridgeLock,
  validateBridgeLock
} from "../dist/registry/bridge-lock.js";
import { cmdRegistryBridge } from "../dist/registry/cli-registry.js";
import { registryPackageManifest } from "../dist/registry/manifest.js";
import { refreshUpgradedPluginLock } from "../dist/registry/host-bootstrap.js";
import { trackRegistryPackageManifest } from "@sentropic/track/registry/manifest";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { launchCentral } from "../dist/runtime/handover/launch.js";
import { installationForEntry, physicalPrefixForEntry } from "../dist/runtime/handover/selection.js";
import { centralStateDirectory, readCentralMcpMarker } from "../dist/runtime/mcp-central-discovery.js";
import { CENTRAL_MEMORY_HIGH_BYTES, CENTRAL_MEMORY_MAX_BYTES, isolateCentralSystemdScope } from "../dist/runtime/handover/central-scope.js";
import { comparePluginAndCentralVersions } from "../dist/runtime/mcp-version-alignment.js";
import { currentCliVersion } from "../dist/runtime/upgrade/index.js";
import { checkLockstepVersions } from "../../../scripts/check-lockstep-versions.mjs";
import { checkPluginContentVersionBump, checkPluginManifestSync } from "../../../scripts/check-plugin-version.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN_PATH = join(REPO_ROOT, "packages/h2a/dist/bin.js");
const SHIM_SCRIPT = join(REPO_ROOT, "packages/h2a/scripts/h2a-bridge-shim.mjs");

function tempBase() {
  const localTmp = join(REPO_ROOT, ".tmp");
  if (existsSync(localTmp)) return localTmp;
  return tmpdir();
}

function makeIsoLab(prefix = "h2a-mcp-robustness-") {
  const dir = mkdtempSync(join(tempBase(), prefix));
  const home = join(dir, "home");
  const xdgConfig = join(dir, "config");
  const xdgRuntime = join(dir, "run");
  const root = join(dir, "store");
  for (const p of [home, xdgConfig, xdgRuntime, root]) {
    mkdirSync(p, { recursive: true, mode: 0o700 });
  }
  return { dir, home, xdgConfig, xdgRuntime, root };
}

function makeStreams(cwd = REPO_ROOT) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (s) => { stdout += s; return true; } },
    stderr: { write: (s) => { stderr += s; return true; } },
    cwd: () => cwd,
    text: () => ({ stdout, stderr })
  };
}

async function withEnv(overrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(overrides)) {
    prev[k] = Object.hasOwn(process.env, k) ? process.env[k] : undefined;
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function setupClaudePluginInstall(iso, version) {
  const claudeRoot = join(iso.home, ".claude");
  const pluginDir = join(claudeRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginDir, "scripts"), { recursive: true });
  writeFileSync(join(pluginDir, "scripts", "h2a-bridge-shim.mjs"), readFileSync(SHIM_SCRIPT, "utf8"), { mode: 0o755 });
  const args = [
    "${CLAUDE_PLUGIN_ROOT}/scripts/h2a-bridge-shim.mjs",
    "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--wake", "auto", "--auto-open", "--auto-upgrade"
  ];
  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "h2a", version, mcpServers: "./.claude-plugin/registry.mcp.json" }, null, 2)
  );
  writeFileSync(
    join(pluginDir, ".claude-plugin", "registry.mcp.json"),
    JSON.stringify({ mcpServers: { h2a: { command: "node", args } } }, null, 2)
  );
  const installedPath = join(claudeRoot, "plugins", "installed_plugins.json");
  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(
    installedPath,
    JSON.stringify({ version: 2, plugins: { "h2a@sentropic": [{ scope: "user", installPath: pluginDir, version }] } }, null, 2)
  );
  const configPath = join(iso.home, ".claude.json");
  writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
  return { pluginDir, configPath };
}

function setupCodexPluginInstall(iso, version) {
  const codexRoot = join(iso.home, ".codex");
  const pluginDir = join(codexRoot, "plugins", "cache", "sentropic", "h2a", version);
  mkdirSync(join(pluginDir, ".codex-plugin"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "h2a", version, mcpServers: "./.codex-plugin/registry.mcp.json" }, null, 2)
  );
  writeFileSync(
    join(pluginDir, ".codex-plugin", "registry.mcp.json"),
    JSON.stringify({
      mcpServers: {
        h2a: {
          command: "h2a",
          args: ["registry-bridge", "serve", "--host", "codex", "--profile", "default", "--wake", "auto", "--auto-open"]
        }
      }
    }, null, 2)
  );
  const configPath = join(codexRoot, "config.toml");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, "");
  return { pluginDir, configPath };
}

async function freeEndpoint() {
  const sock = createServer().listen(0, "127.0.0.1");
  await once(sock, "listening");
  const port = sock.address().port;
  await new Promise((r) => sock.close(r));
  return `http://127.0.0.1:${port}/mcp`;
}

// ---------------------------------------------------------------------------
// Point 1 (01M89T9VJ6SWG9B8DSD6RKQJJ0): Bridge lock auto-repin, rotate CLI,
// backup + journal, exact step error message, refusal of unknown descriptors.
// ---------------------------------------------------------------------------

test("Point 1a: stale verified prior-version lock automatically repins with backup and rotation journal", async (t) => {
  const iso = makeIsoLab("mcp-robust-repin-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  const { pluginDir } = setupClaudePluginInstall(iso, "0.98.10");
  const priorH2a = structuredClone(registryPackageManifest.entries[0]);
  const priorTrack = structuredClone(trackRegistryPackageManifest.entries[0]);
  priorH2a.publisher.packageVersion = "0.98.10";
  priorTrack.publisher.packageVersion = "0.98.10";

  await withEnv(
    {
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime,
      H2A_ROOT: iso.root,
      H2A_MCP_CENTRAL: "0"
    },
    async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({
        lockPath,
        host: "claude",
        profile: "default",
        h2aEntry: priorH2a,
        trackEntry: priorTrack
      });
      const beforeBytes = readFileSync(lockPath, "utf8");
      assert.throws(() => readBridgeLock(lockPath), /integrity_mismatch.*step=bridge-lock-descriptor-verification/);

      // Upgrade in-place (auto-upgrade path)
      const io = makeStreams(iso.root);
      let delegated = 0;
      const code = await cmdRegistryBridge(
        [
          "serve", "--host", "claude", "--profile", "default",
          "--wake", "auto", "--auto-open", "--auto-upgrade",
          "--instance", "claude:test-repin",
          "--root", iso.root, "--runtime-base", iso.xdgRuntime
        ],
        io,
        { delegateServe: async () => { delegated++; return 0; } }
      );
      assert.equal(code, 0, `expected serve --auto-upgrade to repin and exit 0: ${io.text().stderr}\n${io.text().stdout}`);
      assert.equal(delegated, 1);

      const afterLock = readBridgeLock(lockPath);
      assert.ok(afterLock.selection.some((s) => s.id === "sentropic.h2a"));
      assert.notEqual(readFileSync(lockPath, "utf8"), beforeBytes);

      const backups = readdirSync(dirname(lockPath)).filter((n) => n.startsWith("default.lock.json.quarantine-"));
      assert.equal(backups.length, 1);
      assert.equal(readFileSync(join(dirname(lockPath), backups[0]), "utf8"), beforeBytes);
      assert.equal(statSync(join(dirname(lockPath), backups[0])).mode & 0o777, 0o600);

      const journalPath = bridgeLockJournalPath(lockPath);
      assert.equal(existsSync(journalPath), true, "rotation journal must be created");
      assert.equal(statSync(journalPath).mode & 0o777, 0o600);
      const journalLines = readFileSync(journalPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(journalLines.length, 1);
      assert.equal(journalLines[0].backupPath, join(dirname(lockPath), backups[0]));
      assert.equal(journalLines[0].entries.length, 2);
      assert.ok(journalLines[0].entries.every((e) => e.priorVersion === "0.98.10" && e.newVersion === currentCliVersion()));
      assert.match(io.text().stderr, /refreshed plugin lock/);
      assert.match(io.text().stderr, /journal at .*default\.lock\.json\.rotations\.jsonl/);

      // Second invocation finds lock already valid -> no extra backup or journal entry
      const io2 = makeStreams(iso.root);
      assert.equal(refreshUpgradedPluginLock({
        host: "claude", configPath: "", profile: "default", pluginDir,
        h2aEntry: registryPackageManifest.entries[0],
        trackEntry: trackRegistryPackageManifest.entries[0]
      }).refreshed, false);
      assert.equal(readdirSync(dirname(lockPath)).filter((n) => n.startsWith("default.lock.json.quarantine-")).length, 1);
    }
  );
});

test("Point 1b: documented CLI command `h2a registry bootstrap rotate` supports dry-run, rotation, idempotence, and backups", async (t) => {
  const iso = makeIsoLab("mcp-robust-cli-rotate-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  setupCodexPluginInstall(iso, "0.98.10");
  const priorH2a = structuredClone(registryPackageManifest.entries[0]);
  const priorTrack = structuredClone(trackRegistryPackageManifest.entries[0]);
  priorH2a.publisher.packageVersion = "0.98.10";
  priorTrack.publisher.packageVersion = "0.98.10";

  await withEnv(
    { HOME: iso.home, XDG_CONFIG_HOME: iso.xdgConfig, XDG_RUNTIME_DIR: iso.xdgRuntime },
    async () => {
      const lockPath = defaultPluginBridgeLockPath("codex", "default");
      provisionBridgeLock({
        lockPath,
        host: "codex",
        profile: "default",
        h2aEntry: priorH2a,
        trackEntry: priorTrack
      });
      const priorBytes = readFileSync(lockPath, "utf8");

      // Dry-run plans rotation cleanly without modifying disk
      const dryIo = makeStreams(iso.root);
      const dryCode = await runCli(
        ["registry", "bootstrap", "rotate", "--host", "codex", "--profile", "default", "--mechanism", "plugin", "--dry-run"],
        dryIo
      );
      assert.equal(dryCode, 0, dryIo.text().stderr);
      const dryReport = JSON.parse(dryIo.text().stdout);
      assert.equal(dryReport.ok, true);
      assert.equal(dryReport.action, "would-rotate");
      assert.equal(dryReport.rotatedEntries.length, 2);
      assert.equal(readFileSync(lockPath, "utf8"), priorBytes);
      assert.equal(existsSync(bridgeLockJournalPath(lockPath)), false);

      // Actual rotate
      const rotIo = makeStreams(iso.root);
      const rotCode = await runCli(
        ["registry", "bootstrap", "rotate", "--host", "codex", "--profile", "default", "--mechanism", "plugin"],
        rotIo
      );
      assert.equal(rotCode, 0, rotIo.text().stderr);
      const rotReport = JSON.parse(rotIo.text().stdout);
      assert.equal(rotReport.ok, true);
      assert.equal(rotReport.action, "rotated");
      assert.ok(rotReport.backupPath && existsSync(rotReport.backupPath));
      assert.equal(readFileSync(rotReport.backupPath, "utf8"), priorBytes);
      assert.ok(rotReport.journalPath && existsSync(rotReport.journalPath));
      assert.match(rotIo.text().stderr, /rotated bridge lock/);
      readBridgeLock(lockPath);

      // Second run is idempotent
      const idemIo = makeStreams(iso.root);
      assert.equal(
        await runCli(["registry", "bootstrap", "rotate", "--host", "codex", "--profile", "default", "--mechanism", "plugin"], idemIo),
        0
      );
      assert.equal(JSON.parse(idemIo.text().stdout).action, "unchanged");
      assert.equal(readFileSync(bridgeLockJournalPath(lockPath), "utf8").trim().split("\n").length, 1);
    }
  );
});

test("Point 1c: genuinely unknown descriptors and unproven tampered digests fail closed naming exact step", async (t) => {
  const iso = makeIsoLab("mcp-robust-unknown-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  setupClaudePluginInstall(iso, currentCliVersion());
  await withEnv(
    { HOME: iso.home, XDG_CONFIG_HOME: iso.xdgConfig, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_MCP_CENTRAL: "0" },
    async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default" });

      // Case 1: genuinely unknown descriptor provider
      const unknownLock = JSON.parse(readFileSync(lockPath, "utf8"));
      unknownLock.selection.push({ kind: "mcp", id: "evil.unknown-mcp", entryVersion: "1.0.0" });
      unknownLock.entries["evil.unknown-mcp"] = {
        digest: "a".repeat(64),
        config: {},
        configDigest: "b".repeat(64)
      };
      const unknownBytes = JSON.stringify(unknownLock, null, 2);
      writeFileSync(lockPath, unknownBytes);

      assert.throws(
        () => validateBridgeLock(unknownLock),
        /invalid_entry: step=bridge-lock-selection-verification: bridge lock selects unknown provider evil\.unknown-mcp/
      );
      assert.throws(
        () => rotateBridgeLock({ lockPath, host: "claude", profile: "default" }),
        /invalid_entry: step=bridge-lock-selection-verification: bridge lock selects unknown provider evil\.unknown-mcp/
      );
      const serveUnknownIo = makeStreams(iso.root);
      const unknownCode = await cmdRegistryBridge(
        ["serve", "--host", "claude", "--profile", "default", "--auto-upgrade", "--instance", "claude:u"],
        serveUnknownIo,
        { delegateServe: async () => 0 }
      );
      assert.equal(unknownCode, 2);
      assert.match(serveUnknownIo.text().stdout, /step=bridge-lock-selection-verification.*unknown provider evil\.unknown-mcp/);
      assert.equal(readFileSync(lockPath, "utf8"), unknownBytes, "unknown descriptor must never trigger rewrite or backup");
      assert.equal(existsSync(bridgeLockJournalPath(lockPath)), false);

      // Case 2: unproven tampered digest
      rmSync(lockPath, { force: true });
      provisionBridgeLock({ lockPath, host: "claude", profile: "default" });
      const tampered = JSON.parse(readFileSync(lockPath, "utf8"));
      tampered.entries["sentropic.h2a"].digest = "f".repeat(64);
      const tamperedBytes = JSON.stringify(tampered, null, 2);
      writeFileSync(lockPath, tamperedBytes);

      assert.throws(
        () => readBridgeLock(lockPath),
        /integrity_mismatch: step=bridge-lock-descriptor-verification: descriptor digest for sentropic\.h2a/
      );
      const serveTamperIo = makeStreams(iso.root);
      const tamperCode = await cmdRegistryBridge(
        ["serve", "--host", "claude", "--profile", "default", "--auto-upgrade", "--instance", "claude:t"],
        serveTamperIo,
        { delegateServe: async () => 0 }
      );
      assert.equal(tamperCode, 2);
      assert.match(serveTamperIo.text().stdout, /integrity_mismatch: step=bridge-lock-descriptor-verification/);
      assert.match(serveTamperIo.text().stdout, /h2a registry bootstrap rotate --host claude --profile default --mechanism plugin/);
      assert.equal(readFileSync(lockPath, "utf8"), tamperedBytes);
    }
  );
});

// ---------------------------------------------------------------------------
// Point 2 (01M8A9B52FJWJGGMSX1W3048TC): Central MCP owns systemd --user scope
// (MemoryHigh=3G, MemoryMax=4G) + clean fallback with message when absent.
// ---------------------------------------------------------------------------

test("Point 2a: isolateCentralSystemdScope passes MemoryHigh=3G and MemoryMax=4G, handles UnitExists handover overlap, and falls back cleanly", async (t) => {
  const iso = makeIsoLab("mcp-robust-scope-unit-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  const busPath = join(iso.xdgRuntime, "bus");
  writeFileSync(busPath, "");
  const busCalls = [];
  const res = await isolateCentralSystemdScope(4242, {
    platform: "linux",
    environment: { XDG_RUNTIME_DIR: iso.xdgRuntime },
    runBusctl: async (args) => {
      busCalls.push(args);
      return { stdout: "", stderr: "" };
    },
    readCgroup: () => "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-mcp-central.scope\n"
  });
  assert.equal(res.isolated, true);
  assert.equal(res.unit, "h2a-mcp-central.scope");
  assert.equal(res.memoryHighBytes, 3 * 1024 ** 3);
  assert.equal(res.memoryMaxBytes, 4 * 1024 ** 3);
  assert.equal(busCalls.length, 1);
  assert.ok(busCalls[0].includes("StartTransientUnit"));
  assert.ok(busCalls[0].includes("h2a-mcp-central.scope"));
  assert.ok(busCalls[0].includes(String(CENTRAL_MEMORY_HIGH_BYTES)));
  assert.ok(busCalls[0].includes(String(CENTRAL_MEMORY_MAX_BYTES)));

  // Handover collision (`UnitExists`) retries cleanly with per-pid unit
  let attempt = 0;
  const overlapRes = await isolateCentralSystemdScope(9876, {
    platform: "linux",
    environment: { XDG_RUNTIME_DIR: iso.xdgRuntime },
    runBusctl: async (args) => {
      attempt++;
      if (attempt === 1) throw Object.assign(new Error("Unit h2a-mcp-central.scope already exists"), { stderr: "org.freedesktop.systemd1.UnitExists" });
      return { stdout: "", stderr: "" };
    },
    readCgroup: () => "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-mcp-central-9876.scope\n"
  });
  assert.equal(overlapRes.isolated, true);
  assert.equal(overlapRes.unit, "h2a-mcp-central-9876.scope");

  // Absent systemd --user falls back cleanly with message
  const absentRes = await isolateCentralSystemdScope(4242, {
    platform: "linux",
    environment: { XDG_RUNTIME_DIR: join(iso.dir, "empty-run") }
  });
  assert.equal(absentRes.isolated, false);
  assert.equal(absentRes.reason, "systemd_user_absent");
  assert.match(absentRes.message, /systemd --user unavailable/);
});

test("Point 2b: launchCentral isolates via busctl when systemd --user is reachable and falls back cleanly when absent", async (t) => {
  const iso = makeIsoLab("mcp-robust-launch-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  // 1. Absent systemd --user (disposable XDG_RUNTIME_DIR with no bus socket, no DBUS_SESSION_BUS_ADDRESS)
  const dirNoSystemd = join(iso.dir, "run-absent", "h2a-mcp-central");
  mkdirSync(dirname(dirNoSystemd), { recursive: true, mode: 0o700 });
  const root1 = join(iso.dir, "root1");
  mkdirSync(root1, { recursive: true, mode: 0o700 });
  const envNoSystemd = {
    PATH: process.env.PATH,
    HOME: iso.home,
    XDG_RUNTIME_DIR: join(iso.dir, "run-absent"),
    XDG_CONFIG_HOME: iso.xdgConfig,
    H2A_MCP_CENTRAL: "1",
    H2A_MCP_CENTRAL_ENDPOINT: await freeEndpoint(),
    TMPDIR: tempBase()
  };
  const errBuf1 = [];
  const launched1 = await launchCentral({
    directory: dirNoSystemd,
    root: root1,
    installation: installationForEntry(BIN_PATH),
    physicalPrefix: physicalPrefixForEntry(BIN_PATH) ?? join(REPO_ROOT, "packages/h2a"),
    fallbackEntry: BIN_PATH,
    environment: envNoSystemd,
    stderr: { write: (s) => { errBuf1.push(s); return true; } }
  });
  t.after(() => { try { process.kill(launched1.marker.pid, "SIGTERM"); } catch {} });
  assert.equal(launched1.reused, false);
  assert.ok(Number.isInteger(launched1.marker.pid) && launched1.marker.pid > 0);
  const fallbackText = errBuf1.join("");
  assert.match(fallbackText, /systemd --user unavailable.*falling back/);
  assert.match(readFileSync(join(dirNoSystemd, "mcp-central.log"), "utf8"), /systemd --user unavailable.*falling back/);
  try { process.kill(launched1.marker.pid, "SIGTERM"); } catch {}

  // 2. Stubbed busctl + bus socket simulating systemd --user under .tmp/ (never touching host systemd)
  const binDir = join(iso.dir, "stub-bin");
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(binDir, "package.json"), JSON.stringify({ type: "module" }) + "\n");
  const busctlLog = join(iso.dir, "busctl-args.txt");
  const busctlStub = join(binDir, "busctl");
  writeFileSync(
    busctlStub,
    `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(busctlLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
    { mode: 0o755 }
  );
  chmodSync(busctlStub, 0o755);

  const runWithSystemd = join(iso.dir, "run-present");
  mkdirSync(runWithSystemd, { recursive: true, mode: 0o700 });
  writeFileSync(join(runWithSystemd, "bus"), "");
  const dirWithSystemd = join(runWithSystemd, "h2a-mcp-central");
  const root2 = join(iso.dir, "root2");
  mkdirSync(root2, { recursive: true, mode: 0o700 });

  const scopeEvents = [];
  const launched2 = await launchCentral({
    directory: dirWithSystemd,
    root: root2,
    installation: installationForEntry(BIN_PATH),
    physicalPrefix: physicalPrefixForEntry(BIN_PATH) ?? join(REPO_ROOT, "packages/h2a"),
    fallbackEntry: BIN_PATH,
    environment: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: iso.home,
      XDG_RUNTIME_DIR: runWithSystemd,
      XDG_CONFIG_HOME: iso.xdgConfig,
      H2A_MCP_CENTRAL: "1",
      H2A_MCP_CENTRAL_ENDPOINT: await freeEndpoint(),
      TMPDIR: tempBase()
    },
    onSpawn: (_child, scope) => { if (scope) scopeEvents.push(scope); },
    stderr: { write: () => true }
  });
  t.after(() => { try { process.kill(launched2.marker.pid, "SIGTERM"); } catch {} });
  assert.equal(scopeEvents.length, 1);
  assert.equal(scopeEvents[0].isolated, true);
  assert.equal(scopeEvents[0].unit, "h2a-mcp-central.scope");
  const recordedCall = JSON.parse(readFileSync(busctlLog, "utf8").trim().split("\n")[0]);
  assert.ok(recordedCall.includes("StartTransientUnit"));
  assert.ok(recordedCall.includes("h2a-mcp-central.scope"));
  assert.ok(recordedCall.includes(String(CENTRAL_MEMORY_HIGH_BYTES)));
  assert.ok(recordedCall.includes(String(CENTRAL_MEMORY_MAX_BYTES)));
  assert.match(readFileSync(join(dirWithSystemd, "mcp-central.log"), "utf8"), /own systemd --user scope h2a-mcp-central\.scope \(MemoryHigh=3G, MemoryMax=4G/);
  try { process.kill(launched2.marker.pid, "SIGTERM"); } catch {}
});

// ---------------------------------------------------------------------------
// Point 3 (01M8C7HMMBMCTWR01YZMWAT07F & 01M8C72THY2J7Y58TCF0FRXATA):
// Shim/central version skew detection, plugin.json RC bump, release content gate.
// ---------------------------------------------------------------------------

test("Point 3a: shim detects plugin vs central version skew (warns on patch/RC skew, refuses incompatible major/minor)", async (t) => {
  assert.equal(comparePluginAndCentralVersions("0.98.11", "0.98.11").status, "aligned");
  const warnRes = comparePluginAndCentralVersions("0.98.11", "0.98.11-rc.15");
  assert.equal(warnRes.status, "warn");
  assert.match(warnRes.message, /0\.98\.11.*0\.98\.11-rc\.15/);
  const refuseRes = comparePluginAndCentralVersions("0.97.0", "0.98.11");
  assert.equal(refuseRes.status, "refuse");
  assert.equal(refuseRes.code, "incompatible_version");
  assert.match(refuseRes.message, /step=plugin-central-version-check/);

  const iso = makeIsoLab("mcp-robust-version-skew-");
  const central = await startCentralMcpServer({
    root: iso.root,
    runtimeBase: iso.xdgRuntime,
    physicalPrefix: REPO_ROOT,
    env: { H2A_MCP_CENTRAL_ENDPOINT: await freeEndpoint() }
  });
  t.after(async () => {
    await central.stop().catch(() => {});
    rmSync(iso.dir, { recursive: true, force: true });
  });

  const health = await (await fetch(new URL("/_h2a-central/health", central.endpoint))).json();
  assert.equal(health.packageVersion, currentCliVersion());

  const { pluginDir } = setupClaudePluginInstall(iso, currentCliVersion());
  await withEnv(
    {
      HOME: iso.home,
      XDG_CONFIG_HOME: iso.xdgConfig,
      XDG_RUNTIME_DIR: iso.xdgRuntime,
      H2A_ROOT: iso.root,
      CLAUDE_CODE_SESSION_ID: "version-skew-test"
    },
    async () => {
      const lockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath, host: "claude", profile: "default" });

      // Patch/RC skew emits clear warning and delegates
      const warnIo = makeStreams(iso.root);
      const warnCode = await cmdRegistryBridge(
        ["serve", "--host", "claude", "--profile", "default", "--plugin-version", "0.98.10", "--root", iso.root, "--runtime-base", iso.xdgRuntime],
        warnIo,
        { delegateServe: async () => 0 }
      );
      assert.equal(warnCode, 0, warnIo.text().stderr);
      assert.match(warnIo.text().stderr, /WARNING.*0\.98\.10.*differs from central MCP version/);

      // Incompatible 0.x minor skew refuses closed with incompatible_version
      const refuseIo = makeStreams(iso.root);
      const refuseCode = await cmdRegistryBridge(
        ["serve", "--host", "claude", "--profile", "default", "--plugin-version", "0.97.0", "--root", iso.root, "--runtime-base", iso.xdgRuntime],
        refuseIo,
        { delegateServe: async () => 0 }
      );
      assert.equal(refuseCode, 2);
      assert.match(refuseIo.text().stdout, /incompatible_version.*plugin version 0\.97\.0/);

      // Also verify h2a-bridge-shim.mjs reads plugin.json version from CLAUDE_PLUGIN_ROOT
      writeFileSync(
        join(pluginDir, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "h2a", version: "0.97.0", mcpServers: "./.claude-plugin/registry.mcp.json" }, null, 2)
      );
      const binDir = join(iso.dir, "bin");
      mkdirSync(binDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(binDir, "package.json"), JSON.stringify({ type: "module" }) + "\n");
      writeFileSync(
        join(binDir, "h2a"),
        `#!${process.execPath}\nimport "${BIN_PATH}";\n`,
        { mode: 0o755 }
      );
      const shimRun = spawnSync(
        process.execPath,
        [join(pluginDir, "scripts", "h2a-bridge-shim.mjs"), "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--root", iso.root, "--runtime-base", iso.xdgRuntime],
        {
          encoding: "utf8",
          env: {
            PATH: `${binDir}:${process.env.PATH}`,
            HOME: iso.home,
            XDG_CONFIG_HOME: iso.xdgConfig,
            XDG_RUNTIME_DIR: iso.xdgRuntime,
            H2A_ROOT: iso.root,
            CLAUDE_CODE_SESSION_ID: "version-skew-shim-proc",
            TMPDIR: tempBase()
          }
        }
      );
      assert.equal(shimRun.status, 2);
      assert.match(`${shimRun.stdout}\n${shimRun.stderr}`, /incompatible_version.*plugin version 0\.97\.0/);
    }
  );
});

test("Point 3b: release-candidate updates plugin.json manifests and release content check fails if plugin changes without version bump", async (t) => {
  const lab = mkdtempSync(join(tempBase(), "mcp-robust-release-plugin-"));
  t.after(() => rmSync(lab, { recursive: true, force: true }));

  const packages = ["track", "h2a-runtime", "h2a", "h2a-cli", "focus"];
  const baseVersion = "0.98.11";
  for (const pkgName of packages) {
    mkdirSync(join(lab, "packages", pkgName), { recursive: true });
    const ver = pkgName === "focus" ? "0.6.1" : baseVersion;
    writeFileSync(
      join(lab, "packages", pkgName, "package.json"),
      JSON.stringify({
        name: `@sentropic/${pkgName}`,
        version: ver,
        ...(pkgName === "h2a" ? { dependencies: { "@sentropic/track": baseVersion, "@sentropic/h2a-runtime": baseVersion, "@sentropic/focus": "0.6.1" } } : {}),
        ...(pkgName === "h2a-cli" ? { dependencies: { "@sentropic/h2a": baseVersion } } : {})
      }, null, 2) + "\n"
    );
  }
  mkdirSync(join(lab, "packages/h2a/.claude-plugin"), { recursive: true });
  mkdirSync(join(lab, "packages/h2a/.codex-plugin"), { recursive: true });
  mkdirSync(join(lab, "packages/h2a/skills/h2a"), { recursive: true });
  mkdirSync(join(lab, "scripts"), { recursive: true });

  writeFileSync(join(lab, "packages/h2a/.claude-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: baseVersion }, null, 2) + "\n");
  writeFileSync(join(lab, "packages/h2a/.codex-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: baseVersion }, null, 2) + "\n");
  writeFileSync(join(lab, "packages/h2a/skills/h2a/SKILL.md"), "# initial skill\n");
  writeFileSync(join(lab, "scripts/smoke-artifact.mjs"), `const PINNED_RUNTIME_VERSION = '${baseVersion}'\nconst PINNED_FOCUS_VERSION = '0.6.1'\n`);
  for (const rel of ["scripts/check-lockstep-versions.mjs", "scripts/check-plugin-version.mjs", "scripts/release-candidate.mjs"]) {
    cpSync(join(REPO_ROOT, rel), join(lab, rel));
  }

  // Initialize git repo + baseline tag v0.98.11
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Fabien Antoine",
    GIT_AUTHOR_EMAIL: "fabien.antoine@m4x.org",
    GIT_COMMITTER_NAME: "Fabien Antoine",
    GIT_COMMITTER_EMAIL: "fabien.antoine@m4x.org",
    TMPDIR: tempBase()
  };
  const git = (...args) => execFileSync("git", args, { cwd: lab, env: gitEnv, encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "release: v0.98.11");
  git("tag", "-a", "v0.98.11", "-m", "v0.98.11");

  // 1. Modify plugin skill content WITHOUT changing plugin.json version -> MUST fail
  writeFileSync(join(lab, "packages/h2a/skills/h2a/SKILL.md"), "# updated skill content\n");
  git("add", "packages/h2a/skills/h2a/SKILL.md");
  git("commit", "-q", "-m", "feat: update skill");
  assert.throws(
    () => checkPluginContentVersionBump(lab),
    /plugin_version_stale: plugin content changed since v0\.98\.11/
  );

  // 2. Drift check in checkLockstepVersions when plugin.json != package.json
  writeFileSync(join(lab, "packages/h2a/.claude-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: "0.98.10" }, null, 2) + "\n");
  assert.throws(() => checkLockstepVersions(lab), /Plugin manifest packages\/h2a\/\.claude-plugin\/plugin\.json version/);
  assert.throws(() => checkPluginManifestSync(lab), /plugin_version_sync_failed/);
  // Restore matching version before prepare
  writeFileSync(join(lab, "packages/h2a/.claude-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: baseVersion }, null, 2) + "\n");

  // 3. Running `release-candidate.mjs prepare` on v0.98.11-rc.3 stamps both plugin.json files AND passes checks
  const rcPrep = spawnSync(process.execPath, [join(lab, "scripts/release-candidate.mjs"), "prepare"], {
    cwd: lab,
    encoding: "utf8",
    env: {
      ...gitEnv,
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/tags/v0.98.11-rc.3",
      GITHUB_ENV: join(lab, "github-env")
    }
  });
  assert.equal(rcPrep.status, 0, rcPrep.stderr);
  assert.equal(JSON.parse(readFileSync(join(lab, "packages/h2a/.claude-plugin/plugin.json"), "utf8")).version, "0.98.11-rc.3");
  assert.equal(JSON.parse(readFileSync(join(lab, "packages/h2a/.codex-plugin/plugin.json"), "utf8")).version, "0.98.11-rc.3");
  assert.equal(checkLockstepVersions(lab), "0.98.11-rc.3");
  assert.equal(checkPluginContentVersionBump(lab).currentVersion, "0.98.11-rc.3");
});
