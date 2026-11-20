// Lot H1 — Focus Web Svelte wiring & CommentsAdapter C2a/C2b contract tests (DS review kit r6).
//
// Proves:
//   1. Browser-side `createFocusHttpCommentsAdapter` implements DS r6 §1.4 `CommentsAdapter` 1:1
//      (open|closed single vocabulary, target normalisation, mandatory provenance.toolCallId on agent
//      writes, two-icon authorship, reply propagating sectionKey, threadId-keyed setState/assign(null),
//      D3 2048 cap, fail-closed 503 comments unavailable (missing binding), saved-not-delivered guard,
//      onCommentCreated human filter, reanchor omitted until S5).
//   2. Focus fixture (`loadFocusArtifactFixture`) stamps unique `targetRef`s with zero DS diagrams.
//   3. `readArtifactReviewPageConfig` gates behind `FOCUS_ARTIFACT_REVIEW`, respects `?review=1`,
//      builds host-side `CollaborationActor`, and never leaks secrets or URLs.
//   4. Packaged Focus Web (`h2a focus serve`, `packages/h2a/focus-app`) honours flag off (404/clean),
//      missing binding (`comments unavailable (missing binding)`, zero files written), unique
//      `data-anchor-id=<targetRef>` SSR rendering, and full CommentsAdapter HTTP round-trip against
//      PR #469's backend routes (including agent reply with `provenance.toolCallId` and two icons).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertPreSendProvenance,
  assertValidCommentState,
  createFocusHttpCommentsAdapter,
  FocusCommentsAdapterError,
  isHumanReviewComment,
  MAX_SECTION_KEY_LENGTH,
  MISSING_BINDING_LABEL,
  normalizeArtifactTarget,
  normalizeReviewComment
} from '../../../apps/focus/src/lib/review/http-comments-adapter.js';
import {
  collectFixtureTargetRefs,
  loadFocusArtifactFixture
} from '../../../apps/focus/src/lib/review/focus-fixture.js';
import { encodeAnchor } from '../../../apps/focus/src/lib/server/artifact-review/anchor.js';
import { readArtifactReviewPageConfig } from '../../../apps/focus/src/lib/server/artifact-review/page-config.js';

const ROOT = process.cwd();
const BIN = join(ROOT, 'packages', 'h2a', 'dist', 'bin.js');
const FIXTURE_ID = 'focus:local-review-fixture';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function listFilesRecursive(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(join(dir, entry.name), nextRel));
    else out.push(nextRel);
  }
  return out.sort();
}

