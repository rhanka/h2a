import assert from "node:assert/strict";
import test from "node:test";

import {
  auditContractualArtifact,
  deriveValueChain
} from "../dist/index.js";

/** A minimal structurally-valid ENGAGEMENT carrying the optional VALEUR fields. */
function engagement(id, extra = {}) {
  return {
    kind: "ENGAGEMENT",
    id,
    scope: `scope:engagement/${id}`,
    charter: { goal: `deliver ${id}` },
    roleBindings: [{ role: "CONDUCTOR", instance: "conductor:01" }],
    controls: [],
    policies: [],
    successCriteria: [`accepted: ${id}`],
    ...extra
  };
}

// --- VALEUR fields pass the contractual collapse-guard ----------------------

test("an ENGAGEMENT carrying aval + finaliteAmont still passes auditContractualArtifact", () => {
  const eng = engagement("e1", { aval: "e2", finaliteAmont: "deliver-the-product" });
  const result = auditContractualArtifact(eng);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.kind, "ENGAGEMENT");
  assert.deepEqual(result.issues, []);
});

test("an ENGAGEMENT without VALEUR fields is unaffected by the guard", () => {
  const result = auditContractualArtifact(engagement("plain"));
  assert.equal(result.ok, true);
  assert.equal(result.kind, "ENGAGEMENT");
});

// --- deriveValueChain -------------------------------------------------------

test("single-node chain: an engagement with no aval terminates cleanly", () => {
  const chain = deriveValueChain([engagement("e1", { finaliteAmont: "ship" })], "e1");
  assert.equal(chain.length, 1);
  assert.equal(chain[0].id, "e1");
  assert.equal(chain[0].finaliteAmont, "ship");
  assert.equal(chain[0].aval, undefined);
  assert.equal(chain[0].boundaryOpaque, undefined);
});

test("multi-link chain: traversal follows aval as a linked list", () => {
  const engagements = [
    engagement("e1", { aval: "e2", finaliteAmont: "f1" }),
    engagement("e2", { aval: "e3", finaliteAmont: "f2" }),
    engagement("e3", { finaliteAmont: "f3" })
  ];
  const chain = deriveValueChain(engagements, "e1");
  assert.deepEqual(chain.map((n) => n.id), ["e1", "e2", "e3"]);
  assert.equal(chain[2].aval, undefined);
  assert.equal(chain.some((n) => n.boundaryOpaque), false);
});

test("missing aval target terminates the chain without throwing", () => {
  // e1 → e2, but e2 is not present in the supplied set (unknown link).
  const chain = deriveValueChain([engagement("e1", { aval: "e2" })], "e1");
  assert.equal(chain.length, 1);
  assert.equal(chain[0].id, "e1");
  assert.equal(chain[0].aval, "e2");
  // An unresolved local link is not an opaque boundary by itself.
  assert.equal(chain[0].boundaryOpaque, undefined);
});

test("cycle guard: a self/loop reference terminates and never throws", () => {
  const engagements = [
    engagement("e1", { aval: "e2" }),
    engagement("e2", { aval: "e1" })
  ];
  const chain = deriveValueChain(engagements, "e1");
  assert.deepEqual(chain.map((n) => n.id), ["e1", "e2"]);
  // No infinite loop, no duplicate visit.
  assert.equal(new Set(chain.map((n) => n.id)).size, chain.length);
});

test("self-loop terminates cleanly", () => {
  const chain = deriveValueChain([engagement("e1", { aval: "e1" })], "e1");
  assert.deepEqual(chain.map((n) => n.id), ["e1"]);
});

test("unknown fromId yields an empty chain", () => {
  const chain = deriveValueChain([engagement("e1")], "nope");
  assert.deepEqual(chain, []);
});

test("opaque-boundary terminal: a non-full disclosure mode marks the last resolved node", () => {
  // e1 → e2 (present), e2 → e3 (absent). Cross-org default disclosure is opaque,
  // so the missing onward link is flagged rather than silently dropped (F8).
  const engagements = [
    engagement("e1", { aval: "e2" }),
    engagement("e2", { aval: "e3" })
  ];
  const chain = deriveValueChain(engagements, "e1", { disclosureMode: "hash-only" });
  assert.deepEqual(chain.map((n) => n.id), ["e1", "e2"]);
  assert.equal(chain[0].boundaryOpaque, undefined);
  assert.equal(chain[1].boundaryOpaque, true);
});

test("full-view disclosure does not mark an unresolved onward link as opaque", () => {
  const engagements = [engagement("e1", { aval: "e2" })];
  const chain = deriveValueChain(engagements, "e1", { disclosureMode: "full-view" });
  assert.equal(chain.length, 1);
  assert.equal(chain[0].boundaryOpaque, undefined);
});

test("a fully-resolved chain is never marked opaque, regardless of disclosure mode", () => {
  const engagements = [engagement("e1", { aval: "e2" }), engagement("e2")];
  const chain = deriveValueChain(engagements, "e1", { disclosureMode: "denied" });
  assert.deepEqual(chain.map((n) => n.id), ["e1", "e2"]);
  assert.equal(chain.some((n) => n.boundaryOpaque), false);
});

test("deriveValueChain is total: tolerates a non-array / empty input", () => {
  assert.deepEqual(deriveValueChain([], "e1"), []);
  assert.deepEqual(deriveValueChain(undefined, "e1"), []);
});
