/**
 * SPEC (owner decision 16/10, "publish rehearsal", option A): the 0.98.6
 * publish failed four times, each time in a part of the publish path that had
 * never run before a real tag — a hard-coded smoke pin, track missing from
 * the registry during verify, track rebuilt without dev types in publish, a
 * relative tarball path parsed as a GitHub shorthand. The rehearsal workflow
 * (.github/workflows/publish-rehearsal.yml) runs that whole path on every
 * pull request with `npm publish --dry-run` and no registry credentials.
 *
 * This file pins that the rehearsal CANNOT DRIFT from the real publish: the
 * four per-package publish commands are byte-identical to release.yml's
 * publish job except for the single `--dry-run` token, in the same
 * installable order (track, h2a-runtime, h2a, h2a-cli), with the same npm
 * version, the same idempotence/backfill logic, and no credentials. A
 * reintroduced defect (workspace repack, bare tarball path, lost backfill
 * tag, reordered publish) changes one side and fails here.
 *
 * Parse+assert only (same standing choice as release-workflow.test.js): it
 * parses both workflows with a real YAML parser. No network, no registry, no
 * skip: every assertion below either passes or fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const RELEASE = YAML.parse(
  readFileSync(resolve(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8"),
);
const REHEARSAL = YAML.parse(
  readFileSync(resolve(REPO_ROOT, ".github", "workflows", "publish-rehearsal.yml"), "utf8"),
);

/** The four lockstep packages in installable publish order. */
const PACKAGES = [
  ["@sentropic/track", "sentropic-track-"],
  ["@sentropic/h2a-runtime", "sentropic-h2a-runtime-"],
  ["@sentropic/h2a", "sentropic-h2a-"],
  ["@sentropic/h2a-cli", "sentropic-h2a-cli-"],
];

/**
 * The EFFECTIVE script of a step: comment lines stripped, whitespace trimmed.
 * Same execution-contract definition as release-workflow.test.js.
 */
function effectiveScript(run) {
  return String(run)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function publishStepFor(job, tarballPrefix, what) {
  // The full tarball file spec disambiguates: "sentropic-h2a-" is a prefix of
  // the runtime and cli tarballs, so a bare-prefix match is ambiguous.
  const marker = '"./dist-tarballs/' + tarballPrefix + '${v}.tgz"';
  const holders = (job.steps ?? []).filter(
    (step) =>
      String(step.run ?? "").includes("npm publish") && String(step.run ?? "").includes(marker),
  );
  assert.equal(
    holders.length,
    1,
    `${what}: exactly one publish step must ship "./dist-tarballs/${tarballPrefix}..." — zero means the package is unpublished, two means the order pin is ambiguous`,
  );
  return holders[0];
}

test("rehearsal triggers on every PR touching the publish path, plus dispatch", () => {
  const on = REHEARSAL.on;
  assert.ok(on?.pull_request, "the rehearsal must run on pull_request");
  assert.ok("workflow_dispatch" in (on ?? {}), "the rehearsal must also run on workflow_dispatch");
  const paths = on.pull_request.paths ?? [];
  for (const required of [
    ".github/workflows/release.yml",
    "scripts/release*.mjs",
    "scripts/smoke-artifact.mjs",
    "packages/*/package.json",
  ]) {
    assert.ok(
      paths.includes(required),
      `the rehearsal pull_request trigger must list ${required} — otherwise the publish path changes without ever rehearsing`,
    );
  }
});

test("the rehearsal job carries its required-style check name", () => {
  const job = REHEARSAL.jobs?.["rehearse-publish"];
  assert.ok(job, "publish-rehearsal.yml must contain a rehearse-publish job");
  assert.equal(
    job.name,
    "Publish rehearsal (dry-run)",
    "the check name is what the owner adds to branch protection — pin it exactly",
  );
});

test("the rehearsal publishes the four lockstep packages in installable dependency order", () => {
  const job = REHEARSAL.jobs["rehearse-publish"];
  const indexOf = (tarballPrefix) =>
    (job.steps ?? []).findIndex(
      (step) =>
        String(step.run ?? "").includes("npm publish") &&
        String(step.run ?? "").includes('"./dist-tarballs/' + tarballPrefix + '${v}.tgz"'),
    );
  const order = PACKAGES.map(([, prefix]) => indexOf(prefix));
  for (const [i, idx] of order.entries()) {
    assert.ok(idx !== -1, `the rehearsal must dry-run publish ${PACKAGES[i][0]}`);
  }
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "the rehearsal dry-run order must be track, h2a-runtime, h2a, h2a-cli — the installable order of the publish job",
  );
  assert.deepEqual(
    order.map((idx) => job.steps[idx].name),
    [
      "Rehearse @sentropic/track publish (dry-run)",
      "Rehearse @sentropic/h2a-runtime publish (dry-run)",
      "Rehearse @sentropic/h2a publish (dry-run)",
      "Rehearse @sentropic/h2a-cli publish (dry-run)",
    ],
  );
});

