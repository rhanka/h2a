import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBAGENT_ADDRESS_SEPARATOR,
  isSubagentAddress,
  parseSubagentAddress,
  subagentActorRef,
  subagentAddress,
  validateSubagentBinding
} from "../dist/index.js";

const parent = {
  id: "claude:proj-1",
  instance: "claude:proj-1",
  roles: ["AGENTS"],
  scopes: ["scope:demo"],
  capabilities: ["negotiate", "research"],
  endpoints: [],
  publicKeys: [],
  acceptedPolicies: [],
  createdAt: "2026-05-25T00:00:00.000Z"
};

const binding = (over = {}) => ({
  id: subagentAddress("claude:proj-1", "researcher"),
  parentInstance: "claude:proj-1",
  name: "researcher",
  createdAt: "2026-05-25T00:00:01.000Z",
  ...over
});

test("subagentAddress encodes parent + name with the ~ separator", () => {
  assert.equal(subagentAddress("claude:proj-1", "researcher"), "claude:proj-1~researcher");
  assert.equal(SUBAGENT_ADDRESS_SEPARATOR, "~");
});

test("the separator avoids the safePathSegment sanitize set", () => {
  // safePathSegment maps [:/\<>"|?*] -> __ (DEC-062). The separator must not
  // be in that set, so a subagent address keeps its structure as a path name.
  assert.doesNotMatch(SUBAGENT_ADDRESS_SEPARATOR, /[:/\\<>"|?*]/);
});

test("isSubagentAddress / parseSubagentAddress round-trip", () => {
  const addr = subagentAddress("claude:proj-1", "researcher");
  assert.equal(isSubagentAddress(addr), true);
  assert.deepEqual(parseSubagentAddress(addr), {
    parentInstance: "claude:proj-1",
    name: "researcher"
  });
  // a plain instance id is not a subagent address
  assert.equal(isSubagentAddress("claude:proj-1"), false);
  assert.equal(parseSubagentAddress("claude:proj-1"), undefined);
});

test("parseSubagentAddress splits on the LAST separator (parent may contain ~)", () => {
  const addr = subagentAddress("host~weird:inst", "child");
  assert.deepEqual(parseSubagentAddress(addr), {
    parentInstance: "host~weird:inst",
    name: "child"
  });
});

test("a valid binding under an AGENTS parent passes", () => {
  const v = validateSubagentBinding(binding(), parent);
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("a non-AGENTS parent is rejected", () => {
  const v = validateSubagentBinding(binding(), { ...parent, roles: ["CONDUCTOR"] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("parent-not-agents"));
});

test("an empty or separator-bearing name is rejected", () => {
  const empty = validateSubagentBinding(
    binding({ name: "", id: subagentAddress("claude:proj-1", "") }),
    parent
  );
  assert.ok(empty.errors.includes("empty-name"));
  const sep = validateSubagentBinding(
    binding({ name: "a~b", id: subagentAddress("claude:proj-1", "a~b") }),
    parent
  );
  assert.ok(sep.errors.includes("name-contains-separator"));
});

test("id must equal subagentAddress(parentInstance, name)", () => {
  const v = validateSubagentBinding(binding({ id: "claude:proj-1~someoneelse" }), parent);
  assert.ok(v.errors.includes("id-address-mismatch"));
});

test("parentInstance must match the parent registration", () => {
  const v = validateSubagentBinding(
    binding({ parentInstance: "claude:other", id: "claude:other~researcher" }),
    parent
  );
  assert.ok(v.errors.includes("parent-instance-mismatch"));
});

test("declared capabilities must be a subset of the parent's", () => {
  const ok = validateSubagentBinding(binding({ capabilities: ["research"] }), parent);
  assert.equal(ok.ok, true);
  const bad = validateSubagentBinding(binding({ capabilities: ["sign"] }), parent);
  assert.ok(bad.errors.includes("capabilities-exceed-parent"));
});

test("subagentActorRef acts under the parent's AGENTS role", () => {
  const ref = subagentActorRef(binding(), { scope: "scope:demo", mandate: "m-1" });
  assert.equal(ref.instance, "claude:proj-1~researcher");
  assert.equal(ref.role, "AGENTS");
  assert.equal(ref.scope, "scope:demo");
  assert.equal(ref.mandate, "m-1");
  // mandate omitted when not provided
  const noMandate = subagentActorRef(binding(), { scope: "scope:demo" });
  assert.equal("mandate" in noMandate, false);
});
