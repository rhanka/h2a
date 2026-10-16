import { randomUUID } from 'node:crypto';
import { digest } from './wire.js';

const typed = id => `${typeof id}:${JSON.stringify(id)}`;
const sameOwner = (a, b) => ['generation', 'sessionId', 'attachmentId', 'transportEpoch'].every(k => a[k] === b[k]);

// State is proportional to active work. Monotone upstream IDs also fence late
// replies and progress after a downstream ID is reused; no tombstones needed.
export class RequestMappings {
  constructor(capacity = 32) { this.capacity = capacity; this.requests = new Map(); this.tokens = new Map(); this.counter = 0; this.prefix = randomUUID(); }
  nextId() { if (this.counter >= Number.MAX_SAFE_INTEGER) throw new Error('request_id_exhausted'); return `${this.prefix}:${++this.counter}`; }
  get size() { return this.requests.size; }
  begin(message, owner, deadline) {
    const key = typed(message.id);
    if (this.requests.has(key)) throw new Error('duplicate_request_id');
    if (this.requests.size >= this.capacity) throw new Error('request_capacity');
    const entry = { key, downstreamId: message.id, requestUid: randomUUID(), requestNonce: randomUUID(), upstreamId: this.nextId(), owner,
      originalDeadline: deadline, dispatchState: 'local', cancellationState: 'none', terminalState: null, controller: new AbortController() };
    if (message.params?._meta?.progressToken !== undefined) {
      entry.downstreamProgressToken = message.params._meta.progressToken;
      entry.progressToken = this.nextId(); this.tokens.set(entry.progressToken, entry);
    }
    this.requests.set(key, entry); return entry;
  }
  settle(entry, terminalState = 'result') {
    if (entry.terminalState !== null) return false;
    entry.terminalState = terminalState;
    clearTimeout(entry.waitTimer); entry.cancelWait?.();
    this.requests.delete(entry.key); this.tokens.delete(entry.progressToken); return true;
  }
  cancel(id) {
    const entry = this.requests.get(typed(id));
    if (!entry || entry.terminalState !== null) return undefined;
    entry.cancellationState = 'won'; entry.controller.abort();
    return this.settle(entry, 'cancelled') ? entry : undefined;
  }
  progress(token, owner) {
    const entry = this.tokens.get(token);
    return entry && entry.terminalState === null && (sameOwner(entry.owner, owner) ||
      (entry.notificationOwner && sameOwner(entry.notificationOwner, owner))) ? { progressToken: entry.downstreamProgressToken } : undefined;
  }
  resumeNotifications(previous, next) {
    if (previous.generation !== next.generation || previous.attachmentId !== next.attachmentId ||
        !Number.isSafeInteger(next.transportEpoch) || next.transportEpoch !== previous.transportEpoch + 1 || !next.sessionId) throw new Error('notification_resume_mismatch');
    for (const entry of this.requests.values()) {
      const origin = entry.notificationOwner ?? entry.owner;
      if (origin && sameOwner(origin, previous)) entry.notificationOwner = next;
    }
  }
  close() { for (const e of [...this.requests.values()]) { e.controller.abort(); this.settle(e, 'closed'); } }
}

// The caller supplies only an already authenticated response payload.
export function nonAdmissionMatches(proof, entry, message) {
  return Boolean(proof && proof.accepted === false && proof.execution === 'not_started' && typeof proof.reason === 'string' &&
    proof.requestUid === entry.requestUid && proof.requestNonce === entry.requestNonce && proof.method === message.method &&
    proof.requestDigest === entry.requestDigest && proof.generation === entry.owner.marker.generation &&
    Object.hasOwn(proof, 'publicationEpoch') && digest(proof.publicationEpoch) === digest(entry.owner.marker.publicationEpoch));
}
