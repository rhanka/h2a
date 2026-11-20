<script lang="ts">
  // DS SPEC-r3 §3 — CommentComposer (local L0). Cmd/Ctrl+Enter submits, Esc cancels.
  // « envoyer à l'agent » toggle lives here (UI-3) and on thread replies.
  import { Button } from '@sentropic/design-system-svelte';
  import type { CollaborationActor } from './types';

  interface Props {
    author: CollaborationActor;
    placeholder?: string;
    submitLabel?: string;
    initialBody?: string;
    autofocus?: boolean;
    showSendToAgent?: boolean;
    onSubmit?: (body: string, sendToAgent: boolean) => void;
    onCancel?: () => void;
  }

  let {
    author,
    placeholder = 'Écrire un commentaire…',
    submitLabel = 'Commenter',
    initialBody = '',
    autofocus = true,
    showSendToAgent = true,
    onSubmit,
    onCancel
  }: Props = $props();

  let body = $state(initialBody);
  let sendToAgent = $state(false);
  let error = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    if (autofocus) textareaEl?.focus();
  });

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) {
      error = 'Le commentaire ne peut pas être vide.';
      textareaEl?.focus();
      return;
    }
    error = '';
    onSubmit?.(trimmed, sendToAgent);
    body = '';
    sendToAgent = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel?.();
    }
  }
</script>

<div class="st-review-composer" data-testid="comment-composer">
  <label class="st-review-composer__label" for="review-composer-body">
    Commentaire de {author.displayLabel}
  </label>
  <textarea
    id="review-composer-body"
    bind:this={textareaEl}
    bind:value={body}
    {placeholder}
    rows="3"
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? 'review-composer-error' : undefined}
    onkeydown={onKeydown}
  ></textarea>
  {#if error}
    <p id="review-composer-error" role="alert" class="st-review-composer__error">{error}</p>
  {/if}
  <div class="st-review-composer__row">
    {#if showSendToAgent}
      <label class="st-review-composer__agent">
        <input type="checkbox" bind:checked={sendToAgent} data-testid="send-to-agent" />
        Envoyer à l'agent
      </label>
    {/if}
    <span class="st-review-composer__spacer"></span>
    <Button variant="ghost" size="sm" onclick={() => onCancel?.()}>Annuler</Button>
    <Button variant="primary" size="sm" data-testid="composer-submit" onclick={submit}>{submitLabel}</Button>
  </div>
  <p class="st-review-composer__hint">Ctrl+Entrée pour envoyer · Échap pour annuler</p>
</div>

<style>
  .st-review-composer {
    display: grid;
    gap: 0.5rem;
  }
  .st-review-composer__label {
    font-size: 0.85rem;
    font-weight: 600;
  }
  textarea {
    width: 100%;
    font: inherit;
    padding: 0.5rem;
    border: 1px solid var(--st-color-border-strong, #8a919c);
    border-radius: 0.375rem;
    background: var(--st-color-surface-raised, #fff);
    color: inherit;
  }
  textarea:focus-visible {
    outline: 2px solid var(--st-semantic-border-interactive, var(--st-color-border-interactive, #005fcc));
    outline-offset: 1px;
  }
  .st-review-composer__error {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .st-review-composer__row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .st-review-composer__agent {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .st-review-composer__agent input {
    width: 1.1rem;
    height: 1.1rem;
  }
  .st-review-composer__spacer {
    flex: 1;
  }
  .st-review-composer__hint {
    margin: 0;
    font-size: 0.75rem;
    opacity: 0.8;
  }
</style>
