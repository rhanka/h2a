import assert from "node:assert/strict";
import test from "node:test";

import {
  h2aStatusSurfaceOptions,
  h2aStatusWindowCommand,
  installH2aStatusSurfaceWithAccess,
  uninstallH2aStatusSurfaceWithAccess
} from "../../h2a-runtime/dist/tmux.js";
import {
  projectDelegatedExecutions,
  readNativeStatusBarSnapshot,
  renderNativeStatusBarLine,
  uniqueManagedWork
} from "../../h2a-runtime/dist/status-projection.js";
import {
  legacyClientSessionIdFromJournal,
  migrateTmuxNames,
  planTmuxNameMigration
} from "../../h2a-runtime/dist/tmux-name-migration.js";
import {
  gatewayModeForProfile,
  profileUsesLlmMeshGateway
} from "../../h2a-runtime/dist/protocol-local.js";
import {
  replaceAnthropicGatewayEnvironment,
} from "../../h2a-runtime/dist/gateway-host/daemon.js";
import {
  describeLlmMeshRoutingConfig,
  preferredRoutingConfig,
  strategyRoutingConfig
} from "../../h2a-runtime/dist/routing-preferences.js";

const session = (name, tmuxId = "$1", identity = {}) => ({
  tmuxId,
  tmuxCreatedAt: identity.createdAt ?? "1770000000",
  tmuxServerPid: identity.serverPid ?? "4321",
  tmuxSocketPath: identity.socketPath ?? "/tmp/tmux-1000/default",
  name,
  slug: name.replace(/^(?:h2a-|remote-)/, ""),
  profile: "claude",
  path: "/workspace",
  attached: false
});

test("runtime exposes only public Sentropic routing controls", () => {
  const preferred = preferredRoutingConfig(undefined, ["codex", "cloud-code"]);
  const described = describeLlmMeshRoutingConfig(preferred);
  assert.deepEqual(described.strategy, {
    kind: "ordered",
    preferences: [
      { transportProviderId: "codex" },
      { transportProviderId: "cloud-code" }
    ]
  });
  assert.equal(JSON.stringify(described).includes("accountId"), false);
  assert.equal(JSON.stringify(described).includes("gpt-5.6"), false);

  const roundRobin = strategyRoutingConfig(preferred, "round-robin");
  assert.deepEqual(describeLlmMeshRoutingConfig(roundRobin).strategy, {
    kind: "round-robin",
    scope: "new-affinity"
  });
});

test("only Claude profiles consume the Anthropic-compatible gateway", () => {
  assert.equal(profileUsesLlmMeshGateway("claude"), true);
  assert.equal(profileUsesLlmMeshGateway("claude-code"), true);
  for (const profile of ["codex", "agy", "gemini", "opencode", "mistral", "shell"]) {
    assert.equal(profileUsesLlmMeshGateway(profile), false, profile);
    assert.equal(gatewayModeForProfile(profile, "auto"), "direct", profile);
    assert.equal(gatewayModeForProfile(profile, "gateway"), "direct", profile);
  }
  // Owner decision (2026-09): direct unless the gateway is asked for EXPLICITLY.
  // The non-explicit "auto" now resolves to direct for Claude too; only an
  // explicit "gateway" engages it, and "direct" stays direct.
  assert.equal(gatewayModeForProfile("claude", "auto"), "direct");
  assert.equal(gatewayModeForProfile("claude", "gateway"), "gateway");
  assert.equal(gatewayModeForProfile("claude", "direct"), "direct");
});

test("delegated launch gateway env is scrubbed and restores the caller exactly", () => {
  const env = {
    ANTHROPIC_BASE_URL: "http://old.invalid",
    ANTHROPIC_AUTH_TOKEN: "old-token",
    UNRELATED: "kept"
  };
  const restore = replaceAnthropicGatewayEnvironment(env, {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:3002",
    ANTHROPIC_AUTH_TOKEN: "new-token",
    ANTHROPIC_API_KEY: "new-token"
  });
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "new-token");
  assert.equal(env.UNRELATED, "kept");
  restore();
  assert.deepEqual(env, {
    ANTHROPIC_BASE_URL: "http://old.invalid",
    ANTHROPIC_AUTH_TOKEN: "old-token",
    UNRELATED: "kept"
  });
});