test("each rehearsal publish runs the SAME commands as the publish job, plus only --dry-run", () => {
  // The anti-drift core: strip the single `--dry-run` token from the
  // rehearsal step and the EFFECTIVE scripts must be identical to the
  // publish job's. A reintroduced workspace repack (0.98.6 TS2688), a bare
  // tarball path (0.98.6 git shorthand), a dropped backfill tag or a lost
  // idempotence check changes a line on one side and fails here.
  const publish = RELEASE.jobs.publish;
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  for (const [packageName, tarballPrefix] of PACKAGES) {
    const real = publishStepFor(publish, tarballPrefix, "publish");
    const dry = publishStepFor(rehearsal, tarballPrefix, "rehearsal");
    assert.equal(dry.shell, "bash");
    assert.equal(dry["working-directory"], undefined);
    assert.equal(dry.env, undefined);
    assert.equal(dry.if, undefined, "a rehearsal publish with `if:` can disable itself green");
    assert.equal(
      dry["continue-on-error"],
      undefined,
      "a rehearsal publish with continue-on-error reads a failed dry-run green",
    );
    const realLines = effectiveScript(real.run);
    const dryLines = effectiveScript(dry.run);
    assert.equal(
      dryLines.length,
      realLines.length,
      `${packageName}: the rehearsal step must have exactly as many effective lines as the publish step (same commands, no more, no fewer)`,
    );
    const differing = realLines.filter((line, i) => dryLines[i] !== line);
    assert.equal(
      differing.length,
      1,
      `${packageName}: exactly ONE effective line may differ between rehearsal and publish — the npm publish invocation gaining --dry-run (got ${differing.length})`,
    );
    const at = realLines.findIndex((line, i) => dryLines[i] !== line);
    assert.equal(
      dryLines[at],
      realLines[at].replace(" $tagArgs;", " $tagArgs --dry-run;"),
      `${packageName}: the single differing line must be the publish invocation with --dry-run appended after $tagArgs`,
    );
    assert.ok(
      dryLines[at].includes("npm publish") && dryLines[at].includes("--dry-run"),
      `${packageName}: the differing line must be the dry-run publish`,
    );
  }
});

test("every rehearsal npm publish is a dry-run — nothing here may ever publish", () => {
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  const publishes = (rehearsal.steps ?? []).filter((step) =>
    String(step.run ?? "").includes("npm publish"),
  );
  assert.equal(publishes.length, 4, "the rehearsal must dry-run exactly the four lockstep publishes");
  for (const step of publishes) {
    for (const line of effectiveScript(step.run)) {
      // Actual invocations address the tarball file spec; the failure-report
      // echo merely MENTIONS npm publish and carries no --dry-run.
      if (line.includes('npm publish "./dist-tarballs/')) {
        assert.ok(
          line.includes("--dry-run"),
          `rehearsal line publishes without --dry-run: ${line}`,
        );
      }
    }
  }
});

