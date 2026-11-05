import { describe, expect, it } from "vitest";

import {
  ACTION_TTL_MS,
  ACTION_ROUTES,
  CONSERVATIVE_SKEW_MS,
  JWS_ALGS,
  MAX_ENVELOPE_BYTES,
  MAX_INPUT_BYTES,
  MAX_RESULT_BYTES,
  NONCE_TTL_MS,
  PROOF_TTL_MS,
  RC2_R3_PIN,
  REMOTE_ACTION_VERSION,
  SIGNING_DOMAINS,
  SIGNED_BODY_ALGS,
  TARGET_FIELDS,
  canonicalJson,
  digestDomain,
  isTargetRecord,
  rawHash,
} from "./remote-action-contract.js";

function fullTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    appMeshId: "mesh-a",
    sourceMeshId: "mesh-b",
    nativeAudience: "aud-b",
    registrationId: "reg-1",
    tenantId: "tenant-1",
    workspaceId: "ws-1",
    bindingId: "binding-1",
    sourceId: "source-1",
    sourceSessionId: "session-1",
    nativeSessionId: "cli-1",
    sourceGeneration: 3,
    bootGeneration: 7,
    custodyEpoch: 1,
    controllerEpoch: 2,
    connectionId: "conn-1",
    connectionGeneration: 4,
    ...overrides,
  };
}

