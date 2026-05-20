import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function setupNegotiation(store, requiredSigners, scope = "scope:nego") {
  const keys = new Map();
  for (const id of requiredSigners) {
    const kp = newKeyPair();
    keys.set(id, kp);
    store.registerInstance({
      id,
      instance: id,
      roles: ["CONDUCTOR"],
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
    parties: requiredSigners,
    subject: "engagement",
    status: "draft",
    requiredSigners
  });
  return { negotiationId, keys };
}

function signArtifact(store, negotiationId, instance, privatePem, artifact, scope) {
  const artifactHash = computeHash(artifact);
  const signature = signCanonical(
    { artifactHash },
    { by: instance, privateKeyPem: privatePem }
  );
  store.appendNegotiationEvent(negotiationId, {
    id: `evt-sign-${instance.replace(":", "-")}`,
    type: "event",
    actor: { instance, role: "CONDUCTOR", scope },
    body: { kind: "signature", artifactHash, signature },
    createdAt: nowIso()
  });
}

test("stabilizeNegotiation persists a CONTRACT to contracts/<id>/contract.json", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-stab-contract-"));
  try {
    const store = createLocalStore({ root });
    const required = ["conductor:01", "conductor:02"];
    const { negotiationId, keys } = setupNegotiation(store, required);

    const artifact = {
      kind: "CONTRACT",
      id: "contract:alpha",
      scope: "scope:nego",
      clauses: [{ id: "c1", text: "deliver" }]
    };
    // Offer must be in journal so the artifact body is recoverable.
    store.appendNegotiationEvent(negotiationId, {
      id: "evt-offer-01",
      type: "propose",
      actor: { instance: required[0], role: "CONDUCTOR", scope: "scope:nego" },
      body: { artifact },
      createdAt: nowIso()
    });
    for (const id of required) {
      signArtifact(store, negotiationId, id, keys.get(id).privatePem, artifact, "scope:nego");
    }

    const result = store.stabilizeNegotiation(negotiationId);
    assert.equal(result.artifactPath, join(root, "contracts", "contract:alpha", "contract.json"));
    assert.ok(existsSync(result.artifactPath), "contract.json should exist on disk");
    const onDisk = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    assert.deepEqual(onDisk, artifact);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stabilizeNegotiation persists an ENGAGEMENT to engagements/<id>/charter.json", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-stab-engagement-"));
  try {
    const store = createLocalStore({ root });
    const required = ["conductor:11", "conductor:12"];
    const { negotiationId, keys } = setupNegotiation(store, required);

    const artifact = {
      kind: "ENGAGEMENT",
      id: "engagement:ship-v1",
      scope: "scope:nego",
      goal: "ship v1"
    };
    store.appendNegotiationEvent(negotiationId, {
      id: "evt-offer-01",
      type: "propose",
      actor: { instance: required[0], role: "CONDUCTOR", scope: "scope:nego" },
      body: { artifact },
      createdAt: nowIso()
    });
    for (const id of required) {
      signArtifact(store, negotiationId, id, keys.get(id).privatePem, artifact, "scope:nego");
    }

    const result = store.stabilizeNegotiation(negotiationId);
    assert.equal(
      result.artifactPath,
      join(root, "engagements", "engagement:ship-v1", "charter.json")
    );
    assert.ok(existsSync(result.artifactPath));
    const onDisk = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    assert.deepEqual(onDisk, artifact);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stabilizeNegotiation falls back to artifacts/<hash>.json when kind is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-stab-fallback-"));
  try {
    const store = createLocalStore({ root });
    const required = ["conductor:21"];
    const { negotiationId, keys } = setupNegotiation(store, required);

    const artifact = { goal: "no-kind", note: "fallback" };
    store.appendNegotiationEvent(negotiationId, {
      id: "evt-offer-01",
      type: "propose",
      actor: { instance: required[0], role: "CONDUCTOR", scope: "scope:nego" },
      body: { artifact },
      createdAt: nowIso()
    });
    signArtifact(
      store,
      negotiationId,
      required[0],
      keys.get(required[0]).privatePem,
      artifact,
      "scope:nego"
    );

    const result = store.stabilizeNegotiation(negotiationId);
    const expectedHash = computeHash(artifact);
    const safe = expectedHash.replace(/:/g, "_");
    assert.equal(result.artifactPath, join(root, "artifacts", `${safe}.json`));
    assert.ok(existsSync(result.artifactPath));
    const onDisk = JSON.parse(readFileSync(result.artifactPath, "utf8"));
    assert.deepEqual(onDisk, artifact);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stabilizeNegotiation refuses to overwrite an existing immutable artifact file", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-stab-immutable-"));
  try {
    const store = createLocalStore({ root });

    // First negotiation stabilizes engagement:dup
    const firstSigners = ["conductor:01", "conductor:02"];
    const first = setupNegotiation(store, firstSigners);
    const artifact = { kind: "ENGAGEMENT", id: "engagement:dup", goal: "v1" };
    store.appendNegotiationEvent(first.negotiationId, {
      id: "evt-offer-01",
      type: "propose",
      actor: { instance: firstSigners[0], role: "CONDUCTOR", scope: "scope:nego" },
      body: { artifact },
      createdAt: nowIso()
    });
    for (const id of firstSigners) {
      signArtifact(
        store,
        first.negotiationId,
        id,
        first.keys.get(id).privatePem,
        artifact,
        "scope:nego"
      );
    }
    const firstResult = store.stabilizeNegotiation(first.negotiationId);
    assert.ok(existsSync(firstResult.artifactPath));

    // Second negotiation tries to stabilize the same engagement:dup id (collision).
    const secondSigners = ["conductor:91", "conductor:92"];
    const second = setupNegotiation(store, secondSigners);
    store.appendNegotiationEvent(second.negotiationId, {
      id: "evt-offer-01",
      type: "propose",
      actor: { instance: secondSigners[0], role: "CONDUCTOR", scope: "scope:nego" },
      body: { artifact },
      createdAt: nowIso()
    });
    for (const id of secondSigners) {
      signArtifact(
        store,
        second.negotiationId,
        id,
        second.keys.get(id).privatePem,
        artifact,
        "scope:nego"
      );
    }
    assert.throws(
      () => store.stabilizeNegotiation(second.negotiationId),
      /stabilized artifact already on disk at/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stabilizeNegotiation errors when no journal event matches the winning artifactHash", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-stab-orphan-"));
  try {
    const store = createLocalStore({ root });
    const required = ["conductor:01", "conductor:02"];
    const { negotiationId, keys } = setupNegotiation(store, required);

    // Both parties sign a hash but nobody ever offered/countered the body.
    const artifact = { kind: "ENGAGEMENT", id: "engagement:orphan", goal: "orphan" };
    for (const id of required) {
      signArtifact(store, negotiationId, id, keys.get(id).privatePem, artifact, "scope:nego");
    }
    const expectedHash = computeHash(artifact);

    assert.throws(
      () => store.stabilizeNegotiation(negotiationId),
      new RegExp(`no offer/counter event matches the winning artifactHash ${expectedHash}`)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