test('H1 C2a/C2b contract: CommentsAdapter enforces r6 port 1:1, open|closed only, target normalisation, and no reanchor until S5', async () => {
  const calls = [];
  const sampleAnchor = encodeAnchor({ t: 'element', sel: '[data-anchor-id="question:q-storage"]', aid: 'question:q-storage', v: 'sha256:v1' });

  const adapter = createFocusHttpCommentsAdapter({
    artifactId: FIXTURE_ID,
    baseUrl: 'http://127.0.0.1:5178',
    fetchImpl: async (url, init = {}) => {
      const parsedBody = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: parsedBody });
      const href = String(url);
      if (href.includes('/comments?') && (init.method ?? 'GET') === 'GET') {
        return jsonResponse(
          {
            threads: [
              [
                {
                  id: 'cmt_1',
                  threadId: 'thr_1',
                  target: { kind: 'record', recordType: 'artifact', id: FIXTURE_ID, sectionKey: sampleAnchor },
                  author: { id: 'local-owner', displayLabel: 'Owner' },
                  state: 'open',
                  body: 'Check storage binding',
                  createdAt: '2026-11-20T10:00:00.000Z'
                },
                {
                  id: 'cmt_2',
                  threadId: 'thr_1',
                  target: { kind: 'artifact', id: FIXTURE_ID, sectionKey: sampleAnchor },
                  author: { id: 'local-owner' },
                  provenance: { toolCallId: 'agent:claude:owner:1', runId: 'claude:owner' },
                  state: 'open',
                  body: 'Resolved in sha256:v2',
                  createdAt: '2026-11-20T10:01:00.000Z'
                }
              ]
            ]
          },
          200,
          { 'x-comments-store': 'cluster-mesh-http', 'x-comments-durable': 'true' }
        );
      }
      if (href.endsWith('/threads/thr_1/close?tenant=ws-1') || href.endsWith('/threads/thr_1/reopen?tenant=ws-1')) {
        return jsonResponse({ ok: true });
      }
      if (href.endsWith('/threads/thr_1/assign')) {
        return jsonResponse({ ok: true });
      }
      if (href.endsWith('/comments/cmt_1') && init.method === 'PATCH') {
        return jsonResponse({
          id: 'cmt_1',
          threadId: 'thr_1',
          target: { kind: 'artifact', id: FIXTURE_ID, sectionKey: sampleAnchor },
          author: { id: 'local-owner' },
          state: 'open',
          body: parsedBody.body,
          createdAt: '2026-11-20T10:00:00.000Z',
          updatedAt: '2026-11-20T10:02:00.000Z'
        });
      }
      if (href.includes('/comments/cmt_1?') && init.method === 'DELETE') {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: { code: 'not_found', message: 'unexpected route' } }, 404);
    }
  });

  // `reanchor` MUST stay absent until sentropic S5.
  assert.equal('reanchor' in adapter, false);

  // Target normalisation (`record` + `recordType:'artifact'` -> `kind:'artifact'`, `recordType` dropped)
  // and two-icon authorship on agent row carrying `provenance.toolCallId`.
  const listed = await adapter.list('ws-1', { kind: 'record', recordType: 'artifact', id: FIXTURE_ID });
  assert.equal(listed.length, 2);
  assert.deepEqual(listed[0].target, { kind: 'artifact', id: FIXTURE_ID, sectionKey: sampleAnchor });
  assert.equal('recordType' in listed[0].target, false);
  assert.equal(listed[0].authorship.author.kind, 'human');
  assert.equal(listed[0].authorship.sponsor, undefined);
  assert.equal(isHumanReviewComment(listed[0]), true);

  assert.equal(listed[1].authorship.author.kind, 'agent');
  assert.equal(listed[1].authorship.sponsor?.actorId, 'local-owner');
  assert.notEqual(listed[1].authorship.author.actorId, listed[1].authorship.sponsor?.actorId);
  assert.equal(isHumanReviewComment(listed[1]), false);

  // `setState` uses `open | closed` keyed by `threadId` — never `'resolved'`.
  await adapter.setState('ws-1', 'thr_1', 'closed');
  await adapter.setState('ws-1', 'thr_1', 'open');
  await assert.rejects(
    () => adapter.setState('ws-1', 'thr_1', /** @type {any} */ ('resolved')),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'INVALID_STATE'
  );
  assert.throws(
    () => assertValidCommentState('resolved'),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'INVALID_STATE'
  );

  // `assign` preserves explicit `null` for unassignment (DS r6 §1).
  await adapter.assign('ws-1', 'thr_1', 'member-bob');
  await adapter.assign('ws-1', 'thr_1', null);
  const assignBodies = calls.filter((c) => c.url.endsWith('/threads/thr_1/assign')).map((c) => c.body);
  assert.deepEqual(assignBodies, [
    { tenant: 'ws-1', assignedTo: 'member-bob' },
    { tenant: 'ws-1', assignedTo: null }
  ]);

  // Row verbs `edit` and `remove` keyed by `commentId`.
  const edited = await adapter.edit('ws-1', 'cmt_1', 'Edited body');
  assert.equal(edited.body, 'Edited body');
  await adapter.remove('ws-1', 'cmt_1');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/comments/cmt_1?tenant=ws-1')));

  // Direct normalisation helper checks.
  assert.deepEqual(normalizeArtifactTarget({ kind: 'record', recordType: 'artifact', id: 'a1' }), {
    kind: 'artifact',
    id: 'a1'
  });
  assert.throws(
    () =>
      normalizeReviewComment(
        {
          id: 'cmt_bad',
          threadId: 'thr_bad',
          target: { kind: 'artifact', id: 'a1' },
          author: { id: 'u1' },
          state: 'resolved',
          body: 'bad state',
          createdAt: '2026-11-20T00:00:00Z'
        },
        'ws-1'
      ),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'INVALID_STATE'
  );
});

