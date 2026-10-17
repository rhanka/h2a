import { assertUpgradeAuthority } from './upgrade-authority.js';

// CLI resume/abort dispatch over inter-transaction authority (F): the
// presented controller is checked first with CLI-level reasons (foreign vs
// revoked), then the engine re-checks the current process identity itself
// and reconciles or aborts. Read-only authority, engine-owned mutation:
// resume never advances a phase by itself, abort only closes a reversible
// (PREPARING/PREPARED) transaction, idempotently.
const invalid = () => { throw new Error('upgrade_dispatch_invalid'); };

function check(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) invalid();
  const { store, upgradeId, controller } = envelope;
  if (!store || typeof store.reconcile !== 'function' || typeof store.abort !== 'function' ||
    typeof upgradeId !== 'string' || !upgradeId ||
    (controller !== undefined && (!controller || typeof controller !== 'object' || Array.isArray(controller)))) {
    invalid();
  }
  return { store, upgradeId, controller };
}

export function resumeUpgrade(envelope = {}) {
  const { store, upgradeId, controller } = check(envelope);
  const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.reconcile(upgradeId);
  return Object.freeze({ upgradeId, installationState: tx.installationState, controllerEpoch: grant.epoch });
}

export function abortUpgrade(envelope = {}) {
  const { store, upgradeId, controller } = check(envelope);
  const grant = assertUpgradeAuthority({ store, upgradeId, controller });
  const tx = store.abort(upgradeId);
  return Object.freeze({ upgradeId, installationState: tx.installationState, controllerEpoch: grant.epoch });
}
