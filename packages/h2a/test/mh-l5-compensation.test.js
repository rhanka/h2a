import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { managedImage } from './helpers/mh-l5-image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';
import { launchCentral } from '../src/runtime/handover/launch.js';
import { runIsolatedPrecheck } from '../src/runtime/handover/precheck.js';
import { compensateCold } from '../src/runtime/handover/compensation.js';

test('M25 explicit compensation must start the verified pinned source image under new H4 epochs and a new real generation', async () => {
  const f = await managedImage();
  try {
    const source = await launchCentral(f.startOptions), g0 = source.marker;
    const sourceChild = f.children[0]; sourceChild.ref(); sourceChild.kill('SIGTERM'); await sourceChild.closedForTest;
    const directory = g0.stateDirectory, previousPath = join(directory, 'previous.json'), destination = join(directory, 'compensated.json');
    const frame = currentIdentity();
    const previous = { schemaVersion: 1, revision: 1, component: 'mcp', upgradeId: 'failed-upgrade', handoverId: 'failed-mcp', transactionEpoch: 1,
      mode: 'cold-stop', source: Object.fromEntries(['generation', 'publicationEpoch', 'processIdentity', 'packageVersion', 'buildId', 'manifestDigest'].map(k => [k, g0[k]])),
      target: { packageVersion: '0.98.8-fixture', buildId: 'failed', manifestDigest: digest('failed'), entrypoint: join(f.dir, 'failed.js') },
      coordinator: frame, controllerEpoch: 1, inventoryRevision: 1, state: 'SUCCESSOR_FAILED', barrierDeadline: null,
      precheckEvidenceDigest: digest('previous-precheck'), checkpointReferences: [], stepResults: {}, successorReservation: {
        attempts: 3, candidateIdentity: g0.processIdentity, selectionEpoch: 2, targetManifestDigest: digest('failed') } };
    publishState(previousPath, previous, 'componentTransaction');
    const controlPath = join(directory, 'component-control.json'), control = readState(controlPath, 'componentControl');
    replaceState(controlPath, { ...control.value, revision: control.value.revision + 1, activeTransaction: 'previous.json',
      transactionEpoch: 1, ownerState: 'CLOSED' }, 'componentControl', control);
    const selection = { ...f.selection, selectionEpoch: 3, upgradeId: 'compensation' };
    replaceState(f.selectionPath, selection, 'selection', readState(f.selectionPath, 'selection'));
    const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest, entrypoint: join(f.image, selection.entrypoint) };
    const precheck = await runIsolatedPrecheck(f.installation, target, 3, directory);
    const upgradePath = join(f.state, 'compensation.json');
    const upgrade = { schemaVersion: 1, upgradeId: 'compensation', revision: 1, prefixId: f.installation.prefixId,
      canonicalPrefix: f.dir, uid: process.getuid(), requestedTarget: 'source', resolvedTarget: target.packageVersion, artifactDigests: {},
      targetManifestDigest: target.manifestDigest, origin: 'compensation', initiatorIdentity: frame, controllerIdentity: frame,
      controllerBuildId: 'test-h4-controller', controllerEpoch: 2, controllerAuthorityState: 'ACTIVE', delegationState: 'NONE',
      delegatedBuildId: null, delegationReceiptDigest: null, privateTicketReference: null, installationState: 'SELECTED', selectionEpoch: 3,
      previousSelectionReference: null, componentTransactions: {}, observations: {}, verification: {}, createdAt: Date.now(), updatedAt: Date.now() };
    publishState(upgradePath, upgrade, 'upgradeTransaction');
    const transaction = await compensateCold(previousPath, destination, upgradePath, f.installation, precheck);
    assert.equal(transaction.transactionEpoch, 2); assert.equal(transaction.controllerEpoch, 2);
    assert.equal(transaction.successorReservation.attempts, 0); assert.equal(transaction.target.manifestDigest, g0.manifestDigest);
    assert.deepEqual(await compensateCold(previousPath, destination, upgradePath, f.installation, precheck), transaction);
    const successor = await launchCentral(f.startOptions), g1 = successor.marker;
    assert.notEqual(g1.generation, g0.generation); assert.notEqual(g1.pid, g0.pid);
    assert.equal(g1.manifestDigest, g0.manifestDigest); assert.equal(g1.buildId, g0.buildId);
    assert.equal(g1.predecessorGeneration, g0.generation); assert.ok(g1.publicationEpoch.counter > g0.publicationEpoch.counter);
    assert.equal(readState(previousPath, 'componentTransaction').value.state, 'SUCCESSOR_FAILED');
    assert.equal(readState(destination, 'componentTransaction').value.state, 'READY');
    assert.equal(readState(destination, 'componentTransaction').value.successorReservation.attempts, 1);
    assert.equal(readState(controlPath, 'componentControl').value.sourceGeneration, g1.generation);
    assert.equal(f.children.length, 2); assert.equal(fs.existsSync(join(directory, 'operator-stop.json')), false);
    assert.equal(JSON.parse(fs.readFileSync(join(f.image, 'manifest.json'))).buildId, g0.buildId);
  } finally { await f.close(); }
});
