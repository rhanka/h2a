<script setup vapor>
import { computed } from 'vue';
import { bibliography } from '../../../focus/src/render/evidence.ts';
import { citationCallers } from './citation-callers.js';
const props = defineProps({ dossier: { type: Object, required: true }, id: { type: String, required: true } });
const entry = computed(() => bibliography(props.dossier).find(e => e.citation.id === props.id));
</script>
<template>
  <a class="citation-link" :href="`#${entry.anchorId}`" :aria-label="`Source ${entry.number}`" @click="event => citationCallers.set(entry.anchorId, event.currentTarget)">[{{ entry.number }}]</a>
</template>
