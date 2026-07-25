<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Alert,
    AppShell,
    Badge,
    Button,
    Card,
    Container,
    Flex,
    ProgressBar,
    SlideIndicator,
    Stack,
    Table,
    Tile
  } from '@sentropic/design-system-svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const dossier = $derived(data.dossier);
  const matrix = $derived(data.matrix);
  const total = $derived(dossier.decisions.length);
  const storageKey = $derived(`focus:dossier-agent-memory:${dossier.revision}:choix`);

  let current = $state(0);
  let selections = $state<Record<string, string>>({});
  let storageReady = $state(false);
  let pointerStart = $state<{ id: number; x: number; y: number } | null>(null);

  function previous() {
    current = Math.max(0, current - 1);
  }

  function next() {
    current = Math.min(total - 1, current + 1);
  }

  function selectOption(decisionKey: string, optionKey: string) {
    // Ce dossier est un support de réflexion, pas une décision transmise : la sélection ne fait
    // qu'aider le lecteur à noter où il en est, localement dans son navigateur.
    selections = { ...selections, [decisionKey]: optionKey };
  }

  function restoreSelections(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const restored: Record<string, string> = {};
    for (const decision of dossier.decisions) {
      const optionKey = (value as Record<string, unknown>)[decision.key];
      if (typeof optionKey === 'string' && decision.options.some((option) => option.key === optionKey)) {
        restored[decision.key] = optionKey;
      }
    }
    return restored;
  }

  onMount(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) selections = restoreSelections(JSON.parse(saved));
    } catch {
      // Le dossier reste utilisable même si le navigateur interdit le stockage.
    } finally {
      storageReady = true;
    }
  });

  $effect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(selections));
    } catch {
      // Une erreur de quota ne doit pas bloquer la lecture du dossier.
    }
  });

  // Une carte de choix reste prioritaire sur le geste de navigation : le
  // viewport ne doit jamais capturer le pointer d'un label/radio/bouton.
  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('button, input, label, a, [role="button"]'));
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerUp(event: PointerEvent) {
    const start = pointerStart;
    pointerStart = null;
    if (!start) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (start.id !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (deltaX < 0) next();
    else previous();
  }

  function onPointerCancel() {
    pointerStart = null;
  }
</script>

<svelte:head>
  <title>{dossier.title}</title>
</svelte:head>

<AppShell variant="workspace">
  {#snippet main()}
    <Container size="md" padding>
      <main class="dossier" aria-labelledby="dossier-title">
        <Stack gap={4}>
          <header>
            <Stack gap={2}>
              <Flex align="center" justify="between" wrap gap={2}>
                <Badge tone="info">Dossier décisionnel</Badge>
                <Badge tone="neutral">Décision {current + 1} / {total}</Badge>
              </Flex>
              <h1 id="dossier-title">{dossier.title}</h1>
              <p>{dossier.context}</p>
              <ProgressBar
                label="Progression du dossier"
                value={current + 1}
                max={total}
                valueText={`${current + 1} / ${total}`}
                showValue
              />
            </Stack>
          </header>

          <Alert
            tone="info"
            title="Support de décision neutre"
            message="Ce dossier ne préconise aucune option. Chaque carte présente les alternatives avec leur comportement et leur conséquence ; le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. La sélection ci-dessous est une note personnelle conservée uniquement dans votre navigateur."
          />

          <div
            class="swipe-viewport"
            role="group"
            aria-label="Cartes de décisions : faites glisser horizontalement ou utilisez les boutons"
            onpointerdown={onPointerDown}
            onpointerup={onPointerUp}
            onpointercancel={onPointerCancel}
          >
            <div class="swipe-track" style={`transform: translateX(-${current * 100}%);`}>
              {#each dossier.decisions as decision, index (decision.key)}
                <section class="swipe-slide" aria-hidden={index !== current} inert={index !== current}>
                  <Card>
                    <Stack gap={4}>
                      <Flex align="center" justify="between" wrap gap={2}>
                        <Badge tone="info">{decision.key}</Badge>
                        <span>Carte {index + 1} sur {total}</span>
                      </Flex>

                      <Stack gap={2}>
                        <h2>{decision.question}</h2>
                        <p>{decision.whyNow}</p>
                      </Stack>

                      <section aria-labelledby={`options-${decision.key}`}>
                        <Stack gap={2}>
                          <h3 id={`options-${decision.key}`}>Alternatives</h3>
                          <p>Aucune option n’est recommandée par défaut. Une note personnelle est facultative.</p>
                          <Stack gap={2}>
                            {#each decision.options as option (option.key)}
                              <!-- Les choix ne participent jamais au swipe : Tile conserve ainsi
                                   son clic/tap natif et son checkbox accessible du DS. -->
                              <div
                                role="presentation"
                                onpointerdown={(event) => event.stopPropagation()}
                                onpointerup={(event) => event.stopPropagation()}
                                onpointercancel={(event) => event.stopPropagation()}
                              >
                                <Tile
                                  variant="selectable"
                                  selected={selections[decision.key] === option.key}
                                  onselect={() => selectOption(decision.key, option.key)}
                                >
                                  <Stack gap={2}>
                                    <Flex align="center" justify="between" wrap gap={2}>
                                      <strong>{option.title}</strong>
                                      {#if option.recommended}<Badge tone="success" size="sm">Recommandée</Badge>{/if}
                                      {#if selections[decision.key] === option.key}<Badge tone="info" size="sm">Notée</Badge>{/if}
                                    </Flex>
                                    <p>{option.behavior}</p>
                                    <p><strong>Conséquence :</strong> {option.consequence}</p>
                                  </Stack>
                                </Tile>
                              </div>
                            {/each}
                          </Stack>
                        </Stack>
                      </section>

                      <Alert tone="info" title="Critère à trancher (neutre)" message={decision.recommendation} />

                      <Stack gap={2}>
                        <h3>Prochain travail</h3>
                        <p>{decision.nextWork}</p>
                      </Stack>
                    </Stack>
                  </Card>
                </section>
              {/each}
            </div>
          </div>

          <Flex align="center" justify="between" wrap gap={3}>
            <Button variant="secondary" onclick={previous} disabled={current === 0} aria-label="Décision précédente">
              Précédente
            </Button>
            <SlideIndicator
              count={total}
              current={current}
              onChange={(index) => (current = index)}
              label="Accéder à une décision"
              variant="bars"
            />
            <Button variant="primary" onclick={next} disabled={current === total - 1} aria-label="Décision suivante">
              Suivante
            </Button>
          </Flex>

          <section aria-labelledby="matrix-title">
            <Stack gap={2}>
              <h2 id="matrix-title">État de l’art — matrice de comparaison</h2>
              <p>
                Dix-neuf approches du benchmark, comparées sur le stockage, la récupération, la réconciliation, le
                mode d’écriture, le partage multi-CLI, l’auto-hébergement/RAM, la licence et l’adéquation à la
                cible (agent persistant, multi-CLI, local-first). Faites défiler horizontalement pour voir toutes
                les colonnes.
              </p>
              <div class="matrix-scroll">
                <Table caption={matrix.caption} columns={matrix.columns} rows={matrix.rows} />
              </div>
              <p class="matrix-legend">{matrix.legend}</p>
            </Stack>
          </section>
        </Stack>
      </main>
    </Container>
  {/snippet}
</AppShell>

<style>
  .dossier { padding-block: var(--st-spacing-6, 1.5rem) var(--st-spacing-10, 2.5rem); }
  .swipe-viewport { overflow: hidden; touch-action: pan-y; }
  .swipe-track {
    display: flex;
    transition: transform var(--st-motion-normal, 180ms) var(--st-motion-easing, ease);
  }
  .swipe-slide { flex: 0 0 100%; min-width: 0; }
  @media (prefers-reduced-motion: reduce) {
    .swipe-track { transition: none; }
  }
  /* La matrice état-de-l'art peut dépasser la largeur du viewport (19 lignes x 9 colonnes) : elle défile
     dans son propre conteneur, jamais le corps de page. */
  .matrix-scroll {
    max-width: 100%;
    overflow-x: auto;
  }
  .matrix-legend {
    color: var(--st-semantic-text-secondary, inherit);
    font-size: 0.875rem;
  }
</style>
