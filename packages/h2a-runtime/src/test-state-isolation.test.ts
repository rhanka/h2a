import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendCrashLog, resolveCrashLogPath } from "./crash-log.js";
import { migrateConfigHomeIfNeeded, writeRemoteConfig } from "./config.js";
import { removeRegistryRowsById } from "./registry.js";
import {
  appendHostJournal,
  resolveHostJournalPath,
} from "./native-terminal/journal.js";
import { tryAcquireResumeLaunchClaim } from "./relaunch.js";
import { writeLastLayout } from "./restore.js";
import {
  assertConfinedTestEnvironment,
  assertTestEnvironmentIsolated,
  guardTestStateWrite,
  isTestStateMarked,
  TEST_STATE_ROOT_ENV,
  TestStateRefusalError,
} from "./test-state-guard.js";

const fixtures: string[] = [];
let savedMarker: string | undefined;
let savedConfigHome: string | undefined;

beforeEach(() => {
  savedMarker = process.env[TEST_STATE_ROOT_ENV];
  savedConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  delete process.env.REMOTE_CLI_CONFIG_HOME;
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
  if (savedMarker === undefined) delete process.env[TEST_STATE_ROOT_ENV];
  else process.env[TEST_STATE_ROOT_ENV] = savedMarker;
  if (savedConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = savedConfigHome;
});

/** Fresh scratch dir (under os.tmpdir, which follows TMPDIR). */
function freshFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "h2a-l0-"));
  fixtures.push(root);
  return root;
}

/** Mark this process's test-state root at `allowed`; everything else refuses. */
function markRoot(allowed: string): void {
  mkdirSync(allowed, { recursive: true });
  process.env[TEST_STATE_ROOT_ENV] = allowed;
}

