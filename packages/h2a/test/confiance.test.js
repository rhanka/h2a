import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_DECLARATION_INTERET_BODY_KIND,
  buildComprehensionAttestation,
  computeHash,
  createEnvelope,
  deriveDecisionDossier,
  derivePostureConfiance,
  signCanonical
} from "../dist/index.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function record(overrides = {}) {
  return {
    id: "nego-confiance",
    scope: "scope:agencex",
    parties: ["principal:agencex-achats"],
    subject: "engagement",
    status: "draft",
    requiredSigners: ["principal:agencex-achats"],
    ...overrides
  };
}

function entry(body, extra = {}) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `evt-${Math.random().toString(16).slice(2)}`,
    type: "event",
    actor: { instance: "conductor:immo", role: "CONDUCTOR", scope: "scope:agencex" },
    body,
    createdAt: "2026-05-31T00:00:00.000Z",
    sequence: 0,
    contentHash: computeHash(body),
    ...extra
  };
}

function artifact(overrides = {}) {
  return {
    kind: "ENGAGEMENT",
    id: "engagement:agencex-immo",
    scope: "scope:agencex",
    charter: { goal: "operate AgenceX immo service" },
    roleBindings: [],
    controls: [],
    policies: [],
    successCriteria: ["accepted by AgenceX"],
    ...overrides
  };
}

function declaration(subject, extra = {}) {
  return {
    kind: H2A_DECLARATION_INTERET_BODY_KIND,
    subject,
    interets: ["relationship at immo"],
    bindings: ["scope:immo"],
    at: "2026-05-31T00:00:00.000Z",
    ...extra
  };
}

function attestation(subject, dossierHash, keys) {
  const body = buildComprehensionAttestation({
    subject,
    dossierHash,
    at: "2026-05-31T00:00:00.000Z"
  });
  return createEnvelope({
    id: `evt-attn-${subject}`,
    type: "event",
    actor: { instance: subject, role: "PRINCIPAL", scope: "scope:agencex" },
    body,
    signatures: [signCanonical(body, { by: subject, privateKeyPem: keys.privatePem })]
  });
}

function dossierFor(inputRecord, journal) {
  return deriveDecisionDossier({
    record: inputRecord,
    journal,
    now: "2026-05-31T00:00:00.000Z"
  });
}

test("derivePostureConfiance is etablie with fresh attention and no conflict", () => {
  const signer = keypair();
  const inputRecord = record();
  const dossier = dossierFor(inputRecord, [entry({ artifact: artifact() })]);
  const dossierHash = computeHash(dossier);

  const posture = derivePostureConfiance({
    record: inputRecord,
    dossier,
    attestations: [attestation("principal:agencex-achats", dossierHash, signer)],
    publicKeys: { "principal:agencex-achats": signer.publicPem },
    now: "2026-05-31T00:00:00.000Z"
  });

  assert.equal(posture.postureConfiance, "etablie");
  assert.equal(posture.attentionAttested, true);
  assert.equal(posture.noUndisclosedCollectiveConflict, true);
  assert.deepEqual(posture.missingAttestations, []);
  assert.deepEqual(posture.staleAttestations, []);
});

test("derivePostureConfiance is non-etablie when attention is stale", () => {
  const signer = keypair();
  const inputRecord = record();
  const firstDossier = dossierFor(inputRecord, [entry({ artifact: artifact() })]);
  const currentDossier = dossierFor(inputRecord, [
    entry({ artifact: artifact({ successCriteria: [], aval: "engagement:sentropic-platform" }) })
  ]);
  const staleHash = computeHash(firstDossier);
  const currentHash = computeHash(currentDossier);
  assert.notEqual(staleHash, currentHash);

  const posture = derivePostureConfiance({
    record: inputRecord,
    dossier: currentDossier,
    attestations: [attestation("principal:agencex-achats", staleHash, signer)],
    publicKeys: { "principal:agencex-achats": signer.publicPem },
    now: "2026-05-31T00:00:00.000Z"
  });

  assert.equal(posture.postureConfiance, "non-etablie");
  assert.equal(posture.attentionAttested, false);
  assert.deepEqual(posture.missingAttestations, ["principal:agencex-achats"]);
  assert.deepEqual(posture.staleAttestations, ["principal:agencex-achats"]);
  assert.ok(posture.reasons.includes("attention-not-attested"));
});

test("derivePostureConfiance distinguishes undisclosed and disclosed collective conflict", () => {
  const signer = keypair();
  const inputRecord = record();
  const journal = [entry({ artifact: artifact({ aval: "engagement:sentropic-platform" }) })];
  const dossier = dossierFor(inputRecord, journal);
  const dossierHash = computeHash(dossier);
  const common = {
    record: inputRecord,
    dossier,
    attestations: [attestation("principal:agencex-achats", dossierHash, signer)],
    publicKeys: { "principal:agencex-achats": signer.publicPem },
    subjectScopes: { "principal:agencex-achats": ["scope:agencex"] },
    controleFlags: ["principal:agencex-achats"],
    now: "2026-05-31T00:00:00.000Z"
  };

  const undisclosed = derivePostureConfiance(common);
  assert.equal(undisclosed.postureConfiance, "non-etablie");
  assert.equal(undisclosed.attentionAttested, true);
  assert.equal(undisclosed.noUndisclosedCollectiveConflict, false);
  assert.deepEqual(undisclosed.undisclosedConflicts, ["principal:agencex-achats"]);
  assert.ok(undisclosed.reasons.includes("undisclosed-collective-conflict"));

  const disclosedDeclaration = declaration("principal:agencex-achats", {
    masqueImpactCollectif: true
  });
  const disclosedDossier = deriveDecisionDossier({
    record: inputRecord,
    journal,
    declarations: [disclosedDeclaration],
    subjectScopes: { "principal:agencex-achats": ["scope:agencex"] },
    controleFlags: ["principal:agencex-achats"],
    now: "2026-05-31T00:00:00.000Z"
  });
  const disclosed = derivePostureConfiance({
    ...common,
    dossier: disclosedDossier,
    attestations: [
      attestation("principal:agencex-achats", computeHash(disclosedDossier), signer)
    ],
    declarations: [disclosedDeclaration]
  });
  assert.equal(disclosed.postureConfiance, "reservee");
  assert.equal(disclosed.noUndisclosedCollectiveConflict, true);
  assert.equal(disclosed.disclosedConflicts.length, 1);
  assert.equal(disclosed.disclosedConflicts[0].subject, "principal:agencex-achats");
  assert.equal(disclosed.disclosedConflicts[0].postureConflit, "conflit-declarable");
  assert.ok(disclosed.reasons.includes("disclosed-collective-conflict"));

  const serialized = JSON.stringify(disclosed);
  assert.doesNotMatch(serialized, /score|harmScore|measure|legitimacy|validity|verdict/i);
});