test('H1 C2b contract: pre-send checks reject non-human writes without provenance.toolCallId and sectionKey > 2048 chars', async () => {
  let fetchCalls = 0;
  const adapter = createFocusHttpCommentsAdapter({
    artifactId: FIXTURE_ID,
    baseUrl: 'http://127.0.0.1:5178',
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ ok: true });
    }
  });

  // Agent write with runId only (no toolCallId) or blank toolCallId rejected BEFORE fetch.
  await assert.rejects(
    () =>
      adapter.createAsAgent({
        tenant: 'local',
        target: { kind: 'artifact', id: FIXTURE_ID },
        body: 'Agent comment without toolCallId',
        provenance: { runId: 'claude:run-1' }
      }),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'PROVENANCE_TOOL_CALL_ID_REQUIRED'
  );
  await assert.rejects(
    () =>
      adapter.reply({
        tenant: 'local',
        target: { kind: 'artifact', id: FIXTURE_ID },
        threadId: 'thr_1',
        body: 'Blank toolCallId',
        provenance: { toolCallId: '   ' }
      }),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'PROVENANCE_TOOL_CALL_ID_REQUIRED'
  );
  assert.throws(
    () => assertPreSendProvenance(undefined, 'agent'),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'PROVENANCE_TOOL_CALL_ID_REQUIRED'
  );

  // Over-cap sectionKey (> 2048 chars, D3) rejected BEFORE fetch.
  const hugeKey = `a1:${'A'.repeat(MAX_SECTION_KEY_LENGTH)}`;
  await assert.rejects(
    () =>
      adapter.create({
        tenant: 'local',
        target: { kind: 'artifact', id: FIXTURE_ID, sectionKey: hugeKey },
        body: 'Oversized anchor'
      }),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'SECTION_KEY_TOO_LONG'
  );
  assert.equal(fetchCalls, 0, 'pre-send checks must reject before issuing any HTTP request');
});

test('H1 C2b contract: 503 comments_unavailable fails closed and saved-not-delivered preserves comment without duplicating', async () => {
  const statuses = [];
  const createdEvents = [];
  let mode = 'missing-binding';

  const adapter = createFocusHttpCommentsAdapter({
    artifactId: FIXTURE_ID,
    baseUrl: 'http://127.0.0.1:5178',
    onStoreStatus: (status) => statuses.push(status),
    fetchImpl: async () => {
      if (mode === 'missing-binding') {
        return jsonResponse(
          { error: { code: 'comments_unavailable', message: 'comments unavailable (missing binding): set FOCUS_COMMENTS_URL.' } },
          503
        );
      }
      return jsonResponse(
        {
          error: {
            code: 'agent_no_target',
            message: 'No live h2a session.',
            saved: true,
            comment: {
              id: 'cmt_saved',
              threadId: 'thr_saved',
              target: { kind: 'artifact', id: FIXTURE_ID },
              author: { id: 'local-owner' },
              authorship: { author: { actorId: 'local-owner', kind: 'human', displayLabel: 'Owner', color: '#2563eb' } },
              state: 'open',
              body: 'Saved even without live agent',
              createdAt: '2026-11-20T10:10:00.000Z'
            }
          }
        },
        409
      );
    }
  });
  adapter.onCommentCreated?.((c) => createdEvents.push(c));

  await assert.rejects(
    () => adapter.list('local', { kind: 'artifact', id: FIXTURE_ID }),
    (err) =>
      err instanceof FocusCommentsAdapterError &&
      err.code === 'COMMENTS_UNAVAILABLE' &&
      err.missingBinding === true &&
      err.message.includes(MISSING_BINDING_LABEL)
  );
  assert.equal(statuses.at(-1)?.kind, 'unconfigured');

  mode = 'saved-not-delivered';
  await assert.rejects(
    () => adapter.create({ tenant: 'local', target: { kind: 'artifact', id: FIXTURE_ID }, body: 'Saved even without live agent' }),
    (err) =>
      err instanceof FocusCommentsAdapterError &&
      err.code === 'SAVED_NOT_DELIVERED' &&
      err.saved === true &&
      err.comment?.id === 'cmt_saved'
  );
  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0].id, 'cmt_saved');
});

