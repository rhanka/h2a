/**
 * H2A-REG-H2-H4 — H4: `RoleAgentAttestationV1` (r2 §8.1 H4) anchored on the
 * perennial `agentUuid` + `launchName`, ed25519-signed over the canonical
 * bytes excluding `signature`, with the refusal corpus (bad signature,
 * unknown format, superseded key-set revision, unavailable signer key) and
 * the pure estate-inventory collision detector (§2.4 estate migration /
 * R2-P1-5: owner resolution queue, never auto-merged, never touching a real
 * ~/.h2a).
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_ROLE_AGENT_ATTESTATION_V1_FORMAT,
  buildRoleAgentAttestationV1,
  computeKeySetRevision,
  inventoryEstate,
  verifyRoleAgentAttestationV1
} from "../dist/index.js";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" })
  };
}

const FIXED_AT = "2026-10-30T00:00:00.000Z";

function attestationInput(signerKeys) {
  return {
    agentUuid: "uuid-a",
    launchName: "alpha",
    actorLaunchName: "alpha",
    scope: "scope:default",
    attestingInstance: "claude:alpha:aaaaaaaaaaaa",
    keyIds: ["sha256:aa", "sha256:bb"],
    issuedAt: FIXED_AT,
    signer: {
      instance: "claude:alpha:aaaaaaaaaaaa",
      keyId: "sha256:signer",
      privateKeyPem: signerKeys.privateKeyPem
    }
  };
}

test("H4 build produces the frozen shape and a verifiable ed25519 signature", () => {
  const signer = keypair();
  const att = buildRoleAgentAttestationV1({
    ...attestationInput(signer),
    keySetRevision: computeKeySetRevision(["sha256:aa", "sha256:bb"])
  });

  assert.equal(att.format, "h2a.role-agent-attestation/v1");
  assert.equal(H2A_ROLE_AGENT_ATTESTATION_V1_FORMAT, "h2a.role-agent-attestation/v1");
  assert.equal(att.agentUuid, "uuid-a");
  assert.equal(att.launchName, "alpha");
  assert.equal(att.actorLaunchName, "alpha");
  assert.equal(att.scope, "scope:default");
  assert.equal(att.attestingInstance, "claude:alpha:aaaaaaaaaaaa");
  assert.equal(att.signerInstance, "claude:alpha:aaaaaaaaaaaa");
  assert.equal(att.signerKeyId, "sha256:signer");
  assert.equal(typeof att.signature, "string");
  assert.ok(att.signature.length > 0);

  const verdict = verifyRoleAgentAttestationV1(att, {
    resolveSignerKey: () => signer.publicKeyPem
  });
  assert.deepEqual(verdict, { ok: true });
});

test("H4 refusal corpus: named reasons, no silent acceptance", () => {
  const signer = keypair();
  const att = buildRoleAgentAttestationV1({
    ...attestationInput(signer),
    keySetRevision: computeKeySetRevision(["sha256:aa", "sha256:bb"])
  });

  // Bad signature: any tampering of the signed document must refuse.
  const tampered = { ...att, actorLaunchName: "mallory" };
  assert.deepEqual(
    verifyRoleAgentAttestationV1(tampered, { resolveSignerKey: () => signer.publicKeyPem }),
    { ok: false, reason: "bad_signature" }
  );

  // Unknown format/version.
  const wrongFormat = { ...att, format: "h2a.role-agent-attestation/v2" };
  assert.deepEqual(
    verifyRoleAgentAttestationV1(wrongFormat, { resolveSignerKey: () => signer.publicKeyPem }),
    { ok: false, reason: "unknown_format" }
  );

  // Signer key not resolvable through H2.
  assert.deepEqual(
    verifyRoleAgentAttestationV1(att, { resolveSignerKey: () => undefined }),
    { ok: false, reason: "signer_key_unavailable" }
  );

  // Superseded key-set revision: the current revision differs → refuse.
  const verdict = verifyRoleAgentAttestationV1(att, {
    resolveSignerKey: () => signer.publicKeyPem,
    expectedKeySetRevision: computeKeySetRevision(["sha256:aa", "sha256:bb", "sha256:cc"])
  });
  assert.deepEqual(verdict, { ok: false, reason: "key_set_revision_superseded" });
});

test("key rotation changes the key-set revision, so re-attestation is required", () => {
  const before = computeKeySetRevision(["sha256:aa", "sha256:bb"]);
  const sameOrder = computeKeySetRevision(["sha256:bb", "sha256:aa"]);
  const afterRotation = computeKeySetRevision(["sha256:aa", "sha256:bb", "sha256:cc"]);

  assert.equal(before, sameOrder, "key-set revision must be order-independent");
  assert.notEqual(before, afterRotation, "key rotation must change the key-set revision");

  const signer = keypair();
  const att = buildRoleAgentAttestationV1({
    ...attestationInput(signer),
    keyIds: ["sha256:aa", "sha256:bb"],
    keySetRevision: before
  });
  assert.deepEqual(
    verifyRoleAgentAttestationV1(att, {
      resolveSignerKey: () => signer.publicKeyPem,
      expectedKeySetRevision: afterRotation
    }),
    { ok: false, reason: "key_set_revision_superseded" }
  );

  // Re-attestation over the rotated set verifies again.
  const reAttested = buildRoleAgentAttestationV1({
    ...attestationInput(signer),
    keyIds: ["sha256:aa", "sha256:bb", "sha256:cc"],
    keySetRevision: afterRotation
  });
  assert.deepEqual(
    verifyRoleAgentAttestationV1(reAttested, {
      resolveSignerKey: () => signer.publicKeyPem,
      expectedKeySetRevision: afterRotation
    }),
    { ok: true }
  );
});

test("estate inventory: one MemorialAgent per anchored agentUuid, pure inputs", () => {
  const report = inventoryEstate({
    registrations: [
      {
        id: "claude:alpha:aaaaaaaaaaaa",
        instance: "claude:alpha:aaaaaaaaaaaa",
        roles: ["AGENTS"],
        scopes: ["scope:default"],
        capabilities: [],
        endpoints: [{ kind: "local-files", uri: "file://x" }],
        publicKeys: ["pem-a"],
        acceptedPolicies: [],
        createdAt: FIXED_AT,
        agentUuid: "uuid-a",
        name: "alpha"
      },
      {
        id: "claude:alpha2:aaaaaaaaaaaa",
        instance: "claude:alpha2:aaaaaaaaaaaa",
        roles: ["AGENTS"],
        scopes: ["scope:default"],
        capabilities: [],
        endpoints: [{ kind: "local-files", uri: "file://x" }],
        publicKeys: ["pem-a2"],
        acceptedPolicies: [],
        createdAt: "2026-10-30T02:00:00.000Z",
        agentUuid: "uuid-a",
        name: "alpha"
      }
    ],
    bindings: [
      {
        host: "claude",
        providerSessionId: "conv-1",
        workspaceId: "ws:one",
        instance: "claude:alpha:aaaaaaaaaaaa",
        agentUuid: "uuid-a",
        at: FIXED_AT
      },
      {
        host: "claude",
        providerSessionId: "conv-2",
        workspaceId: "ws:one",
        instance: "claude:alpha2:aaaaaaaaaaaa",
        agentUuid: "uuid-a",
        at: FIXED_AT
      }
    ]
  });

  assert.equal(report.format, "h2a.estate-inventory/v1");
  assert.equal(report.resolutionQueue.length, 0);
  assert.equal(report.memorialAgents.length, 1);
  const agent = report.memorialAgents[0];
  assert.equal(agent.agentUuid, "uuid-a");
  assert.equal(agent.launchName, "alpha");
  assert.deepEqual(new Set(agent.instances), new Set([
    "claude:alpha:aaaaaaaaaaaa",
    "claude:alpha2:aaaaaaaaaaaa"
  ]));
});

test("estate inventory: legacy rows and launch-name collisions go to the owner queue, never auto-merged", () => {
  const legacy = {
    id: "codex:legacy",
    instance: "codex:legacy",
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file://x" }],
    publicKeys: ["pem-legacy"],
    acceptedPolicies: [],
    createdAt: FIXED_AT,
    name: "legacy"
  };
  const claim1 = {
    id: "claude:beta:bbbbbbbbbbbb",
    instance: "claude:beta:bbbbbbbbbbbb",
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file://x" }],
    publicKeys: ["pem-b1"],
    acceptedPolicies: [],
    createdAt: FIXED_AT,
    agentUuid: "uuid-b1",
    name: "beta"
  };
  const claim2 = {
    id: "claude:beta:cccccccccccc",
    instance: "claude:beta:cccccccccccc",
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file://x" }],
    publicKeys: ["pem-b2"],
    acceptedPolicies: [],
    createdAt: FIXED_AT,
    agentUuid: "uuid-b2",
    name: "beta"
  };
  const bindingFor = (instance, agentUuid) => ({
    host: "claude",
    providerSessionId: `conv-${agentUuid}`,
    workspaceId: "ws:one",
    instance,
    agentUuid,
    at: FIXED_AT
  });

  const report = inventoryEstate({
    registrations: [legacy, claim1, claim2],
    bindings: [
      bindingFor("claude:beta:bbbbbbbbbbbb", "uuid-b1"),
      bindingFor("claude:beta:cccccccccccc", "uuid-b2")
    ]
  });

  // No auto-merge: the conflicted launch name produces NO level-1 record.
  assert.equal(report.memorialAgents.length, 0);

  const noAnchor = report.resolutionQueue.find((i) => i.kind === "registration_without_perennial_binding");
  assert.ok(noAnchor, "legacy registration must be queued");
  assert.deepEqual(noAnchor.instances, ["codex:legacy"]);

  const collision = report.resolutionQueue.find((i) => i.kind === "launch_name_claimed_by_two_agents");
  assert.ok(collision, "launch-name collision must be queued");
  assert.equal(collision.launchName, "beta");
  assert.deepEqual([...collision.agentUuids].sort(), ["uuid-b1", "uuid-b2"]);
});

test("estate inventory: agentUuid without a resolvable launch name is queued", () => {
  const report = inventoryEstate({
    registrations: [
      {
        id: "claude:nameless:dddddddddddd",
        instance: "claude:nameless:dddddddddddd",
        roles: ["AGENTS"],
        scopes: ["scope:default"],
        capabilities: [],
        endpoints: [{ kind: "local-files", uri: "file://x" }],
        publicKeys: ["pem-d"],
        acceptedPolicies: [],
        createdAt: FIXED_AT,
        agentUuid: "uuid-d"
      }
    ],
    bindings: [
      {
        host: "claude",
        providerSessionId: "conv-d",
        workspaceId: "ws:one",
        instance: "claude:nameless:dddddddddddd",
        agentUuid: "uuid-d",
        at: FIXED_AT
      }
    ]
  });

  assert.equal(report.memorialAgents.length, 0);
  const item = report.resolutionQueue.find((i) => i.kind === "agent_without_launch_name");
  assert.ok(item);
  assert.deepEqual(item.agentUuids, ["uuid-d"]);
});
