<script lang="ts">
  // DS SPEC-r3 §3 — ReviewModeToggle (local L0, kit not published yet; same props).
  // DS components reused: Button + Badge. Never colour-only: count + « non lu » text.
  import { Badge, Button } from '@sentropic/design-system-svelte';

  interface Props {
    mode: 'view' | 'review';
    openCount: number;
    unreadCount?: number;
    label?: string;
    disabled?: boolean;
    class?: string;
    onModeChange?: (mode: 'view' | 'review') => void;
  }

  let {
    mode,
    openCount,
    unreadCount = 0,
    label = 'Review',
    disabled = false,
    class: className = '',
    onModeChange
  }: Props = $props();

  const pressed = $derived(mode === 'review');
</script>

<Button
  variant={pressed ? 'primary' : 'secondary'}
  size="sm"
  {disabled}
  aria-pressed={pressed}
  class={className}
  data-testid="review-toggle"
  onclick={() => onModeChange?.(pressed ? 'view' : 'review')}
>
  {label} · {openCount}
  {#if unreadCount > 0}
    <Badge tone="info" size="sm" aria-label={`${unreadCount} non lu`}>{unreadCount} non lu</Badge>
  {/if}
</Button>
