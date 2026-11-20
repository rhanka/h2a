/**
 * Mesures produit de la lane (protocole velocity) : taille du bundle
 * (renderer-vue.html brut + gzip) et médiane de 5 temps de premier rendu
 * et d'ouverture de fil, à 1440×900 et 390×844, via Playwright/Chromium.
 * Usage : node test/review-measures.mjs  → JSON sur stdout.
 */
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '../../node_modules/playwright/index.mjs';

const vueDir = new URL('../', import.meta.url).pathname;
const kit = join(vueDir, '..');
const fixture = JSON.parse(readFileSync(join(kit, 'test/fixtures/renderer-parity/decision.prepared.json'), 'utf8'));
const template = readFileSync(join(kit, 'renderer-vue.html'));
const payload = JSON.stringify({ document: fixture, mode: 'decision', review: true, artifactId: 'review-measures' }).replace(/</g, '\\u003c');
const html = template.toString('utf8')
  .replace('<!--FOCUS_TITLE-->', 'Review measures')
  .replace('<!--FOCUS_PAYLOAD-->', `<script type="application/json" data-focus-document>${payload}</script>`);

const dir = mkdtempSync(join(tmpdir(), 'review-measures-'));
const file = join(dir, 'dossier.html');
writeFileSync(file, html);
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/dossier.html`;

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const browser = await chromium.launch({ headless: true });
const result = {
  bundle: { rawBytes: template.length, gzipBytes: gzipSync(template).length, note: 'renderer-vue.html fichier unique (JS+CSS inline), revue incluse, flag off par défaut' },
  viewports: {},
};
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } })) {
    const firstRender = [];
    const openThread = [];
    for (let run = 0; run < 5; run++) {
      const page = await browser.newPage({ viewport });
      const started = Date.now();
      await page.goto(url);
      await page.getByRole('button', { name: /Review ·/ }).waitFor();
      firstRender.push(Date.now() - started);
      await page.getByRole('button', { name: /Review ·/ }).click();
      // Crée un fil minimal par l'adaptateur fake via le panneau : sélection + composer.
      const section = page.locator('[data-review-root] .dossier-section').first();
      await section.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const at = walker.currentNode.textContent.search(/\S.{7}/);
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
      });
      await page.getByRole('button', { name: 'Add comment' }).click();
      await page.locator('.st-review-composer-pop textarea').fill(`Timing thread ${run}`);
      await page.locator('.st-review-composer-pop').getByRole('button', { name: 'Comment', exact: true }).click();
      await page.locator('.st-review-pin').first().waitFor();
      const openStarted = Date.now();
      await page.locator('.st-review-pin').first().click();
      await page.locator('.st-review-thread').waitFor();
      openThread.push(Date.now() - openStarted);
      await page.close();
    }
    result.viewports[name] = {
      viewport,
      firstRenderMs: { runs: firstRender, median: median(firstRender) },
      openThreadMs: { runs: openThread, median: median(openThread) },
    };
  }
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
