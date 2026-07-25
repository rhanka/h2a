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
    Textarea,
    Tile
  } from '@sentropic/design-system-svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const dossier = $derived(data.dossier);
  const matrix = $derived(data.matrix);
  const total = $derived(dossier.decisions.length);
  const storageKey = $derived(`focus:dossier-agent-memory:${dossier.revision}:choix`);
  const notesKey = $derived(`focus:dossier-agent-memory:${dossier.revision}:notes`);

  let current = $state(0);
  let selections = $state<Record<string, string>>({});
  let notes = $state<Record<string, string>>({});
  let storageReady = $state(false);
  let pointerStart = $state<{ id: number; x: number; y: number } | null>(null);
  let exportState = $state<'idle' | 'copied' | 'failed'>('idle');

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

  function setNote(decisionKey: string, value: string) {
    notes = { ...notes, [decisionKey]: value };
    exportState = 'idle';
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

  /** Ne restaure que des notes rattachées à une décision existante de cette révision. */
  function restoreNotes(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const restored: Record<string, string> = {};
    for (const decision of dossier.decisions) {
      const note = (value as Record<string, unknown>)[decision.key];
      if (typeof note === 'string' && note.length > 0) restored[decision.key] = note;
    }
    return restored;
  }

  onMount(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) selections = restoreSelections(JSON.parse(saved));
      const savedNotes = window.localStorage.getItem(notesKey);
      if (savedNotes) notes = restoreNotes(JSON.parse(savedNotes));
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

  $effect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(notesKey, JSON.stringify(notes));
    } catch {
      // Idem : une note non persistée ne doit jamais faire perdre la lecture en cours.
    }
  });

  /**
   * Les notes ne servent à rien si elles restent prisonnières du navigateur : cette
   * synthèse markdown les rend transmissibles (à une CLI, à Track, à un tiers). Elle
   * n'enregistre aucune décision — elle recopie ce que le lecteur a écrit.
   */
  function buildSummary(): string {
    const lines = [`# ${dossier.title}`, '', `Révision : ${dossier.revision}`, ''];
    for (const decision of dossier.decisions) {
      const selected = decision.options.find((option) => option.key === selections[decision.key]);
      const note = notes[decision.key]?.trim();
      lines.push(`## ${decision.key} — ${decision.question}`);
      lines.push(`- Option retenue : ${selected ? selected.title : '(aucune)'}`);
      lines.push(`- Note : ${note ? note : '(aucune)'}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildSummary());
      exportState = 'copied';
    } catch {
      exportState = 'failed';
    }
  }

  const answeredCount = $derived(
    dossier.decisions.filter(
      (decision) => selections[decision.key] || notes[decision.key]?.trim()
    ).length
  );

  // Une carte de choix reste prioritaire sur le geste de navigation : le
  // viewport ne doit jamais capturer le pointer d'un label/radio/bouton.
  function isInteractiveTarget(target: EventTarget | null): boolean {
    // `textarea` en fait partie : sans lui, glisser pour sélectionner du texte dans
    // une note ferait défiler la carte et la saisie serait inutilisable.
    return (
      target instanceof Element &&
      Boolean(target.closest('button, input, textarea, label, a, [role="button"]'))
    );
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
            message="Ce dossier ne préconise aucune option. Chaque carte présente les alternatives avec leur comportement et leur conséquence ; le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. Votre sélection et votre note sont conservées uniquement dans votre navigateur ; utilisez « Copier ma synthèse » pour les transmettre."
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
                          <p>Aucune option n’est recommandée par défaut. La sélection est facultative.</p>
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
                                      {#if selections[decision.key] === option.key}<Badge tone="info" size="sm">Sélectionnée</Badge>{/if}
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

                      <!-- La saisie ne participe jamais au swipe : sans cette barrière, taper ou
                           sélectionner du texte ferait défiler la carte. -->
                      <div
                        role="presentation"
                        onpointerdown={(event) => event.stopPropagation()}
                        onpointerup={(event) => event.stopPropagation()}
                        onpointercancel={(event) => event.stopPropagation()}
                      >
                        <Textarea
                          label="Votre note"
                          helperText="Pourquoi ce choix, ce qui manque, ce qu'il faut vérifier. Enregistrée dans votre navigateur au fil de la frappe."
                          rows={4}
                          value={notes[decision.key] ?? ''}
                          oninput={(event) =>
                            setNote(decision.key, (event.currentTarget as HTMLTextAreaElement).value)}
                        />
                      </div>

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

          <section aria-labelledby="summary-title">
            <Stack gap={2}>
              <h2 id="summary-title">Vos notes</h2>
              <Flex align="center" justify="between" wrap gap={2}>
                <span>
                  {answeredCount} décision(s) sur {total} annotée(s) ou sélectionnée(s).
                </span>
                <Button variant="secondary" onclick={copySummary}>Copier ma synthèse</Button>
              </Flex>
              {#if exportState === 'copied'}
                <Alert
                  tone="success"
                  title="Synthèse copiée"
                  message="Vos sélections et vos notes sont dans le presse-papier, en markdown. Collez-les où vous voulez : une CLI, un ticket, un message."
                />
              {:else if exportState === 'failed'}
                <Alert
                  tone="error"
                  title="Copie refusée par le navigateur"
                  message="Le presse-papier n'est pas accessible ici. Vos notes restent enregistrées dans ce navigateur ; sélectionnez-les à la main dans les cartes."
                />
              {/if}
            </Stack>
          </section>

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
