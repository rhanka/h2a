<script setup vapor>
import { computed, ref } from 'vue';
import { Avatar, Badge, Button } from '@sentropic/design-system-vue/vapor';
import CommentComposer from './CommentComposer.vue';
import { anchorLabel, renderMarkdownLite } from './review-core.js';
const props = defineProps({
  thread: { type: Object, required: true },
  currentUser: { type: Object, required: true },
  orphaned: { type: Boolean, default: false },
});
const emit = defineEmits(['reply', 'resolve', 'reopen', 'reanchor']);
const replying = ref(false);
const quote = computed(() => anchorLabel(props.thread.anchor));
const resolved = computed(() => props.thread.state === 'closed');
function authorLabel(comment) {
  return comment.author?.id === props.currentUser.actorId ? props.currentUser.displayLabel : comment.author?.id ?? 'Unknown';
}
function kindLabel(comment) {
  if (comment.provenance?.runId) return 'agent';
  return comment.author?.id === props.currentUser.actorId ? props.currentUser.kind : null;
}
function formatTime(value) {
  try { return new Date(value).toLocaleString(); } catch { return value; }
}
function onReply(payload) {
  emit('reply', { threadId: props.thread.threadId, ...payload });
  replying.value = false;
}
</script>
<template>
  <article class="st-review-thread" :aria-label="`Thread on ${quote}`">
    <header class="st-review-thread-head">
      <p class="st-review-quote">“{{ quote }}”</p>
      <Badge :tone="resolved ? 'success' : 'info'" size="sm">{{ resolved ? 'Resolved' : 'Open' }}</Badge>
      <Badge v-if="orphaned" tone="warning" size="sm">No longer attached</Badge>
    </header>
    <ol class="st-review-comments">
      <li v-for="comment in thread.comments" :key="comment.id" class="st-review-comment">
        <Avatar :name="authorLabel(comment)" size="sm" />
        <div class="st-review-comment-main">
          <p class="st-review-comment-meta">
            <strong>{{ authorLabel(comment) }}</strong>
            <Badge v-if="kindLabel(comment)" tone="neutral" size="sm">{{ kindLabel(comment) }}</Badge>
            <span>{{ formatTime(comment.createdAt) }}</span>
            <span v-if="comment.updatedAt && comment.updatedAt !== comment.createdAt">· edited</span>
            <span v-if="comment.provenance?.runId">· run {{ comment.provenance.runId }}</span>
          </p>
          <!-- Corps échappé puis markdown léger : jamais de HTML brut d'auteur. -->
          <div class="st-review-comment-body" v-html="renderMarkdownLite(comment.body)"></div>
        </div>
      </li>
    </ol>
    <div class="st-review-thread-actions">
      <Button v-if="!resolved" variant="secondary" size="sm" @click="emit('resolve', thread.threadId)">Resolve</Button>
      <Button v-else variant="secondary" size="sm" @click="emit('reopen', thread.threadId)">Reopen</Button>
      <Button v-if="orphaned" variant="ghost" size="sm" @click="emit('reanchor', thread.threadId)">Re-anchor</Button>
      <Button variant="ghost" size="sm" :aria-expanded="replying" @click="replying = !replying">Reply</Button>
    </div>
    <p v-if="resolved && !replying" class="st-review-hint">Comment resolved. Reopen to reply.</p>
    <CommentComposer v-if="replying" :author="currentUser" submit-label="Reply" autofocus @submit="onReply" @cancel="replying = false" />
  </article>
</template>
