<script lang="ts">
  // DS SPEC-r3 §3 — CommentThread (local L0). Pill Open / « Resolved » with icon + text.
  import { Badge, Button } from '@sentropic/design-system-svelte';
  import type { CollaborationActor, ReviewThread } from './types';
  import CommentComposer from './CommentComposer.svelte';

  interface Props {
    thread: ReviewThread;
    currentUser: CollaborationActor;
    actors?: Record<string, CollaborationActor>;
    active?: boolean;
    onReply?: (threadId: string, body: string, sendToAgent: boolean) => void;
    onResolve?: (threadId: string) => void;
    onReopen?: (threadId: string) => void;
    onSelect?: (threadId: string) => void;
  }

  let { thread, currentUser, actors = {}, active = false, onReply, onResolve, onReopen, onSelect }: Props = $props();

  let replying = $state(false);
  const resolved = $derived(thread.state === 'closed');

  function actorFor(id: string): CollaborationActor {
    return (
      actors[id] ?? {
        actorId: id,
        kind: id === currentUser.actorId ? currentUser.kind : 'human',
        displayLabel: id,
        color: '#5b6472'
      }
    );
  }

  function initials(label: string): string {
    return label
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
</script>

<article
  class="st-review-thread"
  class:is-active={active}
  data-testid="comment-thread"
  data-thread-id={thread.threadId}
  aria-label={`Fil sur « ${thread.anchorLabel.slice(0, 60)} »`}
>
  <button type="button" class="st-review-thread__head" onclick={() => onSelect?.(thread.threadId)}>
    <span class="st-review-thread__quote">« {thread.anchorLabel} »</span>
    {#if resolved}
      <Badge tone="success" size="sm">✓ Resolved</Badge>
    {:else}
      <Badge tone="info" size="sm">● Open</Badge>
    {/if}
  </button>

  <ol class="st-review-thread__list">
    {#each thread.comments as comment (comment.id)}
      {@const actor = actorFor(comment.author.id)}
      <li class="st-review-thread__comment" data-testid="thread-comment">
        <span class="st-review-thread__avatar" style="--avatar-bg: {actor.color}" aria-hidden="true">{initials(actor.displayLabel)}</span>
        <div>
          <p class="st-review-thread__meta">
            <strong>{actor.displayLabel}</strong>
            {#if actor.kind !== 'human'}<Badge tone="neutral" size="sm">{actor.kind}</Badge>{/if}
            <time datetime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
            {#if comment.updatedAt && comment.updatedAt !== comment.createdAt}<span>(modifié)</span>{/if}
            {#if comment.provenance?.runId}<span>run {comment.provenance.runId}</span>{/if}
          </p>
          <p class="st-review-thread__body">{comment.body}</p>
        </div>
      </li>
    {/each}
  </ol>

  {#if resolved}
    <p class="st-review-thread__resolved-note">Comment resolved. Reopen to reply.</p>
    <div class="st-review-thread__actions">
      <Button variant="secondary" size="sm" data-testid="thread-reopen" onclick={() => onReopen?.(thread.threadId)}>Rouvrir</Button>
    </div>
  {:else}
    <div class="st-review-thread__actions">
      {#if !replying}
        <Button variant="secondary" size="sm" data-testid="thread-reply-open" onclick={() => (replying = true)}>Répondre</Button>
      {/if}
      <Button variant="ghost" size="sm" data-testid="thread-resolve" onclick={() => onResolve?.(thread.threadId)}>✓ Résoudre</Button>
    </div>
    {#if replying}
      <CommentComposer
        author={currentUser}
        submitLabel="Répondre"
        onSubmit={(body, sendToAgent) => {
          onReply?.(thread.threadId, body, sendToAgent);
          replying = false;
        }}
        onCancel={() => (replying = false)}
      />
    {/if}
  {/if}
</article>

<style>
  .st-review-thread {
    border: 1px solid var(--st-color-border, #c9ced6);
    border-radius: 0.5rem;
    padding: 0.75rem;
    display: grid;
    gap: 0.6rem;
    background: var(--st-color-surface-raised, #fff);
  }
  .st-review-thread.is-active {
    border-width: 2px;
  }
  .st-review-thread__head {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: flex-start;
    background: none;
    border: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0;
  }
  .st-review-thread__head:focus-visible {
    outline: 2px solid var(--st-semantic-border-interactive, var(--st-color-border-interactive, #005fcc));
    outline-offset: 2px;
  }
  .st-review-thread__quote {
    font-size: 0.85rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .st-review-thread__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .st-review-thread__comment {
    display: flex;
    gap: 0.5rem;
  }
  .st-review-thread__avatar {
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 999px;
    background: var(--avatar-bg, #5b6472);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .st-review-thread__meta {
    margin: 0;
    font-size: 0.78rem;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .st-review-thread__body {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .st-review-thread__resolved-note {
    margin: 0;
    font-size: 0.85rem;
    font-style: italic;
  }
  .st-review-thread__actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
</style>
