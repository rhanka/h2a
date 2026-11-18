// Live events for GET /api/artifacts/:artifactId/stream (SSE).
//
// Events are DERIVED FROM STORE READS, never from write intents: after every write made through this
// server, and on a timer when the store can change behind our back (HTTP endpoint), the artifact's rows are
// listed again and diffed against the last snapshot. A comment the store does not return is therefore never
// announced, and an agent reply written straight into cluster-mesh still shows up (on the next poll).
//
//   comment.created  data: ReviewComment
//   thread.closed    data: { artifactId, threadId, state: 'closed', comments: ReviewComment[] }
//   thread.reopened  data: { artifactId, threadId, state: 'open',   comments: ReviewComment[] }
//   review.error     data: { artifactId, error: { code, message } }   (a failed store read, never silent)
//
// `publish` lets the routes add out-of-band events (agent.delivery) to the same subscribers.

import { asReviewError } from './errors.js';
import { groupThreads, threadState } from './comments-adapter.js';

/** @typedef {import('./types').ReviewComment} ReviewComment */
/** @typedef {import('./types').ReviewEvent} ReviewEvent */

/**
 * @typedef {object} Snapshot
 * @property {Set<string>} ids
 * @property {Map<string, 'open' | 'closed'>} states
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
  return {
    ids: new Set(comments.map((comment) => comment.id)),
    states: new Map(groupThreads(comments).map((rows) => [rows[0].threadId, threadState(rows)]))
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
  for (const comment of comments) {
    if (!previous.ids.has(comment.id)) events.push({ event: 'comment.created', data: comment });
  }
  for (const rows of groupThreads(comments)) {
    const threadId = rows[0].threadId;
    const before = previous.states.get(threadId);
    const now = threadState(rows);
    if (before && before !== now) {
      events.push({
        event: now === 'closed' ? 'thread.closed' : 'thread.reopened',
        data: { artifactId, threadId, state: now, comments: rows }
      });
    }
  }
  return events;
}

/**
 * @param {{
 *   adapter: import('./types').CommentsAdapter,
 *   pollMs?: number,
 *   setIntervalImpl?: (fn: () => void, ms: number) => any,
 *   clearIntervalImpl?: (timer: any) => void
 * }} options
 * @returns {import('./types').ReviewEvents}
 */
export function createReviewEvents({
  adapter,
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
        comments = await adapter.list(artifactId);
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
