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
// H2A-ORG-H1 — memorial-agent declarations (r2 §2.4): an org actor may carry a
// memorial-agent block (launch name, agentUuid enrolment reference, H1 policy
// reference, role-memory purpose, sub-agent purpose opt-in, CLI pass-through
// ceiling). validateOrgManifest enforces the block's invariants; the block is
// the versioned schema extension of the committed org.h2a.yaml.
// ---------------------------------------------------------------------------

function memorialAgent(overrides = {}) {
  return {
    launchName: "dev-1",
    agentUuid: "0199c0de-0000-7000-8000-000000000001",
    policyRef: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    memoryPurpose: "purpose:org:acme/role-memory",
    subAgentMemory: "none",
    cliPassThrough: {
      allowedCliKinds: ["claude", "codex"],
      allowedModels: ["muse-spark-1.3"],
      effortCeiling: "high"
    },
    ...overrides
  };
}

test("a memorial-agent declaration passes validation", () => {
  const manifest = validManifest();
  manifest.instances[2] = { ...manifest.instances[2], memorialAgent: memorialAgent() };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("an explicit sub-agent memory opt-in (inherit) also passes", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ subAgentMemory: "inherit" })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, true);
});

test("an empty launch name → memorial-agent-bad-launch-name", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ launchName: "" })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-launch-name"));
});

test("a per-conversation instance id is not a launch name → memorial-agent-bad-launch-name", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ launchName: "claude:h2a:c18853e319ea" })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-launch-name"));
});

test("two actors claiming one launch name → memorial-agent-duplicate-launch-name", () => {
  const manifest = validManifest();
  manifest.instances[1] = { ...manifest.instances[1], memorialAgent: memorialAgent() };
  manifest.instances[2] = { ...manifest.instances[2], memorialAgent: memorialAgent() };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-duplicate-launch-name"));
});

test("an empty memory purpose → memorial-agent-bad-purpose", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ memoryPurpose: "" })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-purpose"));
});

test("an unknown sub-agent policy → memorial-agent-bad-subagent-policy", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ subAgentMemory: "always" })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-subagent-policy"));
});

test("a pass-through ceiling without CLI kinds → memorial-agent-bad-passthrough", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ cliPassThrough: { allowedCliKinds: [] } })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-passthrough"));
});

test("a non-mapping pass-through ceiling → memorial-agent-bad-passthrough", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ cliPassThrough: "yes" })
  };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-passthrough"));
});

test("empty optional declaration scalars → memorial-agent-bad-declaration", () => {
  const manifest = validManifest();
  manifest.instances[2] = {
    ...manifest.instances[2],
    memorialAgent: memorialAgent({ agentUuid: "" })
  };
  assert.ok(validateOrgManifest(manifest).errors.includes("memorial-agent-bad-declaration"));

  const manifest2 = validManifest();
  manifest2.instances[2] = {
    ...manifest2.instances[2],
    memorialAgent: memorialAgent({ policyRef: "" })
  };
  assert.ok(validateOrgManifest(manifest2).errors.includes("memorial-agent-bad-declaration"));
});

test("a non-mapping memorial-agent block → memorial-agent-bad-declaration", () => {
  const manifest = validManifest();
  manifest.instances[2] = { ...manifest.instances[2], memorialAgent: "dev-1" };
  const result = validateOrgManifest(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("memorial-agent-bad-declaration"));
});
