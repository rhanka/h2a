// Focus Web artifact review backend (API contract v0, DS review kit r3) — unit level, with fakes only:
// a CommentStore port fake shaped like PgCommentStore, a fake fetch for the cluster-mesh HTTP endpoint,
// a fake execFile for the h2a CLI, and fake target resolution. No account, no network, no real h2a state.
//
// What is locked down here, beyond "the routes answer":
//   - the owner correction: comments are written through a CommentStore port or a cluster-mesh endpoint,
//     never stored by h2a, and a write is shown as saved only after a read-back;
//   - DS r3 §1.1/§1.2: the API only ever says kind 'artifact' and state 'open' | 'closed';
//   - DS r3 §4 + D1 fallback: agent replies are stored under the owner id with provenance.runId and never
//     re-trigger a send (loop guard); the payload author is ignored;
//   - "fail visibly": every refusal is { error: { code, message } } with a status, a saved-but-undelivered
//     comment says so, and the stream reports store failures instead of going quiet.

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
  createStorePortAdapter,
  groupThreads,
  normalizeComment
} from "../../../apps/focus/src/lib/server/artifact-review/comments-adapter.js";
import { readReviewConfig } from "../../../apps/focus/src/lib/server/artifact-review/config.js";
import {
  buildCommentRequest,
  collaborationActor,
  COMMENT_REQUEST_KIND,
  deliverCommentToAgent
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
const OWNER = { id: "local-owner", displayLabel: "Owner" };
const TENANT = { tenantId: "local", workspaceId: "local", userId: "local-owner" };
const AGENT = "claude:owner-lane:0123456789ab";
const TEXT_ANCHOR = encodeAnchor({
  t: "text",
  q: { exact: "the recall budget", prefix: "Raise ", suffix: " to 8k" },
  aid: "node:decision-2",
  v: "sha256:aaaa"
});
const ELEMENT_ANCHOR = encodeAnchor({ t: "element", sel: "section > p:nth-of-type(2)", aid: "node:option-b", v: "sha256:aaaa" });

/** A CommentStore port fake that behaves like PgCommentStore on the points the adapter must absorb. */
function fakeStore({ recordReadBack = false, dropRunId = false } = {}) {
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
        threadId = `thr_${++seq}`;
      }
      const row = {
        scope: scopeOf(tenant),
        id: `cmt_${++seq}`,
        tenant: { ...tenant },
        target: { ...input.target },
        threadId,
        author: { ...input.author },
        state: "open",
        body: input.body,
        ...(input.provenance ? { provenance: { ...input.provenance } } : {}),
        createdAt: tick()
      };
      rows.push(row);
      return visible(row);
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
    }
  };
}

function portAdapter(store = fakeStore()) {
  return createStorePortAdapter({
    store,
    tenant: TENANT,
    closedState: "resolved",
    info: { kind: "memory", durable: false, label: "test store" }
  });
}

// adapter-node reports https: when ORIGIN is unset, even on plain-HTTP loopback: mirror that here.
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

function harness({ store = fakeStore(), enabled = true, deliver } = {}) {
  const adapter = portAdapter(store);
  const events = createReviewEvents({ adapter });
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
  const config = readReviewConfig({ FOCUS_ARTIFACT_REVIEW: enabled ? "1" : undefined });
  let runtimeBuilds = 0;
  const context = {
    config,
    getRuntime: () => {
      runtimeBuilds++;
      return runtime;
    }
  };
  async function call(route, spec) {
    const response = await handleArtifactReview(route, requestEvent(spec), context);
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }
  const comments = (params = { artifactId: ARTIFACT }) => ({ path: `/api/artifacts/${params.artifactId}/comments`, params });
  const post = (body, extra = {}) =>
    call("comments.create", { method: "POST", ...comments(), body, ...extra });
  const thread = (threadId, action, headers = { "content-type": "application/json" }) => ({
    method: "POST",
    path: `/api/artifacts/${ARTIFACT}/threads/${threadId}/${action}`,
    params: { artifactId: ARTIFACT, threadId },
    headers
  });
  return { store, adapter, events, runtime, deliveries, config, call, comments, post, thread, builds: () => runtimeBuilds };
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

// ── anchors ────────────────────────────────────────────────────────────────────────────────────────────

test("anchors: the a1 sectionKey round-trips and every malformed key is refused with a reason", () => {
  const decoded = decodeAnchor(TEXT_ANCHOR);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.anchor.t, "text");
  assert.deepEqual(decoded.anchor.q, { exact: "the recall budget", prefix: "Raise ", suffix: " to 8k" });

  assert.equal(decodeAnchor("description").code, "invalid_anchor", "a plain section name is not a review anchor");
  assert.equal(decodeAnchor("a1:***").code, "invalid_anchor");
  assert.equal(decodeAnchor(`a1:${Buffer.from("[1,2]").toString("base64url")}`).code, "invalid_anchor");
  assert.equal(decodeAnchor(encodeAnchor({ t: "page", v: "x" })).code, "invalid_anchor");
  const tooLong = encodeAnchor({ t: "text", q: { exact: "x".repeat(SECTION_KEY_MAX) }, v: "v" });
  assert.equal(decodeAnchor(tooLong).code, "anchor_too_long", "decision D3: 2048 characters");
  assert.match(decodeAnchor(tooLong).message, /2048/);
});

