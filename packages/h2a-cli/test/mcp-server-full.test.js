import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyEnvelopeSignature } from "@sentropic/h2a";

import { createMcpServer } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-mcp-full-"));
}

function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function registration(id, publicPem) {
  return {
    id,
    instance: id,
    roles: ["CONDUCTOR"],
    scopes: ["scope:nego"],
    capabilities: ["negotiate", "sign"],
    endpoints: [{ kind: "local-files", uri: "file://<root>" }],
    publicKeys: [publicPem],
    acceptedPolicies: [],
    createdAt: "2026-05-19T00:00:00.000Z"
  };
}

function baseRecord(parties) {
  return {
    id: "nego-mcp-full-01",
    scope: "scope:nego",
    parties,
    subject: "engagement",
    status: "draft",
    requiredSigners: parties
  };
}

test("h2a_open_negotiation persists the record and returns it", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const record = baseRecord(["conductor:01"]);
    const result = server.callTool("h2a_open_negotiation", { record });
    assert.equal(result.error, undefined);
    assert.equal(result.record.id, record.id);
    assert.equal(result.record.status, "draft");

    // Reopening the same negotiation must surface a structured error.
    const dup = server.callTool("h2a_open_negotiation", { record });
    assert.match(dup.error ?? "", /already open/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_nhi_report derives a posture and flags key reuse (NHI9)", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const { publicPem } = newKeyPair();
    // Two instances sharing ONE public key → NHI9 reuse.
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:01", publicPem)
    });
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:02", publicPem)
    });

    const result = server.callTool("h2a_nhi_report", {});
    assert.equal(result.error, undefined);
    const report = result.report;
    assert.equal(report.summary.instances, 2);
    assert.equal(report.findings.length, 5);

    const nhi9 = report.findings.find((f) => f.risk === "NHI9");
    assert.equal(nhi9.severity, "high");
    assert.equal(nhi9.count, 1);
    // The PEM must never appear in the posture output (fingerprint only).
    assert.ok(!JSON.stringify(report).includes(publicPem));

    const nhi4 = report.findings.find((f) => f.risk === "NHI4");
    assert.equal(nhi4.severity, "info"); // both instances have a key
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_nhi_inventory lists the estate with reuse + totals (fingerprints only)", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const { publicPem } = newKeyPair();
    // Two instances sharing one key → reusedKeys = 1.
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:01", publicPem)
    });
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:02", publicPem)
    });

    const result = server.callTool("h2a_nhi_inventory", {});
    assert.equal(result.error, undefined);
    const inv = result.inventory;
    assert.equal(inv.totals.instances, 2);
    assert.equal(inv.totals.activeKeys, 2);
    assert.equal(inv.totals.reusedKeys, 1);
    const c1 = inv.instances.find((i) => i.id === "conductor:01");
    assert.deepEqual(c1.keys[0].sharedWith, ["conductor:02"]);
    assert.ok(!JSON.stringify(inv).includes(publicPem));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_nhi_export returns a SPIFFE-bundle-shaped export of an instance's keys", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const { publicPem } = newKeyPair();
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:01", publicPem)
    });

    const result = server.callTool("h2a_nhi_export", {
      instance: "conductor:01",
      trustDomain: "example.org"
    });
    assert.equal(result.error, undefined);
    const bundle = result.bundle;
    assert.equal(bundle.spiffe_id, "spiffe://example.org/conductor.01");
    assert.equal(bundle.trust_domain, "example.org");
    assert.equal(bundle.keys.length, 1);
    assert.equal(bundle.keys[0].h2a_public_key_pem, publicPem);

    // Invalid trust domain → structured error (not a throw).
    const bad = server.callTool("h2a_nhi_export", { instance: "conductor:01", trustDomain: "BAD_DOMAIN" });
    assert.ok(bad.error);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_nhi_attest signs the posture into a verifiable attestation envelope", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const { privatePem, publicPem } = newKeyPair();
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:01", publicPem)
    });

    const result = server.callTool("h2a_nhi_attest", {
      instance: "conductor:01",
      privateKeyPem: privatePem
    });
    assert.equal(result.error, undefined);
    const env = result.attestation;
    assert.equal(env.type, "event");
    assert.equal(env.actor.instance, "conductor:01");
    assert.equal(env.body.kind, "nhi-attestation");
    assert.ok(env.body.report.findings.length === 5);
    assert.equal(env.signatures.length, 1);

    // Verifiable against the registered public key via the standard primitive.
    assert.equal(verifyEnvelopeSignature(env, publicPem, { by: "conductor:01" }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_nhi_attest: missing key returns a structured error", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_nhi_attest", { instance: "x" });
    assert.match(result.error ?? "", /missing 'privateKeyPem'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_open_negotiation: missing 'record' returns a structured error", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_open_negotiation", {});
    assert.match(result.error ?? "", /missing 'record'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_offer then h2a_counteroffer chain the journal (sequence + prevHash)", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const record = baseRecord(["conductor:01", "conductor:02"]);
    server.callTool("h2a_open_negotiation", { record });

    const offer = server.callTool("h2a_offer", {
      negotiationId: record.id,
      instance: "conductor:01",
      artifact: { kind: "ENGAGEMENT", goal: "draft" },
      eventId: "evt-offer-01"
    });
    assert.equal(offer.error, undefined);
    assert.equal(offer.entry.sequence, 0);
    assert.equal(offer.entry.type, "propose");
    assert.equal(offer.entry.actor.instance, "conductor:01");
    assert.equal(offer.entry.actor.role, "CONDUCTOR");
    assert.equal(offer.entry.actor.scope, record.scope);

    const counter = server.callTool("h2a_counteroffer", {
      negotiationId: record.id,
      instance: "conductor:02",
      artifact: { kind: "ENGAGEMENT", goal: "final" },
      eventId: "evt-counter-02"
    });
    assert.equal(counter.error, undefined);
    assert.equal(counter.entry.sequence, 1);
    assert.equal(counter.entry.type, "counter");
    assert.equal(counter.entry.prevHash, offer.entry.contentHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_offer rejects unknown negotiationId with a structured error", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_offer", {
      negotiationId: "nope",
      instance: "conductor:01",
      artifact: { k: 1 }
    });
    assert.match(result.error ?? "", /negotiation nope not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_sign + h2a_stabilize: full quorum stabilizes the negotiation end-to-end", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });

    const k1 = newKeyPair();
    const k2 = newKeyPair();
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:01", k1.publicPem)
    });
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:02", k2.publicPem)
    });

    const record = baseRecord(["conductor:01", "conductor:02"]);
    server.callTool("h2a_open_negotiation", { record });

    const artifact = { kind: "ENGAGEMENT", id: "eng-1", goal: "ship" };

    // Stabilize now requires the winning artifact to be present in the journal
    // body (DEC-033 — immutable on-disk persistence). Add the offer event first.
    const offer = server.callTool("h2a_offer", {
      negotiationId: record.id,
      instance: "conductor:01",
      artifact,
      eventId: "evt-offer-01"
    });
    assert.equal(offer.error, undefined);

    const sign1 = server.callTool("h2a_sign", {
      negotiationId: record.id,
      instance: "conductor:01",
      artifact,
      privateKeyPem: k1.privatePem,
      eventId: "evt-sign-01"
    });
    assert.equal(sign1.error, undefined);
    assert.equal(sign1.entry.body.kind, "signature");
    assert.match(sign1.entry.body.artifactHash, /^sha256:/);
    assert.equal(sign1.entry.body.signature.by, "conductor:01");
    assert.equal(sign1.entry.body.signature.alg, "ed25519");

    const sign2 = server.callTool("h2a_sign", {
      negotiationId: record.id,
      instance: "conductor:02",
      artifact,
      privateKeyPem: k2.privatePem,
      eventId: "evt-sign-02"
    });
    assert.equal(sign2.error, undefined);
    assert.equal(sign2.entry.body.artifactHash, sign1.entry.body.artifactHash);

    const stab = server.callTool("h2a_stabilize", {
      negotiationId: record.id,
      eventId: "evt-stabilize"
    });
    assert.equal(stab.error, undefined);
    assert.equal(stab.record.status, "stabilized");
    assert.equal(stab.artifactHash, sign1.entry.body.artifactHash);
    assert.deepEqual(stab.signers, ["conductor:01", "conductor:02"]);
    assert.equal(stab.finalEvent.id, "evt-stabilize");
    assert.equal(typeof stab.finalEvent.sequence, "number");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_stabilize errors when quorum is not met (only 1 of 2 signed)", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const k1 = newKeyPair();
    const k2 = newKeyPair();
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:01", k1.publicPem)
    });
    server.callTool("h2a_register_instance", {
      registration: registration("conductor:02", k2.publicPem)
    });
    const record = baseRecord(["conductor:01", "conductor:02"]);
    server.callTool("h2a_open_negotiation", { record });

    server.callTool("h2a_sign", {
      negotiationId: record.id,
      instance: "conductor:01",
      artifact: { goal: "x" },
      privateKeyPem: k1.privatePem
    });

    const stab = server.callTool("h2a_stabilize", { negotiationId: record.id });
    assert.match(stab.error ?? "", /no artifactHash has the full quorum/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_escalate with channel='decide' appends an escalation journal entry", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const record = baseRecord(["conductor:01"]);
    server.callTool("h2a_open_negotiation", { record });

    const result = server.callTool("h2a_escalate", {
      negotiationId: record.id,
      instance: "conductor:01",
      channel: "decide",
      payload: { reason: "deadline missed" }
    });
    assert.equal(result.error, undefined);
    assert.equal(result.entry.type, "escalate");
    assert.equal(result.entry.actor.role, "MANDATAIRE");
    assert.equal(result.entry.actor.instance, "conductor:01");
    assert.equal(result.entry.actor.scope, record.scope);
    assert.equal(result.entry.body.kind, "escalation");
    assert.equal(result.entry.body.channel, "decide");
    assert.deepEqual(result.entry.body.payload, { reason: "deadline missed" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_escalate with an invalid channel returns a structured error", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const record = baseRecord(["conductor:01"]);
    server.callTool("h2a_open_negotiation", { record });

    const result = server.callTool("h2a_escalate", {
      negotiationId: record.id,
      instance: "conductor:01",
      channel: "bogus",
      payload: {}
    });
    assert.match(result.error ?? "", /channel must be advise\|decide\|alert/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("h2a_escalate on a missing negotiation returns a structured error", () => {
  const root = freshRoot();
  try {
    const server = createMcpServer({ root });
    const result = server.callTool("h2a_escalate", {
      negotiationId: "ghost",
      instance: "conductor:01",
      channel: "alert",
      payload: {}
    });
    assert.match(result.error ?? "", /negotiation ghost not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
