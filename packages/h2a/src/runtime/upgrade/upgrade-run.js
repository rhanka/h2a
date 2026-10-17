import { join } from 'node:path';
import { readState } from '../handover/state.js';
import { assessAdoptionNeed } from './adoption-need.js';
import { executeAdoption } from './adoption-execute.js';
import { readManagementOptOut } from './unmanage.js';

// Single automatic/manual upgrade pass (F driver without CLI parsing):
// honor the management opt-out, assess the adoption need, then execute the
// adoption through the verified session and engine. The explicit operator
// path bypasses only the opt-out, never the need assessment or the
// exclusion verdict. This decides and delegates execution; it parses no
// flags and spawns no controller.
export function runUpgradeOnce(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('upgrade_run_invalid');
  const { session, store, upgradeId, target, launcherSource, managedDir, commandPath, exclusion, management, explicit } = envelope;
  if (!session || typeof session !== 'object' || !store || typeof store.begin !== 'function' ||
    typeof upgradeId !== 'string' || !upgradeId || !target || typeof target !== 'object' ||
    typeof launcherSource !== 'string' || typeof managedDir !== 'string' || typeof commandPath !== 'string' ||
    (management !== undefined && (typeof management !== 'object' || management === null))) {
    throw new Error('upgrade_run_invalid');
  }
  const optOut = management ?? readManagementOptOut(managedDir);
  if (optOut.optedOut === true && explicit !== true) {
    return Object.freeze({ completed: false, reason: 'management_opted_out' });
  }
  const selection = readState(join(store.state, 'selected-build.json'), 'selection')?.value ?? null;
  const need = assessAdoptionNeed({ managed: { prefixId: store.installation.prefixId, selection },
    physical: { prefixId: session.evidence.prefixId },
    target: { packageVersion: target.packageVersion, manifestDigest: target.manifestDigest } });
  if (!need.needed) return Object.freeze({ completed: false, reason: need.reason });
  return executeAdoption({ session, store, upgradeId, target, launcherSource, managedDir, commandPath, exclusion });
}
