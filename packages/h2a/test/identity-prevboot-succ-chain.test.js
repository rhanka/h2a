import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";

import {
  identitySelf,
  recoverPreviousBootSuccessionChain,
  runCli,
  withIdentityFence
} from "../dist/index.js";
import { createMcpServer } from "../dist/runtime/mcp/server.js";

const QUALIFIED_FS_TYPES = new Set(["ef53", "58465342", "9123683e", "f2f52010"]);
const OTHER_BOOT_A = "00000000-0000-4000-8000-000000000001";
const OTHER_BOOT_B = "00000000-0000-4000-8000-000000000002";
// Real-reboot fixture namespaces: deliberately different from the current boot.
const PREV_NS = "pid:[4026539999]";
const PREV_TIMENS = "time:[4026539999]";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-prevboot-chain-"));
  const fsType = (statfsSync(dir).type >>> 0).toString(16);
  assert.ok(
    QUALIFIED_FS_TYPES.has(fsType),
    `test root must sit on a recovery-qualified filesystem (statfs f_type=${fsType})`
  );
  const root = join(dir, "store");
  const identityDir = join(root, "identity");
  mkdirSync(identityDir, { recursive: true });
  return { dir, root, identityDir, lock: join(identityDir, ".lock") };
}

function cleanup(x) {
  rmSync(x.dir, { recursive: true, force: true });
}

function otherBoot() {
  const self = identitySelf();
  assert.equal(self.hostKind, "machine-id");
  assert.match(self.boot ?? "", /^[0-9a-f]{8}-/);
  return self.boot === OTHER_BOOT_A ? OTHER_BOOT_B : OTHER_BOOT_A;
}

function hexToken(n) {
  return n.toString(16).padStart(32, "0");
}

function v2Record(self, over) {
  return {
    recordVersion: 2,
    protocol: "identity-binding-fence-v1",
    platform: "linux",
    publication: over.publication ?? "link",
    hostKind: "machine-id",
    host: over.host ?? self.host,
    boot: over.boot,
    ns: over.ns ?? PREV_NS,
    timeNs: over.timeNs ?? PREV_TIMENS,
    pid: over.pid,
    start: "proc:1",
    token: over.token,
    fenceEpoch: over.token,
    at: Date.now(),
    ...(over.target !== undefined ? { target: over.target } : {})
  };
}

// Lock + 8 succ links, every record from another boot of the same machine.
// Mirrors the incident: lock + 8 identity/.lock.succ.* by boot 447b2812,
// current boot differs, chain beyond the depth limit. Namespaces differ like
// a real reboot (self ns/timeNs are never reused).
function writePreviousBootChain(lock, self, boot) {
  assert.notEqual(PREV_NS, self.ns);
  assert.notEqual(PREV_TIMENS, self.timeNs);
  const generation = hexToken(0xaaaa);
  writeFileSync(lock, JSON.stringify(v2Record(self, { boot, pid: 27359, token: generation })));
  let t = generation;
  const tokens = [];
  for (let i = 0; i < 8; i++) {
    const token = hexToken(0xbb00 + i);
    tokens.push(token);
    writeFileSync(
      `${lock}.succ.${t}`,
      JSON.stringify(v2Record(self, { boot, pid: 27359 + i, token, target: generation }))
    );
    t = token;
  }
  return { generation, tokens };
}

function chainFiles(identityDir) {
  return readdirSync(identityDir).filter((n) => n === ".lock" || n.includes(".succ.")).sort();
}

function backupDirs(identityDir) {
  return readdirSync(identityDir).filter((n) =>
    n.startsWith(".identity-prevboot-chain-backup-")
  );
}

function streams(cwd) {
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

function runFenceChild(lock, marker) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "helpers/identity-fence-child.mjs"), lock, marker],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`child exit ${code}: ${err}`))
    );
  });
}

test("prevboot chain: lock + 8 previous-boot succ links recover automatically with recovered-previous-boot-chain", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    const boot = otherBoot();
    writePreviousBootChain(x.lock, self, boot);
    assert.equal(chainFiles(x.identityDir).length, 9);
    const lease = await withIdentityFence(
      x.lock,
      (l) => l,
      { timeoutMs: 8000, pollMs: 10 }
    );
    try {
      assert.equal(lease.acquired, true);
      assert.equal(lease.recovered, true);
      assert.equal(lease.recoveryKind, "recovered-previous-boot-chain");
    } finally {
      lease.release();
    }
    const backups = backupDirs(x.identityDir);
    assert.equal(backups.length, 1);
    const kept = readdirSync(join(x.identityDir, backups[0])).sort();
    assert.ok(kept.includes(".lock"));
    assert.equal(kept.filter((n) => n.includes(".succ.")).length, 8);
  } finally {
    cleanup(x);
  }
});

