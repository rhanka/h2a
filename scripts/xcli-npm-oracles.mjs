// Private, pinned npm parser oracles; no other lifecycle scripts may run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { environment, ORACLE_SOURCES } from './xcli-lab.mjs';

export function installNpmOracles(root) {
  const env = environment(join(root, 'env'));
  const location = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' });
  assert.equal(location.status, 0);
  const npm = fs.realpathSync(location.stdout.trim());
  const npmFamilies = Object.entries(ORACLE_SOURCES).filter(([, source]) => source.kind === 'npm');
  const packages = npmFamilies.map(([, source]) => `${source.package}@${source.pin}`);
  const install = spawnSync(process.execPath, [npm, 'install', '--prefix', root, '--ignore-scripts',
    '--no-audit', '--no-fund', ...packages], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(install.status, 0, `private oracle installation must succeed: ${install.stderr}`);
  // npm treats native payloads as optional: it can exit 0 without one.
  // Promote the exact platform payloads declared by the pinned wrappers to
  // direct requirements, so download/extraction failures cannot be ignored.
  assert.equal(process.platform, 'linux');
  const nativePackages = npmFamilies.map(([family, source]) => {
    const manifest = JSON.parse(fs.readFileSync(join(root, 'node_modules', source.package, 'package.json')));
    const musl = family === 'claude' && !process.report.getReport().header.glibcVersionRuntime;
    const name = `${source.package}-linux-${process.arch}${musl ? '-musl' : ''}`;
    const version = manifest.optionalDependencies?.[name];
    assert.equal(version, family === 'codex' ? `npm:${source.package}@${source.pin}-linux-${process.arch}` : source.pin,
      `${family} platform payload must match the pinned wrapper`);
    return `${name}@${version}`;
  });
  const native = spawnSync(process.execPath, [npm, 'install', '--prefix', root, '--ignore-scripts',
    '--no-audit', '--no-fund', ...nativePackages], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(native.status, 0, `mandatory native oracle installation must succeed: ${native.stderr}`);
  // The reviewed Claude 2.1.301 bootstrap only places its already downloaded
  // optional native package under this node_modules tree (no subprocess on Linux).
  // Keep every other npm lifecycle script disabled, including node-gyp/Python.
  const bootstrap = join(root, `node_modules/${ORACLE_SOURCES.claude.package}/install.cjs`);
  assert.equal(createHash('sha256').update(fs.readFileSync(bootstrap)).digest('hex'),
    ORACLE_SOURCES.claude.bootstrapSha256, 'only the reviewed Node bootstrap may execute');
  const prepared = spawnSync(process.execPath, [bootstrap], { cwd: root, env, encoding: 'utf8', maxBuffer: 65536 });
  assert.equal(prepared.status, 0, `private Claude native bootstrap must succeed: ${prepared.stderr}`);
  const bin = join(root, 'node_modules/.bin');
  for (const [family, source] of npmFamilies) {
    const probe = spawnSync(join(bin, source.bin), ['--version'], { env, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
    assert.equal(probe.status, 0, `${family} native executable must exist before config tests: ${probe.error?.message ?? probe.signal ?? probe.stderr}`);
    assert.equal(probe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0], source.pin);
  }
  return { env, bin, npmFamilies };
}
