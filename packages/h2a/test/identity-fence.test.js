import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  findBinding,
  identityFsQualified,
  neutralizeBindingsTail,
  readIdentityLock,
  reclaimOrMint,
  withIdentityFence,
  withIdentityFenceSync
} from "../dist/index.js";

const QUALIFIED_FS_TYPES = new Set(["ef53", "58465342", "9123683e", "f2f52010"]);

function freshDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `h2a-fence-${label}-`));
  const fsType = (statfsSync(dir).type >>> 0).toString(16);
  assert.ok(
    QUALIFIED_FS_TYPES.has(fsType),
    `test root must sit on a recovery-qualified filesystem (statfs f_type=${fsType})`
  );
  return dir;
}

const MACHINE_ID = readFileSync("/etc/machine-id", "utf8").trim();
const BOOT_ID = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
const PID_NS = readlinkSync("/proc/self/ns/pid");
const TIME_NS = readlinkSync("/proc/self/ns/time");

function selfProcStart() {
  const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
  const rest = stat.slice(stat.lastIndexOf(")") + 2);
  return `proc:${rest.split(" ")[19]}`;
}

function deadPid() {
  const r = spawnSync(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  assert.equal(r.status, 0);
  return r.pid;
}

function v2Record(over) {
  const token = "cafe0123cafe0123cafe0123cafe0123";
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

function writeLock(dir, record) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".lock"), JSON.stringify(record));
  return readFileSync(join(dir, ".lock"));
}

function noSuccDebris(dir) {
  assert.ok(
    !readdirSync(dir).some((n) => n.includes(".succ.")),
    "no succession debris may remain"
  );
}

// ---------------------------------------------------------------------------
// Producer schema (R2).
// ---------------------------------------------------------------------------

