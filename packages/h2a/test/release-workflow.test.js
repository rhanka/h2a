/**
 * SPEC 0.98.5 R8.2 — the release workflow must tie EVERY publication to an
 * observed verify success at the EXACT release SHA.
 *
 * The 0.98.2-0.98.4 incidents were published through two holes this file pins
 * shut:
 *   - `publish` accepted `needs.verify.result == 'skipped'`, and `verify` was
 *     skipped entirely on a backfill dispatch: a workflow_dispatch published
 *     with ZERO tests run;
 *   - `publish` re-checked out a mutable TAG NAME (TOCTOU: the tag can point
 *     somewhere else by then), so even a green verify proved nothing about the
 *     published bytes.
 *
 * This is a parse+assert test, not an end-to-end workflow run (the spec pins
 * that choice): it parses `.github/workflows/release.yml` with a real YAML
 * parser and asserts the structural contract. It runs via `npm test`
 * (packages/h2a/test discovery), so a red here blocks every gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const WORKFLOW_PATH = resolve(REPO_ROOT, ".github", "workflows", "release.yml");
const SOURCE = readFileSync(WORKFLOW_PATH, "utf8");
const WORKFLOW = YAML.parse(SOURCE);

function job(id) {
  const job_ = WORKFLOW.jobs[id];
  assert.ok(job_, `release.yml must contain a ${id} job`);
  return job_;
}

function firstStepIndex(job_, run) {
  const index = job_.steps.findIndex((step) => step.run === run);
  assert.ok(index !== -1, `release.yml ${job_.name ?? "job"} must contain a step running exactly: ${run}`);
  return index;
}

test("R8.4 gel total: verify has no event filter — every publication path is gated", () => {
  const verify = job("verify");
  assert.equal(verify.if, undefined, "verify must run for tag pushes AND backfill dispatches; an `if` here reopens the ungated backfill hole");
});

test("R8.1: verify keeps the Node 20+22 matrix", () => {
  const verify = job("verify");
  assert.deepEqual(verify.strategy?.matrix?.node, ["20", "22"], "the matrix is pinned by the spec; dropping a leg narrows what a green proves");
  assert.deepEqual(verify.strategy?.matrix?.os, ["ubuntu-latest"]);
});

/** `needs: verify` parses as the bare string "verify"; `needs: [verify]` as an array. */
function needsVerify(job_) {
  if (job_.needs === "verify") return true;
  if (Array.isArray(job_.needs)) return job_.needs.includes("verify");
  return Boolean(job_.needs?.verify);
}

test("R8.2 (1): publish proceeds only on an observed verify success, never a skip", () => {
  const publish = job("publish");
  assert.ok(needsVerify(publish), "publish must need verify");
  assert.ok(
    publish.if.includes("needs.verify.result == 'success'"),
    "publish.if must require needs.verify.result == 'success'",
  );
  assert.ok(
    !publish.if.includes("skipped"),
    "the 'skipped' acceptance is what let backfills publish with zero tests; it must stay gone",
  );
});

test("R8.2 TOCTOU: verify resolves the release SHA before checkout, and checks out the SHA", () => {
  const verify = job("verify");
  const resolveStep = verify.steps.find((step) => step.id === "resolve");
  assert.ok(resolveStep, "verify must resolve the exact release SHA in a named step before anything else");
  const resolveIndex = verify.steps.indexOf(resolveStep);
  const checkout = verify.steps.find((step) => step.uses === "actions/checkout@v4");
  assert.ok(checkout, "verify must check out the repository");
  assert.ok(
    resolveIndex < verify.steps.indexOf(checkout),
    "the SHA must be resolved BEFORE the checkout — resolving after would gate a different commit than it checks out",
  );
  assert.equal(
    checkout.with?.ref,
    "${{ steps.resolve.outputs.sha }}",
    "verify must check out the resolved SHA, never a mutable tag name",
  );
  assert.equal(
    verify.outputs?.["release-sha"],
    "${{ steps.resolve.outputs.sha }}",
    "verify must export the gated SHA for publish to consume",
  );
});

