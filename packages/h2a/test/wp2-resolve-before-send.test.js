// WP-2: resolve-before-send — legibility gate tests.
//
// Tests:
//  Unit — resolveRecipient (all 6 branches)
//  CLI  — bare alias → deliver-hint (1 live)
//  CLI  — bare alias → refuse phantom (0 live, 0 registered)
//  CLI  — bare alias → refuse ambiguous (>1 live)
//  CLI  — bare alias → deliver-dormant (registered, 0 live)
//  CLI  — full id   → deliver (unchanged path)
//  MCP  — handleInbox put refuse on phantom returns { error }
//  MCP  — handleInbox put deliver-hint returns liveCandidate

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, resolveRecipient, runCli, writePresence } from "../dist/index.js";
import { handleInbox } from "../dist/runtime/mcp/handlers.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureStreams(cwd) {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (chunk) => void (stdout += chunk) },
    stderr: { write: (chunk) => void (stderr += chunk) },
    cwd: () => cwd,
    get stdoutText() { return stdout; },
    get stderrText() { return stderr; }
  };
}

function makePresence(instance, sessionId, name) {
  return {
    sessionId,
    instance,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...(name !== undefined ? { name } : {})
  };
}

function makeRegistration(instance) {
  return {
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date().toISOString()
  };
}

function makeEnvelope(id = `env:${Date.now()}:0001`) {
  return JSON.stringify({
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "claude:sender:bbbbbbbbbbbb", role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", text: "hi" },
    createdAt: new Date().toISOString()
  });
}

function makeEnvelopeObj(id = `env:${Date.now()}:0001`) {
  return JSON.parse(makeEnvelope(id));
}

// ─── Unit: resolveRecipient ───────────────────────────────────────────────────

test("resolveRecipient: subagent (contains ~) → deliver", () => {
  const result = resolveRecipient({
    target: "claude:foo:aaaaaaaaaaaa~Research",
    liveInstances: [],
    registeredInstances: []
  });
  assert.equal(result.kind, "deliver");
});

test("resolveRecipient: full id (3 segments, 12-hex) → deliver", () => {
  const result = resolveRecipient({
    target: "claude:foo:aaaaaaaaaaaa",
    liveInstances: ["claude:foo:aaaaaaaaaaaa"],
    registeredInstances: ["claude:foo:aaaaaaaaaaaa"]
  });
  assert.equal(result.kind, "deliver");
});

test("resolveRecipient: malformed 3-segment (non-12-hex 3rd seg) → refuse", () => {
  const result = resolveRecipient({
    target: "claude:sentropic:sentropic-chat",
    liveInstances: [],
    registeredInstances: []
  });
  assert.equal(result.kind, "refuse");
  assert.match(result.reason, /3rd segment that is not a uuid/);
  assert.match(result.reason, /claude:sentropic/);
});

test("resolveRecipient: bare alias, 1 live match → deliver-hint", () => {
  const result = resolveRecipient({
    target: "claude:foo",
    liveInstances: ["claude:foo:aaaaaaaaaaaa"],
    registeredInstances: ["claude:foo:aaaaaaaaaaaa"]
  });
  assert.equal(result.kind, "deliver-hint");
  assert.equal(result.liveCandidate, "claude:foo:aaaaaaaaaaaa");
  assert.match(result.reason, /bare alias resolved to 1 live agent/);
});

test("resolveRecipient: bare alias, >1 live matches → refuse (ambiguous)", () => {
  const result = resolveRecipient({
    target: "claude:foo",
    liveInstances: ["claude:foo:aaaaaaaaaaaa", "claude:foo:bbbbbbbbbbbb"],
    registeredInstances: ["claude:foo:aaaaaaaaaaaa", "claude:foo:bbbbbbbbbbbb"]
  });
  assert.equal(result.kind, "refuse");
  assert.match(result.reason, /ambiguous/);
  assert.ok(Array.isArray(result.candidates));
  assert.equal(result.candidates.length, 2);
});

test("resolveRecipient: bare alias, 0 live but registered → deliver-dormant", () => {
  const result = resolveRecipient({
    target: "claude:bar",
    liveInstances: [],
    registeredInstances: ["claude:bar:cccccccccccc"]
  });
  assert.equal(result.kind, "deliver-dormant");
  assert.match(result.reason, /no live session/);
  assert.match(result.reason, /claude:bar/);
});

