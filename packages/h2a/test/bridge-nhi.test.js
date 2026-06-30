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
  runCli,
  runRemoteSend
} from "../dist/index.js";

function freshWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), "h2a-bridge-nhi-ws-"));
  const root = join(mkdtempSync(join(tmpdir(), "h2a-bridge-nhi-root-")), ".h2a");
  return { cwd, root };
}

function captureStreams(cwd = process.cwd()) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: { write: (chunk) => void (stdout += chunk) },
      stderr: { write: (chunk) => void (stderr += chunk) },
      cwd: () => cwd
    },
    out: () => stdout,
    err: () => stderr
  };
}

function withRemoteBridgeEnv(sessionId, workspaceId, fn) {
  const previousSession = process.env.SESSION_ID;
  const previousWorkspace = process.env.SESSION_WORKSPACE_ID;
  process.env.SESSION_ID = sessionId;
  process.env.SESSION_WORKSPACE_ID = workspaceId;
  try {
    return fn();
  } finally {
    if (previousSession === undefined) delete process.env.SESSION_ID;
    else process.env.SESSION_ID = previousSession;
    if (previousWorkspace === undefined) delete process.env.SESSION_WORKSPACE_ID;
    else process.env.SESSION_WORKSPACE_ID = previousWorkspace;
  }
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

let pemCounter = 0;
function writePem(root, pem) {
  const path = join(root, `bridge-signer-${pemCounter++}.pem`);
  writeFileSync(path, pem, "utf8");
  return path;
}

function envelope(id, signer, recipient) {
  return createEnvelope({
    id,
    type: "event",
    actor: { instance: signer, role: "AGENTS", scope: "scope:default" },
    target: { instance: recipient },
    body: { kind: "message", text: "bridge hello" },
    createdAt: new Date().toISOString()
  });
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status: res.status, body: await res.json() };
}

test("remote bridge sessions register as signing peers and authenticate remote envelopes (EVO-11)", async () => {
  const { cwd, root } = freshWorkspace();
  const sessionId = "sess-evo11";
  const workspaceId = "ws:evo11-workspace";
  const bridgeInstance = `remote:${sessionId}`;
  const recipient = "codex:receiver";
  try {
    const connected = withRemoteBridgeEnv(sessionId, workspaceId, () => {
      const cap = captureStreams(cwd);
      const rc = runCli(["connect", "--root", root, "--host", "remote"], cap.streams);
      assert.equal(rc, 0, cap.err());
      return JSON.parse(cap.out());
    });

    assert.equal(connected.instance, bridgeInstance);
    assert.equal(connected.identity.action, "mint");
    assert.equal(connected.identity.providerSessionSource, "bridge");
    assert.equal(connected.identity.workspace.id, workspaceId);

    const discoverCap = captureStreams(cwd);
    assert.equal(
      runCli(["discover", "--root", root, "--scope", "scope:default"], discoverCap.streams),
      0
    );
    const discovered = JSON.parse(discoverCap.out());
    const bridge = discovered.find((entry) => entry.instance === bridgeInstance);
    assert.ok(bridge, "remote bridge NHI should appear in discover");
    assert.equal(bridge.publicKeys.length, 1);
    assert.equal(bridge.workspace.id, workspaceId);

    const store = createLocalStore({ root });
    const server = remoteServerForStore(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/h2a/envelopes`;
    try {
      const acceptedCap = captureStreams(cwd);
      const acceptedRc = await runRemoteSend(
        {
          url,
          instance: bridgeInstance,
          "private-key": connected.identity.privateKeyPath,
          json: JSON.stringify(envelope("env-evo11-ok", bridgeInstance, recipient))
        },
        acceptedCap.streams
      );
      assert.equal(acceptedRc, 0, acceptedCap.err());
      assert.match(acceptedCap.out(), /"status": 202/);
      assert.equal(store.readInbox(recipient).length, 1);

      const unsigned = await postJson(
        url,
        envelope("env-evo11-unsigned", bridgeInstance, recipient)
      );
      assert.equal(unsigned.status, 400);
      assert.equal(unsigned.body.reason, "no-signature");

      const attacker = keypair();
      const wrongKeyCap = captureStreams(cwd);
      const wrongKeyRc = await runRemoteSend(
        {
          url,
          instance: bridgeInstance,
          "private-key": writePem(root, attacker.privateKeyPem),
          json: JSON.stringify(envelope("env-evo11-wrong-key", bridgeInstance, recipient))
        },
        wrongKeyCap.streams
      );
      assert.equal(wrongKeyRc, 1);
      assert.match(wrongKeyCap.out(), /"status": 401/);
      assert.equal(store.readInbox(recipient).length, 1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
