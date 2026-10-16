import { randomBytes, randomUUID } from 'node:crypto';
import { digest, sign, verify } from './wire.js';
import { validate } from './formats.js';

const nonce = () => randomBytes(32).toString('hex');
const unsigned = ({ mac, ...payload }) => payload;
const context = m => ({ service: m.service, namespaceId: m.namespaceId, generation: m.generation });
export function isControlRequest(path, wireBody) {
  if (path.startsWith('/_h2a-central/')) return true;
  try {
    const message = JSON.parse(wireBody.body);
    if (message?.method === 'initialize') return true;
    const frames = Array.isArray(message) ? message : [message];
    return frames.length > 0 && frames.every(m => m?.method === 'notifications/cancelled' && !Object.hasOwn(m, 'id'));
  } catch { return false; }
}

// Socket keys are server-owned objects, never a client-supplied connection ID.
export class ConnectionAuthentication {
  constructor(marker, rootKey, { now = Date.now, capacity = 4096, validityMs = 30_000 } = {}) {
    validate('marker', marker);
    if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(validityMs) || validityMs < 1) throw new Error('authentication_bounds');
    this.marker = marker; this.key = rootKey; this.now = now;
    this.capacity = capacity; this.validityMs = validityMs;
    this.connections = new Map(); this.nonces = new Map(); this.controlNonces = new Map(); this.sequences = new Map();
  }
  prune() {
    const now = this.now();
    for (const [socket, proof] of this.connections) if (proof.expiresAt <= now) this.connections.delete(socket);
    for (const [key, expires] of this.nonces) if (expires <= now) this.nonces.delete(key);
    for (const [key, expires] of this.controlNonces) if (expires <= now) this.controlNonces.delete(key);
  }
  forget(socket) { this.connections.delete(socket); }
  challenge(socket, clientNonce, pool = 'data') {
    this.prune();
    if (typeof clientNonce !== 'string' || clientNonce.length < 1 || clientNonce.length > 256) throw new Error('challenge_invalid');
    if (!['data', 'control'].includes(pool)) throw new Error('challenge_pool_invalid');
    if (!this.connections.has(socket) && [...this.connections.values()].filter(p => p.pool === pool).length >= this.capacity) throw new Error('challenge_capacity');
    const m = this.marker;
    const payload = { schemaVersion: 1, clientNonce, serverNonce: nonce(), connectionNonce: nonce(),
      service: m.service, namespaceId: m.namespaceId, generation: m.generation,
      publicationEpoch: m.publicationEpoch, processIdentity: m.processIdentity,
      endpoint: m.endpoint, endpointMode: m.endpointMode, root: m.root, uid: m.uid, state: m.state,
      packageVersion: m.packageVersion, buildId: m.buildId, manifestDigest: m.manifestDigest,
      mcpProtocolVersions: m.mcpProtocolVersions, descriptorDigest: m.descriptorDigest,
      contractDigest: m.contractDigest, capabilities: m.handoverCapabilities, challengeValidityMs: this.validityMs };
    const proof = validate('readiness', { ...payload, mac: sign(this.key, 'readiness', context(m), payload) });
    this.connections.set(socket, { proof, pool, expiresAt: this.now() + this.validityMs });
    return proof;
  }
  verifyChallenge(proof, clientNonce) {
    try {
      validate('readiness', proof);
      const m = this.marker;
      if (proof.clientNonce !== clientNonce) return false;
      for (const field of ['service', 'namespaceId', 'generation', 'publicationEpoch', 'processIdentity', 'endpoint',
        'endpointMode', 'root', 'uid', 'state', 'packageVersion', 'buildId', 'manifestDigest',
        'mcpProtocolVersions', 'descriptorDigest', 'contractDigest']) if (digest(proof[field]) !== digest(m[field])) return false;
      if (digest(proof.capabilities) !== digest(m.handoverCapabilities)) return false;
      return verify(this.key, 'readiness', context(m), unsigned(proof), proof.mac);
    } catch { return false; }
  }
  request(proof, path, wireBody, { requestUid = randomUUID(), requestNonce = nonce(), attachmentId = null, transportEpoch = null } = {}) {
    const m = this.marker;
    const payload = { schemaVersion: 1, generation: m.generation, publicationEpoch: m.publicationEpoch,
      method: 'POST', authority: new URL(m.endpoint).host, path, bodyDigest: digest(wireBody),
      requestUid, requestNonce, serverNonce: proof.serverNonce, connectionNonce: proof.connectionNonce,
      attachmentId, transportEpoch };
    return validate('request', { ...payload, mac: sign(this.key, 'requests', context(m), payload) });
  }
  admit(socket, request, path, wireBody) {
    // Expired entries must fail as expired before pruning, then cannot revive.
    const session = this.connections.get(socket);
    if (!session) throw new Error('challenge_required');
    if (session.expiresAt <= this.now()) { this.connections.delete(socket); throw new Error('challenge_expired'); }
    try { validate('request', request); } catch (cause) { throw new Error('authentication_invalid', { cause }); }
    const m = this.marker, p = session.proof;
    if (request.generation !== m.generation || digest(request.publicationEpoch) !== digest(m.publicationEpoch) ||
      request.method !== 'POST' || request.authority !== new URL(m.endpoint).host || request.path !== path ||
      request.bodyDigest !== digest(wireBody) || request.serverNonce !== p.serverNonce ||
      request.connectionNonce !== p.connectionNonce || !verify(this.key, 'requests', context(m), unsigned(request), request.mac)) {
      throw new Error('authentication_invalid');
    }
    this.prune();
    const id = request.requestNonce;
    const control = isControlRequest(path, wireBody);
    if (session.pool === 'control' && !control) throw new Error('control_class_mismatch');
    if (this.nonces.has(id) || this.controlNonces.has(id)) throw new Error('nonce_replayed');
    const nonces = control ? this.controlNonces : this.nonces;
    if (nonces.size >= this.capacity) throw new Error('nonce_capacity');
    // Consume before dispatch. A failed application still consumes its nonce.
    nonces.set(id, session.expiresAt);
    return request;
  }
  frame(payload, { attachmentId, transportEpoch, channel, requestUid = null }) {
    if (!['responses', 'notifications', 'admission'].includes(channel)) throw new Error('frame_channel_unknown');
    const id = `${attachmentId}/${transportEpoch}/${channel}`;
    if (!this.sequences.has(id) && this.sequences.size >= this.capacity) throw new Error('sequence_capacity');
    const sequence = (this.sequences.get(id) ?? 0) + 1;
    this.sequences.set(id, sequence);
    const header = { schemaVersion: 1, generation: this.marker.generation, attachmentId,
      transportEpoch, channel, sequence, payloadDigest: digest(payload), requestUid };
    return { header: validate('frame', { ...header, mac: sign(this.key, channel, context(this.marker), header) }), payload };
  }
}