describe("lot L0: mutation-point guard", () => {
  it("should allow a write inside the marked test state root", () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    markRoot(allowed);
    expect(() => guardTestStateWrite(join(allowed, "attach.log"))).not.toThrow();
  });

  it("should stay inert when no test run is marked", () => {
    delete process.env[TEST_STATE_ROOT_ENV];
    expect(isTestStateMarked()).toBe(false);
    expect(() => guardTestStateWrite(join(homedir(), ".local", "state", "h2a", "attach.log"))).not.toThrow();
  });

  it("should refuse an in-process write outside the test state root", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    expect(() => guardTestStateWrite(join(fixture, "elsewhere", "x.log"))).toThrow(TestStateRefusalError);
  });

  it("should refuse an explicit crash-log writer path outside the test state root before creating anything", () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    markRoot(allowed);
    const outside = join(fixture, "protected", "attach.log");
    const sentinel = join(fixture, "protected", "SENTINEL.txt");
    mkdirSync(join(fixture, "protected"), { recursive: true });
    writeFileSync(sentinel, "owner-fixture-sentinel");
    // Defect on today's code: the explicit path bypasses resolveCrashLogPath
    // and the writer creates directories, lock and file there. Guarded: the
    // call fails closed with zero creation.
    expect(appendCrashLog("attach", { event: "refusal", sessionId: "sess-livelock" }, outside)).toBe(false);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(`${outside}.lock`)).toBe(false);
    expect(existsSync(join(fixture, "protected"))).toBe(true);
    expect(readFileSync(sentinel, "utf8")).toBe("owner-fixture-sentinel");
  });

  it("should keep the first op.test describe off the ambient attach.log", () => {
    // The h2a-alpha suite drives the real attach path; under the worker
    // environment the default path must resolve inside the launcher run
    // root — never the owner's real state default (string comparison only;
    // owner state is never read). Run roots live under the owner's home
    // (cache-tmp) by /tmp-rule design, so "owner" here means owner STATE.
    const ownerHome = process.env.H2A_TEST_OWNER_HOME ?? homedir();
    const runRoot = dirname(process.env.H2A_TEST_STATE_ATTESTATION ?? join(tmpdir(), "no-attestation"));
    const ambient = resolveCrashLogPath("attach");
    expect(ambient.startsWith(`${runRoot}/`)).toBe(true);
    expect(ambient).not.toBe(join(ownerHome, ".local", "state", "h2a", "attach.log"));
  });

  it("should write sess-livelock crash rows only under the isolated state root", () => {
    const ownerHome = process.env.H2A_TEST_OWNER_HOME ?? homedir();
    const runRoot = dirname(process.env.H2A_TEST_STATE_ATTESTATION ?? join(tmpdir(), "no-attestation"));
    for (const resolved of [resolveCrashLogPath("attach"), resolveHostJournalPath()]) {
      expect(resolved.startsWith(`${runRoot}/`)).toBe(true);
      expect(resolved.startsWith(join(ownerHome, ".local", "state", "h2a") + "/")).toBe(false);
    }
  });

  it("should refuse an explicit host-journal writer path outside the test state root", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    const outside = join(fixture, "protected", "native-host.log");
    expect(appendHostJournal({ event: "dropped", count: 1 }, outside)).toBe(false);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(`${outside}.lock`)).toBe(false);
  });

  it("should refuse a config write outside the test state root", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    process.env.REMOTE_CLI_CONFIG_HOME = join(fixture, "protected");
    expect(() => writeRemoteConfig({})).toThrow(TestStateRefusalError);
    expect(existsSync(join(fixture, "protected"))).toBe(false);
  });

  it("should refuse a registry write outside the test state root before locking", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    const outside = join(fixture, "protected", "registry.json");
    expect(() => removeRegistryRowsById(["sess-livelock"], outside)).toThrow(TestStateRefusalError);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(join(fixture, "protected"))).toBe(false);
  });

  it("should refuse a layout-last write outside the test state root", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    process.env.REMOTE_CLI_CONFIG_HOME = join(fixture, "protected");
    expect(() => writeLastLayout([], undefined)).toThrow(TestStateRefusalError);
    expect(existsSync(join(fixture, "protected"))).toBe(false);
  });

  it("should refuse a resume-launch claim outside the test state root without claiming", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    const claim = tryAcquireResumeLaunchClaim("0192-space-conv-id", {
      root: join(fixture, "protected", "resume-launch-claims"),
    });
    expect(claim).toBe(undefined);
    expect(existsSync(join(fixture, "protected"))).toBe(false);
  });

  it("should refuse a config-home migration outside the test state root", () => {
    const fixture = freshFixture();
    markRoot(join(fixture, "allowed"));
    const legacy = join(fixture, "protected", ".config", "sentropic", "remote-cli");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "config.json"), "{}");
    process.env.REMOTE_CLI_CONFIG_HOME = join(fixture, "protected");
    const outcome = migrateConfigHomeIfNeeded(Date.now());
    expect(outcome.migrated).toBe(false);
    expect(outcome.reason).toMatch(/REFUSING/);
    expect(existsSync(join(fixture, "protected", ".config", "sentropic", "h2a"))).toBe(false);
  });

  it("should refuse a write through a symlink leaving the test state root", () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    markRoot(allowed);
    const target = join(fixture, "outside-target");
    mkdirSync(target, { recursive: true });
    const sentinel = join(target, "SENTINEL.txt");
    writeFileSync(sentinel, "owner-fixture-sentinel");
    const linkDir = join(allowed, "link");
    symlinkSync(target, linkDir);
    expect(
      appendCrashLog("attach", { event: "refusal", sessionId: "h2a-alpha" }, join(linkDir, "attach.log")),
    ).toBe(false);
    expect(existsSync(join(target, "attach.log"))).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("owner-fixture-sentinel");
  });

  it("should fail a suite whose environment still points at owner state", () => {
    expect(() =>
      assertTestEnvironmentIsolated({
        HOME: homedir(),
        XDG_STATE_HOME: join(homedir(), ".local", "state"),
      }),
    ).toThrow(/owner state/);
    expect(() =>
      assertTestEnvironmentIsolated({
        HOME: freshFixture(),
        XDG_STATE_HOME: freshFixture(),
      }),
    ).not.toThrow();
  });

  it("should refuse an unconfined invocation before evaluating its test module", () => {
    // Negative control: without the launcher attestation the gate throws.
    // (Under the launcher this process IS confined, so probe a copy of the
    // environment with the marker removed instead of touching this process.)
    expect(() => assertConfinedTestEnvironment({})).toThrow(/unconfined/);
  });

  it("should refuse an absolute-path write by a non-Node child process", () => {
    // Filesystem-barrier layer: only the launcher's private run root is
    // writable, so a shell child aiming outside it fails with EROFS and
    // nothing appears. The target is a create-only junk path in the repo
    // root: if the barrier were ever absent, the child would succeed, the
    // test would fail (proving the barrier is required), and afterEach
    // removes the junk — no real state is ever touched either way.
    const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");
    const outside = join(repoRoot, `.escape-${process.pid}-child.txt`);
    fixtures.push(outside);
    const child = spawnSync("/bin/sh", ["-c", `printf payload > ${outside}`], { encoding: "utf8" });
    expect(child.status).not.toBe(0);
    expect(existsSync(outside)).toBe(false);
  });
});
