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
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { releaseContractFailures } from "../../../scripts/release-workflow-contract.mjs";

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

test("R8.1: verify keeps the Node 22+24 matrix — both legs EFFECTIVE", () => {
  const verify = job("verify");
  const matrix = verify.strategy?.matrix;
  assert.deepEqual(matrix?.node, ["22", "24"], "the matrix is pinned by the spec; dropping a leg narrows what a green proves");
  assert.deepEqual(matrix?.os, ["ubuntu-latest"]);
  // Round-5 review finding H02: adding `exclude: [{node: "22"}]` kept this
  // test green — matrix.node still listed both legs — while GitHub Actions
  // ran Node 24 ONLY. A pinned list is not a pinned matrix: what the runner
  // executes is the list AFTER include/exclude are applied, so no exclude
  // entry may exist and the matrix may carry no key beyond the pinned
  // os/node arrays (an exclude on os alone would remove EVERY leg).
  assert.equal(
    matrix?.exclude,
    undefined,
    "matrix.exclude removes legs the listed matrix still claims (round-5 finding H02: an excluded leg left the qualification green)",
  );
  assert.deepEqual(
    Object.keys(matrix ?? {}).sort(),
    ["node", "os"],
    "the EFFECTIVE leg set is pinned: any other matrix key (exclude, include, ...) changes which legs actually run without touching matrix.node",
  );
});

test("R8.1: the matrix legs are EFFECTIVE — verify's setup-node must run exactly ${{ matrix.node }}", () => {
  // Round-6 review finding P2: pinning verify's setup-node to a fixed
  // `node-version: "22"` kept every assertion above green — matrix.node still
  // listed ["22", "24"], no exclude existed, the matrix keys were exactly
  // os/node — while GitHub Actions ran BOTH legs on Node 22 and nothing
  // verified the other matrix leg anymore. A listed matrix leg is not a tested Node
  // version: the leg's steps decide which node actually runs, so the link
  // between matrix.node and the installed node is pinned here, in execution
  // shape: exactly ONE setup-node in verify, its inputs pinned (a
  // node-version-file or a second setup-node re-resolves the node behind the
  // matrix's back), and node-version equal to the matrix link itself.
  const verify = job("verify");
  const setups = verify.steps.filter((step) => String(step.uses ?? "").startsWith("actions/setup-node"));
  assert.equal(
    setups.length,
    1,
    "verify must carry exactly one setup-node: a second one re-pins every leg to a fixed version while the first still names matrix.node textually",
  );
  assert.deepEqual(
    Object.keys(setups[0].with ?? {}).sort(),
    ["cache", "node-version"],
    "the setup-node inputs are pinned: any other input (node-version-file, architecture, a stray second with-block key) changes which node the legs actually run",
  );
  assert.equal(
    setups[0].with?.["node-version"],
    "${{ matrix.node }}",
    "verify's node-version must BE the matrix link: a fixed value (round-6: node-version: \"22\") runs every leg on that one version while matrix.node still claims both legs are tested",
  );
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
  // Round-4 review finding F04: the condition merely had to CONTAIN the
  // substring `needs.verify.result == 'success'` — so appending `|| true`
  // (publish regardless of verify) left every assertion green. A textual
  // mention is not a logical requirement: the condition is pinned EXACTLY,
  // so any edit that makes verify's success optional — an `||` escape, a
  // dropped `!failure()`, a reintroduced 'skipped' — changes the string and
  // fails here.
  assert.equal(
    publish.if,
    "${{ !cancelled() && !failure() && needs.verify.result == 'success' }}",
    "publish.if must REQUIRE verify's success logically, not mention it textually: the round-4 mutation `(needs.verify.result == 'success' || true)` passed every substring check",
  );
  assert.ok(
    !publish.if.includes("skipped"),
    "the 'skipped' acceptance is what let backfills publish with zero tests; it must stay gone",
  );
});

