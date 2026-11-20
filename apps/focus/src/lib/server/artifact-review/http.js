// HTTP surface of the artifact review backend — aligned on DS review kit contract r6:
//
//   GET    /api/artifacts/:artifactId/comments                    → { threads: ReviewComment[][] }
//   POST   /api/artifacts/:artifactId/comments                    create or reply → ReviewComment
//   PATCH  /api/artifacts/:artifactId/comments/:commentId         { body } → ReviewComment (author-or-admin)
//   DELETE /api/artifacts/:artifactId/comments/:commentId         → { ok: true } (hard delete, author-or-admin)
//   POST   /api/artifacts/:artifactId/threads/:threadId/close     {} → { ok: true } (any participant w/ comment right)
//   POST   /api/artifacts/:artifactId/threads/:threadId/reopen    {} → { ok: true } (any participant w/ comment right)
//   POST   /api/artifacts/:artifactId/threads/:threadId/assign    { assignedTo: string | null } → { ok: true }
//   GET    /api/artifacts/:artifactId/stream (SSE)                → comment.created / comment.updated /
//                                                                   comment.deleted / thread.closed /
//                                                                   thread.reopened / thread.assigned / review.error
//   errors                                                        → { error: { code, message, ... } }
//
// DS r6 rules enforced here:
//   - `reply` accepts `{ tenant?, target?: { kind:'artifact', id?, sectionKey? }, threadId, body, provenance? }`
//     (and shorthand `sectionKey`), propagating `target.sectionKey` or falling back to the first chronological
//     row carrying `sectionKey` (`threadAnchorSectionKey`) so deleting the root row preserves the anchor.
//   - Non-human writes (carrying `provenance` or `actorKind`/`actor_kind`/`x-actor-kind: agent|nhi`) MUST carry
//     a non-empty `provenance.toolCallId` (`trim().min(1)`, `400 invalid_provenance` otherwise); `runId` is optional.
//   - `onCommentCreated` / delivery loop guard checks `!c.provenance?.toolCallId` explicitly: agent/NHI rows
//     never trigger `h2a send` (and `sendToAgent: true` with `provenance.toolCallId` is rejected with `400 loop_guard`).
//   - Over-cap `sectionKey` (> 2048 chars, D3) returns `400 section_key_too_long` with `{ maxLength: 2048 }`.
//   - Untrusted request body `author` is always ignored (H2 acceptance 1); authenticated caller comes from the
//     server principal (`resolveCaller`, defaulting to `config.owner`). Non-creator participants with the C2a
//     `comment` right can reply/close/reopen/assign; `edit`/`delete` are author-or-admin only.

import { decodeAnchor, SECTION_KEY_MAX } from './anchor.js';
import {
  groupThreads,
  isHumanComment,
  threadAnchorSectionKey,
  validateNonHumanProvenance
} from './comments-adapter.js';
import { ReviewError, asReviewError, errorBody } from './errors.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~@+=-]{0,255}$/;
const NON_MEMBER_REF_PATTERN = /^(?:track|decision):/i;
export const BODY_MAX = 16000;
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
 * The origin an agent or client addresses on loopback. adapter-node reports `https:` unless
 * ORIGIN/PROTOCOL_HEADER are set, but `h2a focus serve` is plain HTTP on loopback.
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
    ? {
        'access-control-allow-origin': origin,
        vary: 'Origin',
        'access-control-expose-headers': 'x-comments-store, x-comments-durable, x-agent-delivery, x-agent-target'
      }
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
      'Artifact review answers loopback clients only: Focus Web presents the local principal and is not a remote server.'
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
      'Writes must send content-type: application/json (close/reopen/delete: an empty body or {}).'
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
 * @returns {string}
 */
function parseBodyText(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReviewError('body_required', 400, 'body must be a non-empty string.');
  }
  const body = value.trim();
  if (body.length > BODY_MAX) {
    throw new ReviewError('body_too_long', 400, `body is ${body.length} characters; the maximum is ${BODY_MAX}.`);
  }
  return body;
}

