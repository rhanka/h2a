import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectStatusForH2a } from "./status-projection.js";

import { tryAcquireFileLock, releaseFileLock } from "./file-lock.js";
import { readProcessStartTime, type DurableProcFrame } from "./proc-identity.js";
import {
  ARCHIVE_ALERT_EXIT_CODE,
  checkDiskSpaceGuard,
  emitResumeArchiveNotices,
  ensureClaudeSessionRestoredForResume,
  formatArchiveAlertLine,
  listSessionArchives,
  loadLastRunWitness,
  probeHostPidNamespace,
  readClaudeArchiveAlerts,
  readClaudeCleanupPeriodDays,
  rebuildArchiveIndex,
  releaseArchiveLock,
  resolveArchivePaths,
  restoreSessionArchive,
  runArchivePassOnce,
  runSessionArchive,
  scanClaudeSessions,
  SessionArchiveError,
  tryAcquireArchiveLock,
  unlockArchiveLock,
  verifySessionArchives,
  type ArchiveDeps,
  type ArchiveLockRecord,
  DAY_MS,
} from "./session-archive.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEST_TMP_ROOT = join(REPO_ROOT, ".tmp", "session-archive-unit");
const RUNTIME_ARCHIVE_SRC = join(REPO_ROOT, "packages", "h2a-runtime", "src", "session-archive.ts");
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_ORPHAN = "44444444-4444-4444-8444-444444444444";

const FIXED_NOW_MS = Date.UTC(2026, 10, 25, 12, 0, 0);

interface FixtureBox {
  readonly root: string;
  readonly home: string;
  readonly xdgData: string;
  readonly claudeDir: string;
  readonly projectDirName: string;
  readonly projectDir: string;
  readonly originCwd: string;
  readonly registryPath: string;
  readonly leasesPath: string;
  readonly env: NodeJS.ProcessEnv;
}

function makeFixtureBox(): FixtureBox {
  mkdirSync(TEST_TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEST_TMP_ROOT, "case-"));
  const home = join(root, "home");
  const xdgData = join(root, "xdg-data");
  const claudeDir = join(root, "claude-config");
  const originCwd = join(root, "workspace-alpha");
  const projectDirName = originCwd.replaceAll("/", "-");
  const projectDir = join(claudeDir, "projects", projectDirName);
  const h2aStateDir = join(home, ".config", "sentropic", "h2a");
  mkdirSync(home, { recursive: true });
  mkdirSync(xdgData, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(originCwd, { recursive: true });
  mkdirSync(h2aStateDir, { recursive: true });
  mkdirSync(join(root, "local-tmp"), { recursive: true });
  return {
    root,
    home,
    xdgData,
    claudeDir,
    projectDirName,
    projectDir,
    originCwd,
    registryPath: join(h2aStateDir, "registry.json"),
    leasesPath: join(h2aStateDir, "session-leases.json"),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      XDG_DATA_HOME: xdgData,
      CLAUDE_CONFIG_DIR: claudeDir,
      REMOTE_CLI_CONFIG_HOME: home,
      TMPDIR: join(root, "local-tmp"),
    },
  };
}

function writeClaudeSession(
  box: FixtureBox,
  sessionId: string,
  options: {
    readonly mtimeDaysAgo: number;
    readonly companionFiles?: Readonly<Record<string, { readonly content: string; readonly mtimeDaysAgo?: number }>>;
    readonly extraLine?: string;
    readonly jsonlBytes?: string;
  },
): { readonly jsonlPath: string; readonly companionDir?: string } {
  const jsonlPath = join(box.projectDir, `${sessionId}.jsonl`);
  const payload =
    options.jsonlBytes ??
    `${JSON.stringify({ type: "user", cwd: box.originCwd, sessionId, message: "hello" })}\n` +
      (options.extraLine ? `${options.extraLine}\n` : "");
  writeFileSync(jsonlPath, payload, "utf8");

  if (options.companionFiles) {
    const companionDir = join(box.projectDir, sessionId);
    for (const [rel, spec] of Object.entries(options.companionFiles)) {
      const target = join(companionDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, spec.content, "utf8");
      const ageDays = spec.mtimeDaysAgo ?? options.mtimeDaysAgo;
      const dt = new Date(FIXED_NOW_MS - ageDays * DAY_MS);
      utimesSync(target, dt, dt);
    }
    const baseDt = new Date(FIXED_NOW_MS - options.mtimeDaysAgo * DAY_MS);
    utimesSync(companionDir, baseDt, baseDt);
    utimesSync(jsonlPath, baseDt, baseDt);
    return { jsonlPath, companionDir };
  }

  const dt = new Date(FIXED_NOW_MS - options.mtimeDaysAgo * DAY_MS);
  utimesSync(jsonlPath, dt, dt);
  return { jsonlPath };
}

function okDeps(box: FixtureBox, overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    nowMs: () => FIXED_NOW_MS,
    probeHostPidNamespace: () => ({ ok: true }),
    statfs: () => ({ bsize: 4096, blocks: 50_000_000, bavail: 40_000_000 }),
    registryPath: box.registryPath,
    leasesPath: box.leasesPath,
    readProcView: () => ({ currentBootId: "test-boot", processes: new Map(), entries: [] }),
    isPidAlive: () => false,
    tmuxHasSession: () => false,
    nativeSessionLiveness: () => false,
    ...overrides,
  };
}

let activeBoxes: FixtureBox[] = [];

function createBox(): FixtureBox {
  const box = makeFixtureBox();
  activeBoxes.push(box);
  return box;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const box of activeBoxes) {
    rmSync(box.root, { recursive: true, force: true });
  }
  activeBoxes = [];
});

afterAll(() => {
  rmSync(TEST_TMP_ROOT, { recursive: true, force: true });
});

