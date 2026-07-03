import test from "node:test";
import assert from "node:assert/strict";

// Pure launch-request targeting (ASK, bounded by maxRelaunches + cooldown).
import { planLaunchTarget, priorLaunchByAgent } from "../dist/runtime/loop/engine/adapters.js";

const NOW = 10_000_000;
const AGENT = { id: "a1", host: "codex", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" };
function loopWith(over = {}) {
  return { id: "loop-x", goal: "g", agents: [AGENT], policy: { maxRelaunches: 3, tickMs: 60_000 }, ...over };
}

test("agent inconnu → skip unknown-agent", () => {
  const p = planLaunchTarget({ loop: loopWith(), agentId: "zzz", priorCount: 0, now: NOW });
  assert.deepEqual(p, { kind: "skip", reason: "unknown-agent" });
});

test("priorCount >= maxRelaunches → skip max-relaunches", () => {
  const p = planLaunchTarget({ loop: loopWith(), agentId: "a1", priorCount: 3, now: NOW });
  assert.deepEqual(p, { kind: "skip", reason: "max-relaunches" });
});

test("lancement récent → skip cooldown", () => {
  const p = planLaunchTarget({ loop: loopWith(), agentId: "a1", priorCount: 1, priorLatestAt: NOW - 1000, now: NOW });
  assert.deepEqual(p, { kind: "skip", reason: "cooldown" });
});

test("aucun prior → emit avec host", () => {
  const p = planLaunchTarget({ loop: loopWith(), agentId: "a1", priorCount: 0, now: NOW });
  assert.equal(p.kind, "emit");
  assert.equal(p.host, "codex");
});

test("prior ancien (hors cooldown, count < max) → emit", () => {
  const p = planLaunchTarget({ loop: loopWith(), agentId: "a1", priorCount: 1, priorLatestAt: NOW - 400_000, now: NOW });
  assert.equal(p.kind, "emit");
});

test("priorLaunchByAgent: compte + dernier ts par agent, ignore le reste", () => {
  const m = priorLaunchByAgent([
    { type: "loop.action.applied", at: "2026-07-03T10:00:00.000Z", payload: { action: "request-launch", key: "request-launch:a1" } },
    { type: "loop.action.applied", at: "2026-07-03T10:05:00.000Z", payload: { action: "request-launch", key: "request-launch:a1" } },
    { type: "loop.action.applied", at: "2026-07-03T10:02:00.000Z", payload: { action: "wake", key: "wake:a1" } }
  ]);
  const a1 = m.get("a1");
  assert.equal(a1.count, 2);
  assert.equal(a1.latestAt, Date.parse("2026-07-03T10:05:00.000Z"));
});
