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
  import type { Tone, TodoRow } from '$lib/track-model';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const focus = data.focus;

  // Map a semantic tone (from the FR reading layer) onto a DS Badge tone (exact union).
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

  const launchableIds = todos.filter((t) => t.launchable).map((t) => t.id);

  // ---- selection + bulk-launch state ----
  let tab = $state('suivi');
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

  // ---- DataTable column defs (cells are markup snippets defined below) ----
  // Built lazily via $derived.by so the snippet references resolve at render time (after the markup
  // snippets exist), never during the initial script pass.
  const todoColumns = $derived.by(() => [
    { key: 'sel', label: '', width: '3.5rem', sortable: false, cell: selCell },
    { key: 'subject', label: 'Sujet', cell: subjectCell },
    { key: 'action', label: 'Action concrète', cell: actionCell },
    { key: 'actor', label: 'Acteur', width: '12rem', cell: actorCell },
    { key: 'badge', label: 'Priorité', width: '9rem', sortable: false, cell: prioCell }
  ]);
  const doneColumns = [
    { key: 'title', label: 'Sujet' },
    { key: 'kind', label: 'Type', width: '9rem' }
  ];
</script>

{#snippet selCell(row: TodoRow)}
  {#if row.launchable}
    <Checkbox
      label={`Sélectionner : ${row.subject}`}
      checked={selected.includes(row.id)}
      onchange={(e: Event) => toggle(row.id, (e.currentTarget as HTMLInputElement).checked)}
    />
  {:else}
    <span title="Non lançable par un sous-agent (requiert un humain ou un partenaire)" style="opacity:.4"
      >—</span
    >
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
    {#if row.fanIn}<div style="font-size:.78em; opacity:.7; margin-top:3px">
        Débloque {row.fanIn} autre(s)
      </div>{/if}
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

<AppShell variant="workspace">
  {#snippet topChrome()}
    <AppHeader brandName="Focus" productName="Suivi & décision" brandMode="full">
      {#snippet actions()}
        {#if focus.ok}
          <span style="font-size:.8em; opacity:.65">commit {focus.baselineCommit.slice(0, 7)}</span>
        {/if}
      {/snippet}
    </AppHeader>
  {/snippet}

  {#snippet main()}
    <Container size="xl" padding>
      <div style="padding: 1.5rem 0 3rem">
        <ContentSwitcher
          items={[
            { value: 'suivi', label: 'Suivi' },
            { value: 'focus', label: 'Focus décision' }
          ]}
          bind:value={tab}
          label="Choisir la vue"
        />
        <div style="height:1.25rem"></div>

        {#if !focus.ok}
          <Alert tone="error" title="Impossible de charger le suivi" message={focus.error} />
        {:else if tab === 'suivi'}
          <!-- résumé -->
          <Flex gap={4} wrap>
            <Card>
              <div style="padding:1rem 1.25rem; min-width:8rem">
                <div style="font-size:1.9em; font-weight:700">{counts.done}</div>
                <div style="opacity:.7">Faits</div>
              </div>
            </Card>
            <Card>
              <div style="padding:1rem 1.25rem; min-width:8rem">
                <div style="font-size:1.9em; font-weight:700">{counts.todo}</div>
                <div style="opacity:.7">À faire</div>
              </div>
            </Card>
            <Card>
              <div style="padding:1rem 1.25rem; min-width:8rem">
                <div style="font-size:1.9em; font-weight:700">{counts.decisions}</div>
                <div style="opacity:.7">Décisions en attente</div>
              </div>
            </Card>
          </Flex>

          <div style="height:1.25rem"></div>

          <!-- PRÉCO : les vrais coups à plus fort levier -->
          <Card>
            <div style="padding:1.25rem 1.5rem">
              <h2 style="margin:0 0 .2rem; font-size:1.15rem">Préconisations — coups à plus fort levier</h2>
              <p style="margin:0 0 1rem; opacity:.7">
                Dérivées de l'état réel du backlog, pas d'un simple « prendre le premier item ».
              </p>
              {#if keystone}
                <Alert
                  tone="warning"
                  title={`Point de passage : ${keystone.title}`}
                  message={`Cet élément bloque ${keystone.blocks} autre(s) tâche(s) — le traiter débloque le plus de travail.`}
                />
                <div style="height:.85rem"></div>
              {/if}
              <Flex direction="column" gap={3}>
                {#each precos as p (p.id)}
                  <div>
                    <Flex gap={2} align="center" wrap>
                      <Badge tone={badgeTone(p.badge.tone)}>{p.badge.label}</Badge>
                      <strong>{p.title}</strong>
                    </Flex>
                    <div style="opacity:.75; font-size:.9em; margin-top:3px">
                      {p.why} · {p.action} · {p.actor}
                    </div>
                  </div>
                {/each}
              </Flex>
            </div>
          </Card>

          <div style="height:1.5rem"></div>

          <!-- accusé de lancement -->
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
              <div style="height:1rem"></div>
            {:else}
              <Alert tone="error" title="Échec du lancement" message={launchResult.error} />
              <div style="height:1rem"></div>
            {/if}
          {/if}

          <!-- barre d'actions groupées -->
          <Flex align="center" justify="between" wrap gap={3}>
            <div style="opacity:.8">
              {selected.length} action(s) sélectionnée(s) sur {launchableIds.length} lançable(s)
            </div>
            <ButtonGroup label="Actions groupées">
              <Button variant="secondary" onclick={selectAll} disabled={launchableIds.length === 0}>
                Tout sélectionner
              </Button>
              <Button variant="ghost" onclick={clearSel} disabled={selected.length === 0}>Vider</Button>
              <Button
                variant="primary"
                onclick={launch}
                disabled={selected.length === 0 || launching}
              >
                {launching ? 'Lancement…' : `Lancer les actions sélectionnées (${selected.length})`}
              </Button>
            </ButtonGroup>
          </Flex>

          <div style="height:.85rem"></div>

          <!-- À-FAIRE -->
          <DataTable
            columns={todoColumns}
            rows={todos}
            caption="Actions à faire"
            emptyLabel="Aucune action ouverte"
          />

          <div style="height:1.75rem"></div>

          <!-- FAIT -->
          <h2 style="font-size:1.15rem; margin:0 0 .6rem">Fait</h2>
          {#if done.length}
            <DataTable columns={doneColumns} rows={done} pageSize={8} emptyLabel="Rien de terminé" />
          {:else}
            <EmptyState title="Rien de terminé pour l'instant" message="Les tâches livrées apparaîtront ici." />
          {/if}
        {:else}
          <!-- Focus décision -->
          {#if decisions.length === 0}
            <EmptyState
              title="Aucune décision en attente"
              message="Rien à trancher pour le moment — revenez à l'onglet Suivi."
            />
          {:else}
            <p style="opacity:.7; margin:0 0 1rem">
              Les décisions à trancher, formulées en clair. La décision se règle dans track (cette vue est en
              lecture).
            </p>
            <Flex direction="column" gap={4}>
              {#each decisions as d (d.id)}
                <Card>
                  <div style="padding:1.25rem 1.5rem">
                    <Badge tone="info">Décision</Badge>
                    <h3 style="margin:.5rem 0 .3rem; font-size:1.05rem">{d.question}</h3>
                    <p style="margin:0; opacity:.72">Concerne : {d.concerns}</p>
                    <div style="margin-top:.6rem; opacity:.85">{d.action} — {d.actor}</div>
                  </div>
                </Card>
              {/each}
            </Flex>
          {/if}
        {/if}

        <div style="height:1.5rem"></div>
        <div style="opacity:.45; font-size:.75em">
          Généré le {focus.ok ? focus.generatedAt : ''} · source : track (système de référence, lecture seule)
        </div>
      </div>
    </Container>
  {/snippet}
</AppShell>
