import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_DECISION_DOSSIER_KIND,
  H2A_DECISION_DOSSIER_RANK_REASONS,
  H2A_DECLARATION_INTERET_BODY_KIND,
  computeHash,
  deriveDecisionDossier,
  evaluatePresenterBias
} from "../dist/index.js";

function record(overrides = {}) {
  return {
    id: "nego-b2c",
    scope: "scope:agencex",
    parties: ["achats:agencex"],
    subject: "engagement",
    status: "draft",
    requiredSigners: ["achats:agencex", "metier:agencex"],
    ...overrides
  };
}

function entry(body) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `evt-${Math.random().toString(16).slice(2)}`,
    type: "propose",
    actor: { instance: "conductor:immo", role: "CONDUCTOR", scope: "scope:agencex" },
    body,
    createdAt: "2026-05-31T00:00:00.000Z",
    sequence: 0,
    contentHash: computeHash(body)
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

test("deriveDecisionDossier ranks only structural and declared attention reasons", () => {
  const artifact = {
    kind: "ENGAGEMENT",
    id: "engagement:b2c",
    scope: "scope:agencex",
    aval: "engagement:a2b",
    charter: {},
    roleBindings: [],
    controls: [],
    policies: [],
    successCriteria: []
  };
  const declared = declaration("achats:agencex", { masqueImpactCollectif: true });
  const dossier = deriveDecisionDossier({
    record: record(),
    journal: [entry({ artifact })],
    declarations: [declared],
    subjectScopes: {
      "achats:agencex": ["scope:agencex"],
      "metier:agencex": ["scope:agencex"]
    },
    now: "2026-05-31T00:00:00.000Z"
  });

  assert.equal(dossier.kind, H2A_DECISION_DOSSIER_KIND);
  assert.equal(dossier.negotiationId, "nego-b2c");
  assert.equal(dossier.artifactHash, computeHash(artifact));
  assert.deepEqual(H2A_DECISION_DOSSIER_RANK_REASONS, [
    "conflit-declarable",
    "masque-impact-collectif",
    "amends-signed-artifact",
    "cross-scope-aval",
    "missing-success-criteria"
  ]);

  assert.equal(dossier.items[0].subject, "achats:agencex");
  assert.equal(dossier.items[0].rank, 1);
  assert.equal(dossier.items[0].postureConflit, "conflit-declarable");
  assert.deepEqual(dossier.items[0].reasons, [
    "conflit-declarable",
    "masque-impact-collectif",
    "cross-scope-aval",
    "missing-success-criteria"
  ]);
  assert.equal(dossier.items[0].masqueImpactCollectif, true);
  assert.equal(dossier.items[0].crossScopeAval, true);
  assert.equal(dossier.items[0].missingSuccessCriteria, true);
  assert.equal("score" in dossier.items[0], false);
  assert.equal("harmScore" in dossier.items[0], false);
  assert.equal("legitimacy" in dossier.items[0], false);

  assert.equal(dossier.items[1].subject, "metier:agencex");
  assert.equal(dossier.items[1].rank, 2);
  assert.deepEqual(dossier.items[1].reasons, [
    "cross-scope-aval",
    "missing-success-criteria"
  ]);
});

test("deriveDecisionDossier flags amendments to signed artifacts procedurally", () => {
  const amendment = {
    kind: "AMENDMENT",
    id: "amendment:b2c",
    targetKind: "ENGAGEMENT",
    targetId: "engagement:b2c",
    baseArtifactHash: computeHash({ signed: "artifact" }),
    changes: [],
    signatures: []
  };

  const dossier = deriveDecisionDossier({
    record: record({ requiredSigners: ["achats:agencex"] }),
    journal: [entry({ artifact: amendment })],
    now: "2026-05-31T00:00:00.000Z"
  });

  assert.equal(dossier.items.length, 1);
  assert.equal(dossier.items[0].amendsSignedArtifact, true);
  assert.deepEqual(dossier.items[0].reasons, ["amends-signed-artifact"]);
});

test("evaluatePresenterBias reuses derivePostureConflit at decide time", () => {
  const biased = evaluatePresenterBias("mandataire:vendor", {
    declarations: [declaration("mandataire:vendor")],
    ownScopes: ["scope:vendor"],
    decisionScopes: ["scope:agencex"],
    signers: []
  });
  assert.equal(biased.biased, true);
  assert.equal(biased.posture.postureConflit, "conflit-declarable");
  assert.deepEqual(biased.posture.criteres, ["hors-scope-propre"]);

  const clean = evaluatePresenterBias("mandataire:clean", {
    declarations: [],
    ownScopes: ["scope:agencex"],
    decisionScopes: ["scope:agencex"],
    signers: []
  });
  assert.equal(clean.biased, false);
  assert.equal(clean.posture.postureConflit, "none");
});
