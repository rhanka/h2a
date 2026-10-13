import { readState, replaceState } from './state.js';
import { digest } from './wire.js';

// Caller owns the common preclaim; these are shared by every starter.
export function reserveSuccessorAttempt(path, options) {
  const observed = readState(path, 'componentTransaction');
  if (!observed) throw new Error('successor_reservation_missing');
  const tx = observed.value, reservation = tx.successorReservation;
  if (!reservation || tx.state === 'SUCCESSOR_FAILED') throw new Error('successor_failed');
  if (options.paused) throw new Error('deferred_paused');
  if (options.sourceLiveness !== 'dead') throw new Error('source_stop_unproven');
  if (!['STOP_COMMITTED', 'STOPPED', 'STARTING'].includes(tx.state)) throw new Error('successor_state_invalid');
  if (tx.state === 'STARTING' && options.candidateLiveness !== 'dead') throw new Error(options.candidateLiveness === 'alive' ? 'candidate_alive' : 'candidate_liveness_unknown');
  if (reservation.attempts >= 3) throw new Error('successor_failed');
  if (options.selectionEpoch !== reservation.selectionEpoch || options.targetManifestDigest !== reservation.targetManifestDigest) throw new Error('successor_selection_mismatch');
  const next = { ...tx, revision: tx.revision + 1, state: 'STARTING', successorReservation: {
    ...reservation, attempts: reservation.attempts + 1, candidateIdentity: null } };
  replaceState(path, next, 'componentTransaction', observed);
  return { handoverId: tx.handoverId, transactionEpoch: tx.transactionEpoch, attempt: next.successorReservation.attempts };
}
function currentAttempt(path, ticket) {
  const observed = readState(path, 'componentTransaction');
  if (!observed || observed.value.handoverId !== ticket.handoverId || observed.value.transactionEpoch !== ticket.transactionEpoch ||
    observed.value.state !== 'STARTING' || observed.value.successorReservation.attempts !== ticket.attempt) throw new Error('successor_attempt_stale');
  return observed;
}
export function recordSuccessor(path, ticket, identity) {
  const observed = currentAttempt(path, ticket), tx = observed.value;
  if (tx.successorReservation.candidateIdentity && digest(tx.successorReservation.candidateIdentity) !== digest(identity)) throw new Error('candidate_conflict');
  return replaceState(path, { ...tx, revision: tx.revision + 1,
    successorReservation: { ...tx.successorReservation, candidateIdentity: identity } }, 'componentTransaction', observed).value;
}
export function failSuccessor(path, ticket, reason, candidateLiveness, fatal = false) {
  const observed = currentAttempt(path, ticket), tx = observed.value;
  if (candidateLiveness !== 'dead') throw new Error(candidateLiveness === 'alive' ? 'candidate_alive' : 'candidate_liveness_unknown');
  return replaceState(path, { ...tx, revision: tx.revision + 1,
    state: fatal || tx.successorReservation.attempts >= 3 ? 'SUCCESSOR_FAILED' : 'STOPPED',
    stepResults: { ...tx.stepResults, [`successor-attempt-${ticket.attempt}`]: { payloadDigest: digest(reason), result: { reason } } }
  }, 'componentTransaction', observed).value;
}
export function readySuccessor(path, ticket, identity) {
  const observed = currentAttempt(path, ticket), tx = observed.value;
  if (digest(identity) !== digest(tx.successorReservation.candidateIdentity)) throw new Error('candidate_conflict');
  return replaceState(path, { ...tx, revision: tx.revision + 1, state: 'READY' }, 'componentTransaction', observed).value;
}
export function markSuccessorFailed(path, ticket, reason) {
  const observed = currentAttempt(path, ticket), tx = observed.value;
  return replaceState(path, { ...tx, revision: tx.revision + 1, state: 'SUCCESSOR_FAILED',
    stepResults: { ...tx.stepResults, [`successor-attempt-${ticket.attempt}`]: {
      payloadDigest: digest(reason), result: { reason, activation: 'failed' } } }
  }, 'componentTransaction', observed).value;
}
