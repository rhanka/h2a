<script lang="ts">
  import {
    AppShell,
    AppHeader,
    Container,
    Flex,
    Card,
    DataTable,
    Badge,
    Button,
    ButtonGroup,
    Checkbox,
    Alert,
    ContentSwitcher,
    EmptyState
  } from '@sentropic/design-system-svelte';
  import type { Tone, TodoRow, DoneItem } from '$lib/track-model';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const focus = data.focus;

  function badgeTone(t: Tone): 'neutral' | 'success' | 'warning' | 'error' | 'info' {
    return { critical: 'error', warning: 'warning', info: 'info', neutral: 'neutral', positive: 'success' }[
      t
    ] as 'neutral' | 'success' | 'warning' | 'error' | 'info';
  }

  // Everything below is already FRENCH + jargon-free (translated server-side).
  const todos: TodoRow[] = focus.ok ? focus.todos : [];
  const precos = focus.ok ? focus.precos : [];
  const decisions = focus.ok ? focus.decisions : [];
  const done = focus.ok ? focus.done : [];
  const counts = focus.ok ? focus.counts : { done: 0, todo: 0, decisions: 0 };
  const keystone = focus.ok ? focus.keystone : undefined;
  const repo = focus.ok ? focus.repo : '';
  const lastReleaseAt = focus.ok ? focus.lastReleaseAt : undefined;

  // ---- WP filter (spans BOTH Fait and À-faire) ----
  // Distinct workpackages present anywhere, sorted naturally (WP1 < WP2 < WP2.1 < WP10).
  const allWps: string[] = [...new Set([...todos, ...done].map((r) => r.wp).filter((w): w is string => !!w))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true })
  );
  let wpFilter = $state<string>('tous');
  const matchWp = (w: string | undefined): boolean => wpFilter === 'tous' || w === wpFilter;

  const todosShown = $derived(todos.filter((t) => matchWp(t.wp)));
  const launchableIds = $derived(todosShown.filter((t) => t.launchable).map((t) => t.id));

  // ---- FAIT period filter (jour / semaine / mois / depuis dev / tout) ----
  // "dev" = the current dev period, i.e. everything delivered SINCE the last release (lastReleaseAt).
  let period = $state<'jour' | 'semaine' | 'mois' | 'dev' | 'tout'>('mois');
  function withinPeriod(iso: string | undefined): boolean {
    if (period === 'tout') return true;
    if (!iso) return false;
    if (period === 'dev') return lastReleaseAt ? Date.parse(iso) >= Date.parse(lastReleaseAt) : false;
    const days = (Date.now() - Date.parse(iso)) / 86_400_000;
    return period === 'jour' ? days < 1 : period === 'semaine' ? days < 7 : days < 31;
  }
  // "Depuis dev" only makes sense when we know when the last release was cut.
  const periodItems = [
    { value: 'jour', label: 'Jour' },
    { value: 'semaine', label: 'Semaine' },
    { value: 'mois', label: 'Mois' },
    ...(lastReleaseAt ? [{ value: 'dev', label: 'Depuis dev' }] : []),
    { value: 'tout', label: 'Tout' }
  ];
  const doneShown = $derived(done.filter((d) => withinPeriod(d.doneAt) && matchWp(d.wp)));

  // ---- selection + bulk-launch state ----
  let selected = $state<string[]>([]);
  let launching = $state(false);
  let launchResult = $state<any>(null);

  function toggle(id: string, on: boolean) {
    if (on) selected = selected.includes(id) ? selected : [...selected, id];
    else selected = selected.filter((x) => x !== id);
  }
  const selectAll = () => (selected = [...launchableIds]);
  const clearSel = () => (selected = []);

  async function launch() {
    if (selected.length === 0) return;
    launching = true;
    launchResult = null;
    try {
      const res = await fetch('/api/actions/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: selected })
      });
      launchResult = await res.json();
    } catch (e) {
      launchResult = { ok: false, error: String(e) };
    } finally {
      launching = false;
    }
  }

  const todoColumns = $derived.by(() => [
    { key: 'sel', label: '', width: '3.25rem', sortable: false, cell: selCell },
    { key: 'subject', label: 'Sujet', cell: subjectCell },
    { key: 'action', label: 'Action concrète', cell: actionCell },
    { key: 'actor', label: 'Acteur', width: '11rem', cell: actorCell },
    { key: 'badge', label: 'Priorité', width: '8.5rem', sortable: false, cell: prioCell }
  ]);
  const doneColumns = [
    { key: 'title', label: 'Sujet', cell: doneTitleCell },
    { key: 'wp', label: 'WP', width: '6rem', sortable: true },
    { key: 'kind', label: 'Type', width: '7.5rem', sortable: true },
    { key: 'ago', label: 'Réalisé', width: '8rem' }
  ];

  // ---- decision → inject into the concerned CLI (h2a agent of that workspace) ----
  let injecting = $state<string | null>(null);
  let injectResult = $state<Record<string, any>>({});
  async function injectDecision(id: string) {
    injecting = id;
    try {
      const res = await fetch('/api/decisions/inject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      injectResult = { ...injectResult, [id]: await res.json() };
    } catch (e) {
      injectResult = { ...injectResult, [id]: { ok: false, error: String(e) } };
    } finally {
      injecting = null;
    }
  }
</script>

{#snippet selCell(row: TodoRow)}
  {#if row.launchable}
    <Checkbox
      label={`Sélectionner : ${row.subject}`}
      checked={selected.includes(row.id)}
      onchange={(e: Event) => toggle(row.id, (e.currentTarget as HTMLInputElement).checked)}
    />
  {:else}
    <span title="Non lançable par un sous-agent (requiert un humain ou un partenaire)" style="opacity:.4">—</span>
  {/if}
{/snippet}

{#snippet subjectCell(row: TodoRow)}
  <div>
    <div style="font-weight:600; line-height:1.35">{row.subject}</div>
    {#if row.gate}<div style="font-size:.82em; opacity:.72; margin-top:3px">{row.gate}</div>{/if}
    {#if row.wp}<div style="font-size:.75em; opacity:.5; margin-top:3px">{row.wp}</div>{/if}
  </div>
{/snippet}

{#snippet actionCell(row: TodoRow)}
  <div>
    <div>{row.action}</div>
    {#if row.fanIn}<div style="font-size:.78em; opacity:.7; margin-top:3px">Débloque {row.fanIn} autre(s)</div>{/if}
  </div>
{/snippet}

{#snippet actorCell(row: TodoRow)}
  <Flex direction="column" gap={1} align="start">
    <span>{row.actor}</span>
    <Badge tone={row.nature === 'Décision' ? 'info' : 'neutral'} size="sm">{row.nature}</Badge>
  </Flex>
{/snippet}

{#snippet prioCell(row: TodoRow)}
  <Badge tone={badgeTone(row.badge.tone)}>{row.badge.label}</Badge>
{/snippet}

{#snippet doneTitleCell(row: DoneItem)}
  <div>
    <div style="line-height:1.35">{row.title}</div>
    {#if row.summary}<div style="font-size:.8em; opacity:.72; margin-top:3px; line-height:1.35">{row.summary}</div>{/if}
    {#if row.acceptance}
      <div
        style="font-size:.76em; margin-top:3px; opacity:.7; color:{row.acceptance.includes('échec')
          ? 'var(--st-color-danger-fg, #c0392b)'
          : 'inherit'}"
      >
        {row.acceptance}
      </div>
    {/if}
  </div>
{/snippet}

<AppShell variant="workspace">
  {#snippet topChrome()}
    <AppHeader brandName="Focus" productName="Suivi & décision" brandMode="full">
      {#snippet actions()}
        {#if focus.ok}
          <Flex gap={2} align="center" wrap>
            <Badge tone="neutral" size="sm">Projet : {repo}</Badge>
            <span style="font-size:.78em; opacity:.6">commit {focus.baselineCommit.slice(0, 7)}</span>
          </Flex>
        {/if}
      {/snippet}
    </AppHeader>
  {/snippet}

  {#snippet main()}
    <Container size="xl" padding>
      <div class="page">
        {#if !focus.ok}
          <Alert tone="error" title="Impossible de charger le suivi" message={focus.error} />
        {:else}
          <!-- résumé chiffré (toujours visible) -->
          <Flex gap={3} wrap>
            <Card><div class="stat"><div class="stat-n">{counts.done}</div><div class="stat-l">Faits</div></div></Card>
            <Card><div class="stat"><div class="stat-n">{counts.todo}</div><div class="stat-l">À faire</div></div></Card>
            <Card><div class="stat"><div class="stat-n">{counts.decisions}</div><div class="stat-l">Décisions</div></div></Card>
          </Flex>

          <!-- filtre par workpackage : s'applique au Fait ET à l'À-faire -->
          {#if allWps.length}
            <div class="wpbar">
              <span class="wplbl">Workpackage :</span>
              <Button
                size="sm"
                variant={wpFilter === 'tous' ? 'primary' : 'ghost'}
                onclick={() => (wpFilter = 'tous')}>Tous</Button
              >
              {#each allWps as wp (wp)}
                <Button
                  size="sm"
                  variant={wpFilter === wp ? 'primary' : 'ghost'}
                  onclick={() => (wpFilter = wp)}>{wp}</Button
                >
              {/each}
            </div>
          {/if}

          <!-- ========== 1. FAIT (en haut, visible, filtrable par période) ========== -->
          <section>
            <Flex align="center" justify="between" wrap gap={3}>
              <h2 class="sec" style="margin:0">Fait <span class="sec-n">({doneShown.length})</span></h2>
              <ContentSwitcher items={periodItems} bind:value={period} label="Période des faits" />
            </Flex>
            <div class="sp"></div>
            {#if doneShown.length}
              <div class="tscroll">
                <!-- DS DataTable types rows as its base DataTableRow; our typed view DTOs are structurally
                     richer, so we cast (the columns' cell snippets are typed against the concrete row). -->
                <DataTable columns={doneColumns as any} rows={doneShown as any} pageSize={8} emptyLabel="Rien sur cette période" />
              </div>
            {:else}
              <EmptyState title="Rien de terminé sur cette période" message="Élargis la période (Semaine / Mois / Tout)." />
            {/if}
          </section>

          <!-- ========== 2. À FAIRE (avec lancement en masse) ========== -->
          <section>
            <h2 class="sec">
              À faire <span class="sec-n">({wpFilter === 'tous' ? counts.todo : todosShown.length})</span>
              {#if wpFilter !== 'tous'}<span class="sec-n">· {wpFilter}</span>{/if}
            </h2>

            {#if launchResult}
              {#if launchResult.ok}
                <Alert
                  tone={launchResult.rejected?.length ? 'warning' : 'success'}
                  title={`${launchResult.accepted.length} action(s) acceptée(s)${launchResult.rejected?.length ? `, ${launchResult.rejected.length} refusée(s)` : ''}`}
                  message={launchResult.note}
                >
                  {#snippet actions()}
                    <Button size="sm" variant="ghost" onclick={() => (launchResult = null)}>Fermer</Button>
                  {/snippet}
                </Alert>
                <div class="sp"></div>
              {:else}
                <Alert tone="error" title="Échec du lancement" message={launchResult.error} />
                <div class="sp"></div>
              {/if}
            {/if}

            <Flex align="center" justify="between" wrap gap={3}>
              <div style="opacity:.8; font-size:.9em">
                {selected.length} sélectionnée(s) sur {launchableIds.length} lançable(s)
              </div>
              <ButtonGroup label="Actions groupées">
                <Button variant="secondary" onclick={selectAll} disabled={launchableIds.length === 0}>Tout sélectionner</Button>
                <Button variant="ghost" onclick={clearSel} disabled={selected.length === 0}>Vider</Button>
                <Button variant="primary" onclick={launch} disabled={selected.length === 0 || launching}>
                  {launching ? 'Lancement…' : `Lancer la sélection (${selected.length})`}
                </Button>
              </ButtonGroup>
            </Flex>

            <div class="sp"></div>

            <div class="tscroll">
              <DataTable columns={todoColumns as any} rows={todosShown as any} caption="Actions à faire" emptyLabel="Aucune action ouverte" />
            </div>
          </section>

          <!-- ========== 3. LEVIERS (avant les décisions) ========== -->
          <section>
            <h2 class="sec">Leviers — les coups à plus fort effet</h2>
            {#if keystone}
              <Alert
                tone="warning"
                title={`Point de passage : ${keystone.title}`}
                message={`Bloque ${keystone.blocks} autre(s) tâche(s) — le traiter débloque le plus de travail.`}
              />
              <div class="sp"></div>
            {/if}
            <Card>
              <div style="padding:1rem 1.25rem">
                <Flex direction="column" gap={3}>
                  {#each precos as p (p.id)}
                    <div>
                      <Flex gap={2} align="center" wrap>
                        <Badge tone={badgeTone(p.badge.tone)}>{p.badge.label}</Badge>
                        <strong>{p.title}</strong>
                      </Flex>
                      <div style="opacity:.75; font-size:.9em; margin-top:3px">{p.why} · {p.action} · {p.actor}</div>
                    </div>
                  {/each}
                </Flex>
              </div>
            </Card>
          </section>

          <!-- ========== 4. DÉCISIONS (projet + résumé) ========== -->
          <section>
            <h2 class="sec">Décisions <span class="sec-n">({counts.decisions})</span></h2>
            {#if decisions.length === 0}
              <EmptyState title="Aucune décision en attente" message="Rien à trancher pour le moment." />
            {:else}
              <Flex direction="column" gap={3}>
                {#each decisions as d (d.id)}
                  <Card>
                    <div style="padding:1.1rem 1.35rem">
                      <Flex gap={2} align="center" wrap>
                        <Badge tone="info">Décision</Badge>
                        <Badge tone="neutral" size="sm">{d.project}</Badge>
                        {#if d.workspace}<Badge tone="neutral" size="sm">{d.workspace}</Badge>{/if}
                        {#if d.wp}<Badge tone="neutral" size="sm">{d.wp}</Badge>{/if}
                      </Flex>
                      <h3 style="margin:.55rem 0 .3rem; font-size:1.05rem; line-height:1.3">{d.question}</h3>
                      <p style="margin:0 0 .5rem; opacity:.72; font-size:.92em">{d.summary}</p>
                      <Flex align="center" justify="between" wrap gap={2}>
                        <div style="opacity:.85; font-size:.92em">{d.action} — {d.actor}</div>
                        <Button
                          size="sm"
                          variant="primary"
                          onclick={() => injectDecision(d.id)}
                          disabled={injecting === d.id}
                        >
                          {injecting === d.id ? 'Injection…' : 'Injecter dans la CLI'}
                        </Button>
                      </Flex>
                      {#if injectResult[d.id]}
                        <div style="margin-top:.6rem">
                          {#if injectResult[d.id].ok && injectResult[d.id].delivered}
                            <Alert tone="success" title={`Injectée à ${injectResult[d.id].target}`} message={injectResult[d.id].note} />
                          {:else if injectResult[d.id].ok}
                            <Alert tone="warning" title="Aucune CLI live sur ce projet" message={injectResult[d.id].note} />
                          {:else}
                            <Alert tone="error" title="Échec de l'injection" message={injectResult[d.id].error} />
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </Card>
                {/each}
              </Flex>
            {/if}
          </section>

          <div class="foot">
            Généré le {focus.ok ? focus.generatedAt : ''} · source : track (système de référence, lecture seule)
          </div>
        {/if}
      </div>
    </Container>
  {/snippet}
</AppShell>

<style>
  .page { padding: 1.25rem 0 3rem; }
  section { margin-top: 1.9rem; }
  .sec { font-size: 1.15rem; margin: 0 0 .7rem; }
  .sec-n { opacity: .5; font-weight: 400; font-size: .9rem; }
  .stat { padding: .9rem 1.15rem; min-width: 6.5rem; }
  .stat-n { font-size: 1.8em; font-weight: 700; }
  .stat-l { opacity: .7; font-size: .9em; }
  .sp { height: .9rem; }
  .wpbar { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-top: 1.1rem; }
  .wplbl { opacity: .6; font-size: .85em; margin-right: .25rem; }
  .foot { opacity: .45; font-size: .75em; margin-top: 2rem; }
  /* responsive: tables never break the layout on a phone — they scroll on their own */
  .tscroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  @media (max-width: 640px) {
    .page { padding: .75rem 0 2rem; }
    section { margin-top: 1.4rem; }
    .sec { font-size: 1.05rem; }
    .stat { min-width: 5rem; padding: .7rem .85rem; }
    .stat-n { font-size: 1.45em; }
  }
</style>
