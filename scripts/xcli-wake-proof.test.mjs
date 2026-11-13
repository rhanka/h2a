import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { verifyWakeBatch } from './xcli-ci-check.mjs';
import { journalNativeInput, correlateWakeInput } from './xcli-wake-host.mjs';
import { sourceBuild, PROBE } from './xcli-lab.mjs';

const batch = () => [26000, 34000, 30000].map(releaseAt => ({
  woke: true, budgetMs: 60000, startedAt: new Date(0).toISOString(), noPostSendHarnessInput: true,
  wakeWindows: { barrierAt: 0, w0Ms: 13000, w1Ms: 13000, dMs: 3000,
    releaseOffsetMs: releaseAt - 26000, notifyIntervalMs: 100, timestampUncertaintyMs: 1,
    deliveryAt: 13000, withholdAt: 0, releaseAt, wakeAt: releaseAt + 200,
    firstReadAt: releaseAt + 400, preBarrierReads: 0, baselineReads: 0, withheldReads: 0,
    inputJournal: { correlated: true, onlyWakeInput: true, writes: 2,
      lineAt: releaseAt + 100, submitAt: releaseAt + 200 } },
}));

test('L3 rejects separated cells without a correlated PTY input journal', () => {
  const cells = batch();
  for (const cell of cells) delete cell.wakeWindows.inputJournal;
  const verdict = verifyWakeBatch(cells);
  assert.equal(verdict.pass, false, 'event ordering cannot replace the actual PTY input witness');
});

test('L3 rejects a later withheld window that exceeds the original cell budget', () => {
  const cells = batch();
  cells[1].budgetMs = 25000;
  assert.equal(verifyWakeBatch(cells).pass, false, 'release offset and wake/read allowance must be funded');
});

test('L3 rejects credit when release/read ordering or the measured phases are invalid', () => {
  for (const mutate of [
    c => { c.wakeWindows.withheldReads = 1; },
    c => { c.wakeWindows.firstReadAt = c.wakeWindows.wakeAt - 1; },
    c => { c.wakeWindows.firstReadAt = c.wakeWindows.wakeAt + c.wakeWindows.dMs + 1; },
    c => { c.wakeWindows.releaseAt = c.wakeWindows.deliveryAt + 100; },
    c => { c.wakeWindows.notifyIntervalMs = 0; },
    c => { c.wakeWindows.inputJournal.onlyWakeInput = false; },
    c => { c.wakeWindows.inputJournal.submitAt += 1; },
  ]) {
    const cells = batch(); mutate(cells[0]);
    assert.equal(verifyWakeBatch(cells).pass, false);
  }
});

test('L3 accepts a funded, journal-correlated separated batch', () => {
  assert.equal(verifyWakeBatch(batch()).pass, true);
});

test('R31 release planning preserves separation after native sender-startup jitter', async () => {
  const { wakeSeparationTargets, planWakeRelease } = await import('./xcli-wake-schedule.mjs');
  // Actual R31 Vibe -> Codex timings relative to each idle barrier. All
  // reads met D, but the nominal offsets did not produce separated windows.
  const observations = [[37758, 52955, 55988, 60532, 0],
    [26847, 59896, 60677, 65453, 18000], [26322, 50512, 51233, 56158, 9000]];
  const cells = observations.map(([deliveryAt, releaseAt, wakeAt, firstReadAt, releaseOffsetMs]) => ({
    ...batch()[0], budgetMs: 180000, sender: 'vibe', receiver: 'codex',
    seats: { sender: 'vibe', receiver: 'codex' }, scenario: 'probe',
    wakeWindows: { ...batch()[0].wakeWindows, w0Ms: 15000, w1Ms: 15000,
      dMs: 10000, notifyIntervalMs: 5000, deliveryAt, releaseAt, wakeAt, firstReadAt,
      releaseOffsetMs, inputJournal: { correlated: true, onlyWakeInput: true, writes: 2,
        lineAt: wakeAt - 102, submitAt: wakeAt } },
  }));
  assert.equal(verifyWakeBatch(cells).pass, false, 'the old nominal schedule reproduces the real failure');
  const targets = wakeSeparationTargets([cells[0]]);
  const second = cells[1].wakeWindows;
  const planned = planWakeRelease({ ...second, targets });
  assert.ok(planned.releaseAt > second.releaseAt, 'hold for the actual prior acceptance window');
  second.releaseAt = planned.releaseAt;
  second.wakeAt = second.releaseAt + 800;
  second.firstReadAt = second.wakeAt + 4700;
  second.inputJournal.lineAt = second.wakeAt - 102;
  second.inputJournal.submitAt = second.wakeAt;
  assert.equal(verifyWakeBatch(cells).pass, true, 'the unchanged independent verifier accepts actual separated witnesses');
  assert.deepEqual(wakeSeparationTargets([{ ...cells[0], woke: false }]), []);
  const late = planWakeRelease({ ...second, deliveryAt: 70000, targets });
  assert.equal(late.releaseAt, 103000, 'a target whose acceptance already began cannot be claimed');
});

