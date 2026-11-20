// Browser-side CommentsAdapter (DS review kit contract r6 §1.4) for Focus Web (lot H1).
//
// Speaks 1:1 with `@sentropic/design-system-review-core`'s `CommentsAdapter` interface and binds
// to Focus Web's loopback backend routes (PR #469: `/api/artifacts/:artifactId/...`), which in turn
// forward to the cluster-mesh comments API (never a parallel h2a comment store).
//
// TODO(sentropic-C2b): Sentropic C2a (per-artifact `comment` authorization) is merged on sentropic
// main; C2b (dedicated artifact-comments HTTP router over CommentStore) is in progress. Today Focus
// Web's server backend binds `FOCUS_COMMENTS_URL` to the C2b HTTP contract, fails closed with
// `503 comments_unavailable` when `FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH=1`, and stubs C2b in-memory
// (`InMemoryCommentStore`) otherwise. Once C2b+C2c land in cluster-mesh, point `FOCUS_COMMENTS_URL`
// at the local cluster-mesh endpoint and retire the C2b stub; no client adapter change is required.

/** @typedef {import('@sentropic/design-system-review-core').CollaborationActor} CollaborationActor */
/** @typedef {import('@sentropic/design-system-review-core').Comment} Comment */
/** @typedef {import('@sentropic/design-system-review-core').CommentAuthorship} CommentAuthorship */
/** @typedef {import('@sentropic/design-system-review-core').CommentProvenance} CommentProvenance */
/** @typedef {import('@sentropic/design-system-review-core').CommentState} CommentState */
/** @typedef {import('@sentropic/design-system-review-core').CommentTarget} CommentTarget */
/** @typedef {import('@sentropic/design-system-review-core').CommentsAdapter} CommentsAdapter */
/** @typedef {import('@sentropic/design-system-review-core').CreateCommentInput} CreateCommentInput */
/** @typedef {import('@sentropic/design-system-review-core').ReplyCommentInput} ReplyCommentInput */
/** @typedef {import('@sentropic/design-system-review-core').ReviewAdapterErrorCode} ReviewAdapterErrorCode */
/** @typedef {import('@sentropic/design-system-review-core').ReviewComment} ReviewComment */

export const MAX_SECTION_KEY_LENGTH = 2048;
export const MISSING_BINDING_LABEL = 'comments unavailable (missing binding)';
const GENERIC_AGENT_ID = 'agent:generic';
const GENERIC_AGENT_LABEL = 'Agent';
const FALLBACK_ACTOR_COLOR = '#64748b';

/**
 * Adapter error aligned on `@sentropic/design-system-review-core` `ReviewAdapterError` plus
 * Focus Web transport states (`COMMENTS_UNAVAILABLE`, `SAVED_NOT_DELIVERED`).
 */
