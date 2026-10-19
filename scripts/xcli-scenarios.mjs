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
    if (step.readVarFile !== undefined) {
      assert.ok(/^[a-z0-9][a-z0-9.-]{0,40}$/.test(step.readVarFile.name ?? ''), 'script-marker-name');
      assert.ok(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/.test(step.readVarFile.as ?? ''), 'script-var-name');
      continue;
    }
    if (step.saveVarFile !== undefined) {
      assert.ok(/^[a-z0-9][a-z0-9.-]{0,40}$/.test(step.saveVarFile.name ?? ''), 'script-marker-name');
      assert.ok(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/.test(step.saveVarFile.as ?? ''), 'script-var-name');
      continue;
    }
    assert.ok(typeof step.tool === 'string' && step.tool.startsWith('h2a_'), 'script-tool-not-h2a');
    assert.ok(step.args && typeof step.args === 'object', 'script-args-required');
    if (step.retryMs !== undefined) assert.ok(Number.isSafeInteger(step.retryMs) && step.retryMs > 0, 'script-retry-range');
    if (step.recoveryRef !== undefined) assert.equal(step.recoveryRef, true, 'script-recovery-ref-flag');
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
    { tool: 'h2a_loop_stop', args: { loopId: LOOP_ID, instance: '$instance', note: NOTE } },
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

export const SIGNER_A = 'xcli:signer-a';
export const SIGNER_B = 'xcli:signer-b';
const NEGOTIATION_RECORD = Object.freeze({ id: NEGOTIATION_ID, scope: 'scope:xcli/scenario',
  parties: [SIGNER_A, SIGNER_B], subject: 'contract', status: 'draft',
  requiredSigners: [SIGNER_A, SIGNER_B] });
const ARTIFACT = Object.freeze({ kind: 'ENGAGEMENT', id: 'engagement:xcli', goal: GOAL });

// Per-cell throwaway signing keys (Lot L14): the worker generates two
// ed25519 pairs per cell and passes them as $pubKeyA/$privKeyA/$pubKeyB/
// $privKeyB script vars (process env only, never disk, never evidence).
// Signer ids are fixed per-cell-store, so scripts stay deterministic.
// Signers carry PRINCIPAL (comprehension attestation requires it) plus
// CONDUCTOR (negotiation authority for ENGAGEMENT requires it).
const REGISTER_A = { tool: 'h2a_register_instance',
  args: { registration: { id: SIGNER_A, roles: ['PRINCIPAL', 'CONDUCTOR'], publicKeys: ['$pubKeyA'] } } };
const REGISTER_B = { tool: 'h2a_register_instance',
  args: { registration: { id: SIGNER_B, roles: ['PRINCIPAL', 'CONDUCTOR'], publicKeys: ['$pubKeyB'] } } };
const signStep = (signer, priv, negotiationId = NEGOTIATION_ID) => ({ tool: 'h2a_sign',
  args: { negotiationId, instance: signer, artifact: ARTIFACT, privateKeyPem: priv } });
// Journal appends must be entry-shaped: the stabilize posture derivation
// reads entry.actor.role, so a bare payload crashes it (product truth).
const journalStep = signer => ({ tool: 'h2a_append_journal', args: { negotiationId: NEGOTIATION_ID,
  payload: { actor: { instance: signer, role: 'CONDUCTOR', scope: 'scope:xcli/scenario' },
    body: { kind: 'xcli-note', note: NOTE } } } });

// Negotiation flow: initiator × responder. Stabilization needs both sides'
// SIGNATURES (h2a_sign) on the same artifact hash — offers alone never reach
// quorum. One side stabilizes; the second stabilize would throw
// already-stabilized, so the responder stops after signing.
export function negotiationScripts() {
  const initiator = [
    REGISTER_A,
    REGISTER_B,
    { tool: 'h2a_open_negotiation', args: { record: NEGOTIATION_RECORD } },
    { writeFile: 'negotiation-open' },
    { tool: 'h2a_offer', args: { negotiationId: NEGOTIATION_ID, instance: '$instance', artifact: ARTIFACT } },
    journalStep(SIGNER_A),
    { waitForFile: 'responder-offered' },
    signStep(SIGNER_A, '$privKeyA'),
    { waitForFile: 'responder-signed' },
    { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID } },
    journalStep(SIGNER_A),
    { writeFile: 'initiator-stabilized' },
  ];
  const responder = [
    { waitForFile: 'negotiation-open' },
    { tool: 'h2a_counteroffer', args: { negotiationId: NEGOTIATION_ID, instance: '$instance', artifact: ARTIFACT } },
    journalStep(SIGNER_B),
    { writeFile: 'responder-offered' },
    signStep(SIGNER_B, '$privKeyB'),
    { writeFile: 'responder-signed' },
    { waitForFile: 'initiator-stabilized' },
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
      REGISTER_A,
      REGISTER_B,
      { tool: 'h2a_open_negotiation', args: { record: NEGOTIATION_RECORD } },
      { tool: 'h2a_offer', args: { negotiationId: NEGOTIATION_ID, instance: '$instance', artifact: ARTIFACT } },
      signStep(SIGNER_A, '$privKeyA'),
      signStep(SIGNER_B, '$privKeyB'),
      { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID } },
      { tool: 'h2a_stabilize', args: { negotiationId: NEGOTIATION_ID }, expectOk: false },
    ],
  };
  assert.ok(scripts[twin], `unknown-scenario:negotiation:${twin}`);
  validateScriptSteps(scripts[twin]);
  return scripts[twin];
}