test("resolveRecipient: bare alias, 0 live, 0 registered → refuse (phantom)", () => {
  const result = resolveRecipient({
    target: "claude:ghost",
    liveInstances: [],
    registeredInstances: []
  });
  assert.equal(result.kind, "refuse");
  assert.match(result.reason, /phantom\/invented id/);
});

// ─── CLI: deliver-hint (1 live, bare alias) ───────────────────────────────────

test("CLI inbox put bare alias to 1-live instance → exit 0, resolution:deliver-hint, liveCandidate", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-hint-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const fullId = "claude:foo:aaaaaaaaaaaa";
    store.registerInstance(makeRegistration(fullId));
    writePresence(root, makePresence(fullId, "sess:live-foo-1"));

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", "claude:foo", "--json", makeEnvelope("env-hint-1")],
      streams
    );
    assert.equal(rc, 0, `expected exit 0, stderr: ${streams.stderrText}`);
    const out = JSON.parse(streams.stdoutText);
    assert.equal(out.ok, true);
    assert.equal(out.resolution, "deliver-hint", `expected deliver-hint, got: ${JSON.stringify(out)}`);
    assert.equal(out.liveCandidate, fullId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── CLI: refuse phantom ───────────────────────────────────────────────────────

test("CLI inbox put bare alias to phantom (0 live, 0 registered) → exit 1, stderr phantom", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-phantom-"));
  const root = join(dir, ".h2a");
  try {
    createLocalStore({ root });

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", "claude:ghost", "--json", makeEnvelope("env-phantom-1")],
      streams
    );
    assert.equal(rc, 1, `expected exit 1, stderr: ${streams.stderrText}`);
    assert.match(
      streams.stderrText,
      /phantom\/invented id|no live or registered/,
      `expected phantom message in stderr, got: ${streams.stderrText}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── CLI: refuse ambiguous (>1 live) ─────────────────────────────────────────

test("CLI inbox put bare alias to >1 live → exit 1, stderr ambiguous, candidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-ambig-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const fullId1 = "claude:foo:aaaaaaaaaaaa";
    const fullId2 = "claude:foo:bbbbbbbbbbbb";
    store.registerInstance(makeRegistration(fullId1));
    store.registerInstance(makeRegistration(fullId2));
    writePresence(root, makePresence(fullId1, "sess:live-foo-a"));
    writePresence(root, makePresence(fullId2, "sess:live-foo-b"));

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", "claude:foo", "--json", makeEnvelope("env-ambig-1")],
      streams
    );
    assert.equal(rc, 1, `expected exit 1, stderr: ${streams.stderrText}`);
    assert.match(
      streams.stderrText,
      /ambiguous/,
      `expected "ambiguous" in stderr, got: ${streams.stderrText}`
    );
    // Both candidates should appear in the stderr output.
    assert.match(
      streams.stderrText,
      /aaaaaaaaaaaa/,
      `expected candidate 1 in stderr, got: ${streams.stderrText}`
    );
    assert.match(
      streams.stderrText,
      /bbbbbbbbbbbb/,
      `expected candidate 2 in stderr, got: ${streams.stderrText}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── CLI: deliver-dormant (registered, 0 live) ───────────────────────────────

test("CLI inbox put bare alias to dormant (registered, 0 live) → exit 0, resolution:deliver-dormant, dormant:true", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-dormant-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const fullId = "claude:bar:cccccccccccc";
    store.registerInstance(makeRegistration(fullId));
    // No presence file written → 0 live sessions.

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", "claude:bar", "--json", makeEnvelope("env-dormant-1")],
      streams
    );
    assert.equal(rc, 0, `expected exit 0, stderr: ${streams.stderrText}`);
    const out = JSON.parse(streams.stdoutText);
    assert.equal(out.ok, true);
    assert.equal(out.resolution, "deliver-dormant", `expected deliver-dormant, got: ${JSON.stringify(out)}`);
    assert.equal(out.dormant, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── CLI: full id → deliver (unchanged path) ─────────────────────────────────

test("CLI inbox put full id (host:label:uuid12) → exit 0, resolution:deliver", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-fullid-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const fullId = "claude:foo:aaaaaaaaaaaa";
    store.registerInstance(makeRegistration(fullId));
    writePresence(root, makePresence(fullId, "sess:live-foo-full"));

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", fullId, "--json", makeEnvelope("env-fullid-1")],
      streams
    );
    assert.equal(rc, 0, `expected exit 0, stderr: ${streams.stderrText}`);
    const out = JSON.parse(streams.stdoutText);
    assert.equal(out.ok, true);
    assert.equal(out.resolution, "deliver", `expected deliver, got: ${JSON.stringify(out)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── MCP: handleInbox put — refuse phantom → { error } ───────────────────────

test("MCP handleInbox put phantom → { error } containing phantom/no live or registered", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-mcp-phantom-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const result = handleInbox(store, {
      action: "put",
      instance: "claude:ghost",
      envelope: makeEnvelopeObj("env-mcp-phantom-1")
    });
    assert.ok(typeof result.error === "string", `expected error, got: ${JSON.stringify(result)}`);
    assert.match(
      result.error,
      /phantom\/invented id|no live or registered/,
      `expected phantom message, got: ${result.error}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── MCP: handleInbox put — deliver-hint returns liveCandidate ───────────────

test("MCP handleInbox put bare alias to 1-live → ok:true, liveCandidate present", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp2-mcp-hint-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const fullId = "claude:foo:aaaaaaaaaaaa";
    store.registerInstance(makeRegistration(fullId));
    writePresence(root, makePresence(fullId, "sess:live-mcp-foo"));

    const result = handleInbox(store, {
      action: "put",
      instance: "claude:foo",
      envelope: makeEnvelopeObj("env-mcp-hint-1")
    });
    assert.ok(!result.error, `expected no error, got: ${JSON.stringify(result)}`);
    assert.equal(result.ok, true);
    assert.equal(result.resolution, "deliver-hint", `expected deliver-hint, got: ${JSON.stringify(result)}`);
    assert.equal(result.liveCandidate, fullId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── DOC-03: presence-name resolution ───────────────────────────────────────

test("resolveRecipient: a presence name resolves to its live instance", () => {
  const instance = "claude:h2a:345c97408069";
  const result = resolveRecipient({
    target: "agents",
    liveInstances: [makePresence(instance, "sess:name-1", "agents")],
    registeredInstances: [instance]
  });
  assert.equal(result.kind, "deliver-resolved");
  assert.equal(result.recipient, instance);
});

test("MCP handleInbox put resolves a presence name to the instance, never to a bare-name inbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-name-put-"));
  const root = join(dir, ".h2a");
  const instance = "claude:h2a:345c97408069";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(instance));
    writePresence(root, makePresence(instance, "sess:name-put", "agents"));

    const result = handleInbox(store, {
      action: "put",
      instance: "agents",
      envelope: makeEnvelopeObj("env-doc03-name-put")
    });

    assert.equal(result.ok, true, `expected a resolved write, got: ${JSON.stringify(result)}`);
    assert.equal(store.readInbox(instance).length, 1, "the resolved instance receives the envelope");
    assert.equal(store.readInbox("agents").length, 0, "a bare display name is never an inbox address");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP handleInbox put refuses an ambiguous presence name", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-name-write-ambiguous-"));
  const root = join(dir, ".h2a");
  const first = "claude:h2a:111111111111";
  const second = "codex:h2a:222222222222";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(first));
    store.registerInstance(makeRegistration(second));
    writePresence(root, makePresence(first, "sess:name-write-a", "agents"));
    writePresence(root, makePresence(second, "sess:name-write-b", "agents"));

    const result = handleInbox(store, {
      action: "put",
      instance: "agents",
      envelope: makeEnvelopeObj("env-doc03-name-ambiguous")
    });

    assert.match(result.error, /ambiguous/);
    assert.deepEqual(result.candidates, [first, second]);
    assert.equal(store.readInbox(first).length, 0);
    assert.equal(store.readInbox(second).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP handleInbox read lists candidates for an ambiguous presence name", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-name-read-ambiguous-"));
  const root = join(dir, ".h2a");
  const first = "claude:h2a:111111111111";
  const second = "codex:h2a:222222222222";
  try {
    const store = createLocalStore({ root });
    writePresence(root, makePresence(first, "sess:name-read-a", "agents"));
    writePresence(root, makePresence(second, "sess:name-read-b", "agents"));

    const result = handleInbox(store, { action: "read", instance: "agents" });

    assert.deepEqual(result.candidates, [first, second]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI inbox read serves a declared-but-never-live host:label while put remains refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-read-phantom-"));
  const root = join(dir, ".h2a");
  const instance = "codex:dev-1";
  const envelope = makeEnvelopeObj("env-doc03-read-phantom");
  try {
    const store = createLocalStore({ root });
    store.putInboxMessage(instance, envelope);

    const readStreams = captureStreams(dir);
    const readRc = runCli(["inbox", "read", "--root", root, "--instance", instance], readStreams);
    assert.equal(readRc, 0, `expected an orphan inbox read, got: ${readStreams.stderrText}`);
    assert.deepEqual(JSON.parse(readStreams.stdoutText), [envelope]);

    const putStreams = captureStreams(dir);
    const putRc = runCli(
      ["inbox", "put", "--root", root, "--instance", instance, "--json", makeEnvelope("env-doc03-write-phantom")],
      putStreams
    );
    assert.equal(putRc, 1, `phantom write must remain refused, got: ${putStreams.stdoutText}`);
    assert.match(putStreams.stderrText, /no live or registered agent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP inbox read refuses a malformed third segment", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-read-malformed-third-segment-"));
  const root = join(dir, ".h2a");
  try {
    const result = handleInbox(createLocalStore({ root }), {
      action: "read",
      instance: "claude:agents:not-a-uuid"
    });
    assert.ok(typeof result.error === "string", `expected read refusal, got: ${JSON.stringify(result)}`);
    assert.match(result.error, /3rd segment that is not a uuid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP handleInbox put refuses h2a: when a live presence has an empty name", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-empty-name-h2a-prefix-"));
  const root = join(dir, ".h2a");
  const instance = "claude:h2a:111111111111";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(instance));
    writePresence(root, makePresence(instance, "sess:empty-name-h2a-prefix", ""));

    const result = handleInbox(store, {
      action: "put",
      instance: "h2a:",
      envelope: makeEnvelopeObj("env-doc03-empty-name-h2a-prefix")
    });

    assert.ok(typeof result.error === "string", `expected refusal, got: ${JSON.stringify(result)}`);
    assert.equal(store.readInbox(instance).length, 0, "an empty name must never receive h2a: traffic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI inbox put refuses whitespace when a live presence has an empty name", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-empty-name-whitespace-"));
  const root = join(dir, ".h2a");
  const instance = "claude:h2a:111111111111";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(instance));
    writePresence(root, makePresence(instance, "sess:empty-name-whitespace", ""));

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", "   ", "--json", makeEnvelope("env-doc03-empty-name-whitespace")],
      streams
    );

    assert.equal(rc, 1, `expected refusal, got stdout: ${streams.stdoutText}`);
    assert.equal(store.readInbox(instance).length, 0, "an empty name must never receive whitespace traffic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRecipient refuses empty display-name keys before caller-specific guards", () => {
  const instance = "claude:h2a:111111111111";
  for (const target of ["h2a:", "   "]) {
    const result = resolveRecipient({
      target,
      liveInstances: [makePresence(instance, "sess:empty-name-pure", "")],
      registeredInstances: [instance]
    });
    assert.equal(result.kind, "refuse", `expected ${JSON.stringify(target)} to refuse, got: ${JSON.stringify(result)}`);
  }
});

test("MCP inbox read refuses every empty display-name key without touching a live inbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-empty-name-read-pop-"));
  const root = join(dir, ".h2a");
  const instance = "claude:h2a:111111111111";
  const envelope = makeEnvelopeObj("env-doc03-empty-name-read-pop");
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(instance));
    writePresence(root, makePresence(instance, "sess:empty-name-read-pop", ""));
    store.putInboxMessage(instance, envelope);

    for (const target of ["h2a:", "   ", "\t", ""]) {
      const readResult = handleInbox(store, { action: "read", instance: target });
      assert.ok(
        typeof readResult.error === "string",
        `expected ${JSON.stringify(target)} read refusal, got: ${JSON.stringify(readResult)}`
      );
    }

    const popResult = handleInbox(store, {
      action: "pop",
      instance: "   ",
      envelopeId: envelope.id
    });
    assert.ok(typeof popResult.error === "string", `expected pop refusal, got: ${JSON.stringify(popResult)}`);
    assert.equal(store.readInbox(instance).length, 1, "read/pop by an empty key must not touch the live inbox");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP handleInbox put refuses a host-qualified target matching only another presence name", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-host-label-name-capture-"));
  const root = join(dir, ".h2a");
  const impostor = "codex:other:222222222222";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(impostor));
    writePresence(root, makePresence(impostor, "sess:host-label-name-capture", "claude:victim"));

    const result = handleInbox(store, {
      action: "put",
      instance: "claude:victim",
      envelope: makeEnvelopeObj("env-doc03-host-label-name-capture")
    });

    assert.ok(typeof result.error === "string", `expected refusal, got: ${JSON.stringify(result)}`);
    assert.match(result.error, /phantom\/invented id|no live or registered/);
    assert.equal(store.readInbox(impostor).length, 0, "a display name must not capture host-qualified traffic");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRecipient: h2a:agents alias is not made ambiguous by display names", () => {
  const instance = "h2a:agents:111111111111";
  const other = "codex:other:222222222222";
  const result = resolveRecipient({
    target: "h2a:agents",
    liveInstances: [
      makePresence(instance, "sess:literal-h2a-name", "h2a:agents"),
      makePresence(other, "sess:plain-name", "agents")
    ],
    registeredInstances: [instance, other]
  });
  assert.equal(result.kind, "deliver-hint", `expected the alias only, got: ${JSON.stringify(result)}`);
  assert.equal(result.liveCandidate, instance);
});

