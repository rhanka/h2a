<script lang="ts">
  // DS SPEC-r3 §3 — CommentLayer (local L0). Owns picking / highlights / pins.
  // Text via CSS.highlights (fallback: pin only); the kit never mutates artifact DOM.
  import type { Snippet } from 'svelte';
  import type { AnchorPayload, ReviewThread } from './types';
  import { createAnchorFromElement, createAnchorFromSelection, encodeAnchor, layoutPins, resolveAnchor } from './anchor';
  import CommentPin from './CommentPin.svelte';

  interface Props {
    mode: 'view' | 'review';
    threads: ReviewThread[];
    orphanIds?: string[];
    activeThreadId?: string | null;
    unreadByThread?: Record<string, boolean>;
    artifactVersion: string;
    onCreateRequest?: (req: { sectionKey: string; anchor: AnchorPayload; label: string }) => void;
    onSelect?: (threadId: string) => void;
    children?: Snippet;
  }

  let {
    mode,
    threads,
    orphanIds = [],
    activeThreadId = null,
    unreadByThread = {},
    artifactVersion,
    onCreateRequest,
    onSelect,
    children
  }: Props = $props();

  let rootEl: HTMLElement | undefined = $state();
  let pins = $state<{ threadId: string; index: number; top: number; left: number }[]>([]);
  let floating = $state<{ x: number; y: number; sectionKey: string; anchor: AnchorPayload; label: string } | null>(null);
  const orphanSet = $derived(new Set(orphanIds));

  function computePins() {
    if (!rootEl || mode !== 'review') {
      pins = [];
      return;
    }
    const containerRect = rootEl.getBoundingClientRect();
    const raw: { threadId: string; index: number; top: number; left: number }[] = [];
    const visible = threads.filter((t) => !orphanSet.has(t.threadId));
    visible.forEach((thread, index) => {
      if (!thread.anchor || !rootEl) return;
      const resolved = resolveAnchor(rootEl, thread.anchor);
      if (resolved.orphan) return;
      const rect = resolved.range ? resolved.range.getBoundingClientRect() : resolved.el?.getBoundingClientRect();
      if (!rect) return;
      raw.push({ threadId: thread.threadId, index, top: rect.top - containerRect.top, left: rect.right - containerRect.left });
    });
    const laid = layoutPins(raw.map((p) => ({ ...p })));
    pins = laid.map((p) => ({ threadId: p.threadId, index: p.index, top: p.top, left: p.left }));
    // Highlights (progressive enhancement; aria-hidden by construction).
    try {
      const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
      const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
      if (hl && HighlightCtor && rootEl) {
        const ranges: Range[] = [];
        for (const t of visible) {
          if (!t.anchor) continue;
          const r = resolveAnchor(rootEl, t.anchor);
          if (r.range) ranges.push(r.range);
        }
        if (ranges.length) hl.set('st-review', new HighlightCtor(...ranges));
        else hl.delete('st-review');
      }
    } catch {
      /* pin-only fallback */
    }
  }

  $effect(() => {
    // Re-run when threads/mode change.
    void threads;
    void mode;
    void orphanIds;
    const raf = requestAnimationFrame(computePins);
    return () => cancelAnimationFrame(raf);
  });

  $effect(() => {
    if (!rootEl) return;
    const onResize = () => computePins();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(rootEl);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  });

  function trySelectionAnchor() {
    if (!rootEl || mode !== 'review') return;
    try {
      const anchor = createAnchorFromSelection(rootEl, artifactVersion);
      if (!anchor) {
        floating = null;
        return;
      }
      const sel = window.getSelection();
      const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      floating = {
        x: rect ? rect.right : 0,
        y: rect ? rect.bottom : 0,
        sectionKey: encodeAnchor(anchor),
        anchor,
        label: anchor.t === 'text' ? anchor.q.exact.slice(0, 80) : 'Élément'
      };
    } catch {
      floating = null;
    }
  }

  function onMouseUp() {
    // 150 ms settle (SPEC-r3 §3) before offering the floating action.
    setTimeout(trySelectionAnchor, 150);
  }

  function onClick(e: MouseEvent) {
    if (mode !== 'review' || !rootEl) return;
    const target = e.target as Element;
    if (target.closest('a, button, [data-review-passthrough], .st-review-layer__pins, .st-review-layer__floating')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const block =
      target.closest('[data-commentable]') ??
      target.closest('p, h1, h2, h3, h4, h5, h6, li, figure, table, blockquote, pre, [data-anchor-id]');
    if (!block || !rootEl.contains(block)) return;
    try {
      const anchor = createAnchorFromElement(block, rootEl, artifactVersion);
      onCreateRequest?.({
        sectionKey: encodeAnchor(anchor),
        anchor,
        label: anchor.t === 'element' && anchor.aid ? `Élément ${anchor.aid}` : 'Élément'
      });
    } catch {
      /* over-cap anchors fail at compose time in the shell */
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (mode !== 'review') return;
    if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      e.preventDefault();
      if (!rootEl) return;
      try {
        const anchor = createAnchorFromSelection(rootEl, artifactVersion);
        if (anchor) onCreateRequest?.({ sectionKey: encodeAnchor(anchor), anchor, label: anchor.t === 'text' ? anchor.q.exact.slice(0, 80) : 'Élément' });
      } catch {
        /* surfaced by the shell composer */
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={rootEl}
  class="st-review-layer"
  data-testid="comment-layer"
  data-review-root
  role="document"
  aria-describedby="review-layer-status"
  onclick={onClick}
  onmouseup={onMouseUp}
>
  <p id="review-layer-status" class="sr-only">
    {mode === 'review' ? 'Mode revue actif. Sélectionnez du texte ou cliquez un bloc pour commenter.' : 'Mode lecture.'}
  </p>
  {@render children?.()}

  {#if mode === 'review'}
    <div class="st-review-layer__pins" aria-label="Épingles de commentaires">
      {#each pins as pin (pin.threadId)}
        {@const thread = threads.find((t) => t.threadId === pin.threadId)}
        {#if thread}
          <span class="st-review-layer__pin" style="top: {pin.top}px; left: {pin.left}px;">
            <CommentPin
              index={pin.index}
              count={thread.comments.length}
              unread={!!unreadByThread[thread.threadId]}
              resolved={thread.state === 'closed'}
              active={activeThreadId === thread.threadId}
              label={thread.anchorLabel}
              onActivate={() => onSelect?.(thread.threadId)}
            />
          </span>
        {/if}
      {/each}
    </div>
    {#if floating}
      <button
        type="button"
        class="st-review-layer__floating"
        style="left: {floating.x}px; top: {floating.y}px;"
        data-testid="add-comment"
        onclick={() => {
          onCreateRequest?.({ sectionKey: floating!.sectionKey, anchor: floating!.anchor, label: floating!.label });
          floating = null;
          window.getSelection()?.removeAllRanges();
        }}
      >
        + Add comment
      </button>
    {/if}
  {/if}
</div>

<style>
  .st-review-layer {
    position: relative;
  }
  .st-review-layer__pin {
    position: absolute;
    transform: translate(0.25rem, -0.25rem);
    z-index: 3;
  }
  .st-review-layer__floating {
    position: fixed;
    z-index: 30;
    transform: translate(0.5rem, 0.5rem);
    padding: 0.35rem 0.6rem;
    border-radius: 0.375rem;
    border: 1px solid var(--st-color-border-strong, #8a919c);
    background: var(--st-color-surface-raised, #fff);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .st-review-layer__floating:focus-visible,
  .st-review-layer :global([data-commentable]:hover) {
    outline: 2px solid var(--st-semantic-border-interactive, var(--st-color-border-interactive, #005fcc));
    outline-offset: 2px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  ::highlight(st-review) {
    background: var(--st-color-surface-selected, #dbe7ff);
  }
</style>
