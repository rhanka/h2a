import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { convergeAfterExplicitUpgrade } from '../dist/hosts/upgrade-equipment.js';
import { createMcpServer } from '../dist/index.js';
import { HOST_UPDATE_NOTICE } from '../dist/hosts/operator-notices.js';
test('explicit upgraded/current/deferred outcomes converge with the verified binary; failures and skip never launch', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'upgrade-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(join(root, 'dist')); const binary = join(root, 'dist/bin.js');
  fs.writeFileSync(binary, '// private fake verified entrypoint');
  fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@sentropic/h2a', version: '0.99.0' }));
  const calls = [], run = (command, args) => { calls.push([command, args]); return { status: 0, stdout: '{"native":true}', stderr: '' }; };
  const upgraded = { outcome: 'upgraded', current: '0.98.6', target: '0.99.0', verifiedVersion: '0.99.0', verifiedEntrypoint: binary };
  assert.equal(convergeAfterExplicitUpgrade(upgraded, { host: 'vibe' }, run).ok, true);
  assert.equal(calls.length, 1); assert.equal(calls[0][1][0], binary);
  assert.deepEqual(calls[0][1].slice(1), ['doctor', '--repair', '--host', 'vibe']);
  for (const outcome of ['already-current', 'deferred-propagation']) {
    const result = convergeAfterExplicitUpgrade({ ...upgraded, current: '0.99.0', outcome }, { host: 'agy', 'dry-run': 'true' }, run);
    assert.equal(result.ok, true); assert.ok(calls.at(-1)[1].includes('--dry-run'));
  }
  const count = calls.length;
  for (const outcome of ['failed', 'skipped-locked', 'blocked-undecidable', 'skipped-locked-stale']) assert.equal(convergeAfterExplicitUpgrade({ ...upgraded, outcome }, {}, run).skipped, true);
  assert.equal(convergeAfterExplicitUpgrade(upgraded, { 'skip-hosts': 'true' }, run).skipped, true);
  assert.equal(calls.length, count);
  fs.writeFileSync(join(root, 'package.json'), '{"name":"unverified","version":"0.99.0"}');
  assert.equal(convergeAfterExplicitUpgrade(upgraded, {}, run).ok, false);
  assert.equal(calls.length, count);
});
test('MCP identity/session responses preserve fields and include optional in-memory notices', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'mcp-host-notices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let notices = [];
  const server = createMcpServer({ root, operatorNotices: () => notices });
  t.after(() => { server.notifications.stop(); server.sessions.closeAll('closed'); });
  const before = JSON.parse(server.callTool('h2a_identity_status', {}).content[0].text);
  assert.equal(before.operator_notices, undefined);
  notices = [HOST_UPDATE_NOTICE];
  const after = JSON.parse(server.callTool('h2a_identity_status', {}).content[0].text);
  assert.deepEqual(after, { ...before, operator_notices: notices });
  const session = server.callTool('h2a_session_open', { instance: 'private-test', host: 'vibe' });
  assert.ok(session.session); assert.deepEqual(session.operator_notices, notices);
});
