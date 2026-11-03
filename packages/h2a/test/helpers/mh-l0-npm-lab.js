import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);

export async function npmLab() {
  const root = mkdtempSync(join(tmpdir(), 'mh-l0-npm-'));
  const prefix = join(root, 'prefix'); const cache = join(root, 'cache');
  for (const p of ['prefix', 'cache', 'home', 'runtime', 'config', 'state']) mkdirSync(join(root, p), { mode: 0o700 });
  const config = join(root, 'npmrc'); writeFileSync(config, '');
  const globalConfig = join(root, 'global-npmrc'); writeFileSync(globalConfig, '');
  const env = { PATH: process.env.PATH, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'runtime'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'),
    npm_config_userconfig: config, npm_config_globalconfig: globalConfig, npm_config_cache: cache,
    npm_config_prefix: prefix, npm_config_ignore_scripts: 'true', npm_config_audit: 'false',
    npm_config_fund: 'false', npm_config_update_notifier: 'false' };
  const results = [];
  const npm = async (...args) => {
    try { const r = await exec('npm', args, { cwd: root, env, timeout: 30000 });
      const result = { args, code: 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() }; results.push(result); return result;
    } catch (e) { const result = { args, code: e.code, stdout: e.stdout?.trim(), stderr: e.stderr?.trim() };
      results.push(result); return result; }
  };
  const tarballs = {};
  let server;
  try {
    for (const version of ['0.98.6', '0.98.7', '0.98.8']) {
      const packageDir = join(root, `source-${version}`); mkdirSync(packageDir);
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@sentropic/h2a', version,
        bin: { h2a: 'bin.cjs' }, files: ['bin.cjs'] }));
      writeFileSync(join(packageDir, 'bin.cjs'), `#!/usr/bin/env node\nconsole.log('fixture-${version}');\n`);
      const pack = await npm('pack', packageDir, '--json', '--offline');
      if (pack.code !== 0) throw new Error(JSON.stringify(pack));
      tarballs[version] = join(root, JSON.parse(pack.stdout)[0].filename);
    }
    server = createServer((req, res) => {
      const version = /h2a-(0\.98\.[678])\.tgz$/.exec(req.url)?.[1];
      if (version) { res.writeHead(200); res.end(readFileSync(tarballs[version])); return; }
      const base = `http://127.0.0.1:${server.address().port}`;
      const versions = Object.fromEntries(Object.entries(tarballs).map(([v, p]) => [v, {
        name: '@sentropic/h2a', version: v, bin: { h2a: 'bin.cjs' }, dist: { tarball: `${base}/h2a-${v}.tgz`,
          integrity: `sha512-${createHash('sha512').update(readFileSync(p)).digest('base64')}` } }]));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: '@sentropic/h2a', 'dist-tags': { latest: '0.98.8' }, versions }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const managed = join(prefix, 'h2a-managed', String(process.getuid())); mkdirSync(managed, { recursive: true });
    const launcher = join(managed, 'launcher.mjs'); writeFileSync(launcher, "console.log('fixture-managed');");
    const pin = join(managed, 'pinned-image'); writeFileSync(pin, 'immutable-image-fixture');
    const link = join(prefix, 'bin', 'h2a');
    const adopt = () => { try { unlinkSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; } symlinkSync(launcher, link); };
    return { root, prefix, launcher, link, pin, npm, tarballs, results, adopt,
      registry: `http://127.0.0.1:${server.address().port}`,
      async close() { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); } };
  } catch (e) { if (server?.listening) await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true }); throw e; }
}
