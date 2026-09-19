/**
 * L0 unit coverage for the phase-trace primitive (GREEN-only supplement — it
 * imports the new module, so it does not run on un-instrumented main and is NOT
 * the regression red; the behavioral `mcp-phase-trace.test.js` carries that).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createMcpTrace, TRACE_LINE_PREFIX } from "../dist/runtime/mcp/index.js";

function sink() {
  const lines = [];
  const events = [];
  return {
    write: (line) => {
      lines.push(line);
      assert.ok(line.startsWith(TRACE_LINE_PREFIX), "every line is prefixed");
      assert.ok(line.endsWith("\n"), "every line is newline-terminated");
      events.push(JSON.parse(line.slice(TRACE_LINE_PREFIX.length)));
    },
    lines,
    events
  };
}

test("createMcpTrace: mints a UUID attemptId and stamps closed fields", () => {
  const s = sink();
  const t = createMcpTrace({ writer: s.write, detailed: true, env: {} });
  assert.match(t.attemptId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  t.phase("m", { bytes: 42, method: "initialize", requestId: 7 });
  const [e] = s.events;
  assert.equal(e.v, 1);
  assert.equal(e.event, "sample");
  assert.equal(e.phase, "m");
  assert.equal(e.bytes, 42);
  assert.equal(e.method, "initialize");
  assert.equal(e.requestId, 7);
  assert.equal(typeof e.monotonicMs, "number");
});

test("createMcpTrace: drops non-whitelisted fields and sanitizes strings", () => {
  const s = sink();
  const t = createMcpTrace({ writer: s.write, detailed: true, env: {} });
  // A caller who mistakenly attaches a secret gets it DROPPED (not whitelisted),
  // and any control chars / newlines in a whitelisted string are flattened.
  t.phase("x", { pem: "-----BEGIN PRIVATE KEY-----", secret: "z", method: "a\nb\tc" });
  const [e] = s.events;
  assert.equal(e.pem, undefined, "non-whitelisted field dropped");
  assert.equal(e.secret, undefined, "non-whitelisted field dropped");
  assert.equal(e.method, "a b c", "control chars flattened, stays one line");
  assert.ok(!JSON.stringify(e).includes("\n"), "no raw newline in the event");
});

test("createMcpTrace: detailed gating — begin/end suppressed unless detailed, errors always", () => {
  const s = sink();
  const t = createMcpTrace({ writer: s.write, detailed: false, env: {} });
  t.begin("b");
  t.end("b");
  assert.equal(s.events.length, 0, "begin/end suppressed when not detailed");
  t.phase("milestone");
  t.error("boom", { code: "E" });
  assert.deepEqual(s.events.map((e) => e.event), ["sample", "error"]);
});

test("createMcpTrace: span returns the value and emits an error event on throw", () => {
  const s = sink();
  const t = createMcpTrace({ writer: s.write, detailed: true, env: {} });
  const v = t.span("ok", () => 123, { tool: "t" });
  assert.equal(v, 123);
  const kinds = s.events.map((e) => e.event);
  assert.deepEqual(kinds, ["begin", "end"]);
  assert.throws(() => t.span("bad", () => {
    throw new TypeError("nope");
  }));
  assert.equal(s.events.at(-1).event, "error");
  assert.equal(s.events.at(-1).code, "TypeError");
});

test("createMcpTrace: env flag turns on detailed spans", () => {
  const s = sink();
  const t = createMcpTrace({ writer: s.write, env: { H2A_MCP_TRACE: "1" } });
  assert.equal(t.detailed, true);
  t.begin("b");
  assert.equal(s.events.length, 1);
});

test("createMcpTrace: seq strictly increases and monotonicMs never decreases", () => {
  const s = sink();
  const t = createMcpTrace({ writer: s.write, detailed: true, env: {} });
  for (let i = 0; i < 5; i++) t.phase(`p${i}`);
  for (let i = 1; i < s.events.length; i++) {
    assert.equal(s.events[i].seq, s.events[i - 1].seq + 1);
    assert.ok(s.events[i].monotonicMs >= s.events[i - 1].monotonicMs);
  }
});

test("createMcpTrace: a child shares the attemptId with its own role", () => {
  const s = sink();
  const parent = createMcpTrace({ writer: s.write, detailed: true, env: {} });
  const child = parent.child("identity-child");
  assert.equal(child.attemptId, parent.attemptId);
  assert.equal(child.role, "identity-child");
});

test("createMcpTrace: a throwing writer never propagates to the caller", () => {
  const t = createMcpTrace({
    writer: () => {
      throw new Error("sink down");
    },
    detailed: true,
    env: {}
  });
  assert.doesNotThrow(() => t.phase("m"));
  assert.equal(t.span("s", () => "v"), "v");
});