test("the rehearsal uses the same npm version and Node floor as the publish job", () => {
  const publish = RELEASE.jobs.publish;
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  const npmStep = (job) =>
    (job.steps ?? []).find((step) => String(step.run ?? "").includes("npm install -g npm@"));
  assert.equal(
    String(npmStep(rehearsal)?.run ?? "").trim(),
    String(npmStep(publish)?.run ?? "").trim(),
    "the rehearsal must install the same npm version as publish (the shorthand-parsing behaviour is npm-version dependent)",
  );
  assert.ok(
    String(npmStep(rehearsal)?.run ?? "").includes("npm@^11.15.0"),
    "the pinned npm floor (trusted-publishing support) must stay identical on both sides",
  );
  const nodeOf = (job) =>
    (job.steps ?? []).find((step) => String(step.uses ?? "").startsWith("actions/setup-node"));
  assert.equal(
    nodeOf(rehearsal)?.with?.["node-version"],
    "22",
    "the rehearsal runs the publish job's Node floor (owner decision 2026-10-12: minimum Node 22, including publish)",
  );
  assert.equal(
    nodeOf(rehearsal)?.with?.["node-version"],
    nodeOf(publish)?.with?.["node-version"],
  );
});

test("the rehearsal packs the four lockstep tarballs exactly like verify, then smokes them", () => {
  const verify = RELEASE.jobs.verify;
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  const verifyPack = (verify.steps ?? []).find((step) =>
    String(step.run ?? "").includes("npm pack --workspace"),
  );
  const rehearsalPack = (rehearsal.steps ?? []).find((step) =>
    String(step.run ?? "").includes("npm pack --workspace"),
  );
  assert.ok(verifyPack && rehearsalPack, "both verify and the rehearsal must pack the workspaces");
  for (const pkg of ["@sentropic/h2a", "@sentropic/h2a-runtime", "@sentropic/h2a-cli", "@sentropic/track"]) {
    assert.ok(
      String(rehearsalPack.run).includes(pkg),
      `the rehearsal must pack ${pkg} — the dry-run publish MUST address these exact bytes`,
    );
  }
  assert.ok(
    String(rehearsalPack.run).includes("(cd dist-tarballs && sha256sum *.tgz > sha256sums.txt"),
    "the rehearsal must write the same sha256 manifest verify writes",
  );
  // Only the SHA source differs: verify ties the manifest to the resolved
  // release SHA, the rehearsal to its own checkout HEAD (no gated SHA exists
  // on a PR). Every other effective line must match.
  const onlyShaSourceDiffers = (a, b) =>
    a.filter((line, i) => b[i] !== line).every((line) => line.includes("release-sha"));
  assert.ok(
    onlyShaSourceDiffers(effectiveScript(verifyPack.run), effectiveScript(rehearsalPack.run)),
    "the rehearsal pack step must match verify's line by line except the release-sha source",
  );
  const smoke = (rehearsal.steps ?? []).find(
    (step) => step.run === "npm run smoke:artifact -- --tarballs dist-tarballs",
  );
  assert.ok(
    smoke,
    "the rehearsal must run the packaged-artifact smoke on the packed tarballs (a hard-coded smoke pin then fails here, not at tag time)",
  );
  assert.equal(smoke.if, undefined);
});

