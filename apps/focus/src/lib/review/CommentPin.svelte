<script lang="ts">
  // DS SPEC-r3 §3 — CommentPin (local L0). Never colour-only: number + ✓ / « non lu » text.
  interface Props {
    index: number;
    count: number;
    unread?: boolean;
    resolved?: boolean;
    active?: boolean;
    label: string;
    variant?: 'inline' | 'gutter';
    onActivate?: () => void;
  }

  let {
    index,
    count,
    unread = false,
    resolved = false,
    active = false,
    label,
    variant = 'inline',
    onActivate
  }: Props = $props();

  const ariaLabel = $derived(
    `Fil ${index + 1}, ${count} commentaire${count > 1 ? 's' : ''}${unread ? ', non lu' : ''}${resolved ? ', résolu' : ''}, sur « ${label.slice(0, 60)} »`
  );
</script>

<button
  type="button"
  class="st-review-pin st-review-pin--{variant}"
  class:is-active={active}
  class:is-resolved={resolved}
  aria-label={ariaLabel}
  aria-current={active ? 'true' : undefined}
  data-testid="comment-pin"
  onclick={() => onActivate?.()}
>
  <span class="st-review-pin__num" aria-hidden="true">{index + 1}</span>
  {#if resolved}<span class="st-review-pin__check" aria-hidden="true">✓</span>{/if}
  {#if unread}<span class="st-review-pin__dot" aria-hidden="true">●</span><span class="sr-only">non lu</span>{/if}
  <span class="sr-only">{count} commentaire{count > 1 ? 's' : ''}</span>
</button>

<style>
  .st-review-pin {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    min-width: 1.5rem;
    min-height: 1.5rem;
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--st-color-border-strong, #8a919c);
    background: var(--st-color-surface-raised, #fff);
    color: var(--st-color-text-primary, #1c2024);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }
  .st-review-pin:focus-visible {
    outline: 2px solid var(--st-semantic-border-interactive, var(--st-color-border-interactive, #005fcc));
    outline-offset: 2px;
  }
  .st-review-pin.is-active {
    border-width: 2px;
    text-decoration: underline;
  }
  .st-review-pin.is-resolved {
    opacity: 0.72;
  }
  .st-review-pin__dot {
    font-size: 0.55rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
