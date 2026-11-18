// HTTP surface of the artifact review backend — API contract v0 (h2a Focus Web ↔ UI), implemented as is:
//
//   GET  /api/artifacts/:artifactId/comments                    → { threads: Comment[][] }
//   POST /api/artifacts/:artifactId/comments                    { sectionKey, body, threadId?, sendToAgent? } → Comment
//   POST /api/artifacts/:artifactId/threads/:threadId/close     → { ok: true }
//   POST /api/artifacts/:artifactId/threads/:threadId/reopen    → { ok: true }
//   GET  /api/artifacts/:artifactId/stream (SSE)                → comment.created / thread.closed / thread.reopened
//   errors                                                      → { error: { code, message, ... } }
//
// Additive, backward-compatible extensions (absent from v0, ignored by a v0 client):
//   - POST body `provenance: { runId, toolCallId? }` marks an AGENT reply: stored under the owner id with that
//     provenance (r3 fallback until D1) and never delivered again (loop guard);
//   - POST body `agentTarget` names the receiving session explicitly (first rung of the target ladder);
//   - headers `x-comments-store`/`x-comments-durable` on every answer, `x-agent-delivery`/`x-agent-target`
//     on a delivered POST; stream events `ready`, `agent.delivery`, `review.error`;
//   - CORS for loopback origins, so a UI served from another local port can call the API.
//
// Gates, in order: feature flag (FOCUS_ARTIFACT_REVIEW, default off → 404), loopback client (the server
// presents the owner principal, so nothing is served to another machine), loopback Origin when one is sent,
// and `content-type: application/json` on EVERY write, close/reopen included (an HTML form cannot forge
// it). The last gate also matches SvelteKit: in a production build its CSRF guard refuses a POST without a
// content type before any route runs (403, plain text), so a body-less POST could never work there anyway.
// The author is ALWAYS the configured owner: a payload that claims another author is ignored.

import { decodeAnchor } from './anchor.js';
import { groupThreads } from './comments-adapter.js';
import { ReviewError, asReviewError, errorBody } from './errors.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~@+=-]{0,255}$/;
export const BODY_MAX = 16000;
const PROVENANCE_FIELD_MAX = 256;
const HEARTBEAT_MS = 15000;

/**
 * @param {string} address
 */
export function isLoopbackAddress(address) {
  const value = String(address ?? '').trim().toLowerCase();
  return (
    value === '::1' ||
    value === 'localhost' ||
    /^127(?:\.\d{1,3}){3}$/.test(value) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(value)
  );
}

/**
 * @param {string} origin
 */
export function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return isLoopbackAddress(host);
  } catch {
    return false;
  }
}

/**
 * The origin an agent must call back. adapter-node reports `https:` unless ORIGIN/PROTOCOL_HEADER are set
 * (it assumes a TLS proxy), but `h2a focus serve` is plain HTTP on loopback: a loopback host is http.
 * @param {URL} url
 */
export function callbackOrigin(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return `${isLoopbackAddress(host) ? 'http:' : url.protocol}//${url.host}`;
}

/**
 * @param {string | null} origin
 * @returns {Record<string, string>}
 */
function corsHeaders(origin) {
  return origin && isLoopbackOrigin(origin)
    ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': 'x-comments-store, x-comments-durable, x-agent-delivery, x-agent-target' }
    : {};
}

/**
 * @param {import('./types').StoreInfo} store
 * @returns {Record<string, string>}
 */
function storeHeaders(store) {
  return { 'x-comments-store': store.kind, 'x-comments-durable': String(store.durable) };
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} headers
 */
function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

/**
 * @param {string | undefined} value
 * @param {string} label
 */
function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new ReviewError('invalid_request', 400, `${label} must be 1-256 characters of [A-Za-z0-9._:~@+=-].`);
  }
  return value;
}

/**
 * @param {import('./types').ReviewRequestEvent} event
 */
function assertLoopbackClient(event) {
  /** @type {string} */
  let address;
  try {
    address = event.getClientAddress();
  } catch {
    address = '';
  }
  if (!isLoopbackAddress(address)) {
    throw new ReviewError(
      'non_loopback_client',
      403,
      'Artifact review answers loopback clients only: Focus Web presents the owner principal and is not an authenticated server.'
    );
  }
}

/**
 * @param {Request} request
 */
function assertJsonWrite(request) {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new ReviewError(
      'unsupported_media_type',
      415,
      'Writes must send content-type: application/json (close/reopen: an empty body or {}).'
    );
  }
}

