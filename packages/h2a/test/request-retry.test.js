import assert from 'node:assert/strict';
import test from 'node:test';
import { requestWithRetry, transientFetchError, OFFER_ATTEMPT_BUDGETS_MS } from '../src/runtime/handover/request-retry.js';

const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

test('transient fetch failures are retried, then the late success wins', async () => {
  const budgets = [];
  const result = await requestWithRetry(async budget => {
    budgets.push(budget);
    if (budgets.length < 3) throw abortError();
    return 'accepted';
  }, { backoffMs: 0 });
  assert.equal(result, 'accepted');
  assert.deepEqual(budgets, OFFER_ATTEMPT_BUDGETS_MS);
});

test('a dead central fails fast on every attempt and surfaces the refusal', async () => {
  let calls = 0;
  const refusal = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
  // Refused is transient at the fetch layer, but a dead central answers
  // every attempt in milliseconds, so outage detection stays fast.
  await assert.rejects(requestWithRetry(async () => { calls++; throw refusal; }, { backoffMs: 0 }), /ECONNREFUSED/);
  assert.equal(calls, OFFER_ATTEMPT_BUDGETS_MS.length);
});

test('a non-transient failure propagates on the first attempt', async () => {
  let calls = 0;
  await assert.rejects(requestWithRetry(async () => { calls++; throw new Error('shim_ack_invalid'); }, { backoffMs: 0 }), /shim_ack_invalid/);
  assert.equal(calls, 1);
});

test('a signalled stop aborts the loop instead of retrying', async () => {
  const stop = new AbortController();
  stop.abort();
  let calls = 0;
  await assert.rejects(requestWithRetry(async () => { calls++; throw abortError(); }, { backoffMs: 0, stopSignal: stop.signal }), /aborted/);
  assert.equal(calls, 1);
});

test('transientFetchError only matches transport failures', () => {
  assert.equal(transientFetchError(abortError()), true);
  assert.equal(transientFetchError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
  assert.equal(transientFetchError(new Error('socket hang up')), true);
  assert.equal(transientFetchError(new Error('shim_offer_unavailable')), false);
  assert.equal(transientFetchError(new Error('boom')), false);
  assert.equal(transientFetchError(null), false);
});