test("prevboot chain: refusal when any link is current-boot", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    const boot = otherBoot();
    const { generation, tokens } = writePreviousBootChain(x.lock, self, boot);
    // Poison one middle link with the current boot: must keep refusing.
    const poisoned = tokens[3];
    const poisonPath = `${x.lock}.succ.${tokens[2]}`;
    writeFileSync(
      poisonPath,
      JSON.stringify(v2Record(self, { boot: self.boot, ns: self.ns, timeNs: self.timeNs, pid: process.pid, token: poisoned, target: generation }))
    );
    const before = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    await assert.rejects(
      () => withIdentityFence(x.lock, () => assert.fail("must not enter"), { timeoutMs: 600, pollMs: 10 }),
      (e) => {
        assert.equal(e.name, "LockTimeoutError");
        assert.equal(e.diagnostic.bootClass, "other");
        assert.notEqual(e.diagnostic.reasonCode, "recovered-previous-boot-chain");
        return true;
      }
    );
    const after = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    assert.deepEqual(after, before);
    assert.equal(backupDirs(x.identityDir).length, 0);
  } finally {
    cleanup(x);
  }
});

test("prevboot chain: refusal when any link is unknown", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    const { tokens } = writePreviousBootChain(x.lock, self, otherBoot());
    // Poison a walked link (not a trailing file past the depth bound).
    writeFileSync(`${x.lock}.succ.${tokens[2]}`, JSON.stringify({ recordVersion: 999 }));
    const before = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    await assert.rejects(
      () => withIdentityFence(x.lock, () => assert.fail("must not enter"), { timeoutMs: 600, pollMs: 10 }),
      (e) => {
        assert.equal(e.name, "LockTimeoutError");
        return true;
      }
    );
    const after = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    assert.deepEqual(after, before);
    assert.equal(backupDirs(x.identityDir).length, 0);
  } finally {
    cleanup(x);
  }
});

test("prevboot chain: refusal on foreign host, corrupt record and o-excl publication", async () => {
  for (const kind of ["foreign", "corrupt", "o-excl"]) {
    const x = freshStore();
    try {
      const self = identitySelf();
      const { generation, tokens } = writePreviousBootChain(x.lock, self, otherBoot());
      const victim = `${x.lock}.succ.${tokens[2]}`;
      if (kind === "foreign") {
        writeFileSync(
          victim,
          JSON.stringify(v2Record(self, { boot: otherBoot(), host: "1".repeat(32), pid: 9999, token: tokens[3], target: generation }))
        );
      } else if (kind === "corrupt") {
        writeFileSync(victim, "{corrupt");
      } else {
        writeFileSync(
          victim,
          JSON.stringify(v2Record(self, { boot: otherBoot(), pid: 9999, token: tokens[3], target: generation, publication: "o-excl" }))
        );
      }
      const before = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
      await assert.rejects(
        () => withIdentityFence(x.lock, () => assert.fail(`must not enter (${kind})`), { timeoutMs: 600, pollMs: 10 }),
        (e) => {
          assert.equal(e.name, "LockTimeoutError");
          return true;
        }
      );
      const after = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
      assert.deepEqual(after, before, `files intact on ${kind} refusal`);
      assert.equal(backupDirs(x.identityDir).length, 0, `no backup on ${kind} refusal`);
    } finally {
      cleanup(x);
    }
  }
});

test("prevboot chain: refusal on unqualified filesystem", async () => {
  const x = freshStore();
  try {
    writePreviousBootChain(x.lock, identitySelf(), otherBoot());
    const before = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    const original = fs.statfsSync;
    fs.statfsSync = () => ({ type: 0x6969 });
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        () => withIdentityFence(x.lock, () => assert.fail("must not enter"), { timeoutMs: 600, pollMs: 10 }),
        (e) => {
          assert.equal(e.name, "LockTimeoutError");
          return true;
        }
      );
    } finally {
      fs.statfsSync = original;
      syncBuiltinESMExports();
    }
    const after = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    assert.deepEqual(after, before);
    assert.equal(backupDirs(x.identityDir).length, 0);
  } finally {
    cleanup(x);
  }
});

test("prevboot chain: failed backup leaves no orphan backup directory", async () => {
  const x = freshStore();
  try {
    writePreviousBootChain(x.lock, identitySelf(), otherBoot());
    const original = fs.writeSync;
    fs.writeSync = () => { throw Object.assign(new Error("synthetic ENOSPC"), { code: "ENOSPC" }); };
    syncBuiltinESMExports();
    let result;
    try {
      result = recoverPreviousBootSuccessionChain(x.lock);
    } finally {
      fs.writeSync = original;
      syncBuiltinESMExports();
    }
    assert.equal(result.recovered, false);
    assert.equal(backupDirs(x.identityDir).length, 0);
    assert.equal(chainFiles(x.identityDir).length, 9);
  } finally {
    cleanup(x);
  }
});

