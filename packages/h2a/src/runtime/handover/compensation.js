import { join, dirname, basename } from 'node:path';
import { readState, publishState, replaceState } from './state.js';
import { currentIdentity, ownerLiveness, observeProcess } from './admission.js';
import { digest } from './wire.js';
import { verifyTarget, verifyPrecheckEvidence } from './precheck.js';
import { prepareAuthority } from './admission.js';
import { acquirePreclaim } from './authority.js';
import { classifyDurableProcFrame } from './proc-identity.js';

// H4 creates/selects the new compensation upgrade. L2 only consumes that
// durable ACTIVE controller authority; it never reopens the former generation.
// Synchronous kernel requires the common preclaim; H4 uses compensateCold below.
export function prepareCompensation(previousPath, destination, upgradePath, installation,
  { frame = currentIdentity(), observe = observeProcess, precheckEvidenceDigest } = {}) {
  const previous = readState(previousPath, 'componentTransaction')?.value;
  const directory = dirname(destination);
  if (dirname(previousPath) !== directory) throw new Error('compensation_namespace_mismatch');
  if (readState(join(directory, 'operator-stop.json'), 'pause')?.value.paused) throw new Error('deferred_paused');
  const upgrade = readState(upgradePath, 'upgradeTransaction')?.value;
  const selection = readState(join(installation.managedRoot, 'state', 'selected-build.json'), 'selection')?.value;
  if (!previous || !['SUCCESSOR_FAILED', 'STOPPED'].includes(previous.state)) throw new Error('compensation_state_invalid');
  if (!upgrade || upgrade.origin !== 'compensation' || upgrade.upgradeId === previous.upgradeId ||
    upgrade.prefixId !== installation.prefixId || upgrade.controllerAuthorityState !== 'ACTIVE' ||
    upgrade.uid !== installation.uid || upgrade.canonicalPrefix !== installation.canonicalPrefix || upgrade.controllerEpoch <= previous.controllerEpoch ||
    upgrade.delegationState !== 'NONE' || digest(upgrade.controllerIdentity) !== digest(frame) ||
    !['SELECTED', 'ACTIVATING'].includes(upgrade.installationState)) throw new Error('compensation_controller_unqualified');
  const version = /^0\.(\d+)\.(\d+)/.exec(previous.source.packageVersion);
  if (!version || Number(version[1]) < 98 || (Number(version[1]) === 98 && Number(version[2]) < 7)) throw new Error('compensation_source_pre_h4');
  const candidate = previous.successorReservation?.candidateIdentity;
  if (candidate && ownerLiveness({ processIdentity: candidate }, frame, observe) !== 'dead') throw new Error('compensation_candidate_unproven');
  if (ownerLiveness({ processIdentity: previous.source.processIdentity }, frame, observe) !== 'dead') throw new Error('compensation_source_stop_unproven');
  if (!selection || selection.selectionEpoch <= previous.successorReservation.selectionEpoch ||
    selection.selectionEpoch !== upgrade.selectionEpoch || selection.manifestDigest !== previous.source.manifestDigest ||
    selection.upgradeId !== upgrade.upgradeId ||
    upgrade.targetManifestDigest !== selection.manifestDigest || selection.buildId !== previous.source.buildId) throw new Error('compensation_selection_mismatch');
  const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest,
    entrypoint: join(installation.managedRoot, 'images', selection.manifestDigest.slice(7), selection.entrypoint) };
  verifyTarget(installation, target, selection.selectionEpoch);
  verifyPrecheckEvidence(dirname(destination), precheckEvidenceDigest, target, selection.selectionEpoch, frame);
  const link = { previousUpgradeId: previous.upgradeId, previousHandoverId: previous.handoverId,
    previousTransactionEpoch: previous.transactionEpoch, previousGeneration: previous.source.generation };
  const transaction = { ...previous, revision: 1, upgradeId: upgrade.upgradeId,
    handoverId: `${upgrade.upgradeId}-mcp`, transactionEpoch: previous.transactionEpoch + 1,
    coordinator: upgrade.controllerIdentity, controllerEpoch: upgrade.controllerEpoch,
    target, state: 'STOPPED', barrierDeadline: null, precheckEvidenceDigest, checkpointReferences: [],
    stepResults: { compensation: { payloadDigest: digest(link), result: link } },
    successorReservation: { attempts: 0, candidateIdentity: null, selectionEpoch: selection.selectionEpoch,
      targetManifestDigest: target.manifestDigest } };
  const controlPath = join(directory, 'component-control.json'), control = readState(controlPath, 'componentControl');
  if (!control || (join(directory, control.value.activeTransaction ?? '') !== previousPath &&
    join(directory, control.value.activeTransaction ?? '') !== destination)) throw new Error('compensation_authority_mismatch');
  const existing = readState(destination, 'componentTransaction');
  if (existing && digest(existing.value) !== digest(transaction)) throw new Error('compensation_conflict');
  const committed = existing ?? publishState(destination, transaction, 'componentTransaction');
  if (control.value.activeTransaction !== basename(destination)) replaceState(controlPath, { ...control.value,
    revision: control.value.revision + 1, activeTransaction: basename(destination), transactionEpoch: transaction.transactionEpoch,
    sourceGeneration: transaction.source.generation }, 'componentControl', control);
  return committed.value;
}

export async function compensateCold(previousPath, destination, upgradePath, installation, precheckEvidenceDigest) {
  const directory = dirname(destination), frame = currentIdentity();
  const namespace = readState(join(installation.managedRoot, 'state', 'namespaces', 'namespace.json'), 'namespace')?.value;
  if (!namespace || namespace.stateDirectory !== directory) throw new Error('authority_namespace_unknown');
  const anchorDirectory = dirname(namespace.canonicalMarkerLocation);
  const domain = readState(join(anchorDirectory, 'authority-domain.json'), 'authorityDomain')?.value;
  if (!domain) throw new Error('authority_namespace_unknown');
  const authority = await prepareAuthority({ directory: anchorDirectory, root: domain.canonicalRoot,
    physicalPrefix: installation.canonicalPrefix, frame });
  const preclaim = await acquirePreclaim(authority.domain, frame, authority.lockKey, classifyDurableProcFrame);
  try { return prepareCompensation(previousPath, destination, upgradePath, installation, { frame, precheckEvidenceDigest }); }
  finally { await preclaim.release(); }
}
