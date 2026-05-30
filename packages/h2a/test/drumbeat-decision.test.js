import assert from "node:assert/strict";
import test from "node:test";
import { parseReflexiveDecision } from "../dist/index.js";

test("parses each valid action", () => {
  for (const action of ["relance", "finish", "escalate", "reroute"]) {
    const d = parseReflexiveDecision(JSON.stringify({ action, reason: "x" }));
    assert.equal(d.action, action);
    assert.equal(d.reason, "x");
  }
});

test("unknown action → relance (safe fallback)", () => {
  assert.equal(parseReflexiveDecision(JSON.stringify({ action: "nuke" })).action, "relance");
});

test("missing action → relance", () => {
  assert.equal(parseReflexiveDecision(JSON.stringify({ reason: "x" })).action, "relance");
});

test("malformed JSON → relance, never throws", () => {
  assert.equal(parseReflexiveDecision("not json").action, "relance");
  assert.equal(parseReflexiveDecision("").action, "relance");
});

test("reason is optional and omitted when absent", () => {
  assert.equal(parseReflexiveDecision(JSON.stringify({ action: "finish" })).reason, undefined);
});

test("tolerates a JSON object embedded in surrounding text", () => {
  const d = parseReflexiveDecision('Here is my call:\n{"action":"escalate","reason":"stuck"}\nthanks');
  assert.equal(d.action, "escalate");
  assert.equal(d.reason, "stuck");
});
