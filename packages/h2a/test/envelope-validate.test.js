import assert from "node:assert/strict";
import test from "node:test";

import { validateH2AEnvelope } from "../dist/index.js";

// Minimal fully-valid envelope used as a baseline.
function validEnvelope(overrides = {}) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: "env-valid-001",
    type: "event",
    actor: {
      instance: "claude:proj:abc123",
      role: "AGENTS",
      scope: "scope:default"
    },
    body: { kind: "message", text: "hello" },
    createdAt: "2026-06-07T10:00:00.000Z",
    ...overrides
  };
}

test("validateH2AEnvelope: valid envelope returns {ok:true}", () => {
  const result = validateH2AEnvelope(validEnvelope());
  assert.equal(result.ok, true);
});

test("validateH2AEnvelope: non-object returns object-level error", () => {
  const result = validateH2AEnvelope(null);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /JSON object/.test(e)), `expected 'JSON object' in ${JSON.stringify(result.errors)}`);
});

test("validateH2AEnvelope: string input returns object-level error", () => {
  const result = validateH2AEnvelope("not-an-object");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /JSON object/.test(e)));
});

test("validateH2AEnvelope: missing createdAt is flagged", () => {
  const env = validEnvelope();
  delete env.createdAt;
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /createdAt/.test(e)),
    `expected 'createdAt' in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: missing body (flat fields) is flagged with hint", () => {
  const env = validEnvelope();
  delete env.body;
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  const bodyError = result.errors.find((e) => /body/.test(e));
  assert.ok(bodyError, `expected body error in ${JSON.stringify(result.errors)}`);
  // The hint should mention putting content under body
  assert.match(bodyError, /body/);
});

test("validateH2AEnvelope: body as a string (not object) is flagged", () => {
  const env = validEnvelope({ body: "flat-text" });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /body/.test(e)),
    `expected body error in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: bad protocol is flagged", () => {
  const env = validEnvelope({ protocol: "wrong" });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /protocol/.test(e)),
    `expected protocol error in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: bad type is flagged with allowed list", () => {
  const env = validEnvelope({ type: "unknown-type" });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  const typeError = result.errors.find((e) => /type/.test(e));
  assert.ok(typeError, `expected type error in ${JSON.stringify(result.errors)}`);
  // Should mention the bad value
  assert.match(typeError, /unknown-type/);
});

test("validateH2AEnvelope: missing actor.instance is flagged", () => {
  const env = validEnvelope({ actor: { role: "AGENTS", scope: "scope:default" } });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /actor\.instance/.test(e)),
    `expected actor.instance error in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: missing actor entirely is flagged", () => {
  const env = validEnvelope({ actor: null });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /actor\.instance/.test(e)),
    `expected actor.instance error in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: non-string threadId is flagged", () => {
  const env = validEnvelope({ threadId: 42 });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /threadId/.test(e)),
    `expected threadId error in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: non-string replyTo is flagged", () => {
  const env = validEnvelope({ replyTo: true });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /replyTo/.test(e)),
    `expected replyTo error in ${JSON.stringify(result.errors)}`
  );
});

test("validateH2AEnvelope: collects ALL errors (missing createdAt + bad protocol)", () => {
  const env = validEnvelope({ protocol: "wrong" });
  delete env.createdAt;
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /protocol/.test(e)));
  assert.ok(result.errors.some((e) => /createdAt/.test(e)));
  assert.ok(result.errors.length >= 2, `expected at least 2 errors, got ${result.errors.length}`);
});

test("validateH2AEnvelope: optional string fields (threadId, replyTo) pass when valid strings", () => {
  const env = validEnvelope({
    threadId: "thr:1234567890:abcd",
    replyTo: "env-prev-001"
  });
  const result = validateH2AEnvelope(env);
  assert.equal(result.ok, true);
});
