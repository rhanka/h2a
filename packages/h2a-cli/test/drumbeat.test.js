import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  recordStop,
  listDrumbeat,
  clearDrumbeatEntry,
  readDrumbeatEntry,
  scanDrumbeat,
  drumbeatTick,
  runDrumbeatWatch,
  loggingRelauncher
} from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-drumbeat-"));
}

test("recordStop persists a durable entry readable by id and list (DEC-086)", () => {
  const root = freshRoot();
  try {
    recordStop(root, {
      instance: "codex:proj",
      workStatus: "out-of-tokens",
      launchContext: { cwd: "/p", command: "codex", resumeCommand: "codex resume" }
    });
    const e = readDrumbeatEntry(root, "codex:proj");
    assert.equal(e.instance, "codex:proj");
    assert.equal(e.workStatus, "out-of-tokens");
    assert.equal(e.relanceCount, 0);
    assert.equal(e.launchContext.resumeCommand, "codex resume");
    assert.equal(listDrumbeat(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanDrumbeat: done skipped, non-done = finding, over cap = exhausted", () => {
  const root = freshRoot();
  try {
    recordStop(root, { instance: "a", workStatus: "done" });
    recordStop(root, { instance: "b", workStatus: "paused" });
    recordStop(root, { instance: "c", workStatus: "out-of-tokens" });
    const { findings, exhausted } = scanDrumbeat(root, { maxRelances: 3 });
    const byInstance = Object.fromEntries(findings.map((f) => [f.instance, f]));
    assert.equal(findings.length, 2); // a (done) skipped
    assert.equal(byInstance.b.reason, "stopped");
    assert.equal(byInstance.c.reason, "out-of-tokens");
    assert.equal(exhausted.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("drumbeatTick relances candidates, increments count, escalates over cap", async () => {
  const root = freshRoot();
  try {
    recordStop(root, { instance: "b", workStatus: "paused" });
    const relanced = [];
    const relauncher = {
      relance(f) {
        relanced.push(f.instance);
        return true;
      }
    };
    // 3 ticks at maxRelances=2: relance, relance, then exhausted+escalate
    const escalated = [];
    const opts = { maxRelances: 2, onExhausted: (e) => escalated.push(e.instance) };

    let r = await drumbeatTick(root, relauncher, opts);
    assert.deepEqual(r.relanced, ["b"]);
    assert.equal(readDrumbeatEntry(root, "b").relanceCount, 1);

    r = await drumbeatTick(root, relauncher, opts);
    assert.deepEqual(r.relanced, ["b"]);
    assert.equal(readDrumbeatEntry(root, "b").relanceCount, 2);

    // now count (2) >= cap (2) -> exhausted, no further relance
    r = await drumbeatTick(root, relauncher, opts);
    assert.deepEqual(r.relanced, []);
    assert.deepEqual(r.exhausted, ["b"]);
    assert.deepEqual(escalated, ["b"]);
    assert.deepEqual(relanced, ["b", "b"]); // relanced exactly twice
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a relauncher that declines (false) does not increment the count", async () => {
  const root = freshRoot();
  try {
    recordStop(root, { instance: "b", workStatus: "paused" });
    const r = await drumbeatTick(root, { relance: () => false }, {});
    assert.deepEqual(r.relanced, []);
    assert.equal(readDrumbeatEntry(root, "b").relanceCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearDrumbeatEntry removes the entry (clean resume/finish)", () => {
  const root = freshRoot();
  try {
    recordStop(root, { instance: "b", workStatus: "paused" });
    clearDrumbeatEntry(root, "b");
    assert.equal(readDrumbeatEntry(root, "b"), undefined);
    assert.equal(listDrumbeat(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDrumbeatWatch loops until aborted, then stops", async () => {
  const root = freshRoot();
  try {
    recordStop(root, { instance: "b", workStatus: "paused" });
    const controller = new AbortController();
    let ticks = 0;
    const relauncher = loggingRelauncher(() => {});
    const promise = runDrumbeatWatch(root, relauncher, {
      intervalMs: 5,
      signal: controller.signal,
      onTick: () => {
        ticks += 1;
        if (ticks >= 2) controller.abort();
      }
    });
    await promise; // resolves once aborted
    assert.ok(ticks >= 2);
    // b was relanced at least once (count advanced)
    assert.ok(readDrumbeatEntry(root, "b").relanceCount >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
