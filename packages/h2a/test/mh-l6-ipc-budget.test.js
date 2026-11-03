// H1 regression: the IPC budget oracle must discriminate a live but
// unscheduled controller child from a dead or stuck one, with the
// unchanged 5000 ms budget, no retry and no reduced workload.
// Deterministic: SIGSTOP/SIGKILL probes, no host-load dependence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTROLLER_REPLY_BUDGET_MS, replyWithBudget } from './helpers/mh-l6-ipc-budget.mjs';

const worker = fileURLToPath(new URL('./helpers/mh-l6-controller.mjs', import.meta.url));

function procState(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return text.slice(text.lastIndexOf(')') + 1).trim().split(/\s+/)[0];
  } catch {
    return undefined;
  }
}

function launch(t) {
  const child = spawn(process.execPath, [worker], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited.
    }
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

// Stop the child before it can run. Bounded setup attempts: if a hello
// already arrived before SIGSTOP took effect, restart with a fresh child.
// This bounds setup only; the asserted budget itself never retries.
async function stoppedBeforeRun(t) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const child = launch(t);
    let heard = false;
    const early = () => {
      heard = true;
    };
    child.once('message', early);
    child.kill('SIGSTOP');
    const end = Date.now() + 10000;
    let stopped = false;
    while (Date.now() < end) {
      if (heard) break;
      if (procState(child.pid) === 'T') {
        stopped = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    if (stopped && !heard) {
      child.off('message', early);
      return child;
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited.
    }
  }
  throw new Error('setup_failed: could not freeze a controller before its first reply');
}

test('M17 oracle: a healthy child still answers within the unchanged budget', async (t) => {
  assert.equal(CONTROLLER_REPLY_BUDGET_MS, 5000, 'budget bound is unchanged');
  const child = launch(t);
  const hello = await replyWithBudget(child);
  assert.equal(hello.identity.pid, child.pid);
});

test('M17 oracle: budget expiry on a live unscheduled child reports alive evidence', async (t) => {
  const child = await stoppedBeforeRun(t);
  const failed = await replyWithBudget(child).then(
    () => null,
    (error) => error
  );
  assert.ok(failed instanceof Error, 'unchanged budget must still fire');
  assert.match(failed.message, /^controller_reply_budget_exceeded /);
  const evidence = JSON.parse(failed.message.slice('controller_reply_budget_exceeded '.length));
  assert.equal(evidence.budgetMs, 5000, 'budget bound is unchanged');
  assert.ok(evidence.waitedMs >= 5000, `full budget waited, got ${evidence.waitedMs}`);
  assert.equal(evidence.alive, true, 'a SIGSTOPped child is alive and must be reported so');
  assert.equal(evidence.exitCode, null);
  assert.equal(evidence.signalCode, null);
  // Frozen while stopped: no CPU progress during the whole budget window.
  // This is the never-scheduled signature the old bare timeout hid.
  assert.equal(evidence.cpuTicksAtExpiry, evidence.cpuTicksAtArm);
});

test('M17 oracle: a dead child keeps the closed-before-reply verdict', async (t) => {
  const child = launch(t);
  child.kill('SIGKILL');
  const failed = await replyWithBudget(child).then(
    () => null,
    (error) => error
  );
  assert.ok(failed instanceof Error);
  assert.equal(failed.message, 'controller_closed_before_reply');
});

test('M17 oracle: an early timer callback must not expire the unchanged deadline', async t => {
  const { EventEmitter } = await import('node:events');
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  let now = 0, callback, delay, settled = false;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { callback = fn; delay = ms; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const reply = replyWithBudget(child).catch(error => { settled = true; return error; });
  assert.equal(delay, 5000);
  now = 4999; callback();
  await Promise.resolve();
  assert.equal(settled, false, 'early timer delivery is not deadline expiry');
  assert.equal(delay, 1, 'only the remaining budget is scheduled');
  now = 5000; callback();
  const failed = await reply;
  assert.match(failed.message, /^controller_reply_budget_exceeded /);
  const evidence = JSON.parse(failed.message.slice('controller_reply_budget_exceeded '.length));
  assert.equal(evidence.waitedMs, 5000);
  assert.equal(child.listenerCount('message'), 0);
});
