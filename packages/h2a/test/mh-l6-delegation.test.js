import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { UpgradeStore } from '../dist/runtime/upgrade/h4-store.js';
import { installationFixture } from './helpers/mh-l6-installation.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';
import { digest } from '../src/runtime/handover/wire.js';
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
const worker = new URL('./helpers/mh-l6-controller.mjs', import.meta.url).href;
function reply(child) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('close', close); child.off('error', error); };
    const message = value => { cleanup(); resolve(value); };
    const close = () => { cleanup(); reject(new Error('controller_closed_before_reply')); };
    const error = value => { cleanup(); reject(value); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('controller_reply_budget_exceeded')); }, 5000);
    child.once('message', message); child.once('close', close); child.once('error', error);
  });
}
function fixture(t) {
  assert.equal(typeof UpgradeStore.prototype.delegate, 'function', 'durable target delegation required');
  const f = installationFixture(); t.after(() => f.close());
  const target = f.image('future-build-without-allowlist', 1, `import ${JSON.stringify(worker)};\n`);
  const store = new UpgradeStore(f.layout);
  store.begin({ upgradeId: 'one', target }); store.prepare('one'); store.select('one');
  return { ...f, target, store };
}
async function controller(t, f, entry = join(f.target.root, f.target.entrypoint)) {
  const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  // Node 22 manual IPC disconnect omits ChildProcess.close even after exit and
  // both pipes close. Require those three observable events independently.
  const closed = Promise.all([once(child, 'exit'), once(child.stdout, 'close'), once(child.stderr, 'close')]); let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.disconnect(); await closed; });
  const hello = await reply(child);
  assert.equal(hello.identity.pid, child.pid);
  return { child, closed, identity: hello.identity, output: () => output,
    async call(message) { const answer = reply(child); child.send({ layout: f.layout, upgradeId: 'one', ...message }); return await answer; } };
}

test('T5 should revoke the source before the exact future controller acquires and acknowledges once', async t => {
  const f = fixture(t), target = await controller(t, f);
  let handoff; assert.doesNotThrow(() => { handoff = f.store.delegate('one', target.identity); });
  assert.equal(handoff.transaction.controllerAuthorityState, 'REVOKED');
  assert.equal(handoff.transaction.installationState, 'DELEGATING');
  assert.equal(handoff.ticket.expectedRevision, handoff.transaction.revision);
  assert.equal(handoff.ticket.controllerEpoch, 2);
  assert.throws(() => f.store.assertMutationAuthority('one'), /controller_authority_revoked/);
  let repeated; assert.doesNotThrow(() => { repeated = f.store.delegate('one', target.identity); });
  assert.equal(digest(repeated), digest(handoff), 'lost source ACK reuses the same private ticket');
  const acquired = await target.call({ ticket: handoff.ticket });
  assert.equal(acquired.error, undefined, JSON.stringify(acquired));
  assert.equal(acquired.transaction.controllerAuthorityState, 'ACTIVE');
  assert.equal(acquired.transaction.delegationState, 'DELEGATED');
  assert.equal(acquired.transaction.installationState, 'ACTIVATING');
  assert.equal(acquired.transaction.controllerBuildId, f.target.buildId);
  assert.deepEqual(acquired.transaction.controllerIdentity, target.identity);
  const retry = await target.call({ ticket: handoff.ticket });
  assert.deepEqual(retry, acquired, 'lost target ACK must not increment revision/epoch');
  assert.equal((await target.call({ action: 'assert' })).transaction.controllerEpoch, 2);
  assert.throws(() => f.store.abort('one'), /controller_authority_revoked/);
  assert.equal(JSON.stringify(f.store.status('one')).includes(handoff.ticket.ticketNonce), false);
  assert.equal(target.output().includes(handoff.ticket.ticketNonce), false);
  const ticketPath = join(f.state, 'upgrade', handoff.transaction.privateTicketReference);
  assert.equal(fs.statSync(ticketPath).mode & 0o777, 0o600);
});

test('T5 should refuse every altered ticket binding and a second controller before granting authority', async t => {
  const f = fixture(t), target = await controller(t, f), other = await controller(t, f);
  const { ticket } = f.store.delegate('one', target.identity);
  for (const patch of [{ ticketNonce: 'forged' }, { upgradeId: 'other' }, { controllerEpoch: 3 }, { expectedRevision: 999 },
    { delegatedBuildId: 'other' }, { targetManifestDigest: 'sha256:' + 'f'.repeat(64) }, { delegatedControllerIdentity: other.identity }]) {
    const answer = await target.call({ ticket: { ...ticket, ...patch } });
    assert.match(answer.error ?? '', /delegation_ticket_mismatch/);
    assert.equal(f.store.status('one').controllerAuthorityState, 'REVOKED');
  }
  assert.match((await other.call({ ticket })).error ?? '', /delegation_identity_mismatch/);
  assert.equal((await target.call({ ticket })).transaction?.controllerAuthorityState, 'ACTIVE');
  assert.match((await other.call({ ticket })).error ?? '', /delegation_identity_mismatch/);
});

