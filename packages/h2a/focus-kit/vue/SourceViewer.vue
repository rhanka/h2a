<script setup vapor>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { decodeEvidence, evidenceText, evidenceLines } from '../../../focus/src/validation/evidence-bytes.ts';
import { searchSource } from '../src/evidence-search.js';
const props = defineProps({ source: { type: Object, required: true }, locator: Object, visit: Number });
defineEmits(['back']);
const lines = computed(() => props.source.mediaType.startsWith('image/') ? [] : evidenceLines(evidenceText(decodeEvidence(props.source.data))));
const start = ref(0), jump = ref(1), query = ref(''), matches = ref([]), searching = ref(false), matchIndex = ref(0);
const scroller = ref(null), target = ref(null), heading = ref(null);
let serial = 0, navigation = 0;
const windowSize = 80, lineHeight = 24;
onMounted(() => heading.value.focus());
async function go(line, focus = true) {
  const token = ++navigation, n = Math.min(lines.value.length, Math.max(1, Number(line) || 1));
  start.value = Math.max(0, n - 9); jump.value = n;
  await nextTick(); if (token !== navigation || !scroller.value) return;
  scroller.value.scrollTop = (n - 1) * lineHeight;
  await nextTick(); if (focus && token === navigation) {
    scroller.value?.querySelector(`[data-line="${n}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    target.value?.focus({ preventScroll: true });
  }
}
watch(() => props.visit, () => { if (props.visit > 0 && lines.value.length) go(props.locator?.start ?? 1); }, { immediate: true, flush: 'post' });
watch([query, lines], ([needle, input], _, cleanup) => {
  const token = ++serial, location = navigation;
  matches.value = []; searching.value = true; matchIndex.value = 0;
  searchSource(input, needle, () => serial === token, found => {
    matches.value = found; searching.value = false;
    if (found.length && location === navigation) go(found[0], false);
  });
  cleanup(() => { serial++; });
}, { immediate: true });
function download() {
  const url = URL.createObjectURL(new Blob([decodeEvidence(props.source.data)], { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = `evidence-${props.source.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <section aria-label="Source consultée" class="source-viewer">
    <h3 ref="heading" tabindex="-1">{{ source.title }}</h3>
    <p>{{ source.mediaType }} · {{ source.size }} octets · {{ JSON.stringify(source.origin) }}</p>
    <details><summary>Empreinte des octets</summary><code>{{ source.sha256 }}</code></details>
    <div class="evidence-actions"><button @click="$emit('back')">Retour au contexte</button><button @click="download">Télécharger les octets originaux</button></div>
    <figure v-if="source.mediaType.startsWith('image/')"><img :src="`data:${source.mediaType};base64,${source.data}`" :alt="source.alt" :width="source.width" :height="source.height" /><figcaption>{{ locator?.caption ?? source.alt }}</figcaption></figure>
    <template v-else>
      <label>Rechercher dans toute la source <input v-model="query" type="search" /></label>
      <p aria-live="polite" data-search-status>{{ searching ? 'Recherche en cours…' : `${matches.length} résultat(s)` }}</p>
      <button :disabled="!matches.length" @click="matchIndex = (matchIndex + 1) % matches.length; go(matches[matchIndex])">Résultat suivant</button>
      <label>Aller à la ligne <input v-model="jump" type="number" min="1" :max="lines.length" /></label>
      <button @click="go(jump)">Atteindre</button><p>{{ lines.length }} lignes · plage citée : {{ locator?.start ?? '—' }}–{{ locator?.end ?? '—' }}</p>
      <div ref="scroller" class="source-scroll" @scroll="start = Math.max(0, Math.floor(scroller.scrollTop / lineHeight) - 8)">
        <div ref="target" role="list" aria-label="Lignes de la source" tabindex="-1">
          <div aria-hidden="true" :style="{ height: `${start * lineHeight}px` }"></div>
          <div v-for="(line, offset) in lines.slice(start, start + windowSize)" :key="start + offset" role="listitem" class="source-line"
            :class="{ cited: start + offset + 1 >= locator?.start && start + offset + 1 <= locator?.end }" :data-line="start + offset + 1"><span class="line-number">{{ start + offset + 1 }}</span> {{ line || ' ' }}</div>
          <div aria-hidden="true" :style="{ height: `${Math.max(0, lines.length - start - windowSize) * lineHeight}px` }"></div>
        </div>
      </div>
    </template>
  </section>
</template>
