/**
 * WP4 — the COMMITTED org manifest (`org.h2a.yaml` at the repo root) is the machine
 * form of `docs/governance/RACI.md`. These tests are what raises the actor roster from
 * a prose convention to something the required gate refuses to let drift:
 * `h2a org validate` only checks a manifest a human remembered to run it on, so the
 * same checks run here, on the committed file, every time.
 *
 * They pin the roster and the WP ownership map. They deliberately do NOT pin the
 * A/R/C/I assignments of the RACI tables — nothing in the code enforces those, and a
 * test that pretended otherwise would be a claim wider than its proof.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { H2A_ORG_MANIFEST_FILENAME, parseOrgManifest, validateOrgManifest } from "../dist/index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROOT_SCOPE = "org:h2a";

/** The twelve durable actors of DOC-06 (docs/agents/RECALL.md), plus the human owner. */
const TRANSVERSE = ["cond", "arch", "harness", "cyber"];
const DOMAIN = [
  "coop",
  "runtime",
  "track",
  "plugins",
  "memory",
  "portal",
  "agents",
  "gateway"
];
/** WP → the single actor accountable for it, per docs/governance/RACI.md table A. */
const WP_OWNER = {
  1: "coop",
  2: "coop",
  3: "coop",
  4: "cond",
  5: "runtime",
  6: "arch",
  7: "runtime",
  8: "track",
  9: "harness",
  10: "plugins",
  11: "memory",
  12: "portal",
  13: "agents",
  14: "gateway"
};

function committedManifest() {
  const source = readFileSync(join(REPO_ROOT, H2A_ORG_MANIFEST_FILENAME), "utf8");
  const parsed = parseOrgManifest(source);
  assert.deepEqual(parsed.errors, [], `${H2A_ORG_MANIFEST_FILENAME} does not parse`);
  assert.ok(parsed.manifest, `${H2A_ORG_MANIFEST_FILENAME} produced no manifest`);
  return parsed.manifest;
}

test("the committed org manifest parses and satisfies the h2a invariants", () => {
  const manifest = committedManifest();
  assert.equal(manifest.scope, ROOT_SCOPE);
  const validation = validateOrgManifest(manifest);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);
});

test("exactly one PRINCIPAL and exactly one CONDUCTOR are declared", () => {
  const manifest = committedManifest();
  const byRole = (role) => manifest.instances.filter((i) => i.role === role).map((i) => i.instance);
  // A cannot be shared: two conductors would make "who arbitrates" unanswerable, and
  // two principals would make "who accepts" unanswerable.
  assert.deepEqual(byRole("CONDUCTOR"), ["cond"]);
  assert.equal(byRole("PRINCIPAL").length, 1);
});

test("the twelve durable actors are all declared, and nothing else is an actor", () => {
  const manifest = committedManifest();
  const declared = manifest.instances.map((i) => i.instance);
  for (const actor of [...TRANSVERSE, ...DOMAIN]) {
    assert.ok(declared.includes(actor), `actor "${actor}" is missing from the manifest`);
  }
  const principals = manifest.instances.filter((i) => i.role === "PRINCIPAL").map((i) => i.instance);
  const extra = declared.filter(
    (i) => ![...TRANSVERSE, ...DOMAIN, ...principals].includes(i)
  );
  assert.deepEqual(extra, [], "an undeclared actor appeared — amend the RACI, not just the manifest");
});

test("every WP is owned by exactly one actor, and every actor's WP is declared", () => {
  const manifest = committedManifest();
  const owners = new Map(); // wp number → [instances holding org:h2a/wpN]
  for (const inst of manifest.instances) {
    for (const scope of inst.scopes) {
      const m = /^org:h2a\/wp(\d+)$/.exec(scope);
      if (!m) continue;
      const wp = Number(m[1]);
      owners.set(wp, [...(owners.get(wp) ?? []), inst.instance]);
    }
  }
  for (const [wp, owner] of Object.entries(WP_OWNER)) {
    assert.deepEqual(
      owners.get(Number(wp)),
      [owner],
      `WP${wp} must be owned by exactly one actor (${owner})`
    );
  }
  assert.equal(owners.size, Object.keys(WP_OWNER).length, "a WP scope exists with no entry in the RACI");
});

test("every declared instance sits in the root scope", () => {
  const manifest = committedManifest();
  // Messaging is gated by shared scope membership. An actor outside the root scope is
  // an actor nobody can reach — including the conductor that must dispatch to it.
  for (const inst of manifest.instances) {
    assert.ok(
      inst.scopes.includes(ROOT_SCOPE),
      `"${inst.instance}" is not in ${ROOT_SCOPE} and would be unreachable`
    );
  }
});

test("the conductor has a declared edge to every other declared instance", () => {
  const manifest = committedManifest();
  const fromCond = new Set(
    (manifest.commEdges ?? []).filter((e) => e.from === "cond").map((e) => e.to)
  );
  for (const inst of manifest.instances) {
    if (inst.instance === "cond") continue;
    assert.ok(
      fromCond.has(inst.instance),
      `no dispatch edge cond → "${inst.instance}": an actor the conductor cannot address`
    );
  }
});
