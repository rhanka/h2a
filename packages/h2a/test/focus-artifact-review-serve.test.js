// Artifact review, end to end through the PACKAGED Focus Web server (`h2a focus serve`, the committed
// packages/h2a/focus-app build) and the REAL h2a CLI, in a throwaway h2a root, HOME and runtime dir.
//
// It proves what the unit suite cannot: the bundled InMemoryCommentStore of @sentropic/comments behind the
// routes, the SvelteKit SSE stream through the node adapter, and a signed h2a send deposited in the
// recipient's inbox by an auto-provisioned relay identity — with the loop guard holding on the agent reply.
// The recipient is a registered identity with a live presence written by this test; nothing is woken.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { encodeAnchor } from "../../../apps/focus/src/lib/server/artifact-review/anchor.js";
import { defaultRelayInstance } from "../../../apps/focus/src/lib/server/artifact-review/h2a-relay.js";
import { createLocalStore, verifyEnvelopeSignature, writePresence } from "../dist/index.js";

const ROOT = process.cwd();
const BIN = join(ROOT, "packages", "h2a", "dist", "bin.js");
const RECIPIENT = "claude:owner-lane:0123456789ab";
const ARTIFACT = "dossier:agent-memory";

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "h2a-artifact-review-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  mkdirSync(join(repo, ".track"), { recursive: true });
  writeFileSync(join(repo, ".track", "events.jsonl"), "", "utf8");
  const root = join(base, "h2a-root");
  const dirs = { home: join(base, "home"), run: join(base, "run"), config: join(base, "config"), state: join(base, "state") };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return { base, repo, root, dirs };
}

function liveRecipient(root, repo) {
  const store = createLocalStore({ root });
  const { publicKey } = generateKeyPairSync("ed25519");
  store.registerInstance({
    id: RECIPIENT,
    instance: RECIPIENT,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file:///test" }],
    publicKeys: [publicKey.export({ format: "pem", type: "spki" }).toString()],
    acceptedPolicies: [],
    createdAt: new Date().toISOString(),
    name: "owner-lane",
    workspace: { id: "ws:repo", path: repo, host: "claude", label: "repo" }
  });
  const now = new Date().toISOString();
  writePresence(root, {
    sessionId: `session:${RECIPIENT}`,
    pid: process.pid,
    instance: RECIPIENT,
    name: "owner-lane",
    startedAt: now,
    heartbeatAt: now,
    state: "live",
    workspace: { id: "ws:repo", path: repo, host: "claude", label: "repo" },
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: []
  });
  return store;
}

/** A clean environment: nothing of the developer's real h2a state leaks into the child. */
function childEnv(f, extra) {
  return {
    PATH: process.env.PATH,
    HOME: f.dirs.home,
    XDG_RUNTIME_DIR: f.dirs.run,
    XDG_CONFIG_HOME: f.dirs.config,
    XDG_STATE_HOME: f.dirs.state,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    FOCUS_H2A_ROOT: f.root,
    ...extra
  };
}