test('H1 fixture and page-config: unique targetRef per node, zero diagrams, host-controlled ?review=1, zero secret leaks', () => {
  const doc = loadFocusArtifactFixture(FIXTURE_ID);
  assert.equal(doc.ref, FIXTURE_ID);
  assert.ok(doc.hash.startsWith('sha256:'));
  const refs = collectFixtureTargetRefs(doc);
  assert.ok(refs.length >= 6, 'fixture renders multiple Focus nodes (prose, question, optionSet, options, decision, trace)');
  assert.equal(new Set(refs).size, refs.length, 'every Focus node carries one unique targetRef');
  assert.equal(
    doc.sections.some((s) => /** @type {any} */ (s).kind === 'diagram'),
    false,
    'no DS 0.43.0 diagram node rendered in H1'
  );

  const off = readArtifactReviewPageConfig({}, new URL('http://127.0.0.1:5178/artifact/a?review=1'));
  assert.equal(off.enabled, false);
  assert.equal(off.initialMode, 'view');

  const strict = readArtifactReviewPageConfig(
    {
      FOCUS_ARTIFACT_REVIEW: '1',
      FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH: '1',
      FOCUS_COMMENTS_TOKEN: 'super-secret-token',
      FOCUS_REVIEW_OWNER_ID: 'owner-42',
      FOCUS_REVIEW_OWNER_LABEL: 'Alice'
    },
    new URL('http://127.0.0.1:5178/artifact/a?review=1')
  );
  assert.equal(strict.enabled, true);
  assert.equal(strict.missingBinding, true);
  assert.equal(strict.storeMode, 'missing-binding');
  assert.equal(strict.initialMode, 'review');
  assert.equal(strict.currentUser.actorId, 'owner-42');
  assert.equal(strict.currentUser.kind, 'human');
  assert.equal(strict.currentUser.displayLabel, 'Alice');
  assert.doesNotMatch(JSON.stringify(strict), /super-secret-token/);
});

function createServeFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'h2a-h1-serve-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, '.track'), { recursive: true });
  writeFileSync(join(repo, '.track', 'events.jsonl'), '', 'utf8');
  const root = join(base, 'h2a-root');
  const dirs = {
    home: join(base, 'home'),
    run: join(base, 'run'),
    config: join(base, 'config'),
    state: join(base, 'state')
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return { base, repo, root, dirs };
}

