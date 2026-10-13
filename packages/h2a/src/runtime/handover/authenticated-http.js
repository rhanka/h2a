import { Agent, request, createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ConnectionAuthentication, FrameVerifier } from './authentication.js';
import { readState } from './state.js';
import { digest } from './wire.js';
import { validate } from './formats.js';
import { dirname, join } from 'node:path';

const MAX_BYTES = 4 * 1024 * 1024;
const headersOf = headers => Object.fromEntries(headers.entries());
async function bytesOf(stream) {
  const chunks = []; let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error('http_frame_budget');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function readAuthenticationKey(markerPath, marker) {
  validate('marker', marker);
  const directory = dirname(markerPath);
  const domain = readState(join(directory, 'authority-domain.json'), 'authorityDomain')?.value;
  if (!domain || domain.prefixId !== marker.prefixId || domain.namespaceId !== marker.namespaceId ||
    domain.canonicalMarkerLocation !== markerPath || domain.canonicalRoot !== marker.root || domain.uid !== marker.uid) throw new Error('authority_marker_mismatch');
  const secret = readState(join(directory, marker.authKeyReference), 'secret')?.value;
  if (!secret || secret.purpose !== 'authentication' || secret.authorityBinding !== digest({ canonicalMarkerLocation: markerPath,
    prefixId: marker.prefixId, uid: marker.uid })) throw new Error('authentication_key_mismatch');
  return Buffer.from(secret.key, 'hex');
}

// Each operation owns its agent. Challenge and application use exactly the same
// socket; a close/reconnect cannot silently move the body to a new listener.
/** @param {*} options */
export async function authenticatedHttpRequest(markerPath, marker, url, options = {}) {
  const key = readAuthenticationKey(markerPath, marker);
  const endpoint = new URL(url);
  if (endpoint.origin !== new URL(marker.endpoint).origin || endpoint.search || endpoint.hash) throw new Error('authentication_endpoint_mismatch');
  const agent = new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
  const auth = new ConnectionAuthentication(marker, key), verifier = new FrameVerifier(marker, key);
  let socket;
  const exchange = (url, method, headers, body, requiredSocket) => new Promise((resolve, reject) => {
    const req = request(url, { agent, method, headers, signal: options.signal }, resolve);
    req.on('error', reject);
    req.once('socket', assigned => {
      if (requiredSocket && (assigned !== requiredSocket || assigned.destroyed)) {
        req.destroy(new Error('challenge_connection_lost')); return;
      }
      socket = assigned;
      req.end(body);
    });
  });
  try {
    const clientNonce = randomBytes(32).toString('hex');
    const response = await exchange(new URL(`/_h2a-central/challenge/${clientNonce}`, marker.endpoint), 'GET', {}, undefined);
    const proof = JSON.parse(await bytesOf(response));
    if (response.statusCode !== 200 || !auth.verifyChallenge(proof, clientNonce)) throw new Error('readiness_invalid');
    const challengedSocket = socket;
    const wireBody = { method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body ?? null };
    const path = endpoint.pathname;
    const attachmentId = options.attachmentId ?? 'control', transportEpoch = options.transportEpoch ?? 1;
    const signed = auth.request(proof, path, wireBody, { attachmentId, transportEpoch });
    const body = JSON.stringify(wireBody);
    const incoming = await exchange(endpoint, 'POST', { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)),
      'x-h2a-proof': Buffer.from(JSON.stringify(signed)).toString('base64url') }, body, challengedSocket);
    const expected = { attachmentId, transportEpoch, requestUid: signed.requestUid };
    const type = String(incoming.headers['content-type'] ?? '');
    if (!type.includes('text/event-stream')) {
      const frame = JSON.parse(await bytesOf(incoming));
      const payload = verifier.accept(frame, expected);
      agent.destroy();
      const serialized = payload.body === null ? '' : JSON.stringify(payload.body);
      return { ok: payload.status >= 200 && payload.status < 300, status: payload.status,
        headers: { get: name => payload.headers[name.toLowerCase()] ?? null },
        body: null, text: async () => serialized, json: async () => payload.body };
    }
    // SSE frames authenticate metadata and each message before a caller sees it.
    const metadata = JSON.parse(Buffer.from(String(incoming.headers['x-h2a-response']), 'base64url').toString());
    const status = verifier.accept(metadata, expected);
    async function* stream() {
      let buffer = '';
      try {
        for await (const chunk of incoming) {
          buffer += chunk.toString('utf8');
          if (Buffer.byteLength(buffer) > MAX_BYTES) throw new Error('http_frame_budget');
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const frame = JSON.parse(data);
            const isNotification = frame.header?.channel === 'notifications';
            const checking = isNotification && options.notificationVerifier ? options.notificationVerifier : verifier;
            const payload = checking.accept(frame, { ...expected, requestUid: isNotification ? null : signed.requestUid });
            yield Buffer.from(`data: ${JSON.stringify(payload)}\n\n`);
          }
        }
      } finally { agent.destroy(); }
    }
    return { ok: status.status >= 200 && status.status < 300, status: status.status,
      headers: { get: name => status.headers[name.toLowerCase()] ?? null }, body: stream(),
      text: async () => { let result = ''; for await (const chunk of stream()) result += chunk; return result; },
      json: async () => { throw new Error('sse_not_json'); } };
  } catch (error) { agent.destroy(); throw error; }
}

