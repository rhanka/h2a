import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_ORG_PROPOSAL_BODY_KIND,
  H2A_ORG_RATIFIED_BODY_KIND,
  isH2AEnvelope,
  orgAssignmentEnvelope,
  signEnvelope,
  validateOrgManifest,
  verifyEnvelopeSignature
} from "../dist/index.js";

function validManifest() {
  return {
    scope: "org:acme",
    version: "1",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:coach", role: "CONDUCTOR", scopes: ["org:acme", "org:acme/build"] },
      { instance: "claude:dev-1", role: "AGENTS", scopes: ["org:acme/build"], mandateRights: ["read", "write"] }
    ],
    commEdges: [
      { from: "claude:coach", to: "claude:dev-1" },
      { from: "claude:coach", to: "claude:lead" }
    ]
  };
}

test("a valid manifest passes with no errors", () => {
  const result = validateOrgManifest(validManifest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("missing PRINCIPAL → no-principal", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:coach", role: "CONDUCTOR", scopes: ["org:acme"] },
      { instance: "claude:dev-1", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("no-principal"));
});

test("duplicate instance id → duplicate-instance", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:lead", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("duplicate-instance"));
});

test("empty instance id → instance-empty", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "", role: "AGENTS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-empty"));
});

test("instance with no scope → instance-no-scope", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:dev-1", role: "AGENTS", scopes: [] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-no-scope"));
});

test("non-canonical role → instance-bad-role", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
      { instance: "claude:dev-1", role: "BOSS", scopes: ["org:acme"] }
    ]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-bad-role"));
});

test("commEdge to an unknown instance → edge-unknown-instance", () => {
  const manifest = {
    scope: "org:acme",
    instances: [
      { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] }
    ],
    commEdges: [{ from: "claude:lead", to: "claude:ghost" }]
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("edge-unknown-instance"));
});

test("orgAssignmentEnvelope builds an event envelope; defaults to org-proposal", () => {
  const manifest = validManifest();
  const envelope = orgAssignmentEnvelope({
    manifest,
    actor: { instance: "claude:coach", role: "CONDUCTOR", scope: "org:acme" },
    createdAt: "2026-05-28T00:00:00.000Z"
  });
  assert.ok(isH2AEnvelope(envelope));
  assert.equal(envelope.type, "event");
  assert.equal(envelope.actor.instance, "claude:coach");
  assert.equal(envelope.actor.role, "CONDUCTOR");
  assert.equal(envelope.body.kind, H2A_ORG_PROPOSAL_BODY_KIND);
  assert.deepEqual(envelope.body.manifest, manifest);
  assert.equal(envelope.createdAt, "2026-05-28T00:00:00.000Z");
  assert.ok(envelope.id.startsWith("org-"));
  assert.equal(envelope.signatures, undefined);
});

test("orgAssignmentEnvelope honors an explicit org-ratified kind", () => {
  const envelope = orgAssignmentEnvelope({
    manifest: validManifest(),
    actor: { instance: "claude:lead", role: "PRINCIPAL", scope: "org:acme" },
    kind: H2A_ORG_RATIFIED_BODY_KIND
  });
  assert.equal(envelope.body.kind, H2A_ORG_RATIFIED_BODY_KIND);
});

test("a proposal signs + verifies (round-trip); tampering with the manifest breaks it", () => {
  const manifest = validManifest();
  const envelope = orgAssignmentEnvelope({
    manifest,
    actor: { instance: "claude:coach", role: "CONDUCTOR", scope: "org:acme" },
    createdAt: "2026-05-28T00:00:00.000Z"
  });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const signed = signEnvelope(envelope, { by: "claude:coach", privateKeyPem: privatePem });
  assert.equal(signed.signatures.length, 1);
  assert.equal(verifyEnvelopeSignature(signed, publicPem, { by: "claude:coach" }), true);

  // Tampering with the manifest breaks verification.
  const tampered = {
    ...signed,
    body: {
      ...signed.body,
      manifest: { ...signed.body.manifest, scope: "org:evil" }
    }
  };
  assert.equal(verifyEnvelopeSignature(tampered, publicPem, { by: "claude:coach" }), false);
});

