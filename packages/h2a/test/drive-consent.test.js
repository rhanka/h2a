/**
 * Lot H2A-SEAM-LAUNCH — bilateral drive-consent enforcement and drive/wake
 * receipts at the actuation boundary (r2 §8 cadre agentique, co-sign §4.2).
 *
 * Driving or waking a CLI session requires BOTH a fresh F15-class allowing
 * decision naming both id levels AND an active journal-backed
 * `drive-consent:<hash(from,to)>` grant for action `drive.instruction`. An
 * EXACT-class consent refusal stops actuation with that named reason;
 * `consent-unavailable` infers nothing (retry, never grant). Every attempt
 * records a §8 receipt
 * `{ drivingPrincipalOrAgentId, drivenMemorialAgentId, drivenAgentSessionId,
 *    consentGrantId, outcome }`.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  computeHash,
  signCanonical,
  createLocalStore,
  authorizeDriveWakeActuation
} from "../dist/index.js";

function f15Decision(overrides = {}) {
  return {
    allowed: true,
    drivenMemorialAgentId: "agent:mem-driven",
    drivenAgentSessionId: "agent-session:driven-1",
    ...overrides
  };
}

function projectionOf(decision) {
  return {
    decision,
    anomalies: [],
    requests: decision && decision.ok ? 1 : 0,
    limit: "LIMIT"
  };
}

function actuation(overrides = {}) {
  return {
    drivingPrincipalOrAgentId: "agent:mem-driver",
    decision: f15Decision(),
    consent: projectionOf({
      ok: true,
      via: "consent",
      grantId: "grant-1",
      requestId: "request-1",
      notAfter: "2027-01-01T00:00:00.000Z",
      principalDecision: "principal-absent"
    }),
    ...overrides
  };
}

test("unconsented drive is refused with the named reason and a refused receipt", () => {
  const result = authorizeDriveWakeActuation(
    actuation({
      consent: projectionOf({ ok: false, reason: "unauthorized" })
    })
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unauthorized");
  assert.deepEqual(result.receipt, {
    drivingPrincipalOrAgentId: "agent:mem-driver",
    drivenMemorialAgentId: "agent:mem-driven",
    drivenAgentSessionId: "agent-session:driven-1",
    consentGrantId: "",
    outcome: "refused:unauthorized"
  });
});

test("EXACT-class consent refusals pass through verbatim and block actuation immediately", () => {
  for (const reason of [
    "consent-revoked",
    "consent-refused",
    "consent-expired",
    "consent-invalid",
    "consent-principal-unavailable"
  ]) {
    const result = authorizeDriveWakeActuation(
      actuation({ consent: projectionOf({ ok: false, reason }) })
    );
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(result.receipt.outcome, "refused:" + reason);
  }
});

test("consent-unavailable never grants (retry, infer nothing)", () => {
  const result = authorizeDriveWakeActuation(
    actuation({ consent: projectionOf({ ok: false, reason: "consent-unavailable" }) })
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "consent-unavailable");
  assert.equal(result.receipt.outcome, "refused:consent-unavailable");
});

test("an allowed F15 decision plus an active grant authorizes actuation with the §8 receipt", () => {
  const result = authorizeDriveWakeActuation(actuation());
  assert.equal(result.ok, true);
  assert.deepEqual(result.receipt, {
    drivingPrincipalOrAgentId: "agent:mem-driver",
    drivenMemorialAgentId: "agent:mem-driven",
    drivenAgentSessionId: "agent-session:driven-1",
    consentGrantId: "grant-1",
    outcome: "actuated"
  });
});

test("an F15 refusal blocks actuation despite an active consent grant", () => {
  const result = authorizeDriveWakeActuation(
    actuation({ decision: f15Decision({ allowed: false }) })
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "decision_refused");
  assert.equal(result.receipt.outcome, "refused:decision_refused");
  // The grant existed but was not consumed: recorded, never satisfied.
  assert.equal(result.receipt.consentGrantId, "grant-1");
});

test("a malformed F15 decision fails closed as decision_unavailable", () => {
  for (const decision of [
    { allowed: true },
    { allowed: true, drivenMemorialAgentId: "agent:mem-driven", drivenAgentSessionId: "" },
    { allowed: "yes", drivenMemorialAgentId: "agent:mem-driven", drivenAgentSessionId: "agent-session:driven-1" },
    null
  ]) {
    const result = authorizeDriveWakeActuation(actuation({ decision }));
    assert.equal(result.ok, false, JSON.stringify(decision));
    assert.equal(result.reason, "decision_unavailable");
    assert.equal(result.receipt.outcome, "refused:decision_unavailable");
  }
});

test("journal end-to-end: bilateral pair refuses without consent and drives with a granted pair", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-drive-wake-"));
  try {
    const store = createLocalStore({ root });
    const keyOf = () => {
      const k = generateKeyPairSync("ed25519");
      return {
        privateKeyPem: k.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        publicKeyPem: k.publicKey.export({ format: "pem", type: "spki" }).toString()
      };
    };
    const a = keyOf();
    const b = keyOf();
    const now = Date.now();
    const iso = (n) => new Date(n).toISOString();
    const from = "codex:a";
    const to = "codex:b";
    for (const [id, k] of [
      [from, a],
      [to, b]
    ]) {
      store.registerInstance({
        id,
        instance: id,
        roles: ["AGENTS"],
        scopes: [id],
        capabilities: [],
        endpoints: [],
        publicKeys: [k.publicKeyPem],
        acceptedPolicies: [],
        createdAt: iso(now)
      });
    }

    // Without any journal-backed grant the pair is unconsented: refusal.
    const refused = authorizeDriveWakeActuation({
      drivingPrincipalOrAgentId: "agent:mem-driver",
      decision: f15Decision(),
      consent: store.findDriveConsent(from, to, now)
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "unauthorized");
    assert.equal(refused.receipt.outcome, "refused:unauthorized");

    // Record a bilateral request + grant pair in the journal.
    const scope = { action: "drive.instruction", direction: "from->to" };
    const request = {
      kind: "h2a.drive.consent.request",
      v: 1,
      requestId: randomUUID(),
      from,
      to,
      scope,
      createdAt: iso(now),
      answerBy: iso(now + 900000),
      requestedNotAfter: iso(now + 3600000)
    };
    const grant = {
      kind: "h2a.drive.consent.grant",
      v: 1,
      requestId: request.requestId,
      requestHash: computeHash(request),
      from,
      to,
      scope,
      notBefore: iso(now),
      notAfter: iso(now + 3600000),
      issuedAt: iso(now)
    };
    const pairId = "drive-consent:" + computeHash({ from, to });
    store.openNegotiation({
      id: pairId,
      scope: "drive-consent",
      parties: [from, to],
      subject: "drive-consent",
      status: "proposed",
      requiredSigners: [to],
      createdAt: iso(now),
      updatedAt: iso(now)
    });
    for (const [payload, k, by, type] of [
      [request, a, from, "propose"],
      [grant, b, to, "accept"]
    ]) {
      store.recordDriveConsentEnvelope({
        id: randomUUID(),
        type,
        actor: { instance: by, role: "AGENTS", scope: "drive-consent" },
        negotiationId: pairId,
        createdAt: iso(now),
        body: {
          kind: payload.kind,
          payload,
          signature: signCanonical(payload, { by, privateKeyPem: k.privateKeyPem })
        }
      }, now);
    }

    // The granted pair authorizes actuation; the receipt carries the real
    // journal grant id.
    const projection = store.findDriveConsent(from, to, now);
    assert.equal(projection.decision.ok, true, JSON.stringify(projection));
    const allowed = authorizeDriveWakeActuation({
      drivingPrincipalOrAgentId: "agent:mem-driver",
      decision: f15Decision(),
      consent: projection
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.receipt.consentGrantId, projection.decision.grantId);
    assert.equal(allowed.receipt.outcome, "actuated");

    // Bilateral: the reversed pair has no consent of its own.
    const reversed = authorizeDriveWakeActuation({
      drivingPrincipalOrAgentId: "agent:mem-driven",
      decision: f15Decision({
        drivenMemorialAgentId: "agent:mem-driver",
        drivenAgentSessionId: "agent-session:driver-1"
      }),
      consent: store.findDriveConsent(to, from, now)
    });
    assert.equal(reversed.ok, false);
    assert.equal(reversed.reason, "unauthorized");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