test("R8.2/R8.4: no publish step may disable itself, and the integrity checks run before the first npm publish", () => {
  // Round-4 review finding F03: `if: false` on the tarball-sha256 step left
  // every structural assertion green while publish would ship unverified
  // bytes. The steps of publish are the LAST line of defence before the
  // registry: none of them may carry an `if:` (one edit to `if: false`
  // disables it, and even `if: true` is one edit away from a condition), and
  // the integrity checks must precede every publication.
  const publish = job("publish");
  const firstPublish = publish.steps.findIndex((step) => String(step.run ?? "").includes("npm publish"));
  assert.ok(firstPublish !== -1, "publish must publish the lockstep packages");
  for (const step of publish.steps) {
    assert.equal(
      step.if,
      undefined,
      `the publish step "${step.name ?? step.run ?? step.uses}" sets if: — one edit to 'if: false' disables it while every structural assertion stays green (round-4 finding F03)`,
    );
  }
  const shaCheck = publish.steps.find((step) => String(step.run ?? "").includes("sha256sum --check"));
  assert.ok(shaCheck, "publish must verify every tarball sha256 before publishing");
  assert.ok(
    publish.steps.indexOf(shaCheck) < firstPublish,
    "the sha256 check must run BEFORE the first npm publish — the bytes are verified, then published",
  );
  const manifestCheck = publish.steps.find((step) => String(step.run ?? "").includes("release-sha.txt"));
  assert.ok(manifestCheck, "publish must compare the artifact manifest SHA with the gated SHA");
  assert.ok(
    publish.steps.indexOf(manifestCheck) < firstPublish,
    "the manifest tie check must run BEFORE the first npm publish",
  );
});

/**
 * The EFFECTIVE script of a step: comment lines stripped, whitespace trimmed.
 * This is the execution contract — comments document it, these lines ARE it.
 */
