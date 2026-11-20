// Focus Web artifact review backend (DS review kit contract r6) — unit level, with fakes only:
// a CommentStore port fake shaped like PgCommentStore, a fake fetch for the dedicated C2b/C2c cluster-mesh
// artifact-comments HTTP router, a fake execFile for the h2a CLI, and fake target resolution. No account, no
// network, no real h2a state.
//
// What is locked down here (DS r6 deltas #1–#7):
//   - owner rule: comments go through cluster-mesh / CommentStore port only, never stored by h2a; missing
//     binding fails closed (503 comments_unavailable); every write is confirmed by read-back;
//   - DS r6 §1.1/§1.2: single truth 'open' | 'closed' (no 'resolved' mapping), target.kind 'artifact' only;
//   - DS r6 §1.3: mandatory non-empty provenance.toolCallId on non-human writes (split MCP/HTTP), optional
//     runId (dropped by Postgres, enriched host-side), two-icon ReviewComment.authorship;
//   - DS r6 §1.4: typed reply({ tenant, target, threadId, body, provenance? }) propagating sectionKey and
//     surviving root hard delete; edit, remove, assign(..., null), non-creator participant permissions (C2a);
//   - DS r6 §2 + D3: UTF-8 non-ASCII anchor round-trip, 2048-char cap -> 400 section_key_too_long;
//   - DS r6 §4: onCommentCreated -> h2a send filtered explicitly on !c.provenance?.toolCallId, C2d MCP
//     reply channel in payload with zero endpoints/credentials.

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeAnchor,
  encodeAnchor,
  excerptOf,
  SECTION_KEY_MAX
} from "../../../apps/focus/src/lib/server/artifact-review/anchor.js";
import {
  createClusterMeshHttpAdapter,
  createMissingBindingAdapter,
  createStorePortAdapter,
  groupThreads,
  isHumanComment,
  normalizeComment,
  threadAnchorSectionKey
} from "../../../apps/focus/src/lib/server/artifact-review/comments-adapter.js";
import { readReviewConfig } from "../../../apps/focus/src/lib/server/artifact-review/config.js";
import {
  buildCommentRequest,
  CLUSTER_MESH_MCP_PROVIDER,
  collaborationActor,
  COMMENT_REQUEST_KIND,
  deliverCommentToAgent,
  filterHumanComments
} from "../../../apps/focus/src/lib/server/artifact-review/agent-delivery.js";
import { ReviewError } from "../../../apps/focus/src/lib/server/artifact-review/errors.js";
import { createH2aSender, defaultRelayInstance } from "../../../apps/focus/src/lib/server/artifact-review/h2a-relay.js";
import {
  handleArtifactReview,
  callbackOrigin,
  isLoopbackAddress,
  isLoopbackOrigin
} from "../../../apps/focus/src/lib/server/artifact-review/http.js";
import { createReviewEvents } from "../../../apps/focus/src/lib/server/artifact-review/review-events.js";

const ARTIFACT = "dossier:agent-memory";
const TARGET = { kind: "artifact", id: ARTIFACT };
const WORKSPACE = "local";
const OWNER = { id: "local-owner", displayLabel: "Owner" };
const PARTICIPANT = { id: "reviewer-bob", displayLabel: "Bob", role: "commenter", canComment: true };
const TENANT = { tenantId: "local", workspaceId: WORKSPACE, userId: "local-owner" };
const AGENT = "claude:owner-lane:0123456789ab";
const TOOL_CALL_ID = `agent:${AGENT}:1`;
const TEXT_ANCHOR = encodeAnchor({
  t: "text",
  q: { exact: "the recall budget", prefix: "Raise ", suffix: " to 8k" },
  aid: "node:decision-2",
  v: "sha256:aaaa"
});
const ELEMENT_ANCHOR = encodeAnchor({ t: "element", sel: "section > p:nth-of-type(2)", aid: "node:option-b", v: "sha256:aaaa" });

/** A 10-verb CommentStore port fake behaving like PgCommentStore (open|closed post-C1, drops runId on INSERT). */
function fakeStore({ recordReadBack = false, dropRunId = true } = {}) {
  const rows = [];
  const calls = [];
  let seq = 0;
  let clock = Date.parse("2026-11-18T10:00:00.000Z");
  const tick = () => new Date((clock += 1000)).toISOString();
  const scopeOf = (tenant) => `${tenant.tenantId} ${tenant.workspaceId}`;
  const scoped = (tenant) => rows.filter((row) => row.scope === scopeOf(tenant));
  const visible = (row) => {
    const target =
      recordReadBack && row.target.kind === "artifact"
        ? {
            kind: "record",
            id: row.target.id,
            recordType: "artifact",
            ...(row.target.sectionKey ? { sectionKey: row.target.sectionKey } : {})
          }
        : { ...row.target };
    let provenance = row.provenance ? { ...row.provenance } : undefined;
    if (provenance && dropRunId) {
      delete provenance.runId;
      if (!provenance.toolCallId) provenance = undefined;
    }
    const { scope: _scope, ...rest } = row;
    return { ...rest, target, author: { ...row.author }, provenance };
  };
  const notFound = (threadId) => Object.assign(new Error(`Thread not found: ${threadId}`), { name: "ThreadNotFoundError" });
  const commentNotFound = (id) => Object.assign(new Error(`Comment not found: ${id}`), { name: "CommentNotFoundError" });
  return {
    rows,
    calls,
    insertRaw(row) {
      rows.push({ scope: scopeOf(TENANT), state: "open", createdAt: tick(), ...row });
    },
    async add(tenant, input) {
      calls.push(["add", structuredClone(input)]);
      let threadId = input.threadId;
      if (threadId !== undefined) {
        const exists = scoped(tenant).some(
          (row) => row.threadId === threadId && row.target.kind === input.target.kind && row.target.id === input.target.id
        );
        if (!exists) throw notFound(threadId);
      } else {
        // DS r6 §1: threadId is minted distinct from root row id.
        threadId = `thr_${++seq}`;
      }
      const row = {
        scope: scopeOf(tenant),
        id: `cmt_${++seq}`,
        tenant: { ...tenant },
        target: { ...input.target },
        threadId,
        author: { ...input.author },
        ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
        state: "open",
        body: input.body,
        ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
        createdAt: tick()
      };
      rows.push(row);
      return visible(row);
    },
    async get(tenant, id) {
      const found = scoped(tenant).find((row) => row.id === id);
      return found ? visible(found) : null;
    },
    async edit(tenant, id, patch) {
      calls.push(["edit", id, structuredClone(patch)]);
      const found = scoped(tenant).find((row) => row.id === id);
      if (!found) throw commentNotFound(id);
      if (typeof patch.body === "string") found.body = patch.body;
      found.updatedAt = tick();
      return visible(found);
    },
    async delete(tenant, id) {
      calls.push(["delete", id]);
      const index = rows.findIndex((row) => row.scope === scopeOf(tenant) && row.id === id);
      if (index < 0) throw commentNotFound(id);
      rows.splice(index, 1);
    },
    async listByTarget(tenant, query) {
      calls.push(["listByTarget", { ...query }]);
      // PgCommentStore matches on context_id only (kind-agnostic).
      return scoped(tenant).filter((row) => row.target.id === query.id).map(visible);
    },
    async listThread(tenant, threadId) {
      return scoped(tenant).filter((row) => row.threadId === threadId).map(visible);
    },
    async setState(tenant, threadId, state) {
      calls.push(["setState", threadId, state]);
      const thread = scoped(tenant).filter((row) => row.threadId === threadId);
      if (thread.length === 0) throw notFound(threadId);
      for (const row of thread) {
        row.state = state;
        row.updatedAt = tick();
      }
      return thread.map(visible);
    },
    async assign(tenant, threadId, assigneeId) {
      calls.push(["assign", threadId, assigneeId]);
      const thread = scoped(tenant).filter((row) => row.threadId === threadId);
      if (thread.length === 0) throw notFound(threadId);
      for (const row of thread) {
        if (assigneeId === null) delete row.assignedTo;
        else row.assignedTo = assigneeId;
        row.updatedAt = tick();
      }
      return thread.map(visible);
    }
  };
}