test("delegated-execution projection fails closed without owner provenance or live child evidence", () => {
  const base = {
    id: "plugin-review",
    tool: "codex",
    kind: "local-tmux",
    cwd: "/workspace",
    enrolledAt: "2026-07-26T12:00:00.000Z",
    lastSeenAt: "2026-07-26T12:00:00.000Z",
    source: "run",
    sessionClass: "background",
    tmuxSession: "h2a-plugin-review",
    pid: 4242,
    delegationOrigin: "cli:h2a-delegate",
    delegatorInstance: "codex:owner:abc",
    delegatorTmuxSession: "h2a-owner"
  };
  const live = projectDelegatedExecutions(
    [base],
    true,
    [session("h2a-owner"), session("h2a-plugin-review")],
    "h2a-owner",
    "codex:owner:abc",
    [],
    true,
    () => 4242,
  );
  assert.equal(live.degraded, false);
  assert.deepEqual(live.executions.map((item) => item.id), ["plugin-review"]);

  const wrongOwner = projectDelegatedExecutions(
    [base],
    true,
    [session("h2a-owner"), session("h2a-plugin-review")],
    "h2a-owner",
    "codex:other:def",
    [],
    true,
    () => 4242,
  );
  assert.equal(wrongOwner.degraded, false);
  assert.equal(wrongOwner.executions.length, 0);

  const unproven = { ...base, delegationOrigin: undefined };
  const unknown = projectDelegatedExecutions(
    [unproven],
    true,
    [session("h2a-owner"), session("h2a-plugin-review")],
    "h2a-owner",
    "codex:owner:abc"
  );
  assert.equal(unknown.degraded, true);
  assert.equal(unknown.executions.length, 0);

  const serverAttested = projectDelegatedExecutions(
    [{
      ...base,
      delegationOrigin: undefined,
      delegatorInstance: undefined,
      delegatorTmuxSession: undefined
    }],
    true,
    [session("h2a-owner"), session("h2a-plugin-review")],
    "h2a-owner",
    "codex:owner:abc",
    [{
      workerTmuxSession: "h2a-plugin-review",
      workerPid: 4242,
      origin: "mcp:h2a_run",
      delegatorInstance: "codex:owner:abc",
      delegatorTmuxSession: "h2a-owner"
    }],
    true,
    () => 4242,
  );
  assert.equal(serverAttested.degraded, false);
  assert.deepEqual(serverAttested.executions.map((item) => item.id), ["plugin-review"]);

  const replayedName = projectDelegatedExecutions(
    [{
      ...base,
      pid: 9999,
      delegationOrigin: undefined,
      delegatorInstance: undefined,
      delegatorTmuxSession: undefined
    }],
    true,
    [session("h2a-owner"), session("h2a-plugin-review")],
    "h2a-owner",
    "codex:owner:abc",
    [{
      workerTmuxSession: "h2a-plugin-review",
      workerPid: 4242,
      origin: "mcp:h2a_run",
      delegatorInstance: "codex:owner:abc",
      delegatorTmuxSession: "h2a-owner"
    }],
    true,
    () => 9999,
  );
  assert.equal(replayedName.degraded, true);
  assert.equal(replayedName.executions.length, 0);

  const vanished = projectDelegatedExecutions(
    [base],
    true,
    [session("h2a-owner")],
    "h2a-owner",
    "codex:owner:abc"
  );
  assert.equal(vanished.degraded, true);
  assert.equal(vanished.executions.length, 0);
});

