import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { evidenceFixture, digest } from './evidence-fixtures.mjs';
import { portable, isolatedEnvironment } from './evidence-harness.mjs';

test('bibliography anchors and decision response work through CDP, clipboard and real Ctrl+C', async () => {
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
    doc.citations.push({ id: 'early', sourceId: 'long', label: 'Passage initial', locator: { kind: 'lines', start: 3, end: 4 } });
    doc.sections[0].citationRefs.push('early');
    doc.sections[0].id = 'focus-source-1';
    doc.sections[1].id = `src-${Buffer.from(doc.ref).toString('hex')}-1`;
    doc.annexes[0].backRefs = [doc.sections[0].id];
    const artifact = portable(root, doc);
    owner = await chromium.launchPersistentContext(join(root, 'profile'), { headless: true,
      args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
      env: isolatedEnvironment(root), acceptDownloads: true });
    const [port] = readFileSync(join(root, 'profile', 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage(), errors = [];
    assert.equal(owner.pages().length, 2, 'CDP must drive the browser launched by this test');
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(artifact.url);
    const line = page.getByLabel('Ligne de réponse', { exact: true });
    const status = page.locator('p[role="status"]');
    assert.equal(await line.evaluate(el => el.tagName), 'OUTPUT');
    assert.equal(await line.innerText(), 'D1 — · D2 — · D3 —');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Thème sombre', exact: true }).click();
      assert.equal(await page.locator('.focus-page').getAttribute('data-mode'), theme);
      assert.equal(await page.locator('button.citation-link').count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Sources', exact: true, level: 3 }).count(), 1);
      const call = page.locator('.dossier-section .citation-link').first();
      assert.equal(await call.innerText(), '[1]');
      const callBox = await call.boundingBox();
      assert.ok(callBox.width >= 24 && callBox.height >= 24, `citation target >= 24x24: ${JSON.stringify(callBox)}`);
      await call.focus(); await page.keyboard.press('Enter');
      const anchor = await call.getAttribute('href');
      assert.match(anchor, /^#src-[a-f0-9]+-1-$/);
      assert.equal(new URL(page.url()).hash, anchor);
      assert.equal(await page.locator(anchor).count(), 1);
      assert.equal(await page.locator(anchor).evaluate(el => el.tagName === 'LI' && el === document.activeElement), true);
      assert.equal(await page.locator('#focus-source-1').getAttribute('class'), 'dossier-section');
      assert.match(await page.locator(anchor).innerText(), /Preuve distante · Source long · fixture@main:spec.md:12–13/);
      assert.equal(await page.locator('.source-viewer').count(), 0, 'citation navigation opens no panel');
      await page.locator(anchor).getByRole('button', { name: 'Retour au texte', exact: true }).click();
      assert.equal(await call.evaluate(el => el === document.activeElement), true);
      await page.getByRole('button', { name: 'fixture@main:spec.md:3–4', exact: true }).click();
      const panel = page.getByRole('region', { name: 'Source consultée', exact: true });
      await panel.locator('[data-line="3"]').waitFor({ timeout: 1500 });
      assert.match(await panel.innerText(), /plage citée : 3–4/);
      await panel.getByRole('button', { name: 'Retour au contexte', exact: true }).click();
      assert.equal(await page.locator('.source-viewer').count(), 0);
      for (const link of await page.locator('.citation-link').all()) {
        const target = await link.getAttribute('href');
        assert.equal(await page.locator(target).count(), 1);
      }
      await page.locator('#portable0').click();
      await page.locator('#hosted1').click();
      await page.locator('#portable2').click();
      const expected = 'D1 A — Fichier portable · D2 B — Page hébergée · D3 A — Fichier portable';
      assert.equal(await line.innerText(), expected);
      await page.getByRole('button', { name: 'Copier', exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
      assert.equal(await status.innerText(), 'Copié.');
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
      assert.equal(await line.innerText(), 'D1 B — Page hébergée · D2 B — Page hébergée · D3 A — Fichier portable');
      assert.equal(await status.innerText(), '');
      const blocked = await page.locator('main').evaluate(el => [...el.querySelectorAll('*')]
        .filter(node => node.textContent.trim() && getComputedStyle(node).userSelect === 'none').map(node => node.tagName));
      assert.deepEqual(blocked, [], 'all dossier text must allow mouse selection');
      const download = page.waitForEvent('download');
      await page.locator(anchor).getByRole('link', { name: 'Télécharger', exact: true }).click();
      assert.equal(digest(readFileSync(await (await download).path())), doc.sources[0].sha256);
    }
    const updated = 'D1 B — Page hébergée · D2 B — Page hébergée · D3 A — Fichier portable';
    // Clipboard unavailable or denied: selection remains visible and native copy still works.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('denied'); } } }));
    await page.getByRole('button', { name: 'Copier', exact: true }).click();
    assert.equal(await page.evaluate(() => getSelection().toString()), updated);
    assert.match(await status.innerText(), /Ctrl\+C/);
    await page.keyboard.press('Control+c');
    await page.evaluate(() => delete navigator.clipboard);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), updated);
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
    assert.equal(await line.innerText(), "D2 B — Page hébergée");
    await page.getByRole("button", { name: "Copier", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "D2 B — Page hébergée");
    assert.deepEqual(errors, []);
    console.log(`CDP 127.0.0.1:${port} : ancres, deux thèmes, choix, Copier, sélection souris, Ctrl+C et repli validés.`);
  } finally {
    await browser?.close(); await owner?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
