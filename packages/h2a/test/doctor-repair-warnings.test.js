import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { H2A_CLI_VERB_CONTRACTS, renderCliHelp, runCli, writePresence } from "../dist/index.js";

function withTempFixture(fn) {
  const base = mkdtempSync(join(tmpdir(), "h2a-doctor-repair-warn-"));
  const home = join(base, "home");
  const cwdDir = join(base, "repo");
  const root = join(home, "h2a-workspace", ".h2a");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwdDir, { recursive: true });

  const savedHome = process.env.HOME;
  const savedRoot = process.env.H2A_ROOT;
  process.env.HOME = home;
  delete process.env.H2A_ROOT;

  function captureStreams(cwd = cwdDir) {
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

  const healthyHostDoctor = () => ({
    ok: true,
    repair: true,
    dryRun: false,
    sessionFreshnessGuarantee: "ok",
    nativeCommandFailureLimit: "ok",
    version: "0.98.9",
    hosts: []
  });

  try {
    runCli(["init", "--root", root], captureStreams(cwdDir));
    return fn({ base, home, cwdDir, root, captureStreams, healthyHostDoctor });
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedRoot === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = savedRoot;
    rmSync(base, { recursive: true, force: true });
  }
}

function backdateTree(targetPath, ageMs = 48 * 60 * 60 * 1000) {
  const past = new Date(Date.now() - ageMs);
  const st = statSync(targetPath);
  if (st.isDirectory()) {
    for (const entry of readdirSync(targetPath)) {
      backdateTree(join(targetPath, entry), ageMs);
    }
  }
  utimesSync(targetPath, past, past);
}

test("without --repair: warnings state they are repairable with --repair, rootSource is info, nothing moved", () => {
  withTempFixture(({ home, cwdDir, root, captureStreams }) => {
    const sentropicDir = join(home, ".sentropic");
    mkdirSync(sentropicDir, { recursive: true });
    const legacyFile = join(sentropicDir, "accounts.json");
    writeFileSync(legacyFile, "opaque-legacy-data\n", "utf8");

    const localBus = join(cwdDir, ".h2a");
    runCli(["init", "--root", localBus], captureStreams(cwdDir));

    const hostlessDir = join(root, "inbox", "agent__a2a-cli__55951e02e21a");
    mkdirSync(hostlessDir, { recursive: true });

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--skip-hosts"], streams);
    assert.equal(rc, 0, streams.stderrText);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, true);

    const legacyWarn = report.warnings.find((w) => w.check === "legacyAccountArtifacts");
    const rootSourceWarn = report.warnings.find((w) => w.check === "rootSource");
    const splitWarn = report.warnings.find((w) => w.check === "splitBrain");
    const inboxWarn = report.warnings.find((w) => w.check === "inboxHygiene" && w.kind === "hostlessDirs");

    assert.ok(legacyWarn, "expected legacyAccountArtifacts warning");
    assert.match(legacyWarn.message, /--repair/);
    assert.ok(rootSourceWarn, "expected rootSource warning");
    assert.equal(rootSourceWarn.info, true);
    assert.ok(splitWarn, "expected splitBrain warning");
    assert.match(splitWarn.message, /--repair/);
    assert.ok(inboxWarn, "expected inboxHygiene hostlessDirs warning");
    assert.match(inboxWarn.message, /--repair/);

    assert.equal(existsSync(legacyFile), true);
    assert.equal(existsSync(localBus), true);
    assert.equal(existsSync(hostlessDir), true);
    assert.equal(existsSync(join(root, ".quarantine")), false);
  });
});

