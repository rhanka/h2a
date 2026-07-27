import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Hono } from "hono";

const accountsModule = await import(
  "../../h2a-runtime/dist/llm-gateway-runtime/accounts.js"
);
const stickyModule = await import(
  "../../h2a-runtime/dist/llm-gateway-runtime/sticky.js"
);
const proxyModule = await import(
  "../../h2a-runtime/dist/llm-gateway-runtime/proxy-anthropic.js"
);
const ledgerModule = await import(
  "../../h2a-runtime/dist/llm-gateway-runtime/session-ledger.js"
);

async function exerciseUpstream(status, headers = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-gateway-status-"));
  const accountId = `anthropic-${status}`;
  process.env.LLM_GATEWAY_TOKEN_SEED = `seed-${status}`;
  process.env.LLM_GATEWAY_STICKY_FILE = join(scratch, "sticky.json");
  process.env.GATEWAY_ACCOUNTS = JSON.stringify([
    {
      id: accountId,
      provider: "anthropic",
      label: "Raw API key",
      token: `secret-${status}`
    }
  ]);
  accountsModule.resetAccountsCache();
  ledgerModule.resetSessionLedger();
  const sessionId = `h2a-status-${status}`;
  const acquired = await stickyModule.acquireSession(sessionId, {
    clientSessionId: sessionId
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status }), {
      status,
      headers: { "content-type": "application/json", ...headers }
    });
  const app = new Hono();
  app.post("/v1/messages", proxyModule.handleMessages);
  try {
    const response = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${acquired.gatewayToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "not-a-canonical-route",
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }]
        })
      })
    );
    await response.text();
    return {
      response,
      ledger: ledgerModule.getSessionLedgerEntry(sessionId)
    };
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GATEWAY_ACCOUNTS;
    delete process.env.LLM_GATEWAY_STICKY_FILE;
    delete process.env.LLM_GATEWAY_TOKEN_SEED;
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("an actual 429 is the only fallback response projected as rate-limited", async () => {
  const { response, ledger } = await exerciseUpstream(429, {
    "retry-after": "30"
  });
  assert.equal(response.status, 429);
  assert.equal(ledger?.state, "rate-limited");
  assert.equal(ledger?.lastRateLimit?.retryAfterMs, 30_000);
});

test("an upstream 404 is retained as idle route history, never projected as 429", async () => {
  const { response, ledger } = await exerciseUpstream(404);
  assert.equal(response.status, 404);
  assert.equal(ledger?.state, "idle");
  assert.equal(ledger?.lastRateLimit, undefined);
});

test("a streamed success stays active until its body is consumed, then becomes idle", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-gateway-stream-"));
  process.env.LLM_GATEWAY_TOKEN_SEED = "seed-stream";
  process.env.LLM_GATEWAY_STICKY_FILE = join(scratch, "sticky.json");
  process.env.GATEWAY_ACCOUNTS = JSON.stringify([
    {
      id: "anthropic-stream",
      provider: "anthropic",
      label: "stream account",
      token: "stream-secret"
    }
  ]);
  accountsModule.resetAccountsCache();
  ledgerModule.resetSessionLedger();
  const acquired = await stickyModule.acquireSession("h2a-stream", {
    clientSessionId: "h2a-stream"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("event-one\nevent-two\n", { status: 200 });
  const app = new Hono();
  app.post("/v1/messages", proxyModule.handleMessages);
  try {
    const response = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${acquired.gatewayToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ model: "not-a-canonical-route", messages: [] })
      })
    );
    assert.equal(ledgerModule.getSessionLedgerEntry("h2a-stream")?.state, "active");
    await response.text();
    assert.equal(ledgerModule.getSessionLedgerEntry("h2a-stream")?.state, "idle");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GATEWAY_ACCOUNTS;
    delete process.env.LLM_GATEWAY_STICKY_FILE;
    delete process.env.LLM_GATEWAY_TOKEN_SEED;
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("an alias route is refused rather than sent through an incompatible account", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "h2a-gateway-route-"));
  process.env.LLM_GATEWAY_TOKEN_SEED = "seed-route";
  process.env.LLM_GATEWAY_STICKY_FILE = join(scratch, "sticky.json");
  process.env.GATEWAY_ACCOUNTS = JSON.stringify([
    {
      id: "anthropic-only",
      provider: "anthropic",
      label: "anthropic only",
      token: "anthropic-secret"
    }
  ]);
  accountsModule.resetAccountsCache();
  ledgerModule.resetSessionLedger();
  const acquired = await stickyModule.acquireSession("h2a-route", {
    clientSessionId: "h2a-route"
  });
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response("must not be reached", { status: 200 });
  };
  const app = new Hono();
  app.post("/v1/messages", proxyModule.handleMessages);
  try {
    const response = await app.fetch(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${acquired.gatewayToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ model: "claude-opus-5-high", messages: [] })
      })
    );
    assert.equal(response.status, 503);
    assert.equal(upstreamCalls, 0);
    const ledger = ledgerModule.getSessionLedgerEntry("h2a-route");
    assert.equal(ledger?.state, "idle");
    assert.equal(ledger?.requestedModel, undefined);
    assert.equal(ledger?.upstreamModel, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GATEWAY_ACCOUNTS;
    delete process.env.LLM_GATEWAY_STICKY_FILE;
    delete process.env.LLM_GATEWAY_TOKEN_SEED;
    rmSync(scratch, { recursive: true, force: true });
  }
});
