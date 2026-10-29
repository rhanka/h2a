import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { memorySkillConsumer, sha256 } from './helpers/memory-skill-consumer.mjs';

test('packed h2a installs the producer memory skill in isolated HOME without source-tree fallback', t => {
  const fixture = memorySkillConsumer(t, { packed: true });
  assert.equal(fs.existsSync(join(fixture.h2a, 'skills/engram-memory')), false);
  for (const host of ['claude', 'codex', 'muse', 'vibe', 'agy']) for (const scope of ['user', 'project']) {
    const args = ['install-skills', '--host', host, '--scope', scope];
    const root = scope === 'project' ? join(fixture.lane, `.${host === 'agy' ? 'gemini' : host}`)
      : join(fixture.home, host === 'agy' ? '.gemini' : host === 'muse' ? '.config/muse' : `.${host}`);
    const target = join(root, host === 'agy' ? 'commands/engram-memory.toml' : 'skills/engram-memory/SKILL.md');
    const receipt = host === 'agy'
      ? join(root, scope === 'project' ? 'skill-resources' : '.h2a-install/skill-resources', 'engram/0.22.1/engram-memory/.h2a-source.json')
      : join(target, '../.h2a-source.json');
    const custom = host === 'agy' ? 'description = "Personal memory"\nprompt = "Personal instructions"\n' : 'Personal memory instructions.\n';
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.writeFileSync(target, custom);
    const refused = fixture.cli(args);
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(fs.readFileSync(target, 'utf8'), custom);
    assert.equal(fs.existsSync(receipt), false, `${host}/${scope}: packed refusal must not create a receipt`);
    fs.rmSync(target);
    const first = fixture.cli(args);
    assert.equal(first.status, 0, first.stderr);
    const source = first.json().sources.find(s => s.source === 'engram');
    assert.equal(source?.dir, join(fixture.producer, 'skills'));
    assert.equal(source.skills[0].sha256, sha256(fixture.raw));
    const record = JSON.parse(fs.readFileSync(receipt));
    assert.equal(record.sha256, sha256(fixture.raw));
    assert.equal(record.renderedSha256, sha256(fs.readFileSync(target)));
    const second = fixture.cli(args);
    assert.equal(second.status, 0, `${host}/${scope}: packed reinstall`);
    assert.deepEqual(second.json().installed, []);
  }
});
test('tarball consumer receives hooks/scripts/parser and referenced Track resources without source-tree fallback', t => {
  const lane = fs.mkdtempSync(join(tmpdir(), 'host-package-consumer-'));
  t.after(() => fs.rmSync(lane, { recursive: true, force: true }));
  const npm = process.env.HOST_TEST_NPM_CLI || (process.env.PATH ?? '').split(delimiter).map(p => join(p, 'npm')).find(p => fs.existsSync(p));
  assert.ok(npm, 'npm CLI required, never skip package validation');
  const packEnv = { ...process.env, HOME: join(lane, 'pack-home'), npm_config_cache: join(lane, 'npm-cache'), npm_config_userconfig: join(lane, 'npmrc'), npm_config_update_notifier: 'false' };
  fs.mkdirSync(packEnv.HOME);
  const modules = join(lane, 'node_modules'), scoped = join(modules, '@sentropic'); fs.mkdirSync(scoped, { recursive: true });
  for (const pkg of ['h2a', 'track']) {
    const packed = spawnSync(process.execPath, [fs.realpathSync(npm), 'pack', '--ignore-scripts', '--json', '--pack-destination', lane], {
      cwd: resolve('packages', pkg), encoding: 'utf8', env: packEnv, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(packed.status, 0, packed.stderr);
    const pack = JSON.parse(packed.stdout)[0], dest = join(scoped, pkg); fs.mkdirSync(dest);
    const result = spawnSync('/usr/bin/tar', ['-xf', '-', '--strip-components=1', '-C', dest], { encoding: 'utf8', input: gunzipSync(fs.readFileSync(join(lane, pack.filename))) });
    assert.equal(result.status, 0, result.stderr);
  }
  // External pinned dependencies are read-only links; both tested packages
  // themselves resolve exclusively from fresh tarball extractions.
  for (const name of fs.readdirSync(resolve('node_modules'))) if (name !== '@sentropic') fs.symlinkSync(resolve('node_modules', name), join(modules, name));
  for (const name of fs.readdirSync(resolve('node_modules/@sentropic'))) if (!['h2a', 'track'].includes(name)) fs.symlinkSync(resolve('node_modules/@sentropic', name), join(scoped, name));
  const h2a = join(scoped, 'h2a');
  for (const file of ['hooks/vibe-pre-tool.mjs', 'hooks/vibe-post-agent.mjs', 'scripts/qualify-host.mjs', 'fixtures/native-host-catalog.json']) assert.ok(fs.existsSync(join(h2a, file)), file);
  assert.equal(JSON.parse(fs.readFileSync(join(h2a, 'package.json'))).dependencies['toml-eslint-parser'], '0.10.1');
  const home = join(lane, 'home'); fs.mkdirSync(home);
  const r = spawnSync(process.execPath, [join(h2a, 'dist/bin.js'), 'install-skills', '--host', 'vibe'], {
    cwd: lane, env: { ...process.env, HOME: home, VIBE_HOME: join(home, '.vibe') }, encoding: 'utf8', timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(join(home, '.vibe/skills/branch-lifecycle/assets/check.sh')));
  assert.ok(fs.existsSync(join(home, '.vibe/skills/present-decision/assets/dossier-template.md')));
  const script = spawnSync(process.execPath, [join(h2a, 'scripts/qualify-host.mjs'), '--host', 'vibe'], { cwd: lane, env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(script.status, 0, script.stderr);
});
