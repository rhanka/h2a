import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aggregatePendingDecisions,
  escalateToPendingDecision
} from "../dist/runtime/canevas/aggregate.js";
import { createCanevasApp } from "../dist/runtime/canevas/app.js";
import { buildDecisionReplyEnvelope } from "../dist/runtime/canevas/reply.js";
import { postDecisionAnswer, hasAlreadyAnswered } from "../dist/runtime/canevas/answer.js";
import { validateH2AEnvelope } from "../dist/envelope.js";

const ROOT = process.cwd();
const BIN = join(ROOT, "packages/h2a/dist/bin.js");

function esc(id, channel, payload, instance, createdAt) {
  return {
    id, type: "escalate",
    actor: { instance },
    body: { kind: "escalation", channel, payload },
    createdAt
  };
}

test("escalateToPendingDecision mappe une escalation en décision", () => {
  const d = escalateToPendingDecision({
    env: esc("e1", "decide", "Approve merge?", "claude:x:1", "2026-07-03T10:00:00.000Z")
  });
  assert.equal(d.id, "e1");
  assert.equal(d.source, "escalate");
  assert.equal(d.channel, "decide");
  assert.equal(d.instance, "claude:x:1");
  assert.equal(d.question, "Approve merge?");
  assert.equal(d.createdAt, "2026-07-03T10:00:00.000Z");
});

test("une enveloppe non-escalate → null", () => {
  assert.equal(escalateToPendingDecision({ env: { id: "p1", type: "propose" } }), null);
});

test("sans actor.instance mais avec session.instance → utilise la session", () => {
  const d = escalateToPendingDecision({
    env: { id: "e2", type: "escalate", body: { channel: "alert", payload: "x" }, createdAt: "t" },
    session: { instance: "codex:y:2", launchContext: { tmux: { session: "remote-y", pane: "%3" } } }
  });
  assert.equal(d.instance, "codex:y:2");
  assert.deepEqual(d.sessionRef, { tmuxName: "remote-y", pane: "%3" });
});

test("aggregate: dédup par id + tri (alert > decide > advise, puis createdAt asc)", () => {
  const entries = [
    { env: esc("d1", "decide", "q1", "a", "2026-07-03T10:00:00.000Z") },
    { env: esc("a1", "alert", "q2", "b", "2026-07-03T10:05:00.000Z") },
    { env: esc("v1", "advise", "q3", "c", "2026-07-03T09:00:00.000Z") },
    { env: esc("d1", "decide", "dup", "a", "2026-07-03T10:00:00.000Z") } // doublon id
  ];
  const out = aggregatePendingDecisions(entries);
  assert.equal(out.length, 3, "dédup par id");
  assert.deepEqual(out.map((d) => d.id), ["a1", "d1", "v1"]); // alert, decide, advise
});

test("createCanevasApp: GET / sert l'UI HTML self-contained (hooks présents)", async () => {
  const app = createCanevasApp({ listDecisions: () => [], capturePane: async () => ({ degraded: true, text: "" }) });
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const html = await res.text();
  assert.match(html, /h2a canevas/);
  assert.match(html, /\/api\/decisions/, "l'UI doit fetch /api/decisions");
  assert.match(html, /api\/sessions\//, "l'UI doit fetch la vue session");
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/, "self-contained: aucun CDN externe");
});

test("createCanevasApp: GET /api/decisions renvoie l'agrégat injecté", async () => {
  const decisions = [{ id: "e1", source: "escalate", channel: "decide", instance: "a", question: "q", createdAt: "t" }];
  const app = createCanevasApp({ listDecisions: () => decisions, capturePane: async () => ({ degraded: true, text: "" }) });
  const res = await app.request("/api/decisions");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.kind, "canevas-decisions");
  assert.deepEqual(body.decisions, decisions);
});

test("createCanevasApp: GET /pane délègue capturePane (lines parsé, texte propagé)", async () => {
  let called = null;
  const app = createCanevasApp({
    listDecisions: () => [],
    capturePane: async (name, lines) => { called = { name, lines }; return { degraded: false, text: "pane-text" }; }
  });
  const res = await app.request("/api/sessions/remote-x/pane?lines=50");
  const body = await res.json();
  assert.equal(body.kind, "canevas-pane");
  assert.equal(body.tmuxName, "remote-x");
  assert.equal(body.text, "pane-text");
  assert.equal(body.degraded, false);
  assert.deepEqual(called, { name: "remote-x", lines: 50 });
});

test("createCanevasApp: /pane degraded quand le runtime est absent", async () => {
  const app = createCanevasApp({ listDecisions: () => [], capturePane: async () => ({ degraded: true, text: "" }) });
  const body = await (await app.request("/api/sessions/x/pane")).json();
  assert.equal(body.degraded, true);
  assert.equal(body.lines, 200);
});

// ── tranche-3b : pont-réponse (write bridge) ────────────────────────────────

