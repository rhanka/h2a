import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_GOVERNANCE_BOUNDARY_ITEMS,
  H2A_GOVERNANCE_BOUNDARY_LAYERS,
  classifyGovernanceBoundary,
  listGovernanceBoundaryItems
} from "../dist/index.js";

test("H2A_GOVERNANCE_BOUNDARY_LAYERS freezes the protocol/policy/implementation split", () => {
  assert.deepEqual([...H2A_GOVERNANCE_BOUNDARY_LAYERS], [
    "PROTOCOL",
    "POLICY",
    "IMPLEMENTATION"
  ]);
});

test("protocol boundary includes the normative core primitives", () => {
  assert.equal(
    classifyGovernanceBoundary("canonical-artifacts").layer,
    "PROTOCOL"
  );
  assert.equal(
    classifyGovernanceBoundary("scope-authority-escalation").layer,
    "PROTOCOL"
  );
  assert.equal(
    classifyGovernanceBoundary("multi-human-mode-taxonomy").status,
    "v1-shipped"
  );
});

test("policy boundary keeps unresolved governance choices out of hidden protocol rules", () => {
  const precedence = classifyGovernanceBoundary("policy-precedence");
  assert.equal(precedence.layer, "POLICY");
  assert.equal(precedence.status, "v1-open");
  assert.match(precedence.summary, /not hard-coded/);

  assert.equal(
    classifyGovernanceBoundary("controlled-disclosure-profiles").layer,
    "POLICY"
  );
});

test("implementation boundary keeps host/runtime choices replaceable", () => {
  assert.equal(classifyGovernanceBoundary("local-files-store").layer, "IMPLEMENTATION");
  assert.equal(classifyGovernanceBoundary("host-setup-snippets").layer, "IMPLEMENTATION");
  assert.equal(classifyGovernanceBoundary("mcp-stdio-server").status, "v1-shipped");
});

test("listGovernanceBoundaryItems filters by layer", () => {
  assert.equal(
    listGovernanceBoundaryItems("PROTOCOL").every((item) => item.layer === "PROTOCOL"),
    true
  );
  assert.equal(
    listGovernanceBoundaryItems("POLICY").some((item) => item.id === "policy-precedence"),
    true
  );
  assert.equal(listGovernanceBoundaryItems().length, H2A_GOVERNANCE_BOUNDARY_ITEMS.length);
});

test("classifyGovernanceBoundary returns undefined for unknown items", () => {
  assert.equal(classifyGovernanceBoundary("unknown-boundary"), undefined);
});
