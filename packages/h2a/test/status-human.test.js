// `h2a status --human` (L2b) — opt-in read-only projection that ALSO surfaces
// h2a sub-agents and objective loops with durable-supervisor attendance, without
// touching the frozen bare-status JSON contract.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli, renderStatusHuman, createObjectiveLoop } from "../dist/index.js";

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: (c) => void (stderr += c) },
    cwd: () => cwd ?? process.cwd(),
    get stdoutText() {
      return stdout;
    },
    get stderrText() {
      return stderr;
    }
  };
}

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-status-human-"));
  return { dir, root: join(dir, ".h2a") };
}

// --- Pure renderer: deterministic, total, robust to empty/partial data ---

test("renderStatusHuman renders all sections and shows (none) when empty", () => {
  const out = renderStatusHuman({ root: "/r", direct: [], indirect: [], subagents: [], loops: [] });
  assert.match(out, /h2a status — \/r/);
  assert.match(out, /Sessions: 0 \(0 direct, 0 mirrored\)/);
  assert.match(out, /Sub-agents: 0/);
  assert.match(out, /Objective loops: 0/);
  assert.equal((out.match(/\(none\)/g) || []).length, 3, "each empty section prints (none)");
});

test("renderStatusHuman tolerates sessions missing name/workStatus without crashing", () => {
  const out = renderStatusHuman({
    root: "/r",
    direct: [{ instance: "claude:x:1" }],
    indirect: [{ instance: "codex:y:2", name: "peer", workStatus: "working" }],
    subagents: [],
    loops: []
  });
  assert.match(out, /claude:x:1 — —/, "missing workStatus renders a placeholder, no crash");
  assert.match(out, /codex:y:2 "peer" — working/);
  assert.match(out, /Sessions: 2 \(1 direct, 1 mirrored\)/);
});

test("renderStatusHuman flags unattended opted-in loops and revoked sub-agents", () => {
  const out = renderStatusHuman({
    root: "/r",
    direct: [],
    indirect: [],
    subagents: [
      { id: "claude:a:1~researcher", parentInstance: "claude:a:1", status: "active" },
      { id: "claude:a:1~stale", parentInstance: "claude:a:1", status: "revoked" }
    ],
    loops: [
      { id: "l1", name: "live", status: "running", autoTick: true, attendance: "attended" },
      { id: "l2", name: "orphan", status: "running", autoTick: true, attendance: "unattended" },
      { id: "l3", name: "manual", status: "running", autoTick: false, attendance: "not-applicable" }
    ]
  });
  assert.match(out, /Objective loops: 3 — 1 unattended/, "unattended count surfaced in the header");
  assert.match(out, /⚠ l2 "orphan" — running · auto-tick on · unattended/);
  assert.match(out, /· l3 "manual" — running · auto-tick off · not-applicable/);
  assert.match(out, /✗ claude:a:1~stale .* — revoked/);
});

// --- CLI: the frozen contract is untouched; --human is additive ---

test("bare `h2a status` keeps its exact frozen JSON contract", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "hidden", goal: "g", policy: { autoTick: true } });
    const streams = captureStreams();
    const rc = runCli(["status", "--root", root], streams);
    assert.equal(rc, 0, streams.stderrText);
    const parsed = JSON.parse(streams.stdoutText);
    // Exact frozen shape — no loops/subagents leak into the JSON contract.
    assert.deepEqual(Object.keys(parsed).sort(), ["counts", "direct", "indirect", "ok", "root"]);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.counts, { direct: 0, indirect: 0, total: 0 });
    assert.equal("loops" in parsed, false, "loops must NOT appear in the bare JSON");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`h2a status --human` lists objective loops with their attendance", () => {
  const { dir, root } = freshRoot();
  try {
    createObjectiveLoop(root, { id: "opted", name: "supervised", goal: "g", policy: { autoTick: true } });
    createObjectiveLoop(root, { id: "manual", name: "hands-off", goal: "g", policy: {} });
    const streams = captureStreams();
    const rc = runCli(["status", "--human", "--root", root], streams);
    assert.equal(rc, 0, streams.stderrText);
    const out = streams.stdoutText;
    // Not JSON.
    assert.throws(() => JSON.parse(out));
    assert.match(out, /Objective loops: 2/);
    // Opted-in but no supervisor has ticked it ⇒ fail-closed unattended.
    assert.match(out, /opted "supervised" — created · auto-tick on · unattended/);
    // Not opted-in ⇒ not-applicable (never falsely alarmed).
    assert.match(out, /manual "hands-off" — created · auto-tick off · not-applicable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