function portAdapter(store = fakeStore(), extra = {}) {
  return createStorePortAdapter({
    store,
    tenant: TENANT,
    owner: OWNER,
    participants: { [PARTICIPANT.id]: { displayLabel: PARTICIPANT.displayLabel } },
    info: { kind: "memory", durable: false, label: "test store" },
    ...extra
  });
}

function requestEvent({ method = "GET", path, body, headers = {}, params, client = "127.0.0.1", signal }) {
  const url = new URL(path, "https://127.0.0.1:5178");
  const init = { method, headers: { ...headers }, ...(signal ? { signal } : {}) };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!Object.keys(init.headers).some((name) => name.toLowerCase() === "content-type")) {
      init.headers["content-type"] = "application/json";
    }
  }
  return { request: new Request(url, init), url, params, getClientAddress: () => client };
}

function harness({ store = fakeStore(), enabled = true, deliver, env = {}, resolveCaller, resolveAgent } = {}) {
  const adapter = portAdapter(store, { resolveAgent });
  const events = createReviewEvents({ adapter, tenant: WORKSPACE });
  const deliveries = [];
  const runtime = {
    adapter,
    events,
    async deliverComment(input) {
      deliveries.push(input);
      if (deliver) return deliver(input);
      return { status: "delivered", target: AGENT, recipientLive: true, reason: "workspace" };
    }
  };
  const config = readReviewConfig({ FOCUS_ARTIFACT_REVIEW: enabled ? "1" : undefined, ...env });
  let runtimeBuilds = 0;
  const context = {
    config,
    getRuntime: () => {
      runtimeBuilds++;
      return runtime;
    },
    ...(resolveCaller ? { resolveCaller } : {})
  };
  async function call(route, spec) {
    const response = await handleArtifactReview(route, requestEvent(spec), context);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }
  const comments = (params = { artifactId: ARTIFACT }) => ({ path: `/api/artifacts/${params.artifactId}/comments`, params });
  const commentById = (commentId, method = "PATCH", body, extra = {}) => ({
    method,
    path: `/api/artifacts/${ARTIFACT}/comments/${commentId}`,
    params: { artifactId: ARTIFACT, commentId },
    ...(body !== undefined ? { body } : {}),
    headers: { "content-type": "application/json", ...(extra.headers ?? {}) },
    ...extra
  });
  const post = (body, extra = {}) => call("comments.create", { method: "POST", ...comments(), body, ...extra });
  const thread = (threadId, action, body, headers = { "content-type": "application/json" }) => ({
    method: "POST",
    path: `/api/artifacts/${ARTIFACT}/threads/${threadId}/${action}`,
    params: { artifactId: ARTIFACT, threadId },
    ...(body !== undefined ? { body } : {}),
    headers
  });
  return { store, adapter, events, runtime, deliveries, config, call, comments, commentById, post, thread, builds: () => runtimeBuilds };
}

function parseFrame(frame) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  return data.length ? { event, data: JSON.parse(data.join("\n")) } : null;
}

