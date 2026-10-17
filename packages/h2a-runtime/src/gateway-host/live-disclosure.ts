/** Δ-L7a: host-owned disclosure grants, independent of collection/read access.
 * Evidence comes only from a host port (including cache provenance), never
 * directly from an MCP caller. No content or old snapshot is retained; grants
 * and their issuing proofs live only in memory and never resume after restart.
 */
import { randomUUID } from "node:crypto";
import {
  refuse, type DisclosureRefusal, type LiveDisclosureAuth,
  type LiveDisclosureAuthorization, type LiveDisclosureClaims, type Refused,
} from "./live-auth.js";

export const DISCLOSURE_SURFACES = ["prompt", "tool", "mcp", "summary", "symbol", "local-commit", "citation", "context"] as const;
export type DisclosureSurface = typeof DISCLOSURE_SURFACES[number];
export interface DisclosureScope {
  /** Exact repository-relative source paths; no wildcard or implicit descendants. */
  readonly paths: readonly string[];
  readonly surfaces: readonly DisclosureSurface[];
}
export interface LiveDisclosureEvidence {
  /** Host provenance ID; multiple fragments may belong to one requested entry. */
  readonly evidenceId: string;
  readonly repositoryId: string;
  readonly declarationId: string;
  readonly declarationRevision: number;
  readonly policyVersion: string;
  readonly stateRevision: string;
  /** Every source, including previous paths and memory/code composition origins. */
  readonly originPaths: readonly string[];
  readonly surface: DisclosureSurface;
  readonly text: string;
  /** L4b-2 withheld/protected facts and their derivatives stay excluded. */
  readonly excluded: boolean;
}
export interface DisclosureAuditEvent {
  readonly eventId: string;
  readonly at: number;
  /** An attempt is audited before handoff; it is not a delivery receipt. */
  readonly action: "grant" | "revoke" | "emit-attempt" | "refuse";
  /** Only host-minted opaque identifiers enter receipts; never caller text. */
  readonly grantId?: string;
  readonly reason?: DisclosureRefusal;
}
export interface LiveExternalTransport {
  /** Actual destination, including routing/fallback; a different provider must reauthorize. */
  readonly providerId: string;
  /** Synchronous handoff is the emission boundary. No later unguarded routing. */
  send(texts: readonly string[]): void | Promise<void>;
}
/** One host read transaction, held until synchronous send returns.
 * Decisions are values, never callbacks into mutable policy/auth state.
 */
