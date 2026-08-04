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
    Tile
  } from '@sentropic/design-system-svelte';
  import type { PageData } from './$types';

  type IncludeResult = {
    ok: boolean;
    delivered?: boolean;
    target?: string;
    targetRoot?: string | null;
    note?: string;
    error?: string;
    remedy?: string;
    live?: Array<{ instance: string; name?: string | null; workspace?: string | null; root?: string | null }>;
  };

  let { data }: { data: PageData } = $props();
  const dossier = $derived(data.dossier);
  const total = $derived(dossier.decisions.length);
  const storageKey = $derived(`focus:dossier-session-safety:${dossier.revision}:choix`);

  let current = $state(0);
  let selections = $state<Record<string, string>>({});
  let storageReady = $state(false);
  let including = $state<string | null>(null);
  let includeResults = $state<Record<string, IncludeResult>>({});
  let pointerStart = $state<{ id: number; x: number; y: number } | null>(null);

  let h2aTarget = $state<string | null>(data.h2a.target);
  let h2aLive = $state(data.h2a.live);
  let h2aReason = $state(data.h2a.reason);
  let h2aRemedy = $state<string | null>(data.h2a.remedy);
  let h2aAmbiguous = $state(data.h2a.ambiguous);
  let showTargets = $state(false);
  let refreshingTargets = $state(false);

  function previous() {
    current = Math.max(0, current - 1);
  }

  function next() {
    current = Math.min(total - 1, current + 1);
  }

  function selectOption(decisionKey: string, optionKey: string) {
    // Repasser sur l’option déjà choisie la conserve : une décision reste
    // mono-choix dès qu’un choix a été fait.
    selections = { ...selections, [decisionKey]: optionKey };
    const nextResults = { ...includeResults };
    delete nextResults[decisionKey];
    includeResults = nextResults;
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
      // Une erreur de quota ne doit pas bloquer l’inclusion dans la CLI.
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

  async function refreshTargets() {
    refreshingTargets = true;
    try {
      const response = await fetch('/api/h2a/targets');
      const body = await response.json();
      if (body?.ok) {
        h2aLive = body.live ?? [];
        h2aReason = body.reason;
        h2aRemedy = body.remedy ?? null;
        h2aAmbiguous = Boolean(body.ambiguous);
        if (!h2aTarget || !h2aLive.some((session: { instance: string }) => session.instance === h2aTarget)) {
          h2aTarget = body.target ?? null;
        }
      }
    } catch {
      // Le rafraîchissement est un confort : son échec ne doit pas casser la page.
    } finally {
      refreshingTargets = false;
    }
  }

  function chooseTarget(instance: string) {
    h2aTarget = instance;
    showTargets = false;
  }

  async function includeSelection(decisionKey: string) {
    const optionKey = selections[decisionKey];
    if (!optionKey) return;

    including = decisionKey;
    try {
      const response = await fetch('/api/dossiers/session-safety/include', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decisionKey, optionKey, target: h2aTarget })
      });
      includeResults = { ...includeResults, [decisionKey]: (await response.json()) as IncludeResult };
    } catch (error) {
      includeResults = { ...includeResults, [decisionKey]: { ok: false, error: String(error) } };
    } finally {
      including = null;
    }
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
                          <h3 id={`options-${decision.key}`}>Votre choix</h3>
                          <p>Sélectionnez une seule option. Aucune option n’est choisie par défaut.</p>
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

                      <Alert tone="info" title="Recommandation du dossier" message={decision.recommendation} />

                      <Stack gap={2}>
                        <h3>Prochain travail</h3>
                        <p>{decision.nextWork}</p>
                      </Stack>

                      <Flex align="center" justify="between" wrap gap={2}>
                        <span>
                          {#if selections[decision.key]}
                            Choix prêt à être remis à une CLI live.
                          {:else}
                            Sélectionnez une option pour l’inclure dans la CLI.
                          {/if}
                        </span>
                        <Button
                          variant="primary"
                          onclick={() => includeSelection(decision.key)}
                          disabled={!selections[decision.key] || including === decision.key}
                        >
                          {including === decision.key ? 'Inclusion…' : 'Inclure ce choix dans la CLI'}
                        </Button>
                      </Flex>

                      {#if includeResults[decision.key]}
                        {#if includeResults[decision.key].ok && includeResults[decision.key].delivered}
                          <Alert
                            tone="success"
                            title={`Remis à ${includeResults[decision.key].target}`}
                            message={includeResults[decision.key].note}
                          />
                        {:else if includeResults[decision.key].ok}
                          <Alert tone="warning" title="Aucune CLI live" message={includeResults[decision.key].note} />
                        {:else}
                          <Alert tone="error" title="Échec de la remise" message={includeResults[decision.key].error} />
                        {/if}
                      {/if}
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

          <Card>
            <div class="target-card">
              <Stack gap={2}>
                <Flex align="center" justify="between" wrap gap={2}>
                  <div>
                    <strong>Destinataire CLI h2a</strong>
                    <div class="muted">
                      {#if h2aTarget}
                        Cible : <strong>{h2aTarget}</strong>
                      {:else}
                        Aucune cible résolue.
                      {/if}
                    </div>
                  </div>
                  <Flex gap={2} wrap>
                    <Button variant="secondary" size="sm" onclick={() => (showTargets = !showTargets)}>
                      {showTargets ? 'Masquer les sessions' : 'Choisir la session'}
                    </Button>
                    <Button variant="ghost" size="sm" onclick={refreshTargets} disabled={refreshingTargets}>
                      {refreshingTargets ? 'Actualisation…' : 'Actualiser'}
                    </Button>
                  </Flex>
                </Flex>

                {#if h2aAmbiguous && h2aTarget}
                  <Alert
                    tone="warning"
                    title="Plusieurs sessions correspondent à ce dépôt"
                    message={`La session retenue est ${h2aTarget}. Si ce n'est pas la bonne, choisissez-la avant d'inclure un choix.`}
                  />
                {/if}
                {#if !h2aTarget && h2aRemedy}
                  <Alert tone="warning" title="Aucune remise possible pour l'instant" message={h2aRemedy} />
                {/if}

                {#if showTargets}
                  {#if h2aLive.length === 0}
                    <Alert tone="warning" title="Aucune session live visible" message={h2aRemedy ?? h2aReason} />
                  {:else}
                    <Stack gap={2}>
                      {#each h2aLive as session (session.instance)}
                        <Tile
                          variant="selectable"
                          selected={h2aTarget === session.instance}
                          onselect={() => chooseTarget(session.instance)}
                        >
                          <Flex align="center" justify="between" wrap gap={2}>
                            <div>
                              <strong>{session.instance}</strong>
                              <div class="muted">
                                {session.workspace ?? 'workspace inconnu'}{session.root ? ` · racine ${session.root}` : ''}
                              </div>
                            </div>
                            {#if session.matchesRepo}<Badge tone="success" size="sm">Ce dépôt</Badge>{/if}
                            {#if session.default}<Badge tone="info" size="sm">Défaut</Badge>{/if}
                          </Flex>
                        </Tile>
                      {/each}
                    </Stack>
                  {/if}
                {/if}
              </Stack>
            </div>
          </Card>

          <Alert
            tone="info"
            title="Remise à la CLI"
            message="L’inclusion dépose le contexte complet dans l’inbox d’une CLI live choisie ou résolue depuis le registre h2a. Elle ne règle ni ne signe une décision Track permanente."
          />
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
  .target-card { padding: var(--st-spacing-4, 1rem); }
  .muted { opacity: .72; font-size: .9em; margin-top: .2rem; }
  @media (prefers-reduced-motion: reduce) {
    .swipe-track { transition: none; }
  }
</style>