test("doctor --repair: moves legacyAccountArtifacts to 0700 quarantine with manifest (no content)", () => {
  withTempFixture(({ home, cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const sentropicDir = join(home, ".sentropic");
    mkdirSync(sentropicDir, { recursive: true });
    const names = [
      "accounts.json",
      "accounts-tokens.json",
      "session-bindings.json",
      "account-quota.json",
      "session-log.jsonl"
    ];
    const sentinel = "SENTINEL_NEVER_COPY_OR_PRINT_CONTENT_9918273";
    for (const name of names) {
      writeFileSync(join(sentropicDir, name), `${sentinel}:${name}\n`, "utf8");
    }

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 0, streams.stderrText);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, true);

    const legacyWarn = report.warnings.find((w) => w.check === "legacyAccountArtifacts");
    assert.ok(legacyWarn, "expected legacyAccountArtifacts warning entry");
    assert.equal(legacyWarn.status, "repaired");
    assert.equal(legacyWarn.repaired, true);
    assert.ok(legacyWarn.quarantinePath, "expected quarantinePath on repaired warning");
    assert.ok(legacyWarn.quarantinePath.startsWith(join(root, ".quarantine", "doctor-")));

    for (const name of names) {
      assert.equal(existsSync(join(sentropicDir, name)), false, `${name} should be moved out of ~/.sentropic`);
      assert.equal(existsSync(join(legacyWarn.quarantinePath, name)), true, `${name} should exist in quarantine`);
    }

    const quarantineRunDir = join(legacyWarn.quarantinePath, "..");
    const mode = statSync(quarantineRunDir).mode & 0o777;
    assert.equal(mode, 0o700, `expected 0700 perms on quarantine dir, got ${mode.toString(8)}`);

    const manifestPath = join(quarantineRunDir, "manifest.json");
    assert.equal(existsSync(manifestPath), true, "expected manifest.json in quarantine dir");
    const rawManifest = readFileSync(manifestPath, "utf8");
    assert.equal(rawManifest.includes(sentinel), false, "manifest must NEVER include file content");
    assert.equal(streams.stdoutText.includes(sentinel), false, "stdout must NEVER include file content");

    const manifest = JSON.parse(rawManifest);
    assert.equal(manifest.items.length, names.length);
    for (const item of manifest.items) {
      assert.equal(typeof item.path, "string");
      assert.equal(typeof item.size, "number");
      assert.ok(item.size > 0);
      assert.equal(typeof item.mtime, "string");
      assert.equal("content" in item, false);
    }
  });
});

test("doctor --repair: moves inactive split-brain bus and keeps rootSource informational", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const localBus = join(cwdDir, ".h2a");
    runCli(["init", "--root", localBus], captureStreams(cwdDir));
    backdateTree(localBus, 48 * 60 * 60 * 1000);

    const streams = captureStreams(cwdDir);
    // Omit --root so rootSource=default warning also fires alongside splitBrain
    const rc = runCli(["doctor", "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 0, streams.stderrText);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, true);

    const rootSourceWarn = report.warnings.find((w) => w.check === "rootSource");
    assert.ok(rootSourceWarn);
    assert.equal(rootSourceWarn.status, "info");
    assert.equal(rootSourceWarn.info, true);

    const splitWarn = report.warnings.find((w) => w.check === "splitBrain");
    assert.ok(splitWarn);
    assert.equal(splitWarn.status, "repaired");
    assert.equal(splitWarn.repaired, true);
    assert.ok(splitWarn.quarantinePath.startsWith(join(root, ".quarantine", "doctor-")));
    assert.equal(existsSync(localBus), false, "inactive split-brain bus should be moved out");
    assert.equal(existsSync(join(splitWarn.quarantinePath, ".h2a-schema.json")), true, "quarantined bus contents preserved");
  });
});

test("doctor --repair: refuses active split-brain bus when a lock is held", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const localBus = join(cwdDir, ".h2a");
    runCli(["init", "--root", localBus], captureStreams(cwdDir));
    const lockFile = join(localBus, "registry", ".lock");
    writeFileSync(lockFile, "locked\n", "utf8");
    backdateTree(localBus, 48 * 60 * 60 * 1000);

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 2);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, false);

    const splitWarn = report.warnings.find((w) => w.check === "splitBrain");
    assert.ok(splitWarn);
    assert.equal(splitWarn.status, "skipped");
    assert.equal(splitWarn.skipped, true);
    assert.match(splitWarn.reason, /lock/i);
    assert.equal(existsSync(localBus), true, "locked split-brain bus must not be moved");
  });
});

test("doctor --repair: refuses active split-brain bus when modified within 24h", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const localBus = join(cwdDir, ".h2a");
    runCli(["init", "--root", localBus], captureStreams(cwdDir));
    // Do NOT backdate: files were modified < 24h ago

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 2);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, false);

    const splitWarn = report.warnings.find((w) => w.check === "splitBrain");
    assert.ok(splitWarn);
    assert.equal(splitWarn.status, "skipped");
    assert.equal(splitWarn.skipped, true);
    assert.match(splitWarn.reason, /24\s*h|recent|modified/i);
    assert.equal(existsSync(localBus), true, "recent split-brain bus must not be moved");
  });
});

