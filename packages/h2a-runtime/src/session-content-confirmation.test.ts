import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ConfirmationBudget, ConfirmationVerifier, confirmationNonce, type ConfirmationChallenge,
} from "./session-content-confirmation.js";
import { canonicalJson, parseStrictJson } from "./session-content-json.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: attacker, publicKey: attackerPublic } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const now = 1_800_000_000_000;
const challenge: ConfirmationChallenge = {
  id: "challenge-1", owner: { issuer: "https://issuer.example", subject: "owner" },
  project: { tenantId: "tenant", workspaceId: "workspace", workspaceIncarnation: "wi", projectId: "project" },
  source: { workstationId: "workstation", bindingId: "binding", bindingVersion: 1,
    sourceId: "source", sourceGeneration: "generation", sourceBootId: "boot" },
  clientId: "confirmation-client", purpose: "share", target: { kind: "policy", policyDigest: "a".repeat(64) },
  random: Buffer.alloc(32, 7).toString("base64url"), issuedAt: now, expiresAt: now + 60_000,
};
function jwt(ch: ConfirmationChallenge = challenge, patch: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const { attacker: useAttacker, ...protectedHeader } = header;
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", ...protectedHeader })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: ch.owner.issuer, sub: ch.owner.subject, aud: ch.clientId,
    tenantId: ch.project.tenantId, nonce: confirmationNonce(ch), acr: "urn:sentropic:loa:passkey-fresh",
    amr: ["hwk", "user", "mfa"], auth_time: now / 1000, iat: now / 1000, exp: now / 1000 + 60, ...patch })).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), useAttacker ? attacker : privateKey).toString("base64url")}`;
}
function setup() {
  let wall = now, mono = 1000;
  const consumed: string[] = [];
  const verifier = new ConfirmationVerifier({ issuer: "https://issuer.example", clientId: "confirmation-client",
    tenantId: "tenant", subject: "owner", keys: [jwk], wallNow: () => wall, monotonicNow: () => mono,
    measuredClockErrorMs: 0, source: challenge.source, budget: new ConfirmationBudget(() => mono) });
  const handle = verifier.stage(challenge);
  return { verifier, handle, consumed, advance: (ms: number) => { wall += ms; mono += ms; },
    jump: (ms: number) => { wall += ms; },
    consume: (proof = jwt(), guard = () => true) => verifier.consume(handle, proof, {
      // This synchronous port must run under the native denial fence and durably consume before effect.
      commit: (id) => { if (!guard()) throw new Error("denied"); consumed.push(id); },
    }) };
}

describe("session content confirmation", () => {
  it("should create and stage a native challenge using one clock sample without relaxing caller timestamp checks", () => {
    let wall=now;
    const verifier=new ConfirmationVerifier({issuer:challenge.owner.issuer,subject:challenge.owner.subject,tenantId:challenge.project.tenantId,
      clientId:challenge.clientId,source:challenge.source,keys:[jwk],budget:new ConfirmationBudget(()=>1000),
      measuredClockErrorMs:0,wallNow:()=>wall++,monotonicNow:()=>1000});
    const {issuedAt:_issued,expiresAt:_expires,...input}=challenge;
    const staged=verifier.create(input,60000);
    expect(staged.challenge.issuedAt).toBe(now);expect(staged.challenge.expiresAt).toBe(now+60000);
    expect(()=>verifier.stage(challenge)).toThrow();
  });
  it("should verify signed exact-target proof once and durably consume before returning", () => {
    const s = setup();
    expect(s.consume()).toMatchObject({ challengeId: challenge.id, purpose: "share" });
    expect(s.consumed).toEqual([challenge.id]);
    expect(() => s.consume()).toThrow();
    expect(s.consumed).toHaveLength(1);
  });
  it("should reject forged signatures, token-selected keys and unsigned or unknown algorithms", () => {
    for (const header of [{ attacker: true }, { jku: "https://attacker.example/keys" },
      { x5u: "https://attacker.example/cert" }, { jwk }, { alg: "none" }, { alg: "HS256" }]) {
      const s = setup();
      expect(() => s.consume(jwt(challenge, {}, header))).toThrow();
      expect(s.consumed).toEqual([]);
    }
  });
  it("should reject wrong identity, client, tenant, purpose and nonce without consuming", () => {
    for (const patch of [{ iss: "https://other.example" }, { sub: "other" }, { aud: "source-client" },
      { aud: [challenge.clientId, "other"], azp: "other" }, { tenantId: "other" },
      { nonce: "forged" }, { nonce: confirmationNonce({ ...challenge, purpose: "amend" }) }]) {
      const s = setup();
      expect(() => s.consume(jwt(challenge, patch))).toThrow();
      expect(s.consumed).toEqual([]);
    }
  });
  it("should reject missing expiry, stale authentication and incomplete MFA despite fresh issuance", () => {
    for (const patch of [{ exp: null }, { exp: now / 1000 }, { iat: now / 1000 + 100 },
      { auth_time: now / 1000 - 30 }, { auth_time: null }, { acr: "mfa" },
      { amr: ["hwk"] }, { amr: ["user", "mfa"] }]) {
      const s = setup();
      expect(() => s.consume(jwt(challenge, patch))).toThrow();
      expect(s.consumed).toEqual([]);
    }
  });
  it("should reject elapsed monotonic deadlines, unknown clock error and clock jumps", () => {
    const expired = setup(); expired.advance(60_000);
    expect(() => expired.consume()).toThrow();
    const jumped = setup(); jumped.jump(-10_000);
    expect(() => jumped.consume()).toThrow();
    expect(() => new ConfirmationVerifier({ issuer: challenge.owner.issuer, subject: "owner", tenantId: "tenant",
      clientId: challenge.clientId, source: challenge.source, keys: [jwk], budget: new ConfirmationBudget(), measuredClockErrorMs: null })).toThrow();
  });
  it("should refuse local denial and journal failure without returning permission", () => {
    const s = setup();
    expect(() => s.consume(jwt(), () => false)).toThrow();
    expect(s.consumed).toEqual([]);
    // A failed commit has an uncertain outcome; never retry the challenge automatically.
    expect(() => s.consume()).toThrow();
  });
  it("should cancel pending requests independently of quotas and reject foreign handles", () => {
    const s = setup(); s.verifier.cancelAll();
    expect(() => s.consume()).toThrow();
    expect(() => setup().verifier.consume(s.handle, jwt(), { commit() {} })).toThrow();
  });
  it("should bound pending slots by verified owner and host and refill without refunding cancellations", () => {
    const s = setup();
    for (let i = 1; i < 4; i++) s.verifier.stage({ ...challenge, id: `c-${i}` });
    expect(() => s.verifier.stage({ ...challenge, id: "excess" })).toThrow(/resource_busy/);
    s.verifier.cancelAll();
    expect(() => s.verifier.stage({ ...challenge, id: "rate" })).toThrow(/rate_limited/);
    s.advance(10_000);
    expect(s.verifier.stage({ ...challenge, id: "refilled", issuedAt: now + 10_000, expiresAt: now + 70_000 })).toBeDefined();
  });
  it("should bind two outstanding challenges to distinct signed nonces in the same second", () => {
    const s = setup();
    const second = { ...challenge, id: "second", random: Buffer.alloc(32, 8).toString("base64url") };
    const b = s.verifier.stage(second);
    expect(() => s.verifier.consume(b, jwt(), { commit() {} })).toThrow();
    expect(s.consume()).toBeDefined();
    expect(s.verifier.consume(b, jwt(second), { commit: (id) => s.consumed.push(id) })).toBeDefined();
    expect(s.consumed).toEqual([challenge.id, second.id]);
    // This proves native nonce separation only, NOT the issuer's one-UV-event invariant.
  });
  it("should reject caller mutation after staging and support pinned key rotation only", () => {
    const s = setup();
    const mutable = structuredClone(challenge); mutable.id = "mutable";
    const h = s.verifier.stage(mutable);
    if (mutable.target.kind === "policy") mutable.target.policyDigest = "b".repeat(64);
    expect(() => s.verifier.consume(h, jwt(mutable), { commit() {} })).toThrow();
    const fresh = setup();
    fresh.verifier.replaceKeys([{ ...attackerPublic.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" }]);
    expect(() => fresh.consume()).toThrow();
    fresh.verifier.replaceKeys([jwk]);
    expect(fresh.consume()).toBeDefined();
  });
  it("should bind pending quotas to the authenticated source rather than claimed source IDs", () => {
    const s = setup();
    expect(() => s.verifier.stage({ ...challenge, id: "other-source",
      source: { ...challenge.source, sourceId: "invented" } })).toThrow();
  });
  it("should share the sixteen-slot host limit and host creation bucket across authenticated owners", () => {
    let wall = now, mono = 1000;
    const budget = new ConfirmationBudget(() => mono);
    const peers = Array.from({ length: 5 }, (_, i) => {
      const owner = { ...challenge.owner, subject: `owner-${i}` };
      const verifier = new ConfirmationVerifier({ issuer: owner.issuer, subject: owner.subject, tenantId: "tenant",
        clientId: challenge.clientId, source: challenge.source, keys: [jwk], measuredClockErrorMs: 0, budget,
        wallNow: () => wall, monotonicNow: () => mono });
      return { verifier, owner };
    });
    for (const p of peers.slice(0, 4)) for (let j = 0; j < 4; j++) {
      p.verifier.stage({ ...challenge, id: `${p.owner.subject}-${j}`, owner: p.owner });
    }
    const last = peers[4]!;
    expect(() => last.verifier.stage({ ...challenge, owner: last.owner })).toThrow(/resource_busy/);
    peers[0]!.verifier.cancelAll();
    expect(() => last.verifier.stage({ ...challenge, owner: last.owner })).toThrow(/rate_limited/);
    wall += 2500; mono += 2500;
    expect(last.verifier.stage({ ...challenge, owner: last.owner, issuedAt: wall, expiresAt: wall + 60_000 })).toBeDefined();
    for (const p of peers) p.verifier.cancelAll();
  });
  it("should reject duplicate JSON keys, invalid Unicode and noncanonical JWT encoding", () => {
    expect(() => parseStrictJson('{"exp":1,"exp":2}')).toThrow();
    expect(() => parseStrictJson('{"nested":{"x":1,"x":2}}')).toThrow();
    expect(() => canonicalJson({ x: "\ud800" })).toThrow();
    expect(canonicalJson({ z: 1, a: { b: 2, a: 1 } })).toBe('{"a":{"a":1,"b":2},"z":1}');
    const s = setup();
    expect(() => s.consume(jwt() + "=")).toThrow();
  });
});
