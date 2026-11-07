// GHSA-jpvv-r467-5p4w — shared corpus + raw-request helper for the
// packages/h2a HTTP surfaces (canevas serve, hosted MCP). The corpus is the
// same one the vitest suites assert; node:http is used to send the
// request-target VERBATIM (no client-side normalization) because the
// vulnerability lives in how @hono/node-server parsed the raw target.

import { createServer as reserve } from "node:net";
import { request as raw } from "node:http";

/**
 * Raw-backslash corpus: a public prefix with a backslash "dot-dot" into a
 * protected namespace, plus separator-confusion inside a protected
 * namespace. The patched @hono/node-server (2.1.6+) refuses any raw
 * backslash in the request path with 400 — no routing happens.
 */
export function rawBackslashTargets(publicPrefix, protectedTargets) {
  const list = [];
  for (const target of protectedTargets) {
    // The target's leading "/" is stripped: the raw backslash is the
    // separator in this corpus, and a "\/" pair parses as TWO separators
    // (an empty segment), so the ".." would collapse that emptiness instead
    // of escaping the public prefix. One backslash per separator is the
    // shape WHATWG rewrites on 2.1.5 and the patched adapter (2.1.6+)
    // refuses with 400.
    const inner = target.replace(/^\//, "");
    list.push(`${publicPrefix}\\..\\${inner}`);
    list.push(`${publicPrefix}\\..\\..\\${inner}`);
    list.push(`${target}\\segment`);
  }
  return list;
}

/**
 * Encoded corpus: %5C, %5c, mixed ..%5C, encoded-dot %2e%2e%5C and
 * double-encoded %255C. None of these are rewritten into traversal by the
 * adapter (they stay percent-encoded in the router pathname), so each must
 * land on a 404 — never on a protected route.
 */
export function encodedBackslashTargets(publicPrefix, protectedTargets) {
  const list = [];
  for (const target of protectedTargets) {
    list.push(`${publicPrefix}/..%5C${target}`);
    list.push(`${publicPrefix}/..%5c${target}`);
    list.push(`${publicPrefix}/..%5C..%5C${target}`);
    list.push(`${publicPrefix}/%2e%2e%5C${target}`);
    list.push(`${publicPrefix}/..%255C${target}`);
  }
  return list;
}

/** Reserves an ephemeral loopback port and releases it immediately. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = reserve();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Sends the exact request-target string on the wire. */
export function rawRequest(port, target, { method = "GET", body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = raw(
      { host: "127.0.0.1", port, path: target, method, headers: headers ?? {} },
      (res) => {
        let raw2 = "";
        res.on("data", (chunk) => { raw2 += chunk.toString("utf8"); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw2, headers: res.headers }));
      },
    );
    req.once("error", (error) => reject(new Error(`raw ${method} ${JSON.stringify(target)} failed: ${error.message}`)));
    req.end(body ?? "");
  });
}
