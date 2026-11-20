/**
 * Seam unique UI ↔ monde (SPEC DS r3) : `CommentsAdapter`.
 * - `FakeCommentsAdapter` : fake en page implémentant exactement le contrat
 *   HTTP figé (mêmes routes, mêmes formes) sur `localStorage`, SSE simulé par
 *   abonnement local et réponse d'agent simulée pour `sendToAgent`.
 * - `HttpCommentsAdapter` : mêmes verbes contre les vraies routes
 *   `/api/artifacts/:artifactId/...` + `EventSource` sur `.../stream`.
 * Bascule : `createCommentsAdapter({ baseUrl })` — avec `baseUrl`, HTTP ;
 * sans, fake. Aucun autre code ne change.
 */
import { fitsAnchorCap } from './review-core.js';

let sequence = 0;
const nextId = (kind) => `${kind}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

function assertBody(body) {
  if (typeof body !== 'string' || !body.trim()) throw Object.assign(new Error('Comment body must not be empty'), { code: 'empty-body' });
}
function assertAnchor(sectionKey) {
  if (sectionKey !== undefined && !fitsAnchorCap(sectionKey)) {
    throw Object.assign(new Error('Anchor exceeds the 2048-character cap'), { code: 'anchor-too-large' });
  }
}

function memoryStorage() {
  const rows = new Map();
  return {
    getItem: key => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: key => rows.delete(key),
  };
}

export class FakeCommentsAdapter {
  constructor({ artifactId, storage, currentUser, agentDelayMs = 600 } = {}) {
    this.artifactId = artifactId;
    this.currentUser = currentUser ?? { actorId: 'owner', kind: 'human', displayLabel: 'Owner', color: '#2563eb' };
    this.agentDelayMs = agentDelayMs;
    try {
      this.storage = storage ?? window.localStorage;
      this.storage.getItem('h2a-review:probe');
    } catch {
      this.storage = memoryStorage();
    }
    this.key = `h2a-review:${artifactId}`;
    this.listeners = new Set();
  }

  #read() {
    try { return JSON.parse(this.storage.getItem(this.key) ?? '[]'); } catch { return []; }
  }
  #write(rows) {
    this.storage.setItem(this.key, JSON.stringify(rows));
  }
  #emit(event) {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** GET /api/artifacts/:artifactId/comments → { threads: Comment[][] } */
  async listThreads() {
    const rows = this.#read().filter(row => row.target?.id === this.artifactId);
    const grouped = new Map();
    for (const row of rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!grouped.has(row.threadId)) grouped.set(row.threadId, []);
      grouped.get(row.threadId).push(row);
    }
    return { threads: [...grouped.values()] };
  }

  /** POST /api/artifacts/:artifactId/comments */
  async create({ sectionKey, body, threadId, sendToAgent } = {}) {
    assertBody(body);
    assertAnchor(sectionKey);
    const root = threadId ? this.#read().find(row => row.threadId === threadId) : undefined;
    if (threadId && !root) throw Object.assign(new Error('Thread not found'), { code: 'thread-not-found' });
    const comment = {
      id: nextId('comment'),
      threadId: threadId ?? nextId('thread'),
      target: root?.target ?? { kind: 'artifact', id: this.artifactId, sectionKey },
      author: { id: this.currentUser.actorId },
      state: root?.state ?? 'open',
      body,
      createdAt: new Date().toISOString(),
    };
    const rows = this.#read();
    rows.push(comment);
    this.#write(rows);
    this.#emit({ type: 'comment.created', comment });
    if (sendToAgent) this.#scheduleAgentReply(comment);
    return comment;
  }

  #scheduleAgentReply(trigger) {
    const runId = `run-fake-${(++sequence).toString(36)}`;
    setTimeout(() => {
      const rows = this.#read();
      if (!rows.some(row => row.threadId === trigger.threadId)) return;
      const reply = {
        id: nextId('comment'),
        threadId: trigger.threadId,
        target: trigger.target,
        // Repli D1 : l'agent publie sous l'id owner, le run vit dans la provenance.
        author: { id: this.currentUser.actorId },
        state: trigger.state ?? 'open',
        body: `Agent reply (fake): received “${trigger.body.slice(0, 80)}”. Anchor noted; no artifact change in L0 fake.`,
        provenance: { runId },
        createdAt: new Date().toISOString(),
      };
      rows.push(reply);
      this.#write(rows);
      this.#emit({ type: 'comment.created', comment: reply });
    }, this.agentDelayMs);
  }

  /** POST /api/artifacts/:artifactId/threads/:threadId/close */
  async close(threadId) { return this.#setState(threadId, 'closed', 'thread.closed'); }
  /** POST /api/artifacts/:artifactId/threads/:threadId/reopen */
  async reopen(threadId) { return this.#setState(threadId, 'open', 'thread.reopened'); }

  #setState(threadId, state, type) {
    const rows = this.#read();
    let found = false;
    for (const row of rows) if (row.threadId === threadId) { row.state = state; row.updatedAt = new Date().toISOString(); found = true; }
    if (!found) throw Object.assign(new Error('Thread not found'), { code: 'thread-not-found' });
    this.#write(rows);
    this.#emit({ type, threadId });
    return { ok: true };
  }

  /** GET /api/artifacts/:artifactId/stream (SSE) — ici abonnement local. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

async function httpJson(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? { code: `http-${response.status}`, message: `Request failed (${response.status})` };
    // `saved: true`: the comment is stored although the request failed (agent delivery) — never retry it.
    throw Object.assign(new Error(error.message), { code: error.code, status: response.status, saved: error.saved === true, comment: error.comment });
  }
  return payload;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export class HttpCommentsAdapter {
  constructor({ artifactId, baseUrl = '', currentUser, fetchImpl } = {}) {
    this.artifactId = artifactId;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.currentUser = currentUser;
    this.fetch = fetchImpl ?? ((...args) => fetch(...args));
    this.source = null;
  }

  #url(suffix = '') {
    return `${this.baseUrl}/api/artifacts/${encodeURIComponent(this.artifactId)}${suffix}`;
  }

  async listThreads() {
    return httpJson(await this.fetch(this.#url('/comments')));
  }

  async create({ sectionKey, body, threadId, sendToAgent } = {}) {
    assertBody(body);
    assertAnchor(sectionKey);
    return httpJson(await this.fetch(this.#url('/comments'), {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sectionKey, body, threadId, sendToAgent: Boolean(sendToAgent) }),
    }));
  }

  // Every write carries a JSON content type: the backend answers 415 without it and SvelteKit's CSRF
  // guard refuses a content-type-less cross-origin POST before the route runs.
  async close(threadId) {
    return httpJson(await this.fetch(this.#url(`/threads/${encodeURIComponent(threadId)}/close`), { method: 'POST', headers: JSON_HEADERS, body: '{}' }));
  }

  async reopen(threadId) {
    return httpJson(await this.fetch(this.#url(`/threads/${encodeURIComponent(threadId)}/reopen`), { method: 'POST', headers: JSON_HEADERS, body: '{}' }));
  }

  subscribe(listener) {
    if (typeof EventSource === 'undefined') return () => {};
    const source = new EventSource(this.#url('/stream'));
    this.source = source;
    const forward = type => event => {
      try { listener({ type, ...JSON.parse(event.data) }); } catch { listener({ type }); }
    };
    source.addEventListener('comment.created', forward('comment.created'));
    source.addEventListener('thread.closed', forward('thread.closed'));
    source.addEventListener('thread.reopened', forward('thread.reopened'));
    return () => source.close();
  }
}

/** Point de bascule unique fake → réel : fournir `baseUrl` quand le backend existe. */
export function createCommentsAdapter(options = {}) {
  return options.baseUrl ? new HttpCommentsAdapter(options) : new FakeCommentsAdapter(options);
}
