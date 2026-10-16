import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
const guard = resolve('packages/h2a/hooks/vibe-pre-tool.mjs');
const lifecycle = resolve('packages/h2a/hooks/vibe-post-agent.mjs');
test('Vibe guard allows benign quoted text, denies CLI invocations, and fails open on malformed input', () => {
  for (const name of ['bash', 'file_system.bash', 'process_start', 'process.start']) {
    for (const command of ['echo benign', `node -e 'console.log("|h2a send")'`, 'echo h2a']) {
      const r = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: name, tool_input: { command } }), encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); assert.deepEqual(JSON.parse(r.stdout), { decision: 'allow' });
    }
    for (const command of ['h2a send', 'echo ok; h2a send', 'env A="test" command h2a send']) {
      const r = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_name: name, tool_input: { command } }), encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).decision, 'deny');
    }
  }
  const malformed = spawnSync(process.execPath, [guard], { input: '{', encoding: 'utf8' });
  assert.equal(malformed.status, 0); assert.deepEqual(JSON.parse(malformed.stdout), { decision: 'allow' });
});
test('Vibe lifecycle records only explicit parent null, never touches the record for forks or malformed payloads', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'vibe-hook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const record = join(dir, 'record.json'), entry = join(dir, 'fake entry.mjs');
  fs.writeFileSync(entry, `import fs from 'node:fs';fs.writeFileSync(process.env.TEST_RECORD,JSON.stringify(process.argv.slice(2)));console.log('captured');`);
  const args = [lifecycle, '--entrypoint', entry, '--instance', 'parent-id', '--root', dir];
  const env = { ...process.env, TEST_RECORD: record, TMUX_PANE: '%42' };
  const invoke = input => spawnSync(process.execPath, args, { input, encoding: 'utf8', env });
  const parent = invoke(JSON.stringify({ parent_session_id: null, session_id: 'any-prefix' }));
  assert.equal(parent.status, 0, parent.stderr); assert.equal(parent.stdout, '');
  const bytes = fs.readFileSync(record, 'utf8'), mtime = fs.statSync(record).mtimeMs;
  const parsed = JSON.parse(bytes);
  assert.deepEqual(parsed.slice(0, 6), ['drumbeat', 'record', '--instance', 'parent-id', '--status', 'paused']);
  for (const flag of ['--root', '--command', '--resume-command', '--tmux-session', '--tmux-pane']) assert.ok(parsed.includes(flag));
  for (const payload of ['{', '{}', '{"parent_session_id":""}', '{"parent_session_id":2}', '{"parent_session_id":"parent-id"}']) {
    const r = invoke(payload); assert.equal(r.status, 0); assert.equal(r.stdout, '');
    assert.equal(fs.readFileSync(record, 'utf8'), bytes); assert.equal(fs.statSync(record).mtimeMs, mtime);
  }
});
