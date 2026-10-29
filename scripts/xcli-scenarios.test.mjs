// Lot L12 RED set (SPEC v3 §5.1 scenario 2): unavailability must fail closed
// with its classified code — never a durable-only success worded as
// delivery, never wake credit — and refusal twins must observe rejection.
// Red while xcli-scenarios.mjs is absent or misclassifies any twin.
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CLIS } from './xcli-lab.mjs';
import { parseScenario, expectedScenarioBlocker, classifyScenarioRow, verifyScenarioMatrix,
  substituteScriptArgs, validateScriptSteps, loopScripts, loopTwinScripts,
  negotiationScripts, negotiationTwinScripts, inventoryScripts,
  LOOP_TWINS, NEGOTIATION_TWINS, INVENTORY_GROUPS,
  UNAVAILABILITY_STATES, REFUSAL_TWINS, SCENARIO_ROWS, UNKNOWN_INSTANCE } from './xcli-scenarios.mjs';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { environment, repo, removeReportedCampaignRoot, compliantQualificationRoot, sourceBuild, removeCampaignRoot } from './xcli-lab.mjs';

test('L12 review: unavailability requires an observed sender and the expected outcome', async t => {
  const root = compliantQualificationRoot();
  try {
    const built = sourceBuild(root);
    const receiver = join(root, 'receiver-model');
    const sender = join(root, 'dead-sender');
    fs.writeFileSync(receiver, `#!/bin/sh\nexec '${process.execPath}' '${join(repo, 'scripts/xcli-simulated-model.mjs')}' codex "$@"\n`, { mode: 0o700 });
    // Keep an inert sender alive until cleanup so proc pinning cannot race
    // /bin/true's immediate exit. It never loads MCP or attempts a send.
    fs.writeFileSync(sender, '#!/bin/sh\nexec sleep 60\n', { mode: 0o700 });
    const liveSender = join(root, 'sender-model');
    fs.writeFileSync(liveSender, `#!/bin/sh\nexec '${process.execPath}' '${join(repo, 'scripts/xcli-simulated-model.mjs')}' claude "$@"\n`, { mode: 0o700 });
    for (const live of [false, true]) for (const state of ['unknown-instance', 'stopped-receiver']) {
      await t.test(`${state}:${live ? 'live' : 'dead'}-sender`, () => {
        const scenario = `unavailability:${state}`;
        const request = { sender: 'claude', receiver: 'codex', root, build: built.path,
          executables: { claude: live ? liveSender : sender, codex: receiver }, simulated: true, timeoutMs: 20000,
          scenario, wake: { w0Ms: 13000, w1Ms: 13000, dMs: 3000 }, releaseOffsetMs: 0 };
        const run = spawnSync(process.execPath, [join(repo, 'scripts/qualify-cross-cli.mjs'), '--worker'], {
          env: { ...environment(join(root, 'runner')), H2A_TEST_QUALIFICATION_ROOT: root },
          input: JSON.stringify(request), encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
        });
        assert.equal(run.status, 0, run.stderr);
        const row = JSON.parse(run.stdout);
        const verdict = classifyScenarioRow(scenario, row);
        console.log({ scenario, senderMcp: row.senderMcp, sent: row.sent, failure: row.failure, verdict,
          infrastructureCode: row.infrastructureCode, infrastructureLocations: row.infrastructureLocations });
        assert.equal(row.senderMcp, live);
        assert.equal(row.sent, false);
        assert.equal(verdict.ok, live, 'qualification requires the sender to observe the expected refusal');
        if (live) {
          assert.equal(row.failure, undefined);
          assert.ok(row.evidence.some(e => e.role === 'sender' && e.event === 'send' && e.ok === false));
        }
      });
    }
  } finally { removeCampaignRoot(root); }
});

