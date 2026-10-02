import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquirePrefixLock,
  lockPathFor,
  me,
  readLockHolder,
  readLockRecord
} from "../dist/runtime/local-files/succession-lock.js";
import { __test } from "./succession-lock-test-seam.mjs";
import { defaultUpgradeRuntime } from "../dist/index.js";

const SELF = {
  host: "read-first-machine",
  hostKind: "machine-id",
  boot: "read-first-boot",
  ns: "pid:[read-first]",
  timeNs: "time:[read-first]",
  pid: process.pid,
  start: null
};
const require = createRequire(import.meta.url);
const mutableFs = require("node:fs");

function lockRecord(overrides = {}) {
  return {
    ...SELF,
    pid: 999_999_999,
    token: "a".repeat(20),
    at: 0,
    ...overrides
  };
}

function onlyLockFile(prefix) {
  assert.deepEqual(readdirSync(prefix), [".h2a-upgrade.lock"], "no tmp or SUCC file was published");
}

function acquire(prefix, hooks = {}, readFirst) {
  return __test.acquirePrefixLock(
    prefix,
    readFirst === undefined ? {} : { readFirst },
    { self: () => SELF, hooks }
  );
}

function countLockIo(run, interceptLink) {
  const linkSync = mutableFs.linkSync;
  const fsyncSync = mutableFs.fsyncSync;
  const counts = { links: 0, fsyncs: 0 };
  try {
    mutableFs.linkSync = (...args) => {
      counts.links++;
      return interceptLink ? interceptLink(linkSync, ...args) : linkSync(...args);
    };
    mutableFs.fsyncSync = (...args) => {
      counts.fsyncs++;
      return fsyncSync(...args);
    };
    syncBuiltinESMExports();
    return { result: run(), ...counts };
  } finally {
    mutableFs.linkSync = linkSync;
    mutableFs.fsyncSync = fsyncSync;
    syncBuiltinESMExports();
  }
}

function withReadFileFailure(path, code, run) {
  const readFileSync = mutableFs.readFileSync;
  let reads = 0;
  try {
    mutableFs.readFileSync = (candidate, ...args) => {
      if (candidate === path) {
        reads++;
        throw Object.assign(new Error(`injected ${code}`), { code });
      }
      return readFileSync(candidate, ...args);
    };
    syncBuiltinESMExports();
    return { result: run(), reads };
  } finally {
    mutableFs.readFileSync = readFileSync;
    syncBuiltinESMExports();
  }
}

