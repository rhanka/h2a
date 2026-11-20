<script lang="ts">
  import { untrack } from 'svelte';
  import {
    AppHeader,
    AppShell,
    Badge,
    Card,
    Container,
    Flex,
    Stack,
    Tile
  } from '@sentropic/design-system-svelte';
  import type { ReviewMode } from '@sentropic/design-system-svelte';
  import ArtifactReviewHost from '$lib/review/ArtifactReviewHost.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const artifact = $derived(data.artifact);
  const artifactReview = $derived(data.artifactReview);

  let selectedOptions = $state<Record<string, string>>({});
  let reviewMode = $state<ReviewMode>(untrack(() => data.artifactReview.initialMode));

  function selectOption(questionId: string, optionId: string) {
    selectedOptions = { ...selectedOptions, [questionId]: optionId };
  }
</script>

<svelte:head>
  <title>{artifact.title}</title>
</svelte:head>

<AppShell variant="workspace">
  {#snippet topChrome()}
    <AppHeader brandName="Focus" productName="Artifact Review" brandMode="full">
      {#snippet actions()}
        <Flex gap={2} align="center" wrap>
          <Badge tone="neutral" size="sm">{artifact.ref}</Badge>
          <Badge tone="info" size="sm">{artifact.hash}</Badge>
        </Flex>
      {/snippet}
    </AppHeader>
  {/snippet}

  {#snippet main()}
    <Container size={reviewMode === 'review' ? 'xl' : 'md'} padding>
      <div class="artifact-page">
        <ArtifactReviewHost
          artifactId={artifact.ref}
          artifactVersion={artifact.hash}
          reviewConfig={artifactReview}
          onModeChange={(next) => (reviewMode = next)}
        >
          <main class="artifact-doc" aria-labelledby="artifact-title">
            <Stack gap={4}>
              <header class="artifact-doc__header">
                <Stack gap={1}>
                  <h1 id="artifact-title">{artifact.title}</h1>
                  <p class="artifact-doc__subtitle">{artifact.subtitle}</p>
                </Stack>
              </header>

              {#each artifact.sections as section (section.id)}
                {#if section.kind === 'prose'}
                  <section data-anchor-id={section.targetRef} data-commentable>
                    <Card>
                      <Stack gap={2}>
                        <h2>{section.heading}</h2>
                        <p>{section.body}</p>
                      </Stack>
                    </Card>
                  </section>
                {:else if section.kind === 'question'}
                  <section data-anchor-id={section.targetRef} data-commentable>
                    <Card>
                      <Stack gap={2}>
                        <Flex gap={2} align="center" wrap>
                          <Badge tone="info">{section.code}</Badge>
                          <h2>{section.question}</h2>
                        </Flex>
                        <p>{section.context}</p>
                        {#if section.recommendedAnswer}
                          <p class="artifact-doc__reco">
                            <strong>Recommandation :</strong> {section.recommendedAnswer}
                          </p>
                        {/if}
                      </Stack>
                    </Card>
                  </section>
                {:else if section.kind === 'optionSet'}
                  <section data-anchor-id={section.targetRef}>
                    <Card>
                      <Stack gap={3}>
                        <h2>{section.title}</h2>
                        <Stack gap={2}>
                          {#each section.options as option (option.id)}
                            <div data-anchor-id={option.targetRef} data-commentable>
                              <Tile
                                variant="selectable"
                                selected={selectedOptions[section.questionId] === option.id}
                                onselect={() => selectOption(section.questionId, option.id)}
                              >
                                <Stack gap={1}>
                                  <Flex align="center" justify="between" gap={2} wrap>
                                    <strong>{option.label}</strong>
                                    {#if selectedOptions[section.questionId] === option.id}
                                      <Badge tone="info" size="sm">Sélectionnée</Badge>
                                    {/if}
                                  </Flex>
                                  <p>{option.body}</p>
                                  <p class="artifact-doc__consequence">
                                    <strong>Conséquence :</strong> {option.consequence}
                                  </p>
                                </Stack>
                              </Tile>
                            </div>
                          {/each}
                        </Stack>
                      </Stack>
                    </Card>
                  </section>
                {:else if section.kind === 'decision'}
                  <section data-anchor-id={section.targetRef} data-commentable>
                    <Card>
                      <Stack gap={2}>
                        <Badge tone="success" size="sm">{section.modality}</Badge>
                        <p>{section.statement}</p>
                      </Stack>
                    </Card>
                  </section>
                {:else if section.kind === 'trace'}
                  <section data-anchor-id={section.targetRef} data-commentable>
                    <Card>
                      <Stack gap={2}>
                        <h2>{section.title}</h2>
                        <ol class="artifact-doc__trace">
                          {#each section.steps as step (step.label)}
                            <li>
                              <strong>{step.label} :</strong> {step.detail}
                            </li>
                          {/each}
                        </ol>
                      </Stack>
                    </Card>
                  </section>
                {/if}
              {/each}
            </Stack>
          </main>
        </ArtifactReviewHost>
      </div>
    </Container>
  {/snippet}
</AppShell>

<style>
  .artifact-page {
    padding-block: var(--st-spacing-4, 1rem) var(--st-spacing-10, 2.5rem);
  }

  .artifact-doc h1 {
    font-size: 1.5rem;
    margin: 0;
  }

  .artifact-doc h2 {
    font-size: 1.125rem;
    margin: 0;
  }

  .artifact-doc p {
    margin: 0;
  }

  .artifact-doc__subtitle,
  .artifact-doc__reco,
  .artifact-doc__consequence {
    color: var(--st-semantic-text-secondary, #475569);
    font-size: 0.9375rem;
  }

  .artifact-doc__trace {
    display: grid;
    gap: var(--st-spacing-2, 0.5rem);
    margin: 0;
    padding-inline-start: 1.25rem;
  }
</style>