test("excerpts are bounded: the h2a payload never carries more than the excerpt", () => {
  assert.equal(excerptOf("  short\n note "), "short note");
  const long = `${"word ".repeat(200)}TAIL-MARKER`;
  const excerpt = excerptOf(long);
  assert.ok(excerpt.length <= 500);
  assert.doesNotMatch(excerpt, /TAIL-MARKER/);
});

// ── adapter: normalisation and read-back ──────────────────────────────────────────────────────────────

test("normalisation (r3 §1.2/§1.1): record+artifact becomes artifact, resolved becomes closed, other kinds are dropped", () => {
  const raw = {
    id: "c1",
    tenant: TENANT,
    target: { kind: "record", recordType: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: "t1",
    author: { id: OWNER.id },
    state: "resolved",
    body: "b",
    provenance: { toolCallId: "", runId: "run-1" },
    createdAt: "2026-11-18T10:00:00.000Z"
  };
  const comment = normalizeComment(raw);
  assert.deepEqual(comment.target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.equal("recordType" in comment.target, false);
  assert.equal(comment.state, "closed");
  assert.deepEqual(comment.provenance, { runId: "run-1" });
  assert.equal(normalizeComment({ ...raw, target: { kind: "record", recordType: "organization", id: ARTIFACT } }), null);
  assert.throws(() => normalizeComment({ ...raw, state: "archived" }), (error) => error.code === "store_contract_violation");
});

test("store-port adapter: writes go to the port as kind 'artifact', are read back, and come out normalised", async () => {
  const store = fakeStore({ recordReadBack: true });
  const adapter = portAdapter(store);
  const root = await adapter.create({ artifactId: ARTIFACT, sectionKey: TEXT_ANCHOR, body: "Root", author: { id: OWNER.id } });
  assert.equal(store.calls[0][0], "add");
  assert.deepEqual(store.calls[0][1].target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.equal(root.target.kind, "artifact");
  assert.equal(root.state, "open");

  const reply = await adapter.reply({ artifactId: ARTIFACT, threadId: root.threadId, body: "Reply", author: { id: OWNER.id } });
  assert.equal(reply.threadId, root.threadId);
  assert.equal(reply.target.sectionKey, TEXT_ANCHOR, "a reply inherits the root anchor");

  // A non-artifact row on the same context id (Postgres lists on context_id only) is never rewritten.
  store.insertRaw({ id: "org-1", tenant: TENANT, target: { kind: "record", recordType: "organization", id: ARTIFACT }, threadId: "org-thread", author: { id: "x" }, body: "org" });
  const listed = await adapter.list(ARTIFACT);
  assert.deepEqual(listed.map((c) => c.id), [root.id, reply.id]);
  assert.deepEqual(groupThreads(listed).map((rows) => rows.length), [2]);

  const closed = await adapter.setState({ artifactId: ARTIFACT, threadId: root.threadId, state: "closed" });
  assert.deepEqual(store.calls.at(-1), ["setState", root.threadId, "resolved"], "0.3.1 port literal");
  assert.ok(closed.every((c) => c.state === "closed"));
  const reopened = await adapter.setState({ artifactId: ARTIFACT, threadId: root.threadId, state: "open" });
  assert.ok(reopened.every((c) => c.state === "open"));

  await assert.rejects(
    adapter.reply({ artifactId: ARTIFACT, threadId: "thr_missing", body: "x", author: { id: OWNER.id } }),
    (error) => error.code === "thread_not_found" && error.status === 404
  );
  await assert.rejects(
    adapter.setState({ artifactId: "other-artifact", threadId: root.threadId, state: "closed" }),
    (error) => error.code === "thread_not_found",
    "a thread of another artifact is not reachable through this one"
  );
});

test("store-port adapter: a write the store cannot show again is not_saved, never shown as saved", async () => {
  const store = fakeStore();
  const adapter = portAdapter({ ...store, add: store.add, listThread: async () => [], listByTarget: store.listByTarget, setState: store.setState });
  await assert.rejects(
    adapter.create({ artifactId: ARTIFACT, body: "ghost", author: { id: OWNER.id } }),
    (error) => error.code === "not_saved" && error.status === 502
  );
});

// ── adapter: cluster-mesh HTTP endpoint (existing /comments routes) ──────────────────────────────────

function fakeEndpoint({ rejectArtifact = false } = {}) {
  const requests = [];
  const items = [];
  let seq = 0;
  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fetchImpl(url, init = {}) {
    const target = new URL(url);
    const method = init.method ?? "GET";
    requests.push({ method, url: target.toString(), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (rejectArtifact) return reply(400, { message: "Invalid query" });
    if (method === "GET" && target.pathname === "/api/v1/comments") {
      return reply(200, { items: items.filter((item) => item.context_id === target.searchParams.get("context_id")) });
    }
    if (method === "POST" && target.pathname === "/api/v1/comments") {
      const body = JSON.parse(init.body);
      const id = `c${++seq}`;
      const at = `2026-11-18T10:00:0${seq}.000Z`;
      items.push({
        id,
        context_type: body.context_type,
        context_id: body.context_id,
        section_key: body.section_key ?? null,
        created_by: "remote-owner",
        assigned_to: "remote-owner",
        status: "open",
        thread_id: body.thread_id ?? `t${id}`,
        content: body.content,
        tool_call_id: null,
        created_at: at,
        updated_at: at
      });
      return reply(201, { id, thread_id: body.thread_id ?? `t${id}` });
    }
    const close = target.pathname.match(/^\/api\/v1\/comments\/([^/]+)\/(close|reopen)$/);
    if (method === "POST" && close) {
      const root = items.find((item) => item.id === close[1]);
      for (const item of items.filter((entry) => entry.thread_id === root.thread_id)) {
        item.status = close[2] === "close" ? "closed" : "open";
      }
      return reply(200, { success: true });
    }
    return reply(404, { message: "Not found" });
  }
  return { fetchImpl, requests, items };
}

test("cluster-mesh HTTP adapter: speaks the existing /comments wire, normalises it, and closes by thread root", async () => {
  const endpoint = fakeEndpoint();
  const adapter = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1",
    token: "secret-token-value",
    tenant: TENANT,
    fetchImpl: endpoint.fetchImpl
  });
  assert.equal(adapter.store.kind, "cluster-mesh-http");
  assert.equal(adapter.polling, true, "changes made outside Focus Web are seen by polling");
  const root = await adapter.create({ artifactId: ARTIFACT, sectionKey: TEXT_ANCHOR, body: "Root", author: { id: OWNER.id } });
  assert.deepEqual(endpoint.requests[0].body, {
    context_type: "artifact",
    context_id: ARTIFACT,
    section_key: TEXT_ANCHOR,
    content: "Root"
  });
  assert.equal(endpoint.requests[0].headers.authorization, "Bearer secret-token-value");
  assert.deepEqual(root.target, { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR });
  assert.equal(root.author.id, "remote-owner", "the endpoint records its authenticated caller");

  const reply = await adapter.reply({ artifactId: ARTIFACT, threadId: root.threadId, body: "Reply", author: { id: OWNER.id } });
  assert.equal(endpoint.requests.findLast((r) => r.method === "POST").body.thread_id, root.threadId);
  assert.equal(reply.target.sectionKey, TEXT_ANCHOR);

  const closed = await adapter.setState({ artifactId: ARTIFACT, threadId: root.threadId, state: "closed" });
  assert.ok(endpoint.requests.some((r) => r.url.endsWith(`/comments/${root.id}/close`)));
  assert.ok(closed.every((c) => c.state === "closed"));
});

test("cluster-mesh HTTP adapter: refusals and outages are visible, provenance is never silently dropped", async () => {
  const refusing = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1",
    token: "secret-token-value",
    tenant: TENANT,
    fetchImpl: fakeEndpoint({ rejectArtifact: true }).fetchImpl
  });
  await assert.rejects(refusing.list(ARTIFACT), (error) => {
    assert.equal(error.code, "store_rejected");
    assert.match(error.message, /HTTP 400: Invalid query/);
    assert.match(error.message, /G1/);
    assert.doesNotMatch(error.message, /secret-token-value/);
    return true;
  });

  const offline = createClusterMeshHttpAdapter({
    baseUrl: "http://127.0.0.1:8787/api/v1",
    tenant: TENANT,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    }
  });
  await assert.rejects(offline.list(ARTIFACT), (error) => error.code === "comments_unavailable" && error.status === 503);

  const endpoint = fakeEndpoint();
  const adapter = createClusterMeshHttpAdapter({ baseUrl: "http://127.0.0.1:8787/api/v1", tenant: TENANT, fetchImpl: endpoint.fetchImpl });
  await assert.rejects(
    adapter.create({ artifactId: ARTIFACT, body: "agent", author: { id: OWNER.id }, provenance: { runId: AGENT } }),
    (error) => error.code === "provenance_unsupported"
  );
  assert.equal(endpoint.requests.length, 0, "an agent row the endpoint cannot mark is not written at all");

  assert.throws(
    () => createClusterMeshHttpAdapter({ baseUrl: "not a url", tenant: TENANT }),
    (error) => error.code === "comments_misconfigured"
  );
});

