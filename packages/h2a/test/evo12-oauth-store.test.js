import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileOAuthStore } from "../dist/runtime/mcp-http/oauth/file-store.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-oauth-"));
  return { dir, store: new FileOAuthStore(join(dir, "oauth.json")) };
}

test("client register/get round-trips + persists across a reload", async () => {
  const { dir, store } = freshStore();
  try {
    await store.load();
    const client = { client_id: "c1", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
    await store.registerClient(client);
    assert.deepEqual(await store.getClient("c1"), client);
    const reloaded = new FileOAuthStore(store.path);
    await reloaded.load();
    assert.equal((await reloaded.getClient("c1")).client_id, "c1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authorization code is single-use + expiry-gated", async () => {
  const { dir, store } = freshStore();
  try {
    await store.load();
    const now = 1000;
    await store.putAuthorizationCode("code-1", {
      clientId: "c1", redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: "ch", scopes: ["h2a:read"], resource: "https://h/mcp",
      createdAt: now, expiresAt: now + 60
    });
    assert.ok(await store.getAuthorizationCode("code-1", now)); // valid
    const consumed = await store.consumeAuthorizationCode("code-1", now);
    assert.ok(consumed);
    assert.equal(await store.consumeAuthorizationCode("code-1", now), undefined); // no replay
    // expiry
    await store.putAuthorizationCode("code-2", {
      clientId: "c1", redirectUri: "x", codeChallenge: "ch", scopes: ["h2a:read"],
      resource: "r", createdAt: now, expiresAt: now + 10
    });
    assert.equal(await store.getAuthorizationCode("code-2", now + 11), undefined); // expired
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token put/find/revoke", async () => {
  const { dir, store } = freshStore();
  try {
    await store.load();
    await store.putToken("tok-1", {
      tokenType: "access", clientId: "c1", scopes: ["h2a:read"], resource: "r",
      issuedAt: 1, expiresAt: 3601
    });
    assert.equal((await store.findToken("tok-1")).tokenType, "access");
    await store.revokeToken("tok-1", 100);
    assert.equal((await store.findToken("tok-1")).revokedAt, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
