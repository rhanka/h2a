import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createContentPolicyConsent } from "./session-content-consent.js";

const corpus = JSON.parse(readFileSync(new URL("./fixtures/session-content/v3/policy-proof/vectors/policy-coherent.json", import.meta.url), "utf8"));
const blocked = { ok: false, code: "unsupported_version" };

describe("N4 consent successor remains disabled before SG-R15", () => {
  for (const c of [...corpus.positive, ...corpus.activationNegative]) {
    it(`should leave capture off through nonce, proof and activation for ${c.id}`, () => {
      const consent = createContentPolicyConsent();
      expect(consent.canCapture()).toBe(false);
      expect(consent.consumeNonce(c.proof.body.nonce)).toEqual(blocked);
      expect(consent.consumeProof(c.proof)).toEqual(blocked);
      expect(consent.acceptActivationReceipt(c.receipt)).toEqual(blocked);
      expect(consent.canCapture()).toBe(false);
      expect(createContentPolicyConsent().canCapture()).toBe(false);
    });
  }

  for (const c of [corpus.reconnect, ...corpus.reconnectNegative]) {
    it(`should refuse capture refresh without changing admitted policy for ${c.id ?? "coherent reconnect"}`, () => {
      const before = JSON.stringify(c);
      const consent = createContentPolicyConsent();
      for (const r of c.records) expect(consent.refreshCapture(r.value)).toEqual(blocked);
      expect(consent.canCapture()).toBe(false);
      expect(JSON.stringify(c)).toBe(before);
    });
  }

  it("should never acquire nonce, proof or receipt input while the gate is closed", () => {
    const body = new Proxy({}, { get() { throw new Error("input read"); }, ownKeys() { throw new Error("input read"); } });
    const consent = createContentPolicyConsent();
    expect(Object.isFrozen(consent)).toBe(true);
    for (const call of [consent.consumeNonce, consent.consumeProof, consent.acceptActivationReceipt, consent.refreshCapture]) {
      expect(call(body)).toEqual(blocked);
      expect(call(null)).toEqual(blocked);
      expect(call({ accepted: true, r15Accepted: true, captureEnabled: true })).toEqual(blocked);
      expect(Object.isFrozen(call(body))).toBe(true);
    }
    expect(consent.canCapture()).toBe(false);
  });

  it("should have no route, transport, native host, capture callback or fence dependency", () => {
    for (const file of ["session-content-v3-api.ts", "session-content-policy-proof.ts", "session-content-consent.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map(m => m[1]);
      for (const path of imports) expect(path).toMatch(/^(?:node:(?:crypto|module)|ajv\/dist\/2020\.js|\.\/(?:remote-action-contract|session-content-(?:v3-api|policy-proof|consent)|fixtures\/session-content\/v3\/policy-proof\/schemas)\.js)$/);
      expect(source).not.toMatch(/\b(?:fetch|WebSocket|NativeTerminalHost|spawn|createServer|createConnection)\s*\(/);
    }
  });
});