/**
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonObject(request) {
  /** @type {unknown} */
  let value;
  try {
    value = await request.json();
  } catch {
    throw new ReviewError('invalid_json', 400, 'The request body is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewError('invalid_request', 400, 'The request body must be a JSON object.');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function provenanceText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > PROVENANCE_FIELD_MAX) {
    throw new ReviewError('invalid_request', 400, `provenance.${field} must be a non-empty string of at most ${PROVENANCE_FIELD_MAX} characters.`);
  }
  return value.trim();
}

/**
 * Validate a POST body. Unknown fields (an `author`, for instance) are ignored, never trusted.
 * @param {Record<string, unknown>} input
 */
function parseCommentInput(input) {
  if (typeof input.body !== 'string' || input.body.trim().length === 0) {
    throw new ReviewError('body_required', 400, 'body must be a non-empty string.');
  }
  const body = input.body.trim();
  if (body.length > BODY_MAX) {
    throw new ReviewError('body_too_long', 400, `body is ${body.length} characters; the maximum is ${BODY_MAX}.`);
  }
  /** @type {string | undefined} */
  let threadId;
  if (input.threadId !== undefined && input.threadId !== null && input.threadId !== '') {
    threadId = requireId(typeof input.threadId === 'string' ? input.threadId : undefined, 'threadId');
  }
  /** @type {string | undefined} */
  let sectionKey;
  if (input.sectionKey !== undefined && input.sectionKey !== null && input.sectionKey !== '') {
    const decoded = decodeAnchor(input.sectionKey);
    if (!decoded.ok) throw new ReviewError(decoded.code, 400, decoded.message);
    sectionKey = /** @type {string} */ (input.sectionKey);
  }
  if (input.sendToAgent !== undefined && typeof input.sendToAgent !== 'boolean') {
    throw new ReviewError('invalid_request', 400, 'sendToAgent must be a boolean.');
  }
  const sendToAgent = input.sendToAgent === true;
  /** @type {import('./types').CommentProvenance | undefined} */
  let provenance;
  if (input.provenance !== undefined && input.provenance !== null) {
    const raw = input.provenance;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ReviewError('invalid_request', 400, 'provenance must be an object { runId, toolCallId? }.');
    }
    const record = /** @type {Record<string, unknown>} */ (raw);
    provenance = { runId: provenanceText(record.runId, 'runId') };
    if (record.toolCallId !== undefined) provenance.toolCallId = provenanceText(record.toolCallId, 'toolCallId');
  }
  if (provenance && sendToAgent) {
    throw new ReviewError(
      'loop_guard',
      400,
      'A comment carrying agent provenance is never sent to an agent (loop guard); drop sendToAgent.'
    );
  }
  /** @type {string | undefined} */
  let agentTarget;
  if (input.agentTarget !== undefined && input.agentTarget !== null && input.agentTarget !== '') {
    agentTarget = requireId(typeof input.agentTarget === 'string' ? input.agentTarget : undefined, 'agentTarget');
  }
  return { body, threadId, sectionKey, sendToAgent, provenance, agentTarget };
}

/**
 * @param {import('./types').ReviewRequestEvent} event
 * @param {string} artifactId
 * @param {import('./types').ReviewRuntime} runtime
 * @param {import('./types').ReviewConfig} config
 * @param {Record<string, string>} headers
 */
async function createComment(event, artifactId, runtime, config, headers) {
  assertJsonWrite(event.request);
  const input = parseCommentInput(await readJsonObject(event.request));
  const author = { id: config.owner.id };
  /** @type {import('./types').ReviewComment} */
  let comment;
  if (input.threadId) {
    const thread = await runtime.adapter.listThread(artifactId, input.threadId);
    if (thread.length === 0) {
      throw new ReviewError('thread_not_found', 404, `Thread ${input.threadId} does not exist on artifact ${artifactId}.`);
    }
    const rootKey = thread[0].target.sectionKey;
    if (input.sectionKey && input.sectionKey !== rootKey) {
      throw new ReviewError(
        'anchor_mismatch',
        400,
        'A reply inherits the anchor of its thread; send the same sectionKey or none. Re-anchoring is a separate operation.'
      );
    }
    comment = await runtime.adapter.reply({
      artifactId,
      threadId: input.threadId,
      body: input.body,
      author,
      ...(input.provenance ? { provenance: input.provenance } : {})
    });
  } else {
    comment = await runtime.adapter.create({
      artifactId,
      ...(input.sectionKey ? { sectionKey: input.sectionKey } : {}),
      body: input.body,
      author,
      ...(input.provenance ? { provenance: input.provenance } : {})
    });
  }
  await runtime.events.refresh(artifactId);
  if (!input.sendToAgent) return json(comment, 201, headers);

  const decoded = comment.target.sectionKey ? decodeAnchor(comment.target.sectionKey) : null;
  try {
    const delivery = await runtime.deliverComment({
      comment,
      anchor: decoded && decoded.ok ? decoded.anchor : null,
      origin: callbackOrigin(event.url),
      ...(input.agentTarget ? { requested: input.agentTarget } : {})
    });
    runtime.events.publish(artifactId, {
      event: 'agent.delivery',
      data: { artifactId, threadId: comment.threadId, commentId: comment.id, ok: true, ...delivery }
    });
    return json(comment, 201, { ...headers, 'x-agent-delivery': delivery.status, 'x-agent-target': delivery.target });
  } catch (error) {
    const failure = asReviewError(error);
    runtime.events.publish(artifactId, {
      event: 'agent.delivery',
      data: {
        artifactId,
        threadId: comment.threadId,
        commentId: comment.id,
        ok: false,
        error: { code: failure.code, message: failure.message }
      }
    });
    // The comment IS saved: say so in the error itself, so a UI never retries into a duplicate.
    failure.details = { ...failure.details, saved: true, comment };
    throw failure;
  }
}

