import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import {
  ANCHOR_CAP, anchorLabel, decodeAnchor, encodeAnchor, encodeAnchorCapped,
  filterThreads, fitsAnchorCap, groupThreads, isUnread, layoutPins, renderMarkdownLite,
} from '../review/review-core.js';
import { FakeCommentsAdapter } from '../review/adapter.js';

const user = { actorId: 'owner', kind: 'human', displayLabel: 'Owner', color: '#2563eb' };
function memoryStorage() {
  const rows = new Map();
  return { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, String(v)), removeItem: k => rows.delete(k) };
}
function comment(id, threadId, body, extra = {}) {
  return {
    id, threadId, body,
    target: { kind: 'artifact', id: 'art-1', sectionKey: encodeAnchor({ t: 'text', q: { exact: body }, v: 'v1' }) },
    author: { id: 'owner' }, state: 'open',
    createdAt: `2026-11-18T10:00:0${id}Z`, ...extra,
  };
}

test('anchor round-trip keeps W3C quote, element path and version', () => {
  const payload = { t: 'text', q: { exact: 'Décision “importante”', prefix: 'avant ', suffix: ' après' }, pos: { start: 6, end: 28 }, sel: 'p:nth-of-type(2)', v: 'draft:1' };
  const encoded = encodeAnchor(payload);
  assert.ok(encoded.startsWith('a1:'));
  assert.deepEqual(decodeAnchor(encoded), payload);
  assert.equal(decodeAnchor('plain-section'), null);
  assert.equal(decodeAnchor('a1:not-base64!!'), null);
});

test('anchor cap: 2048 chars enforced, encoder shortens quote context first', () => {
  const huge = { t: 'text', q: { exact: 'x'.repeat(5000), prefix: 'p'.repeat(500), suffix: 's'.repeat(500) }, v: 'v1' };
  const encoded = encodeAnchorCapped(huge);
  assert.ok(encoded.length <= ANCHOR_CAP, `${encoded.length} <= ${ANCHOR_CAP}`);
  assert.ok(fitsAnchorCap(encoded));
  assert.equal(fitsAnchorCap('a'.repeat(ANCHOR_CAP + 1)), false);
  assert.throws(() => encodeAnchorCapped({ t: 'element', sel: 'a'.repeat(5000), v: 'v' }), /2048/);
});

test('grouping, filters, unread and labels follow the DS view model', () => {
  const threads = groupThreads([
    comment('3', 't2', 'second thread'),
    comment('1', 't1', 'first thread'),
    comment('2', 't1', 'reply here', { author: { id: 'agent-1' } }),
  ]);
  assert.equal(threads.length, 2);
  assert.deepEqual(threads[0].comments.map(c => c.id), ['1', '2']);
  assert.equal(threads[0].state, 'open');
  assert.equal(filterThreads(threads, 'mine', 'agent-1').visible.length, 1);
  assert.equal(filterThreads(threads, 'closed', 'owner').counts.closed, 0);
  assert.equal(isUnread(threads[0], '2026-11-18T10:00:00Z', 'owner'), true);
  assert.equal(isUnread(threads[0], '2026-11-19T10:00:00Z', 'owner'), false);
  assert.ok(anchorLabel(threads[0].anchor).includes('first thread'));
  const long = anchorLabel({ t: 'text', q: { exact: ' mot'.repeat(100) } });
  assert.ok(long.length <= 140);
});

test('layoutPins sorts by Y with a 28px minimum gap and clamps to the container', () => {
  const pins = layoutPins([{ y: 100 }, { y: 90 }, { y: 95 }], 120);
  // Trié 90, 95→118, 100→146, puis débordement 26 retiré : 64, 92, 120.
  assert.deepEqual(pins.map(p => p.y), [64, 92, 120]);
  for (let i = 1; i < pins.length; i++) assert.ok(pins[i].y - pins[i - 1].y >= 28);
});

