// Lot L12 RED set (SPEC v3 §5.1 scenario 2): unavailability must fail closed
// with its classified code — never a durable-only success worded as
// delivery, never wake credit — and refusal twins must observe rejection.
// Red while xcli-scenarios.mjs is absent or misclassifies any twin.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CLIS } from './xcli-lab.mjs';
import { parseScenario, expectedScenarioBlocker, classifyScenarioRow, verifyScenarioMatrix,
  UNAVAILABILITY_STATES, REFUSAL_TWINS, SCENARIO_ROWS } from './xcli-scenarios.mjs';

test('L12: scenario specs parse to a closed vocabulary', () => {
  assert.equal(parseScenario('probe').kind, 'probe');
  for (const state of UNAVAILABILITY_STATES) {
    assert.equal(parseScenario(`unavailability:${state}`).state, state);
  }
  for (const twin of REFUSAL_TWINS) {
    assert.equal(parseScenario(`refusal:${twin}`).twin, twin);
  }
  for (const bad of ['pool', 'unavailability:bogus', 'refusal:bogus', 'unavailability:', '']) {
    assert.throws(() => parseScenario(bad), /unknown-scenario/);
  }
});

test('L12: every scenario row names its closed blocker code', () => {
  assert.deepEqual([...UNAVAILABILITY_STATES].sort(),
    ['identity-never-ready', 'stopped-receiver', 'unknown-instance']);
  assert.deepEqual([...REFUSAL_TWINS].sort(),
    ['misaddressed-wake', 'replayed-wake', 'unsigned-wake']);
  assert.equal(expectedScenarioBlocker(parseScenario('unavailability:stopped-receiver')), 'receiver-unavailable');
  assert.equal(expectedScenarioBlocker(parseScenario('unavailability:unknown-instance')), 'unknown-instance');
  assert.equal(expectedScenarioBlocker(parseScenario('unavailability:identity-never-ready')), 'identity-never-ready');
  for (const twin of REFUSAL_TWINS) {
    assert.equal(expectedScenarioBlocker(parseScenario(`refusal:${twin}`)), `wake-refused:${twin}`);
  }
});

const closedRow = (scenario, pair, overrides = {}) => ({
  scenario, pair: pair ?? 'claude:codex', status: 'blocked',
  blocker: expectedScenarioBlocker(parseScenario(scenario)),
  sent: true, delivered: false, received: false, woke: false,
  replied: false, replyDelivered: false, ...overrides });

test('L12: clean fail-closed unavailability rows classify scenario-OK', () => {
  for (const state of UNAVAILABILITY_STATES) {
    const verdict = classifyScenarioRow(`unavailability:${state}`, closedRow(`unavailability:${state}`));
    assert.equal(verdict.ok, true, state);
  }
});

test('L12: durable-only success is never worded as delivery', () => {
  const unmarked = closedRow('unavailability:stopped-receiver', 'claude:codex', { delivered: true });
  assert.equal(classifyScenarioRow('unavailability:stopped-receiver', unmarked).ok, false);
  assert.match(classifyScenarioRow('unavailability:stopped-receiver', unmarked).code, /scenario-live-claim/);
  const marked = closedRow('unavailability:stopped-receiver', 'claude:codex', { delivered: true, durableOnly: true });
  assert.equal(classifyScenarioRow('unavailability:stopped-receiver', marked).ok, true);
});

test('L12: wake credit on an unavailable peer fails the row', () => {
  const credited = closedRow('unavailability:stopped-receiver', 'claude:codex', { woke: true, received: true });
  assert.equal(classifyScenarioRow('unavailability:stopped-receiver', credited).ok, false);
});

test('L12: wrong blocker code fails the row', () => {
  const wrong = closedRow('unavailability:unknown-instance', 'claude:codex', { blocker: 'sender-send-not-observed' });
  const verdict = classifyScenarioRow('unavailability:unknown-instance', wrong);
  assert.equal(verdict.ok, false);
  assert.match(verdict.code, /scenario-wrong-blocker/);
});

