import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as RESERVE_NET_SERVER } from "node:net";
import { request as RAW_HTTP } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startServer } from "./host.js";
import { resetSessions } from "./sessions.js";
import { resetSessionLedger } from "./ledger.js";

vi.mock("../claude-code-cli-lifecycle.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../claude-code-cli-lifecycle.js")>();
  return {
    ...mod,
    sweepOrphanSandboxes: vi
      .fn()
      .mockResolvedValue({ swept: 0, retained: 0, skippedAlive: 0 }),
  };
});

/**
 * GHSA-jpvv-r467-5p4w — the local LLM gateway host is served by
 * @hono/node-server, which (before 2.1.6) ran any request-target that failed
 * its strict validation through the WHATWG URL parser. WHATWG maps "\" to
 * "/" and collapses ".." segments, so `GET /health\..\v1\sessions` reached the
 * app as `/v1/sessions`. The host deliberately exposes only loopback traffic
 * (session minting is "unauthenticated local control-plane traffic"), but the
 * same adapter rewrite deceives any path-based rule in front of the deployment
 * — the O9 scenario is a laptop proxy that allow-lists /health for the
 * gateway while a backslash target escapes to /v1/* and /gw/* underneath.
 * The patched adapter refuses raw-backslash targets with 400 before routing.
 *
 * These tests drive the REAL HTTP boundary (`startServer` → `serve()`) with
 * raw request lines; the rewrite lives in the adapter, not in the Hono app.
 * The encoded corpus pins that %5C/%5c/..%5C/%255C targets never traverse
 * into the bearer-gated /gw mount: each stays a 404 at the host router.
 */

const RAW_BACKSLASH_TARGETS = [
  "/health\\..\\v1\\sessions",
  "/health\\..\\..\\gw\\v1\\models",
  "/v1\\sessions\\abc\\def",
];

const ENCODED_BACKSLASH_TARGETS = [
  "/health/..%5Cv1/sessions",
  "/health/..%5cgw/v1/models",
  "/health/..%5C..%5Cgw/v1/models",
  "/health/%2e%2e%5Cv1/sessions",
  "/health/..%255Cgw/v1/models",
];

let tempBase = "";

beforeEach(() => {
  // Same confinement contract as host.test.ts: every gateway composition
  // runs in temp HOME/XDG/H2A_ROOT with an empty temp PATH — never the
  // owner's real mesh store or real `claude`.
  tempBase = mkdtempSync(join(tmpdir(), "h2a-gateway-ghsa-"));
  const emptyBin = join(tempBase, "bin");
  mkdirSync(emptyBin, { recursive: true });
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("H2A_LLM_MESH_OWNER_SCOPE", "cli:test-owner");
  vi.stubEnv("HOME", join(tempBase, "home"));
  vi.stubEnv("XDG_RUNTIME_DIR", join(tempBase, "run"));
  vi.stubEnv("H2A_ROOT", join(tempBase, "h2a-root"));
  vi.stubEnv("PATH", emptyBin);
  resetSessions();
  resetSessionLedger();
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempBase) rmSync(tempBase, { recursive: true, force: true });
  tempBase = "";
});

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

describe("gateway host HTTP surface — backslash request targets (GHSA-jpvv-r467-5p4w)", () => {
  it("serves the public health prefix normally (control path)", async () => {
    const port = await freePort();
    vi.stubEnv("PORT", String(port));
    const server = await startServer();
    try {
      const response = await rawGet(port, "/health");
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve) => { (server as unknown as { close(callback?: () => void): void }).close(() => resolve()); });
    }
  });

  it("refuses raw-backslash request targets at the adapter boundary (400), before any routing", async () => {
    const port = await freePort();
    vi.stubEnv("PORT", String(port));
    const server = await startServer();
    try {
      for (const target of RAW_BACKSLASH_TARGETS) {
        const response = await rawGet(port, target);
        // On the vulnerable adapter (2.1.5) the WHATWG rewrite routes
        // /health\..\v1\sessions straight into GET /v1/sessions, which
        // answers 200 with the public session ledger through the public
        // prefix. This expectation was RED there.
        expect(response.status, `target ${JSON.stringify(target)} must be refused by the server`).toBe(400);
        expect(response.body).not.toContain("gatewaySessionId");
      }
    } finally {
      await new Promise<void>((resolve) => { (server as unknown as { close(callback?: () => void): void }).close(() => resolve()); });
    }
  });

  it("never reaches the /gw mount or v1 routes through an encoded-backslash traversal", async () => {
    const port = await freePort();
    vi.stubEnv("PORT", String(port));
    const server = await startServer();
    try {
      for (const target of ENCODED_BACKSLASH_TARGETS) {
        const response = await rawGet(port, target);
        expect(response.status, `target ${JSON.stringify(target)} must not be resolved into a gateway route`).toBe(404);
        expect(response.body).not.toContain("gatewaySessionId");
      }
    } finally {
      await new Promise<void>((resolve) => { (server as unknown as { close(callback?: () => void): void }).close(() => resolve()); });
    }
  });
});
