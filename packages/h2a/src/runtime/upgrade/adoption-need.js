// Adoption gate (§8.6, U01): `h2a upgrade` runs needed adoption before the
// `current == latest` shortcut. This pure assessor decides from the observed
// managed selection, the physical installation evidence and the target,
// with one typed reason per situation. It prepares, installs and selects
// nothing: C2b-2b/F execute the adoption it requires.
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const upgradeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const need = reason => Object.freeze({ needed: true, reason });

function checkTargetShape(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target) ||
    typeof target.packageVersion !== 'string' || !semver.test(target.packageVersion) ||
    typeof target.manifestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(target.manifestDigest)) {
    throw new Error('adoption_assessment_invalid');
  }
}

export function assessAdoptionNeed(envelope = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('adoption_assessment_invalid');
  const { managed, physical, target, management } = envelope;
  checkTargetShape(target);
  if (management !== undefined) {
    if (!management || typeof management !== 'object' || Array.isArray(management)) throw new Error('adoption_assessment_invalid');
    if (management.optedOut === true) return need('management_opted_out');
  }
  if (managed == null || typeof managed !== 'object' || Array.isArray(managed)) return need('managed_installation_absent');
  if (managed.selection == null) return need('managed_selection_absent');
  if (typeof managed.prefixId === 'string' && typeof physical?.prefixId === 'string' &&
    managed.prefixId !== physical.prefixId) return need('managed_prefix_foreign');
  const selection = managed.selection;
  if (!selection || typeof selection !== 'object' || typeof selection.packageVersion !== 'string' ||
    typeof selection.manifestDigest !== 'string' || !upgradeId.test(selection.upgradeId ?? '')) {
    return need('managed_selection_malformed');
  }
  if (physical == null || typeof physical !== 'object' || Array.isArray(physical)) return need('physical_installation_unreadable');
  if (selection.packageVersion !== target.packageVersion || selection.manifestDigest !== target.manifestDigest) {
    return need('target_mismatch');
  }
  return Object.freeze({ needed: false, reason: 'already_adopted' });
}
