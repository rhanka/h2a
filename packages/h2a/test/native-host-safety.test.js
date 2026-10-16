import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { atomicNativeWrite, snapshot } from '../dist/hosts/native-files.js';
import { editVibeHooks, parseNativeToml } from '../dist/hosts/native-toml.js';
const hook = { name: 'h2a-drumbeat-record', type: 'post_agent', command: "node '/path with spaces/hook.mjs'", timeout: 5 };
const third = '# user comment\n[[hooks]]\nname="user"\ntype="post_tool"\ncommand="echo personal"\n';
test('TOML validates the entire document as 1.0 and preserves third parties', () => {
  const first = editVibeHooks(third, [hook], {});
  assert.ok(first.text.startsWith(third));
  assert.equal(editVibeHooks(first.text, [hook], first.owned).text, first.text);
  assert.equal(editVibeHooks(first.text, [], first.owned).text.trim(), third.trim());
  for (const bad of ['x=1\nx=2\n', 'hooks = [\n', 'x = "\\e"\n']) assert.throws(() => editVibeHooks(bad, [hook], {}));
  assert.throws(() => editVibeHooks('hooks=[{name="user"}]\n', [hook], {}), /inline/);
  assert.equal(parseNativeToml(editVibeHooks('hooks=[]\n', [hook], {}).text).hooks.length, 1);
});
test('TOML refuses unknown or customized owned blocks even with third party changes', () => {
  const first = editVibeHooks('', [hook], {});
  assert.throws(() => editVibeHooks(first.text, [hook], {}), /ownership/);
  assert.throws(() => editVibeHooks(first.text.replace('timeout = 5', 'timeout = 4'), [hook], first.owned), /custom/);
  const changedThird = first.text + third;
  assert.ok(editVibeHooks(changedThird, [], first.owned).text.includes('echo personal'));
});
test('TOML inserts hooks in requested order', () => {
  const guard = { ...hook, name: 'sentropic-h2a-deny-manual-cli', type: 'pre_tool' };
  const result = editVibeHooks(third, [guard, hook], {});
  assert.deepEqual(parseNativeToml(result.text).hooks.map(h => h.name), ['user', guard.name, hook.name]);
});
test('TOML hook activation and removal preserve exact surrounding bytes across cycles', () => {
  for (const original of ['', third, third.trimEnd()]) {
    let text = original;
    for (let i = 0; i < 3; i++) {
      const installed = editVibeHooks(text, [hook], {});
      text = editVibeHooks(installed.text, [], installed.owned).text;
      assert.equal(text, original);
    }
  }
});
test('TOML removes the separator and terminal newline of a previously installed hook', () => {
  const installed = editVibeHooks(third, [hook], {});
  const historical = installed.text.endsWith('\n') ? installed.text : installed.text + '\n';
  assert.equal(editVibeHooks(historical, [], installed.owned).text, third);
});
test('native writes refuse races and symlinks; dry-run and stable repeat do not mutate', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'native-writes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'hooks.toml'), state = join(dir, 'state');
  assert.equal(atomicNativeWrite(path, third, { state, dryRun: true }), true);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(atomicNativeWrite(path, third, { state }), true);
  const time = fs.statSync(path).mtimeMs;
  assert.equal(atomicNativeWrite(path, third, { state }), false);
  assert.equal(fs.statSync(path).mtimeMs, time);
  const expected = snapshot(path);
  assert.throws(() => atomicNativeWrite(path, 'replacement', { state, expected, beforeRename: () => fs.writeFileSync(path, 'concurrent') }), /concurrent/);
  assert.equal(fs.readFileSync(path, 'utf8'), 'concurrent');
  assert.equal(fs.readdirSync(state + '/backups').length, 0);
  assert.equal(fs.readdirSync(dir).some(p => p.endsWith('.tmp')), false);
  fs.symlinkSync(path, join(dir, 'link'));
  assert.throws(() => atomicNativeWrite(join(dir, 'link'), 'oops', { state }), /symlink/);
});
