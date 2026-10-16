import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CLIS, classify, matrix, environment, inside, pythonEntrypoint } from './xcli-lab.mjs';

test('durable delivery without live receive and reply never qualifies a real CLI', () => {
  const row = { senderMcp: true, receiverMcp: true, sent: true, delivered: true,
    received: false, woke: false, replied: false, replyDelivered: false };
  assert.equal(classify(row), 'measured-KO');
  for (const key of Object.keys(row)) row[key] = true;
  assert.equal(classify(row), 'measured-OK');
  row.blocker = 'authentication-required';
  assert.equal(classify(row), 'blocked');
});

test('the qualification table requires all 36 distinct ordered pairs including same CLI', () => {
  const cells = CLIS.flatMap(sender => CLIS.map(receiver => ({ sender, receiver, status: 'blocked' })));
  assert.equal((matrix(cells).match(/\[blocked\]/g) ?? []).length, 36);
  assert.throws(() => matrix(cells.slice(1)), /36/);
  assert.throws(() => matrix([...cells.slice(1), cells[1]]), /duplicate/);
});

test('the private environment drops ambient sockets, hooks, daemon and provider configuration', () => {
  const root = mkdtempSync('/tmp/xcli-env-');
  try {
    const env = environment(root);
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
      'H2A_ROOT', 'H2A_NATIVE_SOCKET', 'REMOTE_CLI_CONFIG_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
      assert.ok(env[key].startsWith(root + '/'), key);
    }
    assert.equal(env.H2A_UPGRADE_REEXECED, '1');
    for (const key of ['NODE_OPTIONS', 'BASH_ENV', 'TMUX', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'H2A_MCP_CENTRAL_ENDPOINT']) assert.equal(env[key], undefined);
    assert.throws(() => inside(root, join(root, '../owner')), /outside/);
    const entry = join(root, 'vibe');
    writeFileSync(entry, '#!/usr/bin/env python3\n');
    assert.equal(pythonEntrypoint(entry), true);
    writeFileSync(entry, '#!/usr/bin/env node\n');
    assert.equal(pythonEntrypoint(entry), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
