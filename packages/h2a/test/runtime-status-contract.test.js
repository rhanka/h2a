import assert from "node:assert/strict";
import test from "node:test";

import { describeCanonicalTargetRoutes } from "@sentropic/llm-gateway";
import {
  listModelCatalog,
  resetModelCatalogCache,
  resolveModelRoute
} from "../../h2a-runtime/dist/llm-gateway-runtime/model-catalog.js";
import {
  getSessionLedgerEntry,
  getSessionLedgerEntryForClient,
  recordSessionFallback,
  recordSessionIdle,
  recordSessionRateLimitComplete,
  recordSessionRateLimited,
  recordSessionRequest,
  resetSessionLedger,
  upsertSessionLedger
} from "../../h2a-runtime/dist/llm-gateway-runtime/session-ledger.js";
import {
  h2aStatusSurfaceOptions,
  h2aStatusWindowCommand,
  installH2aStatusSurfaceWithAccess,
  uninstallH2aStatusSurfaceWithAccess
} from "../../h2a-runtime/dist/tmux.js";
import {
  gatewayFromLedger,
  projectDelegatedExecutions,
  selectExactGatewayLedgerEntry,
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
import { toCodexRequest } from "../../h2a-runtime/dist/llm-gateway-runtime/proxy-openai.js";
import { replaceAnthropicGatewayEnvironment } from "../../h2a-runtime/dist/llm-mesh.js";

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

test("runtime routing is read from llm-gateway 0.10 canonical descriptions", () => {
  delete process.env.OPENAI_MODEL_MAP;
  resetModelCatalogCache();
  const described = describeCanonicalTargetRoutes();
  const catalog = listModelCatalog();
  const canonicalCatalog = catalog.filter((entry) =>
    described.some((route) => route.requestedId === entry.id)
  );
  assert.deepEqual(
    canonicalCatalog.map((entry) => [entry.id, entry.targetProviderId, entry.transportProviderId, entry.upstreamModel, entry.routeKind]),
    described.map((entry) => [entry.requestedId, entry.providerId, entry.transportProviderId, entry.model, entry.kind])
  );
  assert.deepEqual(
    catalog
      .filter((entry) => entry.transportProviderId === "cloud-code")
      .map((entry) => [entry.id, entry.targetProviderId, entry.upstreamModel, entry.routeKind]),
    [
      ["gemini-2.5-pro", "google", "gemini-2.5-pro", "faithful"],
      ["gemini-2.5-flash", "google", "gemini-2.5-flash", "faithful"]
    ]
  );
  assert.equal(resolveModelRoute("claude-opus-5-xhigh")?.upstreamModel, "gpt-5.6-terra");
  assert.equal(resolveModelRoute("claude-fable-5-max")?.upstreamModel, "gpt-5.6-sol");
  assert.equal(resolveModelRoute("claude-opus-4-8-xhigh"), undefined);
});

test("only Claude profiles can mint an Anthropic-compatible gateway session", () => {
  assert.equal(profileUsesLlmMeshGateway("claude"), true);
  assert.equal(profileUsesLlmMeshGateway("claude-code"), true);
  for (const profile of ["codex", "agy", "gemini", "opencode", "mistral", "shell"]) {
    assert.equal(profileUsesLlmMeshGateway(profile), false, profile);
    assert.equal(gatewayModeForProfile(profile, "auto"), "direct", profile);
    assert.equal(gatewayModeForProfile(profile, "gateway"), "direct", profile);
  }
  assert.equal(gatewayModeForProfile("claude", "auto"), "auto");
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

test("canonical alias effort overrides missing or conflicting thinking budgets", () => {
  const withoutThinking = toCodexRequest({
    model: "claude-fable-5-max",
    messages: [],
    max_tokens: 8
  }, "max");
  assert.deepEqual(withoutThinking.reasoning, { effort: "max" });
  const conflicting = toCodexRequest({
    model: "claude-opus-5-high",
    messages: [],
    max_tokens: 8,
    thinking: { type: "enabled", budget_tokens: 50_000 }
  }, "high");
  assert.deepEqual(conflicting.reasoning, { effort: "high" });
});

test("gateway ledger exposes concurrent active work and only explicit fallback transitions", () => {
  resetSessionLedger();
  const first = { id: "acct-a", provider: "openai", label: "Raw API key", token: "sk-secret-a" };
  const second = { id: "acct-b", provider: "openai", label: "work-codex", token: "sk-secret-b" };
  const route = resolveModelRoute("claude-opus-5-high");
  upsertSessionLedger({ gatewaySessionId: "gw-one", clientSessionId: "h2a-demo", account: first, route });
  recordSessionRequest("gw-one", route);
  recordSessionRequest("gw-one", route);
  assert.equal(getSessionLedgerEntry("gw-one")?.state, "active");
  assert.equal(getSessionLedgerEntry("gw-one")?.inFlightRequests, 2);
  assert.equal(getSessionLedgerEntry("gw-one")?.upstreamModel, undefined);
  recordSessionIdle("gw-one", route);
  assert.equal(getSessionLedgerEntry("gw-one")?.state, "active");
  assert.equal(getSessionLedgerEntry("gw-one")?.inFlightRequests, 1);
  recordSessionIdle("gw-one", route);
  recordSessionRequest("gw-one", route);
  recordSessionRateLimited("gw-one", first, { route, retryAfterMs: 30_000 });
  assert.equal(getSessionLedgerEntry("gw-one")?.state, "rate-limited");
  upsertSessionLedger({ gatewaySessionId: "gw-one", account: second, route });
  assert.equal(getSessionLedgerEntry("gw-one")?.lastFallback, undefined);
  recordSessionFallback("gw-one", first, second, route);
  recordSessionIdle("gw-one", route);
  const entry = getSessionLedgerEntry("gw-one");
  assert.equal(entry?.state, "idle");
  assert.equal(entry?.inFlightRequests, 0);
  assert.equal(entry?.lastFallback?.from.id, "acct-a");
  assert.equal(entry?.lastFallback?.to.id, "acct-b");
  assert.notEqual(entry?.upstreamModel, entry?.account.provider);
  assert.equal(JSON.stringify(entry).includes("sk-secret"), false);
  recordSessionRequest("gw-one");
  assert.equal(getSessionLedgerEntry("gw-one")?.requestedModel, undefined);
  assert.equal(getSessionLedgerEntry("gw-one")?.upstreamModel, undefined);
});

test("gateway route stays unknown until an outbound dispatch is recorded", () => {
  resetSessionLedger();
  const account = { id: "acct-a", provider: "openai", label: "work", token: "secret" };
  const route = resolveModelRoute("claude-opus-5-high");
  upsertSessionLedger({
    gatewaySessionId: "gw-not-yet-dispatched",
    clientSessionId: "h2a-owner",
    account,
    route,
  });
  assert.equal(getSessionLedgerEntry("gw-not-yet-dispatched")?.requestedModel, undefined);
  assert.equal(getSessionLedgerEntryForClient("h2a-owner")?.upstreamModel, undefined);
  recordSessionRequest("gw-not-yet-dispatched", route);
  assert.equal(getSessionLedgerEntryForClient("h2a-owner")?.upstreamModel, "gpt-5.6-terra");
});

test("overlapping gateway routes suppress non-attributable route and account details", () => {
  resetSessionLedger();
  const account = { id: "acct-a", provider: "openai", label: "work", token: "secret" };
  const routeA = resolveModelRoute("claude-opus-5-high");
  const routeB = resolveModelRoute("claude-fable-5-max");
  upsertSessionLedger({ gatewaySessionId: "gw-mixed", clientSessionId: "h2a-demo", account, route: routeA });
  recordSessionRequest("gw-mixed", routeA);
  recordSessionRequest("gw-mixed", routeB);
  recordSessionIdle("gw-mixed", routeA);

  const active = gatewayFromLedger(getSessionLedgerEntry("gw-mixed"));
  assert.equal(active.state, "active");
  assert.equal(active.requestedModel, undefined);
  assert.equal(active.upstreamModel, undefined);
  assert.equal(active.accountLabel, undefined);
  assert.match(active.reason, /overlapping requests/);

  recordSessionIdle("gw-mixed", routeB);
  const idle = gatewayFromLedger(getSessionLedgerEntry("gw-mixed"));
  assert.equal(idle.state, "idle");
  assert.equal(idle.requestedModel, undefined);

  recordSessionRequest("gw-mixed", routeA);
  const singular = gatewayFromLedger(getSessionLedgerEntry("gw-mixed"));
  assert.equal(singular.requestedModel, "claude-opus-5-high");
  assert.equal(singular.upstreamModel, "gpt-5.6-terra");
  assert.equal(singular.accountLabel, "work");
});

test("gateway projection expires stale active and 429 claims and counts down retry", () => {
  resetSessionLedger();
  const at = new Date("2026-07-25T12:00:00.000Z");
  const account = { id: "acct-a", provider: "openai", label: "Raw API key", token: "secret" };
  const route = resolveModelRoute("claude-opus-5-high");
  upsertSessionLedger({ gatewaySessionId: "gw-stale", clientSessionId: "h2a-stale", account, route, now: at });
  recordSessionRequest("gw-stale", route, at);
  assert.equal(
    gatewayFromLedger(getSessionLedgerEntry("gw-stale"), at.getTime()).accountLabel,
    "acct-a"
  );
  assert.equal(
    gatewayFromLedger(getSessionLedgerEntry("gw-stale"), at.getTime() + 300_001).state,
    "unknown"
  );

  recordSessionRateLimited("gw-stale", account, { route, retryAfterMs: 30_000, now: at });
  recordSessionRateLimitComplete("gw-stale", route, at);
  const limited = getSessionLedgerEntry("gw-stale");
  assert.equal(gatewayFromLedger(limited, at.getTime() + 10_000).retryAfterMs, 20_000);
  assert.equal(gatewayFromLedger(limited, at.getTime() + 30_001).state, "unknown");
});

test("gateway projection selects only the exact tmux client session id", () => {
  resetSessionLedger();
  const account = { id: "acct", provider: "openai", label: "work", token: "secret" };
  const wrong = upsertSessionLedger({
    gatewaySessionId: "gw-wrong",
    clientSessionId: "remote-demo",
    workspaceId: "/tmp/demo",
    account
  });
  const exact = upsertSessionLedger({
    gatewaySessionId: "gw-exact",
    clientSessionId: "h2a-demo",
    workspaceId: "/different/demo",
    account
  });
  assert.equal(selectExactGatewayLedgerEntry([wrong, exact], "h2a-demo")?.gatewaySessionId, "gw-exact");
  assert.equal(selectExactGatewayLedgerEntry([wrong], "h2a-demo"), undefined);
});

test("exact-client gateway lookup chooses the freshest unambiguous gateway record", () => {
  resetSessionLedger();
  const account = { id: "acct", provider: "openai", label: "work", token: "secret" };
  upsertSessionLedger({
    gatewaySessionId: "gw-old",
    clientSessionId: "h2a-owner",
    account,
    now: new Date("2026-07-26T12:00:00.000Z"),
  });
  upsertSessionLedger({
    gatewaySessionId: "gw-new",
    clientSessionId: "h2a-owner",
    account,
    now: new Date("2026-07-26T12:01:00.000Z"),
  });
  assert.equal(getSessionLedgerEntryForClient("h2a-owner")?.gatewaySessionId, "gw-new");
  upsertSessionLedger({
    gatewaySessionId: "gw-old",
    clientSessionId: "h2a-owner",
    account,
    now: new Date("2026-07-26T12:02:00.000Z"),
  });
  assert.equal(getSessionLedgerEntryForClient("h2a-owner")?.gatewaySessionId, "gw-old");
  upsertSessionLedger({
    gatewaySessionId: "gw-tied",
    clientSessionId: "h2a-owner",
    account,
    now: new Date("2026-07-26T12:02:00.000Z"),
  });
  assert.equal(getSessionLedgerEntryForClient("h2a-owner"), undefined);
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
