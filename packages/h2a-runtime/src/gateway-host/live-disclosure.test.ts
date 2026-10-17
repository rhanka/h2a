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
    readAccess: () => true,
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
