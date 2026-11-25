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
});
