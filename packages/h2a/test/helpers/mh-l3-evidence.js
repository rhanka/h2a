import { evidence, marker } from './mh-l0-fixtures.js';
import { digest, sign } from '../../src/runtime/handover/wire.js';
export function evidenceFixture(changes = {}) {
  const proof = { ...evidence(), ...changes }, rootKey = Buffer.alloc(32, 3), m = marker(), report = { fixture: 'additive' };
  proof.verifier = { ...proof.verifier, reportDigest: digest(report) };
  const context = { service: m.service, namespaceId: m.namespaceId, generation: m.generation };
  const { mac, ...payload } = proof; proof.mac = sign(rootKey, 'compatibility', context, payload);
  const expected = Object.fromEntries(['mode', 'namespaceId', 'root', 'uid', 'source', 'target', 'attester', 'attachmentId', 'inventoryRevision', 'authorization'].map(k => [k, structuredClone(proof[k])]));
  const a = proof.authorization;
  const delegation = { controllerAuthorityState: 'ACTIVE', delegationState: 'DELEGATED', upgradeId: a.upgradeId,
    handoverId: a.handoverId, controllerEpoch: a.controllerEpoch, transactionEpoch: a.transactionEpoch,
    targetManifestDigest: a.selectedManifestDigest, controllerIdentity: a.delegatedControllerIdentity,
    delegatedBuildId: proof.verifier.buildId, delegationReceiptDigest: a.delegationReceiptDigest };
  return { proof, options: { rootKey, context, expected, delegation, report, now: 1500, challengeNonce: proof.challengeNonce } };
}
