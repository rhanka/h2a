import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeHash, signCanonical } from "@sentropic/h2a";
import { createLocalStore } from "../dist/index.js";

function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function nowIso() {
  return new Date().toISOString();
}

function setupNegotiation({
  store,
  signers,
  scope = "scope:nego",
  subject = "engagement"
}) {
  const keys = new Map();
  for (const { id, role } of signers) {
    const kp = newKeyPair();
    keys.set(id, kp);
    store.registerInstance({
      id,
      instance: id,
      roles: [role],
      scopes: [scope],
      capabilities: [],
      endpoints: [],
      publicKeys: [kp.publicPem],
      acceptedPolicies: [],
      createdAt: nowIso()
    });
  }
  const negotiationId = `nego-${Math.random().toString(36).slice(2, 8)}`;
  store.openNegotiation({
    id: negotiationId,
    scope,
    parties: signers.map((s) => s.id),
    subject,
    status: "draft",
    requiredSigners: signers.map((s) => s.id)
  });
  return { negotiationId, keys };
}

function appendOffer(store, negotiationId, signer, role, artifact, scope = "scope:nego") {
  store.appendNegotiationEvent(negotiationId, {
    id: "evt-offer-01",
    type: "propose",
    actor: { instance: signer, role, scope },
    body: { artifact },
    createdAt: nowIso()
  });
}

function appendSignature(store, negotiationId, signer, role, privatePem, artifact, scope = "scope:nego") {
  const artifactHash = computeHash(artifact);
  const signature = signCanonical(
    { artifactHash },
    { by: signer, privateKeyPem: privatePem }
  );
  store.appendNegotiationEvent(negotiationId, {
    id: `evt-sign-${signer.replace(":", "-")}`,
    type: "event",
    actor: { instance: signer, role, scope },
    body: { kind: "signature", artifactHash, signature },
    createdAt: nowIso()
  });
}

test("two CONDUCTORs signing an ENGAGEMENT stabilize successfully", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-auth-ok-"));
  try {
    const store = createLocalStore({ root });
    const signers = [
      { id: "conductor:01", role: "CONDUCTOR" },
      { id: "conductor:02", role: "CONDUCTOR" }
    ];
    const { negotiationId, keys } = setupNegotiation({ store, signers });

    const artifact = {
      kind: "ENGAGEMENT",
      id: "engagement:auth-ok",
      scope: "scope:nego",
      goal: "ship"
    };
    appendOffer(store, negotiationId, signers[0].id, "CONDUCTOR", artifact);
    for (const s of signers) {
      appendSignature(store, negotiationId, s.id, "CONDUCTOR", keys.get(s.id).privatePem, artifact);
    }

    const result = store.stabilizeNegotiation(negotiationId);
    assert.equal(result.record.status, "stabilized");
    assert.equal(result.artifactHash, computeHash(artifact));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an AGENTS signer on an ENGAGEMENT is rejected with an authority error", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-auth-agents-"));
  try {
    const store = createLocalStore({ root });
    const signers = [
      { id: "conductor:01", role: "CONDUCTOR" },
      { id: "agent:99", role: "AGENTS" }
    ];
    const { negotiationId, keys } = setupNegotiation({ store, signers });

    const artifact = {
      kind: "ENGAGEMENT",
      id: "engagement:auth-bad",
      scope: "scope:nego",
      goal: "ship"
    };
    appendOffer(store, negotiationId, "conductor:01", "CONDUCTOR", artifact);
    appendSignature(
      store,
      negotiationId,
      "conductor:01",
      "CONDUCTOR",
      keys.get("conductor:01").privatePem,
      artifact
    );
    appendSignature(
      store,
      negotiationId,
      "agent:99",
      "AGENTS",
      keys.get("agent:99").privatePem,
      artifact
    );

    assert.throws(
      () => store.stabilizeNegotiation(negotiationId),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /agent:99/);
        assert.match(err.message, /not authorized to sign artifact kind ENGAGEMENT/);
        return true;
      }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a PRINCIPAL can sign a MANDATE alone (allowed by the matrix)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-auth-mandate-ok-"));
  try {
    const store = createLocalStore({ root });
    const signers = [{ id: "human:antoine", role: "PRINCIPAL" }];
    const { negotiationId, keys } = setupNegotiation({
      store,
      signers,
      subject: "amendment"
    });

    const artifact = {
      kind: "MANDATE",
      id: "mandate:auth-ok",
      instance: "conductor:01",
      role: "CONDUCTOR",
      scope: "scope:nego",
      rights: ["sign"]
    };
    appendOffer(store, negotiationId, "human:antoine", "PRINCIPAL", artifact);
    appendSignature(
      store,
      negotiationId,
      "human:antoine",
      "PRINCIPAL",
      keys.get("human:antoine").privatePem,
      artifact
    );

    const result = store.stabilizeNegotiation(negotiationId);
    assert.equal(result.record.status, "stabilized");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a CONDUCTOR signing a MANDATE is rejected (CONDUCTOR not in MANDATE roster)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-auth-mandate-bad-"));
  try {
    const store = createLocalStore({ root });
    const signers = [{ id: "conductor:01", role: "CONDUCTOR" }];
    const { negotiationId, keys } = setupNegotiation({
      store,
      signers,
      subject: "amendment"
    });

    const artifact = {
      kind: "MANDATE",
      id: "mandate:auth-bad",
      instance: "conductor:02",
      role: "CONDUCTOR",
      scope: "scope:nego",
      rights: ["sign"]
    };
    appendOffer(store, negotiationId, "conductor:01", "CONDUCTOR", artifact);
    appendSignature(
      store,
      negotiationId,
      "conductor:01",
      "CONDUCTOR",
      keys.get("conductor:01").privatePem,
      artifact
    );

    assert.throws(
      () => store.stabilizeNegotiation(negotiationId),
      (err) => {
        assert.match(err.message, /conductor:01/);
        assert.match(err.message, /not authorized to sign artifact kind MANDATE/);
        return true;
      }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an artifact without `kind` stabilizes OK but emits a stderr warning", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-auth-nokind-"));
  const captured = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    captured.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  };
  try {
    const store = createLocalStore({ root });
    const signers = [{ id: "conductor:01", role: "CONDUCTOR" }];
    const { negotiationId, keys } = setupNegotiation({ store, signers });

    const artifact = { goal: "no-kind-here" };
    appendOffer(store, negotiationId, "conductor:01", "CONDUCTOR", artifact);
    appendSignature(
      store,
      negotiationId,
      "conductor:01",
      "CONDUCTOR",
      keys.get("conductor:01").privatePem,
      artifact
    );

    const result = store.stabilizeNegotiation(negotiationId);
    assert.equal(result.record.status, "stabilized");
  } finally {
    process.stderr.write = originalWrite;
    rmSync(root, { recursive: true, force: true });
  }

  const joined = captured.join("");
  assert.match(joined, /h2a stabilize/);
  assert.match(joined, /no recognizable kind/);
  assert.match(joined, /skipping authority check/);
});
