import { digest, verify, sign } from './wire.js';
import { validate } from './formats.js';
import { readState, publishState } from './state.js';
import { join } from 'node:path';

// First-acceptance provenance predicate.
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

const accepted = new WeakSet();
export const isCompatibilityAcceptance = receipt => Boolean(receipt && accepted.has(receipt));

// Only an exact accepted proof may be replayed after expiry/commit. This cache
// grants no publication, acquisition, restart or stop authority.
export class EvidenceAcceptances {
  constructor(capacity = 128) { this.capacity = capacity; this.receipts = new Map(); }
  accept(proof, options) {
    const key = `${proof.attachmentId}/${proof.proofId}`, fingerprint = digest({ proof, expected: options.expected, challengeNonce: options.challengeNonce, report: options.report });
    const old = this.receipts.get(key);
    if (old) { if (old.fingerprint !== fingerprint) throw new Error('evidence_acceptance_conflict'); return old.receipt; }
    if (this.receipts.size >= this.capacity) throw new Error('evidence_acceptance_capacity');
    readCompatibilityEvidence(proof, options);
    const receipt = Object.freeze({ proofId: proof.proofId, proofDigest: digest(proof), attachmentId: proof.attachmentId,
      authorization: structuredClone(proof.authorization), mode: proof.mode,
      sourceContractDigest: proof.source.contractDigest, targetDescriptorDigest: proof.target.descriptorDigest });
    accepted.add(receipt); this.receipts.set(key, { fingerprint, receipt }); return receipt;
  }
}

const acknowledgementPath = (marker, receipt) => join(marker.stateDirectory,
  `shim-acceptance-${digest({ generation: marker.generation, attachmentId: receipt.attachmentId, proofDigest: receipt.proofDigest }).slice(7)}.json`);
const acknowledgementContext = m => ({ service: m.service, namespaceId: m.namespaceId, generation: m.generation });
export function recordShimAcceptance(marker, key, receipt) {
  const value = { schemaVersion: 1, sourceGeneration: marker.generation, sourceMarkerDigest: digest(marker), receipt };
  const record = { ...value, mac: sign(key, 'compatibility', acknowledgementContext(marker), value) };
  const path = acknowledgementPath(marker, receipt), old = readState(path, 'shimAcceptance');
  if (old && digest(old.value) !== digest(record)) throw new Error('shim_ack_conflict');
  if (!old) publishState(path, record, 'shimAcceptance');
}
export function shimAcceptanceRecorded(marker, key, receipt) {
  const record = readState(acknowledgementPath(marker, receipt), 'shimAcceptance')?.value;
  if (!record) return false;
  const { mac, ...value } = record;
  return record.sourceGeneration === marker.generation && record.sourceMarkerDigest === digest(marker) && digest(record.receipt) === digest(receipt) &&
    verify(key, 'compatibility', acknowledgementContext(marker), value, mac);
}
