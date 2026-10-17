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
  let locked = false;
  const assertWritable = () => { if (locked) throw new Error("SNAPSHOT-WRITE-FENCED"); };
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
  let evidence: LiveDisclosureEvidence[] = [{ evidenceId: "cache-entry-1", ...state, originPaths: ["src/a.ts"], surface: "mcp", text: "allowed fixture", excluded: false }];
  const options: { -readonly [K in keyof LiveDisclosureOptions]: LiveDisclosureOptions[K] } = new Proxy<{
    -readonly [K in keyof LiveDisclosureOptions]: LiveDisclosureOptions[K]
  }>({ auth, now: () => now, audit: (event) => { audit.push(event); },
    readAccess: () => true,
    loadEvidence: vi.fn(async () => evidence), contentPolicy: () => ({ version: state.policyVersion, allows: () => true }),
    transport: (providerId) => ({ providerId, send: (texts) => { wire.push(...texts); } }),
    acquireEmissionSnapshot: ({ request, issuingCapability, evidence: batch, transport }) => {
      // Test host owns the state and every writer. Resolve potentially reentrant
      // ports before taking a single immutable data snapshot; fence its lifetime.
      const providerId = transport.providerId;
      const send = transport.send.bind(transport);
      const composition = Object.freeze({ ...batch[0]!, text: batch.map(e => e.text).join(''),
        originPaths: Object.freeze([...new Set(batch.flatMap(e => e.originPaths))]) });
      try {
        const policy = options.contentPolicy?.();
        if (policy) { batch.forEach(e => policy.allows(e)); policy.allows(composition); }
      } catch { return { ok: false, reason: 'policy-unavailable' }; }
      // Exercise host callbacks, then capture authoritative data directly. These
      // callbacks are not used by the leased snapshot's verifier or send path.
      options.auth.authorize(request.capability, 'emit', request.repositoryId);
      options.auth.authorize(issuingCapability, 'grant', request.repositoryId);
      let readAllowed = false;
      try { readAllowed = options.readAccess?.({ principal: claims.principal, repositoryId: request.repositoryId, evidenceIds: request.evidenceIds }) === true; }
      catch { return { ok: false, reason: 'read-denied' }; }
      let policyDecision;
      locked = true;
      try {
        const policy = options.contentPolicy?.();
        if (policy) policyDecision = { version: policy.version, allowed: batch.map(e => policy.allows(e)), compositionAllowed: policy.allows(composition) };
      } catch { locked = false; return { ok: false, reason: 'policy-unavailable' }; }
      const capturedState = structuredClone(state); const capturedNow = now; const capturedRevoked = new Set(revokedProofs);
      const capturedAuth = createLiveDisclosureAuth({ now: () => capturedNow, trust: () => ({ ...scope, publicKey: keys.publicKey }),
        readState: () => capturedState, isRevoked: id => capturedRevoked.has(id) });
      const snapshot = Object.freeze({ at: capturedNow, providerId, readAllowed,
        authorization: capturedAuth.authorize(request.capability, 'emit', request.repositoryId),
        issuerAuthorization: capturedAuth.authorize(issuingCapability, 'grant', request.repositoryId),
        ...(policyDecision ? { policy: Object.freeze({ ...policyDecision, allowed: Object.freeze(policyDecision.allowed) }) } : {}),
      });
      locked = true;
      return { snapshot, send, release: () => { locked = false; } };
    },
  }, { set: (target, key, value) => { assertWritable(); return Reflect.set(target, key, value); } });
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
    revokeProof: () => { assertWritable(); revokedProofs.add(claims.id); },
    freshProof: () => {
      const c = { ...claims, id: "proof-2" };
      return { claims: c, signature: sign(null, liveDisclosureSigningBytes(c), keys.privateKey).toString("base64url") };
    },
    get evidence() { return evidence; }, setEvidence: (v: LiveDisclosureEvidence[]) => { evidence = v; },
    setNow: (v: number) => { assertWritable(); now = v; }, setState: (v: Partial<LiveDisclosureState>) => { assertWritable(); state = { ...state, ...v }; } };
}

