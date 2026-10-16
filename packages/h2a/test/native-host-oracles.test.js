import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGuardEntries, inspectLifecycleEntries } from '../scripts/qualification-oracles.mjs';
import { inspectMcpEntries } from '../scripts/qualification-oracles.mjs';
import { createMcpServer } from '../dist/index.js';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('MCP oracle qualifies real identity, session and Track handlers and rejects another bus or workspace', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oracle-real-')), workspace = join(root, 'workspace');
  fs.mkdirSync(join(workspace, '.track'), { recursive: true }); fs.writeFileSync(join(workspace, '.track/events.jsonl'), '');
  const server = createMcpServer({ root: join(root, 'bus'), workspaceRoot: workspace });
  t.after(() => { server.notifications.stop(); server.sessions.closeAll('closed'); fs.rmSync(root, { recursive: true, force: true }); });
  const effect = (toolName, input) => ({ type: 'effect', sessionId: 'native', detail: { toolName, input }, state: { status: 'completed', output: server.callTool(toolName, input) } });
  const entries = [effect('h2a_identity_status', {}), effect('h2a_session_open', { instance: 'qualification-test', host: 'vibe' }), effect('track_status', { level: 'task', baselineCommit: 'qualification' })];
  const options = { busRoot: join(root, 'bus'), workspace };
  const result = inspectMcpEntries(entries, 'native', options);
  assert.equal(result.MCP, true); assert.equal(result.context, true);
  assert.equal(inspectMcpEntries(entries, 'native', { ...options, busRoot: join(root, 'other') }).MCP, false);
  assert.equal(inspectMcpEntries(entries, 'native', { ...options, workspace: join(root, 'other') }).context, false);
  assert.equal(inspectMcpEntries(entries.filter(e => e.detail.toolName !== 'track_status'), 'native', options).context, false);
  assert.equal(inspectMcpEntries(entries, 'other-session', options).MCP, false);
});
const notice = (kind, id, extra = {}) => ({ type: 'notice', sessionId: 'copy', detail: { kind, scope: 'pre_tool', toolCallId: id, ...extra } });
const benign = { id: 'allow-call', type: 'effect', sessionId: 'copy', detail: { input: { command: 'printf vibe-guard-ok' } }, state: { status: 'completed' } };
const denied = { id: 'deny-call', type: 'effect', sessionId: 'copy', detail: { input: { command: 'h2a --version' } }, state: { status: 'failed' } };
const valid = [benign, denied, notice('hook_run_started', benign.id), notice('hook_run_completed', benign.id), notice('hook_completed', denied.id, { hookName: 'sentropic-h2a-deny-manual-cli', status: 'error' })];
test('guard oracle refuses an executed target or an unrelated deny even when benign command succeeds', () => {
  assert.equal(inspectGuardEntries(valid, 'copy'), true);
  const executed = valid.map(e => e === denied ? { ...e, state: { status: 'completed' } } : e);
  assert.equal(inspectGuardEntries(executed, 'copy'), false);
  const unrelated = valid.map(e => e.detail?.kind === 'hook_completed' ? { ...e, detail: { ...e.detail, toolCallId: 'other-command' } } : e);
  assert.equal(inspectGuardEntries(unrelated, 'copy'), false);
  assert.equal(inspectGuardEntries([...valid, notice('hook_run_completed', benign.id, { status: 'warning' })], 'copy'), false);
});
test('lifecycle oracle requires child/parent record boundaries; fork wrapper runs alone are not record calls', () => {
  const entries = [
    { type: 'notice', sessionId: 'origin', detail: { scope: 'post_agent', kind: 'hook_run_started' } },
    { type: 'notice', sessionId: 'origin', detail: { scope: 'post_agent', kind: 'hook_run_completed' } },
    { type: 'effect', sessionId: 'origin', detail: { kind: 'subagent' }, state: { status: 'completed' } },
    { type: 'notice', sessionId: 'copy', detail: { scope: 'post_agent', kind: 'hook_run_started' } }
  ];
  const record = { parentRecordPresent: true, lifecycleRecordUnchangedInFork: true, recordedAfterParent: true };
  assert.equal(inspectLifecycleEntries(entries, 'origin', 'copy', record), false, 'no child/end-of-parent record boundary evidence');
  assert.equal(inspectLifecycleEntries(entries, 'origin', 'copy', { ...record, childRecordUntouched: true, parentRecordTransitions: 1, otherInstancesUntouched: true }), true);
});