test('L12: refusal twins pass only on observed rejection after a live phase A', () => {
  for (const twin of REFUSAL_TWINS) {
    const scenario = `refusal:${twin}`;
    const accepted = closedRow(scenario, 'claude:codex', { refusalRejected: true, phaseAReplyDelivered: true });
    assert.equal(classifyScenarioRow(scenario, accepted).ok, true, twin);
    const repliedTwice = { ...accepted, secondReply: true };
    assert.equal(classifyScenarioRow(scenario, repliedTwice).ok, false, `${twin} second reply`);
    const noPhaseA = { ...accepted, phaseAReplyDelivered: false };
    assert.equal(classifyScenarioRow(scenario, noPhaseA).ok, false, `${twin} dead runner`);
    const noRejection = { ...accepted, refusalRejected: false };
    assert.equal(classifyScenarioRow(scenario, noRejection).ok, false, `${twin} no rejection`);
  }
});

test('L12: the verdict scopes to one row with --only', () => {
  const allPairs = CLIS.flatMap(sender => CLIS.map(receiver => `${sender}:${receiver}`));
  const cells = allPairs.map(pair => closedRow('unavailability:stopped-receiver', pair));
  assert.equal(verifyScenarioMatrix(cells, 'unavailability:stopped-receiver').pass, true);
  assert.equal(verifyScenarioMatrix(cells).pass, false);
});

test('L12: the S matrix verdict requires all 36 pairs on every scenario row', () => {
  const allPairs = CLIS.flatMap(sender => CLIS.map(receiver => `${sender}:${receiver}`));
  const cells = SCENARIO_ROWS.flatMap(scenario => allPairs.map(pair => closedRow(scenario, pair,
    scenario.startsWith('refusal:') ? { refusalRejected: true, phaseAReplyDelivered: true } : {})));
  assert.equal(verifyScenarioMatrix(cells).pass, true);
  const missing = cells.filter(cell => cell.pair !== 'vibe:agy');
  const verdict = verifyScenarioMatrix(missing);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some(f => f.includes('vibe:agy')), 'the missing pair is named');
});

// Guard level: the exact product crypto the scenario runner relies on.
// Unsigned, mis-addressed, and replayed wakes must all verify false.
const build = new URL('../packages/h2a/dist/index.js', import.meta.url).pathname;
const { formatSignedDriveInstruction, verifySignedDriveInstruction, verifyDriveOnReceive,
  createReplayGuard } = await import(pathToFileURL(build).href);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const mint = (to, instruction = '[h2a-wake reason=inbox test] automatic message from h2a.') =>
  formatSignedDriveInstruction({ from: 'instance-a', to, instruction, privateKeyPem: privatePem });

test('L12: a tampered signature verifies false (unsigned twin guard)', () => {
  const line = mint('instance-b');
  const tampered = line.replace(/sig=[^\]]+/, 'sig=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const verdict = verifySignedDriveInstruction(tampered, { resolvePublicKeys: () => [publicPem],
    guard: createReplayGuard(), now: Date.now() });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'bad-signature');
});

test('L12: a wake for another instance verifies target-mismatch (misaddressed twin guard)', () => {
  const verdict = verifyDriveOnReceive({}, mint('someone-else'), { to: 'instance-b', guard: createReplayGuard(), now: Date.now() });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'target-mismatch');
});

test('L12: a replayed wake verifies false on second delivery (replayed twin guard)', () => {
  const guard = createReplayGuard();
  const line = mint('instance-b');
  const first = verifySignedDriveInstruction(line, { resolvePublicKeys: () => [publicPem], guard, now: Date.now() });
  assert.equal(first.ok, true, 'first delivery verifies');
  const second = verifySignedDriveInstruction(line, { resolvePublicKeys: () => [publicPem], guard, now: Date.now() });
  assert.equal(second.ok, false, 'replay verifies false');
});