// Lot L15 homogenous inventory scripts. Peer crossing uses worker-written
// peer-id files (peer-for-sender / peer-for-receiver); readVarFile loads
// the other peer's enrolled id into $peer. $cwd is the peer workspace.
const PEER_FILE = role => role === 'sender' ? 'peer-for-sender' : 'peer-for-receiver';
// Bulk text travels as a worker-written marker file (readVarFile), never as
// process env. Sized past the default 1 MiB transport frame so the read
// response takes the real oversize path and yields a payload ref.
export const LARGE_TEXT = 'x'.repeat(1100000);

// Put envelopes must be protocol-valid (validateH2AEnvelope): the store
// refuses shapeless bodies before any delivery.
const putEnvelope = role => ({ protocol: 'sentropic.h2a', version: '0.1', id: `xcli-read-${role}`,
  type: 'event', actor: { instance: '$instance' }, body: { kind: 'xcli-note', text: '$large' },
  createdAt: new Date().toISOString() });

function readPathsScripts(role) {
  const other = role === 'sender' ? 'receiver' : 'sender';
  const smallEnvelope = { protocol: 'sentropic.h2a', version: '0.1', id: `xcli-read-small-${role}`,
    type: 'event', actor: { instance: '$instance' }, body: { kind: 'xcli-note', text: 'xcli' },
    createdAt: new Date().toISOString() };
  return [
    { waitForFile: PEER_FILE(role) },
    { readVarFile: { name: PEER_FILE(role), as: 'peer' } },
    { readVarFile: { name: 'large-text', as: 'large' } },
    { tool: 'h2a_identity_status', args: {} },
    { tool: 'h2a_discover_instances', args: {} },
    { tool: 'h2a_discover_sessions', args: { instance: '$instance' } },
    { tool: 'h2a_inbox', args: { action: 'put', instance: '$peer', envelope: putEnvelope(role) } },
    { tool: 'h2a_inbox', args: { action: 'put', instance: '$peer', envelope: smallEnvelope } },
    { writeFile: `${role}-put` },
    { waitForFile: `${other}-put` },
    // The large envelope forces the oversize path: read errors WITH the
    // recovery ref, which the peer consumes through read_payload.
    { tool: 'h2a_inbox', args: { action: 'read', instance: '$instance' }, saveAs: 'ref', recoveryRef: true },
    { saveVarFile: { as: 'ref', name: `${role}-ref` } },
    { waitForFile: `${other}-ref` },
    { readVarFile: { name: `${other}-ref`, as: 'peerRef' } },
    { tool: 'h2a_read_payload', args: { ref: '$peerRef' } },
    { tool: 'h2a_inbox', args: { action: 'pop', instance: '$instance', envelopeId: `xcli-read-small-${other}` } },
  ];
}

// h2a_run is excluded by design (spawns agent processes); the group covers
// register/open/close plus sign cross-verification (A signs, B stabilizes
// through product paths). The run row stays not-covered with its blocker.
const INV_SIGN_ID = 'xcli-inv-sign';
function sessionPathsScripts(role) {
  if (role === 'sender') {
    return [
      REGISTER_A,
      REGISTER_B,
      { tool: 'h2a_register_instance',
        args: { registration: { id: 'xcli:inventory-reg', roles: ['CONDUCTOR'] } } },
      { tool: 'h2a_open_negotiation', args: { record: { ...NEGOTIATION_RECORD, id: INV_SIGN_ID } } },
      { writeFile: 'inv-nego-open' },
      { tool: 'h2a_session_open', args: { instance: '$instance' }, saveAs: 'session' },
      { tool: 'h2a_offer', args: { negotiationId: INV_SIGN_ID, instance: '$instance', artifact: ARTIFACT } },
      signStep(SIGNER_A, '$privKeyA', INV_SIGN_ID),
      { waitForFile: 'inv-b-signed' },
      { tool: 'h2a_stabilize', args: { negotiationId: INV_SIGN_ID } },
      { tool: 'h2a_session_close', args: { sessionId: '$session' } },
      { writeFile: 'inv-a-closed' },
    ];
  }
  return [
    { waitForFile: 'inv-nego-open' },
    { tool: 'h2a_session_open', args: { instance: '$instance' }, saveAs: 'session' },
    signStep(SIGNER_B, '$privKeyB', INV_SIGN_ID),
    { writeFile: 'inv-b-signed' },
    { waitForFile: 'inv-a-closed' },
    { tool: 'h2a_session_close', args: { sessionId: '$session' } },
  ];
}

