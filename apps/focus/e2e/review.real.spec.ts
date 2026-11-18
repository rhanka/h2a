import { expect, test } from '@playwright/test';
import { RECIPIENT, readCommentRequests } from './real-backend.mjs';

// Same acceptance as review.spec.ts, against the REAL backend routes: 3 threads on
// 3 anchors, a reply, one thread sent to the agent (signed h2a send deposited in the
// recipient's inbox) and the agent's answer shown live through the SSE stream,
// resolve, reopen, reload with the state read back from the backend store.
const world = JSON.parse(process.env.FOCUS_REVIEW_REAL_WORLD ?? '{}') as { root: string };

test('artifact review acceptance against the real backend', async ({ page, request }) => {
  const artifactId = `e2e-real-${Date.now()}`;
  const api = `/api/artifacts/${artifactId}`;

  // The real routes answer (not the 404 that selects the in-page fake).
  const probe = await request.get(`${api}/comments`);
  expect(probe.status()).toBe(200);
  expect(probe.headers()['x-comments-store']).toBe('memory');
  expect(await probe.json()).toEqual({ threads: [] });

  // The live SSE stream keeps a request open (no 'networkidle'): the stream opening is
  // the hydration signal, and it proves the client selected the real backend.
  const streamOpened = () => page.waitForResponse((r) => r.url().endsWith(`${api}/stream`) && r.status() === 200);
  let stream = streamOpened();
  await page.goto(`/artifact/${artifactId}`);
  await stream;
  const toggle = page.getByTestId('review-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });

  const createComposer = page.getByTestId('create-composer');
  const panelThreads = page.getByTestId('comment-thread');

  async function createOnBlock(anchorId: string, body: string, sendToAgent = false) {
    await page.locator(`[data-anchor-id="${anchorId}"]`).click();
    await expect(createComposer).toBeVisible();
    await createComposer.locator('#review-composer-body').fill(body);
    if (sendToAgent) await createComposer.getByTestId('send-to-agent').check();
    const posted = page.waitForResponse((r) => r.url().endsWith(`${api}/comments`) && r.request().method() === 'POST');
    await createComposer.getByTestId('composer-submit').click();
    const response = await posted;
    expect(response.status(), await response.text()).toBe(201);
    await expect(createComposer).toBeHidden();
    return response;
  }

  await createOnBlock('a-intro', 'Premier fil — ancrage élément intro.');
  await expect(panelThreads).toHaveCount(1);
  const sent = await createOnBlock('a-scope', 'Deuxième fil — question pour l’agent.', true);
  expect(sent.headers()['x-agent-delivery']).toBe('delivered');
  expect(sent.headers()['x-agent-target']).toBe(RECIPIENT);
  const sentComment = (await sent.json()) as { id: string; threadId: string };
  await expect(panelThreads).toHaveCount(2);

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

  // The recipient session got exactly one signed comment request for that thread; it
  // answers through the reply path the message carries (as a live CLI session would).
  const requests = await readCommentRequests(world.root);
  expect(requests).toHaveLength(1);
  expect(requests[0].threadId).toBe(sentComment.threadId);
  expect(requests[0].commentId).toBe(sentComment.id);
  const postReply = requests[0].reply.postReply;
  const agentReply = await request.post(postReply.url, {
    headers: { 'content-type': 'application/json' },
    data: { ...postReply.body, threadId: sentComment.threadId, body: 'Réponse de l’agent (session réelle).' }
  });
  expect(agentReply.status(), await agentReply.text()).toBe(201);
  // Live through the SSE stream, no reload.
  await expect(panelThreads.nth(1)).toContainText('Réponse de l’agent (session réelle).', { timeout: 15_000 });
  expect(await readCommentRequests(world.root), 'loop guard: the agent reply sent nothing').toHaveLength(1);

  await panelThreads.nth(0).getByTestId('thread-reply-open').click();
  await panelThreads.nth(0).locator('textarea').fill('Réponse humaine au premier fil.');
  await panelThreads.nth(0).getByTestId('composer-submit').click();
  await expect(panelThreads.nth(0)).toContainText('Réponse humaine au premier fil.');

  await panelThreads.nth(2).getByTestId('thread-resolve').click();
  await expect(panelThreads.nth(2)).toContainText('✓ Resolved');
  await expect(panelThreads.nth(2)).toContainText('Comment resolved. Reopen to reply.');
  await panelThreads.nth(2).getByTestId('thread-reopen').click();
  await expect(panelThreads.nth(2)).toContainText('● Open');

  // Reload: state read back from the backend store, and nothing was written to the fake.
  stream = streamOpened();
  await page.reload();
  await stream;
  await page.getByTestId('review-toggle').click();
  await expect(page.getByTestId('comment-thread')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByTestId('comment-thread').nth(0)).toContainText('Réponse humaine au premier fil.');
  const stored = (await (await request.get(`${api}/comments`)).json()) as { threads: unknown[][] };
  expect(stored.threads).toHaveLength(3);
  expect(stored.threads.flat()).toHaveLength(5);
  const fakeKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('focus-review:read:')));
  expect(fakeKeys).toEqual([]);
});
