import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLiveDisclosureAuth, LIVE_DISCLOSURE_AUDIENCE, liveDisclosureSigningBytes, type LiveDisclosureClaims, type LiveDisclosureState } from "./live-auth.js";
import { createLiveDisclosureAuthority, DISCLOSURE_SURFACES, type DisclosureAuditEvent, type EmitDisclosureRequest, type LiveDisclosureEvidence, type LiveDisclosureOptions } from "./live-disclosure.js";
import { createLiveDisclosureHost } from "./live-host.js";

function fixture() {
  const keys = generateKeyPairSync("ed25519");
  let now = 1000;
  const revokedProofs = new Set<string>();
  let state: LiveDisclosureState = {
    principal: "owner-1", hostId: "host-1", tenant: "local:owner-1", repositoryId: "clone-1",
    declarationId: "declaration-1", declarationRevision: 1, authorizedRoots: ["/fixture/repo"],
    policyVersion: "content/1", stateRevision: "state-1",
  };
  const { stateRevision: _, ...scope } = state;
  const claims: LiveDisclosureClaims = { ...scope, id: "proof-1", keyId: "key-1", audience: LIVE_DISCLOSURE_AUDIENCE,
    issuedAt: 900, expiresAt: 3000, operations: ["grant", "revoke", "emit"] };
  const proof = { claims, signature: sign(null, liveDisclosureSigningBytes(claims), keys.privateKey).toString("base64url") };
  const auth = createLiveDisclosureAuth({ now: () => now, trust: () => ({ ...scope, publicKey: keys.publicKey }),
    readState: () => state, isRevoked: (id) => revokedProofs.has(id) });
  const audit: DisclosureAuditEvent[] = [];
  const wire: string[] = [];
  let evidence: LiveDisclosureEvidence[] = [{ ...state, originPaths: ["src/a.ts"], surface: "mcp", text: "allowed fixture", excluded: false }];
  const options: { -readonly [K in keyof LiveDisclosureOptions]: LiveDisclosureOptions[K] } = { auth, now: () => now, audit: (event) => { audit.push(event); },
    loadEvidence: vi.fn(async () => evidence), contentPolicy: () => ({ version: state.policyVersion, allows: () => true }),
    transport: (providerId) => ({ providerId, send: (texts) => { wire.push(...texts); } }),
  };
  const authority = createLiveDisclosureAuthority(options);
  const request = { capability: proof, repositoryId: "clone-1", providerId: "provider-1",
    scope: { paths: ["src/a.ts"], surfaces: [...DISCLOSURE_SURFACES] }, expiresAt: 2000 };
  const grant = () => {
    const result = authority.grant(request);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("fixture grant refused");
    return result.grantId;
  };
  const emit = (grantId?: string, patch: Partial<EmitDisclosureRequest> = {}) => authority.emit({
    capability: proof, repositoryId: "clone-1", providerId: "provider-1", evidenceIds: ["cache-entry-1"],
    ...(grantId === undefined ? {} : { grantId }), ...patch,
  });
  return { authority, options, request, proof, wire, audit, grant, emit,
    revokeProof: () => { revokedProofs.add(claims.id); },
    freshProof: () => {
      const c = { ...claims, id: "proof-2" };
      return { claims: c, signature: sign(null, liveDisclosureSigningBytes(c), keys.privateKey).toString("base64url") };
    },
    get evidence() { return evidence; }, setEvidence: (v: LiveDisclosureEvidence[]) => { evidence = v; },
    setNow: (v: number) => { now = v; }, setState: (v: Partial<LiveDisclosureState>) => { state = { ...state, ...v }; } };
}

