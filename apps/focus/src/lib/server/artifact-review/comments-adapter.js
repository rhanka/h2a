// CommentsAdapter: the only seam between the Focus Web routes and the cluster-mesh comment metamodel.
//
// Owner correction (17/11): comments go through cluster-mesh, which already carries the comment metamodel;
// h2a/Focus Web is a client and keeps no comment store of its own. This module therefore never persists a
// comment: it either calls a `CommentStore` port instance (the `@sentropic/comments` port, wired by the
// runtime) or a cluster-mesh comments HTTP endpoint. Both bindings return the same normalised shape:
//
//   - target: DS r3 §1.2 — a read-back `kind:'record', recordType:'artifact'` becomes `kind:'artifact'`
//     and `recordType` is dropped; a row of any other kind is never rewritten into an artifact thread.
//   - state:  DS r3 §1.1 — the published 0.3.1 port still says 'resolved'; the wire and this API say
//     'closed' (shown « Resolved » by the kit). No third literal leaves this module.
//
// Every write is confirmed by a read-back before it is returned: a comment the store cannot show again is
// reported as `not_saved`, never presented as saved.

import { ReviewError } from './errors.js';

/** @typedef {import('./types').ReviewComment} ReviewComment */
/** @typedef {import('./types').CommentsAdapter} CommentsAdapter */
/** @typedef {import('./types').CommentProvenance} CommentProvenance */
/** @typedef {import('./types').TenantContext} TenantContext */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} target
 * @returns {ReviewComment['target'] | null}
 */
export function normalizeTarget(target) {
  if (!isRecord(target) || typeof target.id !== 'string') return null;
  const isArtifact =
    target.kind === 'artifact' || (target.kind === 'record' && target.recordType === 'artifact');
  if (!isArtifact) return null;
  return typeof target.sectionKey === 'string' && target.sectionKey.length > 0
    ? { kind: 'artifact', id: target.id, sectionKey: target.sectionKey }
    : { kind: 'artifact', id: target.id };
}

/**
 * @param {unknown} state
 * @returns {'open' | 'closed'}
 */
export function normalizeState(state) {
  if (state === 'open') return 'open';
  if (state === 'closed' || state === 'resolved') return 'closed';
  throw new ReviewError(
    'store_contract_violation',
    502,
    `The comment store returned an unknown thread state (${JSON.stringify(state)}); expected open or closed.`
  );
}

/**
 * @param {unknown} provenance
 * @returns {CommentProvenance | undefined}
 */
function normalizeProvenance(provenance) {
  if (!isRecord(provenance)) return undefined;
  /** @type {CommentProvenance} */
  const out = {};
  if (typeof provenance.toolCallId === 'string' && provenance.toolCallId) out.toolCallId = provenance.toolCallId;
  if (typeof provenance.runId === 'string' && provenance.runId) out.runId = provenance.runId;
  return out.toolCallId || out.runId ? out : undefined;
}

/**
 * Normalise one store row to the API shape, or `null` when the row is not an artifact comment.
 * @param {unknown} raw
 * @returns {ReviewComment | null}
 */
export function normalizeComment(raw) {
  if (!isRecord(raw)) return null;
  const target = normalizeTarget(raw.target);
  if (!target) return null;
  if (typeof raw.id !== 'string' || typeof raw.threadId !== 'string') {
    throw new ReviewError('store_contract_violation', 502, 'The comment store returned a row without id or threadId.');
  }
  const author = isRecord(raw.author) && typeof raw.author.id === 'string' ? raw.author : null;
  if (!author) {
    throw new ReviewError('store_contract_violation', 502, `Comment ${raw.id} has no author id.`);
  }
  /** @type {ReviewComment} */
  const comment = {
    id: raw.id,
    ...(isRecord(raw.tenant) ? { tenant: /** @type {TenantContext} */ ({ ...raw.tenant }) } : {}),
    target,
    threadId: raw.threadId,
    author: {
      id: author.id,
      ...(author.kind === 'human' || author.kind === 'agent' || author.kind === 'nhi' ? { kind: author.kind } : {}),
      ...(typeof author.displayLabel === 'string' && author.displayLabel ? { displayLabel: author.displayLabel } : {})
    },
    ...(typeof raw.assignedTo === 'string' && raw.assignedTo ? { assignedTo: raw.assignedTo } : {}),
    state: normalizeState(raw.state),
    body: typeof raw.body === 'string' ? raw.body : String(raw.body ?? ''),
    createdAt: String(raw.createdAt),
    ...(raw.updatedAt ? { updatedAt: String(raw.updatedAt) } : {})
  };
  const provenance = normalizeProvenance(raw.provenance);
  if (provenance) {
    // Keep the DS key order readable in fixtures: provenance sits after body.
    const { createdAt, updatedAt, ...head } = comment;
    return { ...head, provenance, createdAt, ...(updatedAt ? { updatedAt } : {}) };
  }
  return comment;
}

