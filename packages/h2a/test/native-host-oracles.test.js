import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGuardEntries, inspectLifecycleEntries } from '../scripts/qualification-oracles.mjs';
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
