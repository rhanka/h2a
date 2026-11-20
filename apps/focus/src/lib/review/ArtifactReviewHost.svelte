<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import {
    countThreadsByFilter,
    countUnreadThreads,
    groupCommentsIntoThreads,
    type CommentsAdapter,
    type ReviewComment,
    type ThreadFilter,
    type ThreadReadState
  } from '@sentropic/design-system-review-core';
  import {
    Alert,
    Badge,
    CommentLayer,
    Drawer,
    ReviewModeToggle,
    type CommentLayerCreatePayload,
    type ReviewMode
  } from '@sentropic/design-system-svelte';
  import {
    createFocusHttpCommentsAdapter,
    FocusCommentsAdapterError,
    MISSING_BINDING_LABEL,
    type AdapterStoreStatus
  } from './http-comments-adapter.js';
  import type { ArtifactReviewPageConfig } from '$lib/server/artifact-review/page-config.js';

  interface Props {
    artifactId: string;
    artifactVersion: string;
    reviewConfig: ArtifactReviewPageConfig;
    /** Optional explicit agent target (e.g. from dossier h2a target selector). */
    agentTarget?: string | null;
    /** Optional custom CommentsAdapter for tests/storybook; defaults to the Focus Web HTTP adapter. */
    adapter?: CommentsAdapter;
    /** Optional callback notified whenever host-controlled review mode changes. */
    onModeChange?: (mode: ReviewMode) => void;
    children: Snippet;
  }

  let {
    artifactId,
    artifactVersion,
    reviewConfig,
    agentTarget = null,
    adapter: providedAdapter,
    onModeChange,
    children
  }: Props = $props();

  const COMPACT_MEDIA_QUERY = '(max-width: 47.999rem)';

  let mode = $state<ReviewMode>(untrack(() => reviewConfig.initialMode));
  let comments = $state<ReviewComment[]>([]);
  let activeThreadId = $state<string | null>(null);
  let panelOpen = $state<boolean>(true);
  let panelFilter = $state<ThreadFilter>('all');
  // Host-held in-memory read state `(threadId -> ISO timestamp)` (AR-10, never persisted by h2a).
  let readState = $state<ThreadReadState>({});
  let sendToAgent = $state<boolean>(false);
  let storeStatus = $state<AdapterStoreStatus | null>(
    untrack(() =>
      reviewConfig.missingBinding
        ? { kind: 'unconfigured', durable: false, label: MISSING_BINDING_LABEL }
        : null
    )
  );
  let unavailableMessage = $state<string | null>(
    untrack(() =>
      reviewConfig.missingBinding
        ? `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.`
        : null
    )
  );
  let actionError = $state<string | null>(null);
  let deliveryNotice = $state<string | null>(null);
  let compact = $state<boolean>(false);
  let unavailableAsideEl: HTMLElement | undefined = $state();

  const target = $derived({ kind: 'artifact' as const, id: artifactId });
  const commentsUnavailable = $derived(unavailableMessage !== null);
  const threads = $derived(groupCommentsIntoThreads(comments));
  const openCount = $derived(countThreadsByFilter(threads, reviewConfig.currentUser).open);
  const unreadCount = $derived(countUnreadThreads(threads, reviewConfig.currentUser, readState));

  function getAdapter(): CommentsAdapter {
    if (providedAdapter) return providedAdapter;
    return createFocusHttpCommentsAdapter({
      artifactId,
      pollMs: reviewConfig.pollMs,
      sendToAgent: () => sendToAgent,
      agentTarget: () => agentTarget,
      onStoreStatus: (status) => {
        storeStatus = status;
        if (status.kind === 'unconfigured') {
          unavailableMessage =
            status.label && status.label.toLowerCase().includes(MISSING_BINDING_LABEL)
              ? status.label
              : `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.`;
        }
      }
    });
  }

  async function refreshComments(activeAdapter: CommentsAdapter) {
    if (!reviewConfig.enabled) return;
    if (reviewConfig.missingBinding) {
      unavailableMessage = `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL with a cluster-mesh artifact-comments endpoint.`;
      comments = [];
      return;
    }
    try {
      const next = await activeAdapter.list(reviewConfig.tenant, target);
      comments = next;
      unavailableMessage = null;
    } catch (error) {
      if (error instanceof FocusCommentsAdapterError && error.missingBinding) {
        unavailableMessage = error.message;
        comments = [];
        return;
      }
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  function syncUrlReviewParam(next: ReviewMode) {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (next === 'review') url.searchParams.set('review', '1');
      else url.searchParams.delete('review');
      window.history.replaceState(window.history.state, '', url.toString());
    } catch {
      // Ignore history restrictions in non-standard browsing contexts.
    }
  }

  function handleModeChange(next: ReviewMode) {
    mode = next;
    if (next === 'review') {
      panelOpen = true;
    }
    syncUrlReviewParam(next);
    onModeChange?.(next);
  }

  function upsertComment(saved: ReviewComment) {
    const idx = comments.findIndex((row) => row.id === saved.id);
    if (idx >= 0) {
      comments = comments.map((row) => (row.id === saved.id ? saved : row));
    } else {
      comments = [...comments, saved];
    }
  }

  function markThreadRead(threadId: string) {
    readState = { ...readState, [threadId]: new Date().toISOString() };
  }

  async function handleCreate(payload: CommentLayerCreatePayload) {
    actionError = null;
    deliveryNotice = null;
    if (commentsUnavailable) {
      const msg = unavailableMessage ?? MISSING_BINDING_LABEL;
      actionError = msg;
      throw new Error(msg);
    }
    const activeAdapter = getAdapter();
    try {
      const created = await activeAdapter.create({
        tenant: reviewConfig.tenant,
        target: {
          kind: 'artifact',
          id: artifactId,
          sectionKey: payload.sectionKey
        },
        body: payload.body
      });
      upsertComment(created);
      activeThreadId = created.threadId;
      panelOpen = true;
      markThreadRead(created.threadId);
    } catch (error) {
      if (error instanceof FocusCommentsAdapterError && error.saved && error.comment) {
        // Saved in cluster-mesh, not delivered to agent: keep saved comment and surface warning (never duplicate).
        upsertComment(error.comment);
        activeThreadId = error.comment.threadId;
        panelOpen = true;
        markThreadRead(error.comment.threadId);
        deliveryNotice = `Saved, not sent: ${error.message}`;
        return;
      }
      if (error instanceof FocusCommentsAdapterError && error.missingBinding) {
        unavailableMessage = error.message;
      }
      const message = error instanceof Error ? error.message : String(error);
      actionError = message;
      throw error;
    }
  }

  async function handleReply(threadId: string, body: string) {
    actionError = null;
    deliveryNotice = null;
    if (commentsUnavailable) {
      const msg = unavailableMessage ?? MISSING_BINDING_LABEL;
      actionError = msg;
      throw new Error(msg);
    }
    const activeAdapter = getAdapter();
    // DS r6 §1.4: propagate the thread's anchor `sectionKey` (first chronological row carrying one).
    const thread = threads.find((t) => t.threadId === threadId);
    const sectionKey = thread?.sectionKey;
    try {
      const created = await activeAdapter.reply({
        tenant: reviewConfig.tenant,
        target: {
          kind: 'artifact',
          id: artifactId,
          ...(sectionKey ? { sectionKey } : {})
        },
        threadId,
        body
      });
      upsertComment(created);
      markThreadRead(threadId);
    } catch (error) {
      if (error instanceof FocusCommentsAdapterError && error.saved && error.comment) {
        upsertComment(error.comment);
        markThreadRead(threadId);
        deliveryNotice = `Saved, not sent: ${error.message}`;
        return;
      }
      if (error instanceof FocusCommentsAdapterError && error.missingBinding) {
        unavailableMessage = error.message;
      }
      const message = error instanceof Error ? error.message : String(error);
      actionError = message;
      throw error;
    }
  }

  async function handleSetState(threadId: string, state: 'open' | 'closed') {
    actionError = null;
    if (commentsUnavailable) {
      actionError = unavailableMessage ?? MISSING_BINDING_LABEL;
      return;
    }
    const previous = comments;
    // Optimistic update, rolled back with role="alert" on adapter rejection (SPEC-r6 §3).
    comments = comments.map((row) => (row.threadId === threadId ? { ...row, state } : row));
    const activeAdapter = getAdapter();
    try {
      await activeAdapter.setState(reviewConfig.tenant, threadId, state);
      await refreshComments(activeAdapter);
    } catch (error) {
      comments = previous;
      if (error instanceof FocusCommentsAdapterError && error.missingBinding) {
        unavailableMessage = error.message;
      }
      actionError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async function handleEditComment(commentId: string, body: string) {
    actionError = null;
    if (commentsUnavailable) {
      actionError = unavailableMessage ?? MISSING_BINDING_LABEL;
      return;
    }
    const previous = comments;
    comments = comments.map((row) => (row.id === commentId ? { ...row, body } : row));
    const activeAdapter = getAdapter();
    try {
      const updated = await activeAdapter.edit(reviewConfig.tenant, commentId, body);
      upsertComment(updated);
    } catch (error) {
      comments = previous;
      actionError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async function handleDeleteComment(commentId: string) {
    actionError = null;
    if (commentsUnavailable) {
      actionError = unavailableMessage ?? MISSING_BINDING_LABEL;
      return;
    }
    const previous = comments;
    comments = comments.filter((row) => row.id !== commentId);
    const activeAdapter = getAdapter();
    try {
      await activeAdapter.remove(reviewConfig.tenant, commentId);
      await refreshComments(activeAdapter);
    } catch (error) {
      comments = previous;
      actionError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  // Track <48rem viewport for the unavailable-state panel container (matching DS ThreadPanel breakpoint).
  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(COMPACT_MEDIA_QUERY);
    compact = mql.matches;
    const onChange = (event: MediaQueryListEvent) => {
      compact = event.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  // Element-scoped Escape on the unavailable <aside> at >=48rem (never pre-empts inner layers).
  $effect(() => {
    const node = unavailableAsideEl;
    if (!node || compact || mode !== 'review' || !panelOpen) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      panelOpen = false;
    };
    node.addEventListener('keydown', onKeydown);
    return () => node.removeEventListener('keydown', onKeydown);
  });

  onMount(() => {
    if (!reviewConfig.enabled) return;
    const activeAdapter = getAdapter();
    void refreshComments(activeAdapter);
    if (reviewConfig.missingBinding) return;
    const unsubscribe = activeAdapter.subscribe?.(reviewConfig.tenant, target, (next) => {
      comments = next;
      unavailableMessage = null;
    });
    return () => {
      unsubscribe?.();
    };
  });

  const isC2bStub = $derived(
    !commentsUnavailable && (storeStatus?.kind === 'memory' || (!storeStatus && reviewConfig.storeMode === 'c2b-stub'))
  );
</script>

{#if !reviewConfig.enabled}
  {@render children()}
{:else}
  <div
    class="review-host"
    class:review-host--review={mode === 'review'}
    data-artifact-review-enabled="true"
    data-artifact-id={artifactId}
    data-artifact-version={artifactVersion}
  >
    <div class="review-bar" role="region" aria-label="Artifact review controls">
      <div class="review-bar__left">
        <ReviewModeToggle
          {mode}
          {openCount}
          {unreadCount}
          label="Review"
          onModeChange={handleModeChange}
        />
        {#if mode === 'review'}
          {#if commentsUnavailable}
            <Badge tone="warning" size="sm">{MISSING_BINDING_LABEL}</Badge>
          {:else if isC2bStub}
            <Badge tone="neutral" size="sm">C2b stub · in-memory only</Badge>
          {:else}
            <Badge tone="success" size="sm">cluster-mesh</Badge>
          {/if}
        {/if}
      </div>

      {#if mode === 'review' && !commentsUnavailable}
        <div class="review-bar__right">
          <label class="review-bar__notify">
            <input type="checkbox" bind:checked={sendToAgent} />
            <span>Notify agent on human comments</span>
          </label>
          {#if !panelOpen}
            <button
              type="button"
              class="review-bar__reopen-panel"
              onclick={() => (panelOpen = true)}
            >
              Show comments
            </button>
          {/if}
        </div>
      {/if}
    </div>

    {#if mode === 'review' && actionError}
      <div class="review-alert" role="alert">
        <Alert tone="error" title="Comment action failed" message={actionError} />
      </div>
    {/if}

    {#if mode === 'review' && deliveryNotice}
      <div class="review-alert" role="status">
        <Alert tone="warning" title="Comment saved, agent not notified" message={deliveryNotice} />
      </div>
    {/if}

    <div class="review-stage" class:review-stage--unavailable={mode === 'review' && commentsUnavailable && panelOpen}>
      <CommentLayer
        {mode}
        {target}
        {artifactVersion}
        {comments}
        currentUser={reviewConfig.currentUser}
        {activeThreadId}
        {readState}
        panelOpen={mode === 'review' && panelOpen && !commentsUnavailable}
        {panelFilter}
        onCreate={handleCreate}
        onSelect={(threadId) => {
          activeThreadId = threadId;
          if (threadId !== null) panelOpen = true;
        }}
        onMarkRead={markThreadRead}
        onModeChange={handleModeChange}
        onPanelFilterChange={(next) => (panelFilter = next)}
        onPanelClose={() => (panelOpen = false)}
        onReply={handleReply}
        onResolve={(threadId) => handleSetState(threadId, 'closed')}
        onReopen={(threadId) => handleSetState(threadId, 'open')}
        onEditComment={handleEditComment}
        onDeleteComment={handleDeleteComment}
      >
        <div data-review-root={artifactId} data-artifact-version={artifactVersion}>
          {@render children()}
        </div>
      </CommentLayer>

      {#if mode === 'review' && commentsUnavailable && panelOpen}
        {#if compact}
          <Drawer
            open={true}
            side="bottom"
            title="Comments"
            onclose={() => (panelOpen = false)}
          >
            <div class="review-unavailable__body" role="alert">
              <Alert
                tone="warning"
                title={MISSING_BINDING_LABEL}
                message={unavailableMessage ?? `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL.`}
              />
            </div>
          </Drawer>
        {:else}
          <aside
            bind:this={unavailableAsideEl}
            class="review-unavailable-panel"
            aria-label="Comments"
            tabindex="-1"
          >
            <header class="review-unavailable-panel__header">
              <h2>Comments</h2>
            </header>
            <div class="review-unavailable__body" role="alert">
              <Alert
                tone="warning"
                title={MISSING_BINDING_LABEL}
                message={unavailableMessage ?? `${MISSING_BINDING_LABEL}: configure FOCUS_COMMENTS_URL.`}
              />
            </div>
          </aside>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .review-host {
    display: block;
    min-width: 0;
  }

  .review-bar {
    align-items: center;
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    display: flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
    justify-content: space-between;
    margin-bottom: var(--st-spacing-4, 1rem);
    padding: var(--st-spacing-2, 0.5rem) 0;
  }

  .review-bar__left,
  .review-bar__right {
    align-items: center;
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--st-spacing-2, 0.5rem);
  }

  .review-bar__notify {
    align-items: center;
    color: var(--st-semantic-text-secondary, #475569);
    display: inline-flex;
    font-size: 0.8125rem;
    gap: 0.375rem;
  }

  .review-bar__reopen-panel {
    background: transparent;
    border: 1px solid var(--st-semantic-border-subtle, #cbd5e1);
    border-radius: var(--st-radius-sm, 0.375rem);
    color: var(--st-semantic-text-primary, inherit);
    cursor: pointer;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
  }

  .review-alert {
    margin-bottom: var(--st-spacing-3, 0.75rem);
  }

  /* At >=48rem, place the non-modal <aside> beside the artifact with room for the margin gutter
     so artifact pins stay clickable while the panel is open (SPEC-r6 §3, H1 acceptance 5). */
  @media (min-width: 48rem) {
    .review-host--review :global(.st-review-layer) {
      align-items: start;
      display: grid;
      gap: 3rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .review-host--review :global(.st-review-layer__panel) {
      position: sticky;
      top: var(--st-spacing-4, 1rem);
    }

    .review-stage--unavailable {
      align-items: start;
      display: grid;
      gap: 2rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }

  .review-unavailable-panel {
    background: var(
      --st-component-review-panel-background,
      var(--st-semantic-surface-raised, #ffffff)
    );
    border: 1px solid
      var(--st-component-review-panel-border, var(--st-semantic-border-subtle, #e2e8f0));
    border-radius: var(--st-component-review-panel-radius, var(--st-radius-md, 0.5rem));
    display: grid;
    gap: var(--st-spacing-3, 0.75rem);
    max-width: 26rem;
    min-width: 22rem;
    padding: var(--st-spacing-4, 1rem);
    position: sticky;
    top: var(--st-spacing-4, 1rem);
    width: 24rem;
  }

  .review-unavailable-panel__header {
    border-bottom: 1px solid var(--st-semantic-border-subtle, #e2e8f0);
    padding-bottom: var(--st-spacing-2, 0.5rem);
  }

  .review-unavailable-panel__header h2 {
    font-size: 1rem;
    font-weight: 700;
    margin: 0;
  }

  .review-unavailable__body {
    min-width: 0;
  }
</style>
