// Canonical §8.4 verdict for the future exclusion of legacy engines.
//
// The four closures are assessed, never assumed: terminated legacy workers
// with no late mutation, closed relaunch sources, routed future starts, and
// retained processes barred from reintroducing the legacy installer. Anything
// short of four established closures with a stated basis verdicts
// legacy_installer_unfenced: preparation stays possible while qualified
// selection is deferred. This producer persists no state and fences nothing
// by itself; C2b/F consume its verdict on the real M18 path.
const CONDITIONS = ['workersTerminated', 'relaunchSourcesClosed', 'futureStartsRouted', 'installerReintroductionBarred'];

export function assessLegacyExclusion(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('legacy_exclusion_evidence_invalid');
  }
  const missing = [];
  for (const key of CONDITIONS) {
    const entry = evidence[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.established !== true ||
      typeof entry.detail !== 'string' || !entry.detail) {
      missing.push(key);
    }
  }
  if (missing.length) {
    return Object.freeze({ fenced: false, reason: 'legacy_installer_unfenced', missing: Object.freeze([...missing]) });
  }
  return Object.freeze({ fenced: true, reason: 'legacy_exclusion_verified', missing: Object.freeze([]) });
}