/**
 * createdAt ASC, then id ASC — the port's documented order, re-applied so both bindings agree.
 * @param {ReviewComment} a
 * @param {ReviewComment} b
 */
function byCreatedThenId(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * @param {unknown[]} rows
 * @param {string} artifactId
 * @returns {ReviewComment[]}
 */
function artifactRows(rows, artifactId) {
  if (!Array.isArray(rows)) {
    throw new ReviewError('store_contract_violation', 502, 'The comment store did not return a list.');
  }
  return rows
    .map(normalizeComment)
    .filter(/** @returns {c is ReviewComment} */ (c) => c !== null && c.target.id === artifactId)
    .sort(byCreatedThenId);
}

/**
 * Flat rows grouped by `threadId` (DS r3: flat threads), threads ordered by their first row.
 * @param {ReviewComment[]} comments
 * @returns {ReviewComment[][]}
 */
export function groupThreads(comments) {
  /** @type {Map<string, ReviewComment[]>} */
  const threads = new Map();
  for (const comment of [...comments].sort(byCreatedThenId)) {
    const rows = threads.get(comment.threadId);
    if (rows) rows.push(comment);
    else threads.set(comment.threadId, [comment]);
  }
  return [...threads.values()];
}

/**
 * Thread state as the stream and the kit read it: closed as soon as one row is closed (the Postgres
 * thread-summary rule), open otherwise.
 * @param {ReviewComment[]} rows
 * @returns {'open' | 'closed'}
 */
export function threadState(rows) {
  return rows.some((row) => row.state === 'closed') ? 'closed' : 'open';
}

/**
 * @param {unknown} error
 * @param {string} threadId
 */
function storeFailure(error, threadId) {
  const name = isRecord(error) ? error.name : undefined;
  if (name === 'ThreadNotFoundError' || name === 'CommentNotFoundError') {
    return new ReviewError('thread_not_found', 404, `Thread ${threadId} does not exist on this artifact.`);
  }
  if (error instanceof ReviewError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ReviewError('store_rejected', 502, `The comment store refused the write: ${message}`);
}

/**
 * Binding over a `CommentStore` port instance (`@sentropic/comments`).
 *
 * @param {{
 *   store: import('./types').CommentStorePort,
 *   tenant: TenantContext,
 *   closedState?: 'resolved' | 'closed',
 *   info?: import('./types').StoreInfo
 * }} options
 *   `closedState` is the literal the port expects for a closed thread: 'resolved' for the published
 *   0.3.1 port, 'closed' once the r3 §1.1 rename (sentropic lot C1) ships.
 * @returns {CommentsAdapter}
 */
export function createStorePortAdapter({ store, tenant, closedState = 'resolved', info }) {
  const scope = { ...tenant };

  /**
   * @param {string} artifactId
   * @param {string} threadId
   */
  async function listThread(artifactId, threadId) {
    return artifactRows(await store.listThread(scope, threadId), artifactId);
  }

  /**
   * @param {string} artifactId
   * @param {string} threadId
   * @param {string} id
   */
  async function readBack(artifactId, threadId, id) {
    const saved = (await listThread(artifactId, threadId)).find((row) => row.id === id);
    if (!saved) {
      throw new ReviewError(
        'not_saved',
        502,
        `The comment store accepted comment ${id} but does not return it on read-back; it is not shown as saved.`
      );
    }
    return saved;
  }

  /**
   * @param {{ artifactId: string, sectionKey?: string, body: string, author: import('./types').CommentAuthor, provenance?: CommentProvenance, threadId?: string }} input
   */
  async function add(input) {
    /** @type {unknown} */
    let created;
    try {
      created = await store.add(scope, {
        tenant: scope,
        target: {
          kind: 'artifact',
          id: input.artifactId,
          ...(input.sectionKey ? { sectionKey: input.sectionKey } : {})
        },
        author: { id: input.author.id },
        body: input.body,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.provenance ? { provenance: { ...input.provenance } } : {})
      });
    } catch (error) {
      throw storeFailure(error, input.threadId ?? '(new)');
    }
    if (!isRecord(created) || typeof created.id !== 'string' || typeof created.threadId !== 'string') {
      throw new ReviewError('not_saved', 502, 'The comment store did not return the created comment.');
    }
    return readBack(input.artifactId, created.threadId, created.id);
  }

  return {
    store: info ?? { kind: 'store-port', durable: false, label: 'CommentStore port' },
    polling: false,
    async list(artifactId) {
      return artifactRows(await store.listByTarget(scope, { kind: 'artifact', id: artifactId }), artifactId);
    },
    listThread,
    create(input) {
      return add(input);
    },
    async reply(input) {
      const thread = await listThread(input.artifactId, input.threadId);
      if (thread.length === 0) {
        throw new ReviewError('thread_not_found', 404, `Thread ${input.threadId} does not exist on this artifact.`);
      }
      // Replies inherit the root target, sectionKey included (r3 adapter `reply` takes only threadId).
      return add({ ...input, sectionKey: thread[0].target.sectionKey });
    },
    async setState({ artifactId, threadId, state }) {
      const thread = await listThread(artifactId, threadId);
      if (thread.length === 0) {
        throw new ReviewError('thread_not_found', 404, `Thread ${threadId} does not exist on this artifact.`);
      }
      try {
        await store.setState(scope, threadId, state === 'closed' ? closedState : 'open');
      } catch (error) {
        throw storeFailure(error, threadId);
      }
      const rows = await listThread(artifactId, threadId);
      if (threadState(rows) !== state) {
        throw new ReviewError(
          'not_saved',
          502,
          `The comment store did not apply state ${state} to thread ${threadId} (read-back shows ${threadState(rows)}).`
        );
      }
      return rows;
    }
  };
}

/**
 * Binding over a cluster-mesh comments HTTP endpoint exposing the existing `/comments` routes
 * (`@sentropic/comments/hono`: GET/POST /comments, POST /comments/:id/close|reopen). Wire rows are
 * snake_case; the router's create carries no provenance, so agent rows are refused here rather than
 * stored without their run marker (gap G1, sentropic lot C2).
 *
 * @param {{
 *   baseUrl: string,
 *   token?: string,
 *   tenant: TenantContext,
 *   fetchImpl?: typeof fetch
 * }} options
 * @returns {CommentsAdapter}
 */
export function createClusterMeshHttpAdapter({ baseUrl, token, tenant, fetchImpl = fetch }) {
  /** @type {URL} */
  let base;
  try {
    base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  } catch {
    throw new ReviewError('comments_misconfigured', 500, 'FOCUS_COMMENTS_URL is not a valid URL.');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new ReviewError('comments_misconfigured', 500, 'FOCUS_COMMENTS_URL must be an http(s) URL.');
  }
  const endpoint = base.origin + base.pathname.replace(/\/$/, '');

  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown }} [init]
   * @returns {Promise<any>}
   */
  async function call(path, init = {}) {
    /** @type {Record<string, string>} */
    const headers = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    /** @type {Response} */
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: init.method ?? 'GET',
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ReviewError(
        'comments_unavailable',
        503,
        `The cluster-mesh comments endpoint ${endpoint} is unreachable (${reason}); nothing was written.`
      );
    }
    const raw = await response.text();
    /** @type {any} */
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const said = (isRecord(payload) && (payload.message || payload.error)) || response.statusText || 'no message';
      const hint =
        response.status === 400 || response.status === 404
          ? ' This endpoint does not admit artifact targets yet (gap G1, sentropic lot C2).'
          : '';
      throw new ReviewError(
        'store_rejected',
        502,
        `The cluster-mesh comments endpoint refused ${init.method ?? 'GET'} ${path} (HTTP ${response.status}: ${String(said)}).${hint}`,
        { upstreamStatus: response.status }
      );
    }
    return payload;
  }

  /**
   * @param {any} item
   * @returns {unknown}
   */
  function fromWire(item) {
    if (!isRecord(item)) return null;
    return {
      id: item.id,
      tenant: { ...tenant, ...(typeof item.created_by === 'string' ? { userId: item.created_by } : {}) },
      target: {
        kind: item.context_type === 'artifact' ? 'artifact' : 'record',
        id: item.context_id,
        ...(item.context_type !== 'artifact' ? { recordType: item.context_type } : {}),
        ...(typeof item.section_key === 'string' && item.section_key ? { sectionKey: item.section_key } : {})
      },
      threadId: item.thread_id,
      author: { id: item.created_by },
      ...(item.assigned_to ? { assignedTo: item.assigned_to } : {}),
      state: item.status,
      body: item.content,
      ...(item.tool_call_id ? { provenance: { toolCallId: item.tool_call_id } } : {}),
      createdAt: item.created_at,
      ...(item.updated_at && item.updated_at !== item.created_at ? { updatedAt: item.updated_at } : {})
    };
  }

  /** @param {string} artifactId */
  async function list(artifactId) {
    const query = new URLSearchParams({ context_type: 'artifact', context_id: artifactId });
    const payload = await call(`comments?${query}`);
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new ReviewError('store_contract_violation', 502, 'The cluster-mesh comments endpoint did not return { items }.');
    }
    return artifactRows(payload.items.map(fromWire), artifactId);
  }

  /**
   * @param {string} artifactId
   * @param {string} threadId
   */
  async function listThread(artifactId, threadId) {
    return (await list(artifactId)).filter((row) => row.threadId === threadId);
  }

  /** @param {CommentProvenance | undefined} provenance */
  function refuseProvenance(provenance) {
    if (provenance) {
      throw new ReviewError(
        'provenance_unsupported',
        501,
        'The cluster-mesh comments endpoint cannot record provenance (no provenance field on POST /comments, gap G1); the agent reply was not written.'
      );
    }
  }

  /**
   * @param {{ artifactId: string, sectionKey?: string, body: string, threadId?: string }} input
   */
  async function post(input) {
    const created = await call('comments', {
      method: 'POST',
      body: {
        context_type: 'artifact',
        context_id: input.artifactId,
        ...(input.sectionKey ? { section_key: input.sectionKey } : {}),
        content: input.body,
        ...(input.threadId ? { thread_id: input.threadId } : {})
      }
    });
    if (!isRecord(created) || typeof created.id !== 'string') {
      throw new ReviewError('not_saved', 502, 'The cluster-mesh comments endpoint did not return the created comment id.');
    }
    const saved = (await list(input.artifactId)).find((row) => row.id === created.id);
    if (!saved) {
      throw new ReviewError(
        'not_saved',
        502,
        `The cluster-mesh comments endpoint accepted comment ${created.id} but does not return it on read-back.`
      );
    }
    return saved;
  }

  return {
    store: { kind: 'cluster-mesh-http', durable: true, label: `cluster-mesh comments endpoint ${endpoint}` },
    polling: true,
    list,
    listThread,
    async create(input) {
      refuseProvenance(input.provenance);
      return post(input);
    },
    async reply(input) {
      refuseProvenance(input.provenance);
      const thread = await listThread(input.artifactId, input.threadId);
      if (thread.length === 0) {
        throw new ReviewError('thread_not_found', 404, `Thread ${input.threadId} does not exist on this artifact.`);
      }
      return post({ ...input, sectionKey: thread[0].target.sectionKey });
    },
    async setState({ artifactId, threadId, state }) {
      const thread = await listThread(artifactId, threadId);
      if (thread.length === 0) {
        throw new ReviewError('thread_not_found', 404, `Thread ${threadId} does not exist on this artifact.`);
      }
      await call(`comments/${encodeURIComponent(thread[0].id)}/${state === 'closed' ? 'close' : 'reopen'}`, {
        method: 'POST'
      });
      const rows = await listThread(artifactId, threadId);
      if (threadState(rows) !== state) {
        throw new ReviewError(
          'not_saved',
          502,
          `The cluster-mesh comments endpoint did not apply state ${state} to thread ${threadId}.`
        );
      }
      return rows;
    }
  };
}
