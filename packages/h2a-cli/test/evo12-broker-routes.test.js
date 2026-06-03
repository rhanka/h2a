import assert from "node:assert/strict";
import test from "node:test";

import { buildBrokerRoutes, createBrokerLogin } from "../dist/index.js";

const CONFIG = {
  issuer: "https://sentropic.sent-tech.ca",
  authorizeUrl: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize",
  tokenUrl: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/token",
  clientId: "h2a-gateway",
  clientSecret: "s3cr3t",
  redirectUri: "https://h2a-mcp.sent-tech.ca/oidc/callback",
  scopes: ["openid"]
};

let N = 0;
function brokerWith(exchange) {
  return createBrokerLogin({
    config: CONFIG,
    exchange,
    baseRoot: "/var/lib/h2a/root",
    randomState: () => `st-${++N}`,
    pkce: () => ({ verifier: "ver", challenge: "chal" }),
    now: () => 1_000_000
  });
}

function app(broker, issueClaudeaiCode) {
  return buildBrokerRoutes({ brokerLogin: broker, issueClaudeaiCode });
}

test("GET /authorize → 302 to 39-auth /authorize with state + PKCE", async () => {
  const broker = brokerWith(async () => ({ sub: "u", idToken: "x.y.z" }));
  const router = app(broker, () => "https://claude.ai/cb?code=ISSUED");
  const res = await router.request("/authorize?redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=cl&code_challenge=clcc");
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, CONFIG.authorizeUrl);
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.ok(loc.searchParams.get("state"), "carries an upstream state");
});

test("GET /oidc/callback → exchanges, binds user/root, 302 back to claude.ai with the issued code", async () => {
  const broker = brokerWith(async (code) => {
    assert.equal(code, "up-code");
    return { sub: "user-9", idToken: "x.y.z" };
  });
  let bound;
  const router = app(broker, (claudeai, ctx) => {
    bound = { claudeai, ctx };
    return `${claudeai.redirect_uri}?code=ISSUED&state=${claudeai.state}`;
  });
  // start a login to register the state
  const started = await router.request("/authorize?redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=cl");
  const upstreamState = new URL(started.headers.get("location")).searchParams.get("state");

  const res = await router.request(`/oidc/callback?code=up-code&state=${upstreamState}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://claude.ai/cb?code=ISSUED&state=cl");
  assert.equal(bound.ctx.sub, "user-9");
  assert.equal(bound.ctx.root, "/var/lib/h2a/root/tenants/user-9");
  assert.equal(bound.claudeai.state, "cl", "original claude.ai request carried through");
});

test("GET /oidc/callback with unknown state → 400", async () => {
  const broker = brokerWith(async () => ({ sub: "u", idToken: "x.y.z" }));
  const router = app(broker, () => "x");
  const res = await router.request("/oidc/callback?code=c&state=bogus");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "access_denied");
});
