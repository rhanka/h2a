import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { runCli } from '../dist/index.js';
import { convergeArtifacts } from '../dist/hosts/native-artifacts.js';
import { convergeNativeHost } from '../dist/hosts/native-convergence.js';
import { digest, readNativeManifest } from '../dist/hosts/native-files.js';
import { planVibeEquipment } from '../dist/hosts/vibe-equipment.js';
import { createHash } from 'node:crypto';
function lane(t) {
  const home = fs.mkdtempSync(join(tmpdir(), 'review-native-')), previous = { ...process.env };
  Object.assign(process.env, { HOME: home, VIBE_HOME: '', MUSE_HOME: '', GEMINI_CLI_HOME: '' });
  const cwd = join(home, 'project'); fs.mkdirSync(cwd);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); fs.rmSync(home, { recursive: true, force: true }); });
  const cli = args => { let out = '', err = ''; const code = runCli(args, { cwd: () => cwd, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } }); return { code, out, err, json: () => JSON.parse(out) }; };
  const bus = join(home, 'bus'); assert.equal(cli(['init', '--root', bus]).code, 0);
  const doctor = flags => cli(['doctor', '--host', 'vibe', '--root', bus, '--repair', ...flags]);
  return { home, cwd, cli, doctor };
}
for (const host of ['vibe', 'muse', 'agy', 'gemini']) {
  test(`${host} project installation writes only project skills, without user equipment state`, t => {
    const { home, cwd, cli } = lane(t);
    const result = cli(['install-skills', '--host', host, '--scope', 'project']); assert.equal(result.code, 0, result.err);
    const base = join(cwd, host === 'agy' ? '.gemini' : '.' + host);
    assert.equal(fs.existsSync(join(base, '.h2a-install')), false);
    assert.equal(fs.existsSync(join(base, '.h2a-install-agy')), false);
    assert.equal(fs.existsSync(join(home, '.vibe')), false);
    assert.ok(result.json().installed.length > 0);
    const shared = host === 'agy' || host === 'gemini';
    assert.ok(fs.existsSync(shared ? join(base, 'skill-resources/track/0.98.6/branch-lifecycle/assets/check.sh') : join(base, 'skills/branch-lifecycle/assets/check.sh')));
    if (shared) assert.match(fs.readFileSync(join(base, 'commands/present-decision.toml'), 'utf8'), /skill-resources\/track\/0\.98\.6\/present-decision\/assets\//);
  });
  test(`${host} force restores a modified managed user skill but preserves unknown files`, t => {
    const { home, cli } = lane(t), args = ['install-skills', '--host', host];
    assert.equal(cli(args).code, 0);
    const root = join(home, host === 'muse' ? '.config/muse' : host === 'agy' ? '.gemini' : '.' + host);
    const skill = join(root, host === 'gemini' || host === 'agy' ? 'commands/h2a.toml' : 'skills/h2a/SKILL.md');
    const original = fs.readFileSync(skill); fs.writeFileSync(skill, 'locally modified');
    assert.equal(cli(args).code, 2); assert.equal(fs.readFileSync(skill, 'utf8'), 'locally modified');
    assert.equal(cli([...args, '--force']).code, 0);
    assert.deepEqual(fs.readFileSync(skill), original);
    fs.unlinkSync(skill);
    const state = join(root, host === 'gemini' || host === 'agy' ? '.h2a-install-agy/shared-owner.json' : '.h2a-install/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(state));
    delete manifest.files[host === 'gemini' || host === 'agy' ? 'commands/h2a.toml' : 'skills/h2a/SKILL.md'];
    fs.writeFileSync(state, JSON.stringify(manifest)); fs.writeFileSync(skill, 'unknown personal file');
    assert.equal(cli([...args, '--force']).code, 2);
    assert.equal(fs.readFileSync(skill, 'utf8'), 'unknown personal file');
  });
}
test('explicit Vibe skills installation also ships its hook scripts', t => {
  const { home, cli } = lane(t); assert.equal(cli(['install-skills', '--host', 'vibe']).code, 0);
  for (const name of ['vibe-pre-tool.mjs', 'vibe-post-agent.mjs']) assert.ok(fs.existsSync(join(home, '.vibe/.h2a-install/hooks', name)));
});
test('obsolete managed artifacts are removed only at their known hash, with backup and dry-run preservation', t => {
  const { home } = lane(t), root = join(home, 'root'), state = join(root, '.h2a-install');
  const artifact = name => ({ path: join(root, 'skills', name), bytes: 'known', source: 'h2a@old/skill' });
  const options = { root, state, host: 'vibe', version: 'old', repair: true };
  convergeArtifacts({ ...options, artifacts: [artifact('old'), artifact('custom'), { ...artifact('optout'), selected: false }] });
  fs.writeFileSync(artifact('custom').path, 'personal');
  const dry = convergeArtifacts({ ...options, version: 'new', artifacts: [], dryRun: true });
  assert.ok(dry.changes.planned.includes(artifact('old').path)); assert.ok(fs.existsSync(artifact('old').path));
  const result = convergeArtifacts({ ...options, version: 'new', artifacts: [] });
  assert.equal(fs.existsSync(artifact('old').path), false);
  assert.equal(fs.readFileSync(artifact('custom').path, 'utf8'), 'personal');
  assert.ok(result.changes.conflicts.includes(artifact('custom').path));
  assert.ok(fs.readdirSync(join(state, 'backups')).some(name => fs.readFileSync(join(state, 'backups', name), 'utf8') === 'known'));
});
test('an incomplete source inventory reports failure without retiring previously installed skills', t => {
  const { home } = lane(t), root = join(home, '.config/muse'), resourceDir = join(home, 'source'); fs.mkdirSync(resourceDir);
  const skill = { installName: 'keep', raw: 'installed skill', source: 'h2a', resourceDir, parsed: { name: 'keep', description: 'keep', body: 'installed skill' } };
  const options = { host: 'muse', root, explicitInstall: true, repair: true, renderGemini: () => '' };
  assert.equal(convergeNativeHost({ ...options, version: '1', skills: [skill], sourcesComplete: true }).ok, true);
  const result = convergeNativeHost({ ...options, version: '2', skills: [], sourcesComplete: false });
  assert.equal(result.ok, false); assert.equal(result.missingSources, true);
  assert.equal(fs.readFileSync(join(root, 'skills/keep/SKILL.md'), 'utf8'), 'installed skill');
});
test('relative manifest entries survive relocation and reject escaping paths', t => {
  const { home } = lane(t), root = join(home, 'before'), state = join(root, '.h2a-install');
  convergeArtifacts({ root, state, host: 'vibe', version: '1', repair: true, artifacts: [{ path: join(root, 'skills/a/SKILL.md'), bytes: 'a', source: 'h2a@1/a' }] });
  const manifest = JSON.parse(fs.readFileSync(join(state, 'manifest.json')));
  assert.deepEqual(Object.keys(manifest.files), ['skills/a/SKILL.md']);
  assert.ok(Object.keys(manifest.files).every(path => !isAbsolute(path)));
  const moved = join(home, 'after'); fs.renameSync(root, moved);
  const result = convergeArtifacts({ root: moved, state: join(moved, '.h2a-install'), host: 'vibe', version: '1', repair: true,
    artifacts: [{ path: join(moved, 'skills/a/SKILL.md'), bytes: 'a', source: 'h2a@1/a' }] });
  assert.deepEqual(result.changes.changed, []);
  manifest.root = moved; manifest.files['../escape'] = manifest.files['skills/a/SKILL.md'];
  fs.writeFileSync(join(moved, '.h2a-install/manifest.json'), JSON.stringify(manifest));
  assert.throws(() => readNativeManifest(join(moved, '.h2a-install'), 'vibe', moved, '1'), /invalid|out-of-root/);
});
test('repair migrates absolute ownership and both former shared-store files without losing provenance', t => {
  const { home } = lane(t), root = join(home, '.gemini'), state = join(root, '.h2a-install'), agyState = join(root, '.h2a-install-agy');
  fs.mkdirSync(state, { recursive: true }); fs.mkdirSync(agyState); fs.mkdirSync(join(root, 'commands'));
  const path = join(root, 'commands/a.toml'); fs.writeFileSync(path, 'known old command');
  const legacy = { schema: 1, host: 'gemini-commands', root, version: 'old', files: { [path]: { sha256: digest('known old command'), source: 'h2a@old/a', selected: true } } };
  fs.writeFileSync(join(state, 'commands-manifest.json'), JSON.stringify(legacy)); fs.writeFileSync(join(agyState, 'shared-owner.json'), JSON.stringify({ manifest: join(state, 'commands-manifest.json'), sha256: digest(JSON.stringify(legacy)), import: 'pending' }));
  const options = { root, state: agyState, host: 'gemini-commands', version: 'new', repair: true, manifestName: 'shared-owner.json', artifacts: [{ path, bytes: 'known new command', source: 'h2a@new/a' }] };
  const result = convergeArtifacts(options); assert.deepEqual(result.changes.conflicts, []);
  assert.equal(fs.readFileSync(path, 'utf8'), 'known new command');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(join(agyState, 'shared-owner.json'))).files), ['commands/a.toml']);
  fs.writeFileSync(path, 'personal'); assert.deepEqual(convergeArtifacts(options).changes.conflicts, [path]);
});
test('Gemini and agy update the same authoritative relative shared-owner manifest and clean old resources', t => {
  const { home } = lane(t), root = join(home, '.gemini'), resourceDir = join(home, 'source'); fs.mkdirSync(resourceDir);
  fs.mkdirSync(join(resourceDir, 'assets')); fs.writeFileSync(join(resourceDir, 'assets/a.txt'), 'resource');
  const skill = { installName: 'a', raw: 'assets/a.txt', source: 'h2a', resourceDir, parsed: { name: 'a', description: 'a', body: 'assets/a.txt' } };
  const options = { root, skills: [skill], explicitInstall: true, repair: true, renderGemini: p => `description=${JSON.stringify(p.description)}\nprompt=${JSON.stringify('You are the a custom command for Gemini CLI.\n\n' + p.body)}\n` };
  convergeNativeHost({ ...options, host: 'agy', version: '1' });
  const old = join(root, '.h2a-install/skill-resources/h2a/1/a/assets/a.txt'); assert.ok(fs.existsSync(old));
  const result = convergeNativeHost({ ...options, host: 'gemini', version: '2' }); assert.equal(result.ok, true);
  const manifest = JSON.parse(fs.readFileSync(join(root, '.h2a-install-agy/shared-owner.json')));
  assert.equal(manifest.version, '2'); assert.ok(manifest.files['commands/a.toml']);
  assert.equal(manifest.files['commands/a.toml'].sha256, digest(fs.readFileSync(join(root, 'commands/a.toml'))));
  assert.equal(fs.existsSync(old), false);
  assert.ok(Object.keys(manifest.files).every(path => !isAbsolute(path)));
});
function proofFor(root, observed, components) {
  const runtime = join(root, 'wheel'), info = join(runtime, 'mistral_vibe.dist-info'); fs.mkdirSync(info, { recursive: true });
  fs.mkdirSync(join(runtime, 'vibe')); fs.writeFileSync(join(runtime, 'vibe/runtime.txt'), 'native fixture');
  const record = `vibe/runtime.txt,sha256=${createHash('sha256').update('native fixture').digest('base64url')},14\n`;
  const recordPath = join(info, 'RECORD'), metadataPath = join(info, 'METADATA');
  fs.writeFileSync(recordPath, record); fs.writeFileSync(metadataPath, 'Name: mistral-vibe\nVersion: 2.7.2\n');
  const evidence = join(root, 'evidence.json'); fs.writeFileSync(evidence, '{}');
  // Synthetic receipt in a disposable profile exercises validation, never the owner's qualification.
  fs.writeFileSync(join(root, '.h2a-install/qualification.json'), JSON.stringify({ schema: 1, host: 'vibe', root, fixture: false, recordedAt: new Date().toISOString(),
    runtime: { distribution: 'mistral-vibe', version: '2.7.2', recordPath, metadataPath, recordSha256: digest(record) },
    components: Object.fromEntries(components.map(name => [name, { status: 'qualified', dependencies: name === 'MCP' ? Object.fromEntries(['MCP', 'profile', 'node', 'entrypoint'].map(k => [k, observed[k]])) : { skills: observed.skills }, evidence: [evidence], evidenceHashes: { [evidence]: digest('{}') }, scope: 'test-only synthetic receipt' }])) }));
}
test('repair reports qualification of the installed bytes after restoring a missing skill', t => {
  const { home, cwd, cli, doctor } = lane(t); assert.equal(cli(['install-skills', '--host', 'vibe']).code, 0);
  const root = join(home, '.vibe'), state = join(root, '.h2a-install');
  const plan = planVibeEquipment({ root, state, cwd, version: '0.98.6', config: {}, mcpAvailable: false, repair: false });
  proofFor(root, plan.observed, ['skills']); fs.unlinkSync(join(root, 'skills/h2a/SKILL.md'));
  const result = doctor([]); assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.json().checks.nativeHostInstallations.hosts[0].qualification.components.skills, 'qualified');
});
test('skill proof becomes obsolete when project discovery gains a collision', t => {
  const { home, cwd, cli } = lane(t); assert.equal(cli(['install-skills', '--host', 'vibe']).code, 0);
  const root = join(home, '.vibe'), state = join(root, '.h2a-install');
  const plan = () => planVibeEquipment({ root, state, cwd, version: '0.98.6', config: {}, mcpAvailable: false, repair: false });
  proofFor(root, plan().observed, ['skills']);
  assert.equal(plan().qualification.components.skills, 'qualified');
  const project = join(cwd, '.agents/skills/h2a'); fs.mkdirSync(project, { recursive: true }); fs.writeFileSync(join(project, 'SKILL.md'), 'project override');
  assert.equal(plan().qualification.components.skills, 'obsolete');
});
test('an already enabled guard suspends when a project hook masks it', t => {
  const { home, cwd, cli, doctor } = lane(t); assert.equal(cli(['install-skills', '--host', 'vibe']).code, 0);
  const root = join(home, '.vibe'), state = join(root, '.h2a-install');
  const config = { mcp_servers: [{ name: 'h2a', command: 'private-test', args: ['mcp-serve'] }] };
  fs.writeFileSync(join(root, 'config.toml'), '[[mcp_servers]]\nname="h2a"\ncommand="private-test"\nargs=["mcp-serve"]\n');
  const plan = planVibeEquipment({ root, state, cwd, version: '0.98.6', config, mcpAvailable: true, repair: false }); proofFor(root, plan.observed, ['MCP']);
  assert.equal(doctor(['--guard', 'on']).code, 0);
  fs.mkdirSync(join(cwd, '.vibe'), { recursive: true }); fs.writeFileSync(join(cwd, '.vibe/hooks.toml'), '[[hooks]]\nname="sentropic-h2a-deny-manual-cli"\ntype="pre_tool"\ncommand="true"\n');
  const result = doctor([]); assert.equal(result.code, 0, result.err);
  assert.equal(result.json().checks.nativeHostInstallations.hosts[0].guard.active, false);
  assert.doesNotMatch(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /pre_tool/);
});