test("T-readFirst-ne-décide-pas: skips publication for a live holder", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-live-"));
  const path = lockPathFor(prefix);
  try {
    const raw = JSON.stringify(lockRecord({ pid: process.pid, token: "b".repeat(20) }));
    writeFileSync(path, raw, "utf8");
    let publicationAttempts = 0;

    const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {
      beforePublishLock: () => { publicationAttempts++; }
    }, true));

    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy");
    assert.equal(publicationAttempts, 0, "readFirst must skip tmp/fsync/link before a live LOCK");
    assert.equal(links, 0, "readFirst must skip link before a live LOCK");
    assert.equal(fsyncs, 0, "readFirst must skip fsync before a live LOCK");
    assert.equal(readFileSync(path, "utf8"), raw, "the live LOCK was never touched");
    onlyLockFile(prefix);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: a preliminary death is re-read before succession", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-refresh-"));
  const path = lockPathFor(prefix);
  try {
    writeFileSync(path, JSON.stringify(lockRecord()), "utf8");
    let preliminaryReads = 0;
    let publicationAttempts = 0;
    let successorPublications = 0;

    const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {
      // Test-only critical-window hook: make the holder live after readFirst has
      // observed a dead record, before the normal EEXIST read/classification.
      afterReadFirst: () => {
        preliminaryReads++;
        writeFileSync(path, JSON.stringify(lockRecord({ pid: process.pid, token: "c".repeat(20) })), "utf8");
      },
      beforePublishLock: () => { publicationAttempts++; },
      afterPublishSucc: () => { successorPublications++; }
    }, true));

    assert.equal(preliminaryReads, 1, "the preliminary LOCK observation occurred");
    assert.equal(publicationAttempts, 1, "a preliminary death resumes the ordinary publication path");
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy", "the fresh live holder wins over the preliminary dead observation");
    assert.equal(successorPublications, 0, "no succession may use the preliminary death");
    assert.equal(links, 1, "the ordinary LOCK publication reaches link once before the fresh read");
    assert.equal(fsyncs, 1, "the ordinary LOCK publication fsyncs once before the fresh read");
    assert.equal(readLockRecord(path).token, "c".repeat(20), "the fresh live LOCK remains held");
    onlyLockFile(prefix);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: a freshly confirmed death succeeds with one final holder", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-dead-"));
  const path = lockPathFor(prefix);
  try {
    writeFileSync(path, JSON.stringify(lockRecord()), "utf8");
    let preliminaryReads = 0;
    let successorPublications = 0;

    const lease = acquire(prefix, {
      afterReadFirst: () => { preliminaryReads++; },
      afterPublishSucc: () => { successorPublications++; }
    }, true);

    assert.equal(preliminaryReads, 1);
    assert.equal(lease.acquired, true, "a dead holder is still reclaimed through ordinary succession");
    assert.equal(successorPublications, 1, "the ordinary path elected exactly one successor");
    assert.equal(readLockRecord(path).token, lease.token, "the replacement LOCK belongs to this lease");
    onlyLockFile(prefix);
    lease.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: legacy, corrupt, and undecidable holders skip publication", () => {
  for (const [label, contents] of [
    ["legacy", JSON.stringify({ pid: 1234, hostname: "legacy-host", startedAt: "2026-09-20T12:34:56.000Z" })],
    ["corrupt", "not-json"],
    ["undecidable", JSON.stringify(lockRecord({ hostKind: "weak" }))]
  ]) {
    const prefix = mkdtempSync(join(tmpdir(), `h2a-read-first-${label}-`));
    const path = lockPathFor(prefix);
    try {
      writeFileSync(path, contents, "utf8");
      let publicationAttempts = 0;
      const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {
        beforePublishLock: () => { publicationAttempts++; }
      }, true));

      assert.equal(lease.acquired, false, label);
      assert.equal(lease.reason, "dead-undecidable", label);
      assert.equal(publicationAttempts, 0, `${label}: readFirst skips tmp/fsync/link`);
      assert.equal(links, 0, `${label}: readFirst skips link`);
      assert.equal(fsyncs, 0, `${label}: readFirst skips fsync`);
      assert.equal(readFileSync(path, "utf8"), contents, `${label}: the existing LOCK remains untouched`);
      onlyLockFile(prefix);
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  }
});

