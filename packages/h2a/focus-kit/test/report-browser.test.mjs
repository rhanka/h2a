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
    doc.sections[1].markdown += '\n| Texte | <img src=x onerror=alert(1)> |';
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
      assert.doesNotMatch(await page.locator('main').innerText(), /question\(s\)|Recommandation|Sélectionnez|Vos sélections/);
      assert.equal(await page.locator('.option-card').count(), 0);
      assert.equal(await page.locator('#table table').count(), 1);
      assert.equal(await page.locator('#table img').count(), 0, 'table content is escaped');
      assert.match(await page.locator('#table').innerText(), /<img src=x/);
      assert.ok(await page.getByText(doc.readability.glossary[0].definition, { exact: true }).count());
      await page.getByRole('button', { name: 'Résultats mesurés', exact: true }).first().click();
      await page.getByText(/Détection,Stable/).first().waitFor();
      for (const theme of ['clair', 'sombre']) {
        await page.getByRole('button', { name: `Graphique ${theme}`, exact: true }).first().click();
        await page.getByRole('img', { name: `Emplacement du graphique ${theme}`, exact: true }).waitFor();
      }
      await page.locator('summary').filter({ hasText: 'Annexe de méthode' }).click();
      await page.getByText('En bref : chaque mesure provient du même corpus de référence.', { exact: true }).waitFor();
      assert.equal(await page.locator('table').count(), 2);
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(process.cwd(), `.tmp/report-${colorScheme}.png`), fullPage: true });
      await context.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});