test('L15 review: read-paths data is ready when the peer markers are published', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-inventory-review-'));
  try {
    const worker = join(root, 'qualify.mjs'), output = join(root, 'receipt.json');
    const source = fs.readFileSync(join(repo, 'scripts/qualify-cross-cli.mjs'), 'utf8');
    const marker = "fs.writeFileSync(join(cell, 'peer-for-receiver'), senderReady.instance + '\\n', { mode: 0o600 });";
    assert.ok(source.includes(marker), 'the readiness publication must be instrumented');
    // Reproduce the reviewer's scheduling gap after readiness, without
    // changing the product or the peers that immediately consume its data.
    fs.writeFileSync(worker, source.replace(marker, marker + '\n        await sleep(500);')
      .replace(/'\.\/([^']+\.mjs)'/g, (_, name) => JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href)));
    const run = spawnSync(process.execPath, [worker, '--simulated', '--pair', 'claude:codex',
      '--scenario', 'inventory:read-paths', '--timeout-ms', '15000', '--output', output], {
      // Keep campaign allocations at the test's temporary parent: nesting
      // another root under env/tmp can exceed the Unix socket path limit.
      env: { ...environment(join(root, 'env')), TMPDIR: tmpdir() }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    removeReportedCampaignRoot(run.stdout);
    assert.ok(fs.existsSync(output), run.stdout + run.stderr);
    const cell = JSON.parse(fs.readFileSync(output)).cells[0];
    const proof = { inventoryOk: cell.inventoryOk, receiverScriptOk: cell.receiverScriptOk, senderScriptOk: cell.senderScriptOk };
    console.log(proof);
    // Scripted rows claim no wake: the runner returns 2, and the separate
    // scenario verifier decides whether the observed inventory is complete.
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.deepEqual(proof, { inventoryOk: true, receiverScriptOk: true, senderScriptOk: true });
    assert.equal(classifyScenarioRow('inventory:read-paths', cell).ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

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

function unavailableEvidence(scenario) {
  if (!scenario.startsWith('unavailability:')) return {};
  if (scenario.endsWith('identity-never-ready')) return { receiverMcp: true, evidence: [
    { role: 'receiver', event: 'initialize', ok: true },
    { role: 'receiver', event: 'tools', ok: true, messaging: true },
    { role: 'receiver', event: 'identity', ok: true, ready: false, state: 'identity_pending' },
    { role: 'receiver', event: 'readiness-deadline', mcpLoaded: true },
  ] };
  const unknown = scenario.endsWith('unknown-instance');
  return { senderMcp: true, evidence: [
    { role: 'sender', event: 'identity', ok: true, ready: true, instance: 'claude:sender' },
    { role: 'receiver', event: 'identity', ok: true, ready: true, instance: 'codex:receiver' },
    ...(!unknown ? [{ event: 'scenario-peer-stopped' }] : []),
    { role: 'sender', event: 'send', kind: 'probe', ok: false,
      requestedTo: unknown ? UNKNOWN_INSTANCE : 'codex:receiver',
      refusalCode: unknown ? 'unknown-instance' : 'recipient-not-live' },
  ] };
}

const closedRow = (scenario, pair, overrides = {}) => ({
  scenario, pair: pair ?? 'claude:codex', status: 'blocked',
  blocker: expectedScenarioBlocker(parseScenario(scenario)),
  sent: true, delivered: false, received: false, woke: false,
  replied: false, replyDelivered: false, ...unavailableEvidence(scenario), ...overrides });

test('L12 review: unavailability rejects missing, unrelated and wrong-result send evidence', () => {
  for (const state of ['unknown-instance', 'stopped-receiver']) {
    const scenario = `unavailability:${state}`;
    const good = closedRow(scenario);
    for (const overrides of [
      { senderMcp: false }, { evidence: [] },
      { evidence: good.evidence.map(e => e.event === 'send' ? { ...e, requestedTo: 'codex:other' } : e) },
      { evidence: good.evidence.map(e => e.event === 'send' ? { ...e, refusalCode: 'auth-failed' } : e) },
    ]) assert.equal(classifyScenarioRow(scenario, { ...good, ...overrides }).ok, false, `${state}:${JSON.stringify(overrides)}`);
  }
  const scenario = 'unavailability:unknown-instance';
  assert.equal(classifyScenarioRow(scenario, closedRow(scenario, undefined,
    { delivered: true, durableOnly: true })).ok, false, 'an unknown target cannot receive a durable landing');
});

test('R5: identity-never-ready requires live MCP and a witnessed non-ready identity gate', () => {
  const scenario = 'unavailability:identity-never-ready', good = closedRow(scenario);
  assert.equal(classifyScenarioRow(scenario, good).ok, true);
  for (const overrides of [
    { receiverMcp: false }, { evidence: [] },
    ...['initialize', 'tools', 'identity', 'readiness-deadline'].map(event => ({ evidence: good.evidence.filter(e => e.event !== event) })),
    { evidence: good.evidence.map(e => e.event === 'identity' ? { ...e, role: 'sender' } : e) },
    { evidence: good.evidence.map(e => e.event === 'identity' ? { ...e, ready: true, state: 'identity_ready' } : e) },
    { evidence: [...good.evidence, { role: 'receiver', event: 'scenario-identity-gate-held' },
      { role: 'receiver', event: 'identity', ok: true, ready: false, state: 'identity_failed' }] },
    { evidence: [...good.evidence, { role: 'receiver', event: 'cli-exit' }] },
  ]) assert.equal(classifyScenarioRow(scenario, { ...good, ...overrides }).ok, false, JSON.stringify(overrides));
});

test('L3/L12: a sender shard requires all six refusal pairs and never satisfies the full matrix', () => {
  const scenario = 'refusal:replayed-wake';
  const rows = CLIS.map(receiver => closedRow(scenario, `claude:${receiver}`,
    { phaseAReplyDelivered: true, refusalRejected: true, secondReply: false }));
  assert.equal(verifyScenarioMatrix(rows, scenario, 'claude').pass, true);
  assert.equal(verifyScenarioMatrix(rows, scenario).pass, false);
  assert.equal(verifyScenarioMatrix(rows.slice(1), scenario, 'claude').pass, false);
  assert.throws(() => verifyScenarioMatrix(rows, scenario, 'unknown'), /unknown scenario sender/);
});

test('L3 CI partitions preserve every polling period, Node version and ordered refusal pair', async () => {
  const { parse } = await import('yaml');
  const workflow = parse(fs.readFileSync(join(repo, '.github/workflows/cross-cli-messaging.yml'), 'utf8'));
  const polling = workflow.jobs['polling-controls'].strategy.matrix;
  assert.deepEqual(polling.node, ['22', '24']);
  assert.deepEqual(polling.period.map(Number), [1000, 5000, 15000, 45000, 90000]);
  const refusal = workflow.jobs['refusal-matrix'].strategy.matrix;
  assert.deepEqual(refusal.node, ['22', '24']);
  assert.deepEqual(refusal.senders.flatMap(group => group.split(' ')), CLIS);
  assert.deepEqual(refusal.scenario, ['refusal:unsigned-wake', 'refusal:misaddressed-wake', 'refusal:replayed-wake']);
  const { SCENARIO_ROWS } = await import('./xcli-scenarios.mjs');
  assert.deepEqual([...workflow.jobs['scenario-matrix'].strategy.matrix.scenario, ...refusal.scenario].sort(),
    [...SCENARIO_ROWS].sort());
});

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
  const extra = scenario => scenario.startsWith('refusal:')
    ? { refusalRejected: true, phaseAReplyDelivered: true }
    : scenario.startsWith('loop:') && !scenario.includes('lifecycle') ? { twinRefused: true }
    : scenario === 'loop:lifecycle' ? { loopTerminal: true }
    : scenario.startsWith('negotiation:') && scenario !== 'negotiation:flow' ? { twinRefused: true }
    : scenario === 'negotiation:flow' ? { stabilized: true, journalGrown: true }
    : { inventoryOk: true };
  const cells = SCENARIO_ROWS.flatMap(scenario => allPairs.map(pair => closedRow(scenario, pair, extra(scenario))));
  assert.equal(verifyScenarioMatrix(cells).pass, true);
  const missing = cells.filter(cell => cell.pair !== 'vibe:agy');
  const verdict = verifyScenarioMatrix(missing);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.some(f => f.includes('vibe:agy')), 'the missing pair is named');
});

test('L13: loop and negotiation specs parse to the closed vocabulary', () => {
  assert.equal(parseScenario('loop:lifecycle').name, 'lifecycle');
  for (const twin of ['join-unknown', 'report-without-join', 'report-after-done']) {
    assert.ok(parseScenario(`loop:${twin}`).twin === twin);
  }
  assert.equal(parseScenario('negotiation:flow').name, 'flow');
  for (const twin of ['offer-unknown', 'stabilize-without-offer', 'replayed-stabilization']) {
    assert.ok(parseScenario(`negotiation:${twin}`).twin === twin);
  }
  for (const group of ['read-paths', 'session-paths', 'conductor-paths', 'governance-paths']) {
    assert.equal(parseScenario(`inventory:${group}`).group, group);
  }
  assert.throws(() => parseScenario('loop:bogus'), /unknown-scenario/);
  assert.equal(expectedScenarioBlocker(parseScenario('loop:lifecycle')), 'loop-lifecycle-complete');
  assert.equal(expectedScenarioBlocker(parseScenario('loop:join-unknown')), 'loop-refused:join-unknown');
  assert.equal(expectedScenarioBlocker(parseScenario('negotiation:flow')), 'negotiation-flow-complete');
});

test('L13: script args substitute instance and saved ids, nothing else', () => {
  const args = substituteScriptArgs({ a: '$instance', b: 'x-$loop', c: ['$instance', 3], d: { e: '$loop' } },
    { instance: 'i1', loop: 'l9' });
  assert.deepEqual(args, { a: 'i1', b: 'x-$loop', c: ['i1', 3], d: { e: 'l9' } });
  assert.throws(() => validateScriptSteps([{ tool: 'h2a_loop_create' }]), /script-args-required/);
  assert.throws(() => validateScriptSteps([{ tool: 'rm', args: {} }]), /script-tool-not-h2a/);
  assert.doesNotThrow(() => validateScriptSteps(loopScripts().creator));
  assert.doesNotThrow(() => validateScriptSteps(loopScripts().participant));
  assert.doesNotThrow(() => validateScriptSteps(negotiationScripts().initiator));
  assert.doesNotThrow(() => validateScriptSteps(negotiationScripts().responder));
  for (const twin of LOOP_TWINS) assert.doesNotThrow(() => validateScriptSteps(loopTwinScripts(twin)));
  for (const twin of NEGOTIATION_TWINS) assert.doesNotThrow(() => validateScriptSteps(negotiationTwinScripts(twin)));
});

test('L13: loop lifecycle passes only on terminal state witnessed both sides', () => {
  const base = { scenario: 'loop:lifecycle', pair: 'claude:codex', status: 'blocked',
    blocker: 'loop-lifecycle-complete', loopTerminal: false };
  assert.equal(classifyScenarioRow('loop:lifecycle', base).ok, false);
  assert.equal(classifyScenarioRow('loop:lifecycle', { ...base, loopTerminal: true }).ok, true);
  const twin = { scenario: 'loop:join-unknown', pair: 'claude:codex', status: 'blocked',
    blocker: 'loop-refused:join-unknown', twinRefused: true };
  assert.equal(classifyScenarioRow('loop:join-unknown', twin).ok, true);
  assert.equal(classifyScenarioRow('loop:join-unknown', { ...twin, twinRefused: false }).ok, false);
});

test('L13: a participant waits for completed loop creation before mutating its state', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-loop-creation-'));
  try {
    // Widen the real create/enrol and truncate/write intervals in a private
    // build. Joining before create acknowledges can make its own enrol read
    // an incomplete participant write; retries then find the existing id.
    function delayPublication(build) {
      const handlersPath = join(build, 'packages/h2a/dist/runtime/mcp/handlers.js');
      const handlers = fs.readFileSync(handlersPath, 'utf8');
      const enrol = 'const host = loopHostFromPresence(root, args.instance);';
      assert.ok(handlers.includes(enrol), 'creator enrolment must be instrumented');
      fs.writeFileSync(handlersPath, handlers.replace(enrol,
        'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200); ' + enrol));
      const loopsPath = join(build, 'packages/h2a/dist/runtime/loop/index.js');
      const loops = fs.readFileSync(loopsPath, 'utf8');
      const write = 'function writeLoopState(root, loop) {';
      assert.ok(loops.includes(write), 'participant state write must be instrumented');
      fs.writeFileSync(loopsPath, loops.replace(write, write + `
if (process.env.H2A_NATIVE_TARGET_SESSION === 'h2a-receiver' && loop.id === 'xcli-loop') {
  writeFileSync(stateFile(root, loop.id), '', 'utf8');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
}`));
    }
    const source = fs.readFileSync(join(repo, 'scripts/qualify-cross-cli.mjs'), 'utf8');
    const marker = 'const built = sourceBuild(root);';
    assert.ok(source.includes(marker), 'the private build must be instrumented');
    const worker = join(root, 'qualify.mjs'), output = join(root, 'receipt.json');
    fs.writeFileSync(worker, source.replace(marker, () => marker + `\n(${delayPublication.toString()})(built.path);`)
      .replace(/'\.\/([^']+\.mjs)'/g, (_, name) => JSON.stringify(pathToFileURL(join(repo, 'scripts', name)).href)));
    const run = spawnSync(process.execPath, [worker, '--simulated', '--pair', 'codex:gemini',
      '--scenario', 'loop:lifecycle', '--timeout-ms', '15000', '--output', output], {
      env: { ...environment(join(root, 'env')), TMPDIR: tmpdir(),
        ...(process.env.XCLI_NODE_HEADERS ? { XCLI_NODE_HEADERS: process.env.XCLI_NODE_HEADERS } : {}) },
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    removeReportedCampaignRoot(run.stdout);
    assert.ok(fs.existsSync(output), run.stdout + run.stderr);
    const cell = JSON.parse(fs.readFileSync(output, 'utf8')).cells[0];
    const proof = { senderScriptOk: cell.senderScriptOk, receiverScriptOk: cell.receiverScriptOk, loopTerminal: cell.loopTerminal };
    console.log(proof);
    assert.equal(run.status, 2, 'scripted rows claim no wake');
    assert.deepEqual(proof, { senderScriptOk: true, receiverScriptOk: true, loopTerminal: true });
    assert.equal(classifyScenarioRow('loop:lifecycle', cell).ok, true);
    const creates = cell.evidence.filter(e => e.event === 'tool-call' && e.tool === 'h2a_loop_create');
    const joined = cell.evidence.find(e => e.event === 'tool-call' && e.tool === 'h2a_loop_join' && e.ok);
    assert.equal(creates.length, 1, 'the create must succeed without a duplicate-id retry');
    assert.equal(creates[0].ok, true);
    assert.ok(joined.at >= creates[0].at, 'participant mutation follows the successful create response');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L15: every inventory group builds valid two-sided scripts', () => {
  for (const group of INVENTORY_GROUPS) {
    const { receiver, sender } = inventoryScripts(group);
    assert.ok(receiver.length > 0 && sender.length > 0, `${group} scripts both sides`);
    const tools = new Set([...receiver, ...sender].filter(s => s.tool).map(s => s.tool));
    assert.ok([...tools].every(t => t.startsWith('h2a_')), `${group} closed tool vocabulary`);
  }
  assert.throws(() => inventoryScripts('bogus'), /unknown-scenario/);
  // Regression: every sign/offer/stabilize step names the negotiation its
  // flow opened (a hardcoded id fails closed with negotiation-not-found).
  for (const group of ['session-paths']) {
    const { receiver, sender } = inventoryScripts(group);
    const ids = new Set([...receiver, ...sender]
      .filter(s => ['h2a_offer', 'h2a_sign', 'h2a_stabilize'].includes(s.tool))
      .map(s => s.args.negotiationId));
    assert.equal(ids.size, 1, `${group} single negotiation id`);
  }
  const row = { scenario: 'inventory:read-paths', pair: 'claude:codex', status: 'blocked',
    blocker: 'inventory-complete:read-paths', inventoryOk: true };
  assert.equal(classifyScenarioRow('inventory:read-paths', row).ok, true);
  assert.equal(classifyScenarioRow('inventory:read-paths', { ...row, inventoryOk: false }).ok, false);
});

test('L14: negotiation flow passes only on stabilization with journal growth', () => {
  const base = { scenario: 'negotiation:flow', pair: 'claude:codex', status: 'blocked',
    blocker: 'negotiation-flow-complete', stabilized: false, journalGrown: false };
  assert.equal(classifyScenarioRow('negotiation:flow', base).ok, false);
  assert.equal(classifyScenarioRow('negotiation:flow',
    { ...base, stabilized: true, journalGrown: true }).ok, true);
  assert.equal(classifyScenarioRow('negotiation:flow',
    { ...base, stabilized: true, journalGrown: false }).ok, false);
});

test('L15: every served tool is covered by a scenario or named in the remainder', () => {
  const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  const src = fs.readFileSync(join(repoRoot, 'packages/h2a/dist/runtime/mcp/tools.js'), 'utf8');
  const served = new Set([...src.matchAll(/name: "(h2a_[a-z_]+)"/g)].map(m => m[1]));
  const covered = new Set(['h2a_identity_status', 'h2a_inbox', 'h2a_send']);
  const scripts = [loopScripts()];
  for (const twin of LOOP_TWINS) scripts.push({ creator: loopTwinScripts(twin), participant: [] });
  scripts.push(negotiationScripts());
  for (const twin of NEGOTIATION_TWINS) scripts.push({ initiator: negotiationTwinScripts(twin), responder: [] });
  for (const group of INVENTORY_GROUPS) scripts.push(inventoryScripts(group));
  for (const built of scripts) {
    for (const steps of Object.values(built)) {
      for (const step of steps) if (step.tool) covered.add(step.tool);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(join(repoRoot, 'docs/cross-cli-matrix.json'), 'utf8'));
  const remainder = manifest.rows.find(row => row.scenario === 'functions-remainder').tools;
  const uncovered = [...served].filter(tool => !covered.has(tool)).sort();
  const unpublished = remainder.filter(tool => !served.has(tool)).sort();
  assert.deepEqual(uncovered, remainder.filter(tool => served.has(tool)).sort(),
    'no served tool is neither covered nor listed');
  // Named-but-unpublished tools stay tracked in the remainder with their
  // blocker instead of vanishing from the inventory.
  assert.deepEqual(unpublished, ['h2a_drive_consent_cosign', 'h2a_drive_consent_request',
    'h2a_drive_consent_respond', 'h2a_drive_consent_revoke', 'h2a_drive_consent_status']);
});

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