test("T-readFirst-ne-décide-pas: an absent LOCK publishes normally", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-absent-"));
  try {
    let publicationAttempts = 0;
    const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {
      beforePublishLock: () => { publicationAttempts++; }
    }, true));

    assert.equal(lease.acquired, true);
    assert.equal(publicationAttempts, 1, "an absent LOCK still reaches tmp/fsync/link");
    assert.equal(links, 1, "an absent LOCK reaches link once");
    assert.equal(fsyncs, 1, "an absent LOCK reaches fsync once");
    onlyLockFile(prefix);
    lease.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: the default retains the pre-readFirst publication path", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-default-"));
  const path = lockPathFor(prefix);
  try {
    writeFileSync(path, JSON.stringify(lockRecord({ pid: process.pid, token: "d".repeat(20) })), "utf8");
    let publicationAttempts = 0;

    const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {
      beforePublishLock: () => { publicationAttempts++; }
    }));

    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy");
    assert.equal(publicationAttempts, 1, "without readFirst the existing tmp/fsync/link attempt remains unchanged");
    assert.equal(links, 1, "without readFirst the existing link attempt remains unchanged");
    assert.equal(fsyncs, 1, "without readFirst the existing fsync remains unchanged");
    onlyLockFile(prefix);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: no second argument preserves the default live-holder publication", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-no-options-"));
  try {
    const holder = acquirePrefixLock(prefix);
    assert.equal(holder.acquired, true);
    const { result: lease, links, fsyncs } = countLockIo(() => acquirePrefixLock(prefix));

    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy");
    assert.equal(links, 1, "the default still attempts one LOCK link before observing the live holder");
    assert.equal(fsyncs, 1, "the default still fsyncs one temporary LOCK record");
    holder.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-structurel: production entries ignore every hook shape and a foreign self", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-production-options-"));
  const local = me();
  const foreignSelf = { ...local, host: `${local.host}-foreign` };
  const hookNames = ["afterReadFirst", "beforePublishLock", "afterPublishSucc", "beforeRetireUnlink", "afterRetireUnlink"];
  try {
    for (const [entryLabel, entry] of [
      ["direct production entry", acquirePrefixLock],
      ["UpgradeRuntime", defaultUpgradeRuntime.acquirePrefixLock]
    ]) {
      for (const shape of ["flat", "nested hooks", "foreign self"]) {
        const hookCalls = [];
        const hooks = Object.fromEntries(hookNames.map((name) => [name, () => { hookCalls.push(name); }]));
        const options = shape === "flat"
          ? { readFirst: true, ...hooks }
          : shape === "nested hooks"
            ? { readFirst: true, hooks }
            : { readFirst: true, self: () => foreignSelf, hooks };
        writeFileSync(lockPathFor(prefix), JSON.stringify({ ...local, pid: 999_999_999, token: "f".repeat(20), at: 0 }), "utf8");

        const lease = entry(prefix, options);

        assert.equal(lease.acquired, true, `${entryLabel}/${shape}: a foreign self must be ignored`);
        assert.deepEqual(hookCalls, [], `${entryLabel}/${shape}: production options cannot activate any test hook`);
        lease.release();
      }
    }
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-structurel: production entries ignore a third dependency argument", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-production-deps-"));
  const local = me();
  const foreignSelf = { ...local, host: `${local.host}-foreign` };
  let hookCalls = 0;
  const hooks = { beforePublishLock: () => { hookCalls++; } };
  const deps = { self: () => foreignSelf, hooks };
  const entries = [
    ["direct", acquirePrefixLock],
    ["UpgradeRuntime", defaultUpgradeRuntime.acquirePrefixLock]
  ];
  try {
    for (const [label, entry] of entries) {
      for (const [callLabel, call] of [
        ["direct", () => entry(prefix, { readFirst: true }, deps)],
        ["call", () => entry.call(undefined, prefix, { readFirst: true }, deps)],
        ["spread", () => entry(...[prefix, { readFirst: true }, deps])]
      ]) {
        writeFileSync(lockPathFor(prefix), JSON.stringify({ ...local, pid: 999_999_999, token: "g".repeat(20), at: 0 }), "utf8");
        hookCalls = 0;
        const lease = call();
        assert.equal(lease.acquired, true, `${label}/${callLabel}: third arguments cannot inject dependencies`);
        assert.equal(hookCalls, 0, `${label}/${callLabel}: third arguments cannot activate hooks`);
        lease.release();
      }
    }
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-proxy: preserves JavaScript legacy values and the explicit readFirst flag", () => {
  for (const value of ["x", 1]) {
    const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-proxy-primitive-"));
    try {
      const lease = defaultUpgradeRuntime.acquirePrefixLock(prefix, value);
      assert.equal(lease.acquired, true, `legacy JavaScript value ${JSON.stringify(value)} retains 0.97.9 behaviour`);
      lease.release();
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  }

  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-proxy-live-"));
  try {
    const holder = acquirePrefixLock(prefix);
    assert.equal(holder.acquired, true);
    const { result: lease, links, fsyncs } = countLockIo(() =>
      defaultUpgradeRuntime.acquirePrefixLock(prefix, { readFirst: true })
    );
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy");
    assert.equal(links, 0, "the proxy must preserve readFirst for a live holder");
    assert.equal(fsyncs, 0, "the proxy must preserve readFirst before temporary publication");
    holder.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-test-seam: a dead holder reaches all deterministic hook points", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-test-seam-"));
  const local = me();
  const calls = [];
  try {
    writeFileSync(lockPathFor(prefix), JSON.stringify({ ...local, pid: 999_999_999, token: "e".repeat(20), at: 0 }), "utf8");
    const lease = __test.acquirePrefixLock(prefix, { readFirst: true }, {
      hooks: Object.fromEntries([
        "afterReadFirst",
        "beforePublishLock",
        "afterPublishSucc",
        "beforeRetireUnlink",
        "afterRetireUnlink"
      ].map((name) => [name, () => { calls.push(name); }]))
    });

    assert.equal(lease.acquired, true);
    assert.deepEqual(calls, ["afterReadFirst", "beforePublishLock", "afterPublishSucc", "beforeRetireUnlink", "afterRetireUnlink"]);
    lease.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: an absent preliminary read rechecks a live LOCK after EEXIST", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-absent-live-"));
  const path = lockPathFor(prefix);
  const liveRaw = JSON.stringify(lockRecord({ pid: process.pid, token: "e".repeat(20) }));
  try {
    let preliminaryPresentReads = 0;
    let successorPublications = 0;
    const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {
      afterReadFirst: () => { preliminaryPresentReads++; },
      beforePublishLock: () => { writeFileSync(path, liveRaw, "utf8"); },
      afterPublishSucc: () => { successorPublications++; }
    }, true));

    assert.equal(preliminaryPresentReads, 0, "the preliminary read observed absence");
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy", "the fresh EEXIST read classifies the new live holder");
    assert.equal(links, 1, "only the ordinary round-zero LOCK link is attempted");
    assert.equal(fsyncs, 1, "only the ordinary round-zero LOCK fsync is attempted");
    assert.equal(successorPublications, 0, "no succession is published for the new live holder");
    assert.equal(readFileSync(path, "utf8"), liveRaw, "the live LOCK remains held");
    onlyLockFile(prefix);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: a retry reaches round one before suppressing a second publication", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-retry-"));
  const path = lockPathFor(prefix);
  const liveRaw = JSON.stringify(lockRecord({ pid: process.pid, token: "f".repeat(20) }));
  try {
    const readFirstRounds = [];
    let forcedRetry = false;
    const { result: lease, links, fsyncs } = countLockIo(
      () => acquire(prefix, {
        afterReadFirst: ({ round }) => { readFirstRounds.push(round); }
      }, true),
      (originalLink, from, to) => {
        if (!forcedRetry && to === path) {
          forcedRetry = true;
          writeFileSync(path, liveRaw, "utf8");
          const error = new Error("forced retry");
          error.code = "ENOENT";
          throw error;
        }
        return originalLink(from, to);
      }
    );

    assert.equal(forcedRetry, true, "the round-zero link was forced to retry");
    assert.deepEqual(readFirstRounds, [1], "readFirst re-runs for the live LOCK in round one");
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy");
    assert.equal(links, 1, "round-one readFirst suppresses a second LOCK link");
    assert.equal(fsyncs, 1, "round-one readFirst suppresses a second LOCK fsync");
    assert.equal(readFileSync(path, "utf8"), liveRaw);
    onlyLockFile(prefix);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: a round-one preliminary death cannot elect against a replacement", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-round-one-"));
  const path = lockPathFor(prefix);
  const tokenA = "a".repeat(20);
  const tokenC = "c".repeat(20);
  const tokenD = "d".repeat(20);
  try {
    writeFileSync(path, JSON.stringify(lockRecord({ token: tokenA })), "utf8");
    const readFirstRounds = [];
    const successorTargets = [];
    let successorTargetMatchedCurrentLock = true;
    const { result: lease } = countLockIo(() => acquire(prefix, {
      afterReadFirst: ({ round }) => {
        readFirstRounds.push(round);
        if (round === 1) {
          writeFileSync(path, JSON.stringify(lockRecord({ pid: process.pid, token: tokenD })), "utf8");
        }
      },
      afterPublishSucc: ({ round, target }) => {
        successorTargets.push(target);
        const current = readLockRecord(path);
        if (current === "absent" || current === "corrupt" || current.token !== target) {
          successorTargetMatchedCurrentLock = false;
        }
        if (round === 0) {
          writeFileSync(path, JSON.stringify(lockRecord({ token: tokenC })), "utf8");
        }
      }
    }, true));

    assert.equal(successorTargetMatchedCurrentLock, true, "every SUCC target matches the current LOCK token");
    assert.deepEqual(readFirstRounds, [0, 1], "readFirst observes both rounds");
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "busy");
    assert.deepEqual(successorTargets, [tokenA], "only the original dead holder receives a SUCC publication");
    assert.equal(readLockRecord(path).token, tokenD, "the round-one live replacement remains held");
    onlyLockFile(prefix);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: a read-only EMFILE falls through to ordinary acquisition", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-emfile-"));
  const path = lockPathFor(prefix);
  try {
    const { result: injected, links, fsyncs } = countLockIo(() =>
      withReadFileFailure(path, "EMFILE", () => acquire(prefix, {}, true))
    );

    assert.equal(injected.reads, 1, "only the advisory read is injected to fail");
    assert.equal(injected.result.acquired, true, "a read-only EMFILE must not decide acquisition");
    assert.equal(links, 1, "ordinary publication still links one LOCK");
    assert.equal(fsyncs, 1, "ordinary publication still fsyncs one temporary LOCK");
    injected.result.release();
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("T-readFirst-ne-décide-pas: unreadable and directory LOCKs remain corrupt and fail closed", () => {
  for (const [label, prepare, restore] of [
    [
      "mode 000",
      (path) => {
        writeFileSync(path, JSON.stringify(lockRecord()), "utf8");
        chmodSync(path, 0o000);
      },
      (path) => chmodSync(path, 0o600)
    ],
    ["directory", (path) => mkdirSync(path), () => {}]
  ]) {
    const prefix = mkdtempSync(join(tmpdir(), `h2a-read-first-unreadable-${label.replace(" ", "-")}-`));
    const path = lockPathFor(prefix);
    try {
      prepare(path);
      assert.equal(readLockHolder(path), "corrupt", `${label}: holder reader fails closed`);
      assert.equal(readLockRecord(path), "corrupt", `${label}: v4 reader fails closed`);

      const ordinary = countLockIo(() => acquire(prefix));
      assert.equal(ordinary.result.reason, "dead-undecidable", `${label}: ordinary acquisition fails closed`);
      assert.deepEqual({ links: ordinary.links, fsyncs: ordinary.fsyncs }, { links: 1, fsyncs: 1 }, `${label}: ordinary publication remains unchanged`);

      const readFirst = countLockIo(() => acquire(prefix, {}, true));
      assert.equal(readFirst.result.reason, "dead-undecidable", `${label}: readFirst must fall through and fail closed`);
      assert.deepEqual({ links: readFirst.links, fsyncs: readFirst.fsyncs }, { links: 1, fsyncs: 1 }, `${label}: readFirst matches ordinary publication`);
    } finally {
      restore(path);
      rmSync(prefix, { recursive: true, force: true });
    }
  }
});

test("T-readFirst-ne-décide-pas: a non-traversable prefix preserves its read errno", () => {
  const prefix = mkdtempSync(join(tmpdir(), "h2a-read-first-eacces-"));
  try {
    chmodSync(prefix, 0o600);
    const { result: lease, links, fsyncs } = countLockIo(() => acquire(prefix, {}, true));

    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "error:EACCES");
    assert.equal(links, 0, "a failed read must not reach link");
    assert.equal(fsyncs, 0, "a failed read must not reach fsync");
  } finally {
    chmodSync(prefix, 0o700);
    rmSync(prefix, { recursive: true, force: true });
  }
});
