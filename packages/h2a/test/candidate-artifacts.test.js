import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import YAML from 'yaml';

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

test('candidate tarballs include both verified payloads and the exact five-package release cohort', { timeout: 240_000 }, async () => {
  const lab = fs.mkdtempSync(join(tmpdir(), 'candidate-artifacts-'));
  const output = join(lab, 'tarballs');
  try {
    const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
    for (const name of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'TMPDIR']) {
      env[name] = join(lab, name); fs.mkdirSync(env[name], { mode: 0o700 });
    }
    const result = await exec(process.execPath, ['scripts/pack-candidate.mjs', output], {
      cwd: repo, env, timeout: 230_000, maxBuffer: 8 * 1024 * 1024,
    });
    const version = JSON.parse(fs.readFileSync(join(repo, 'packages/h2a/package.json'))).version;
    const focusVersion = JSON.parse(fs.readFileSync(join(repo, 'packages/focus/package.json'))).version;
    assert.deepEqual(fs.readdirSync(output).sort(), [...['h2a', 'h2a-cli', 'h2a-runtime', 'track']
      .map(name => `sentropic-${name}-${version}.tgz`), `sentropic-focus-${focusVersion}.tgz`].sort());
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
    assert.equal(result.stderr, '');
  } finally { fs.rmSync(lab, { recursive: true, force: true }); }
});
