import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireClaudeAccountLease,
  checkTokenTtlAdmission,
  reapProcessTree,
  sweepOrphanSandboxes,
} from "./claude-code-cli-lifecycle.js";
import { readBootId, readProcessStartTime } from "./proc-identity.js";

// Mirrors the lock filename scheme in claude-code-cli-lifecycle.ts.
const lockPathFor = (lockDir: string, ownerScope: string, accountId: string) =>
  join(
    lockDir,
    `${createHash("sha256").update(`${ownerScope}:${accountId}`).digest("hex").slice(0, 32)}.lock`,
  );

const TEST_SCRATCH = join(tmpdir(), "h2a-claude-lifecycle-test-" + Date.now());

beforeEach(() => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_SCRATCH, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("claude-code-cli-lifecycle", () => {
  describe("lease management", () => {
    it("holds exclusive lease for same account and rejects concurrent acquisition after timeout", async () => {
      const lockDir = join(TEST_SCRATCH, "locks");
      const lease1 = await acquireClaudeAccountLease("owner-a", "acct-1", {
        lockDir,
        timeoutMs: 1000,
      });

      expect(lease1.ownerScope).toBe("owner-a");
      expect(lease1.accountId).toBe("acct-1");

      // Attempt second acquisition for same owner:account -> must timeout with busy error
      await expect(
        acquireClaudeAccountLease("owner-a", "acct-1", {
          lockDir,
          timeoutMs: 150,
        }),
      ).rejects.toThrow("Claude account busy: lease acquisition timed out");

      // Release first lease
      await lease1.release();

      // Now acquisition succeeds
      const lease2 = await acquireClaudeAccountLease("owner-a", "acct-1", {
        lockDir,
        timeoutMs: 500,
      });
      expect(lease2).toBeDefined();
      await lease2.release();
    });

    it("keeps a live holder's lock file intact when a waiter times out", async () => {
      const lockDir = join(TEST_SCRATCH, "locks-intact");
      const lease1 = await acquireClaudeAccountLease("owner-a", "acct-1", {
        lockDir,
        timeoutMs: 1000,
      });
      const lockFile = lockPathFor(lockDir, "owner-a", "acct-1");
      const before = JSON.parse(readFileSync(lockFile, "utf8"));

      await expect(
        acquireClaudeAccountLease("owner-a", "acct-1", { lockDir, timeoutMs: 150 }),
      ).rejects.toThrow("Claude account busy");

      expect(JSON.parse(readFileSync(lockFile, "utf8"))).toEqual(before);
      await lease1.release();
      expect(existsSync(lockFile)).toBe(false);
    });

    it("reclaims a holder proven dead by start-time identity despite a live pid", async () => {
      const lockDir = join(TEST_SCRATCH, "locks-reclaim");
      mkdirSync(lockDir, { recursive: true });
      const lockFile = lockPathFor(lockDir, "owner-a", "acct-1");
      const liveStartTime = readProcessStartTime(process.pid);
      if (liveStartTime === undefined) return; // No /proc identity: fail-closed wait is correct there.
      // A live pid carrying a foreign start-time is a recycled pid: dead holder.
      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          startTime: liveStartTime + 1_000_000,
          bootId: readBootId() ?? null,
          ownerScope: "owner-a",
          accountId: "acct-1",
          acquiredAt: Date.now(),
          token: "stale-foreign-claim",
        }),
      );

      const lease = await acquireClaudeAccountLease("owner-a", "acct-1", {
        lockDir,
        timeoutMs: 2000,
      });
      expect(lease.ownerScope).toBe("owner-a");
      const current = JSON.parse(readFileSync(lockFile, "utf8"));
      expect(current.token).not.toBe("stale-foreign-claim");
      await lease.release();
    });

    it("release never deletes a successor's fresh lock file", async () => {
      const lockDir = join(TEST_SCRATCH, "locks-successor");
      const lease1 = await acquireClaudeAccountLease("owner-a", "acct-1", {
        lockDir,
        timeoutMs: 1000,
      });
      const lockFile = lockPathFor(lockDir, "owner-a", "acct-1");

      // A successor claim lands (as after a reclaim race): release must keep it.
      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          startTime: readProcessStartTime(process.pid) ?? null,
          bootId: readBootId() ?? null,
          ownerScope: "owner-a",
          accountId: "acct-1",
          acquiredAt: Date.now(),
          token: "successor-claim",
        }),
      );
      await lease1.release();

      expect(existsSync(lockFile)).toBe(true);
      expect(JSON.parse(readFileSync(lockFile, "utf8")).token).toBe("successor-claim");
    });

    it("allows concurrent leases for different accounts", async () => {
      const lockDir = join(TEST_SCRATCH, "locks-diff");

      const leaseA = await acquireClaudeAccountLease("owner-a", "acct-1", {
        lockDir,
      });
      const leaseB = await acquireClaudeAccountLease("owner-a", "acct-2", {
        lockDir,
      });
      const leaseC = await acquireClaudeAccountLease("owner-b", "acct-1", {
        lockDir,
      });

      expect(leaseA).toBeDefined();
      expect(leaseB).toBeDefined();
      expect(leaseC).toBeDefined();

      await leaseA.release();
      await leaseB.release();
      await leaseC.release();
    });
  });

  describe("TTL admission", () => {
    it("admits valid tokens and refuses insufficient or excessive remaining TTL without rewriting", () => {
      const now = 1_000_000;

      // Valid: 1 hour remaining (3,600,000 ms)
      expect(checkTokenTtlAdmission(now + 3_600_000, now)).toEqual({
        admitted: true,
      });

      // Refusal: insufficient TTL (< 60,000 ms)
      expect(checkTokenTtlAdmission(now + 30_000, now)).toEqual({
        admitted: false,
        reason: "insufficient_remaining_ttl",
      });

      // Refusal: expired (negative remaining)
      expect(checkTokenTtlAdmission(now - 10_000, now)).toEqual({
        admitted: false,
        reason: "insufficient_remaining_ttl",
      });

      // Refusal: excessive TTL (> 24 hours = 86,400,000 ms)
      expect(checkTokenTtlAdmission(now + 100_000_000, now)).toEqual({
        admitted: false,
        reason: "excessive_remaining_ttl",
      });
    });
  });

  describe("process reaping", () => {
    it("reaps live child processes and process groups cleanly", async () => {
      // Spawn a sleep child
      const child = spawn("sleep", ["60"], { detached: true });
      const pid = child.pid!;
      expect(pid).toBeGreaterThan(0);

      // Verify alive
      expect(() => process.kill(pid, 0)).not.toThrow();

      // Reap process tree
      await reapProcessTree(pid, "SIGKILL", 50);

      // Verify dead
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  describe("orphan sweeping", () => {
    it("sweeps dead orphans older than threshold while retaining young orphans and active processes", async () => {
      const rootDir = join(TEST_SCRATCH, "runtime-root");
      mkdirSync(rootDir, { recursive: true });

      const now = 10_000_000;
      const staleAge = 300_000; // 5 min

      // 1. Stale orphan (dead PID 999999, age 10 minutes) -> should be swept
      const staleDir = join(rootDir, "run-stale");
      mkdirSync(staleDir, { recursive: true });
      writeFileSync(
        join(staleDir, "run-meta.json"),
        JSON.stringify({ pid: 999999, createdAt: now - 600_000 }),
      );

      // 2. Young orphan (dead PID 999998, age 1 minute) -> should be retained (retry later)
      const youngDir = join(rootDir, "run-young");
      mkdirSync(youngDir, { recursive: true });
      writeFileSync(
        join(youngDir, "run-meta.json"),
        JSON.stringify({ pid: 999998, createdAt: now - 60_000 }),
      );

      // 3. Live process (current process.pid, age 10 minutes) -> should be skipped (alive)
      const liveDir = join(rootDir, "run-live");
      mkdirSync(liveDir, { recursive: true });
      writeFileSync(
        join(liveDir, "run-meta.json"),
        JSON.stringify({ pid: process.pid, createdAt: now - 600_000 }),
      );

      const result = await sweepOrphanSandboxes(rootDir, {
        now: () => now,
        maxAgeMs: staleAge,
      });

      expect(result.swept).toBe(1);
      expect(result.retained).toBe(1);
      expect(result.skippedAlive).toBe(1);

      expect(existsSync(staleDir)).toBe(false);
      expect(existsSync(youngDir)).toBe(true);
      expect(existsSync(liveDir)).toBe(true);
    });

    it("never deletes runs without valid identity metadata, however old", async () => {
      const rootDir = join(TEST_SCRATCH, "meta-less-root");
      mkdirSync(rootDir, { recursive: true });

      // No run-meta.json at all, far past the stale threshold by the clock.
      const bareDir = join(rootDir, "run-bare");
      mkdirSync(bareDir, { recursive: true });

      // Corrupt metadata is not identity either.
      const corruptDir = join(rootDir, "run-corrupt");
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(join(corruptDir, "run-meta.json"), "not-json{{");

      const result = await sweepOrphanSandboxes(rootDir, {
        now: () => Date.now() + 3_600_000,
        maxAgeMs: 300_000,
      });

      expect(result.swept).toBe(0);
      expect(result.retained).toBe(2);
      expect(existsSync(bareDir)).toBe(true);
      expect(existsSync(corruptDir)).toBe(true);
    });

    it("yields to an active sweeper instead of sweeping concurrently", async () => {
      const rootDir = join(TEST_SCRATCH, "contended-root");
      mkdirSync(rootDir, { recursive: true });

      const staleDir = join(rootDir, "run-stale");
      mkdirSync(staleDir, { recursive: true });
      writeFileSync(
        join(staleDir, "run-meta.json"),
        JSON.stringify({ pid: 999997, createdAt: Date.now() - 600_000 }),
      );

      // A live sweeper holds the sweep lock.
      writeFileSync(
        join(rootDir, ".sweep.lock"),
        JSON.stringify({
          pid: process.pid,
          startTime: readProcessStartTime(process.pid) ?? null,
          bootId: readBootId() ?? null,
          acquiredAt: Date.now(),
          token: "active-sweeper",
        }),
      );

      const result = await sweepOrphanSandboxes(rootDir, { maxAgeMs: 300_000 });

      expect(result).toEqual({ swept: 0, retained: 0, skippedAlive: 0 });
      expect(existsSync(staleDir)).toBe(true);
    });
  });
});