// Conductor paths with the contested-claim twin embedded: B claims A's
// held instance and must be refused before A releases.
function conductorPathsScripts(role) {
  if (role === 'sender') {
    return [
      { waitForFile: PEER_FILE(role) },
      { readVarFile: { name: PEER_FILE(role), as: 'peer' } },
      { tool: 'h2a_conductor', args: { workspacePath: '$cwd' } },
      { tool: 'h2a_conductor_claim', args: { instance: '$instance', workspacePath: '$cwd' } },
      { writeFile: 'conductor-held' },
      { tool: 'h2a_conductor_launch_check', args: { workspacePath: '$cwd' } },
      { tool: 'h2a_conductor_launch', args: { workspacePath: '$cwd' } },
      { tool: 'h2a_conductor_release', args: { instance: '$instance', workspacePath: '$cwd' } },
    ];
  }
  // Spec deviation (product truth): claims and releases are append-only —
  // a contested claim is accepted, never refused — so no refusal twin
  // exists in conductor paths. Both peers claim and release their own.
  return [
    { tool: 'h2a_conductor', args: { workspacePath: '$cwd' } },
    { waitForFile: 'conductor-held' },
    { tool: 'h2a_conductor_claim', args: { instance: '$instance', workspacePath: '$cwd' } },
    { tool: 'h2a_conductor_release', args: { instance: '$instance', workspacePath: '$cwd' } },
  ];
}

const INV_GOV_ID = 'xcli-inv-gov';
const GOV_RECORD = Object.freeze({ ...NEGOTIATION_RECORD, id: INV_GOV_ID });
function governancePathsScripts(role) {
  const signer = role === 'sender' ? SIGNER_A : SIGNER_B;
  const priv = role === 'sender' ? '$privKeyA' : '$privKeyB';
  const steps = [
    { tool: 'h2a_escalate', args: { negotiationId: INV_GOV_ID, instance: '$instance',
      channel: role === 'sender' ? 'advise' : 'decide' } },
    { tool: 'h2a_conflict_posture', args: { negotiationId: INV_GOV_ID } },
    { tool: 'h2a_declare_conflit_interet', args: { negotiationId: INV_GOV_ID, instance: '$instance',
      interets: [`scope:xcli/${role}`] } },
    { tool: 'h2a_blockage_raise', args: { instance: '$instance', reason: `xcli ${role}` } },
    { tool: 'h2a_blockage_list', args: {} },
    { tool: 'h2a_blockage_resolve', args: { instance: '$instance' } },
    { tool: 'h2a_nhi_inventory', args: {} },
    { tool: 'h2a_nhi_report', args: {} },
    { tool: 'h2a_nhi_attest', args: { instance: signer, privateKeyPem: priv,
      role: 'CONDUCTOR', scope: 'scope:xcli/scenario' } },
    { tool: 'h2a_attest_comprehension', args: { instance: signer, privateKeyPem: priv,
      role: 'PRINCIPAL', scope: 'scope:xcli/scenario',
      dossier: { title: 'xcli inventory', body: 'scenario comprehension' } } },
    { tool: 'h2a_nhi_export', args: { instance: '$instance', trustDomain: 'xcli-inventory' } },
  ];
  if (role === 'sender') {
    return [
      REGISTER_A,
      REGISTER_B,
      { tool: 'h2a_open_negotiation', args: { record: GOV_RECORD } },
      { writeFile: 'gov-open' },
      ...steps,
      { tool: 'h2a_nhi_offboard', args: { instance: '$instance', reason: 'xcli inventory end' } },
    ];
  }
  return [
    { waitForFile: 'gov-open' },
    ...steps,
    { tool: 'h2a_nhi_offboard', args: { instance: '$instance', reason: 'xcli inventory end' } },
  ];
}

export function inventoryScripts(group) {
  const builders = {
    'read-paths': readPathsScripts,
    'session-paths': sessionPathsScripts,
    'conductor-paths': conductorPathsScripts,
    'governance-paths': governancePathsScripts,
  };
  assert.ok(builders[group], `unknown-scenario:inventory:${group}`);
  const receiver = builders[group]('receiver');
  const sender = builders[group]('sender');
  validateScriptSteps(receiver);
  validateScriptSteps(sender);
  return { receiver, sender };
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
