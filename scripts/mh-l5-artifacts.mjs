// Public registry artifacts only. No installed h2a, lifecycle scripts or native host.
import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
process.umask(0o022);
// MH_L5_ARTIFACTS_ROOT overrides the private root (owner rule: never the
// real /tmp); unset keeps the historical /tmp prefix.
const root = process.env.MH_L5_ARTIFACTS_ROOT
  ? fs.mkdtempSync(join(process.env.MH_L5_ARTIFACTS_ROOT, 'mh-l5-artifacts-'))
  : fs.mkdtempSync('/tmp/mh-l5-artifacts-');
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', npm_config_registry: 'https://registry.npmjs.org',
  npm_config_userconfig: join(root, 'npmrc'), npm_config_globalconfig: join(root, 'global-npmrc') };
for (const key of ['HOME', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
  env[key] = join(root, key); fs.mkdirSync(env[key], { mode: 0o700 });
}
fs.writeFileSync(env.npm_config_userconfig, ''); fs.writeFileSync(env.npm_config_globalconfig, '');
const run = (command, args, cwd) => {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  fs.appendFileSync(join(root, 'prepare.log'), `${command} ${args.join(' ')}\n${r.stdout}${r.stderr}\nexit=${r.status}\n`);
  if (r.status !== 0) throw new Error(`artifact_command_failed:${root}`);
};
const profiles = [];
for (const version of ['0.98.5', '0.98.6']) {
  const directory = join(root, version); fs.mkdirSync(directory);
  const lockBytes = fs.readFileSync(new URL(`../docs/plan/mh-l5/v1-lock-${version}.json`, import.meta.url));
  const lock = JSON.parse(lockBytes);
  fs.writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: lock.packages[''].dependencies }));
  fs.writeFileSync(join(directory, 'package-lock.json'), lockBytes);
  const packages = [];
  for (const name of ['h2a', 'h2a-runtime']) {
    const response = await fetch(`https://registry.npmjs.org/@sentropic%2f${name}/${version}`);
    if (!response.ok) throw new Error('published_artifact_missing');
    const metadata = await response.json(), tarball = await fetch(metadata.dist.tarball);
    if (!tarball.ok) throw new Error('published_tarball_missing');
    const bytes = Buffer.from(await tarball.arrayBuffer());
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (integrity !== metadata.dist.integrity) throw new Error('published_integrity_mismatch');
    const path = join(directory, `${name}.tgz`); fs.writeFileSync(path, bytes);
    packages.push({ name: metadata.name, version, tarball: metadata.dist.tarball, integrity,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
  const central = join(directory, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js');
  profiles.push({ version, packages, centralSha256: createHash('sha256').update(fs.readFileSync(central)).digest('hex'),
    lockSha256: createHash('sha256').update(fs.readFileSync(join(directory, 'package-lock.json'))).digest('hex') });
}
// Exact public Node 24 runtime; its official SHASUMS verifies the archive.
const nodeVersion = '24.21.0', name = `node-v${nodeVersion}-linux-${process.arch === 'x64' ? 'x64' : 'arm64'}`;
const base = `https://nodejs.org/dist/v${nodeVersion}/`, sums = await (await fetch(base + 'SHASUMS256.txt')).text();
const expected = sums.split('\n').find(line => line.endsWith(`  ${name}.tar.xz`))?.split(' ')[0];
if (!expected) throw new Error('node_profile_missing');
const archive = Buffer.from(await (await fetch(base + name + '.tar.xz')).arrayBuffer());
if (createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('node_integrity_mismatch');
fs.writeFileSync(join(root, 'node24.tar.xz'), archive);
run('tar', ['-xJf', join(root, 'node24.tar.xz'), '-C', root], root);
const receipt = { root, profiles, node24: join(root, name, 'bin/node'), nodeArchiveSha256: expected };
fs.writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
