<script lang="ts">
  // DS SPEC-r3 §3 — ThreadPanel + OrphanList (local L0, merged for L0 size).
  // Filters All/Open/Resolved/Mine with counts; orphans stay replyable/resolvable.
  import { Button, EmptyState } from '@sentropic/design-system-svelte';
  import type { CollaborationActor, ReviewThread, ThreadFilter } from './types';
  import CommentThread from './CommentThread.svelte';

  interface Props {
    threads: ReviewThread[];
    orphaned: ReviewThread[];
    currentUser: CollaborationActor;
    actors?: Record<string, CollaborationActor>;
    activeThreadId?: string | null;
    filter?: ThreadFilter;
    unreadByThread?: Record<string, boolean>;
    onSelect?: (threadId: string) => void;
    onFilterChange?: (filter: ThreadFilter) => void;
    onReply?: (threadId: string, body: string, sendToAgent: boolean) => void;
    onResolve?: (threadId: string) => void;
    onReopen?: (threadId: string) => void;
  }

  let {
    threads,
    orphaned,
    currentUser,
    actors = {},
    activeThreadId = null,
    filter = 'all',
    unreadByThread = {},
    onSelect,
    onFilterChange,
    onReply,
    onResolve,
    onReopen
  }: Props = $props();

  const filters: { value: ThreadFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'mine', label: 'Mine' }
  ];

  function countFor(f: ThreadFilter): number {
    if (f === 'all') return threads.length;
    if (f === 'open') return threads.filter((t) => t.state === 'open').length;
    if (f === 'resolved') return threads.filter((t) => t.state === 'closed').length;
    return threads.filter((t) => t.comments.some((c) => c.author.id === currentUser.actorId)).length;
  }
</script>

<section class="st-review-panel" aria-label="Fils de commentaires" data-testid="thread-panel">
  <h2 class="st-review-panel__title" tabindex="-1">Commentaires</h2>

  <div class="st-review-panel__filters" role="group" aria-label="Filtrer les fils">
    {#each filters as f (f.value)}
      <Button
        variant={filter === f.value ? 'primary' : 'ghost'}
        size="sm"
        aria-pressed={filter === f.value}
        data-testid="filter-{f.value}"
        onclick={() => onFilterChange?.(f.value)}
      >
        {f.label} ({countFor(f.value)})
      </Button>
    {/each}
  </div>

  {#if orphaned.length > 0}
    <p class="st-review-panel__orphans" role="status">
      {orphaned.length} fil{orphaned.length > 1 ? 's' : ''} sans attache (No longer attached) — toujours répondables et résolvables ci-dessous.
    </p>
  {/if}

  {#if threads.length === 0 && orphaned.length === 0}
    <EmptyState title="Aucun commentaire" message="Sélectionnez du texte ou cliquez un bloc commentable pour créer le premier fil." />
  {:else}
    <div class="st-review-panel__list">
      {#each threads as thread (thread.threadId)}
        <div class:st-review-panel__unread={unreadByThread[thread.threadId]}>
          {#if unreadByThread[thread.threadId]}<p class="st-review-panel__unread-label">● Non lu</p>{/if}
          <CommentThread {thread} {currentUser} {actors} active={activeThreadId === thread.threadId} {onReply} {onResolve} {onReopen} {onSelect} />
        </div>
      {/each}
      {#each orphaned as thread (thread.threadId)}
        <div data-testid="orphan-thread">
          <p class="st-review-panel__orphan-label">Sans attache — No longer attached</p>
          <CommentThread {thread} {currentUser} {actors} active={activeThreadId === thread.threadId} {onReply} {onResolve} {onReopen} {onSelect} />
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .st-review-panel {
    display: grid;
    gap: 0.75rem;
    align-content: start;
  }
  .st-review-panel__title {
    margin: 0;
    font-size: 1rem;
  }
  .st-review-panel__title:focus-visible {
    outline: 2px solid var(--st-semantic-border-interactive, var(--st-color-border-interactive, #005fcc));
    outline-offset: 2px;
  }
  .st-review-panel__filters {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .st-review-panel__orphans,
  .st-review-panel__orphan-label,
  .st-review-panel__unread-label {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .st-review-panel__list {
    display: grid;
    gap: 0.75rem;
  }
</style>
