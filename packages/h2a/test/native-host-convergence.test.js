import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../dist/index.js';
import { planVibeEquipment } from '../dist/hosts/vibe-equipment.js';
import { digest } from '../dist/hosts/native-files.js';
function setup(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'host-convergence-')), root = join(dir, "vibe ' quoted");
  const previous = { ...process.env }; process.env.HOME = dir; process.env.VIBE_HOME = root;
  fs.mkdirSync(root); fs.writeFileSync(join(root, 'config.toml'), 'mcp_servers=[]\n');
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); fs.rmSync(dir, { recursive: true, force: true }); });
  const cli = args => { let out = '', err = ''; const code = runCli(args, { cwd: () => dir, stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } }); return { code, out, err, json: () => JSON.parse(out) }; };
  const bus = join(dir, 'bus'); cli(['init', '--root', bus]);
  return { dir, root, state: join(root, '.h2a-install'), cli, doctor: flags => cli(['doctor', '--root', bus, '--host', 'vibe', '--repair', ...flags]) };
}
test('doctor dry-run is empty of writes; explicit lifecycle is independent of MCP and preserves off/on', t => {
  const { root, cli, doctor } = setup(t);
  const before = fs.readdirSync(root);
  assert.equal(doctor(['--dry-run']).code, 0);
  assert.deepEqual(fs.readdirSync(root), before);
  assert.notEqual(cli(['host', 'plugin', '--host', 'vibe', '--instance', 'auto', '--write', join(root, 'hooks.toml')]).code, 0);
  assert.deepEqual(fs.readdirSync(root), before);
  const install = cli(['host', 'plugin', '--host', 'vibe', '--instance', 'explicit', '--write', join(root, 'hooks.toml')]);
  assert.equal(install.code, 0, install.err);
  assert.match(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /post_agent/);
  assert.doesNotMatch(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /pre_tool|strict|match =/);
  assert.equal(doctor(['--lifecycle', 'off']).code, 0);
  assert.doesNotMatch(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /post_agent/);
  assert.equal(doctor(['--lifecycle', 'on']).code, 0);
  assert.match(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /explicit/);
  assert.notEqual(doctor(['--guard', 'on']).code, 0);
});
test('guard rejects fixture qualification, retains stale-code choice, and suspends on observable MCP loss', t => {
  const { root, state, doctor } = setup(t);
  fs.writeFileSync(join(root, 'config.toml'), '[[mcp_servers]]\nname="h2a"\ncommand="h2a"\nargs=["mcp-serve"]\n');
  assert.equal(doctor([]).code, 0);
  const config = { mcp_servers: [{ name: 'h2a', command: 'h2a', args: ['mcp-serve'] }] };
  const plan = planVibeEquipment({ root, state, version: '0.98.6', config, mcpAvailable: true, repair: false });
  const recordPath = join(root, 'RECORD'), metadataPath = join(root, 'METADATA');
  fs.writeFileSync(recordPath, 'private runtime fixture'); fs.writeFileSync(metadataPath, 'Name: mistral-vibe\nVersion: 2.26.1\n');
  const proof = { schema: 1, host: 'vibe', root, fixture: true, recordedAt: new Date().toISOString(),
    runtime: { distribution: 'mistral-vibe', version: '2.26.1', recordPath, metadataPath, recordSha256: digest('private runtime fixture') },
    components: { MCP: { status: 'qualified', dependencies: plan.observed, evidence: ['test double only'], scope: 'private fixture' } } };
  const proofPath = join(state, 'qualification.json'); fs.writeFileSync(proofPath, JSON.stringify(proof));
  assert.notEqual(doctor(['--guard', 'on']).code, 0);
  // Exercise production receipt validation in this disposable profile; no real host is qualified.
  proof.fixture = false; fs.writeFileSync(proofPath, JSON.stringify(proof));
  assert.equal(doctor(['--guard', 'on']).code, 0);
  assert.match(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /pre_tool/);
  proof.components.MCP.dependencies.entrypoint = 'obsolete-code'; fs.writeFileSync(proofPath, JSON.stringify(proof));
  assert.equal(doctor([]).code, 0);
  assert.match(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /pre_tool/);
  fs.writeFileSync(join(root, 'config.toml'), 'mcp_servers=[]\n');
  assert.equal(doctor([]).code, 0);
  assert.doesNotMatch(fs.readFileSync(join(root, 'hooks.toml'), 'utf8'), /pre_tool/);
  assert.equal(JSON.parse(fs.readFileSync(join(state, 'manifest.json'))).guard, 'on');
});
