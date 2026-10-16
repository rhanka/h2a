import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import { EvidenceAcceptances, recordShimAcceptance, shimAcceptanceRecorded } from '../src/runtime/handover/evidence.js';
import { evidenceFixture } from './helpers/mh-l3-evidence.js';
import { liveFixture } from './helpers/mh-l2-live.js';
import { shimEvidenceOptions } from '../src/runtime/handover/shim-evidence.js';
import { describeCatalogue } from '../src/runtime/handover/catalogue.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';
import { sign } from '../src/runtime/handover/wire.js';
import { join } from 'node:path';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { marker } from './helpers/mh-l0-fixtures.js';

test('evidence should accept an unknown delegated build and acknowledge only its exact transaction after commit', () => {
  const f = evidenceFixture(), cache = new EvidenceAcceptances(1);
  const receipt = cache.accept(f.proof, f.options);
  assert.equal(receipt.mode, 'handover');
  assert.equal(receipt.authorization.controllerEpoch, 2);
  assert.equal(cache.accept(f.proof, { ...f.options, now: 3000 }), receipt);
  assert.throws(() => cache.accept({ ...f.proof, challengeNonce: 'another' }, f.options), /acceptance_conflict/);
  const wrong = { ...f.options, expected: { ...f.options.expected, inventoryRevision: 4 } };
  assert.throws(() => cache.accept(f.proof, wrong), /acceptance_conflict/);
  assert.throws(() => new EvidenceAcceptances().accept(f.proof, { ...f.options, now: 2000 }), /challenge_invalid/);
  assert.throws(() => new EvidenceAcceptances().accept(f.proof, { ...f.options, delegation: { ...f.options.delegation, controllerEpoch: 3 } }), /delegation_mismatch/);
});

test('durable shim acceptance should survive a lost ACK only for its exact authenticated source and receipt', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l3-ack-'));
  try {
    const f = evidenceFixture(), receipt = new EvidenceAcceptances().accept(f.proof, f.options), m = { ...marker(), stateDirectory: directory };
    assert.equal(shimAcceptanceRecorded(m, f.options.rootKey, receipt), false);
    recordShimAcceptance(m, f.options.rootKey, receipt);
    assert.equal(shimAcceptanceRecorded(m, f.options.rootKey, receipt), true);
    recordShimAcceptance(m, f.options.rootKey, receipt);
    assert.equal(fs.readdirSync(directory).length, 1);
    assert.equal(shimAcceptanceRecorded({ ...m, root: '/another' }, f.options.rootKey, receipt), false);
    const path = join(directory, fs.readdirSync(directory)[0]), record = readState(path, 'shimAcceptance');
    replaceState(path, { ...record.value, mac: '0'.repeat(64) }, 'shimAcceptance', record);
    assert.equal(shimAcceptanceRecorded(m, f.options.rootKey, receipt), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ordinary catalogue evidence should bind durable delegation and the published target without granting transfer', () => {
  const f = liveFixture();
  try {
    f.step('reserve', f.payload());
    const transaction = f.admin.transaction();
    const descriptor = describeCatalogue([{ name: 'added', inputSchema: { type: 'object' }, description: 'fixture' }]);
    const published = { ...f.m, publicationEpoch: { ...f.m.publicationEpoch, counter: 2 }, descriptorDigest: descriptor.descriptorDigest, contractDigest: descriptor.contractDigest };
    replaceState(join(f.stateDirectory, f.admin.control().value.activeTransaction), { ...transaction.value, mode: 'catalogue',
      source: { ...transaction.value.source, publicationEpoch: published.publicationEpoch }, revision: transaction.value.revision + 1 }, 'componentTransaction', transaction);
    replaceState(f.markerPath, published, 'marker', readState(f.markerPath, 'marker'));
    const sourceView = { generation: null, buildId: 'embedded', profileId: 'linux-x64-node22', descriptorDigest: f.m.descriptorDigest, contractDigest: f.m.contractDigest };
    const { proof } = evidenceFixture({ mode: 'catalogue', namespaceId: published.namespaceId, root: f.root, uid: published.uid,
      attester: { generation: published.generation, publicationEpoch: published.publicationEpoch, processIdentity: published.processIdentity, buildId: published.buildId },
      verifier: { algorithmVersion: 'future', buildId: f.next.buildId, reportDigest: f.authorization.target.manifestDigest, verdict: 'additive-compatible' },
      source: sourceView, target: { generation: published.generation, publicationEpoch: published.publicationEpoch, endpoint: published.endpoint,
        buildId: published.buildId, manifestDigest: published.manifestDigest, descriptorDigest: descriptor.descriptorDigest, contractDigest: descriptor.contractDigest, catalogueRevision: 1 },
      authorization: f.authorization.authorization, attachmentId: 'a', inventoryRevision: f.authorization.inventoryRevision });
    const { mac, ...payload } = proof;
    proof.mac = sign(f.rootKey, 'compatibility', { service: published.service, namespaceId: published.namespaceId, generation: published.generation }, payload);
    const offer = { proof, report: { fixture: 'additive' }, descriptor, targetPublication: published, catalogueRevision: 1 };
    const context = { marker: published, markerPath: f.markerPath, rootKey: f.rootKey, installation: f.live.installation,
      sourceView, attachmentId: 'a', inventoryRevision: f.authorization.inventoryRevision, challengeNonce: proof.challengeNonce, now: 1500 };
    const receipt = new EvidenceAcceptances().accept(proof, shimEvidenceOptions(offer, context));
    assert.equal(receipt.mode, 'catalogue');
    assert.throws(() => shimEvidenceOptions({ ...offer, targetPublication: { ...published, generation: f.next.generation } }, context), /catalogue_target_not_published/);
    f.changeUpgrade({ controllerEpoch: 3 });
    assert.throws(() => shimEvidenceOptions(offer, context), /delegation_mismatch/);
  } finally { f.close(); }
});
