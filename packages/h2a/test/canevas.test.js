import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aggregatePendingDecisions,
  escalateToPendingDecision
} from "../dist/runtime/canevas/aggregate.js";

const ROOT = process.cwd();
const BIN = join(ROOT, "packages/h2a/dist/bin.js");

function esc(id, channel, payload, instance, createdAt) {
  return {
    id, type: "escalate",
    actor: { instance },
    body: { kind: "escalation", channel, payload },
    createdAt
  };
}

test("escalateToPendingDecision mappe une escalation en décision", () => {
  const d = escalateToPendingDecision({
    env: esc("e1", "decide", "Approve merge?", "claude:x:1", "2026-07-03T10:00:00.000Z")
  });
  assert.equal(d.id, "e1");
  assert.equal(d.source, "escalate");
  assert.equal(d.channel, "decide");
  assert.equal(d.instance, "claude:x:1");
  assert.equal(d.question, "Approve merge?");
  assert.equal(d.createdAt, "2026-07-03T10:00:00.000Z");
});

test("une enveloppe non-escalate → null", () => {
  assert.equal(escalateToPendingDecision({ env: { id: "p1", type: "propose" } }), null);
});

test("sans actor.instance mais avec session.instance → utilise la session", () => {
  const d = escalateToPendingDecision({
    env: { id: "e2", type: "escalate", body: { channel: "alert", payload: "x" }, createdAt: "t" },
    session: { instance: "codex:y:2", launchContext: { tmux: { session: "remote-y", pane: "%3" } } }
  });
  assert.equal(d.instance, "codex:y:2");
  assert.deepEqual(d.sessionRef, { tmuxName: "remote-y", pane: "%3" });
});

test("aggregate: dédup par id + tri (alert > decide > advise, puis createdAt asc)", () => {
  const entries = [
    { env: esc("d1", "decide", "q1", "a", "2026-07-03T10:00:00.000Z") },
    { env: esc("a1", "alert", "q2", "b", "2026-07-03T10:05:00.000Z") },
    { env: esc("v1", "advise", "q3", "c", "2026-07-03T09:00:00.000Z") },
    { env: esc("d1", "decide", "dup", "a", "2026-07-03T10:00:00.000Z") } // doublon id
  ];
  const out = aggregatePendingDecisions(entries);
  assert.equal(out.length, 3, "dédup par id");
  assert.deepEqual(out.map((d) => d.id), ["a1", "d1", "v1"]); // alert, decide, advise
});

test("h2a canevas list --json : enveloppe stable (root vide → aucune décision)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-canevas-"));
  try {
    const res = spawnSync(process.execPath, [BIN, "canevas", "list", "--json", "--root", dir], { encoding: "utf8" });
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.kind, "canevas-decisions");
    assert.equal(out.version, 1);
    assert.deepEqual(out.decisions, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
