<script setup vapor>
const props = defineProps({
  index: { type: Number, required: true },
  count: { type: Number, default: 1 },
  unread: { type: Boolean, default: false },
  resolved: { type: Boolean, default: false },
  active: { type: Boolean, default: false },
  label: { type: String, required: true },
});
const emit = defineEmits(['activate']);
</script>
<template>
  <button type="button" class="st-review-pin" :class="{ active, resolved }"
    :aria-label="`Thread ${index + 1}, ${count} comment${count === 1 ? '' : 's'}${unread ? ', unread' : ''}${resolved ? ', resolved' : ''}, on '${label}'`"
    :aria-current="active ? 'true' : undefined" @click="emit('activate')">
    <span aria-hidden="true">{{ index + 1 }}</span>
    <span v-if="resolved" aria-hidden="true">✓</span>
    <span v-else-if="unread" class="st-review-pin-dot" aria-hidden="true">●</span>
    <span class="st-review-sr">{{ resolved ? 'Resolved' : unread ? 'Unread' : 'Read' }}</span>
  </button>
</template>