export function createAuthenticatedServer(auth, fetch) {
  const server = createServer(async (incoming, outgoing) => {
    const sendPlain = (status, body) => { outgoing.writeHead(status, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify(body)); };
    let admitted;
    try {
      const path = new URL(incoming.url, auth.marker.endpoint).pathname;
      if (incoming.method === 'GET' && path === '/_h2a-central/ping') { sendPlain(200, { generation: auth.marker.generation }); return; }
      if (incoming.method === 'GET' && path.startsWith('/_h2a-central/challenge/')) {
        if (auth.ready === false) throw new Error('readiness_unavailable');
        sendPlain(200, auth.challenge(incoming.socket, path.slice('/_h2a-central/challenge/'.length))); return;
      }
      if (incoming.method !== 'POST' || incoming.headers.authorization || !incoming.headers['x-h2a-proof']) throw new Error('authentication_required');
      if (incoming.headers.host !== new URL(auth.marker.endpoint).host) throw new Error('authentication_authority_invalid');
      const envelope = JSON.parse(await bytesOf(incoming));
      if (Object.keys(envelope).sort().join(',') !== 'body,headers,method' || !['GET', 'POST', 'DELETE'].includes(envelope.method) ||
        (envelope.body !== null && typeof envelope.body !== 'string') || !envelope.headers || typeof envelope.headers !== 'object') throw new Error('wire_body_invalid');
      const proof = JSON.parse(Buffer.from(String(incoming.headers['x-h2a-proof']), 'base64url').toString());
      admitted = auth.admit(incoming.socket, proof, path, envelope);
      const headers = new Headers(envelope.headers);
      headers.delete('authorization'); headers.delete('x-h2a-proof'); headers.delete('content-length');
      headers.set('host', new URL(auth.marker.endpoint).host);
      const controller = new AbortController();
      outgoing.once('close', () => controller.abort());
      const response = await fetch(new Request(new URL(path, auth.marker.endpoint), {
        method: envelope.method, headers, ...(envelope.body !== null ? { body: envelope.body } : {}), signal: controller.signal
      }), admitted);
      const ownership = { attachmentId: admitted.attachmentId ?? 'control', transportEpoch: admitted.transportEpoch ?? 1,
        channel: 'responses', requestUid: admitted.requestUid };
      const metadata = { status: response.status, headers: headersOf(response.headers) };
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const text = await response.text();
        const frame = auth.frame({ ...metadata, body: text ? JSON.parse(text) : null }, ownership);
        outgoing.writeHead(response.status, { 'content-type': 'application/json' });
        // Keep an authenticated body even for logical 204/202 responses.
        if (response.status === 204) outgoing.statusCode = 200;
        outgoing.end(JSON.stringify(frame)); return;
      }
      outgoing.writeHead(response.status, { 'content-type': 'text/event-stream',
        'x-h2a-response': Buffer.from(JSON.stringify(auth.frame(metadata, ownership))).toString('base64url') });
      let buffer = ''; const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += Buffer.from(value).toString('utf8');
          if (Buffer.byteLength(buffer) > MAX_BYTES) throw new Error('http_frame_budget');
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const message = JSON.parse(data);
            const notification = message.method && message.id === undefined;
            const frame = auth.frame(message, notification ? { ...ownership, channel: 'notifications', requestUid: null } : ownership);
            if (!outgoing.write(`data: ${JSON.stringify(frame)}\n\n`)) await new Promise(resolve => outgoing.once('drain', resolve));
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      outgoing.end();
    } catch (error) {
      auth.rejectedRequests = (auth.rejectedRequests ?? 0) + 1;
      if (outgoing.headersSent) { outgoing.destroy(error); return; }
      if (admitted) {
        const payload = { status: 409, headers: {}, body: { error: error.message } };
        const frame = auth.frame(payload, { attachmentId: admitted.attachmentId ?? 'control', transportEpoch: admitted.transportEpoch ?? 1,
          channel: 'responses', requestUid: admitted.requestUid });
        sendPlain(409, frame);
      } else sendPlain(401, { error: error.message });
    }
  });
  server.on('connection', socket => socket.once('close', () => auth.forget(socket)));
  // Upgrade / Expect paths never admit unsigned bodies.
  server.on('checkContinue', (_req, res) => { res.writeHead(401); res.end(); });
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}
