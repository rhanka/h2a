import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';
import { buildFocusDossier } from '../../dist/focus-build.js';
import { parityCorpus } from './parity-corpus.mjs';

export const fixtureRoot = new URL('./fixtures/renderer-parity/', import.meta.url);
export const dimensions = [1440, 390];
export const normalize = text => text.replace(/\s+/g, ' ').trim();
export async function observe(page) {
  return page.evaluate(() => {
    const normalize = text => text.replace(/\s+/g, ' ').trim();
    return {
      title: document.title,
      text: normalize(document.querySelector('main').innerText),
      sections: [...document.querySelectorAll('.dossier-section')].map(el => ({ id: el.id,
        text: normalize(el.innerText), headings: [...el.querySelectorAll('h2,h3')].map(h => h.textContent) })),
      headings: [...document.querySelectorAll('h1,h2,h3')].map(el => ({ tag: el.tagName, text: el.textContent })),
      details: [...document.querySelectorAll('details')].map(el => ({ summary: el.querySelector('summary')?.textContent, open: el.open })),
      buttons: [...document.querySelectorAll('button')].map(el => ({ text: normalize(el.innerText), label: el.getAttribute('aria-label'), pressed: el.getAttribute('aria-pressed') })),
      glossaryFolded: !document.querySelector('.focus-glossary').open,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

export async function captureBaseline() {
  mkdirSync(fixtureRoot, { recursive: true });
  const temporary = new URL('../../../../.tmp/renderer-parity/', import.meta.url);
  mkdirSync(temporary, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, doc] of Object.entries(parityCorpus())) {
      const html = buildFocusDossier(doc);
      writeFileSync(new URL(`${name}.input.json`, fixtureRoot), JSON.stringify(doc, null, 2) + '\n');
      const payload = JSON.parse(html.match(/data-focus-document>([\s\S]*?)<\/script>/)[1]);
      writeFileSync(new URL(`${name}.prepared.json`, fixtureRoot), JSON.stringify(payload.document) + '\n');
      const file = new URL(`${name}.html`, temporary); writeFileSync(file, html);
      for (const width of dimensions) {
        const context = await browser.newContext({ offline: true, viewport: { width, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
        const page = await context.newPage(), errors = [], network = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
        await page.goto(pathToFileURL(fileURLToPath(file)).href);
        await page.locator('.svelte-flow__node').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const observation = await observe(page);
        assert.equal(observation.glossaryFolded, true); assert.equal(observation.overflow, false);
        assert.deepEqual(errors, []); assert.deepEqual(network, []);
        writeFileSync(new URL(`${name}-${width}.svelte.json`, fixtureRoot), JSON.stringify(observation, null, 2) + '\n');
        await page.screenshot({ path: fileURLToPath(new URL(`${name}-${width}.svelte.png`, fixtureRoot)), fullPage: true, animations: 'disabled' });
        await context.close();
      }
    }
    writeFileSync(new URL('baseline.json', fixtureRoot), JSON.stringify({ renderer: 'Svelte', widths: dimensions, height: 1000,
      theme: 'entropic/light', glossary: 'folded', numberedFlows: false, profiles: ['generic@1'],
      report: 'Validated decision dossier; this baseline defines no ReportDocument schema or report mode.',
      pins: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).dependencies }, null, 2) + '\n');
  } finally { await browser.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await captureBaseline();
