import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { digest } from './wire.js';
import { prepareAuthority, currentIdentity, ownerLiveness, observeProcess, readMarkerObservation } from './admission.js';
import { acquirePreclaim } from './authority.js';
import { classifyDurableProcFrame } from './proc-identity.js';
import { starterPlan } from './selection.js';
import { readState, publishState, replaceState } from './state.js';
import { reserveSuccessorAttempt, recordSuccessor, failSuccessor, markSuccessorFailed } from './successor.js';

/** @param {*} options */
export async function launchCentral({ directory, root, installation, physicalPrefix, fallbackEntry, environment, kind = 'shim', onSpawn }) {
  const identity = currentIdentity();
  const authority = await prepareAuthority({ directory, root, physicalPrefix: installation?.canonicalPrefix ?? physicalPrefix, frame: identity });
  let plan, child, ticket;
  const lock = await acquirePreclaim(authority.domain, identity, authority.lockKey, classifyDurableProcFrame);
  const stateDirectory = authority.stateDirectory;
  const slotPath = join(stateDirectory, 'startup-reservation.json');
  try {
    plan = starterPlan({ installation, directory: stateDirectory, kind, fallbackEntry });
    const marker = readMarkerObservation(authority.domain.canonicalMarkerLocation);
    if (marker) {
      const liveness = ownerLiveness(marker.value, identity);
      if (liveness === 'alive') return { reused: true, marker: marker.value };
      if (liveness !== 'dead') throw new Error('owner_liveness_unknown');
    }
    const owner = readState(join(stateDirectory, 'component-control.json'), 'componentControl');
    if (owner?.value.ownerState === 'ACTIVE') {
      const liveness = ownerLiveness({ processIdentity: owner.value.ownerIdentity }, identity);
      if (liveness !== 'dead') throw new Error(liveness === 'alive' ? 'owner_alive' : 'owner_liveness_unknown');
    }
    if (plan.reservation && !['READY', 'ABORTED'].includes(plan.reservation.state)) {
      const tx = plan.reservation;
      if (tx.source.processIdentity.bootId !== identity.bootId) throw new Error("transaction_boot_changed");
      const sourceLiveness = tx.state === 'STOPPED' ? 'dead' : ownerLiveness({ processIdentity: tx.source.processIdentity }, identity);
      const candidateLiveness = tx.successorReservation.candidateIdentity ? ownerLiveness({ processIdentity: tx.successorReservation.candidateIdentity }, identity) :
        tx.state === 'STARTING' ? 'unknown' : 'dead';
      ticket = reserveSuccessorAttempt(plan.transactionPath, { sourceLiveness, candidateLiveness,
        selectionEpoch: plan.selection.selectionEpoch, targetManifestDigest: plan.selection.manifestDigest, paused: false });
    }
    const old = readState(slotPath, 'startupReservation');
    if (old && ['RESERVED', 'STARTING'].includes(old.value.state)) {
      const owner = old.value.candidateIdentity ?? old.value.starterIdentity;
      const liveness = ownerLiveness({ processIdentity: owner }, identity);
      if (liveness !== 'dead') throw new Error(liveness === 'alive' ? 'startup_reserved' : 'candidate_liveness_unknown');
      if (!old.value.candidateIdentity) throw new Error('spawn_outcome_unknown');
    }
    const slot = { schemaVersion: 1, revision: (old?.value.revision ?? 0) + 1, starterIdentity: identity,
      candidateIdentity: null, entrypoint: plan.entrypoint, createdAt: Date.now(), state: 'RESERVED' };
    const reserved = old ? replaceState(slotPath, slot, 'startupReservation', old) : publishState(slotPath, slot, 'startupReservation');
    const log = fs.openSync(join(directory, 'mcp-central.log'), 'a', 0o600);
    try {
      child = spawn(process.execPath, ['--max-old-space-size=384', plan.entrypoint, 'mcp-central-serve', '--root', root,
        '--runtime-base', dirname(directory), '--auto-start', ...(ticket ? ['--handover-id', ticket.handoverId,
          '--transaction-epoch', String(ticket.transactionEpoch), '--successor-attempt', String(ticket.attempt)] : [])],
        { detached: true, cwd: environment.HOME, env: environment, stdio: ['ignore', log, log] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } catch (error) {
      replaceState(slotPath, { ...slot, revision: reserved.value.revision + 1, state: 'FAILED' }, 'startupReservation', reserved);
      if (ticket) failSuccessor(plan.transactionPath, ticket, 'spawn_failed', 'dead');
      throw error;
    } finally { fs.closeSync(log); }
    const proc = observeProcess(child.pid);
    if (!Number.isSafeInteger(proc.startTime)) throw new Error('candidate_identity_unknown');
    const candidate = { ...identity, pid: child.pid, startTime: proc.startTime };
    replaceState(slotPath, { ...slot, revision: reserved.value.revision + 1, candidateIdentity: candidate, state: 'STARTING' }, 'startupReservation', reserved);
    if (ticket) recordSuccessor(plan.transactionPath, ticket, candidate);
    child.unref();
    onSpawn?.(child);
  } finally { await lock.release(); }
  const budget = plan.manifest?.startupWaitBudgetMs ?? 10_000, deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    const marker = readMarkerObservation(authority.domain.canonicalMarkerLocation);
    const slot = readState(slotPath, 'startupReservation');
    const transactionReady = !ticket || readState(plan.transactionPath, 'componentTransaction')?.value.state === 'READY';
    if (marker?.value.pid === child.pid && marker.value.state === 'ready' && slot?.value.state === 'READY' && transactionReady)
      return { reused: false, marker: marker.value, spawnedPid: child.pid };
    if (ownerLiveness({ processIdentity: readState(slotPath, 'startupReservation').value.candidateIdentity }, identity) === 'dead') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (ticket) {
    const again = await acquirePreclaim(authority.domain, identity, authority.lockKey, classifyDurableProcFrame);
    try {
      const tx = readState(plan.transactionPath, 'componentTransaction').value;
      const candidate = tx.successorReservation.candidateIdentity;
      const liveness = candidate ? ownerLiveness({ processIdentity: candidate }, identity) : 'unknown';
      if (liveness === 'dead') failSuccessor(plan.transactionPath, ticket, 'startup_failed', liveness);
      else markSuccessorFailed(plan.transactionPath, ticket, 'startup_budget_expired_candidate_fenced');
    } finally { await again.release(); }
  }
  throw new Error('successor_startup_failed');
}

export function checkStartupReservation(directory, entrypoint, identity) {
  const path = join(directory, 'startup-reservation.json'), slot = readState(path, 'startupReservation');
  if (!slot || !['RESERVED', 'STARTING'].includes(slot.value.state)) return;
  const candidate = slot.value.candidateIdentity;
  if (!candidate || digest(candidate) !== digest(identity) || slot.value.entrypoint !== entrypoint) throw new Error('startup_reserved');
}
export function markStartupReady(directory, identity) {
  const path = join(directory, 'startup-reservation.json'), slot = readState(path, 'startupReservation');
  if (slot?.value.candidateIdentity && digest(slot.value.candidateIdentity) === digest(identity))
    replaceState(path, { ...slot.value, revision: slot.value.revision + 1, state: 'READY' }, 'startupReservation', slot);
}