async function serve(t, f, extraEnv) {
  const child = spawn(process.execPath, [BIN, "focus", "serve", "--repo", f.repo, "--port", "0"], {
    cwd: f.repo,
    env: childEnv(f, extraEnv),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => void (stdout += chunk));
  child.stderr.on("data", (chunk) => void (stderr += chunk));
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const started = Date.now();
  while (!/Focus Web: http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
    if (child.exitCode !== null) throw new Error(`Focus exited before binding (code=${child.exitCode}): ${stderr}`);
    if (Date.now() - started > 15000) throw new Error(`Focus did not bind in time: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const url = stdout.match(/Focus Web: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  return {
    url,
    stderr: () => stderr,
    async stop() {
      child.kill("SIGTERM");
      return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    }
  };
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

async function openStream(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const received = [];
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
  const waitFor = async (predicate, label, timeoutMs = 10000) => {
    const started = Date.now();
    while (!predicate(received)) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`stream: timed out waiting for ${label}; got ${JSON.stringify(received.map((e) => e.event))}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await waitFor((events) => events.some((e) => e.event === "ready"), "ready");
  return {
    received,
    waitFor,
    async close() {
      controller.abort();
      await pump;
    }
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("packaged Focus Web: artifact review is off by default and answers 404 feature_disabled", { skip: process.platform === "win32" }, async (t) => {
  const f = fixture(t);
  const server = await serve(t, f, {});
  const response = await fetch(`${server.url}/api/artifacts/${encodeURIComponent(ARTIFACT)}/comments`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "feature_disabled");
  assert.deepEqual(await server.stop(), { code: 143, signal: null });
});

test("packaged Focus Web: comment → signed h2a send to the owning session → agent reply live in the thread → resolve/reopen", { skip: process.platform === "win32" }, async (t) => {
  const f = fixture(t);
  const store = liveRecipient(f.root, f.repo);
  const server = await serve(t, f, { FOCUS_ARTIFACT_REVIEW: "1" });
  const api = `${server.url}/api/artifacts/${encodeURIComponent(ARTIFACT)}`;

  const empty = await fetch(`${api}/comments`);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("x-comments-store"), "memory");
  assert.equal(empty.headers.get("x-comments-durable"), "false");
  assert.deepEqual(await empty.json(), { threads: [] });

  const stream = await openStream(`${api}/stream`);
  const ready = stream.received.find((e) => e.event === "ready").data;
  assert.equal(ready.store.kind, "memory");
  assert.match(ready.store.label, /InMemoryCommentStore \(@sentropic\/comments 0\.3\.1\)/);

  const anchor = encodeAnchor({ t: "text", q: { exact: "the recall budget", prefix: "Raise ", suffix: " to 8k" }, aid: "node:decision-2", v: "sha256:aaaa" });
  const longBody = `Please raise the recall budget and say why. ${"Context sentence. ".repeat(40)}UNIQUE-TAIL-7f3a`;
  const posted = await postJson(`${api}/comments`, { sectionKey: anchor, body: longBody, sendToAgent: true, author: { id: "mallory" } });
  assert.equal(posted.status, 201, JSON.stringify(posted.body) + server.stderr());
  assert.equal(posted.headers.get("x-agent-delivery"), "delivered");
  assert.equal(posted.headers.get("x-agent-target"), RECIPIENT);
  const root = posted.body;
  assert.deepEqual(root.author, { id: "local-owner" }, "the payload author is ignored");
  assert.deepEqual(root.target, { kind: "artifact", id: ARTIFACT, sectionKey: anchor });
  assert.equal(root.state, "open");
  await stream.waitFor((events) => events.some((e) => e.event === "comment.created" && e.data.id === root.id), "comment.created (root)");

  // Exactly one signed envelope, in the recipient's root, from the relay identity.
  const relay = defaultRelayInstance(f.repo);
  const inbox = store.readInbox(RECIPIENT);
  assert.equal(inbox.length, 1);
  const envelope = inbox[0];
  const registration = store.findInstance(relay);
  assert.ok(registration, "the relay identity was provisioned in the recipient's root");
  assert.equal(verifyEnvelopeSignature(envelope, registration.publicKeys[0], { by: relay }), true);
  const text = envelope.body.text;
  assert.match(text, /^\[h2a comment-request\] The owner commented on artifact dossier:agent-memory/);
  const payload = JSON.parse(text.slice(text.indexOf("{"), text.indexOf("\n}\n") + 2));
  assert.equal(payload.kind, "h2a.comment-request");
  assert.equal(payload.threadId, root.threadId);
  assert.equal(payload.commentId, root.id);
  assert.equal(payload.recipient, RECIPIENT);
  assert.equal(payload.anchor.q.exact, "the recall budget");
  assert.deepEqual(payload.reply.postReply.body.provenance, { runId: RECIPIENT });
  assert.equal(payload.reply.postReply.url, `${api}/comments`, "the reply path points back at this loopback server");
  assert.doesNotMatch(text, /UNIQUE-TAIL-7f3a/, "the full body stays in the comment store");

  // The agent answers through Focus Web, as the message tells it to.
  const reply = await postJson(payload.reply.postReply.url, {
    threadId: root.threadId,
    body: "Resolved in sha256:bbbb — budget raised to 8k.",
    provenance: { runId: RECIPIENT }
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.deepEqual(reply.body.author, { id: "local-owner" }, "owner id of record until D1");
  assert.deepEqual(reply.body.provenance, { runId: RECIPIENT });
  await stream.waitFor(
    (events) => events.some((e) => e.event === "comment.created" && e.data.provenance?.runId === RECIPIENT),
    "comment.created (agent reply)"
  );
  assert.equal(store.readInbox(RECIPIENT).length, 1, "loop guard: the agent reply sent nothing");

  // SvelteKit's own CSRF guard refuses a POST without a content type before the route runs: the
  // contract's close/reopen therefore always send application/json (as the reply instructions do).
  const bare = await fetch(payload.reply.closeThread.url, { method: "POST" });
  assert.equal(bare.status, 403);
  assert.match(await bare.text(), /Cross-site POST form submissions are forbidden/);
  assert.equal((await (await fetch(`${api}/comments`)).json()).threads[0][0].state, "open", "a refused close changes nothing");

  assert.deepEqual(payload.reply.closeThread, { method: "POST", url: `${api}/threads/${encodeURIComponent(root.threadId)}/close`, contentType: "application/json", body: {} });
  const closed = await postJson(payload.reply.closeThread.url, payload.reply.closeThread.body);
  assert.deepEqual({ status: closed.status, body: closed.body }, { status: 200, body: { ok: true } });
  await stream.waitFor((events) => events.some((e) => e.event === "thread.closed"), "thread.closed");
  const afterClose = await (await fetch(`${api}/comments`)).json();
  assert.deepEqual(afterClose.threads.map((rows) => rows.map((c) => c.state)), [["closed", "closed"]]);

  const reopened = await postJson(`${api}/threads/${encodeURIComponent(root.threadId)}/reopen`, {});
  assert.deepEqual(reopened.body, { ok: true });
  await stream.waitFor((events) => events.some((e) => e.event === "thread.reopened"), "thread.reopened");

  // An explicit target that is not live is refused visibly; the comment is saved and nothing is sent.
  const ghost = await postJson(`${api}/comments`, { body: "For a session that is gone", sendToAgent: true, agentTarget: "claude:ghost:000000000000" });
  assert.equal(ghost.status, 409);
  assert.equal(ghost.body.error.code, "agent_no_target");
  assert.equal(ghost.body.error.saved, true);
  assert.equal(ghost.body.error.delivery.reason, "requested-not-live");
  assert.equal(store.readInbox(RECIPIENT).length, 1);

  const final = await (await fetch(`${api}/comments`)).json();
  assert.equal(final.threads.length, 2);
  assert.deepEqual(final.threads[0].map((c) => c.body.slice(0, 20)), [longBody.slice(0, 20), "Resolved in sha256:b"]);

  await stream.close();
  assert.deepEqual(await server.stop(), { code: 143, signal: null });
});