test("acquisition publishes a strict v2 record: provenance, token===fenceEpoch, 0600, no legacy fields", () => {
  const dir = freshDir("schema");
  const lockPath = join(dir, ".lock");
  try {
    let inFence;
    const value = withIdentityFenceSync(lockPath, (lease) => {
      assert.equal(lease.publication, "link");
      assert.equal(lease.recovered, false);
      inFence = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.equal(statSync(lockPath).mode & 0o777, 0o600, "the fence record must be 0600");
      return 42;
    });
    assert.equal(value, 42);
    const rec = inFence;
    assert.equal(rec.recordVersion, 2);
    assert.equal(rec.protocol, "identity-binding-fence-v1");
    assert.equal(rec.platform, "linux");
    assert.equal(rec.publication, "link");
    assert.equal(rec.hostKind, "machine-id");
    assert.equal(rec.host, MACHINE_ID);
    assert.equal(rec.boot, BOOT_ID);
    assert.equal(rec.ns, PID_NS);
    assert.equal(rec.timeNs, TIME_NS);
    assert.equal(rec.pid, process.pid);
    assert.equal(rec.start, selfProcStart());
    assert.match(rec.token, /^[0-9a-f]{32}$/);
    assert.equal(rec.fenceEpoch, rec.token);
    assert.equal(typeof rec.at, "number");
    // No legacy field is ever written (an old parser's ESRCH+hostname
    // recovery must stay impossible).
    for (const banned of ["hostname", "startedAt", "acquiredAt"]) {
      assert.equal(banned in rec, false, `v2 record must not carry ${banned}`);
    }
    assert.deepEqual(
      Object.keys(rec).sort(),
      ["at", "boot", "fenceEpoch", "host", "hostKind", "ns", "pid", "platform",
        "protocol", "publication", "recordVersion", "start", "timeNs", "token"],
      "strict v2 key set"
    );
    assert.equal(existsSync(lockPath), false, "release removes the lock");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readIdentityLock classifies v2 / adapter / legacy / cull / unknown / corrupt / absent", () => {
  const dir = freshDir("reader");
  try {
    const lockPath = join(dir, ".lock");
    assert.equal(readIdentityLock(lockPath), "absent");
    writeFileSync(lockPath, "{not json");
    assert.equal(readIdentityLock(lockPath), "corrupt");
    writeFileSync(lockPath, JSON.stringify(v2Record({ pid: process.pid })));
    const v2 = readIdentityLock(lockPath);
    assert.equal(v2.kind, "v2");
    assert.equal(v2.rec.token, v2.rec.fenceEpoch);
    // 0.98.5 succession format (adapter): anchors used as-is, link publication recognized.
    writeFileSync(lockPath, JSON.stringify({
      host: MACHINE_ID, hostKind: "machine-id", boot: BOOT_ID, ns: PID_NS,
      timeNs: TIME_NS, pid: process.pid, start: selfProcStart(),
      token: "abcd0123abcd0123abcd0123abcd0123", at: Date.now()
    }));
    const adapter = readIdentityLock(lockPath);
    assert.equal(adapter.kind, "adapter");
    // A newer record version is explicit-unknown, never downgraded.
    writeFileSync(lockPath, JSON.stringify(v2Record({ recordVersion: 3 })));
    assert.equal(readIdentityLock(lockPath), "unknown");
    // Legacy binding lock (<= 0.98.5 sentinel shape).
    writeFileSync(lockPath, JSON.stringify({
      pid: 123, hostname: "h", startedAt: "2026-01-01T00:00:00.000Z"
    }));
    assert.equal(readIdentityLock(lockPath).kind, "legacy");
    // Historical cull fence.
    writeFileSync(lockPath, JSON.stringify({
      protocol: "identity-binding-fence-v1", fenceEpoch: "x", pid: 123, acquiredAt: 1
    }));
    assert.equal(readIdentityLock(lockPath).kind, "cull");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("identityFsQualified: ext4 qualifies, proc and errors do not", () => {
  assert.equal(identityFsQualified(freshDir("fs")), true);
  assert.equal(identityFsQualified("/proc"), false, "procfs must never qualify");
  assert.equal(identityFsQualified(join(freshDir("fs2"), "nope")), false);
});

// ---------------------------------------------------------------------------
// Doubt classes (R3/R7): bounded refusal with a precise, expurgated reason.
// ---------------------------------------------------------------------------

test("an unknown record version is never downgraded: bounded wait, stable record", async () => {
  const dir = freshDir("unknown");
  const lockPath = join(dir, ".lock");
  try {
    const before = writeLock(dir, v2Record({ recordVersion: 3, pid: deadPid() }));
    await assert.rejects(
      () => withIdentityFence(lockPath, () => "never", { timeoutMs: 600 }),
      (err) => {
        assert.equal(err.name, "LockTimeoutError");
        assert.equal(err.diagnostic.reasonCode, "unknown-record-version");
        assert.equal(err.diagnostic.retryCondition, "blocker-change");
        assert.equal(readFileSync(lockPath).toString(), before.toString());
        noSuccDebris(dir);
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an o-excl publication is provably dead but never recovered automatically", async () => {
  const dir = freshDir("oexcl");
  const lockPath = join(dir, ".lock");
  try {
    writeLock(dir, v2Record({ publication: "o-excl", pid: deadPid() }));
    await assert.rejects(
      () => withIdentityFence(lockPath, () => "never", { timeoutMs: 600 }),
      (err) => {
        assert.equal(err.diagnostic.reasonCode, "publication-o-excl");
        assert.equal(err.diagnostic.pid !== "unknown", true);
        noSuccDebris(dir);
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a foreign machine holder is undecidable: named, bounded, never recovered", async () => {
  const dir = freshDir("foreign");
  const lockPath = join(dir, ".lock");
  try {
    writeLock(dir, v2Record({
      host: "ffffffffffffffffffffffffffffff01",
      pid: deadPid()
    }));
    await assert.rejects(
      () => withIdentityFence(lockPath, () => "never", { timeoutMs: 600 }),
      (err) => {
        assert.equal(err.diagnostic.reasonCode, "foreign-machine");
        assert.equal(err.diagnostic.machineClass, "other");
        assert.equal(err.diagnostic.retryCondition, "blocker-change");
        assert.equal(err.message.includes(MACHINE_ID), false, "no raw machine-id in the diagnostic");
        noSuccDebris(dir);
        return true;
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Real crash: a child that holds the fence is SIGKILLed; the parent recovers.
// ---------------------------------------------------------------------------

test("a SIGKILLed holder of the same boot is recovered by the next acquisition", () => {
  const dir = freshDir("crash");
  const lockPath = join(dir, ".lock");
  let child;
  try {
    const distUrl = pathToFileURL(join(import.meta.dirname, "..", "dist", "index.js")).href;
    // The child acquires the real fence and holds it (busy wait, no signal
    // handler cleanup) until we kill it by the PID we spawned.
    const script = `
      import { withIdentityFenceSync } from ${JSON.stringify(distUrl)};
      withIdentityFenceSync(${JSON.stringify(lockPath)}, () => {
        const end = Date.now() + 30000;
        while (Date.now() < end) {}
      }, { timeoutMs: 5000 });
    `;
    child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
    // Wait until the child actually holds the fence.
    let holder;
    const deadline = Date.now() + 10000;
    for (;;) {
      const read = readIdentityLock(lockPath);
      if (typeof read === "object" && read.kind === "v2") {
        holder = read;
        break;
      }
      assert.ok(Date.now() < deadline, "child never published its fence record");
      spawnSync(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    }
    assert.equal(holder.rec.pid, child.pid);
    child.kill("SIGKILL");
    const exited = spawnSync("true", []).status; // let the reaper settle
    assert.equal(exited, 0);
    let recovered = false;
    const out = withIdentityFenceSync(lockPath, (lease) => {
      recovered = lease.recovered;
      return lease.recovered;
    }, { timeoutMs: 4000 });
    assert.equal(out, true, "the next acquisition must recover the killed holder");
    assert.equal(recovered, true);
    assert.equal(existsSync(lockPath), false);
    noSuccDebris(dir);
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Concurrency: two waiters over a dead holder serialize; exactly one recovers.
// ---------------------------------------------------------------------------

test("two concurrent waiters over a dead holder serialize and elect exactly one successor", async () => {
  const dir = freshDir("two");
  const lockPath = join(dir, ".lock");
  try {
    writeLock(dir, v2Record({ pid: deadPid() }));
    const markers = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const run = (id) => withIdentityFence(lockPath, async (lease) => {
      markers.push(`enter-${id}`);
      await sleep(150);
      markers.push(`exit-${id}`);
      return lease.recovered;
    }, { timeoutMs: 5000, pollMs: 40 });
    const [a, b] = await Promise.all([run("A"), run("B")]);
    assert.equal(a === true || b === true, true, "at least one waiter recovered the dead holder");
    assert.equal((a === true) + (b === true), 1, "exactly one waiter performs the recovery");
    assert.match(
      markers.join(" "),
      /^(enter-A exit-A enter-B exit-B|enter-B exit-B enter-A exit-A)$/,
      "critical sections must be strictly serialized"
    );
    assert.equal(existsSync(lockPath), false);
    noSuccDebris(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R5 tail neutralization.
// ---------------------------------------------------------------------------

const OLD_BINDING = JSON.stringify({
  host: "claude", providerSessionId: "psid-old", workspaceId: "ws-old",
  instance: "claude:lbl:old", agentUuid: "uuid-old", at: "2026-01-01T00:00:00.000Z"
});

test("reclaimOrMint neutralizes an unterminated fragment suffix and preserves every byte", () => {
  const dir = freshDir("tail-frag");
  const root = join(dir, ".h2a");
  try {
    mkdirSync(join(root, "identity"), { recursive: true });
    const original = `${OLD_BINDING}\n{"fragment`;
    writeFileSync(join(root, "identity", "bindings.jsonl"), original);
    const r = reclaimOrMint(root, { host: "claude", providerSessionId: "psid-new", workspaceId: "ws" }, {
      verifyProof: () => false,
      mint: () => ({ instance: "claude:lbl:new", agentUuid: "uuid-new" }),
      now: () => Date.parse("2026-10-11T00:00:00.000Z")
    });
    assert.equal(r.action, "mint");
    const after = readFileSync(join(root, "identity", "bindings.jsonl"), "utf8");
    assert.ok(
      after.startsWith(original + "\n"),
      "the fragment suffix is terminated with exactly one byte; no byte before it changes"
    );
    assert.ok(after.includes("uuid-new"), "the minted row is appended after the neutralized tail");
    assert.ok(findBinding(root, { host: "claude", providerSessionId: "psid-old", workspaceId: "ws-old" }),
      "the complete row before the fragment stays visible");
    assert.equal(findBinding(root, { host: "claude", providerSessionId: "psid-new", workspaceId: "ws" }).agentUuid, "uuid-new");
    assert.equal(existsSync(join(root, "identity", ".lock")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("neutralizeBindingsTail: terminates a complete unterminated JSON, idempotent, no-ops", () => {
  const dir = freshDir("tail-unit");
  try {
    const f = join(dir, "b.jsonl");
    assert.equal(neutralizeBindingsTail(f), undefined, "absent file is a no-op");
    writeFileSync(f, "");
    assert.equal(neutralizeBindingsTail(f), undefined, "empty file is a no-op");
    writeFileSync(f, OLD_BINDING); // complete JSON, no trailing newline
    const n = neutralizeBindingsTail(f);
    assert.equal(n.offset, 0);
    assert.equal(n.length, Buffer.byteLength(OLD_BINDING));
    assert.match(n.sha256, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(f, "utf8"), `${OLD_BINDING}\n`);
    assert.equal(neutralizeBindingsTail(f), undefined, "already terminated: idempotent");
    assert.equal(readFileSync(f, "utf8"), `${OLD_BINDING}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
