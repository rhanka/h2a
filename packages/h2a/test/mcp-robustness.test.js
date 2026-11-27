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
      assert.equal(serveTamperIo.text().stdout.includes("integrity_mismatch: integrity_mismatch:"), false);
      assert.match(serveTamperIo.text().stdout, /h2a registry bootstrap rotate --host claude --profile default --mechanism plugin/);
      assert.equal(readFileSync(lockPath, "utf8"), tamperedBytes);
    }
  );
});

test("Point 1d (B1 PoC non-regression): modified descriptor with 0.0.0-evil or uncompiled digest fails closed on both --lock --auto-upgrade and default plugin paths", async (t) => {
  const { CURRENT_SHIPPED_ENTRY_DIGESTS, PRIOR_SHIPPED_ENTRY_DIGESTS, isPublishedPackageVersion, isStrictlyNewerSemver } = await import("../dist/registry/bridge-lock.js");
  assert.equal(isPublishedPackageVersion("0.0.0-evil"), false);
  assert.equal(isPublishedPackageVersion("0.0.0"), false);
  assert.equal(isPublishedPackageVersion("0.98.11"), true);
  assert.equal(isStrictlyNewerSemver("0.98.11", "0.98.11"), false);
  assert.equal(isStrictlyNewerSemver("0.98.11", "0.98.11-rc.15"), true);
  for (const [, desc] of PRIOR_SHIPPED_ENTRY_DIGESTS) {
    assert.notEqual(desc.packageVersion, currentCliVersion(), "current CLI version digest must never be in PRIOR_SHIPPED_ENTRY_DIGESTS");
  }

  const iso = makeIsoLab("mcp-robust-b1-poc-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  const installedVer = currentCliVersion();
  const { pluginDir } = setupClaudePluginInstall(iso, installedVer);

  // Unit-level tamper check via refreshUpgradedPluginLock on healthy lock
  const evilH2a = structuredClone(registryPackageManifest.entries[0]);
  evilH2a.description = "tampered evil description";
  evilH2a.publisher.packageVersion = "0.0.0-evil";
  const realTrack = structuredClone(trackRegistryPackageManifest.entries[0]);

  await withEnv(
    { HOME: iso.home, XDG_CONFIG_HOME: iso.xdgConfig, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_MCP_CENTRAL: "0" },
    async () => {
      const pluginLockPath = defaultPluginBridgeLockPath("claude", "default");
      provisionBridgeLock({ lockPath: pluginLockPath, host: "claude", profile: "default" });
      const pluginLockBefore = readFileSync(pluginLockPath, "utf8");

      const refreshEvil = refreshUpgradedPluginLock({
        host: "claude", configPath: "", profile: "default", pluginDir,
        h2aEntry: evilH2a, trackEntry: realTrack
      });
      assert.equal(refreshEvil.refreshed, false);
      assert.equal(readFileSync(pluginLockPath, "utf8"), pluginLockBefore);

      // Even if a tampered descriptor claims installedVer, compiled digest check rejects it
      const subtleEvil = structuredClone(registryPackageManifest.entries[0]);
      subtleEvil.description = "subtle uncompiled tamper";
      assert.equal(
        refreshUpgradedPluginLock({
          host: "claude", configPath: "", profile: "default", pluginDir,
          h2aEntry: subtleEvil, trackEntry: realTrack
        }).refreshed,
        false
      );
      assert.equal(readFileSync(pluginLockPath, "utf8"), pluginLockBefore);
      assert.equal(existsSync(bridgeLockJournalPath(pluginLockPath)), false);
      assert.ok(CURRENT_SHIPPED_ENTRY_DIGESTS.get("sentropic.h2a"));

      // End-to-end Opus review PoC: copy built packages into temp workspace with tampered entries.v1.json (description + 0.0.0-evil)
      const pocRepo = join(iso.dir, "poc-repo");
      const pocH2a = join(pocRepo, "packages", "h2a");
      const pocTrack = join(pocRepo, "packages", "track");
      mkdirSync(pocH2a, { recursive: true });
      mkdirSync(pocTrack, { recursive: true });
      for (const rel of ["package.json", "dist", "registry", "fixtures", "vendor", "scripts", "schema"]) {
        if (existsSync(join(REPO_ROOT, "packages/h2a", rel))) {
          cpSync(join(REPO_ROOT, "packages/h2a", rel), join(pocH2a, rel), { recursive: true });
        }
      }
      for (const rel of ["package.json", "dist", "registry"]) {
        if (existsSync(join(REPO_ROOT, "packages/track", rel))) {
          cpSync(join(REPO_ROOT, "packages/track", rel), join(pocTrack, rel), { recursive: true });
        }
      }
      mkdirSync(join(pocRepo, "node_modules/@sentropic"), { recursive: true });
      // Resolve external deps from repo root node_modules + @sentropic/track to our pocTrack
      execFileSync("ln", ["-s", pocTrack, join(pocRepo, "node_modules/@sentropic/track")]);
      for (const entry of readdirSync(join(REPO_ROOT, "node_modules"))) {
        if (entry === ".bin") continue;
        if (entry === "@sentropic") {
          for (const sub of readdirSync(join(REPO_ROOT, "node_modules/@sentropic"))) {
            if (sub === "track") continue;
            execFileSync("ln", ["-s", join(REPO_ROOT, "node_modules/@sentropic", sub), join(pocRepo, "node_modules/@sentropic", sub)]);
          }
          continue;
        }
        execFileSync("ln", ["-s", join(REPO_ROOT, "node_modules", entry), join(pocRepo, "node_modules", entry)]);
      }

      const pocEntriesPath = join(pocH2a, "registry/entries.v1.json");
      const tamperedManifest = JSON.parse(readFileSync(pocEntriesPath, "utf8"));
      tamperedManifest.entries[0].description = "tampered PoC description";
      tamperedManifest.entries[0].publisher.packageVersion = "0.0.0-evil";
      writeFileSync(pocEntriesPath, JSON.stringify(tamperedManifest, null, 2) + "\n");

      const explicitLockPath = join(iso.dir, "explicit-healthy.lock.json");
      provisionBridgeLock({ lockPath: explicitLockPath, host: "claude", profile: "default" });
      const explicitBefore = readFileSync(explicitLockPath, "utf8");
      const pocBin = join(pocH2a, "dist/bin.js");

      // 1) Explicit --lock --auto-upgrade MUST refuse closed
      const explicitPocRun = spawnSync(
        process.execPath,
        [pocBin, "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--lock", explicitLockPath, "--auto-upgrade", "--instance", "claude:poc-lock"],
        {
          cwd: pocRepo,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            HOME: iso.home,
            XDG_CONFIG_HOME: iso.xdgConfig,
            XDG_RUNTIME_DIR: iso.xdgRuntime,
            H2A_ROOT: iso.root,
            H2A_MCP_CENTRAL: "0",
            TMPDIR: tempBase()
          }
        }
      );
      assert.equal(explicitPocRun.status, 2, explicitPocRun.stdout + explicitPocRun.stderr);
      assert.match(explicitPocRun.stdout + explicitPocRun.stderr, /integrity_mismatch/);
      assert.match(explicitPocRun.stdout + explicitPocRun.stderr, /bridge-lock-new-descriptor-verification/);
      assert.equal(explicitPocRun.stdout.includes("0.0.0-evil") && readFileSync(explicitLockPath, "utf8") !== explicitBefore, false);
      assert.equal(readFileSync(explicitLockPath, "utf8"), explicitBefore);
      assert.equal(existsSync(bridgeLockJournalPath(explicitLockPath)), false);

      // 2) Default plugin path (--auto-upgrade with cached 0.98.11 plugin) MUST refuse closed
      const pluginPocRun = spawnSync(
        process.execPath,
        [pocBin, "registry-bridge", "serve", "--host", "claude", "--profile", "default", "--auto-upgrade", "--instance", "claude:poc-plugin"],
        {
          cwd: pocRepo,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            HOME: iso.home,
            XDG_CONFIG_HOME: iso.xdgConfig,
            XDG_RUNTIME_DIR: iso.xdgRuntime,
            H2A_ROOT: iso.root,
            H2A_MCP_CENTRAL: "0",
            TMPDIR: tempBase()
          }
        }
      );
      assert.equal(pluginPocRun.status, 2, pluginPocRun.stdout + pluginPocRun.stderr);
      assert.match(pluginPocRun.stdout + pluginPocRun.stderr, /integrity_mismatch/);
      assert.match(pluginPocRun.stdout + pluginPocRun.stderr, /bridge-lock-new-descriptor-verification/);
      assert.equal(readFileSync(pluginLockPath, "utf8"), pluginLockBefore);
      assert.equal(existsSync(bridgeLockJournalPath(pluginLockPath)), false);
    }
  );
});

