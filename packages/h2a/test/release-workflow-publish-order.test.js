import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("release workflow supports a backfill dispatch for an existing tag", () => {
  assert.match(workflow, /workflow_dispatch:/, "release must be dispatchable for backfills");
  assert.match(workflow, /backfill-version:/, "dispatch must take the tag version to backfill");
  // Verify only gates real tag pushes; a backfill dispatch proceeds on the skipped verify.
  assert.match(workflow, /if: github\.event_name == 'push'/, "verify must be gated to tag pushes");
  assert.match(workflow, /needs\.verify\.result == 'skipped'/, "publish must proceed when verify is skipped (dispatch)");
  // The dispatch checks out the requested tag and revalidates it is on main.
  assert.match(workflow, /format\('v\{0\}', inputs\.backfill-version\)/, "dispatch checkout must target the requested tag");
  assert.match(workflow, /Refusing publish: \$\{?tag\}? is not on origin\/main|Refusing publish: \$tag is not on origin\/main/, "dispatch must refuse tags not on main");
});
