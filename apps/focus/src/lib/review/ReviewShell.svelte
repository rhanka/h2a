<script lang="ts">
  // Page-level orchestration (host): toggle + layer + panel, optimistic mutations
  // with rollback + role="alert" on adapter rejection (SPEC-r3 §3).
  import type { Snippet } from 'svelte';
  import { Button } from '@sentropic/design-system-svelte';
  import type { AnchorPayload, CollaborationActor, Comment, ReviewThread, ThreadFilter } from './types';
  import { filterThreads, groupThreads, isUnread, resolveAnchor } from './anchor';
  import { createCommentsClient, ReviewApiError } from './adapter';
  import ReviewModeToggle from './ReviewModeToggle.svelte';
  import CommentLayer from './CommentLayer.svelte';
  import CommentComposer from './CommentComposer.svelte';
  import ThreadPanel from './ThreadPanel.svelte';

  interface Props {
    artifactId: string;
    artifactVersion?: string;
    currentUser: CollaborationActor;
    actors?: Record<string, CollaborationActor>;
    children?: Snippet;
  }

  let { artifactId, artifactVersion = 'v1', currentUser, actors = {}, children }: Props = $props();

  const client = createCommentsClient(artifactId, { authorId: currentUser.actorId });

  let mode = $state<'view' | 'review'>('view');
  let allThreads = $state<ReviewThread[]>([]);
  let filter = $state<ThreadFilter>('all');
  let activeThreadId = $state<string | null>(null);
  let panelOpen = $state(false);
  let pending = $state<{ sectionKey: string; anchor: AnchorPayload; label: string } | null>(null);
  let pendingError = $state('');
  let loadError = $state('');
  let status = $state('');
  let readState = $state<Record<string, string>>({});
  let layerRoot: HTMLElement | null = null;

  const readKey = `focus-review:read:${artifactId}`;
  const attached = $derived.by(() => {
    if (!layerRoot) return allThreads;
    return allThreads.filter((t) => !resolveAnchor(layerRoot as unknown as HTMLElement, t.anchor).orphan);
  });
  const orphaned = $derived.by(() => {
    if (!layerRoot) return [] as ReviewThread[];
    return allThreads.filter((t) => resolveAnchor(layerRoot as unknown as HTMLElement, t.anchor).orphan);
  });
  // Before the layer mounts, treat every thread as attached (no false orphans).
  const shownOrphaned = $derived(layerRoot ? orphaned : []);
  const shownAttached = $derived(layerRoot ? attached : allThreads);
  const visible = $derived(filterThreads(shownAttached, filter, currentUser.actorId));
  const openCount = $derived(shownAttached.filter((t) => t.state === 'open').length + shownOrphaned.filter((t) => t.state === 'open').length);
  const unreadByThread = $derived.by(() => {
    const map: Record<string, boolean> = {};
    for (const t of [...shownAttached, ...shownOrphaned]) map[t.threadId] = isUnread(t, readState[t.threadId], currentUser.actorId);
    return map;
  });
  const unreadCount = $derived(Object.values(unreadByThread).filter(Boolean).length);

  async function refresh() {
    try {
      const grouped = await client.listThreads();
      allThreads = groupThreads(grouped.flat());
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Chargement des commentaires impossible.';
    }
  }

  function markRead(threadId: string) {
    readState = { ...readState, [threadId]: new Date().toISOString() };
    try {
      localStorage.setItem(readKey, JSON.stringify(readState));
    } catch {
      /* read state is host-held best-effort (SPEC-r3 §2) */
    }
  }

  $effect(() => {
    try {
      const raw = localStorage.getItem(readKey);
      if (raw) readState = JSON.parse(raw) as Record<string, string>;
    } catch {
      readState = {};
    }
    void refresh();
    const off = client.subscribe((type) => {
      if (type === 'comment.created') status = 'Nouveau commentaire reçu.';
      if (type === 'thread.closed') status = 'Fil résolu.';
      if (type === 'thread.reopened') status = 'Fil rouvert.';
      void refresh();
    });
    // Capture the layer root for orphan resolution once mounted.
    const t = setTimeout(() => {
      layerRoot = document.querySelector('[data-review-root]') as HTMLElement | null;
      void refresh();
    }, 0);
    return () => {
      off();
      clearTimeout(t);
    };
  });

  function onModeChange(next: 'view' | 'review') {
    if (mode === 'review' && next === 'view' && pending) {
      const ok = window.confirm('Un brouillon de commentaire est en cours. Quitter le mode revue ?');
      if (!ok) return;
      pending = null;
    }
    mode = next;
    if (next === 'review') panelOpen = true;
  }

  function selectThread(threadId: string) {
    activeThreadId = threadId;
    panelOpen = true;
    if (mode !== 'review') mode = 'review';
    markRead(threadId);
    status = 'Fil ouvert.';
  }

  async function submitCreate(body: string, sendToAgent: boolean) {
    if (!pending) return;
    if (pending.sectionKey.length > 2048) {
      pendingError = "L'ancre dépasse 2048 caractères. Réduisez la sélection.";
      return;
    }
    pendingError = '';
    const before = allThreads;
    try {
      const created: Comment = await client.create({ sectionKey: pending.sectionKey, body, sendToAgent });
      pending = null;
      await refresh();
      selectThread(created.threadId);
      status = sendToAgent ? "Commentaire créé et envoyé à l'agent." : 'Commentaire créé.';
    } catch (e) {
      if (e instanceof ReviewApiError && e.saved) {
        // Stored but not delivered (agent target, h2a): show it once, never retry.
        pending = null;
        await refresh();
        if (e.comment) selectThread(e.comment.threadId);
        loadError = e.message;
        return;
      }
      allThreads = before;
      pendingError = e instanceof Error ? e.message : 'Création impossible.';
    }
  }

  async function reply(threadId: string, body: string, sendToAgent: boolean) {
    const before = allThreads;
    try {
      await client.create({ sectionKey: '', body, threadId, sendToAgent });
      await refresh();
      markRead(threadId);
      status = sendToAgent ? "Réponse envoyée à l'agent." : 'Réponse ajoutée.';
    } catch (e) {
      if (e instanceof ReviewApiError && e.saved) {
        await refresh();
        markRead(threadId);
        loadError = e.message;
        return;
      }
      allThreads = before;
      loadError = e instanceof Error ? e.message : 'Réponse impossible.';
    }
  }

  async function resolve(threadId: string) {
    const before = allThreads;
    try {
      await client.closeThread(threadId);
      await refresh();
      status = 'Fil résolu.';
    } catch (e) {
      allThreads = before;
      loadError = e instanceof Error ? e.message : 'Résolution impossible.';
    }
  }

  async function reopen(threadId: string) {
    const before = allThreads;
    try {
      await client.reopenThread(threadId);
      await refresh();
      status = 'Fil rouvert.';
    } catch (e) {
      allThreads = before;
      loadError = e instanceof Error ? e.message : 'Réouverture impossible.';
    }
  }
