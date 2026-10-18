import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidenceFixture, source, digest } from './evidence-fixtures.mjs';
import { withBrowser } from './evidence-harness.mjs';

test('consults complete evidence offline with bounded lines, inert text and focus return on keyboard and touch', async () => {
  const doc = evidenceFixture(20_000, 31);
  doc.sources.push(source('hostile', '</script><img src=x onerror=globalThis.bad=1>\r\nL06b'));
  await withBrowser(doc, async ({ browser, url }) => {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width, height: 900 },
        isMobile: width < 600, hasTouch: width < 600 });
      const page = await context.newPage(), errors = [], network = [];
      page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
      await page.goto(url);
      const evidence = page.getByRole('region', { name: 'Pièces justificatives', exact: true });
      assert.equal(await evidence.count(), 1, 'H1 must expose the evidence index');
      await page.getByRole('button', { name: /Fichier portable/ }).click();
      await page.locator('.svelte-flow__controls-zoomin').click();
      const camera = await page.locator('.svelte-flow__viewport').getAttribute('style');
      const opener = page.locator('.dossier-section').first().getByRole('button', { name: 'Preuve distante', exact: true });
      await opener.focus(); await page.keyboard.press('Enter');
      const panel = page.getByRole('region', { name: 'Source consultée', exact: true });
      await panel.locator('[data-line="20000"]').waitFor({ timeout: 1500 });
      assert.match(await panel.locator('[data-line="20000"]').innerText(), /fin distante/);
      assert.ok(await panel.locator('.source-line').count() <= 80);
      const search = panel.getByRole('searchbox', { name: 'Rechercher dans toute la source' });
      await search.fill('preuve'); await search.fill('fin distante');
      await page.waitForFunction(() => document.querySelector('[data-search-status]')?.textContent === '1 résultat(s)', null, { timeout: 1500 });
      assert.equal(await panel.locator('[data-search-status]').innerText(), '1 résultat(s)');
      await search.fill('absent-complet');
      await page.waitForFunction(() => document.querySelector('[data-search-status]')?.textContent === '0 résultat(s)', null, { timeout: 1500 });
      const download = page.waitForEvent('download');
      await panel.getByRole('button', { name: 'Télécharger les octets originaux' }).click();
      const saved = await download;
      assert.equal(digest(readFileSync(await saved.path())), doc.sources[0].sha256);
      await panel.getByRole('button', { name: 'Retour au contexte' }).click();
      assert.equal(await opener.evaluate(e => e === document.activeElement), true);
      assert.equal(await page.locator('.svelte-flow__viewport').getAttribute('style'), camera);
      assert.equal(await page.getByRole('button', { name: /Fichier portable/ }).getAttribute('aria-pressed'), 'true');
      await evidence.getByRole('button', { name: 'Consulter Source hostile', exact: true }).click();
      assert.match(await panel.innerText(), /<img src=x onerror=/);
      assert.equal(await page.evaluate(() => globalThis.bad), undefined);
      assert.equal(await panel.locator('img').count(), 0);
      await panel.getByRole('button', { name: 'Retour au contexte' }).click();
      await evidence.getByRole('button', { name: 'Capture', exact: true }).first().click();
      assert.equal(await panel.getByAltText('Capture de référence').count(), 1);
      await panel.getByRole('button', { name: 'Retour au contexte' }).click();
      await evidence.getByText('Détail des pièces', { exact: true }).click();
      assert.equal(await evidence.getByText('Texte de soutien.', { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      console.log(`${width}px: offline range/search/download/back, bounded DOM and inert text OK`);
      await context.close();
    }
  });
});
