import { proofDeps } from './helpers/identity-proof-fixture.mjs';
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statfsSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// 0.98.6 regression: the identity binding lock must be recoverable when its
// holder is PROVABLY dead. These scenarios run against the production
// acquisition path (reclaimOrMintAsync) with fixtures written through the
// documented record formats, in a temporary store only.
import { reclaimOrMintAsync as rawReclaimOrMintAsync } from "../dist/runtime/identity/bindings.js";

/** Filesystem types eligible for automatic recovery (same whitelist as the impl). */
function reclaimOrMintAsync(root,key,deps,...options){return rawReclaimOrMintAsync(root,key,proofDeps(root,deps),...options);}

const QUALIFIED_FS_TYPES = new Set(["ef53", "58465342", "9123683e", "f2f52010"]);

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-idlock-"));
  const fsType = (statfsSync(dir).type >>> 0).toString(16);
  // A test root that does not qualify would silently exercise the "wait, never
  // recover" path — that is a failure, not a skip.
  assert.ok(
    QUALIFIED_FS_TYPES.has(fsType),
    `test root must sit on a recovery-qualified filesystem (statfs f_type=${fsType})`
  );
  return { dir, root: join(dir, ".h2a"), identityDir: join(dir, ".h2a", "identity") };
}

// Real machine/boot/namespace anchors (read-only /proc + /etc, never real h2a state).
const MACHINE_ID = readFileSync("/etc/machine-id", "utf8").trim();
const BOOT_ID = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
const PID_NS = readlinkSync("/proc/self/ns/pid");
const TIME_NS = readlinkSync("/proc/self/ns/time");

function selfProcStart() {
  const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const rest = stat.slice(stat.lastIndexOf(")") + 2);
  return `proc:${rest.split(" ")[19]}`;
}

/** A PID that is certainly gone (spawned + reaped by this test, never a foreign process). */
function deadPid() {
  const r = spawnSync(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  assert.equal(r.status, 0, "dead-pid fixture child must exit cleanly");
  return r.pid;
}

function v2Record(over) {
  const token = "deadbeefcafe0123deadbeefcafe0123";
  return {
    recordVersion: 2,
    protocol: "identity-binding-fence-v1",
    platform: "linux",
    publication: "link",
    hostKind: "machine-id",
    host: MACHINE_ID,
    boot: BOOT_ID,
    ns: PID_NS,
    timeNs: TIME_NS,
    pid: 4242,
    start: "proc:1",
    token,
    fenceEpoch: token,
    at: Date.now(),
    ...over
  };
}

function writeLock(identityDir, record) {
  mkdirSync(identityDir, { recursive: true });
  writeFileSync(join(identityDir, ".lock"), JSON.stringify(record));
  return readFileSync(join(identityDir, ".lock"));
}

const KEY = { host: "claude", providerSessionId: "psid-recovery", workspaceId: "ws-recovery" };
let MINT = 0;
function deps() {
  return {
    verifyProof: () => false,
    mint: () => {
      MINT += 1;
      return { instance: `claude:lbl:r${MINT}`, agentUuid: `uuid-r${MINT}` };
    },
    now: () => Date.parse("2026-10-11T00:00:00.000Z")
  };
}

test("recovery: a previous-boot holder is recovered automatically (stale boot)", async () => {
  const { dir, root, identityDir } = freshRoot();
  try {
    const otherBoot = "00000000-0000-4000-8000-000000000001";
    assert.match(otherBoot, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    writeLock(identityDir, v2Record({ boot: otherBoot, pid: process.pid }));
    const r = await reclaimOrMintAsync(root, KEY, deps(), { deadlineMs: 1500 });
    assert.equal(r.action, "mint");
    // The recovered fence is fully released: no lock, no succession debris.
    assert.equal(existsSync(join(identityDir, ".lock")), false, "fence must be released after the transaction");
    assert.ok(
      !readdirSync(identityDir).some((n) => n.includes(".succ.")),
      "no succession debris may remain after a completed recovery"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recovery: a same-boot dead PID is recovered automatically", async () => {
  const { dir, root, identityDir } = freshRoot();
  try {
    const pid = deadPid();
    writeLock(identityDir, v2Record({ pid, start: `proc:${pid}` }));
    const r = await reclaimOrMintAsync(root, KEY, deps(), { deadlineMs: 1500 });
    assert.equal(r.action, "mint");
    assert.equal(existsSync(join(identityDir, ".lock")), false, "fence must be released after the transaction");
    assert.ok(
      !readdirSync(identityDir).some((n) => n.includes(".succ.")),
      "no succession debris may remain after a completed recovery"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no recovery of a live holder: bounded timeout, expurgated reason, lock untouched", async () => {
  const { dir, root, identityDir } = freshRoot();
  try {
    const before = writeLock(identityDir, v2Record({
      pid: process.pid,
      start: selfProcStart()
    }));
    await assert.rejects(
      () => reclaimOrMintAsync(root, KEY, deps(), { deadlineMs: 800 }),
      (err) => {
        assert.equal(err.name, "LockTimeoutError");
        assert.match(err.message, /Automatic recovery is not authorized: holder-live/);
        const after = readFileSync(join(identityDir, ".lock"));
        assert.equal(after.toString(), before.toString(), "a live holder's lock bytes must be untouched");
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy with mismatched hostname: bounded B refusal, no downgrade", async () => {
  const { dir, root, identityDir } = freshRoot();
  try {
    const legacy = {
      pid: deadPid(),
      hostname: "fixture-host",
      startedAt: new Date().toISOString(),
      protocol: "identity-binding-fence-v1",
      fenceEpoch: randomUUID()
    };
    const before = writeLock(identityDir, legacy);
    await assert.rejects(
      () => reclaimOrMintAsync(root, KEY, deps(), { deadlineMs: 800 }),
      (err) => {
        assert.equal(err.name, "LockTimeoutError");
        assert.match(err.message, /Legacy identity lock retained: independent recovery evidence is incomplete/);
        assert.equal(err.diagnostic.reasonCode, "legacy-hostname-mismatch");
        const after = readFileSync(join(identityDir, ".lock"));
        assert.equal(after.toString(), before.toString(), "a legacy lock is never rewritten or downgraded");
        assert.ok(
          !readdirSync(identityDir).some((n) => n.includes(".succ.")),
          "no succession file may be created against a legacy lock"
        );
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
