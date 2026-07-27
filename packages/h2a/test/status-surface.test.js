import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEventListeners } from "node:events";
import test from "node:test";

import {
  cleanStatusText,
  readStatusSnapshot,
  renderGatewayBar,
  renderHumanStatus,
  renderWorkloadBar,
  runStatusSurfaceCli,
  statusWatchIntervalMs
} from "../dist/status-surface.js";

function runtime(sessionState = "present") {
  return {
    kind: "h2a-status-runtime",
    version: 1,
    session: { state: sessionState, tmuxSession: "h2a-demo" },
    managed: {
      degraded: false,
      agents: [
        { id: "job:one", kind: "delegated-job", tool: "codex", state: "running" },
        { id: "job:two", kind: "delegated-job", tool: "claude", state: "throttled" }
      ]
    },
    delegations: { executions: [], degraded: false },
    gateway: {
      state: "active",
      requestedModel: "claude-opus-5-xhigh",
      upstreamModel: "gpt-5.6-terra",
      accountId: "work-codex",
      accountLabel: "work-codex"
    },
    warnings: []
  };
}

test("host-controlled status text strips controls and bidi and marks truncation", () => {
  const rendered = cleanStatusText("one\u202etwo\u0007 three", 5);
  assert.equal(rendered, "one t[cut]");
  assert.doesNotMatch(rendered, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
});

test("status bar distinguishes an absent h2a session from a present empty session", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    const present = await readStatusSnapshot(
      { root },
      { projectRuntime: async () => ({ ...runtime(), managed: { degraded: false, agents: [] } }) }
    );
    assert.equal(present.tmuxSession, "h2a-demo");
    assert.equal(renderWorkloadBar(present), "J0 I? L?");

    const absent = await readStatusSnapshot(
      { root, tmuxSession: "remote-missing" },
      { projectRuntime: async () => runtime("absent") }
    );
    assert.equal(renderWorkloadBar(absent), "h2a absent");
    assert.equal(renderGatewayBar(absent), "gw n/a");

    const unknown = await readStatusSnapshot(
      { root, tmuxSession: "h2a-unknown" },
      { projectRuntime: async () => runtime("unknown") }
    );
    assert.equal(renderWorkloadBar(unknown), "h2a ?");
    assert.equal(renderGatewayBar(unknown), "gw ?");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status projection shows delegated subagents, inbox senders, loops, and truthful gateway route", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    mkdirSync(join(root, "inbox", "codex__owner__abc"), { recursive: true });
    mkdirSync(join(root, "loops", "loop-one"), { recursive: true });
    writeFileSync(
      join(root, "registry", "subagents.jsonl"),
      `${JSON.stringify({ id: "codex:owner:abc~reviewer", parentInstance: "codex:owner:abc", name: "reviewer", createdAt: "2026-07-25T10:00:00.000Z" })}\n`
    );
    writeFileSync(
      join(root, "registry", "subagent-audit.jsonl"),
      `${JSON.stringify({ subagent: "codex:owner:abc~reviewer", type: "routed", at: "2026-07-25T10:30:00.000Z", envelopeId: "env:delegated", mailbox: "inbox" })}\n`
    );
    writeFileSync(
      join(root, "inbox", "codex__owner__abc", "env-one.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env:one",
        type: "event",
        actor: { instance: "claude:peer:def", role: "AGENTS", scope: "scope:default" },
        body: { topic: "review.ready" },
        createdAt: "2026-07-25T11:00:00.000Z"
      })
    );
    writeFileSync(
      join(root, "loops", "loop-one", "state.json"),
      JSON.stringify({
        id: "loop-one",
        ownerSystem: "h2a",
        name: "Review status surface",
        goal: "ship",
        status: "waiting-human",
        repos: [],
        refs: [],
        agents: [],
        policy: {},
        createdAt: "2026-07-25T10:00:00.000Z",
        updatedAt: "2026-07-25T11:00:00.000Z"
      })
    );

    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      {
        projectRuntime: async () => ({
          ...runtime(),
          delegations: {
            executions: [{
              id: "run:plugin-review",
              origin: "mcp:h2a_run",
              delegatorInstance: "codex:owner:abc",
              delegatorTmuxSession: "h2a-demo",
              tool: "codex",
              state: "throttled"
            }],
            degraded: false
          }
        })
      }
    );
    assert.equal(renderWorkloadBar(snapshot), "J1!1 I1 L1!1");
    assert.equal(
      renderGatewayBar(snapshot),
      "gw active · claude-opus-5-xhigh→gpt-5.6-terra"
    );
    assert.equal(
      renderGatewayBar({
        ...snapshot,
        gateway: {
          ...snapshot.gateway,
          previousAccountLabel: "acct-a",
          fallbackAccountLabel: "work-codex"
        }
      }),
      "gw active · claude-opus-5-xhigh→gpt-5.6-terra"
    );
    const human = renderHumanStatus(snapshot);
    assert.match(human, /run:plugin-review  mcp:h2a_run  codex  throttled/);
    assert.match(human, /codex:owner:abc~reviewer/);
    assert.match(human, /last routed env:delegated to inbox/);
    assert.match(human, /from claude:peer:def/);
    assert.match(human, /loop-one  waiting-human/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inbox counts the exact tmux owner once across canonical and raw paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  const envelope = {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: "env:offline",
    type: "event",
    actor: { instance: "claude:peer:def", role: "AGENTS", scope: "scope:default" },
    body: { topic: "review.ready" },
    createdAt: "2026-07-25T11:00:00.000Z"
  };
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(join(root, "registry", "subagents.jsonl"), "");
    writeFileSync(join(root, "registry", "subagent-audit.jsonl"), "");
    for (const directory of ["codex__owner__abc", "Codex__Owner__ABC"]) {
      mkdirSync(join(root, "inbox", directory), { recursive: true });
      writeFileSync(join(root, "inbox", directory, "env-offline.json"), JSON.stringify(envelope));
    }
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "Codex:Owner:ABC" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.inbox.waiting, 1);
    assert.equal(snapshot.inbox.degraded, false);
    assert.match(renderWorkloadBar(snapshot), /I1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("persisted sidecar attestation reaches the owner-scoped J projection", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(
      join(root, "registry", "mcp-delegations.jsonl"),
      `${JSON.stringify({
        version: 1,
        workerTmuxSession: "h2a-plugin-review",
        workerPid: 4242,
        origin: "mcp:h2a_run",
        delegatorInstance: "codex:owner:abc",
        delegatorTmuxSession: "h2a-demo",
        recordedAt: "2026-07-26T12:00:00.000Z"
      })}\n`
    );
    let requested;
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      {
        projectRuntime: async (input) => {
          requested = input;
          const item = input.delegationAttestations[0];
          return {
            ...runtime(),
            delegations: {
              executions: [{
                id: "plugin-review",
                origin: item.origin,
                delegatorInstance: item.delegatorInstance,
                delegatorTmuxSession: item.delegatorTmuxSession,
                tool: "codex",
                state: "running"
              }],
              degraded: input.delegationAttestationsKnown !== true
            }
          };
        }
      }
    );
    assert.equal(requested.delegationAttestationsKnown, true);
    assert.equal(requested.delegationAttestations.length, 1);
    assert.match(renderWorkloadBar(snapshot), /^J1 I\? L\?$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unrelated inbox cannot inflate the exact owner's count", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(join(root, "registry", "subagents.jsonl"), "");
    writeFileSync(join(root, "registry", "subagent-audit.jsonl"), "");
    mkdirSync(join(root, "inbox", "unknown__owner"), { recursive: true });
    writeFileSync(
      join(root, "inbox", "unknown__owner", "env-orphan.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env:orphan",
        type: "event",
        actor: { instance: "claude:peer:def", role: "AGENTS", scope: "scope:default" },
        body: {},
        createdAt: "2026-07-25T11:00:00.000Z"
      })
    );
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.inbox.waiting, 0);
    assert.equal(snapshot.inbox.degraded, false);
    assert.match(renderWorkloadBar(snapshot), /I0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status bar renders unknown instead of zero when owner inbox scope is unverifiable", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(join(root, "registry", "subagents.jsonl"), "not-json\n");
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.match(renderWorkloadBar(snapshot), /I\?/);
    assert.doesNotMatch(renderWorkloadBar(snapshot), /I0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("contract-invalid delegation rows render I? instead of a false inbox count", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(
      join(root, "registry", "subagents.jsonl"),
      `${JSON.stringify({ id: "codex:owner:abc~wrong", parentInstance: "codex:owner:abc", name: "reviewer", createdAt: "not-a-time" })}\n`
    );
    writeFileSync(
      join(root, "registry", "subagent-audit.jsonl"),
      `${JSON.stringify({ subagent: "codex:owner:abc~reviewer", type: "revoked" })}\n`
    );
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.subagents.addressable, 0);
    assert.equal(snapshot.subagents.degraded, true);
    assert.match(renderWorkloadBar(snapshot), /I\?/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing child-scope registry renders I? rather than a false owner-only zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "inbox", "codex__owner__abc"), { recursive: true });
    mkdirSync(join(root, "loops"), { recursive: true });
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.match(renderWorkloadBar(snapshot), /I\?/);
    assert.doesNotMatch(renderWorkloadBar(snapshot), /I0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing loop collection renders L? rather than a healthy zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(join(root, "registry", "subagents.jsonl"), "");
    writeFileSync(join(root, "registry", "subagent-audit.jsonl"), "");
    mkdirSync(join(root, "inbox", "codex__owner__abc"), { recursive: true });
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.match(renderWorkloadBar(snapshot), /I0/);
    assert.match(renderWorkloadBar(snapshot), /L\?/);
    assert.doesNotMatch(renderWorkloadBar(snapshot), /L0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an over-budget plugin-attestation history renders J? instead of a partial count", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(join(root, "registry", "mcp-delegations.jsonl"), "x".repeat(32 * 1024 + 1));
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      {
        projectRuntime: async (input) => ({
          ...runtime(),
          delegations: { executions: [], degraded: input.delegationAttestationsKnown !== true }
        })
      }
    );
    assert.match(renderWorkloadBar(snapshot), /J\?/);
    assert.doesNotMatch(renderWorkloadBar(snapshot), /J0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unverifiable delegated execution renders J? rather than a healthy zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      {
        projectRuntime: async () => ({
          ...runtime(),
          delegations: { executions: [], degraded: true }
        })
      }
    );
    assert.equal(renderWorkloadBar(snapshot), "J? I? L?");
    assert.doesNotMatch(renderWorkloadBar(snapshot), /J0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gateway route is omitted whole when its width budget cannot fit it", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(renderGatewayBar(snapshot, 12), "gw active");
    assert.doesNotMatch(renderGatewayBar(snapshot, 12), /claude|gpt/);
    const fullWidthRoute = renderGatewayBar({
      ...snapshot,
      gateway: {
        ...snapshot.gateway,
        requestedModel: "模型",
        upstreamModel: "上游"
      }
    }, 15);
    assert.equal(fullWidthRoute, "gw active");
    const hostileLongRoute = renderGatewayBar({
      ...snapshot,
      gateway: {
        ...snapshot.gateway,
        requestedModel: `claude-${"x".repeat(200)}\u202e`,
        upstreamModel: "gpt-5.6-terra"
      }
    });
    assert.equal(hostileLongRoute, "gw active · route [cut]");
    assert.doesNotMatch(hostileLongRoute, /claude-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status projection does not sweep malformed presence while polling", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "presence"), { recursive: true });
    const malformed = join(root, "presence", "malformed.json");
    writeFileSync(malformed, "not-json\n");
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(readFileSync(malformed, "utf8"), "not-json\n");
    assert.equal(snapshot.presence.degraded, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a valid JSON file with an invalid loop shape renders L? instead of zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "loops", "invalid-loop"), { recursive: true });
    writeFileSync(
      join(root, "loops", "invalid-loop", "state.json"),
      JSON.stringify({ id: "invalid-loop", status: "running" })
    );
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.match(renderWorkloadBar(snapshot), /L\?/);
    assert.doesNotThrow(() => renderHumanStatus(snapshot));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loop attention includes fail-closed attendance and terminal blocked work", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  const policy = {
    tickMs: 1000,
    idleMs: 1000,
    maxRelaunches: 1,
    requireHumanTypingGuard: true,
    autoTick: true,
    closeWhenRefsSatisfied: false,
    successCriteria: "all-targets-accepted",
    decisionGatePolicy: "all-go-or-waived"
  };
  try {
    for (const [id, status] of [["unattended", "running"], ["blocked", "blocked"]]) {
      mkdirSync(join(root, "loops", id), { recursive: true });
      writeFileSync(
        join(root, "loops", id, "state.json"),
        JSON.stringify({
          id,
          ownerSystem: "h2a",
          name: id,
          goal: "ship",
          status,
          repos: [],
          refs: [],
          agents: [],
          policy,
          createdAt: "2026-07-25T10:00:00.000Z",
          updatedAt: "2026-07-25T11:00:00.000Z"
        })
      );
    }
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo", ownerInstance: "codex:owner:abc" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.loops.active, 1);
    assert.equal(snapshot.loops.attention, 2);
    assert.match(renderWorkloadBar(snapshot), /L1!2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the workload segment does not poll the gateway snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  let requested;
  let output = "";
  try {
    const exit = await runStatusSurfaceCli(
      {
        bar: "true",
        segment: "workload",
        "tmux-session": "h2a-demo",
        "owner-instance": "codex:owner:abc"
      },
      {
        stdout: { write: (chunk) => { output += chunk; } },
        stderr: { write: () => {} }
      },
      {
        root,
        projectRuntime: async (input) => {
          requested = input;
          return { ...runtime(), managed: { degraded: false, agents: [] } };
        }
      }
    );
    assert.equal(exit, 0);
    assert.equal(requested.includeGateway, false);
    assert.equal(requested.includeManagedInventory, false);
    assert.equal(output, "J0 I? L?\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the gateway segment does not request delegated-work projection", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  let requested;
  try {
    const exit = await runStatusSurfaceCli(
      { bar: "true", segment: "gateway", "tmux-session": "h2a-demo" },
      { stdout: { write: () => {} }, stderr: { write: () => {} } },
      {
        root,
        projectRuntime: async (input) => {
          requested = input;
          return runtime();
        }
      }
    );
    assert.equal(exit, 0);
    assert.equal(requested.includeDelegations, false);
    assert.equal(requested.includeManagedInventory, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the detailed watcher defaults to the same bounded five-second poll", () => {
  assert.equal(statusWatchIntervalMs(undefined), 5000);
  assert.equal(statusWatchIntervalMs("750ms"), 750);
});

test("watch polling removes each abort listener after the timer wins", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), 620);
  try {
    const exit = await runStatusSurfaceCli(
      {
        human: "true",
        watch: "true",
        interval: "250ms",
        "tmux-session": "h2a-demo"
      },
      {
        stdout: { write: () => {} },
        stderr: { write: () => {} }
      },
      {
        root,
        signal: controller.signal,
        projectRuntime: async () => runtime()
      }
    );
    assert.equal(exit, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    clearTimeout(stop);
    rmSync(root, { recursive: true, force: true });
  }
});
