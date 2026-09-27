import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquirePrefixLock,
  classifyLiveness,
  lockPathFor,
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

// These are synthetic fixtures, constructed from the exact JSON.stringify payload
// written by local-files/locks.ts. They intentionally never inspect a real identity
// store or a user-owned .stale-* file.
const LEGACY_VECTORS = [
  { pid: 2910836, hostname: "legacy-builder-host", startedAt: "2026-09-20T12:34:56.000Z" },
  { pid: 2910837, hostname: "legacy-builder-host", startedAt: "2026-09-20T12:35:56.000Z" },
  { pid: 2910838, hostname: "legacy-worker-host", startedAt: "2026-09-20T12:36:56.000Z" },
  { pid: 2910839, hostname: "legacy-worker-host", startedAt: "2026-09-20T12:37:56.000Z" }
];

function tokenFor(raw) {
  return `legacy-${createHash("sha256").update(raw).digest("hex")}`;
}

function assertNoLegacyFields(record, label) {
  assert.equal(Object.hasOwn(record, "hostname"), false, `${label} must not write hostname`);
  assert.equal(Object.hasOwn(record, "startedAt"), false, `${label} must not write startedAt`);
  assert.equal(Object.hasOwn(record, "host"), true, `${label} remains a v4 record`);
  assert.equal(Object.hasOwn(record, "token"), true, `${label} remains a v4 record`);
}

test("T-legacy: reads only the exact locks.ts legacy shape and derives its token from raw bytes", () => {
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

test("T-legacy: never probes a legacy PID and reports it undecidable even when absent on this hostname", () => {
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
      throw new Error("legacy PID probe must not run");
    };
    assert.deepEqual(classifyLiveness(holder, SELF, {
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
