<script setup vapor>
import { Button, Badge } from '@sentropic/design-system-vue/vapor';
const props = defineProps({
  mode: { type: String, default: 'view' },
  openCount: { type: Number, default: 0 },
  unreadCount: { type: Number, default: 0 },
  label: { type: String, default: 'Review' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['modeChange']);
</script>
<template>
  <span class="st-review-toggle">
    <Button variant="ghost" size="sm" :disabled="disabled" :aria-pressed="mode === 'review'"
      @click="emit('modeChange', mode === 'review' ? 'view' : 'review')">
      {{ label }} · {{ openCount }}
      <Badge v-if="unreadCount" tone="info" size="sm">{{ unreadCount }} unread</Badge>
    </Button>
  </span>
</template>
