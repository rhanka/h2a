import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLiveDisclosureAuth, LIVE_DISCLOSURE_AUDIENCE, liveDisclosureSigningBytes,
  type LiveDisclosureClaims, type LiveDisclosureState,
} from "./live-auth.js";

function fixture() {
  const keys = generateKeyPairSync("ed25519");
  let now = 1000;
  let revoked: boolean | undefined = false;
  let state: LiveDisclosureState | undefined = {
    principal: "owner-key", hostId: "host-1", tenant: "local:owner-1",
    repositoryId: "clone-1", declarationId: "declaration-1", declarationRevision: 1,
    policyVersion: "content/1", authorizedRoots: ["/fixture/repo"], stateRevision: "state-1",
  };
  const { stateRevision: _, ...scope } = state;
  const claims: LiveDisclosureClaims = {
    ...scope, id: "cap-1", keyId: "key-1", audience: LIVE_DISCLOSURE_AUDIENCE,
    issuedAt: 900, expiresAt: 2000, operations: ["grant", "revoke", "emit"],
  };
  const capability = (patch: Partial<LiveDisclosureClaims> = {}) => {
    const value = { ...claims, ...patch };
    return { claims: value, signature: sign(null, liveDisclosureSigningBytes(value), keys.privateKey).toString("base64url") };
  };
  const auth = createLiveDisclosureAuth({ now: () => now,
    trust: (key) => key === "key-1" ? { ...scope, publicKey: keys.publicKey } : undefined,
    readState: (repo) => repo === "clone-1" ? state : undefined,
    isRevoked: () => revoked,
  });
  return { auth, capability, claims, setNow: (n: number) => { now = n; },
    setRevoked: (r: boolean | undefined) => { revoked = r; },
    setState: (s: LiveDisclosureState | undefined) => { state = s; }, state };
}

describe("verified live disclosure authority", () => {
  it("should authorize only a registered host proof bound to the current declaration", () => {
    const f = fixture();
    expect(f.auth.authorize(f.capability(), "grant", "clone-1")).toMatchObject({ ok: true, state: f.state });
  });
  it("should deny missing authority and unverified or session principals explicitly", () => {
    expect(createLiveDisclosureAuth().authorize({}, "grant", "clone-1")).toEqual({ ok: false, reason: "authority-unavailable" });
    const f = fixture();
    for (const proof of [undefined, "session-bearer", {}, { ...f.capability(), signature: "invalid" }, f.capability({ keyId: "unknown" })]) {
      expect(f.auth.authorize(proof, "grant", "clone-1")).toEqual({ ok: false, reason: "unverified-principal" });
    }
  });
  it.each([
    [{ audience: "session-control" }, "wrong-audience"],
    [{ expiresAt: 1000 }, "capability-expired"],
    [{ issuedAt: 1100 }, "capability-expired"],
    [{ operations: ["emit"] }, "operation-denied"],
    [{ principal: "another-owner" }, "unverified-principal"],
    [{ hostId: "another-host" }, "unverified-principal"],
    [{ tenant: "product:tenant" }, "unverified-principal"],
    [{ authorizedRoots: ["/other"] }, "scope-mismatch"],
    [{ declarationRevision: 2 }, "scope-mismatch"],
    [{ policyVersion: "content/0" }, "policy-changed"],
  ] as const)("should refuse mismatched capability %j", (patch, reason) => {
    const f = fixture();
    expect(f.auth.authorize(f.capability(patch), "grant", "clone-1")).toEqual({ ok: false, reason });
  });
  it("should recheck expiry revocation missing state and declaration replacement", () => {
    const f = fixture(); const proof = f.capability();
    f.setNow(2000);
    expect(f.auth.authorize(proof, "emit", "clone-1")).toEqual({ ok: false, reason: "capability-expired" });
    f.setNow(1000); f.setRevoked(true);
    expect(f.auth.authorize(proof, "emit", "clone-1")).toEqual({ ok: false, reason: "capability-revoked" });
    f.setRevoked(undefined);
    expect(f.auth.authorize(proof, "emit", "clone-1")).toEqual({ ok: false, reason: "authority-unavailable" });
    f.setRevoked(false); f.setState({ ...f.state!, declarationRevision: 2 });
    expect(f.auth.authorize(proof, "emit", "clone-1")).toEqual({ ok: false, reason: "scope-mismatch" });
    f.setState(undefined);
    expect(f.auth.authorize(proof, "emit", "clone-1")).toEqual({ ok: false, reason: "scope-mismatch" });
    expect(f.auth.authorize(proof, "emit", "clone-2")).toEqual({ ok: false, reason: "scope-mismatch" });
  });
  it("should contain throwing trust and hostile accessors without echoing their values", () => {
    const f = fixture();
    const auth = createLiveDisclosureAuth({ trust: () => { throw new Error("SECRET"); }, readState: () => f.state, isRevoked: () => false });
    expect(auth.authorize(f.capability(), "emit", "clone-1")).toEqual({ ok: false, reason: "authority-unavailable" });
    expect(f.auth.authorize({ get claims() { throw new Error("SECRET"); } }, "emit", "clone-1")).toEqual({ ok: false, reason: "unverified-principal" });
  });
});
