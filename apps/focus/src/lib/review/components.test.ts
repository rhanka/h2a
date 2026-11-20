import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ReviewModeToggle from './ReviewModeToggle.svelte';
import CommentPin from './CommentPin.svelte';
import CommentComposer from './CommentComposer.svelte';
import type { CollaborationActor } from './types';

const user: CollaborationActor = { actorId: 'owner', kind: 'human', displayLabel: 'Propriétaire', color: '#34558b' };

describe('ReviewModeToggle', () => {
  it('shows open + unread counts as text and toggles with aria-pressed', async () => {
    const onModeChange = vi.fn();
    render(ReviewModeToggle, { mode: 'view', openCount: 3, unreadCount: 2, onModeChange });
    const btn = screen.getByTestId('review-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toContain('Review · 3');
    expect(btn.textContent).toContain('2 non lu');
    await fireEvent.click(btn);
    expect(onModeChange).toHaveBeenCalledWith('review');
  });
});

describe('CommentPin', () => {
  it('never colour-only: number, check and unread are text', () => {
    render(CommentPin, { index: 1, count: 3, unread: true, resolved: true, label: 'passage ancré' });
    const pin = screen.getByTestId('comment-pin');
    expect(pin.getAttribute('aria-label')).toContain('Fil 2, 3 commentaires');
    expect(pin.getAttribute('aria-label')).toContain('non lu');
    expect(pin.getAttribute('aria-label')).toContain('résolu');
    expect(pin.textContent).toContain('✓');
  });
});

describe('CommentComposer', () => {
  it('rejects an empty body inline and submits with the agent toggle', async () => {
    const onSubmit = vi.fn();
    render(CommentComposer, { author: user, onSubmit });
    await fireEvent.click(screen.getByTestId('composer-submit'));
    expect(screen.getByRole('alert').textContent).toContain('vide');
    expect(onSubmit).not.toHaveBeenCalled();

    const area = screen.getByRole('textbox');
    await fireEvent.input(area, { target: { value: 'Bonjour agent' } });
    await fireEvent.click(screen.getByTestId('send-to-agent'));
    await fireEvent.click(screen.getByTestId('composer-submit'));
    expect(onSubmit).toHaveBeenCalledWith('Bonjour agent', true);
  });

  it('submits on Ctrl+Enter', async () => {
    const onSubmit = vi.fn();
    render(CommentComposer, { author: user, onSubmit });
    const area = screen.getByRole('textbox');
    await fireEvent.input(area, { target: { value: 'via clavier' } });
    await fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith('via clavier', false);
  });
});
