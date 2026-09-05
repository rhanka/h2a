// Drift-guard for the VENDORED graphify memory contract (path V — see
// docs/specs/2026-09-05-SPEC_v1v2-adapter...). h2a vendors graphify's
// `graphify-memory/contracts/index.ts` (types-only, 0 runtime, 0 imports) as
// `src/runtime/memory/graphify-contracts-v2.vendored.ts`, BYTE-IDENTICAL, so
// importing the contract pulls ZERO graphify runtime (anti-cycle preserved).
//
// This guard has two layers:
//  (A) LOCAL, runs in h2a CI now: the vendored copy must match the pinned
//      digest — catches any silent local edit of the vendored copy, so the
//      copy cannot drift from what was vendored without a red test + a
//      deliberate re-pin.
//  (B) UPSTREAM, CI-config follow-up (reachability TBD): a CI step re-derives
//      the sha256 of graphify main's `graphify-memory/contracts/index.ts` and
//      compares it to PINNED_GRAPHIFY_CONTRACT_DIGEST below; on mismatch the
//      graphify contract evolved → re-vendor + re-pin. This needs the graphify
//      contract reachable at h2a CI time (sibling checkout or a fetched
//      fixture) — owned by whoever wires h2a CI's access to the graphify repo.
//      When V→A lands (the contract is published as @graphify/memory-contracts),
//      this whole guard is replaced by a normal npm dependency + the vendored
//      copy is deleted.
//
// PINNED against graphify main 20df1405 (measured 2026-09-05).

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const PINNED_GRAPHIFY_CONTRACT_DIGEST =
  "bd1fc12021aa943157372bf5a77f6c537d5ff516be5af455ccf5ec13bbb31d57";

const here = dirname(fileURLToPath(import.meta.url));
const vendoredPath = join(here, "../src/runtime/memory/graphify-contracts-v2.vendored.ts");

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("drift-guard (A): the vendored graphify V2 contract copy matches its pinned digest", () => {
  const bytes = readFileSync(vendoredPath);
  const digest = sha256Hex(bytes);
  assert.equal(
    digest,
    PINNED_GRAPHIFY_CONTRACT_DIGEST,
    "the vendored graphify-contracts-v2.vendored.ts no longer matches the pinned digest — " +
      "either it was edited locally (revert — the vendored copy must stay byte-identical to graphify), " +
      "or graphify's contract was intentionally re-vendored (update PINNED_GRAPHIFY_CONTRACT_DIGEST)."
  );
});

test("drift-guard: the vendored copy is types-only (no runtime import, anti-cycle)", () => {
  const text = readFileSync(vendoredPath, "utf8");
  assert.equal(/^import\s/m.test(text), false, "the vendored contract must have zero imports (pure types)");
  // NIT-02: broaden past `export const` to every runtime-value export form
  // (const/let/var/function/class, plus `export default` and `export async
  // function`), tolerating extra whitespace — a pure-types contract must have
  // none, so any match means graphify runtime leaked in. (The digest pin above
  // is the authoritative guard; this is the human-readable defense-in-depth.)
  assert.equal(
    /^export\s+(?:default|async|const|let|var|function|class)\b/m.test(text),
    false,
    "the vendored contract must have zero runtime exports (pure types)"
  );
});
