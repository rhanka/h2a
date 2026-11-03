import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import YAML from 'yaml';
import { expectedCandidateTarballs, sharedPackCandidates } from './helpers/shared-pack-candidates.mjs';

const exec = promisify(execFile);
const repo = new URL('../../../', import.meta.url).pathname;

test('verify, rehearsal and cross-platform smoke consume the same closed candidate producer', () => {
  for (const workflow of ['release', 'publish-rehearsal', 'smoke']) {
    const parsed = YAML.parse(fs.readFileSync(join(repo, '.github/workflows', workflow + '.yml'), 'utf8'));
    const producers = Object.values(parsed.jobs).flatMap(job => job.steps ?? [])
      .filter(step => String(step.run).includes('node scripts/pack-candidate.mjs'));
    assert.equal(producers.length, 1, workflow + ' must build the closed candidate exactly once');
    assert.equal(producers[0]['continue-on-error'], undefined);
    assert.ok(!String(producers[0].run).includes('--ignore-scripts'));
    if (workflow === 'smoke') {
      assert.equal(parsed.jobs['build-candidate']['runs-on'], 'ubuntu-latest');
      assert.equal(parsed.jobs['smoke-install'].needs, 'build-candidate');
      assert.ok(parsed.jobs['smoke-install'].steps.some(step => step.uses === 'actions/download-artifact@v4'));
    }
  }
});

test('candidate tarballs include both verified payloads and the exact five-package release cohort', { timeout: 590_000 }, async () => {
  // Candidates shared with the other packed-tree suites (see
  // helpers/shared-pack-candidates.mjs): one pack per tree state. The
  // producer still runs warning-free; the helper asserts that centrally.
  // A private pack remains the fallback when sharing is unavailable.
  const lab = fs.mkdtempSync(join(tmpdir(), 'candidate-artifacts-'));
  try {
    let output = await sharedPackCandidates();
    if (output === null) {
      output = join(lab, 'tarballs');
      const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
      for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
        env[name] = join(lab, name); fs.mkdirSync(env[name], { mode: 0o700 });
      }
      const result = await exec(process.execPath, ['scripts/pack-candidate.mjs', output], {
        cwd: repo, env, timeout: 580_000, maxBuffer: 8 * 1024 * 1024,
      });
      assert.equal(result.stderr, '');
    }
    const version = JSON.parse(fs.readFileSync(join(repo, 'packages/h2a/package.json'))).version;
    const focusVersion = JSON.parse(fs.readFileSync(join(repo, 'packages/focus/package.json'))).version;
    const cohort = [...['h2a', 'h2a-cli', 'h2a-runtime', 'track']
      .map(name => `sentropic-${name}-${version}.tgz`), `sentropic-focus-${focusVersion}.tgz`].sort();
    // The shared directory also carries the cache manifest and lock; the
    // tarball cohort itself must match exactly either way.
    assert.deepEqual(fs.readdirSync(output).filter((name) => name.endsWith('.tgz')).sort(), cohort);
    assert.deepEqual(fs.readdirSync(output).filter((name) => name.endsWith('.tgz')).sort(),
      expectedCandidateTarballs());
    if (output === join(lab, 'tarballs')) assert.deepEqual(fs.readdirSync(output).sort(), cohort);
    for (const name of ['h2a', 'h2a-runtime']) {
      const tarball = join(output, `sentropic-${name}-${version}.tgz`);
      const manifest = JSON.parse((await exec('tar', ['-xOf', tarball, 'package/manifest.json'], { maxBuffer: 32 * 1024 * 1024 })).stdout);
      assert.equal(manifest.kind, 'h2a-published-payload');
      assert.deepEqual(Object.keys(manifest.manifests), ['22', '24']);
      for (const profile of Object.values(manifest.manifests)) {
        assert.equal(profile.packageVersion, version);
        assert.ok(profile.files.length > 100);
      }
    }
  } finally { fs.rmSync(lab, { recursive: true, force: true }); }
});
