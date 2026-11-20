<script setup vapor>
import { nextTick, onMounted, ref } from 'vue';
import { Button, Textarea, Toggle } from '@sentropic/design-system-vue/vapor';
const props = defineProps({
  author: { type: Object, required: true },
  placeholder: { type: String, default: 'Add a comment…' },
  submitLabel: { type: String, default: 'Comment' },
  initialBody: { type: String, default: '' },
  autofocus: { type: Boolean, default: false },
  showAgentToggle: { type: Boolean, default: true },
});
const emit = defineEmits(['submit', 'cancel']);
const body = ref(props.initialBody);
const sendToAgent = ref(false);
const localError = ref('');
const field = ref(null);

onMounted(async () => {
  if (!props.autofocus) return;
  await nextTick();
  field.value?.querySelector?.('textarea')?.focus();
});

function submit() {
  if (!body.value.trim()) {
    localError.value = 'Comment must not be empty.';
    return;
  }
  localError.value = '';
  emit('submit', { body: body.value.trim(), sendToAgent: sendToAgent.value });
  body.value = '';
  sendToAgent.value = false;
}
function onKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); submit(); }
  if (event.key === 'Escape') { event.preventDefault(); emit('cancel'); }
}
</script>
<template>
  <form class="st-review-composer" @submit.prevent="submit" @keydown="onKeydown">
    <div ref="field">
      <Textarea v-model="body" :label="`Comment as ${author.displayLabel}`" :placeholder="placeholder" :rows="3" />
    </div>
    <p v-if="localError" role="alert" class="st-review-error">{{ localError }}</p>
    <div class="st-review-composer-actions">
      <Toggle v-if="showAgentToggle" v-model="sendToAgent" label="Send to agent" size="sm" />
      <Button variant="ghost" size="sm" type="button" @click="emit('cancel')">Cancel</Button>
      <Button variant="primary" size="sm" type="submit">{{ submitLabel }}</Button>
    </div>
    <p class="st-review-hint">Cmd/Ctrl+Enter to send · Esc to cancel</p>
  </form>
</template>
