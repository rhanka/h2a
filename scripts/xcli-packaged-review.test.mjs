import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, repo } from './xcli-lab.mjs';

test('L2 review: the upgrade candidate installs its exact local Focus artifact without registry fallback', () => {
  const root = fs.mkdtempSync('/tmp/xcli-packaged-');
  try {
    const recipe = fs.readFileSync(join(repo, 'packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts'), 'utf8');
    const dependencies = JSON.parse(recipe.match(/for \(const dependency of (\[[^\]]+\])\)/)[1]);
    const env = { ...environment(join(root, 'env')), npm_config_cache: join(root, 'npm-cache') };
    const tarballs = [];
    for (const pkg of ['h2a-runtime', ...dependencies]) {
      const out = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: join(repo, 'packages', pkg), env, encoding: 'utf8', timeout: 30000 });
      assert.equal(out.status, 0, out.stderr);
      tarballs.push(join(root, JSON.parse(out.stdout)[0].filename));
    }
    // Candidate siblings must be local, including unpublished Focus. Only
    // third-party dependencies may resolve through the public registry.
    const install = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--prefix', join(root, 'prefix'), ...tarballs], {
      env: { ...env, npm_config_registry: 'https://registry.npmjs.org' }, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    });
    assert.equal(install.status, 0, install.stderr);
    const actual = JSON.parse(fs.readFileSync(join(root, 'prefix/node_modules/@sentropic/focus/package.json'))).version;
    const expected = JSON.parse(fs.readFileSync(join(repo, 'packages/focus/package.json'))).version;
    assert.equal(actual, expected);
    assert.ok(tarballs.some(file => file.endsWith(`sentropic-focus-${expected}.tgz`)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