test('markdown-lite escapes raw HTML before applying emphasis', () => {
  const html = renderMarkdownLite('<script>alert(1)</script> **gras** `code` [lien](https://example.com)');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>gras</strong>'));
  assert.ok(html.includes('<code>code</code>'));
});

test('fake adapter implements the frozen contract: create, reply, close, reopen, persistence', async () => {
  const storage = memoryStorage();
  const adapter = new FakeCommentsAdapter({ artifactId: 'art-1', storage, currentUser: user, agentDelayMs: 5 });
  const events = [];
  adapter.subscribe(event => events.push(event.type));
  const anchor = encodeAnchor({ t: 'text', q: { exact: 'alpha' }, v: 'v1' });
  const first = await adapter.create({ sectionKey: anchor, body: 'First thread' });
  await adapter.create({ sectionKey: anchor, body: 'Second thread' });
  await adapter.create({ sectionKey: anchor, body: 'Third thread' });
  const reply = await adapter.create({ threadId: first.threadId, body: 'A reply' });
  assert.equal(reply.threadId, first.threadId);
  let payload = await adapter.listThreads();
  assert.equal(payload.threads.length, 3);
  assert.equal(payload.threads.find(rows => rows[0].threadId === first.threadId).length, 2);
  await adapter.close(first.threadId);
  payload = await adapter.listThreads();
  assert.equal(payload.threads.find(rows => rows[0].threadId === first.threadId)[0].state, 'closed');
  await adapter.reopen(first.threadId);
  payload = await adapter.listThreads();
  assert.equal(payload.threads.find(rows => rows[0].threadId === first.threadId)[0].state, 'open');
  assert.ok(events.includes('thread.closed') && events.includes('thread.reopened'));
  // Persistance : un nouvel adaptateur sur le même stockage relit l'état (reload).
  const reloaded = new FakeCommentsAdapter({ artifactId: 'art-1', storage, currentUser: user });
  assert.equal((await reloaded.listThreads()).threads.length, 3);
  await assert.rejects(() => adapter.create({ sectionKey: anchor, body: '  ' }), /must not be empty/);
  await assert.rejects(() => adapter.create({ sectionKey: 'a1:' + 'x'.repeat(3000), body: 'trop' }), /2048/);
});

test('fake adapter delivers a live agent reply on sendToAgent (SSE-shaped event)', async () => {
  const adapter = new FakeCommentsAdapter({ artifactId: 'art-9', storage: memoryStorage(), currentUser: user, agentDelayMs: 5 });
  const seen = [];
  adapter.subscribe(event => seen.push(event));
  const root = await adapter.create({ sectionKey: encodeAnchor({ t: 'element', sel: 'p', v: 'v1' }), body: 'Please check this', sendToAgent: true });
  await new Promise(resolve => setTimeout(resolve, 40));
  const agentEvents = seen.filter(event => event.type === 'comment.created' && event.comment?.provenance?.runId);
  assert.equal(agentEvents.length, 1);
  assert.equal(agentEvents[0].comment.threadId, root.threadId);
  assert.equal((await adapter.listThreads()).threads[0].length, 2);
});

test('all review templates compile as Vapor; only CommentThread renders markdown-lite HTML', () => {
  for (const filename of ['ReviewModeToggle.vue', 'CommentPin.vue', 'CommentComposer.vue', 'CommentThread.vue', 'ThreadPanel.vue', 'CommentLayer.vue']) {
    const source = readFileSync(new URL(`../review/${filename}`, import.meta.url), 'utf8');
    const { descriptor, errors } = parse(source, { filename });
    assert.deepEqual(errors, []);
    assert.equal(descriptor.vapor, true, filename);
    assert.doesNotMatch(source, /\bh\(/);
    if (filename !== 'CommentThread.vue') assert.doesNotMatch(source, /v-html/);
    const compiled = compileScript(descriptor, { id: filename, inlineTemplate: true });
    assert.match(compiled.content, /__vapor: true/);
  }
  const thread = readFileSync(new URL('../review/CommentThread.vue', import.meta.url), 'utf8');
  assert.match(thread, /renderMarkdownLite\(comment\.body\)/);
});