export class FocusCommentsAdapterError extends Error {
  /**
   * @param {ReviewAdapterErrorCode | 'COMMENTS_UNAVAILABLE' | 'SAVED_NOT_DELIVERED' | 'TRANSPORT_ERROR'} code
   * @param {number} status
   * @param {string} message
   * @param {{ saved?: boolean, comment?: ReviewComment, missingBinding?: boolean, upstreamCode?: string }} [details]
   */
  constructor(code, status, message, details = {}) {
    super(message);
    this.name = 'FocusCommentsAdapterError';
    this.code = code;
    this.status = status;
    this.saved = details.saved === true;
    this.comment = details.comment;
    this.missingBinding = details.missingBinding === true;
    this.upstreamCode = details.upstreamCode;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * DS r6 §1.2 target normalisation: `kind:'record' + recordType:'artifact'` -> `kind:'artifact'`,
 * dropping `recordType` so the kit only ever sees `kind:'artifact'`.
 *
 * @param {CommentTarget} target
 * @returns {CommentTarget}
 */
export function normalizeArtifactTarget(target) {
  if (target.kind === 'record' && target.recordType === 'artifact') {
    return {
      kind: 'artifact',
      id: target.id,
      ...(target.sectionKey ? { sectionKey: target.sectionKey } : {})
    };
  }
  return {
    kind: target.kind,
    id: target.id,
    ...(target.sectionKey ? { sectionKey: target.sectionKey } : {}),
    ...(target.recordType ? { recordType: target.recordType } : {})
  };
}

/**
 * DS r6 §1.1 single state vocabulary: `'open' | 'closed'` only. Never translates `'resolved'`.
 *
 * @param {unknown} state
 * @returns {CommentState}
 */
export function assertValidCommentState(state) {
  if (state === 'open' || state === 'closed') return state;
  throw new FocusCommentsAdapterError(
    'INVALID_STATE',
    502,
    `Invalid comment state ${JSON.stringify(state)}; contract requires "open" or "closed" only.`
  );
}

/**
 * DS r6 §1.3 / §4 predicate: human comments have no non-empty `provenance.toolCallId`.
 *
 * @param {{ provenance?: CommentProvenance } | null | undefined} comment
 * @returns {boolean}
 */
export function isHumanReviewComment(comment) {
  const toolCallId = comment?.provenance?.toolCallId;
  return !(typeof toolCallId === 'string' && toolCallId.trim().length > 0);
}

/**
 * DS r6 §1.3 pre-send validation: whenever `provenance` is supplied (or caller declares non-human
 * write), `provenance.toolCallId` MUST be a non-empty string (`trim().min(1)`).
 *
 * @param {CommentProvenance | undefined} provenance
 * @param {'human' | 'agent' | 'nhi'} [actorKind]
 * @returns {CommentProvenance | undefined}
 */
export function assertPreSendProvenance(provenance, actorKind) {
  const nonHuman = actorKind === 'agent' || actorKind === 'nhi';
  if (provenance === undefined && !nonHuman) return undefined;
  if (!isRecord(provenance)) {
    throw new FocusCommentsAdapterError(
      'PROVENANCE_TOOL_CALL_ID_REQUIRED',
      400,
      'Non-human comment writes require a non-empty provenance.toolCallId (e.g. agent:<sessionId>:<seq>).'
    );
  }
  const toolCallId = typeof provenance.toolCallId === 'string' ? provenance.toolCallId.trim() : '';
  if (!toolCallId) {
    throw new FocusCommentsAdapterError(
      'PROVENANCE_TOOL_CALL_ID_REQUIRED',
      400,
      'Non-human comment writes require a non-empty provenance.toolCallId (runId alone is dropped at write).'
    );
  }
  const runId = typeof provenance.runId === 'string' && provenance.runId.trim() ? provenance.runId.trim() : undefined;
  return runId ? { toolCallId, runId } : { toolCallId };
}

/**
 * Pre-send D3 cap check on `sectionKey` (2048 chars).
 *
 * @param {string | undefined} sectionKey
 */
function assertSectionKeyWithinCap(sectionKey) {
  if (typeof sectionKey === 'string' && sectionKey.length > MAX_SECTION_KEY_LENGTH) {
    throw new FocusCommentsAdapterError(
      'SECTION_KEY_TOO_LONG',
      400,
      `Anchor sectionKey exceeds the ${MAX_SECTION_KEY_LENGTH}-character cap (got ${sectionKey.length}).`
    );
  }
}

/**
 * @param {unknown} raw
 * @param {string} fallbackId
 * @param {'human' | 'agent' | 'nhi'} fallbackKind
 * @returns {CollaborationActor}
 */
function normalizeActor(raw, fallbackId, fallbackKind) {
  if (isRecord(raw) && typeof raw.actorId === 'string' && raw.actorId.trim()) {
    const kind = raw.kind === 'human' || raw.kind === 'agent' || raw.kind === 'nhi' ? raw.kind : fallbackKind;
    return {
      actorId: raw.actorId.trim(),
      kind,
      displayLabel:
        typeof raw.displayLabel === 'string' && raw.displayLabel.trim()
          ? raw.displayLabel.trim()
          : raw.actorId.trim(),
      color: typeof raw.color === 'string' && raw.color.trim() ? raw.color.trim() : FALLBACK_ACTOR_COLOR
    };
  }
  return {
    actorId: fallbackId,
    kind: fallbackKind,
    displayLabel: fallbackKind === 'human' ? fallbackId : GENERIC_AGENT_LABEL,
    color: FALLBACK_ACTOR_COLOR
  };
}

/**
 * Ensure a comment carries valid r6 `ReviewComment` shape (`target.kind === 'artifact'`,
 * `state: 'open' | 'closed'`, two-icon `authorship` when `provenance.toolCallId` is present).
 *
 * @param {unknown} raw
 * @param {string} fallbackWorkspaceId
 * @returns {ReviewComment}
 */
export function normalizeReviewComment(raw, fallbackWorkspaceId) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.threadId !== 'string') {
    throw new FocusCommentsAdapterError('TRANSPORT_ERROR', 502, 'Backend returned a malformed comment row.');
  }
  if (!isRecord(raw.target) || typeof raw.target.id !== 'string') {
    throw new FocusCommentsAdapterError('INVALID_TARGET', 502, `Comment ${raw.id} is missing target.`);
  }
  const target = normalizeArtifactTarget(/** @type {CommentTarget} */ (raw.target));
  const state = assertValidCommentState(raw.state);
  const authorId = isRecord(raw.author) && typeof raw.author.id === 'string' ? raw.author.id : 'unknown';
  const provenance =
    isRecord(raw.provenance) &&
    ((typeof raw.provenance.toolCallId === 'string' && raw.provenance.toolCallId.trim()) ||
      (typeof raw.provenance.runId === 'string' && raw.provenance.runId.trim()))
      ? {
          ...(typeof raw.provenance.toolCallId === 'string' && raw.provenance.toolCallId.trim()
            ? { toolCallId: raw.provenance.toolCallId.trim() }
            : {}),
          ...(typeof raw.provenance.runId === 'string' && raw.provenance.runId.trim()
            ? { runId: raw.provenance.runId.trim() }
            : {})
        }
      : undefined;