// ---------------------------------------------------------------------------
// H2A-ORG-H1 — memorial-agent declarations in the co-signed `org.h2a.yaml`
// v2 schema (spec-r4-h2a-cosign §2.1, r2 §2.4): per org actor, the L1
// declaration (launch name equal to the instance, agentUuid enrolment
// reference, H1 policy references, requested memory scopes, purpose grants
// with the explicit sub-agent opt-in, CLI/model/effort ceiling, declaring
// owner). The general CLI pass-through ceiling (runs WITHOUT a memorial
// agent, Q-D) lives at the manifest level (`generalCliPolicy`), never on the
// agent's L1 declaration. validateOrgManifest enforces the §2.2 codes.
// ---------------------------------------------------------------------------

function memorialAgent(overrides = {}) {
  return {
    launchName: "claude:dev-1",
    agentUuidRef: "0199c0de-0000-7000-8000-000000000001",
    policyRefs: ["pol:org:acme:dev-1:v1"],
    memoryScopes: ["role", "repo"],
    purposeGrants: [
      { scopeKind: "role", purposeRef: "purpose:org:acme/dev-1/role", allowSubagentExec: false },
      { scopeKind: "repo", purposeRef: "purpose:org:acme/dev-1/repo", allowSubagentExec: true }
    ],
    allowedCliKinds: ["claude", "codex"],
    allowedModels: ["muse-spark-1.3"],
    effortCeiling: "high",
    declaringOwner: "claude:lead",
    ...overrides
  };
}

function memorialManifest(declarationOverrides = {}, extra = {}) {
  const manifest = validManifest();
  manifest.instances[2] = { ...manifest.instances[2], memorialAgent: memorialAgent(declarationOverrides) };
  return { ...manifest, ...extra };
}

