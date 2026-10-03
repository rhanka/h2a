import { __test } from "./succession-lock-test-seam.mjs";
const acquirePrefixLock = (prefix, hooks, deps) => __test.acquirePrefixLock(prefix, {}, { ...deps, hooks });
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyLiveness,
  lockPathFor,
  parseLockRec,
  readLockHolder,
  readLockRecord
} from "../dist/runtime/local-files/succession-lock.js";

const SELF = {
  host: "legacy-reader-machine",
  hostKind: "machine-id",
  boot: "legacy-reader-boot",
  ns: "pid:[legacy-reader]",
  timeNs: "time:[legacy-reader]",
  pid: process.pid,
  start: null
};

// These synthetic fixtures model the JSON.stringify payload shape written by
// local-files/locks.ts, both with and without optional ownerMetadata. They intentionally
// never inspect a real identity store or a user-owned .stale-* file.
const LEGACY_VECTORS = [
  { pid: 2910836, hostname: "legacy-builder-host", startedAt: "2026-09-20T12:34:56.000Z" },
  { pid: 2910837, hostname: "legacy-builder-host", startedAt: "2026-09-20T12:35:56.000Z" },
  { pid: 2910838, hostname: "legacy-worker-host", startedAt: "2026-09-20T12:36:56.000Z" },
  { pid: 2910839, hostname: "legacy-worker-host", startedAt: "2026-09-20T12:37:56.000Z", protocol: "identity-binding-fence-v1" },
  { pid: 2910840, hostname: "legacy-worker-host", startedAt: "2026-09-20T12:38:56.000Z", fenceEpoch: "48d13e5a-d932-40e3-a35f-9de14498179a" }
];

const IDENTITY_BINDING_LEGACY = {
  pid: 2910840,
  hostname: "identity-binding-host",
  startedAt: "2026-09-20T12:38:56.000Z",
  protocol: "identity-binding-fence-v1",
  fenceEpoch: "48d13e5a-d932-40e3-a35f-9de14498179a"
};

function tokenFor(raw) {
  return `legacy-${createHash("sha256").update(raw).digest("hex")}`;
}

function assertNoLegacyFields(record, label) {
  assert.equal(Object.hasOwn(record, "hostname"), false, `${label} must not write hostname`);
  assert.equal(Object.hasOwn(record, "startedAt"), false, `${label} must not write startedAt`);
  assert.equal(Object.hasOwn(record, "host"), true, `${label} remains a v4 record`);
  assert.equal(Object.hasOwn(record, "token"), true, `${label} remains a v4 record`);
}