  const isAgent = Boolean(provenance?.toolCallId);
  /** @type {CommentAuthorship} */
  let authorship;
  if (isRecord(raw.authorship) && isRecord(raw.authorship.author)) {
    const author = normalizeActor(raw.authorship.author, isAgent ? GENERIC_AGENT_ID : authorId, isAgent ? 'agent' : 'human');
    const sponsor = isRecord(raw.authorship.sponsor)
      ? normalizeActor(raw.authorship.sponsor, authorId, 'human')
      : isAgent
        ? normalizeActor(null, authorId, 'human')
        : undefined;
    const runId =
      typeof raw.authorship.runId === 'string' && raw.authorship.runId.trim()
        ? raw.authorship.runId.trim()
        : undefined;
    authorship = {
      author,
      ...(sponsor ? { sponsor } : {}),
      ...(runId ? { runId } : {})
    };
  } else if (isAgent) {
    const sponsor = {
      actorId: authorId,
      kind: /** @type {const} */ ('human'),
      displayLabel:
        isRecord(raw.author) && typeof raw.author.displayLabel === 'string' && raw.author.displayLabel.trim()
          ? raw.author.displayLabel.trim()
          : authorId,
      color: FALLBACK_ACTOR_COLOR
    };
    const agentId = provenance?.runId && provenance.runId !== authorId ? provenance.runId : GENERIC_AGENT_ID;
    authorship = {
      author: {
        actorId: agentId,
        kind: 'agent',
        displayLabel: GENERIC_AGENT_LABEL,
        color: FALLBACK_ACTOR_COLOR
      },
      sponsor,
      ...(provenance?.runId ? { runId: provenance.runId } : {})
    };
  } else {
    authorship = {
      author: {
        actorId: authorId,
        kind: 'human',
        displayLabel:
          isRecord(raw.author) && typeof raw.author.displayLabel === 'string' && raw.author.displayLabel.trim()
            ? raw.author.displayLabel.trim()
            : authorId,
        color: FALLBACK_ACTOR_COLOR
      }
    };
  }

  const tenant = isRecord(raw.tenant) && typeof raw.tenant.workspaceId === 'string'
    ? {
        workspaceId: raw.tenant.workspaceId,
        ...(typeof raw.tenant.tenantId === 'string' ? { tenantId: raw.tenant.tenantId } : {}),
        ...(typeof raw.tenant.userId === 'string' ? { userId: raw.tenant.userId } : {})
      }
    : { workspaceId: fallbackWorkspaceId };

  return {
    id: raw.id,
    tenant,
    target,
    threadId: raw.threadId,
    author: {
      id: authorId,
      ...(isRecord(raw.author) &&
      (raw.author.kind === 'human' || raw.author.kind === 'agent' || raw.author.kind === 'nhi')
        ? { kind: raw.author.kind }
        : {}),
      ...(isRecord(raw.author) && typeof raw.author.displayLabel === 'string' && raw.author.displayLabel
        ? { displayLabel: raw.author.displayLabel }
        : {})
    },
    authorship,
    ...(typeof raw.assignedTo === 'string' && raw.assignedTo ? { assignedTo: raw.assignedTo } : {}),
    state,
    body: typeof raw.body === 'string' ? raw.body : String(raw.body ?? ''),
    ...(provenance ? { provenance } : {}),
    createdAt: String(raw.createdAt),
    ...(typeof raw.updatedAt === 'string' && raw.updatedAt ? { updatedAt: raw.updatedAt } : {})
  };
}

