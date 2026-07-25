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
  const decisionsTotal = $derived(dossier.decisions.length);
  /**
   * L'état de l'art est la PREMIÈRE carte et ne porte aucune décision : on lit le paysage avant de
   * trancher quoi que ce soit. Le compteur ne doit donc jamais l'appeler « Décision 1 » — il y a
   * `decisionsTotal` décisions et `slidesTotal` cartes, et ce sont deux nombres différents.
   */
  const slidesTotal = $derived(decisionsTotal + 1);
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
    current = Math.min(slidesTotal - 1, current + 1);
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
   * Les cartes vivent côte à côte dans une même piste flex : sans précaution, le viewport prend la
   * hauteur de la carte la PLUS HAUTE et toutes les autres affichent la différence en vide mort.
   * On mesure donc la carte active (ResizeObserver, donc robuste au reflow : redimensionnement de la
   * fenêtre, note qui s'agrandit, alerte de transmission qui apparaît) et on impose cette hauteur au
   * viewport. Mesurer plutôt que ne rendre que la carte active : toutes les cartes restent dans le DOM,
   * donc la transition de glissement, `inert`/`aria-hidden` et le geste de swipe restent intacts.
   */
  let trackEl = $state<HTMLElement | null>(null);
  let activeHeight = $state(0);

  $effect(() => {
    const slide = trackEl?.children[current] as HTMLElement | undefined;
    if (!slide) return;
    const measure = () => {
      activeHeight = slide.getBoundingClientRect().height;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slide);
    return () => observer.disconnect();
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

  type IncludeResult = {
    ok: boolean;
    delivered?: boolean;
    target?: string;
    recipientLive?: boolean;
    note?: string;
    error?: string;
  };

  let including = $state<string | null>(null);
  let includeResult = $state<Record<string, IncludeResult>>({});

  /** Il n'y a quelque chose à transmettre que si le lecteur a choisi une option OU écrit une note. */
  function hasSomethingToInclude(decisionKey: string): boolean {
    return Boolean(selections[decisionKey] || notes[decisionKey]?.trim());
  }

  /**
   * Le presse-papier rend le choix transportable ; ceci le fait ARRIVER. La note part avec le choix :
   * c'est elle qui porte le raisonnement, la transmettre sans elle n'aurait aucun intérêt.
   */
  async function includeChoice(decisionKey: string) {
    including = decisionKey;
    try {
      const res = await fetch('/api/dossiers/agent-memory/include', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decisionKey,
          optionKey: selections[decisionKey] ?? null,
          note: notes[decisionKey] ?? ''
        })
      });
      includeResult = { ...includeResult, [decisionKey]: (await res.json()) as IncludeResult };
    } catch (e) {
      includeResult = {
        ...includeResult,
        [decisionKey]: { ok: false, error: `Appel impossible : ${e instanceof Error ? e.message : String(e)}` }
      };
    } finally {
      including = null;
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
                {#if current === 0}
                  <Badge tone="neutral">État de l’art — aucune décision</Badge>
                {:else}
                  <Badge tone="neutral">Décision {current} / {decisionsTotal}</Badge>
                {/if}
              </Flex>
              <h1 id="dossier-title">{dossier.title}</h1>
              <p>{dossier.context}</p>
              <ProgressBar
                label="Progression du dossier"
                value={current + 1}
                max={slidesTotal}
                valueText={current === 0 ? 'État de l’art' : `Décision ${current} / ${decisionsTotal}`}
                showValue
              />
            </Stack>
          </header>

          <Alert
            tone="info"
            title="Support de décision neutre"
            message="Ce dossier ne préconise aucune option. La première carte présente l'état de l'art et ne demande rien ; viennent ensuite les décisions, chacune avec ses alternatives, leur comportement et leur conséquence. Le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. Votre sélection et votre note sont conservées dans votre navigateur : « Copier ma synthèse » les met au presse-papier, « Inclure ce choix dans la CLI » les remet à une CLI live du projet."
          />

          <div
            class="swipe-viewport"
            role="group"
            aria-label="Cartes du dossier : l’état de l’art puis les décisions. Faites glisser horizontalement ou utilisez les boutons."
            style={activeHeight > 0 ? `height: ${activeHeight}px;` : undefined}
            onpointerdown={onPointerDown}
            onpointerup={onPointerUp}
            onpointercancel={onPointerCancel}
          >
            <div
              class="swipe-track"
              bind:this={trackEl}
              style={`transform: translateX(-${current * 100}%);`}
            >
              <!-- Carte 1 : l'état de l'art. On lit le paysage AVANT de trancher — la mettre en bas de
                   page rendait le dossier illisible dans l'ordre où on le parcourt. Elle ne porte
                   volontairement aucune option, aucune note, aucun choix. -->
              <section class="swipe-slide" aria-hidden={current !== 0} inert={current !== 0}>
                <Card>
                  <Stack gap={4}>
                    <Flex align="center" justify="between" wrap gap={2}>
                      <Badge tone="info">État de l’art</Badge>
                      <span>Carte 1 sur {slidesTotal} — aucune décision ici</span>
                    </Flex>

                    <Stack gap={2}>
                      <h2 id="matrix-title">Matrice de comparaison</h2>
                      <p>
                        Dix-neuf approches du benchmark, comparées sur le stockage, la récupération, la
                        réconciliation, le mode d’écriture, le partage multi-CLI, l’auto-hébergement/RAM, la
                        licence et l’adéquation à la cible (agent persistant, multi-CLI, local-first). Faites
                        défiler horizontalement pour voir toutes les colonnes.
                      </p>
                    </Stack>

                    <!-- La matrice défile horizontalement DANS son conteneur : ce geste ne doit jamais
                         être confondu avec le swipe de carte, sinon consulter les colonnes changerait de
                         carte. Même barrière que la note. -->
                    <div
                      class="matrix-scroll"
                      role="presentation"
                      onpointerdown={(event) => event.stopPropagation()}
                      onpointerup={(event) => event.stopPropagation()}
                      onpointercancel={(event) => event.stopPropagation()}
                    >
                      <Table caption={matrix.caption} columns={matrix.columns} rows={matrix.rows} />
                    </div>
                    <p class="matrix-legend">{matrix.legend}</p>

                    <Alert
                      tone="info"
                      title="Rien à trancher sur cette carte"
                      message="Passez à la carte suivante pour entrer dans les décisions."
                    />
                  </Stack>
                </Card>
              </section>

              {#each dossier.decisions as decision, index (decision.key)}
                {@const slide = index + 1}
                <section class="swipe-slide" aria-hidden={current !== slide} inert={current !== slide}>
                  <Card>
                    <Stack gap={4}>
                      <Flex align="center" justify="between" wrap gap={2}>
                        <Badge tone="info">{decision.key}</Badge>
                        <span>Décision {slide} sur {decisionsTotal}</span>
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
                           sélectionner du texte ferait défiler la carte.
                           `--st-component-field-maxWidth` : le champ du DS est plafonné à 28rem par
                           défaut ; une note de raisonnement doit occuper toute la largeur de la carte.
                           On surcharge le token depuis le consommateur, sans toucher au composant. -->
                      <div
                        class="note-field"
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

                      <!-- Remettre le choix ET la note à une CLI live du projet : le presse-papier sert
                           à coller n'importe où, ceci sert à ce que l'agent qui travaille le lise. -->
                      <Stack gap={2}>
                        <Flex align="center" justify="between" wrap gap={2}>
                          <span class="include-hint">
                            {hasSomethingToInclude(decision.key)
                              ? 'Votre option et votre note partent ensemble vers la CLI live du projet.'
                              : 'Sélectionnez une option ou écrivez une note pour pouvoir la transmettre.'}
                          </span>
                          <Button
                            variant="secondary"
                            onclick={() => includeChoice(decision.key)}
                            disabled={including === decision.key || !hasSomethingToInclude(decision.key)}
                          >
                            {including === decision.key ? 'Transmission…' : 'Inclure ce choix dans la CLI'}
                          </Button>
                        </Flex>
                        {#if includeResult[decision.key]}
                          {@const result = includeResult[decision.key]}
                          {#if result.ok && result.delivered}
                            <Alert
                              tone="success"
                              title={`Transmis à ${result.target}`}
                              message={result.note ?? ''}
                            />
                          {:else if result.ok}
                            <Alert
                              tone="warning"
                              title="Aucune CLI live sur ce projet"
                              message={result.note ?? ''}
                            />
                          {:else}
                            <Alert
                              tone="error"
                              title="Échec de la transmission"
                              message={result.error ?? 'Erreur inconnue.'}
                            />
                          {/if}
                        {/if}
                      </Stack>

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
            <Button variant="secondary" onclick={previous} disabled={current === 0} aria-label="Carte précédente">
              Précédente
            </Button>
            <SlideIndicator
              count={slidesTotal}
              current={current}
              onChange={(index) => (current = index)}
              label="Accéder à une carte"
              variant="bars"
            />
            <Button
              variant="primary"
              onclick={next}
              disabled={current === slidesTotal - 1}
              aria-label="Carte suivante"
            >
              Suivante
            </Button>
          </Flex>

          <section aria-labelledby="summary-title">
            <Stack gap={2}>
              <h2 id="summary-title">Vos notes</h2>
              <Flex align="center" justify="between" wrap gap={2}>
                <span>
                  {answeredCount} décision(s) sur {decisionsTotal} annotée(s) ou sélectionnée(s).
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
        </Stack>
      </main>
    </Container>
  {/snippet}
</AppShell>

<style>
  .dossier { padding-block: var(--st-spacing-6, 1.5rem) var(--st-spacing-10, 2.5rem); }
  /* La hauteur est imposée en ligne depuis la mesure de la carte active (voir le $effect) : sans elle
     le viewport prendrait la hauteur de la carte la plus haute et les cartes courtes afficheraient un
     grand vide mort. `overflow: hidden` masque le débord des cartes plus hautes pendant le glissement. */
  .swipe-viewport {
    overflow: hidden;
    /* `pan-x pan-y` et non `pan-y` : la matrice de l'état de l'art vit désormais DANS le viewport et doit
       pouvoir défiler horizontalement au doigt. Un ancêtre en `pan-y` l'en empêcherait (le comportement
       effectif est l'intersection le long de la chaîne d'ancêtres). Le viewport lui-même n'a aucun débord
       horizontal, donc rien n'y défile : le geste de swipe reste traité par nos handlers pointer. */
    touch-action: pan-x pan-y;
    /* PAS de `transition: height` ici. Mesuré en navigateur : animer la hauteur la garde bloquée sur
       l'ancienne hauteur de contenu (la transition repart à chaque réécriture de l'attribut `style`),
       et le vide mort réapparaît intégralement. La hauteur doit donc s'appliquer immédiatement — c'est
       le glissement horizontal qui porte l'animation, pas la hauteur. */
  }
  .swipe-track {
    display: flex;
    /* Chaque carte garde sa hauteur de contenu au lieu de s'étirer sur la plus haute : c'est ce qui
       rend la mesure de la carte active fidèle. */
    align-items: flex-start;
    transition: transform var(--st-motion-normal, 180ms) var(--st-motion-easing, ease);
  }
  .swipe-slide { flex: 0 0 100%; min-width: 0; }
  @media (prefers-reduced-motion: reduce) {
    .swipe-track { transition: none; }
  }
  /* Le champ de note du DS est plafonné à `--st-component-field-maxWidth` (28rem par défaut) : on lève
     le plafond pour cette zone seulement, par le token, sans forker le composant. */
  .note-field { --st-component-field-maxWidth: 100%; }
  .include-hint {
    color: var(--st-semantic-text-secondary, inherit);
    font-size: 0.875rem;
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
