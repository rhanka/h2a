import { digest, verify } from './wire.js';
import { validate } from './formats.js';

// First-acceptance provenance predicate. Transaction ACK/cache machinery is MH-L3.
// This verifies an authorized verdict, never its additive semantic correctness.
export function readCompatibilityEvidence(proof, options) {
  validate('compatibilityEvidence', proof);
  const { rootKey, context, expected, delegation, report, now, challengeNonce } = options;
  const { mac, ...payload } = proof;
  if (proof.namespaceId !== context.namespaceId || proof.attester.generation !== context.generation ||
      !verify(rootKey, 'compatibility', context, payload, mac)) throw new Error('evidence_authentication_failed');
  if (!Number.isSafeInteger(now) || now < proof.issuedAt || now >= proof.expiresAt ||
      proof.challengeNonce !== challengeNonce) throw new Error('evidence_challenge_invalid');
  for (const field of ['mode', 'namespaceId', 'root', 'uid', 'source', 'target', 'attester',
    'attachmentId', 'inventoryRevision', 'authorization']) {
    if (!Object.hasOwn(expected, field) || digest(expected[field]) !== digest(proof[field])) {
      throw new Error('evidence_binding_mismatch');
    }
  }
  if (digest(report) !== proof.verifier.reportDigest) throw new Error('evidence_report_mismatch');
  if (!delegation || delegation.controllerAuthorityState !== 'ACTIVE' || delegation.delegationState !== 'DELEGATED') {
    throw new Error('evidence_controller_unauthorized');
  }
  const a = proof.authorization;
  const bindings = { upgradeId: a.upgradeId, handoverId: a.handoverId, controllerEpoch: a.controllerEpoch,
    transactionEpoch: a.transactionEpoch, targetManifestDigest: a.selectedManifestDigest,
    controllerIdentity: a.delegatedControllerIdentity, delegatedBuildId: proof.verifier.buildId,
    delegationReceiptDigest: a.delegationReceiptDigest };
  for (const [key, value] of Object.entries(bindings)) {
    if (!Object.hasOwn(delegation, key) || digest(delegation[key]) !== digest(value)) {
      throw new Error('evidence_delegation_mismatch');
    }
  }
  return proof;
}
