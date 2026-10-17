import { digest } from '../handover/wire.js';
import { currentIdentity } from '../handover/admission.js';
import { assertUpgradeAuthority } from './upgrade-authority.js';

// Source-side delegation orchestration (F over the B1 primitive): hand the
// SELECTED transaction to exactly one candidate. Like the engine, a lost
// source acknowledgement replays the same handoff first (same bound
// controller on an open handoff goes straight back to the engine, which
// replays or refuses the ticket binding itself); otherwise CLI authority is
// checked first with CLI-level reasons. The private ticket never leaves
// the engine journal through this call (no ticket bytes in the result);
// the future controller receives it out of band and the engine re-verifies
// it on acquisition.
const invalid = () => { throw new Error('upgrade_delegate_invalid'); };
const frozen = handoff => Object.freeze({ upgradeId: handoff.transaction.upgradeId,
  delegationState: handoff.transaction.delegationState, controllerEpoch: handoff.transaction.controllerEpoch });

export function delegateUpgrade(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) invalid();
  const { store, upgradeId, candidate, controller } = envelope;
  if (!store || typeof store.status !== 'function' || typeof store.delegate !== 'function' ||
    typeof upgradeId !== 'string' || !upgradeId ||
    !candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
    (controller !== undefined && (!controller || typeof controller !== 'object' || Array.isArray(controller)))) {
    invalid();
  }
  const tx = store.status(upgradeId);
  if (tx.installationState === 'DELEGATING' && tx.controllerAuthorityState === 'REVOKED' &&
    digest(tx.controllerIdentity) === digest(controller ?? currentIdentity())) {
    return frozen(store.delegate(upgradeId, candidate));
  }
  assertUpgradeAuthority({ store, upgradeId, controller });
  return frozen(store.delegate(upgradeId, candidate));
}