/**
 * @param {unknown} raw
 * @param {Request} request
 * @returns {import('./types').ActorKind | undefined}
 */
function parseActorKind(raw, request) {
  const headerValue = request.headers.get('x-actor-kind');
  const candidate = raw ?? headerValue;
  if (candidate === undefined || candidate === null || candidate === '') return undefined;
  if (typeof candidate !== 'string') {
    throw new ReviewError('invalid_request', 400, 'actorKind must be one of human, agent, nhi.');
  }
  const lowered = candidate.trim().toLowerCase();
  if (lowered === 'human' || lowered === 'agent' || lowered === 'nhi') return lowered;
  throw new ReviewError('invalid_request', 400, 'actorKind must be one of human, agent, nhi.');
}

/**
 * @param {unknown} rawTenant
 * @param {import('./types').ReviewConfig} config
 * @returns {string}
 */
function resolveRequestTenant(rawTenant, config) {
  if (rawTenant === undefined || rawTenant === null || rawTenant === '') return config.workspaceId;
  if (typeof rawTenant !== 'string' || rawTenant.trim().length === 0) {
    throw new ReviewError('invalid_request', 400, 'tenant must be a non-empty workspace id string.');
  }
  const trimmed = rawTenant.trim();
  if (trimmed !== config.workspaceId) {
    throw new ReviewError(
      'forbidden',
      403,
      `Workspace ${trimmed} does not match the active workspace (${config.workspaceId}).`
    );
  }
  return config.workspaceId;
}

/**
 * Validate a POST body. Unknown fields (an `author`, for instance) are ignored, never trusted.
 * @param {Record<string, unknown>} input
 * @param {Request} request
 * @param {string} artifactId
 * @param {import('./types').ReviewConfig} config
 */
function parseCommentInput(input, request, artifactId, config) {
  const body = parseBodyText(input.body);
  const tenant = resolveRequestTenant(input.tenant, config);

  /** @type {string | undefined} */
  let threadId;
  if (input.threadId !== undefined && input.threadId !== null && input.threadId !== '') {
    threadId = requireId(typeof input.threadId === 'string' ? input.threadId : undefined, 'threadId');
  }

  /** @type {unknown} */
  let rawSectionKey = input.sectionKey;
  if (input.target !== undefined && input.target !== null) {
    if (typeof input.target !== 'object' || Array.isArray(input.target)) {
      throw new ReviewError('invalid_request', 400, 'target must be an object { kind: "artifact", id, sectionKey? }.');
    }
    const targetObj = /** @type {Record<string, unknown>} */ (input.target);
    if (targetObj.kind !== undefined && targetObj.kind !== 'artifact') {
      throw new ReviewError('invalid_request', 400, 'target.kind must be "artifact".');
    }
    if (targetObj.id !== undefined && targetObj.id !== artifactId) {
      throw new ReviewError('invalid_request', 400, `target.id (${String(targetObj.id)}) must match artifactId (${artifactId}).`);
    }
    if (targetObj.sectionKey !== undefined && targetObj.sectionKey !== null && targetObj.sectionKey !== '') {
      if (rawSectionKey !== undefined && rawSectionKey !== null && rawSectionKey !== '' && rawSectionKey !== targetObj.sectionKey) {
        throw new ReviewError('invalid_request', 400, 'sectionKey and target.sectionKey disagree.');
      }
      rawSectionKey = targetObj.sectionKey;
    }
  }

  /** @type {string | undefined} */
  let sectionKey;
  if (rawSectionKey !== undefined && rawSectionKey !== null && rawSectionKey !== '') {
    const decoded = decodeAnchor(rawSectionKey);
    if (!decoded.ok) {
      throw new ReviewError(
        decoded.code,
        400,
        decoded.message,
        decoded.code === 'section_key_too_long' ? { maxLength: SECTION_KEY_MAX } : decoded.details
      );
    }
    sectionKey = /** @type {string} */ (rawSectionKey);
  }

  if (input.sendToAgent !== undefined && typeof input.sendToAgent !== 'boolean') {
    throw new ReviewError('invalid_request', 400, 'sendToAgent must be a boolean.');
  }
  const sendToAgent = input.sendToAgent === true;

  const actorKind = parseActorKind(input.actorKind ?? input.actor_kind, request);
  const provenanceInput = input.provenance === null ? undefined : input.provenance;
  const provenance = validateNonHumanProvenance(
    /** @type {import('./types').CommentProvenance | undefined} */ (provenanceInput),
    actorKind
  );

  // DS r6 §4: loop guard explicitly filters on `provenance.toolCallId`.
  if (provenance?.toolCallId && sendToAgent) {
    throw new ReviewError(
      'loop_guard',
      400,
      'A comment carrying provenance.toolCallId is non-human and never sent to an agent (loop guard); drop sendToAgent.'
    );
  }

  /** @type {string | undefined} */
  let agentTarget;
  if (input.agentTarget !== undefined && input.agentTarget !== null && input.agentTarget !== '') {
    agentTarget = requireId(typeof input.agentTarget === 'string' ? input.agentTarget : undefined, 'agentTarget');
  }

  return { tenant, body, threadId, sectionKey, sendToAgent, provenance, actorKind, agentTarget };
}

