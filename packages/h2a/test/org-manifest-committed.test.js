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
/**
 * WP → the single actor accountable for it, **derived from `docs/governance/RACI.md` table A and
 * never duplicated here**. A copy would have to be edited in lockstep with the document, and the
 * first time someone forgot, this file would pin yesterday's map while claiming to check today's.
 * Deriving makes the document the single source; this file only enforces the invariant over it.
 *
 * That distinction is what keeps a ratified change from becoming a test failure: when the owner
 * dissolves WP7, the document and the manifest change and this test follows — it does not have to
 * be edited, and it does not turn an arbitration into a red build for the lane that loses the WP.
 *
 * Table A row shape: `| WP7 | Infra, deploy & MCP | \`runtime\` — **provisional** | … | … |`.
 * The accountable actor is the FIRST backticked token of column 3; a trailing marker or note is
 * deliberately ignored. Rows whose first column is not `WP<n>` — the WP-less security row — carry
 * no WP and are skipped.
 */
function wpOwnersFromRaci() {
  const md = readFileSync(join(REPO_ROOT, "docs", "governance", "RACI.md"), "utf8");
  const owners = new Map();
  const duplicates = [];
  for (const line of md.split("\n")) {
    const row = /^\|\s*WP(\d+)\s*\|[^|]*\|([^|]*)\|/.exec(line);
    if (!row) continue;
    const actor = /`([^`]+)`/.exec(row[2]);
    if (!actor) continue;
    const wp = Number(row[1]);
    // A `Map.set` here would let a SECOND row for the same WP silently overwrite the first, so a
    // document naming two different owners for one WP would still agree with a manifest matching
    // whichever came last — and the suite would go green on a document that contradicts itself.
    // The second review leg found exactly that hole by duplicating a row, so the duplicate is now
    // collected and surfaced instead of swallowed.
    if (owners.has(wp)) duplicates.push(`WP${wp}: "${owners.get(wp)}" then "${actor[1]}"`);
    owners.set(wp, actor[1]);
  }
  return { owners, duplicates };
}

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

test("every WP is owned by exactly one actor — the invariant, not one particular map", () => {
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

  // THE invariant: a WP is answerable to exactly one actor. Two owners make "who arbitrates"
  // unanswerable; zero makes the work nobody's. This is what must never drift — the identity of
  // the owner is the document's business, and it may change by ratified decision at any time.
  for (const [wp, holders] of owners) {
    assert.equal(
      holders.length,
      1,
      `WP${wp} is claimed by ${holders.length} actors (${holders.join(", ")}) — exactly one must be accountable`
    );
  }

  // And the manifest must agree with the document, in both directions, so neither can drift alone.
  const { owners: fromRaci, duplicates } = wpOwnersFromRaci();
  // The document must not contradict ITSELF either. Agreeing with the manifest is not enough: a
  // table naming two owners for one WP is already unanswerable, whichever one the manifest matches.
  assert.deepEqual(
    duplicates,
    [],
    `docs/governance/RACI.md table A names a WP more than once — ${duplicates.join("; ")}`
  );
  assert.ok(fromRaci.size > 0, "no WP row could be parsed out of docs/governance/RACI.md table A");
  for (const [wp, owner] of fromRaci) {
    assert.deepEqual(
      owners.get(wp),
      [owner],
      `RACI.md table A gives WP${wp} to "${owner}"; org.h2a.yaml disagrees`
    );
  }
  assert.deepEqual(
    [...owners.keys()].sort((a, b) => a - b),
    [...fromRaci.keys()].sort((a, b) => a - b),
    "org.h2a.yaml and RACI.md table A do not cover the same set of WPs"
  );
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
