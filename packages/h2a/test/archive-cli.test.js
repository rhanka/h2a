import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");
const BIN_JS = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
const RUNTIME_ARCHIVE_JS = join(REPO_ROOT, "packages", "h2a-runtime", "dist", "session-archive.js");
const SCRATCH_PARENT = join(REPO_ROOT, ".tmp", "archive-cli-test");

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeIsolatedEnv() {
  mkdirSync(SCRATCH_PARENT, { recursive: true });
  const root = mkdtempSync(join(SCRATCH_PARENT, "run-"));
  const home = join(root, "home");
  const xdgData = join(root, "xdg-data");
  const claudeDir = join(root, "claude-config");
  const workspace = join(root, "project-x");
  const h2aRoot = join(root, "h2a-root");
  const projectDir = join(claudeDir, "projects", workspace.replaceAll("/", "-"));
  const stagingTmp = join(root, "local-tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(xdgData, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(h2aRoot, { recursive: true });
  mkdirSync(stagingTmp, { recursive: true });

  return {
    root,
    home,
    xdgData,
    claudeDir,
    workspace,
    h2aRoot,
    projectDir,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      XDG_DATA_HOME: xdgData,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      CLAUDE_CONFIG_DIR: claudeDir,
      REMOTE_CLI_CONFIG_HOME: home,
      H2A_ROOT: h2aRoot,
      TMPDIR: stagingTmp,
    },
  };
}

function runCli(args, env, cwd) {
  return spawnSync(process.execPath, [BIN_JS, ...args], {
    env,
    cwd,
    encoding: "utf8",
  });
}

test.after(() => {
  rmSync(SCRATCH_PARENT, { recursive: true, force: true });
});

