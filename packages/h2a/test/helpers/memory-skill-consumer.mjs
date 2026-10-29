import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceHash = 'dd4f17695844a65ae10fa7c9b023578f0c9f8688b446e5ba790fbb39f3abfbaf';

// A producer-shaped fixture, never a vendored copy of the producer's skill.
export function memorySkillConsumer(t, { packed = false, raw } = {}) {
  const lane = fs.mkdtempSync(join(tmpdir(), 'memory-skill-consumer-'));
  t.after(() => fs.rmSync(lane, { recursive: true, force: true }));
  const modules = join(lane, 'node_modules'), scoped = join(modules, '@sentropic');
  fs.mkdirSync(scoped, { recursive: true });
  const home = join(lane, 'home'), runtime = join(lane, 'runtime');
  fs.mkdirSync(home); fs.mkdirSync(runtime); fs.mkdirSync(join(lane, 'empty-bin'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(H2A_|CLAUDE_|CODEX_|VIBE_|XDG_)/.test(key)) delete env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.state'),
    XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
    PATH: join(lane, 'empty-bin'), TMPDIR: tmpdir(),
    npm_config_cache: join(lane, 'npm-cache'), npm_config_userconfig: join(lane, 'npmrc'), npm_config_update_notifier: 'false' });
  const npm = packed && (process.env.HOST_TEST_NPM_CLI || (process.env.PATH ?? '').split(delimiter).map(p => join(p, 'npm')).find(p => fs.existsSync(p)));
  for (const pkg of ['h2a', 'track']) {
    const dest = join(scoped, pkg);
    if (packed) {
      assert.ok(npm, 'npm CLI required; package acceptance must never skip');
      const pack = spawnSync(process.execPath, [fs.realpathSync(npm), 'pack', '--ignore-scripts', '--json', '--pack-destination', lane], {
        cwd: join(repo, 'packages', pkg), env, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(pack.status, 0, pack.stderr);
      const tarball = JSON.parse(pack.stdout)[0];
      fs.mkdirSync(dest);
      const unpack = spawnSync('/usr/bin/tar', ['-xf', '-', '--strip-components=1', '-C', dest], {
        input: gunzipSync(fs.readFileSync(join(lane, tarball.filename))), encoding: 'utf8' });
      assert.equal(unpack.status, 0, unpack.stderr);
    } else if (pkg === 'track') fs.symlinkSync(join(repo, 'packages/track'), dest);
    else {
      fs.mkdirSync(dest);
      for (const name of ['package.json', 'dist', 'skills', 'hooks', 'fixtures', 'scripts', 'schema', '.claude-plugin', '.codex-plugin', '.mcp.json'])
        fs.cpSync(join(repo, 'packages/h2a', name), join(dest, name), { recursive: true });
    }
  }
  for (const name of fs.readdirSync(join(repo, 'node_modules'))) if (name !== '@sentropic')
    fs.symlinkSync(join(repo, 'node_modules', name), join(modules, name));
  for (const name of fs.readdirSync(join(repo, 'node_modules/@sentropic'))) if (!['h2a', 'track', 'engram'].includes(name))
    fs.symlinkSync(join(repo, 'node_modules/@sentropic', name), join(scoped, name));
  const producer = join(scoped, 'engram');
  fs.mkdirSync(join(producer, 'dist/nested'), { recursive: true });
  fs.writeFileSync(join(producer, 'package.json'), JSON.stringify({ name: '@sentropic/engram', version: '0.22.1', type: 'module', exports: { '.': { import: './dist/nested/index.js' } } }));
  // Resolving a skill must never execute the memory provider.
  fs.writeFileSync(join(producer, 'dist/nested/index.js'), 'throw new Error("producer must not be imported");');
  if (raw === undefined && process.env.H2A_MEMORY_SKILL_FIXTURE) {
    raw = fs.readFileSync(process.env.H2A_MEMORY_SKILL_FIXTURE, 'utf8');
    assert.equal(sha256(raw), referenceHash, 'validated external fixture digest');
  }
  raw ??= '---\nname: engram-memory\ndescription: Recall cited durable knowledge through memory MCP.\n---\nDiscover engram_memory_search before use. Read `assets/guide.md`.\n';
  const skill = join(producer, 'skills/engram-memory');
  fs.mkdirSync(join(skill, 'assets'), { recursive: true });
  fs.writeFileSync(join(skill, 'SKILL.md'), raw);
  fs.writeFileSync(join(skill, 'assets/guide.md'), 'Producer resource fixture.\n');
  // Only the memory skill belongs to this handoff, not the graph skill.
  fs.mkdirSync(join(producer, 'skills/engram'));
  fs.writeFileSync(join(producer, 'skills/engram/SKILL.md'), '---\nname: engram\ndescription: Graph fixture\n---\nGraph only.\n');
  const cli = (args, overrides = {}) => {
    const result = spawnSync(process.execPath, [join(scoped, 'h2a/dist/bin.js'), ...args], {
      cwd: lane, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(result.error);
    return { ...result, json: () => JSON.parse(result.stdout) };
  };
  return { lane, home, producer, skill, raw, cli, h2a: join(scoped, 'h2a') };
}