test("T-legacy: reads only the locks.ts legacy key set and derives its token from raw bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-legacy-reader-"));
  const path = join(root, ".h2a-upgrade.lock");
  try {
    for (const fixture of LEGACY_VECTORS) {
      const raw = JSON.stringify(fixture);
      writeFileSync(path, raw);
      assert.deepEqual(readLockHolder(path), {
        kind: "legacy",
        token: tokenFor(raw),
        ...fixture
      }, `legacy pid ${fixture.pid}`);
      // Existing v4-only callers still fail closed on the legacy record.
      assert.equal(readLockRecord(path), "corrupt", `legacy pid ${fixture.pid} is not a v4 record`);
    }

    // Identity binding adds both optional LockOwner metadata fields. Pin each exact
    // byte vector so the pre-v4 fencing token remains suitable for a later re-read.
    const identityRaw = JSON.stringify(IDENTITY_BINDING_LEGACY);
    writeFileSync(path, identityRaw);
    assert.deepEqual(readLockHolder(path), {
      kind: "legacy",
      token: "legacy-c608da4d084ad2b9422f7c8fa649da95d232bb96f4660b2f76a8d60ac11b85ca",
      ...IDENTITY_BINDING_LEGACY
    });

    const identityNewlineRaw = `${identityRaw}\n`;
    writeFileSync(path, identityNewlineRaw);
    assert.deepEqual(readLockHolder(path), {
      kind: "legacy",
      token: "legacy-20bc776a0727955d6a269434c6e7554f480851ddd56b24e02d14f5f98839d8bf",
      ...IDENTITY_BINDING_LEGACY
    });

    // The final newline is part of the token input. Keep this precomputed vector
    // rather than normalizing or reserializing the JSON before hashing.
    const newlineRaw = `${JSON.stringify(LEGACY_VECTORS[0])}\n`;
    writeFileSync(path, newlineRaw);
    assert.deepEqual(readLockHolder(path), {
      kind: "legacy",
      token: "legacy-a7d1e7ae867015d5f81323306d1b11a160ca7073998f9ebf58a8d437c15c06ee",
      ...LEGACY_VECTORS[0]
    });

    for (const [label, value] of [
      ["missing startedAt", { pid: 1, hostname: "host" }],
      ["non-positive pid", { pid: 0, hostname: "host", startedAt: "now" }],
      ["fractional pid", { pid: 1.5, hostname: "host", startedAt: "now" }],
      ["string pid", { pid: "1", hostname: "host", startedAt: "now" }],
      ["non-string hostname", { pid: 1, hostname: 2, startedAt: "now" }],
      ["non-string startedAt", { pid: 1, hostname: "host", startedAt: 2 }],
      ["non-string protocol", { pid: 1, hostname: "host", startedAt: "now", protocol: 2 }],
      ["non-string fenceEpoch", { pid: 1, hostname: "host", startedAt: "now", fenceEpoch: 2 }],
      ["five legacy keys plus an extra key", { ...IDENTITY_BINDING_LEGACY, extra: true }],
      ["legacy plus v4 token", { pid: 1, hostname: "host", startedAt: "now", token: "a".repeat(20) }],
      ["legacy plus unrelated field", { pid: 1, hostname: "host", startedAt: "now", extra: true }]
    ]) {
      writeFileSync(path, JSON.stringify(value));
      assert.equal(readLockHolder(path), "corrupt", label);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-legacy: remains disjoint from v4 parsing and rejects the legacy token namespace", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-legacy-v4-disjoint-"));
  const path = join(root, ".h2a-upgrade.lock");
  const v4 = {
    ...SELF,
    pid: 999_999_999,
    start: "btime:1",
    token: "a".repeat(20),
    at: 0
  };
  try {
    writeFileSync(path, JSON.stringify({ ...v4, hostname: "legacy-host", startedAt: "legacy-start" }));
    const valid = readLockHolder(path);
    assert.notEqual(valid, "absent");
    assert.notEqual(valid, "corrupt");
    assert.equal(valid.kind, undefined, "v4 parsing remains first and does not expose a legacy kind");

    for (const [label, value] of [
      ["legacy-prefixed v4 token", { ...v4, token: `legacy-${"a".repeat(64)}` }],
      ["v4 missing time namespace", (() => {
        const { timeNs: _timeNs, ...withoutTimeNs } = v4;
        return { ...withoutTimeNs, hostname: "legacy-host", startedAt: "legacy-start", protocol: "p", fenceEpoch: "e" };
      })()],
      ["v4 invalid host identity", { ...v4, hostKind: "invalid" }]
    ]) {
      writeFileSync(path, JSON.stringify(value));
      assert.equal(readLockHolder(path), "corrupt", label);
    }
    assert.throws(
      () => parseLockRec({ ...v4, token: `legacy-${"a".repeat(64)}` }),
      /bad token/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("T-legacy: never probes a legacy PID and reports it undecidable even with strong v4 fields", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-legacy-liveness-"));
  const path = lockPathFor(root);
  const legacy = { pid: 999_999_999, hostname: SELF.host, startedAt: "2026-09-20T12:34:56.000Z" };
  const originalKill = process.kill;
  let killCalls = 0;
  try {
    writeFileSync(path, JSON.stringify(legacy));
    const holder = readLockHolder(path);
    assert.notEqual(holder, "absent");
    assert.notEqual(holder, "corrupt");
    process.kill = () => {
      killCalls++;
      throw Object.assign(new Error("legacy PID probe must not run"), { code: "ESRCH" });
    };
    assert.deepEqual(classifyLiveness(holder, SELF, {
      platform: "linux",
      probe: () => { throw new Error("legacy start probe must not run"); }
    }), { verdict: "undecidable", datable: false });
    const strongLegacy = {
      kind: "legacy",
      token: `legacy-${"a".repeat(64)}`,
      hostname: "legacy-builder-host",
      startedAt: "2026-09-20T12:34:56.000Z",
      host: SELF.host,
      hostKind: "machine-id",
      boot: SELF.boot,
      ns: SELF.ns,
      timeNs: SELF.timeNs,
      pid: 999_999_999,
      start: "btime:1"
    };
    assert.deepEqual(classifyLiveness(strongLegacy, SELF, {
      platform: "linux",
      probe: () => { throw new Error("legacy start probe must not run"); }
    }), { verdict: "undecidable", datable: false });
    const lease = acquirePrefixLock(root, {}, { self: () => SELF });
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "dead-undecidable");
    assert.equal(killCalls, 0, "legacy must not reach a PID liveness probe");

    writeFileSync(path, "not json");
    const corrupt = acquirePrefixLock(root, {}, { self: () => SELF });
    assert.equal(corrupt.acquired, false);
    assert.equal(corrupt.reason, "dead-undecidable", "a corrupt lock keeps the existing upgrade result");
  } finally {
    process.kill = originalKill;
    rmSync(root, { recursive: true, force: true });
  }
});

test("T7a: LOCK, SUCC, and republication never write the legacy shape", {
  skip: !["linux", "darwin"].includes(process.platform) && "requires a supported liveness platform"
}, () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-legacy-publication-"));
  const path = lockPathFor(root);
  const deadToken = "a".repeat(20);
  try {
    const first = acquirePrefixLock(root, {}, { self: () => SELF });
    assert.equal(first.acquired, true, "initial LOCK is published");
    const initialLock = JSON.parse(readFileSync(path, "utf8"));
    first.release();

    // An externally left v4 lock is only a deterministic trigger for succession.
    // It is not one of the module records asserted below.
    writeFileSync(path, JSON.stringify({ ...SELF, pid: 999_999_999, token: deadToken, at: Date.now() }));
    let successor;
    const next = acquirePrefixLock(root, {
      afterPublishSucc: ({ path: succPath }) => {
        successor = JSON.parse(readFileSync(succPath, "utf8"));
      }
    }, { self: () => SELF });
    assert.equal(next.acquired, true, "dead holder is succeeded");
    const republishedLock = JSON.parse(readFileSync(path, "utf8"));

    assert.ok(successor, "SUCC record was published");
    assertNoLegacyFields(initialLock, "LOCK");
    assertNoLegacyFields(successor, "SUCC");
    assertNoLegacyFields(republishedLock, "republished LOCK");
    next.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