async function startFocusServe(t, f, extraEnv) {
  const child = spawn(process.execPath, [BIN, 'focus', 'serve', '--repo', f.repo, '--port', '0'], {
    cwd: f.repo,
    env: {
      PATH: process.env.PATH,
      HOME: f.dirs.home,
      XDG_RUNTIME_DIR: f.dirs.run,
      XDG_CONFIG_HOME: f.dirs.config,
      XDG_STATE_HOME: f.dirs.state,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
      FOCUS_H2A_ROOT: f.root,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => void (stdout += chunk));
  child.stderr.on('data', (chunk) => void (stderr += chunk));
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  const started = Date.now();
  while (!/Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
    if (child.exitCode !== null) throw new Error(`Focus exited early (code=${child.exitCode}): ${stderr}`);
    if (Date.now() - started > 15000) throw new Error(`Focus did not bind in time: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const url = stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  return {
    url,
    async stop() {
      child.kill('SIGTERM');
      return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    }
  };
}

test('H1 packaged Focus Web: flag off keeps View clean, missing binding renders exact message with zero writes, and CommentsAdapter completes r6 round-trip', { skip: process.platform === 'win32' }, async (t) => {
  const f = createServeFixture(t);

  // 1. Flag OFF: /artifact/:id -> 404; /dossier/agent-memory has zero review chrome.
  const offServer = await startFocusServe(t, f, {});
  const offArtifact = await fetch(`${offServer.url}/artifact/${encodeURIComponent(FIXTURE_ID)}`);
  assert.equal(offArtifact.status, 404);
  const offDossierHtml = await (await fetch(`${offServer.url}/dossier/agent-memory`)).text();
  assert.equal(offDossierHtml.includes('data-artifact-review-enabled="true"'), false);
  assert.equal(offDossierHtml.includes('st-review-toggle'), false);
  await offServer.stop();

  // 2. Flag ON + missing binding (`FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH=1` without `FOCUS_COMMENTS_URL`):
  //    toggle renders, review mode opens, panel shows `comments unavailable (missing binding)`, zero files written.
  const filesBefore = listFilesRecursive(f.base);
  const strictServer = await startFocusServe(t, f, {
    FOCUS_ARTIFACT_REVIEW: '1',
    FOCUS_COMMENTS_REQUIRE_CLUSTER_MESH: '1'
  });
  const strictHtml = await (
    await fetch(`${strictServer.url}/artifact/${encodeURIComponent(FIXTURE_ID)}?review=1`)
  ).text();
  assert.match(strictHtml, /st-review-toggle/);
  assert.match(strictHtml, /data-review-root="focus:local-review-fixture"/);
  assert.match(strictHtml, /comments unavailable \(missing binding\)/);
  const expectedRefs = collectFixtureTargetRefs(loadFocusArtifactFixture(FIXTURE_ID));
  for (const ref of expectedRefs) {
    const matches = strictHtml.match(new RegExp(`data-anchor-id="${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) ?? [];
    assert.equal(matches.length, 1, `expected exactly one data-anchor-id="${ref}" in rendered HTML`);
  }

  const strictAdapter = createFocusHttpCommentsAdapter({
    artifactId: FIXTURE_ID,
    baseUrl: strictServer.url
  });
  await assert.rejects(
    () => strictAdapter.list('local', { kind: 'artifact', id: FIXTURE_ID }),
    (err) => err instanceof FocusCommentsAdapterError && err.code === 'COMMENTS_UNAVAILABLE' && err.missingBinding
  );
  await strictServer.stop();
  assert.deepEqual(listFilesRecursive(f.base), filesBefore, 'missing binding must write zero files anywhere');

  // 3. Flag ON + C2b in-memory stub: full CommentsAdapter round-trip against live packaged Focus Web.
  const stubServer = await startFocusServe(t, f, {
    FOCUS_ARTIFACT_REVIEW: '1',
    FOCUS_REVIEW_MEMBERS: 'local-owner,reviewer-bob'
  });
  const adapter = createFocusHttpCommentsAdapter({
    artifactId: FIXTURE_ID,
    baseUrl: stubServer.url
  });
  const doc = loadFocusArtifactFixture(FIXTURE_ID);
  const sectionKey = encodeAnchor({
    t: 'element',
    sel: '[data-anchor-id="question:q-storage"]',
    aid: 'question:q-storage',
    v: doc.hash
  });

  const root = await adapter.create({
    tenant: 'local',
    target: { kind: 'artifact', id: FIXTURE_ID, sectionKey },
    body: 'Human root comment on D1'
  });
  assert.equal(root.state, 'open');
  assert.equal(root.target.kind, 'artifact');
  assert.equal(root.target.sectionKey, sectionKey);
  assert.equal(root.authorship.author.kind, 'human');
  assert.equal(root.authorship.sponsor, undefined);
  assert.notEqual(root.threadId, root.id);

  // Agent reply with mandatory provenance.toolCallId -> two-icon authorship (agent + sponsoring owner).
  const agentReply = await adapter.replyAsAgent({
    tenant: 'local',
    target: { kind: 'artifact', id: FIXTURE_ID, sectionKey },
    threadId: root.threadId,
    body: 'Resolved in sha256:focus-fixture-v2',
    provenance: { toolCallId: 'agent:claude:h1-demo:1' }
  });
  assert.equal(agentReply.provenance?.toolCallId, 'agent:claude:h1-demo:1');
  assert.equal(agentReply.authorship.author.kind, 'agent');
  assert.equal(agentReply.authorship.sponsor?.actorId, 'local-owner');
  assert.notEqual(agentReply.authorship.author.actorId, 'local-owner');
  assert.equal(isHumanReviewComment(agentReply), false);

  // Edit own human row, assign + unassign(null), close ('closed'), reopen ('open'), delete root preserving anchor.
  const edited = await adapter.edit('local', root.id, 'Updated human root comment');
  assert.equal(edited.body, 'Updated human root comment');

  await adapter.assign('local', root.threadId, 'reviewer-bob');
  let listed = await adapter.list('local', { kind: 'artifact', id: FIXTURE_ID });
  assert.equal(listed[0].assignedTo, 'reviewer-bob');
  await adapter.assign('local', root.threadId, null);
  listed = await adapter.list('local', { kind: 'artifact', id: FIXTURE_ID });
  assert.equal(listed[0].assignedTo, undefined);

  await adapter.setState('local', root.threadId, 'closed');
  listed = await adapter.list('local', { kind: 'artifact', id: FIXTURE_ID });
  assert.deepEqual(listed.map((r) => r.state), ['closed', 'closed']);
  await adapter.setState('local', root.threadId, 'open');

  await adapter.remove('local', root.id);
  listed = await adapter.list('local', { kind: 'artifact', id: FIXTURE_ID });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, agentReply.id);
  assert.equal(listed[0].target.sectionKey, sectionKey, 'deleting root row preserves thread anchor on surviving reply');

  await stubServer.stop();
});
