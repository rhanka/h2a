import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { digest } from './wire.js';
import {
  prepareAuthority,
  currentIdentity,
  ownerLiveness,
  observeProcess,
  readMarkerObservation,
  probeOwnerHealth,
  evictUnresponsiveOwnerLocked,
  centralMcpPing
} from './admission.js';
import { acquirePreclaim } from './authority.js';
import { classifyDurableProcFrame } from './proc-identity.js';
import { starterPlan } from './selection.js';
import { readState, publishState, replaceState } from './state.js';
import { reserveSuccessorAttempt, recordSuccessor, failSuccessor, markSuccessorFailed } from './successor.js';
import { isolateCentralSystemdScope } from './central-scope.js';
import { scrubSessionIdentityEnv } from '../identity/session-auth-keys.js';

/** @param {*} options */
export async function launchCentral({ directory, root, installation, physicalPrefix, fallbackEntry, environment, kind = 'shim', onSpawn, logPath, probeOptions, evictionOptions, scopeOptions, stderr }) {
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
      if (marker.value.prefixId && marker.value.prefixId !== authority.domain.prefixId) {
        throw new Error('foreign_installation_authority');
      }
      const probe = await probeOwnerHealth(authority.domain.canonicalMarkerLocation, marker, authority, probeOptions);
      if (probe.status === 'healthy') return { reused: true, marker: probe.marker };
      if (probe.status === 'starting') throw new Error('startup_reserved');
      if (probe.status === 'unknown') throw new Error('owner_liveness_unknown');
      if (probe.status === 'unresponsive') {
        const evicted = await evictUnresponsiveOwnerLocked(authority, marker, { ...evictionOptions, alreadyProbed: true });
        if (!evicted.evicted && evicted.reason === 'healthy' && evicted.marker) {
          return { reused: true, marker: evicted.marker };
        }
        if (!evicted.evicted && evicted.reason === 'generation_changed' && evicted.marker) {
          const fresh = readMarkerObservation(authority.domain.canonicalMarkerLocation);
          if (fresh) {
            const recheck = await probeOwnerHealth(authority.domain.canonicalMarkerLocation, fresh, authority, probeOptions);
            if (recheck.status === 'healthy') return { reused: true, marker: recheck.marker };
          }
        }
      }
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
    const childEnv = scrubSessionIdentityEnv(environment);
    const log = fs.openSync(logPath?.() ?? join(directory, 'mcp-central.log'), 'a', 0o600);
    let scopeResult;
    try {
      child = spawn(process.execPath, ['--max-old-space-size=384', plan.entrypoint, 'mcp-central-serve', '--root', root,
        '--runtime-base', dirname(directory), '--auto-start', ...(ticket ? ['--handover-id', ticket.handoverId,
          '--transaction-epoch', String(ticket.transactionEpoch), '--successor-attempt', String(ticket.attempt)] : [])],
        { detached: true, cwd: childEnv.HOME ?? environment.HOME, env: childEnv, stdio: ['ignore', log, log] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      const generationToken = `${ticket ? `t${ticket.transactionEpoch}-a${ticket.attempt}-` : ''}${child.pid}-${randomUUID().slice(0, 8)}`;
      scopeResult = await isolateCentralSystemdScope(child.pid, {
        environment,
        generation: generationToken,
        ...(scopeOptions ?? {})
      });
      try {
        fs.writeSync(log, `${scopeResult.message}\n`);
      } catch {
        /* best-effort log diagnostic */
      }
      if (!scopeResult.isolated && environment?.H2A_MCP_CENTRAL_QUIET_SCOPE_FALLBACK !== '1') {
        try {
          (stderr ?? process.stderr).write(`${scopeResult.message}\n`);
        } catch {
          /* best-effort fallback diagnostic */
        }
      }
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
    onSpawn?.(child, scopeResult);
  } finally { await lock.release(); }
  const budget = plan.manifest?.startupWaitBudgetMs ?? 10_000, deadline = Date.now() + budget;
  while (Date.now() < deadline) {
    const marker = readMarkerObservation(authority.domain.canonicalMarkerLocation);
    const slot = readState(slotPath, 'startupReservation');
    const transactionReady = !ticket || readState(plan.transactionPath, 'componentTransaction')?.value.state === 'READY';
    if (marker?.value.pid === child.pid && marker.value.state === 'ready' && slot?.value.state === 'READY' && transactionReady) {
      const ping = await centralMcpPing(marker.value.endpoint, 800);
      if (ping.kind === 'generation' && ping.generation === marker.value.generation) {
        return { reused: false, marker: marker.value, spawnedPid: child.pid };
      }
    }
    if (ownerLiveness({ processIdentity: readState(slotPath, 'startupReservation').value.candidateIdentity }, identity) === 'dead') break;
    await new Promise(resolve => setTimeout(resolve, 25));
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