</script>

<div class="st-review-shell" data-testid="review-shell">
  <div class="st-review-shell__bar">
    <ReviewModeToggle {mode} {openCount} {unreadCount} onModeChange={onModeChange} />
    {#if mode === 'review'}
      <Button variant="ghost" size="sm" aria-expanded={panelOpen} data-testid="panel-toggle" onclick={() => (panelOpen = !panelOpen)}>
        {panelOpen ? 'Masquer les commentaires' : 'Afficher les commentaires'}
      </Button>
    {/if}
    <span aria-live="polite" class="st-review-shell__status">{status}</span>
  </div>

  {#if loadError}
    <p role="alert" class="st-review-shell__alert">{loadError}</p>
  {/if}

  {#if pending}
    <div class="st-review-shell__composer" data-testid="create-composer">
      <p class="st-review-shell__anchor">Ancre : « {pending.label} »</p>
      {#if pendingError}<p role="alert" class="st-review-shell__alert">{pendingError}</p>{/if}
      <CommentComposer
        author={currentUser}
        submitLabel="Créer le fil"
        onSubmit={submitCreate}
        onCancel={() => {
          pending = null;
          pendingError = '';
        }}
      />
    </div>
  {/if}

  <div class="st-review-shell__layout" class:has-panel={panelOpen && mode === 'review'}>
    <div class="st-review-shell__main">
      <CommentLayer
        {mode}
        threads={shownAttached}
        orphanIds={shownOrphaned.map((t) => t.threadId)}
        {activeThreadId}
        {unreadByThread}
        artifactVersion={artifactVersion}
        onCreateRequest={(req) => {
          pending = req;
          pendingError = req.sectionKey.length > 2048 ? "L'ancre dépasse 2048 caractères. Réduisez la sélection." : '';
        }}
        onSelect={selectThread}
      >
        {@render children?.()}
      </CommentLayer>
    </div>
    {#if panelOpen && mode === 'review'}
      <aside class="st-review-shell__panel" data-testid="review-panel-wrap">
        <ThreadPanel
          threads={visible}
          orphaned={shownOrphaned}
          {currentUser}
          {actors}
          {activeThreadId}
          {filter}
          {unreadByThread}
          onSelect={selectThread}
          onFilterChange={(f) => (filter = f)}
          onReply={reply}
          onResolve={resolve}
          onReopen={reopen}
        />
      </aside>
    {/if}
  </div>
</div>

<style>
  .st-review-shell {
    display: grid;
    gap: 0.75rem;
  }
  .st-review-shell__bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .st-review-shell__status {
    font-size: 0.85rem;
  }
  .st-review-shell__alert {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--st-color-border-strong, #8a919c);
    border-radius: 0.375rem;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .st-review-shell__composer {
    border: 1px solid var(--st-color-border, #c9ced6);
    border-radius: 0.5rem;
    padding: 0.75rem;
    display: grid;
    gap: 0.5rem;
    background: var(--st-color-surface-raised, #fff);
  }
  .st-review-shell__anchor {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .st-review-shell__layout {
    display: grid;
    gap: 1rem;
    align-items: start;
  }
  .st-review-shell__layout.has-panel {
    grid-template-columns: minmax(0, 1fr) 24rem;
  }
  .st-review-shell__panel {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow: auto;
  }
  /* Phone: panel becomes a bottom sheet (SPEC-r3 §3, <48rem). */
  @media (max-width: 48rem) {
    .st-review-shell__layout.has-panel {
      grid-template-columns: minmax(0, 1fr);
    }
    .st-review-shell__panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      top: auto;
      max-height: 62vh;
      background: var(--st-color-surface-raised, #fff);
      border-top: 2px solid var(--st-color-border-strong, #8a919c);
      padding: 0.75rem;
      z-index: 20;
    }
  }
</style>
