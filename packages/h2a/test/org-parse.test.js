import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_ORG_MANIFEST_FILENAME,
  parseOrgManifest,
  validateOrgManifest
} from "../dist/index.js";

const YAML = `# personal org for acme
scope: org:acme
version: "1"
instances:
  - instance: claude:lead
    role: PRINCIPAL
    scopes: [org:acme]
  - instance: claude:coach
    role: CONDUCTOR
    scopes:
      - org:acme
      - org:acme/build
    mandateRights: [read, write]
  - instance: codex:dev-1   # a worker
    role: AGENTS
    scopes: [org:acme/build]
commEdges:
  - from: claude:coach
    to: claude:lead
  - from: claude:coach
    to: codex:dev-1
`;

test("filename constant is org.h2a.yaml", () => {
  assert.equal(H2A_ORG_MANIFEST_FILENAME, "org.h2a.yaml");
});

test("parses the block-YAML subset into a typed manifest", () => {
  const { manifest, errors } = parseOrgManifest(YAML);
  assert.deepEqual(errors, []);
  assert.ok(manifest);
  assert.equal(manifest.scope, "org:acme");
  assert.equal(manifest.version, "1");
  assert.equal(manifest.instances.length, 3);

  assert.deepEqual(manifest.instances[0], {
    instance: "claude:lead",
    role: "PRINCIPAL",
    scopes: ["org:acme"]
  });
  // block-list scopes + flow mandateRights both land as string arrays
  assert.deepEqual(manifest.instances[1].scopes, ["org:acme", "org:acme/build"]);
  assert.deepEqual(manifest.instances[1].mandateRights, ["read", "write"]);
  // trailing inline comment is stripped, not folded into the value
  assert.equal(manifest.instances[2].instance, "codex:dev-1");
  assert.deepEqual(manifest.commEdges, [
    { from: "claude:coach", to: "claude:lead" },
    { from: "claude:coach", to: "codex:dev-1" }
  ]);
});

test("parsed manifest is accepted by validateOrgManifest", () => {
  const { manifest } = parseOrgManifest(YAML);
  assert.equal(validateOrgManifest(manifest).ok, true);
});

test("accepts the JSON form (org.h2a.json)", () => {
  const json = JSON.stringify({
    scope: "org:x",
    instances: [{ instance: "a", role: "PRINCIPAL", scopes: ["org:x"] }]
  });
  const { manifest, errors } = parseOrgManifest(json);
  assert.deepEqual(errors, []);
  assert.equal(manifest.scope, "org:x");
  assert.equal(manifest.instances[0].role, "PRINCIPAL");
});

test("a bare scalar scope list is coerced to a one-element array", () => {
  const { manifest } = parseOrgManifest(
    "scope: org:x\ninstances:\n  - instance: a\n    role: PRINCIPAL\n    scopes: org:x\n"
  );
  assert.deepEqual(manifest.instances[0].scopes, ["org:x"]);
});

test("double-quoted scalar keeps its colon/spaces", () => {
  const { manifest } = parseOrgManifest(
    'scope: "org: with spaces"\ninstances:\n  - instance: a\n    role: PRINCIPAL\n    scopes: [s]\n'
  );
  assert.equal(manifest.scope, "org: with spaces");
});

test("tab indentation is rejected with a line-anchored error", () => {
  const { manifest, errors } = parseOrgManifest("scope: org:x\ninstances:\n\t- instance: a\n");
  assert.equal(manifest, undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /line 3: tab indentation/);
});

test("missing scope is a shape error (no manifest)", () => {
  const { manifest, errors } = parseOrgManifest(
    "instances:\n  - instance: a\n    role: PRINCIPAL\n    scopes: [x]\n"
  );
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => /^scope:/.test(e)));
});

test("instances must be a sequence", () => {
  const { manifest, errors } = parseOrgManifest("scope: org:x\ninstances: nope\n");
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => /^instances: expected a sequence/.test(e)));
});

