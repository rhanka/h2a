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

const batch = () => [20000, 28000, 24000].map(releaseAt => ({
  woke: true, budgetMs: 45000, startedAt: new Date(0).toISOString(), noPostSendHarnessInput: true,
  wakeWindows: { barrierAt: 5000, w0Ms: 2000, w1Ms: 13000, dMs: 3000,
    releaseOffsetMs: releaseAt - 20000, notifyIntervalMs: 100, timestampUncertaintyMs: 1,
    deliveryAt: 7000, withholdAt: 5000, releaseAt, wakeAt: releaseAt + 200,
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
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
