import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
const { createLocalGatewayApp } = await import(
  "../../h2a-runtime/dist/gateway-host/host.js"
);
import {
  resetSessionLedger
} from "../../h2a-runtime/dist/gateway-host/ledger.js";
import {
  resetSessions
} from "../../h2a-runtime/dist/gateway-host/sessions.js";

test.afterEach(() => {
  resetSessions();
  resetSessionLedger();
});

test("local gateway mints process-local opaque session bearers", async () => {
  const app = await createLocalGatewayApp({ ownerScopeRef: "owner:node-test" });
  const first = await app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-one",
      clientSessionId: "claude-one",
      workspaceId: "workspace-one"
    })
  });
  const second = await app.request("/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-two",
      clientSessionId: "claude-two",
      workspaceId: "workspace-one"
    })
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.match(firstBody.gatewayToken, /^gw-v2-/);
  assert.match(secondBody.gatewayToken, /^gw-v2-/);
  assert.notEqual(firstBody.gatewayToken, secondBody.gatewayToken);
  assert.doesNotMatch(JSON.stringify([firstBody, secondBody]), /account|provider|model|transport/i);
});

test("gateway rejects an unknown bearer before planning or egress", async () => {
  const app = await createLocalGatewayApp({ ownerScopeRef: "owner:node-test" });
  const response = await app.request("/v1/messages", {
    method: "POST",
    headers: {
      authorization: "Bearer unknown",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-opus-5-xhigh",
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }]
    })
  });
  assert.equal(response.status, 401);
});