describe("session-archive engine (Claude Lot 1, keep-only)", () => {
  beforeEach(() => {
    mkdirSync(TEST_TMP_ROOT, { recursive: true });
  });

  it("archives transcript + companion with manifest, 0600 perms, tar compatibility, and leaves originals & out-of-scope untouched", () => {
    const box = createBox();
    writeFileSync(
      join(box.claudeDir, "settings.json"),
      JSON.stringify({ cleanupPeriodDays: 90 }),
      "utf8",
    );

    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 20,
      companionFiles: {
        "subagents/agent-a.jsonl": { content: '{"role":"assistant","text":"sub"}\n' },
        "archived.json": { content: '{"archivedBy":"claude"}\n' },
      },
    });
    const memoryFile = join(box.projectDir, "memory", "MEMORY.md");
    mkdirSync(dirname(memoryFile), { recursive: true });
    writeFileSync(memoryFile, "# Persistent project memory\n", "utf8");

    const fileHistory = join(box.claudeDir, "file-history", "snap.txt");
    mkdirSync(dirname(fileHistory), { recursive: true });
    writeFileSync(fileHistory, "history", "utf8");

    const sessionEnv = join(box.claudeDir, "session-env", "env.json");
    mkdirSync(dirname(sessionEnv), { recursive: true });
    writeFileSync(sessionEnv, "{}", "utf8");

    const orphanDir = join(box.projectDir, UUID_ORPHAN);
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "orphan.txt"), "leftover", "utf8");

    const paths = resolveArchivePaths({ env: box.env });
    const scanBefore = scanClaudeSessions({ env: box.env, deps: okDeps(box) });
    expect(scanBefore.sessions).toHaveLength(1);
    expect(scanBefore.orphanCompanionDirs.map((d) => d.sessionId)).toEqual([UUID_ORPHAN]);
    expect(scanBefore.sessions[0]?.cleanupPeriodDays).toBe(90);

    const res = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(res.ok).toBe(true);
    expect(res.archived).toHaveLength(1);
    const archived = res.archived[0]!;
    expect(archived.sessionId).toBe(UUID_1);
    expect(archived.originCwd).toBe(box.originCwd);

    // Originals remain completely untouched (keep-only invariant).
    expect(existsSync(s1.jsonlPath)).toBe(true);
    expect(existsSync(join(s1.companionDir!, "archived.json"))).toBe(true);
    expect(existsSync(memoryFile)).toBe(true);
    expect(existsSync(fileHistory)).toBe(true);
    expect(existsSync(sessionEnv)).toBe(true);
    expect(existsSync(orphanDir)).toBe(true);

    // Archive file has mode 0600, .staging/ is clean, and tar -xzf extracts standard layout.
    const tarballAbs = join(paths.cliRoot, archived.archiveRelPath);
    expect(statSync(tarballAbs).mode & 0o777).toBe(0o600);
    expect(readdirSync(paths.stagingDir)).toEqual([]);

    const manualExtract = join(box.root, "manual-extract");
    mkdirSync(manualExtract, { recursive: true });
    const tarOut = spawnSync("tar", ["-xzf", tarballAbs, "-C", manualExtract], { encoding: "utf8" });
    expect(tarOut.status).toBe(0);
    expect(existsSync(join(manualExtract, `${UUID_1}.jsonl`))).toBe(true);
    expect(existsSync(join(manualExtract, UUID_1, "subagents", "agent-a.jsonl"))).toBe(true);
    expect(existsSync(join(manualExtract, UUID_1, "archived.json"))).toBe(true);
    expect(existsSync(join(manualExtract, "memory"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(manualExtract, "manifest.json"), "utf8"));
    expect(manifest.originCwd).toBe(box.originCwd);
    expect(manifest.cleanupPeriodDays).toBe(90);

    const listed = listSessionArchives({ env: box.env });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.originCwd).toBe(box.originCwd);
    expect(verifySessionArchives({ env: box.env }).ok).toBe(true);
  });

  it("enforces two-tier idempotence and preserves v1 when creating v2 on real edits", () => {
    const box = createBox();
    const s = writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20 });

    const r1 = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(r1.archived).toHaveLength(1);

    // Tier 1: identical stat -> skipped without new archive.
    const r2 = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(r2.archived).toHaveLength(0);
    expect(r2.skippedIdempotent).toEqual([UUID_1]);

    // Tier 2: mtime bumped (simulating touch / restore), identical content -> still skipped, refreshes stat cache.
    const bumpedDt = new Date(FIXED_NOW_MS - 16 * DAY_MS);
    utimesSync(s.jsonlPath, bumpedDt, bumpedDt);
    const r3 = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(r3.archived).toHaveLength(0);
    expect(r3.skippedIdempotent).toEqual([UUID_1]);
    expect(r3.refreshedIndexStats).toEqual([UUID_1]);
    expect(listSessionArchives({ env: box.env })).toHaveLength(1);

    // Real content change -> appends v2 while keeping v1 intact.
    writeFileSync(
      s.jsonlPath,
      `${readFileSync(s.jsonlPath, "utf8")}${JSON.stringify({ type: "assistant", text: "v2 change" })}\n`,
      "utf8",
    );
    utimesSync(s.jsonlPath, bumpedDt, bumpedDt);
    const r4 = runSessionArchive({
      env: box.env,
      deps: okDeps(box, { nowMs: () => FIXED_NOW_MS + 5_000 }),
    });
    expect(r4.archived).toHaveLength(1);
    expect(r4.archived[0]?.version).toBe(2);
    const allVersions = listSessionArchives({ env: box.env });
    expect(allVersions).toHaveLength(2);
    expect(allVersions.every((v) => v.archiveExists)).toBe(true);
    expect(verifySessionArchives({ env: box.env }).passedCount).toBe(2);
  });

  it("enforces min(10 GiB, 5%) disk guard both before start and between sessions with alert", () => {
    const box = createBox();
    writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20, jsonlBytes: `${"a".repeat(8192)}\n` });
    writeClaudeSession(box, UUID_2, { mtimeDaysAgo: 20, jsonlBytes: `${"b".repeat(120_000)}\n` });

    // Check formula: min(10_000_000_000, floor(total * 0.05)).
    // On a 400 GiB disk, 5% is 20 GiB -> capped at 10_000_000_000.
    const checkLarge = checkDiskSpaceGuard(box.root, 0, {
      statfs: () => ({ bsize: 1_000_000, blocks: 400_000, bavail: 9_999 }),
    });
    expect(checkLarge.reserveBytes).toBe(10_000_000_000);
    expect(checkLarge.ok).toBe(false);

    // On a 10 GiB disk, 5% is 500_000_000 (< 10 GiB cap).
    const deniedStart = runSessionArchive({
      env: box.env,
      deps: okDeps(box, {
        statfs: () => ({ bsize: 1_000_000, blocks: 10_000, bavail: 400 }),
      }),
    });
    expect(deniedStart.ok).toBe(false);
    expect(deniedStart.errorCode).toBe("DISK_SPACE_LOW");
    expect(
      readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS }).some(
        (a) => a.kind === "disk-space-low",
      ),
    ).toBe(true);

    // Enough for reserve (500 MB) + session 1 (8.2 KB), NOT enough for session 2 (120 KB).
    const partial = runSessionArchive({
      env: box.env,
      deps: okDeps(box, {
        statfs: () => ({ bsize: 1_000, blocks: 10_000_000, bavail: 500_050 }),
      }),
    });
    expect(partial.ok).toBe(false);
    expect(partial.stoppedForDiskGuard).toBe(true);
    expect(partial.archived.map((a) => a.sessionId)).toEqual([UUID_1]);
  });

  it("blocks live sessions & recent mtime grace, while archiving non-blocking ambiguity with copyNotes", () => {
    const box = createBox();
    // Session 1: active owner in h2a registry -> blocked.
    writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20 });
    writeFileSync(
      box.registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "lane-live",
            tool: "claude",
            kind: "local",
            cwd: box.originCwd,
            convId: UUID_1,
            pid: 999_001,
            label: "live-lane",
            source: "hook",
            enrolledAt: new Date(FIXED_NOW_MS - 3600_000).toISOString(),
            lastSeenAt: new Date(FIXED_NOW_MS - 60_000).toISOString(),
          },
          {
            id: "lane-leased",
            tool: "claude",
            kind: "local",
            cwd: join(box.root, "other-leased-dir"),
            convId: "55555555-5555-4555-8555-555555555555",
            pid: 999_002,
            label: "leased-lane",
            source: "hook",
            enrolledAt: new Date(FIXED_NOW_MS - 3600_000).toISOString(),
            lastSeenAt: new Date(FIXED_NOW_MS - 60_000).toISOString(),
          },
        ],
      }),
      "utf8",
    );

    const leasedUuid = "55555555-5555-4555-8555-555555555555";
    writeClaudeSession(box, leasedUuid, { mtimeDaysAgo: 20 });
    writeFileSync(
      box.leasesPath,
      JSON.stringify({
        version: 1,
        leases: [
          {
            leaseId: "lease-1",
            sessionId: "lane-leased",
            holder: "supervisor",
            acquiredAt: new Date(FIXED_NOW_MS - 60_000).toISOString(),
            heartbeatAt: new Date(FIXED_NOW_MS - 10_000).toISOString(),
            expiresAt: new Date(FIXED_NOW_MS + 600_000).toISOString(),
            ttlMs: 600_000,
            token: "tok-1",
          },
        ],
      }),
      "utf8",
    );

    // Session 2: recent mtime within 24h -> blocked by grace window even with --older-than 14d.
    writeClaudeSession(box, UUID_2, { mtimeDaysAgo: 0.1 });

    // Session 3: old & NOT matching any live owner, YET same cwd has another live Claude pid + sandbox 2.json -> allowed with copyNotes.
    writeClaudeSession(box, UUID_3, { mtimeDaysAgo: 25 });
    const sessionsDir = join(box.claudeDir, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "2.json"),
      JSON.stringify({ pid: 2, sessionId: UUID_3, cwd: box.originCwd }),
      "utf8",
    );
    writeFileSync(
      join(sessionsDir, "888002.json"),
      JSON.stringify({ pid: 888_002, sessionId: UUID_ORPHAN, cwd: box.originCwd }),
      "utf8",
    );

    const res = runSessionArchive({
      env: box.env,
      deps: okDeps(box, {
        isPidAlive: (pid) => pid === 999_001 || pid === 888_002,
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.archived.map((a) => a.sessionId)).toEqual([UUID_3]);
    expect(res.archived[0]?.copyNotes).toEqual(
      expect.arrayContaining([
        "ignored-unverified-claude-pid:2",
        "unrelated-claude-live-in-cwd:888002",
        `unrelated-h2a-session-live-in-cwd:${box.originCwd}`,
      ]),
    );
    expect(res.skippedBlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: UUID_1 }),
        expect.objectContaining({ sessionId: leasedUuid }),
        expect.objectContaining({ sessionId: UUID_2 }),
      ]),
    );
  });

  it("computes Claude purge deadline on main transcript mtime (NB-3) and triggers <14d on-the-fly alerts", async () => {
    const box = createBox();
    // Default without settings -> 30d.
    expect(readClaudeCleanupPeriodDays(box.claudeDir).cleanupPeriodDays).toBe(30);

    // Explicit 90d in settings.json; invalid 0 in settings.local.json is ignored.
    writeFileSync(
      join(box.claudeDir, "settings.json"),
      JSON.stringify({ cleanupPeriodDays: 90 }),
      "utf8",
    );
    writeFileSync(
      join(box.claudeDir, "settings.local.json"),
      JSON.stringify({ cleanupPeriodDays: 0 }),
      "utf8",
    );
    expect(readClaudeCleanupPeriodDays(box.claudeDir).cleanupPeriodDays).toBe(90);

    // NB-3 critical scenario: `.jsonl` is 80 days old (10 days until 90d purge -> < 14d alert),
    // while companion file inside <uuid>/ was touched 1h ago!
    writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 80,
      companionFiles: {
        "subagents/fresh.jsonl": { content: '{"msg":"fresh"}\n', mtimeDaysAgo: 0.05 },
      },
    });
    // Ensure main .jsonl retains 80d mtime even after companion creation.
    const oldTranscriptDt = new Date(FIXED_NOW_MS - 80 * DAY_MS);
    utimesSync(join(box.projectDir, `${UUID_1}.jsonl`), oldTranscriptDt, oldTranscriptDt);

    const alertsBefore = readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS });
    expect(alertsBefore).toHaveLength(1);
    expect(alertsBefore[0]?.kind).toBe("purge-imminent");
    expect(alertsBefore[0]?.daysRemaining).toBe(10);
    expect(formatArchiveAlertLine(alertsBefore[0]!)).toContain(UUID_1);

    // On-the-fly status projection warning also surfaces the <14d unarchived alert.
    vi.stubEnv("CLAUDE_CONFIG_DIR", box.claudeDir);
    const statusProj = await projectStatusForH2a({ includeManagedInventory: true, includeDelegations: false });
    expect(statusProj.warnings.some((w) => w.includes(UUID_1) && w.includes("not yet archived"))).toBe(true);
    vi.unstubAllEnvs();

    // Once archived with --older-than 0, alert clears!
    const archived = runSessionArchive({
      env: box.env,
      olderThanDays: 0,
      graceHours: 0,
      deps: okDeps(box),
    });
    expect(archived.archived).toHaveLength(1);
    expect(readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS })).toHaveLength(0);
  });

  it("supports manual restore (conflict refusal, backup, mtime refresh) and Q2-A automatic restore", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 20,
      companionFiles: { "tool-results/out.txt": { content: "result payload\n" } },
    });

    const runRes = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(runRes.archived).toHaveLength(1);

    // Target exists on disk -> refuse by default.
    expect(() =>
      restoreSessionArchive({ id: UUID_1, env: box.env, deps: okDeps(box) }),
    ).toThrowError(SessionArchiveError);

    // `--on-conflict backup` creates .bak-* backup and refreshes mtime.
    const backedUp = restoreSessionArchive({
      id: UUID_1,
      onConflict: "backup",
      env: box.env,
      deps: okDeps(box),
    });
    expect(backedUp.backedUpPaths.length).toBeGreaterThan(0);
    expect(Math.floor(statSync(s1.jsonlPath).mtimeMs)).toBe(Math.floor(FIXED_NOW_MS));

    // Delete from disk (simulating Claude auto-purge) -> auto-restore hook for h2a resume!
    rmSync(s1.jsonlPath, { force: true });
    rmSync(s1.companionDir!, { recursive: true, force: true });
    expect(existsSync(s1.jsonlPath)).toBe(false);

    const auto = ensureClaudeSessionRestoredForResume({
      convId: UUID_1,
      cwd: box.originCwd,
      env: box.env,
      deps: okDeps(box),
    });
    expect(auto.status).toBe("restored");
    expect(existsSync(s1.jsonlPath)).toBe(true);
    expect(existsSync(join(s1.companionDir!, "tool-results", "out.txt"))).toBe(true);
    expect(Math.floor(statSync(s1.jsonlPath).mtimeMs)).toBe(Math.floor(FIXED_NOW_MS));
    expect(statSync(s1.jsonlPath).mode & 0o777).toBe(0o600);

    // Calling resume hook again sees transcript already on disk -> no-op.
    const already = ensureClaudeSessionRestoredForResume({
      convId: UUID_1,
      cwd: box.originCwd,
      env: box.env,
      deps: okDeps(box),
    });
    expect(already.status).toBe("already-on-disk");
  });

  it("detects corrupted tarballs and refuses verify, manual restore, and automatic resume restore", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20 });
    const runRes = runSessionArchive({ env: box.env, deps: okDeps(box) });
    const paths = resolveArchivePaths({ env: box.env });
    const tarballAbs = join(paths.cliRoot, runRes.archived[0]!.archiveRelPath);

    // Tamper with archive bytes cleanly via chmod 0600 -> write -> chmod 0600.
    chmodSync(tarballAbs, 0o600);
    const bytes = readFileSync(tarballAbs);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(tarballAbs, bytes);

    const verify = verifySessionArchives({ env: box.env });
    expect(verify.ok).toBe(false);
    expect(verify.failedCount).toBe(1);

    rmSync(s1.jsonlPath, { force: true });
    expect(() =>
      restoreSessionArchive({ id: UUID_1, env: box.env, deps: okDeps(box) }),
    ).toThrowError(/mismatch|failed|ARCHIVE_CORRUPTED/i);
    expect(existsSync(s1.jsonlPath)).toBe(false);

    expect(() =>
      ensureClaudeSessionRestoredForResume({
        convId: UUID_1,
        cwd: box.originCwd,
        env: box.env,
        deps: okDeps(box),
      }),
    ).toThrowError(/mismatch|failed|ARCHIVE_CORRUPTED/i);
    expect(existsSync(s1.jsonlPath)).toBe(false);
  });

  it("enforces file-lock exclusivity and aborts cleanly on mid-copy source mutation", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20 });
    const paths = resolveArchivePaths({ env: box.env });

    // Overlap refusal while lock held.
    mkdirSync(paths.root, { recursive: true });
    const heldFd = tryAcquireFileLock(paths.lockTargetPath);
    expect(heldFd).toBeDefined();
    try {
      expect(() =>
        runSessionArchive({ env: box.env, deps: okDeps(box) }),
      ).toThrowError(/holds .*archive\.lock/);
    } finally {
      releaseFileLock(heldFd!, paths.lockTargetPath);
    }

    // Mid-copy concurrent modification aborts without publishing corrupt/partial archive.
    const raceRes = runSessionArchive({
      env: box.env,
      deps: okDeps(box, {
        onBeforeCommit: () => {
          writeFileSync(s1.jsonlPath, `${readFileSync(s1.jsonlPath, "utf8")}{"raced":true}\n`, "utf8");
          const dt = new Date(FIXED_NOW_MS - 19 * DAY_MS);
          utimesSync(s1.jsonlPath, dt, dt);
        },
      }),
    });
    expect(raceRes.archived).toHaveLength(0);
    expect(raceRes.skippedBlocked[0]?.reasons[0]).toContain("concurrent-source-modification");
    expect(listSessionArchives({ env: box.env })).toHaveLength(0);
    expect(readdirSync(paths.stagingDir)).toEqual([]);
  });

  it("enforces host PID namespace guard and external-scheduler one-shot pass + H2A_ARCHIVE_OFF=1", () => {
    const box = createBox();
    writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20 });

    // Simulated container/sandbox PID namespace blocks mutating run, preserves dry-run & scan.
    const isolatedGuard = () => ({ ok: false, reason: "pid-namespace-isolated", detail: "test" });
    const blocked = runSessionArchive({
      env: box.env,
      deps: okDeps(box, { probeHostPidNamespace: isolatedGuard }),
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.errorCode).toBe("PID_NAMESPACE_GUARD");
    expect(
      readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS }).some(
        (a) => a.kind === "pid-namespace-guard",
      ),
    ).toBe(true);

    const dry = runSessionArchive({
      env: box.env,
      dryRun: true,
      deps: okDeps(box, { probeHostPidNamespace: isolatedGuard }),
    });
    expect(dry.ok).toBe(true);
    expect(dry.wouldArchive).toEqual([UUID_1]);

    // Kill-switch H2A_ARCHIVE_OFF=1 writes versioned last-run.json witness cleanly and exits 0.
    const offPass = runArchivePassOnce({
      env: { ...box.env, H2A_ARCHIVE_OFF: "1" },
      deps: okDeps(box),
    });
    expect(offPass.ok).toBe(true);
    expect(offPass.exitCode).toBe(0);
    expect(offPass.witness.status).toBe("skipped");
    expect(offPass.witness.reason).toBe("disabled-by-env:H2A_ARCHIVE_OFF");
    expect(listSessionArchives({ env: box.env })).toHaveLength(0);

    const paths = resolveArchivePaths({ env: box.env });
    const savedOffWitness = loadLastRunWitness(paths.lastRunPath);
    expect(savedOffWitness?.schemaVersion).toBe(1);
    expect(savedOffWitness?.status).toBe("skipped");

    // Enabled one-shot pass commits and clears pid guard alert.
    const okPass = runArchivePassOnce({ env: box.env, deps: okDeps(box) });
    expect(okPass.ok).toBe(true);
    expect(okPass.exitCode).toBe(0);
    expect(okPass.witness.status).toBe("ok");
    expect(okPass.witness.archived).toBe(1);
    const savedOkWitness = loadLastRunWitness(paths.lastRunPath);
    expect(savedOkWitness?.archived).toBe(1);

    // Ensure probeHostPidNamespace itself never throws regardless of test host/sandbox.
    const realProbe = probeHostPidNamespace();
    expect(typeof realProbe.ok).toBe("boolean");

    // Ensure no synthetic SHA mismatches exist in hash helper spot check.
    const rows = listSessionArchives({ env: box.env });
    expect(rows[0]?.archiveSha256).toBe(
      createHash("sha256").update(readFileSync(rows[0]!.archiveAbsPath)).digest("hex"),
    );
  });

  it("B-1: never overwrites corrupt or unknown-schema index.json, persists alert, and supports rebuild-index", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 20,
      companionFiles: { "subagents/agent-a.jsonl": { content: '{"role":"assistant"}\n' } },
    });
    const paths = resolveArchivePaths({ env: box.env });

    const initial = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(initial.ok).toBe(true);
    expect(initial.archived).toHaveLength(1);
    const originalArchiveId = initial.archived[0]!.archiveId;

    // Case 1: Corrupt index.json -> run, pass, restore, verify, list, resume all refuse; bytes untouched.
    const corruptRaw = '{"schemaVersion": 1, "sessions": ';
    writeFileSync(paths.indexPath, corruptRaw, "utf8");
    const corruptBefore = readFileSync(paths.indexPath);

    expect(() => runSessionArchive({ env: box.env, deps: okDeps(box) })).toThrowError(SessionArchiveError);
    try {
      runSessionArchive({ env: box.env, deps: okDeps(box) });
    } catch (err) {
      expect((err as SessionArchiveError).code).toBe("INDEX_UNREADABLE");
    }
    expect(readFileSync(paths.indexPath).equals(corruptBefore)).toBe(true);

    const corruptPass = runArchivePassOnce({ env: box.env, deps: okDeps(box) });
    expect(corruptPass.ok).toBe(false);
    expect(corruptPass.exitCode).toBe(2);
    expect(corruptPass.witness.status).toBe("error");
    expect(corruptPass.witness.reason).toBe("INDEX_UNREADABLE");
    expect(readFileSync(paths.indexPath).equals(corruptBefore)).toBe(true);

    expect(() => restoreSessionArchive({ id: UUID_1, env: box.env, deps: okDeps(box) })).toThrowError(
      /unreadable|INDEX_UNREADABLE/i,
    );
    expect(() => listSessionArchives({ env: box.env })).toThrowError(/unreadable/i);
    expect(() => verifySessionArchives({ env: box.env })).toThrowError(/unreadable/i);
    expect(readFileSync(paths.indexPath).equals(corruptBefore)).toBe(true);
    expect(
      readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS }).some(
        (a) => a.kind === "archive-index-unreadable",
      ),
    ).toBe(true);

    // Resume when transcript is missing and index is corrupt refuses loudly.
    rmSync(s1.jsonlPath, { force: true });
    expect(() =>
      ensureClaudeSessionRestoredForResume({ convId: UUID_1, cwd: box.originCwd, env: box.env, deps: okDeps(box) }),
    ).toThrowError(/unreadable/i);

    // Rebuild index from self-contained tarballs -> backs up corrupt file, restores catalog, clears alert.
    const rebuiltFromCorrupt = rebuildArchiveIndex({ env: box.env, deps: okDeps(box) });
    expect(rebuiltFromCorrupt.ok).toBe(true);
    expect(rebuiltFromCorrupt.sessionsCount).toBe(1);
    expect(rebuiltFromCorrupt.versionsCount).toBe(1);
    expect(rebuiltFromCorrupt.backupPath).toBeDefined();
    expect(readFileSync(rebuiltFromCorrupt.backupPath!).equals(corruptBefore)).toBe(true);
    expect(listSessionArchives({ env: box.env }).map((r) => r.archiveId)).toEqual([originalArchiveId]);

    // Case 2: Unknown schemaVersion: 2 -> refused everywhere, bytes preserved, requires --force to rebuild.
    const v2Raw = `${JSON.stringify({ schemaVersion: 2, cli: "claude", updatedAt: "2026-11-25T00:00:00Z", sessions: { future: {} } })}\n`;
    writeFileSync(paths.indexPath, v2Raw, "utf8");
    const v2Before = readFileSync(paths.indexPath);

    let runErrCode: string | undefined;
    try {
      runSessionArchive({ env: box.env, deps: okDeps(box) });
    } catch (err) {
      runErrCode = (err as SessionArchiveError).code;
    }
    expect(runErrCode).toBe("INDEX_UNREADABLE");
    expect(readFileSync(paths.indexPath).equals(v2Before)).toBe(true);

    const v2Pass = runArchivePassOnce({ env: box.env, deps: okDeps(box) });
    expect(v2Pass.ok).toBe(false);
    expect(v2Pass.exitCode).toBe(2);
    expect(v2Pass.witness.reason).toBe("INDEX_UNREADABLE");
    expect(readFileSync(paths.indexPath).equals(v2Before)).toBe(true);

    expect(() => restoreSessionArchive({ id: UUID_1, env: box.env, deps: okDeps(box) })).toThrowError(
      /schemaVersion 2/i,
    );
    expect(readFileSync(paths.indexPath).equals(v2Before)).toBe(true);

    // Rebuild without force refuses over unknown schema v2; with force backs up v2 and restores v1 catalog.
    expect(() => rebuildArchiveIndex({ env: box.env, deps: okDeps(box) })).toThrowError(/--force/i);
    expect(readFileSync(paths.indexPath).equals(v2Before)).toBe(true);

    const rebuiltFromV2 = rebuildArchiveIndex({ env: box.env, force: true, deps: okDeps(box) });
    expect(rebuiltFromV2.ok).toBe(true);
    expect(rebuiltFromV2.versionsCount).toBe(1);
    expect(readFileSync(rebuiltFromV2.backupPath!).equals(v2Before)).toBe(true);
    expect(listSessionArchives({ env: box.env }).map((r) => r.archiveId)).toEqual([originalArchiveId]);

    // After restore and clean index rebuild, subsequent archive run is idempotent (no duplicate v2 tarball).
    const restored = ensureClaudeSessionRestoredForResume({
      convId: UUID_1,
      cwd: box.originCwd,
      env: box.env,
      deps: okDeps(box),
    });
    expect(restored.status).toBe("restored");
    const postRebuildRun = runSessionArchive({
      env: box.env,
      olderThanDays: 0,
      graceHours: 0,
      deps: okDeps(box),
    });
    expect(postRebuildRun.ok).toBe(true);
    expect(postRebuildRun.archived).toHaveLength(0);
    expect(postRebuildRun.skippedIdempotent).toEqual([UUID_1]);
    expect(listSessionArchives({ env: box.env })).toHaveLength(1);
  });

  it("B-2: ownership lock does not expire past LOCK_STALE_MS during a slow synchronous pass and blocks concurrent run/restore", () => {
    const box = createBox();
    writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 20 });
    writeClaudeSession(box, UUID_2, { mtimeDaysAgo: 20 });
    const paths = resolveArchivePaths({ env: box.env });
    const waitBuf = new Int32Array(new SharedArrayBuffer(4));

    let checkedAfterStale = false;
    let secondRunError: unknown;
    let secondRestoreError: unknown;
    let passWhileLockedStatus: string | undefined;
    let passWhileLockedExit: number | undefined;

    const res = runSessionArchive({
      env: box.env,
      deps: okDeps(box, {
        onBeforeCommit: (sessionId) => {
          if (sessionId !== UUID_1 || checkedAfterStale) return;
          checkedAfterStale = true;
          // Sleep synchronously beyond LOCK_STALE_MS (10_000 ms) to prove lock does not expire mid-pass.
          Atomics.wait(waitBuf, 0, 0, 10_500);
          const lockJson = JSON.parse(readFileSync(paths.lockPath, "utf8")) as {
            pid: number;
            token: string;
          };
          expect(lockJson.pid).toBe(process.pid);

          // Spawn a real second OS process importing live TS source (never stale dist) trying `runSessionArchive`, `restoreSessionArchive`, and `runArchivePassOnce`.
          const probeScript = `
            import { runSessionArchive, restoreSessionArchive, runArchivePassOnce } from ${JSON.stringify(RUNTIME_ARCHIVE_SRC)};
            const env = JSON.parse(process.argv[1]);
            const deps = { probeHostPidNamespace: () => ({ ok: true }) };
            let runCode = null;
            try { runSessionArchive({ env, deps }); } catch (e) { runCode = e?.code ?? e?.message; }
            let restoreCode = null;
            try { restoreSessionArchive({ id: ${JSON.stringify(UUID_1)}, env, deps }); } catch (e) { restoreCode = e?.code ?? e?.message; }
            const passRes = runArchivePassOnce({ env, deps });
            console.log(JSON.stringify({ runCode, restoreCode, passStatus: passRes.witness.status, passReason: passRes.witness.reason, passExit: passRes.exitCode }));
          `;
          const child = spawnSync(
            process.execPath,
            ["--import", TSX_LOADER, "--input-type=module", "-e", probeScript, JSON.stringify(box.env)],
            {
              env: {
                ...process.env,
                ...box.env,
                XDG_STATE_HOME: join(box.root, "state"),
                XDG_CONFIG_HOME: join(box.root, "config"),
                XDG_RUNTIME_DIR: join(box.root, "runtime"),
              },
              encoding: "utf8",
            },
          );
          expect(child.status, child.stderr).toBe(0);
          const parsed = JSON.parse(child.stdout.trim()) as {
            runCode: string | null;
            restoreCode: string | null;
            passStatus: string;
            passReason: string;
            passExit: number;
          };
          secondRunError = parsed.runCode;
          secondRestoreError = parsed.restoreCode;
          passWhileLockedStatus = parsed.passStatus;
          passWhileLockedExit = parsed.passExit;
          expect(parsed.passReason).toBe("ARCHIVE_LOCKED");
          // Original holder's lock file must still carry the exact same token.
          expect(JSON.parse(readFileSync(paths.lockPath, "utf8")).token).toBe(lockJson.token);
        },
      }),
    });

    expect(checkedAfterStale).toBe(true);
    expect(secondRunError).toBe("ARCHIVE_LOCKED");
    expect(secondRestoreError).toBe("ARCHIVE_LOCKED");
    expect(passWhileLockedStatus).toBe("locked");
    expect(passWhileLockedExit).toBe(2);

    expect(res.ok).toBe(true);
    expect(res.archived.map((a) => a.sessionId)).toEqual([UUID_1, UUID_2]);
    expect(existsSync(paths.lockPath)).toBe(false);
    expect(listSessionArchives({ env: box.env })).toHaveLength(2);
    expect(verifySessionArchives({ env: box.env }).ok).toBe(true);

    // Dead-holder lock reclamation & token-checked release:
    const foreignLock = tryAcquireArchiveLock(paths.lockTargetPath);
    expect(foreignLock).toBeDefined();
    writeFileSync(
      paths.lockPath,
      JSON.stringify({ schemaVersion: 1, token: "dead-token", pid: 999_999_999, acquiredAt: new Date().toISOString() }),
      "utf8",
    );
    // Releasing foreignLock must NOT delete a lock whose token does not match.
    releaseArchiveLock(foreignLock!);
    expect(existsSync(paths.lockPath)).toBe(true);
    // Acquiring when holder is dead reclaims the dead lock cleanly.
    const reclaimed = tryAcquireArchiveLock(paths.lockTargetPath, {
      isLockHolderAlive: () => false,
    });
    expect(reclaimed).toBeDefined();
    releaseArchiveLock(reclaimed!);
    expect(existsSync(paths.lockPath)).toBe(false);
  }, 25_000);

  it("NB-1: supports non-ASCII/backslash filenames, isolates per-session errors, and tolerates ENOENT during scan", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 20,
      companionFiles: {
        "café.txt": { content: "espresso\n" },
        "back\\slash.txt": { content: "windows-ish\n" },
      },
    });
    writeClaudeSession(box, UUID_2, { mtimeDaysAgo: 20 });
    writeClaudeSession(box, UUID_3, { mtimeDaysAgo: 20 });

    // Session 2 throws a non-concurrency error inside build; Sessions 1 and 3 must still archive!
    const partialPass = runArchivePassOnce({
      env: box.env,
      deps: okDeps(box, {
        onBeforeCommit: (sessionId) => {
          if (sessionId === UUID_2) {
            throw new Error("simulated per-session tar failure");
          }
        },
      }),
    });
    expect(partialPass.ok).toBe(false);
    expect(partialPass.exitCode).toBe(2);
    expect(partialPass.witness.status).toBe("partial");
    expect(partialPass.runResult?.archived.map((a) => a.sessionId)).toEqual([UUID_1, UUID_3]);
    expect(partialPass.runResult?.failedSessions).toHaveLength(1);
    expect(partialPass.runResult?.failedSessions[0]?.sessionId).toBe(UUID_2);
    expect(
      readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS }).some(
        (a) => a.kind === "archive-run-failed",
      ),
    ).toBe(true);

    // Non-ASCII and backslash companion files verify and restore cleanly.
    expect(verifySessionArchives({ env: box.env, id: UUID_1 }).ok).toBe(true);
    rmSync(s1.jsonlPath, { force: true });
    rmSync(s1.companionDir!, { recursive: true, force: true });
    const restored = restoreSessionArchive({ id: UUID_1, env: box.env, deps: okDeps(box) });
    expect(restored.ok).toBe(true);
    expect(readFileSync(join(s1.companionDir!, "café.txt"), "utf8")).toBe("espresso\n");
    expect(readFileSync(join(s1.companionDir!, "back\\slash.txt"), "utf8")).toBe("windows-ish\n");

    // Transient ENOENT during scan does not crash scanClaudeSessions.
    const scanOk = scanClaudeSessions({ env: box.env, deps: okDeps(box) });
    expect(scanOk.sessions.length).toBeGreaterThanOrEqual(3);
  });

  it("NB-2: surfaces pass delay, disabled state, and failure alerts in status, and exits with ARCHIVE_ALERT_EXIT_CODE when alerts remain", () => {
    const box = createBox();
    // Session 21d old under 30d default (9d remaining -> <14d alert), but within 24h grace -> blocked so alert persists after pass.
    const s1 = writeClaudeSession(box, UUID_1, { mtimeDaysAgo: 21 });
    const recentCompanion = join(box.projectDir, UUID_1, "recent.txt");
    mkdirSync(dirname(recentCompanion), { recursive: true });
    writeFileSync(recentCompanion, "active\n", "utf8");
    const recentDt = new Date(FIXED_NOW_MS - 1 * 3600 * 1000);
    utimesSync(recentCompanion, recentDt, recentDt);
    const oldTranscriptDt = new Date(FIXED_NOW_MS - 21 * DAY_MS);
    utimesSync(s1.jsonlPath, oldTranscriptDt, oldTranscriptDt);

    const passWithAlert = runArchivePassOnce({ env: box.env, deps: okDeps(box) });
    expect(passWithAlert.ok).toBe(true);
    expect(passWithAlert.exitCode).toBe(ARCHIVE_ALERT_EXIT_CODE);
    expect(passWithAlert.alerts.some((a) => a.kind === "purge-imminent")).toBe(true);

    // Overdue pass witness (>48h) surfaces `archive-pass-overdue` alert on the fly.
    const laterMs = FIXED_NOW_MS + 60 * 3600 * 1000;
    const overdueAlerts = readClaudeArchiveAlerts({ env: box.env, nowMs: laterMs });
    expect(overdueAlerts.some((a) => a.kind === "archive-pass-overdue")).toBe(true);

    // H2A_ARCHIVE_OFF=1 surfaces `archive-disabled` alert on the fly.
    const disabledAlerts = readClaudeArchiveAlerts({
      env: { ...box.env, H2A_ARCHIVE_OFF: "1" },
      nowMs: FIXED_NOW_MS,
    });
    expect(disabledAlerts.some((a) => a.kind === "archive-disabled")).toBe(true);
  });

  it("NB-3: auto-restore on resume succeeds when companion dir survives transcript purge and preserves newer companion files", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 80,
      companionFiles: {
        "subagents/old.jsonl": { content: '{"msg":"archived"}\n' },
        "note.txt": { content: "original note\n" },
      },
    });
    const oldDt = new Date(FIXED_NOW_MS - 80 * DAY_MS);
    utimesSync(s1.jsonlPath, oldDt, oldDt);

    const archived = runSessionArchive({ env: box.env, deps: okDeps(box) });
    expect(archived.archived).toHaveLength(1);

    // Simulate Claude purging main transcript at 90d while newer companion files survive inside <uuid>/.
    rmSync(s1.jsonlPath, { force: true });
    const survivingPath = join(s1.companionDir!, "subagents", "fresh.jsonl");
    writeFileSync(survivingPath, '{"msg":"newer survivor"}\n', "utf8");
    const survivorDt = new Date(FIXED_NOW_MS - 2 * DAY_MS);
    utimesSync(survivingPath, survivorDt, survivorDt);

    // Also modify note.txt on disk to verify existing companion files are NEVER overwritten during auto-restore.
    const existingNotePath = join(s1.companionDir!, "note.txt");
    writeFileSync(existingNotePath, "newer local note\n", "utf8");

    const auto = ensureClaudeSessionRestoredForResume({
      convId: UUID_1,
      cwd: box.originCwd,
      env: box.env,
      deps: okDeps(box),
    });
    expect(auto.status).toBe("restored");
    expect(existsSync(s1.jsonlPath)).toBe(true);
    expect(Math.floor(statSync(s1.jsonlPath).mtimeMs)).toBe(Math.floor(FIXED_NOW_MS));
    expect(readFileSync(join(s1.companionDir!, "subagents", "old.jsonl"), "utf8")).toBe(
      '{"msg":"archived"}\n',
    );
    expect(readFileSync(survivingPath, "utf8")).toBe('{"msg":"newer survivor"}\n');
    expect(Math.floor(statSync(survivingPath).mtimeMs)).toBe(Math.floor(survivorDt.getTime()));
    expect(readFileSync(existingNotePath, "utf8")).toBe("newer local note\n");

    // Empty surviving companion dir also auto-restores cleanly.
    rmSync(s1.jsonlPath, { force: true });
    rmSync(s1.companionDir!, { recursive: true, force: true });
    mkdirSync(s1.companionDir!, { recursive: true });
    const autoEmpty = ensureClaudeSessionRestoredForResume({
      convId: UUID_1,
      cwd: box.originCwd,
      env: box.env,
      deps: okDeps(box),
    });
    expect(autoEmpty.status).toBe("restored");
    expect(existsSync(s1.jsonlPath)).toBe(true);
    expect(existsSync(join(s1.companionDir!, "note.txt"))).toBe(true);
  });

  it("B-1-r2 / NB-3-r2: default lock detector never breaks foreign/missing-anchor/unknown-schema/empty locks and reclaims only proven death", () => {
    const box = createBox();
    const paths = resolveArchivePaths({ env: box.env });
    mkdirSync(paths.root, { recursive: true });

    const currentFrame: DurableProcFrame = {
      machineId: "a".repeat(32),
      bootId: "11111111-1111-4111-8111-111111111111",
      pidNamespace: "4026531836",
    };
    const otherMachineId = "b".repeat(32);
    const prevBootId = "00000000-0000-4000-8000-000000000000";
    const otherPidNs = "4026539999";

    const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const holderPid = holder.pid!;
    expect(holderPid).toBeGreaterThan(0);

    try {
      const actualStartTime = readProcessStartTime(holderPid);
      expect(actualStartTime).toBeDefined();

      const writeLock = (payload: string, ageMs = 0): void => {
        writeFileSync(paths.lockPath, payload, { encoding: "utf8", mode: 0o600 });
        if (ageMs > 0) {
          const past = new Date(Date.now() - ageMs);
          utimesSync(paths.lockPath, past, past);
        }
      };

      const baseRecord: ArchiveLockRecord = {
        schemaVersion: 1,
        token: "tok-holder",
        pid: holderPid,
        startTime: actualStartTime!,
        pidNamespace: currentFrame.pidNamespace,
        bootId: currentFrame.bootId,
        machineId: currentFrame.machineId,
        acquiredAt: new Date(FIXED_NOW_MS).toISOString(),
      };

      const frameDeps = okDeps(box, {
        readProcessFrame: () => currentFrame,
      });

      // Case 1: live holder, same frame, matching startTime -> refused.
      writeLock(JSON.stringify(baseRecord));
      expect(tryAcquireArchiveLock(paths.lockTargetPath, frameDeps)).toBeUndefined();

      // Case 4: live holder, same frame, missing startTime -> refused (fail closed).
      const { startTime: _omitStart, ...noStartRecord } = baseRecord;
      writeLock(JSON.stringify(noStartRecord));
      expect(tryAcquireArchiveLock(paths.lockTargetPath, frameDeps)).toBeUndefined();

      // Case 5: other machine, both machineIds known -> refused even when PID is absent.
      writeLock(JSON.stringify({ ...baseRecord, pid: 999_999_999, machineId: otherMachineId }));
      expect(tryAcquireArchiveLock(paths.lockTargetPath, frameDeps)).toBeUndefined();

      // Case 6a: other machine / missing machineId on record, different bootId -> NEVER broken.
      const { machineId: _omitRecMachine, ...noRecMachine } = baseRecord;
      writeLock(JSON.stringify({ ...noRecMachine, pid: 999_999_999, bootId: prevBootId }));
      const passMissingRecMachine = runArchivePassOnce({ env: box.env, deps: frameDeps });
      expect(passMissingRecMachine.ok).toBe(false);
      expect(passMissingRecMachine.exitCode).toBe(2);
      expect(passMissingRecMachine.witness.status).toBe("locked");
      expect(passMissingRecMachine.witness.reason).toBe("ARCHIVE_LOCKED");

      // Case 6b: missing machineId on reader, different bootId -> NEVER broken.
      writeLock(JSON.stringify({ ...baseRecord, pid: 999_999_999, bootId: prevBootId }));
      const noReaderMachineDeps = okDeps(box, {
        readProcessFrame: () => ({ bootId: currentFrame.bootId, pidNamespace: currentFrame.pidNamespace }),
      });
      expect(tryAcquireArchiveLock(paths.lockTargetPath, noReaderMachineDeps)).toBeUndefined();

      // Case 8: different PID namespace (all anchors known) -> refused.
      writeLock(JSON.stringify({ ...baseRecord, pid: 999_999_999, pidNamespace: otherPidNs }));
      expect(tryAcquireArchiveLock(paths.lockTargetPath, frameDeps)).toBeUndefined();

      // Case 9: missing pidNamespace on record, PID absent locally -> NEVER broken.
      const { pidNamespace: _omitNs, ...noNsRecord } = baseRecord;
      writeLock(JSON.stringify({ ...noNsRecord, pid: 999_999_999 }));
      const passNoNs = runArchivePassOnce({ env: box.env, deps: frameDeps });
      expect(passNoNs.witness.status).toBe("locked");
      expect(existsSync(paths.lockPath)).toBe(true);

      // Case 10: unknown schemaVersion: 2, invalid JSON, and empty 0-byte lock aged > LOCK_STALE_MS -> NEVER broken by age.
      for (const rawPayload of [
        JSON.stringify({ schemaVersion: 2, token: "future-tok", pid: 999_999_999 }),
        "{truncated-json",
        "",
      ]) {
        writeLock(rawPayload, 60_000);
        const passUnknown = runArchivePassOnce({ env: box.env, deps: frameDeps });
        expect(passUnknown.ok).toBe(false);
        expect(passUnknown.exitCode).toBe(2);
        expect(passUnknown.witness.status).toBe("locked");
        expect(passUnknown.witness.reason).toBe("ARCHIVE_LOCKED");
        expect(readFileSync(paths.lockPath, "utf8")).toBe(rawPayload);
        expect(
          readClaudeArchiveAlerts({ env: box.env, nowMs: FIXED_NOW_MS }).some(
            (a) => a.kind === "archive-run-failed" && a.message.includes("writer lock"),
          ),
        ).toBe(true);
      }

      // Non-Linux reader encountering Linux anchors with dead/absent PID -> refused (fail closed).
      writeLock(JSON.stringify({ ...baseRecord, pid: 999_999_999 }));
      expect(
        tryAcquireArchiveLock(paths.lockTargetPath, okDeps(box, { platform: "darwin" })),
      ).toBeUndefined();

      // Inspect & unlock recovery API: refuses without force on live/unverified lock, removes with force.
      writeLock(JSON.stringify(baseRecord));
      const inspectLocked = unlockArchiveLock({ env: box.env, deps: frameDeps });
      expect(inspectLocked.ok).toBe(false);
      expect(inspectLocked.existed).toBe(true);
      expect(inspectLocked.unlocked).toBe(false);
      expect(inspectLocked.holderStatus).toBe("alive-or-unverified");
      expect(inspectLocked.record?.token).toBe("tok-holder");
      expect(existsSync(paths.lockPath)).toBe(true);

      const forcedUnlock = unlockArchiveLock({ env: box.env, force: true, deps: frameDeps });
      expect(forcedUnlock.ok).toBe(true);
      expect(forcedUnlock.unlocked).toBe(true);
      expect(existsSync(paths.lockPath)).toBe(false);

      // Case 2: PID reused (live PID, different startTime, same frame) -> proven dead -> reclaimed.
      writeLock(JSON.stringify({ ...baseRecord, startTime: actualStartTime! + 100 }));
      const reclaimedReused = tryAcquireArchiveLock(paths.lockTargetPath, frameDeps);
      expect(reclaimedReused).toBeDefined();
      releaseArchiveLock(reclaimedReused!);

      // Case 7: same machine & pidNamespace, previous bootId -> stale-boot -> reclaimed.
      writeLock(JSON.stringify({ ...baseRecord, bootId: prevBootId }));
      const reclaimedStaleBoot = tryAcquireArchiveLock(paths.lockTargetPath, frameDeps);
      expect(reclaimedStaleBoot).toBeDefined();
      releaseArchiveLock(reclaimedStaleBoot!);

      // Case 3: PID absent from /proc, same frame -> reclaimed.
      writeLock(JSON.stringify({ ...baseRecord, pid: 999_999_999 }));
      const reclaimedAbsent = tryAcquireArchiveLock(paths.lockTargetPath, frameDeps);
      expect(reclaimedAbsent).toBeDefined();
      releaseArchiveLock(reclaimedAbsent!);
    } finally {
      holder.kill("SIGKILL");
    }
  });

  it("NB-1-r2: refuse and merge-missing place restored files exclusively and never overwrite concurrent targets", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 20,
      companionFiles: {
        "sub/note.txt": { content: "archived note\n" },
      },
    });
    expect(runSessionArchive({ env: box.env, deps: okDeps(box) }).archived).toHaveLength(1);

    // 1. Concurrent creation of companion file right before placement in `merge-missing`: skips without overwriting.
    rmSync(s1.jsonlPath, { force: true });
    rmSync(join(s1.companionDir!, "sub", "note.txt"), { force: true });
    const raceNoteDest = join(s1.companionDir!, "sub", "note.txt");
    const mergeRace = restoreSessionArchive({
      id: UUID_1,
      onConflict: "merge-missing",
      env: box.env,
      deps: okDeps(box, {
        onBeforeRestorePlace: (dest) => {
          if (dest === raceNoteDest) {
            writeFileSync(dest, "concurrent winner\n", "utf8");
          }
        },
      }),
    });
    expect(mergeRace.ok).toBe(true);
    expect(mergeRace.restoredFiles).toEqual([s1.jsonlPath]);
    expect(mergeRace.skippedExistingFiles).toEqual([raceNoteDest]);
    expect(readFileSync(raceNoteDest, "utf8")).toBe("concurrent winner\n");
    expect(readdirSync(join(s1.companionDir!, "sub")).some((n) => n.startsWith(".restore-"))).toBe(false);

    // 2. Concurrent creation of transcript right before placement in `merge-missing` -> refuses without overwriting.
    rmSync(s1.jsonlPath, { force: true });
    expect(() =>
      restoreSessionArchive({
        id: UUID_1,
        onConflict: "merge-missing",
        env: box.env,
        deps: okDeps(box, {
          onBeforeRestorePlace: (dest) => {
            if (dest === s1.jsonlPath) {
              writeFileSync(dest, "concurrent transcript\n", "utf8");
            }
          },
        }),
      }),
    ).toThrowError(SessionArchiveError);
    expect(readFileSync(s1.jsonlPath, "utf8")).toBe("concurrent transcript\n");
    expect(readdirSync(box.projectDir).some((n) => n.startsWith(".restore-"))).toBe(false);

    // 3. Concurrent creation right before placement in `refuse` -> refuses without overwriting.
    rmSync(s1.jsonlPath, { force: true });
    rmSync(s1.companionDir!, { recursive: true, force: true });
    expect(() =>
      restoreSessionArchive({
        id: UUID_1,
        onConflict: "refuse",
        env: box.env,
        deps: okDeps(box, {
          onBeforeRestorePlace: (dest) => {
            if (dest === s1.jsonlPath) {
              writeFileSync(dest, "refuse concurrent winner\n", "utf8");
            }
          },
        }),
      }),
    ).toThrowError(SessionArchiveError);
    expect(readFileSync(s1.jsonlPath, "utf8")).toBe("refuse concurrent winner\n");
    expect(readdirSync(box.projectDir).some((n) => n.startsWith(".restore-"))).toBe(false);
  });

  it("NB-2-r2: merge-missing rejects intermediate symlinks and non-directory ancestors without touching external targets", () => {
    const box = createBox();
    const s1 = writeClaudeSession(box, UUID_1, {
      mtimeDaysAgo: 20,
      companionFiles: {
        "sub/a.txt": { content: "from archive sub\n" },
        "blk/b.txt": { content: "from archive blk\n" },
        "real/c.txt": { content: "from archive real\n" },
      },
    });
    expect(runSessionArchive({ env: box.env, deps: okDeps(box) }).archived).toHaveLength(1);

    // Simulate purged transcript while surviving companion directory contains:
    // - `sub` -> symlink to external 0755 directory (T1)
    // - `blk` -> regular file instead of directory (T2)
    // - `real` -> existing real directory with mode 0755 (T3)
    rmSync(s1.jsonlPath, { force: true });
    rmSync(s1.companionDir!, { recursive: true, force: true });
    mkdirSync(s1.companionDir!, { recursive: true });

    const outsideDir = join(box.root, "outside-target");
    mkdirSync(outsideDir, { recursive: true });
    chmodSync(outsideDir, 0o755);
    symlinkSync(outsideDir, join(s1.companionDir!, "sub"));

    writeFileSync(join(s1.companionDir!, "blk"), "surviving regular file\n", "utf8");

    const survivingReal = join(s1.companionDir!, "real");
    mkdirSync(survivingReal, { recursive: true });
    chmodSync(survivingReal, 0o755);

    const auto = ensureClaudeSessionRestoredForResume({
      convId: UUID_1,
      cwd: box.originCwd,
      env: box.env,
      deps: okDeps(box),
    });
    expect(auto.status).toBe("restored");
    expect(existsSync(s1.jsonlPath)).toBe(true);
    expect(existsSync(join(survivingReal, "c.txt"))).toBe(true);

    // T1: symlink never followed; outsideDir untouched and mode 0755 preserved.
    expect(existsSync(join(outsideDir, "a.txt"))).toBe(false);
    expect(statSync(outsideDir).mode & 0o777).toBe(0o755);

    // T2: regular file `blk` untouched, nonexistent `blk/b.txt` NOT listed in skippedExistingFiles.
    expect(readFileSync(join(s1.companionDir!, "blk"), "utf8")).toBe("surviving regular file\n");
    expect(auto.skippedExistingFiles ?? []).toEqual([]);

    // T3: surviving real directory retains its mode 0755.
    expect(statSync(survivingReal).mode & 0o777).toBe(0o755);

    // Both blocked targets reported cleanly.
    expect(auto.skippedUnsafePaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(s1.companionDir!, "sub", "a.txt"),
          blockingPath: join(s1.companionDir!, "sub"),
          reason: "intermediate-symlink",
        }),
        expect.objectContaining({
          path: join(s1.companionDir!, "blk", "b.txt"),
          blockingPath: join(s1.companionDir!, "blk"),
          reason: "non-directory-ancestor",
        }),
      ]),
    );

    let capturedNotice = "";
    emitResumeArchiveNotices(auto, {
      write: (chunk: string) => {
        capturedNotice += chunk;
        return true;
      },
    } as unknown as NodeJS.WritableStream);
    expect(capturedNotice).toContain("intermediate-symlink");
    expect(capturedNotice).toContain("non-directory-ancestor");
  });
});
