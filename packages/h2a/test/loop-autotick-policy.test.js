import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createObjectiveLoop,
  stopObjectiveLoop,
  listAutoTickLoops,
  isLoopAutoTickEligible,
  isLoopTerminal,
  autoTickGloballyDisabled,
  H2A_DEFAULT_LOOP_POLICY
} from "../dist/index.js";

// L1 Lot 1a — per-loop auto-tick opt-in + global kill-switch + eligibility.

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-autotick-"));
  return { dir, root: join(dir, ".h2a") };
}

// Locate every persisted loop state.json under a scratch dir, regardless of the
// store's internal layout — so tests can mutate the RAW on-disk shape (a legacy
// loop missing a key, a corrupt status) that the module-level helpers never
// produce but must tolerate.
function findStateFiles(base) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(base, e.name);
    if (e.isDirectory()) out.push(...findStateFiles(p));
    else if (e.name === "state.json") out.push(p);
  }
  return out;
}

// Patch the on-disk state.json of the loop with the given id via `mutate`.
function patchLoopOnDisk(dir, id, mutate) {
  for (const file of findStateFiles(dir)) {
    const obj = JSON.parse(readFileSync(file, "utf8"));
    if (obj.id === id) {
      mutate(obj);
      writeFileSync(file, JSON.stringify(obj));
      return;
    }
  }
  throw new Error(`state.json for loop ${id} not found under ${dir}`);
}

test("default policy is NOT auto-tick (opt-in, never resurrect all loops)", () => {
  assert.equal(H2A_DEFAULT_LOOP_POLICY.autoTick, false);
});

test("a loop is eligible only when it explicitly opts in", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "loop-off", goal: "g", policy: {} });
    createObjectiveLoop(root, { id: "loop-on", goal: "g", policy: { autoTick: true } });
    const eligible = listAutoTickLoops(root, {}).map((l) => l.id);
    assert.deepEqual(eligible, ["loop-on"], "only the opted-in loop is eligible");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a terminal loop is never eligible even if opted in", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "loop-t", goal: "g", policy: { autoTick: true } });
    let eligible = listAutoTickLoops(root, {}).map((l) => l.id);
    assert.deepEqual(eligible, ["loop-t"]);
    stopObjectiveLoop(root, "loop-t", { reason: "test" });
    eligible = listAutoTickLoops(root, {}).map((l) => l.id);
    assert.deepEqual(eligible, [], "stopped loop drops out of eligibility");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("global kill-switch H2A_LOOP_AUTOTICK_OFF disables everything", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "loop-on", goal: "g", policy: { autoTick: true } });
    assert.equal(autoTickGloballyDisabled({ H2A_LOOP_AUTOTICK_OFF: "1" }), true);
    assert.equal(autoTickGloballyDisabled({ H2A_LOOP_AUTOTICK_OFF: "0" }), false);
    assert.equal(autoTickGloballyDisabled({ H2A_LOOP_AUTOTICK_OFF: "false" }), false);
    assert.equal(autoTickGloballyDisabled({}), false);
    assert.deepEqual(
      listAutoTickLoops(root, { H2A_LOOP_AUTOTICK_OFF: "1" }),
      [],
      "kill-switch empties the eligible set regardless of opt-in"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isLoopAutoTickEligible / isLoopTerminal compose correctly", () => {
  const nonTerminalOptedIn = { status: "running", policy: { autoTick: true } };
  const nonTerminalOff = { status: "running", policy: { autoTick: false } };
  const terminalOptedIn = { status: "done", policy: { autoTick: true } };
  assert.equal(isLoopAutoTickEligible(nonTerminalOptedIn, {}), true);
  assert.equal(isLoopAutoTickEligible(nonTerminalOff, {}), false);
  assert.equal(isLoopAutoTickEligible(terminalOptedIn, {}), false);
  assert.equal(isLoopAutoTickEligible(nonTerminalOptedIn, { H2A_LOOP_AUTOTICK_OFF: "yes" }), false);
  assert.equal(isLoopTerminal({ status: "stopped" }), true);
  assert.equal(isLoopTerminal({ status: "running" }), false);
});

