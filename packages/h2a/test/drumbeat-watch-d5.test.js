import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  drumbeatTick,
  recordStop,
  markRelanced,
  readDrumbeatEntry,
  listDrumbeatDecisions
} from "../dist/index.js";

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-d5w-"));
  return { dir, root: join(dir, ".h2a") };
}
const relauncher = { relance: () => true };
const fixed = Date.parse("2026-05-30T00:00:00.000Z");

/** Seed a stopped entry already relanced `n` times. */
function seed(root, instance, workStatus, n) {
  recordStop(root, { instance, workStatus, launchContext: { command: "echo hi" } }, fixed);
  for (let i = 0; i < n; i++) markRelanced(root, instance, fixed);
}

test("below --decider-after the decider is never consulted", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 0); // relanceCount 0 < K(1)
    let called = false;
    const decider = { decide: () => { called = true; return { action: "escalate" }; } };
    const r = await drumbeatTick(root, relauncher, { decider, deciderAfter: 1, enforce: true, now: fixed });
    assert.equal(called, false);
    assert.deepEqual(r.relanced, ["a:1"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("advisory mode: decider consulted + logged, but safe default (relance) applied", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1); // >= K
    const decider = { decide: () => ({ action: "escalate", reason: "stuck" }) };
    const r = await drumbeatTick(root, relauncher, { decider, deciderAfter: 1, enforce: false, now: fixed });
    assert.deepEqual(r.relanced, ["a:1"]); // applied = relance
    const log = listDrumbeatDecisions(root);
    assert.equal(log[0].decided, "escalate");
    assert.equal(log[0].applied, "relance");
    assert.equal(log[0].enforced, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enforce + finish on an active stall escalates (guard: done-only) and marks terminal", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1);
    const escalated = [];
    const decider = { decide: () => ({ action: "finish", reason: "looks done" }) };
    await drumbeatTick(root, relauncher, {
      decider, deciderAfter: 1, enforce: true, now: fixed,
      onEscalate: (f, d) => void escalated.push([f.instance, d.reason])
    });
    assert.deepEqual(escalated, [["a:1", "looks done"]]); // decision.reason flows to the hook
    assert.equal(readDrumbeatEntry(root, "a:1").terminal.action, "escalate");
    const log = listDrumbeatDecisions(root)[0];
    assert.equal(log.decided, "finish");
    assert.equal(log.applied, "escalate");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enforce + escalate calls onEscalate and marks terminal", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1);
    const escalated = [];
    const decider = { decide: () => ({ action: "escalate", reason: "needs human" }) };
    await drumbeatTick(root, relauncher, {
      decider, deciderAfter: 1, enforce: true, now: fixed,
      onEscalate: (f) => void escalated.push(f.instance)
    });
    assert.deepEqual(escalated, ["a:1"]);
    assert.equal(readDrumbeatEntry(root, "a:1").terminal.action, "escalate");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("enforce + reroute calls onReroute and marks terminal", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "blocked", 1);
    const rerouted = [];
    const decider = { decide: () => ({ action: "reroute", reason: "give to peer" }) };
    await drumbeatTick(root, relauncher, {
      decider, deciderAfter: 1, enforce: true, now: fixed,
      onReroute: (f, d) => void rerouted.push([f.instance, d.reason])
    });
    assert.deepEqual(rerouted, [["a:1", "give to peer"]]);
    assert.equal(readDrumbeatEntry(root, "a:1").terminal.action, "reroute");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a terminal entry is not re-decided on the next tick", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1);
    const decider1 = { decide: () => ({ action: "escalate" }) };
    await drumbeatTick(root, relauncher, { decider: decider1, deciderAfter: 1, enforce: true, now: fixed, onEscalate: () => {} });
    let calledAgain = false;
    const decider2 = { decide: () => { calledAgain = true; return { action: "relance" }; } };
    const r = await drumbeatTick(root, relauncher, { decider: decider2, deciderAfter: 1, enforce: true, now: fixed, onEscalate: () => {} });
    assert.equal(calledAgain, false); // scan skips the terminal entry
    assert.deepEqual(r.relanced, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no decider → behaviour identical to today (relance, no decision log)", async () => {
  const { dir, root } = freshRoot();
  try {
    seed(root, "a:1", "out-of-tokens", 1);
    const r = await drumbeatTick(root, relauncher, { now: fixed });
    assert.deepEqual(r.relanced, ["a:1"]);
    assert.deepEqual(listDrumbeatDecisions(root), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
