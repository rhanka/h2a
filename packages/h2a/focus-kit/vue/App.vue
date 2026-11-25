<script setup vapor>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ThemeProvider, Button, Badge, Card, Container } from '@sentropic/design-system-vue/vapor';
import { lightTheme, darkTheme } from './themes.js';
import Canvas from './Canvas.vue';
import Evidence from './Evidence.vue';
import Citation from './Citation.vue';
import { preparePresentation } from '../../../focus/src/render/presentation.ts';
import { decisionCodes, optionCode, responseLine } from '../../../focus-interactive/src/response-line.ts';
const props = defineProps({ document: { type: Object, required: true }, mode: { type: String, default: 'decision' }, target: { type: String, default: 'document' } });
const dossier = computed(() => props.document);
const dark = ref(matchMedia('(prefers-color-scheme: dark)').matches);
const selections = reactive(new Map());
const evidencePanel = ref(null), glossary = ref(null);
const questions = computed(() => dossier.value.sections.filter(s => s.kind === 'question'));
const sections = computed(() => preparePresentation(dossier.value).sections);
const optionSets = computed(() => sections.value.filter(s => s.kind === 'optionSet'));
const optionLabel = (questionId, optionId) => optionSets.value.filter(s => s.questionId === questionId)
  .flatMap(s => s.options).find(o => o.id === optionId)?.label;
const recommended = (set, option) => questions.value.find(q => q.id === set.questionId)?.recommendedOptionId === option.id;
const codes = computed(() => decisionCodes(questions.value));
const questionHeading = section => { const code = codes.value[questions.value.findIndex(q => q.id === section.id)]; return section.question.startsWith(`${code} · `) ? section.question : `${code} ·${section.question}`; };
const optionIndex = (set, option) => optionSets.value.filter(s => s.questionId === set.questionId).flatMap(s => s.options).findIndex(o => o.id === option.id);
const response = computed(() => responseLine(questions.value, optionSets.value, selections));
const responseText = ref(null), copyStatus = ref('');
async function copyResponse() {
  try { await navigator.clipboard.writeText(response.value); copyStatus.value = 'Copié.'; }
  catch {
    const range = document.createRange(); range.selectNodeContents(responseText.value);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    responseText.value.focus(); copyStatus.value = 'Texte sélectionné. Appuyez sur Ctrl+C ou ⌘C pour copier.';
  }
}
const steps = computed(() => [...dossier.value.amendmentTrace, ...dossier.value.sections.filter(s => s.kind === 'amendmentTrace').flatMap(s => s.steps)]);
function revealTerm() {
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const term = document.getElementById(id);
  if (term && glossary.value?.contains(term)) { glossary.value.open = true; term.scrollIntoView(); }
}
onMounted(() => { revealTerm(); window.addEventListener('hashchange', revealTerm); });
onUnmounted(() => window.removeEventListener('hashchange', revealTerm));
</script>

