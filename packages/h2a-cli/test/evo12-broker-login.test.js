import assert from "node:assert/strict";
import test from "node:test";

import { createBrokerLogin } from "../dist/index.js";

const CONFIG = {
  issuer: "https://sentropic.sent-tech.ca",
  authorizeUrl: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize",
  tokenUrl: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/token",
  clientId: "h2a-gateway",
  clientSecret: "s3cr3t",
  redirectUri: "https://h2a-mcp.sent-tech.ca/oidc/callback",
  scopes: ["openid"]
};

let CLOCK = 1_000_000;
let N = 0;
function deps(exchange) {
  return {
    config: CONFIG,
    exchange,
    baseRoot: "/var/lib/h2a/root",
    randomState: () => `state-${++N}`,
    pkce: () => ({ verifier: "ver", challenge: "chal" }),
    now: () => CLOCK,
    maxAgeMs: 600_000
  };
}

test("start stores pending + redirects to 39-auth with state+PKCE; complete exchanges → sub + per-user root", async () => {
  const broker = createBrokerLogin(deps(async (code, verifier) => {
    assert.equal(code, "up-code");
    assert.equal(verifier, "ver");
    return { sub: "user-7", idToken: "x.y.z" };
  }));
  const claudeai = { redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "cl-state" };
  const started = broker.start(claudeai);
  const u = new URL(started.redirectUrl);
  assert.equal(u.origin + u.pathname, CONFIG.authorizeUrl);
  assert.equal(u.searchParams.get("state"), started.state);
  assert.equal(u.searchParams.get("code_challenge"), "chal");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(broker.pendingCount(), 1);

  const done = await broker.complete(started.state, "up-code");
  assert.deepEqual(done.claudeai, claudeai, "original claude.ai request is carried through");
  assert.equal(done.sub, "user-7");
  assert.equal(done.root, "/var/lib/h2a/root/tenants/user-7");
  assert.equal(broker.pendingCount(), 0, "pending consumed (single-use)");
});

test("complete: unknown state, replayed state, and expired state all reject", async () => {
  const broker = createBrokerLogin(deps(async () => ({ sub: "u", idToken: "x.y.z" })));
  await assert.rejects(() => broker.complete("nope", "c"), /unknown state/);

  const s = broker.start({}).state;
  await broker.complete(s, "c"); // first ok
  await assert.rejects(() => broker.complete(s, "c"), /unknown state/); // replay → consumed

  const s2 = broker.start({}).state;
  CLOCK += 600_001; // past TTL
  await assert.rejects(() => broker.complete(s2, "c"), /expired/);
});
