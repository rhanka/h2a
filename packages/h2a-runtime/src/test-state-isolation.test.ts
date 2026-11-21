import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendCrashLog, resolveCrashLogPath } from "./crash-log.js";
import { migrateConfigHomeIfNeeded, writeRemoteConfig } from "./config.js";
import {
  removeRegistryRowsById,
  tryWithRegistryLock,
  withNativeCreationRegistryTurn,
  withRegistryLock,
} from "./registry.js";
import {
  appendHostJournal,
  createHostJournalWriter,
  readHostJournal,
  resolveHostJournalPath,
} from "./native-terminal/journal.js";
import { tryAcquireResumeLaunchClaim } from "./relaunch.js";
import { writeLastLayout } from "./restore.js";
import {
  assertConfinedTestEnvironment,
  assertTestEnvironmentIsolated,
  guardTestStateWrite,
  isTestStateMarked,
  TEST_OWNER_HOME_ENV,
  TEST_SANDBOX_NONCE_ENV,
  TEST_STATE_BARRIER_ENV,
  TEST_STATE_RECEIPT_ENV,
  TEST_STATE_ROOT_ENV,
  TestStateRefusalError,
  translateAttestedAlias,
} from "./test-state-guard.js";

const fixtures: string[] = [];
let savedEnv: Record<string, string | undefined> = {};

const SAVED_KEYS = [
  TEST_STATE_ROOT_ENV,
  TEST_STATE_BARRIER_ENV,
  TEST_SANDBOX_NONCE_ENV,
  TEST_STATE_RECEIPT_ENV,
  "H2A_TEST_QUALIFICATION_ROOT",
  "REMOTE_CLI_CONFIG_HOME",
] as const;

