import { digest } from '../handover/wire.js';
import { currentIdentity } from '../handover/admission.js';

// Inter-transaction authority for CLI/auto callers (F): the presented
// controller must be the transaction's ACTIVE bound controller. A revoked
// controller (delegation handed authority away) and a foreign controller
// are refused with distinct reasons; the engine's own revocation stays the
// reference for the revoked case. Read-only: binds nothing, mints nothing.
export function assertUpgradeAuthority(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('upgrade_authority_invalid');
  const { store, upgradeId, controller } = envelope;
  if (!store || typeof store.status !== 'function' || typeof upgradeId !== 'string' || !upgradeId ||
    (controller !== undefined && (!controller || typeof controller !== 'object' || Array.isArray(controller)))) {
    throw new Error('upgrade_authority_invalid');
  }
  const tx = store.status(upgradeId);
  if (tx.controllerAuthorityState !== 'ACTIVE') throw new Error('upgrade_authority_revoked');
  if (digest(tx.controllerIdentity) !== digest(controller ?? currentIdentity())) {
    throw new Error('upgrade_authority_foreign');
  }
  return Object.freeze({ upgradeId, epoch: tx.controllerEpoch });
}
