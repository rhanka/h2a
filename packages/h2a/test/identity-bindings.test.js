import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { signCanonical } from "@sentropic/h2a";
import {
  reclaimOrMint,
  findBinding,
  listBindings,
  verifyReclaimProof
} from "../dist/index.js";

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-bind-"));
  return { dir, root: join(dir, ".h2a") };
}
const KEY = { host: "claude", providerSessionId: "psid-1", workspaceId: "ws-1" };
const fixed = Date.parse("2026-05-31T00:00:00.000Z");

// Global mint counter so every mint() (across deps instances) is unique.
let MINT = 0;
function deps(proof = false) {
  return {
    verifyProof: () => proof,
    mint: () => {
      MINT += 1;
      return { instance: `claude:lbl:m${MINT}`, agentUuid: `uuid-m${MINT}` };
    },
    now: () => fixed
  };
}

test("first connect with no binding → MINT + records the binding", () => {
  const { dir, root } = freshRoot();
  try {
    const r = reclaimOrMint(root, KEY, deps());
    assert.equal(r.action, "mint");
    const recorded = findBinding(root, KEY);
    assert.equal(recorded.instance, r.instance);
    assert.equal(recorded.agentUuid, r.agentUuid);
    assert.equal(listBindings(root).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("binding writer carries the canonical fence epoch for its entire append transaction", () => {
  const { dir, root } = freshRoot();
  try {
    let observedFence;
    reclaimOrMint(root, KEY, {
      verifyProof: () => false,
      mint: () => {
        observedFence = JSON.parse(readFileSync(join(root, "identity", ".lock"), "utf8"));
        return { instance: "claude:lbl:fenced", agentUuid: "uuid-fenced" };
      },
      now: () => fixed
    });
    assert.equal(observedFence.protocol, "identity-binding-fence-v1");
    assert.equal(typeof observedFence.fenceEpoch, "string");
    assert.equal(observedFence.fenceEpoch.length > 0, true);
    assert.equal(existsSync(join(root, "identity", ".lock")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconnect with a bound key + valid proof → RECLAIM (same identity, no new binding)", () => {
  const { dir, root } = freshRoot();
  try {
    const first = reclaimOrMint(root, KEY, deps()); // mint
    const again = reclaimOrMint(root, KEY, deps(true)); // proof OK → reclaim
    assert.equal(again.action, "reclaim");
    assert.equal(again.instance, first.instance);
    assert.equal(again.agentUuid, first.agentUuid);
    assert.equal(listBindings(root).length, 1, "reclaim must not append a new binding");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a present id/workspace but FAILED proof → MINT a fresh identity (spoof rejected, de-collision)", () => {
  const { dir, root } = freshRoot();
  try {
    const first = reclaimOrMint(root, KEY, deps()); // mint
    const spoof = reclaimOrMint(root, KEY, deps(false)); // no key proof → new identity
    assert.equal(spoof.action, "mint");
    assert.notEqual(spoof.instance, first.instance);
    assert.notEqual(spoof.agentUuid, first.agentUuid);
    assert.equal(listBindings(root).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-anchored on conversation: a DIFFERENT providerSessionId in the same workspace MINTS a distinct identity (no collision)", () => {
  const { dir, root } = freshRoot();
  try {
    const first = reclaimOrMint(
      root,
      { host: "claude", providerSessionId: "psid-A", workspaceId: "ws-1" },
      deps()
    ); // mint
    const other = reclaimOrMint(
      root,
      { host: "claude", providerSessionId: "psid-B", workspaceId: "ws-1" },
      deps(true)
    ); // distinct conversation in the SAME workspace → no binding for psid-B → MINT
    assert.equal(other.action, "mint");
    assert.notEqual(other.instance, first.instance);
    assert.notEqual(other.agentUuid, first.agentUuid);
    assert.equal(
      listBindings(root).length,
      2,
      "two concurrent conversations in one workspace → two distinct identities (the BR25 collision fix)"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-anchored on conversation: the SAME providerSessionId reclaims its identity even across workspaces (one conversation = one agent)", () => {
  const { dir, root } = freshRoot();
  try {
    const a = reclaimOrMint(root, { host: "claude", providerSessionId: "p", workspaceId: "ws-1" }, deps());
    const b = reclaimOrMint(root, { host: "claude", providerSessionId: "p", workspaceId: "ws-2" }, deps(true));
    assert.equal(b.action, "reclaim", "same conversation UUID → reclaim, regardless of cwd");
    assert.equal(b.instance, a.instance);
    assert.equal(listBindings(root).length, 1, "one conversation → one identity");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyReclaimProof: a nonce signed by a bound key verifies; a stranger key does not", () => {
  const a = generateKeyPairSync("ed25519");
  const b = generateKeyPairSync("ed25519");
  const aPriv = a.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const aPub = a.publicKey.export({ format: "pem", type: "spki" }).toString();
  const bPub = b.publicKey.export({ format: "pem", type: "spki" }).toString();

  const nonce = "challenge-1780000000-abcd";
  const sig = signCanonical(nonce, { privateKeyPem: aPriv });

  assert.equal(verifyReclaimProof(nonce, sig, [bPub, aPub]), true); // matches amid others
  assert.equal(verifyReclaimProof(nonce, sig, [bPub]), false); // unrelated key only
  assert.equal(verifyReclaimProof(nonce, sig, []), false); // empty keyring
});