test("tmux status surface uses bounded five-second polling and no cache", () => {
  const priorRoot = process.env.H2A_ROOT;
  // Keep the test independent of the checkout path; cache-path checkouts used to fail /cache/i spuriously.
  process.env.H2A_ROOT = "/tmp/h2a-status-surface-test-root";
  try {
    const options = Object.fromEntries(h2aStatusSurfaceOptions());
    assert.equal(options["status-interval"], "5");
    // The storm was #(h2a status …) re-run per refresh per session. The bar must
    // now be a cheap file read with a static placeholder, never a node spawn — if
    // #(h2a status returns here, the storm is back.
    assert.doesNotMatch(options["status-left"], /#\(h2a status/);
    assert.doesNotMatch(options["status-right"], /#\(h2a status/);
    assert.match(options["status-left"], /#\(cat .*echo 'h2a \?'\)/);
    assert.match(options["status-right"], /#\(cat .*echo 'gw \?'\)/);
    assert.doesNotMatch(options["status-left"], /#\{session_name\}|#\{window_name\}/);
    assert.doesNotMatch(options["status-left"], /remote-/);
    assert.doesNotMatch(JSON.stringify(options), /cache/i);
    const hostilePriorRight = "#{pane_title}\u202e".repeat(100);
    const installedRight = Object.fromEntries(h2aStatusSurfaceOptions(hostilePriorRight))["status-right"];
    assert.match(installedRight, /%H:%M$/);
    assert.doesNotMatch(installedRight, /pane_title|\u202e/);
    assert.match(
      h2aStatusWindowCommand("h2a-owner", "codex:owner:abc"),
      /--owner-instance 'codex:owner:abc'/,
    );
    assert.doesNotMatch(
      h2aStatusWindowCommand("h2a-owner", "owner; rm -rf /"),
      /owner-instance/,
    );
  } finally {
    if (priorRoot === undefined) delete process.env.H2A_ROOT;
    else process.env.H2A_ROOT = priorRoot;
  }
});

function statusOptionFixture(failOnce = () => false) {
  const values = new Map([
    ["status", "on"],
    ["status-left", "original-left"],
    ["status-right", ""],
    ["status-interval", "15"],
    ["status-left-length", "22"],
    ["status-right-length", "33"]
  ]);
  const access = {
    read: (_session, option) => values.get(option),
    set: (_session, option, value) => {
      if (failOnce(option, value)) return false;
      values.set(option, value);
      return true;
    },
    unset: (_session, option) => {
      values.delete(option);
      return true;
    }
  };
  return { values, access };
}

test("tmux status install is failure-atomic and preserves an empty status-right", () => {
  let failed = false;
  const liveFailure = statusOptionFixture((option, value) => {
    if (!failed && option === "status-left" && value.includes("#(cat")) {
      failed = true;
      return true;
    }
    return false;
  });
  assert.equal(installH2aStatusSurfaceWithAccess("h2a-demo", liveFailure.access), false);
  assert.deepEqual(
    Object.fromEntries([...liveFailure.values].filter(([key]) => !key.startsWith("@h2a_"))),
    {
      status: "on",
      "status-left": "original-left",
      "status-right": "",
      "status-interval": "15",
      "status-left-length": "22",
      "status-right-length": "33"
    }
  );
  assert.equal([...liveFailure.values.keys()].some((key) => key.startsWith("@h2a_")), false);

  const success = statusOptionFixture();
  assert.equal(installH2aStatusSurfaceWithAccess("h2a-demo", success.access), true);
  assert.match(success.values.get("status-left"), /#\(cat /);
  assert.equal(uninstallH2aStatusSurfaceWithAccess("h2a-demo", success.access), true);
  assert.equal(success.values.get("status-right"), "");
  assert.equal(success.values.get("status-left"), "original-left");
});

test("tmux status install does not mutate live options if snapshot capture fails", () => {
  let failed = false;
  const fixture = statusOptionFixture((option) => {
    if (!failed && option === "@h2a_status_previous_right") {
      failed = true;
      return true;
    }
    return false;
  });
  const before = new Map(fixture.values);
  assert.equal(installH2aStatusSurfaceWithAccess("h2a-demo", fixture.access), false);
  assert.deepEqual(fixture.values, before);
});

test("status counts a delegated job and its exact tmux row as one work item", () => {
  const common = {
    ownerSystem: "remote",
    authoritativeForObjectiveState: false,
    tool: "codex",
    state: "running",
    cwd: "/workspace",
    tmuxSession: "h2a-job-one",
    sources: [],
    conflicts: [],
    capabilities: {
      attach: true,
      logs: true,
      remote: false,
      objectiveStateAuthority: false
    }
  };
  const result = uniqueManagedWork([
    { ...common, id: "job:one", kind: "delegated-job" },
    { ...common, id: "local:job-one", kind: "local-session" }
  ]);
  assert.deepEqual(result.map((agent) => agent.id), ["job:one"]);
});

test("tmux migration refuses collisions and journals reversible exact renames", () => {
  const collision = planTmuxNameMigration([session("remote-demo"), session("h2a-demo")]);
  assert.deepEqual(collision, [{
    tmuxSessionId: "$1",
    tmuxSessionCreatedAt: "1770000000",
    tmuxServerPid: "4321",
    tmuxSocketPath: "/tmp/tmux-1000/default",
    oldName: "remote-demo",
    newName: "h2a-demo",
    collision: true
  }]);

  let sessions = [session("remote-one", "$1"), session("remote-two", "$2")];
  let journal;
  const registryUpdates = [];
  const deps = {
    listSessions: () => sessions,
    renameSession: (oldName, newName) => {
      const item = sessions.find((entry) => entry.name === oldName);
      if (!item || sessions.some((entry) => entry.name === newName)) return false;
      sessions = sessions.map((entry) =>
        entry === item ? session(newName, entry.tmuxId) : entry
      );
      return true;
    },
    updateRegistry: (oldName, newName) => {
      registryUpdates.push([oldName, newName]);
      return 1;
    },
    readJournal: () => journal,
    writeJournal: (value) => { journal = structuredClone(value); },
    now: () => "2026-07-25T12:00:00.000Z"
  };
  const applied = migrateTmuxNames("apply", deps);
  assert.equal(applied.changed, 2);
  assert.deepEqual(sessions.map((entry) => entry.name), ["h2a-one", "h2a-two"]);
  assert.equal(journal.entries.every((entry) => entry.state === "applied"), true);

  const rolledBack = migrateTmuxNames("rollback", deps);
  assert.equal(rolledBack.changed, 2);
  assert.deepEqual(sessions.map((entry) => entry.name), ["remote-one", "remote-two"]);
  assert.deepEqual(registryUpdates, [
    ["remote-one", "h2a-one"],
    ["remote-two", "h2a-two"],
    ["h2a-two", "remote-two"],
    ["h2a-one", "remote-one"]
  ]);
});

test("tmux migration resumes a rename interrupted before its registry update", () => {
  let journal = {
    version: 1,
    createdAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:00:00.000Z",
    entries: [{
      tmuxSessionId: "$7",
      tmuxSessionCreatedAt: "1770000000",
      tmuxServerPid: "4321",
      tmuxSocketPath: "/tmp/tmux-1000/default",
      oldName: "remote-recover",
      newName: "h2a-recover",
      state: "renamed",
      registryEntriesUpdated: 0
    }]
  };
  const registryUpdates = [];
  const recovered = migrateTmuxNames("apply", {
    listSessions: () => [session("h2a-recover", "$7")],
    renameSession: () => { throw new Error("already renamed; must not run"); },
    updateRegistry: (oldName, newName) => {
      registryUpdates.push([oldName, newName]);
      return 1;
    },
    readJournal: () => journal,
    writeJournal: (value) => { journal = structuredClone(value); },
    now: () => "2026-07-25T12:01:00.000Z"
  });
  assert.equal(recovered.changed, 0);
  assert.equal(recovered.warnings.length, 0);
  assert.equal(journal.entries[0].state, "applied");
  assert.deepEqual(registryUpdates, [["remote-recover", "h2a-recover"]]);
});

test("tmux migration refuses corrupt journals and changed tmux identities", () => {
  let renameCalls = 0;
  const corrupt = migrateTmuxNames("apply", {
    listSessions: () => [session("remote-safe", "$4")],
    renameSession: () => { renameCalls += 1; return true; },
    updateRegistry: () => 1,
    readJournal: () => { throw new Error("tmux name migration journal is invalid"); },
    writeJournal: () => {},
    now: () => "2026-07-25T12:00:00.000Z"
  });
  assert.equal(corrupt.changed, 0);
  assert.match(corrupt.warnings[0], /journal is invalid/);
  assert.equal(renameCalls, 0);

  const identityChanged = migrateTmuxNames("rollback", {
    listSessions: () => [session("h2a-safe", "$4", { createdAt: "1770000999" })],
    renameSession: () => { renameCalls += 1; return true; },
    updateRegistry: () => 1,
    readJournal: () => ({
      version: 1,
      createdAt: "2026-07-25T12:00:00.000Z",
      updatedAt: "2026-07-25T12:00:00.000Z",
      entries: [{
        tmuxSessionId: "$4",
        tmuxSessionCreatedAt: "1770000000",
        tmuxServerPid: "4321",
        tmuxSocketPath: "/tmp/tmux-1000/default",
        oldName: "remote-safe",
        newName: "h2a-safe",
        state: "applied",
        registryEntriesUpdated: 1
      }]
    }),
    writeJournal: () => {},
    now: () => "2026-07-25T12:00:00.000Z"
  });
  assert.equal(identityChanged.changed, 0);
  assert.match(identityChanged.warnings[0], /identity changed/);
  assert.equal(renameCalls, 0);
});

test("journalled rename correlation survives rename but refuses server identity reuse", () => {
  const migrated = session("h2a-demo", "$7");
  const journal = {
    version: 1,
    createdAt: "2026-07-25T12:00:00.000Z",
    updatedAt: "2026-07-25T12:00:00.000Z",
    entries: [{
      tmuxSessionId: "$7",
      tmuxSessionCreatedAt: migrated.tmuxCreatedAt,
      tmuxServerPid: migrated.tmuxServerPid,
      tmuxSocketPath: migrated.tmuxSocketPath,
      oldName: "remote-demo",
      newName: "h2a-demo",
      state: "applied",
      registryEntriesUpdated: 1
    }]
  };
  assert.equal(legacyClientSessionIdFromJournal(migrated, journal), "remote-demo");
  assert.equal(
    legacyClientSessionIdFromJournal(
      session("h2a-demo", "$7", { serverPid: "9876" }),
      journal
    ),
    undefined
  );
});

test("native status bar projection counts local-native delegated workers and formats left/right segments", () => {
  const nativeWorker = {
    id: "native-worker-1",
    tool: "codex",
    kind: "local-native",
    cwd: "/workspace",
    enrolledAt: "2026-11-11T12:00:00.000Z",
    lastSeenAt: "2026-11-11T12:00:00.000Z",
    source: "run",
    role: "job",
    jobState: "running",
    sessionClass: "background",
    tmuxSession: "h2a-native-worker-1",
    pid: 5151,
    delegationOrigin: "cli:h2a-delegate",
    delegatorInstance: "claude:conductor:01",
    delegatorTmuxSession: "h2a-alpha"
  };

  const projected = projectDelegatedExecutions(
    [nativeWorker],
    true,
    [],
    "h2a-alpha",
    "claude:conductor:01",
    [],
    true,
    () => undefined,
    (sessionName) => (sessionName === "h2a-native-worker-1" ? 5151 : undefined)
  );
  assert.equal(projected.degraded, false);
  assert.deepEqual(projected.executions.map((item) => item.id), ["native-worker-1"]);

  const line = renderNativeStatusBarLine(
    {
      cli: "claude",
      sessionName: "h2a-alpha",
      linkState: "attached",
      role: "conductor",
      workload: {
        j: { open: 1, attention: 0, degraded: false },
        i: { waiting: 2, degraded: false },
        l: { active: 1, attention: 1, degraded: false }
      },
      delegatedSessions: 1,
      gateway: {
        state: "active",
        clientSessionId: "h2a-alpha",
        requestedModel: "claude-opus-4-6",
        upstreamModel: "claude-sonnet-4-6"
      }
    },
    120
  );
  assert.equal(line.length, 120);
  assert.match(line, /^ claude · h2a-alpha · attached/);
  assert.match(line, /J1 I2 L1!1 · role conductor · gw active · claude-opus-4-6→claude-sonnet-4-6 · deleg 1 $/);
});

test("Angle B 1-7: readNativeStatusBarSnapshot enforces real H2ASession schema, no sessionClass role fallback, auto gateway posture, loop/inbox contracts, and delegated liveness", async () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const root = mkdtempSync(join(tmpdir(), "h2a-status-truth-"));
  try {
    const now = 1_760_000_000_000;
    const registryPath = join(root, "registry.json");
    const h2aRoot = join(root, ".h2a");
    mkdirSync(join(h2aRoot, "presence"), { recursive: true });
    mkdirSync(join(h2aRoot, "registry"), { recursive: true });
    mkdirSync(join(h2aRoot, "inbox", "claude__conductor__01~Researcher"), { recursive: true });
    mkdirSync(join(h2aRoot, "loops", "loop-active"), { recursive: true });
    mkdirSync(join(h2aRoot, "loops", "loop-stopped"), { recursive: true });
    mkdirSync(join(h2aRoot, "loops", "loop-blocked"), { recursive: true });

    // Entry has sessionClass: "human", no role, and NO explicit gatewayMode (should default to "auto", not "disabled")
    // Also has 1 live background worker (process.pid), 1 dead-PID worker (99999999), and 1 finished worker (endedAt set, jobState: "done")
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "alpha",
            label: "alpha",
            tmuxSession: "h2a-alpha",
            tool: "claude",
            kind: "local-native",
            cwd: root,
            source: "run",
            sessionClass: "human",
            enrolledAt: new Date(now - 60_000).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
          },
          {
            id: "worker-live",
            label: "worker-live",
            tmuxSession: "h2a-worker-live",
            tool: "codex",
            kind: "local-native",
            cwd: root,
            source: "run",
            role: "job",
            jobState: "running",
            sessionClass: "background",
            pid: process.pid,
            delegationOrigin: "cli:h2a-delegate",
            delegatorInstance: "claude:conductor:01",
            delegatorTmuxSession: "h2a-alpha",
            enrolledAt: new Date(now - 30_000).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
          },
          {
            id: "worker-stopped-bg",
            label: "worker-stopped-bg",
            tmuxSession: "h2a-worker-live",
            tool: "codex",
            kind: "local-native",
            cwd: root,
            source: "run",
            sessionClass: "background",
            endedAt: new Date(now - 10_000).toISOString(),
            pid: 999_999_999,
            delegationOrigin: "cli:h2a-delegate",
            delegatorInstance: "claude:conductor:01",
            delegatorTmuxSession: "h2a-alpha",
            enrolledAt: new Date(now - 50_000).toISOString(),
            lastSeenAt: new Date(now - 10_000).toISOString(),
          },
          {
            id: "worker-finished",
            label: "worker-finished",
            tmuxSession: "h2a-worker-finished",
            tool: "codex",
            kind: "local-native",
            cwd: root,
            source: "run",
            role: "job",
            jobState: "done",
            endedAt: new Date(now - 5_000).toISOString(),
            sessionClass: "background",
            pid: process.pid,
            delegationOrigin: "cli:h2a-delegate",
            delegatorInstance: "claude:conductor:01",
            delegatorTmuxSession: "h2a-alpha",
            enrolledAt: new Date(now - 30_000).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
          },
        ],
      }),
    );

    // 1) Write a CLOSED presence file -> must be ignored!
    writeFileSync(
      join(h2aRoot, "presence", "sess-closed.json"),
      JSON.stringify({
        sessionId: "sess-closed",
        instance: "closed:instance:01",
        pid: process.pid,
        startedAt: new Date(now - 60_000).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        state: "closed",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: [],
        launchContext: { cwd: root, command: "h2a mcp-serve", nativePty: { session: "h2a-alpha" } },
      }),
    );
    // 2) Write a STALE presence file (> 90s old heartbeatAt) -> must be ignored!
    writeFileSync(
      join(h2aRoot, "presence", "sess-stale.json"),
      JSON.stringify({
        sessionId: "sess-stale",
        instance: "stale:instance:01",
        pid: process.pid,
        startedAt: new Date(now - 200_000).toISOString(),
        heartbeatAt: new Date(now - 120_000).toISOString(),
        state: "live",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: [],
        launchContext: { cwd: root, command: "h2a mcp-serve", nativePty: { session: "h2a-alpha" } },
      }),
    );
    // 3) Write a DEAD-PID local presence file -> must be ignored!
    writeFileSync(
      join(h2aRoot, "presence", "sess-dead-pid.json"),
      JSON.stringify({
        sessionId: "sess-dead-pid",
        instance: "dead:instance:01",
        pid: 999_999_999,
        startedAt: new Date(now - 60_000).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        state: "live",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: [],
        launchContext: { cwd: root, command: "h2a mcp-serve", nativePty: { session: "h2a-alpha" } },
      }),
    );
    // 4) Write a REAL live H2ASession presence file (with no role anywhere when loop has no role)
    writeFileSync(
      join(h2aRoot, "presence", "sess-live.json"),
      JSON.stringify({
        sessionId: "sess-live",
        instance: "claude:conductor:01",
        host: "claude",
        pid: process.pid,
        startedAt: new Date(now - 60_000).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        state: "live",
        interests: { scopes: [], negotiations: [] },
        subscribedTopics: [],
        launchContext: { cwd: root, command: "h2a mcp-serve", nativePty: { session: "h2a-alpha" } },
      }),
    );

    // Subagent with `~` and uppercase name: claude:conductor:01~Researcher
    writeFileSync(
      join(h2aRoot, "registry", "subagents.jsonl"),
      `${JSON.stringify({
        id: "claude:conductor:01~Researcher",
        parentInstance: "claude:conductor:01",
        name: "Researcher",
        createdAt: new Date(now - 30_000).toISOString(),
      })}\n`,
    );
    writeFileSync(join(h2aRoot, "registry", "subagent-audit.jsonl"), "");
    writeFileSync(join(h2aRoot, "registry", "instances.jsonl"), "");

    // Valid envelope in subagent inbox (preserving `~` and uppercase in directory name)
    writeFileSync(
      join(h2aRoot, "inbox", "claude__conductor__01~Researcher", "valid.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env:sub:1",
        type: "propose",
        actor: { instance: "codex:worker:01", role: "AGENTS", scope: "scope:default" },
        body: { topic: "plan" },
        createdAt: new Date(now - 1_000).toISOString(),
      }),
    );

    // Active loop with autoTick: true and stale executor heartbeat -> active = 1, attention = 1!
    // Stopped and blocked loops -> terminal, must NOT be counted as active!
    writeFileSync(
      join(h2aRoot, "loops", "loop-active", "state.json"),
      JSON.stringify({
        id: "loop-active",
        ownerSystem: "h2a",
        name: "Active loop",
        goal: "test",
        status: "running",
        repos: [],
        refs: [],
        agents: [],
        policy: { autoTick: true },
        executor: {
          pid: process.pid,
          heartbeat: new Date(now - 600_000).toISOString(),
        },
        createdAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
    );
    writeFileSync(
      join(h2aRoot, "loops", "loop-stopped", "state.json"),
      JSON.stringify({
        id: "loop-stopped",
        ownerSystem: "h2a",
        name: "Stopped loop",
        goal: "test",
        status: "stopped",
        repos: [],
        refs: [],
        agents: [],
        policy: {},
        createdAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
    );
    writeFileSync(
      join(h2aRoot, "loops", "loop-blocked", "state.json"),
      JSON.stringify({
        id: "loop-blocked",
        ownerSystem: "h2a",
        name: "Blocked loop",
        goal: "test",
        status: "blocked",
        repos: [],
        refs: [],
        agents: [],
        policy: {},
        createdAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
    );

    const snapshot = await readNativeStatusBarSnapshot({
      sessionName: "h2a-alpha",
      linkState: "attached",
      registryPath,
      h2aRoot,
      gatewayBaseUrl: "http://127.0.0.1:43199",
      nowMs: now,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });

    // Role must NOT fall back to sessionClass ("human")!
    assert.equal(snapshot.role, "unknown");
    const rendered = renderNativeStatusBarLine(snapshot, 120);
    assert.doesNotMatch(rendered, /role human/);
    assert.match(rendered, /role \?/);

    // Gateway posture defaulted to "auto" -> resolved via resolveResumedGatewayMode to "direct" -> state "off" (gw off, NOT gw ?)
    assert.equal(snapshot.gateway?.state, "off");

    // Subagent ~ inbox counted 1 valid message
    assert.equal(snapshot.workload?.i.waiting, 1);
    assert.equal(snapshot.workload?.i.degraded, false);

    // Loops: only loop-active is counted (1 active, 1 attention due to stale executor heartbeat); stopped & blocked are terminal
    assert.equal(snapshot.workload?.l.active, 1);
    assert.equal(snapshot.workload?.l.attention, 1);
    assert.equal(snapshot.workload?.l.degraded, false);

    // Delegated sessions: only worker-live is counted (worker-stopped-bg has endedAt set, worker-finished has endedAt & jobState=done)
    assert.equal(snapshot.delegatedSessions, 1);
    assert.equal(snapshot.workload?.j.open, 1);
    assert.equal(snapshot.workload?.j.degraded, false);

    // Now add an invalid-type envelope in inbox, a legacy fake-schema presence file, and a loop directory missing state.json -> fail-closed degradation
    writeFileSync(
      join(h2aRoot, "inbox", "claude__conductor__01~Researcher", "bad-type.json"),
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        id: "env:sub:bad",
        type: "not-an-envelope-type",
        actor: { instance: "codex:worker:01", role: "AGENTS", scope: "scope:default" },
        body: {},
        createdAt: new Date(now - 1_000).toISOString(),
      }),
    );
    writeFileSync(
      join(h2aRoot, "presence", "sess-fake-schema.json"),
      JSON.stringify({
        sessionId: "sess-fake-schema",
        instance: "fake:instance:01",
        expiresAt: new Date(now + 60_000).toISOString(),
        launchContext: { nativePty: { session: "h2a-alpha" } },
      }),
    );
    mkdirSync(join(h2aRoot, "loops", "loop-corrupt-empty"), { recursive: true });
    const degradedSnap = await readNativeStatusBarSnapshot({
      sessionName: "h2a-alpha",
      linkState: "attached",
      registryPath,
      h2aRoot,
      nowMs: now,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    assert.equal(degradedSnap.workload?.i.degraded, true);
    assert.equal(degradedSnap.workload?.l.degraded, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Angle B 3: H2A_NATIVE_PTY_SESSION is injected for native sessions and takes precedence over inherited TMUX_PANE", async () => {
  const { currentTmuxSessionForSidecar } = await import("../dist/runtime/mcp/stdio.js");
  // Even when TMUX_PANE is set in the inherited environment, H2A_NATIVE_PTY_SESSION must win
  const resolved = currentTmuxSessionForSidecar({
    TMUX: "/tmp/tmux-1000/default,1234,0",
    TMUX_PANE: "%0",
    H2A_NATIVE_PTY_SESSION: "h2a-native-child",
  });
  assert.equal(resolved, "h2a-native-child");
});
