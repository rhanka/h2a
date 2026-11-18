import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, repo, sourceBuild } from './xcli-lab.mjs';

test('L2 review: the upgrade candidate installs its exact local Focus artifact without registry fallback', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-packaged-'));
  try {
    // Resolve the selected toolchain before replacing PATH/HOME.
    const npmLocation = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' });
    assert.equal(npmLocation.status, 0, 'npm build toolchain must be available');
    const npmCli = fs.realpathSync(npmLocation.stdout.trim());
    const built = sourceBuild(root);
    const recipe = fs.readFileSync(join(repo, 'packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts'), 'utf8');
    const dependencies = JSON.parse(recipe.match(/for \(const dependency of (\[[^\]]+\])\)/)[1]);
    // setup-node's npm lives outside the isolated PATH on hosted runners.
    // Keep only the private Node shim so this also reproduces that locally.
    const env = { ...environment(join(root, 'env')), PATH: join(root, 'env/bin'), npm_config_cache: join(root, 'npm-cache') };
    const tarballs = [];
    for (const pkg of ['h2a-runtime', ...dependencies]) {
      const out = spawnSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: join(built.path, 'packages', pkg), env, encoding: 'utf8', timeout: 30000 });
      assert.equal(out.status, 0, `${pkg}: ${out.error?.code ?? out.signal ?? out.stderr}`);
      tarballs.push(join(root, JSON.parse(out.stdout)[0].filename));
    }
    // Candidate siblings must be local, including unpublished Focus. Only
    // third-party dependencies may resolve through the public registry.
    const install = spawnSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--prefix', join(root, 'prefix'), ...tarballs], {
      env: { ...env, npm_config_registry: 'https://registry.npmjs.org' }, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    });
    assert.equal(install.status, 0, `${install.error?.code ?? install.signal ?? install.stderr}`);
    const actual = JSON.parse(fs.readFileSync(join(root, 'prefix/node_modules/@sentropic/focus/package.json'))).version;
    const expected = JSON.parse(fs.readFileSync(join(repo, 'packages/focus/package.json'))).version;
    assert.equal(actual, expected);
    assert.ok(tarballs.some(file => file.endsWith(`sentropic-focus-${expected}.tgz`)));
    for (const file of ['dist/index.js', 'registry/entries.v1.json', 'schemas/focus-editing-manifest.v1.schema.json']) {
      assert.ok(fs.existsSync(join(root, 'prefix/node_modules/@sentropic/focus', file)), `Focus artifact is missing ${file}`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