async function openStream(h, artifactId = ARTIFACT) {
  const controller = new AbortController();
  const event = requestEvent({ path: `/api/artifacts/${artifactId}/stream`, params: { artifactId }, signal: controller.signal });
  const response = await handleArtifactReview("stream", event, { config: h.config, getRuntime: () => h.runtime });
  const received = [];
  if (response.status !== 200) return { response, received, close: async () => {} };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = parseFrame(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        if (frame) received.push(frame);
      }
    }
  })().catch(() => {});
  const waitFor = async (predicate, timeoutMs = 2000) => {
    const started = Date.now();
    while (!predicate(received)) {
      if (Date.now() - started > timeoutMs) throw new Error(`stream timeout; got ${JSON.stringify(received.map((e) => e.event))}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  await waitFor((events) => events.some((e) => e.event === "ready"));
  return {
    response,
    received,
    waitFor,
    async close() {
      await reader.cancel().catch(() => {});
      controller.abort();
      await pump;
    }
  };
}

// ── anchors (DS r6 §2 + D3) ───────────────────────────────────────────────────────────────────────────

test("anchors: UTF-8 non-ASCII round-trip, section_key_too_long (2048), and malformed key refusal", () => {
  const decoded = decodeAnchor(TEXT_ANCHOR);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.anchor.t, "text");
  assert.deepEqual(decoded.anchor.q, { exact: "the recall budget", prefix: "Raise ", suffix: " to 8k" });

  // H5 acceptance: non-ASCII UTF-8 quote round-trips byte-identically.
  const utf8Anchor = encodeAnchor({
    t: "text",
    q: { exact: "résumé « éàü — 中文 »", prefix: "Voir ", suffix: " §2" },
    aid: "node:utf8",
    v: "sha256:utf8"
  });
  const utf8Decoded = decodeAnchor(utf8Anchor);
  assert.equal(utf8Decoded.ok, true);
  assert.equal(utf8Decoded.anchor.q.exact, "résumé « éàü — 中文 »");

  assert.equal(decodeAnchor("description").code, "invalid_anchor", "a plain section name is not a review anchor");
  assert.equal(decodeAnchor("a1:***").code, "invalid_anchor");
  assert.equal(decodeAnchor(`a1:${Buffer.from("[1,2]").toString("base64url")}`).code, "invalid_anchor");
  assert.equal(decodeAnchor(encodeAnchor({ t: "page", v: "x" })).code, "invalid_anchor");

  const tooLong = encodeAnchor({ t: "text", q: { exact: "x".repeat(SECTION_KEY_MAX) }, v: "v" });
  const capError = decodeAnchor(tooLong);
  assert.equal(capError.ok, false);
  assert.equal(capError.code, "section_key_too_long", "decision D3 / r6 §2 error code");
  assert.equal(capError.details.maxLength, 2048);
  assert.match(capError.message, /2048/);
});

test("excerpts are bounded: the h2a payload never carries more than the excerpt", () => {
  assert.equal(excerptOf("  short\n note "), "short note");
  const long = `${"word ".repeat(200)}TAIL-MARKER`;
  const excerpt = excerptOf(long);
  assert.ok(excerpt.length <= 500);
  assert.doesNotMatch(excerpt, /TAIL-MARKER/);
});

// ── adapter: normalisation, authorship, reply inheritance, root deletion ──────────────────────────────

test("normalisation (r6 §1.1/§1.2/§1.3): record+artifact -> artifact, open|closed only (no resolved), two-icon authorship", () => {
  const raw = {
    id: "c1",
    tenant: TENANT,
    target: { kind: "record", recordType: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: "t1",
    author: { id: OWNER.id },
    state: "closed",
    body: "b",
    provenance: { toolCallId: TOOL_CALL_ID },
    createdAt: "2026-11-18T10:00:00.000Z"
  };
  const comment = normalizeComment(raw, {
    owner: OWNER,
    resolveAgent: ({ toolCallId }) =>
      toolCallId === TOOL_CALL_ID ? { actorId: AGENT, kind: "agent", displayLabel: "Claude", runId: AGENT } : null
  });
  assert.deepEqual(comment.target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.equal("recordType" in comment.target, false);
  assert.equal(comment.state, "closed");
  assert.deepEqual(comment.provenance, { toolCallId: TOOL_CALL_ID });
  assert.equal(comment.authorship.author.kind, "agent");
  assert.equal(comment.authorship.author.actorId, AGENT);
  assert.equal(comment.authorship.author.displayLabel, "Claude");
  assert.equal(comment.authorship.sponsor.actorId, OWNER.id);
  assert.equal(comment.authorship.sponsor.kind, "human");
  assert.equal(comment.authorship.runId, AGENT, "runId enriched host-side even when absent on wire");
  assert.notEqual(comment.authorship.author.actorId, OWNER.id, "Mine / isUnread must distinguish agent from owner");

  // Generic « Agent » fallback when the live session is stopped / resolver returns null.
  const genericAgent = normalizeComment(raw, { owner: OWNER });
  assert.equal(genericAgent.authorship.author.displayLabel, "Agent");
  assert.equal(genericAgent.authorship.author.kind, "agent");
  assert.equal(genericAgent.authorship.sponsor.actorId, OWNER.id);
  assert.equal(genericAgent.authorship.runId, undefined);

  // Human comment: single author, no sponsor.
  const human = normalizeComment({ ...raw, provenance: undefined }, { owner: OWNER });
  assert.equal(human.authorship.author.actorId, OWNER.id);
  assert.equal(human.authorship.author.kind, "human");
  assert.equal(human.authorship.sponsor, undefined);
  assert.equal(isHumanComment(human), true);
  assert.equal(isHumanComment(comment), false);

  // Non-artifact rows are dropped; legacy 'resolved' literal is rejected (no closed<->resolved mapping in r6).
  assert.equal(normalizeComment({ ...raw, target: { kind: "record", recordType: "organization", id: ARTIFACT } }), null);
  assert.throws(() => normalizeComment({ ...raw, state: "resolved" }), (error) => error.code === "store_contract_violation");
  assert.throws(() => normalizeComment({ ...raw, state: "archived" }), (error) => error.code === "store_contract_violation");
});

test("store-port adapter (r6): typed reply, root deletion preserves anchor, edit, remove, assign(null), open|closed direct", async () => {
  const store = fakeStore({ recordReadBack: true, dropRunId: true });
  const createdEvents = [];
  const adapter = portAdapter(store);
  adapter.onCommentCreated((c) => createdEvents.push(c));

  const root = await adapter.create({
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    body: "Root",
    author: { id: OWNER.id }
  });
  assert.equal(store.calls[0][0], "add");
  assert.deepEqual(store.calls[0][1].target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.equal(root.target.kind, "artifact");
  assert.equal(root.state, "open");
  assert.equal(root.assignedTo, undefined, "no auto-assign on root creation");
  assert.notEqual(root.threadId, root.id, "threadId distinct from root row id");

  // Typed reply propagating target.sectionKey (and inheriting from thread when omitted).
  const reply1 = await adapter.reply({
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: root.threadId,
    body: "Reply 1",
    author: { id: OWNER.id }
  });
  assert.equal(reply1.threadId, root.threadId);
  assert.equal(reply1.target.sectionKey, TEXT_ANCHOR);

  // Deleting root row preserves surviving replies AND thread anchor from first surviving row carrying sectionKey.
  await adapter.remove({ tenant: WORKSPACE, target: TARGET, commentId: root.id });
  const surviving = await adapter.listThread(WORKSPACE, TARGET, root.threadId);
  assert.deepEqual(surviving.map((r) => r.id), [reply1.id]);
  assert.equal(threadAnchorSectionKey(surviving), TEXT_ANCHOR, "anchor survives root hard delete");

  // Subsequent reply omitting sectionKey still inherits anchor from surviving reply1.
  const reply2 = await adapter.reply({
    tenant: WORKSPACE,
    target: TARGET,
    threadId: root.threadId,
    body: "Reply after root delete",
    author: { id: OWNER.id },
    provenance: { toolCallId: TOOL_CALL_ID, runId: AGENT }
  });
  assert.equal(reply2.target.sectionKey, TEXT_ANCHOR);
  assert.deepEqual(reply2.provenance, { toolCallId: TOOL_CALL_ID }, "PgCommentStore drops runId on write");
  assert.equal(reply2.authorship.sponsor.actorId, OWNER.id);
  assert.equal(reply2.authorship.author.kind, "agent");

  // onCommentCreated fired for all 3 creations; filterHumanComments passes ONLY human rows.
  const humanOnly = [];
  const filtered = filterHumanComments((c) => humanOnly.push(c.id));
  for (const c of createdEvents) filtered(c);
  assert.deepEqual(humanOnly, [root.id, reply1.id], "agent row filtered out on provenance.toolCallId even without runId");

  // Non-artifact row on the same context id is excluded.
  store.insertRaw({
    id: "org-1",
    tenant: TENANT,
    target: { kind: "record", recordType: "organization", id: ARTIFACT },
    threadId: "org-thread",
    author: { id: "x" },
    body: "org"
  });
  const listed = await adapter.list(WORKSPACE, TARGET);
  assert.deepEqual(listed.map((c) => c.id), [reply1.id, reply2.id]);
  assert.deepEqual(groupThreads(listed).map((rows) => rows.length), [2]);

  // Edit own row.
  const edited = await adapter.edit({ tenant: WORKSPACE, target: TARGET, commentId: reply1.id, body: "Reply 1 edited" });
  assert.equal(edited.body, "Reply 1 edited");
  assert.ok(edited.updatedAt);

  // Assign workspace member, then unassign with explicit null.
  const assigned = await adapter.assign({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, assigneeId: PARTICIPANT.id });
  assert.ok(assigned.every((c) => c.assignedTo === PARTICIPANT.id));
  const unassigned = await adapter.assign({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, assigneeId: null });
  assert.ok(unassigned.every((c) => c.assignedTo === undefined), "assign(null) persists as unassigned");

  // setState passes 'closed' directly (no 'resolved' mapping).
  const closed = await adapter.setState({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, state: "closed" });
  assert.deepEqual(store.calls.at(-1), ["setState", root.threadId, "closed"], "r6 §1.1: direct open|closed");
  assert.ok(closed.every((c) => c.state === "closed"));
  const reopened = await adapter.setState({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, state: "open" });
  assert.ok(reopened.every((c) => c.state === "open"));

  // Pre-send non-human provenance check rejects missing/empty toolCallId before touching the store.
  const callsBefore = store.calls.length;
  await assert.rejects(
    adapter.create({ tenant: WORKSPACE, target: TARGET, body: "bad", provenance: { runId: AGENT } }),
    (error) => error.code === "invalid_provenance" && error.status === 400
  );
  await assert.rejects(
    adapter.create({ tenant: WORKSPACE, target: TARGET, body: "bad", actorKind: "agent" }),
    (error) => error.code === "invalid_provenance" && error.status === 400
  );
  assert.equal(store.calls.length, callsBefore, "rejected before reaching store");

  await assert.rejects(
    adapter.reply({ tenant: WORKSPACE, target: TARGET, threadId: "thr_missing", body: "x", author: { id: OWNER.id } }),
    (error) => error.code === "thread_not_found" && error.status === 404
  );
  await assert.rejects(
    adapter.setState({ tenant: WORKSPACE, target: { kind: "artifact", id: "other-artifact" }, threadId: root.threadId, state: "closed" }),
    (error) => error.code === "thread_not_found"
  );
});

test("store-port adapter: a write the store cannot show again is not_saved; missing binding fails closed (503)", async () => {
  const store = fakeStore();
  const adapter = portAdapter({ ...store, listThread: async () => [] });
  await assert.rejects(
    adapter.create({ tenant: WORKSPACE, target: TARGET, body: "ghost", author: { id: OWNER.id } }),
    (error) => error.code === "not_saved" && error.status === 502
  );

  const missing = createMissingBindingAdapter();
  assert.equal(missing.store.kind, "unconfigured");
  await assert.rejects(missing.list(WORKSPACE, TARGET), (error) => error.code === "comments_unavailable" && error.status === 503);
  await assert.rejects(
    missing.create({ tenant: WORKSPACE, target: TARGET, body: "blocked" }),
    (error) => error.code === "comments_unavailable" && error.status === 503
  );
});

// ── adapter: dedicated cluster-mesh C2b/C2c HTTP router ───────────────────────────────────────────────

function fakeC2Endpoint({ rejectWith } = {}) {
  const requests = [];
  const items = [];
  let seq = 0;
  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fetchImpl(url, init = {}) {
    const target = new URL(url);
    const method = init.method ?? "GET";
    requests.push({ method, url: target.toString(), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (rejectWith) return reply(rejectWith.status, rejectWith.body);

    if (method === "GET" && target.pathname === "/api/v1/artifact-comments/comments") {
      const ws = target.searchParams.get("workspace_id");
      const id = target.searchParams.get("context_id");
      return reply(200, {
        items: items.filter((item) => item.workspace_id === ws && item.context_id === id && item.context_type === "artifact")
      });
    }
    const threadGet = target.pathname.match(/^\/api\/v1\/artifact-comments\/threads\/([^/]+)$/);
    if (method === "GET" && threadGet) {
      const ws = target.searchParams.get("workspace_id");
      const id = target.searchParams.get("context_id");
      const threadId = decodeURIComponent(threadGet[1]);
      return reply(200, {
        items: items.filter((item) => item.workspace_id === ws && item.context_id === id && item.thread_id === threadId)
      });
    }
    if (method === "POST" && target.pathname === "/api/v1/artifact-comments/comments") {
      const body = JSON.parse(init.body);
      const id = `c${++seq}`;
      const threadId = body.thread_id ?? `t${++seq}`;
      const at = `2026-11-18T10:00:0${seq}.000Z`;
      items.push({
        id,
        workspace_id: body.workspace_id,
        context_type: body.context_type,
        context_id: body.context_id,
        section_key: body.section_key ?? null,
        created_by: "remote-owner",
        assigned_to: null,
        status: "open",
        thread_id: threadId,
        content: body.content,
        // Mirrors PgCommentStore: stores tool_call_id only, drops run_id.
        tool_call_id: body.provenance?.tool_call_id ?? body.tool_call_id ?? null,
        created_at: at,
        updated_at: at
      });
      return reply(201, { id, thread_id: threadId });
    }
    const commentPatchDel = target.pathname.match(/^\/api\/v1\/artifact-comments\/comments\/([^/]+)$/);
    if (method === "PATCH" && commentPatchDel) {
      const id = decodeURIComponent(commentPatchDel[1]);
      const body = JSON.parse(init.body);
      const found = items.find((item) => item.id === id);
      if (!found) return reply(404, { error: { code: "comment_not_found", message: "Not found" } });
      found.content = body.content;
      found.updated_at = `2026-11-18T10:01:0${++seq}.000Z`;
      return reply(200, found);
    }
    if (method === "DELETE" && commentPatchDel) {
      const id = decodeURIComponent(commentPatchDel[1]);
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) return reply(404, { error: { code: "comment_not_found", message: "Not found" } });
      items.splice(idx, 1);
      return reply(200, { ok: true });
    }
    const threadAction = target.pathname.match(/^\/api\/v1\/artifact-comments\/threads\/([^/]+)\/(close|reopen|assign)$/);
    if (method === "POST" && threadAction) {
      const threadId = decodeURIComponent(threadAction[1]);
      const action = threadAction[2];
      const body = JSON.parse(init.body);
      const rows = items.filter((entry) => entry.thread_id === threadId);
      if (rows.length === 0) return reply(404, { error: { code: "thread_not_found", message: "Not found" } });
      for (const item of rows) {
        if (action === "assign") item.assigned_to = body.assigned_to;
        else item.status = action === "close" ? "closed" : "open";
        item.updated_at = `2026-11-18T10:02:0${++seq}.000Z`;
      }
      return reply(200, { ok: true });
    }
    return reply(404, { message: "Not found" });
  }
  return { fetchImpl, requests, items };
}

test("cluster-mesh HTTP adapter (C2b/C2c): threadId verbs, provenance + actor_kind discriminant, assign(null), edit, delete", async () => {
  const endpoint = fakeC2Endpoint();
  const adapter = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1/artifact-comments",
    token: "secret-token-value",
    tenant: TENANT,
    owner: { id: "remote-owner", displayLabel: "Remote Owner" },
    resolveAgent: ({ toolCallId }) =>
      toolCallId === TOOL_CALL_ID ? { actorId: AGENT, kind: "agent", displayLabel: "Claude", runId: AGENT } : null,
    fetchImpl: endpoint.fetchImpl
  });
  assert.equal(adapter.store.kind, "cluster-mesh-http");
  assert.equal(adapter.polling, true);

  const root = await adapter.create({
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    body: "Root"
  });
  assert.deepEqual(endpoint.requests[0].body, {
    workspace_id: WORKSPACE,
    context_type: "artifact",
    context_id: ARTIFACT,
    section_key: TEXT_ANCHOR,
    content: "Root"
  });
  assert.equal(endpoint.requests[0].headers.authorization, "Bearer secret-token-value");
  assert.deepEqual(root.target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.equal(root.author.id, "remote-owner");
  assert.equal(root.assignedTo, undefined, "C2c leaves new roots unassigned");
  assert.equal(root.authorship.author.kind, "human");

  // Agent reply via HTTP transmits provenance + C2b non-human discriminant (`actor_kind` + `x-actor-kind`).
  const reply = await adapter.reply({
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: root.threadId,
    body: "Agent reply",
    provenance: { toolCallId: TOOL_CALL_ID, runId: AGENT },
    actorKind: "agent"
  });
  const replyReq = endpoint.requests.find((r) => r.method === "POST" && r.body?.thread_id === root.threadId);
  assert.equal(replyReq.body.actor_kind, "agent");
  assert.equal(replyReq.headers["x-actor-kind"], "agent");
  assert.equal(replyReq.body.tool_call_id, TOOL_CALL_ID);
  assert.equal(replyReq.body.provenance.tool_call_id, TOOL_CALL_ID);
  assert.equal(replyReq.body.section_key, TEXT_ANCHOR);
  assert.deepEqual(reply.provenance, { toolCallId: TOOL_CALL_ID }, "wire returns toolCallId only");
  assert.equal(reply.authorship.author.actorId, AGENT);
  assert.equal(reply.authorship.sponsor.actorId, "remote-owner");
  assert.equal(reply.authorship.runId, AGENT, "enriched host-side");

  // Thread verbs keyed by threadId (NOT row id!).
  const closed = await adapter.setState({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, state: "closed" });
  assert.ok(endpoint.requests.some((r) => r.url.endsWith(`/threads/${root.threadId}/close`)));
  assert.ok(closed.every((c) => c.state === "closed"));

  // Assign workspace member, then unassign with null.
  await adapter.assign({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, assigneeId: PARTICIPANT.id });
  const assignedReq = endpoint.requests.findLast((r) => r.url.endsWith(`/threads/${root.threadId}/assign`));
  assert.deepEqual(assignedReq.body, { workspace_id: WORKSPACE, assigned_to: PARTICIPANT.id });

  const unassigned = await adapter.assign({ tenant: WORKSPACE, target: TARGET, threadId: root.threadId, assigneeId: null });
  const unassignReq = endpoint.requests.findLast((r) => r.url.endsWith(`/threads/${root.threadId}/assign`));
  assert.deepEqual(unassignReq.body, { workspace_id: WORKSPACE, assigned_to: null });
  assert.ok(unassigned.every((c) => c.assignedTo === undefined));

  // Edit and remove by commentId; deleting root leaves reply and preserves anchor.
  const edited = await adapter.edit({ tenant: WORKSPACE, target: TARGET, commentId: root.id, body: "Root edited" });
  assert.equal(edited.body, "Root edited");
  assert.ok(endpoint.requests.some((r) => r.method === "PATCH" && r.url.endsWith(`/comments/${root.id}`)));

  await adapter.remove({ tenant: WORKSPACE, target: TARGET, commentId: root.id });
  assert.ok(endpoint.requests.some((r) => r.method === "DELETE" && r.url.includes(`/comments/${root.id}`)));
  const remaining = await adapter.listThread(WORKSPACE, TARGET, root.threadId);
  assert.deepEqual(remaining.map((r) => r.id), [reply.id]);
  assert.equal(threadAnchorSectionKey(remaining), TEXT_ANCHOR);
});

test("cluster-mesh HTTP adapter: pre-checks toolCallId/cap before sending, maps C2b errors without leaking token", async () => {
  const endpoint = fakeC2Endpoint();
  const adapter = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1/artifact-comments",
    token: "secret-token-value",
    tenant: TENANT,
    fetchImpl: endpoint.fetchImpl
  });

  // Pre-send check rejects non-human write lacking toolCallId before any HTTP call.
  await assert.rejects(
    adapter.create({ tenant: WORKSPACE, target: TARGET, body: "agent", provenance: { runId: AGENT } }),
    (error) => error.code === "invalid_provenance" && error.status === 400
  );
  await assert.rejects(
    adapter.create({ tenant: WORKSPACE, target: TARGET, body: "agent", actorKind: "nhi" }),
    (error) => error.code === "invalid_provenance" && error.status === 400
  );
  await assert.rejects(
    adapter.create({
      tenant: WORKSPACE,
      target: { kind: "artifact", id: ARTIFACT, sectionKey: "a1:" + "a".repeat(SECTION_KEY_MAX) },
      body: "too long"
    }),
    (error) => error.code === "section_key_too_long" && error.details.maxLength === 2048
  );
  assert.equal(endpoint.requests.length, 0, "pre-checks refuse before sending");

  // Upstream 400 section_key_too_long & 403 forbidden & 500 error mapping (never leaks token).
  const capReject = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1/artifact-comments",
    token: "secret-token-value",
    tenant: TENANT,
    fetchImpl: fakeC2Endpoint({
      rejectWith: { status: 400, body: { error: { code: "section_key_too_long", message: "Cap 2048 exceeded", maxLength: 2048 } } }
    }).fetchImpl
  });
  await assert.rejects(capReject.list(WORKSPACE, TARGET), (error) => error.code === "section_key_too_long" && error.status === 400);

  const forbidden = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1/artifact-comments",
    token: "secret-token-value",
    tenant: TENANT,
    fetchImpl: fakeC2Endpoint({ rejectWith: { status: 403, body: { error: { code: "forbidden", message: "No comment right" } } } }).fetchImpl
  });
  await assert.rejects(forbidden.list(WORKSPACE, TARGET), (error) => {
    assert.equal(error.code, "forbidden");
    assert.equal(error.status, 403);
    assert.doesNotMatch(error.message, /secret-token-value/);
    return true;
  });

  const offline = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1/artifact-comments",
    tenant: TENANT,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    }
  });
  await assert.rejects(offline.list(WORKSPACE, TARGET), (error) => error.code === "comments_unavailable" && error.status === 503);

  assert.throws(
    () => createClusterMeshHttpAdapter({ baseUrl: "not a url", tenant: TENANT }),
    (error) => error.code === "comments_misconfigured"
  );
});

// ── events ────────────────────────────────────────────────────────────────────────────────────────────

test("events are derived from store reads: created, updated, deleted, closed, reopened, assigned", async () => {
  const store = fakeStore({ recordReadBack: true });
  const adapter = portAdapter(store);
  const events = createReviewEvents({ adapter, tenant: WORKSPACE });
  const existing = await adapter.create({ tenant: WORKSPACE, target: TARGET, body: "before", author: { id: OWNER.id } });
  const seen = [];
  const unsubscribe = await events.subscribe(ARTIFACT, (event) => seen.push(event));
  assert.deepEqual(seen, [], "rows that existed before the subscription are state, not news");

  const created = await adapter.create({ tenant: WORKSPACE, target: TARGET, body: "after", author: { id: OWNER.id } });
  await events.refresh(ARTIFACT);
  await events.refresh(ARTIFACT);
  assert.deepEqual(seen.map((e) => e.event), ["comment.created"], "a second refresh announces nothing twice");
  assert.equal(seen[0].data.id, created.id);
  assert.equal(seen[0].data.target.kind, "artifact");

  await adapter.edit({ tenant: WORKSPACE, target: TARGET, commentId: created.id, body: "after edited" });
  await events.refresh(ARTIFACT);
  await adapter.assign({ tenant: WORKSPACE, target: TARGET, threadId: existing.threadId, assigneeId: PARTICIPANT.id });
  await events.refresh(ARTIFACT);
  await adapter.assign({ tenant: WORKSPACE, target: TARGET, threadId: existing.threadId, assigneeId: null });
  await events.refresh(ARTIFACT);
  await adapter.setState({ tenant: WORKSPACE, target: TARGET, threadId: existing.threadId, state: "closed" });
  await events.refresh(ARTIFACT);
  await adapter.setState({ tenant: WORKSPACE, target: TARGET, threadId: existing.threadId, state: "open" });
  await events.refresh(ARTIFACT);
  await adapter.remove({ tenant: WORKSPACE, target: TARGET, commentId: created.id });
  await events.refresh(ARTIFACT);

  assert.deepEqual(
    seen.map((e) => e.event),
    ["comment.created", "comment.updated", "thread.assigned", "thread.assigned", "thread.closed", "thread.reopened", "comment.deleted"]
  );
  assert.equal(seen[2].data.assignedTo, PARTICIPANT.id);
  assert.equal(seen[3].data.assignedTo, null);
  assert.equal(seen[6].data.commentId, created.id);

  unsubscribe();
  await adapter.create({ tenant: WORKSPACE, target: TARGET, body: "unwatched", author: { id: OWNER.id } });
  await events.refresh(ARTIFACT);
  assert.equal(seen.length, 7, "no listener, no work");
});

test("events: a polling store is polled while watched, and a failed read is reported, not swallowed", async () => {
  const timers = [];
  let fail = false;
  const store = fakeStore();
  const base = portAdapter(store);
  const adapter = {
    ...base,
    polling: true,
    list: async (ws, target) => {
      if (fail) throw new ReviewError("comments_unavailable", 503, "endpoint down");
      return base.list(ws, target);
    }
  };
  const events = createReviewEvents({
    adapter,
    tenant: WORKSPACE,
    pollMs: 1000,
    setIntervalImpl: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearIntervalImpl: (timer) => {
      timer.cleared = true;
    }
  });
  const seen = [];
  const unsubscribe = await events.subscribe(ARTIFACT, (event) => seen.push(event));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1000);

  await store.add(TENANT, {
    tenant: TENANT,
    target: { kind: "artifact", id: ARTIFACT },
    author: { id: OWNER.id },
    body: "external",
    provenance: { toolCallId: TOOL_CALL_ID }
  });
  timers[0].fn();
  await events.refresh(ARTIFACT);
  assert.deepEqual(seen.map((e) => e.event), ["comment.created"]);
  assert.equal(seen[0].data.authorship.sponsor.actorId, OWNER.id);

  fail = true;
  await events.refresh(ARTIFACT);
  assert.equal(seen.at(-1).event, "review.error");
  assert.deepEqual(seen.at(-1).data.error, { code: "comments_unavailable", message: "endpoint down" });

  unsubscribe();
  assert.equal(timers[0].cleared, true);
});

// ── delivery to the owning session (DS r6 §4 + Appendix C + C2d MCP) ─────────────────────────────────

function savedComment(overrides = {}) {
  return {
    id: "cmt_9",
    tenant: TENANT,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: "thr_3",
    author: { id: OWNER.id },
    authorship: { author: collaborationActor(OWNER) },
    state: "open",
    body: "Please raise the recall budget.",
    createdAt: "2026-11-18T10:00:00.000Z",
    ...overrides
  };
}

function resolution(overrides = {}) {
  return {
    target: AGENT,
    targetRoot: "/tmp-free/h2a-root",
    reason: "workspace",
    live: [{ instance: AGENT, workspace: { path: "/repo" }, root: "/tmp-free/h2a-root" }],
    candidates: [{ instance: AGENT, workspace: { path: "/repo" }, root: "/tmp-free/h2a-root" }],
    ambiguous: false,
    binMissing: false,
    ...overrides
  };
}

test("comment request payload (r6 §4 / Appendix C): authorship, bounded excerpt, decoded anchor, C2d MCP channel, zero endpoints/secrets", () => {
  const body = `${"Please raise the recall budget. ".repeat(30)}UNIQUE-TAIL-0xBEEF`;
  const anchor = decodeAnchor(TEXT_ANCHOR).anchor;
  const { text, payload } = buildCommentRequest({
    comment: savedComment({ body }),
    anchor,
    owner: OWNER,
    recipient: AGENT,
    tenant: WORKSPACE
  });
  assert.equal(payload.kind, COMMENT_REQUEST_KIND);
  assert.equal(payload.v, 1);
  assert.deepEqual(
    { tenant: payload.tenant, artifactId: payload.artifactId, threadId: payload.threadId, commentId: payload.commentId, recipient: payload.recipient },
    { tenant: WORKSPACE, artifactId: ARTIFACT, threadId: "thr_3", commentId: "cmt_9", recipient: AGENT }
  );
  assert.deepEqual(payload.target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.deepEqual(payload.authorship.author, collaborationActor(OWNER));
  assert.equal(payload.authorship.author.kind, "human");
  assert.match(payload.authorship.author.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(payload.anchor, anchor);
  assert.ok(payload.excerpt.length <= 500);
  assert.doesNotMatch(text, /UNIQUE-TAIL-0xBEEF/, "the full body never travels in the envelope");
  assert.doesNotMatch(text, /https?:\/\//i, "no endpoint URL in the send payload (r6 §9 / Appendix C)");
  assert.doesNotMatch(JSON.stringify(payload), /token|password|secret/i);

  assert.equal(payload.replyChannel.provider, CLUSTER_MESH_MCP_PROVIDER);
  assert.deepEqual(payload.replyChannel.verbs.reply.args, {
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: "thr_3",
    body: "<your reply>",
    provenance: { toolCallId: `agent:${AGENT}:1` }
  });
  assert.deepEqual(payload.replyChannel.verbs.closeThread.args, { tenant: WORKSPACE, threadId: "thr_3", state: "closed" });
  assert.match(text.split("\n")[0], /^\[h2a comment-request\] Owner commented on artifact dossier:agent-memory \(thread thr_3\)/);
  assert.match(text, /the thread is the authority/);
  assert.ok(Buffer.byteLength(text) < 64 * 1024);
});

test("delivery resolves the owning session, refuses non-human comments (loop guard), and sends once into its root", async () => {
  const sends = [];
  const result = await deliverCommentToAgent({
    comment: savedComment(),
    anchor: decodeAnchor(TEXT_ANCHOR).anchor,
    owner: OWNER,
    tenant: WORKSPACE,
    requested: undefined,
    resolveTarget: () => resolution(),
    send: async (input) => {
      sends.push(input);
      return { recipient: AGENT, recipientLive: true, relay: "focus:artifact-review:abc", envelopeId: "env-1" };
    }
  });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].target, AGENT);
  assert.equal(sends[0].targetRoot, "/tmp-free/h2a-root");
  assert.equal(result.status, "delivered");

  // Defense-in-depth loop guard on provenance.toolCallId even if called directly.
  await assert.rejects(
    deliverCommentToAgent({
      comment: savedComment({ provenance: { toolCallId: TOOL_CALL_ID } }),
      anchor: null,
      owner: OWNER,
      tenant: WORKSPACE,
      resolveTarget: () => resolution(),
      send: async () => {
        sends.push("should-not-happen");
        return { recipientLive: true };
      }
    }),
    (error) => error.code === "loop_guard" && error.status === 400
  );
  assert.equal(sends.length, 1);
});

test("delivery refuses visibly: no target, ambiguous target, no h2a binary, failed send — nothing redirected", async () => {
  const base = { comment: savedComment(), anchor: null, owner: OWNER, tenant: WORKSPACE };
  let sends = 0;
  const send = async () => {
    sends++;
    return { recipientLive: true };
  };
  await assert.rejects(
    deliverCommentToAgent({ ...base, send, resolveTarget: () => resolution({ target: undefined, reason: "none", remedy: "Open an h2a CLI on this repo." }) }),
    (error) => error.code === "agent_no_target" && error.status === 409 && /Comment cmt_9 is saved/.test(error.message)
  );
  await assert.rejects(
    deliverCommentToAgent({
      ...base,
      send,
      resolveTarget: () => resolution({ ambiguous: true, candidates: [{ instance: AGENT }, { instance: "codex:other:000000000002" }] })
    }),
    (error) => error.code === "agent_target_ambiguous" && error.details.delivery.candidates.length === 2
  );
  await assert.rejects(
    deliverCommentToAgent({ ...base, send, resolveTarget: () => resolution({ target: undefined, binMissing: true, remedy: "build h2a" }) }),
    (error) => error.code === "h2a_unavailable" && error.status === 503
  );
  assert.equal(sends, 0);
  await assert.rejects(
    deliverCommentToAgent({
      ...base,
      resolveTarget: () => resolution(),
      send: async () => {
        throw new Error("h2a send: recipient is not reachable");
      }
    }),
    (error) => error.code === "agent_delivery_failed" && /recipient is not reachable/.test(error.message)
  );
});

// ── signed transport: h2a CLI send through a relay identity ─────────────────────────────────────────

function fakeExec(script) {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const step = script(args, calls.length);
    setImmediate(() => callback(step.error ?? null, step.stdout ?? "", step.stderr ?? ""));
  };
  return { calls, execFileImpl };
}

test("relay sender: sends signed with the relay identity into the target root", async () => {
  const exec = fakeExec(() => ({ stdout: JSON.stringify({ recipient: AGENT, recipientLive: true, envelope: { id: "env-7" } }) }));
  const relay = defaultRelayInstance("/repo");
  assert.match(relay, /^focus:artifact-review:[0-9a-f]{12}$/);
  const sender = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay, nodePath: "node", execFileImpl: exec.execFileImpl });
  const result = await sender.send({ target: AGENT, targetRoot: "/root-a", text: "hello" });
  assert.deepEqual(exec.calls[0].args, ["/opt/h2a/bin.js", "send", AGENT, "hello", "--from", relay, "--root", "/root-a"]);
  assert.deepEqual(result, { recipient: AGENT, recipientLive: true, dormant: false, envelopeId: "env-7", relay });
  await assert.rejects(sender.send({ target: AGENT, targetRoot: undefined, text: "x" }), /root of .* is unknown/);
});

test("relay sender: provisions absent relay once per root (including concurrent first sends), refuses unkeyed registered relay", async () => {
  const relay = "focus:artifact-review:0000000000cc";
  let registered = false;
  const exec = fakeExec((args) => {
    if (args[1] === "send") {
      return registered
        ? { stdout: JSON.stringify({ recipient: AGENT, recipientLive: true }) }
        : { error: Object.assign(new Error("Command failed"), { code: 3 }), stderr: `h2a send: cannot read the local private key for ${relay} (ENOENT)\n` };
    }
    if (args[1] === "discover") return { stdout: JSON.stringify(registered ? [{ id: relay, instance: relay }] : []) };
    if (args[1] === "keys") return { stdout: JSON.stringify({ ok: true, publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n" }) };
    if (args[1] === "register") {
      registered = true;
      return { stdout: JSON.stringify({ ok: true }) };
    }
    return { stdout: "{}" };
  });
  const sender = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay, nodePath: "node", execFileImpl: exec.execFileImpl });
  const results = await Promise.all([
    sender.send({ target: AGENT, targetRoot: "/root-d", text: "first" }),
    sender.send({ target: AGENT, targetRoot: "/root-d", text: "second" })
  ]);
  assert.deepEqual(results.map((r) => r.recipientLive), [true, true]);
  assert.equal(exec.calls.filter((c) => c.args[1] === "keys").length, 1);
  assert.equal(exec.calls.filter((c) => c.args[1] === "register").length, 1);

  const missingKey = fakeExec((args) => {
    if (args[1] === "send") return { error: Object.assign(new Error("Command failed"), { code: 3 }), stderr: `h2a send: cannot read the local private key for ${relay} (ENOENT)\n` };
    if (args[1] === "discover") return { stdout: JSON.stringify([{ id: relay, instance: relay }]) };
    return { stdout: "{}" };
  });
  const s2 = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay, nodePath: "node", execFileImpl: missingKey.execFileImpl });
  await assert.rejects(s2.send({ target: AGENT, targetRoot: "/root-c", text: "hello" }), /FOCUS_REVIEW_RELAY/);
});

// ── routes (DS r6 HTTP surface) ───────────────────────────────────────────────────────────────────────

test("routes: the flag is off by default — 404 feature_disabled, and nothing is built", async () => {
  const h = harness({ enabled: false });
  assert.equal(readReviewConfig({}).enabled, false);
  for (const [route, spec] of [
    ["comments.list", h.comments()],
    ["comments.create", { method: "POST", ...h.comments(), body: { body: "x" } }],
    ["comment.edit", h.commentById("cmt_1", "PATCH", { body: "y" })],
    ["comment.remove", h.commentById("cmt_1", "DELETE")],
    ["thread.close", h.thread("thr_1", "close", {})],
    ["thread.assign", h.thread("thr_1", "assign", { assignedTo: null })],
    ["stream", { path: `/api/artifacts/${ARTIFACT}/stream`, params: { artifactId: ARTIFACT } }]
  ]) {
    const response = await h.call(route, spec);
    assert.equal(response.status, 404, route);
    assert.equal(response.body.error.code, "feature_disabled");
  }
  assert.equal(h.builds(), 0);
});

test("routes: loopback clients/origins only, JSON writes required, preflight exposes PATCH & DELETE", async () => {
  const h = harness();
  assert.equal((await h.call("comments.list", { ...h.comments(), client: "192.168.1.20" })).status, 403);
  assert.equal(
    (await h.post({ body: "x" }, { headers: { origin: "https://evil.example", "content-type": "application/json" } })).status,
    403
  );
  assert.equal((await h.call("thread.close", h.thread("thr_1", "close", undefined, {}))).status, 415);

  const preflight = await h.call("preflight", { method: "OPTIONS", ...h.comments(), headers: { origin: "http://localhost:5173" } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods"), /PATCH/);
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);

  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackOrigin("http://[::1]:5178"), true);
  assert.equal(callbackOrigin(new URL("https://127.0.0.1:5178/x")), "http://127.0.0.1:5178");
});

test("routes (r6 + H5): create, typed reply, edit, root delete keeping anchor, assign/unassign(null), non-creator participant (C2a)", async () => {
  let activeCaller = { id: OWNER.id, displayLabel: OWNER.displayLabel, role: "admin", canComment: true };
  const h = harness({
    store: fakeStore({ recordReadBack: true, dropRunId: true }),
    env: { FOCUS_REVIEW_MEMBERS: `${OWNER.id},${PARTICIPANT.id}` },
    resolveCaller: () => activeCaller
  });

  // Owner creates root; payload author is ignored.
  const created = await h.post({
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    body: "  Raise the budget.  ",
    author: { id: "mallory" }
  });
  assert.equal(created.status, 201);
  const root = created.body;
  assert.deepEqual(root.author, { id: OWNER.id });
  assert.equal(root.authorship.author.actorId, OWNER.id);
  assert.equal(root.authorship.author.kind, "human");
  assert.equal(root.assignedTo, undefined);

  // Switch to non-creator participant (C2a commenter right): can reply, assign, unassign(null), close, reopen.
  activeCaller = PARTICIPANT;

  const participantReply = await h.post({
    tenant: WORKSPACE,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: root.threadId,
    body: "Looks reasonable to me."
  });
  assert.equal(participantReply.status, 201);
  assert.equal(participantReply.body.author.id, PARTICIPANT.id);
  assert.equal(participantReply.body.target.sectionKey, TEXT_ANCHOR);

  // Non-creator CANNOT edit or delete owner's comment (403 forbidden).
  const editOther = await h.call("comment.edit", h.commentById(root.id, "PATCH", { body: "hijack" }));
  assert.equal(editOther.status, 403);
  assert.equal(editOther.body.error.code, "forbidden");
  const delOther = await h.call("comment.remove", h.commentById(root.id, "DELETE"));
  assert.equal(delOther.status, 403);
  assert.equal(delOther.body.error.code, "forbidden");

  // Non-creator CAN edit their own comment (never triggers h2a send).
  const editOwn = await h.call("comment.edit", h.commentById(participantReply.body.id, "PATCH", { body: "Looks great to me." }));
  assert.equal(editOwn.status, 200);
  assert.equal(editOwn.body.body, "Looks great to me.");
  assert.equal(h.deliveries.length, 0);

  // Non-creator CAN assign workspace member, then unassign with null; Track id / non-member rejected.
  assert.equal(
    (await h.call("thread.assign", h.thread(root.threadId, "assign", { assignedTo: "track:01M39" }))).body.error.code,
    "invalid_assignee"
  );
  assert.equal(
    (await h.call("thread.assign", h.thread(root.threadId, "assign", { assignedTo: "stranger-id" }))).body.error.code,
    "invalid_assignee"
  );
  const assigned = await h.call("thread.assign", h.thread(root.threadId, "assign", { assignedTo: PARTICIPANT.id }));
  assert.deepEqual({ status: assigned.status, body: assigned.body }, { status: 200, body: { ok: true } });
  const unassigned = await h.call("thread.assign", h.thread(root.threadId, "assign", { assignedTo: null }));
  assert.deepEqual({ status: unassigned.status, body: unassigned.body }, { status: 200, body: { ok: true } });
  const afterUnassign = await h.call("comments.list", h.comments());
  assert.equal(afterUnassign.body.threads[0][0].assignedTo, undefined, "null unassign persisted");

  // Non-creator CAN close and reopen owner's thread.
  assert.equal((await h.call("thread.close", h.thread(root.threadId, "close", {}))).status, 200);
  const afterClose = await h.call("comments.list", h.comments());
  assert.deepEqual(afterClose.body.threads[0].map((c) => c.state), ["closed", "closed"]);
  assert.equal((await h.call("thread.reopen", h.thread(root.threadId, "reopen", {}))).status, 200);

  // Caller without per-artifact comment right is refused (403 forbidden).
  activeCaller = { id: "viewer-1", displayLabel: "Viewer", role: "commenter", canComment: false };
  assert.equal((await h.call("thread.close", h.thread(root.threadId, "close", {}))).status, 403);

  // Owner deletes root row: surviving reply keeps the thread and its anchor, next reply inherits it.
  activeCaller = { id: OWNER.id, displayLabel: OWNER.displayLabel, role: "admin", canComment: true };
  assert.equal((await h.call("comment.remove", h.commentById(root.id, "DELETE"))).status, 200);
  const afterRootDel = await h.post({ threadId: root.threadId, body: "Follow-up after root deleted" });
  assert.equal(afterRootDel.status, 201);
  assert.equal(afterRootDel.body.target.sectionKey, TEXT_ANCHOR, "anchor survived root deletion");
});

test("routes: invalid input refused (section_key_too_long, invalid_provenance, loop_guard, cross-workspace 403)", async () => {
  const h = harness();
  const cases = [
    [{ body: "   " }, 400, "body_required"],
    [{ body: "x".repeat(16001) }, 400, "body_too_long"],
    [{ body: "x", sectionKey: "description" }, 400, "invalid_anchor"],
    [{ body: "x", sectionKey: encodeAnchor({ t: "text", q: { exact: "y".repeat(3000) }, v: "v" }) }, 400, "section_key_too_long"],
    [{ body: "x", sendToAgent: "yes" }, 400, "invalid_request"],
    [{ body: "x", threadId: "../../etc" }, 400, "invalid_request"],
    [{ body: "x", threadId: "thr_404" }, 404, "thread_not_found"],
    [{ body: "x", tenant: "other-workspace" }, 403, "forbidden"],
    [{ body: "x", provenance: { runId: AGENT } }, 400, "invalid_provenance"],
    [{ body: "x", provenance: { toolCallId: "   " } }, 400, "invalid_provenance"],
    [{ body: "x", actorKind: "agent" }, 400, "invalid_provenance"],
    [{ body: "x", provenance: { toolCallId: TOOL_CALL_ID }, sendToAgent: true }, 400, "loop_guard"]
  ];
  for (const [body, status, code] of cases) {
    const response = await h.post(body);
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 100));
    assert.equal(response.body.error.code, code);
    if (code === "section_key_too_long") assert.equal(response.body.error.maxLength, 2048);
  }
  // Header discriminant x-actor-kind: nhi without toolCallId -> 400 invalid_provenance.
  const headerNhi = await h.post({ body: "nhi write" }, { headers: { "content-type": "application/json", "x-actor-kind": "nhi" } });
  assert.equal(headerNhi.status, 400);
  assert.equal(headerNhi.body.error.code, "invalid_provenance");

  const root = await h.post({ sectionKey: TEXT_ANCHOR, body: "root" });
  const mismatch = await h.post({ threadId: root.body.threadId, sectionKey: ELEMENT_ANCHOR, body: "moved?" });
  assert.equal(mismatch.body.error.code, "anchor_mismatch");
  assert.equal(h.store.rows.length, 1);
});

test("routes: onCommentCreated sends human comments (incl. decoded anchor on replies) and blocks agent writes on toolCallId", async () => {
  const h = harness({
    store: fakeStore({ recordReadBack: true, dropRunId: true }),
    resolveAgent: ({ toolCallId }) =>
      toolCallId === TOOL_CALL_ID ? { actorId: AGENT, kind: "agent", displayLabel: "Claude", runId: AGENT } : null
  });
  const posted = await h.post({ sectionKey: TEXT_ANCHOR, body: "Agent, please check this.", sendToAgent: true });
  assert.equal(posted.status, 201);
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.deliveries[0].anchor.t, "text");

  // Agent reply with toolCallId ONLY (no runId): accepted, enriched with two-icon authorship, zero h2a send.
  const agentReply = await h.post({
    threadId: posted.body.threadId,
    body: "Resolved in sha256:bbbb",
    provenance: { toolCallId: TOOL_CALL_ID }
  });
  assert.equal(agentReply.status, 201);
  assert.deepEqual(agentReply.body.author, { id: OWNER.id });
  assert.deepEqual(agentReply.body.provenance, { toolCallId: TOOL_CALL_ID });
  assert.equal(agentReply.body.authorship.author.actorId, AGENT);
  assert.equal(agentReply.body.authorship.sponsor.actorId, OWNER.id);
  assert.equal(agentReply.body.authorship.runId, AGENT);
  assert.equal(h.deliveries.length, 1, "loop guard: agent reply triggers zero h2a send");

  // Human reply also carries decoded anchor in delivery!
  const humanReply = await h.post({
    threadId: posted.body.threadId,
    body: "Thanks, one more point",
    sendToAgent: true,
    agentTarget: "codex:other:000000000002"
  });
  assert.equal(humanReply.status, 201);
  assert.equal(h.deliveries.length, 2);
  assert.equal(h.deliveries[1].requested, "codex:other:000000000002");
  assert.equal(h.deliveries[1].anchor.t, "text", "decoded anchor travels on replies too (r6 §4)");
});

test("routes: a saved but undelivered comment returns saved:true — never a silent success", async () => {
  const h = harness({
    deliver: async () => {
      throw new ReviewError("agent_no_target", 409, "Comment is saved, but no live h2a session can receive it.", {
        delivery: { status: "no-target", remedy: "Open an h2a CLI on this repository." }
      });
    }
  });
  const stream = await openStream(h);
  const posted = await h.post({ body: "Nobody home?", sendToAgent: true });
  assert.equal(posted.status, 409);
  assert.equal(posted.body.error.code, "agent_no_target");
  assert.equal(posted.body.error.saved, true);
  assert.equal(posted.body.error.comment.body, "Nobody home?");
  await stream.waitFor((events) => events.some((e) => e.event === "agent.delivery"));
  await stream.close();
});

test("stream: SSE frames for created, updated, assigned, closed, reopened, deleted — scoped to artifact", async () => {
  const h = harness({ store: fakeStore({ dropRunId: true }) });
  const other = await h.post({ body: "on another artifact" }, { path: "/api/artifacts/other/comments", params: { artifactId: "other" } });
  assert.equal(other.status, 201);
  const stream = await openStream(h);

  const root = await h.post({ sectionKey: TEXT_ANCHOR, body: "Root" });
  const agentRow = await h.post({
    threadId: root.body.threadId,
    body: "Resolved in sha256:cccc",
    provenance: { toolCallId: TOOL_CALL_ID }
  });
  await h.call("comment.edit", h.commentById(root.body.id, "PATCH", { body: "Root edited" }));
  await h.call("thread.assign", h.thread(root.body.threadId, "assign", { assignedTo: PARTICIPANT.id }));
  await h.call("thread.assign", h.thread(root.body.threadId, "assign", { assignedTo: null }));
  await h.call("thread.close", h.thread(root.body.threadId, "close", {}));
  await h.call("thread.reopen", h.thread(root.body.threadId, "reopen", {}));
  await h.call("comment.remove", h.commentById(root.body.id, "DELETE"));
  await h.post({ body: "noise elsewhere" }, { path: "/api/artifacts/other/comments", params: { artifactId: "other" } });
  await stream.waitFor((events) => events.some((e) => e.event === "comment.deleted"));

  const names = stream.received.filter((e) => e.event !== "ready").map((e) => e.event);
  assert.deepEqual(names, [
    "comment.created",
    "comment.created",
    "comment.updated",
    "thread.assigned",
    "thread.assigned",
    "thread.closed",
    "thread.reopened",
    "comment.deleted"
  ]);
  const streamedAgent = stream.received.filter((e) => e.event === "comment.created")[1].data;
  assert.equal(streamedAgent.id, agentRow.body.id);
  assert.equal(streamedAgent.provenance.toolCallId, TOOL_CALL_ID);
  assert.equal(streamedAgent.authorship.sponsor.actorId, OWNER.id);
  assert.equal(streamedAgent.authorship.author.kind, "agent");

  await stream.close();
  await h.post({ body: "after disconnect" });
  assert.equal(stream.received.filter((e) => e.event === "comment.created").length, 2);
});