/**
 * @param {import('./types').ReviewConfig} config
 * @returns {import('./types').ParticipantPrincipal}
 */
function defaultCaller(config) {
  return {
    id: config.owner.id,
    displayLabel: config.owner.displayLabel,
    role: 'admin',
    canComment: true
  };
}

/**
 * @param {import('./types').ParticipantPrincipal} caller
 */
function assertCanComment(caller) {
  if (!caller.canComment) {
    throw new ReviewError('forbidden', 403, `Principal ${caller.id} lacks the per-artifact comment right (C2a).`);
  }
}

/**
 * @param {import('./types').ParticipantPrincipal} caller
 * @param {import('./types').ReviewComment} comment
 * @param {'edit' | 'delete'} action
 */
function assertCanMutateRow(caller, comment, action) {
  assertCanComment(caller);
  if (caller.role === 'admin') return;
  if (comment.author.id === caller.id && isHumanComment(comment)) return;
  throw new ReviewError(
    'forbidden',
    403,
    `Principal ${caller.id} cannot ${action} comment ${comment.id}: author-or-admin permission is required (C2a).`
  );
}

/**
 * @param {import('./types').ReviewRequestEvent} event
 * @param {string} artifactId
 * @param {import('./types').ReviewRuntime} runtime
 * @param {import('./types').ReviewConfig} config
 * @param {import('./types').ParticipantPrincipal} caller
 * @param {Record<string, string>} headers
 */
