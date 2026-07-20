import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