/**
 * @typedef {{
 *   kind: string,
 *   durable: boolean,
 *   label?: string
 * }} AdapterStoreStatus
 */

/**
 * @typedef {{
 *   artifactId: string,
 *   baseUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   EventSourceImpl?: typeof EventSource,
 *   pollMs?: number,
 *   sendToAgent?: () => boolean,
 *   agentTarget?: () => string | null | undefined,
 *   onStoreStatus?: (status: AdapterStoreStatus) => void
 * }} FocusHttpCommentsAdapterOptions
 */

/**
 * Create a browser-side `CommentsAdapter` (DS r6 §1.4) bound to Focus Web's `/api/artifacts/:id/...`
 * routes (PR #469).
 *
 * @param {FocusHttpCommentsAdapterOptions} options
 * @returns {CommentsAdapter & {
 *   createAsAgent(input: CreateCommentInput & { actorKind?: 'agent' | 'nhi' }): Promise<ReviewComment>,
 *   replyAsAgent(input: ReplyCommentInput & { actorKind?: 'agent' | 'nhi' }): Promise<ReviewComment>
 * }}
 */
export function createFocusHttpCommentsAdapter(options) {
  const {
    artifactId,
    baseUrl = '',
    fetchImpl = globalThis.fetch,
    EventSourceImpl = globalThis.EventSource,
    pollMs = 2000,
    sendToAgent,
    agentTarget,
    onStoreStatus
  } = options;

  /** @type {Set<(comment: ReviewComment) => void>} */
  const createdListeners = new Set();

  /** @param {string} id */
  const artifactBase = (id) => `${baseUrl.replace(/\/$/, '')}/api/artifacts/${encodeURIComponent(id)}`;

  /**
   * @param {Response} response
   */
  function captureStoreHeaders(response) {
    const kind = response.headers.get('x-comments-store');
    if (kind && onStoreStatus) {
      onStoreStatus({
        kind,
        durable: response.headers.get('x-comments-durable') === 'true'
      });
    }
  }

  /**
   * @param {string} url
   * @param {RequestInit} init
   * @param {string} workspaceId
   */
  async function requestJson(url, init, workspaceId) {
    /** @type {Response} */
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new FocusCommentsAdapterError(
        'COMMENTS_UNAVAILABLE',
        503,
        `${MISSING_BINDING_LABEL}: unable to reach Focus Web comments API (${reason}).`,
        { missingBinding: true }
      );
    }
    captureStoreHeaders(response);
    const text = await response.text();
    /** @type {any} */
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const errObj = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
      const upstreamCode = isRecord(errObj) && typeof errObj.code === 'string' ? errObj.code : undefined;
      const message =
        isRecord(errObj) && typeof errObj.message === 'string' && errObj.message.trim()
          ? errObj.message.trim()
          : `Comments request failed (HTTP ${response.status}).`;

      if (isRecord(errObj) && errObj.saved === true && isRecord(errObj.comment)) {
        const savedComment = normalizeReviewComment(errObj.comment, workspaceId);
        emitCreated(savedComment);
        throw new FocusCommentsAdapterError('SAVED_NOT_DELIVERED', response.status, message, {
          saved: true,
          comment: savedComment,
          upstreamCode
        });
      }
      if (response.status === 503 || upstreamCode === 'comments_unavailable') {
        onStoreStatus?.({ kind: 'unconfigured', durable: false, label: MISSING_BINDING_LABEL });
        const displayMessage = message.toLowerCase().includes(MISSING_BINDING_LABEL)
          ? message
          : `${MISSING_BINDING_LABEL}: ${message}`;
        throw new FocusCommentsAdapterError('COMMENTS_UNAVAILABLE', 503, displayMessage, {
          missingBinding: true,
          upstreamCode
        });
      }
      if (upstreamCode === 'section_key_too_long') {
        throw new FocusCommentsAdapterError('SECTION_KEY_TOO_LONG', 400, message, { upstreamCode });
      }
      if (upstreamCode === 'invalid_provenance') {
        throw new FocusCommentsAdapterError('PROVENANCE_TOOL_CALL_ID_REQUIRED', 400, message, { upstreamCode });
      }
      if (upstreamCode === 'invalid_assignee') {
        throw new FocusCommentsAdapterError('INVALID_ASSIGNEE', 400, message, { upstreamCode });
      }
      if (upstreamCode === 'body_required' || upstreamCode === 'body_too_long') {
        throw new FocusCommentsAdapterError('INVALID_BODY', 400, message, { upstreamCode });
      }
      if (response.status === 403 || upstreamCode === 'forbidden') {
        throw new FocusCommentsAdapterError('FORBIDDEN', 403, message, { upstreamCode });
      }
      if (
        response.status === 404 ||
        upstreamCode === 'thread_not_found' ||
        upstreamCode === 'comment_not_found'
      ) {
        throw new FocusCommentsAdapterError('NOT_FOUND', 404, message, { upstreamCode });
      }
      throw new FocusCommentsAdapterError('TRANSPORT_ERROR', response.status, message, { upstreamCode });
    }
    return payload;
  }

  /** @param {ReviewComment} comment */
  function emitCreated(comment) {
    for (const listener of [...createdListeners]) {
      try {
        listener(comment);
      } catch {
        // An observer error never rolls back a saved comment.
      }
    }
  }

  /**
   * @param {string} tenant
   * @param {CommentTarget} target
   * @returns {Promise<ReviewComment[]>}
   */
  async function list(tenant, target) {
    const normalized = normalizeArtifactTarget(target);
    if (normalized.kind !== 'artifact') {
      throw new FocusCommentsAdapterError(
        'INVALID_TARGET',
        400,
        `Artifact comments adapter only accepts target.kind "artifact" (got ${JSON.stringify(target.kind)}).`
      );
    }
    const query = new URLSearchParams({ tenant });
    const payload = await requestJson(`${artifactBase(normalized.id)}/comments?${query}`, { method: 'GET' }, tenant);
    if (!isRecord(payload) || !Array.isArray(payload.threads)) {
      throw new FocusCommentsAdapterError('TRANSPORT_ERROR', 502, 'Backend did not return { threads }.');
    }
    /** @type {ReviewComment[]} */
    const flat = [];
    for (const group of payload.threads) {
      if (!Array.isArray(group)) continue;
      for (const row of group) {
        flat.push(normalizeReviewComment(row, tenant));
      }
    }
    return flat;
  }

  /**
   * @param {{
   *   tenant: string,
   *   target: CommentTarget,
   *   body: string,
   *   threadId?: string,
   *   provenance?: CommentProvenance,
   *   actorKind?: 'human' | 'agent' | 'nhi'
   * }} input
   * @returns {Promise<ReviewComment>}
   */
  async function postComment(input) {
    const normalized = normalizeArtifactTarget(input.target);
    if (normalized.kind !== 'artifact') {
      throw new FocusCommentsAdapterError('INVALID_TARGET', 400, 'target.kind must be "artifact".');
    }
    const trimmedBody = typeof input.body === 'string' ? input.body.trim() : '';
    if (!trimmedBody) {
      throw new FocusCommentsAdapterError('INVALID_BODY', 400, 'Comment body must be non-empty.');
    }
    assertSectionKeyWithinCap(normalized.sectionKey);
    const provenance = assertPreSendProvenance(input.provenance, input.actorKind);
    const isNonHuman = Boolean(provenance?.toolCallId);
    const shouldNotify = !isNonHuman && Boolean(sendToAgent?.());
    const requestedTarget = shouldNotify ? agentTarget?.() : undefined;

    /** @type {Record<string, unknown>} */
    const body = {
      tenant: input.tenant,
      target: normalized,
      ...(normalized.sectionKey ? { sectionKey: normalized.sectionKey } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      body: trimmedBody,
      ...(provenance ? { provenance } : {}),
      ...(input.actorKind ? { actorKind: input.actorKind } : {}),
      ...(shouldNotify ? { sendToAgent: true } : {}),
      ...(requestedTarget ? { agentTarget: requestedTarget } : {})
    };

    const payload = await requestJson(
      `${artifactBase(normalized.id)}/comments`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(input.actorKind && input.actorKind !== 'human' ? { 'x-actor-kind': input.actorKind } : {})
        },
        body: JSON.stringify(body)
      },
      input.tenant
    );
    const saved = normalizeReviewComment(payload, input.tenant);
    emitCreated(saved);
    return saved;
  }

  /**
   * @param {string} tenant
   * @param {string} commentId
   * @param {string} body
   * @returns {Promise<ReviewComment>}
   */
  async function edit(tenant, commentId, body) {
    const trimmed = typeof body === 'string' ? body.trim() : '';
    if (!trimmed) {
      throw new FocusCommentsAdapterError('INVALID_BODY', 400, 'Comment body must be non-empty.');
    }
    const payload = await requestJson(
      `${artifactBase(artifactId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, body: trimmed })
      },
      tenant
    );
    return normalizeReviewComment(payload, tenant);
  }

  /**
   * @param {string} tenant
   * @param {string} threadId
   * @param {CommentState} state
   * @returns {Promise<void>}
   */
  async function setState(tenant, threadId, state) {
    const validState = assertValidCommentState(state);
    const action = validState === 'closed' ? 'close' : 'reopen';
    const query = new URLSearchParams({ tenant });
    await requestJson(
      `${artifactBase(artifactId)}/threads/${encodeURIComponent(threadId)}/${action}?${query}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      },
      tenant
    );
  }

  /**
   * @param {string} tenant
   * @param {string} commentId
   * @returns {Promise<void>}
   */
  async function remove(tenant, commentId) {
    const query = new URLSearchParams({ tenant });
    await requestJson(
      `${artifactBase(artifactId)}/comments/${encodeURIComponent(commentId)}?${query}`,
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      },
      tenant
    );
  }

  /**
   * @param {string} tenant
   * @param {string} threadId
   * @param {string | null} assigneeId
   * @returns {Promise<void>}
   */
  async function assign(tenant, threadId, assigneeId) {
    await requestJson(
      `${artifactBase(artifactId)}/threads/${encodeURIComponent(threadId)}/assign`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, assignedTo: assigneeId })
      },
      tenant
    );
  }

  /**
   * Subscribe to live updates via Focus Web's SSE `/stream` route with polling fallback.
   *
   * @param {string} tenant
   * @param {CommentTarget} target
   * @param {(comments: ReviewComment[]) => void} cb
   * @returns {() => void}
   */
  function subscribe(tenant, target, cb) {
    const normalized = normalizeArtifactTarget(target);
    let stopped = false;
    /** @type {EventSource | null} */
    let source = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = null;
    let refreshing = false;

    const refresh = async () => {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const next = await list(tenant, normalized);
        if (!stopped) cb(next);
      } catch {
        // Errors are surfaced via explicit reads / store status callbacks.
      } finally {
        refreshing = false;
      }
    };

    const startPolling = () => {
      if (stopped || timer !== null) return;
      timer = setInterval(() => {
        void refresh();
      }, Math.max(250, pollMs));
    };

    if (typeof EventSourceImpl === 'function') {
      try {
        source = new EventSourceImpl(`${artifactBase(normalized.id)}/stream`);
        const onMutation = () => {
          void refresh();
        };
        for (const eventName of [
          'comment.created',
          'comment.updated',
          'comment.deleted',
          'thread.closed',
          'thread.reopened',
          'thread.assigned'
        ]) {
          source.addEventListener(eventName, onMutation);
        }
        source.addEventListener('ready', (event) => {
          try {
            const parsed = JSON.parse(/** @type {MessageEvent} */ (event).data);
            if (isRecord(parsed?.store) && typeof parsed.store.kind === 'string') {
              onStoreStatus?.({
                kind: parsed.store.kind,
                durable: parsed.store.durable === true,
                ...(typeof parsed.store.label === 'string' ? { label: parsed.store.label } : {})
              });
            }
          } catch {
            // Ignore malformed SSE metadata frames.
          }
        });
        source.addEventListener('review.error', (event) => {
          try {
            const parsed = JSON.parse(/** @type {MessageEvent} */ (event).data);
            if (parsed?.error?.code === 'comments_unavailable') {
              onStoreStatus?.({
                kind: 'unconfigured',
                durable: false,
                label: parsed.error.message || MISSING_BINDING_LABEL
              });
            }
          } catch {
            // Ignore malformed SSE error frames.
          }
        });
        source.onerror = () => {
          // Fall back to polling if SSE drops.
          startPolling();
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      stopped = true;
      if (source) {
        source.close();
        source = null;
      }
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }

  return {
    list,
    create(input) {
      return postComment(input);
    },
    reply(input) {
      return postComment(input);
    },
    createAsAgent(input) {
      return postComment({ ...input, actorKind: input.actorKind ?? 'agent' });
    },
    replyAsAgent(input) {
      return postComment({ ...input, actorKind: input.actorKind ?? 'agent' });
    },
    edit,
    setState,
    remove,
    assign,
    // `reanchor` intentionally omitted until sentropic S5 lands (SPEC-r6 §1.4, §3).
    subscribe,
    onCommentCreated(cb) {
      createdListeners.add(cb);
      return () => {
        createdListeners.delete(cb);
      };
    }
  };
}
