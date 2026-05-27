import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  H2A_NHI_ATTESTATION_BODY_KIND,
  H2A_NHI_RISK_IDS,
  auditNhiPosture,
  isH2AEnvelope,
  nhiAttestationEnvelope,
  nhiKeyFingerprint,
  signEnvelope,
  verifyEnvelopeSignature
} from "../dist/index.js";

function findingFor(report, risk) {
  const f = report.findings.find((x) => x.risk === risk);
  assert.ok(f, `expected a finding for ${risk}`);
  return f;
}

test("clean registry → all findings info, summary counts correct", () => {
  const report = auditNhiPosture({
    now: "2026-05-27T00:00:00.000Z",
    instances: [
      { id: "claude:p1", activeKeys: ["KEY-A"] },
      { id: "codex:p2", activeKeys: ["KEY-B"] }
    ],
    subagents: [
      { id: "claude:p1~r", parentInstance: "claude:p1", status: "active", capabilities: ["read"] }
    ]
  });
  assert.equal(report.generatedAt, "2026-05-27T00:00:00.000Z");
  assert.deepEqual(
    report.findings.map((f) => f.risk),
    [...H2A_NHI_RISK_IDS]
  );
  for (const f of report.findings) {
    assert.equal(f.severity, "info", `${f.risk} should be info on a clean registry`);
    assert.equal(f.count, 0);
  }
  assert.equal(report.summary.instances, 2);
  assert.equal(report.summary.activeKeys, 2);
  assert.equal(report.summary.instancesWithoutKey, 0);
  assert.equal(report.summary.activeSubagents, 1);
  assert.equal(report.summary.revokedSubagents, 0);
});

test("NHI4 flags an instance with no active key", () => {
  const report = auditNhiPosture({
    instances: [
      { id: "claude:p1", activeKeys: [] },
      { id: "codex:p2", activeKeys: ["KEY-B"] }
    ]
  });
  const f = findingFor(report, "NHI4");
  assert.equal(f.severity, "high");
  assert.deepEqual(f.subjects, ["claude:p1"]);
  assert.equal(report.summary.instancesWithoutKey, 1);
});

test("NHI9 flags a public key reused across instances (fingerprinted, not the PEM)", () => {
  const report = auditNhiPosture({
    instances: [
      { id: "b:two", activeKeys: ["SHARED"] },
      { id: "a:one", activeKeys: ["SHARED"] },
      { id: "c:three", activeKeys: ["OWN"] }
    ]
  });
  const f = findingFor(report, "NHI9");
  assert.equal(f.severity, "high");
  assert.equal(f.count, 1);
  // owners sorted, key fingerprinted (never the raw PEM)
  assert.equal(f.subjects[0], `${nhiKeyFingerprint("SHARED")}: a:one, b:two`);
  assert.ok(!f.subjects[0].includes("SHARED"));
});

test("NHI5 flags an active subagent with no capability bound; revoked ones ignored", () => {
  const report = auditNhiPosture({
    instances: [{ id: "claude:p1", activeKeys: ["K"] }],
    subagents: [
      { id: "claude:p1~bounded", parentInstance: "claude:p1", status: "active", capabilities: ["read"] },
      { id: "claude:p1~loose", parentInstance: "claude:p1", status: "active" },
      { id: "claude:p1~empty", parentInstance: "claude:p1", status: "active", capabilities: [] },
      { id: "claude:p1~gone", parentInstance: "claude:p1", status: "revoked" }
    ]
  });
  const f = findingFor(report, "NHI5");
  assert.equal(f.severity, "medium");
  assert.deepEqual(f.subjects.sort(), ["claude:p1~empty", "claude:p1~loose"]);
  assert.equal(report.summary.revokedSubagents, 1);
});

test("NHI1 flags an active subagent whose parent has no active key", () => {
  const report = auditNhiPosture({
    instances: [
      { id: "claude:p1", activeKeys: [] }, // offboarded parent
      { id: "codex:p2", activeKeys: ["K"] }
    ],
    subagents: [
      { id: "claude:p1~dangling", parentInstance: "claude:p1", status: "active", capabilities: ["x"] },
      { id: "codex:p2~ok", parentInstance: "codex:p2", status: "active", capabilities: ["x"] }
    ]
  });
  const f = findingFor(report, "NHI1");
  assert.equal(f.severity, "high");
  assert.deepEqual(f.subjects, ["claude:p1~dangling"]);
});

test("NHI7 flags long-lived keys from keyring events; revoked keys excluded", () => {
  const report = auditNhiPosture({
    now: "2026-05-27T00:00:00.000Z",
    longLivedKeyMaxDays: 90,
    instances: [{ id: "claude:p1", activeKeys: ["OLD", "FRESH"] }],
    keyEvents: [
      { instance: "claude:p1", publicKey: "OLD", type: "added", at: "2026-01-01T00:00:00.000Z" }, // ~146d
      { instance: "claude:p1", publicKey: "FRESH", type: "added", at: "2026-05-20T00:00:00.000Z" }, // 7d
      { instance: "claude:p1", publicKey: "ROTATED", type: "added", at: "2025-01-01T00:00:00.000Z" },
      { instance: "claude:p1", publicKey: "ROTATED", type: "revoked", at: "2026-05-01T00:00:00.000Z" }
    ]
  });
  const f = findingFor(report, "NHI7");
  assert.equal(f.severity, "medium");
  assert.equal(f.count, 1);
  assert.ok(f.subjects[0].startsWith(`claude:p1:${nhiKeyFingerprint("OLD")}`));
});

test("NHI7 is info (age not evaluated) when no keyring events supplied", () => {
  const report = auditNhiPosture({
    instances: [{ id: "claude:p1", activeKeys: ["K"] }]
  });
  const f = findingFor(report, "NHI7");
  assert.equal(f.severity, "info");
  assert.match(f.detail, /not evaluated/);
});

test("nhiAttestationEnvelope builds an event envelope that verifies once signed", () => {
  const report = auditNhiPosture({
    now: "2026-05-27T00:00:00.000Z",
    instances: [{ id: "claude:p1", activeKeys: ["K"] }]
  });
  const envelope = nhiAttestationEnvelope({
    report,
    actor: { instance: "claude:p1", role: "CONTROL", scope: "scope:audit" }
  });
  assert.ok(isH2AEnvelope(envelope));
  assert.equal(envelope.type, "event");
  assert.equal(envelope.actor.instance, "claude:p1");
  assert.equal(envelope.body.kind, H2A_NHI_ATTESTATION_BODY_KIND);
  assert.deepEqual(envelope.body.report, report);
  assert.equal(envelope.createdAt, report.generatedAt);
  assert.ok(envelope.id.startsWith("nhi-attest-"));
  assert.equal(envelope.signatures, undefined);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const signed = signEnvelope(envelope, { by: "claude:p1", privateKeyPem: privatePem });
  assert.equal(signed.signatures.length, 1);
  assert.equal(verifyEnvelopeSignature(signed, publicPem, { by: "claude:p1" }), true);

  // Tampering with the report breaks verification.
  const tampered = {
    ...signed,
    body: { ...signed.body, report: { ...signed.body.report, summary: { ...signed.body.report.summary, instances: 99 } } }
  };
  assert.equal(verifyEnvelopeSignature(tampered, publicPem, { by: "claude:p1" }), false);
});
