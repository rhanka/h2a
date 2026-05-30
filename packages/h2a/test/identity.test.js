import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveInstanceId,
  deriveWorkspaceId,
  isH2AWorkspaceRef,
  mintAgentUuid,
  slugify,
  uuid12
} from "../dist/index.js";

test("slugify lowercases, keeps grep-safe chars, collapses the rest to single dashes", () => {
  assert.equal(slugify("Sent Tech Design System"), "sent-tech-design-system");
  assert.equal(slugify("a2a-cli"), "a2a-cli");
  assert.equal(slugify("Foo/Bar:Baz"), "foo-bar-baz");
  assert.equal(slugify("  trailing  "), "trailing");
  assert.equal(slugify("UPPER_under.dot"), "upper_under.dot");
});

test("slugify never produces an empty slug and never contains a colon (F5: never `:`-split)", () => {
  assert.equal(slugify(""), "workspace");
  assert.equal(slugify("::::"), "workspace");
  assert.equal(slugify("!@#$%"), "workspace");
  for (const s of ["a:b", "x", "Project X"]) {
    assert.ok(!slugify(s).includes(":"), `slug ${slugify(s)} must not contain ':'`);
  }
});

test("uuid12 is the first 12 hex of a UUID (F5: widen uuid8 -> uuid12)", () => {
  assert.equal(uuid12("9f3a1c20-aaaa-bbbb-cccc-ddddeeeeffff"), "9f3a1c20aaaa");
  // tolerant of an already-stripped value
  assert.equal(uuid12("9f3a1c20aaaabbbbccccddddeeeeffff"), "9f3a1c20aaaa");
  assert.equal(uuid12("9f3a1c20-aaaa-bbbb-cccc-ddddeeeeffff").length, 12);
});

test("deriveInstanceId composes host:slug(label):uuid12 and is greppable + collision-proof", () => {
  const uuid = "9f3a1c20-aaaa-bbbb-cccc-ddddeeeeffff";
  assert.equal(
    deriveInstanceId({ host: "claude", label: "sent-tech-design-system", uuid }),
    "claude:sent-tech-design-system:9f3a1c20aaaa"
  );
  // Two agents, same label, distinct uuid -> distinct instance (de-collision).
  const a = deriveInstanceId({ host: "claude", label: "sentropic", uuid: "11111111-2222-3333-4444-555555555555" });
  const b = deriveInstanceId({ host: "claude", label: "sentropic", uuid: "aaaaaaaa-2222-3333-4444-555555555555" });
  assert.notEqual(a, b);
});

test("deriveInstanceId slugifies an unsafe label so the handle is never `:`-split (F5)", () => {
  const uuid = "9f3a1c20-aaaa-bbbb-cccc-ddddeeeeffff";
  const id = deriveInstanceId({ host: "claude", label: "a:b/c", uuid });
  // host : slug : uuid12 -> exactly two colons, slug carries no extra colon.
  assert.equal(id.split(":").length, 3);
  assert.equal(id, "claude:a-b-c:9f3a1c20aaaa");
});

test("deriveWorkspaceId is deterministic for the same (machineId, path) and salted by both (F6)", () => {
  const id1 = deriveWorkspaceId({ machineId: "machine-A", path: "/home/u/repo" });
  const id2 = deriveWorkspaceId({ machineId: "machine-A", path: "/home/u/repo" });
  assert.equal(id1, id2, "same machine + path -> same workspace id (agents groupable)");
  assert.match(id1, /^ws:[0-9a-f-]+$/);

  // Different machine (clone/container) -> different workspace (salt-by-machine).
  const idOtherMachine = deriveWorkspaceId({ machineId: "machine-B", path: "/home/u/repo" });
  assert.notEqual(id1, idOtherMachine);

  // Different path on the same machine -> different workspace.
  const idOtherPath = deriveWorkspaceId({ machineId: "machine-A", path: "/home/u/other" });
  assert.notEqual(id1, idOtherPath);
});

test("mintAgentUuid produces distinct RFC-4122 UUIDs", () => {
  const a = mintAgentUuid();
  const b = mintAgentUuid();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("isH2AWorkspaceRef validates a full ref and rejects malformed input", () => {
  const ref = {
    id: "ws:abc",
    path: "/home/u/repo",
    host: "claude",
    label: "repo"
  };
  assert.ok(isH2AWorkspaceRef(ref));
  assert.ok(isH2AWorkspaceRef({ ...ref, repo: "github.com/o/r" }));
  assert.ok(!isH2AWorkspaceRef(null));
  assert.ok(!isH2AWorkspaceRef({ ...ref, id: 5 }));
  assert.ok(!isH2AWorkspaceRef({ ...ref, path: undefined }));
  assert.ok(!isH2AWorkspaceRef({ ...ref, repo: 7 }));
});
