import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const workflow = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");

const publishStep = (packageName) => {
  const marker = `- name: Publish ${packageName} (`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `release workflow must publish ${packageName}`);
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next === -1 ? undefined : next);
};

test("release publishes lockstep packages in installable dependency order", () => {
  const track = workflow.indexOf("- name: Publish @sentropic/track");
  const runtime = workflow.indexOf("- name: Publish @sentropic/h2a-runtime");
  const h2a = workflow.indexOf("- name: Publish @sentropic/h2a (");
  const cli = workflow.indexOf("- name: Publish @sentropic/h2a-cli");

  assert.ok(track < runtime, "Track must be available before @sentropic/h2a");
  assert.ok(runtime < h2a, "runtime must be available before its @sentropic/h2a peer consumer");
  assert.ok(h2a < cli, "@sentropic/h2a must be available before @sentropic/h2a-cli");
});

for (const packageName of [
  "@sentropic/track",
  "@sentropic/h2a-runtime",
  "@sentropic/h2a",
  "@sentropic/h2a-cli",
]) {
  test(`release publication of ${packageName} is retry-safe and waits for registry visibility`, () => {
    const step = publishStep(packageName);
    assert.match(step, new RegExp(`npm view [^\\n]*${packageName.replace("/", "\\/")}`));
    assert.match(step, /already on registry; skipping/);
    assert.match(step, /not visible on registry yet; retrying/);
  });
}

test("release publishes are backfill-safe: a version below latest gets --tag backfill", () => {
  for (const packageName of [
    "@sentropic/track",
    "@sentropic/h2a-runtime",
    "@sentropic/h2a",
    "@sentropic/h2a-cli",
  ]) {
    const step = publishStep(packageName);
    assert.match(step, /dist-tags\.latest/, `${packageName}: publish must read the current latest dist-tag`);
    assert.match(step, /--tag backfill/, `${packageName}: publish must fall back to --tag backfill when below latest`);
  }
});

test("release publishes the VERIFIED tarball bytes for all four packages (no workspace repack)", () => {
  // 0.98.6 incident: the track step re-ran `npm publish --workspace
  // @sentropic/track`, rebuilding in the publish job where dev types are
  // absent (TS2688). Every lockstep publish must ship the verify-built
  // tarball after a sha256 re-check — never a workspace repack.
  for (const [packageName, tarball] of [
    ["@sentropic/track", "sentropic-track-"],
    ["@sentropic/h2a-runtime", "sentropic-h2a-runtime-"],
    ["@sentropic/h2a", "sentropic-h2a-"],
    ["@sentropic/h2a-cli", "sentropic-h2a-cli-"],
  ]) {
    const step = publishStep(packageName);
    assert.match(step, new RegExp(`npm publish "\\./dist-tarballs/${tarball}\\$\\{v\\}\\.tgz"`), `${packageName}: publish must ship the verify-built tarball bytes via an unambiguous ./ file spec (0.98.6: the bare form parsed as git shorthand)`);
    assert.match(step, /sha256sum --check --strict sha256sums\.txt/, `${packageName}: publish must re-check the tarball sha256 before publishing`);
    assert.ok(!step.includes("--workspace"), `${packageName}: publish must never repack a workspace (0.98.6 TS2688)`);
  }
});

test("release workflow supports a backfill dispatch for an existing tag", () => {
  const parsed = YAML.parse(workflow);
  assert.equal(parsed.on.workflow_dispatch.inputs["backfill-version"].required, true);
  // R8.2/R8.4: backfill resolves once, verifies both legs, and publishes
  // only the immutable SHA's verified artifact. Comments prove no behavior.
  const verify = parsed.jobs.verify;
  assert.equal(verify.if, undefined, "backfills must run verify too");
  assert.equal(verify.needs, "resolve-release-sha");
  assert.equal(verify.steps.find((step) => step.uses === "actions/checkout@v4").with.ref,
    "${{ needs.resolve-release-sha.outputs.release-sha }}");
  const publish = parsed.jobs.publish;
  assert.equal(publish.needs, "verify");
  assert.equal(publish.if, "${{ !cancelled() && !failure() && needs.verify.result == 'success' }}");
  assert.equal(publish.steps.find((step) => step.uses === "actions/checkout@v4").with.ref,
    "${{ needs.verify.outputs.release-sha }}");
  const sanity = publish.steps.find((step) => step.name === "Version sanity gate (tag vs package.json)");
  assert.match(sanity.run, /git merge-base --is-ancestor "\$release_sha" origin\/main/);
});
