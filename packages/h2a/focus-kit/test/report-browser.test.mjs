import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildFocusDossier } from '../../dist/focus-build.js';

test('benchmark report retains tables, charts, glossary, citations and appendix offline in both themes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-report-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../../../focus/tests/fixtures/benchmark-report.json', import.meta.url), 'utf8'));
    doc.sections[1].markdown += '\n| Texte | <img src=x onerror=alert> |';
    const boundedCell = `${'Mesure stable. '.repeat(15)}\\| ${'Mesure stable. '.repeat(14)}Fin.`;
    doc.sections[1].markdown += `\n| Pipe \\| littéral | ${boundedCell} |`;
    const output = join(root, 'report.html');
    writeFileSync(output, buildFocusDossier(doc));
    browser = await chromium.launch({ headless: true });
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ offline: true, colorScheme, viewport: { width: 390, height: 844 } });
      const page = await context.newPage(), errors = [], network = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
      await page.goto(pathToFileURL(output).href);
      await page.getByRole('heading', { name: doc.title }).waitFor();
      assert.match(await page.locator('.reading-meta').innerText(), /Rapport/);
      assert.doesNotMatch(await page.locator('main').innerText(), /question\(s\)|Recommandation|Sélectionnez|Vos sélections|Votre réponse/);
      assert.equal(await page.locator('.option-card, .response-summary').count(), 0);
      assert.equal(await page.locator('#table table').count(), 1);
      assert.equal(await page.locator('#table img').count(), 0, 'table content is escaped');
      assert.match(await page.locator('#table').innerText(), /<img src=x/);
      const escapedRow = page.locator('#table tbody tr').last();
      assert.equal(await escapedRow.locator('td').count(), 2);
      assert.deepEqual(await escapedRow.locator('td').allTextContents(), ['Pipe | littéral', boundedCell.replace('\\|', '|')]);
      assert.equal((await escapedRow.locator('td').last().innerText()).split(/\s+/).length, 60);
      for (const word of ['Mesure', 'Détection']) {
        const lineCount = await page.locator('#table th, #table td').filter({ hasText: new RegExp(`^${word}$`) }).evaluate(cell => {
          const range = document.createRange(); range.selectNodeContents(cell);
          return new Set([...range.getClientRects()].map(rect => rect.top)).size;
        });
        assert.equal(lineCount, 1, `${word} must remain on one line at 390px`);
      }
      assert.ok(await page.getByText(doc.readability.glossary[0].definition, { exact: true }).count());
      const call = page.getByRole('link', { name: 'Source 1', exact: true }).first();
      const anchor = await call.getAttribute('href');
      await call.click();
      assert.equal(new URL(page.url()).hash, anchor);
      assert.match(await page.locator(anchor).innerText(), /Résultats mesurés · Mesures du corpus/);
      await page.getByRole('button', { name: 'Consulter Mesures du corpus', exact: true }).click();
      await page.getByText(/Détection,Stable/).first().waitFor();
      for (const theme of ['clair', 'sombre']) {
        await page.getByRole('button', { name: `Consulter Emplacement du graphique ${theme}`, exact: true }).click();
        await page.getByRole('img', { name: `Emplacement du graphique ${theme}`, exact: true }).waitFor();
      }
      await page.locator('summary').filter({ hasText: 'Annexe de méthode' }).click();
      await page.getByText('En bref : chaque mesure provient du même corpus de référence.', { exact: true }).waitFor();
      assert.equal(await page.locator('table').count(), 2);
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(process.cwd(), `.tmp/report-${colorScheme}.png`), fullPage: true });
      // An indivisible value may overflow the table, but must never widen the page.
      await escapedRow.locator('td').last().evaluate(cell => { cell.textContent = 'observation'.repeat(60); });
      const scroll = await page.locator('#table .evidence-table').evaluate(container => {
        container.scrollLeft = container.scrollWidth;
        return { needed: container.scrollWidth > container.clientWidth, moved: container.scrollLeft > 0,
          pageFits: document.documentElement.scrollWidth <= innerWidth };
      });
      assert.deepEqual(scroll, { needed: true, moved: true, pageFits: true });
      await context.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('HTML-like table text is displayed at 60 words and refused at 61 by both renderer and build', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-report-literal-'));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(2000);
    const renderer = readFileSync(new URL('../renderer.html', import.meta.url), 'utf8');
    for (const words of [60, 61]) for (const cell of [
      `<${Array(words).fill('stable.').join(' ')}>`,
      `<span title=" ${Array(words - 3).fill('stable.').join(' ')} ">`,
    ]) {
      const doc = JSON.parse(readFileSync(new URL('../../../focus/tests/fixtures/benchmark-report.json', import.meta.url), 'utf8'));
      doc.sections[1].markdown = `| ${cell} | Observation |\n| --- | --- |\n| ${cell} | Stable |`;
      // Exercise browser-side validation independently of the build-time gate.
      const payload = JSON.stringify({ document: doc, views: {}, build: {} }).replace(/</g, '\\u003c');
      const output = join(root, 'literal.html');
      writeFileSync(output, renderer.replace('<!--FOCUS_PAYLOAD-->', () => `<script type="application/json" data-focus-document>${payload}</script>`));
      const refusal = words === 61 ? page.waitForEvent('pageerror') : null;
      await page.goto(pathToFileURL(output).href);
      if (refusal) {
        assert.match((await refusal).message, /cell_max_60_words.*found 61 words/);
        assert.equal(await page.locator('#table table').count(), 0);
        assert.throws(() => buildFocusDossier(doc), /cell_max_60_words.*found 61 words/);
        continue;
      }
      await page.getByRole('heading', { name: doc.title }).waitFor();
      for (const selector of ['#table th:first-child', '#table td:first-child']) {
        const rendered = await page.locator(selector).innerText();
        assert.equal(rendered, cell);
        assert.equal(rendered.trim().split(/\s+/).length, words);
        assert.equal(await page.locator(`${selector} *`).count(), 0);
      }
      assert.doesNotThrow(() => buildFocusDossier(doc));
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});
