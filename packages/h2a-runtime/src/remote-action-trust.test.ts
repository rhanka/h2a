import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  TrustError,
  assertLiveKey,
  createPinnedTrust,
  isAllowedBodyAlg,
  isAllowedJwsAlg,
  resolveTrustEntry,
  type PinnedKey,
} from "./remote-action-trust.js";

function spkiFor(label: string): { spkiBase64: string } {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  void label;
  return { spkiBase64: der.toString("base64") };
}

function keyEntry(overrides: Partial<PinnedKey> & { kid: string }): PinnedKey {
  return {
    issuer: "test-issuer",
    audience: "test-b-audience",
    purposes: ["action-envelope"],
    publicKeySpkiBase64: spkiFor(overrides.kid).spkiBase64,
    revoked: false,
    fixtureOnly: false,
    ...overrides,
  };
}

describe("pinned remote-action trust", () => {
  it("resolves a known kid for its pinned purpose", () => {
    const trust = createPinnedTrust([
      keyEntry({ kid: "k1", purposes: ["nonce-publication"] }),
    ]);
    const entry = resolveTrustEntry(trust, "k1", "nonce-publication");
    expect(entry.kid).toBe("k1");
  });

  it("fails closed on an unknown kid", () => {
    const trust = createPinnedTrust([keyEntry({ kid: "k1" })]);
    expect(() => resolveTrustEntry(trust, "nope", "action-envelope")).toThrowError(TrustError);
    try {
      resolveTrustEntry(trust, "nope", "action-envelope");
      expect.unreachable();
    } catch (error) {
      expect((error as TrustError).code).toBe("unknown_kid");
    }
  });

  it("fails closed on a revoked kid", () => {
    const trust = createPinnedTrust([keyEntry({ kid: "k1", revoked: true })]);
    expect(() => resolveTrustEntry(trust, "k1", "action-envelope")).toThrowError(
      expect.objectContaining({ code: "revoked_key" }),
    );
  });

  it("refuses cross-purpose key use with a valid signature key", () => {
    const trust = createPinnedTrust([
      keyEntry({ kid: "k1", purposes: ["session-attestation"] }),
    ]);
    expect(() => resolveTrustEntry(trust, "k1", "action-envelope")).toThrowError(
      expect.objectContaining({ code: "wrong_purpose" }),
    );
  });

  it("ignores trust material smuggled inside the message body", () => {
    const trust = createPinnedTrust([keyEntry({ kid: "k1" })]);
    const bodyWithSmuggledRoots = {
      version: "remote-action-v1",
      kind: "action-envelope",
      kid: "attacker-key",
      trustRoots: ["attacker-key"],
      publicKey: "MCowBQYDK2VwAyEAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=",
    };
    expect(() =>
      resolveTrustEntry(
        trust,
        bodyWithSmuggledRoots.kid,
        "action-envelope",
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown_kid" }));
  });

  it("rejects duplicate kids when the store is pinned", () => {
    expect(() =>
      createPinnedTrust([keyEntry({ kid: "k1" }), keyEntry({ kid: "k1" })]),
    ).toThrowError(TrustError);
  });

  it("freezes the pinned store so callers cannot add roots", () => {
    const trust = createPinnedTrust([keyEntry({ kid: "k1" })]);
    expect(Object.isFrozen(trust)).toBe(true);
    expect(Object.isFrozen(trust.keys)).toBe(true);
  });

  it("refuses fixture-only keys for live admission", () => {
    const trust = createPinnedTrust([
      keyEntry({ kid: "fixture-key", fixtureOnly: true }),
      keyEntry({ kid: "live-key", fixtureOnly: false }),
    ]);
    expect(() => assertLiveKey(trust.keys[0]!)).toThrowError(
      expect.objectContaining({ code: "fixture_only" }),
    );
    expect(() => assertLiveKey(trust.keys[1]!)).not.toThrow();
  });

  it("allows only Ed25519 raw bodies and EdDSA JWS", () => {
    expect(isAllowedBodyAlg("Ed25519")).toBe(true);
    expect(isAllowedBodyAlg("EdDSA")).toBe(false);
    expect(isAllowedBodyAlg("RS256")).toBe(false);
    expect(isAllowedBodyAlg("none")).toBe(false);
    expect(isAllowedJwsAlg("EdDSA")).toBe(true);
    expect(isAllowedJwsAlg("RS256")).toBe(false);
    expect(isAllowedJwsAlg("Ed25519")).toBe(false);
  });
});