describe("remote-action-v1 frozen contract", () => {
  it("pins the stable wire-contract identifier", () => {
    expect(REMOTE_ACTION_VERSION).toBe("remote-action-v1");
  });

  it("pins exactly the 14 capsule-fixed signing domains, no alias", () => {
    expect([...SIGNING_DOMAINS].sort()).toEqual(
      [
        "action-claim",
        "action-envelope",
        "cli-session-proof",
        "input",
        "nonce-publication",
        "permission-request",
        "permission-response",
        "remote-action-audit",
        "result",
        "session-attestation",
        "source-registration",
        "source-renewal",
        "target",
        "typed-event-batch",
      ].sort(),
    );
  });

  it("allows only Ed25519 raw bodies and EdDSA JWS, never RS256", () => {
    expect([...SIGNED_BODY_ALGS]).toEqual(["Ed25519"]);
    expect([...JWS_ALGS]).toEqual(["EdDSA"]);
    expect([...SIGNED_BODY_ALGS, ...JWS_ALGS].join(",")).not.toMatch(/RS256|ES256|none/);
  });

  it("pins the closed 16-field Target in order", () => {
    expect([...TARGET_FIELDS]).toEqual([
      "appMeshId",
      "sourceMeshId",
      "nativeAudience",
      "registrationId",
      "tenantId",
      "workspaceId",
      "bindingId",
      "sourceId",
      "sourceSessionId",
      "nativeSessionId",
      "sourceGeneration",
      "bootGeneration",
      "custodyEpoch",
      "controllerEpoch",
      "connectionId",
      "connectionGeneration",
    ]);
  });

  it("accepts a complete 16-field Target record", () => {
    expect(isTargetRecord(fullTarget())).toBe(true);
  });

  it("rejects Target records with missing, null, extra or mistyped fields", () => {
    const missing = fullTarget();
    delete missing["connectionId"];
    expect(isTargetRecord(missing)).toBe(false);

    expect(isTargetRecord(fullTarget({ connectionId: null }))).toBe(false);
    expect(isTargetRecord(fullTarget({ extraField: "x" }))).toBe(false);
    expect(isTargetRecord(fullTarget({ appMeshId: "" }))).toBe(false);
    expect(isTargetRecord(fullTarget({ sourceGeneration: -1 }))).toBe(false);
    expect(isTargetRecord(fullTarget({ sourceGeneration: 1.5 }))).toBe(false);
    expect(isTargetRecord(fullTarget({ connectionId: "x".repeat(129) }))).toBe(false);
    expect(isTargetRecord(null)).toBe(false);
    expect(isTargetRecord("target")).toBe(false);
  });

  it("pins the frozen lifetime, skew and size bounds", () => {
    expect(ACTION_TTL_MS).toBe(30000);
    expect(NONCE_TTL_MS).toBe(60000);
    expect(PROOF_TTL_MS).toBe(60000);
    expect(CONSERVATIVE_SKEW_MS).toBe(5000);
    expect(MAX_ENVELOPE_BYTES).toBe(65536);
    expect(MAX_RESULT_BYTES).toBe(16384);
    expect(MAX_INPUT_BYTES).toBe(32768);
  });

  it("pins the four action routes N1 parses", () => {
    expect(Object.keys(ACTION_ROUTES).sort()).toEqual([
      "action-claim",
      "action-nonce",
      "action-result",
      "action-stream",
    ]);
    expect(ACTION_ROUTES["action-nonce"]).toMatchObject({
      method: "POST",
      path: "/api/v1/auth/session/content/:bindingId/source/sessions/:sourceSessionId/actions/nonces",
    });
    expect(ACTION_ROUTES["action-claim"]).toMatchObject({ method: "POST" });
    expect(ACTION_ROUTES["action-result"]).toMatchObject({ method: "POST" });
    expect(ACTION_ROUTES["action-stream"]).toMatchObject({ method: "GET" });
  });

  it("pins the r3 manifest both branches re-pin on", () => {
    expect(RC2_R3_PIN.manifestSha256).toBe(
      "6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715",
    );
    expect(RC2_R3_PIN.revision).toBe("r3");
    expect(RC2_R3_PIN.vectors["consent-native-canonical.json"]).toBe(
      "436d59008001e58252000b040509d1dc551d9aa82370a57f6c514cdd8360d10a",
    );
    expect(RC2_R3_PIN.vectors["RC0ImportedRecord.json"]).toBe(
      "951abfe00143599da7841707939bb5cec083665424b6cf5ed8ce986e818664c6",
    );
    expect(RC2_R3_PIN.vectors["route-action-nonce.json"]).toBe(
      "9e3823d0ab962d3cba8924b19f08d4a05de205f1c24456be3b45301d8da15fdb",
    );
    expect(RC2_R3_PIN.vectors["route-action-claim.json"]).toBe(
      "8735fae8ff6d153d0b0fcdf0462346cbe3c90776e1440efbb4814aa871d8c4b6",
    );
    expect(RC2_R3_PIN.vectors["route-action-result.json"]).toBe(
      "20e3a453f6427cf71abee300dd99b9b6548938f68d8647668cac19bc473ea332",
    );
    expect(RC2_R3_PIN.vectors["route-action-stream.json"]).toBe(
      "1d9c3a48f0a19c0858ce5cf82ea181d27e8945bd07665ca35a2cae0947a644e4",
    );
    expect(RC2_R3_PIN.vectors["public-fixture-trust.json"]).toBe(
      "81ed3136e06d95eedb056cdc5d19efebad1225d8626b836565685fcbc05167d1",
    );
    expect(RC2_R3_PIN.vectors["state-transitions.json"]).toBe(
      "3e3e4acc27f6e7615c22dc08fabd75bcdb5339097104e0487e384d6ebbd4f018",
    );
  });

  it("computes domain digests deterministically and domain-separated", () => {
    const a = digestDomain("target", { b: 1, a: 2 });
    const reordered = digestDomain("target", { a: 2, b: 1 });
    expect(a).toBe(reordered);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(digestDomain("input", "same")).not.toBe(digestDomain("target", "same"));
    expect(digestDomain("target", { a: 1 })).not.toBe(digestDomain("target", { a: 2 }));
  });

  it("refuses non-integer numbers in canonical JSON", () => {
    expect(() => canonicalJson(1.5)).toThrowError(/not canonicalizable/);
    expect(() => canonicalJson(Number.NaN)).toThrowError(/not canonicalizable/);
    expect(() => canonicalJson({ a: 1.5 })).toThrowError(/not canonicalizable/);
    expect(canonicalJson({ a: 1 })).toBe('{"a":1}');
  });

  it("matches the known SHA-256 answers for raw hashes", () => {
    expect(rawHash(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(rawHash(Buffer.from("abc", "utf8"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