test('T5 should refuse a correctly identified process loaded outside the selected absolute entry', async t => {
  const f = fixture(t), rogue = join(f.layout.canonicalPrefix, 'rogue.mjs');
  fs.copyFileSync(join(f.target.root, f.target.entrypoint), rogue);
  const candidate = await controller(t, f, rogue), { ticket } = f.store.delegate('one', candidate.identity);
  assert.match((await candidate.call({ ticket })).error ?? '', /controller_entrypoint_mismatch/);
  assert.equal(f.store.status('one').controllerAuthorityState, 'REVOKED');
});

test('T5 should refuse an expired unacquired ticket and keep the source revoked', async t => {
  const f = fixture(t), target = await controller(t, f), now = Date.now();
  t.mock.method(Date, 'now', () => now - 3_600_000);
  const { ticket } = f.store.delegate('one', target.identity); t.mock.restoreAll();
  assert.match((await target.call({ ticket })).error ?? '', /delegation_ticket_expired/);
  assert.equal(f.store.status('one').controllerAuthorityState, 'REVOKED');
});

test('U05 should reconcile every ticket/revocation fsync cut before target acquisition', async t => {
  const sync = fs.fsyncSync;
  for (let failAt = 1; failAt <= 4; failAt++) {
    const f = fixture(t), target = await controller(t, f); let count = 0;
    t.mock.method(fs, 'fsyncSync', fd => { if (++count === failAt) throw new Error('injected_delegation_sync'); sync(fd); });
    assert.throws(() => f.store.delegate('one', target.identity), /injected_delegation_sync|persistence_indeterminate/);
    t.mock.restoreAll();
    const { ticket, transaction } = f.store.delegate('one', target.identity);
    assert.equal(transaction.controllerAuthorityState, 'REVOKED');
    const answer = await target.call({ ticket });
    assert.equal(answer.error, undefined, JSON.stringify(answer));
    assert.equal(answer.transaction.controllerEpoch, 2);
  }
});

test('U05 should reconcile receipt/acquisition fsync cuts without duplicate authority or false ACK', async t => {
  for (let faultAt = 1; faultAt <= 4; faultAt++) {
    const f = fixture(t), target = await controller(t, f), { ticket } = f.store.delegate('one', target.identity);
    const failed = await target.call({ ticket, faultAt });
    assert.match(failed.error ?? '', /injected_acquisition_sync|persistence_indeterminate/);
    assert.equal(failed.transaction, undefined);
    const answer = await target.call({ ticket });
    assert.equal(answer.error, undefined, JSON.stringify(answer));
    assert.equal(answer.transaction.controllerEpoch, 2);
    const receipt = readState(join(f.state, 'upgrade/receipts', answer.transaction.delegationReceiptDigest.slice(7) + '.json'), 'delegationReceipt').value;
    assert.equal(receipt.previousRevision, ticket.expectedRevision);
  }
});

test('T5 should suspend behind the real compatible guardian and reacquire after its proven death', async t => {
  const f = fixture(t), target = await controller(t, f), guardian = await controller(t, f);
  const { ticket } = f.store.delegate('one', target.identity);
  assert.equal((await guardian.call({ action: 'hold', prefix: f.layout.canonicalPrefix })).acquired, true);
  const before = JSON.stringify(f.store.status('one'));
  assert.match((await target.call({ ticket })).error ?? '', /legacy_lock_unavailable/);
  assert.equal(JSON.stringify(f.store.status('one')), before);
  guardian.child.kill('SIGKILL'); await guardian.closed; // Only this test's child PID.
  const answer = await target.call({ ticket });
  assert.equal(answer.error, undefined, JSON.stringify(answer));
  assert.equal(answer.transaction.controllerAuthorityState, 'ACTIVE');
  assert.equal(fs.existsSync(join(f.layout.canonicalPrefix, '.h2a-upgrade.lock')), false);
});

test('U05 should resynchronize a previously visible receipt before granting controller authority', async t => {
  const f = fixture(t), target = await controller(t, f), { ticket } = f.store.delegate('one', target.identity);
  assert.match((await target.call({ ticket, faultAt: 2 })).error ?? '', /persistence_indeterminate/);
  const retry = await target.call({ ticket, faultDirectory: 'receipts' });
  assert.match(retry.error ?? '', /injected_acquisition_sync|persistence_indeterminate/);
  assert.equal(f.store.status('one').controllerAuthorityState, 'REVOKED');
  assert.equal((await target.call({ ticket })).transaction?.controllerAuthorityState, 'ACTIVE');
});

