import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

test('xyflow consumes diagram-core entities, links and nested containers without a Focus graph', async () => {
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
    await page.locator('.svelte-flow__node').first().waitFor();
    assert.equal(await page.locator('.svelte-flow__node').count(), 4);
    for (const entity of Object.values(semantic.entities)) {
      assert.equal(await page.locator('.svelte-flow__node').getByText(entity.attributes.name.value, { exact: true }).count(), 1);
    }
    for (const [child, parent] of [['models', 'root'], ['gateway', 'models'], ['coordinator', 'root']]) {
      const childBox = await page.locator(`.svelte-flow__node[data-id="entity:${child}"]`).boundingBox();
      const parentBox = await page.locator(`.svelte-flow__node[data-id="entity:${parent}"]`).boundingBox();
      assert.ok(childBox.x > parentBox.x && childBox.y > parentBox.y, `${child} starts inside ${parent}`);
      assert.ok(childBox.x + childBox.width < parentBox.x + parentBox.width && childBox.y + childBox.height < parentBox.y + parentBox.height, `${child} fits inside ${parent}`);
    }
    assert.equal(await page.locator('.svelte-flow__edge').count(), 2, 'contains relations are grouping, not links');
    assert.equal(await page.locator('.svelte-flow__edge-label').getByText('Demandes', { exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    console.log('diagram-core: names, optional link label, nested containers, phone offline OK');
  } finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('portable Focus works offline on desktop and phone, including touch pinch and safe text', async () => {
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
      const context = await browser.newContext({ offline: true, viewport: { width, height: mobile ? 844 : 1000 },
        isMobile: mobile, hasTouch: mobile, colorScheme: 'light' });
      const page = await context.newPage(), errors = [], network = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
      page.on('request', req => { if (/^https?:/.test(req.url())) network.push(req.url()); });
      await page.goto(pathToFileURL(output).href);
      await page.locator('.svelte-flow__node').first().waitFor();
      assert.equal(await page.title(), await page.locator('h1').innerText());
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
      assert.equal(await page.locator('.svelte-flow__edge-path').first().evaluate(el => getComputedStyle(el).strokeWidth), '1px');
      await page.getByRole('button', { name: 'Thème clair' }).click();
      const canvas = page.locator('.canvas'), viewport = page.locator('.svelte-flow__viewport');
      await canvas.scrollIntoViewIfNeeded();
      const beforeZoom = await viewport.getAttribute('style');
      await page.locator('.svelte-flow__controls-zoomin').click();
      await page.waitForFunction(before => document.querySelector('.svelte-flow__viewport').getAttribute('style') !== before, beforeZoom);
      if (mobile) {
        const session = await context.newCDPSession(page);
        const box = await canvas.boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const beforePinch = await viewport.getAttribute('style');
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
        for (const distance of [40, 55, 70, 90]) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance, y, id: 1 }, { x: x + distance, y, id: 2 }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(before => document.querySelector('.svelte-flow__viewport').getAttribute('style') !== before, beforePinch);
        await session.detach();
      }
      assert.deepEqual(errors, [], 'no browser runtime errors');
      assert.deepEqual(network, [], 'no network requests');
      console.log(`${mobile ? `phone ${width}px + touch pinch` : 'desktop'}: cards, keyboard, themes, 1px, offline OK`);
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
    await page.locator('.svelte-flow__node').first().waitFor();
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
