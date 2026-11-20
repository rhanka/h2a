// Real-browser (headless Chromium Playwright) acceptance tests for Lot H1 — Focus Web Svelte wiring.
//
// Runs against the REAL packaged Focus Web server (`h2a focus serve`, `packages/h2a/focus-app`)
// and verifies every single H1 acceptance line from `docs/specs/2026-11-17-SPEC_EVOL_local-artifact-review.md`:
//   1. Missing binding -> toggle renders, review mode opens, panel shows `comments unavailable (missing binding)`,
//      zero comment files written anywhere.
//   2. Every rendered Focus node in the fixture carries one unique `data-anchor-id` equal to its `targetRef`.
//   3. View mode changes nothing (text selection, option-card clicks, tab order untouched).
//   4. `CommentLayer` receives `target` & `artifactVersion`; agent reply with `provenance.toolCallId`
//      renders two icons (`CommentAuthorship` on `AvatarGroup`, single `role="img"`, "on behalf of"),
//      unread for owner, excluded from Mine; closing thread (`state: 'closed'`) shows "Resolved" +
//      check pin at 55% opacity; zero `'resolved'` literal in wire or UI state.
//   5. >=48rem renders non-modal `<aside>` with clickable artifact pins while open; <48rem renders
//      `Drawer side="bottom"`; `Escape` closes only the topmost active layer.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

import {
  collectFixtureTargetRefs,
  loadFocusArtifactFixture
} from '../../../../apps/focus/src/lib/review/focus-fixture.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const BIN = join(REPO_ROOT, 'packages', 'h2a', 'dist', 'bin.js');
const FIXTURE_ID = 'focus:local-review-fixture';

function listFilesRecursive(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(join(dir, entry.name), nextRel));
    else out.push(nextRel);
  }
  return out.sort();
}

function createFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'h2a-h1-browser-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.track'), { recursive: true });
  writeFileSync(join(repo, '.track', 'events.jsonl'), '', 'utf8');
  const root = join(base, 'h2a-root');
  const dirs = {
    home: join(base, 'home'),
    run: join(base, 'run'),
    config: join(base, 'config'),
    state: join(base, 'state')
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return { base, repo, root, dirs };
}