test("h2a archive CLI (scan, dry-run, pass kill-switch, status alert, list, verify, restore, corruption)", async (t) => {
  const iso = makeIsolatedEnv();
  t.after(() => {
    rmSync(iso.root, { recursive: true, force: true });
  });

  // Setup synthetic Claude session aged 22 days under 30d default -> 8 days until purge (< 14d alert).
  const jsonlPath = join(iso.projectDir, `${SESSION_UUID}.jsonl`);
  const companionDir = join(iso.projectDir, SESSION_UUID);
  mkdirSync(companionDir, { recursive: true });
  writeFileSync(
    jsonlPath,
    `${JSON.stringify({ type: "user", cwd: iso.workspace, message: "synthetic" })}\n`,
    "utf8",
  );
  writeFileSync(join(companionDir, "note.txt"), "companion note\n", "utf8");
  const aged = new Date(Date.now() - 22 * DAY_MS);
  utimesSync(join(companionDir, "note.txt"), aged, aged);
  utimesSync(companionDir, aged, aged);
  utimesSync(jsonlPath, aged, aged);

  // 1. `h2a archive scan --json` detects eligible session + <14d alert.
  const scanRes = runCli(["archive", "scan", "--json"], iso.env, iso.workspace);
  assert.equal(scanRes.status, 0, scanRes.stderr);
  const scanJson = JSON.parse(scanRes.stdout);
  assert.equal(scanJson.sessions.length, 1);
  assert.equal(scanJson.sessions[0].sessionId, SESSION_UUID);
  assert.equal(scanJson.sessions[0].originCwd, iso.workspace);
  assert.equal(scanJson.alerts.length, 1);
  assert.equal(scanJson.alerts[0].kind, "purge-imminent");

  // 2. `h2a status` surfaces `<14d` alert on stderr while keeping stdout valid JSON.
  const statusRes = runCli(["status", "--root", iso.h2aRoot], iso.env, iso.workspace);
  assert.equal(statusRes.status, 0, statusRes.stderr);
  const statusJson = JSON.parse(statusRes.stdout);
  assert.equal(statusJson.ok, true);
  assert.match(statusRes.stderr, /purge-imminent|not yet archived/i);

  // 3. `h2a archive run --dry-run --json` plans archive without mutating disk.
  const dryRes = runCli(["archive", "run", "--dry-run", "--json"], iso.env, iso.workspace);
  assert.equal(dryRes.status, 0, dryRes.stderr);
  const dryJson = JSON.parse(dryRes.stdout);
  assert.deepEqual(dryJson.wouldArchive, [SESSION_UUID]);

  // 4. `H2A_ARCHIVE_OFF=1 h2a archive pass --json` honors kill-switch and writes last-run.json.
  const offRes = runCli(
    ["archive", "pass", "--json"],
    { ...iso.env, H2A_ARCHIVE_OFF: "1" },
    iso.workspace,
  );
  assert.equal(offRes.status, 0, offRes.stderr);
  const offJson = JSON.parse(offRes.stdout);
  assert.equal(offJson.witness.status, "skipped");
  assert.equal(offJson.witness.reason, "disabled-by-env:H2A_ARCHIVE_OFF");
  assert.equal(existsSync(join(iso.xdgData, "h2a", "session-archives", "last-run.json")), true);

  // 5. If running inside an isolated container/bwrap PID namespace, mutating `archive run` refuses visibly.
  let inInitPidNs = false;
  try {
    inInitPidNs = readlinkSync("/proc/self/ns/pid") === "pid:[4026531836]";
  } catch {
    inInitPidNs = false;
  }
  if (!inInitPidNs) {
    const blockedRes = runCli(["archive", "run", "--json"], iso.env, iso.workspace);
    assert.notEqual(blockedRes.status, 0);
    const blockedJson = JSON.parse(blockedRes.stdout);
    assert.equal(blockedJson.errorCode, "PID_NAMESPACE_GUARD");
  }

  // 6. Commit an archive using the compiled runtime engine (host PID probe injected for sandbox parity),
  //    then exercise `h2a archive list`, `verify`, `restore`, and corrupted-archive rejection via real CLI.
  const mod = await import(RUNTIME_ARCHIVE_JS);
  const runOutcome = mod.runSessionArchive({
    env: iso.env,
    deps: { probeHostPidNamespace: () => ({ ok: true }) },
  });
  assert.equal(runOutcome.ok, true);
  assert.equal(runOutcome.archived.length, 1);

  const listRes = runCli(["archive", "list", "--json"], iso.env, iso.workspace);
  assert.equal(listRes.status, 0, listRes.stderr);
  const listJson = JSON.parse(listRes.stdout);
  assert.equal(listJson.length, 1);
  assert.equal(listJson[0].originCwd, iso.workspace);

  const verifyOkRes = runCli(["archive", "verify", SESSION_UUID, "--json"], iso.env, iso.workspace);
  assert.equal(verifyOkRes.status, 0, verifyOkRes.stderr);
  assert.equal(JSON.parse(verifyOkRes.stdout).ok, true);

  // Delete originals and restore manually via CLI -> mtime refreshed, archive intact.
  rmSync(jsonlPath, { force: true });
  rmSync(companionDir, { recursive: true, force: true });
  const beforeRestoreMs = Date.now();
  const restoreRes = runCli(["archive", "restore", SESSION_UUID, "--json"], iso.env, iso.workspace);
  assert.equal(restoreRes.status, 0, restoreRes.stderr);
  const restoreJson = JSON.parse(restoreRes.stdout);
  assert.equal(restoreJson.ok, true);
  assert.equal(existsSync(jsonlPath), true);
  assert.equal(existsSync(join(companionDir, "note.txt")), true);
  assert.ok(statSync(jsonlPath).mtimeMs >= beforeRestoreMs - 2_000);
  assert.equal(existsSync(listJson[0].archiveAbsPath), true);

  // Corrupt the tarball -> `h2a archive verify` and `h2a archive restore` both fail cleanly.
  chmodSync(listJson[0].archiveAbsPath, 0o600);
  const tampered = readFileSync(listJson[0].archiveAbsPath);
  const originalArchiveBackup = Buffer.from(tampered);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  writeFileSync(listJson[0].archiveAbsPath, tampered);

  const verifyFailRes = runCli(["archive", "verify", SESSION_UUID, "--json"], iso.env, iso.workspace);
  assert.notEqual(verifyFailRes.status, 0);
  assert.equal(JSON.parse(verifyFailRes.stdout).ok, false);

  rmSync(jsonlPath, { force: true });
  rmSync(companionDir, { recursive: true, force: true });
  const restoreFailRes = runCli(["archive", "restore", SESSION_UUID, "--json"], iso.env, iso.workspace);
  assert.notEqual(restoreFailRes.status, 0);
  assert.equal(existsSync(jsonlPath), false);

  // Restore valid tarball bytes so we can test B-1 CLI index protection + rebuild-index end-to-end.
  writeFileSync(listJson[0].archiveAbsPath, originalArchiveBackup);
  const indexPath = join(iso.xdgData, "h2a", "session-archives", "claude", "index.json");
  writeFileSync(indexPath, '{"schemaVersion": 2, "cli": "claude", "sessions": {}}\n', "utf8");
  const v2Bytes = readFileSync(indexPath);

  const listCorrupt = runCli(["archive", "list", "--json"], iso.env, iso.workspace);
  assert.notEqual(listCorrupt.status, 0);
  assert.equal(JSON.parse(listCorrupt.stdout).errorCode, "INDEX_UNREADABLE");
  assert.equal(readFileSync(indexPath).equals(v2Bytes), true);

  const passCorrupt = runCli(["archive", "pass", "--json"], iso.env, iso.workspace);
  assert.notEqual(passCorrupt.status, 0);
  assert.equal(JSON.parse(passCorrupt.stdout).witness.reason, "INDEX_UNREADABLE");
  assert.equal(readFileSync(indexPath).equals(v2Bytes), true);

  // `h2a status` surfaces the unreadable index and failed pass alerts on stderr.
  const statusCorrupt = runCli(["status", "--root", iso.h2aRoot], iso.env, iso.workspace);
  assert.equal(statusCorrupt.status, 0);
  assert.match(statusCorrupt.stderr, /unreadable|schemaVersion 2/i);

  // `h2a claude --local --resume <id>` catches auto-restore error cleanly without stack trace.
  const resumeCorrupt = runCli(["claude", "--local", "--resume", SESSION_UUID], iso.env, iso.workspace);
  assert.notEqual(resumeCorrupt.status, 0);
  assert.match(resumeCorrupt.stderr, /archive auto-restore failed/);
  assert.doesNotMatch(resumeCorrupt.stderr, /\n\s+at /);

  // `rebuild-index` refuses without `--force` over schema v2, then succeeds with `--force`.
  const rebuildRefuse = runCli(["archive", "rebuild-index", "--json"], iso.env, iso.workspace);
  assert.notEqual(rebuildRefuse.status, 0);
  assert.equal(readFileSync(indexPath).equals(v2Bytes), true);

  const rebuildForce = runCli(["archive", "rebuild-index", "--force", "--json"], iso.env, iso.workspace);
  assert.equal(rebuildForce.status, 0, rebuildForce.stderr);
  const rebuildJson = JSON.parse(rebuildForce.stdout);
  assert.equal(rebuildJson.ok, true);
  assert.equal(rebuildJson.versionsCount, 1);
  assert.equal(JSON.parse(runCli(["archive", "list", "--json"], iso.env, iso.workspace).stdout).length, 1);

  // Unknown-schema lock file is never broken by age: pass reports `locked`, `unlock` inspects without removing, `unlock --force` clears it.
  const lockPath = join(iso.xdgData, "h2a", "session-archives", "archive.lock");
  writeFileSync(lockPath, JSON.stringify({ schemaVersion: 2, token: "future-lock", pid: 999_999_999 }), "utf8");
  const agedLock = new Date(Date.now() - 60_000);
  utimesSync(lockPath, agedLock, agedLock);

  const lockedPass = runCli(["archive", "pass", "--json"], iso.env, iso.workspace);
  assert.notEqual(lockedPass.status, 0);
  assert.equal(JSON.parse(lockedPass.stdout).witness.status, "locked");
  assert.equal(existsSync(lockPath), true);

  const statusLocked = runCli(["status", "--root", iso.h2aRoot], iso.env, iso.workspace);
  assert.equal(statusLocked.status, 0);
  assert.match(statusLocked.stderr, /writer lock|ARCHIVE_LOCKED/i);

  const unlockInspect = runCli(["archive", "unlock", "--json"], iso.env, iso.workspace);
  assert.notEqual(unlockInspect.status, 0);
  assert.equal(JSON.parse(unlockInspect.stdout).unlocked, false);
  assert.equal(existsSync(lockPath), true);

  const unlockForce = runCli(["archive", "unlock", "--force", "--json"], iso.env, iso.workspace);
  assert.equal(unlockForce.status, 0, unlockForce.stderr);
  assert.equal(JSON.parse(unlockForce.stdout).unlocked, true);
  assert.equal(existsSync(lockPath), false);
});

