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

  import {
    collectAnsweredOnly,
    diffAgainstCommitted,
    projectAnswerSet,
    readDraft,
    reconcileAnswerState
  } from '$lib/dossier-answers.js';

  let { data }: { data: PageData } = $props();
  const dossier = $derived(data.dossier);
  const matrix = $derived(data.matrix);
  /** Jeu de réponses commité, chargé côté serveur. `null` si le fichier n'est pas atteignable. */
  const answerSet = $derived(data.answerSet);

  /**
   * Le jeu commité projeté sur CETTE révision, calculé à l'initialisation — donc présent dès le rendu
   * serveur. C'est le correctif de fond : les réponses du propriétaire sont dans git, elles doivent
   * s'afficher à l'ouverture de l'URL, sur un navigateur neuf, sans aucun état local. Le localStorage
   * n'est plus qu'une couche de BROUILLON pour des modifications non commitées.
   */
  const committed = projectAnswerSet(data.answerSet, data.dossier.decisions, data.dossier.revision);
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
  // Initialisés depuis le jeu commité, pas à vide : c'est ce qui fait qu'ouvrir l'URL suffit.
  let selections = $state<Record<string, string>>({ ...(committed?.state.selections ?? {}) });
  let notes = $state<Record<string, string>>({ ...(committed?.state.notes ?? {}) });
  let storageReady = $state(false);
  /** Un brouillon local existait-il au chargement ? Sert à le DIRE, jamais à décider en silence. */
  let draftLoaded = $state(false);
  /** Le brouillon n'est écrit que si l'humain a réellement modifié quelque chose. */
  let dirty = $state(false);
  let pointerStart = $state<{ id: number; x: number; y: number } | null>(null);
  let exportState = $state<'idle' | 'copied' | 'copied-json' | 'failed'>('idle');

  /**
   * Les décisions où le brouillon local CONTREDIT le jeu commité. Dérivé, donc toujours exact, y compris
   * après une modification. Tant que cette liste n'est pas vide, la page doit le dire : un brouillon
   * périmé qui masque silencieusement les réponses commitées, c'est la même perte qu'au départ.
   */
  const divergences = $derived(
    storageReady && committed
      ? diffAgainstCommitted({ selections, notes }, committed.state, data.answerSet)
      : []
  );
  const divergentKeys = $derived(new Set(divergences.map((d) => d.key)));
  const answerOrigin = $derived(
    !committed ? 'empty' : divergences.length > 0 ? 'draft' : 'committed'
  );

  function previous() {
    current = Math.max(0, current - 1);
  }

  function next() {
    current = Math.min(slidesTotal - 1, current + 1);
  }

  function selectOption(decisionKey: string, optionKey: string) {
    // Ce dossier est un support de réflexion, pas une décision transmise : la sélection ne fait
    // qu'aider le lecteur à noter où il en est.
    selections = { ...selections, [decisionKey]: optionKey };
    dirty = true;
  }

  function setNote(decisionKey: string, value: string) {
    notes = { ...notes, [decisionKey]: value };
    dirty = true;
    exportState = 'idle';
  }

  /**
   * Réconcilie le jeu commité (déjà affiché, y compris au rendu serveur) avec un éventuel brouillon local.
   *
   * Un brouillon VIDE compte pour rien : l'ancienne page écrivait `{}` dans le localStorage à chaque
   * montage, si bien qu'un navigateur « ayant déjà ouvert le dossier » possédait un brouillon présent mais
   * vide — et c'est précisément ce brouillon vide qui écrasait les réponses commitées et montrait un
   * dossier désert. L'absence de réponse n'est pas une réponse d'absence.
   */
  onMount(() => {
    let draft = null;
    try {
      const rawSelections = window.localStorage.getItem(storageKey);
      const rawNotes = window.localStorage.getItem(notesKey);
      if (rawSelections !== null || rawNotes !== null) {
        draftLoaded = true;
        draft = readDraft(
          rawSelections ? JSON.parse(rawSelections) : null,
          rawNotes ? JSON.parse(rawNotes) : null,
          dossier.decisions
        );
      }
    } catch {
      // Un brouillon illisible ne doit jamais pouvoir masquer les réponses commitées.
      draft = null;
    }

    const reconciled = reconcileAnswerState(draft, committed, data.answerSet);
    selections = reconciled.state.selections;
    notes = reconciled.state.notes;
    storageReady = true;
  });

  /**
   * Le brouillon n'est écrit QUE si l'humain a modifié quelque chose (`dirty`). Sans cette garde, le simple
   * fait d'ouvrir la page recopiait le jeu commité dans le navigateur et faisait du localStorage une
   * seconde source de vérité — celle qui, en divergeant, finit par gagner en silence.
   */
  $effect(() => {
    if (!storageReady || !dirty) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(selections));
      window.localStorage.setItem(notesKey, JSON.stringify(notes));
    } catch {
      // Une erreur de quota ne doit pas bloquer la lecture du dossier.
    }
  });

  /**
   * Revenir au jeu commité : on SUPPRIME le brouillon au lieu de le réécrire, pour que la page retrouve
   * exactement l'état d'un navigateur neuf. Action volontaire, jamais automatique.
   */
  function useCommitted() {
    if (!committed) return;
    selections = { ...committed.state.selections };
    notes = { ...committed.state.notes };
    dirty = false;
    exportState = 'idle';
    replayReport = committed.report;
    try {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(notesKey);
    } catch {
      // Le stockage peut être interdit : l'état affiché, lui, est bien revenu au jeu commité.
    }
    draftLoaded = false;
  }

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

  function measureActiveSlide() {
    const slide = trackEl?.children[current] as HTMLElement | undefined;
    if (slide) activeHeight = slide.getBoundingClientRect().height;
  }

  /**
   * Mesure principale, pilotée par la réactivité Svelte. Elle couvre tout ce qui fait grandir la carte
   * active par changement d'état : alerte de transmission, rapport de rejeu, note qui s'allonge,
   * sélection d'une option. Vérifié en navigateur : sans ce chemin, l'alerte de transmission dépassait
   * la hauteur mesurée et se faisait rogner, car un ResizeObserver seul dépend d'une frame d'animation
   * (et n'en reçoit aucune dans un onglet en arrière-plan).
   */
  $effect(() => {
    // Lectures volontaires : elles abonnent cet effet aux changements de contenu de la carte active.
    void current;
    void includeResult;
    void notes;
    void selections;
    void replayReport;
    void exportState;
    void divergences;
    void sendAllResult;
    void showTargets;
    measureActiveSlide();
  });

  /** Filet pour ce qui ne passe pas par l'état : redimensionnement de fenêtre, polices, poignée de resize. */
  $effect(() => {
    const slide = trackEl?.children[current] as HTMLElement | undefined;
    if (!slide) return;
    const observer = new ResizeObserver(() => measureActiveSlide());
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

  /**
   * Même forme que le jeu de réponses commité : ce qui sort peut donc être rejoué tel quel, sans
   * édition à la main. C'est ce qui fait du dossier un scénario de recette et pas une capture d'écran.
   */
  function buildAnswerSetJson(): string {
    const answers: Record<string, { option: string | null; note: string }> = {};
    for (const decision of dossier.decisions) {
      answers[decision.key] = {
        option: selections[decision.key] ?? null,
        note: notes[decision.key]?.trim() ?? ''
      };
    }
    return `${JSON.stringify(
      {
        dossier: 'agent-memory',
        revision: dossier.revision,
        capturedAt: new Date().toISOString().slice(0, 10),
        capturedFrom: 'focus, dossier /dossier/agent-memory',
        answers
      },
      null,
      2
    )}\n`;
  }

  async function copyAnswerSetJson() {
    try {
      await navigator.clipboard.writeText(buildAnswerSetJson());
      exportState = 'copied-json';
    } catch {
      exportState = 'failed';
    }
  }

  type ReplayReport = {
    applied: string[];
    /** Clés de réponse dont la décision n'existe plus dans cette révision. */
    missingDecisions: string[];
    /** Décision toujours là, mais option disparue : la note est rejouée, la sélection non. */
    staleOptions: string[];
    /**
     * L'inverse : des décisions de CETTE révision que le jeu enregistré ne couvre pas. Sur un changement
     * de révision c'est précisément ce que le lecteur doit voir — sans cela, un rejeu « réussi » laisse
     * croire que tout le dossier est répondu alors que les cartes ajoutées sont vides.
     */
    unanswered: string[];
    revisionMismatch: boolean;
  };

  /**
   * Le rapport du jeu commité tel qu'il retombe sur CETTE révision. Affiché d'emblée, plus seulement
   * après un clic : puisque le jeu commité est désormais ce qu'on voit à l'ouverture, le lecteur doit
   * savoir immédiatement ce qui a été chargé, ce qui n'a pas pu l'être, et quelles cartes ont été
   * AJOUTÉES depuis (D8–D13) — des cartes en attente, pas des réponses perdues.
   */
  let replayReport = $state<ReplayReport | null>(committed ? committed.report : null);
  let replayPendingConfirm = $state(false);

  const revisionMismatch = $derived(Boolean(answerSet) && answerSet!.revision !== dossier.revision);

  /**
   * Recharger le jeu commité est un acte DÉLIBÉRÉ dès qu'il y a un brouillon à écraser : des réponses en
   * cours ne doivent pas disparaître d'un clic. Sans brouillon, il n'y a rien à confirmer.
   */
  function requestReplay() {
    if (!answerSet) return;
    if (divergences.length > 0) {
      replayPendingConfirm = true;
      return;
    }
    applyReplay();
  }

  function cancelReplay() {
    replayPendingConfirm = false;
  }

  /**
   * Applique le jeu enregistré. Toute réponse qui ne retombe pas sur cette révision est RAPPORTÉE,
   * jamais écartée en silence : une absence invisible est un mensonge de plus dans un dossier de
   * décision. Les réponses sont rejouées telles quelles — y compris une sélection qui contredit sa
   * propre note : c'est ce que l'humain a écrit, ce n'est pas à l'interface de le réconcilier.
   */
  function applyReplay() {
    if (!committed) return;
    // Une seule projection, partagée avec le chargement initial (`$lib/dossier-answers.js`) : deux
    // implémentations du même report finiraient par ne plus dire la même chose au même lecteur.
    useCommitted();
    replayPendingConfirm = false;
    // On atterrit sur la première décision : un rejeu qu'on ne voit pas n'est pas un rejeu.
    current = 1;
  }

  type IncludeResult = {
    ok: boolean;
    delivered?: boolean;
    target?: string;
    reason?: string;
    recipientLive?: boolean;
    answerCount?: number;
    noteCount?: number;
    remedy?: string;
    live?: { instance: string; name: string | null; workspace: string | null }[];
    note?: string;
    error?: string;
  };

  let including = $state<string | null>(null);
  let includeResult = $state<Record<string, IncludeResult>>({});

  // ── Destinataire ────────────────────────────────────────────────────────────────────────────────
  // Résolu côté serveur contre le REGISTRE VIVANT (chemin du checkout, pas nom du dossier), et modifiable
  // ici. Un destinataire qu'on peut voir et choisir vaut mieux qu'un destinataire deviné : c'est la
  // différence entre « aucune session live » et « voici qui est live, dites-moi qui doit lire ça ».
  let h2aTarget = $state<string | null>(data.h2a.target);
  let h2aLive = $state(data.h2a.live);
  let h2aReason = $state(data.h2a.reason);
  let h2aRemedy = $state<string | null>(data.h2a.remedy);
  let h2aAmbiguous = $state(data.h2a.ambiguous);
  let showTargets = $state(false);
  let refreshingTargets = $state(false);

  async function refreshTargets() {
    refreshingTargets = true;
    try {
      const res = await fetch('/api/h2a/targets');
      const body = await res.json();
      if (body?.ok) {
        h2aLive = body.live ?? [];
        h2aReason = body.reason;
        h2aRemedy = body.remedy ?? null;
        h2aAmbiguous = Boolean(body.ambiguous);
        // Une cible explicitement choisie par l'humain n'est jamais écrasée par une re-résolution.
        if (!h2aTarget || !h2aLive.some((s: { instance: string }) => s.instance === h2aTarget)) {
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

  /** Il n'y a quelque chose à transmettre que si le lecteur a choisi une option OU écrit une note. */
  function hasSomethingToInclude(decisionKey: string): boolean {
    return Boolean(selections[decisionKey] || notes[decisionKey]?.trim());
  }

  /**
   * Le presse-papier rend le choix transportable ; ceci le fait ARRIVER, et c'est le chemin par DÉFAUT.
   * La note part avec le choix : c'est elle qui porte le raisonnement, l'option n'en est que l'étiquette —
   * une transmission qui perd les notes a échoué même si toutes les options sont justes.
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
          note: notes[decisionKey] ?? '',
          target: h2aTarget
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

  let sendingAll = $state(false);
  let sendAllResult = $state<IncludeResult | null>(null);

  /**
   * Tout le dossier en une fois, en UN envelope. Treize clics pour sortir un dossier, c'est exactement la
   * raison pour laquelle on finit par tout recopier à la main dans le presse-papier.
   */
  async function sendAll() {
    sendingAll = true;
    sendAllResult = null;
    try {
      const answers = collectAnsweredOnly({ selections, notes }, dossier.decisions);
      const res = await fetch('/api/dossiers/agent-memory/include', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers, target: h2aTarget })
      });
      sendAllResult = (await res.json()) as IncludeResult;
    } catch (e) {
      sendAllResult = { ok: false, error: `Appel impossible : ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      sendingAll = false;
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
            message="Ce dossier ne préconise aucune option. La première carte présente l'état de l'art, ne demande rien, et liste les corrections apportées à la révision précédente ; viennent ensuite les décisions, chacune avec ses alternatives, leur comportement, leur conséquence, les faits de mécanisme qui les éclairent avec leur source, et ce que la recherche n'a PAS pu établir. Le champ « critère à trancher » nomme ce qu'il faut peser, jamais un choix. Les cartes marquées « nouvelle carte » découlent de vos propres réponses du premier passage, citées verbatim. Vos réponses commitées sont chargées depuis le dépôt : « Transmettre à la CLI » les remet à une session h2a live du projet, le presse-papier reste disponible en repli."
          />

          <!-- D'OÙ VIENNENT LES RÉPONSES AFFICHÉES. C'est le correctif du défaut principal : ces réponses
               vivaient dans le localStorage d'un seul navigateur, donc un navigateur neuf, un autre port ou
               un stockage vidé affichait un dossier VIDE alors que tout était commité et intact dans git.
               La provenance est maintenant dite à l'écran, jamais supposée. -->
          {#if !answerSet}
            <Alert
              tone="warning"
              title="Jeu de réponses commité introuvable"
              message="Le fichier docs/decisions/2026-07-25-agent-memory-owner-answers.json n'est pas atteignable depuis ce service. Rien n'a été inventé : le dossier s'ouvre vide, et vos réponses commitées ne sont pas perdues pour autant — elles sont dans le dépôt."
            />
          {:else if answerOrigin === 'committed'}
            <Alert
              tone="success"
              title={`Réponses commitées chargées (${Object.keys(committed?.state.notes ?? {}).length} note(s), ${Object.keys(committed?.state.selections ?? {}).length} sélection(s))`}
              message={`Chargées côté serveur depuis ${answerSet.source} — aucun état de navigateur n'est nécessaire pour les voir. Vos modifications restent locales tant qu'elles ne sont pas commitées, et cette bannière vous dira si elles s'écartent du jeu commité.`}
            />
          {:else}
            <!-- Brouillon ET jeu commité en désaccord : on affiche le brouillon (c'est le travail en cours
                 de l'humain) mais JAMAIS en silence. Nommer les décisions concernées, montrer les deux
                 valeurs, offrir le retour au jeu commité. -->
            <Alert
              tone="warning"
              title={`Brouillon local différent du jeu commité sur ${divergences.length} décision(s) : ${divergences.map((d) => d.key).join(', ')}`}
              message="Ce qui est affiché ci-dessous est votre brouillon local (non commité). Le jeu commité dans le dépôt, lui, est intact. Le détail des écarts est plus bas, avec le retour au jeu commité en un clic."
            />
          {/if}

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

                    <!-- Les corrections à la révision précédente sont montrées ICI, sur la carte d'état de
                         l'art, et jamais appliquées en silence : un dossier de décision qui réécrit un fait
                         sans le dire demande au lecteur de faire confiance à une version qu'il ne peut plus
                         comparer. Chaque entrée nomme ce qui était affirmé, ce qu'il en est, et la source. -->
                    {#if dossier.corrections?.length}
                      <section aria-labelledby="corrections-title">
                        <Stack gap={2}>
                          <h2 id="corrections-title">
                            Corrections à la révision précédente ({dossier.corrections.length})
                          </h2>
                          <p>
                            La recherche de mécanismes a démenti des affirmations que la révision
                            <strong>{dossier.previousRevision}</strong> présentait comme des faits. Elles sont
                            listées ici, et les cellules concernées de la matrice ci-dessus ont été réécrites.
                          </p>
                          <ul class="corrections">
                            {#each dossier.corrections as correction (correction.subject)}
                              <li>
                                <Stack gap={1}>
                                  <strong>{correction.subject}</strong>
                                  <p class="was-stated">
                                    <em>Était affirmé :</em>
                                    {correction.wasStated}
                                  </p>
                                  <p><strong>En réalité :</strong> {correction.actually}</p>
                                  <p class="fact-source">{correction.source}</p>
                                </Stack>
                              </li>
                            {/each}
                          </ul>
                        </Stack>
                      </section>
                    {/if}

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
                        <Flex align="center" wrap gap={2}>
                          <Badge tone="info">{decision.key}</Badge>
                          {#if decision.addedInRevision}
                            <Badge tone="neutral" size="sm">Nouvelle carte (révision 2)</Badge>
                          {/if}
                          <!-- L'écart se voit AUSSI sur la carte concernée : une bannière en haut de page
                               se lit une fois, la carte se lit au moment de décider. -->
                          {#if divergentKeys.has(decision.key)}
                            <Badge tone="warning" size="sm">Brouillon ≠ jeu commité</Badge>
                          {/if}
                        </Flex>
                        <span>Décision {slide} sur {decisionsTotal}</span>
                      </Flex>

                      <Stack gap={2}>
                        <h2>{decision.question}</h2>
                        <p>{decision.whyNow}</p>
                      </Stack>

                      <!-- Une carte de la ronde 2 doit dire d'où elle vient : la réponse du propriétaire est
                           citée VERBATIM, dans ses mots, parce que c'est le raisonnement — la reformuler
                           reviendrait à lui présenter une carte fondée sur notre paraphrase de lui. -->
                      {#if decision.fromAnswer}
                        <section
                          class="from-answer"
                          aria-labelledby={`from-answer-${decision.key}`}
                        >
                          <Stack gap={1}>
                            <h3 id={`from-answer-${decision.key}`}>
                              Découle de votre réponse{decision.parent?.length
                                ? ` à ${decision.parent.join(' et ')}`
                                : ''}
                            </h3>
                            <blockquote>{decision.fromAnswer}</blockquote>
                          </Stack>
                        </section>
                      {/if}

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

                      <!-- Les faits de MÉCANISME vivent sur la carte qui en a besoin, jamais en annexe : la
                           demande explicite du propriétaire était « comment hermes fait ou d'autres, il faut
                           plus de détail ». Chaque fait porte sa source (section de recherche + fichier:ligne,
                           issue ou arXiv) pour être vérifiable, et un fait que la recherche n'a pas pu établir
                           est marqué NON VÉRIFIÉ au lieu d'être présenté comme acquis. -->
                      {#if decision.mechanisms?.length}
                        <section aria-labelledby={`mechanisms-${decision.key}`}>
                          <Stack gap={2}>
                            <h3 id={`mechanisms-${decision.key}`}>
                              Comment ça marche réellement ({decision.mechanisms.length})
                            </h3>
                            <ul class="mechanisms">
                              {#each decision.mechanisms as mechanism (mechanism.system + mechanism.source)}
                                <li>
                                  <Stack gap={1}>
                                    <Flex align="center" wrap gap={2}>
                                      <strong>{mechanism.system}</strong>
                                      {#if mechanism.status === 'unverified'}
                                        <Badge tone="warning" size="sm">Non vérifié</Badge>
                                      {/if}
                                    </Flex>
                                    <p>{mechanism.fact}</p>
                                    <p class="fact-source">{mechanism.source}</p>
                                  </Stack>
                                </li>
                              {/each}
                            </ul>
                          </Stack>
                        </section>
                      {/if}

                      <!-- La ligne la plus utile d'une carte de décision est un « nous n'avons pas pu
                           l'établir » honnête. Ces éléments ne sont donc pas fondus dans la prose des options,
                           où ils prendraient la couleur d'un fait. -->
                      {#if decision.unknowns?.length}
                        <section class="unknowns" aria-labelledby={`unknowns-${decision.key}`}>
                          <Stack gap={2}>
                            <Flex align="center" wrap gap={2}>
                              <h3 id={`unknowns-${decision.key}`}>Ce que nous n’avons pas pu établir</h3>
                              <Badge tone="warning" size="sm">{decision.unknowns.length}</Badge>
                            </Flex>
                            <ul>
                              {#each decision.unknowns as unknown, unknownIndex (unknownIndex)}
                                <li>{unknown}</li>
                              {/each}
                            </ul>
                          </Stack>
                        </section>
                      {/if}

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
                              ? `Votre option et votre note partent ensemble${h2aTarget ? ` vers ${h2aTarget}` : ''}.`
                              : 'Sélectionnez une option ou écrivez une note pour pouvoir la transmettre.'}
                          </span>
                          <Button
                            variant="primary"
                            onclick={() => includeChoice(decision.key)}
                            disabled={including === decision.key || !hasSomethingToInclude(decision.key)}
                          >
                            {including === decision.key ? 'Transmission…' : 'Transmettre à la CLI (h2a)'}
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
                            <!-- Pas seulement « non » : POURQUOI, et ce qui le rendrait possible. -->
                            <Alert
                              tone="warning"
                              title="Non remis — et voici ce qui le permettrait"
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

          <!-- SORTIR LES RÉPONSES. h2a est le chemin par défaut : c'est ce que le propriétaire demandait
               (« on avait déjà fait ça donc c'est faisable et ça devrait être le choix par défaut »). Le
               presse-papier reste là, en repli, pour coller ailleurs. -->
          <section aria-labelledby="handoff-title">
            <Stack gap={3}>
              <h2 id="handoff-title">Transmettre vos réponses</h2>

              <Stack gap={2}>
                <Flex align="center" justify="between" wrap gap={2}>
                  <span class="include-hint">
                    {#if h2aTarget}
                      Destinataire : <strong>{h2aTarget}</strong>
                      {#if h2aReason === 'workspace'}(résolu sur le chemin du checkout){:else if h2aReason === 'emitter'}(la session qui sert ce focus){:else if h2aReason === 'requested'}(choisi par vous){:else if h2aReason === 'configured'}(épinglé par FOCUS_H2A_TARGET){:else if h2aReason === 'sole'}(seule session live){:else if h2aReason === 'name'}(résolu sur le nom de session){/if}
                    {:else}
                      Aucun destinataire résolu pour l'instant.
                    {/if}
                  </span>
                  <Flex align="center" wrap gap={2}>
                    <Button variant="secondary" onclick={() => (showTargets = !showTargets)}>
                      {showTargets ? 'Masquer les sessions' : 'Changer de destinataire'}
                    </Button>
                    <Button variant="secondary" onclick={refreshTargets} disabled={refreshingTargets}>
                      {refreshingTargets ? 'Actualisation…' : 'Actualiser'}
                    </Button>
                  </Flex>
                </Flex>

                {#if !h2aTarget && h2aRemedy}
                  <Alert tone="warning" title="Rien à qui remettre — pour l'instant" message={h2aRemedy} />
                {/if}

                <!-- Plusieurs sessions live répondent pour ce dépôt : on en retient une, mais jamais en
                     silence. Choisir à pile ou face qui lira une décision ne doit pas être invisible. -->
                {#if h2aAmbiguous}
                  <Alert
                    tone="warning"
                    title="Plusieurs sessions live répondent pour ce dépôt"
                    message={`Le destinataire retenu est ${h2aTarget}. Les autres sessions live de ce dépôt ne le recevront pas — si ce n'est pas la bonne, choisissez-la ci-dessus avant de transmettre. Les sessions peuvent vivre sur des racines h2a différentes, qui ne se voient pas entre elles.`}
                  />
                {/if}

                {#if showTargets}
                  <!-- Le registre vivant, montré tel quel : un destinataire qu'on choisit dans une liste
                       est résoluble ; un destinataire déduit du nom d'un dossier est une devinette. -->
                  <Stack gap={2}>
                    {#if h2aLive.length === 0}
                      <Alert
                        tone="warning"
                        title="Aucune session h2a live"
                        message={h2aRemedy ?? "Le registre ne contient aucune session live, pour aucun projet. Ouvrez une CLI h2a, puis « Actualiser »."}
                      />
                    {:else}
                      {#each h2aLive as session (session.instance)}
                        <div
                          role="presentation"
                          onpointerdown={(event) => event.stopPropagation()}
                          onpointerup={(event) => event.stopPropagation()}
                        >
                          <Tile
                            variant="selectable"
                            selected={h2aTarget === session.instance}
                            onselect={() => chooseTarget(session.instance)}
                          >
                            <Stack gap={1}>
                              <Flex align="center" justify="between" wrap gap={2}>
                                <strong>{session.name ?? session.instance}</strong>
                                {#if session.matchesRepo}
                                  <Badge tone="success" size="sm">Ce dépôt</Badge>
                                {/if}
                              </Flex>
                              <p class="fact-source">{session.instance}</p>
                              {#if session.workspace}<p class="fact-source">{session.workspace}</p>{/if}
                              <!-- La racine fait PARTIE de l'adresse : deux sessions du même dépôt peuvent
                                   vivre sur deux bus h2a qui ne se voient pas. -->
                              {#if session.root}<p class="fact-source">racine h2a : {session.root}</p>{/if}
                            </Stack>
                          </Tile>
                        </div>
                      {/each}
                    {/if}
                  </Stack>
                {/if}

                <Flex align="center" justify="between" wrap gap={2}>
                  <span class="include-hint">
                    {answeredCount > 0
                      ? `${answeredCount} réponse(s) partiraient en un seul envoi, options ET notes.`
                      : 'Aucune réponse à transmettre pour le moment.'}
                  </span>
                  <Button variant="primary" onclick={sendAll} disabled={sendingAll || answeredCount === 0}>
                    {sendingAll ? 'Transmission…' : 'Transmettre toutes mes réponses à la CLI'}
                  </Button>
                </Flex>

                {#if sendAllResult}
                  {#if sendAllResult.ok && sendAllResult.delivered}
                    <Alert
                      tone="success"
                      title={`Transmis à ${sendAllResult.target}`}
                      message={sendAllResult.note ?? ''}
                    />
                  {:else if sendAllResult.ok}
                    <Alert
                      tone="warning"
                      title="Non remis — et voici ce qui le permettrait"
                      message={sendAllResult.note ?? ''}
                    />
                  {:else}
                    <Alert
                      tone="error"
                      title="Échec de la transmission"
                      message={sendAllResult.error ?? 'Erreur inconnue.'}
                    />
                  {/if}
                {/if}
              </Stack>
            </Stack>
          </section>

          <section aria-labelledby="summary-title">
            <Stack gap={2}>
              <h2 id="summary-title">Vos notes (repli presse-papier)</h2>
              <Flex align="center" justify="between" wrap gap={2}>
                <span>
                  {answeredCount} décision(s) sur {decisionsTotal} annotée(s) ou sélectionnée(s).
                </span>
                <Flex align="center" wrap gap={2}>
                  <Button variant="secondary" onclick={copySummary}>Copier ma synthèse</Button>
                  <Button variant="secondary" onclick={copyAnswerSetJson}>
                    Copier le jeu de réponses (JSON)
                  </Button>
                </Flex>
              </Flex>
              {#if exportState === 'copied'}
                <Alert
                  tone="success"
                  title="Synthèse copiée"
                  message="Vos sélections et vos notes sont dans le presse-papier, en markdown. Collez-les où vous voulez : une CLI, un ticket, un message."
                />
              {:else if exportState === 'copied-json'}
                <Alert
                  tone="success"
                  title="Jeu de réponses copié (JSON)"
                  message="Même forme que le jeu enregistré : il peut être commité puis rejoué tel quel dans ce dossier, sans retouche à la main."
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

          <!-- Rejeu du jeu de réponses commité : ce dossier sert de scénario de recette, il doit donc
               pouvoir être re-parcouru avec de vraies réponses. Jamais au chargement, toujours sur
               action explicite. -->
          <section aria-labelledby="replay-title">
            <Stack gap={2}>
              <h2 id="replay-title">Jeu de réponses commité</h2>
              {#if !answerSet}
                <Alert
                  tone="warning"
                  title="Jeu commité indisponible"
                  message="Le jeu de réponses commité n'est pas atteignable depuis ce service (docs/decisions/2026-07-25-agent-memory-owner-answers.json). Rien n'a été inventé : vos réponses locales sont intactes."
                />
              {:else}
                <p>
                  Jeu commité : <code>{answerSet.source}</code> — révision
                  <strong>{answerSet.revision}</strong>{answerSet.capturedAt
                    ? `, capturé le ${answerSet.capturedAt}`
                    : ''}{answerSet.status ? ` (${answerSet.status})` : ''}. Il est chargé
                  <strong>par défaut</strong>, côté serveur, sélections <strong>et</strong> notes, telles
                  qu'elles ont été écrites — aucun état de navigateur n'est requis pour le voir.
                </p>
                <!-- Ce que la montée de révision conserve, dit AVANT l'avertissement de révision différente :
                     l'écart de révision est un fait, mais il n'implique pas une perte, et laisser croire le
                     contraire ferait hésiter à rejouer un jeu qui se rejoue intégralement. -->
                {#if dossier.carryOver}
                  <Alert
                    tone="info"
                    title={`Report depuis « ${dossier.carryOver.from} » : ${dossier.carryOver.carried.length} décisions conservées, ${dossier.carryOver.added.length} ajoutées`}
                    message={dossier.carryOver.statement}
                  />
                {/if}
                {#if revisionMismatch}
                  <Alert
                    tone="warning"
                    title="Révision différente"
                    message={`Ces réponses ont été capturées sur « ${answerSet.revision} », or ce dossier est en « ${dossier.revision} ». Le rejeu dira précisément ce qui retombe sur cette révision, ce qui n'y retombe plus, et quelles décisions ce jeu ne couvre pas.`}
                  />
                {/if}
                <!-- LE DÉTAIL DES ÉCARTS. Quand le brouillon local et le jeu commité ne disent pas la même
                     chose, on montre LES DEUX valeurs plutôt que d'en choisir une sans le dire. -->
                {#if divergences.length > 0}
                  <Alert
                    tone="warning"
                    title={`${divergences.length} écart(s) entre votre brouillon local et le jeu commité`}
                    message="Ce que la page affiche est votre brouillon. Voici, décision par décision, ce que dit le jeu commité du dépôt."
                  />
                  <ul class="divergences">
                    {#each divergences as divergence (divergence.key)}
                      <li>
                        <Stack gap={1}>
                          <strong>{divergence.key}</strong>
                          <p>
                            <em>Jeu commité :</em>
                            {divergence.committedOption ?? '(aucune option)'} —
                            {divergence.committedNote ? divergence.committedNote : '(aucune note)'}
                          </p>
                          <p>
                            <em>Votre brouillon :</em>
                            {divergence.draftOption ?? '(aucune option)'} —
                            {divergence.draftNote ? divergence.draftNote : '(aucune note)'}
                          </p>
                        </Stack>
                      </li>
                    {/each}
                  </ul>
                {/if}

                <Flex align="center" justify="between" wrap gap={2}>
                  <span class="include-hint">
                    {divergences.length > 0
                      ? 'Votre brouillon local diverge : le recharger le remplacera, après confirmation.'
                      : 'Aucun écart : ce que vous voyez EST le jeu commité.'}
                  </span>
                  <Button variant="secondary" onclick={requestReplay} disabled={replayPendingConfirm}>
                    Recharger le jeu commité
                  </Button>
                </Flex>

                {#if replayPendingConfirm}
                  <Alert
                    tone="warning"
                    title="Remplacer votre brouillon local ?"
                    message={`Le rechargement va supprimer votre brouillon local (${divergences.length} écart(s) : ${divergences.map((d) => d.key).join(', ')}) et réafficher le jeu commité du dépôt. Cette action est volontaire et ne peut pas être annulée.`}
                  />
                  <Flex align="center" wrap gap={2}>
                    <Button variant="primary" onclick={applyReplay}>Remplacer et recharger</Button>
                    <Button variant="secondary" onclick={cancelReplay}>Annuler</Button>
                  </Flex>
                {/if}

                {#if replayReport}
                  <Alert
                    tone={replayReport.missingDecisions.length || replayReport.staleOptions.length
                      ? 'warning'
                      : 'success'}
                    title={`${replayReport.applied.length} réponse(s) chargée(s) depuis le jeu commité`}
                    message={`Sélections et notes chargées pour : ${replayReport.applied.join(', ') || '(aucune)'}.`}
                  />
                  <!-- Une réponse qui ne retombe plus sur cette révision est NOMMÉE, jamais escamotée. -->
                  {#if replayReport.missingDecisions.length}
                    <Alert
                      tone="error"
                      title="Réponses non rejouables : décision disparue"
                      message={`Ces clés n'existent plus dans la révision « ${dossier.revision} » et n'ont donc pas pu être rejouées : ${replayReport.missingDecisions.join(', ')}. Leurs notes sont toujours dans le jeu enregistré, pas dans cette page.`}
                    />
                  {/if}
                  {#if replayReport.staleOptions.length}
                    <Alert
                      tone="warning"
                      title="Options disparues : note rejouée, sélection non"
                      message={`Ces options n'existent plus pour leur décision : ${replayReport.staleOptions.join(', ')}. La note a été restaurée, la sélection est restée vide — à vous de la reprendre.`}
                    />
                  {/if}
                  <!-- L'autre moitié de l'honnêteté d'un rejeu : les cartes que ce jeu ne couvre pas. -->
                  {#if replayReport.unanswered.length}
                    <Alert
                      tone="info"
                      title={`${replayReport.unanswered.length} décision(s) sans réponse dans ce jeu`}
                      message={`Ce jeu enregistré ne couvre pas : ${replayReport.unanswered.join(', ')}. Ce ne sont pas des réponses perdues — ce sont les cartes ajoutées depuis, qui attendent la vôtre.`}
                    />
                  {/if}
                {/if}
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
  /* Les listes de la révision 2 (corrections, mécanismes, inconnues) : uniquement des tokens du design
     system, aucune couleur en dur, pour rester lisibles en thème clair comme en thème sombre. */
  .corrections,
  .mechanisms,
  .divergences,
  .unknowns ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--st-spacing-3, 0.75rem);
  }
  .corrections > li,
  .mechanisms > li,
  .divergences > li,
  .unknowns ul > li {
    border-inline-start: 2px solid var(--st-semantic-border-default, currentColor);
    padding-inline-start: var(--st-spacing-3, 0.75rem);
    min-width: 0;
  }
  /* La source rend le fait vérifiable : discrète, mais jamais absente. */
  .fact-source {
    color: var(--st-semantic-text-secondary, inherit);
    font-size: 0.8125rem;
    /* Un chemin fichier:ligne ne doit pas provoquer de débordement horizontal du corps de page. */
    overflow-wrap: anywhere;
  }
  .was-stated {
    color: var(--st-semantic-text-secondary, inherit);
  }
  /* La réponse du propriétaire, citée verbatim : visuellement distincte de notre propre texte. */
  .from-answer blockquote {
    margin: 0;
    border-inline-start: 3px solid var(--st-semantic-border-default, currentColor);
    padding-inline-start: var(--st-spacing-3, 0.75rem);
    font-style: italic;
  }
</style>