async function startFocusServe(t, f, extraEnv) {
  const child = spawn(process.execPath, [BIN, 'focus', 'serve', '--repo', f.repo, '--port', '0'], {
    cwd: f.repo,
    env: {
      PATH: process.env.PATH,
      HOME: f.dirs.home,
      XDG_RUNTIME_DIR: f.dirs.run,
      XDG_CONFIG_HOME: f.dirs.config,
      XDG_STATE_HOME: f.dirs.state,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      FOCUS_H2A_ROOT: f.root,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => void (stdout += chunk));
  child.stderr.on('data', (chunk) => void (stderr += chunk));
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  const started = Date.now();
  while (!/Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
    if (child.exitCode !== null) throw new Error(`Focus exited early (code=${child.exitCode}): ${stderr}`);
    if (Date.now() - started > 15000) throw new Error(`Focus did not bind in time: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const url = stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  return {
    url,
    async stop() {
      child.kill('SIGTERM');
      return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    }
  };
}

test('H1 Acceptance 1 & 2 (browser): missing binding opens panel with exact message and zero writes; every Focus node has unique data-anchor-id', async (t) => {
  const f = createFixture(t);
  const filesBefore = listFilesRecursive(f.base);
  const server = await startFocusServe(t, f, {
    FOCUS_ARTIFACT_REVIEW: '1',
    FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH: '1'
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`${server.url}/artifact/${encodeURIComponent(FIXTURE_ID)}`);

  // Acceptance 2: every rendered Focus node carries one unique data-anchor-id equal to its targetRef.
  const domAnchorIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-review-root] [data-anchor-id]')).map((el) =>
      el.getAttribute('data-anchor-id')
    )
  );
  const expectedRefs = collectFixtureTargetRefs(loadFocusArtifactFixture(FIXTURE_ID));
  assert.deepEqual(domAnchorIds, expectedRefs);
  assert.equal(new Set(domAnchorIds).size, domAnchorIds.length);

  // Acceptance 1: toggle renders in View mode; clicking opens Review mode and panel shows exact missing binding message.
  const toggle = page.locator('button.st-review-toggle');
  await toggle.waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  const aside = page.locator('aside[aria-label="Comments"]');
  await aside.waitFor({ state: 'visible' });
  const asideText = await aside.innerText();
  assert.match(asideText, /comments unavailable \(missing binding\)/i);

  assert.deepEqual(pageErrors, []);
  await server.stop();
  assert.deepEqual(listFilesRecursive(f.base), filesBefore, 'zero files written anywhere on missing binding');
});

test('H1 Acceptance 3, 4 & 5 (browser): View mode untouched, Review pins + 2-icon agent authorship + Resolved check pin 55% opacity, >=48rem aside / <48rem Drawer bottom / active-layer Escape', async (t) => {
  const f = createFixture(t);
  const server = await startFocusServe(t, f, {
    FOCUS_ARTIFACT_REVIEW: '1',
    FOCUS_REVIEW_OWNER_ID: 'local-owner',
    FOCUS_REVIEW_OWNER_LABEL: 'Owner'
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`${server.url}/artifact/${encodeURIComponent(FIXTURE_ID)}`);

  // --- Acceptance 3: View mode changes nothing (text selection, option-card clicks, tab order untouched). ---
  assert.equal(await page.locator('.st-review-pin').count(), 0);
  assert.equal(await page.locator('aside.st-review-panel').count(), 0);

  // Option card click selects the option cleanly in View mode.
  const firstOption = page.locator('[data-anchor-id="option:q-storage:cluster-mesh"]');
  await firstOption.click();
  await firstOption.locator('text=Sélectionnée').waitFor({ state: 'visible' });

  // Text selection works untouched in View mode.
  const selectedText = await page.evaluate(() => {
    const p = document.querySelector('[data-anchor-id="section:summary"] p');
    const textNode = p?.firstChild;
    if (!textNode) return '';
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 16);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return sel?.toString() ?? '';
  });
  assert.equal(selectedText, 'Les commentaires');

  // Tab order inside [data-review-root] has no injected review controls in View mode.
  const reviewFocusablesInRoot = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-review-root] [tabindex]:not([tabindex="-1"]), [data-review-root] button')).filter(
      (el) => el.closest('[data-review-overlay]') !== null
    ).length
  );
  assert.equal(reviewFocusablesInRoot, 0);

  // --- Enter Review mode ---
  await page.locator('button.st-review-toggle').click();
  const aside = page.locator('aside.st-review-panel');
  await aside.waitFor({ state: 'visible' });
  assert.equal(await aside.getAttribute('aria-modal'), null, '>=48rem panel must be a non-modal <aside>');

  // --- Acceptance 4: CommentLayer receives target & artifactVersion, creates anchored thread ---
  const questionBlock = page.locator('[data-anchor-id="question:q-storage"]');
  await questionBlock.click();
  const composerTextarea = page.locator('.st-review-layer__composer textarea');
  await composerTextarea.waitFor({ state: 'visible' });

  // --- Acceptance 5 (active-layer Escape): Escape closes ONLY the composer, keeping <aside> panel open ---
  await page.keyboard.press('Escape');
  await composerTextarea.waitFor({ state: 'detached' });
  assert.equal(await aside.isVisible(), true, 'Escape on composer must NOT close the outer <aside> panel');

  // Re-open composer on questionBlock and submit a real comment through CommentsAdapter -> PR #469 backend.
  await questionBlock.click();
  await composerTextarea.waitFor({ state: 'visible' });
  await composerTextarea.fill('Need confirmation on C2b cluster-mesh path.');
  await page.locator('.st-review-layer__composer button[type="submit"]').click();

  // Wait for the thread to appear in the panel and verify the pin on the artifact.
  await page.locator('.st-review-pin').first().waitFor({ state: 'visible' });

  // Verify wire state via backend API: open state, target.kind === 'artifact', anchor carries aid + artifactVersion.
  const apiBase = `${server.url}/api/artifacts/${encodeURIComponent(FIXTURE_ID)}`;
  const wireBefore = await (await fetch(`${apiBase}/comments`)).json();
  assert.equal(wireBefore.threads.length, 1);
  const rootRow = wireBefore.threads[0][0];
  assert.equal(rootRow.state, 'open');
  assert.equal(rootRow.target.kind, 'artifact');
  assert.equal(rootRow.target.id, FIXTURE_ID);
  assert.ok(rootRow.target.sectionKey.startsWith('a1:'));
  const decodedPayload = JSON.parse(
    Buffer.from(rootRow.target.sectionKey.slice(3), 'base64url').toString('utf8')
  );
  assert.equal(decodedPayload.aid, 'question:q-storage');
  assert.equal(decodedPayload.v, 'sha256:focus-fixture-v1');

  // Post an agent reply carrying mandatory `provenance.toolCallId` through the real backend.
  const agentReplyRes = await fetch(`${apiBase}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenant: 'local',
      target: { kind: 'artifact', id: FIXTURE_ID, sectionKey: rootRow.target.sectionKey },
      threadId: rootRow.threadId,
      body: 'Resolved in sha256:focus-fixture-v2 — verified against C2a.',
      provenance: { toolCallId: 'agent:claude:h1-browser:1' }
    })
  });
  assert.equal(agentReplyRes.status, 201);

  // Wait for live SSE update to render the agent reply with TWO icons (agent + sponsoring owner).
  const agentAuthorship = page.locator('.st-review-authorship[data-author-kind="agent"]');
  await agentAuthorship.waitFor({ state: 'visible', timeout: 8000 });
  const roleImg = agentAuthorship.locator('[role="img"]');
  assert.equal(await roleImg.count(), 1, 'CommentAuthorship must have one enclosing role="img"');
  assert.match(await roleImg.getAttribute('aria-label'), /agent.*on behalf of Owner/i);
  assert.equal(await agentAuthorship.locator('.st-review-authorship__vignette').count(), 2, 'two icons: agent + owner');
  assert.match(await agentAuthorship.innerText(), /on behalf of Owner/);

  // Create a second thread on `section:summary` so we can verify artifact pin clickability while <aside> is open!
  await page.locator('[data-anchor-id="section:summary"]').click();
  await composerTextarea.waitFor({ state: 'visible' });
  await composerTextarea.fill('Second thread for pin switching');
  await page.locator('.st-review-layer__composer button[type="submit"]').click();

  // Wait for 2 inline pins; click Thread 1's pin (`question:q-storage`, 2nd in document order) while
  // the non-modal <aside> is open -> panel switches from Thread 2 to Thread 1!
  await page.waitForFunction(() => document.querySelectorAll('.st-review-layer__pins button.st-review-pin').length === 2);
  assert.equal(await aside.isVisible(), true);
  await page.locator(`.st-review-layer__pins [data-pin-section-key="${rootRow.target.sectionKey}"] button.st-review-pin`).click();
  await page.locator('.st-review-panel__detail', { hasText: 'Need confirmation on C2b cluster-mesh path.' }).waitFor({ state: 'visible' });

  // Active-layer Escape inside the non-modal <aside> backs out of thread detail while keeping <aside> open.
  await page.locator('.st-review-panel__back-row button').focus();
  await page.keyboard.press('Escape');
  await page.locator('.st-review-panel__list').waitFor({ state: 'visible' });
  assert.equal(await aside.isVisible(), true);

  // Re-open Thread 1 via its artifact pin and resolve it -> wire state becomes `'closed'` (never `'resolved'`),
  // UI pill says "Resolved", and check pin renders at 55% opacity (`st-review-pin--resolved`).
  await page.locator(`.st-review-layer__pins [data-pin-section-key="${rootRow.target.sectionKey}"] button.st-review-pin`).click();
  await page.locator('.st-review-panel__detail button', { hasText: 'Resolve' }).click();
  await page.locator('.st-review-layer__pins button.st-review-pin--resolved').first().waitFor({ state: 'visible' });
  // Deselect active thread so inactive resolved pin opacity (0.55) is asserted cleanly.
  await page.locator('.st-review-panel__back-row button').click();
  await page.waitForFunction(() => {
    const pin = document.querySelector('.st-review-layer__pins button.st-review-pin--resolved:not(.st-review-pin--active)');
    return pin !== null && Math.abs(parseFloat(getComputedStyle(pin).opacity) - 0.55) < 0.02;
  });
  const cardState = await page.locator(`.st-review-panel__thread-card[data-thread-id="${rootRow.threadId}"]`).getAttribute('data-thread-state');
  assert.equal(cardState, 'closed', 'DOM thread state uses wire literal "closed"');
  const cardText = await page.locator(`.st-review-panel__thread-card[data-thread-id="${rootRow.threadId}"]`).innerText();
  assert.match(cardText, /Resolved/, 'UI displays "Resolved" label for state "closed"');

  const wireAfter = await (await fetch(`${apiBase}/comments`)).json();
  const wireStates = wireAfter.threads.flat().map((c) => c.state);
  assert.equal(wireStates.includes('resolved'), false, 'zero "resolved" literal on the wire');
  assert.ok(wireStates.includes('closed'));

  // --- Acceptance 5 (<48rem): switches to Drawer side="bottom" ---
  await page.setViewportSize({ width: 640, height: 844 });
  const bottomDrawer = page.locator('.st-drawer--bottom[role="dialog"]');
  await bottomDrawer.waitFor({ state: 'visible' });
  assert.equal(await page.locator('aside.st-review-panel').count(), 0);

  assert.deepEqual(pageErrors, []);
  await server.stop();
});