test("CLI inbox put resolves a unique presence name to its instance", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-cli-unique-name-"));
  const root = join(dir, ".h2a");
  const instance = "claude:h2a:345c97408069";
  try {
    const store = createLocalStore({ root });
    store.registerInstance(makeRegistration(instance));
    writePresence(root, makePresence(instance, "sess:cli-unique-name", "agents"));

    const streams = captureStreams(dir);
    const rc = runCli(
      ["inbox", "put", "--root", root, "--instance", "agents", "--json", makeEnvelope("env-doc03-cli-unique-name")],
      streams
    );

    assert.equal(rc, 0, `expected resolved delivery, got stderr: ${streams.stderrText}`);
    const out = JSON.parse(streams.stdoutText);
    assert.equal(out.resolution, "deliver-resolved");
    assert.equal(out.instance, instance);
    assert.equal(store.readInbox(instance).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI inbox put keeps bare labels and malformed third segments fail-closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc03-cli-fail-closed-"));
  const root = join(dir, ".h2a");
  try {
    createLocalStore({ root });
    for (const [target, envelopeId] of [
      ["agents", "env-doc03-bare-label"],
      ["claude:victim:not-a-uuid", "env-doc03-malformed-third-segment"]
    ]) {
      const streams = captureStreams(dir);
      const rc = runCli(
        ["inbox", "put", "--root", root, "--instance", target, "--json", makeEnvelope(envelopeId)],
        streams
      );
      assert.equal(rc, 1, `expected ${target} to be refused, got stdout: ${streams.stdoutText}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Legacy-prefix ordering regressions: strip exactly one leading `h2a:` marker,
// then apply the colon guard to the remaining name key.

test("resolveRecipient: h2a:claude:victim stays ineligible after one legacy strip", () => {
  const result = resolveRecipient({
    target: "h2a:claude:victim",
    liveInstances: [
      makePresence("codex:other:222222222222", "sess:legacy-b-capture", "claude:victim")
    ],
    registeredInstances: ["codex:other:222222222222"]
  });
  assert.equal(result.kind, "refuse");
});

test("resolveRecipient: h2a:h2a: strips only the leading marker", () => {
  const result = resolveRecipient({
    target: "h2a:h2a:",
    liveInstances: [
      makePresence("claude:other:333333333333", "sess:legacy-a-capture", "h2a:")
    ],
    registeredInstances: ["claude:other:333333333333"]
  });
  assert.equal(result.kind, "refuse");
});

test("resolveRecipient: h2a: uses the empty-key guard after stripping", () => {
  const result = resolveRecipient({
    target: "h2a:",
    liveInstances: [makePresence("claude:empty:444444444444", "sess:legacy-c-empty", "")],
    registeredInstances: ["claude:empty:444444444444"]
  });
  assert.equal(result.kind, "refuse");
  assert.match(result.reason, /empty display-name key/);
});

for (const target of ["H2A:agents", " h2a:agents "]) {
  test(`resolveRecipient: ${JSON.stringify(target)} resolves case- and whitespace-insensitively`, () => {
    const instance = "claude:agents:555555555555";
    const result = resolveRecipient({
      target,
      liveInstances: [makePresence(instance, `sess:legacy-d-${target.length}`, "agents")],
      registeredInstances: [instance]
    });
    assert.equal(result.kind, "deliver-resolved");
    assert.equal(result.recipient, instance);
  });
}
