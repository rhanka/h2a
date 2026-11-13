import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';
import { buildFocusDossier } from '../../dist/focus-build.js';
import { fixtureRoot, dimensions, observe } from './parity-capture.mjs';

// Deliberately fails (never skips) when Vue is requested without qualified assets.
const backend = process.env.FOCUS_PARITY_RENDERER ?? 'svelte';
assert.ok(['svelte', 'vue'].includes(backend));
test(`portable ${backend}: frozen data, visible content and offline browser parity`, async () => {
  const output = new URL('../../../../.tmp/renderer-parity-results/', import.meta.url);
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const name of ['decision', 'report', 'evidence']) {
      const raw = readFileSync(new URL(`${name}.input.json`, fixtureRoot), 'utf8'), doc = JSON.parse(raw), before = JSON.stringify(doc);
      const report = backend === 'vue' && name === 'report';
      const html = buildFocusDossier(doc, { renderer: backend, ...(report ? { mode: 'report' } : {}) });
      assert.equal(JSON.stringify(doc), before, 'input is not mutated');
      const payload = JSON.parse(html.match(/data-focus-document>([\s\S]*?)<\/script>/)[1]);
      assert.equal(JSON.stringify(payload.document) + '\n', readFileSync(new URL(`${name}.prepared.json`, fixtureRoot), 'utf8'), 'exact prepared serializer bytes');
      const file = new URL(`${name}-${backend}.html`, output); writeFileSync(file, html);
      for (const width of dimensions) {
        const context = await browser.newContext({ offline: true, viewport: { width, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
        const page = await context.newPage(), errors = [], network = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
        await page.goto(file.href);
        await page.locator(backend === 'vue' ? '[data-scene-occurrence]' : '.svelte-flow__node').first().waitFor();
        const result = await observe(page);
        const baseline = JSON.parse(readFileSync(new URL(`${name}-${width}.svelte.json`, fixtureRoot)));
        assert.equal(result.title, baseline.title);
        assert.deepEqual(result.headings, baseline.headings);
        assert.equal(result.glossaryFolded, true); assert.equal(result.overflow, false);
        if (backend === 'svelte') assert.deepEqual(result, baseline);
        else {
          // Different camera controls/layout; all document sections outside the figure are exact.
          const diagramIds = new Set(doc.sections.filter(s => s.kind === 'diagram').map(s => s.id));
          const documentSections = items => items.filter(s => !diagramIds.has(s.id)).map(s => ({ ...s,
            text: report ? s.text.replace('Sélectionnez une option pour préparer votre réponse.', '').trim() : s.text }));
          assert.deepEqual(documentSections(result.sections), documentSections(baseline.sections));
          for (const section of payload.document.sections.filter(s => s.kind === 'diagram')) {
            const figure = page.locator(`#${section.id}`);
            for (const entity of Object.values(section.scene.entities)) assert.ok((await figure.innerText()).includes(entity.attributes.name.value));
            assert.equal(await figure.locator('[role="alert"]').count(), 0);
            for (const node of await figure.locator('[data-scene-occurrence]').all()) {
              const box = await node.boundingBox(); assert.ok(box.width > 0 && box.height > 0, 'no empty diagram card');
            }
          }
        }
        const screenshot = new URL(`${name}-${width}.${backend}.png`, output);
        await page.screenshot({ path: fileURLToPath(screenshot), fullPage: true, animations: 'disabled' });
        writeFileSync(new URL(`${name}-${width}.${backend}.json`, output), JSON.stringify(result, null, 2) + '\n');
        if (report) {
          assert.equal(await page.getByRole('button', { name: /Fichier portable/ }).first().isDisabled(), true);
          assert.equal(await page.locator('.selection').count(), 0);
        } else {
          await page.getByRole('button', { name: /Fichier portable/ }).first().click();
          assert.equal(await page.getByRole('button', { name: /Fichier portable/ }).first().getAttribute('aria-pressed'), 'true');
          await page.getByRole('button', { name: /Page hébergée/ }).first().focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.getByRole('button', { name: /Page hébergée/ }).first().getAttribute('aria-pressed'), 'true');
        }
        await page.getByRole('button', { name: 'Thème sombre' }).click();
        assert.equal(await page.locator('.focus-page').getAttribute('data-mode'), 'dark');
        assert.deepEqual(errors, []); assert.deepEqual(network, []);
        if (backend === 'vue') {
          const pair = await context.newPage();
          const image = url => `data:image/png;base64,${readFileSync(url).toString('base64')}`;
          await pair.setContent(`<style>body{margin:0;display:flex}figure{margin:0;width:50%}img{width:100%}</style><figure><figcaption>Svelte</figcaption><img src="${image(new URL(`${name}-${width}.svelte.png`, fixtureRoot))}"></figure><figure><figcaption>Vue</figcaption><img src="${image(screenshot)}"></figure>`);
          await pair.screenshot({ path: fileURLToPath(new URL(`${name}-${width}.comparison.png`, output)), fullPage: true });
        }
        await context.close();
      }
    }
  } finally { await browser.close(); }
});