describe("Δ-L7a disclosure authority", () => {
  it("should deny live read and MCP access without an explicit repository provider grant before loading evidence", async () => {
    const f = fixture();
    expect(await f.emit()).toEqual({ ok: false, reason: "grant-required" });
    expect(f.options.loadEvidence).not.toHaveBeenCalled(); expect(f.wire).toEqual([]);
    expect(f.audit).toMatchObject([{ action: "refuse", reason: "grant-required" }]);
    expect(f.authority.grant({ ...f.request, capability: "session-bearer" })).toEqual({ ok: false, reason: "unverified-principal" });
  });
  it.each(DISCLOSURE_SURFACES)("should emit only the authorized latest non-secret %s surface", async (surface) => {
    const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, surface }]);
    expect(await f.emit(f.grant())).toEqual({ ok: true });
    expect(f.wire).toEqual(["allowed fixture"]);
    expect(f.audit.map((e) => e.action)).toEqual(["grant", "emit-attempt"]);
  });
  it("should bind an explicit grant to the verified owner duration and exact scope", () => {
    const f = fixture();
    for (const patch of [{ expiresAt: 1000 }, { expiresAt: 3001 }, { providerId: "*" },
      { scope: { paths: [], surfaces: ["mcp"] } }, { scope: { paths: ["../a"], surfaces: ["mcp"] } },
      { scope: { paths: ["src/*"], surfaces: ["mcp"] } }, { scope: { paths: ["src/a.ts"], surfaces: ["unknown"] } }]) {
      expect(f.authority.grant({ ...f.request, ...patch } as typeof f.request)).toEqual({ ok: false, reason: "invalid-request" });
    }
  });
  it.each([
    ["repository", "scope-mismatch"], ["provider", "provider-mismatch"], ["path", "out-of-scope"],
    ["origin", "out-of-scope"], ["surface", "out-of-scope"], ["expired", "grant-expired"],
    ["revoked", "grant-revoked"], ["state", "stale-evidence"], ["revision", "scope-mismatch"],
    ["policy", "policy-changed"], ["foreign-evidence", "scope-mismatch"], ["withheld", "secret-excluded"],
  ] as const)("should refuse %s on cached or composed evidence without bytes on the external transport", async (change, reason) => {
    const f = fixture();
    if (change === "surface") f.request.scope.surfaces = ["prompt"];
    const id = f.grant(); let patch: Partial<EmitDisclosureRequest> = {};
    if (change === "repository") patch = { repositoryId: "clone-2" };
    if (change === "provider") patch = { providerId: "provider-2" };
    if (change === "path") f.setEvidence([{ ...f.evidence[0]!, originPaths: ["src/ab.ts"] }]);
    if (change === "origin") f.setEvidence([{ ...f.evidence[0]!, originPaths: ["src/a.ts", "private/b.ts"] }]);
    if (change === "expired") f.setNow(2000);
    if (change === "revoked") expect(f.authority.revoke(f.proof, id)).toEqual({ ok: true });
    if (change === "state") f.setState({ stateRevision: "state-2" });
    if (change === "revision") f.setState({ declarationRevision: 2 });
    if (change === "policy") f.setState({ policyVersion: "content/2" });
    if (change === "foreign-evidence") f.setEvidence([{ ...f.evidence[0]!, repositoryId: "clone-2" }]);
    if (change === "withheld") f.setEvidence([{ ...f.evidence[0]!, excluded: true }]);
    expect(await f.emit(id, patch)).toEqual({ ok: false, reason }); expect(f.wire).toEqual([]);
  });
  it.each([".env", "nested/.env.production", ".ssh/id_ed25519", "private.pem", "credentials.json"])("should keep protected source %s excluded even with explicit consent", async (path) => {
    const f = fixture(); f.request.scope.paths = [path]; f.setEvidence([{ ...f.evidence[0]!, originPaths: [path] }]);
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: "secret-excluded" }); expect(f.wire).toEqual([]);
  });
  it.each(["-----BEGIN PRIVATE KEY-----", "ghp_" + "x".repeat(36), "AKIA" + "A".repeat(16), "sk-" + "x".repeat(40)])("should exclude known secret text before transport and audit", async (text) => {
    const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, text }]);
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: "secret-excluded" });
    expect(f.wire).toEqual([]); expect(JSON.stringify(f.audit)).not.toContain(text);
  });
  it("should apply L4b exclusion to derivatives and secrets split over composed responses", async () => {
    const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, text: "ghp_" }, { ...f.evidence[0]!, text: "x".repeat(36) }]);
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: "secret-excluded" }); expect(f.wire).toEqual([]);
    f.options.contentPolicy = () => ({ version: "content/1", allows: () => false });
    f.setEvidence([{ ...f.evidence[0]!, text: "derived symbol" }]);
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: "secret-excluded" });
  });
});
