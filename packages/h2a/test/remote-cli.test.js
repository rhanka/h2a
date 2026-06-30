import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEnvelope } from "@sentropic/h2a";
import {
  createLocalStore,
  remoteServerForStore,
  runRemoteSend,
  runRemoteServe
} from "../dist/index.js";

const SIGNER = "claude:proj-1";
const RECIPIENT = "codex:proj-2";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-remote-cli-"));
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function registerSigner(store, publicKeyPem) {
  store.registerInstance({
    id: SIGNER,
    instance: SIGNER,
    roles: ["AGENTS"],
    scopes: ["scope:demo"],
    capabilities: ["negotiate"],
    endpoints: [],
    publicKeys: [publicKeyPem],
    acceptedPolicies: [],
    createdAt: "2026-05-25T00:00:00.000Z"
  });
}

const envelope = (id = "env-cli-1") =>
  createEnvelope({
    id,
    type: "propose",
    actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
    target: { instance: RECIPIENT },
    body: { offer: 1 },
    createdAt: new Date().toISOString()
  });

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (c) => void (stdout += c) },
      stderr: { write: (c) => void (stderr += c) },
      cwd: () => process.cwd()
    },
    out: () => stdout,
    err: () => stderr
  };
}

test("remoteServerForStore authenticates against the registry + delivers to inbox (DEC-077)", async () => {
  const root = freshRoot();
  const { privateKeyPem, publicKeyPem } = keypair();
  try {
    const store = createLocalStore({ root });
    registerSigner(store, publicKeyPem);
    const server = remoteServerForStore(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/h2a/envelopes`;
    try {
      const cap = captureStreams();
      const rc = await runRemoteSend(
        {
          url,
          instance: SIGNER,
          "private-key": writePem(root, privateKeyPem),
          json: JSON.stringify(envelope())
        },
        cap.streams
      );
      assert.equal(rc, 0);
      assert.match(cap.out(), /"status": 202/);
      // delivered to the recipient's inbox
      assert.equal(store.readInbox(RECIPIENT).length, 1);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runRemoteSend returns 1 when the signer key is unknown to the server", async () => {
  const root = freshRoot();
  const { privateKeyPem } = keypair(); // signer NOT registered
  try {
    const store = createLocalStore({ root });
    const server = remoteServerForStore(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/h2a/envelopes`;
    try {
      const cap = captureStreams();
      const rc = await runRemoteSend(
        {
          url,
          instance: SIGNER,
          "private-key": writePem(root, privateKeyPem),
          json: JSON.stringify(envelope("env-unknown"))
        },
        cap.streams
      );
      assert.equal(rc, 1);
      assert.match(cap.out(), /"status": 401/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runRemoteSend rejects missing flags with exit 1", async () => {
  const cap = captureStreams();
  const rc = await runRemoteSend({ url: "http://x", instance: "a" }, cap.streams);
  assert.equal(rc, 1);
  assert.match(cap.err(), /required/);
});

test("runRemoteServe binds, serves, and resolves 0 on close (DEC-077)", async () => {
  const root = freshRoot();
  const { privateKeyPem, publicKeyPem } = keypair();
  try {
    const store = createLocalStore({ root });
    registerSigner(store, publicKeyPem);
    let server;
    const io = {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      cwd: () => process.cwd(),
      onListening: (s) => {
        server = s;
      }
    };
    const servePromise = runRemoteServe({ root, port: "0", host: "127.0.0.1" }, io);
    // wait until listening
    while (!server) await new Promise((r) => setTimeout(r, 5));
    const url = `http://127.0.0.1:${server.address().port}/h2a/envelopes`;

    const cap = captureStreams();
    const rc = await runRemoteSend(
      {
        url,
        instance: SIGNER,
        "private-key": writePem(root, privateKeyPem),
        json: JSON.stringify(envelope("env-serve-1"))
      },
      cap.streams
    );
    assert.equal(rc, 0);
    assert.equal(store.readInbox(RECIPIENT).length, 1);

    server.close();
    assert.equal(await servePromise, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runRemoteServe rejects an invalid --port", async () => {
  const root = freshRoot();
  try {
    const io = { stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: () => process.cwd() };
    const rc = await runRemoteServe({ root, port: "not-a-port" }, io);
    assert.equal(rc, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

let pemCounter = 0;
function writePem(root, pem) {
  const path = join(root, `signer-${pemCounter++}.pem`);
  writeFileSync(path, pem, "utf8");
  return path;
}
