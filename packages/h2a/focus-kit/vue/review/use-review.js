import { computed, onUnmounted, ref } from 'vue';
import { groupThreads, isUnread } from './review-core.js';

/**
 * État de revue porté par l'hôte : fils, lecture, erreurs. Aucun accès réseau
 * ici — tout passe par l'adaptateur injecté (fake en page ou HTTP).
 * L'état de lecture `(threadId → lastReadAt)` reste chez l'hôte (SPEC §2).
 */
export function useReview({ adapter, currentUser, artifactId }) {
  const comments = ref([]);
  const activeThreadId = ref(null);
  const error = ref('');
  const status = ref('');
  const readState = ref(readStored());
  let unsubscribe = null;

  const threads = computed(() => groupThreads(comments.value));
  const openCount = computed(() => threads.value.filter(thread => thread.state === 'open').length);
  const unreadCount = computed(() => threads.value.filter(thread => isUnread(thread, readState.value[thread.threadId], currentUser.actorId)).length);
  const activeThread = computed(() => threads.value.find(thread => thread.threadId === activeThreadId.value) ?? null);

  function readKey() { return `h2a-review-read:${artifactId}`; }
  function readStored() {
    try { return JSON.parse(window.localStorage.getItem(readKey()) ?? '{}'); } catch { return {}; }
  }
  function persistRead() {
    try { window.localStorage.setItem(readKey(), JSON.stringify(readState.value)); } catch { /* lecture non persistée */ }
  }

  async function refresh() {
    const payload = await adapter.listThreads();
    comments.value = [...(payload.threads ?? []).flat()];
  }

  async function guard(action, successMessage) {
    error.value = '';
    try {
      const result = await action();
      await refresh();
      if (successMessage) status.value = successMessage;
      return result;
    } catch (caught) {
      error.value = caught?.message ?? 'Review action failed';
      // Stored but not delivered: show the stored comment (never retried) next to the error.
      if (caught?.saved) await refresh().catch(() => {});
      return caught?.saved ? caught.comment ?? null : null;
    }
  }

  async function createThread({ sectionKey, body, sendToAgent }) {
    const comment = await guard(() => adapter.create({ sectionKey, body, sendToAgent }), 'Thread created');
    if (comment) activeThreadId.value = comment.threadId;
    return comment;
  }

  async function reply({ threadId, body, sendToAgent }) {
    return guard(() => adapter.create({ threadId, body, sendToAgent }), 'Reply posted');
  }

  async function closeThread(threadId) {
    return guard(() => adapter.close(threadId), 'Thread resolved');
  }

  async function reopenThread(threadId) {
    return guard(() => adapter.reopen(threadId), 'Thread reopened');
  }

  function markRead(threadId) {
    readState.value = { ...readState.value, [threadId]: new Date().toISOString() };
    persistRead();
  }

  function selectThread(threadId) {
    activeThreadId.value = threadId;
    if (threadId) markRead(threadId);
  }

  function start() {
    void refresh();
    if (typeof adapter.subscribe === 'function') {
      unsubscribe = adapter.subscribe(() => { void refresh(); });
    }
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
  }

  onUnmounted(stop);
  return { comments, threads, activeThread, activeThreadId, openCount, unreadCount, error, status, readState, refresh, createThread, reply, closeThread, reopenThread, markRead, selectThread, start, stop };
}
