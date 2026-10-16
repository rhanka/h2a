import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { convergeArtifacts } from '../dist/hosts/native-artifacts.js';
import { planVibeEquipment } from '../dist/hosts/vibe-equipment.js';
test('interrupted hooks are recovered from exact durable pending hashes without rewriting intact files', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'native-recovery-')), state = join(root, '.h2a-install');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { root, state, version: '0.98.6', config: {}, mcpAvailable: false, repair: true };
  const first = planVibeEquipment({ ...options, instance: 'private-instance', busRoot: join(root, 'bus') });
  const invoke = (plan, finalize) => convergeArtifacts({ root, state, version: options.version, host: 'vibe', repair: true,
    artifacts: plan.artifacts, configure: plan.configure, finalize });
  assert.throws(() => invoke(first, () => { first.finish(); throw new Error('interrupted'); }), /interrupted/);
  assert.ok(fs.existsSync(join(state, 'pending.json')));
  assert.equal(fs.existsSync(join(state, 'manifest.json')), false);
  const path = join(root, 'hooks.toml'), bytes = fs.readFileSync(path), mtime = fs.statSync(path).mtimeMs;
  const next = planVibeEquipment(options); invoke(next, next.finish);
  assert.deepEqual(fs.readFileSync(path), bytes); assert.equal(fs.statSync(path).mtimeMs, mtime);
  assert.equal(JSON.parse(fs.readFileSync(join(state, 'manifest.json'))).lifecycle.instance, 'private-instance');
  assert.equal(fs.existsSync(join(state, 'pending.json')), false);
  assert.equal(fs.existsSync(join(state, 'writer.lock')), false);
});
test('a stopped writer lock blocks repair with a recovery diagnostic and preserves its journal', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'native-lock-')), state = join(root, '.h2a-install');
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); fs.mkdirSync(state);
  const pending = join(state, 'pending.json'), lock = join(state, 'writer.lock');
  fs.writeFileSync(lock, ''); fs.writeFileSync(pending, '{"private":"journal"}');
  assert.throws(() => convergeArtifacts({ root,state,host:'vibe',version:'0.98.6',repair:true,artifacts:[] }), /Confirm that the writer has stopped.*pending.json is preserved/);
  assert.equal(fs.readFileSync(pending,'utf8'),'{"private":"journal"}'); assert.ok(fs.existsSync(lock));
});
