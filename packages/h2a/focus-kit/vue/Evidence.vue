<script setup vapor>
import { computed, nextTick, reactive, ref } from 'vue';
import SourceViewer from './SourceViewer.vue';
import { evidenceVolume } from '../../../focus/src/render/evidence.ts';
const props = defineProps({ dossier: { type: Object, required: true } });
const active = ref(null), locator = ref(null), visit = ref(0), expanded = reactive(new Set());
let opener, scroll;
const volume = computed(() => evidenceVolume(props.dossier));
function openCitation(id) {
  const citation = props.dossier.citations.find(c => c.id === id);
  openSource(citation.sourceId, citation.locator);
}
function openSource(id, range = null) {
  opener = document.activeElement; scroll = window.scrollY;
  locator.value = range; active.value = props.dossier.sources.find(s => s.id === id); visit.value++;
}
async function back() { active.value = null; locator.value = null; await nextTick(); opener?.focus({ preventScroll: true }); window.scrollTo(0, scroll); }
function referenceTarget(ref) {
  if (ref === props.dossier.ref) return { id: null, label: 'dossier' };
  for (const section of props.dossier.sections) {
    const option = section.kind === 'optionSet' && section.options.find(o => o.id === ref || o.targetRef === ref);
    if (option) return { id: option.id, label: option.label };
    if (section.id === ref || section.targetRef === ref) return { id: section.id,
      label: section.question ?? section.title ?? section.alt ?? (section.kind === 'outcome' ? 'Conclusion' : section.kind === 'amendmentTrace' ? 'Historique' : 'Contexte') };
  }
}
function returnTo(ref) {
  const target = referenceTarget(ref), element = target?.id === null ? document.querySelector('main')
    : [...document.querySelectorAll('main .dossier-section, main .option-card')].find(el => el.id === target?.id);
  if (!element) throw new Error('Unresolved annex back reference');
  if (!element.matches('button, a, input')) element.tabIndex = -1;
  element.focus(); element.scrollIntoView({ block: 'start' });
}
defineExpose({ openCitation });
</script>
<template>
  <section aria-label="Pièces justificatives" class="evidence-index">
    <h2>Pièces justificatives</h2>
    <p>{{ volume.sources }} sources · {{ volume.bytes }} octets · consultation estimée : {{ volume.consultationMinutes }} minute(s), à six octets par mot, hors budget de décision.</p>
    <SourceViewer v-if="active" :key="active.id" :source="active" :locator="locator" :visit="visit" @back="back" />
    <ul><li v-for="citation in dossier.citations" :key="citation.id"><button @click="openCitation(citation.id)">{{ citation.label }}</button> — {{ citation.sourceId }}</li></ul>
    <details open><summary>Catalogue des sources</summary><ul><li v-for="source in dossier.sources" :key="source.id"><button @click="openSource(source.id)">Consulter {{ source.title }}</button> · {{ source.size }} octets</li></ul></details>
    <article v-for="group in dossier.evidenceGroups" :key="group.id"><p>{{ group.summary }}</p>
      <button v-for="id in group.citationRefs" :key="id" @click="openCitation(id)">{{ dossier.citations.find(c => c.id === id).label }}</button>
      <button v-for="id in group.sourceRefs" :key="id" @click="openSource(id)">Source : {{ dossier.sources.find(s => s.id === id).title }}</button>
    </article>
    <details v-for="annex in dossier.annexes" :key="annex.id" @toggle="e => e.currentTarget.open ? expanded.add(annex.id) : expanded.delete(annex.id)">
      <summary><span>{{ annex.title }}</span> — {{ annex.summary }}</summary>
      <template v-if="expanded.has(annex.id)">
        <template v-for="(block, index) in annex.blocks" :key="index">
          <p v-if="block.kind === 'text'">{{ block.text }}</p>
          <pre v-else-if="block.kind === 'code'"><code>{{ block.text }}</code></pre>
          <div v-else-if="block.kind === 'table'" class="evidence-table"><table><thead><tr><th v-for="(column, columnIndex) in block.columns" :key="columnIndex">{{ column }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in block.rows" :key="rowIndex"><td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td></tr></tbody></table></div>
          <template v-else-if="block.kind === 'references'"><button v-for="id in block.citationRefs" :key="id" @click="openCitation(id)">{{ dossier.citations.find(c => c.id === id).label }}</button></template>
        </template>
        <button v-for="id in annex.backRefs" :key="id" @click="returnTo(id)">Retour : {{ referenceTarget(id).label }}</button>
      </template>
    </details>
  </section>
</template>
