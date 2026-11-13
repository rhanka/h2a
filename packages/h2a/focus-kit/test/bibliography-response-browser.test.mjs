import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { evidenceFixture, digest } from './evidence-fixtures.mjs';
import { portable, isolatedEnvironment } from './evidence-harness.mjs';

test('bibliography anchors and decision response work through CDP 9333, clipboard and real Ctrl+C', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-citations-cdp-'));
  let owner, browser;
  try {
    const doc = evidenceFixture();
    doc.readability.stakesLevel = 'high';
    doc.readability.readingBudgetMinutes = 10;
    const question = doc.sections.find(s => s.kind === 'question');
    const options = doc.sections.find(s => s.kind === 'optionSet');
    const rationale = doc.sections.find(s => s.id === 'rationale');
    doc.sections = [doc.sections[0], doc.sections.find(s => s.kind === 'diagram'), ...Array.from({ length: 3 }, (_, i) => {
      const q = structuredClone(question), o = structuredClone(options), r = structuredClone(rationale);
      for (const section of [q, o, r]) { section.id += i; section.targetRef += i; section.questionId = q.id; }
      delete q.questionId;
      q.recommendedOptionId += i;
      o.options.forEach(option => { option.id += i; option.targetRef += i; });
      return [q, o, r];
    }).flat()];
    doc.sources[0].origin = { repo: 'fixture', revision: 'main', path: 'spec.md' };
    const artifact = portable(root, doc);
    owner = await chromium.launchPersistentContext(join(root, 'profile'), { headless: true,
      args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9333'],
      env: isolatedEnvironment(root), acceptDownloads: true });
    browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const context = browser.contexts()[0];
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(artifact.url);
    const line = page.getByLabel('Ligne de réponse', { exact: true });
    assert.equal(await line.innerText(), 'D1 — · D2 — · D3 —');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Thème sombre', exact: true }).click();
      assert.equal(await page.locator('.focus-page').getAttribute('data-mode'), theme);
      assert.equal(await page.locator('button.citation-link').count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Sources', exact: true }).count(), 1);
      const call = page.locator('.dossier-section .citation-link').first();
      assert.equal(await call.innerText(), '[1]');
      await call.focus(); await page.keyboard.press('Enter');
      assert.equal(new URL(page.url()).hash, '#focus-source-1');
      assert.match(await page.locator('#focus-source-1').innerText(), /Preuve distante · Source long · fixture@main:spec.md:12–13/);
      assert.equal(await page.locator('.source-viewer').count(), 0, 'citation navigation opens no panel');
      for (const link of await page.locator('.citation-link').all()) {
        const target = await link.getAttribute('href');
        assert.equal(await page.locator(target).count(), 1);
      }
      await page.locator('#portable0').click();
      await page.locator('#hosted1').click();
      await page.locator('#portable2').click();
      const expected = 'D1 A · D2 B · D3 A';
      assert.equal(await line.innerText(), expected);
      await page.getByRole('button', { name: 'Copier', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
      // Select the actual rendered text by dragging the mouse, then use native Ctrl+C.
      await line.scrollIntoViewIfNeeded();
      const box = await line.evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      await page.mouse.move(box.x, box.y + box.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 20 }); await page.mouse.up();
      assert.equal(await page.evaluate(() => getSelection().toString()), expected);
      await page.keyboard.press('Control+c');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
      await page.locator('#hosted0').click();
      assert.equal(await line.innerText(), 'D1 B · D2 B · D3 A');
      const blocked = await page.locator('main').evaluate(el => [...el.querySelectorAll('*')]
        .filter(node => node.textContent.trim() && getComputedStyle(node).userSelect === 'none').map(node => node.tagName));
      assert.deepEqual(blocked, [], 'all dossier text must allow mouse selection');
      const download = page.waitForEvent('download');
      await page.locator('#focus-source-1').getByRole('link', { name: 'Télécharger', exact: true }).click();
      assert.equal(digest(readFileSync(await (await download).path())), doc.sources[0].sha256);
    }
    // Clipboard unavailable or denied: selection remains visible and native copy still works.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('denied'); } } }));
    await page.getByRole('button', { name: 'Copier', exact: true }).click();
    assert.equal(await page.evaluate(() => getSelection().toString()), 'D1 B · D2 B · D3 A');
    assert.match(await page.getByRole('status').innerText(), /Ctrl\+C/);
    await page.keyboard.press('Control+c');
    await page.evaluate(() => delete navigator.clipboard);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'D1 B · D2 B · D3 A');
    assert.deepEqual(errors, []);
    const legacy = JSON.parse(readFileSync(new URL("../dossier.template.json", import.meta.url), "utf8"));
    const legacyQuestion = legacy.sections.find(s => s.kind === 'question');
    for (const section of legacy.sections) if (section.questionId === legacyQuestion.id) section.questionId = 'D2';
    legacyQuestion.id = 'D2';
    legacyQuestion.question = `D2 · ${legacyQuestion.question}`;
    legacy.readability.glossary.push({ term: 'D2', definition: 'Décision sur le format du dossier.' });
    await page.goto(portable(root, legacy).url);
    assert.equal(await line.innerText(), "D2 —");
    assert.equal(await page.getByRole('heading', { name: legacyQuestion.question, exact: true }).count(), 1);
    await page.locator("#hosted").click();
    assert.equal(await line.innerText(), "D2 B");
    await page.getByRole("button", { name: "Copier", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "D2 B");
    assert.deepEqual(errors, []);
    console.log('CDP 127.0.0.1:9333 : ancres, deux thèmes, choix, Copier, sélection souris, Ctrl+C et repli validés.');
  } finally {
    await browser?.close(); await owner?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
