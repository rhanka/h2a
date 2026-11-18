import { expect, test } from '@playwright/test';

// Acceptance (same for both lanes): create 3 threads on 3 anchors, reply,
// send one to the agent and show the reply, resolve one, reopen it,
// reload and see state persisted. Runs against the in-page fake
// (API-CONTRACT.md) until the backend lane lands.
test('artifact review acceptance', async ({ page }) => {
  const artifactId = `e2e-${Date.now()}`;
  await page.goto(`/artifact/${artifactId}`);

  // UI-1: review toggle behind the flag.
  const toggle = page.getByTestId('review-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText('Review · 0');
  await page.waitForLoadState('networkidle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(page.getByTestId('thread-panel')).toBeVisible();

  const createComposer = page.getByTestId('create-composer');
  const panelThreads = page.getByTestId('comment-thread');

  async function createOnBlock(anchorId: string, body: string, sendToAgent = false) {
    await page.locator(`[data-anchor-id="${anchorId}"]`).click();
    await expect(createComposer).toBeVisible();
    await createComposer.locator('#review-composer-body').fill(body);
    if (sendToAgent) await createComposer.getByTestId('send-to-agent').check();
    await createComposer.getByTestId('composer-submit').click();
    await expect(createComposer).toBeHidden();
  }

  // UI-2: three threads on three anchors (two element anchors…).
  await createOnBlock('a-intro', 'Premier fil — ancrage élément intro.');
  await expect(panelThreads).toHaveCount(1);
  await createOnBlock('a-scope', 'Deuxième fil — question pour l\u2019agent.', true);
  await expect(panelThreads).toHaveCount(2);

  // …and one text-selection anchor.
  await page.evaluate(() => {
    const el = document.querySelector('[data-anchor-id="a-quote"]');
    if (!el) throw new Error('a-quote missing');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByTestId('add-comment').click();
  await expect(createComposer).toBeVisible();
  await createComposer.locator('#review-composer-body').fill('Troisième fil — ancrage texte.');
  await createComposer.getByTestId('composer-submit').click();
  await expect(panelThreads).toHaveCount(3);
  await expect(page.getByTestId('comment-pin')).toHaveCount(3);

  // UI-3: live agent reply in the second thread (fake SSE bus).
  await expect(panelThreads.nth(1)).toContainText(/Réponse de l.agent \(fake\)/, { timeout: 15_000 });

  // Reply on the first thread.
  await panelThreads.nth(0).getByTestId('thread-reply-open').click();
  await panelThreads.nth(0).locator('textarea').fill('Réponse humaine au premier fil.');
  await panelThreads.nth(0).getByTestId('composer-submit').click();
  await expect(panelThreads.nth(0)).toContainText('Réponse humaine au premier fil.');

  // Resolve the third thread, then reopen it (« Resolved » wording, never colour-only).
  await panelThreads.nth(2).getByTestId('thread-resolve').click();
  await expect(panelThreads.nth(2)).toContainText('✓ Resolved');
  await expect(panelThreads.nth(2)).toContainText('Comment resolved. Reopen to reply.');
  await panelThreads.nth(2).getByTestId('thread-reopen').click();
  await expect(panelThreads.nth(2)).toContainText('● Open');

  // Reload: state persisted (fake localStorage, same shapes as the real API).
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('review-toggle').click();
  await expect(page.getByTestId('review-toggle')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(page.getByTestId('comment-thread')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByTestId('comment-thread').nth(0)).toContainText('Réponse humaine au premier fil.');
});
