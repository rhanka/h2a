import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCanevasServe } from "../dist/runtime/canevas/serve.js";
import {
  encodedBackslashTargets,
  freePort,
  rawBackslashTargets,
  rawRequest
} from "./helpers/ghsa-backslash-corpus.js";

/**
 * GHSA-jpvv-r467-5p4w — the canevas server (`h2a canevas serve`, bind
 * 127.0.0.1 STRICT) is served by @hono/node-server, which before 2.1.6 ran
 * any request-target that failed its strict validation through the WHATWG
 * URL parser: "\" became "/" and ".." segments were collapsed, so a public
 * prefix with a backslash reached protected routes after rewriting. The
 * patched adapter refuses raw-backslash targets with 400 before routing.
 *
 * The write surface does its OWN guarding on top of routing: POST
 * /api/decisions/:id/answer requires the per-run write token. So the corpus
 * is asserted twice: the adapter must refuse raw-backslash targets, and the
 * token guard must refuse the whole corpus regardless (never accepted).
 */

const PUBLIC_PREFIX = "/api/decisions";
const PROTECTED_TARGETS = ["/api/sessions/demo/pane", "/api/decisions"];

test("canevas serve: raw-backslash request targets are refused 400 at the adapter boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-canevas-ghsa-"));
  const port = await freePort();
  const abort = new AbortController();
  const runPromise = runCanevasServe({ root, port, stderr: { write() {} }, signal: abort.signal });
  try {
    const targets = rawBackslashTargets(PUBLIC_PREFIX, PROTECTED_TARGETS);
    for (const target of targets) {
      const response = await rawRequest(port, target, { method: "GET" });
      // On the vulnerable adapter (2.1.5) the WHATWG rewrite routes
      // /api/decisions\..\api\sessions... straight past the public prefix
      // (e.g. 200 decisions JSON or 200 pane JSON). This expectation was
      // RED there: the rewritten request was routed, not refused.
      assert.equal(response.status, 400, `target ${JSON.stringify(target)} must be refused by the server`);
      assert.ok(!response.body.includes("canevas-decisions"), `target ${JSON.stringify(target)} must not leak decisions JSON`);
    }
  } finally {
    abort.abort();
    await runPromise;
    rmSync(root, { recursive: true, force: true });
  }
});

test("canevas serve: encoded-backslash traversal never reaches a real route (404, no content)", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-canevas-ghsa-"));
  const port = await freePort();
  const abort = new AbortController();
  const runPromise = runCanevasServe({ root, port, stderr: { write() {} }, signal: abort.signal });
  try {
    const targets = encodedBackslashTargets(PUBLIC_PREFIX, PROTECTED_TARGETS);
    for (const target of targets) {
      const response = await rawRequest(port, target, { method: "GET" });
      assert.equal(response.status, 404, `target ${JSON.stringify(target)} must not be resolved into a protected route`);
      assert.ok(!response.body.includes("canevas-decisions"), `target ${JSON.stringify(target)} must not leak decisions JSON`);
      assert.ok(!response.body.includes("canevas-pane"), `target ${JSON.stringify(target)} must not leak pane JSON`);
    }
  } finally {
    abort.abort();
    await runPromise;
    rmSync(root, { recursive: true, force: true });
  }
});

test("canevas serve: the write-token guard refuses the whole corpus (own path guarding)", async () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-canevas-ghsa-"));
  const port = await freePort();
  const abort = new AbortController();
  const runPromise = runCanevasServe({ root, port, stderr: { write() {} }, signal: abort.signal });
  try {
    const forged = { "x-canevas-token": "forged-token", "content-type": "application/json" };
    const attackBody = JSON.stringify({ answerId: "answer-1" });
    const rawTargets = rawBackslashTargets(PUBLIC_PREFIX, ["/api/decisions/d1/answer"]);
    const encodedTargets = encodedBackslashTargets(PUBLIC_PREFIX, ["/api/decisions/d1/answer"]);
    for (const target of [...rawTargets, ...encodedTargets]) {
      const response = await rawRequest(port, target, { method: "POST", headers: forged, body: attackBody });
      // Refused in one of three ways: adapter boundary (400, raw backslash
      // on the patched adapter), token guard (403, the handler refuses the
      // forged token even when the target was rewritten on the vulnerable
      // adapter), or no route (404). Never accepted — never 200.
      assert.ok(
        [400, 403, 404].includes(response.status),
        `forged-token POST ${JSON.stringify(target)} must be refused, got ${response.status}`
      );
      assert.ok(!response.body.includes("canevas-reply"), `POST ${JSON.stringify(target)} must not write an answer`);
    }
    // Control path: the guard still fires on the canonical target.
    const canonical = await rawRequest(port, "/api/decisions/d1/answer", { method: "POST", headers: forged, body: attackBody });
    assert.equal(canonical.status, 403, "forged token on the canonical answer route must be refused 403");
  } finally {
    abort.abort();
    await runPromise;
    rmSync(root, { recursive: true, force: true });
  }
});
