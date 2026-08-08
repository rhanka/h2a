import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, effectiveOrgInstances } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-store-normalize-"));
}

// FIX-rroles: legacy registry rows exist on disk with `roles`/`scopes` ABSENT
// (undefined). `listInstances()` must normalize them to arrays at the read
// boundary so `for (const role of r.roles)` (org.ts effectiveOrgInstances) and
// every `.includes`/`.filter`/`[0]` consumer never sees a non-iterable.
// Read-tolerant only: the line on disk must stay exactly as written.

test("listInstances normalizes a legacy row with roles AND scopes absent to []", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    // A pre-fix legacy registration line: roles and scopes ABSENT entirely.
    const legacyLine =
      '{"id":"legacy:01","instance":"legacy:01","capabilities":[],"endpoints":[],"publicKeys":[],"acceptedPolicies":[],"createdAt":"2026-01-01T00:00:00.000Z"}';
    appendFileSync(store.paths.instances, `${legacyLine}\n`, "utf8");

    // The original crash site FIRST: org.ts effectiveOrgInstances iterates
    // `r.roles`/`r.scopes` with for..of — against origin/main this line
    // throws exactly `TypeError: r.roles is not iterable` (org.ts:325).
    const eff = effectiveOrgInstances(store.listInstances(), []);

    const rows = store.listInstances();
    const legacy = rows.find((r) => r.id === "legacy:01");
    assert.ok(legacy, "legacy row must still be listed");
    assert.deepEqual(legacy.roles, []);
    assert.deepEqual(legacy.scopes, []);
    const effLegacy = eff.find((e) => e.instance === "legacy:01");
    assert.ok(effLegacy, "effectiveOrgInstances must include the legacy row");
    assert.deepEqual(effLegacy.roles, []);
    assert.deepEqual(effLegacy.scopes, []);

    // Read-tolerant only: the legacy line on disk is untouched (no rewrite).
    const onDisk = readFileSync(store.paths.instances, "utf8");
    assert.ok(onDisk.includes(legacyLine), "legacy line must stay verbatim on disk");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listInstances normalizes scalar roles/scopes to single-element arrays", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    // Future-proof: a row where roles/scopes were written as bare scalars.
    const scalarLine =
      '{"id":"scalar:01","instance":"scalar:01","roles":"BUILDER","scopes":"scope:test","capabilities":[],"endpoints":[],"publicKeys":[],"acceptedPolicies":[],"createdAt":"2026-01-01T00:00:00.000Z"}';
    appendFileSync(store.paths.instances, `${scalarLine}\n`, "utf8");

    const rows = store.listInstances();
    const scalar = rows.find((r) => r.id === "scalar:01");
    assert.ok(scalar, "scalar row must still be listed");
    assert.deepEqual(scalar.roles, ["BUILDER"]);
    assert.deepEqual(scalar.scopes, ["scope:test"]);

    const eff = effectiveOrgInstances(store.listInstances(), []);
    const effScalar = eff.find((e) => e.instance === "scalar:01");
    assert.ok(effScalar, "effectiveOrgInstances must include the scalar row");
    assert.deepEqual(effScalar.roles, ["BUILDER"]);
    assert.deepEqual(effScalar.scopes, ["scope:test"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listInstances leaves well-formed array roles/scopes as-is alongside a legacy row", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance({
      id: "modern:01",
      instance: "modern:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:principal/antoine"],
      capabilities: ["negotiate"],
      endpoints: [{ kind: "local-files", uri: `file://${root}` }],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    appendFileSync(
      store.paths.instances,
      '{"id":"legacy:02","instance":"legacy:02","capabilities":[],"endpoints":[],"publicKeys":[],"acceptedPolicies":[],"createdAt":"2026-01-01T00:00:00.000Z"}\n',
      "utf8"
    );

    const rows = store.listInstances();
    const modern = rows.find((r) => r.id === "modern:01");
    assert.deepEqual(modern.roles, ["CONDUCTOR"]);
    assert.deepEqual(modern.scopes, ["scope:principal/antoine"]);

    // One absent-fields row must not break discovery over the whole registry.
    const eff = effectiveOrgInstances(store.listInstances(), []);
    assert.ok(eff.find((e) => e.instance === "modern:01"));
    assert.ok(eff.find((e) => e.instance === "legacy:02"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
