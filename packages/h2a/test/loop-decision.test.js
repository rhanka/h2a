import test from "node:test";
import assert from "node:assert/strict";

// Pure objective-loop tick core (functional core / imperative shell).
import { planLoopTick, loopRefLocator } from "../dist/runtime/loop/engine/decision.js";

const POLICY = {
  tickMs: 60000,
  idleMs: 900000,
  maxRelaunches: 3,
  requireHumanTypingGuard: true,
  closeWhenRefsSatisfied: false,
  successCriteria: "all-targets-accepted",
  decisionGatePolicy: "all-go-or-waived",
};

function ref(role, id, extra = {}) {
  return {
    system: "track",
    repoKey: "h2a",
    workspace: "h2a",
    aggregateKind: "wp",
    aggregateId: id,
    role,
    ...extra,
  };
}

function makeLoop(over = {}) {
  return {
    id: "loop-test",
    ownerSystem: "h2a",
    name: "t",
    goal: "g",
    status: "running",
    repos: [],
    refs: [],
    agents: [],
    policy: POLICY,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...over,
  };
}

function rolled(refs) {
  return { degraded: false, refs: refs.map((r) => ({ locator: loopRefLocator(r.ref), status: r.status })) };
}

const EMPTY_AGENTS = { degraded: false, version: 1, agents: [] };
const EMPTY_PRESENCE = { byInstance: new Map() };
const EMPTY_INBOX = { pendingDecisions: [] };
const NO_REFS = { degraded: false, refs: [] };
const NOW = 1_000_000;

const types = (plan) => plan.actions.map((a) => a.type);

test("degraded runtime absent sans présence → aucune wake/launch, close=false", () => {
  const loop = makeLoop({ agents: [{ id: "a1", host: "codex", role: "impl", placement: "local", status: "idle", h2aInstance: "x" }] });
  const plan = planLoopTick({
    loop,
    agents: { degraded: true, agents: [] },
    presence: EMPTY_PRESENCE,
    refs: NO_REFS,
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.equal(plan.degraded, true);
  assert.deepEqual(plan.degradedSources, { agents: true, refs: false });
  assert.equal(plan.close, false);
  assert.ok(!types(plan).includes("wake"), "pas de wake sans présence");
  assert.ok(!types(plan).includes("request-launch"), "pas de launch quand la projection runtime est dégradée");
});

test("degraded (track injoignable) → surface les décisions en attente sans injection", () => {
  const plan = planLoopTick({
    loop: makeLoop(),
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: { degraded: true, refs: [] },
    inbox: { pendingDecisions: [{ id: "d1" }] },
    now: NOW,
  });
  assert.equal(plan.outcome, "degraded");
  assert.deepEqual(types(plan), ["route-decision"]);
});

test("tous les refs target accepted/done + policy.closeWhenRefsSatisfied=false → eligible-for-close, close=false", () => {
  const r1 = ref("target", "WP-1");
  const r2 = ref("primary", "WP-2");
  const loop = makeLoop({ refs: [r1, r2] });
  const plan = planLoopTick({
    loop,
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: r1, status: "accepted" }, { ref: r2, status: "done" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.equal(plan.outcome, "eligible-for-close");
  assert.equal(plan.close, false);
  assert.ok(!types(plan).includes("close"));
});

test("tous les refs target satisfaits + closeWhenRefsSatisfied=true → close=true + action close", () => {
  const r1 = ref("target", "WP-1");
  const loop = makeLoop({ refs: [r1], policy: { ...POLICY, closeWhenRefsSatisfied: true } });
  const plan = planLoopTick({
    loop,
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: r1, status: "accepted" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.equal(plan.outcome, "eligible-for-close");
  assert.equal(plan.close, true);
  assert.ok(types(plan).includes("close"));
});

test("un ref target rejected → failed, aucune action agent", () => {
  const r1 = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [r1],
    agents: [{ id: "a1", host: "codex", role: "impl", placement: "local", status: "idle", h2aInstance: "x" }],
  });
  const plan = planLoopTick({
    loop,
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: r1, status: "rejected" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.equal(plan.outcome, "failed");
  assert.equal(plan.close, false);
  assert.ok(!types(plan).includes("wake") && !types(plan).includes("request-launch"));
});

test("blocker ref ouvert → stalled", () => {
  const t = ref("target", "WP-1");
  const b = ref("blocker", "BLK-1");
  const loop = makeLoop({ refs: [t, b] });
  const plan = planLoopTick({
    loop,
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: t, status: "pending" }, { ref: b, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.equal(plan.outcome, "stalled");
});

test("décision en attente (inbox) → waiting-human + route-decision", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({ refs: [t] });
  const plan = planLoopTick({
    loop,
    agents: EMPTY_AGENTS,
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: { pendingDecisions: [{ id: "d9", forAgent: "a1" }] },
    now: NOW,
  });
  assert.equal(plan.outcome, "waiting-human");
  const route = plan.actions.find((a) => a.type === "route-decision");
  assert.ok(route && route.decisionId === "d9" && route.agentId === "a1");
});

test("agent enrôlé manquant + travail en cours → request-launch", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "codex", role: "impl", placement: "local", status: "running", remoteJobId: "job-x" }],
  });
  const plan = planLoopTick({
    loop,
    agents: { degraded: false, agents: [] }, // job-x absent de la projection
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  const launch = plan.actions.find((a) => a.type === "request-launch");
  assert.ok(launch && launch.agentId === "a1");
});

test("agent enrôlé idle + travail en cours → wake", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "codex", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" }],
  });
  const plan = planLoopTick({
    loop,
    agents: {
      degraded: false,
      agents: [{ id: "j", tool: "codex", state: "idle", cwd: "/x", h2aInstance: "inst-1", capabilities: { attach: true, logs: true, remote: false } }],
    },
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  const wake = plan.actions.find((a) => a.type === "wake");
  assert.ok(wake && wake.agentId === "a1");
});

test("agent présent & running + travail → aucune relance/wake (noop)", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "codex", role: "impl", placement: "local", status: "running", h2aInstance: "inst-1" }],
  });
  const plan = planLoopTick({
    loop,
    agents: {
      degraded: false,
      agents: [{ id: "j", tool: "codex", state: "running", cwd: "/x", h2aInstance: "inst-1", capabilities: { attach: true, logs: true, remote: false } }],
    },
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.ok(!types(plan).includes("wake") && !types(plan).includes("request-launch"));
});