// ---------------------------------------------------------------------------
// Point 2 (01M8A9B52FJWJGGMSX1W3048TC): Central MCP owns systemd --user scope
// (MemoryHigh=3G, MemoryMax=4G) + clean fallback with message when absent.
// ---------------------------------------------------------------------------

test("Point 2a: isolateCentralSystemdScope generates unique per-generation scopes, handles real busctl errors, and verifies /proc/<pid>/cgroup", async (t) => {
  const iso = makeIsoLab("mcp-robust-scope-unit-");
  t.after(() => rmSync(iso.dir, { recursive: true, force: true }));

  const busPath = join(iso.xdgRuntime, "bus");
  writeFileSync(busPath, "");

  // 1. Default calls generate distinct unique scope names per generation
  const seenUnits = [];
  for (let gen = 0; gen < 2; gen++) {
    const busCalls = [];
    const res = await isolateCentralSystemdScope(4242, {
      platform: "linux",
      environment: { XDG_RUNTIME_DIR: iso.xdgRuntime },
      cgroupVerifyTimeoutMs: 50,
      cgroupPollIntervalMs: 5,
      runBusctl: async (args) => {
        busCalls.push(args);
        return { stdout: "", stderr: "" };
      },
      readCgroup: () => {
        const unitArg = busCalls[0]?.find((arg) => typeof arg === "string" && arg.endsWith(".scope"));
        return `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${unitArg}\n`;
      }
    });
    assert.equal(res.isolated, true);
    assert.match(res.unit, /^h2a-mcp-central-.*\.scope$/);
    assert.equal(res.memoryHighBytes, 3 * 1024 ** 3);
    assert.equal(res.memoryMaxBytes, 4 * 1024 ** 3);
    assert.ok(busCalls[0].includes("StartTransientUnit"));
    assert.ok(busCalls[0].includes(String(CENTRAL_MEMORY_HIGH_BYTES)));
    assert.ok(busCalls[0].includes(String(CENTRAL_MEMORY_MAX_BYTES)));
    seenUnits.push(res.unit);
  }
  assert.notEqual(seenUnits[0], seenUnits[1], "each central generation must receive a unique scope name");

  // 2. Handover collision recognizes real busctl message ("was already loaded or has a fragment file")
  let realErrAttempt = 0;
  const busArgsSeen = [];
  const realOverlapRes = await isolateCentralSystemdScope(9876, {
    platform: "linux",
    generation: "handover-gen-2",
    environment: {
      XDG_RUNTIME_DIR: iso.xdgRuntime,
      H2A_MCP_CENTRAL_SYSTEMD_UNIT: "h2a-mcp-central.scope"
    },
    cgroupVerifyTimeoutMs: 50,
    cgroupPollIntervalMs: 5,
    runBusctl: async (args) => {
      busArgsSeen.push(args);
      realErrAttempt++;
      if (realErrAttempt === 1) {
        throw Object.assign(new Error("Command failed: busctl --user call ..."), {
          stderr: "Call failed: Unit h2a-mcp-central.scope was already loaded or has a fragment file.\n"
        });
      }
      return { stdout: "", stderr: "" };
    },
    readCgroup: () => "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-mcp-central-handover-gen-2.scope\n"
  });
  assert.equal(realErrAttempt, 2);
  assert.equal(realOverlapRes.isolated, true);
  assert.equal(realOverlapRes.unit, "h2a-mcp-central-handover-gen-2.scope");

  // 3. Delayed async move into target scope (polls /proc/<pid>/cgroup until confirmed)
  let cgroupReads = 0;
  const asyncMoveRes = await isolateCentralSystemdScope(7777, {
    platform: "linux",
    generation: "async-move-gen",
    environment: { XDG_RUNTIME_DIR: iso.xdgRuntime },
    cgroupVerifyTimeoutMs: 250,
    cgroupPollIntervalMs: 10,
    runBusctl: async () => ({ stdout: "", stderr: "" }),
    readCgroup: () => {
      cgroupReads++;
      if (cgroupReads < 3) {
        return "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-session-caller.scope\n";
      }
      return "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-mcp-central-async-move-gen.scope\n";
    }
  });
  assert.equal(asyncMoveRes.isolated, true);
  assert.ok(cgroupReads >= 3);
  assert.match(asyncMoveRes.cgroupPath, /h2a-mcp-central-async-move-gen\.scope$/);

  // 4. PID remaining in caller scope sets isolated:false (never lies about scope ownership)
  const unconfirmedRes = await isolateCentralSystemdScope(8888, {
    platform: "linux",
    generation: "unmoved-gen",
    environment: { XDG_RUNTIME_DIR: iso.xdgRuntime },
    cgroupVerifyTimeoutMs: 40,
    cgroupPollIntervalMs: 10,
    runBusctl: async () => ({ stdout: "", stderr: "" }),
    readCgroup: () => "0::/user.slice/user-1000.slice/user@1000.service/app.slice/h2a-session-123.scope\n"
  });
  assert.equal(unconfirmedRes.isolated, false);
  assert.equal(unconfirmedRes.reason, "scope_verification_failed");
  assert.match(unconfirmedRes.cgroupPath, /h2a-session-123\.scope$/);
  assert.match(unconfirmedRes.message, /isolated=false/);

  // 5. Absent systemd --user falls back cleanly with message
  const absentRes = await isolateCentralSystemdScope(4242, {
    platform: "linux",
    environment: { XDG_RUNTIME_DIR: join(iso.dir, "empty-run") }
  });
  assert.equal(absentRes.isolated, false);
  assert.equal(absentRes.reason, "systemd_user_absent");
  assert.match(absentRes.message, /systemd --user unavailable/);
});

