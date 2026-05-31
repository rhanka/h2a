import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_DECLARATION_INTERET_BODY_KIND,
  derivePostureConflit,
  isH2ADeclarationInteret
} from "../dist/index.js";

const at = "2026-05-31T00:00:00.000Z";

function declaration(overrides = {}) {
  return {
    kind: H2A_DECLARATION_INTERET_BODY_KIND,
    subject: "signer:1",
    interets: ["vendor shareholding"],
    at,
    ...overrides
  };
}

test("isH2ADeclarationInteret accepts the declaration-interet body shape", () => {
  assert.equal(isH2ADeclarationInteret(declaration()), true);
  assert.equal(
    isH2ADeclarationInteret({ ...declaration(), kind: "declaration-interet-v2" }),
    false
  );
  assert.equal(isH2ADeclarationInteret({ ...declaration(), interets: [] }), true);
  assert.equal(isH2ADeclarationInteret({ ...declaration(), interets: ["ok", 7] }), false);
});

test("derivePostureConflit returns none without a declaration", () => {
  const posture = derivePostureConflit("signer:1", {
    declarations: [],
    ownScopes: ["scope:self"],
    decisionScopes: ["scope:self"],
    signers: []
  });

  assert.equal(posture.postureConflit, "none");
  assert.deepEqual(posture.criteres, []);
  assert.equal(posture.disclosureMode, "attestation");
});

test("derivePostureConflit watches a declared stake when no declarable criterion fires", () => {
  const posture = derivePostureConflit("signer:1", {
    declarations: [declaration()],
    ownScopes: ["scope:self"],
    decisionScopes: ["scope:self"],
    signers: []
  });

  assert.equal(posture.postureConflit, "a-surveiller");
  assert.deepEqual(posture.criteres, []);
  assert.equal(posture.disclosureMode, "attestation");
});

test("derivePostureConflit marks a signer with a declaration as conflit-declarable", () => {
  const posture = derivePostureConflit("signer:1", {
    declarations: [declaration()],
    ownScopes: ["scope:self"],
    decisionScopes: ["scope:self"],
    signers: ["signer:1"]
  });

  assert.equal(posture.postureConflit, "conflit-declarable");
  assert.deepEqual(posture.criteres, ["signataire"]);
  assert.equal(posture.disclosureMode, "attestation");
});

test("derivePostureConflit escalates disclosure when the decision reaches outside own scope", () => {
  const posture = derivePostureConflit("signer:1", {
    declarations: [declaration({ bindings: ["scope:umbrella"] })],
    ownScopes: ["scope:self"],
    decisionScopes: ["scope:self"],
    signers: []
  });

  assert.equal(posture.postureConflit, "conflit-declarable");
  assert.deepEqual(posture.criteres, ["hors-scope-propre"]);
  assert.equal(posture.disclosureMode, "evidence-package");
});

test("derivePostureConflit honors CONTROL flags and declared collective-mask impact", () => {
  const posture = derivePostureConflit("signer:1", {
    declarations: [declaration({ masqueImpactCollectif: true })],
    ownScopes: ["scope:self"],
    decisionScopes: ["scope:self"],
    signers: [],
    controleFlags: ["signer:1"]
  });

  assert.equal(posture.postureConflit, "conflit-declarable");
  assert.deepEqual(posture.criteres, ["controle-flag"]);
  assert.equal(posture.masqueImpactCollectif, true);
  assert.equal(posture.disclosureMode, "evidence-package");
});
