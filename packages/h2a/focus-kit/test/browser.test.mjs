import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { renderHtml } from '../../../track/src/focus-vendor/render/html.js';

for (const renderer of ['portable', 'generic']) {
  test(`${renderer} glossary stays folded with 47 terms, supports keyboard, search, anchors and print`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'focus-glossary-browser-'));
    let browser;
    try {
      const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
      doc.sections = doc.sections.filter(s => s.kind !== 'diagram');
      doc.readability.glossary.push(...Array.from({ length: 46 }, (_, i) => ({
        term: `Repère ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`,
        definition: 'Une explication pour la lecture.',
      })));
      const output = join(root, 'glossary.html');
      const html = renderer === 'portable'
        ? readFileSync(new URL('../renderer.html', import.meta.url), 'utf8')
          .replace('<!--FOCUS_TITLE-->', 'Glossaire')
          .replace('<!--FOCUS_PAYLOAD-->', `<script type="application/json" data-focus-document>${JSON.stringify({ document: doc }).replace(/</g, '\\u003c')}</script>`)
        : renderHtml(doc, { renderMarkdown: text => text, sanitizeHtml: html => html });
      writeFileSync(output, html);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      const glossary = page.locator('details').filter({ has: page.locator('summary', { hasText: /(?:Glossaire|Glossary)/ }) });
      assert.equal(await glossary.count(), 1);
      assert.equal(await glossary.evaluate(el => el.open), false);
      const summary = glossary.locator('summary');
      assert.equal(await summary.innerText(), renderer === 'portable' ? 'Glossaire (47 termes)' : 'Glossary (47 terms)');
      assert.equal(await glossary.locator('dt').count(), 47, 'terms remain in the DOM');
      assert.equal(await glossary.locator('dd').first().isVisible(), false);
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await glossary.evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => window.find('Une explication pour la lecture.')), true);
      await summary.focus();
      await page.keyboard.press('Space');
      assert.equal(await glossary.evaluate(el => el.open), false);

      // Printing must expose the existing definitions without changing screen state.
      if (renderer === 'portable') await page.getByRole('button', { name: 'Thème sombre', exact: true }).click();
      else await page.addStyleTag({ content: '.focus-document { color: #aaa; background: #111; }' });
      await page.emulateMedia({ media: 'print' });
      assert.equal(await glossary.locator('dd').last().isVisible(), true);
      assert.deepEqual(await glossary.evaluate(el => {
        const style = getComputedStyle(el);
        return [style.color, style.backgroundColor];
      }), ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'], 'print remains legible with a dark screen theme');
      await page.emulateMedia({ media: 'screen' });
      assert.equal(await glossary.evaluate(el => el.open), false);
      assert.equal(await glossary.locator('dd').last().isVisible(), false);

      const term = doc.readability.glossary.at(-1).term;
      const anchor = `glossary-${encodeURIComponent(term)}`;
      assert.equal(await glossary.locator('dt').last().getAttribute('id'), anchor);
      // Test an actual link, then a cold load (Svelte mounts after fragment navigation).
      await page.evaluate(id => {
        const link = document.createElement('a');
        link.href = `#${encodeURIComponent(id)}`;
        link.textContent = 'Définition';
        document.body.prepend(link);
      }, anchor);
      await page.getByRole('link', { name: 'Définition', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.focus-glossary').open);
      assert.equal(await glossary.locator('dt').last().isVisible(), true);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('.focus-glossary')?.open);
      assert.equal(await glossary.locator('dt').last().isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

test('r7 inline SVG consumes diagram-core entities, links and nested containers without a Focus graph', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-semantic-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    const semantic = JSON.parse(readFileSync(new URL('../../../focus/tests/diagram-core-generic.fixture.json', import.meta.url), 'utf8'));
    const diagram = doc.sections.find(s => s.kind === 'diagram');
    diagram.scene = semantic;
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html');
    writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../dist/bin.js', import.meta.url)), 'focus', 'build', input, '-o', output], {
      encoding: 'utf8', cwd: root, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
        XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'h2a') },
    });
    assert.equal(result.status, 0, result.stderr);
    browser = await chromium.launch({ headless: true, env: { ...process.env, XDG_RUNTIME_DIR: root } });
    const context = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(output).href);
    const activeSvg = page.locator('[data-renderer="r7"] .ds-diagram-mount[data-variant="narrow"] .ds-diagram-svg');
    await activeSvg.waitFor({ state: 'visible' });
    assert.equal(await activeSvg.locator('g[data-scene-occurrence]').count(), 4);
    for (const entity of Object.values(semantic.entities)) {
      assert.equal(await activeSvg.locator('.st-diagramCard-title, .st-diagramZone-title')
        .getByText(entity.attributes.name.value, { exact: true }).count(), 1, `${entity.id} carries its DS title`);
    }
    for (const [child, parent] of [['models', 'root'], ['gateway', 'models'], ['coordinator', 'root']]) {
      const childBox = await activeSvg.locator(`g[data-scene-occurrence="occurrence:e.${child}"]`).boundingBox();
      const parentBox = await activeSvg.locator(`g[data-scene-occurrence="occurrence:e.${parent}"]`).boundingBox();
      assert.ok(childBox.x > parentBox.x && childBox.y > parentBox.y, `${child} starts inside ${parent}`);
      assert.ok(childBox.x + childBox.width < parentBox.x + parentBox.width && childBox.y + childBox.height < parentBox.y + parentBox.height, `${child} fits inside ${parent}`);
    }
    assert.equal(await activeSvg.locator('[data-scene-connectors] [data-scene-edge]').count(), 2, 'contains relations are grouping, not links');
    assert.equal(await activeSvg.locator('[data-scene-label]').getByText('Demandes', { exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    console.log('diagram-core r7: names, optional link label, nested containers, phone offline OK');
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('portable Focus works offline on desktop and phone with responsive r7 inline SVG, themes and safe text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    doc.sections.find(s => s.kind === 'question').id = '__proto__';
    for (const section of doc.sections) if (section.questionId === 'format') section.questionId = '__proto__';
    doc.sections.find(s => s.kind === 'prose').markdown += '\n</script><img src=x onerror=alert(1)>';
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html');
    writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../dist/bin.js', import.meta.url)), 'focus', 'build', input, '-o', output], {
      encoding: 'utf8', cwd: root, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
        XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'h2a') },
    });
    assert.equal(result.status, 0, result.stderr);
    browser = await chromium.launch({ headless: true, env: { ...process.env, XDG_RUNTIME_DIR: root } });
    for (const width of [1366, 390, 320]) {
      const mobile = width < 600;
      const variant = mobile ? 'narrow' : 'wide';
      const context = await browser.newContext({ offline: true, viewport: { width, height: mobile ? 844 : 1000 },
        isMobile: mobile, hasTouch: mobile, colorScheme: 'light' });
      const page = await context.newPage(), errors = [], network = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
      page.on('request', req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
      await page.goto(pathToFileURL(output).href);
      const activeSvg = page.locator(`[data-renderer="r7"] .ds-diagram-mount[data-variant="${variant}"] .ds-diagram-svg`);
      await activeSvg.waitFor({ state: 'visible' });
      assert.equal(await page.title(), await page.locator('h1').innerText());
      assert.equal(await page.locator('.focus-glossary summary').innerText(), 'Glossaire (1 terme)');
      assert.equal(await page.locator('.focus-glossary').evaluate(el => el.open), false);
      assert.equal(await page.locator('img').count(), 0);
      assert.match(await page.locator('main').innerText(), /<img src=x onerror=alert\(1\)>/);
      assert.ok(await page.locator('h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 20));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
      await page.getByRole('button', { name: /Fichier portable/ }).click();
      assert.equal(await page.getByRole('button', { name: /Fichier portable/ }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: /Page hébergée/ }).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.getByRole('button', { name: /Page hébergée/ }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: 'Thème sombre' }).click();
      assert.equal(await page.locator('.focus-page').getAttribute('data-mode'), 'dark');
      assert.equal(await page.locator('.st-card').first().evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
      assert.ok(await activeSvg.locator('[data-scene-connectors] [data-scene-edge]').count() > 0, 'DS connectors rendered');
      assert.ok(await activeSvg.locator('.st-diagramCard-body').count() > 0, 'DS node bodies rendered');
      await page.getByRole('button', { name: 'Thème clair' }).click();
      const box = await activeSvg.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `${variant} r7 SVG has non-zero rendered bounds`);
      assert.deepEqual(errors, [], 'no browser runtime errors');
      assert.deepEqual(network, [], 'no network requests');
      console.log(`${mobile ? `phone ${width}px (${variant})` : `desktop (${variant})`}: r7 SVG, cards, keyboard, themes, offline OK`);
      await context.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('presents all option sets with their question and resolves labels across sets', async t => {
  const root = mkdtempSync(join(tmpdir(), 'focus-options-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    const question = doc.sections.find(s => s.kind === 'question');
    const set = doc.sections.find(s => s.kind === 'optionSet');
    question.recommendedAnswer = 'Ce choix facilite le partage et la lecture hors connexion.';
    const secondQuestion = { ...question, id: 'timing', targetRef: 'timing', question: 'Quand préparer le dossier ?',
      recommendedOptionId: 'today', recommendedAnswer: "Aujourd’hui, pour préparer la réunion." };
    const secondSet = { ...set, id: 'timing-options', targetRef: 'timing-options', questionId: 'timing', title: 'Calendrier',
      options: [{ ...set.options[0], id: 'today', targetRef: 'today', label: 'Aujourd’hui' },
        { ...set.options[1], id: 'later', targetRef: 'later', label: 'Demain' }] };
    const firstSet = { ...set, options: [set.options[0]] };
    const splitSet = { ...set, id: 'other-formats', targetRef: 'other-formats', options: [set.options[1]] };
    doc.sections = [question, secondQuestion, secondSet, firstSet, splitSet, doc.sections.find(s => s.kind === 'diagram')];
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html');
    writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../dist/bin.js', import.meta.url)), 'focus', 'build', input, '-o', output], {
      encoding: 'utf8', cwd: root, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
        XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'h2a') },
    });
    assert.equal(result.status, 0, result.stderr);
    browser = await chromium.launch({ headless: true, env: { ...process.env, XDG_RUNTIME_DIR: root } });
    const context = await browser.newContext({ offline: true, viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(output).href);
    await page.locator('[data-renderer="r7"] .ds-diagram-mount[data-variant="narrow"] .ds-diagram-svg').waitFor({ state: 'visible' });
    await t.test('selection in one set is named in all sets of the same question', async () => {
      for (const label of ['Fichier portable', 'Page hébergée']) {
        await page.getByRole('button', { name: new RegExp(label) }).click();
        for (const id of ['formats', 'other-formats']) {
          assert.match(await page.locator(`#${id} .selection`).innerText(), new RegExp(`Sélection locale : ${label}\\.`));
        }
        assert.match(await page.locator('#timing-options .selection').innerText(), /Sélectionnez une option/);
      }
    });
    await t.test('linked sets follow their question once regardless of input order', async () => {
      assert.deepEqual(await page.locator('.dossier-section').evaluateAll(nodes => nodes.slice(0, 5).map(n => n.id)),
        ['format', 'formats', 'other-formats', 'timing', 'timing-options']);
      assert.equal(await page.locator('#formats').count(), 1);
      assert.equal(await page.locator('#other-formats').count(), 1);
    });
    await t.test('recommendation names its option once before the reason', async () => {
      assert.match(await page.locator('#format .recommendation').innerText(), /Fichier portable — Ce choix/);
      assert.equal((await page.locator('#timing .recommendation').innerText()).match(/Aujourd’hui/g).length, 1);
    });
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a payload without views draws the DC-1 cards from its scene, and a refused scene shows typed diagnostics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-no-views-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    const semantic = JSON.parse(readFileSync(new URL('../../../focus/tests/diagram-core-generic.fixture.json', import.meta.url), 'utf8'));
    doc.sections.find(s => s.kind === 'diagram').scene = semantic;
    const input = join(root, 'dossier.json'), output = join(root, 'decision.html');
    writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../dist/bin.js', import.meta.url)), 'focus', 'build', input, '-o', output], {
      encoding: 'utf8', cwd: root, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root,
        XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, H2A_ROOT: join(root, 'h2a') },
    });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(output, 'utf8');
    const block = /<script type="application\/json" data-focus-document>([\s\S]*?)<\/script>/.exec(html);
    const built = JSON.parse(block[1]);
    const diagramId = built.document.sections.find(s => s.kind === 'diagram').id;
    // A store that keeps only the built document and its build stamp injects no views.
    const inject = (name, payload) => {
      const file = join(root, name);
      writeFileSync(file, html.replace(block[0], () => `<script type="application/json" data-focus-document>${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`));
      return pathToFileURL(file).href;
    };
    const withoutViews = inject('no-views.html', { document: built.document, build: built.build });
    const refusedDocument = structuredClone(built.document);
    const refusedNode = refusedDocument.sections.find(s => s.kind === 'diagram').scene.entities['entity:coordinator'];
    refusedNode.attributes.name.value = 'Coordinationinterorganisationnelledurablepermanente';
    const refused = inject('refused.html', { document: refusedDocument, build: built.build });
    browser = await chromium.launch({ headless: true, env: { ...process.env, XDG_RUNTIME_DIR: root } });
    const context = await browser.newContext({ offline: true, viewport: { width: 1366, height: 1000 } });
    const page = await context.newPage(), errors = [], network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
    await page.goto(withoutViews);
    const activeSvg = page.locator('[data-renderer="r7"] .ds-diagram-mount[data-variant="wide"] .ds-diagram-svg');
    await activeSvg.waitFor({ state: 'visible' });
    assert.equal(await activeSvg.locator('g[data-scene-occurrence]').count(), Object.keys(semantic.entities).length);
    for (const entityId of Object.keys(semantic.entities)) {
      const node = activeSvg.locator(`g[data-scene-occurrence="occurrence:e.${entityId.slice('entity:'.length)}"]`);
      const box = await node.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `${entityId} is not an empty 0x0 node`);
    }
    assert.equal(await activeSvg.evaluate((el, svg) => {
      const reference = document.createElement('div');
      reference.innerHTML = svg;
      return el.outerHTML === reference.querySelector('svg')?.outerHTML;
    }, built.diagrams[diagramId].wide.svg), true, 'renderer draws the exact build r7 inline SVG');
    assert.equal(await page.locator('[role="alert"]').count(), 0);
    await page.goto(refused);
    const alert = page.locator('figure [role="alert"]');
    await alert.waitFor({ timeout: 10000 });
    const text = await alert.innerText();
    for (const part of [/card-overflow/, /\btitle\b/, /entity:coordinator/, /Coordinationinterorganisationnelledurablepermanente/, /\d+(?:\.\d+)? px > \d+(?:\.\d+)? px/]) {
      assert.match(text, part, 'the refusal names its typed diagnostic');
    }
    assert.equal(await page.locator('.ds-diagram-svg').count(), 0, 'a refused diagram draws no empty SVG');
    assert.deepEqual(errors, [], 'no browser runtime errors');
    assert.deepEqual(network, [], 'no network requests');
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('artifact fragment renders at 390 and 800 px inside an artifact shell with the phone/desktop variants', async () => {
  const root = mkdtempSync(join(tmpdir(), 'focus-artifact-shell-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    // Small drawn scene (1213 units, readability scale 437 px): the measured fit shows the column
    // variant at 390 px and the horizontal one at 800 px inside the artifact panel.
    Object.assign(doc.sections.find(s => s.kind === 'diagram'), { alt: 'La rédaction transmet le dossier à la lecture.',
      source: 'flowchart LR\nwriter["Rédaction"]\nreader["Lecture"]\nwriter -->|transmet| reader' });
    const { buildFocusDossier } = await import('../../dist/focus-build.js');
    const fragment = buildFocusDossier(doc, { target: 'artifact' });
    assert.doesNotMatch(fragment, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
    // Minimal artifact-shell stub: the host owns the document shell and the CSP.
    const shell = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shell</title></head><body><div class="artifact-panel" style="max-width:60rem;margin:0 auto">${fragment}</div></body></html>`;
    const file = join(root, 'shell.html');
    writeFileSync(file, shell);
    browser = await chromium.launch({ headless: true, env: { ...process.env, XDG_RUNTIME_DIR: root } });
    for (const [width, variant] of [[390, 'phone'], [800, 'wide']]) {
      const context = await browser.newContext({ offline: true, viewport: { width, height: 900 }, colorScheme: 'light' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(file).href);
      const active = page.locator(`[data-renderer="r7"] .ds-diagram-mount[data-variant="${variant}"] .ds-diagram-svg`);
      await active.waitFor({ state: 'visible' });
      const hidden = variant === 'wide' ? 'narrow' : 'wide';
      assert.equal(await page.locator(`[data-renderer="r7"] .ds-diagram-mount[data-variant="${hidden}"] .ds-diagram-svg`).isVisible(), false);
      assert.equal(await page.locator('h1').innerText(), doc.title);
      assert.equal(await page.locator('.focus-glossary summary').innerText(), 'Glossaire (1 terme)');
      assert.equal(await page.locator('.focus-glossary').evaluate(el => el.open), false);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal page overflow at ${width}px`);
      const box = await active.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `${variant} r7 SVG has non-zero rendered bounds at ${width}px`);
      assert.ok(box.width <= width, `diagram keeps its natural size at ${width}px`);
      assert.deepEqual(errors, [], 'no browser runtime errors');
      await context.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

// Owner regression « trop de marge sur le côté »: the DS Container owns the only side gutter
// (max-inline-size lg + 1rem padding), main only centers and pads vertically. A doubled gutter
// would put 16 px of main padding on top of the 16 px container gutter.
test('the DS container owns a single side gutter: main content is 358 px at 390 and 992 px at 1440', async () => {
  const { buildFocusDossier } = await import('../../dist/focus-build.js');
  const root = mkdtempSync(join(tmpdir(), 'focus-gutter-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    const output = join(root, 'gutter.html');
    writeFileSync(output, buildFocusDossier(doc));
    browser = await chromium.launch({ headless: true });
    for (const [width, mainWidth] of [[390, 358], [1440, 992]]) {
      const context = await browser.newContext({ offline: true, viewport: { width, height: 900 }, colorScheme: 'light' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      await page.locator('main').waitFor();
      const measured = await page.evaluate(() => {
        const main = document.querySelector('main');
        const style = getComputedStyle(main);
        const box = main.getBoundingClientRect();
        const first = main.querySelector('.reading-meta');
        const gap = first.getBoundingClientRect().left - box.left;
        return { mainWidth: box.width, padLeft: style.paddingLeft, padRight: style.paddingRight, gap };
      });
      assert.equal(Math.round(measured.mainWidth), mainWidth, `${width}px viewport: DS lg content width`);
      assert.equal(measured.padLeft, '0px', `${width}px viewport: main adds no side padding`);
      assert.equal(measured.padRight, '0px', `${width}px viewport: main adds no side padding`);
      assert.ok(Math.abs(measured.gap) < 1, `${width}px viewport: text starts at the container edge (gap ${measured.gap})`);
      assert.deepEqual(errors, [], 'no browser runtime errors');
      await context.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

// Untyped 4-step LR flowchart now renders as process@1 simple boxes (scale >= 0.9, TB on 390/800 and
// LR at 1.0 on 1440), while explicit diagramType "architecture" keeps reduced generic@1 cards.
test('a four-step LR flowchart keeps a sane rendered size on phone, tablet and desktop', async () => {
  const { buildFocusDossier } = await import('../../dist/focus-build.js');
  const { pickDiagramVariant, displayWidth, WIDE_MIN_READABLE_SCALE } = await import('../src/diagram-fit.js');
  assert.equal(pickDiagramVariant(1126, 2501), 'wide');
  assert.equal(pickDiagramVariant(2501 * WIDE_MIN_READABLE_SCALE - 1, 2501), 'narrow');
  assert.equal(pickDiagramVariant(700, 1900), 'wide', 'a three-step flow stays horizontal on a 700 px stage');
  assert.equal(pickDiagramVariant(1126, 3334), 'wide', 'a large scene stays horizontal on a desktop stage');
  assert.equal(pickDiagramVariant(742, 3334), 'narrow');
  assert.equal(displayWidth('narrow', 640), 320);
  const root = mkdtempSync(join(tmpdir(), 'focus-diagram-size-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    Object.assign(doc.sections.find(s => s.kind === 'diagram'), { alt: 'Quatre étapes de la demande à la livraison.',
      source: ['flowchart LR', 'a["Demande"]', 'b["Analyse"]', 'c["Décision"]', 'd["Livraison"]',
        'a -->|envoie| b', 'b -->|propose| c', 'c -->|lance| d'].join('\n') });
    const output = join(root, 'flow.html');
    writeFileSync(output, buildFocusDossier(doc));
    browser = await chromium.launch({ headless: true });
    const expected = {
      390: { variant: 'narrow', width: [110, 220], height: [300, 500], scaleMin: 0.95 },
      800: { variant: 'narrow', width: [110, 220], height: [300, 500], scaleMin: 0.95 },
      1440: { variant: 'wide', width: [700, 960], height: [40, 120], scaleMin: 0.98 },
    };
    for (const [viewport, bounds] of Object.entries(expected)) {
      const width = Number(viewport), mobile = width < 600;
      const context = await browser.newContext({ offline: true, viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      await page.goto(pathToFileURL(output).href);
      const stage = page.locator('[data-renderer="r7"]');
      await stage.locator(`.ds-diagram-mount[data-variant="${bounds.variant}"] .ds-diagram-svg`).waitFor({ state: 'visible' });
      const seen = await stage.evaluate(el => {
        const shown = [...el.querySelectorAll('.ds-diagram-svg')].filter(svg => svg.getBoundingClientRect().width > 0);
        const box = shown[0].getBoundingClientRect(), scale = box.width / shown[0].viewBox.baseVal.width;
        const titleEl = shown[0].querySelector('.st-diagramProcessBox text:not([data-process-step-badge])');
        const title = titleEl ? parseFloat(getComputedStyle(titleEl).fontSize) * scale : NaN;
        return { count: shown.length, variant: shown[0].dataset.variant, width: box.width, height: box.height, scale, title,
          toggles: shown[0].querySelectorAll('[data-toggle]').length, icons: shown[0].querySelectorAll('.st-diagramCard-icon').length };
      });
      assert.equal(seen.count, 1, `${width}px: exactly one variant is displayed`);
      assert.equal(seen.variant, bounds.variant, `${width}px: displayed variant`);
      assert.equal(seen.toggles, 0, `${width}px: process@1 has 0 fold toggles`);
      assert.equal(seen.icons, 0, `${width}px: process@1 has 0 component icons`);
      assert.ok(seen.width >= bounds.width[0] && seen.width <= bounds.width[1], `${width}px: width ${seen.width.toFixed(1)} outside [${bounds.width}]`);
      assert.ok(seen.height >= bounds.height[0] && seen.height <= bounds.height[1], `${width}px: height ${seen.height.toFixed(1)} outside [${bounds.height}]`);
      assert.ok(seen.scale >= bounds.scaleMin, `${width}px: scale ${seen.scale.toFixed(3)} below ${bounds.scaleMin}`);
      assert.ok(seen.title >= 12.6 && seen.title <= 15, `${width}px: process title CSS size ${seen.title.toFixed(2)}px outside [12.6, 15]`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal page overflow`);
      await context.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

// Owner regression « en bref en bref en bref »: legacy dossiers may still carry the marker the gate
// used to require; the reader no longer sees it. The embedded document must stay untouched (it is
// re-validated at load).
test('the takeaway marker carried by legacy dossiers is not displayed', async () => {
  const { buildFocusDossier } = await import('../../dist/focus-build.js');
  const { withoutTakeawayMarker } = await import('../src/takeaway.js');
  assert.equal(withoutTakeawayMarker('En bref : le fichier suffit. Il se partage.'), 'Le fichier suffit. Il se partage.');
  assert.equal(withoutTakeawayMarker('In short: écrire court.\nEn bref :  Déjà en capitale.'), 'Écrire court.\nDéjà en capitale.');
  assert.equal(withoutTakeawayMarker('Fichier portable — En bref : il se lit hors connexion.'), 'Fichier portable — Il se lit hors connexion.');
  assert.equal(withoutTakeawayMarker('Le résumé, en bref : inchangé.'), 'Le résumé, en bref : inchangé.');
  assert.equal(withoutTakeawayMarker(undefined), undefined);
  const root = mkdtempSync(join(tmpdir(), 'focus-takeaway-'));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const name of ['decision', 'evidence']) {
      const doc = JSON.parse(readFileSync(new URL(`./fixtures/renderer-parity/${name}.input.json`, import.meta.url), 'utf8'));
      // Fixtures and templates are clean since the requirement was dropped: inject one legacy marker.
      const prose = doc.sections.find(s => s.kind === 'prose');
      prose.markdown = `En bref : ${prose.markdown.charAt(0).toLowerCase()}${prose.markdown.slice(1)}`;
      const marked = JSON.stringify(doc).match(/En bref\s*:|In short:/g)?.length ?? 0;
      assert.equal(marked, 1, `${name}: the legacy marker was injected`);
      const html = buildFocusDossier(doc), output = join(root, `${name}.html`);
      assert.equal(html.match(/data-focus-document>([\s\S]*?)<\/script>/)[1].match(/En bref\s*:|In short:/g).length, marked,
        `${name}: the embedded document keeps every marker`);
      writeFileSync(output, html);
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      await page.locator('.dossier-section').first().waitFor();
      for (const details of await page.locator('details').all()) await details.evaluate(el => { el.open = true; });
      const text = await page.locator('body').innerText();
      assert.doesNotMatch(text, /En bref\s*:|In short:/, `${name}: no marker in the displayed text`);
      assert.match(await page.locator('p.prose').first().innerText(), /^\p{Lu}/u, `${name}: the takeaway sentence starts with a capital`);
      assert.deepEqual(errors, [], `${name}: the document still validates at load`);
      await page.close();
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('inlined theme CSS with :root and [data-theme] overrides ThemeProvider tokens offline under strict CSP', async () => {
  const { buildFocusDossier } = await import('../../dist/focus-build.js');
  const root = mkdtempSync(join(tmpdir(), 'focus-theme-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    const css = `:root, [data-theme="devmtl"] {\n  --st-semantic-surface-default: rgb(18, 24, 38);\n  --st-semantic-text-primary: rgb(245, 247, 250);\n}\n`;
    const html = buildFocusDossier(doc, { themeCss: css, themeId: 'devmtl' });
    const output = join(root, 'devmtl.html');
    writeFileSync(output, html);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage(), errors = [], cspViolations = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations = (window.__cspViolations || []);
        window.__cspViolations.push(`${e.violatedDirective}:${e.blockedURI}`);
      });
    });
    await page.goto(pathToFileURL(output).href);
    await page.locator('.focus-page').waitFor({ state: 'visible' });
    const observed = await page.evaluate(() => {
      const pageEl = document.querySelector('.focus-page');
      const style = getComputedStyle(pageEl);
      return {
        rootTheme: document.documentElement.getAttribute('data-theme'),
        bg: style.backgroundColor,
        color: style.color,
        violations: window.__cspViolations || [],
      };
    });
    cspViolations.push(...observed.violations);
    assert.equal(observed.rootTheme, 'devmtl');
    assert.equal(observed.bg, 'rgb(18, 24, 38)');
    assert.equal(observed.color, 'rgb(245, 247, 250)');
    assert.deepEqual(cspViolations, []);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('artifact target with <body> and <script> comments in theme CSS keeps scripts inert and applies tokens in host shell', async () => {
  const { buildFocusDossier } = await import('../../dist/focus-build.js');
  const root = mkdtempSync(join(tmpdir(), 'focus-theme-artifact-browser-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    const css = [
      '/* <body> */',
      '/* <script>window.__injected = "theme-css-script-ran"</script> */',
      ':root{--st-semantic-feedback-info:#4a4f8f;--st-semantic-surface-default:rgb(18, 24, 38)}',
    ].join('\n');
    const fragment = buildFocusDossier(doc, { target: 'artifact', themeCss: css, themeId: 'devmtl' });
    const shell = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Artifact Host</title></head><body>${fragment}</body></html>`;
    const output = join(root, 'artifact-shell.html');
    writeFileSync(output, shell);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(output).href);
    await page.locator('.focus-page').waitFor({ state: 'visible' });
    const observed = await page.evaluate(() => {
      const pageEl = document.querySelector('.focus-page');
      return {
        injected: window.__injected ?? null,
        themeCount: document.querySelectorAll('style[data-focus-theme]').length,
        info: getComputedStyle(pageEl).getPropertyValue('--st-semantic-feedback-info').trim(),
        bg: getComputedStyle(pageEl).backgroundColor,
      };
    });
    assert.equal(observed.injected, null);
    assert.equal(observed.themeCount, 1);
    assert.equal(observed.info, '#4a4f8f');
    assert.equal(observed.bg, 'rgb(18, 24, 38)');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('Lot 1 process@1 acceptance (light/dark, offline CSP): 5 steps LR 1.0 at 1440px, TB >= 0.9 at 72ch, clean column at 390px, 0 scroll in document & artifact', async () => {
  const { buildFocusDossier } = await import('../../dist/focus-build.js');
  const root = mkdtempSync(join(tmpdir(), 'focus-lot1-process-'));
  let browser;
  try {
    const doc = JSON.parse(readFileSync(new URL('../dossier.template.json', import.meta.url), 'utf8'));
    Object.assign(doc.sections.find(s => s.kind === 'diagram'), {
      diagramType: 'workflow',
      alt: 'Cinq étapes séquentielles de la réception à l’archive.',
      source: [
        'flowchart LR',
        's1["Réception"]',
        's2["Tri"]',
        's3["Revue"]',
        's4["Validation"]',
        's5["Archive"]',
        's1 -->|brut| s2',
        's2 -->|qualifié| s3',
        's3 -->|conforme| s4',
        's4 -->|validé| s5',
      ].join('\n'),
    });
    const svelteDocPath = join(root, 'svelte-doc.html');
    writeFileSync(svelteDocPath, buildFocusDossier(doc, { renderer: 'svelte', target: 'document' }));
    const svelteArtifactPath = join(root, 'svelte-artifact-72ch.html');
    const svelteFragment = buildFocusDossier(doc, { renderer: 'svelte', target: 'artifact' });
    writeFileSync(svelteArtifactPath, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artifact 72ch</title></head><body><main style="max-width:72ch;margin:0 auto">${svelteFragment}</main></body></html>`);
    const vueDocPath = join(root, 'vue-doc.html');
    writeFileSync(vueDocPath, buildFocusDossier(doc, { renderer: 'vue', target: 'document' }));
    const vueArtifactPath = join(root, 'vue-artifact-72ch.html');
    const vueFragment = buildFocusDossier(doc, { renderer: 'vue', target: 'artifact' });
    writeFileSync(vueArtifactPath, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vue Artifact 72ch</title></head><body><main style="max-width:72ch;margin:0 auto">${vueFragment}</main></body></html>`);

    browser = await chromium.launch({ headless: true });
    for (const [rendererName, docPath, artPath] of [
      ['svelte', svelteDocPath, svelteArtifactPath],
      ['vue', vueDocPath, vueArtifactPath],
    ]) {
      for (const colorScheme of ['light', 'dark']) {
        for (const [label, filePath, viewportWidth] of [
          ['desktop-1440', docPath, 1440],
          ['col-72ch-artifact', artPath, 1024],
          ['col-640-doc', docPath, 640],
          ['mobile-390-doc', docPath, 390],
          ['mobile-390-art', artPath, 390],
        ]) {
          const context = await browser.newContext({ offline: true, viewport: { width: viewportWidth, height: 900 }, colorScheme });
          const page = await context.newPage(), errors = [], network = [];
          page.on('pageerror', e => errors.push(e.message));
          page.on('request', req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
          await page.goto(pathToFileURL(filePath).href);
          await page.waitForFunction((expectRow) => {
            const boxes = [...document.querySelectorAll('.st-diagramProcessBox')].filter(el => el.getBoundingClientRect().width > 0);
            if (boxes.length !== 5) return false;
            const ys = new Set(boxes.map(el => Math.round(el.getBoundingClientRect().y)));
            const xs = new Set(boxes.map(el => Math.round(el.getBoundingClientRect().x)));
            return expectRow ? ys.size === 1 : xs.size === 1;
          }, label === 'desktop-1440', { timeout: 10000 });

          const metrics = await page.evaluate((isVue) => {
            const scrollOverflow = document.documentElement.scrollWidth > window.innerWidth;
            const visibleBoxes = [...document.querySelectorAll('.st-diagramProcessBox')].filter(el => el.getBoundingClientRect().width > 0);
            const ys = visibleBoxes.map(el => Math.round(el.getBoundingClientRect().y));
            const xs = visibleBoxes.map(el => Math.round(el.getBoundingClientRect().x));
            const radii = visibleBoxes.map(el => Number(el.querySelector('rect')?.getAttribute('rx') ?? 0));
            const icons = [...document.querySelectorAll('.st-diagramCard-icon')].filter(el => el.getBoundingClientRect().width > 0).length;
            const toggles = [...document.querySelectorAll('[data-toggle], .st-diagramCard-toggle')].filter(el => el.getBoundingClientRect().width > 0).length;
            const visibleEdges = [...document.querySelectorAll('[data-scene-edge]')].filter(el => el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0).length;
            const visibleLabels = [...document.querySelectorAll('[data-scene-label]')].filter(el => el.getBoundingClientRect().width > 0).length;
            const table = document.querySelector('details.st-diagramProcessTable');
            let scale;
            if (!isVue) {
              const svg = [...document.querySelectorAll('.ds-diagram-svg')].find(el => el.getBoundingClientRect().width > 0);
              scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
            } else {
              const fig = document.querySelector('.st-diagramSceneFigure');
              const vp = document.querySelector('.st-diagramSceneFigure-viewport');
              const raw = (vp ? getComputedStyle(vp).getPropertyValue('--st-diagram-zoom').trim() : '') || fig?.dataset.zoom || '';
              scale = raw ? parseFloat(raw) : NaN;
            }
            return { scrollOverflow, boxCount: visibleBoxes.length, ys, xs, radii, icons, toggles, visibleEdges, visibleLabels, hasTable: Boolean(table), scale };
          }, rendererName === 'vue');

          const tag = `${rendererName}/${colorScheme}/${label}`;
          assert.equal(metrics.scrollOverflow, false, `${tag}: zero horizontal scroll`);
          assert.equal(metrics.boxCount, 5, `${tag}: 5 visible process steps`);
          assert.ok(metrics.radii.every(rx => rx >= 8), `${tag}: rounded process boxes (${metrics.radii})`);
          assert.equal(metrics.icons, 0, `${tag}: 0 component icons`);
          assert.equal(metrics.toggles, 0, `${tag}: 0 fold buttons`);
          assert.equal(metrics.visibleEdges, 4, `${tag}: 4 visible edges`);
          assert.equal(metrics.visibleLabels, 4, `${tag}: 4 visible edge labels`);
          assert.equal(metrics.hasTable, true, `${tag}: <details class="st-diagramProcessTable"> present`);
          assert.ok(Number.isFinite(metrics.scale) && metrics.scale >= 0.9, `${tag}: rendered scale ${metrics.scale} >= 0.9`);
          if (label === 'desktop-1440') {
            assert.ok(Math.abs(metrics.scale - 1) <= 0.02, `${tag}: 1440px scale === 1.0 (got ${metrics.scale})`);
            assert.equal(new Set(metrics.ys).size, 1, `${tag}: 5 steps aligned on 1 LR row (ys=${metrics.ys})`);
          } else {
            assert.equal(new Set(metrics.xs).size, 1, `${tag}: 5 steps stacked cleanly in TB column (xs=${metrics.xs})`);
          }
          assert.deepEqual(errors, [], `${tag}: 0 browser errors`);
          assert.deepEqual(network, [], `${tag}: 0 network requests`);
          await context.close();
        }
      }
    }
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});
