import test from "node:test";
import assert from "node:assert/strict";

// Pure wake targeting (freshness + cooldown gates). No tmux.
import { planWakeTarget, priorWakeAtByAgent } from "../dist/runtime/loop/engine/adapters.js";

const NOW = 10_000_000;

function loopWith(agents) {
  return { id: "loop-x", goal: "do it", agents, policy: { tickMs: 60_000 } };
}
const AGENT = { id: "a1", host: "codex", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" };
const FRESH = [{ instance: "inst-1", launchContext: { tmux: { session: "s", pane: "%1" } } }];
const NONE = new Map();

test("agent sans h2aInstance → skip no-h2a-instance", () => {
  const p = planWakeTarget({
    loop: loopWith([{ id: "a1", role: "impl", placement: "local", status: "running" }]),
    agentId: "a1", freshSessions: FRESH, priorWakeAtByAgent: NONE, now: NOW
  });
  assert.deepEqual(p, { kind: "skip", reason: "no-h2a-instance" });
});

test("aucune session fraîche pour l'instance → skip no-fresh-tmux-session", () => {
  const p = planWakeTarget({
    loop: loopWith([AGENT]), agentId: "a1",
    freshSessions: [{ instance: "autre", launchContext: { tmux: { pane: "%9" } } }],
    priorWakeAtByAgent: NONE, now: NOW
  });
  assert.equal(p.kind, "skip");
  assert.equal(p.reason, "no-fresh-tmux-session");
});

test("session fraîche sans launchContext.tmux → skip no-fresh-tmux-session", () => {
  const p = planWakeTarget({
    loop: loopWith([AGENT]), agentId: "a1",
    freshSessions: [{ instance: "inst-1" }],
    priorWakeAtByAgent: NONE, now: NOW
  });
  assert.equal(p.reason, "no-fresh-tmux-session");
});

test("cooldown récent → skip cooldown", () => {
  const p = planWakeTarget({
    loop: loopWith([AGENT]), agentId: "a1", freshSessions: FRESH,
    priorWakeAtByAgent: new Map([["a1", NOW - 1000]]), now: NOW
  });
  assert.deepEqual(p, { kind: "skip", reason: "cooldown" });
});

test("agent + session fraîche tmux + hors cooldown → wake avec launchContext + ligne taggée", () => {
  const p = planWakeTarget({
    loop: loopWith([AGENT]), agentId: "a1", freshSessions: FRESH,
    priorWakeAtByAgent: new Map([["a1", NOW - 400_000]]), now: NOW
  });
  assert.equal(p.kind, "wake");
  assert.equal(p.instance, "inst-1");
  assert.equal(p.host, "codex");
  assert.ok(p.launchContext.tmux);
  assert.match(p.instructionLine, /\[h2a-wake reason=loop loopId=loop-x /);
});

test("plusieurs sessions même instance → préfère celle qui a launchContext.tmux", () => {
  const p = planWakeTarget({
    loop: loopWith([AGENT]),
    agentId: "a1",
    freshSessions: [
      { instance: "inst-1", launchContext: { cwd: "/x", command: "claude" } },
      { instance: "inst-1", launchContext: { cwd: "/x", command: "claude", tmux: { session: "s", pane: "%2" } } }
    ],
    priorWakeAtByAgent: NONE,
    now: NOW
  });
  assert.equal(p.kind, "wake");
  assert.equal(p.launchContext.tmux.pane, "%2");
});

test("priorWakeAtByAgent: garde le dernier wake appliqué par agent, ignore le reste", () => {
  const m = priorWakeAtByAgent([
    { type: "loop.action.applied", at: "2026-07-03T10:00:00.000Z", payload: { action: "wake", key: "wake:a1" } },
    { type: "loop.action.applied", at: "2026-07-03T10:05:00.000Z", payload: { action: "wake", key: "wake:a1" } },
    { type: "loop.action.applied", at: "2026-07-03T10:02:00.000Z", payload: { action: "close", key: "close:loop" } },
    { type: "loop.tick", at: "2026-07-03T10:06:00.000Z" }
  ]);
  assert.equal(m.get("a1"), Date.parse("2026-07-03T10:05:00.000Z"));
  assert.equal(m.size, 1);
});
