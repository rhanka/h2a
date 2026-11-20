/**
 * Real-backend acceptance of the Vue review UI (same scenario as review-browser.test.mjs):
 * the built renderer-vue.html talks to the REAL artifact review routes through
 * HttpCommentsAdapter (`apiBase` in the payload) instead of the in-page fake.
 *
 * Backend: the PACKAGED Focus Web server (`h2a focus serve`, FOCUS_ARTIFACT_REVIEW=1) of the
 * checkout named by FOCUS_REVIEW_BACKEND_REPO (default: this checkout), with its built CLI
 * (`npm run build`), in a throwaway h2a root, HOME and XDG dirs with one registered live
 * recipient. The test fails (never skips) when the backend routes are absent.
 *
 * Host contract shown here: renderer-vue.html ships `connect-src 'none'`; a host that
 * enables review against real routes must widen connect-src to the API origin.
 * Run explicitly: node --test packages/h2a/focus-kit/test/review-real-browser.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const kit = new URL('../', import.meta.url).pathname;
const backendRepo = resolve(process.env.FOCUS_REVIEW_BACKEND_REPO || join(kit, '..', '..', '..'));
const fixture = JSON.parse(readFileSync(join(kit, 'test/fixtures/renderer-parity/decision.prepared.json'), 'utf8'));
const RECIPIENT = 'claude:review-vue-e2e:0123456789ab';

async function h2aLib() {
  return import(pathToFileURL(join(backendRepo, 'packages', 'h2a', 'dist', 'index.js')).href);
}

function world(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'focus-review-vue-real-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dirs = { base, root: join(base, 'h2a-root'), home: join(base, 'home'), run: join(base, 'run'),
    config: join(base, 'config'), state: join(base, 'state'), repo: join(base, 'repo') };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  mkdirSync(join(dirs.repo, '.track'), { recursive: true });
  writeFileSync(join(dirs.repo, '.track', 'events.jsonl'), '', 'utf8');
  return dirs;
}

async function registerRecipient(w) {
  const { createLocalStore, writePresence } = await h2aLib();
  const store = createLocalStore({ root: w.root });
  const { publicKey } = generateKeyPairSync('ed25519');
  const workspace = { id: 'ws:review-vue-e2e', path: w.repo, host: 'claude', label: 'review-vue-e2e' };
  store.registerInstance({
    id: RECIPIENT, instance: RECIPIENT, roles: ['AGENTS'], scopes: ['scope:default'], capabilities: [],
    endpoints: [{ kind: 'local-files', uri: 'file:///review-vue-e2e' }],
    publicKeys: [publicKey.export({ format: 'pem', type: 'spki' }).toString()],
    acceptedPolicies: [], createdAt: new Date().toISOString(), name: 'review-vue-e2e', workspace,
  });
  const now = new Date().toISOString();
  writePresence(w.root, {
    sessionId: `session:${RECIPIENT}`, pid: process.pid, instance: RECIPIENT, name: 'review-vue-e2e',
    startedAt: now, heartbeatAt: now, state: 'live', workspace,
    interests: { scopes: ['scope:default'], negotiations: [] }, subscribedTopics: [],
  });
  return store;
}

async function serveBackend(t, w) {
  const child = spawn(process.execPath, [join(backendRepo, 'packages', 'h2a', 'dist', 'bin.js'), 'focus', 'serve', '--repo', w.repo, '--port', '0'], {
    cwd: w.repo,
    env: {
      PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), HOME: w.home, XDG_RUNTIME_DIR: w.run,
      XDG_CONFIG_HOME: w.config, XDG_STATE_HOME: w.state, FOCUS_H2A_ROOT: w.root, FOCUS_H2A_TARGET: RECIPIENT,
      FOCUS_ARTIFACT_REVIEW: '1', FOCUS_REVIEW_OWNER_ID: 'owner', FOCUS_REVIEW_OWNER_LABEL: 'Owner',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const started = Date.now();
  while (!/Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
    if (child.exitCode !== null) throw new Error(`Focus exited before binding (code=${child.exitCode}): ${stderr}`);
    if (Date.now() - started > 20000) throw new Error(`Focus did not bind in time: ${stderr}`);
    await new Promise(done => setTimeout(done, 20));
  }
  return { url: stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1], stderr: () => stderr };
}

function buildPage(apiBase, artifactId) {
  const template = readFileSync(join(kit, 'renderer-vue.html'), 'utf8');
  assert.ok(template.includes("connect-src 'none'"), 'renderer-vue.html ships connect-src none');
  const payload = JSON.stringify({ document: fixture, mode: 'decision', review: true, artifactId, apiBase }).replace(/</g, '\\u003c');
  return template
    .replace("connect-src 'none'", `connect-src ${apiBase}`)
    .replace('<!--FOCUS_TITLE-->', 'Review acceptance (real backend)')
    .replace('<!--FOCUS_PAYLOAD-->', `<script type="application/json" data-focus-document>${payload}</script>`);
}

async function serveStatic(t, html) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/dossier.html`;
}

function commentRequests(store) {
  return store.readInbox(RECIPIENT).map(envelope => {
    const text = envelope.body.text;
    return JSON.parse(text.slice(text.indexOf('{'), text.indexOf('\n}\n') + 2));
  });
}

async function createThreadFromSection(page, sectionIndex, body) {
  const section = page.locator('[data-review-root] .dossier-section').nth(sectionIndex);
  await section.scrollIntoViewIfNeeded();
  await section.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent;
      const at = text.search(/\S.{7}/);
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
    throw new Error('No selectable text in section');
  });
  await page.getByRole('button', { name: 'Add comment' }).click({ timeout: 5000 });
  await page.locator('.st-review-composer-pop textarea').fill(body);
  await page.locator('.st-review-composer-pop').getByRole('button', { name: 'Comment', exact: true }).click();
  await page.locator('.st-review-panel').getByText(body).waitFor({ timeout: 8000 });
}

test('real backend: 3 threads, reply, delivered agent request, live agent reply, resolve, reopen, reload', async t => {
  const w = world(t);
  const store = await registerRecipient(w);
  const backend = await serveBackend(t, w);
  const artifactId = `vue-real-${Date.now()}`;
  const api = `${backend.url}/api/artifacts/${artifactId}`;
  const probe = await fetch(`${api}/comments`);
  assert.equal(probe.status, 200, `artifact review routes absent in ${backendRepo} (status ${probe.status})`);
  assert.equal(probe.headers.get('x-comments-store'), 'memory');

  const pageUrl = await serveStatic(t, buildPage(backend.url, artifactId));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const blocked = [];
  page.on('console', message => { if (/Content Security Policy|CORS/i.test(message.text())) blocked.push(message.text()); });
  const streamOpened = () => page.waitForResponse(r => r.url() === `${api}/stream` && r.status() === 200, { timeout: 15000 });
  let stream = streamOpened();
  await page.goto(pageUrl);
  await stream;
  await page.getByRole('button', { name: /Review ·/ }).click();
  await page.locator('.st-review-panel').waitFor();

  await createThreadFromSection(page, 0, 'First anchor note');
  await createThreadFromSection(page, 1, 'Second anchor note');
  const third = page.locator('[data-review-root] .dossier-section').nth(2);
  await third.scrollIntoViewIfNeeded();
  await third.locator('p, h2, h3').first().click();
  await page.locator('.st-review-composer-pop textarea').fill('Element anchor note');
  await page.locator('.st-review-composer-pop').getByRole('button', { name: 'Comment', exact: true }).click();
  await page.locator('.st-review-panel').getByText('Element anchor note').waitFor({ timeout: 8000 });
  assert.equal(await page.locator('.st-review-pin').count(), 3, '3 anchored pins');

  await page.locator('.st-review-thread-row').first().click();
  await page.getByRole('button', { name: 'Reply' }).click();
  await page.locator('.st-review-panel textarea').last().fill('Reply from owner');
  await page.locator('.st-review-panel').getByRole('button', { name: 'Reply', exact: true }).last().click();
  await page.locator('.st-review-panel').getByText('Reply from owner').waitFor({ timeout: 8000 });

  // Send the first thread to the agent: one signed comment request lands in the recipient inbox.
  await page.getByRole('button', { name: 'Reply' }).click();
  await page.locator('.st-review-panel textarea').last().fill('Agent please review');
  await page.locator('.st-review-panel').getByLabel(/Send to agent/).check();
  const sent = page.waitForResponse(r => r.url() === `${api}/comments` && r.request().method() === 'POST');
  await page.locator('.st-review-panel').getByRole('button', { name: 'Reply', exact: true }).last().click();
  const sentResponse = await sent;
  assert.equal(sentResponse.status(), 201, await sentResponse.text());
  assert.equal(sentResponse.headers()['x-agent-delivery'], 'delivered');
  const sentComment = await sentResponse.json();
  const requests = commentRequests(store);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].threadId, sentComment.threadId);

  // The recipient answers through the reply path of the request; the reply shows up live (SSE).
  const { postReply } = requests[0].reply;
  const agentReply = await fetch(postReply.url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...postReply.body, threadId: sentComment.threadId, body: 'Agent reply (real session)' }),
  });
  assert.equal(agentReply.status, 201, await agentReply.text());
  await page.locator('.st-review-panel').getByText('Agent reply (real session)').waitFor({ timeout: 15000 });
  assert.equal(commentRequests(store).length, 1, 'loop guard: the agent reply sent nothing');

  await page.locator('.st-review-thread-row').nth(1).click();
  await page.locator('.st-review-thread').getByRole('button', { name: 'Resolve' }).click();
  await page.locator('.st-review-thread').getByText('Resolved', { exact: true }).waitFor({ timeout: 8000 });
  await page.locator('.st-review-thread').getByRole('button', { name: 'Reopen' }).click();
  await page.locator('.st-review-thread').getByRole('button', { name: 'Resolve' }).waitFor({ timeout: 8000 });

  // Reload: state read back from the backend store; nothing was written to the fake.
  stream = streamOpened();
  await page.reload();
  await stream;
  await page.getByRole('button', { name: /Review · 3/ }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: /Review ·/ }).click();
  assert.equal(await page.locator('.st-review-thread-row').count(), 3, '3 threads read back after reload');
  const stored = await (await fetch(`${api}/comments`)).json();
  assert.equal(stored.threads.length, 3);
  assert.equal(stored.threads.flat().length, 6, '3 roots + owner reply + agent request + agent reply');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('h2a-review:'))), []);
  assert.deepEqual(blocked, [], 'no CSP/CORS refusal');
});