/**
 * @param {import('./types').ReviewRequestEvent} event
 * @param {string} artifactId
 * @param {import('./types').ReviewRuntime} runtime
 * @param {Record<string, string>} headers
 */
function streamComments(event, artifactId, runtime, headers) {
  const encoder = new TextEncoder();
  let closed = false;
  /** @type {() => void} */
  let unsubscribe = () => {};
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let heartbeat;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
  };
  const stream = new ReadableStream({
    async start(controller) {
      /** @param {string} chunk */
      const write = (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      /**
       * @param {string} name
       * @param {unknown} data
       */
      const send = (name, data) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      write('retry: 3000\n\n');
      try {
        const stop = await runtime.events.subscribe(artifactId, (entry) => send(entry.event, entry.data));
        if (closed) stop();
        else unsubscribe = stop;
      } catch (error) {
        const failure = asReviewError(error);
        send('review.error', { artifactId, error: { code: failure.code, message: failure.message } });
      }
      send('ready', { artifactId, store: runtime.adapter.store });
      heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      if (typeof heartbeat.unref === 'function') heartbeat.unref();
      event.request.signal?.addEventListener(
        'abort',
        () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed by the consumer
          }
        },
        { once: true }
      );
    },
    cancel() {
      cleanup();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      ...headers
    }
  });
}

/**
 * @typedef {'comments.list' | 'comments.create' | 'thread.close' | 'thread.reopen' | 'stream' | 'preflight'} ReviewRoute
 */

/**
 * @param {ReviewRoute} route
 * @param {import('./types').ReviewRequestEvent} event
 * @param {{ config: import('./types').ReviewConfig, getRuntime: () => import('./types').ReviewRuntime }} context
 * @returns {Promise<Response>}
 */
export async function handleArtifactReview(route, event, { config, getRuntime }) {
  const origin = event.request.headers.get('origin');
  const cors = corsHeaders(origin);
  try {
    if (!config.enabled) {
      throw new ReviewError(
        'feature_disabled',
        404,
        'Artifact review is disabled on this Focus Web server; start it with FOCUS_ARTIFACT_REVIEW=1.'
      );
    }
    assertLoopbackClient(event);
    if (origin && !isLoopbackOrigin(origin)) {
      throw new ReviewError('forbidden_origin', 403, `Origin ${origin} is not a loopback origin.`);
    }
    if (route === 'preflight') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600'
        }
      });
    }
    const artifactId = requireId(event.params.artifactId, 'artifactId');
    const runtime = getRuntime();
    const headers = { ...cors, ...storeHeaders(runtime.adapter.store) };
    switch (route) {
      case 'comments.list':
        return json({ threads: groupThreads(await runtime.adapter.list(artifactId)) }, 200, headers);
      case 'comments.create':
        return await createComment(event, artifactId, runtime, config, headers);
      case 'thread.close':
      case 'thread.reopen': {
        assertJsonWrite(event.request);
        const threadId = requireId(event.params.threadId, 'threadId');
        await runtime.adapter.setState({ artifactId, threadId, state: route === 'thread.close' ? 'closed' : 'open' });
        await runtime.events.refresh(artifactId);
        return json({ ok: true }, 200, headers);
      }
      case 'stream':
        return streamComments(event, artifactId, runtime, headers);
      default:
        throw new ReviewError('not_found', 404, `Unknown artifact review route ${String(route)}.`);
    }
  } catch (error) {
    const failure = asReviewError(error);
    return json(errorBody(failure), failure.status, cors);
  }
}