test("a memorial-agent declaration passes validation", () => {
  const result = validateOrgManifest(memorialManifest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("a declaration without any memory scope also passes (no memory requested)", () => {
  const result = validateOrgManifest(
    memorialManifest({ memoryScopes: [], purposeGrants: [] })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("an empty launch name → memorial-agent-bad-launch-name", () => {
  const result = validateOrgManifest(memorialManifest({ launchName: "" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-launch-name"));
});

test("a per-conversation instance id is not a launch name → memorial-agent-bad-launch-name", () => {
  const result = validateOrgManifest(memorialManifest({ launchName: "claude:h2a:c18853e319ea" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-launch-name"));
});

test("a per-conversation instance id is never a valid org instance id → instance-per-conversation-id-forbidden", () => {
  const manifest = validManifest();
  manifest.instances[2] = { ...manifest.instances[2], instance: "claude:h2a:c18853e319ea" };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("instance-per-conversation-id-forbidden"));
});

test("a launch name that is not the parent instance id → memorial-launch-name-mismatch", () => {
  // the declaration names org actors by their bare launch name, which must be
  // exactly the instance id it hangs from (spec §2.1)
  const result = validateOrgManifest(memorialManifest({ launchName: "someone-else" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-launch-name-mismatch"));
});

test("two actors claiming one launch name → memorial-agent-duplicate-launch-name", () => {
  const manifest = validManifest();
  manifest.instances[1] = { ...manifest.instances[1], memorialAgent: memorialAgent() };
  manifest.instances[2] = { ...manifest.instances[2], memorialAgent: memorialAgent() };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-duplicate-launch-name"));
});

test("an empty allowedCliKinds → memorial-empty-cli-kinds", () => {
  const result = validateOrgManifest(memorialManifest({ allowedCliKinds: [] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-empty-cli-kinds"));
});

test("an absent allowedCliKinds → memorial-empty-cli-kinds (required field)", () => {
  const manifest = memorialManifest();
  delete manifest.instances[2].memorialAgent.allowedCliKinds;
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-empty-cli-kinds"));
});

test("an empty allowedModels → memorial-empty-models", () => {
  const result = validateOrgManifest(memorialManifest({ allowedModels: [] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-empty-models"));
});

test("an unknown memory scope → memorial-invalid-memory-scope", () => {
  const result = validateOrgManifest(memorialManifest({ memoryScopes: ["team"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-invalid-memory-scope"));
});

test("a purpose grant naming an unrequested scope → memorial-purpose-scope-unlisted", () => {
  const result = validateOrgManifest(
    memorialManifest({ memoryScopes: ["role"], purposeGrants: [{ scopeKind: "repo", purposeRef: "purpose:x" }] })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-purpose-scope-unlisted"));
});

test("an empty purposeRef → memorial-agent-bad-purpose", () => {
  const result = validateOrgManifest(
    memorialManifest({ purposeGrants: [{ scopeKind: "role", purposeRef: "" }] })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-purpose"));
});

test("a non-boolean sub-agent opt-in → memorial-agent-bad-subagent-policy", () => {
  const result = validateOrgManifest(
    memorialManifest({
      purposeGrants: [{ scopeKind: "role", purposeRef: "purpose:x", allowSubagentExec: "yes" }]
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-subagent-policy"));
});

test("malformed required declaration scalars → memorial-agent-bad-declaration", () => {
  const emptyUuid = validateOrgManifest(memorialManifest({ agentUuidRef: "" }));
  assert.ok(emptyUuid.errors.includes("memorial-agent-bad-declaration"));

  const noRefs = memorialManifest();
  delete noRefs.instances[2].memorialAgent.policyRefs;
  assert.ok(validateOrgManifest(noRefs).errors.includes("memorial-agent-bad-declaration"));

  const emptyRefs = validateOrgManifest(memorialManifest({ policyRefs: [] }));
  assert.ok(emptyRefs.errors.includes("memorial-agent-bad-declaration"));

  const noOwner = memorialManifest();
  delete noOwner.instances[2].memorialAgent.declaringOwner;
  assert.ok(validateOrgManifest(noOwner).errors.includes("memorial-agent-bad-declaration"));

  const badEffort = validateOrgManifest(memorialManifest({ effortCeiling: "" }));
  assert.ok(badEffort.errors.includes("memorial-agent-bad-declaration"));
});

test("a non-mapping memorial-agent block → memorial-agent-bad-declaration", () => {
  const manifest = validManifest();
  manifest.instances[2] = { ...manifest.instances[2], memorialAgent: "dev-1" };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-declaration"));
});

// ---------------------------------------------------------------------------
// The manifest-level general CLI policy (Q-D): the pass-through ceiling for
// runs WITHOUT a memorial agent — never on the agent's L1 declaration.
// ---------------------------------------------------------------------------

function generalCliPolicy(overrides = {}) {
  return {
    generalPolicyRef: "gpol:org:acme:passthrough-readonly:v1",
    allowedCliKinds: ["claude", "codex"],
    allowedModels: ["*"],
    effortCeiling: "high",
    allowedTools: ["h2a_discover_sessions"],
    allowMemory: false,
    ...overrides
  };
}

test("a well-formed generalCliPolicy passes (Q-D default posture)", () => {
  const manifest = validManifest();
  const result = validateOrgManifest({ ...manifest, generalCliPolicy: generalCliPolicy() });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("a generalCliPolicy granting memory → passthrough-memory-forbidden (R4-05)", () => {
  const manifest = validManifest();
  const result = validateOrgManifest({
    ...manifest,
    generalCliPolicy: generalCliPolicy({ allowMemory: true })
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("passthrough-memory-forbidden"));
});

test("a generalCliPolicy allowing an engram_memory_* tool → passthrough-memory-forbidden", () => {
  const manifest = validManifest();
  const result = validateOrgManifest({
    ...manifest,
    generalCliPolicy: generalCliPolicy({ allowedTools: ["h2a_org_show", "engram_memory_get"] })
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("passthrough-memory-forbidden"));
});

test("a malformed generalCliPolicy → general-cli-policy-bad", () => {
  const manifest = validManifest();
  for (const bad of [
    "yes",
    { ...generalCliPolicy(), generalPolicyRef: "" },
    { ...generalCliPolicy(), allowedCliKinds: [] },
    { ...generalCliPolicy(), allowedCliKinds: "claude" },
    { ...generalCliPolicy(), allowedTools: "h2a_org_show" },
    { ...generalCliPolicy(), effortCeiling: "" }
  ]) {
    const result = validateOrgManifest({ ...manifest, generalCliPolicy: bad });
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.ok(result.errors.includes("general-cli-policy-bad"), JSON.stringify(bad));
  }
});