beforeEach(() => {
  savedEnv = Object.fromEntries(SAVED_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.REMOTE_CLI_CONFIG_HOME;
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
  for (const key of SAVED_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** Fresh scratch dir inside the worker's private TMPDIR (inside R). */
function freshFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "h2a-l0-"));
  fixtures.push(root);
  return root;
}

/** Narrow H2A_TEST_STATE_ROOT to `allowed` (which stays inside the live receipt root). */
function narrowRoot(allowed: string): void {
  mkdirSync(allowed, { recursive: true, mode: 0o700 });
  process.env[TEST_STATE_ROOT_ENV] = allowed;
}

describe("lot L0: test-state isolation by construction (D16)", () => {
  it("should isolate direct attach crash logging before importing the runtime", () => {
    const runRoot = process.env[TEST_STATE_ROOT_ENV];
    expect(runRoot).toBeTruthy();
    const ownerHome = process.env[TEST_OWNER_HOME_ENV] ?? homedir();
    const resolved = resolveCrashLogPath("attach");
    expect(resolved.startsWith(`${resolve(runRoot!)}/`)).toBe(true);
    expect(resolved).not.toBe(join(ownerHome, ".local", "state", "h2a", "attach.log"));
    expect(appendCrashLog("attach", { event: "refusal", sessionId: "d16-direct-before-import" })).toBe(true);
    expect(existsSync(resolved)).toBe(true);
  });

  it("should write sess-livelock crash rows only under the isolated state root", () => {
    const runRoot = resolve(process.env[TEST_STATE_ROOT_ENV]!);
    const ownerHome = process.env[TEST_OWNER_HOME_ENV] ?? homedir();
    for (const resolved of [resolveCrashLogPath("attach"), resolveHostJournalPath()]) {
      expect(resolved.startsWith(`${runRoot}/`)).toBe(true);
      expect(resolved.startsWith(join(ownerHome, ".local", "state", "h2a") + "/")).toBe(false);
    }
    expect(appendCrashLog("attach", { event: "reconnect", sessionId: "sess-livelock" })).toBe(true);
    expect(readFileSync(resolveCrashLogPath("attach"), "utf8")).toContain("sess-livelock");
  });

  it("should allow writes inside the marked root and stay inert when unmarked", () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    narrowRoot(allowed);
    expect(() => guardTestStateWrite(join(allowed, "attach.log"))).not.toThrow();

    const unmarkedEnv: Record<string, string | undefined> = {
      H2A_TEST_QUALIFICATION_ROOT: allowed,
    };
    expect(isTestStateMarked(unmarkedEnv)).toBe(false);
    expect(() =>
      guardTestStateWrite(join(fixture, "outside", "attach.log"), unmarkedEnv),
    ).not.toThrow();
  });

  it("should refuse partial or contradictory D16 environment tuples before mutation", () => {
    const fixture = freshFixture();
    const target = join(fixture, "x.log");
    // Companion D16 var without H2A_TEST_STATE_ROOT -> configuration error before mutation.
    expect(() =>
      guardTestStateWrite(target, { [TEST_STATE_BARRIER_ENV]: "1" }),
    ).toThrow(TestStateRefusalError);
    // H2A_TEST_STATE_ROOT without barrier/receipt -> configuration error before mutation.
    expect(() =>
      guardTestStateWrite(target, { [TEST_STATE_ROOT_ENV]: fixture }),
    ).toThrow(TestStateRefusalError);
    // Wrong nonce -> refused.
    expect(() =>
      guardTestStateWrite(target, {
        ...process.env,
        [TEST_SANDBOX_NONCE_ENV]: "0".repeat(48),
      }),
    ).toThrow(TestStateRefusalError);
  });

  it("should translate C5 compat-tmp alias only with matching dev/ino and refuse mismatches", () => {
    const receipt = assertConfinedTestEnvironment(process.env);
    const tmpAlias = receipt.aliases.find((a) => a.visible === "/tmp");
    expect(tmpAlias).toBeDefined();
    expect(tmpAlias!.target).toBe("compat-tmp");
    const visStat = statSync("/tmp");
    const backStat = statSync(join(receipt.root, "compat-tmp"));
    expect(String(visStat.dev)).toBe(tmpAlias!.dev);
    expect(String(visStat.ino)).toBe(tmpAlias!.ino);
    expect(String(backStat.dev)).toBe(tmpAlias!.dev);
    expect(String(backStat.ino)).toBe(tmpAlias!.ino);

    // Valid compat-tmp path resolves into R/compat-tmp.
    const translated = translateAttestedAlias("/tmp/mh-l6-probe/file.txt", receipt);
    expect(translated).toBe(join(receipt.root, "compat-tmp", "mh-l6-probe", "file.txt"));
    expect(() => guardTestStateWrite("/tmp/mh-l6-probe/file.txt")).not.toThrow();

    // Missing compat-tmp entry or mismatched inode -> refused before effect.
    const noTmpReceipt = { ...receipt, aliases: receipt.aliases.filter((a) => a.visible !== "/tmp") };
    expect(translateAttestedAlias("/tmp/mh-l6-probe/file.txt", noTmpReceipt)).toBeNull();
    const badInoReceipt = {
      ...receipt,
      aliases: receipt.aliases.map((a) => (a.visible === "/tmp" ? { ...a, ino: "999999999999" } : a)),
    };
    expect(translateAttestedAlias("/tmp/mh-l6-probe/file.txt", badInoReceipt)).toBeNull();
  });

  it("should refuse an in-process write outside the test state root", () => {
    const fixture = freshFixture();
    narrowRoot(join(fixture, "allowed"));
    expect(() => guardTestStateWrite(join(fixture, "elsewhere", "x.log"))).toThrow(TestStateRefusalError);
  });

  it("should refuse an explicit writer path outside the test state root before creating anything", () => {
    const fixture = freshFixture();
    narrowRoot(join(fixture, "allowed"));
    const protectedDir = join(fixture, "protected");
    mkdirSync(protectedDir, { recursive: true });
    const sentinel = join(protectedDir, "SENTINEL.txt");
    writeFileSync(sentinel, "owner-fixture-sentinel");
    const outside = join(protectedDir, "nested", "attach.log");

    expect(appendCrashLog("attach", { event: "refusal", sessionId: "sess-livelock" }, outside)).toBe(false);
    expect(existsSync(join(protectedDir, "nested"))).toBe(false);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(`${outside}.lock`)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("owner-fixture-sentinel");
  });

  it("should guard direct and worker host-journal writes (C4)", async () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    narrowRoot(allowed);

    const protectedDir = join(fixture, "protected");
    mkdirSync(protectedDir, { recursive: true });
    const sentinel = join(protectedDir, "SENTINEL.txt");
    writeFileSync(sentinel, "owner-fixture-sentinel");
    const outsideLog = join(protectedDir, "native-host.log");

    // Direct call outside root -> refused with zero effects.
    expect(appendHostJournal({ event: "dropped", count: 1 }, outsideLog)).toBe(false);
    expect(existsSync(outsideLog)).toBe(false);
    expect(existsSync(`${outsideLog}.lock`)).toBe(false);
    expect(existsSync(`${outsideLog}.1`)).toBe(false);

    // Worker writer outside root -> refused before fork, zero effects.
    const refusedWriter = createHostJournalWriter(outsideLog);
    refusedWriter.write({ event: "dropped", count: 2 });
    await refusedWriter.flush();
    await refusedWriter.settle();
    expect(existsSync(outsideLog)).toBe(false);
    expect(existsSync(`${outsideLog}.lock`)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("owner-fixture-sentinel");

    // Allowed worker writer -> lands inside allowed root.
    const insideLog = join(allowed, "native-host.log");
    const okWriter = createHostJournalWriter(insideLog);
    okWriter.write({ event: "dropped", count: 3 });
    await okWriter.flush();
    await okWriter.settle();
    expect(readHostJournal(insideLog).some((e) => e.event === "dropped" && e.count === 3)).toBe(true);
  });

  it("should guard config write and config-home migration outside the test state root", () => {
    const fixture = freshFixture();
    narrowRoot(join(fixture, "allowed"));
    const protectedHome = join(fixture, "protected");
    process.env.REMOTE_CLI_CONFIG_HOME = protectedHome;
    expect(() => writeRemoteConfig({})).toThrow(TestStateRefusalError);
    expect(existsSync(protectedHome)).toBe(false);

    const legacy = join(protectedHome, ".config", "sentropic", "remote-cli");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "config.json"), "{}");
    const outcome = migrateConfigHomeIfNeeded(Date.now());
    expect(outcome.migrated).toBe(false);
    expect(outcome.reason).toMatch(/REFUSING/);
    expect(existsSync(join(protectedHome, ".config", "sentropic", "h2a"))).toBe(false);
  });

  it("should guard all three registry lock acquisitions and both release paths (C4)", async () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    narrowRoot(allowed);

    const protectedDir = join(fixture, "protected");
    mkdirSync(protectedDir, { recursive: true });
    const outsideReg = join(protectedDir, "registry.json");
    const sentinelLock = `${outsideReg}.lock`;
    writeFileSync(sentinelLock, "foreign-lock-sentinel");

    // 1. withRegistryLock / removeRegistryRowsById
    expect(() => removeRegistryRowsById(["sess-livelock"], outsideReg)).toThrow(TestStateRefusalError);
    expect(() => withRegistryLock(outsideReg, (entries) => ({ entries, result: 0 }))).toThrow(TestStateRefusalError);
    // 2. tryWithRegistryLock
    expect(() => tryWithRegistryLock(outsideReg, (entries) => ({ entries, result: 0 }))).toThrow(TestStateRefusalError);
    // 3. withNativeCreationRegistryTurn (async)
    await expect(withNativeCreationRegistryTurn(outsideReg, () => 1)).rejects.toThrow(TestStateRefusalError);

    expect(existsSync(outsideReg)).toBe(false);
    expect(readFileSync(sentinelLock, "utf8")).toBe("foreign-lock-sentinel");

    // Verify release guard does NOT unlink a swapped lock file inside allowed root.
    const insideReg = join(allowed, "registry.json");
    const insideLock = `${insideReg}.lock`;
    withRegistryLock(insideReg, (entries) => {
      // Simulate lock replacement while held: unlink our lock and create a new inode.
      rmSync(insideLock, { force: true });
      writeFileSync(insideLock, "swapped-owner-lock");
      return { entries, result: true, save: false };
    });
    expect(readFileSync(insideLock, "utf8")).toBe("swapped-owner-lock");

    // Verify async turn release also refuses to unlink a swapped lock.
    rmSync(insideLock, { force: true });
    await withNativeCreationRegistryTurn(insideReg, () => {
      rmSync(insideLock, { force: true });
      writeFileSync(insideLock, "swapped-async-lock");
      return true;
    });
    expect(readFileSync(insideLock, "utf8")).toBe("swapped-async-lock");
  });

  it("should refuse a layout-last write outside the test state root", () => {
    const fixture = freshFixture();
    narrowRoot(join(fixture, "allowed"));
    process.env.REMOTE_CLI_CONFIG_HOME = join(fixture, "protected");
    expect(() => writeLastLayout([], undefined)).toThrow(TestStateRefusalError);
    expect(existsSync(join(fixture, "protected"))).toBe(false);
  });

  it("should refuse a resume-launch claim outside the test state root without claiming", () => {
    const fixture = freshFixture();
    narrowRoot(join(fixture, "allowed"));
    const claim = tryAcquireResumeLaunchClaim("0192-space-conv-id", {
      root: join(fixture, "protected", "resume-launch-claims"),
    });
    expect(claim).toBe(undefined);
    expect(existsSync(join(fixture, "protected"))).toBe(false);
  });

  it("should refuse a write through a symlink leaving the test state root", () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    narrowRoot(allowed);
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
    expect(existsSync(join(target, "attach.log.lock"))).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("owner-fixture-sentinel");
  });

  it("should refuse an absolute-path write by a non-Node child process", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const outside = join(repoRoot, `.escape-${process.pid}-child.txt`);
    const child = spawnSync("/bin/sh", ["-c", `printf payload > "${outside}"`], { encoding: "utf8" });
    expect(child.status).not.toBe(0);
    expect(existsSync(outside)).toBe(false);
  });

  it("should preserve the protected owner fixture across worker and child failures", () => {
    const fixture = freshFixture();
    const allowed = join(fixture, "allowed");
    narrowRoot(allowed);
    const protectedDir = join(fixture, "fake-owner");
    mkdirSync(protectedDir, { recursive: true });
    const sentinel = join(protectedDir, "attach.log");
    writeFileSync(sentinel, "immutable-owner-bytes\n");
    const beforeStat = lstatSync(sentinel);

    expect(() => {
      try {
        guardTestStateWrite(sentinel);
      } finally {
        // Exception path must leave protected fixture byte-identical.
      }
    }).toThrow(TestStateRefusalError);

    expect(readFileSync(sentinel, "utf8")).toBe("immutable-owner-bytes\n");
    expect(lstatSync(sentinel).ino).toBe(beforeStat.ino);
  });

  it("should fail a suite whose environment still points at owner state", () => {
    const ownerHome = process.env[TEST_OWNER_HOME_ENV] ?? homedir();
    expect(() =>
      assertTestEnvironmentIsolated({
        [TEST_OWNER_HOME_ENV]: ownerHome,
        HOME: ownerHome,
        XDG_STATE_HOME: join(ownerHome, ".local", "state"),
      }),
    ).toThrow(/owner state/);
    expect(() =>
      assertTestEnvironmentIsolated({
        [TEST_OWNER_HOME_ENV]: ownerHome,
        HOME: freshFixture(),
        XDG_STATE_HOME: freshFixture(),
      }),
    ).not.toThrow();
  });

  it("should refuse an unconfined direct Node or Vitest run before evaluating its test module", () => {
    expect(() => assertConfinedTestEnvironment({})).toThrow(/unconfined/);
    expect(() =>
      assertConfinedTestEnvironment({
        [TEST_STATE_ROOT_ENV]: freshFixture(),
      }),
    ).toThrow(/unconfined/);
  });
});