function effectiveScript(run) {
  return String(run)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

test("R8.2: the publish integrity control is pinned COMMAND BY COMMAND — a check that cannot fail is not a check", () => {
  // Round-4 review finding F06 (G01/G02): the qualification only asserted the
  // PRESENCE of `sha256sum --check` and `release-sha.txt` and their position.
  // Appending `|| true` to the checksum line (the mutated control then
  // accepted corrupted bytes with exit 0) or inverting `!=` into `=` in the
  // manifest comparison (an ungated SHA then passed with exit 0) left every
  // assertion green — a textual mention was graded as a failure condition.
  // A mention is not a mechanism: the EFFECTIVE script (comments stripped) is
  // pinned line by line, so any edit that changes HOW the step can fail — an
  // `||` escape on the check, an inverted or self-satisfied comparison, a
  // dropped `exit 1`, a missing `set -euo pipefail` — changes a line and fails
  // here.
  const publish = job("publish");
  const integrity = publish.steps.find((step) => String(step.run ?? "").includes("sha256sum --check"));
  assert.ok(integrity, "publish must verify the tarball sha256 before publishing");
  // The step runs under GitHub's bash wrapper (its own -eo pipefail) and its
  // own `set -euo pipefail`; no working-directory or env may silently relocate
  // the files the pinned lines address.
  assert.equal(integrity.shell, "bash", "the integrity control must run under the bash wrapper — a weaker shell changes what the pinned lines mean");
  assert.equal(integrity["working-directory"], undefined, "a working-directory on the integrity step silently relocates the paths the pinned commands address");
  assert.equal(integrity.env, undefined, "an env block on the integrity step can shadow the variables the pinned comparison uses");
  assert.deepEqual(effectiveScript(integrity.run), [
    "set -euo pipefail",
    "(cd dist-tarballs && sha256sum --check --strict sha256sums.txt)",
    'manifest_sha="$(cat dist-tarballs/release-sha.txt)"',
    'gated_sha="${{ needs.verify.outputs.release-sha }}"',
    'if [ "$manifest_sha" != "$gated_sha" ]; then',
    'echo "::error::Artifact manifest SHA ${manifest_sha} != verify-gated SHA ${gated_sha}; refusing to publish bytes of an ungated commit." >&2',
    "exit 1",
    "fi",
  ], "the integrity control's failure conditions are pinned: `|| true` on the checksum (round-4 G01), an inverted comparison (round-4 G02), a self-satisfied or dropped refusal, or a removed `set -euo pipefail` all change this script");
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
  const smoke = firstStepIndex(verify, "npm run smoke:artifact -- --tarballs dist-tarballs");
  assert.ok(
    trustRoot < npmTest,
    "the trust root must gate the runner BEFORE the runner is trusted to report npm test",
  );
  assert.ok(
    npmTest < smoke,
    "the packaged-artifact smoke runs after the suite gate, still inside verify — smoke red means verify red means publish blocked",
  );
});

test("R8.2: verify packs the four lockstep packages, records sha256, uploads them as artifacts", () => {
  const verify = job("verify");
  const pack = verify.steps.find((step) => String(step.run ?? "").includes("npm pack --workspace"));
  assert.ok(pack, "verify must npm pack the candidate packages");
  for (const pkg of ["@sentropic/h2a", "@sentropic/h2a-runtime", "@sentropic/h2a-cli", "@sentropic/track"]) {
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

test("R8.2: the pack step is pinned COMMAND BY COMMAND — a manifest that stops covering a tarball is a changed line", () => {
  // Round-5 review finding H01: the qualification only required the pack
  // step to MENTION `sha256sum`. Mutating the manifest generation from
  // `sha256sum *.tgz` to `sha256sum sentropic-h2a-cli-*.tgz` kept every
  // assertion green: the manifest then covered the CLI tarball only, and
  // the pinned publish-side `sha256sum --check` verified exactly that one —
  // a corrupted runtime passed with exit 0. The pack step is the manifest's
  // only generator, so its EFFECTIVE script (comments stripped) is pinned
  // line by line, exactly like the publish integrity control: any edit that
  // changes WHAT the manifest covers changes a line and fails here.
  const pack = job("verify").steps.find((step) => String(step.run ?? "").includes("npm pack --workspace"));
  assert.ok(pack, "verify must pack the lockstep packages");
  assert.equal(pack.shell, "bash", "the manifest generation must run under the bash wrapper — a weaker shell changes what the pinned lines mean");
  assert.equal(pack["working-directory"], undefined, "a working-directory on the pack step silently relocates the paths the pinned commands address");
  assert.deepEqual(effectiveScript(pack.run), [
    "set -euo pipefail",
    "mkdir -p dist-tarballs",
    "for pkg in @sentropic/h2a @sentropic/h2a-runtime @sentropic/h2a-cli @sentropic/track; do",
    'npm pack --workspace "$pkg" --pack-destination dist-tarballs',
    "done",
    "(cd dist-tarballs && sha256sum *.tgz > sha256sums.txt && cat sha256sums.txt)",
    'echo "${{ needs.resolve-release-sha.outputs.release-sha }}" > dist-tarballs/release-sha.txt',
  ], "the manifest generation is pinned: narrowing the sha256sum glob (round-5 H01: CLI-only manifest), dropping a package from the pack loop, or removing `set -euo pipefail` all change this script");
});

test("R8.2: the sha256 manifest covers the FOUR lockstep tarballs — generation AND consumption are EXECUTED", () => {
  // The round-5 H01 proof closed on execution, not text: a textual pin
  // proves the script did not change, not that it MEANS coverage. So this
  // qualification executes the workflow's own pack step and publish
  // integrity control in a mkdtemp lab with a fake npm (no install, no
  // registry, no publication — only local files): the manifest the pack
  // step actually GENERATES must cover h2a, h2a-runtime, h2a-cli and track,
  // and the publish control must refuse EACH of the four tarballs once its
  // bytes are corrupted. Under the round-5 mutation (a manifest covering
  // the CLI only) the corrupted runtime passes with exit 0 — exactly the
  // property this test forces to stay red.
  const pack = job("verify").steps.find((step) => String(step.run ?? "").includes("npm pack --workspace"));
  const integrity = job("publish").steps.find((step) => String(step.run ?? "").includes("sha256sum --check"));
  assert.ok(pack, "verify must pack the lockstep packages");
  assert.ok(integrity, "publish must check the tarball sha256");
  const sha = "a".repeat(40);
  const lab = mkdtempSync(join(tmpdir(), "release-manifest-coverage-"));
  const labEnv = () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    env.HOME = lab;
    env.TMPDIR = lab;
    env.XDG_RUNTIME_DIR = join(lab, "run");
    return env;
  };
  mkdirSync(join(lab, "run"));
  try {
    // A fake npm producing the four tarballs `npm pack` would: purely local
    // file writes inside the lab, no network and no real npm involved.
    const bin = join(lab, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "npm"), [
      "#!/usr/bin/env bash",
      "set -eu",
      'pkg="" dest="."',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --workspace) pkg="$2"; shift 2 ;;',
      '    --pack-destination) dest="$2"; shift 2 ;;',
      '    *) shift ;;',
      "  esac",
      "done",
      'name="${pkg#@sentropic/}"',
      'printf "candidate original bytes: %s\\n" "$name" > "${dest}/sentropic-${name}-0.98.5.tgz"',
      "",
    ].join("\n"), { mode: 0o700 });
    const runWorkflowScript = (script, name) => {
      const file = join(lab, name);
      // The only ${{ }} expressions in these two scripts resolve to the one
      // gated SHA; substitute it so the scripts run exactly as GitHub would.
      writeFileSync(file, String(script).replace(/\$\{\{[^}]+\}\}/g, sha));
      return spawnSync("bash", [file], {
        cwd: lab,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...labEnv(), PATH: `${bin}:${process.env.PATH}` },
      });
    };
    const build = runWorkflowScript(pack.run, "pack.sh");
    assert.equal(build.status, 0, `the pack step must succeed in the lab:\n${build.stdout}\n${build.stderr}`);
    const manifest = readFileSync(join(lab, "dist-tarballs", "sha256sums.txt"), "utf8");
    const covered = manifest
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.trim().split(/\s+/)[1]);
    assert.deepEqual(
      [...covered].sort(),
      ["sentropic-h2a-0.98.5.tgz", "sentropic-h2a-cli-0.98.5.tgz", "sentropic-h2a-runtime-0.98.5.tgz", "sentropic-track-0.98.5.tgz"],
      "the manifest the pack step GENERATES must cover all FOUR lockstep tarballs — a CLI-only manifest is the round-5 false green",
    );
    assert.equal(
      readFileSync(join(lab, "dist-tarballs", "release-sha.txt"), "utf8").trim(),
      sha,
      "the manifest must travel with the resolved SHA it is tied to",
    );
    // Positive control: on the exact packed bytes, the publish control passes.
    const intact = runWorkflowScript(integrity.run, "integrity.sh");
    assert.equal(intact.status, 0, `positive control failed:\n${intact.stdout}\n${intact.stderr}`);
    // The guarded property, per tarball: corrupt the bytes, the publish
    // control must refuse EACH of the four (exit non-zero), then restore.
    for (const tarball of covered) {
      const path = join(lab, "dist-tarballs", tarball);
      const original = readFileSync(path);
      writeFileSync(path, `corrupted bytes: ${tarball}`);
      const check = runWorkflowScript(integrity.run, "integrity.sh");
      assert.notEqual(check.status, 0, `the publish control ACCEPTED corrupted ${tarball} — the manifest does not effectively cover it`);
      writeFileSync(path, original);
    }
  } finally {
    rmSync(lab, { recursive: true, force: true });
  }
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
  // The four lockstep publishes must publish THE artifact tarballs.
  for (const tarball of ["sentropic-h2a-", "sentropic-h2a-runtime-", "sentropic-h2a-cli-", "sentropic-track-"]) {
    const publishStep = publish.steps.find((step) => String(step.run ?? "").includes(`npm publish "dist-tarballs/${tarball}`));
    assert.ok(
      publishStep,
      `publish must run npm publish on the verified artifact tarball for ${tarball}*, not a workspace pack of a mutable ref`,
    );
  }
});