test("h2a archive schedule CLI fails closed without @sentropic/local-scheduler and surfaces scheduler banners in status", async (t) => {
  const iso = makeIsolatedEnv();
  t.after(() => {
    rmSync(iso.root, { recursive: true, force: true });
  });

  // 1. Help surface exposes enable/disable/status/uninstall and hides _schedule-exec; restore stays separate.
  const schedHelp = runCli(["archive", "schedule", "--help"], iso.env, iso.workspace);
  assert.equal(schedHelp.status, 0, schedHelp.stderr);
  for (const verb of ["enable", "disable", "status", "uninstall"]) {
    assert.match(schedHelp.stdout, new RegExp(`\\b${verb}\\b`));
  }
  assert.doesNotMatch(schedHelp.stdout, /_schedule-exec/);

  const archiveHelp = runCli(["archive", "--help"], iso.env, iso.workspace);
  assert.equal(archiveHelp.status, 0);
  assert.doesNotMatch(archiveHelp.stdout, /_schedule-exec/);

  const restoreHelp = runCli(["restore", "--help"], iso.env, iso.workspace);
  assert.equal(restoreHelp.status, 0);
  assert.doesNotMatch(restoreHelp.stdout, /\bschedule\b/);

  // 2. Real-package resolution absent -> explicit LOCAL_SCHEDULER_NOT_INSTALLED (exit 69) without installing anything.
  for (const subcmd of ["enable", "disable", "status", "uninstall"]) {
    const res = runCli(["archive", "schedule", subcmd, "--json"], iso.env, iso.workspace);
    assert.equal(res.status, 69, `${subcmd}: ${res.stderr} ${res.stdout}`);
    const body = JSON.parse(res.stdout);
    assert.equal(body.ok, false);
    assert.equal(body.errorCode, "LOCAL_SCHEDULER_NOT_INSTALLED");
    assert.equal(body.exitCode, 69);
    assert.match(body.error, /local-scheduler not installed/i);
  }

  const textEnable = runCli(["archive", "schedule", "enable"], iso.env, iso.workspace);
  assert.equal(textEnable.status, 69);
  assert.match(textEnable.stderr, /local-scheduler not installed/i);

  const execAbsent = runCli(["archive", "_schedule-exec", "h2a-session-archive"], iso.env, iso.workspace);
  assert.equal(execAbsent.status, 69);
  assert.match(execAbsent.stderr, /LOCAL_SCHEDULER_NOT_INSTALLED/);
  assert.match(execAbsent.stderr, /local-scheduler not installed/i);

  // 3. --scheduled & --max-duration & H2A_ARCHIVE_OFF on BIN_JS entrypoint.
  const sessionUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const jsonlPath = join(iso.projectDir, `${sessionUuid}.jsonl`);
  writeFileSync(
    jsonlPath,
    JSON.stringify({
      type: "user",
      sessionId: sessionUuid,
      cwd: iso.workspace,
      timestamp: "2026-10-01T10:00:00.000Z",
      message: { role: "user", content: "scheduled smoke" },
    }) + "\n",
    "utf8",
  );
  const aged19d = new Date(Date.now() - 19 * DAY_MS);
  utimesSync(jsonlPath, aged19d, aged19d);

  const passKillSwitch = runCli(
    ["archive", "run", "--once", "--scheduled", "--json"],
    { ...iso.env, H2A_ARCHIVE_OFF: "1" },
    iso.workspace,
  );
  assert.equal(passKillSwitch.status, 0, passKillSwitch.stderr);
  const killJson = JSON.parse(passKillSwitch.stdout);
  assert.equal(killJson.ok, true);
  assert.equal(killJson.witness.status, "skipped");
  assert.equal(killJson.witness.reason, "disabled-by-env:H2A_ARCHIVE_OFF");

  // --dry-run + --scheduled --max-duration 1440s exits 0 even outside host init PID namespace.
  const passDryScheduled = runCli(
    [
      "archive",
      "run",
      "--once",
      "--cli",
      "claude",
      "--older-than",
      "14d",
      "--max-duration",
      "1440s",
      "--scheduled",
      "--dry-run",
      "--json",
    ],
    iso.env,
    iso.workspace,
  );
  assert.equal(passDryScheduled.status, 0, passDryScheduled.stderr);
  const drySchedJson = JSON.parse(passDryScheduled.stdout);
  assert.equal(drySchedJson.ok, true);
  assert.equal(drySchedJson.witness.status, "ok");
  assert.deepEqual(drySchedJson.runResult.wouldArchive, [sessionUuid]);

  // Real CLI mutating `--scheduled` outside host init PID ns refuses on PID_NAMESPACE_GUARD.
  let inInitPidNs = false;
  try {
    inInitPidNs = readlinkSync("/proc/self/ns/pid") === "pid:[4026531836]";
  } catch {
    inInitPidNs = false;
  }
  const passLiveScheduled = runCli(
    [
      "archive",
      "run",
      "--once",
      "--cli",
      "claude",
      "--older-than",
      "14d",
      "--max-duration",
      "1440s",
      "--scheduled",
      "--json",
    ],
    iso.env,
    iso.workspace,
  );
  if (inInitPidNs) {
    assert.equal(passLiveScheduled.status, 0, passLiveScheduled.stderr);
    const liveJson = JSON.parse(passLiveScheduled.stdout);
    assert.equal(liveJson.ok, true);
    assert.equal(liveJson.witness.archived, 1);
  } else {
    assert.equal(passLiveScheduled.status, 2);
    const blockedSched = JSON.parse(passLiveScheduled.stdout);
    assert.equal(blockedSched.ok, false);
    assert.equal(blockedSched.witness.reason, "PID_NAMESPACE_GUARD");
  }

  // 4. Synthetic scheduler state with stale (>36h) last-run surfaces CRITICAL alerts on h2a status and h2a status --human.
  const stateDir = join(iso.env.XDG_STATE_HOME, "sentropic", "local-scheduler");
  const taskDir = join(stateDir, "tasks", "h2a-session-archive");
  mkdirSync(taskDir, { recursive: true });
  chmodSync(stateDir, 0o700);
  chmodSync(taskDir, 0o700);

  const staleIso = new Date(Date.now() - 40 * 3_600_000).toISOString();
  const manifest = {
    v: 1,
    enabled: true,
    installedAt: staleIso,
    enabledAt: staleIso,
    stateDir,
    envFilePath: join(iso.env.XDG_CONFIG_HOME, "sentropic", "local-scheduler", "env"),
    expectedIntervalMs: 86_400_000,
    runner: {
      bin: process.execPath,
      args: [BIN_JS, "archive", "_schedule-exec"],
    },
    units: {
      serviceSha256: "a".repeat(64),
      timerSha256: "b".repeat(64),
    },
    spec: {
      v: 1,
      taskId: "h2a-session-archive",
      owner: "h2a",
      description: "Periodic Claude Code session archive pass",
      schedule: {
        onCalendar: "daily",
        persistent: true,
        expectedIntervalMs: 86_400_000,
        graceMultiplier: 1.5,
      },
      command: {
        bin: process.execPath,
        args: [
          BIN_JS,
          "archive",
          "run",
          "--cli",
          "claude",
          "--older-than",
          "14d",
          "--max-duration",
          "1440s",
          "--scheduled",
        ],
      },
      timeoutMs: 1_500_000,
      killSwitchEnv: "H2A_ARCHIVE_OFF",
    },
  };
  writeFileSync(join(taskDir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  const staleWitness = {
    v: 1,
    taskId: "h2a-session-archive",
    owner: "h2a",
    runId: "11111111-1111-4111-8111-111111111111",
    trigger: "systemd-timer",
    host: "synthetic-host",
    pid: 12345,
    startedAt: staleIso,
    finishedAt: staleIso,
    durationMs: 250,
    outcome: "succeeded",
    exitCode: 0,
    signal: null,
    consecutiveFailures: 0,
    lastSuccessAt: staleIso,
    lastSuccessRunId: "11111111-1111-4111-8111-111111111111",
  };
  writeFileSync(join(taskDir, "last-run.json"), JSON.stringify(staleWitness, null, 2), { mode: 0o600 });

  const statusJsonRes = runCli(["status", "--root", iso.h2aRoot], iso.env, iso.workspace);
  assert.equal(statusJsonRes.status, 0, statusJsonRes.stderr);
  assert.doesNotThrow(() => JSON.parse(statusJsonRes.stdout));
  assert.match(statusJsonRes.stderr, /\[archive-schedule CRITICAL\] status=schedule_missed/);

  const statusHumanRes = runCli(["status", "--root", iso.h2aRoot, "--human"], iso.env, iso.workspace);
  assert.equal(statusHumanRes.status, 0, statusHumanRes.stderr);
  assert.match(statusHumanRes.stderr, /h2a status: \[archive-schedule CRITICAL\] status=schedule_missed/);
});
