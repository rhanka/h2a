import { digest } from './wire.js';

const immutable = context => {
  const { resume, expectedInstance, ...value } = context;
  return digest(value);
};

// The caller serializes these synchronous transitions with activation creation.
// Transport loss NEVER creates or destroys a business activation.
export class AttachmentTransports {
  constructor({ generation, capacity = 256 }) { this.generation = generation; this.capacity = capacity; this.attachments = new Map(); this.revision = 1; }
  attach(id, context, activate) {
    if (this.attachments.has(id)) throw new Error('attachment_exists_resume_required');
    if (this.attachments.size >= this.capacity) throw new Error('attachment_capacity');
    const activation = activate();
    const a = { id, context, contextDigest: immutable(context), activation, transportEpoch: 1,
      expectedInstance: context.expectedInstance ?? 'identity_disabled', state: 'attached', sequence: 0, attempts: new Map() };
    this.attachments.set(id, a); this.revision++; return a;
  }
  admit(id, epoch) {
    const a = this.attachments.get(id);
    if (!a || a.state !== 'attached' || a.transportEpoch !== epoch) throw new Error('transport_fenced');
    return a;
  }
  detach(id, liveness) {
    const a = this.attachments.get(id);
    if (!a) return;
    const state = liveness === 'alive' ? 'detached' : liveness === 'dead' ? 'draining' : 'quarantined';
    if (a.state !== state) { a.state = state; this.revision++; }
  }
  resume(request, context, liveness) {
    const a = this.attachments.get(request.attachmentId);
    if (!a || immutable(context) !== a.contextDigest) throw new Error('attachment_context_mismatch');
    const fingerprint = digest(request), previous = a.attempts.get(request.resumeAttemptId);
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error('resume_conflict'); return previous.result; }
    if (request.expectedGeneration !== this.generation || request.expectedTransportEpoch !== a.transportEpoch ||
        request.expectedInstance !== a.expectedInstance) throw new Error('resume_expectation_mismatch');
    if (liveness !== 'alive') throw new Error('liveness_unknown');
    if (!Number.isSafeInteger(request.lastAcceptedNotificationSequence) || request.lastAcceptedNotificationSequence < 0 ||
        request.lastAcceptedNotificationSequence > a.sequence) throw new Error('notification_sequence_invalid');
    if (a.attempts.size >= 128) throw new Error('resume_capacity');
    a.transportEpoch++; a.state = 'attached'; this.revision++;
    const result = { attachmentId: a.id, generation: this.generation, transportEpoch: a.transportEpoch,
      notificationGap: request.lastAcceptedNotificationSequence !== a.sequence };
    a.attempts.set(request.resumeAttemptId, { fingerprint, result }); return result;
  }
  close(id) { if (this.attachments.delete(id)) this.revision++; }
}
