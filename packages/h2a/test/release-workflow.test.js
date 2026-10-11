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

/** Same shape for any job id. */
function needsJob(job_, id) {
  if (job_.needs === id) return true;
  if (Array.isArray(job_.needs)) return job_.needs.includes(id);
  return Boolean(job_.needs?.[id]);
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

test("R8.2 TOCTOU + race: the SHA is resolved ONCE in a prior job; verify consumes it and never resolves", () => {
  // The review reproduced the race with a fake git: when EACH verify matrix
  // leg resolved the mutable tag itself, two legs could gate two different
  // commits while the artifacts came from only one of them. The fix is
  // structural: ONE resolution, before the matrix exists.
  const resolveJob = job("resolve-release-sha");
  const resolveStep = resolveJob.steps.find((step) => step.id === "resolve");
  assert.ok(resolveStep, "resolve-release-sha must resolve the exact release SHA in a named step");
  assert.equal(
    resolveJob.steps.length,
    1,
    "the resolution job must do nothing but resolve — no checkout, no build, nothing that could fail on a different SHA",
  );
  assert.equal(resolveJob.needs, undefined, "the resolution job must not inherit another job's verdict");
  assert.ok(
    String(resolveStep.run).includes("git ls-remote"),
    "the backfill path must peel the existing tag from the remote",
  );
  assert.equal(resolveJob.outputs?.["release-sha"], "${{ steps.resolve.outputs.sha }}");

  const verify = job("verify");
  assert.ok(
    needsJob(verify, "resolve-release-sha"),
    "verify must need resolve-release-sha and consume its output — never re-resolve per leg",
  );
  for (const step of verify.steps) {
    assert.ok(
      step.id !== "resolve",
      "verify must NOT carry its own resolve step: per-leg resolution is the reproduced race",
    );
    assert.ok(
      !String(step.run ?? "").includes("git ls-remote"),
      "verify must not resolve a tag: the mutable tag is peeled exactly once, before the matrix",
    );
  }
  const checkout = verify.steps.find((step) => step.uses === "actions/checkout@v4");
  assert.ok(checkout, "verify must check out the repository");
  assert.equal(
    checkout.with?.ref,
    "${{ needs.resolve-release-sha.outputs.release-sha }}",
    "verify must check out the one resolved SHA, never a mutable tag name",
  );
  assert.equal(
    verify.outputs?.["release-sha"],
    "${{ needs.resolve-release-sha.outputs.release-sha }}",
    "verify must re-export the gated SHA for publish to consume — identical on every leg, by construction",
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

test("R8.2: the artifact manifest is TIED to the resolved SHA, and publish re-checks the tie before publishing", () => {
  const pack = job("verify").steps.find((step) => String(step.run ?? "").includes("sha256sum"));
  assert.ok(pack, "verify must record the tarball sha256 sums");
  assert.ok(
    String(pack.run).includes("release-sha.txt"),
    "verify must write the ONE resolved SHA into the artifact (release-sha.txt): the manifest must travel with the bytes it describes",
  );
  assert.ok(
    String(pack.run).includes("${{ needs.resolve-release-sha.outputs.release-sha }}"),
    "the manifest SHA must be the resolve-release-sha output — the same SHA every leg gated",
  );
  const publish = job("publish");
  const manifestCheck = publish.steps.find((step) => String(step.run ?? "").includes("release-sha.txt"));
  assert.ok(
    manifestCheck,
    "publish must compare the manifest SHA with the verify-gated SHA before publishing anything",
  );
  const firstPublish = publish.steps.findIndex((step) => String(step.run ?? "").includes("npm publish"));
  assert.ok(
    publish.steps.indexOf(manifestCheck) < firstPublish,
    "the manifest tie check must run BEFORE the first npm publish",
  );
});

test("R8.2/R8.4: no step anywhere may swallow its own failure (continue-on-error)", () => {
  // The review's mutation: `continue-on-error: true` on the three verification
  // steps left every structural assertion green while a red verify would still
  // read as success and publish. A gate that cannot fail is not a gate.
  for (const [id, job_] of Object.entries(WORKFLOW.jobs)) {
    for (const step of job_.steps ?? []) {
      assert.equal(
        step["continue-on-error"],
        undefined,
        `step "${step.name ?? step.run ?? step.uses}" of ${id} sets continue-on-error: its failure would read green and publish anyway`,
      );
    }
  }
});

test("no publication path bypasses verify: publish needs verify and nothing else publishes", () => {
  for (const [id, job_] of Object.entries(WORKFLOW.jobs)) {
    if (id === "verify" || id === "resolve-release-sha") continue;
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