test("Point 2b: launchCentral requests unique generation scope and verifies /proc/<pid>/cgroup before setting isolated=true", async (t) => {
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

  // 2. Stubbed busctl where kernel cgroup did NOT actually move -> isolated MUST be false (scope_verification_failed)
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

  const scopeEventsUnmoved = [];
  const launched2 = await launchCentral({
    directory: dirWithSystemd,
    root: root2,
    installation: installationForEntry(BIN_PATH),
    physicalPrefix: physicalPrefixForEntry(BIN_PATH) ?? join(REPO_ROOT, "packages/h2a"),
    fallbackEntry: BIN_PATH,
    scopeOptions: { cgroupVerifyTimeoutMs: 40, cgroupPollIntervalMs: 10 },
    environment: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: iso.home,
      XDG_RUNTIME_DIR: runWithSystemd,
      XDG_CONFIG_HOME: iso.xdgConfig,
      H2A_MCP_CENTRAL: "1",
      H2A_MCP_CENTRAL_ENDPOINT: await freeEndpoint(),
      TMPDIR: tempBase()
    },
    onSpawn: (_child, scope) => { if (scope) scopeEventsUnmoved.push(scope); },
    stderr: { write: () => true }
  });
  t.after(() => { try { process.kill(launched2.marker.pid, "SIGTERM"); } catch {} });
  assert.equal(scopeEventsUnmoved.length, 1);
  assert.equal(scopeEventsUnmoved[0].isolated, false, "real /proc/<pid>/cgroup was not moved by stub busctl so isolated must be false");
  assert.equal(scopeEventsUnmoved[0].reason, "scope_verification_failed");
  const recordedCall = JSON.parse(readFileSync(busctlLog, "utf8").trim().split("\n")[0]);
  assert.ok(recordedCall.includes("StartTransientUnit"));
  const requestedUnit = recordedCall.find((arg) => typeof arg === "string" && arg.endsWith(".scope"));
  assert.match(requestedUnit, /^h2a-mcp-central-.*\.scope$/);
  try { process.kill(launched2.marker.pid, "SIGTERM"); } catch {}

  // 3. Confirmed cgroup move sets isolated:true with the generation-unique unit
  const runConfirmed = join(iso.dir, "run-confirmed");
  mkdirSync(runConfirmed, { recursive: true, mode: 0o700 });
  writeFileSync(join(runConfirmed, "bus"), "");
  const dirConfirmed = join(runConfirmed, "h2a-mcp-central");
  const root3 = join(iso.dir, "root3");
  mkdirSync(root3, { recursive: true, mode: 0o700 });
  const scopeEventsConfirmed = [];
  const launched3 = await launchCentral({
    directory: dirConfirmed,
    root: root3,
    installation: installationForEntry(BIN_PATH),
    physicalPrefix: physicalPrefixForEntry(BIN_PATH) ?? join(REPO_ROOT, "packages/h2a"),
    fallbackEntry: BIN_PATH,
    scopeOptions: {
      cgroupVerifyTimeoutMs: 50,
      cgroupPollIntervalMs: 10,
      readCgroup: () => {
        const lines = readFileSync(busctlLog, "utf8").trim().split("\n");
        const args = JSON.parse(lines[lines.length - 1]);
        const unitArg = args.find((arg) => typeof arg === "string" && arg.endsWith(".scope"));
        return `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${unitArg}\n`;
      }
    },
    environment: {
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: iso.home,
      XDG_RUNTIME_DIR: runConfirmed,
      XDG_CONFIG_HOME: iso.xdgConfig,
      H2A_MCP_CENTRAL: "1",
      H2A_MCP_CENTRAL_ENDPOINT: await freeEndpoint(),
      TMPDIR: tempBase()
    },
    onSpawn: (_child, scope) => { if (scope) scopeEventsConfirmed.push(scope); },
    stderr: { write: () => true }
  });
  t.after(() => { try { process.kill(launched3.marker.pid, "SIGTERM"); } catch {} });
  assert.equal(scopeEventsConfirmed.length, 1);
  assert.equal(scopeEventsConfirmed[0].isolated, true);
  assert.match(scopeEventsConfirmed[0].unit, /^h2a-mcp-central-.*\.scope$/);
  assert.notEqual(scopeEventsConfirmed[0].unit, requestedUnit, "new generation uses a distinct scope name");
  assert.match(readFileSync(join(dirConfirmed, "mcp-central.log"), "utf8"), /own systemd --user scope h2a-mcp-central-.*\.scope \(MemoryHigh=3G, MemoryMax=4G/);
  try { process.kill(launched3.marker.pid, "SIGTERM"); } catch {}
});

