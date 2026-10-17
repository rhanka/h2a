<script>
  import { ThemeProvider, Button, Badge, Card, Container } from '@sentropic/design-system-svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { lightTheme, darkTheme } from './themes.js';
  import Canvas from './Canvas.svelte';
  let { document: dossier } = $props();
  let dark = $state(matchMedia('(prefers-color-scheme: dark)').matches);
  const selections = new SvelteMap();
  let questions = $derived(dossier.sections.filter(s => s.kind === 'question'));
  const recommended = (set, option) => questions.find(q => q.id === set.questionId)?.recommendedOptionId === option.id;
  let steps = $derived([...dossier.amendmentTrace, ...dossier.sections.filter(s => s.kind === 'amendmentTrace').flatMap(s => s.steps)]);
</script>

<ThemeProvider theme={dark ? darkTheme : lightTheme}>
  <div class="focus-page" data-mode={dark ? 'dark' : 'light'}>
    <header class="title-band"><h1>{dossier.title}</h1>
      <Button variant="ghost" size="sm" aria-pressed={dark} onclick={() => dark = !dark}>Thème {dark ? 'clair' : 'sombre'}</Button>
    </header>
    <Container size="full">
      <main>
        <div class="reading-meta"><Badge tone="info">Focus</Badge> {questions.length} question(s) · {dossier.readability.readingBudgetMinutes} minutes</div>
        <Card><h2>Votre demande</h2><blockquote>{dossier.readability.ownerRequestQuote}</blockquote><p>{dossier.readability.stakes}</p></Card>
        {#if dossier.readability.glossary?.length}
          <aside aria-label="Glossaire"><h2>En mots simples</h2><dl>{#each dossier.readability.glossary as entry}<dt>{entry.term}</dt><dd>{entry.definition}</dd>{/each}</dl></aside>
        {/if}
        {#each dossier.sections as section}
          <section id={section.id} class="dossier-section">
            {#if section.kind === 'prose'}
              <p class="prose">{section.markdown}</p>
            {:else if section.kind === 'question'}
              <h2>{section.question}</h2><p>{section.context}</p>
              <p class="recommendation"><Badge tone="success">Recommandation</Badge> {section.recommendedAnswer}</p>
              <p class="muted">{section.readingTimeMinutes} minute(s) · {section.state === 'open' ? 'Question ouverte' : section.state === 'answered' ? 'Réponse reçue' : 'Décision validée'}</p>
              {#if section.answer}<p>Réponse enregistrée : {section.answer}</p>{/if}
            {:else if section.kind === 'optionSet'}
              {#if section.title}<h3>{section.title}</h3>{/if}
              <div class="options" role="group" aria-label={section.title ?? 'Options'}>
                {#each section.options as option}
                  <button class="option-card" class:selected={selections.get(section.questionId) === option.id}
                    aria-pressed={selections.get(section.questionId) === option.id} onclick={() => selections.set(section.questionId, option.id)}>
                    <Card><strong>{option.label}</strong>
                      {#if recommended(section, option)}<Badge tone="success">Recommandée</Badge>{/if}
                      <p>{option.consequence}</p>{#if option.body}<p>{option.body}</p>{/if}
                      {#if option.annotation !== 'none'}<p>Annotation source : {option.annotation}</p>{/if}
                      {#if option.annotationComment}<p>{option.annotationComment}</p>{/if}
                    </Card>
                  </button>
                {/each}
              </div>
              <p class="selection" aria-live="polite">{selections.get(section.questionId) ? `Sélection locale : ${section.options.find(o => o.id === selections.get(section.questionId))?.label}. Communiquez ce choix au présentateur pour l’enregistrer.` : 'Sélectionnez une option pour préparer votre réponse.'}</p>
            {:else if section.kind === 'diagram'}
              <Canvas document={section.scene} {dark} alt={section.alt} />
            {:else if section.kind === 'outcome'}
              <Card><h3>Conclusion proposée</h3><p>{section.statement}</p></Card>
            {/if}
          </section>
        {/each}
        {#if steps.length}<details><summary>Historique</summary><ul>{#each steps as step}<li>{step.at} · {step.author} : {step.summary}</li>{/each}</ul></details>{/if}
        <footer><p>Vos sélections restent dans cette page jusqu’à sa fermeture. Elles ne valent pas décision enregistrée.</p>
          <details><summary>Source et version</summary><p>{dossier.provenance.source} · {dossier.provenance.readAt}</p><p>{dossier.ref} · {dossier.cursor} · {dossier.hash}</p></details>
        </footer>
      </main>
    </Container>
  </div>
</ThemeProvider>
