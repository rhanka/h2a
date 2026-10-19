import { join } from 'node:path';
import { readState } from '../handover/state.js';
import { assertBootstrapSessionUnchanged } from './bootstrap-session.js';
import { assessAdoptionNeed } from './adoption-need.js';
import { installManagedLauncher } from './launcher-install.js';

// Adoption execution (§8.6.2–7 without delegation): from the verified bootstrap
// session, run the needed adoption before any already-current shortcut —
// need assessment, explicit lock handoff to the engine, journal
// begin/prepare, conditional launcher install, then durable selection with
// the exclusion verdict. The session lock covers observation and decision;
// engine mutations take the compatible lock per operation, so the session
// hands it off before begin (a competitor racing the handoff meets the
// engine's typed lock refusal, never a half-written adoption). Delegation to
// the absolute target controller stays an explicit caller step (B1 primitive).
// An explicit operator override is forwarded to the launcher installer and
// recorded there; anything else is refused before any mutation.
export function executeAdoption(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('adoption_execute_invalid');
  const { session, store, upgradeId, target, launcherSource, managedDir, commandPath, exclusion, explicit } = envelope;
  if (!session || typeof session !== 'object' || !store || typeof store.begin !== 'function' ||
    typeof upgradeId !== 'string' || !upgradeId || !target || typeof target !== 'object' ||
    typeof launcherSource !== 'string' || typeof managedDir !== 'string' || typeof commandPath !== 'string') {
    throw new Error('adoption_execute_invalid');
  }
  if (explicit !== undefined && typeof explicit !== 'boolean') throw new Error('adoption_execute_invalid');
  assertBootstrapSessionUnchanged(session);
  const selection = readState(join(store.state, 'selected-build.json'), 'selection')?.value ?? null;
  const need = assessAdoptionNeed({ managed: { prefixId: store.installation.prefixId, selection },
    physical: { prefixId: session.evidence.prefixId },
    target: { packageVersion: target.packageVersion, manifestDigest: target.manifestDigest } });
  if (!need.needed) return Object.freeze({ completed: false, reason: need.reason });
  session.release();
  store.begin({ upgradeId, target, origin: 'bootstrap', artifactDigests: {} });
  store.prepare(upgradeId);
  const installation = installManagedLauncher({ session, launcherSource, managedDir, commandPath, explicit });
  const transaction = store.select(upgradeId, { exclusion });
  return Object.freeze({ completed: true, upgradeId, installation, transaction });
}