test("doctor --repair: refuses split-brain bus when a live presence points to it", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const localBus = join(cwdDir, ".h2a");
    runCli(["init", "--root", localBus], captureStreams(cwdDir));
    writePresence(localBus, {
      sessionId: "sess:live-local",
      instance: "claude:repo:aaaaaaaaaaaa",
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: []
    });
    backdateTree(localBus, 48 * 60 * 60 * 1000);

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 2);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, false);

    const splitWarn = report.warnings.find((w) => w.check === "splitBrain");
    assert.ok(splitWarn);
    assert.equal(splitWarn.status, "skipped");
    assert.equal(splitWarn.skipped, true);
    assert.match(splitWarn.reason, /presence|live/i);
    assert.equal(existsSync(localBus), true, "split-brain bus with live presence must not be moved");
  });
});

test("doctor --repair: moves empty and >24h hostless inbox dirs to quarantine", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const emptyHostless = join(root, "inbox", "agent__a2a-cli__55951e02e21a");
    const oldHostless = join(root, "inbox", "agent__bpmn-moddle-py__eecf4c224280");
    mkdirSync(emptyHostless, { recursive: true });
    mkdirSync(oldHostless, { recursive: true });
    writeFileSync(join(oldHostless, "env-1.json"), "{}\n", "utf8");
    backdateTree(oldHostless, 48 * 60 * 60 * 1000);

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 0, streams.stderrText);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, true);

    const inboxWarn = report.warnings.find((w) => w.check === "inboxHygiene" && w.kind === "hostlessDirs");
    assert.ok(inboxWarn);
    assert.equal(inboxWarn.status, "repaired");
    assert.equal(inboxWarn.repaired, true);
    assert.ok(inboxWarn.quarantinePath.startsWith(join(root, ".quarantine", "doctor-")));

    assert.equal(existsSync(emptyHostless), false);
    assert.equal(existsSync(oldHostless), false);
    assert.equal(existsSync(join(inboxWarn.quarantinePath, "agent__a2a-cli__55951e02e21a")), true);
    assert.equal(existsSync(join(inboxWarn.quarantinePath, "agent__bpmn-moddle-py__eecf4c224280", "env-1.json")), true);
  });
});

test("doctor --repair: refuses hostless inbox dir referenced by live presence", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const liveHostless = join(root, "inbox", "agent__a2a-cli__55951e02e21a");
    mkdirSync(liveHostless, { recursive: true });
    writePresence(root, {
      sessionId: "sess:live-hostless",
      instance: "claude:a2a-cli:55951e02e21a",
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: [], negotiations: [] },
      subscribedTopics: []
    });

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 2);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, false);

    const inboxWarn = report.warnings.find((w) => w.check === "inboxHygiene" && w.kind === "hostlessDirs");
    assert.ok(inboxWarn);
    assert.equal(inboxWarn.status, "skipped");
    assert.equal(inboxWarn.skipped, true);
    assert.match(inboxWarn.reason, /presence|live/i);
    assert.equal(existsSync(liveHostless), true, "hostless inbox referenced by live presence must remain");
  });
});

test("doctor --repair: refuses non-empty recent hostless inbox dir (<24h)", () => {
  withTempFixture(({ cwdDir, root, captureStreams, healthyHostDoctor }) => {
    const recentHostless = join(root, "inbox", "agent__recent__33090d073ed4");
    mkdirSync(recentHostless, { recursive: true });
    writeFileSync(join(recentHostless, "env-fresh.json"), "{\"id\":\"env-fresh\"}\n", "utf8");

    const streams = captureStreams(cwdDir);
    const rc = runCli(["doctor", "--root", root, "--repair", "--skip-hosts"], streams, {
      doctorHostInstallations: healthyHostDoctor
    });
    assert.equal(rc, 2);
    const report = JSON.parse(streams.stdoutText);
    assert.equal(report.ok, false);

    const inboxWarn = report.warnings.find((w) => w.check === "inboxHygiene" && w.kind === "hostlessDirs");
    assert.ok(inboxWarn);
    assert.equal(inboxWarn.status, "skipped");
    assert.equal(inboxWarn.skipped, true);
    assert.match(inboxWarn.reason, /24\s*h|recent|modified/i);
    assert.equal(existsSync(recentHostless), true, "recent non-empty hostless inbox must remain");
  });
});

test("doctor help and contract document what --repair moves to .quarantine", () => {
  const help = renderCliHelp();
  assert.match(help, /\.quarantine\/doctor-/);
  const contract = H2A_CLI_VERB_CONTRACTS.find((c) => c.verb === "doctor");
  assert.ok(contract);
  assert.match(contract.description, /\.quarantine\/doctor-/);
  assert.match(contract.description, /0700/);
  assert.match(contract.description, /manifest/);
});
