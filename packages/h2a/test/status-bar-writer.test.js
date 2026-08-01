import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  STATUS_BAR_WRITER_LOCK_FILE,
  acquireStatusBarWriterLease,
  releaseStatusBarWriterLease,
} from "../dist/status-bar-writer.js";

// The status-bar writer is the ONLY process allowed to compute bar content.
// If two writers could run, every h2a launch would add one more background
// node process and the spawn storm would return in slow motion. The lease
// below is what makes the writer single-instance per h2a root.

function withDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-bar-writer-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const alive = () => true;
const dead = () => false;

test("acquires the lease in an empty directory and records its pid", () => {
  withDir((dir) => {
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 1111, isAlive: alive }),
      true,
    );
    const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
    assert.ok(existsSync(lockPath));
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 1111);
  });
});

test("refuses a second writer while the holder is alive and fresh", () => {
  withDir((dir) => {
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 1111, isAlive: alive }),
      true,
    );
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 2222, isAlive: alive }),
      false,
    );
    const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 1111);
  });
});

test("reclaims the lease from a dead holder", () => {
  withDir((dir) => {
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 1111, isAlive: alive }),
      true,
    );
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 2222, isAlive: dead }),
      true,
    );
    const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 2222);
  });
});

test("reclaims the lease from a live-looking but expired holder (pid reuse)", () => {
  withDir((dir) => {
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 1111, isAlive: alive }),
      true,
    );
    const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lockPath, stale, stale);
    assert.equal(
      acquireStatusBarWriterLease(dir, {
        pid: 2222,
        isAlive: alive,
        staleMs: 60_000,
      }),
      true,
    );
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 2222);
  });
});

test("release removes an owned lock and leaves a foreign one", () => {
  withDir((dir) => {
    assert.equal(
      acquireStatusBarWriterLease(dir, { pid: 1111, isAlive: alive }),
      true,
    );
    const lockPath = join(dir, STATUS_BAR_WRITER_LOCK_FILE);
    releaseStatusBarWriterLease(dir, 2222);
    assert.ok(existsSync(lockPath), "a foreign pid must not release the lease");
    releaseStatusBarWriterLease(dir, 1111);
    assert.ok(!existsSync(lockPath), "the owner releases its own lease");
  });
});
