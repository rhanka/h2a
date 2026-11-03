import { join } from 'node:path';
import { readState } from '../handover/state.js';
import { currentIdentity } from '../handover/admission.js';

// Common read-only report (§8.10, manual and automatic share it): prepared
// and selected builds, loaded builds, observed process identity and
// generation, transaction phase, and activation. An unknown version stays
// unknown (null, never invented); a recorded unfenced exclusion verdict
// reports deferred on any non-terminal phase. Terminal states report
// themselves. This composes durable state; it mints, stops, publishes
// and mutates nothing.
const TERMINAL = { COMPLETED: 'completed', ABORTED: 'failed' };

export function composeUpgradeStatus(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('status_report_invalid');
  const { store, upgradeId } = envelope;
  if (!store || typeof store.status !== 'function' || typeof upgradeId !== 'string' || !upgradeId) {
    throw new Error('status_report_invalid');
  }
  const tx = store.status(upgradeId);
  const intent = tx.observations.selectionIntent ?? {};
  const durableRecord = readState(join(store.state, 'selected-build.json'), 'selection');
  if (durableRecord) for (const key of ['prefixId', 'canonicalPrefix', 'uid']) {
    if (durableRecord.value[key] !== store.installation[key]) throw new Error('foreign_installation_authority');
  }
  const durable = durableRecord?.value ?? null;
  const exclusion = tx.verification?.legacyExclusion ?? null;
  const terminal = TERMINAL[tx.installationState] ?? null;
  const deferred = !terminal && exclusion && exclusion.fenced === false;
  const activation = terminal ?? (deferred ? 'deferred' : tx.installationState === 'PREPARING' || tx.installationState === 'PREPARED' ? 'unchanged' : 'unknown');
  const reason = deferred ? `selection_deferred:${exclusion.reason}` : null;
  return Object.freeze({
    transactionId: tx.upgradeId,
    phase: tx.installationState,
    preparedVersion: intent.packageVersion ?? null,
    preparedBuildId: intent.buildId ?? null,
    selectedVersion: durable?.packageVersion ?? null,
    selectedBuildId: durable?.buildId ?? null,
    loadedVersion: durable?.packageVersion ?? null,
    loadedBuildId: durable?.buildId ?? null,
    observedProcessIdentity: currentIdentity(),
    observedGeneration: tx.controllerEpoch,
    activation,
    reason,
  });
}
