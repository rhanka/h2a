import { createServer as RESERVE_NET_SERVER } from "node:net";
import { request as RAW_HTTP } from "node:http";

import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";

import { createControlPlane } from "./index.js";

/**
 * GHSA-jpvv-r467-5p4w — the control-plane is served by @hono/node-server,
 * which (before 2.1.6) passed the raw request-target through the WHATWG URL
 * parser on any target that failed its strict validation. WHATWG maps "\" to
 * "/" and collapses ".." segments, so `GET /healthz\..\sessions` reached the
 * app as `/sessions`. Any path-based access control in FRONT of a deployment
 * (the mesh-gateway proxy, an ingress allow-list of /healthz) applied its
 * rules to the original `/healthz\...` string: the path the guard judged and
 * the path the router served were different. The patched adapter refuses
 * raw-backslash request targets with 400 before any routing happens.
 *
 * These tests drive the REAL HTTP boundary — `serve()` plus raw request
 * lines — because the rewrite lives in the adapter, not in the Hono app. A
 * plain `app.request()` could never observe it.
 *
 * The corpus also pins the encoded variants (%5C, %5c, mixed ..%5C,
 * double-encoded %255C): they are never rewritten into traversal by the
 * adapter, so each must land on a 404 — never on a protected-namespace
 * response.
 */

const RAW_BACKSLASH_TARGETS = [
  "/healthz\\..\\sessions",
  "/healthz\\..\\..\\workspaces",
  "/healthz\\..\\lineage-leases",
  "/sessions\\abc\\def",
];

const ENCODED_BACKSLASH_TARGETS = [
  "/healthz/..%5Csessions",
  "/healthz/..%5cworkspaces",
  "/healthz/..%5C..%5Clineage-leases",
  "/healthz/%2e%2e%5Csessions",
  "/healthz/..%255Cworkspaces",
];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = RESERVE_NET_SERVER();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

function rawGet(port: number, target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = RAW_HTTP({ host: "127.0.0.1", port, path: target, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.once("error", (error) => reject(new Error(`raw GET ${JSON.stringify(target)} failed: ${error.message}`)));
    req.end();
  });
}

async function withServedControlPlane<T>(
  run: (port: number) => Promise<T>,
): Promise<T> {
  const app = createControlPlane();
  const port = await freePort();
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  try {
    return await run(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("control-plane HTTP surface — backslash request targets (GHSA-jpvv-r467-5p4w)", () => {
  it("serves the public health prefix normally (control path)", async () => {
    await withServedControlPlane(async (port) => {
      const response = await rawGet(port, "/healthz");
      expect(response.status).toBe(200);
      expect(response.body).toContain("sentropic-remote-control-plane");
    });
  });

  it("refuses raw-backslash request targets at the adapter boundary (400), before any routing", async () => {
    await withServedControlPlane(async (port) => {
      for (const target of RAW_BACKSLASH_TARGETS) {
        const response = await rawGet(port, target);
        // On the vulnerable adapter (2.1.5) the WHATWG rewrite routes
        // /healthz\..\sessions straight into GET /sessions, which answers
        // 200 with the session list JSON. This expectation was RED there.
        expect(response.status, `target ${JSON.stringify(target)} must be refused by the server`).toBe(400);
        expect(response.body).not.toContain("sessionId");
      }
    });
  });

  it("never reaches a protected namespace through an encoded-backslash traversal", async () => {
    await withServedControlPlane(async (port) => {
      for (const target of ENCODED_BACKSLASH_TARGETS) {
        const response = await rawGet(port, target);
        expect(response.status, `target ${JSON.stringify(target)} must not be resolved into a protected route`).toBe(404);
        expect(response.body).not.toContain("sessionId");
        expect(response.body).not.toContain("workspace");
      }
    });
  });
});
