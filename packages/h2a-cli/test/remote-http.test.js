import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

import { createEnvelope, createReplayGuard } from "@sentropic/h2a";
import {
  createRemoteServer,
  rejectionStatus,
  sendRemoteEnvelope
} from "../dist/index.js";

const SIGNER = "claude:proj-1";
const RECIPIENT = "codex:proj-2";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function envelope(id = "env-h1") {
  return createEnvelope({
    id,
    type: "propose",
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    target: { instance: RECIPIENT },
    body: { offer: 1 },
    createdAt: new Date().toISOString()
  });
}

// Start an ephemeral server on a random port; returns { url, delivered, close }.
async function startServer(over = {}) {
  const { publicKeyPem } = over.keys ?? keypair();
  const delivered = [];
  const server = createRemoteServer({
    resolvePublicKey: (who) => (who === SIGNER ? publicKeyPem : undefined),
    deliver: (recipient, env) => delivered.push({ recipient, env }),
    guard: createReplayGuard(),
    ...over.serverOptions
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/h2a/envelopes`,
    delivered,
    publicKeyPem,
    close: () => new Promise((r) => server.close(r))
  };
}

test("rejectionStatus maps reasons to sensible HTTP codes", () => {
  assert.equal(rejectionStatus("malformed"), 400);
  assert.equal(rejectionStatus("bad-signature"), 401);
  assert.equal(rejectionStatus("no-public-key"), 401);
  assert.equal(rejectionStatus("replayed"), 409);
  assert.equal(rejectionStatus("expired"), 422);
});

test("end-to-end: signed envelope is accepted (202) and delivered (DEC-076)", async () => {
  const keys = keypair();
  const srv = await startServer({ keys });
  try {
    const res = await sendRemoteEnvelope(srv.url, envelope(), {
      by: SIGNER,
      privateKeyPem: keys.privateKeyPem
    });
    assert.equal(res.status, 202);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.deliveredTo, RECIPIENT);
    assert.equal(srv.delivered.length, 1);
    assert.equal(srv.delivered[0].env.id, "env-h1");
  } finally {
    await srv.close();
  }
});

test("a signature from the wrong key is rejected with 401", async () => {
  const keys = keypair();
  const attacker = keypair();
  const srv = await startServer({ keys });
  try {
    const res = await sendRemoteEnvelope(srv.url, envelope("env-bad"), {
      by: SIGNER,
      privateKeyPem: attacker.privateKeyPem
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.reason, "bad-signature");
    assert.equal(srv.delivered.length, 0);
  } finally {
    await srv.close();
  }
});

test("a replayed envelope is rejected with 409 on second POST", async () => {
  const keys = keypair();
  const srv = await startServer({ keys });
  try {
    const env = envelope("env-dup");
    const first = await sendRemoteEnvelope(srv.url, env, {
      by: SIGNER,
      privateKeyPem: keys.privateKeyPem
    });
    assert.equal(first.status, 202);
    // Re-send the same envelope (same id + createdAt). The guard dedups on id,
    // so the second receipt is refused as a replay even though the signature is
    // valid — the canonical defense against a capture-and-resend.
    const second = await sendRemoteEnvelope(srv.url, env, {
      by: SIGNER,
      privateKeyPem: keys.privateKeyPem
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.reason, "replayed");
    assert.equal(srv.delivered.length, 1);
  } finally {
    await srv.close();
  }
});

test("wrong path → 404, wrong method → 405", async () => {
  const keys = keypair();
  const srv = await startServer({ keys });
  const base = srv.url.replace("/h2a/envelopes", "");
  try {
    const notFound = await fetch(`${base}/nope`, { method: "POST", body: "{}" });
    assert.equal(notFound.status, 404);
    const wrongMethod = await fetch(srv.url, { method: "GET" });
    assert.equal(wrongMethod.status, 405);
  } finally {
    await srv.close();
  }
});

test("malformed JSON body → 400", async () => {
  const keys = keypair();
  const srv = await startServer({ keys });
  try {
    const res = await fetch(srv.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    assert.equal(res.status, 400);
  } finally {
    await srv.close();
  }
});
