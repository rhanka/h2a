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
  runCli
} from "../dist/index.js";

const SIGNER = "claude:proj-1";
const RECIPIENT = "codex:proj-2";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-keyring-"));
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function registerSigner(store, publicKeys = []) {
  store.registerInstance({
    id: SIGNER,
    instance: SIGNER,
    roles: ["AGENTS"],
    scopes: ["scope:demo"],
    capabilities: ["negotiate"],
    endpoints: [],
    publicKeys,
    acceptedPolicies: [],
    createdAt: "2026-05-25T00:00:00.000Z"
  });
}

test("addInstanceKey + listInstanceKeys union registration & keyring (DEC-078)", () => {
  const root = freshRoot();
  try {
    const a = keypair();
    const b = keypair();
    const store = createLocalStore({ root });
    registerSigner(store, [a.publicKeyPem]);
    assert.deepEqual(store.listInstanceKeys(SIGNER), [a.publicKeyPem]);
    store.addInstanceKey(SIGNER, b.publicKeyPem);
    const keys = store.listInstanceKeys(SIGNER);
    assert.equal(keys.length, 2);
    assert.ok(keys.includes(a.publicKeyPem) && keys.includes(b.publicKeyPem));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("addInstanceKey rejects unknown instance and duplicate key", () => {
  const root = freshRoot();
  try {
    const a = keypair();
    const store = createLocalStore({ root });
    assert.throws(() => store.addInstanceKey(SIGNER, a.publicKeyPem), /not registered/i);
    registerSigner(store, [a.publicKeyPem]);
    assert.throws(() => store.addInstanceKey(SIGNER, a.publicKeyPem), /already registered/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a keys add/list via CLI", () => {
  const root = freshRoot();
  try {
    const a = keypair();
    const store = createLocalStore({ root });
    registerSigner(store, [a.publicKeyPem]);
    const b = keypair();
    const pubPath = join(root, "..", "b.pub.pem");
    writeFileSync(pubPath, b.publicKeyPem, "utf8");

    let out = "";
    const streams = {
      stdout: { write: (c) => void (out += c) },
      stderr: { write: () => {} },
      cwd: () => process.cwd()
    };
    assert.equal(
      runCli(["keys", "add", "--root", root, "--instance", SIGNER, "--public-key", pubPath], streams),
      0
    );
    out = "";
    assert.equal(runCli(["keys", "list", "--root", root, "--instance", SIGNER], streams), 0);
    const listed = JSON.parse(out);
    assert.equal(listed.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rotation: a freshly-added key verifies at the remote server (DEC-078)", async () => {
  const root = freshRoot();
  try {
    const original = keypair();
    const rotated = keypair();
    const store = createLocalStore({ root });
    // registered with only the original key
    registerSigner(store, [original.publicKeyPem]);
    // rotate-in the new key
    store.addInstanceKey(SIGNER, rotated.publicKeyPem);

    const server = remoteServerForStore(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/h2a/envelopes`;
    try {
      // sign with the ROTATED key — must verify because the server tries all keys
      const pemPath = join(root, "..", "rotated.key.pem");
      writeFileSync(pemPath, rotated.privateKeyPem, "utf8");
      const cap = {
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        cwd: () => process.cwd()
      };
      const rc = await runRemoteSend(
        {
          url,
          instance: SIGNER,
          "private-key": pemPath,
          json: JSON.stringify(
            createEnvelope({
              id: "env-rot",
              type: "propose",
              actor: { instance: SIGNER, role: "AGENTS", scope: "scope:demo" },
              target: { instance: RECIPIENT },
              body: {},
              createdAt: new Date().toISOString()
            })
          )
        },
        cap
      );
      assert.equal(rc, 0);
      assert.equal(store.readInbox(RECIPIENT).length, 1);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