test('U05 should resynchronize an uncertain acquisition before asserting mutation authority', async t => {
  const f = fixture(t), target = await controller(t, f), { ticket } = f.store.delegate('one', target.identity);
  assert.match((await target.call({ ticket, faultAt: 4 })).error ?? '', /persistence_indeterminate/);
  const uncertain = await target.call({ action: 'assert', faultDirectory: 'transactions' });
  assert.match(uncertain.error ?? '', /injected_acquisition_sync|persistence_indeterminate/);
  assert.equal(uncertain.transaction, undefined);
  assert.equal((await target.call({ action: 'assert' })).transaction?.controllerAuthorityState, 'ACTIVE');
});

test('T5 should refuse acquisition against a different durable revocation revision', async t => {
  const f = fixture(t), target = await controller(t, f), next = await controller(t, f), { ticket } = f.store.delegate('one', target.identity);
  const path = join(f.state, 'upgrade/transactions/one.json'), record = readState(path, 'upgradeTransaction');
  replaceState(path, { ...record.value, revision: record.value.revision + 1 }, 'upgradeTransaction', record);
  assert.match((await target.call({ ticket })).error ?? '', /delegation_revision_mismatch/);
  assert.equal(f.store.status('one').controllerAuthorityState, 'REVOKED');
  target.child.kill('SIGKILL'); await target.closed;
  assert.match((await next.call({ action: 'recover' })).error ?? '', /delegation_revision_mismatch/);
  assert.equal(f.store.status('one').controllerEpoch, 2);
});

test('T5 should refuse a corrupt delegation receipt before any further controller authority', async t => {
  const f = fixture(t), target = await controller(t, f), { ticket } = f.store.delegate('one', target.identity);
  const acquired = await target.call({ ticket }); assert.equal(acquired.error, undefined);
  const path = join(f.state, 'upgrade/receipts', acquired.transaction.delegationReceiptDigest.slice(7) + '.json');
  const record = readState(path, 'delegationReceipt');
  replaceState(path, { ...record.value, ticketDigest: 'sha256:' + 'f'.repeat(64) }, 'delegationReceipt', record);
  assert.match((await target.call({ action: 'assert' })).error ?? '', /RECOVERY_BLOCKED:delegation_receipt/);
  assert.match((await target.call({ ticket })).error ?? '', /RECOVERY_BLOCKED:delegation_receipt/);
});

test('T5 should replace a proven dead unacquired delegate with a new epoch and reject its old ticket', async t => {
  const f = fixture(t), old = await controller(t, f), next = await controller(t, f);
  const { ticket } = f.store.delegate('one', old.identity);
  assert.match((await next.call({ action: 'recover' })).error ?? '', /delegation_owner_not_dead/);
  old.child.kill('SIGKILL'); await old.closed;
  const recovered = await next.call({ action: 'recover' });
  assert.equal(recovered.error, undefined, recovered.error);
  assert.equal(recovered.transaction?.controllerEpoch, 3);
  assert.deepEqual(recovered.transaction.controllerIdentity, next.identity);
  assert.match((await next.call({ ticket })).error ?? '', /delegation_ticket_mismatch/);
});

test('T5 should recover a dead acquired controller from the exact selected image without reviving its source', async t => {
  const f = fixture(t), old = await controller(t, f), next = await controller(t, f);
  const { ticket } = f.store.delegate('one', old.identity);
  assert.equal((await old.call({ ticket })).transaction?.controllerAuthorityState, 'ACTIVE');
  assert.match((await next.call({ action: 'recover' })).error ?? '', /delegation_owner_not_dead/);
  old.child.kill('SIGKILL'); await old.closed;
  const recovered = await next.call({ action: 'recover' });
  assert.equal(recovered.error, undefined, recovered.error);
  assert.equal(recovered.transaction?.controllerEpoch, 3);
  assert.throws(() => f.store.assertMutationAuthority('one'), /controller_authority_revoked/);
  assert.equal((await next.call({ action: 'assert' })).transaction?.controllerEpoch, 3);
});

test('T5 should refuse a delegate death inferred from an incomparable process frame', async t => {
  const f = fixture(t), old = await controller(t, f), next = await controller(t, f);
  const { transaction } = f.store.delegate('one', old.identity);
  const path = join(f.state, 'upgrade', transaction.privateTicketReference), record = readState(path, 'delegationTicket');
  replaceState(path, { ...record.value, delegatedControllerIdentity: { ...old.identity,
    machineId: old.identity.machineId === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32) } }, 'delegationTicket', record);
  assert.match((await next.call({ action: 'recover' })).error ?? '', /delegation_owner_not_dead/);
  assert.equal(f.store.status('one').controllerEpoch, 2);
});
