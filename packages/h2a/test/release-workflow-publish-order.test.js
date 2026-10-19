import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
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
  "@sentropic/focus",
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
  "@sentropic/focus",
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
    ["@sentropic/focus", "sentropic-focus-"],
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

for (const name of ['h2a-runtime', 'h2a']) {
  test(`release executes the closed ${name} tarball publication and preserves backfill and retry guards`, t => {
    const root = mkdtempSync(join(tmpdir(), 'mh-l6-publish-step-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = join(root, 'bin'), balls = join(root, 'dist-tarballs'), tarball = `sentropic-${name}-0.98.7.tgz`;
    // The merged publish body addresses the verify-built tarball by ./-relative
    // spec from the checkout root and re-checks its sha256 before publishing.
    const target = `./dist-tarballs/${tarball}`;
    mkdirSync(bin); mkdirSync(join(root, 'packages', name), { recursive: true }); mkdirSync(balls, { recursive: true });
    writeFileSync(join(balls, tarball), 'private tar sentinel');
    writeFileSync(join(balls, 'sha256sums.txt'), `${createHash('sha256').update('private tar sentinel').digest('hex')}  ${tarball}\n`);
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({ version: '0.98.7' }));
    const marker = join(root, 'published'), log = join(root, 'calls');
    writeFileSync(join(bin, 'npm'), '#!' + process.execPath + '\n' + `
      const fs=require('node:fs'),args=process.argv.slice(2);
      if(args[0]==='view'&&args[2]==='version')process.exit(fs.existsSync(process.env.PROBE_PUBLISHED)?0:1);
      if(args[0]==='view'&&args[2]==='dist-tags.latest'){console.log('0.99.0');process.exit(0);}
      if(args[0]!=='publish'||JSON.stringify(args.slice(1))!==JSON.stringify([process.env.PROBE_TAR,'--access','public','--tag','backfill'])||!fs.existsSync(process.env.PROBE_TAR)){console.error('wrong publication target '+JSON.stringify(args));process.exit(42);}
      fs.appendFileSync(process.env.PROBE_LOG,JSON.stringify(args)+'\\n');
      if(process.env.PROBE_FAIL==='1')process.exit(43);
      fs.writeFileSync(process.env.PROBE_PUBLISHED,'visible');
    `, { mode: 0o755 });
    const step = publishStep('@sentropic/' + name), body = step.slice(step.indexOf('run: |') + 6).split('\n').slice(1).map(line => line.replace(/^          /, '')).join('\n');
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH, RUNNER_TEMP: root, PROBE_PUBLISHED: marker, PROBE_LOG: log, PROBE_TAR: target };
    const run = options => spawnSync('/bin/bash', ['-e', '-c', body], { cwd: root, env: { ...env, ...options }, encoding: 'utf8', timeout: 10000 });
    const published = run(); assert.equal(published.status, 0, published.stderr); assert.match(published.stdout, /backfill/);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
    const repeated = run(); assert.equal(repeated.status, 0, repeated.stderr); assert.match(repeated.stdout, /already on registry; skipping/);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
    rmSync(marker); const failed = run({ PROBE_FAIL: '1' }); assert.equal(failed.status, 1); assert.match(failed.stderr, /npm publish failed/);
    appendFileSync(join(balls, tarball), 'tampered');
    const tampered = run(); assert.equal(tampered.status, 1, tampered.stderr);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2, 'a tampered tarball must fail the sha256 re-check before any further publish call');
    t.diagnostic(`actual release shell for ${name}: verified tarball with sha256 re-check; backfill, retry, failed publish and tamper refusal observed with private npm stub`);
  });
}
