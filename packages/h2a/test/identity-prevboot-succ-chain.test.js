import assert from "node:assert/strict";
import test from "node:test";
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

import {
  identitySelf,
  readIdentityLock,
  runCli,
  withIdentityFence
} from "../dist/index.js";

const QUALIFIED_FS_TYPES = new Set(["ef53", "58465342", "9123683e", "f2f52010"]);
const OTHER_BOOT_A = "00000000-0000-4000-8000-000000000001";
const OTHER_BOOT_B = "00000000-0000-4000-8000-000000000002";

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
    publication: "link",
    hostKind: "machine-id",
    host: self.host,
    boot: over.boot,
    ns: self.ns,
    timeNs: self.timeNs,
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
// current boot differs, chain beyond the depth limit.
function writePreviousBootChain(lock, self, boot) {
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
    const backups = readdirSync(x.identityDir).filter((n) =>
      n.startsWith(".identity-prevboot-chain-backup-")
    );
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
      JSON.stringify(v2Record(self, { boot: self.boot, pid: process.pid, token: poisoned, target: generation }))
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
    void readlinkSync;
    void readIdentityLock;
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