test("agent présent live+tmux mais absent de la projection runtime → wake, pas request-launch", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "claude", role: "impl", placement: "local", status: "running", h2aInstance: "claude:a2a-cli:d36d7390005e" }],
  });
  const plan = planLoopTick({
    loop,
    agents: { degraded: false, agents: [] },
    presence: {
      byInstance: new Map([
        ["claude:a2a-cli:d36d7390005e", { instance: "claude:a2a-cli:d36d7390005e", liveSession: true, hasTmuxLaunchContext: true }]
      ])
    },
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.ok(types(plan).includes("wake"));
  assert.ok(!types(plan).includes("request-launch"));
});

test("runtime dégradé mais présence live+tmux → wake exécutable", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "claude", role: "impl", placement: "local", status: "running", h2aInstance: "claude:a2a-cli:d36d7390005e" }],
  });
  const plan = planLoopTick({
    loop,
    agents: { degraded: true, agents: [] },
    presence: {
      byInstance: new Map([
        ["claude:a2a-cli:d36d7390005e", { instance: "claude:a2a-cli:d36d7390005e", liveSession: true, hasTmuxLaunchContext: true }]
      ])
    },
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.equal(plan.degraded, true);
  assert.deepEqual(plan.degradedSources, { agents: true, refs: false });
  assert.ok(types(plan).includes("wake"));
  assert.ok(!types(plan).includes("request-launch"));
});

test("présence live+tmux mais projection runtime running → pas de wake", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "claude", role: "impl", placement: "local", status: "idle", h2aInstance: "claude:a2a-cli:d36d7390005e" }],
  });
  const plan = planLoopTick({
    loop,
    agents: {
      degraded: false,
      agents: [
        {
          id: "j",
          tool: "claude",
          state: "running",
          cwd: "/x",
          h2aInstance: "claude:a2a-cli:d36d7390005e",
          capabilities: { attach: true, logs: true, remote: false }
        }
      ]
    },
    presence: {
      byInstance: new Map([
        ["claude:a2a-cli:d36d7390005e", { instance: "claude:a2a-cli:d36d7390005e", liveSession: true, hasTmuxLaunchContext: true }]
      ])
    },
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.ok(!types(plan).includes("wake"));
  assert.ok(!types(plan).includes("request-launch"));
});

test("projection runtime running gagne sur statut loop idle sans présence", () => {
  const t = ref("target", "WP-1");
  const loop = makeLoop({
    refs: [t],
    agents: [{ id: "a1", host: "claude", role: "impl", placement: "local", status: "idle", h2aInstance: "inst-1" }],
  });
  const plan = planLoopTick({
    loop,
    agents: {
      degraded: false,
      agents: [{ id: "j", tool: "claude", state: "running", cwd: "/x", h2aInstance: "inst-1", capabilities: { attach: true, logs: true, remote: false } }],
    },
    presence: EMPTY_PRESENCE,
    refs: rolled([{ ref: t, status: "pending" }]),
    inbox: EMPTY_INBOX,
    now: NOW,
  });
  assert.ok(!types(plan).includes("wake"));
  assert.ok(!types(plan).includes("request-launch"));
});
