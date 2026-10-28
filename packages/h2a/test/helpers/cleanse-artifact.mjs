// L0's candidate is prepared, prepacked and installed before product probes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repo = resolve(import.meta.dirname, '../../../..');
const names = ['focus', 'track', 'h2a-runtime', 'h2a', 'h2a-cli'];
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function isolatedEnv(root) {
  const env = {
    PATH: [join(root, 'bin'), join(root, 'prefix/bin'), dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
    HOME: join(root, 'home'), TMPDIR: root, TMP: root, TEMP: root,
    XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'),
    XDG_RUNTIME_DIR: join(root, 'runtime'), REMOTE_CLI_CONFIG_HOME: join(root, 'home'),
    H2A_ROOT: join(root, 'store'), H2A_MCP_CENTRAL: 'off',
    H2A_NATIVE_SOCKET: '',
    ...(process.env.H2A_TEST_QUALIFICATION_ROOT ? { H2A_TEST_QUALIFICATION_ROOT: process.env.H2A_TEST_QUALIFICATION_ROOT } : {}),
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(root, 'no-bus'),
    npm_config_prefix: join(root, 'prefix'), npm_config_cache: join(root, 'npm-cache'),
    npm_config_userconfig: join(root, 'npmrc'), npm_config_globalconfig: join(root, 'global-npmrc'),
    npm_config_update_notifier: 'false',
  };
  for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME',
    'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'H2A_ROOT', 'npm_config_prefix', 'npm_config_cache']) {
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(env.npm_config_userconfig, '');
  writeFileSync(env.npm_config_globalconfig, '');
  return env;
}

export function run(bin, args, cwd, env) {
  const r = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 ** 2 });
  assert.equal(r.error, undefined, `${bin}: ${r.error?.message}`);
  assert.equal(r.status, 0, `${bin} ${args.join(' ')}: ${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

export function candidate(t) {
  assert.ok(process.env.TMPDIR && resolve(process.env.TMPDIR) !== '/tmp', 'Supply a private TMPDIR');
  const root = mkdtempSync(join(tmpdir(), 'c-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  const env = isolatedEnv(root);
  const source = join(root, 'source');
  mkdirSync(source);
  for (const path of ['packages', 'apps/focus', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json']) {
    cpSync(join(repo, path), join(source, path), { recursive: true,
      filter: p => !p.split('/').some(part => ['node_modules', '.git', '.svelte-kit'].includes(part)) });
  }
  // Build tools only. Installed product resolution is verified separately.
  symlinkSync(join(repo, 'node_modules'), join(source, 'node_modules'), 'dir');
  // npm test builds first; targeted execution has the same prerequisite.
  for (const name of names) assert.ok(existsSync(join(source, 'packages', name, 'dist/index.js')), `${name}: build first`);
  const stable = json(join(source, 'packages/h2a/package.json')).version.split('-')[0];
  const version = `${stable}-rc.999`;
  const prepared = run(process.execPath, ['scripts/release-candidate.mjs', 'prepare'], source,
    { ...env, GITHUB_ACTIONS: 'true', GITHUB_REF: `refs/tags/v${version}`, GITHUB_ENV: join(root, 'github-env') });
  assert.equal(json(join(source, 'packages/h2a/package.json')).version, version);
  const tarballs = join(root, 'tarballs');
  mkdirSync(tarballs);
  const artifacts = names.map(name => {
    const output = run('npm', ['pack', '--workspace', `@sentropic/${name}`, '--pack-destination', tarballs, '--json'], source, env);
    const path = join(tarballs, JSON.parse(output)[0].filename);
    return { name, path, sha256: hash(readFileSync(path)) };
  });
  const prefix = env.npm_config_prefix;
  const packages = join(prefix, 'lib/node_modules/@sentropic');
  function install() {
    return run('npm', ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', ...artifacts.map(a => a.path)], root, env);
  }
  function verify() {
    for (const { name, path, sha256 } of artifacts) {
      assert.equal(hash(readFileSync(path)), sha256, 'candidate tarball bytes must not change');
      const installed = realpathSync(join(packages, name));
      assert.ok(installed.startsWith(realpathSync(prefix) + '/'), 'candidate must resolve inside its prefix');
      assert.equal(json(join(installed, 'package.json')).version, json(join(source, 'packages', name, 'package.json')).version);
    }
  }
  return { root, env, source, version, prefix, packages, artifacts, install, verify, prepared,
    cli: join(packages, 'h2a/dist/bin.js'), runtime: join(packages, 'h2a-runtime/dist') };
}
