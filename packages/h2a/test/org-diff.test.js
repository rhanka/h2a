import assert from "node:assert/strict";
import test from "node:test";

import { diffOrgManifest } from "../dist/index.js";

const manifest = {
  scope: "org:acme",
  instances: [
    { instance: "claude:lead", role: "PRINCIPAL", scopes: ["org:acme"] },
    { instance: "codex:dev-1", role: "AGENTS", scopes: ["org:acme", "org:acme/build"] }
  ]
};

test("inSync when the live registry matches the manifest exactly", () => {
  const diff = diffOrgManifest(manifest, [
    { instance: "claude:lead", roles: ["PRINCIPAL"], scopes: ["org:acme"] },
    { instance: "codex:dev-1", roles: ["AGENTS"], scopes: ["org:acme", "org:acme/build"] }
  ]);
  assert.equal(diff.inSync, true);
  assert.deepEqual(diff.matched.sort(), ["claude:lead", "codex:dev-1"]);
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.undeclared, []);
});

test("missing = declared but not registered", () => {
  const diff = diffOrgManifest(manifest, [
    { instance: "claude:lead", roles: ["PRINCIPAL"], scopes: ["org:acme"] }
  ]);
  assert.equal(diff.inSync, false);
  assert.equal(diff.missing.length, 1);
  assert.equal(diff.missing[0].instance, "codex:dev-1");
  assert.deepEqual(diff.missing[0].declaredScopes, ["org:acme", "org:acme/build"]);
});

test("undeclared = registered but not in the manifest", () => {
  const diff = diffOrgManifest(manifest, [
    { instance: "claude:lead", roles: ["PRINCIPAL"], scopes: ["org:acme"] },
    { instance: "codex:dev-1", roles: ["AGENTS"], scopes: ["org:acme", "org:acme/build"] },
    { instance: "rogue:x", roles: ["AGENTS"], scopes: ["org:acme"] }
  ]);
  assert.equal(diff.inSync, false);
  assert.equal(diff.undeclared.length, 1);
  assert.equal(diff.undeclared[0].instance, "rogue:x");
});

test("roleMismatch when the declared role is not among registered roles", () => {
  const diff = diffOrgManifest(manifest, [
    { instance: "claude:lead", roles: ["AGENTS"], scopes: ["org:acme"] },
    { instance: "codex:dev-1", roles: ["AGENTS"], scopes: ["org:acme", "org:acme/build"] }
  ]);
  assert.equal(diff.inSync, false);
  assert.equal(diff.roleMismatch.length, 1);
  assert.equal(diff.roleMismatch[0].instance, "claude:lead");
  assert.equal(diff.roleMismatch[0].declaredRole, "PRINCIPAL");
  assert.deepEqual(diff.roleMismatch[0].registeredRoles, ["AGENTS"]);
  assert.ok(!diff.matched.includes("claude:lead"));
});

test("scopeGaps lists declared scopes the instance is not a member of", () => {
  const diff = diffOrgManifest(manifest, [
    { instance: "claude:lead", roles: ["PRINCIPAL"], scopes: ["org:acme"] },
    { instance: "codex:dev-1", roles: ["AGENTS"], scopes: ["org:acme"] } // missing org:acme/build
  ]);
  assert.equal(diff.inSync, false);
  assert.equal(diff.scopeGaps.length, 1);
  assert.equal(diff.scopeGaps[0].instance, "codex:dev-1");
  assert.deepEqual(diff.scopeGaps[0].missingScopes, ["org:acme/build"]);
});

test("empty registry → every declared instance is missing", () => {
  const diff = diffOrgManifest(manifest, []);
  assert.equal(diff.inSync, false);
  assert.equal(diff.missing.length, 2);
  assert.deepEqual(diff.matched, []);
});