test("the rehearsal re-checks the tarball sha256 tie before any dry-run publish", () => {
  const publish = RELEASE.jobs.publish;
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  const real = (publish.steps ?? []).find((step) => String(step.run ?? "").includes("sha256sum --check"));
  const dry = (rehearsal.steps ?? []).find((step) => String(step.run ?? "").includes("sha256sum --check"));
  assert.ok(real && dry, "both publish and the rehearsal must verify the tarball sha256");
  const realLines = effectiveScript(real.run);
  const dryLines = effectiveScript(dry.run);
  assert.equal(dryLines.length, realLines.length);
  for (const [i, line] of realLines.entries()) {
    if (dryLines[i] === line) continue;
    // Only the gated-SHA source may differ (PR checkout HEAD vs gated SHA);
    // the check, the strictness and the refusal must be identical.
    assert.ok(
      line.includes("needs.verify.outputs.release-sha") && dryLines[i].includes("git rev-parse HEAD"),
      `only the SHA source may differ in the integrity control (line ${i}): ${line} vs ${dryLines[i]}`,
    );
  }
  const firstDryPublish = (rehearsal.steps ?? []).findIndex((step) =>
    String(step.run ?? "").includes("npm publish"),
  );
  assert.ok(
    (rehearsal.steps ?? []).indexOf(dry) < firstDryPublish,
    "the sha256 re-check must run BEFORE the first dry-run publish",
  );
});

test("the rehearsal keeps the publish guards: tarball bytes, ./ file spec, backfill, idempotence", () => {
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  for (const [packageName, tarballPrefix] of PACKAGES) {
    const step = publishStepFor(rehearsal, tarballPrefix, "rehearsal");
    const run = String(step.run);
    assert.ok(
      !run.includes("--workspace"),
      `${packageName}: the rehearsal must never repack a workspace (0.98.6 TS2688: the publish job has no dev types)`,
    );
    assert.ok(
      run.includes(`npm publish "./dist-tarballs/${tarballPrefix}\${v}.tgz"`),
      `${packageName}: the rehearsal must address the verified tarball via an unambiguous ./ file spec (0.98.6: the bare form parsed as git shorthand)`,
    );
    assert.ok(run.includes("sha256sum --check --strict sha256sums.txt"));
    assert.ok(run.includes("already on registry; skipping"));
    assert.ok(run.includes("--tag backfill"));
    assert.ok(run.includes("not visible on registry yet; retrying"));
  }
});

test("the rehearsal drops node_modules before the dry-run publishes", () => {
  // The publish job never runs `npm ci`: it downloads the verified tarballs
  // into a dependency-less checkout, which is exactly why the 0.98.6
  // `--workspace` repack died there (TS2688) while passing everywhere with
  // dev types. The rehearsal NEEDS node_modules to pack and smoke, then
  // removes it — so a reintroduced workspace repack fails the dry-run here
  // instead of passing with dev types and exploding at tag time.
  const rehearsal = REHEARSAL.jobs["rehearse-publish"];
  const drop = (rehearsal.steps ?? []).findIndex((step) =>
    String(step.run ?? "").includes("rm -rf node_modules"),
  );
  assert.ok(drop !== -1, "the rehearsal must drop node_modules after the smoke");
  const smokeIdx = (rehearsal.steps ?? []).findIndex(
    (step) => step.run === "npm run smoke:artifact -- --tarballs dist-tarballs",
  );
  const firstDryPublish = (rehearsal.steps ?? []).findIndex((step) =>
    String(step.run ?? "").includes("npm publish"),
  );
  assert.ok(smokeIdx !== -1 && smokeIdx < drop && drop < firstDryPublish);
});

test("the rehearsal carries no registry credentials", () => {
  const source = readFileSync(
    resolve(REPO_ROOT, ".github", "workflows", "publish-rehearsal.yml"),
    "utf8",
  );
  assert.equal(REHEARSAL.permissions?.["id-token"], undefined, "no trusted-publishing identity in the rehearsal");
  for (const needle of ["NODE_AUTH_TOKEN", "NPM_TOKEN", "registry-password", "id-token: write"]) {
    assert.ok(!source.includes(needle), `the rehearsal must not carry ${needle}`);
  }
  for (const [id, job] of Object.entries(REHEARSAL.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      assert.equal(step.if, undefined, `rehearsal step "${step.name ?? step.run ?? step.uses}" of ${id} sets if:`);
      assert.equal(
        step["continue-on-error"],
        undefined,
        `rehearsal step "${step.name ?? step.run ?? step.uses}" of ${id} sets continue-on-error`,
      );
    }
  }
});