test("non-string role (via JSON) is a shape error", () => {
  const json = JSON.stringify({
    scope: "org:x",
    instances: [{ instance: "a", role: 5, scopes: ["x"] }]
  });
  const { manifest, errors } = parseOrgManifest(json);
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => /instances\[0\]\.role: expected a string/.test(e)));
});

test("invalid JSON yields a single error, never throws", () => {
  const { manifest, errors } = parseOrgManifest("{not json");
  assert.equal(manifest, undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /invalid JSON/);
});

test("empty document parses to an empty mapping → shape errors, no throw", () => {
  const { manifest, errors } = parseOrgManifest("   \n  # only a comment\n");
  assert.equal(manifest, undefined);
  assert.ok(errors.length >= 1);
});

// ---------------------------------------------------------------------------
// H2A-ORG-H1 — the memorial-agent declaration block (r2 §2.4) parses from the
// committed block-YAML subset into the typed declaration, with the same
// path-anchored shape errors as every other manifest field.
// ---------------------------------------------------------------------------

const MEMORIAL_YAML = `scope: org:acme
instances:
  - instance: claude:lead
    role: PRINCIPAL
    scopes: [org:acme]
  - instance: codex:dev-1
    role: AGENTS
    scopes: [org:acme]
    memorialAgent:
      launchName: dev-1
      agentUuid: 0199c0de-0000-7000-8000-000000000001
      policyRef: sha256:0000
      memoryPurpose: purpose:org:acme/role-memory
      subAgentMemory: none
      cliPassThrough:
        allowedCliKinds: [claude, codex]
        allowedModels: [muse-spark-1.3]
        effortCeiling: high
`;

test("parses a memorial-agent declaration block", () => {
  const { manifest, errors } = parseOrgManifest(MEMORIAL_YAML);
  assert.deepEqual(errors, []);
  assert.ok(manifest);
  assert.deepEqual(manifest.instances[1].memorialAgent, {
    launchName: "dev-1",
    agentUuid: "0199c0de-0000-7000-8000-000000000001",
    policyRef: "sha256:0000",
    memoryPurpose: "purpose:org:acme/role-memory",
    subAgentMemory: "none",
    cliPassThrough: {
      allowedCliKinds: ["claude", "codex"],
      allowedModels: ["muse-spark-1.3"],
      effortCeiling: "high"
    }
  });
  // an instance without a block stays without one
  assert.equal(manifest.instances[0].memorialAgent, undefined);
});

test("a missing launchName in the memorial-agent block is a shape error", () => {
  const bad = MEMORIAL_YAML.replace("      launchName: dev-1\n", "");
  const { manifest, errors } = parseOrgManifest(bad);
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => /instances\[1\]\.memorialAgent\.launchName: a non-empty string is required/.test(e)));
});

test("an unknown sub-agent policy in YAML is a shape error", () => {
  const bad = MEMORIAL_YAML.replace("subAgentMemory: none", "subAgentMemory: always");
  const { manifest, errors } = parseOrgManifest(bad);
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => /instances\[1\]\.memorialAgent\.subAgentMemory: expected "none" or "inherit"/.test(e)));
});

test("a pass-through ceiling without CLI kinds in YAML is a shape error", () => {
  const bad = MEMORIAL_YAML.replace("        allowedCliKinds: [claude, codex]", "        allowedModels: [muse-spark-1.3]");
  const { manifest, errors } = parseOrgManifest(bad);
  assert.equal(manifest, undefined);
  assert.ok(
    errors.some((e) =>
      /instances\[1\]\.memorialAgent\.cliPassThrough\.allowedCliKinds: at least one CLI kind is required/.test(e)
    )
  );
});

test("a non-mapping memorialAgent in YAML is a shape error", () => {
  // the whole declaration block collapses into a bare scalar
  const bad =
    MEMORIAL_YAML.slice(0, MEMORIAL_YAML.indexOf("    memorialAgent:")) + "    memorialAgent: dev-1\n";
  const { manifest, errors } = parseOrgManifest(bad);
  assert.equal(manifest, undefined);
  assert.ok(errors.some((e) => /instances\[1\]\.memorialAgent: expected a mapping/.test(e)));
});
