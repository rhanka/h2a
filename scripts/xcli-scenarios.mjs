// Lot L12 (SPEC v3 §5.1 scenario 2, shared by L12–L15): scripted scenario
// vocabulary, classification, and S-matrix verdict. Unavailability rows must
// fail closed with their classified code — a durable-only success is never
// delivery, wake credit is never granted. Refusal twins pass only when the
// runner was provably live (phase-A reply) and the faulty wake produced no
// second reply.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CLIS } from './xcli-lab.mjs';

export const UNAVAILABILITY_STATES = Object.freeze(
  ['stopped-receiver', 'unknown-instance', 'identity-never-ready']);
export const REFUSAL_TWINS = Object.freeze(['unsigned-wake', 'misaddressed-wake', 'replayed-wake']);

// Every scenario row the S matrix covers: 3 unavailability states + 3
// refusal twins. Loop and negotiation join this list in L13/L14.
export const SCENARIO_ROWS = Object.freeze([
  ...UNAVAILABILITY_STATES.map(state => `unavailability:${state}`),
  ...REFUSAL_TWINS.map(twin => `refusal:${twin}`),
]);

export function parseScenario(spec) {
  if (spec === 'probe') return { kind: 'probe', key: 'probe' };
  const unavailable = /^unavailability:([a-z-]+)$/.exec(spec ?? '');
  if (unavailable && UNAVAILABILITY_STATES.includes(unavailable[1])) {
    return { kind: 'unavailability', state: unavailable[1], key: spec };
  }
  const refusal = /^refusal:([a-z-]+)$/.exec(spec ?? '');
  if (refusal && REFUSAL_TWINS.includes(refusal[1])) {
    return { kind: 'refusal', twin: refusal[1], key: spec };
  }
  throw new Error(`unknown-scenario:${spec}`);
}

const UNAVAILABILITY_BLOCKERS = Object.freeze({
  'stopped-receiver': 'receiver-unavailable',
  'unknown-instance': 'unknown-instance',
  'identity-never-ready': 'identity-never-ready',
});

export function expectedScenarioBlocker(parsed) {
  if (parsed.kind === 'unavailability') return UNAVAILABILITY_BLOCKERS[parsed.state];
  if (parsed.kind === 'refusal') return `wake-refused:${parsed.twin}`;
  throw new Error(`unknown-scenario-kind:${parsed.key}`);
}

// The synthetic target for the unknown-instance state: shaped like an
// instance id but reserved by the harness, never enrolled.
export const UNKNOWN_INSTANCE = 'xcli-unknown-instance';

function fail(code, detail) {
  return { ok: false, code, detail };
}

export function classifyScenarioRow(scenario, row) {
  const parsed = parseScenario(scenario);
  const expected = expectedScenarioBlocker(parsed);
  if (row.scenario !== parsed.key) return fail('scenario-row-mismatch', row.scenario);
  if (row.status !== 'blocked' || row.blocker !== expected) {
    return fail('scenario-wrong-blocker', `${row.status}:${row.blocker}`);
  }
  if (parsed.kind === 'unavailability') {
    // A durable-only landing on a stopped peer is recorded, never delivery:
    // accepted only when explicitly marked, with no live stage and no wake.
    if (row.delivered === true && row.durableOnly !== true) {
      return fail('scenario-live-claim', 'durable-only landing worded as delivery');
    }
    if (row.received === true || row.replied === true || row.replyDelivered === true) {
      return fail('scenario-live-claim', 'unavailable peer shows a live stage');
    }
    if (row.woke === true) return fail('scenario-live-claim', 'wake credited on an unavailable peer');
    return { ok: true };
  }
  if (!row.phaseAReplyDelivered) return fail('scenario-dead-runner', 'twin without a live phase A proves nothing');
  if (!row.refusalRejected) return fail('scenario-no-rejection', 'faulty wake was not rejected');
  if (row.secondReply) return fail('scenario-second-reply', 'faulty wake produced a reply');
  return { ok: true };
}

// Full S-matrix verdict: all 36 ordered pairs scenario-OK on every row.
// Extra cells are ignored; missing or failing cells are named.
export function verifyScenarioMatrix(cells, only) {
  const failures = [];
  assert.ok(Array.isArray(cells), 'scenario cells required');
  const rows = only ? [parseScenario(only).key] : [...SCENARIO_ROWS];
  if (only) assert.ok(SCENARIO_ROWS.includes(rows[0]), `unknown-scenario:${only}`);
  const pairOf = cell => cell.pair ?? `${cell.sender}:${cell.receiver}`;
  const byKey = new Map(cells.map(cell => [`${cell.scenario}:${pairOf(cell)}`, cell]));
  const allPairs = CLIS.flatMap(sender => CLIS.map(receiver => `${sender}:${receiver}`));
  for (const scenario of rows) {
    for (const pair of allPairs) {
      const row = byKey.get(`${scenario}:${pair}`);
      if (!row) { failures.push(`${scenario}:${pair} missing`); continue; }
      const verdict = classifyScenarioRow(scenario, row);
      if (!verdict.ok) failures.push(`${scenario}:${pair} ${verdict.code}`);
    }
  }
  return { pass: failures.length === 0, failures };
}

const invokedAsCli = process.argv[1] === new URL(import.meta.url).pathname;
if (invokedAsCli) {
  const checkIndex = process.argv.indexOf('--check');
  assert.ok(checkIndex !== -1, 'usage: xcli-scenarios.mjs --check <qualification.json>');
  const output = JSON.parse(fs.readFileSync(process.argv[checkIndex + 1], 'utf8'));
  const onlyIndex = process.argv.indexOf('--only');
  const verdict = verifyScenarioMatrix(output.cells ?? [],
    onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1]);
  console.log(JSON.stringify({ pass: verdict.pass, failures: verdict.failures.slice(0, 20),
    failureCount: verdict.failures.length }));
  process.exitCode = verdict.pass ? 0 : 1;
}
