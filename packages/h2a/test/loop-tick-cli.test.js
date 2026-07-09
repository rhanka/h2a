import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writePresence } from "../dist/index.js";
// Adapter + pure core, exercised in-process to prove the R3 idle gate reads the
// on-disk presence fields (lastMcpActivityAt / workStatus) end-to-end.
import { readPresenceSnapshot } from "../dist/runtime/loop/engine/adapters.js";
import { planLoopTick } from "../dist/runtime/loop/engine/decision.js";

// Integration: `h2a loop tick|watch` are ASYNC (lazy runtime + periodic) and are
// dispatched in bin.ts, so we exercise them through the real binary.
const ROOT = process.cwd();
const BIN = join(ROOT, "packages/h2a/dist/bin.js");

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
}

test("h2a loop tick produit un plan dry-run (resource) + code 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    assert.equal(created.status, 0, `create stderr: ${created.stderr}`);
    const loopId = JSON.parse(created.stdout).id;
    assert.ok(loopId, "loopId manquant");

    const ticked = run(["loop", "tick", loopId, "--root", dir]);
    assert.equal(ticked.status, 0, `tick stderr: ${ticked.stderr}`);
    const plan = JSON.parse(ticked.stdout);
    assert.equal(plan.loopId, loopId);
    assert.equal(plan.degraded, false);
    assert.equal(typeof plan.outcome, "string");
    assert.ok(Array.isArray(plan.actions), "plan.actions doit être un tableau");
    // Aucune ref déclarée → running + noop (le core ne close jamais sans refs).
    assert.equal(plan.close, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop watch --max 1 exécute une relance gardée par défaut", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const joined = run(["loop", "join", loopId, "--instance", "claude:test", "--agent-id", "a1", "--root", dir]);
    assert.equal(joined.status, 0, `join stderr: ${joined.stderr}`);
    const watched = run(["loop", "watch", loopId, "--root", dir, "--max", "1"]);
    assert.equal(watched.status, 0, `watch stderr: ${watched.stderr}`);
    const lines = watched.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "watch --max 1 doit émettre exactement 1 plan");
    const plan = JSON.parse(lines[0]);
    assert.equal(plan.loopId, loopId);
    assert.ok(plan.exec, "watch/run MVP doit exécuter par défaut les actions de relance gardées");
    assert.ok(plan.exec.results.some((r) => r.type === "request-launch" && r.agentId === "a1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop tick préfère wake quand une présence h2a live+tmux existe", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  const instance = "claude:test:aaaaaaaaaaaa";
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const joined = run(["loop", "join", loopId, "--instance", instance, "--agent-id", "a1", "--root", dir]);
    assert.equal(joined.status, 0, `join stderr: ${joined.stderr}`);
    const now = new Date().toISOString();
    // R3 gate: a live+tmux presence is not enough — it must also look IDLE. An old
    // `lastMcpActivityAt` (1h ago, beyond policy.idleMs) is the idle evidence.
    const staleActivity = new Date(Date.now() - 3600_000).toISOString();
    writePresence(dir, {
      sessionId: "sess-live-tmux",
      instance,
      host: "claude",
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      lastMcpActivityAt: staleActivity,
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: [],
      launchContext: {
        cwd: dir,
        command: "claude",
        tmux: { session: "h2a-test", pane: "%1" }
      }
    });

    const ticked = run(["loop", "tick", loopId, "--root", dir]);
    assert.equal(ticked.status, 0, `tick stderr: ${ticked.stderr}`);
    const plan = JSON.parse(ticked.stdout);
    assert.ok(plan.actions.some((a) => a.type === "wake" && a.agentId === "a1"));
    assert.ok(!plan.actions.some((a) => a.type === "request-launch" && a.agentId === "a1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop watch --dry-run reste observation-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const joined = run(["loop", "join", loopId, "--instance", "claude:test", "--agent-id", "a1", "--root", dir]);
    assert.equal(joined.status, 0, `join stderr: ${joined.stderr}`);
    const watched = run(["loop", "watch", loopId, "--root", dir, "--max", "1", "--dry-run"]);
    assert.equal(watched.status, 0, `watch stderr: ${watched.stderr}`);
    const plan = JSON.parse(watched.stdout.trim());
    assert.equal(plan.loopId, loopId);
    assert.equal(plan.exec, undefined);
    assert.ok(plan.actions.some((a) => a.type === "request-launch" && a.agentId === "a1"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop tick --execute (loop sans ref) → sûr : exec présent, statut inchangé", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const ticked = run(["loop", "tick", loopId, "--root", dir, "--execute"]);
    assert.equal(ticked.status, 0, `tick --execute stderr: ${ticked.stderr}`);
    const out = JSON.parse(ticked.stdout);
    assert.ok(out.exec, "le rapport exec doit être présent avec --execute");
    // Aucune ref → pas d'action close → statut reste 'created'.
    const status = run(["loop", "status", loopId, "--root", dir]);
    assert.equal(JSON.parse(status.stdout).status, "created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop tick sur un loop inexistant → code non-zero + stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const res = run(["loop", "tick", "loop-does-not-exist", "--root", dir]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /loop tick/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a loop stop is honored by subsequent tick --execute", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    assert.equal(created.status, 0, `create stderr: ${created.stderr}`);
    const loopId = JSON.parse(created.stdout).id;
    const stopped = run(["loop", "stop", loopId, "--root", dir, "--reason", "operator stop"]);
    assert.equal(stopped.status, 0, `stop stderr: ${stopped.stderr}`);

    const ticked = run(["loop", "tick", loopId, "--root", dir, "--execute"]);
    assert.equal(ticked.status, 0, `tick --execute stderr: ${ticked.stderr}`);
    const out = JSON.parse(ticked.stdout);
    assert.equal(out.outcome, "stopped");
    assert.deepEqual(out.actions, []);
    assert.deepEqual(out.exec.results, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loop blocked → tick n'émet aucun wake (short-circuit no-action)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  const instance = "claude:test:bbbbbbbbbbbb";
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    const joined = run(["loop", "join", loopId, "--instance", instance, "--agent-id", "a1", "--root", dir]);
    assert.equal(joined.status, 0, `join stderr: ${joined.stderr}`);
    const now = new Date().toISOString();
    // Idle+wakeable presence that WOULD normally trigger a wake — the point of the
    // test is that a `blocked` loop status suppresses it regardless.
    writePresence(dir, {
      sessionId: "sess-blocked",
      instance,
      host: "claude",
      startedAt: now,
      heartbeatAt: now,
      state: "live",
      lastMcpActivityAt: new Date(Date.now() - 3600_000).toISOString(),
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: [],
      launchContext: { cwd: dir, command: "claude", tmux: { session: "h2a-test", pane: "%1" } }
    });

    // No CLI verb flips a loop to `blocked`; it is set by the runtime. Simulate it
    // by editing state.json directly (mirrors updateObjectiveLoopStatus's write).
    const statePath = join(dir, "loops", loopId, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.status = "blocked";
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const ticked = run(["loop", "tick", loopId, "--root", dir]);
    assert.equal(ticked.status, 0, `tick stderr: ${ticked.stderr}`);
    const plan = JSON.parse(ticked.stdout);
    assert.equal(plan.outcome, "stalled", "un loop blocked doit rester stalled");
    assert.deepEqual(plan.actions, [], "un loop blocked ne planifie aucune action");
    assert.ok(!plan.actions.some((a) => a.type === "wake"), "aucun wake sur un loop blocked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Anti-over-suppression proof through the REAL adapter: a genuine h2a session
// populates lastMcpActivityAt, so the R3 gate correctly wakes an idle session and
// leaves a working one alone — read from disk via readPresenceSnapshot, not a
// hand-built PresenceView.
test("adaptateur: présence idle-stale sur disque → wake ; workStatus=working → noop", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-loop-"));
  const instance = "claude:test:cccccccccccc";
  try {
    const created = run(["loop", "create", "--name", "t", "--goal", "g", "--root", dir]);
    const loopId = JSON.parse(created.stdout).id;
    run(["loop", "join", loopId, "--instance", instance, "--agent-id", "a1", "--root", dir]);
    const now = Date.now();
    const loop = JSON.parse(run(["loop", "status", loopId, "--root", dir]).stdout);
    // One declared target ref kept pending so `workPending` is true in the core.
    loop.refs = [{ system: "track", repoKey: "h2a", workspace: "h2a", aggregateKind: "wp", aggregateId: "WP-X", role: "target" }];
    const refs = { degraded: false, refs: [{ locator: `track:h2a:h2a:wp:WP-X`, status: "pending" }] };
    const agents = { degraded: false, agents: [] };
    const inbox = { pendingDecisions: [] };
    const nowIso = new Date(now).toISOString();
    const base = {
      instance,
      host: "claude",
      startedAt: nowIso,
      heartbeatAt: nowIso,
      state: "live",
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: [],
      launchContext: { cwd: dir, command: "claude", tmux: { session: "h2a-test", pane: "%1" } }
    };

    // (a) idle-stale MCP activity → wake
    writePresence(dir, { ...base, sessionId: "sess-a", lastMcpActivityAt: new Date(now - loop.policy.idleMs - 1).toISOString() });
    const idlePlan = planLoopTick({ loop, agents, presence: readPresenceSnapshot(dir, now), refs, inbox, now });
    assert.ok(idlePlan.actions.some((a) => a.type === "wake" && a.agentId === "a1"), "présence idle-stale doit être réveillée");

    // (b) workStatus=working → noop (no wake), even with the same tmux context
    writePresence(dir, { ...base, sessionId: "sess-a", workStatus: "working", lastMcpActivityAt: new Date(now - loop.policy.idleMs - 1).toISOString() });
    const busyPlan = planLoopTick({ loop, agents, presence: readPresenceSnapshot(dir, now), refs, inbox, now });
    assert.ok(!busyPlan.actions.some((a) => a.type === "wake"), "workStatus=working ne doit jamais être réveillé");
    assert.ok(!busyPlan.actions.some((a) => a.type === "request-launch"), "un agent live ne doit pas être relancé comme missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
