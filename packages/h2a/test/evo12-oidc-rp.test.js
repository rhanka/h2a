import assert from "node:assert/strict";
import test from "node:test";

import { buildUpstreamAuthorizeUrl, exchangeUpstreamCode } from "../dist/index.js";

const CONFIG = {
  issuer: "https://sentropic.sent-tech.ca",
  authorizeUrl: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize",
  tokenUrl: "https://sentropic.sent-tech.ca/api/v1/auth/oauth/token",
  clientId: "h2a-gateway",
  clientSecret: "s3cr3t",
  redirectUri: "https://h2a-mcp.sent-tech.ca/oidc/callback",
  scopes: ["openid", "profile"]
};

function idToken(claims) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "EdDSA", typ: "JWT" })}.${part(claims)}.sig`;
}

test("buildUpstreamAuthorizeUrl: authorization_code + PKCE toward 39-auth", () => {
  const url = new URL(buildUpstreamAuthorizeUrl(CONFIG, { state: "st", codeChallenge: "cc" }));
  assert.equal(url.origin + url.pathname, "https://sentropic.sent-tech.ca/api/v1/auth/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "h2a-gateway");
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(url.searchParams.get("scope"), "openid profile");
  assert.equal(url.searchParams.get("code_challenge"), "cc");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("exchangeUpstreamCode: posts the code with Basic auth + PKCE, returns the sub", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ id_token: idToken({ sub: "user-42" }), access_token: "at" }) };
  };
  const login = await exchangeUpstreamCode(CONFIG, { code: "abc", codeVerifier: "ver" }, fetchImpl);
  assert.equal(login.sub, "user-42");
  assert.equal(login.accessToken, "at");
  assert.equal(seen.url, CONFIG.tokenUrl);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, `Basic ${Buffer.from("h2a-gateway:s3cr3t").toString("base64")}`);
  assert.match(seen.init.body, /grant_type=authorization_code/);
  assert.match(seen.init.body, /code_verifier=ver/);
});

test("exchangeUpstreamCode: rejects non-2xx, missing id_token, and sub-less id_token", async () => {
  const fail = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => exchangeUpstreamCode(CONFIG, { code: "x", codeVerifier: "v" }, fail), /HTTP 401/);

  const noIdToken = async () => ({ ok: true, status: 200, json: async () => ({ access_token: "at" }) });
  await assert.rejects(() => exchangeUpstreamCode(CONFIG, { code: "x", codeVerifier: "v" }, noIdToken), /missing id_token/);

  const noSub = async () => ({ ok: true, status: 200, json: async () => ({ id_token: idToken({ aud: "x" }) }) });
  await assert.rejects(() => exchangeUpstreamCode(CONFIG, { code: "x", codeVerifier: "v" }, noSub), /no sub/);
});
