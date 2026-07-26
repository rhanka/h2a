import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEventListeners } from "node:events";
import test from "node:test";

import {
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

test("status bar distinguishes an absent h2a session from a present empty session", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    const present = await readStatusSnapshot(
      { root },
      { projectRuntime: async () => ({ ...runtime(), managed: { degraded: false, agents: [] } }) }
    );
    assert.equal(present.tmuxSession, "h2a-demo");
    assert.equal(renderWorkloadBar(present), "A0!? D0 I0 L0");

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
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(renderWorkloadBar(snapshot), "A2!1+ D1 I1 L1!1");
    assert.equal(
      renderGatewayBar(snapshot),
      "gw active · claude-opus-5-xhigh→gpt-5.6-terra · acct work-codex"
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
      "gw active · claude-opus-5-xhigh→gpt-5.6-terra · acct acct-a→work-codex"
    );
    const human = renderHumanStatus(snapshot);
    assert.match(human, /codex:owner:abc~reviewer/);
    assert.match(human, /last routed env:delegated to inbox/);
    assert.match(human, /from claude:peer:def/);
    assert.match(human, /loop-one  waiting-human/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inbox counts registered offline owners once across canonical and raw paths", async () => {
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
    writeFileSync(
      join(root, "registry", "instances.jsonl"),
      `${JSON.stringify({ id: "owner", instance: "Codex:Owner:ABC", roles: [], scopes: [], capabilities: [] })}\n`
    );
    for (const directory of ["codex__owner__abc", "Codex__Owner__ABC"]) {
      mkdirSync(join(root, "inbox", directory), { recursive: true });
      writeFileSync(join(root, "inbox", directory, "env-offline.json"), JSON.stringify(envelope));
    }
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.inbox.waiting, 1);
    assert.equal(snapshot.inbox.degraded, false);
    assert.match(renderWorkloadBar(snapshot), /I1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an orphan inbox is unknown rather than confidently counted", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
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
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.inbox.waiting, 0);
    assert.equal(snapshot.inbox.degraded, true);
    assert.match(renderWorkloadBar(snapshot), /I\?/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status bar renders unknown instead of zero when a source is malformed", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  try {
    mkdirSync(join(root, "registry"), { recursive: true });
    writeFileSync(join(root, "registry", "subagents.jsonl"), "not-json\n");
    const snapshot = await readStatusSnapshot(
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.match(renderWorkloadBar(snapshot), /D\?/);
    assert.doesNotMatch(renderWorkloadBar(snapshot), /D0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("contract-invalid delegation rows render D? instead of false state", async () => {
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
      { root, tmuxSession: "h2a-demo" },
      { projectRuntime: async () => runtime() }
    );
    assert.equal(snapshot.subagents.addressable, 0);
    assert.equal(snapshot.subagents.degraded, true);
    assert.match(renderWorkloadBar(snapshot), /D\?/);
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

test("the workload segment does not poll the gateway snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-status-"));
  let requested;
  let output = "";
  try {
    const exit = await runStatusSurfaceCli(
      {
        bar: "true",
        segment: "workload",
        "tmux-session": "h2a-demo"
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
    assert.equal(output, "A0!? D0 I0 L0\n");
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
