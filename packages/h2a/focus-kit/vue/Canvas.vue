<script setup vapor>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { DiagramSceneFigure } from '@sentropic/design-system-vue/vapor';
import { getDiagramGlyph } from '@sentropic/design-system-vue/vapor/diagram-icons';
import { diagramAdapter } from './diagram-adapter.js';

const PROCESS_TARGET_WIDTH = 640;

const props = defineProps({
  document: { type: Object, required: true },
  alt: { type: String, required: true },
  target: { type: String, default: 'document' },
});
const adapter = computed(() => diagramAdapter(props.document));
const isProcess = computed(() => props.document.profileRefs?.[0] === 'process@1');
const links = computed(() => Object.values(props.document.relations).filter(r => r.type === 'link'));
const endpoint = (relation, role) => relation.endpoints.find(e => e.role === role).target;
const labels = {
  controls: 'Zoom',
  zoomIn: 'Agrandir',
  zoomOut: 'Réduire',
  fit: 'Ajuster',
  viewport: 'Schéma',
  expand: title => `Déplier : ${title}`,
  collapse: title => `Replier : ${title}`,
};

const rootEl = ref(null);
const columnWidth = ref(0);
const viewportWidth = ref(globalThis.innerWidth || 0);
const sceneSize = ref({ width: 0, height: 0 });
let observer;

function syncMetrics() {
  viewportWidth.value = window.innerWidth;
  const host = rootEl.value?.parentElement ?? rootEl.value;
  if (host) columnWidth.value = Math.round(host.getBoundingClientRect().width);
}

onMounted(() => {
  syncMetrics();
  window.addEventListener('resize', syncMetrics);
  const host = rootEl.value?.parentElement ?? rootEl.value;
  if (host && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(syncMetrics);
    observer.observe(host);
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', syncMetrics);
  observer?.disconnect();
});

const effectiveColumn = computed(() => columnWidth.value || viewportWidth.value || 992);
const targetWidth = computed(() => {
  if (!isProcess.value) return undefined;
  if (effectiveColumn.value >= 800 && viewportWidth.value >= 1120) {
    return Math.min(1440, Math.max(960, viewportWidth.value - 64));
  }
  return Math.min(PROCESS_TARGET_WIDTH, Math.max(280, effectiveColumn.value - 26));
});

const stageExtra = computed(() => {
  if (!isProcess.value || props.target !== 'document') return 0;
  const needed = sceneSize.value.width ? Math.ceil(sceneSize.value.width + 8) : 0;
  if (needed <= effectiveColumn.value || viewportWidth.value < needed + 64) return 0;
  return needed - effectiveColumn.value;
});

const figureStyle = computed(() =>
  stageExtra.value > 0
    ? `width: calc(100% + ${stageExtra.value}px); margin-inline: -${Math.ceil(stageExtra.value / 2)}px;`
    : '',
);
</script>
<template>
  <div ref="rootEl" class="focus-diagram" :style="figureStyle">
    <DiagramSceneFigure
      :document="document"
      v-bind="adapter"
      :target-width="targetWidth"
      :resolve-glyph="getDiagramGlyph"
      :title="alt"
      :label="alt"
      :labels="labels"
      @size-change="size => sceneSize = size"
    />
    <details v-if="!isProcess"><summary>Lire les relations du schéma</summary><ul>
      <li v-for="link in links" :key="link.id">{{ document.entities[endpoint(link, 'source')].attributes.name.value }} → {{ document.entities[endpoint(link, 'target')].attributes.name.value }}{{ link.attributes?.label ? ` : ${link.attributes.label.value}` : '' }}</li>
    </ul></details>
  </div>
</template>
