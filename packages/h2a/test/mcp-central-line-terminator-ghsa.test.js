import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  H2A_MCP_CENTRAL_ENDPOINT_ENV,
  startCentralMcpServer
} from "../dist/index.js";
import { authenticatedHttpRequest } from "../dist/runtime/handover/authenticated-http.js";

/**
 * GHSA-h7mg-cq63-vhpq — hono ≤ 4.13.15: the RegExpRouter built its wildcard
 * middleware pattern with `.*`, which never matched a request path carrying
 * an encoded line terminator (%0A, %0D, %E2%80%A8, %E2%80%A9). Requests whose
 * path matched no route fell straight to the not-found handler with the
 * wildcard chain skipped; hono 4.13.16 rebuilt wildcards as `[^]*` so the
 * chain runs there too.
 *
 * The central MCP server guards every route with the wildcard `app.use("*",
 * …)` origin guard (loopback host + same-origin, else 403 "central MCP
 * request origin is not allowed"). Its authenticated dispatch surfaces an
 * unguarded plain-text 404 as a frame-verify 409 whose error is the JSON
 * parse failure of "404 Not Found" (observed on 4.13.13: "Unexpected
 * non-whitespace character after JSON at position 4"). RED (4.13.13): a
 * marker-authenticated hostile-origin request on a terminator-bearing
 * no-route path reaches the hono not-found handler (409) with the origin
 * guard never executed. GREEN (4.13.16+): the wildcard guard refuses it
 * (403). The router-level negative keeps holding for the family: published
 * routes bearing `[^/]+` params still ran the guard on 4.13.13 (probed: the
 * shim param corpus stays 403 pre-bump), so the corpus pins the only
 * observable regression shape — the no-route fallthrough.
 *
 * The public loopback GET /_h2a-central/ping is served by the Node dispatch
 * in runtime/handover/authenticated-http.js before the hono app ever sees
 * the request, so it is deliberately not an origin-guard probe here.
 */

const HOSTILE_ORIGIN = "http://attacker.invalid";

const NO_ROUTE_LINE_TERMINATOR_TARGETS = [
  { path: "/mcp%0A", method: "POST", body: true },
  { path: "/_h2a-central/status%0A", method: "GET", body: false },
  { path: "/_h2a-central%0A/status", method: "GET", body: false },
  { path: "/_h2a-central/catalogue%E2%80%A8", method: "GET", body: false },
  { path: "/_h2a-central/lease%0A/id", method: "GET", body: false },
];

const linux = process.platform === "linux" ? {} : { skip: "central MCP marker requires Linux uid/runtime semantics" };

function currentUid() {
  assert.equal(typeof process.getuid, "function", "Linux provides process.getuid");
  return process.getuid();
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "h2a-mcp-central-wildcard-ghsa-"));
  const runtimeBase = join(directory, "run", String(currentUid()));
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  chmodSync(runtimeBase, 0o700);
  // Explicit laboratory installation seam: a 0700 test-owned physical prefix
  // keeps prepareAuthority's ownership check meaningful outside a 0755 CI
  // checkout (a group-writable developer worktree is refused, by design).
  const prefix = join(directory, "prefix");
  mkdirSync(prefix, { mode: 0o700 });
  chmodSync(prefix, 0o700);
  return { directory, runtimeBase, root: join(directory, "store"), prefix };
}

async function freeEndpoint() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function stop(started) {
  if (started?.kind === "started") await started.stop();
}

function initializeEnvelope(hostile) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(hostile ? { origin: HOSTILE_ORIGIN } : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: hostile ? "cross-origin-line-feed" : "loopback-line-feed", version: "1" } }
    })
  };
}

test("the central wildcard origin guard still refuses line-terminator paths and marker-authenticated cross-origin requests (GHSA-h7mg-cq63-vhpq)", linux, async () => {
  const f = fixture();
  let started;
  try {
    const requested = await freeEndpoint();
    started = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      physicalPrefix: f.prefix,
      env: { [H2A_MCP_CENTRAL_ENDPOINT_ENV]: requested }
    });
    assert.equal(started.kind, "started");
    const origin = new URL(started.endpoint).origin;
    const stored = JSON.parse(readFileSync(started.markerPath, "utf8"));

    // Control: the ping is served by the Node dispatch layer (public loopback
    // telemetry), before the hono app and its wildcard guard.
    const ping = await fetch(new URL("/_h2a-central/ping", origin));
    assert.equal(ping.status, 200);
    assert.equal(typeof (await ping.json()).generation, "string");

    // Control: a marker-authenticated request without an Origin header is
    // same-origin by omission and reaches the guarded app.
    const status = await authenticatedHttpRequest(started.markerPath, stored, `${origin}/_h2a-central/status`, { method: "GET" });
    assert.equal(status.status, 200, "same-origin requests keep reaching the app");
    assert.equal(typeof (await status.json()).generation, "string");

    // Control: the wildcard guard refuses a hostile Origin on a terminator-
    // free path — this holds on the vulnerable hono as well (RED baseline).
    const refused = await authenticatedHttpRequest(started.markerPath, stored, `${origin}/mcp`, initializeEnvelope(true));
    assert.equal(refused.status, 403, "a hostile Origin on a normal path is refused");
    assert.match((await refused.json()).error, /origin is not allowed/);

    // Corpus: with an encoded line terminator on a path that matches no
    // route, the wildcard guard must still apply, refusing the marker-
    // authenticated cross-origin request. On hono ≤ 4.13.15 the wildcard
    // pattern never matched such paths, the guard was skipped and the
    // request fell to the bare not-found handler (surfaced as the frame
    // 409 "Unexpected non-whitespace character after JSON" — RED);
    // on 4.13.16+ the guard refuses it.
    for (const target of NO_ROUTE_LINE_TERMINATOR_TARGETS) {
      const options = target.method === "POST" && target.body
        ? initializeEnvelope(true)
        : { method: target.method, headers: { origin: HOSTILE_ORIGIN } };
      const response = await authenticatedHttpRequest(started.markerPath, stored, `${origin}${target.path}`, options);
      assert.equal(response.status, 403, `${target.method} ${target.path} must stay behind the origin guard`);
      const body = await response.json();
      assert.match(body.error, /origin is not allowed/, `${target.path} must be refused by the wildcard guard, not by the not-found fallthrough`);
      assert.ok(!("generation" in body), `${target.path} must not disclose central state`);
    }

    // Discriminator: the same terminator-bearing no-route path with no
    // Origin header passes the guard on fixed hono and still falls to the
    // not-found handler; the authenticated layer surfaces that plain-text
    // 404 as the frame 409 parse error. This pins that the corpus 403s
    // above discriminate on origin, not on the path shape.
    const passed = await authenticatedHttpRequest(started.markerPath, stored, `${origin}/_h2a-central/status%0A`, { method: "GET" });
    assert.notEqual(passed.status, 403, "no Origin header means same-origin: the guard itself passes");
    assert.equal(passed.status, 409, "the guard-passed terminator path falls to not-found, surfaced as the frame 409");
  } finally {
    await stop(started);
    rmSync(f.directory, { recursive: true, force: true });
  }
});
