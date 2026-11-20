<script lang="ts">
  import { Container, Stack } from '@sentropic/design-system-svelte';
  import type { PageData } from './$types';
  import ReviewShell from '$lib/review/ReviewShell.svelte';
  import type { CollaborationActor } from '$lib/review/types';

  let { data }: { data: PageData } = $props();

  const currentUser: CollaborationActor = {
    actorId: 'owner',
    kind: 'human',
    displayLabel: 'Propriétaire',
    color: '#34558b'
  };
  const actors: Record<string, CollaborationActor> = {
    owner: currentUser,
    agent: { actorId: 'agent', kind: 'agent', displayLabel: 'Agent (session propriétaire)', color: '#2e7d4f' }
  };
</script>

{#snippet artifactBody()}
  <article data-testid="artifact-body">
    <h2 data-anchor-id="a-title">Décision — revue des artefacts locaux</h2>
    <p data-anchor-id="a-intro" data-commentable>
      Les artefacts locaux doivent offrir un mode commentaire aussi réactif que l'expérience de référence, mais entièrement en local. Chaque commentaire est ancré sur un passage précis ou sur un bloc stable du document, puis suivi comme un fil de discussion.
    </p>
    <p data-anchor-id="a-scope" data-commentable>
      Le périmètre L0 couvre la bascule revue, les épingles ancrées, le panneau de fils, la réponse de l'agent en direct et la résolution avec réouverture. Le stockage passe par l'API commentaires du contrat figé ; en attendant le backend, un double en page assure la même recette.
    </p>
    <blockquote data-anchor-id="a-quote" data-commentable>
      Un commentaire envoyé à l'agent réveille la session propriétaire de l'artefact, quelle que soit la CLI utilisée, et la réponse revient dans le fil.
    </blockquote>
    <h3 data-anchor-id="a-list-title">Points à valider</h3>
    <ul>
      <li data-anchor-id="a-item-1" data-commentable>Ancrage texte : sélection d'au moins un caractère, ancre W3C text-quote plafonnée à 2048 caractères.</li>
      <li data-anchor-id="a-item-2" data-commentable>Ancrage élément : clic sur un bloc commentable, chemin d'élément et identifiant stable.</li>
      <li data-anchor-id="a-item-3" data-commentable>Accessibilité : navigation clavier complète, jamais la couleur seule, cible tactile d'au moins 24 px.</li>
    </ul>
    <p data-anchor-id="a-close" data-commentable>
      Après relecture, chaque fil peut être résolu puis rouvert si le sujet revient. L'état survit au rechargement de la page.
    </p>
  </article>
{/snippet}

<Container>
  <Stack gap={4}>
    <header>
      <p><a href="/">← Retour au suivi</a></p>
      <h1>Artefact {data.artifactId}</h1>
      <p>Version {data.artifactVersion}. Page de démonstration du mode revue local (L0).</p>
    </header>

    {#if data.reviewEnabled}
      <ReviewShell artifactId={data.artifactId} artifactVersion={data.artifactVersion} {currentUser} {actors}>
        {@render artifactBody()}
      </ReviewShell>
    {:else}
      <p data-testid="review-disabled" role="status">
        Mode revue désactivé. Activez <code>PUBLIC_FOCUS_ARTIFACT_REVIEW=1</code> pour afficher la bascule, les épingles et le panneau de fils.
      </p>
      {@render artifactBody()}
    {/if}
  </Stack>
</Container>

<style>
  article {
    display: grid;
    gap: 0.75rem;
    max-width: 46rem;
  }
  article h2,
  article h3,
  article p,
  article blockquote,
  article ul {
    margin: 0;
  }
  blockquote {
    padding-left: 0.75rem;
    border-left: 3px solid var(--st-color-border-strong, #8a919c);
  }
</style>
