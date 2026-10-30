/**
 * Lot H2A-SEAM-LAUNCH — pre-spawn launch-authorisation seam (r2 §2.4 seam 1,
 * co-sign §4.1), the L2 `AgentSession` purpose_ref handshake (R4-08) and the
 * sub-agent memory-purpose ceiling (r2 §2.4 sub-agents, co-sign §2.3).
 *
 * The seam lives in `runtime/governance/agent-launch-seam.ts` (the B4 module
 * delivered by #416): the r2 layer that first landed in `launch-check.ts` is
 * re-founded there, so the module keep its evolved B4 protocol —
 * `isLiveAllow` (shape + expiry) gates both published allow forms and
 * `spawnOnAuthorizedLaunch` revalidates the wrapper before spawning — and
 * gains the frozen L2 field set + sub-agent rules. The read-only conductor
 * recommendation (`recommendConductorLaunch` / `conductorLaunchCheck`) stays
 * DRY-RUN in `launch-check.ts`. All decision producers here are in-memory
 * doubles; binding the live local cluster-mesh instance is cutover work
 * (H2A-354-CUTOVER).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  H2A_AGENT_SESSION_ID,
  authorizeAgentLaunch,
  spawnOnAuthorizedLaunch
} from "../dist/runtime/governance/agent-launch-seam.js";
import {
  authorizeSessionMemoryPurpose,
  recommendConductorLaunch
} from "../dist/index.js";
import * as barrel from "../dist/index.js";

const WS = "ws:01234567-89ab-cdef-89ab-cdef01234567";
const DURABLE = "ws:" + "a".repeat(64);

function launchRequest(overrides = {}) {
  return {
    h2aWorkspaceId: WS,
    durableWorkspaceIdHint: DURABLE,
    realpath: "/home/agent/proj",
    instanceId: "claude:alpha:aaaaaaaaaaaa",
    cliKind: "claude",
    ...overrides
  };
}

function bareAllow(overrides = {}) {
  return {
    allow: true,
    agentSessionId: "agent-session:8f2c",
    policyRevision: "pol:42",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides
  };
}

function l2Allow(overrides = {}) {
  return bareAllow({
    policyMode: "role",
    memorialAgentId: "agent:mem-alpha",
    associationRevision: "assoc:3",
    workspaceRef: "ws:" + "b".repeat(64),
    purposeRefs: { role: "purpose:alpha-role", repo: "purpose:alpha-repo" },
    permittedTools: ["engram_memory_status", "engram_memory_get"],
    requestCollectionAvailable: true,
    ...overrides
  });
}

function portOf(answer, hooks = {}) {
  const calls = [];
  const port = (request) => {
    calls.push(request);
    if (hooks.beforeReturn) hooks.beforeReturn();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  port.calls = calls;
  return port;
}

test("the seam stays module-scoped and distinct from the read-only conductor recommendation", async () => {
  // The DRY-RUN conductor recommendation is unchanged and still advisory.
  assert.deepEqual(recommendConductorLaunch({ conductorLive: false, stalledCount: 2 }), {
    recommendation: "launch",
    reason: "2 stalled item(s) and no live conductor",
    suggestedHosts: ["claude", "codex", "agy"]
  });
  // The pre-spawn authorisation seam exposes its evolved B4 protocol locals.
  assert.equal(typeof authorizeAgentLaunch, "function");
  assert.equal(typeof spawnOnAuthorizedLaunch, "function");
  assert.equal(H2A_AGENT_SESSION_ID, "H2A_AGENT_SESSION_ID");
  // Nothing is re-exported from the public barrel before the B5
  // reconciliation: the r2 public names no longer shadow the B4 seam.
  assert.equal("authorizeAgentLaunch" in barrel, false);
  assert.equal("spawnOnAuthorizedLaunch" in barrel, false);
});

test("deny decisions map 1:1 through the typed decision port and spawn zero OS processes", async () => {
  const reasons = [
    "agent_not_active",
    "agent_not_ratified_in_workspace",
    "workspace_unmapped",
    "cli_kind_outside_ceiling",
    "model_outside_ceiling",
    "effort_outside_ceiling",
    "passthrough_policy_missing",
    "policy_unavailable"
  ];
  for (const reason of reasons) {
    const port = portOf({ allow: false, reason });
    const decided = await authorizeAgentLaunch(launchRequest(), port);
    assert.deepEqual(decided, { ok: true, decision: { allow: false, reason } });
    // The port received the request verbatim (typed port, published shapes).
    assert.equal(port.calls.length, 1);
    assert.equal(port.calls[0].instanceId, "claude:alpha:aaaaaaaaaaaa");
    let spawnCalls = 0;
    const out = spawnOnAuthorizedLaunch(decided, () => {
      spawnCalls += 1;
      return 0;
    }, {});
    assert.equal(spawnCalls, 0, "a refused launch must never reach the spawn step");
    assert.deepEqual(out, { ok: false, reason });
  }
});

test("port failure or garbage answer fails closed", async () => {
  const thrown = await authorizeAgentLaunch(launchRequest(), portOf(new Error("boom")));
  assert.deepEqual(thrown, { ok: false, reason: "policy_unavailable" });
  const garbage = await authorizeAgentLaunch(launchRequest(), portOf(null));
  assert.deepEqual(garbage, { ok: false, reason: "invalid_decision" });
});

test("a bare B4 allow still verifies and sets exactly H2A_AGENT_SESSION_ID", async () => {
  const decided = await authorizeAgentLaunch(launchRequest(), () => bareAllow());
  assert.deepEqual(decided.ok, true);
  const seen = [];
  const out = spawnOnAuthorizedLaunch(
    decided,
    (env) => {
      seen.push({ ...env });
      return 7;
    },
    { H2A_AGENT_SESSION_ID: "agent-session:caller", MARK: "kept" }
  );
  assert.deepEqual(out, { ok: true, value: 7 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][H2A_AGENT_SESSION_ID], "agent-session:8f2c");
  assert.equal(seen[0].MARK, "kept");
});

test("the L2 purpose_ref handshake reaches the caller through the seam", async () => {
  const decided = await authorizeAgentLaunch(launchRequest(), () => l2Allow());
  assert.equal(decided.ok, true);
  const allow = decided.decision;
  // R4-08: the opened L2 session description (purpose_ref map included) is
  // what the runtime executes under — never a bare exit flag.
  assert.equal(allow.policyMode, "role");
  assert.equal(allow.agentSessionId, "agent-session:8f2c");
  assert.equal(allow.memorialAgentId, "agent:mem-alpha");
  assert.equal(allow.associationRevision, "assoc:3");
  assert.equal(allow.workspaceRef, "ws:" + "b".repeat(64));
  assert.equal(allow.policyRevision, "pol:42");
  assert.deepEqual(allow.purposeRefs, { role: "purpose:alpha-role", repo: "purpose:alpha-repo" });
  assert.deepEqual(allow.permittedTools, ["engram_memory_status", "engram_memory_get"]);
  assert.equal(allow.requestCollectionAvailable, true);
  let spawnCalls = 0;
  const out = spawnOnAuthorizedLaunch(
    decided,
    (env) => {
      spawnCalls += 1;
      return env[H2A_AGENT_SESSION_ID];
    },
    { H2A_AGENT_SESSION_ID: "agent-session:caller" }
  );
  assert.deepEqual(out, { ok: true, value: "agent-session:8f2c" });
  assert.equal(spawnCalls, 1);
});

test("unverifiable L2 decision shapes fail closed as invalid_decision", async () => {
  const missingRequired = l2Allow();
  delete missingRequired.workspaceRef;
  const partial = bareAllow({ memorialAgentId: "agent:mem-alpha" });
  const cases = [
    l2Allow({ extraField: "no" }),
    l2Allow({ agentSessionId: "not-a-session-id" }),
    l2Allow({ memorialAgentId: "not-an-agent-id" }),
    l2Allow({ policyMode: "wizard" }),
    l2Allow({ purposeRefs: { team: "purpose:x" } }),
    l2Allow({ permittedTools: "engram_memory_status" }),
    l2Allow({ expiresAt: "tomorrow" }),
    { ...l2Allow(), workspaceRef: undefined },
    missingRequired,
    partial,
    { allow: "yes" }
  ];
  for (const portAnswer of cases) {
    const decided = await authorizeAgentLaunch(launchRequest(), portOf(portAnswer));
    assert.deepEqual(decided, { ok: false, reason: "invalid_decision" });
  }
  let spawnCalls = 0;
  const refused = await authorizeAgentLaunch(launchRequest(), portOf(l2Allow({ extraField: "no" })));
  const out = spawnOnAuthorizedLaunch(refused, () => {
    spawnCalls += 1;
    return 0;
  }, {});
  assert.deepEqual(out, { ok: false, reason: "invalid_decision" });
  assert.equal(spawnCalls, 0);
});

test("expired allow refuses, spawn never runs", async () => {
  let spawnCalls = 0;
  const spawn = () => {
    spawnCalls += 1;
    return 0;
  };
  for (const expired of [
    bareAllow({ expiresAt: "2000-01-01T00:00:00.000Z" }),
    l2Allow({ expiresAt: "2000-01-01T00:00:00.000Z" })
  ]) {
    const refused = await authorizeAgentLaunch(launchRequest(), portOf(expired));
    assert.deepEqual(refused, { ok: false, reason: "invalid_decision" });
    assert.deepEqual(spawnOnAuthorizedLaunch(refused, spawn, {}), {
      ok: false,
      reason: "invalid_decision"
    });
    // A stale wrapper past the same seam also never spawns: the guard
    // revalidates the decision, not the caller's wrapper.
    const stale = { ok: true, decision: expired };
    assert.deepEqual(spawnOnAuthorizedLaunch(stale, spawn, {}), {
      ok: false,
      reason: "invalid_decision"
    });
  }
  assert.equal(spawnCalls, 0);
});

test("fabricated wrapper never spawns", async () => {
  let spawnCalls = 0;
  const spawn = () => {
    spawnCalls += 1;
    return 0;
  };
  const fabricated = [
    { ok: true, decision: l2Allow({ agentSessionId: "forged" }) },
    {
      ok: true,
      decision: l2Allow({
        agentSessionId: "agent-session:decided-1",
        expiresAt: "2000-01-01T00:00:00.000Z"
      })
    },
    {
      ok: true,
      decision: l2Allow({ agentSessionId: "agent-session:decided-1", policyMode: "wizard" })
    },
    {
      ok: true,
      decision: bareAllow({ agentSessionId: "not a valid id!!" })
    },
    { allow: true, agentSessionId: "agent-session:decided-1", expiresAt: "2030-01-01T00:00:00.000Z" }
  ];
  for (const wrapper of fabricated) {
    assert.deepEqual(spawnOnAuthorizedLaunch(wrapper, spawn, {}), {
      ok: false,
      reason: "invalid_decision"
    });
  }
  assert.equal(spawnCalls, 0, "a fabricated or stale wrapper must never spawn");
});

test("sub-agent launch authorises under the parent session (no level-2 record of its own)", async () => {
  const request = launchRequest({
    instanceId: "claude:alpha:aaaaaaaaaaaa~researcher",
    parentAgentSessionId: "agent-session:parent-1",
    subagentName: "researcher"
  });
  const decided = await authorizeAgentLaunch(
    request,
    portOf(l2Allow({ agentSessionId: "agent-session:parent-1" }))
  );
  assert.equal(decided.ok, true);
  assert.equal(decided.decision.agentSessionId, "agent-session:parent-1");
  assert.equal(decided.decision.purposeRefs.role, "purpose:alpha-role");
});

test("sub-agent launch opening its own L2 record fails closed", async () => {
  const request = launchRequest({
    instanceId: "claude:alpha:aaaaaaaaaaaa~researcher",
    parentAgentSessionId: "agent-session:parent-1",
    subagentName: "researcher"
  });
  const decided = await authorizeAgentLaunch(
    request,
    portOf(l2Allow({ agentSessionId: "agent-session:own-record" }))
  );
  assert.deepEqual(decided, { ok: false, reason: "invalid_decision" });
});

test("structurally invalid sub-agent requests never reach the decision port", async () => {
  const port = portOf(l2Allow());
  const malformed = [
    // name without parent
    launchRequest({
      instanceId: "claude:alpha:aaaaaaaaaaaa~researcher",
      subagentName: "researcher"
    }),
    // parent without name
    launchRequest({ parentAgentSessionId: "agent-session:parent-1" }),
    // parent+name but plain instance id (no sub-agent address)
    launchRequest({
      parentAgentSessionId: "agent-session:parent-1",
      subagentName: "researcher"
    }),
    // address+parent but mismatching sub-agent name
    launchRequest({
      instanceId: "claude:alpha:aaaaaaaaaaaa~researcher",
      parentAgentSessionId: "agent-session:parent-1",
      subagentName: "other-name"
    }),
    // parent not an agent-session id
    launchRequest({
      instanceId: "claude:alpha:aaaaaaaaaaaa~researcher",
      parentAgentSessionId: "parent-1",
      subagentName: "researcher"
    })
  ];
  for (const request of malformed) {
    const decided = await authorizeAgentLaunch(request, port);
    assert.deepEqual(decided, { ok: false, reason: "invalid_request" });
  }
  assert.equal(port.calls.length, 0, "an invalid request never reaches the decision port");
  // A paired sub-agent request reaches the port only when structurally valid.
  const ok = await authorizeAgentLaunch(
    launchRequest({
      instanceId: "claude:alpha:aaaaaaaaaaaa~researcher",
      parentAgentSessionId: "agent-session:parent-1",
      subagentName: "researcher"
    }),
    portOf(l2Allow({ agentSessionId: "agent-session:parent-1" }))
  );
  assert.equal(ok.ok, true);
});

test("sub-agent memory purpose requires the explicit opt-in (purpose_not_granted)", () => {
  const grant = {
    memorialAgentId: "agent:mem-alpha",
    scopeKind: "role",
    purposeRef: "purpose:alpha-role",
    allowSubagentExec: false
  };
  // Parent calls proceed under the grant.
  assert.deepEqual(
    authorizeSessionMemoryPurpose([grant], {
      memorialAgentId: "agent:mem-alpha",
      scopeKind: "role",
      subagent: false
    }),
    { ok: true, purposeRef: "purpose:alpha-role" }
  );
  // The same grant without the explicit allowance refuses sub-agent calls.
  assert.deepEqual(
    authorizeSessionMemoryPurpose([grant], {
      memorialAgentId: "agent:mem-alpha",
      scopeKind: "role",
      subagent: true
    }),
    { ok: false, reason: "purpose_not_granted" }
  );
  // allowSubagentExec: true is the explicit opt-in.
  assert.deepEqual(
    authorizeSessionMemoryPurpose(
      [{ ...grant, allowSubagentExec: true }],
      { memorialAgentId: "agent:mem-alpha", scopeKind: "role", subagent: true }
    ),
    { ok: true, purposeRef: "purpose:alpha-role" }
  );
  // Without any purpose_ref there is nothing to inherit.
  assert.deepEqual(
    authorizeSessionMemoryPurpose([], {
      memorialAgentId: "agent:mem-alpha",
      scopeKind: "role",
      subagent: true
    }),
    { ok: false, reason: "purpose_not_granted" }
  );
});

test("cross-agent purpose_ref copy refuses purpose_not_granted", () => {
  const grants = [
    {
      memorialAgentId: "agent:mem-alpha",
      scopeKind: "role",
      purposeRef: "purpose:alpha-role",
      allowSubagentExec: true
    }
  ];
  assert.deepEqual(
    authorizeSessionMemoryPurpose(grants, {
      memorialAgentId: "agent:mem-beta",
      scopeKind: "role",
      subagent: false
    }),
    { ok: false, reason: "purpose_not_granted" }
  );
});
