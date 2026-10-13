import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marker, identity, hash } from './helpers/mh-l0-fixtures.js';
import { digest } from '../src/runtime/handover/wire.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';

test('compensation should require new ACTIVE H4 authority, a verified source image and proven absence; never reopen G0', async () => {
  const { prepareCompensation } = await import('../src/runtime/handover/compensation.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-compensation-'));
  try {
    const images = join(dir, 'images'), state = join(dir, 'state');
    fs.mkdirSync(images, { mode: 0o700 }); fs.mkdirSync(state, { mode: 0o700 });
    const payload = join(dir, 'payload'); fs.mkdirSync(payload, { mode: 0o700 });
    fs.writeFileSync(join(payload, 'entry.js'), 'export const fixture=true;\n', { mode: 0o600 });
    const manifest = createManifest(payload, { packageVersion: '0.98.7', buildId: 'previous-source', profile: {
      platform: 'linux', arch: process.arch, libc: 'glibc', nodeMajor: Number(process.versions.node.split('.')[0]), nodeAbi: process.versions.modules },
      entrypoints: { cli: 'entry.js' }, startupWaitBudgetMs: 10000, maxAttachments: 32, nativeArtifacts: [] });
    const manifestDigest = digest(manifest), image = join(images, manifestDigest.slice(7));
    fs.renameSync(payload, image); fs.writeFileSync(join(image, 'manifest.json'), JSON.stringify(manifest));
    const installation = { canonicalPrefix: dir, managedRoot: dir, uid: process.getuid(), prefixId: digest({ canonicalPrefix: dir, uid: process.getuid() }) };
    const m = marker(), previousPath = join(state, 'previous.json'), destination = join(state, 'compensated.json');
    const previous = { schemaVersion: 1, revision: 1, component: 'mcp', upgradeId: 'u1', handoverId: 'h1', transactionEpoch: 1, mode: 'cold-stop',
      source: { generation: m.generation, publicationEpoch: m.publicationEpoch, processIdentity: identity, packageVersion: manifest.packageVersion,
        buildId: manifest.buildId, manifestDigest }, target: { packageVersion: '0.98.8', buildId: 'failed', manifestDigest: hash, entrypoint: '/lab/failed.js' },
      coordinator: identity, controllerEpoch: 1, inventoryRevision: 1, state: 'SUCCESSOR_FAILED', barrierDeadline: null,
      precheckEvidenceDigest: hash, checkpointReferences: [], stepResults: {}, successorReservation: {
        attempts: 3, candidateIdentity: { ...identity, pid: 124 }, selectionEpoch: 2, targetManifestDigest: hash } };
    publishState(previousPath, previous, 'componentTransaction');
    publishState(join(state, 'component-control.json'), { schemaVersion: 1, revision: 1, activeTransaction: 'previous.json',
      sourceGeneration: m.generation, ownerIdentity: identity, ownerState: 'CLOSED',
      transactionEpoch: 1, operatorStopCommitted: false, operatorStopped: true }, 'componentControl');
    const selection = { schemaVersion: 1, prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(), selectionEpoch: 3,
      packageVersion: manifest.packageVersion, buildId: manifest.buildId, manifestDigest, entrypoint: 'entry.js', previousSelectionReference: null, upgradeId: 'u2' };
    publishState(join(state, 'selected-build.json'), selection, 'selection');
    const upgradePath = join(state, 'upgrade.json');
    const upgrade = { schemaVersion: 1, upgradeId: 'u2', revision: 1, prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(),
      requestedTarget: 'source', resolvedTarget: '0.98.7', artifactDigests: {}, targetManifestDigest: manifestDigest, origin: 'compensation',
      initiatorIdentity: identity, controllerIdentity: identity, controllerBuildId: 'controller', controllerEpoch: 2, controllerAuthorityState: 'ACTIVE',
      delegationState: 'NONE', delegatedBuildId: null, delegationReceiptDigest: null, privateTicketReference: null,
      installationState: 'SELECTED', selectionEpoch: 3, previousSelectionReference: null, componentTransactions: {}, observations: {}, verification: {}, createdAt: 1, updatedAt: 1 };
    publishState(upgradePath, upgrade, 'upgradeTransaction');
    const evidence = { schemaVersion: 1, targetBuildId: manifest.buildId, targetManifestDigest: manifestDigest, targetEntrypoint: join(image, 'entry.js'),
      selectionEpoch: 3, trialIdentity: identity, elapsedMs: 1, cleanupVerified: true };
    const precheckEvidenceDigest = digest(evidence);
    publishState(join(state, `precheck-${precheckEvidenceDigest.slice(7)}.json`), evidence, 'precheckEvidence');
    const options = { frame: identity, observe: () => ({ absent: true, visible: true }), precheckEvidenceDigest };
    assert.throws(() => prepareCompensation(previousPath, destination, upgradePath, installation, {
      ...options, observe: () => ({ startTime: identity.startTime }) }), /compensation_candidate_unproven/);
    let old = readState(upgradePath, 'upgradeTransaction');
    replaceState(upgradePath, { ...upgrade, revision: 2, controllerAuthorityState: 'REVOKED' }, 'upgradeTransaction', old);
    assert.throws(() => prepareCompensation(previousPath, destination, upgradePath, installation, options), /compensation_controller_unqualified/);
    old = readState(upgradePath, 'upgradeTransaction'); replaceState(upgradePath, { ...upgrade, revision: 3 }, 'upgradeTransaction', old);
    const result = prepareCompensation(previousPath, destination, upgradePath, installation, options);
    assert.equal(result.state, 'STOPPED'); assert.equal(result.transactionEpoch, 2); assert.equal(result.controllerEpoch, 2);
    assert.equal(result.target.buildId, 'previous-source'); assert.equal(result.successorReservation.attempts, 0);
    assert.equal(readState(previousPath, 'componentTransaction').value.state, 'SUCCESSOR_FAILED');
    assert.equal(readState(join(state, 'component-control.json'), 'componentControl').value.activeTransaction, 'compensated.json');
    assert.equal(fs.existsSync(join(state, 'marker.json')), false);
    assert.deepEqual(prepareCompensation(previousPath, destination, upgradePath, installation, options), result);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
