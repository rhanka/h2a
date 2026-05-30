import assert from "node:assert/strict";
import test from "node:test";

import { deriveMutualisationOpportunities } from "../dist/index.js";

/** Reuse the H2AOrgRegisteredInstance shape ({ instance, roles, scopes }). */
function inst(instance, scopes, roles = ["AGENTS"]) {
  return { instance, roles, scopes };
}

test("no overlap → empty", () => {
  const opps = deriveMutualisationOpportunities([
    inst("a", ["scope:x"]),
    inst("b", ["scope:y"]),
    inst("c", ["scope:z"])
  ]);
  assert.deepEqual(opps, []);
});

test("empty / single-instance input → empty", () => {
  assert.deepEqual(deriveMutualisationOpportunities([]), []);
  assert.deepEqual(deriveMutualisationOpportunities([inst("solo", ["scope:x"])]), []);
});

test("partial overlap → one opportunity naming the instances + the shared scope", () => {
  const opps = deriveMutualisationOpportunities([
    inst("a", ["scope:shared", "scope:a-only"]),
    inst("b", ["scope:shared", "scope:b-only"])
  ]);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].scope, "scope:shared");
  assert.deepEqual(opps[0].instances, ["a", "b"]);
});

test("a scope held by a single instance is ignored", () => {
  const opps = deriveMutualisationOpportunities([
    inst("a", ["scope:shared", "scope:a-only"]),
    inst("b", ["scope:shared"]),
    inst("c", ["scope:c-only"])
  ]);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].scope, "scope:shared");
  assert.deepEqual(opps[0].instances, ["a", "b"]);
});

test("three instances on one scope → one opportunity naming all three", () => {
  const opps = deriveMutualisationOpportunities([
    inst("c", ["scope:shared"]),
    inst("a", ["scope:shared"]),
    inst("b", ["scope:shared"])
  ]);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].scope, "scope:shared");
  // Instances sorted deterministically.
  assert.deepEqual(opps[0].instances, ["a", "b", "c"]);
});

test("multiple shared scopes → one opportunity per scope, deterministically ordered", () => {
  const opps = deriveMutualisationOpportunities([
    inst("b", ["scope:beta", "scope:alpha"]),
    inst("a", ["scope:alpha", "scope:beta"]),
    inst("c", ["scope:alpha"])
  ]);
  // Two shared scopes: alpha {a,b,c}, beta {a,b}. Ordered by scope name.
  assert.deepEqual(opps.map((o) => o.scope), ["scope:alpha", "scope:beta"]);
  assert.deepEqual(opps[0].instances, ["a", "b", "c"]);
  assert.deepEqual(opps[1].instances, ["a", "b"]);
});

test("deterministic ordering is independent of input order", () => {
  const a = deriveMutualisationOpportunities([
    inst("z", ["scope:two", "scope:one"]),
    inst("a", ["scope:one", "scope:two"])
  ]);
  const b = deriveMutualisationOpportunities([
    inst("a", ["scope:two", "scope:one"]),
    inst("z", ["scope:one", "scope:two"])
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((o) => o.scope), ["scope:one", "scope:two"]);
});

test("an instance listing the same scope twice does not self-overlap", () => {
  const opps = deriveMutualisationOpportunities([
    inst("a", ["scope:x", "scope:x"])
  ]);
  assert.deepEqual(opps, []);
});

test("total: tolerates undefined / malformed rows without throwing", () => {
  assert.deepEqual(deriveMutualisationOpportunities(undefined), []);
  const opps = deriveMutualisationOpportunities([
    inst("a", ["scope:shared"]),
    { instance: "b", roles: ["AGENTS"], scopes: ["scope:shared"] },
    { instance: "c" } // no scopes
  ]);
  assert.equal(opps.length, 1);
  assert.deepEqual(opps[0].instances, ["a", "b"]);
});
