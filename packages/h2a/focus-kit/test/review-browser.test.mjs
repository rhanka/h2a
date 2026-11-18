/**
 * Recette L0 (même scénario pour les deux lanes) contre le fake en page :
 * créer 3 fils sur 3 ancres, répondre, envoyer un fil à l'agent et voir sa
 * réponse, résoudre un fil, le rouvrir, recharger et retrouver l'état.
 * Sert le renderer Vue construit avec un payload `review: true` injecté.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '../node_modules/playwright/index.mjs';

const kit = new URL('../', import.meta.url).pathname;
const fixture = JSON.parse(readFileSync(join(kit, 'test/fixtures/renderer-parity/decision.prepared.json'), 'utf8'));

function buildPage() {
  const template = readFileSync(join(kit, 'renderer-vue.html'), 'utf8');
  assert.ok(template.includes('<!--FOCUS_PAYLOAD-->'), 'renderer-vue.html doit être construit (node scripts/build-focus-vue.mjs)');
  const payload = JSON.stringify({ document: fixture, mode: 'decision', review: true, artifactId: 'review-acceptance' })
    .replace(/</g, '\\u003c');
  return template
    .replace('<!--FOCUS_TITLE-->', 'Review acceptance')
    .replace('<!--FOCUS_PAYLOAD-->', `<script type="application/json" data-focus-document>${payload}</script>`);
}

async function serve(html) {
  const dir = mkdtempSync(join(tmpdir(), 'review-browser-'));
  const file = join(dir, 'dossier.html');
  writeFileSync(file, html);
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/dossier.html`, close: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

async function createThreadFromSection(page, sectionIndex, body) {
  const section = page.locator('[data-review-root] .dossier-section').nth(sectionIndex);
  await section.scrollIntoViewIfNeeded();
  // Sélectionne le premier texte rendu de la section, puis Add comment.
  await section.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent;
      const at = text.search(/\S.{7}/);
      if (at !== -1) {
        const range = document.createRange();
        range.setStart(walker.currentNode, at);
        range.setEnd(walker.currentNode, at + 8);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
    throw new Error('No selectable text in section');
  });
  await page.getByRole('button', { name: 'Add comment' }).click({ timeout: 5000 });
  await page.locator('.st-review-composer-pop textarea').fill(body);
  await page.locator('.st-review-composer-pop').getByRole('button', { name: 'Comment', exact: true }).click();
  await page.locator('.st-review-panel').getByText(body).waitFor({ timeout: 5000 });
}

test('acceptance: 3 threads, reply, agent reply, resolve, reopen, reload persists', async () => {
  const { url, close } = await serve(buildPage());
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    await page.getByRole('button', { name: /Review ·/ }).waitFor();
    // Flag on mais mode vue par défaut : aucune épingle visible.
    assert.equal(await page.locator('.st-review-pin').count(), 0);
    await page.getByRole('button', { name: /Review ·/ }).click();
    await page.locator('.st-review-panel').waitFor();

    await createThreadFromSection(page, 0, 'First anchor note');
    await createThreadFromSection(page, 1, 'Second anchor note');
    // Troisième fil par clic élément sur une autre section.
    const third = page.locator('[data-review-root] .dossier-section').nth(2);
    await third.scrollIntoViewIfNeeded();
    await third.locator('p, h2, h3').first().click();
    await page.locator('.st-review-composer-pop textarea').fill('Element anchor note');
    await page.locator('.st-review-composer-pop').getByRole('button', { name: 'Comment', exact: true }).click();
    await page.locator('.st-review-panel').getByText('Element anchor note').waitFor();
    assert.equal(await page.locator('.st-review-pin').count(), 3, '3 épingles ancrées');

    // Répondre au premier fil.
    await page.locator('.st-review-thread-row').first().click();
    await page.getByRole('button', { name: 'Reply' }).click();
    await page.locator('.st-review-panel textarea').last().fill('Reply from owner');
    await page.locator('.st-review-panel').getByRole('button', { name: 'Reply', exact: true }).last().click();
    await page.locator('.st-review-panel').getByText('Reply from owner').waitFor();

    // Envoyer le premier fil à l'agent et voir la réponse arriver en direct.
    await page.getByRole('button', { name: 'Reply' }).click();
    await page.locator('.st-review-panel textarea').last().fill('Agent please review');
    await page.locator('.st-review-panel').getByLabel(/Send to agent/).check();
    await page.locator('.st-review-panel').getByRole('button', { name: 'Reply', exact: true }).last().click();
    await page.locator('.st-review-panel').getByText(/Agent reply \(fake\)/).waitFor({ timeout: 8000 });

    // Résoudre puis rouvrir le deuxième fil.
    await page.locator('.st-review-thread-row').nth(1).click();
    await page.locator('.st-review-thread').getByRole('button', { name: 'Resolve' }).click();
    await page.locator('.st-review-thread').getByText('Resolved', { exact: true }).waitFor();
    await page.locator('.st-review-thread').getByRole('button', { name: 'Reopen' }).click();
    await page.locator('.st-review-thread').getByRole('button', { name: 'Resolve' }).waitFor();

    // Recharger : l'état persisté (fake localStorage) est relu.
    await page.reload();
    await page.getByRole('button', { name: /Review · 3/ }).waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: /Review ·/ }).click();
    assert.equal(await page.locator('.st-review-thread-row').count(), 3, '3 fils relus après reload');
    await page.locator('.st-review-thread-row').first().click();
    await page.locator('.st-review-panel').getByText('First anchor note').waitFor();
    await page.locator('.st-review-panel').getByText('Reply from owner').waitFor();
    assert.equal(await page.locator('.st-review-pin').count(), 3);
  } finally {
    await browser.close();
    close();
  }
});

test('keyboard and phone: pin reachable by keyboard, panel becomes a bottom sheet', async () => {
  const { url, close } = await serve(buildPage());
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(url);
    await page.getByRole('button', { name: /Review ·/ }).click();
    await page.locator('.st-review-panel').waitFor();
    await createThreadFromSection(page, 0, 'Keyboard thread');
    const pin = page.locator('.st-review-pin').first();
    await pin.focus();
    assert.equal(await pin.evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Enter');
    await page.locator('.st-review-thread').waitFor();
    // Feuille du bas : le panneau touche le bas du viewport téléphone.
    const box = await page.locator('.st-review-panel').boundingBox();
    assert.ok(Math.abs(box.y + box.height - 844) < 2, `panel bottom ${box.y + box.height} ≈ 844`);
    // Jamais la couleur seule : l'épingle expose un libellé textuel complet.
    assert.match(await pin.getAttribute('aria-label'), /Thread 1, 1 comment/);
  } finally {
    await browser.close();
    close();
  }
});

test('flag off by default: no review toggle without the flag', async () => {
  const template = readFileSync(join(kit, 'renderer-vue.html'), 'utf8');
  const payload = JSON.stringify({ document: fixture, mode: 'decision' }).replace(/</g, '\\u003c');
  const html = template.replace('<!--FOCUS_TITLE-->', 'No review').replace('<!--FOCUS_PAYLOAD-->', `<script type="application/json" data-focus-document>${payload}</script>`);
  const { url, close } = await serve(html);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(url);
    await page.locator('.focus-page').waitFor();
    assert.equal(await page.getByRole('button', { name: /Review ·/ }).count(), 0);
    assert.equal(await page.locator('.st-review-panel').count(), 0);
  } finally {
    await browser.close();
    close();
  }
});
