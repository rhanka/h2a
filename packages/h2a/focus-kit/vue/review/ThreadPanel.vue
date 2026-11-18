<script setup vapor>
import { computed, ref } from 'vue';
import { Badge, Button, EmptyState } from '@sentropic/design-system-vue/vapor';
import CommentThread from './CommentThread.vue';
import { anchorLabel, filterThreads, isUnread } from './review-core.js';
const props = defineProps({
  threads: { type: Array, default: () => [] },
  orphanedIds: { type: Object, default: () => new Set() },
  currentUser: { type: Object, required: true },
  activeThreadId: { type: String, default: null },
  readState: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['select', 'reply', 'resolve', 'reopen', 'reanchor', 'close']);
const filter = ref('all');
const filtered = computed(() => filterThreads(props.threads, filter.value, props.currentUser.actorId));
const activeThread = computed(() => props.threads.find(thread => thread.threadId === props.activeThreadId) ?? null);
const orphans = computed(() => props.threads.filter(thread => props.orphanedIds.has(thread.threadId)));
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Resolved' },
  { id: 'mine', label: 'Mine' },
];
function threadUnread(thread) {
  return isUnread(thread, props.readState[thread.threadId], props.currentUser.actorId);
}
</script>
<template>
  <aside class="st-review-panel" aria-label="Review threads">
    <header class="st-review-panel-head">
      <h2 tabindex="-1" class="st-review-panel-title">Threads</h2>
      <span v-if="orphans.length">{{ orphans.length }} orphaned</span>
      <Button variant="ghost" size="sm" aria-label="Close review panel" @click="emit('close')">Close</Button>
    </header>
    <div class="st-review-filters" role="group" aria-label="Filter threads">
      <Button v-for="item in FILTERS" :key="item.id" variant="ghost" size="sm"
        :aria-pressed="filter === item.id" @click="filter = item.id">
        {{ item.label }} · {{ filtered.counts[item.id] }}
      </Button>
    </div>
    <EmptyState v-if="!filtered.visible.length" title="No threads" message="Select text or an element in the artifact to start a thread." />
    <ol v-else class="st-review-thread-list">
      <li v-for="(thread, index) in filtered.visible" :key="thread.threadId">
        <button type="button" class="st-review-thread-row"
          :class="{ active: thread.threadId === activeThreadId }"
          :aria-current="thread.threadId === activeThreadId ? 'true' : undefined"
          @click="emit('select', thread.threadId)">
          <span class="st-review-row-index">{{ index + 1 }}</span>
          <span class="st-review-row-quote">{{ anchorLabel(thread.anchor) }}</span>
          <Badge :tone="thread.state === 'closed' ? 'success' : 'info'" size="sm">{{ thread.state === 'closed' ? 'Resolved' : 'Open' }}</Badge>
          <span v-if="threadUnread(thread)"><span aria-hidden="true">●</span> Unread</span>
          <span>{{ thread.comments.length }} comment{{ thread.comments.length === 1 ? '' : 's' }}</span>
        </button>
      </li>
    </ol>
    <CommentThread v-if="activeThread" :thread="activeThread" :current-user="currentUser"
      :orphaned="orphanedIds.has(activeThread.threadId)"
      @reply="payload => emit('reply', payload)" @resolve="id => emit('resolve', id)"
      @reopen="id => emit('reopen', id)" @reanchor="id => emit('reanchor', id)" />
    <section v-if="orphans.length" class="st-review-orphans" aria-label="Orphaned threads">
      <h3>No longer attached</h3>
      <ol>
        <li v-for="thread in orphans" :key="thread.threadId">
          <button type="button" @click="emit('select', thread.threadId)">{{ anchorLabel(thread.anchor) }}</button>
          <Button variant="ghost" size="sm" @click="emit('resolve', thread.threadId)">Resolve</Button>
        </li>
      </ol>
    </section>
  </aside>
</template>