export interface LiveDisclosureEmissionSnapshot {
  readonly at: number;
  readonly authorization: LiveDisclosureAuthorization;
  readonly issuerAuthorization: LiveDisclosureAuthorization;
  readonly readAllowed: boolean;
  readonly policy?: Readonly<{ version: string; allowed: readonly boolean[]; compositionAllowed: boolean }>;
  readonly providerId: string;
}
export interface LiveDisclosureEmissionLease {
  readonly snapshot: LiveDisclosureEmissionSnapshot;
  /** Bound to snapshot.providerId; synchronous handoff under the same host fence. */
  send(texts: readonly string[]): void | Promise<void>;
  release(): void;
}
export interface LiveDisclosureOptions {
  readonly auth: LiveDisclosureAuth;
  readonly now?: () => number;
  /** Must durably append synchronously or throw; unavailable audit denies emission. */
  readonly audit?: (event: DisclosureAuditEvent) => void;
  readonly loadEvidence: (ids: readonly string[]) => Promise<readonly LiveDisclosureEvidence[]>;
  /** Separate verified read authority; a disclosure grant cannot create it. */
  readonly readAccess?: (request: Readonly<{
    principal: string; repositoryId: string; evidenceIds: readonly string[];
  }>) => boolean;
  /** Current host L4b exclusion policy. Absence/incompatibility never falls back. */
  readonly contentPolicy?: () => Readonly<{
    version: string; allows(evidence: LiveDisclosureEvidence): boolean;
  }> | undefined;
  readonly transport: (providerId: string) => LiveExternalTransport | undefined;
  /** Mandatory at handoff. Acquire one host-owned read transaction spanning
   * trust/revocation, declaration/latest-state, clock, read authority, policy
   * decisions for every fragment AND their concatenation, and actual routing.
   * All relevant writers (including reentrant audit callbacks) must be fenced
   * until release. Resolve callbacks/getters BEFORE exposing the snapshot.
   * No promise, stale independent reads, caller booleans or unlocked fallback.
   * The current G4 consumer stays closed until its host implements this port.
   */
  readonly acquireEmissionSnapshot?: (request: Readonly<{
    request: EmitDisclosureRequest; issuingCapability: unknown;
    evidence: readonly LiveDisclosureEvidence[]; transport: LiveExternalTransport;
  }>) => LiveDisclosureEmissionLease | Refused;
}
export interface GrantDisclosureRequest {
  readonly capability: unknown;
  readonly repositoryId: string;
  readonly providerId: string;
  readonly scope: DisclosureScope;
  /** Absolute exclusive bound in milliseconds, also bounded by the owner proof. */
  readonly expiresAt: number;
}
export interface EmitDisclosureRequest {
  readonly capability: unknown;
  readonly grantId?: string;
  readonly repositoryId: string;
  readonly providerId: string;
  readonly evidenceIds: readonly string[];
}
export interface LiveDisclosureAuthority {
  grant(request: GrantDisclosureRequest): Refused | Readonly<{ ok: true; grantId: string; expiresAt: number }>;
  revoke(capability: unknown, grantId: string): Refused | Readonly<{ ok: true }>;
  emit(request: EmitDisclosureRequest): Promise<Refused | Readonly<{ ok: true }>>;
  /** G4's missing L8 policy is a typed, audited refusal before any read. */
  policyUnavailable(): Refused;
}

interface Grant {
  readonly issuingCapability: unknown;
  readonly claims: LiveDisclosureClaims;
  readonly providerId: string;
  readonly scope: DisclosureScope;
  readonly expiresAt: number;
  readonly startsAt: number;
  revoked: boolean;
}
const validPath = (path: unknown): path is string => typeof path === "string" && path.length > 0
  && !/[\\\0:*?\[\]{}]/.test(path) && path.split("/").every((p) => p !== "" && p !== "." && p !== "..");
const validProvider = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9._:/-]{0,199}$/.test(v);
// Superset of engram e417c33c content-policy.ts L4b-2. Keep every normative
// secret rule, basename/prefix/suffix/segment, and secret-bearing path bytes.
const protectedPath = (p: string): boolean => containsKnownSecret(p) || p.split("/").some((part) =>
  /^\.env/i.test(part) || /^\.ssh$/i.test(part) || /^(id_(rsa|dsa|ecdsa|ed25519)|credentials)(\.|$)/i.test(part)
  || /^(secret|secrets|secrets\.json|service-account\.json)$/i.test(part) || /\.(pem|key|p12|pfx)$/i.test(part));
