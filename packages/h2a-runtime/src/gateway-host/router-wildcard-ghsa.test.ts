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
 * GHSA-h7mg-cq63-vhpq surveillance pin — the mesh gateway HTTP surface
 * (hono, wildcard `app.all("*")` delegation into the composed cluster-mesh
 * plugin; bearer checks run inside the route handlers, not in wildcard
 * middleware). Wildcard-hono regressions that skip or re-route the delegate
 * must never turn a line-terminator path (%0A, %0D, %E2%80%A8, %E2%80%A9)
 * into a served gateway route: such a path matches no gateway route, so it
 * must stay an unauthenticated not-found that discloses no gateway state.
 *
 * On 4.13.13 (probed pre-bump) every corpus target is answered by the plain
 * "404 Not Found" handler and the three bearer routes answer 401
 * "authentication failed"; on 4.13.16+ (wildcards rebuilt as `[^]*`) the
 * delegation matches line-terminator paths too, hands them to the plugin,
 * and the plugin still has no matching route — same 404, same refusal. The
 * exact-auth differential lives on the wildcard-middleware surfaces pinned
 * by router-wildcard-ghsa.test.ts (control-plane) and
 * mcp-central-line-terminator-ghsa.test.js (central MCP); this file pins
 * the protected gateway routes and their refuse-without-credentials
 * behaviour across the hono bump, including the mounted-plugin surface.
 */

const GATEWAY_BEARER_TARGETS = [
  "/v1/messages",
  "/v1/responses",
  "/v1/chat/completions",
];

const LINE_TERMINATOR_TARGETS = [
  "/gw/v1/messages%0A",
  "/v1/messages%0A",
  "/v1%0A/responses",
  "/v1/responses%0D",
  "/v1/chat/completions%E2%80%A8",
  "/v1/sessions%E2%80%A9",
  "/health%0A",
];

let tempBase = "";

beforeEach(() => {
  // Same confinement contract as host.test.ts: every gateway composition
  // runs in temp HOME/XDG/H2A_ROOT with an empty temp PATH — never the
  // owner's real mesh store or real `claude`.
  tempBase = mkdtempSync(join(tmpdir(), "h2a-gateway-wildcard-ghsa-"));
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

interface RawResponse {
  status: number;
  body: string;
}

function rawExchange(
  port: number,
  target: string,
  method: string,
  rawBody?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = RAW_HTTP(
      { host: "127.0.0.1", port, path: target, method }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
    req.once("error", (error) => reject(new Error(`raw ${method} ${JSON.stringify(target)} failed: ${error.message}`)));
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

function rawGet(port: number, target: string): Promise<RawResponse> {
  return rawExchange(port, target, "GET");
}

function rawPostJson(port: number, target: string, body: Record<string, unknown>): Promise<RawResponse> {
  return rawExchange(port, target, "POST", JSON.stringify(body));
}

async function withGatewayHost<T>(run: (port: number) => Promise<T>): Promise<T> {
  const port = await freePort();
  vi.stubEnv("PORT", String(port));
  const server = await startServer();
  try {
    return await run(port);
  } finally {
    await new Promise<void>((resolve) => { (server as unknown as { close(callback?: () => void): void }).close(() => resolve()); });
  }
}

describe("gateway host HTTP surface — mesh gateway auth vs wildcard patterns (GHSA-h7mg-cq63-vhpq)", () => {
  it("serves the public health prefix and mints sessions normally (control paths)", async () => {
    await withGatewayHost(async (port) => {
      const health = await rawGet(port, "/health");
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ ok: true });
      const minted = await rawPostJson(port, "/v1/session", { sessionId: "router-wildcard-ghsa" });
      expect(minted.status).toBe(201);
      const session = JSON.parse(minted.body);
      expect(typeof session.gatewayToken).toBe("string");
      expect(session.clientSessionId).toBe("router-wildcard-ghsa");
    });
  });

  it("refuses every mesh gateway route without credentials", async () => {
    await withGatewayHost(async (port) => {
      for (const target of GATEWAY_BEARER_TARGETS) {
        const response = await rawPostJson(port, target, { model: "test-model" });
        expect(response.status, target).toBe(401);
        expect(response.body, target).toContain("authentication failed");
        expect(response.body, target).not.toContain("gatewayToken");
        expect(response.body, target).not.toContain("gatewaySessionId");
        expect(response.body, target).not.toContain("clientSessionId");
      }
    });
  });

  it("never resolves a line-terminator path into a gateway route serving gateway state", async () => {
    await withGatewayHost(async (port) => {
      for (const target of LINE_TERMINATOR_TARGETS) {
        const post = await rawPostJson(port, target, { model: "test-model" });
        // Probed pre-bump (4.13.13): the plain not-found handler answers;
        // composing the /gw mount deliberately refuses session-control
        // traffic, so nothing under /gw serves either. Either way the line-
        // terminator path must stay unresolvable and unauthenticated.
        expect(post.status, target).toBe(404);
        expect(post.body, target).not.toContain("gatewayToken");
        expect(post.body, target).not.toContain("gatewaySessionId");
        expect(post.body, target).not.toContain("clientSessionId");
        const get = await rawGet(port, target);
        expect(get.status, target).toBe(404);
        expect(get.body, target).not.toContain("gatewayToken");
        expect(get.body, target).not.toContain("gatewaySessionId");
        expect(get.body, target).not.toContain("clientSessionId");
      }
    });
  });
});
