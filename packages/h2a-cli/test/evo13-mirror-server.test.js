import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { signEnvelope } from "@sentropic/h2a";
import { buildInstanceMirror, createLocalStore, mirrorServerForStore } from "../dist/index.js";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "pem", type: "spki" }).toString(),
    priv: privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  };
}

const INSTANCE = "claude:proj:aaaaaaaaaaaa";
function registration(pub) {
  return {
    id: INSTANCE,
    instance: INSTANCE,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: "file:///tmp/.h2a" }],
    publicKeys: [pub],
    acceptedPolicies: [],
    createdAt: "2026-06-02T11:00:00.000Z"
  };
}

function signedMirror(pub, priv) {
  const env = buildInstanceMirror(
    { findInstance: (id) => (id === INSTANCE ? registration(pub) : undefined) },
    INSTANCE,
    Date.now()
  );
  return signEnvelope(env, { by: INSTANCE, privateKeyPem: priv });
}

async function post(server, body) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/h2a/mirror`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: res.status, json: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("ingester applies an enrolled-key mirror → 202 and the remote store now lists the instance", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-evo13-")), ".h2a");
  try {
    const k = keypair();
    const remote = createLocalStore({ root });
    assert.equal(remote.findInstance(INSTANCE), undefined); // empty before
    const server = mirrorServerForStore(remote, { enrolledKeys: [k.pub] });
    const { status, json } = await post(server, signedMirror(k.pub, k.priv));
    assert.equal(status, 202, JSON.stringify(json));
    assert.deepEqual(json.applied, [INSTANCE]);
    // re-open the store to prove it was persisted, then discover
    const reread = createLocalStore({ root });
    assert.ok(reread.findInstance(INSTANCE), "instance must be discoverable on the remote");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ingester refuses an unknown (non-enrolled) key → 401, store untouched", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-evo13-")), ".h2a");
  try {
    const k = keypair();
    const remote = createLocalStore({ root });
    const server = mirrorServerForStore(remote, { enrolledKeys: [] }); // nobody enrolled
    const { status, json } = await post(server, signedMirror(k.pub, k.priv));
    assert.equal(status, 401);
    assert.equal(json.reason, "unauthorized-key");
    assert.equal(createLocalStore({ root }).findInstance(INSTANCE), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
