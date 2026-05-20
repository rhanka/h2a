import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_ARTIFACT_KINDS,
  H2A_AUTHORITY_MATRIX,
  H2A_ROLES,
  assertCanSignArtifactKind,
  canSignArtifactKind
} from "../dist/index.js";

// Expected V1 baseline (mirror of DEC-035).
const EXPECTED = {
  CONTRACT: new Set(["PRINCIPAL", "EXECUTIF", "CONDUCTOR"]),
  POLICY: new Set(["PRINCIPAL", "EXECUTIF", "CONTROL"]),
  ENGAGEMENT: new Set(["PRINCIPAL", "EXECUTIF", "CONDUCTOR"]),
  AMENDMENT: new Set(["PRINCIPAL", "EXECUTIF", "CONDUCTOR", "CONTROL"]),
  MANDATE: new Set(["PRINCIPAL", "EXECUTIF"]),
  AUTHORITY: new Set(["PRINCIPAL", "EXECUTIF"]),
  SIGNATURE: new Set(["PRINCIPAL", "EXECUTIF", "CONDUCTOR", "AGENTS", "CONTROL", "MANDATAIRE"]),
  ENFORCEMENT_PLAN: new Set(["PRINCIPAL", "EXECUTIF", "CONTROL"])
};

test("H2A_AUTHORITY_MATRIX covers every canonical artifact kind", () => {
  for (const kind of H2A_ARTIFACT_KINDS) {
    assert.ok(
      H2A_AUTHORITY_MATRIX[kind],
      `matrix missing entry for ${kind}`
    );
    assert.ok(
      Array.isArray(H2A_AUTHORITY_MATRIX[kind].roles),
      `matrix entry ${kind}.roles must be array`
    );
  }
});

test("matrix matches the DEC-035 baseline for every role/kind pair", () => {
  for (const kind of H2A_ARTIFACT_KINDS) {
    for (const role of H2A_ROLES) {
      const expected = EXPECTED[kind].has(role);
      const got = canSignArtifactKind(role, kind);
      assert.equal(
        got,
        expected,
        `canSignArtifactKind(${role}, ${kind}) → ${got}, expected ${expected}`
      );
    }
  }
});

test("MANDATAIRE is refused on every binding artifact kind (only SIGNATURE allowed)", () => {
  for (const kind of H2A_ARTIFACT_KINDS) {
    if (kind === "SIGNATURE") {
      assert.equal(canSignArtifactKind("MANDATAIRE", "SIGNATURE"), true);
      continue;
    }
    assert.equal(
      canSignArtifactKind("MANDATAIRE", kind),
      false,
      `MANDATAIRE must never sign ${kind}`
    );
  }
});

test("AGENTS is only allowed on SIGNATURE", () => {
  for (const kind of H2A_ARTIFACT_KINDS) {
    const expected = kind === "SIGNATURE";
    assert.equal(
      canSignArtifactKind("AGENTS", kind),
      expected,
      `AGENTS on ${kind}: expected ${expected}`
    );
  }
});

test("assertCanSignArtifactKind passes silently for allowed pairs", () => {
  assert.doesNotThrow(() => assertCanSignArtifactKind("CONDUCTOR", "ENGAGEMENT"));
  assert.doesNotThrow(() => assertCanSignArtifactKind("PRINCIPAL", "MANDATE"));
  assert.doesNotThrow(() => assertCanSignArtifactKind("CONTROL", "ENFORCEMENT_PLAN"));
  assert.doesNotThrow(() => assertCanSignArtifactKind("AGENTS", "SIGNATURE"));
});

test("assertCanSignArtifactKind throws and names role + kind on refusal", () => {
  assert.throws(
    () => assertCanSignArtifactKind("AGENTS", "ENGAGEMENT"),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /AGENTS/);
      assert.match(err.message, /ENGAGEMENT/);
      return true;
    }
  );

  assert.throws(
    () => assertCanSignArtifactKind("MANDATAIRE", "CONTRACT"),
    (err) => {
      assert.match(err.message, /MANDATAIRE/);
      assert.match(err.message, /CONTRACT/);
      return true;
    }
  );

  assert.throws(
    () => assertCanSignArtifactKind("CONDUCTOR", "MANDATE"),
    (err) => {
      assert.match(err.message, /CONDUCTOR/);
      assert.match(err.message, /MANDATE/);
      return true;
    }
  );
});