describe("Δ-L7a disclosure authority", () => {
  it.each(['removed','version','denied'] as const)('should refuse policy %s during final host proof verification', async change => {
    const f = fixture(); const id = f.grant(); let calls = 0; let armed = false;
    f.options.contentPolicy = () => { if (++calls === 2) armed = true; return { version: 'content/1', allows: () => true }; };
    const authorize = f.options.auth.authorize;
    f.options.auth.authorize = (...args) => {
      const result = authorize(...args);
      if (armed) f.options.contentPolicy = () => change === 'removed' ? undefined : { version: change === 'version' ? 'content/2' : 'content/1', allows: () => change !== 'denied' };
      return result;
    };
    expect(await f.emit(id)).toEqual({ ok: false, reason: change === 'removed' ? 'policy-unavailable' : change === 'version' ? 'policy-changed' : 'secret-excluded' }); expect(f.wire).toEqual([]);
  });
  it('should release the snapshot at synchronous handoff before awaiting transport completion', async () => {
    const f = fixture(); let finish!: () => void; const sent = new Promise<void>(resolve => { finish = resolve; });
    f.options.transport = providerId => ({ providerId, send: texts => { f.wire.push(...texts); return sent; } });
    const emission = f.emit(f.grant());
    await vi.waitFor(() => expect(f.wire).toEqual(['allowed fixture']));
    expect(() => f.setNow(2000)).not.toThrow(); finish(); expect(await emission).toEqual({ ok: true });
  });
  it.each(['throw','reject'] as const)('should contain a transport %s after recording the attempt', async mode => {
    const f = fixture(); f.options.transport = providerId => ({ providerId, send: () => { if (mode === 'throw') throw new Error('SEND-CANARY'); return Promise.reject(new Error('SEND-CANARY')); } });
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: 'transport-failed' });
    expect(f.audit.map(e => e.action)).toEqual(['grant','emit-attempt','refuse']); expect(JSON.stringify(f.audit)).not.toContain('SEND-CANARY');
  });
  it('should contain acquisition and release failures without exposing exceptions', async () => {
    const f = fixture(); const id = f.grant(); const acquire = f.options.acquireEmissionSnapshot!;
    f.options.acquireEmissionSnapshot = () => { throw new Error('LEASE-CANARY'); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: 'authority-unavailable' }); expect(f.wire).toEqual([]);
    f.options.acquireEmissionSnapshot = request => {
      const lease = acquire(request); if ('ok' in lease) return lease;
      return { ...lease, release: () => { lease.release(); throw new Error('LEASE-CANARY'); } };
    };
    expect(await f.emit(id)).toEqual({ ok: false, reason: 'authority-unavailable' });
    expect(f.wire).toEqual(['allowed fixture']); // An attempt is not a delivery receipt.
    expect(JSON.stringify(f.audit)).not.toContain('LEASE-CANARY');
  });

  it('should deny handoff without a coherent host snapshot rather than use unlocked callbacks', async () => {
    const f = fixture(); const id = f.grant(); delete f.options.acquireEmissionSnapshot;
    expect(await f.emit(id)).toEqual({ ok: false, reason: 'authority-unavailable' });
    expect(f.wire).toEqual([]); expect(f.audit.map(e => e.action)).toEqual(['grant', 'refuse']);
  });
  it.each(['clock','state','policy','read','route','proof'] as const)('should hold the host writer fence over audit and synchronous send for %s', async change => {
    const f = fixture(); const id = f.grant();
    f.options.audit = event => {
      f.audit.push(event);
      if (event.action === 'emit-attempt') {
        if (change === 'clock') f.setNow(2000);
        if (change === 'state') f.setState({ stateRevision: 'state-2' });
        if (change === 'policy') f.options.contentPolicy = () => undefined;
        if (change === 'read') f.options.readAccess = () => false;
        if (change === 'route') f.options.transport = () => undefined;
        if (change === 'proof') f.revokeProof();
      }
    };
    expect(await f.emit(id)).toEqual({ ok: false, reason: 'audit-unavailable' }); expect(f.wire).toEqual([]);
    // The lease must also be released on refusal.
    expect(() => f.setNow(1001)).not.toThrow();
  });
  it('should make the decision and synchronous send on the same snapshot without rereading host ports', async () => {
    const f = fixture(); const id = f.grant(); let leased = false; let sentWhileLeased = false;
    const acquire = f.options.acquireEmissionSnapshot!;
    for (const key of ['contentPolicy','readAccess','transport'] as const) {
      const original = f.options[key]!;
      Object.defineProperty(f.options, key, { configurable: true, get: () => { expect(leased).toBe(false); return original; } });
    }
    const authorize = f.options.auth.authorize;
    f.options.auth.authorize = (...args) => { expect(leased).toBe(false); return authorize(...args); };
    f.options.acquireEmissionSnapshot = request => {
      expect(Object.isFrozen(request.request)).toBe(true); expect(Object.isFrozen(request.evidence)).toBe(true);
      expect(request.evidence.every(e => Object.isFrozen(e) && Object.isFrozen(e.originPaths))).toBe(true);
      const lease = acquire(request); if ('ok' in lease) return lease;
      leased = true;
      return { snapshot: lease.snapshot, send: texts => { sentWhileLeased = leased; expect(() => f.setNow(2000)).toThrow('SNAPSHOT-WRITE-FENCED'); return lease.send(texts); },
        release: () => { leased = false; lease.release(); } };
    };
    expect(await f.emit(id)).toEqual({ ok: true }); expect(sentWhileLeased).toBe(true); expect(leased).toBe(false);
    expect(f.wire).toEqual(['allowed fixture']);
  });
  it('should refuse unrelated evidence even when the returned count matches', async () => {
    const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, evidenceId: 'unrequested' }]);
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: 'evidence-unavailable' }); expect(f.wire).toEqual([]);
  });
  it('should emit a complete identified batch and deny duplicates substituted for a missing entry', async () => {
    const f = fixture(); const id = f.grant();
    f.setEvidence([{ ...f.evidence[0]! }, { ...f.evidence[0]!, evidenceId: 'cache-entry-2', text: 'second fixture' }]);
    expect(await f.emit(id, { evidenceIds: ['cache-entry-1','cache-entry-2'] })).toEqual({ ok: true });
    expect(f.wire).toEqual(['allowed fixture','second fixture']); f.wire.length = 0;
    f.setEvidence([{ ...f.evidence[0]! }, { ...f.evidence[0]! }]);
    expect(await f.emit(id, { evidenceIds: ['cache-entry-1','cache-entry-2'] })).toEqual({ ok: false, reason: 'evidence-unavailable' }); expect(f.wire).toEqual([]);
  });

  // Engram e417c33c content-policy.ts: all five normative rules and alternatives.
  it.each([
    'AKIAIOSFODNN7SYNTHETIC', ...['p','o','u','s','r'].map(k => 'gh' + k + '_' + 'x'.repeat(36)),
    'github_pat_' + 'x'.repeat(30), 'sk-' + 'x'.repeat(40), ...['', 'RSA ', 'ED25519 ', 'PKCS8 ', 'RSA PSS '].map(k => '-----BEGIN ' + k + 'PRIVATE KEY-----'),
    ...['password', 'passwd', 'pwd', 'secret', 'api_key', 'api-key', 'apikey'].map(k => k + ' = synthetic-value'),
    'db_password = "synthetic-s3cr3t-not-real"', 'postgres://tester:synthetic-pw-not-real@localhost:5432/demo',
  ])('should exclude normative L4b-2 secret %s on every surface and composition', async (text) => {
    for (const surface of DISCLOSURE_SURFACES) {
      const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, surface, text }]);
      expect(await f.emit(f.grant())).toEqual({ ok: false, reason: 'secret-excluded' });
      expect(f.wire).toEqual([]); expect(JSON.stringify(f.audit)).not.toContain(text);
    }
    for (let split = 1; split < text.length; split++) {
      const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, text: 'Bearer' + text.slice(0, split) }, { ...f.evidence[0]!, text: text.slice(split) }]);
      expect(await f.emit(f.grant())).toEqual({ ok: false, reason: 'secret-excluded' }); expect(f.wire).toEqual([]);
    }
  });
  it.each([
    '.env', 'config/.env.production', 'certs/tls.key', 'certs/bundle.pem',
    ...['id_rsa','id_dsa','id_ecdsa','id_ed25519','credentials.json','secrets.json','service-account.json'].map(p => 'nested/' + p),
    ...['secret','secrets','credentials'].map(p => p + '/config.yaml'),
    'token-ghp_' + 'x'.repeat(36), 'AKIAIOSFODNN7SYNTHETIC/file', 'api_key=synthetic-value/file', 'github_pat_' + 'x'.repeat(30) + '/file', '-----BEGIN ED25519 PRIVATE KEY-----/file',
  ])('should exclude every normative protected path %s despite explicit consent', async (path) => {
    const f = fixture(); f.request.scope.paths = [path]; f.setEvidence([{ ...f.evidence[0]!, originPaths: [path] }]);
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: 'secret-excluded' }); expect(f.wire).toEqual([]);
    expect(JSON.stringify(f.audit)).not.toContain(path);
  });
  it('should screen the assembled response with the mandatory host policy', async () => {
    const f = fixture(); f.setEvidence([{ ...f.evidence[0]!, text: 'host-' }, { ...f.evidence[0]!, text: 'private' }]);
    f.options.contentPolicy = () => ({ version: 'content/1', allows: e => !e.text.includes('host-private') });
    expect(await f.emit(f.grant())).toEqual({ ok: false, reason: 'secret-excluded' }); expect(f.wire).toEqual([]);
  });
  it.each(['emit','revoke'] as const)('should authenticate before revealing grant existence through %s', async (operation) => {
    const f = fixture(); const id = f.grant();
    for (const grantId of [id, 'unknown']) {
      const result = operation === 'emit' ? await f.emit(grantId, { capability: 'session-bearer' }) : f.authority.revoke('session-bearer', grantId);
      expect(result).toEqual({ ok: false, reason: 'unverified-principal' });
    }
    expect(f.audit.at(-2)).toMatchObject({ action: 'refuse', grantId: id });
    expect(f.audit.at(-1)).not.toHaveProperty('grantId');
  });
  it.each([{ declarationRevision: 2 }, { policyVersion: 'content/2' }, { authorizedRoots: ['/replacement'] }])('should allow the verified owner to revoke after state evolution %j', async (patch) => {
    const f = fixture(); const id = f.grant(); f.setState(patch);
    expect(f.authority.revoke(f.proof, id)).toEqual({ ok: true });
    expect(f.audit.at(-1)).toMatchObject({ action: 'revoke', grantId: id });
  });
  it('should correlate a scope-denied revocation with the known opaque grant', () => {
    const f = fixture(); const id = f.grant();
    const authorize = f.options.auth.authorize;
    f.options.auth.authorize = (...args) => {
      const result = authorize(...args);
      return result.ok ? { ...result, claims: { ...result.claims, principal: 'other-owner' } } : result;
    };
    expect(f.authority.revoke(f.proof, id)).toEqual({ ok: false, reason: 'scope-mismatch' });
    expect(f.audit.at(-1)).toMatchObject({ action: 'refuse', grantId: id, reason: 'scope-mismatch' });
  });
  it('should refuse a partial nonempty evidence batch', async () => {
    const f = fixture();
    expect(await f.emit(f.grant(), { evidenceIds: ['cache-entry-1', 'missing'] })).toEqual({ ok: false, reason: 'evidence-unavailable' });
    expect(f.wire).toEqual([]);
  });
  it('should classify a throwing transport factory as transport-failed without an attempt', async () => {
    const f = fixture(); const id = f.grant(); f.options.transport = () => { throw new Error('ROUTE-CANARY'); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: 'transport-failed' });
    expect(f.audit.map(e => e.action)).toEqual(['grant', 'refuse']); expect(f.wire).toEqual([]);
  });
  it('should classify a late throwing policy as policy-unavailable without an attempt', async () => {
    const f = fixture(); const id = f.grant(); let calls = 0;
    f.options.contentPolicy = () => { if (++calls > 1) throw new Error('POLICY-CANARY'); return { version: 'content/1', allows: () => true }; };
    expect(await f.emit(id)).toEqual({ ok: false, reason: 'policy-unavailable' });
    expect(f.audit.map(e => e.action)).toEqual(['grant', 'refuse']); expect(f.wire).toEqual([]);
  });
  it.each(['provider','state'] as const)('should not audit an emission attempt before final %s validation', async change => {
    const f = fixture(); const id = f.grant();
    f.options.transport = () => { if (change === 'state') f.setState({ stateRevision: 'state-2' }); return { providerId: change === 'provider' ? 'other-provider' : 'provider-1', send: () => {} }; };
    expect(await f.emit(id)).toEqual({ ok: false, reason: change === 'provider' ? 'provider-mismatch' : 'stale-evidence' });
    expect(f.audit.map(e => e.action)).toEqual(['grant', 'refuse']); expect(f.wire).toEqual([]);
  });
  it.each(['removed','version','denied'] as const)('should refuse a policy %s by final read authorization', async change => {
    const f = fixture(); const id = f.grant(); let calls = 0; let armed = false;
    f.options.contentPolicy = () => { if (++calls === 2) armed = true; return { version: 'content/1', allows: () => true }; };
    f.options.readAccess = () => {
      if (armed) f.options.contentPolicy = () => change === 'removed' ? undefined : ({ version: change === 'version' ? 'content/2' : 'content/1', allows: () => change !== 'denied' });
      return true;
    };
    expect(await f.emit(id)).toEqual({ ok: false, reason: change === 'removed' ? 'policy-unavailable' : change === 'version' ? 'policy-changed' : 'secret-excluded' });
    expect(f.wire).toEqual([]);
  });
  it.each(['revoke','expire','state','proof','read','policy'] as const)('should refuse %s injected by the last destination getter', async change => {
    const f = fixture(); const id = f.grant(); let calls = 0;
    f.options.transport = () => ({ get providerId() {
      if (++calls >= 2) { if (change === 'revoke') f.authority.revoke(f.proof,id); if (change === 'expire') f.setNow(2000); if (change === 'state') f.setState({ stateRevision: 'state-2' }); if (change === 'proof') f.revokeProof(); if (change === 'read') f.options.readAccess = () => false; if (change === 'policy') f.options.contentPolicy = () => undefined; }
      return 'provider-1';
    }, send: texts => { f.wire.push(...texts); } });
    expect(await f.emit(id)).toEqual({ ok: false, reason: { revoke: 'grant-revoked', expire: 'grant-expired', state: 'stale-evidence', proof: 'capability-revoked', read: 'read-denied', policy: 'policy-unavailable' }[change] });
    expect(f.wire).toEqual([]);
  });

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
  it.each(["-----BEGIN PRIVATE KEY-----", "ghp_" + "x".repeat(36), "AKIA" + "A".repeat(16), "sk-" + "x".repeat(40)])("should exclude known secret %s before transport and audit", async (text) => {
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
  it.each(["revoke", "expire", "latest", "policy"] as const)("should revalidate %s after async preparation immediately before emission", async (change) => {
    const f = fixture(); const id = f.grant();
    f.options.loadEvidence = async () => {
      await Promise.resolve();
      if (change === "revoke") f.authority.revoke(f.proof, id);
      if (change === "expire") f.setNow(2000);
      if (change === "latest") f.setState({ stateRevision: "state-2" });
      if (change === "policy") f.setState({ policyVersion: "content/2" });
      return f.evidence;
    };
    expect(await f.emit(id)).toEqual({ ok: false, reason: { revoke: "grant-revoked", expire: "grant-expired", latest: "stale-evidence", policy: "policy-changed" }[change] });
    expect(f.wire).toEqual([]);
  });
  it("should refuse revocation injected by the audit handoff and prevent mutable request widening", async () => {
    const f = fixture(); const id = f.grant();
    f.options.audit = (e) => { f.audit.push(e); if (e.action === "emit-attempt") f.authority.revoke(f.proof, id); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: "grant-revoked" }); expect(f.wire).toEqual([]);
    const g = fixture(); const gid = g.grant(); g.request.scope.paths.push("private/b.ts");
    g.setEvidence([{ ...g.evidence[0]!, originPaths: ["private/b.ts"] }]);
    expect(await g.emit(gid)).toEqual({ ok: false, reason: "out-of-scope" });
  });
  it("should contain port failures and refuse missing policy audit or mismatched actual destination", async () => {
    const f = fixture(); const id = f.grant();
    f.options.loadEvidence = async () => { throw new Error("SENSITIVE-PORT-CANARY"); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: "evidence-unavailable" });
    f.options.loadEvidence = async () => f.evidence;
    f.options.contentPolicy = () => undefined;
    expect(await f.emit(id)).toEqual({ ok: false, reason: "policy-unavailable" });
    f.options.contentPolicy = () => ({ version: "content/1", allows: () => true });
    f.options.transport = () => ({ providerId: "fallback-provider", send: () => { throw new Error("must not send"); } });
    expect(await f.emit(id)).toEqual({ ok: false, reason: "provider-mismatch" });
    f.options.audit = () => { throw new Error("SENSITIVE-PORT-CANARY"); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: "audit-unavailable" });
    expect(f.wire).toEqual([]); expect(JSON.stringify(f.audit)).not.toContain("SENSITIVE-PORT-CANARY");
  });
  it("should refuse G4 with policy-unavailable before loading or sending composed MCP content", async () => {
    const f = fixture(); const host = createLiveDisclosureHost(f.options);
    expect(await host.emit({ capability: f.proof, evidenceIds: ["cache-entry-1"] })).toEqual({ ok: false, reason: "policy-unavailable" });
    expect(f.options.loadEvidence).not.toHaveBeenCalled(); expect(f.wire).toEqual([]);
    expect(f.audit).toMatchObject([{ action: "refuse", reason: "policy-unavailable" }]);
  });
  it("should refuse latest-state replacement inside the final policy callback", async () => {
    const f = fixture(); const id = f.grant(); let checks = 0;
    f.options.contentPolicy = () => ({ version: "content/1", allows: () => {
      if (++checks === 2) f.setState({ stateRevision: "state-2" }); return true;
    } });
    expect(await f.emit(id)).toEqual({ ok: false, reason: "stale-evidence" }); expect(f.wire).toEqual([]);
  });
  it("should refuse a destination changed by the final policy callback before handoff", async () => {
    const f = fixture(); const id = f.grant(); let destination = "provider-1"; let checks = 0;
    f.options.transport = () => ({ get providerId() { return destination; }, send: (texts) => { f.wire.push(...texts); } });
    f.options.contentPolicy = () => ({ version: "content/1", allows: () => { if (++checks === 2) destination = "provider-2"; return true; } });
    expect(await f.emit(id)).toEqual({ ok: false, reason: "provider-mismatch" }); expect(f.wire).toEqual([]);
  });
  it("should keep a grant denied when its issuing proof is revoked even with a fresh emission proof", async () => {
    const f = fixture(); const id = f.grant(); f.revokeProof();
    expect(await f.emit(id, { capability: f.freshProof() })).toEqual({ ok: false, reason: "capability-revoked" });
    expect(f.wire).toEqual([]);
  });
  it("should not extend a grant backwards before its explicit start time", async () => {
    const f = fixture(); const id = f.grant(); f.setNow(950);
    expect(await f.emit(id)).toEqual({ ok: false, reason: "grant-expired" }); expect(f.wire).toEqual([]);
  });
  it("should not manufacture read permission from an otherwise valid disclosure grant", async () => {
    const f = fixture(); const id = f.grant();
    f.options.readAccess = () => false;
    expect(await f.emit(id)).toEqual({ ok: false, reason: "read-denied" });
    expect(f.options.loadEvidence).not.toHaveBeenCalled(); expect(f.wire).toEqual([]);
  });
  it("should deny absent throwing or revoked read authority on a warm grant", async () => {
    const f = fixture(); const id = f.grant(); delete f.options.readAccess;
    expect(await f.emit(id)).toEqual({ ok: false, reason: "read-denied" });
    f.options.readAccess = () => { throw new Error("READ-CANARY"); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: "read-denied" });
    let allowed = true; f.options.readAccess = () => allowed;
    f.options.loadEvidence = async () => { await Promise.resolve(); allowed = false; return f.evidence; };
    expect(await f.emit(id)).toEqual({ ok: false, reason: "read-denied" }); expect(f.wire).toEqual([]);
  });
  it("should refuse the whole composed batch if one origin belongs to another repository", async () => {
    const f = fixture(); const id = f.grant();
    f.setEvidence([...f.evidence, { ...f.evidence[0]!, repositoryId: "clone-2", text: "foreign fixture" }]);
    expect(await f.emit(id)).toEqual({ ok: false, reason: "scope-mismatch" }); expect(f.wire).toEqual([]);
  });
  it("should recheck a grant on each warm cache hit and keep a new host denied after restart", async () => {
    const f = fixture(); const id = f.grant(); expect(await f.emit(id)).toEqual({ ok: true });
    f.authority.revoke(f.proof, id); expect(await f.emit(id)).toEqual({ ok: false, reason: "grant-revoked" });
    expect(f.options.loadEvidence).toHaveBeenCalledTimes(1);
    const restarted = createLiveDisclosureAuthority(f.options);
    expect(await restarted.emit({ capability: f.proof, grantId: id, repositoryId: "clone-1", providerId: "provider-1", evidenceIds: ["cache-entry-1"] }))
      .toEqual({ ok: false, reason: "grant-required" });
    expect(f.wire).toEqual(["allowed fixture"]);
  });
  it("should retain the original destination when an emission request mutates during preparation", async () => {
    const f = fixture(); const id = f.grant();
    const request = { capability: f.proof, grantId: id, repositoryId: "clone-1", providerId: "provider-1", evidenceIds: ["cache-entry-1"] };
    f.options.loadEvidence = async () => { await Promise.resolve(); request.providerId = "provider-2"; return f.evidence; };
    const route = vi.fn(f.options.transport); f.options.transport = route;
    expect(await f.authority.emit(request)).toEqual({ ok: true });
    expect(route).toHaveBeenCalledWith("provider-1");
  });
  it("should keep audit-unavailable revocation effective when the sink recovers", async () => {
    const f = fixture(); const id = f.grant();
    const audit = f.options.audit; f.options.audit = () => { throw new Error("AUDIT-CANARY"); };
    expect(f.authority.revoke(f.proof, id)).toEqual({ ok: false, reason: "audit-unavailable" });
    f.options.audit = audit!;
    expect(await f.emit(id)).toEqual({ ok: false, reason: "grant-revoked" }); expect(f.wire).toEqual([]);
  });
  it("should fail closed when an audit sink returns an asynchronous receipt", async () => {
    const f = fixture(); const id = f.grant();
    f.options.audit = async () => { await Promise.resolve(); };
    expect(await f.emit(id)).toEqual({ ok: false, reason: "audit-unavailable" }); expect(f.wire).toEqual([]);
  });
  it("should contain an unavailable clock rather than reject with its exception", async () => {
    const f = fixture(); f.options.now = () => { throw new Error("CLOCK-CANARY"); };
    const a = createLiveDisclosureAuthority(f.options);
    expect(a.grant(f.request)).toEqual({ ok: false, reason: "audit-unavailable" });
  });
  it("should record only opaque receipts in a durable host sink with no private payload or proof", async () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-disclosure-audit-"));
    try {
      const f = fixture(); const log = join(root, "audit.jsonl");
      f.options.audit = (event) => { appendFileSync(log, JSON.stringify(event) + "\n", { flush: true }); };
      const id = f.grant(); expect(await f.emit(id)).toEqual({ ok: true });
      f.authority.revoke(f.proof, id);
      expect(await f.emit(id)).toEqual({ ok: false, reason: "grant-revoked" });
      const bytes = readFileSync(log, "utf8");
      expect(bytes).not.toContain("allowed fixture"); expect(bytes).not.toContain(f.proof.signature);
      expect(bytes).not.toContain("src/a.ts");
      expect(bytes.trim().split("\n").map((line) => JSON.parse(line).action)).toEqual(["grant", "emit-attempt", "revoke", "refuse"]);
      expect(JSON.parse(bytes.trim().split("\n").at(-1)!)).toMatchObject({ grantId: id, reason: "grant-revoked" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("should keep the emitted G4 consumer closed without L8 policy on an isolated installation", async () => {
    const root = mkdtempSync(join(tmpdir(), "h2a-disclosure-installed-"));
    try {
      const repo = resolve(import.meta.dirname, "../../../..");
      execFileSync(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"),
        "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--skipLibCheck",
        "--outDir", root, join(import.meta.dirname, "live-host.ts")], { cwd: repo, stdio: "pipe" });
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
      const probe = `import { createLiveDisclosureHost } from './live-host.js';
        const receipts = []; const forbidden = () => { throw new Error('UNEXPECTED-READ-OR-EMISSION'); };
        const host = createLiveDisclosureHost({ auth: { authorize: forbidden }, loadEvidence: forbidden,
          transport: forbidden, audit: e => { receipts.push(e); } });
        console.log(JSON.stringify({ result: await host.emit({}), receipts }));`;
      writeFileSync(join(root, "probe.mjs"), probe);
      const result = JSON.parse(execFileSync(process.execPath, [join(root, "probe.mjs")], {
        cwd: root, env: { ...process.env, HOME: root, XDG_RUNTIME_DIR: root }, encoding: "utf8",
      }));
      expect(result).toMatchObject({ result: { ok: false, reason: "policy-unavailable" }, receipts: [{ action: "refuse", reason: "policy-unavailable" }] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
