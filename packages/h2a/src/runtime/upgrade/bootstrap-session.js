import { acquirePrefixLock } from '../local-files/succession-lock.js';
import { inspectLegacyInstallation, assertLegacyInstallationUnchanged } from './physical-installation.js';

// First bootstrap step (§8.6.1–2): identify the prefix from the real npm
// entry, verify its artifacts, and hold compatible exclusion while the
// session is open. The session prepares nothing, selects nothing and
// executes no package: later C2b steps consume it for image preparation,
// launcher installation and durable selection.
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function checkTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target) ||
    typeof target.manifestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(target.manifestDigest) ||
    typeof target.packageVersion !== 'string' || !semver.test(target.packageVersion) ||
    typeof target.entrypoint !== 'string' || !target.entrypoint) {
    throw new Error('bootstrap_target_invalid');
  }
  return Object.freeze({ ...target });
}

export function openBootstrapSession({ prefix, entrypoint, legacyPrefix, target }) {
  const eligible = checkTarget(target);
  const evidence = inspectLegacyInstallation({ prefix, entrypoint, legacyPrefix });
  const lease = acquirePrefixLock(evidence.canonicalPrefix);
  if (!lease.acquired) throw new Error(`bootstrap_lock_unavailable:${lease.reason}`);
  try {
    // An external installer may replace paths between observation and lock.
    assertLegacyInstallationUnchanged(evidence);
  } catch (error) {
    lease.release();
    throw error;
  }
  let released = false;
  return Object.freeze({ evidence, canonicalPrefix: evidence.canonicalPrefix, target: eligible,
    release() { if (!released) { released = true; lease.release(); } } });
}

export function assertBootstrapSessionUnchanged(session) {
  if (!session || typeof session !== 'object' || !session.evidence) throw new Error('bootstrap_session_invalid');
  return assertLegacyInstallationUnchanged(session.evidence);
}