test("loops persisted WITHOUT autoTick (legacy) read as not-opted-in", () => {
  const { dir, root } = freshRoot();
  try {
    // A loop created with an empty policy has autoTick defaulted to false, which
    // is the same observable state as a pre-field legacy loop: not eligible.
    createObjectiveLoop(root, { id: "legacy", goal: "g", policy: {} });
    assert.deepEqual(listAutoTickLoops(root, {}), [], "legacy/default loop is not auto-ticked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Regressions from the double-opus review of this PR ---

test("a `blocked` loop is NEVER auto-tick eligible (§7.3 parity with tick engine)", () => {
  const { dir, root } = freshRoot();
  try {
    // blocked is terminal-for-automatic-wake everywhere in the engine; the
    // eligibility gate must agree, or an unattended supervisor would tick a
    // human-gated loop.
    assert.equal(isLoopTerminal({ status: "blocked" }), true, "blocked is terminal");
    assert.equal(
      isLoopAutoTickEligible({ status: "blocked", policy: { autoTick: true } }, {}),
      false,
      "blocked opted-in loop is not eligible"
    );
    createObjectiveLoop(root, { id: "l-blocked", goal: "g", policy: { autoTick: true } });
    patchLoopOnDisk(dir, "l-blocked", (o) => { o.status = "blocked"; });
    assert.deepEqual(
      listAutoTickLoops(root, {}).map((l) => l.id),
      [],
      "a blocked opted-in loop drops out of the eligible set"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an UNKNOWN/corrupt status is fail-closed (allow-list, not deny-list)", () => {
  const { dir, root } = freshRoot();
  try {
    // Eligibility is membership in the LIVE allow-list, so a status nobody
    // enumerated (future value, corrupt write) is excluded by default.
    assert.equal(
      isLoopAutoTickEligible({ status: "totally-bogus", policy: { autoTick: true } }, {}),
      false,
      "unknown status is not eligible"
    );
    createObjectiveLoop(root, { id: "l-bogus", goal: "g", policy: { autoTick: true } });
    patchLoopOnDisk(dir, "l-bogus", (o) => { o.status = "totally-bogus"; });
    assert.deepEqual(
      listAutoTickLoops(root, {}).map((l) => l.id),
      [],
      "a bogus-status opted-in loop is excluded"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a state.json with the autoTick KEY PHYSICALLY ABSENT reads as not-opted-in", () => {
  const { dir, root } = freshRoot();
  try {
    // The truest legacy shape: opted-in on disk then the key removed entirely,
    // so policy.autoTick is `undefined` (not an explicit false). Strict === true
    // must still exclude it.
    createObjectiveLoop(root, { id: "l-nokey", goal: "g", policy: { autoTick: true } });
    patchLoopOnDisk(dir, "l-nokey", (o) => { delete o.policy.autoTick; });
    assert.deepEqual(
      listAutoTickLoops(root, {}).map((l) => l.id),
      [],
      "missing autoTick key is not eligible"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a state.json with NO policy object does not crash discovery (optional-chaining guard)", () => {
  const { dir, root } = freshRoot();
  try {
    // A partially-written loop with no `policy` at all must be excluded, NOT
    // throw a TypeError that would hide every other healthy loop.
    createObjectiveLoop(root, { id: "l-nopolicy", goal: "g", policy: { autoTick: true } });
    createObjectiveLoop(root, { id: "l-healthy", goal: "g", policy: { autoTick: true } });
    patchLoopOnDisk(dir, "l-nopolicy", (o) => { delete o.policy; });
    let eligible;
    assert.doesNotThrow(() => { eligible = listAutoTickLoops(root, {}).map((l) => l.id); });
    assert.deepEqual(
      eligible,
      ["l-healthy"],
      "a policy-less loop is skipped while the healthy opted-in loop is still found"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
