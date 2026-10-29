import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import test from 'node:test';
import { runCli } from '../dist/index.js';
import { parseNativeToml } from '../dist/hosts/native-toml.js';
import { captureHostOperatorNotices } from '../dist/hosts/operator-notices.js';
import { memorySkillConsumer, sha256 } from './helpers/memory-skill-consumer.mjs';

test('memory producer resources use the producer version and remain valid in the shared agy command', t => {
  const fixture = memorySkillConsumer(t, { raw: '---\nname: engram-memory\ndescription: Memory fixture\n---\nUse engram_memory_search and read `assets/guide.md`.\n' });
  const first = fixture.cli(['install-skills', '--host', 'agy']);
  assert.equal(first.status, 0, first.stderr);
  const command = join(fixture.home, '.gemini/commands/engram-memory.toml');
  const resource = join(fixture.home, '.gemini/.h2a-install/skill-resources/engram/0.22.1/engram-memory/assets/guide.md');
  assert.match(parseNativeToml(fs.readFileSync(command, 'utf8')).prompt, new RegExp(resource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.readFileSync(resource, 'utf8'), 'Producer resource fixture.\n');
  const owner = JSON.parse(fs.readFileSync(join(fixture.home, '.gemini/.h2a-install-agy/shared-owner.json')));
  assert.equal(owner.files['commands/engram-memory.toml'].source, '@sentropic/engram@0.22.1/engram-memory');
  assert.equal(owner.files['commands/engram-memory.toml'].sha256, sha256(fs.readFileSync(command)));
  assert.match(first.json().importHint, /agy plugin import gemini/);
  assert.equal(fixture.cli(['install-skills', '--host', 'gemini']).status, 0);
  assert.ok(fs.readdirSync(join(fixture.home, '.gemini/commands')).every(n => n.endsWith('.toml')));
  fs.rmSync(join(fixture.skill, 'assets/guide.md'));
  const missing = fixture.cli(['install-skills', '--host', 'agy']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /required skill resource missing: engram-memory\/assets\/guide.md/);
});
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
function setup(t) {
  const home = fs.mkdtempSync(join(tmpdir(), 'shared-host-')), previous = { ...process.env };
  process.env.HOME = home; process.env.VIBE_HOME = ''; process.env.PATH = join(home, 'empty-bin');
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); fs.rmSync(home, { recursive: true, force: true }); });
  const cli = args => { let out = '', err = ''; const code = runCli(args, { cwd: () => home, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } }); return { code, out, err, json: () => JSON.parse(out) }; };
  return { home, cli };
}
test('agy and Gemini share one command owner and resources outside command discovery', t => {
  const { home, cli } = setup(t);
  fs.mkdirSync(join(home, '.gemini'));
  const absent = cli(['host', 'status', '--host', 'agy']);
  assert.equal(absent.json().hosts[0].native.installation, 'absent');
  const first = cli(['install-skills', '--host', 'agy']);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.json().sharedGeminiEffect, true);
  const owner = join(home, '.gemini/.h2a-install-agy/shared-owner.json');
  const bytes = fs.readFileSync(owner), mtime = fs.statSync(owner).mtimeMs;
  assert.equal(cli(['install-skills', '--host', 'gemini']).code, 0);
  assert.deepEqual(fs.readFileSync(owner), bytes); assert.equal(fs.statSync(owner).mtimeMs, mtime);
  const commands = fs.readdirSync(join(home, '.gemini/commands'));
  assert.ok(commands.every(n => n.endsWith('.toml')));
  const prompt = fs.readFileSync(join(home, '.gemini/commands/present-decision.toml'), 'utf8');
  assert.ok(prompt.includes(`.h2a-install/skill-resources/track/${PACKAGE_VERSION}/present-decision/assets/`));
  const body = parseNativeToml(prompt).prompt;
  for (const asset of ['owner-criteria.template.md', 'dossier-template.md', 'self-audit.md']) {
    const path = join(home, `.gemini/.h2a-install/skill-resources/track/${PACKAGE_VERSION}/present-decision/assets`, asset);
    assert.equal(body.split(path).length - 1, 1, `${asset}: one expanded reference per prompt`);
    assert.ok(fs.existsSync(path), `referenced resource exists: ${asset}`);
  }
  const custom = join(home, '.gemini/commands/h2a.toml'); fs.writeFileSync(custom, 'personal = true\n');
  assert.notEqual(cli(['install-skills', '--host', 'gemini']).code, 0);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'personal = true\n');
  assert.equal(cli(['install-skills', '--host', 'gemini', '--force']).code, 0);
  assert.notEqual(fs.readFileSync(custom, 'utf8'), 'personal = true\n');
});
test('shared command notices inspect the actual Gemini artifacts and quoted roots produce valid TOML', t => {
  const { home, cli } = setup(t);
  const quoted = join(home,"three'''quotes");fs.mkdirSync(quoted);process.env.HOME=quoted;
  const bin=join(home,'bin');fs.mkdirSync(bin);fs.writeFileSync(join(bin,'agy'),'fixture',{mode:0o700});process.env.PATH=bin;
  assert.equal(cli(['install-skills','--host','agy']).code,0);
  const command=join(quoted,'.gemini/commands/present-decision.toml');
  const parsed=parseNativeToml(fs.readFileSync(command,'utf8'));assert.match(parsed.prompt,/three'''quotes/);
  assert.deepEqual(captureHostOperatorNotices(),[]);
  fs.writeFileSync(command,'custom=true\n');
  assert.ok(captureHostOperatorNotices().length>0);
});
test('Muse receives referenced resources; Vibe disabled skills stay disabled', t => {
  const { home, cli } = setup(t);
  assert.equal(cli(['install-skills', '--host', 'muse']).code, 0);
  assert.ok(fs.existsSync(join(home, '.config/muse/skills/branch-lifecycle/assets/check.sh')));
  const vibe = join(home, '.vibe'); fs.mkdirSync(vibe);
  fs.writeFileSync(join(vibe, 'config.toml'), 'mcp_servers=[]\ndisabled_skills=["h2a"]\n');
  assert.equal(cli(['install-skills', '--host', 'vibe']).code, 0);
  assert.equal(fs.existsSync(join(vibe, 'skills/h2a/SKILL.md')), false);
  assert.ok(fs.existsSync(join(vibe, 'skills/track-operation/SKILL.md')));
});
