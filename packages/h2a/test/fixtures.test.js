import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  H2A_CANONICAL_FIXTURES,
  canonicalize,
  computeHash,
  isAuthority,
  isContract,
  isEnforcementPlan,
  isEngagement,
  isMandate,
  isPolicy
} from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");

const GUARDS = {
  CONTRACT: isContract,
  POLICY: isPolicy,
  ENGAGEMENT: isEngagement,
  MANDATE: isMandate,
  AUTHORITY: isAuthority,
  ENFORCEMENT_PLAN: isEnforcementPlan
};

test("H2A_CANONICAL_FIXTURES manifest is non-empty and matches the on-disk file", () => {
  assert.ok(Array.isArray(H2A_CANONICAL_FIXTURES));
  assert.ok(H2A_CANONICAL_FIXTURES.length >= 6, "expected at least 6 canonical fixtures");

  const manifestText = readFileSync(join(PKG_ROOT, "fixtures", "manifest.json"), "utf8");
  const onDisk = JSON.parse(manifestText);
  assert.deepEqual(
    onDisk,
    H2A_CANONICAL_FIXTURES.map((e) => ({ ...e })),
    "exported H2A_CANONICAL_FIXTURES must match fixtures/manifest.json byte-for-byte content"
  );
});

test("manifest covers each of the 6 expected canonical kinds exactly once", () => {
  const expected = new Set([
    "CONTRACT",
    "POLICY",
    "ENGAGEMENT",
    "MANDATE",
    "AUTHORITY",
    "ENFORCEMENT_PLAN"
  ]);
  const seen = new Set();
  for (const entry of H2A_CANONICAL_FIXTURES) {
    assert.ok(expected.has(entry.kind), `unexpected fixture kind ${entry.kind}`);
    assert.ok(!seen.has(entry.kind), `fixture kind ${entry.kind} appears twice`);
    seen.add(entry.kind);
  }
  for (const kind of expected) {
    assert.ok(seen.has(kind), `missing canonical fixture for kind ${kind}`);
  }
});

for (const entry of H2A_CANONICAL_FIXTURES) {
  test(`fixture ${entry.path} is byte-canonical and matches its declared sha256`, () => {
    const fullPath = join(PKG_ROOT, entry.path);
    const bytes = readFileSync(fullPath, "utf8");

    // The on-disk content must equal canonicalize(parsed) exactly.
    const parsed = JSON.parse(bytes);
    const canonical = canonicalize(parsed);
    assert.equal(
      bytes,
      canonical,
      `fixture ${entry.path} content must equal canonicalize(parsed) byte-for-byte`
    );

    // computeHash(parsed) must equal "sha256:" + entry.sha256.
    const hash = computeHash(parsed);
    assert.equal(
      hash,
      `sha256:${entry.sha256}`,
      `fixture ${entry.path} computeHash mismatch`
    );

    // The matching kind guard accepts the parsed value.
    const guard = GUARDS[entry.kind];
    assert.ok(guard, `no guard registered for kind ${entry.kind}`);
    assert.equal(
      guard(parsed),
      true,
      `fixture ${entry.path}: is${entry.kind}(parsed) should return true`
    );

    // The parsed artifact's own id must match the manifest entry.
    assert.equal(parsed.id, entry.id, `fixture ${entry.path}: parsed.id mismatch`);
    assert.equal(parsed.kind, entry.kind, `fixture ${entry.path}: parsed.kind mismatch`);
  });
}