// ── events ────────────────────────────────────────────────────────────────────────────────────────────

test("events are derived from store reads: baseline is silent, then created / closed / reopened", async () => {
  const store = fakeStore({ recordReadBack: true });
  const adapter = portAdapter(store);
  const events = createReviewEvents({ adapter });
  const existing = await adapter.create({ artifactId: ARTIFACT, body: "before", author: { id: OWNER.id } });
  const seen = [];
  const unsubscribe = await events.subscribe(ARTIFACT, (event) => seen.push(event));
  assert.deepEqual(seen, [], "rows that existed before the subscription are state, not news");

  const created = await adapter.create({ artifactId: ARTIFACT, body: "after", author: { id: OWNER.id } });
  await events.refresh(ARTIFACT);
  await events.refresh(ARTIFACT);
  assert.deepEqual(seen.map((e) => e.event), ["comment.created"], "a second refresh announces nothing twice");
  assert.equal(seen[0].data.id, created.id);
  assert.equal(seen[0].data.target.kind, "artifact");

  await adapter.setState({ artifactId: ARTIFACT, threadId: existing.threadId, state: "closed" });
  await events.refresh(ARTIFACT);
  await adapter.setState({ artifactId: ARTIFACT, threadId: existing.threadId, state: "open" });
  await events.refresh(ARTIFACT);
  assert.deepEqual(seen.map((e) => e.event), ["comment.created", "thread.closed", "thread.reopened"]);
  assert.deepEqual(
    { threadId: seen[1].data.threadId, state: seen[1].data.state, rows: seen[1].data.comments.length },
    { threadId: existing.threadId, state: "closed", rows: 1 }
  );

  unsubscribe();
  await adapter.create({ artifactId: ARTIFACT, body: "unwatched", author: { id: OWNER.id } });
  await events.refresh(ARTIFACT);
  assert.equal(seen.length, 3, "no listener, no work");
});