test("R8.2: @sentropic/track publishes the VERIFIED tarball bytes — pinned COMMAND BY COMMAND", () => {
  // 0.98.6 publish incident: the track step ran `npm publish --workspace
  // @sentropic/track`, re-running the package build in the publish job where
  // dev types are absent (TS2688: Cannot find type definition file for
  // 'node'). The three other packages publish the verify-built tarball bytes
  // (sha256-checked, SPEC 0.98.5 R8.2); track must do exactly the same. The
  // EFFECTIVE script (comments stripped) is pinned line by line, so any
  // return to a workspace repack — or a dropped sha256 re-check — changes a
  // line and fails here.
  const publish = job("publish");
  const step = publish.steps.find((s) => s.name === "Publish @sentropic/track (trusted publishing, public)");
  assert.ok(step, "publish must carry the track tarball step under its trusted-publishing name");
  assert.equal(step.shell, "bash", "the track publish must run under the bash wrapper — a weaker shell changes what the pinned lines mean");
  assert.equal(step["working-directory"], undefined, "a working-directory on the track step silently relocates the paths the pinned commands address");
  assert.equal(step.env, undefined, "an env block on the track step can shadow the variables the pinned commands use");
  assert.equal(step.if, undefined, "the track publish must stay unconditional (the total-unconditionality test above enforces this for every step)");
  assert.equal(step["continue-on-error"], undefined, "a continue-on-error on the track publish would read a failed publication green");
  assert.ok(
    !String(step.run).includes("--workspace"),
    "the track publish must never repack a workspace: `npm publish --workspace` rebuilds in the publish job where dev types are absent (0.98.6 TS2688)",
  );
  assert.deepEqual(effectiveScript(step.run), [
    'v="$(node -p "require(\'./packages/track/package.json\').version")"',
    'if npm view "@sentropic/track@$v" version >/dev/null 2>&1; then',
    'echo "@sentropic/track@$v already on registry; skipping."',
    "else",
    'tagArgs=""',
    'latest="$(npm view "@sentropic/track" dist-tags.latest 2>/dev/null || true)"',
    'if [ -n "$latest" ] && [ "$v" != "$latest" ]; then',
    'lowest="$(printf \'%s\\n%s\\n\' "$v" "$latest" | sort -V | head -n1)"',
    'if [ "$lowest" = "$v" ]; then',
    'tagArgs="--tag backfill"',
    'echo "@sentropic/track@$v is below latest ($latest); publishing with $tagArgs so the latest dist-tag stays untouched."',
    "fi",
    "fi",
    "(cd dist-tarballs && sha256sum --check --strict sha256sums.txt)",
    'if ! npm publish "dist-tarballs/sentropic-track-${v}.tgz" --access public $tagArgs; then',
    'echo "::error::@sentropic/track@$v: npm publish failed (not published)." >&2',
    "exit 1",
    "fi",
    "fi",
    "for attempt in $(seq 1 18); do",
    'if npm view "@sentropic/track@$v" version >/dev/null 2>&1; then',
    "break",
    "fi",
    'if [[ "$attempt" -eq 18 ]]; then',
    'echo "::warning::@sentropic/track@$v was published but is not visible on registry after 18 attempts — registry propagation lag; not failing the step." >&2',
    "break",
    "fi",
    'echo "@sentropic/track@$v is not visible on registry yet; retrying in 10 seconds (attempt $attempt/18)." >&2',
    "sleep 10",
    "done",
  ], "the track publish's failure and idempotence conditions are pinned: a workspace repack (0.98.6 TS2688), a dropped sha256 re-check, a lost backfill tag, or a silenced publish error all change this script");
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

test("R8.1/R8.3/R8.4: the mandatory verify steps are UNCONDITIONAL — a disabled gate still reads green", () => {
  // Round-3 review finding N01: adding `if: false` to the trust-root, npm-test
  // and smoke steps left all 11 assertions of this file green. The gates would
  // simply never run while `verify` reported success and publish proceeded.
  // An `if:` on a verification step is one edit away from disabling the gate,
  // so NO step of verify may set one — not even `if: true`, which only looks
  // harmless until someone edits the condition.
  // (The pack step is unconditional since the round-7 fix; the only remaining
  // matrix-scoped `if` in verify is the single-leg upload, pinned exactly by
  // the total-unconditionality test below.)
  const verify = job("verify");
  const mandatory = new Map([
    ["node --test packages/h2a/test/run-test-gates.test.js", "the trust root"],
    ["npm test", "the full gate suite (h2a + runtime TS suites)"],
    ["npm run smoke:artifact -- --tarballs dist-tarballs", "the packaged-artifact smoke"],
  ]);
  for (const [run, what] of mandatory) {
    const step = verify.steps.find((s) => s.run === run);
    assert.ok(step, `verify must keep a step running exactly \`${run}\` (${what})`);
    assert.equal(
      step.if,
      undefined,
      `the step running \`${run}\` (${what}) sets if: — one edit to \`if: false\` disables the gate while every structural assertion stays green`,
    );
  }
});

test("R8/R8.4: EVERY step of the workflow is UNCONDITIONAL — the only sanctioned `if` is the single-leg upload", () => {
  // Round-7 review finding P2: `if: false` on verify's setup-node kept every
  // assertion above green — both legs then ran the runner's default Node
  // while the matrix still claimed both legs. The round-3 mandatory pin covered
  // run-steps only; a `uses:` step (checkout, setup-node) or any other
  // dependency (npm ci, the pack/checksums step) could be disabled with one
  // `if:` line while the workflow kept reading green. The invariant is
  // therefore STRUCTURAL and TOTAL: NO step of ANY job may carry an `if:`,
  // with exactly one sanctioned exception — verify's single-leg upload
  // (actions/upload-artifact forbids duplicate artifact names, and a missing
  // upload fails publish's download step fail-closed; it cannot silently
  // read green). The exception's condition is pinned exactly, so any other
  // condition — including `if: false` — fails here.
  for (const [id, job_] of Object.entries(WORKFLOW.jobs)) {
    for (const step of job_.steps ?? []) {
      const isVerifyUpload =
        id === "verify" && String(step.uses ?? "").startsWith("actions/upload-artifact");
      if (isVerifyUpload) {
        assert.equal(
          step.if,
          "matrix.node == '22'",
          "the single-leg upload condition is pinned exactly: any other condition can drop the artifact leg — and with it the bytes publish consumes — behind a green workflow",
        );
        continue;
      }
      assert.equal(
        step.if,
        undefined,
        `the step "${step.name ?? step.run ?? step.uses}" of ${id} sets if: — one edit to \`if: false\` disables it while every structural assertion stays green (round-7 finding P2)`,
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


test("C9: the complete execution plan preserves context, SHA, Node, bytes and every publication route", () => {
  assert.deepEqual(releaseContractFailures(WORKFLOW), []);
  const verify = job("verify");
  const pack = verify.steps.findIndex((step) => String(step.run ?? "").includes("npm pack --workspace"));
  const smoke = firstStepIndex(verify, "npm run smoke:artifact -- --tarballs dist-tarballs");
  const upload = verify.steps.findIndex((step) => step.uses === "actions/upload-artifact@v4");
  assert.ok(pack < smoke && smoke + 1 === upload, "smoke exercises the built bytes immediately before their upload");
});

test("C9 A09: a comment-shaped line inside a quoted script cannot hide another publication", () => {
  const mutant = structuredClone(WORKFLOW);
  const doctor = mutant.jobs.publish.steps.find((step) => step.name === "Verify published @sentropic/h2a doctor (post-release)");
  const original = doctor.run;
  doctor.run = doctor.run.replace("node -e '\n", "node -e '\n#' || npm publish --workspace @sentropic/h2a\n");
  assert.notEqual(doctor.run, original, "the quoting mutation must apply");
  assert.ok(releaseContractFailures(mutant).length > 0, "script lines inside quotes are executable data, even when they start with #");
});