<template>
  <ThemeProvider :theme="dark ? darkTheme : lightTheme">
    <div class="focus-page" :data-mode="dark ? 'dark' : 'light'" data-renderer="vue" :data-presentation="mode">
      <header class="title-band"><h1>{{ dossier.title }}</h1>
        <Button variant="ghost" size="sm" :aria-pressed="dark" @click="dark = !dark">Thème {{ dark ? 'clair' : 'sombre' }}</Button>
      </header>
      <Container size="lg"><main>
        <div class="reading-meta"><Badge tone="info">Focus</Badge> {{ questions.length }} question(s) · {{ dossier.readability.readingBudgetMinutes }} minutes</div>
        <Card><h2>Votre demande</h2><blockquote>{{ dossier.readability.ownerRequestQuote }}</blockquote><p>{{ dossier.readability.stakes }}</p></Card>
        <aside v-if="dossier.readability.glossary?.length" aria-label="Glossaire"><details ref="glossary" class="focus-glossary">
          <summary>Glossaire ({{ dossier.readability.glossary.length }} {{ dossier.readability.glossary.length === 1 ? 'terme' : 'termes' }})</summary>
          <dl><template v-for="entry in dossier.readability.glossary" :key="entry.term"><dt :id="`glossary-${encodeURIComponent(entry.term)}`">{{ entry.term }}</dt><dd>{{ entry.definition }}</dd></template></dl>
        </details></aside>
        <section v-for="section in sections" :id="section.id" :key="section.id" class="dossier-section">
          <p v-if="section.kind === 'prose'" class="prose">{{ section.markdown }}</p>
          <template v-else-if="section.kind === 'question'">
            <h2>{{ questionHeading(section) }}</h2><p>{{ section.context }}</p>
            <p class="recommendation"><Badge tone="success">Recommandation</Badge> {{ section.recommendedAnswer }}</p>
            <p class="muted">{{ section.readingTimeMinutes }} minute(s) · {{ section.state === 'open' ? 'Question ouverte' : section.state === 'answered' ? 'Réponse reçue' : 'Décision validée' }}</p>
            <p v-if="section.answer">Réponse enregistrée : {{ section.answer }}</p>
          </template>
          <template v-else-if="section.kind === 'optionSet'">
            <h3 v-if="section.title">{{ section.title }}</h3>
            <div class="options" role="group" :aria-label="section.title ?? 'Options'">
              <button v-for="option in section.options" :id="option.id" :key="option.id" class="option-card"
                :class="{ selected: selections.get(section.questionId) === option.id }" :disabled="mode === 'report'"
                :aria-pressed="selections.get(section.questionId) === option.id" @click="selections.set(section.questionId, option.id)">
                <Card><strong>{{ optionCode(optionIndex(section, option)) }} · {{ option.label }}</strong><Badge v-if="recommended(section, option)" tone="success">Recommandée</Badge>
                  <p>{{ option.consequence }}</p><p v-if="option.body">{{ option.body }}</p>
                  <p v-if="option.annotation !== 'none'">Annotation source : {{ option.annotation }}</p><p v-if="option.annotationComment">{{ option.annotationComment }}</p>
                </Card>
              </button>
            </div>
            <p v-if="mode !== 'report'" class="selection" aria-live="polite">{{ selections.get(section.questionId) ? `Sélection locale : ${optionLabel(section.questionId, selections.get(section.questionId))}. Communiquez ce choix au présentateur pour l’enregistrer.` : 'Sélectionnez une option pour préparer votre réponse.' }}</p>
          </template>
          <Canvas v-else-if="section.kind === 'diagram'" :document="section.scene" :alt="section.alt" :target="props.target" />
          <Card v-else-if="section.kind === 'outcome'"><h3>Conclusion proposée</h3><p>{{ section.statement }}</p></Card>
          <Citation v-for="id in section.citationRefs ?? []" :key="id" :dossier="dossier" :id="id" />
          <template v-if="section.kind === 'optionSet'"><template v-for="option in section.options" :key="option.id">
            <p v-for="id in option.citationRefs ?? []" :key="id">{{ option.label }} : <Citation :dossier="dossier" :id="id" /></p>
          </template></template>
        </section>
        <Evidence v-if="dossier.schemaVersion === 2" ref="evidencePanel" :dossier="dossier" :target="props.target" />
        <details v-if="steps.length"><summary>Historique</summary><ul><li v-for="(step, index) in steps" :key="index">{{ step.at }} · {{ step.author }} : {{ step.summary }}</li></ul></details>
        <section v-if="questions.length" class="response-summary" aria-label="Récapitulatif des décisions">
          <h2>Votre réponse</h2>
          <p>Les choix sans réponse sont indiqués par —.</p>
          <output ref="responseText" class="response-line" tabindex="-1" aria-label="Ligne de réponse">{{ response }}</output>
          <Button variant="secondary" size="sm" @click="copyResponse">Copier</Button>
          <p role="status">{{ copyStatus }}</p>
        </section>
        <footer><p v-if="mode !== 'report'">Vos sélections restent dans cette page jusqu’à sa fermeture. Elles ne valent pas décision enregistrée.</p>
          <p v-else>Rapport en lecture seule.</p>
          <details><summary>Source et version</summary><p>{{ dossier.provenance.source }} · {{ dossier.provenance.readAt }}</p><p>{{ dossier.ref }} · {{ dossier.cursor }} · {{ dossier.hash }}</p></details>
        </footer>
      </main></Container>
    </div>
  </ThemeProvider>
</template>