test('L3 baseline covers every polling period named in the exclusion claim', () => {
  const cells = batch();
  cells[0].wakeWindows.w0Ms = 2000;
  assert.equal(verifyWakeBatch(cells).pass, false, 'W0 must cover the claimed W1 exclusion period');
});

test('L3 journals successful host writes and rejects uncorrelated or additional input', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-input-proof-'));
  try {
    const built = sourceBuild(root);
    const product = await import(pathToFileURL(join(built.path, 'packages/h2a/dist/index.js')));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const receiver = 'codex:receiver';
    const probe = { id: 'probe:fixture', actor: { instance: 'claude:sender' }, target: { instance: receiver },
      body: { kind: 'message', text: PROBE }, createdAt: new Date(1700000000000 - 2000).toISOString() };
    const send = { envelopeId: probe.id, from: probe.actor.instance };
    const at = 1700000000000;
    const line = product.formatSignedDriveInstruction({ from: receiver, to: receiver,
      instruction: product.formatWakeLine([probe], new Date(at).toISOString()),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), now: () => at });
    let clock = at;
    class Host {
      write(lease) { if (lease.epoch !== 1) throw new Error('stale lease'); }
      releaseController() { return 'released'; }
    }
    const file = join(root, 'journal.jsonl');
    journalNativeInput(Host, file, () => clock);
    const host = new Host();
    const lease = { id: 'h2a-receiver', incarnation: 'fixture', controllerId: 'h2a-drive-123', epoch: 1 };
    host.write(lease, line); clock += 100; host.write(lease, '\r');
    assert.throws(() => host.write({ ...lease, epoch: 2 }, 'unaccepted input'), /stale lease/);
    assert.equal(host.releaseController(lease), 'released');
    const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 3, 'a rejected write is never journaled as an accepted input');
    const context = { target: lease, barrierAt: at - 20000, releaseAt: at - 1000, send, receiver, probe, product,
      store: { listInstanceKeys: () => [publicKey.export({ type: 'spki', format: 'pem' })] } };
    const proof = correlateWakeInput(records, context);
    assert.equal(proof.correlated, true);
    assert.equal(proof.onlyWakeInput, true);
    assert.match(proof.lineSha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(proof).includes(line), 'the published witness retains no raw input');
    for (const broken of [
      [...records, { ...records[1], data: '\r' }],
      records.map((r, i) => i === 0 ? { ...r, data: line.replace('sig=', 'sig=bad') } : r),
      records.map((r, i) => i === 1 ? { ...r, controllerId: 'other' } : r),
      records.map((r, i) => i === 0 ? { ...r, at: context.releaseAt - 1 } : r),
    ]) assert.equal(correlateWakeInput(broken, context).correlated, false);
    assert.equal(correlateWakeInput(records, { ...context, probe: { ...probe, body: { topic: 'other' } } }).correlated, false);

    const muse = 'muse:receiver';
    const museProbe = { ...probe, target: { instance: muse } };
    const museLine = product.formatSignedDriveInstruction({ from: muse, to: muse,
      instruction: product.formatWakeLine([museProbe], new Date(at).toISOString()),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), now: () => at });
    const bracketed = records.map((r, i) => i === 0 ? { ...r, data: `\x1b[200~${museLine}\x1b[201~` } : r);
    const museContext = { ...context, receiver: muse, probe: museProbe };
    assert.equal(correlateWakeInput(bracketed, museContext).correlated, true,
      'R36: exact Muse paste framing preserves the signed payload and the two-write proof');
    for (const malformed of [
      `${museLine}\x1b[201~`, `\x1b[200~${museLine}`, `\x1b[200~${museLine}\x1b[201~extra`,
      `\x1b[200~${museLine.replace('sig=', 'sig=bad')}\x1b[201~`,
      `\x1b[200~${museLine}\r\x1b[201~`,
    ]) assert.equal(correlateWakeInput(bracketed.map((r, i) => i === 0 ? { ...r, data: malformed } : r), museContext).correlated, false);
    assert.equal(correlateWakeInput(bracketed, context).correlated, false, 'framing cannot forge a different receiver');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