test("buildDecisionReplyEnvelope: enveloppe h2a valide + marqueur local-human", () => {
  const env = buildDecisionReplyEnvelope({
    decisionId: "e1",
    answerId: "go",
    note: "ok pour moi",
    targetInstance: "claude:proj:abc123def456",
    envelopeId: "env-reply-1",
    createdAt: "2026-07-03T10:00:00.000Z"
  });
  const v = validateH2AEnvelope(env);
  assert.equal(v.ok, true, `enveloppe invalide: ${JSON.stringify(v.errors || [])}`);
  assert.equal(env.type, "event");
  assert.equal(env.target.instance, "claude:proj:abc123def456");
  assert.equal(env.body.kind, "message");
  assert.equal(env.body.topic, "decision-reply");
  assert.equal(env.body.replyTo, "e1");
  assert.equal(env.body.answerId, "go");
  assert.equal(env.body.answeredBy, "local-human");
  assert.equal(env.body.note, "ok pour moi");
});

test("buildDecisionReplyEnvelope: note omise → pas de champ note", () => {
  const env = buildDecisionReplyEnvelope({
    decisionId: "e2",
    answerId: "veto",
    targetInstance: "codex:x:0011aabbccdd",
    envelopeId: "env-reply-2",
    createdAt: "2026-07-03T11:00:00.000Z"
  });
  assert.equal(validateH2AEnvelope(env).ok, true);
  assert.equal("note" in env.body, false, "note absente quand non fournie");
});

test("POST /answer: pas de postAnswer(dep) → 501", async () => {
  const app = createCanevasApp({ listDecisions: () => [], capturePane: async () => ({ degraded: true, text: "" }) });
  const res = await app.request("/api/decisions/d1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answerId: "go" })
  });
  assert.equal(res.status, 501);
});

test("POST /answer: token requis — absent → 403, mauvais → 403", async () => {
  let called = 0;
  const app = createCanevasApp({
    listDecisions: () => [],
    capturePane: async () => ({ degraded: true, text: "" }),
    writeToken: "SECRET",
    postAnswer: () => { called += 1; return { status: "answered", decisionId: "d1" }; }
  });
  const noTok = await app.request("/api/decisions/d1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answerId: "go" })
  });
  assert.equal(noTok.status, 403);
  const badTok = await app.request("/api/decisions/d1/answer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-canevas-token": "WRONG" },
    body: JSON.stringify({ answerId: "go" })
  });
  assert.equal(badTok.status, 403);
  assert.equal(called, 0, "postAnswer jamais appelé sans bon token");
});

test("POST /answer: bon token mais answerId manquant → 400", async () => {
  const app = createCanevasApp({
    listDecisions: () => [],
    capturePane: async () => ({ degraded: true, text: "" }),
    writeToken: "SECRET",
    postAnswer: () => ({ status: "answered", decisionId: "d1" })
  });
  const res = await app.request("/api/decisions/d1/answer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-canevas-token": "SECRET" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test("POST /answer: bon token → délègue + mappe status (answered=200, already=409)", async () => {
  const mk = (status) => createCanevasApp({
    listDecisions: () => [],
    capturePane: async () => ({ degraded: true, text: "" }),
    writeToken: "SECRET",
    postAnswer: (id, body) => ({ status, decisionId: id, answerId: body.answerId })
  });
  const ok = await mk("answered").request("/api/decisions/d1/answer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-canevas-token": "SECRET" },
    body: JSON.stringify({ answerId: "go" })
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).answerId, "go");
  const dup = await mk("already").request("/api/decisions/d1/answer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-canevas-token": "SECRET" },
    body: JSON.stringify({ answerId: "go" })
  });
  assert.equal(dup.status, 409);
});

test("postDecisionAnswer: décision inexistante (root vide) → not-found", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-canevas-answer-"));
  try {
    const r = postDecisionAnswer(dir, { decisionId: "nope", answerId: "go" }, { now: 0, envelopeId: "env-x" });
    assert.equal(r.status, "not-found");
    assert.equal(r.decisionId, "nope");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("postDecisionAnswer: decisionId/answerId requis → invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-canevas-answer-"));
  try {
    const r = postDecisionAnswer(dir, { decisionId: "d1", answerId: "" }, { now: 0, envelopeId: "env-x" });
    assert.equal(r.status, "invalid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasAlreadyAnswered: false puis true après écriture du journal reply (idempotence)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-canevas-answer-"));
  try {
    assert.equal(hasAlreadyAnswered(dir, "e1"), false);
    mkdirSync(join(dir, "canevas", "replies"), { recursive: true });
    writeFileSync(join(dir, "canevas", "replies", "e1.json"), JSON.stringify({ decisionId: "e1" }), "utf8");
    assert.equal(hasAlreadyAnswered(dir, "e1"), true);
    // idempotence bout-à-bout : une décision déjà répondue → status "already"
    const r = postDecisionAnswer(dir, { decisionId: "e1", answerId: "go" }, { now: 0, envelopeId: "env-x" });
    assert.equal(r.status, "already");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("h2a canevas list --json : enveloppe stable (root vide → aucune décision)", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-canevas-"));
  try {
    const res = spawnSync(process.execPath, [BIN, "canevas", "list", "--json", "--root", dir], { encoding: "utf8" });
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.kind, "canevas-decisions");
    assert.equal(out.version, 1);
    assert.deepEqual(out.decisions, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