async function createComment(event, artifactId, runtime, config, caller, headers) {
  assertCanComment(caller);
  assertJsonWrite(event.request);
  const input = parseCommentInput(await readJsonObject(event.request), event.request, artifactId, config);
  const author = { id: caller.id };
  const target = { kind: /** @type {const} */ ('artifact'), id: artifactId };

  /** @type {import('./types').ReviewComment} */
  let comment;
  if (input.threadId) {
    const thread = await runtime.adapter.listThread(input.tenant, target, input.threadId);
    if (thread.length === 0) {
      throw new ReviewError('thread_not_found', 404, `Thread ${input.threadId} does not exist on artifact ${artifactId}.`);
    }
    // DS r6 §1/§2: derive anchor from the FIRST chronological row carrying sectionKey (survives root deletion).
    const anchorKey = threadAnchorSectionKey(thread);
    if (input.sectionKey && anchorKey && input.sectionKey !== anchorKey) {
      throw new ReviewError(
        'anchor_mismatch',
        400,
        'A reply inherits the anchor of its thread; send the same sectionKey or none. Re-anchoring is unavailable until S5.'
      );
    }
    const effectiveSectionKey = input.sectionKey ?? anchorKey;
    comment = await runtime.adapter.reply({
      tenant: input.tenant,
      target: {
        kind: 'artifact',
        id: artifactId,
        ...(effectiveSectionKey ? { sectionKey: effectiveSectionKey } : {})
      },
      threadId: input.threadId,
      body: input.body,
      author,
      ...(input.provenance ? { provenance: input.provenance } : {}),
      ...(input.actorKind ? { actorKind: input.actorKind } : {})
    });
  } else {
    comment = await runtime.adapter.create({
      tenant: input.tenant,
      target: {
        kind: 'artifact',
        id: artifactId,
        ...(input.sectionKey ? { sectionKey: input.sectionKey } : {})
      },
      body: input.body,
      author,
      ...(input.provenance ? { provenance: input.provenance } : {}),
      ...(input.actorKind ? { actorKind: input.actorKind } : {})
    });
  }
  await runtime.events.refresh(artifactId);

  // DS r6 §4: onCommentCreated -> h2a send triggers ONLY for human comments (`!c.provenance?.toolCallId`).
  if (!input.sendToAgent || !isHumanComment(comment)) return json(comment, 201, headers);

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
 * @param {import('./types').ReviewConfig} config
 * @param {import('./types').ParticipantPrincipal} caller
 * @param {Record<string, string>} headers
 */
async function editComment(event, artifactId, runtime, config, caller, headers) {
  assertCanComment(caller);
  assertJsonWrite(event.request);
  const commentId = requireId(event.params.commentId, 'commentId');
  const raw = await readJsonObject(event.request);
  const tenant = resolveRequestTenant(raw.tenant, config);
  const body = parseBodyText(raw.body);
  const target = { kind: /** @type {const} */ ('artifact'), id: artifactId };

  const rows = await runtime.adapter.list(tenant, target);
  const existing = rows.find((row) => row.id === commentId);
  if (!existing) {
    throw new ReviewError('comment_not_found', 404, `Comment ${commentId} does not exist on artifact ${artifactId}.`);
  }
  assertCanMutateRow(caller, existing, 'edit');

  const updated = await runtime.adapter.edit({ tenant, target, commentId, body });
  await runtime.events.refresh(artifactId);
  return json(updated, 200, headers);
}

/**
 * @param {import('./types').ReviewRequestEvent} event
 * @param {string} artifactId
 * @param {import('./types').ReviewRuntime} runtime
 * @param {import('./types').ReviewConfig} config
 * @param {import('./types').ParticipantPrincipal} caller
 * @param {Record<string, string>} headers
 */
async function removeComment(event, artifactId, runtime, config, caller, headers) {
  assertCanComment(caller);
  assertJsonWrite(event.request);
  const commentId = requireId(event.params.commentId, 'commentId');
  const tenant = resolveRequestTenant(event.url.searchParams.get('tenant'), config);
  const target = { kind: /** @type {const} */ ('artifact'), id: artifactId };

  const rows = await runtime.adapter.list(tenant, target);
  const existing = rows.find((row) => row.id === commentId);
  if (!existing) {
    throw new ReviewError('comment_not_found', 404, `Comment ${commentId} does not exist on artifact ${artifactId}.`);
  }
  assertCanMutateRow(caller, existing, 'delete');

  await runtime.adapter.remove({ tenant, target, commentId });
  await runtime.events.refresh(artifactId);
  return json({ ok: true }, 200, headers);
}

/**
 * @param {import('./types').ReviewRequestEvent} event
 * @param {string} artifactId
 * @param {import('./types').ReviewRuntime} runtime
 * @param {import('./types').ReviewConfig} config
 * @param {import('./types').ParticipantPrincipal} caller
 * @param {Record<string, string>} headers
 */
async function assignThread(event, artifactId, runtime, config, caller, headers) {
  assertCanComment(caller);
  assertJsonWrite(event.request);
  const threadId = requireId(event.params.threadId, 'threadId');
  const raw = await readJsonObject(event.request);
  const tenant = resolveRequestTenant(raw.tenant, config);

  if (!('assignedTo' in raw) || raw.assignedTo === undefined) {
    throw new ReviewError('invalid_request', 400, 'assignedTo must be a workspace member id or null.');
  }
  /** @type {string | null} */
  let assigneeId;
  if (raw.assignedTo === null) {
    assigneeId = null;
  } else {
    const candidate = requireId(typeof raw.assignedTo === 'string' ? raw.assignedTo : undefined, 'assignedTo');
    if (NON_MEMBER_REF_PATTERN.test(candidate)) {
      throw new ReviewError(
        'invalid_assignee',
        400,
        `assignedTo (${candidate}) must be a workspace member id; Track/decision references belong in a Ref: reply trailer (DS r6).`
      );
    }
    if (config.workspaceMembers && !config.workspaceMembers.includes(candidate)) {
      throw new ReviewError(
        'invalid_assignee',
        400,
        `assignedTo (${candidate}) is not a member of workspace ${tenant}.`
      );
    }
    assigneeId = candidate;
  }

  await runtime.adapter.assign({
    tenant,
    target: { kind: 'artifact', id: artifactId },
    threadId,
    assigneeId
  });
  await runtime.events.refresh(artifactId);
  return json({ ok: true }, 200, headers);
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
 * @typedef {'comments.list' | 'comments.create' | 'comment.edit' | 'comment.remove' | 'thread.close' | 'thread.reopen' | 'thread.assign' | 'stream' | 'preflight'} ReviewRoute
 */

/**
 * @param {ReviewRoute} route
 * @param {import('./types').ReviewRequestEvent} event
 * @param {{
 *   config: import('./types').ReviewConfig,
 *   getRuntime: () => import('./types').ReviewRuntime,
 *   resolveCaller?: (event: import('./types').ReviewRequestEvent, config: import('./types').ReviewConfig) => import('./types').ParticipantPrincipal
 * }} context
 * @returns {Promise<Response>}
 */
export async function handleArtifactReview(route, event, { config, getRuntime, resolveCaller }) {
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
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': 'content-type, x-actor-kind',
          'access-control-max-age': '600'
        }
      });
    }
    const artifactId = requireId(event.params.artifactId, 'artifactId');
    const runtime = getRuntime();
    const headers = { ...cors, ...storeHeaders(runtime.adapter.store) };
    const caller = resolveCaller ? resolveCaller(event, config) : defaultCaller(config);

    switch (route) {
      case 'comments.list': {
        const tenant = resolveRequestTenant(event.url.searchParams.get('tenant'), config);
        return json(
          { threads: groupThreads(await runtime.adapter.list(tenant, { kind: 'artifact', id: artifactId })) },
          200,
          headers
        );
      }
      case 'comments.create':
        return await createComment(event, artifactId, runtime, config, caller, headers);
      case 'comment.edit':
        return await editComment(event, artifactId, runtime, config, caller, headers);
      case 'comment.remove':
        return await removeComment(event, artifactId, runtime, config, caller, headers);
      case 'thread.close':
      case 'thread.reopen': {
        assertCanComment(caller);
        assertJsonWrite(event.request);
        const threadId = requireId(event.params.threadId, 'threadId');
        const tenant = resolveRequestTenant(event.url.searchParams.get('tenant'), config);
        await runtime.adapter.setState({
          tenant,
          target: { kind: 'artifact', id: artifactId },
          threadId,
          state: route === 'thread.close' ? 'closed' : 'open'
        });
        await runtime.events.refresh(artifactId);
        return json({ ok: true }, 200, headers);
      }
      case 'thread.assign':
        return await assignThread(event, artifactId, runtime, config, caller, headers);
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