export class FrameVerifier {
  constructor(marker, rootKey, capacity = 4096) { this.marker = marker; this.key = rootKey; this.capacity = capacity; this.sequences = new Map(); this.rejectedFrames = 0; }
  accept(frame, expected) {
    try { return this.acceptFrame(frame, expected); } catch (error) { this.rejectedFrames++; throw error; }
  }
  acceptFrame(frame, expected) {
    if (!frame || Object.keys(frame).sort().join(',') !== 'header,payload') throw new Error('frame_invalid');
    const h = validate('frame', frame.header);
    if (!['responses', 'notifications', 'admission'].includes(h.channel) || h.generation !== this.marker.generation ||
      h.payloadDigest !== digest(frame.payload) || !verify(this.key, h.channel, context(this.marker), unsigned(h), h.mac)) throw new Error('frame_invalid');
    if (h.attachmentId !== expected.attachmentId || h.transportEpoch !== expected.transportEpoch ||
      h.requestUid !== expected.requestUid) throw new Error('frame_owner_mismatch');
    const id = `${h.attachmentId}/${h.transportEpoch}/${h.channel}`;
    if (h.sequence <= (this.sequences.get(id) ?? 0)) throw new Error('sequence_replayed');
    if (!this.sequences.has(id) && this.sequences.size >= this.capacity) throw new Error('sequence_capacity');
    this.sequences.set(id, h.sequence);
    return frame.payload;
  }
}