// ---------------------------------------------------------------------------
// Point 3 (01M8C7HMMBMCTWR01YZMWAT07F & 01M8C72THY2J7Y58TCF0FRXATA):
// Shim/central version skew warning (protocol-only refusal), git RC plugin.json
// bump flow, and strict release content gate (shallow fail + RC->stable promotion).
// ---------------------------------------------------------------------------

test("Point 3a (B4): shim warns on plugin/central SemVer skew (incl. 0.x minor) and refuses only on explicit protocol mismatch", async (t) => {
  assert.equal(comparePluginAndCentralVersions("0.98.11", "0.98.11").status, "aligned");
  for (const [pluginVer, centralVer] of [
    ["0.98.11", "0.98.11-rc.15"],
    ["0.97.0", "0.98.11"],
    ["0.98.11", "0.99.0-rc.1"],
    ["0.99.0-rc.1", "0.98.11"],
    ["1.0.0", "0.98.11"]
  ]) {
    const warnRes = comparePluginAndCentralVersions(pluginVer, centralVer);
    assert.equal(warnRes.status, "warn", `expected warn for ${pluginVer} vs ${centralVer}`);
    assert.equal(warnRes.code, "version_skew");
    assert.match(warnRes.message, new RegExp(pluginVer.replaceAll(".", "\\.")));
  }

  for (const badMarker of [
    { protocol: 1, schemaVersion: 2, handoverProtocol: 1, mcpProtocolVersions: ["2025-06-18"] },
    { protocol: 2, schemaVersion: 1, handoverProtocol: 1, mcpProtocolVersions: ["2025-06-18"] },
    { protocol: 2, schemaVersion: 2, handoverProtocol: 2, mcpProtocolVersions: ["2025-06-18"] },
    { protocol: 2, schemaVersion: 2, handoverProtocol: 1, mcpProtocolVersions: ["2020-01-01"] }
  ]) {
    const refuseRes = comparePluginAndCentralVersions("0.98.11", "0.98.11", {
      centralMarker: badMarker,
      supportedProtocols: ["2025-06-18", "2024-11-05"]
    });
    assert.equal(refuseRes.status, "refuse", JSON.stringify(badMarker));
    assert.equal(refuseRes.code, "incompatible_version");
    assert.match(refuseRes.message, /step=plugin-central-version-check/);
  }

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

      // Patch/RC skew AND 0.x minor skew (e.g. 0.97.0 / 0.99.0-rc.1) warn clearly and stay connected
      for (const skewedVersion of ["0.98.10", "0.97.0", "0.99.0-rc.1"]) {
        const warnIo = makeStreams(iso.root);
        const warnCode = await cmdRegistryBridge(
          ["serve", "--host", "claude", "--profile", "default", "--plugin-version", skewedVersion, "--root", iso.root, "--runtime-base", iso.xdgRuntime],
          warnIo,
          { delegateServe: async () => 0 }
        );
        assert.equal(warnCode, 0, warnIo.text().stderr);
        assert.match(warnIo.text().stderr, new RegExp(`WARNING.*${skewedVersion.replaceAll(".", "\\.")}.*differs from central MCP version`));
      }

      // Also verify h2a-bridge-shim.mjs with plugin.json at 0.97.0 warns cleanly and stays alive (not exit 2)
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
          input: "",
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
      assert.equal(shimRun.status, 0, shimRun.stdout + shimRun.stderr);
      assert.match(shimRun.stderr, /WARNING.*0\.97\.0.*differs from central MCP version/);
    }
  );
});

