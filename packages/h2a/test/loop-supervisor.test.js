import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createObjectiveLoop,
  stopObjectiveLoop,
  runSupervisorBeat,
  runLoopSupervisor,
  loopAttendance,
  readExecutorHeartbeat,
  stampExecutorHeartbeat,
  loopExecutorHeartbeatPath,
  acquireLoopExecutorLease,
  readObjectiveLoop
} from "../dist/index.js";

// L1 Lot 1b — durable loop supervisor: ticks opted-in loops under a per-loop
// single-writer lease, isolates failures, and exposes fail-closed attendance.

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-supervisor-"));
  return { dir, root: join(dir, ".h2a") };
}

// A runTick stub that records which loops it executed, so tests assert on real
// scheduling without driving the full engine.
function recordingTick(log) {
  return async (root, loopId, opts) => {
    log.push({ loopId, execute: opts?.execute === true });
    return { plan: { loopId, outcome: "ok", actions: [] } };
  };
}

test("supervisor ticks ONLY opted-in loops (opt-in respected)", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "off", goal: "g", policy: {} });
    createObjectiveLoop(root, { id: "on", goal: "g", policy: { autoTick: true } });
    const log = [];
    const summary = await runSupervisorBeat(root, { runTickFn: recordingTick(log), env: {} });
    assert.deepEqual(summary.ticked, ["on"], "only the opted-in loop is ticked");
    assert.deepEqual(log.map((e) => e.loopId), ["on"]);
    assert.equal(log[0].execute, true, "tick runs with execute:true");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a loop is executed ONLY under its lease (single-writer)", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "x", goal: "g", policy: { autoTick: true } });
    // A peer already holds x's executor lease → the supervisor must NOT tick it.
    const held = acquireLoopExecutorLease(root, "x");
    assert.ok(held, "peer acquired the lease");
    const log1 = [];
    const s1 = await runSupervisorBeat(root, { runTickFn: recordingTick(log1), env: {} });
    assert.deepEqual(s1.ticked, [], "held loop is not ticked");
    assert.deepEqual(s1.skippedLocked, ["x"], "held loop is reported skipped-locked");
    assert.equal(log1.length, 0, "runTick never called while lease is held");
    // Release → next beat executes it.
    held.release();
    const log2 = [];
    const s2 = await runSupervisorBeat(root, { runTickFn: recordingTick(log2), env: {} });
    assert.deepEqual(s2.ticked, ["x"], "after release the loop is ticked");
    assert.deepEqual(log2.map((e) => e.loopId), ["x"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("global kill-switch freezes the whole beat", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "on", goal: "g", policy: { autoTick: true } });
    const log = [];
    const summary = await runSupervisorBeat(root, {
      runTickFn: recordingTick(log),
      env: { H2A_LOOP_AUTOTICK_OFF: "1" }
    });
    assert.equal(summary.frozen, true, "beat reports frozen");
    assert.deepEqual(summary.ticked, [], "nothing ticked under kill-switch");
    assert.equal(log.length, 0, "runTick never called");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attendance is FAIL-CLOSED: unattended until a heartbeat, attended after, stale again", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "on", goal: "g", policy: { autoTick: true } });
    const loop = () => readObjectiveLoop(root, "on");
    // No heartbeat yet ⇒ unattended (absence of proof ⇒ unattended).
    assert.equal(loopAttendance(root, loop(), {}, 1_000_000), "unattended");
    // A supervised beat stamps a heartbeat at t=1_000_000.
    await runSupervisorBeat(root, { runTickFn: recordingTick([]), env: {}, now: () => 1_000_000 });
    assert.ok(readExecutorHeartbeat(root, "on"), "heartbeat written");
    assert.equal(loopAttendance(root, loop(), {}, 1_000_000), "attended", "fresh heartbeat ⇒ attended");
    // tickMs defaults to 60_000; K=3 ⇒ stale after 180_000ms.
    assert.equal(loopAttendance(root, loop(), {}, 1_000_000 + 180_001), "unattended", "stale ⇒ unattended");
    // A not-opted-in loop is not-applicable regardless of heartbeat.
    createObjectiveLoop(root, { id: "off", goal: "g", policy: {} });
    assert.equal(loopAttendance(root, readObjectiveLoop(root, "off"), {}, 1_000_000), "not-applicable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one loop throwing does NOT abort the beat (fail-closed isolation)", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "bad", goal: "g", policy: { autoTick: true } });
    createObjectiveLoop(root, { id: "good", goal: "g", policy: { autoTick: true } });
    const log = [];
    const tick = async (r, loopId, opts) => {
      if (loopId === "bad") throw new Error("boom");
      log.push(loopId);
      return { plan: { loopId } };
    };
    const summary = await runSupervisorBeat(root, { runTickFn: tick, env: {} });
    assert.deepEqual(summary.errored.map((e) => e.loopId), ["bad"], "bad loop captured in errored");
    assert.ok(summary.ticked.includes("good"), "good loop still ticked after bad threw");
    assert.deepEqual(log, ["good"]);
    // The thrown loop got NO heartbeat ⇒ it reads unattended (visible failure).
    assert.equal(readExecutorHeartbeat(root, "bad"), null, "no heartbeat for the failed loop");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the lease is released after each loop (a later beat / peer can re-acquire)", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "x", goal: "g", policy: { autoTick: true } });
    await runSupervisorBeat(root, { runTickFn: recordingTick([]), env: {} });
    // If the supervisor leaked the lease, this acquire would return null.
    const after = acquireLoopExecutorLease(root, "x");
    assert.ok(after, "lease is free after the beat (released in finally)");
    after.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runLoopSupervisor honors max beats and stops", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "on", goal: "g", policy: { autoTick: true } });
    let beats = 0;
    const n = await runLoopSupervisor(root, {
      runTickFn: recordingTick([]),
      env: {},
      max: 2,
      intervalMs: 1,
      onBeat: () => { beats += 1; }
    });
    assert.equal(n, 2, "ran exactly max beats");
    assert.equal(beats, 2, "onBeat fired per beat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Regressions from the double-opus review of this PR ---

test("an opted-in loop that reached a TERMINAL status reads not-applicable, not unattended", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "t", goal: "g", policy: { autoTick: true } });
    // It even has a fresh heartbeat — but once terminal it must not be alarmed.
    stampExecutorHeartbeat(root, "t", { holder: "h", fencingToken: 1, at: 1_000_000 });
    stopObjectiveLoop(root, "t", { reason: "done" });
    assert.equal(
      loopAttendance(root, readObjectiveLoop(root, "t"), {}, 1_000_000),
      "not-applicable",
      "a terminal opted-in loop is not falsely flagged unattended"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an implausibly FUTURE heartbeat is fail-closed (unattended), not attended-forever", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "on", goal: "g", policy: { autoTick: true } });
    // Heartbeat stamped far in the future (skewed/lying holder). tickMs default
    // 60_000; a beat more than one tick ahead of the reader's clock is untrusted.
    stampExecutorHeartbeat(root, "on", { holder: "h", fencingToken: 1, at: 5_000_000 });
    assert.equal(loopAttendance(root, readObjectiveLoop(root, "on"), {}, 1_000_000), "unattended");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed heartbeat timestamp is fail-closed (unattended)", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "on", goal: "g", policy: { autoTick: true } });
    writeFileSync(
      loopExecutorHeartbeatPath(root, "on"),
      JSON.stringify({ at: "not-a-date", holder: "h", fencingToken: 1 })
    );
    assert.equal(loopAttendance(root, readObjectiveLoop(root, "on"), {}, 1_000_000), "unattended");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tick that overruns its lease-safety timeout is aborted, fail-closed (no heartbeat)", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "slow", goal: "g", policy: { autoTick: true } });
    // A tick that only settles when its signal aborts — i.e. it would run past
    // the timeout. The supervisor must not wait for it, must mark it errored, and
    // must NOT stamp a heartbeat (so it reads unattended).
    const tick = (r, id, opts) =>
      new Promise((resolve) => {
        opts.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
      });
    const summary = await runSupervisorBeat(root, {
      runTickFn: tick,
      env: {},
      leaseMs: 1000,
      tickTimeoutMs: 20
    });
    assert.deepEqual(summary.ticked, [], "an overrun tick is not counted as ticked");
    assert.deepEqual(summary.errored.map((e) => e.loopId), ["slow"], "overrun captured as errored");
    assert.match(summary.errored[0].error, /timeout/, "error names the lease-safety timeout");
    assert.equal(readExecutorHeartbeat(root, "slow"), null, "no heartbeat for an overrun tick");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a shutdown signal drains the beat: no loop is ticked once aborted", async () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "a", goal: "g", policy: { autoTick: true } });
    createObjectiveLoop(root, { id: "b", goal: "g", policy: { autoTick: true } });
    const ac = new AbortController();
    ac.abort(); // already shutting down before the beat starts
    const log = [];
    const summary = await runSupervisorBeat(root, {
      runTickFn: recordingTick(log),
      env: {},
      signal: ac.signal
    });
    assert.deepEqual(summary.ticked, [], "an aborted beat ticks nothing");
    assert.equal(log.length, 0, "runTick never called under an aborted signal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