test("events: a polling store is polled while watched, and a failed read is reported, not swallowed", async () => {
  const timers = [];
  let fail = false;
  const store = fakeStore();
  const base = portAdapter(store);
  const adapter = {
    ...base,
    polling: true,
    list: async (id) => {
      if (fail) throw new ReviewError("comments_unavailable", 503, "endpoint down");
      return base.list(id);
    }
  };
  const events = createReviewEvents({
    adapter,
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

  // A row written straight into the store (an agent through cluster-mesh, not through Focus Web).
  await store.add(TENANT, { tenant: TENANT, target: { kind: "artifact", id: ARTIFACT }, author: { id: OWNER.id }, body: "external" });
  timers[0].fn();
  await events.refresh(ARTIFACT);
  assert.deepEqual(seen.map((e) => e.event), ["comment.created"]);

  fail = true;
  await events.refresh(ARTIFACT);
  assert.equal(seen.at(-1).event, "review.error");
  assert.deepEqual(seen.at(-1).data.error, { code: "comments_unavailable", message: "endpoint down" });

  unsubscribe();
  assert.equal(timers[0].cleared, true);
});

// ── delivery to the owning session ────────────────────────────────────────────────────────────────────

function savedComment(overrides = {}) {
  return {
    id: "cmt_9",
    tenant: TENANT,
    target: { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR },
    threadId: "thr_3",
    author: { id: OWNER.id },
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

test("comment request payload (r3 §4): ids, CollaborationActor, bounded excerpt, decoded anchor, recipient, reply path", () => {
  const body = `${"Please raise the recall budget. ".repeat(30)}UNIQUE-TAIL-0xBEEF`;
  const anchor = decodeAnchor(TEXT_ANCHOR).anchor;
  const { text, payload } = buildCommentRequest({
    comment: savedComment({ body }),
    anchor,
    owner: OWNER,
    origin: "http://127.0.0.1:5178",
    recipient: AGENT,
    tenant: "local"
  });
  assert.equal(payload.kind, COMMENT_REQUEST_KIND);
  assert.equal(payload.v, 1);
  assert.deepEqual(
    { tenant: payload.tenant, artifactId: payload.artifactId, threadId: payload.threadId, commentId: payload.commentId, recipient: payload.recipient },
    { tenant: "local", artifactId: ARTIFACT, threadId: "thr_3", commentId: "cmt_9", recipient: AGENT }
  );
  assert.deepEqual(payload.author, collaborationActor(OWNER));
  assert.equal(payload.author.kind, "human");
  assert.match(payload.author.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(payload.anchor, anchor);
  assert.ok(payload.excerpt.length <= 500);
  assert.doesNotMatch(text, /UNIQUE-TAIL-0xBEEF/, "the full body never travels in the envelope");
  assert.deepEqual(payload.reply.postReply.body, { threadId: "thr_3", body: "<your reply>", provenance: { runId: AGENT } });
  assert.equal(payload.reply.postReply.url, "http://127.0.0.1:5178/api/artifacts/dossier%3Aagent-memory/comments");
  assert.match(text.split("\n")[0], /^\[h2a comment-request\] The owner commented on artifact dossier:agent-memory \(thread thr_3\)/);
  assert.match(text, /the thread is the authority/);
  assert.ok(Buffer.byteLength(text) < 64 * 1024, "fits the h2a send bound");
  assert.doesNotMatch(JSON.stringify(payload), /token|password|secret/i);
});

test("delivery resolves the owning session and sends exactly once into its root", async () => {
  const sends = [];
  const result = await deliverCommentToAgent({
    comment: savedComment(),
    anchor: decodeAnchor(TEXT_ANCHOR).anchor,
    owner: OWNER,
    origin: "http://127.0.0.1:5178",
    tenant: "local",
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
  assert.deepEqual(result, {
    status: "delivered",
    target: AGENT,
    targetRoot: "/tmp-free/h2a-root",
    recipientLive: true,
    reason: "workspace",
    relay: "focus:artifact-review:abc",
    envelopeId: "env-1"
  });

  const dormant = await deliverCommentToAgent({
    comment: savedComment(),
    anchor: null,
    owner: OWNER,
    origin: "http://127.0.0.1:5178",
    tenant: "local",
    resolveTarget: () => resolution(),
    send: async () => ({ recipientLive: false, dormant: true })
  });
  assert.equal(dormant.status, "deposited-dormant");
});

test("delivery refuses visibly: no target, ambiguous target, no h2a binary, failed send — nothing redirected", async () => {
  const base = {
    comment: savedComment(),
    anchor: null,
    owner: OWNER,
    origin: "http://127.0.0.1:5178",
    tenant: "local"
  };
  let sends = 0;
  const send = async () => {
    sends++;
    return { recipientLive: true };
  };
  await assert.rejects(
    deliverCommentToAgent({ ...base, send, resolveTarget: () => resolution({ target: undefined, reason: "none", remedy: "Open an h2a CLI on this repo." }) }),
    (error) => {
      assert.equal(error.code, "agent_no_target");
      assert.equal(error.status, 409);
      assert.match(error.message, /Comment cmt_9 is saved/);
      assert.equal(error.details.delivery.remedy, "Open an h2a CLI on this repo.");
      return true;
    }
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
  assert.equal(sends, 0, "nothing is sent before a single target is known");
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

test("relay sender: a relay absent from the root is provisioned once there (keys generate, register), then retried", async () => {
  const relay = "focus:artifact-review:0000000000aa";
  for (const firstFailure of [
    `h2a send: cannot read the local private key for ${relay} (ENOENT: no such file or directory)\n`,
    `h2a send: sender is not registered: ${relay}\n`
  ]) {
    const exec = fakeExec((args, n) => {
      if (args[1] === "send" && n === 1) return { error: Object.assign(new Error("Command failed"), { code: 3 }), stderr: firstFailure };
      if (args[1] === "discover") return { stdout: JSON.stringify([{ id: AGENT, instance: AGENT }]) };
      if (args[1] === "keys") return { stdout: JSON.stringify({ ok: true, publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n" }) };
      if (args[1] === "register") return { stdout: JSON.stringify({ ok: true }) };
      return { stdout: JSON.stringify({ recipient: AGENT, recipientLive: false, dormant: true }) };
    });
    const sender = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay, nodePath: "node", execFileImpl: exec.execFileImpl, now: () => new Date("2026-11-18T10:00:00.000Z") });
    const result = await sender.send({ target: AGENT, targetRoot: "/root-b", text: "hello" });
    assert.deepEqual(exec.calls.map((c) => c.args[1]), ["send", "discover", "keys", "register", "send"]);
    assert.deepEqual(exec.calls[1].args.slice(1), ["discover", "--root", "/root-b"]);
    assert.deepEqual(exec.calls[2].args.slice(1), ["keys", "generate", "--instance", relay, "--root", "/root-b"]);
    const registration = JSON.parse(exec.calls[3].args[exec.calls[3].args.indexOf("--json") + 1]);
    assert.equal(registration.id, relay);
    assert.deepEqual(registration.publicKeys, ["-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----\n"]);
    assert.equal("workspace" in registration, false, "the relay must never become a sender candidate of a checkout");
    assert.equal(result.dormant, true);
  }
});

test("relay sender: a registered relay without its key is refused — never re-keyed behind its registration", async () => {
  const relay = "focus:artifact-review:0000000000bb";
  const exec = fakeExec((args) => {
    if (args[1] === "send") return { error: Object.assign(new Error("Command failed"), { code: 3 }), stderr: `h2a send: cannot read the local private key for ${relay} (ENOENT)\n` };
    if (args[1] === "discover") return { stdout: JSON.stringify([{ id: relay, instance: relay }]) };
    return { stdout: "{}" };
  });
  const sender = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay, nodePath: "node", execFileImpl: exec.execFileImpl });
  await assert.rejects(sender.send({ target: AGENT, targetRoot: "/root-c", text: "hello" }), /is registered in \/root-c but cannot sign.*FOCUS_REVIEW_RELAY/);
  assert.deepEqual(exec.calls.map((c) => c.args[1]), ["send", "discover"], "no key generation, no registration");
});

test("relay sender: a pinned relay is never provisioned, and failures carry a reason without the command line", async () => {
  const exec = fakeExec(() => ({ error: Object.assign(new Error("Command failed: node bin send … secret body …"), { code: 1 }), stderr: "h2a send: sender is not registered: focus:pinned:1\n" }));
  const pinned = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay: "focus:pinned:1", autoProvision: false, nodePath: "node", execFileImpl: exec.execFileImpl });
  await assert.rejects(pinned.send({ target: AGENT, targetRoot: "/r", text: "secret body" }), (error) => {
    assert.equal(error.message, "h2a send: sender is not registered: focus:pinned:1");
    return true;
  });
  assert.equal(exec.calls.length, 1);

  const timeout = fakeExec(() => ({ error: Object.assign(new Error("Command failed: node bin send … secret body …"), { killed: true, code: null }) }));
  const slow = createH2aSender({ getBin: () => "/opt/h2a/bin.js", relay: "focus:pinned:1", nodePath: "node", execFileImpl: timeout.execFileImpl, timeoutMs: 50 });
  await assert.rejects(slow.send({ target: AGENT, targetRoot: "/r", text: "secret body" }), (error) => {
    assert.equal(error.message, "timed out after 50 ms");
    return true;
  });

  const none = createH2aSender({ getBin: () => undefined, relay: "focus:pinned:1" });
  await assert.rejects(none.send({ target: AGENT, targetRoot: "/r", text: "x" }), /no h2a binary/);
});

// ── routes ────────────────────────────────────────────────────────────────────────────────────────────

test("routes: the flag is off by default — 404 feature_disabled, and nothing is built", async () => {
  const h = harness({ enabled: false });
  assert.equal(readReviewConfig({}).enabled, false);
  for (const [route, spec] of [
    ["comments.list", h.comments()],
    ["comments.create", { method: "POST", ...h.comments(), body: { body: "x" } }],
    ["thread.close", h.thread("thr_1", "close")],
    ["stream", { path: `/api/artifacts/${ARTIFACT}/stream`, params: { artifactId: ARTIFACT } }]
  ]) {
    const response = await h.call(route, spec);
    assert.equal(response.status, 404, route);
    assert.equal(response.body.error.code, "feature_disabled");
    assert.match(response.body.error.message, /FOCUS_ARTIFACT_REVIEW=1/);
  }
  assert.equal(h.builds(), 0, "no store is instantiated while the feature is off");
  assert.equal(h.store.rows.length, 0);
});

test("routes: loopback clients and loopback origins only; writes need a JSON body", async () => {
  const h = harness();
  const remote = await h.call("comments.list", { ...h.comments(), client: "192.168.1.20" });
  assert.equal(remote.status, 403);
  assert.equal(remote.body.error.code, "non_loopback_client");

  const foreign = await h.post({ body: "x" }, { headers: { origin: "https://evil.example", "content-type": "application/json" } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, "forbidden_origin");

  const form = await h.call("comments.create", {
    method: "POST",
    ...h.comments(),
    body: "body=x",
    headers: { "content-type": "application/x-www-form-urlencoded" }
  });
  assert.equal(form.status, 415);
  const formClose = await h.call("thread.close", { ...h.thread("thr_1", "close"), body: "a=1", headers: { "content-type": "text/plain" } });
  assert.equal(formClose.status, 415);
  const bareClose = await h.call("thread.close", h.thread("thr_1", "close", {}));
  assert.equal(bareClose.status, 415, "close/reopen need application/json too, as SvelteKit's CSRF guard demands in production");
  assert.match(bareClose.body.error.message, /application\/json/);

  const preflight = await h.call("preflight", { method: "OPTIONS", ...h.comments(), headers: { origin: "http://localhost:5173" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(h.store.rows.length, 0);

  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("10.0.0.1"), false);
  assert.equal(isLoopbackOrigin("http://[::1]:5178"), true);
  assert.equal(isLoopbackOrigin("http://127.0.0.1.evil.example"), false);
  assert.equal(callbackOrigin(new URL("https://127.0.0.1:5178/x")), "http://127.0.0.1:5178");
  assert.equal(callbackOrigin(new URL("https://[::1]:5178/x")), "http://[::1]:5178");
  assert.equal(callbackOrigin(new URL("https://focus.example/x")), "https://focus.example");
});

test("routes: create, reply, list, close, reopen — contract shapes, owner as author, store as the only memory", async () => {
  const h = harness({ store: fakeStore({ recordReadBack: true }) });
  const created = await h.post({ sectionKey: TEXT_ANCHOR, body: "  Raise the budget.  ", author: { id: "mallory" } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("x-comments-store"), "memory");
  assert.equal(created.headers.get("x-comments-durable"), "false");
  const root = created.body;
  assert.deepEqual(
    { kind: root.target.kind, id: root.target.id, sectionKey: root.target.sectionKey, state: root.state, body: root.body, author: root.author },
    { kind: "artifact", id: ARTIFACT, sectionKey: TEXT_ANCHOR, state: "open", body: "Raise the budget.", author: { id: OWNER.id } },
    "a payload claiming another author is ignored (H2 acceptance 1)"
  );

  const reply = await h.post({ threadId: root.threadId, body: "Second thought" });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.threadId, root.threadId);
  const element = await h.post({ sectionKey: ELEMENT_ANCHOR, body: "On option B" });
  assert.equal(element.status, 201);

  const list = await h.call("comments.list", h.comments());
  assert.equal(list.status, 200);
  assert.deepEqual(Object.keys(list.body), ["threads"]);
  assert.deepEqual(list.body.threads.map((rows) => rows.map((c) => c.body)), [["Raise the budget.", "Second thought"], ["On option B"]]);

  const close = await h.call("thread.close", h.thread(root.threadId, "close"));
  assert.deepEqual({ status: close.status, body: close.body }, { status: 200, body: { ok: true } });
  const afterClose = await h.call("comments.list", h.comments());
  assert.deepEqual(afterClose.body.threads[0].map((c) => c.state), ["closed", "closed"], "closed, never 'resolved'");
  const reopen = await h.call("thread.reopen", h.thread(root.threadId, "reopen"));
  assert.deepEqual(reopen.body, { ok: true });

  const unknown = await h.call("thread.close", h.thread("thr_missing", "close"));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "thread_not_found");
  assert.equal(h.deliveries.length, 0, "nothing is sent unless sendToAgent is true");
});

test("routes: invalid input is refused with a code, and nothing is written", async () => {
  const h = harness();
  const cases = [
    [{ body: "   " }, 400, "body_required"],
    [{ body: "x".repeat(16001) }, 400, "body_too_long"],
    [{ body: "x", sectionKey: "description" }, 400, "invalid_anchor"],
    [{ body: "x", sectionKey: encodeAnchor({ t: "text", q: { exact: "y".repeat(3000) }, v: "v" }) }, 400, "anchor_too_long"],
    [{ body: "x", sendToAgent: "yes" }, 400, "invalid_request"],
    [{ body: "x", threadId: "../../etc" }, 400, "invalid_request"],
    [{ body: "x", threadId: "thr_404" }, 404, "thread_not_found"],
    [{ body: "x", provenance: { runId: "" } }, 400, "invalid_request"],
    [{ body: "x", provenance: { runId: AGENT }, sendToAgent: true }, 400, "loop_guard"]
  ];
  for (const [body, status, code] of cases) {
    const response = await h.post(body);
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal(response.body.error.code, code);
    assert.equal(typeof response.body.error.message, "string");
  }
  const notJson = await h.call("comments.create", { method: "POST", ...h.comments(), body: "{nope", headers: { "content-type": "application/json" } });
  assert.equal(notJson.body.error.code, "invalid_json");
  const badId = await h.call("comments.list", { path: "/api/artifacts/%2E%2E/comments", params: { artifactId: ".." } });
  assert.equal(badId.status, 400);

  const root = await h.post({ sectionKey: TEXT_ANCHOR, body: "root" });
  const mismatch = await h.post({ threadId: root.body.threadId, sectionKey: ELEMENT_ANCHOR, body: "moved?" });
  assert.equal(mismatch.body.error.code, "anchor_mismatch", "a reply never re-anchors its thread silently");
  assert.equal(h.store.rows.length, 1);
});

test("routes: sendToAgent delivers the saved comment once; an agent reply is stored under the owner id with its run", async () => {
  const h = harness();
  const posted = await h.post({ sectionKey: TEXT_ANCHOR, body: "Agent, please check this.", sendToAgent: true });
  assert.equal(posted.status, 201);
  assert.equal(posted.headers.get("x-agent-delivery"), "delivered");
  assert.equal(posted.headers.get("x-agent-target"), AGENT);
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.deliveries[0].comment.id, posted.body.id);
  assert.equal(h.deliveries[0].origin, "http://127.0.0.1:5178");
  assert.equal(h.deliveries[0].anchor.t, "text", "the decoded anchor travels with the request");

  const agentReply = await h.post({ threadId: posted.body.threadId, body: "Resolved in sha256:bbbb", provenance: { runId: AGENT, toolCallId: "tool-1" } });
  assert.equal(agentReply.status, 201);
  assert.deepEqual(agentReply.body.author, { id: OWNER.id }, "r3 fallback until D1: the owner is the author of record");
  assert.deepEqual(agentReply.body.provenance, { toolCallId: "tool-1", runId: AGENT });
  assert.equal(h.deliveries.length, 1, "loop guard: an agent row never triggers a new send");

  const owned = await h.post({ threadId: posted.body.threadId, body: "Thanks, one more point", sendToAgent: true, agentTarget: "codex:other:000000000002" });
  assert.equal(owned.status, 201);
  assert.equal(h.deliveries.length, 2, "each owner create/reply through the hook triggers exactly one send");
  assert.equal(h.deliveries[1].requested, "codex:other:000000000002");
});

test("routes: a saved but undelivered comment is an error that says it is saved — never a silent success", async () => {
  const h = harness({
    deliver: async () => {
      throw new ReviewError("agent_no_target", 409, "Comment is saved, but no live h2a session can receive it (none); nothing was sent.", {
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
  assert.equal(posted.body.error.delivery.remedy, "Open an h2a CLI on this repository.");
  const list = await h.call("comments.list", h.comments());
  assert.equal(list.body.threads.length, 1, "the comment stays saved");
  await stream.waitFor((events) => events.some((e) => e.event === "agent.delivery"));
  const delivery = stream.received.find((e) => e.event === "agent.delivery");
  assert.equal(delivery.data.ok, false);
  assert.equal(delivery.data.error.code, "agent_no_target");
  await stream.close();
});

test("stream: SSE frames for created, closed and reopened, scoped to the artifact, cleaned up on disconnect", async () => {
  const h = harness();
  const other = await h.post({ body: "on another artifact" }, { path: "/api/artifacts/other/comments", params: { artifactId: "other" } });
  assert.equal(other.status, 201);
  const stream = await openStream(h);
  assert.equal(stream.response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const ready = stream.received.find((e) => e.event === "ready");
  assert.deepEqual(ready.data, { artifactId: ARTIFACT, store: { kind: "memory", durable: false, label: "test store" } });

  const root = await h.post({ sectionKey: TEXT_ANCHOR, body: "Root" });
  await h.post({ threadId: root.body.threadId, body: "Resolved in sha256:cccc", provenance: { runId: AGENT } });
  await h.call("thread.close", h.thread(root.body.threadId, "close"));
  await h.call("thread.reopen", h.thread(root.body.threadId, "reopen"));
  await h.post({ body: "noise elsewhere" }, { path: "/api/artifacts/other/comments", params: { artifactId: "other" } });
  await stream.waitFor((events) => events.some((e) => e.event === "thread.reopened"));

  const names = stream.received.filter((e) => e.event !== "ready").map((e) => e.event);
  assert.deepEqual(names, ["comment.created", "comment.created", "thread.closed", "thread.reopened"]);
  const agentRow = stream.received.filter((e) => e.event === "comment.created")[1].data;
  assert.equal(agentRow.provenance.runId, AGENT, "the agent reply arrives live with its run marker");
  assert.equal(agentRow.author.id, OWNER.id);
  const closed = stream.received.find((e) => e.event === "thread.closed").data;
  assert.equal(closed.artifactId, ARTIFACT);
  assert.equal(closed.threadId, root.body.threadId);
  assert.deepEqual(closed.comments.map((c) => c.state), ["closed", "closed"]);

  await stream.close();
  await h.post({ body: "after disconnect" });
  assert.equal(stream.received.filter((e) => e.event === "comment.created").length, 2, "an unsubscribed stream receives nothing");
});