test("P1 race: two parallel recoverers plus a live acquirer keep mutual exclusion with one backup", async () => {
  const x = freshStore();
  const children = [];
  try {
    writePreviousBootChain(x.lock, identitySelf(), otherBoot());
    const marker = join(x.dir, "markers");
    const first = [runFenceChild(x.lock, marker), runFenceChild(x.lock, marker)];
    await new Promise((r) => setTimeout(r, 20));
    const late = runFenceChild(x.lock, marker);
    const results = await Promise.all([...first, late]);
    assert.equal(results.length, 3);
    const rows = readFileSync(marker, "utf8").trim().split("\n");
    assert.equal(rows.length, 6);
    for (let i = 0; i < rows.length; i += 2) {
      assert.equal(rows[i].replace("enter", "exit"), rows[i + 1]);
    }
    assert.equal(backupDirs(x.identityDir).length, 1);
    assert.equal(existsSync(x.lock), false);
    void children;
  } finally {
    cleanup(x);
  }
});

test("startup storm: N sessions starting after reboot all reach identity_ready", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    writePreviousBootChain(x.lock, self, otherBoot());
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        withIdentityFence(x.lock, () => "identity_ready", { timeoutMs: 15000, pollMs: 5 })
      )
    );
    assert.equal(results.length, N);
    for (const r of results) assert.equal(r, "identity_ready");
  } finally {
    cleanup(x);
  }
});

test("startup storm (multi-process): 8 parallel recoverers keep one backup and mutual exclusion", async () => {
  const x = freshStore();
  try {
    writePreviousBootChain(x.lock, identitySelf(), otherBoot());
    const marker = join(x.dir, "markers-mp");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => runFenceChild(x.lock, marker))
    );
    assert.equal(results.length, 8);
    const rows = readFileSync(marker, "utf8").trim().split("\n");
    assert.equal(rows.length, 16);
    for (let i = 0; i < rows.length; i += 2) {
      assert.equal(rows[i].replace("enter", "exit"), rows[i + 1]);
    }
    assert.equal(backupDirs(x.identityDir).length, 1);
    assert.equal(existsSync(x.lock), false);
  } finally {
    cleanup(x);
  }
});

test("doctor --repair recovers the previous-boot succession chain", async () => {
  const x = freshStore();
  try {
    const self = identitySelf();
    assert.equal(await runCli(["init", "--root", x.root], streams(x.dir), {}), 0);
    writePreviousBootChain(x.lock, self, otherBoot());
    const io = streams(x.dir);
    const exit = await runCli(["doctor", "--root", x.root, "--repair", "--skip-hosts"], io, {});
    const report = JSON.parse(io.stdoutText);
    assert.equal(exit, 0);
    assert.equal(report.checks.identityPreviousBootChain.recovered, true);
    assert.equal(report.checks.identityPreviousBootChain.reason, "recovered-previous-boot-chain");
    assert.equal(existsSync(x.lock), false);
    assert.equal(chainFiles(x.identityDir).length, 0);
    // Identity is usable at once after the repair.
    const lease = await withIdentityFence(x.lock, (l) => l, { timeoutMs: 2000, pollMs: 10 });
    try {
      assert.equal(lease.acquired, true);
    } finally {
      lease.release();
    }
  } finally {
    cleanup(x);
  }
});

test("doctor --repair --dry-run never mutates identity/", async () => {
  const x = freshStore();
  try {
    assert.equal(await runCli(["init", "--root", x.root], streams(x.dir), {}), 0);
    writePreviousBootChain(x.lock, identitySelf(), otherBoot());
    const before = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    const io = streams(x.dir);
    const exit = await runCli(["doctor", "--root", x.root, "--repair", "--dry-run", "--skip-hosts"], io, {});
    const report = JSON.parse(io.stdoutText);
    assert.equal(exit, 0);
    assert.equal(report.checks.identityPreviousBootChain.skipped, true);
    assert.equal(report.checks.identityPreviousBootChain.dryRun, true);
    const after = chainFiles(x.identityDir).map((n) => readFileSync(join(x.identityDir, n), "utf8"));
    assert.deepEqual(after, before);
    assert.equal(backupDirs(x.identityDir).length, 0);
    assert.equal(existsSync(x.lock), true);
  } finally {
    cleanup(x);
  }
});

test("h2a_identity_status reports a fresh attempt instead of the stale failure when the blocker is gone", async () => {
  const x = freshStore();
  try {
    let state = {
      state: "identity_failed",
      attemptId: "a1",
      cause: "identity_timeout",
      message: "stale blocker",
      retryable: true,
      elapsedMs: 10,
      retryCondition: "blocker-change",
      diagnostic: {
        blockerType: "SUCC",
        reasonCode: "succ-chain-exhausted",
        reason: "the succession chain reached its depth limit",
        retryCondition: "blocker-change"
      }
    };
    let retried = false;
    const identity = {
      status: () => state,
      retry: () => {
        retried = true;
        state = { state: "identity_pending", attemptId: "a2", elapsedMs: 0, timeoutMs: 20000 };
        return true;
      },
      signer: () => undefined
    };
    const server = createMcpServer({ root: x.root, identity, storeInitialize: false });
    const res = await server.callTool("h2a_identity_status", {});
    const body = JSON.parse(res.content[0].text);
    assert.equal(retried, true);
    assert.equal(body.state, "identity_pending");
    assert.equal(body.attemptId, "a2");
  } finally {
    cleanup(x);
  }
});
