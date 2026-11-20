// Live events for GET /api/artifacts/:artifactId/stream (SSE).
//
// Events are DERIVED FROM STORE READS, never from write intents: after every write made through this
// server, and on a timer when the store can change behind our back (HTTP endpoint), the artifact's rows are
// listed again and diffed against the last snapshot. A comment the store does not return is therefore never
// announced, and an agent reply written straight into cluster-mesh (C2d MCP) still shows up on the next poll.
//
//   comment.created  data: ReviewComment
//   comment.updated  data: ReviewComment
//   comment.deleted  data: { artifactId, commentId, threadId }
//   thread.closed    data: { artifactId, threadId, state: 'closed', comments: ReviewComment[] }
//   thread.reopened  data: { artifactId, threadId, state: 'open',   comments: ReviewComment[] }
//   thread.assigned  data: { artifactId, threadId, assignedTo: string | null, comments: ReviewComment[] }
//   review.error     data: { artifactId, error: { code, message } }   (a failed store read, never silent)
//
// `publish` lets the routes add out-of-band events (agent.delivery) to the same subscribers.

import { asReviewError } from './errors.js';
import { groupThreads, threadAssignee, threadState } from './comments-adapter.js';

/** @typedef {import('./types').ReviewComment} ReviewComment */
/** @typedef {import('./types').ReviewEvent} ReviewEvent */

/**
 * @typedef {object} Snapshot
 * @property {Map<string, { threadId: string, body: string, updatedAt?: string }>} rows
 * @property {Map<string, 'open' | 'closed'>} states
 * @property {Map<string, string | null>} assignees
 */

/**
 * @typedef {object} Watcher
 * @property {Set<(event: ReviewEvent) => void>} listeners
 * @property {Snapshot | null} snapshot
 * @property {Promise<void>} chain
 * @property {ReturnType<typeof setInterval> | null} timer
 */

/**
 * @param {ReviewComment[]} comments
 * @returns {Snapshot}
 */
function snapshotOf(comments) {
  const threads = groupThreads(comments);
  return {
    rows: new Map(
      comments.map((comment) => [
        comment.id,
        { threadId: comment.threadId, body: comment.body, updatedAt: comment.updatedAt }
      ])
    ),
    states: new Map(threads.map((rows) => [rows[0].threadId, threadState(rows)])),
    assignees: new Map(threads.map((rows) => [rows[0].threadId, threadAssignee(rows)]))
  };
}

/**
 * @param {string} artifactId
 * @param {Snapshot} previous
 * @param {ReviewComment[]} comments
 * @returns {ReviewEvent[]}
 */
function diff(artifactId, previous, comments) {
  /** @type {ReviewEvent[]} */
  const events = [];
  const currentIds = new Set(comments.map((comment) => comment.id));

  for (const comment of comments) {
    const before = previous.rows.get(comment.id);
    if (!before) {
      events.push({ event: 'comment.created', data: comment });
    } else if (before.body !== comment.body) {
      events.push({ event: 'comment.updated', data: comment });
    }
  }

  for (const [commentId, before] of previous.rows) {
    if (!currentIds.has(commentId)) {
      events.push({ event: 'comment.deleted', data: { artifactId, commentId, threadId: before.threadId } });
    }
  }

  for (const rows of groupThreads(comments)) {
    const threadId = rows[0].threadId;
    const beforeState = previous.states.get(threadId);
    const nowState = threadState(rows);
    if (beforeState && beforeState !== nowState) {
      events.push({
        event: nowState === 'closed' ? 'thread.closed' : 'thread.reopened',
        data: { artifactId, threadId, state: nowState, comments: rows }
      });
    }
    if (previous.assignees.has(threadId)) {
      const beforeAssignee = previous.assignees.get(threadId) ?? null;
      const nowAssignee = threadAssignee(rows);
      if (beforeAssignee !== nowAssignee) {
        events.push({
          event: 'thread.assigned',
          data: { artifactId, threadId, assignedTo: nowAssignee, comments: rows }
        });
      }
    }
  }
  return events;
}

/**
 * @param {{
 *   adapter: import('./types').CommentsAdapter,
 *   tenant: string,
 *   pollMs?: number,
 *   setIntervalImpl?: (fn: () => void, ms: number) => any,
 *   clearIntervalImpl?: (timer: any) => void
 * }} options
 * @returns {import('./types').ReviewEvents}
 */
export function createReviewEvents({
  adapter,
  tenant,
  pollMs = 2000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
}) {
  /** @type {Map<string, Watcher>} */
  const watchers = new Map();

  /**
   * @param {Watcher} watcher
   * @param {ReviewEvent} event
   */
  function dispatch(watcher, event) {
    for (const listener of [...watcher.listeners]) {
      try {
        listener(event);
      } catch {
        // One broken subscriber (closed socket) must not starve the others.
      }
    }
  }

  /**
   * Serialised per artifact so two refreshes never announce the same change twice.
   * @param {string} artifactId
   * @param {Watcher} watcher
   * @param {boolean} announce
   */
  function enqueue(artifactId, watcher, announce) {
    watcher.chain = watcher.chain.then(async () => {
      /** @type {ReviewComment[]} */
      let comments;
      try {
        comments = await adapter.list(tenant, { kind: 'artifact', id: artifactId });
      } catch (error) {
        const failure = asReviewError(error);
        dispatch(watcher, {
          event: 'review.error',
          data: { artifactId, error: { code: failure.code, message: failure.message } }
        });
        return;
      }
      if (announce && watcher.snapshot) {
        for (const event of diff(artifactId, watcher.snapshot, comments)) dispatch(watcher, event);
      }
      watcher.snapshot = snapshotOf(comments);
    });
    return watcher.chain;
  }

  return {
    async subscribe(artifactId, listener) {
      let watcher = watchers.get(artifactId);
      if (!watcher) {
        watcher = { listeners: new Set(), snapshot: null, chain: Promise.resolve(), timer: null };
        watchers.set(artifactId, watcher);
      }
      const current = watcher;
      current.listeners.add(listener);
      // Baseline before the subscriber is live: existing rows are state, not news.
      if (current.snapshot === null) await enqueue(artifactId, current, false);
      if (adapter.polling && current.timer === null) {
        current.timer = setIntervalImpl(() => void enqueue(artifactId, current, true), pollMs);
        if (current.timer && typeof current.timer.unref === 'function') current.timer.unref();
      }
      return () => {
        current.listeners.delete(listener);
        if (current.listeners.size === 0 && watchers.get(artifactId) === current) {
          if (current.timer !== null) clearIntervalImpl(current.timer);
          watchers.delete(artifactId);
        }
      };
    },
    refresh(artifactId) {
      const watcher = watchers.get(artifactId);
      return watcher ? enqueue(artifactId, watcher, true) : Promise.resolve();
    },
    publish(artifactId, event) {
      const watcher = watchers.get(artifactId);
      if (watcher) dispatch(watcher, event);
    },
    close() {
      for (const watcher of watchers.values()) {
        if (watcher.timer !== null) clearIntervalImpl(watcher.timer);
        watcher.listeners.clear();
      }
      watchers.clear();
    }
  };
}