// Defence in depth; the current L4b policy remains mandatory. This cannot
// establish the absence of unknown secrets, nor override withheld provenance.
const containsKnownSecret = (text: string): boolean =>
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,}/.test(text)
  || /(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*\S+/i.test(text)
  || /:\/\/[^/\s:]+:[^/\s@]+@/.test(text);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createLiveDisclosureAuthority(options: LiveDisclosureOptions): LiveDisclosureAuthority {
  const readNow = options.now ?? Date.now;
  const now = (): number => { try { return readNow(); } catch { return NaN; } };
  const grants = new Map<string, Grant>();
  const record = (action: DisclosureAuditEvent["action"], grantId?: string, reason?: DisclosureRefusal, snapshotTime?: number): boolean => {
    try {
      if (!options.audit) return false;
      const at = snapshotTime ?? now(); if (!Number.isSafeInteger(at)) return false;
      const receipt: unknown = options.audit(Object.freeze({ eventId: randomUUID(), at, action,
        ...(grantId === undefined ? {} : { grantId }), ...(reason === undefined ? {} : { reason }) }));
      if (receipt !== undefined) {
        // A void-typed async callback is legal TypeScript but cannot attest a
        // durable synchronous append. Contain its rejection as well.
        if (receipt instanceof Promise) void receipt.catch(() => {});
        return false;
      }
      return true;
    } catch { return false; }
  };
  const deny = (reason: DisclosureRefusal, requestedId?: string): Refused => record("refuse",
    requestedId !== undefined && grants.has(requestedId) ? requestedId : undefined, reason)
    ? refuse(reason) : refuse("audit-unavailable");
  const authorize = (capability: unknown, operation: "grant" | "emit" | "revoke", repositoryId?: string): LiveDisclosureAuthorization => {
    try { return options.auth.authorize(capability, operation, repositoryId); }
    catch { return refuse("authority-unavailable"); }
  };
  const check = (r: EmitDisclosureRequest): Refused | { ok: true; grant: Grant; stateRevision: string } => {
    const auth = authorize(r.capability, "emit", r.repositoryId);
    if (!auth.ok) return auth;
    const g = r.grantId === undefined ? undefined : grants.get(r.grantId);
    if (!g) return refuse("grant-required");
    const issuer = authorize(g.issuingCapability, "grant", r.repositoryId);
    if (!issuer.ok) return issuer;
    if (g.claims.repositoryId !== r.repositoryId || g.claims.principal !== auth.claims.principal
      || g.claims.hostId !== auth.claims.hostId || g.claims.tenant !== auth.claims.tenant
      || g.claims.declarationId !== auth.claims.declarationId || g.claims.declarationRevision !== auth.claims.declarationRevision
      || JSON.stringify(g.claims.authorizedRoots) !== JSON.stringify(auth.claims.authorizedRoots)) return refuse("scope-mismatch");
    if (g.claims.policyVersion !== auth.claims.policyVersion) return refuse("policy-changed");
    if (g.revoked) return refuse("grant-revoked");
    const time = now(); if (!Number.isSafeInteger(time)) return refuse("authority-unavailable");
    if (time >= g.expiresAt || time < g.startsAt) return refuse("grant-expired");
    if (g.providerId !== r.providerId) return refuse("provider-mismatch");
    try {
      if (options.readAccess?.(Object.freeze({ principal: auth.claims.principal, repositoryId: r.repositoryId,
        evidenceIds: Object.freeze([...r.evidenceIds]) })) !== true) return refuse("read-denied");
    } catch { return refuse("read-denied"); }
    const lateIssuer = authorize(g.issuingCapability, "grant", r.repositoryId);
    if (!lateIssuer.ok) return lateIssuer;
    const latest = authorize(r.capability, "emit", r.repositoryId);
    if (!latest.ok) return latest;
    if (g.revoked) return refuse("grant-revoked");
    const finalTime = now();
    if (!Number.isSafeInteger(finalTime)) return refuse("authority-unavailable");
    if (finalTime >= g.expiresAt || finalTime < g.startsAt) return refuse("grant-expired");
    return { ok: true, grant: g, stateRevision: latest.state.stateRevision };
  };
  return {
    grant(input) {
      let r: GrantDisclosureRequest;
      try { r = copy(input); } catch { return deny("invalid-request"); }
      if (!r || !validProvider(r.providerId) || !Number.isSafeInteger(r.expiresAt)
        || !r.scope || !Array.isArray(r.scope.paths) || r.scope.paths.length === 0 || !r.scope.paths.every(validPath)
        || !Array.isArray(r.scope.surfaces) || r.scope.surfaces.length === 0
        || !r.scope.surfaces.every((s) => DISCLOSURE_SURFACES.includes(s))) return deny("invalid-request");
      const auth = authorize(r.capability, "grant", r.repositoryId);
      if (!auth.ok) return deny(auth.reason);
      const time = now();
      if (!Number.isSafeInteger(time) || r.expiresAt <= time || r.expiresAt > auth.claims.expiresAt) return deny("invalid-request");
      const id = randomUUID();
      const g: Grant = { issuingCapability: r.capability, claims: copy(auth.claims), providerId: r.providerId,
        startsAt: time, expiresAt: r.expiresAt,
        scope: { paths: Object.freeze([...r.scope.paths]), surfaces: Object.freeze([...r.scope.surfaces]) }, revoked: false };
      grants.set(id, g);
      if (!record("grant", id)) { grants.delete(id); return refuse("audit-unavailable"); }
      return Object.freeze({ ok: true, grantId: id, expiresAt: g.expiresAt });
    },
    revoke(capability, id) {
      const auth = authorize(capability, "revoke");
      if (!auth.ok) return deny(auth.reason, id);
      const g = grants.get(id); if (!g) return deny("grant-required");
      if (auth.claims.repositoryId !== g.claims.repositoryId || auth.claims.principal !== g.claims.principal || auth.claims.hostId !== g.claims.hostId
        || auth.claims.tenant !== g.claims.tenant) return deny("scope-mismatch", id);
      // Revocation takes effect even if its audit sink has failed.
      g.revoked = true;
      return record("revoke", id) ? Object.freeze({ ok: true }) : refuse("audit-unavailable");
    },
    async emit(input) {
      let r: EmitDisclosureRequest;
      try { r = copy(input); } catch { return deny("invalid-request"); }
      const reject = (reason: DisclosureRefusal): Refused => deny(reason, r?.grantId);
      if (!r || !Array.isArray(r.evidenceIds) || r.evidenceIds.length === 0
        || r.evidenceIds.some((id) => typeof id !== "string" || id.length === 0)) return reject("invalid-request");
      Object.freeze(r.evidenceIds); Object.freeze(r);
      const permitted = check(r); if (!permitted.ok) return reject(permitted.reason);
      let evidence: readonly LiveDisclosureEvidence[];
      try { evidence = copy(await options.loadEvidence(Object.freeze([...r.evidenceIds]))); }
      catch { return reject("evidence-unavailable"); }
      // Freeze evidence before any policy/transport callback can mutate it.
      try {
        if (!Array.isArray(evidence) || evidence.length === 0) return reject("evidence-unavailable");
        for (const e of evidence) {
          if (!e || !r.evidenceIds.includes(e.evidenceId) || typeof e.text !== "string" || typeof e.excluded !== "boolean"
            || !Array.isArray(e.originPaths) || e.originPaths.length === 0 || !e.originPaths.every(validPath)) return reject("evidence-unavailable");
          Object.freeze(e.originPaths); Object.freeze(e);
        }
        if (r.evidenceIds.some(id => !evidence.some(e => e.evidenceId === id))) return reject("evidence-unavailable");
        Object.freeze(evidence);
      } catch { return reject("evidence-unavailable"); }
      const screen = (): Refused | undefined => {
        const current = check(r); if (!current.ok) return current;
        const g = current.grant;
        const policy = options.contentPolicy?.();
        if (!policy || typeof policy.allows !== "function") return refuse("policy-unavailable");
        if (policy.version !== g.claims.policyVersion) return refuse("policy-changed");
        for (const e of evidence) {
          if (e.repositoryId !== r.repositoryId || e.declarationId !== g.claims.declarationId
            || e.declarationRevision !== g.claims.declarationRevision) return refuse("scope-mismatch");
          if (e.policyVersion !== g.claims.policyVersion) return refuse("policy-changed");
          if (e.stateRevision !== current.stateRevision) return refuse("stale-evidence");
          if (!g.scope.surfaces.includes(e.surface) || e.originPaths.some((p: string) => !g.scope.paths.includes(p))) return refuse("out-of-scope");
          if (e.excluded || e.originPaths.some(protectedPath) || containsKnownSecret(e.text) || policy.allows(e) !== true) return refuse("secret-excluded");
        }
        const text = evidence.map((e) => e.text).join("");
        if (containsKnownSecret(text) || policy.allows(Object.freeze({ ...evidence[0]!, text,
          originPaths: Object.freeze([...new Set(evidence.flatMap(e => e.originPaths))]) })) !== true) return refuse("secret-excluded");
        return undefined;
      };
      try {
        const refusal = screen(); if (refusal) return reject(refusal.reason);
      } catch { return reject("policy-unavailable"); }
      let transport: LiveExternalTransport | undefined;
      try {
        transport = options.transport(r.providerId);
        if (!transport || transport.providerId !== r.providerId || typeof transport.send !== "function") return reject("provider-mismatch");
      } catch { return reject("transport-failed"); }
      // Reordering mutable callbacks cannot make the decision atomic.
      // Require a host snapshot lease; final validation uses data only.
      if (!options.acquireEmissionSnapshot) return reject("authority-unavailable");
      let lease: LiveDisclosureEmissionLease;
      try {
        const acquired = options.acquireEmissionSnapshot(Object.freeze({ request: r,
          issuingCapability: permitted.grant.issuingCapability, evidence, transport }));
        if ("ok" in acquired) return reject(acquired.reason);
        lease = acquired;
      } catch { return reject("authority-unavailable"); }
      let pending: void | Promise<void>;
      let releaseFailed = false;
      try {
        // Resolve accessors before validation, while the host fence is held.
        const send = lease.send.bind(lease);
        const snapshot = copy(lease.snapshot);
        const auth = snapshot.authorization;
        const issuer = snapshot.issuerAuthorization;
        if (!auth.ok) return reject(auth.reason);
        if (!issuer.ok) return reject(issuer.reason);
        const g = permitted.grant;
        // Bind both proofs and their states to this grant. No live authority,
        // read, clock, policy or route callbacks run during this validation.
        for (const verified of [auth, issuer]) {
          for (const key of ["principal", "hostId", "tenant", "repositoryId", "declarationId", "declarationRevision"] as const) {
            if (verified.claims[key] !== g.claims[key] || verified.state[key] !== g.claims[key]) return reject("scope-mismatch");
          }
          if (JSON.stringify(verified.claims.authorizedRoots) !== JSON.stringify(g.claims.authorizedRoots)
            || JSON.stringify(verified.state.authorizedRoots) !== JSON.stringify(g.claims.authorizedRoots)) return reject("scope-mismatch");
          if (verified.claims.policyVersion !== g.claims.policyVersion || verified.state.policyVersion !== g.claims.policyVersion) return reject("policy-changed");
          if (snapshot.at < verified.claims.issuedAt || snapshot.at >= verified.claims.expiresAt) return reject("capability-expired");
        }
        if (g.revoked) return reject("grant-revoked");
        if (!Number.isSafeInteger(snapshot.at)) return reject("authority-unavailable");
        if (snapshot.at < g.startsAt || snapshot.at >= g.expiresAt) return reject("grant-expired");
        if (snapshot.readAllowed !== true) return reject("read-denied");
        if (snapshot.providerId !== r.providerId) return reject("provider-mismatch");
        if (evidence.some(e => e.stateRevision !== auth.state.stateRevision || e.stateRevision !== issuer.state.stateRevision)) return reject("stale-evidence");
        const policy = snapshot.policy;
        if (!policy) return reject("policy-unavailable");
        if (policy.version !== g.claims.policyVersion) return reject("policy-changed");
        if (policy.allowed.length !== evidence.length || policy.allowed.some(allowed => allowed !== true)
          || policy.compositionAllowed !== true) return reject("secret-excluded");
        // All route/policy/state checks precede the receipt. The host fence
        // covers audit; a reentrant revocation of our local grant still wins.
        if (!record("emit-attempt", r.grantId, undefined, snapshot.at)) return refuse("audit-unavailable");
        if (g.revoked) return reject("grant-revoked");
        try { pending = send(Object.freeze(evidence.map(e => e.text))); }
        catch { return reject("transport-failed"); }
      } catch { return reject("authority-unavailable"); }
      finally { try { lease.release(); } catch { releaseFailed = true; } }
      try { await pending; } catch { return reject("transport-failed"); }
      if (releaseFailed) return reject("authority-unavailable");
      return Object.freeze({ ok: true });
    },
    policyUnavailable: () => deny("policy-unavailable"),
  };
}