test("Point 3b (NB-a & NB-b): git plugin.json RC bumps, shallow failure, RC->stable same-tree promotion, and live repo sync", async (t) => {
  // Verify live repository manifests & compiled shipped digests match cleanly
  assert.ok(checkPluginManifestSync(REPO_ROOT));
  const liveGenCheck = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/generate-registry-entries.mjs"), "--check"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  assert.equal(liveGenCheck.status, 0, liveGenCheck.stdout + liveGenCheck.stderr);

  const lab = mkdtempSync(join(tempBase(), "mcp-robust-release-plugin-"));
  const shallow = mkdtempSync(join(tempBase(), "mcp-robust-release-shallow-"));
  t.after(() => {
    rmSync(lab, { recursive: true, force: true });
    rmSync(shallow, { recursive: true, force: true });
  });

  const packages = ["track", "h2a-runtime", "h2a", "h2a-cli", "focus"];
  const initVer = "0.98.11";
  const writeRepoVersions = (ver) => {
    writeFileSync(join(lab, "package.json"), JSON.stringify({ name: "h2a-root", version: ver, private: true }, null, 2) + "\n");
    for (const pkgName of packages) {
      mkdirSync(join(lab, "packages", pkgName), { recursive: true });
      const effectiveVer = pkgName === "focus" ? "0.6.1" : ver;
      writeFileSync(
        join(lab, "packages", pkgName, "package.json"),
        JSON.stringify({
          name: `@sentropic/${pkgName}`,
          version: effectiveVer,
          ...(pkgName === "h2a" ? { dependencies: { "@sentropic/track": ver, "@sentropic/h2a-runtime": ver, "@sentropic/focus": "0.6.1" } } : {}),
          ...(pkgName === "h2a-cli" ? { dependencies: { "@sentropic/h2a": ver } } : {})
        }, null, 2) + "\n"
      );
    }
    writeFileSync(join(lab, "packages/h2a/.claude-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: ver }, null, 2) + "\n");
    writeFileSync(join(lab, "packages/h2a/.codex-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: ver }, null, 2) + "\n");
    writeFileSync(join(lab, "scripts/smoke-artifact.mjs"), `const PINNED_RUNTIME_VERSION = '${ver}'\nconst PINNED_FOCUS_VERSION = '0.6.1'\n`);
  };

  mkdirSync(join(lab, "packages/h2a/.claude-plugin"), { recursive: true });
  mkdirSync(join(lab, "packages/h2a/.codex-plugin"), { recursive: true });
  mkdirSync(join(lab, "packages/h2a/skills/h2a"), { recursive: true });
  mkdirSync(join(lab, "scripts"), { recursive: true });
  writeRepoVersions(initVer);
  writeFileSync(join(lab, "packages/h2a/skills/h2a/SKILL.md"), "# initial skill\n");
  for (const rel of ["scripts/check-lockstep-versions.mjs", "scripts/check-plugin-version.mjs", "scripts/release-candidate.mjs"]) {
    cpSync(join(REPO_ROOT, rel), join(lab, rel));
  }

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Fabien Antoine",
    GIT_AUTHOR_EMAIL: "fabien.antoine@m4x.org",
    GIT_COMMITTER_NAME: "Fabien Antoine",
    GIT_COMMITTER_EMAIL: "fabien.antoine@m4x.org",
    TMPDIR: tempBase()
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
  git(lab, "init", "-q");
  git(lab, "add", ".");
  git(lab, "commit", "-q", "-m", "release: v0.98.11");
  git(lab, "tag", "-a", "v0.98.11", "-m", "v0.98.11");

  // 1. Shallow clone MUST fail closed (`plugin_version_check_incomplete`), never skip
  execFileSync("git", ["clone", "--depth=1", `file://${lab}`, shallow], { env: gitEnv, encoding: "utf8" });
  assert.throws(
    () => checkPluginContentVersionBump(shallow),
    /plugin_version_check_incomplete: shallow git checkout/
  );

  // 2. Modifying plugin skill without git bump in plugin.json fails BOTH checkPluginContentVersionBump AND RC `prepare`
  writeFileSync(join(lab, "packages/h2a/skills/h2a/SKILL.md"), "# updated skill v1\n");
  git(lab, "add", "packages/h2a/skills/h2a/SKILL.md");
  git(lab, "commit", "-q", "-m", "feat: update skill");
  assert.throws(
    () => checkPluginContentVersionBump(lab),
    /plugin_version_stale: plugin content changed since v0\.98\.11/
  );
  const staleRcPrep = spawnSync(process.execPath, [join(lab, "scripts/release-candidate.mjs"), "prepare"], {
    cwd: lab,
    encoding: "utf8",
    env: {
      ...gitEnv,
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/tags/v0.98.11-rc.2",
      GITHUB_ENV: join(lab, "github-env-stale")
    }
  });
  assert.notEqual(staleRcPrep.status, 0, "unbumped git plugin.json must fail even on an RC tag");
  assert.match(staleRcPrep.stderr, /plugin_version_stale/);

  // 3. Committing the RC bump on git (`0.99.0-rc.1`) makes plugin.json change in the git marketplace and passes check + prepare
  writeRepoVersions("0.99.0-rc.1");
  git(lab, "add", ".");
  git(lab, "commit", "-q", "-m", "release: v0.99.0-rc.1");
  git(lab, "tag", "-a", "v0.99.0-rc.1", "-m", "v0.99.0-rc.1");
  assert.equal(checkPluginContentVersionBump(lab).baseRef, "v0.98.11");

  // Next RC (`v0.99.0-rc.2`) changes skill AND bumps git plugin.json -> 0.99.0-rc.2
  writeFileSync(join(lab, "packages/h2a/skills/h2a/SKILL.md"), "# updated skill v2\n");
  writeRepoVersions("0.99.0-rc.2");
  git(lab, "add", ".");
  git(lab, "commit", "-q", "-m", "release: v0.99.0-rc.2");
  git(lab, "tag", "-a", "v0.99.0-rc.2", "-m", "v0.99.0-rc.2");
  const rc2Prep = spawnSync(process.execPath, [join(lab, "scripts/release-candidate.mjs"), "prepare"], {
    cwd: lab,
    encoding: "utf8",
    env: {
      ...gitEnv,
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/tags/v0.99.0-rc.2",
      GITHUB_ENV: join(lab, "github-env-rc2")
    }
  });
  assert.equal(rc2Prep.status, 0, rc2Prep.stderr);
  assert.equal(checkLockstepVersions(lab), "0.99.0-rc.2");

  // 4. Promoting stable (`v0.99.0`) on the EXACT same tree/commit as `v0.99.0-rc.2` MUST pass checkPluginContentVersionBump
  git(lab, "tag", "-a", "v0.99.0", "-m", "v0.99.0");
  await withEnv({ GITHUB_REF: "refs/tags/v0.99.0" }, async () => {
    const promo = checkPluginContentVersionBump(lab);
    assert.equal(promo.checked, true);
    assert.equal(promo.baseRef, "v0.99.0-rc.2");
    assert.deepEqual(promo.changedFiles, []);
  });

  // 5. Drift check in checkLockstepVersions & checkPluginManifestSync when plugin.json != package.json
  writeFileSync(join(lab, "packages/h2a/.claude-plugin/plugin.json"), JSON.stringify({ name: "h2a", version: "0.98.10" }, null, 2) + "\n");
  assert.throws(() => checkLockstepVersions(lab), /Plugin manifest packages\/h2a\/\.claude-plugin\/plugin\.json version/);
  assert.throws(() => checkPluginManifestSync(lab), /plugin_version_sync_failed/);
});
