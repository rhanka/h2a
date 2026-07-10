import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregatePendingDecisions,
  captureFeedbackIntent,
  createFocusStore,
  createSwipeState,
  decisionKey,
  move,
  parseDecisionKey,
  projectHash
} from '../dist/index.js';

const rootA = '/repo/a';
const rootB = '/repo/b';
const keyA1 = decisionKey({ projectRoot: rootA, source: 'escalate', decisionId: 'same:id' });
const keyB1 = decisionKey({ projectRoot: rootB, source: 'escalate', decisionId: 'same:id' });

function decision(overrides) {
  return {
    decisionKey: keyA1,
    id: 'same:id',
    source: 'escalate',
    channel: 'decide',
    instance: 'agent:one',
    question: 'Decide?',
    createdAt: '2026-07-09T00:00:00.000Z',
    ...overrides
  };
}

test('decisionKey is project-scoped and round-trips ids containing colons', () => {
  assert.notEqual(keyA1, keyB1);
  assert.equal(parseDecisionKey(keyA1).projectHash, projectHash(rootA));
  assert.deepEqual(parseDecisionKey(keyA1), {
    projectHash: projectHash(rootA),
    source: 'escalate',
    decisionId: 'same:id'
  });
});

test('aggregatePendingDecisions dedups by decisionKey and sorts by channel then time', () => {
  const olderAdvise = decision({ decisionKey: 'aaaa:track:1', id: '1', source: 'track', channel: 'advise', createdAt: '2026-07-08T00:00:00.000Z' });
  const newerAlert = decision({ decisionKey: 'aaaa:loop:2', id: '2', source: 'loop', channel: 'alert', createdAt: '2026-07-10T00:00:00.000Z' });
  const duplicate = decision({ decisionKey: olderAdvise.decisionKey, question: 'duplicate loses' });
  const out = aggregatePendingDecisions([olderAdvise, newerAlert, duplicate]);
  assert.equal(out.length, 2);
  assert.equal(out[0].decisionKey, newerAlert.decisionKey);
  assert.equal(out[1].question, olderAdvise.question);
});

test('swipe FSM clamps at bounds', () => {
  let state = createSwipeState(2);
  state = move(state, 'prev');
  assert.equal(state.index, 0);
  state = move(state, 'next');
  state = move(state, 'next');
  assert.equal(state.index, 1);
});

test('focus store stacks projects, preserves active selection, and captures intents as data', () => {
  const store = createFocusStore([
    { projectHash: projectHash(rootA), projectRoot: rootA, readAt: 'now', decisions: [decision({ decisionKey: keyA1 })] },
    { projectHash: projectHash(rootB), projectRoot: rootB, readAt: 'now', decisions: [decision({ decisionKey: keyB1 })] }
  ]);
  assert.equal(store.getSnapshot().projects.length, 2);
  assert.equal(store.getSnapshot().allDecisions.length, 2);

  store.setActiveProject(projectHash(rootB));
  assert.equal(store.getSnapshot().active?.selected?.decisionKey, keyB1);

  const intent = captureFeedbackIntent(
    { kind: 'answer', decisionKey: keyB1, answer: 'Ship it' },
    { source: 'escalate', now: () => '2026-07-09T12:00:00.000Z' }
  );
  store.captureIntent(intent);
  assert.deepEqual(store.getSnapshot().intents, [intent]);
});

test('captureFeedbackIntent rejects empty free-text payloads', () => {
  assert.throws(
    () => captureFeedbackIntent({ kind: 'comment', decisionKey: keyA1, comment: '   ' }, { source: 'track' }),
    /comment must be non-empty/
  );
});