test("R8.2 (2): publish checks out the verify-gated SHA, never a mutable tag name", () => {
  const publish = job("publish");
  const checkouts = publish.steps.filter((step) => String(step.uses ?? "").startsWith("actions/checkout"));
  assert.ok(checkouts.length > 0, "publish must check out the gated tree (version gate, GitHub release)");
  for (const checkout of checkouts) {
    assert.equal(
      checkout.with?.ref,
      "${{ needs.verify.outputs.release-sha }}",
      "every publish checkout must consume the SHA verify gated — a tag name can be re-pointed between jobs (TOCTOU)",
    );
  }
  const publishSource = SOURCE.slice(SOURCE.indexOf("  publish:"));
  assert.ok(
    !publishSource.includes("format('v{0}', inputs.backfill-version)"),
    "no publish checkout may be derived from the mutable backfill tag name",
  );
});

test("R8.1/R8.3 (3): verify runs the trust root BEFORE npm test, then the packaged-artifact smoke", () => {
  const verify = job("verify");
  const trustRoot = firstStepIndex(verify, "node --test packages/h2a/test/run-test-gates.test.js");
  const npmTest = firstStepIndex(verify, "npm test");
  const smoke = firstStepIndex(verify, "npm run smoke:artifact");
  assert.ok(
    trustRoot < npmTest,
    "the trust root must gate the runner BEFORE the runner is trusted to report npm test",
  );
  assert.ok(
    npmTest < smoke,
    "the packaged-artifact smoke runs after the suite gate, still inside verify — smoke red means verify red means publish blocked",
  );
});

test("R8.2: verify packs the three lockstep packages, records sha256, uploads them as artifacts", () => {
  const verify = job("verify");
  const pack = verify.steps.find((step) => String(step.run ?? "").includes("npm pack --workspace"));
  assert.ok(pack, "verify must npm pack the candidate packages");
  for (const pkg of ["@sentropic/h2a", "@sentropic/h2a-runtime", "@sentropic/h2a-cli"]) {
    assert.ok(
      String(pack.run).includes(pkg),
      `verify must pack ${pkg} — the tarball publish later MUST be these exact bytes`,
    );
  }
  assert.ok(
    String(pack.run).includes("sha256sum"),
    "verify must record the sha256 of every tarball",
  );
  const upload = verify.steps.find((step) => String(step.uses ?? "").startsWith("actions/upload-artifact"));
  assert.ok(upload, "verify must upload the tarballs as run artifacts");
  assert.equal(upload.with?.name, "release-tarballs");
  assert.equal(upload.with?.["if-no-files-found"], "error", "a missing artifact must fail verify, not publish");
});

test("R8.2 (4): publish downloads the verify-built tarballs and verifies every sha256 before publishing", () => {
  const publish = job("publish");
  const download = publish.steps.find((step) => String(step.uses ?? "").startsWith("actions/download-artifact"));
  assert.ok(download, "publish must download the tarballs verify built — never pack its own");
  assert.equal(download.with?.name, "release-tarballs");
  const verifyHashes = publish.steps.find((step) => String(step.run ?? "").includes("sha256sum --check"));
  assert.ok(
    verifyHashes,
    "publish must verify every tarball sha256 against what verify recorded before any npm publish",
  );
  // The three lockstep publishes must publish THE artifact tarballs.
  for (const tarball of ["sentropic-h2a-", "sentropic-h2a-runtime-", "sentropic-h2a-cli-"]) {
    const publishStep = publish.steps.find((step) => String(step.run ?? "").includes(`npm publish "dist-tarballs/${tarball}`));
    assert.ok(
      publishStep,
      `publish must run npm publish on the verified artifact tarball for ${tarball}*, not a workspace pack of a mutable ref`,
    );
  }
});

test("no publication path bypasses verify: publish needs verify and nothing else publishes", () => {
  for (const [id, job_] of Object.entries(WORKFLOW.jobs)) {
    if (id === "verify") continue;
    assert.ok(
      needsVerify(job_),
      `the ${id} job must depend on verify`,
    );
  }
  const publishSteps = job("publish").steps;
  const publishes = publishSteps.filter((step) => String(step.run ?? "").includes("npm publish"));
  assert.ok(publishes.length >= 4, "publish must publish track plus the three lockstep packages");
  for (const step of publishes) {
    assert.ok(
      String(step.run).includes("exit 1"),
      "every npm publish must fail the job on failure (#283): a silent publish error must never read as success",
    );
  }
});
