/**
 * Round-2 P2: a globally configured LLM gateway URL alone must never route a
 * session through the gateway. Acquisition (POST <gw>/v1/session) and pod
 * injection both require the explicit per-session `llmGateway: true` choice,
 * which is persisted on the descriptor so hard refresh keeps it.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProvisionOptions,
  SessionProvisioner,
} from "@sentropic/remote-k8s-orchestrator";
import { createAjv, type ValidationVars } from "../validation.js";
import { createSessionsRouter } from "./sessions.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "h2a-sessions-gw-"));
const GW_URL = "https://llm-gateway.test";

type RecordedCall = {
  readonly kind: "provision" | "refresh";
  readonly options?: ProvisionOptions;
};

function recordingProvisioner() {
  const calls: RecordedCall[] = [];
  const provisioner: SessionProvisioner = {
    async provision(_descriptor, _emit, options) {
      calls.push({ kind: "provision", options });
    },
    async refresh(_descriptor, _emit, options) {
      calls.push({ kind: "refresh", options });
    },
    async destroy() {},
    async inspect() {
      return undefined;
    },
  };
  return { provisioner, calls };
}

const gatewayFetches: string[] = [];

function stubGatewayFetch() {
  vi.stubGlobal(
    "fetch",
    async (url: unknown) => {
      gatewayFetches.push(String(url));
      return new Response(JSON.stringify({ gatewayToken: "gw-test-token" }), {
        status: 200,
      });
    },
  );
}

function makeRouter() {
  const dataDir = mkdtempSync(join(SCRATCH, "data-"));
  process.env.DATA_DIR = dataDir;
  const ajv = createAjv();
  const { provisioner, calls } = recordingProvisioner();
  const { router } = createSessionsRouter({
    ajv,
    provisioner,
    llmGatewayUrl: GW_URL,
  });
  // Auth lives on the parent app in production (authMiddleware); mount the
  // router the same way and inject the test identity there.
  const app = new Hono<{ Variables: ValidationVars }>();
  app.use("*", async (c, next) => {
    c.set("auth", { userId: "test-user", claims: {} });
    await next();
  });
  app.route("/", router);
  return { router: app, calls, dataDir };
}

describe("sessions router gateway exclusion (round-2 P2)", () => {
  let dataDir = "";

  beforeEach(() => {
    gatewayFetches.length = 0;
    stubGatewayFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATA_DIR;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("a global gateway URL alone acquires nothing and injects nothing", async () => {
    const { router, calls } = makeRouter();

    const res = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "claude", target: "k3s" }),
    });

    expect(res.status).toBe(201);
    expect(gatewayFetches).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.gatewayToken).toBeUndefined();
    expect(calls[0]?.options?.llmGateway).not.toBe(true);
  });

  it("an explicit llmGateway choice acquires a per-session token and threads it to provisioning", async () => {
    const { router, calls } = makeRouter();

    const res = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "claude", target: "k3s", llmGateway: true }),
    });

    expect(res.status).toBe(201);
    expect(gatewayFetches).toHaveLength(1);
    expect(gatewayFetches[0]).toBe(`${GW_URL}/v1/session`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.gatewayToken).toBe("gw-test-token");
    expect(calls[0]?.options?.llmGateway).toBe(true);

    const created = (await res.json()) as { session: { id: string } };
    const got = await router.request(`/${created.session.id}`);
    expect(got.status).toBe(200);
    const descriptor = (await got.json()) as {
      session: { llmGateway?: boolean };
    };
    expect(descriptor.session.llmGateway).toBe(true);
  });

  it("hard refresh re-acquires the gateway only for explicit sessions", async () => {
    const { router, calls } = makeRouter();

    const plain = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "claude", target: "k3s" }),
    });
    const plainId = ((await plain.json()) as { session: { id: string } }).session.id;

    const gw = await router.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: "claude", target: "k3s", llmGateway: true }),
    });
    const gwId = ((await gw.json()) as { session: { id: string } }).session.id;
    expect(gatewayFetches).toHaveLength(1);

    const creds = { ".claude/.credentials.json": "aGVsbG8=" };
    const plainRefresh = await router.request(`/${plainId}/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    expect(plainRefresh.status).toBe(200);
    expect(gatewayFetches).toHaveLength(1);

    const gwRefresh = await router.request(`/${gwId}/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    expect(gwRefresh.status).toBe(200);
    expect(gatewayFetches).toHaveLength(2);
    const refreshCalls = calls.filter((c) => c.kind === "refresh");
    expect(refreshCalls).toHaveLength(2);
    expect(refreshCalls[1]?.options?.gatewayToken).toBe("gw-test-token");
    expect(refreshCalls[1]?.options?.llmGateway).toBe(true);
  });
});
