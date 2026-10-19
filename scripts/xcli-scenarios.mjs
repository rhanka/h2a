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

// Lot L13: loop lifecycle plus its refusal twins (join unknown loop,
// report without join, double done).
export const LOOP_LIFECYCLE = 'lifecycle';
export const LOOP_TWINS = Object.freeze(['join-unknown', 'report-without-join', 'report-after-done']);

// Lot L14: negotiation flow plus its refusal twins (offer on an unknown
// negotiation, stabilize without the counterparty's offer, replayed
// stabilization signature).
export const NEGOTIATION_FLOW = 'flow';
export const NEGOTIATION_TWINS = Object.freeze(['offer-unknown', 'stabilize-without-offer', 'replayed-stabilization']);

// Lot L15: remaining inventory by class. Drive-consent paths are not
// published at the tested SHA, so the group stays not-covered with a named
// blocker instead of an unexecutable scenario.
export const INVENTORY_GROUPS = Object.freeze(['read-paths', 'session-paths', 'conductor-paths', 'governance-paths']);

// Every scenario row the S matrix covers.
export const SCENARIO_ROWS = Object.freeze([
  ...UNAVAILABILITY_STATES.map(state => `unavailability:${state}`),
  ...REFUSAL_TWINS.map(twin => `refusal:${twin}`),
  'loop:lifecycle',
  ...LOOP_TWINS.map(twin => `loop:${twin}`),
  'negotiation:flow',
  ...NEGOTIATION_TWINS.map(twin => `negotiation:${twin}`),
  ...INVENTORY_GROUPS.map(group => `inventory:${group}`),
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
  const loop = /^loop:([a-z-]+)$/.exec(spec ?? '');
  if (loop && (loop[1] === LOOP_LIFECYCLE || LOOP_TWINS.includes(loop[1]))) {
    return loop[1] === LOOP_LIFECYCLE
      ? { kind: 'loop', name: LOOP_LIFECYCLE, key: spec }
      : { kind: 'loop', name: LOOP_LIFECYCLE, twin: loop[1], key: spec };
  }
  const negotiation = /^negotiation:([a-z-]+)$/.exec(spec ?? '');
  if (negotiation && (negotiation[1] === NEGOTIATION_FLOW || NEGOTIATION_TWINS.includes(negotiation[1]))) {
    return negotiation[1] === NEGOTIATION_FLOW
      ? { kind: 'negotiation', name: NEGOTIATION_FLOW, key: spec }
      : { kind: 'negotiation', name: NEGOTIATION_FLOW, twin: negotiation[1], key: spec };
  }
  const inventory = /^inventory:([a-z-]+)$/.exec(spec ?? '');
  if (inventory && INVENTORY_GROUPS.includes(inventory[1])) {
    return { kind: 'inventory', group: inventory[1], key: spec };
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
  if (parsed.kind === 'loop') return parsed.twin ? `loop-refused:${parsed.twin}` : 'loop-lifecycle-complete';
  if (parsed.kind === 'negotiation') {
    return parsed.twin ? `negotiation-refused:${parsed.twin}` : 'negotiation-flow-complete';
  }
  if (parsed.kind === 'inventory') return `inventory-complete:${parsed.group}`;
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
  if (parsed.kind === 'loop') return classifyLoopRow(parsed, row);
  if (parsed.kind === 'negotiation') return classifyNegotiationRow(parsed, row);
  if (parsed.kind === 'inventory') return classifyInventoryRow(parsed, row);
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

export function classifyLoopRow(parsed, row) {
  if (parsed.twin) {
    if (row.twinRefused !== true) return fail('scenario-no-rejection', `loop twin ${parsed.twin} was not refused`);
    return { ok: true };
  }
  if (row.loopTerminal !== true) return fail('scenario-no-terminal', 'loop terminal state unwitnessed');
  return { ok: true };
}

export function classifyNegotiationRow(parsed, row) {
  if (parsed.twin) {
    if (row.twinRefused !== true) return fail('scenario-no-rejection', `negotiation twin ${parsed.twin} was not refused`);
    return { ok: true };
  }
  if (row.stabilized !== true) return fail('scenario-unstabilized', 'stabilization unwitnessed');
  if (row.journalGrown !== true) return fail('scenario-no-journal', 'journal growth unwitnessed');
  return { ok: true };
}

export function classifyInventoryRow(parsed, row) {
  if (row.inventoryOk !== true) return fail('scenario-inventory-gap', `${parsed.group} not fully witnessed`);
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

// Scripted peers (Lots L13–L15): deterministic step lists executed by the
// simulated model after identity readiness. `$instance` is the peer's own
// enrolled id; `$name` reads a value an earlier step saved. Substitution is
// exact-string only — never interpolation — so ids cannot leak into larger
// strings. Coordination between peers uses harness marker files the worker
// owns ({waitForFile, writeFile} carry cell-relative names only).
export function substituteScriptArgs(args, vars) {
  if (typeof args === 'string' && args.startsWith('$')) {
    const name = args.slice(1);
    assert.ok(Object.hasOwn(vars, name), `script-unknown-var:${name}`);
    return vars[name];
  }
  if (Array.isArray(args)) return args.map(entry => substituteScriptArgs(entry, vars));
  if (args && typeof args === 'object') {
    return Object.fromEntries(Object.entries(args).map(([key, entry]) => [key, substituteScriptArgs(entry, vars)]));
  }
  return args;
}

export function validateScriptSteps(steps) {
  assert.ok(Array.isArray(steps) && steps.length > 0, 'script-steps-required');
  for (const step of steps) {
    if (step.waitForFile !== undefined || step.writeFile !== undefined) {
      const name = step.waitForFile ?? step.writeFile;
      assert.ok(typeof name === 'string' && /^[a-z0-9][a-z0-9.-]{0,40}$/.test(name), 'script-marker-name');
      continue;
    }
    assert.ok(typeof step.tool === 'string' && step.tool.startsWith('h2a_'), 'script-tool-not-h2a');
    assert.ok(step.args && typeof step.args === 'object', 'script-args-required');
    if (step.retryMs !== undefined) assert.ok(Number.isSafeInteger(step.retryMs) && step.retryMs > 0, 'script-retry-range');
  }
  return true;
}

export const LOOP_ID = 'xcli-loop';
export const NEGOTIATION_ID = 'xcli-nego';
const GOAL = 'xcli scenario qualification';
const NOTE = 'xcli scenario note';

// Loop lifecycle: creator (sender) × participant (receiver) ordered role
// pairs. Marker files serialize the join before the report and the report
// before done, so done always closes a reported loop.
export function loopScripts() {
  const creator = [
    { tool: 'h2a_loop_create', args: { id: LOOP_ID, goal: GOAL, instance: '$instance' } },
    { tool: 'h2a_loop_status', args: { loopId: LOOP_ID } },
    { tool: 'h2a_loop_list', args: {} },
    { waitForFile: 'participant-reported' },
    { tool: 'h2a_loop_done', args: { loopId: LOOP_ID, instance: '$instance', note: NOTE } },
    { tool: 'h2a_loop_status', args: { loopId: LOOP_ID } },
    { writeFile: 'creator-done' },
  ];
  const participant = [
    { tool: 'h2a_loop_join', args: { loopId: LOOP_ID, instance: '$instance' }, retryMs: 60000 },
    { tool: 'h2a_loop_report', args: { loopId: LOOP_ID, instance: '$instance', note: NOTE } },
    { tool: 'h2a_loop_status', args: { loopId: LOOP_ID } },
    { tool: 'h2a_loop_list', args: {} },
    { writeFile: 'participant-reported' },
    { waitForFile: 'creator-done' },
    { tool: 'h2a_loop_status', args: { loopId: LOOP_ID } },
  ];
  validateScriptSteps(creator);
  validateScriptSteps(participant);
  return { creator, participant };
}

// Loop refusal twins: single-peer scripts whose key step must fail.
export function loopTwinScripts(twin) {
  const scripts = {
    'join-unknown': [{ tool: 'h2a_loop_join', args: { loopId: 'xcli-no-such-loop', instance: '$instance' }, expectOk: false }],
    'report-without-join': [
      { tool: 'h2a_loop_create', args: { id: LOOP_ID, goal: GOAL, allowEmpty: true } },
      { tool: 'h2a_loop_report', args: { loopId: LOOP_ID, instance: '$instance', note: NOTE }, expectOk: false },
    ],
    // Spec deviation (product truth, runtime/loop/index.js): done/stop on a
    // terminal loop are idempotent by design, so a duplicate done cannot
    // refuse. The refusing duplicate-terminal transition is report-after-
    // done (`loop is terminal`), which this twin covers instead.
    'report-after-done': [
      { tool: 'h2a_loop_create', args: { id: LOOP_ID, goal: GOAL, instance: '$instance' } },
      { tool: 'h2a_loop_done', args: { loopId: LOOP_ID, instance: '$instance', note: NOTE } },
      { tool: 'h2a_loop_report', args: { loopId: LOOP_ID, instance: '$instance', note: NOTE }, expectOk: false },
    ],
  };
  assert.ok(scripts[twin], `unknown-scenario:loop:${twin}`);
  validateScriptSteps(scripts[twin]);
  return scripts[twin];
}

const NEGOTIATION_RECORD = Object.freeze({ id: NEGOTIATION_ID, scope: 'scope:xcli/scenario',
  parties: ['xcli:initiator', 'xcli:responder'], subject: 'contract', status: 'draft',
  requiredSigners: ['xcli:initiator', 'xcli:responder'] });
const ARTIFACT = Object.freeze({ kind: 'ENGAGEMENT', id: 'engagement:xcli', goal: GOAL });

// Negotiation flow: initiator × responder. Stabilization needs both sides'
// offers on the record before either side stabilizes.
export function negotiationScripts() {
  const initiator = [
    { tool: 'h2a_open_negotiation', args: { record: NEGOTIATION_RECORD } },
    { writeFile: 'negotiation-open' },
    { tool: 'h2a_offer', args: { negotiationId: NEGOTIATION_ID, instance: '$instance', artifact: ARTIFACT } },
    { tool: 'h2a_append_journal', args: { negotiationId: NEGOTIATION_ID, payload: { note: NOTE } } },
    { waitForFile: 'responder-offered' },
    { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID } },
    { tool: 'h2a_append_journal', args: { negotiationId: NEGOTIATION_ID, payload: { note: NOTE } } },
    { writeFile: 'initiator-stabilized' },
  ];
  const responder = [
    { waitForFile: 'negotiation-open' },
    { tool: 'h2a_counteroffer', args: { negotiationId: NEGOTIATION_ID, instance: '$instance', artifact: ARTIFACT } },
    { tool: 'h2a_append_journal', args: { negotiationId: NEGOTIATION_ID, payload: { note: NOTE } } },
    { writeFile: 'responder-offered' },
    { waitForFile: 'initiator-stabilized' },
    { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID } },
  ];
  validateScriptSteps(initiator);
  validateScriptSteps(responder);
  return { initiator, responder, openMarker: 'negotiation-open' };
}

// Negotiation refusal twins.
export function negotiationTwinScripts(twin) {
  const scripts = {
    'offer-unknown': [{ tool: 'h2a_offer', args: { negotiationId: 'xcli-no-such-nego',
      instance: '$instance', artifact: ARTIFACT }, expectOk: false }],
    'stabilize-without-offer': [
      { tool: 'h2a_open_negotiation', args: { record: NEGOTIATION_RECORD } },
      { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID }, expectOk: false },
    ],
    'replayed-stabilization': [
      { tool: 'h2a_open_negotiation', args: { record: NEGOTIATION_RECORD } },
      { tool: 'h2a_offer', args: { negotiationId: NEGOTIATION_ID, instance: '$instance', artifact: ARTIFACT } },
      { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID } },
      { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID }, expectOk: false },
    ],
  };
  assert.ok(scripts[twin], `unknown-scenario:negotiation:${twin}`);
  validateScriptSteps(scripts[twin]);
  return scripts[twin];
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
