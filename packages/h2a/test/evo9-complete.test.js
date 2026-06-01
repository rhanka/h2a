import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  H2A_DECLARATION_INTERET_BODY_KIND,
  buildComprehensionAttestation,
  computeHash,
  createEnvelope,
  deriveDecisionDossier,
  deriveMutualisationOpportunities,
  derivePostureConfiance,
  derivePostureConflit,
  deriveValueChain,
  signCanonical
} from "../dist/index.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function engagement(id, extra = {}) {
  return {
    kind: "ENGAGEMENT",
    id,
    scope: `scope:${id}`,
    charter: { goal: `deliver ${id}` },
    roleBindings: [{ role: "CONDUCTOR", instance: "conductor:01" }],
    controls: [],
    policies: [],
    successCriteria: [`accepted: ${id}`],
    ...extra
  };
}

function inst(instance, scopes) {
  return { instance, roles: ["AGENTS"], scopes };
}

function record() {
  return {
    id: "nego-b2b2b-sentropic",
    scope: "scope:agencex",
    parties: ["principal:agencex-achats"],
    subject: "engagement",
    status: "draft",
    requiredSigners: ["principal:agencex-achats"]
  };
}

function entry(body) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `evt-${Math.random().toString(16).slice(2)}`,
    type: "event",
    actor: { instance: "conductor:immo", role: "CONDUCTOR", scope: "scope:agencex" },
    body,
    createdAt: "2026-05-31T00:00:00.000Z",
    sequence: 0,
    contentHash: computeHash(body)
  };
}

function declaration(subject) {
  return {
    kind: H2A_DECLARATION_INTERET_BODY_KIND,
    subject,
    interets: ["relationship at immo"],
    bindings: ["scope:immo"],
    masqueImpactCollectif: true,
    at: "2026-05-31T00:00:00.000Z"
  };
}

function assertNoMeasurementOrLegitimacy(value) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /score|harmScore|metric|measure|mesure|legitimacy|legitimite|validity|verdict|veto/i
  );
}

test("EVO-9 B2B2B dogfood composes value, mutualisation, interest, attention and confiance", () => {
  const sourceDoc = readFileSync(
    new URL("../../../evaluations/confiance/b2b2b-sentropic.md", import.meta.url),
    "utf8"
  );
  assert.match(sourceDoc, /B2B2B|Sentropic/i);

  const sentropicPlatform = engagement("engagement:sentropic-platform", {
    scope: "scope:sentropic",
    finaliteAmont: "serve immo platform",
    aval: "engagement:immo-agencex"
  });
  const immoAgencex = engagement("engagement:immo-agencex", {
    scope: "scope:agencex",
    finaliteAmont: "operate immo for AgenceX users",
    aval: "engagement:agencex-users",
    successCriteria: []
  });

  const valueChain = deriveValueChain(
    [sentropicPlatform, immoAgencex],
    sentropicPlatform.id,
    { disclosureMode: "full-view" }
  );
  assert.deepEqual(valueChain.map((node) => node.id), [
    sentropicPlatform.id,
    immoAgencex.id
  ]);
  assert.equal(valueChain.some((node) => node.boundaryOpaque), false);

  const mutualisation = deriveMutualisationOpportunities([
    inst("claude:a2a-cli", ["scope:eco-sentropic/libs"]),
    inst("codex:a2a-cli", ["scope:eco-sentropic/libs"]),
    inst("claude:immo", ["scope:immo"])
  ]);
  assert.deepEqual(mutualisation, [
    {
      scope: "scope:eco-sentropic/libs",
      instances: ["claude:a2a-cli", "codex:a2a-cli"]
    }
  ]);

  const declared = declaration("principal:agencex-achats");
  const postureConflit = derivePostureConflit("principal:agencex-achats", {
    declarations: [declared],
    ownScopes: ["scope:agencex"],
    decisionScopes: ["scope:agencex", "scope:immo"],
    signers: ["principal:agencex-achats"]
  });
  assert.equal(postureConflit.postureConflit, "conflit-declarable");
  assert.equal(postureConflit.disclosureMode, "evidence-package");

  const dossier = deriveDecisionDossier({
    record: record(),
    journal: [entry({ artifact: immoAgencex })],
    declarations: [declared],
    subjectScopes: { "principal:agencex-achats": ["scope:agencex"] },
    now: "2026-05-31T00:00:00.000Z"
  });
  const dossierHash = computeHash(dossier);
  assert.equal(dossier.items[0].subject, "principal:agencex-achats");
  assert.deepEqual(dossier.items[0].reasons, [
    "conflit-declarable",
    "masque-impact-collectif",
    "cross-scope-aval",
    "missing-success-criteria"
  ]);
  assertNoMeasurementOrLegitimacy(dossier);

  const keys = keypair();
  const attestationBody = buildComprehensionAttestation({
    subject: "principal:agencex-achats",
    dossierHash,
    at: "2026-05-31T00:00:00.000Z"
  });
  const attention = createEnvelope({
    id: "evt-attention-01",
    type: "event",
    actor: {
      instance: "principal:agencex-achats",
      role: "PRINCIPAL",
      scope: "scope:agencex"
    },
    body: attestationBody,
    signatures: [
      signCanonical(attestationBody, {
        by: "principal:agencex-achats",
        privateKeyPem: keys.privatePem
      })
    ]
  });
  assert.equal(attention.body.kind, "comprehension-attestation");
  assert.equal(attention.artifactKind, undefined);

  const confiance = derivePostureConfiance({
    record: record(),
    dossier,
    declarations: [declared],
    attestations: [attention],
    publicKeys: { "principal:agencex-achats": keys.publicPem },
    subjectScopes: { "principal:agencex-achats": ["scope:agencex"] },
    now: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(confiance.attentionAttested, true);
  assert.equal(confiance.postureConfiance, "reservee");
  assert.equal(confiance.disclosedConflicts.length, 1);
  assertNoMeasurementOrLegitimacy(confiance);
});
