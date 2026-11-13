<script setup vapor>
import { computed } from 'vue';
import { DiagramSceneFigure } from '@sentropic/design-system-vue/vapor';
import { getDiagramGlyph } from '@sentropic/design-system-vue/vapor/diagram-icons';
import { diagramAdapter } from './diagram-adapter.js';
const props = defineProps({ document: { type: Object, required: true }, alt: { type: String, required: true } });
const adapter = computed(() => diagramAdapter(props.document));
const links = computed(() => Object.values(props.document.relations).filter(r => r.type === 'link'));
const endpoint = (relation, role) => relation.endpoints.find(e => e.role === role).target;
const labels = { controls: 'Zoom', zoomIn: 'Agrandir', zoomOut: 'Réduire', fit: 'Ajuster', viewport: 'Schéma',
  expand: title => `Déplier : ${title}`, collapse: title => `Replier : ${title}` };
</script>
<template>
  <div class="focus-diagram">
    <DiagramSceneFigure :document="document" v-bind="adapter" :resolve-glyph="getDiagramGlyph" :title="alt" :label="alt" :labels="labels" />
    <details><summary>Lire les relations du schéma</summary><ul>
      <li v-for="link in links" :key="link.id">{{ document.entities[endpoint(link, 'source')].attributes.name.value }} → {{ document.entities[endpoint(link, 'target')].attributes.name.value }}{{ link.attributes?.label ? ` : ${link.attributes.label.value}` : '' }}</li>
    </ul></details>
  </div>
</template>
