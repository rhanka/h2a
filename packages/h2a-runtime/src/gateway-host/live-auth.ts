/** Live disclosure uses registered host keys, never loopback/session bearers.
 * All ports are host-owned. This module neither discovers identity nor reads
 * owner state. Missing trust/declaration/revocation information fails closed.
 */
import { verify, type KeyObject } from "node:crypto";

export const LIVE_DISCLOSURE_AUDIENCE = "h2a:live-disclosure:v1";
export type DisclosureOperation = "grant" | "revoke" | "emit";
export type DisclosureRefusal =
  | "authority-unavailable" | "unverified-principal" | "wrong-audience"
  | "capability-expired" | "capability-revoked" | "operation-denied"
  | "scope-mismatch" | "policy-changed" | "invalid-request"
  | "grant-required" | "grant-expired" | "grant-revoked"
  | "provider-mismatch" | "out-of-scope" | "secret-excluded"
  | "stale-evidence" | "evidence-unavailable" | "policy-unavailable"
  | "audit-unavailable" | "transport-failed";
export type Refused = Readonly<{ ok: false; reason: DisclosureRefusal }>;
export const refuse = (reason: DisclosureRefusal): Refused => Object.freeze({ ok: false, reason });

export interface LiveDisclosureState {
  readonly principal: string;
  readonly hostId: string;
  readonly tenant: string;
  /** Host-derived opaque clone identity, never a URL or workspace fingerprint. */
  readonly repositoryId: string;
  readonly declarationId: string;
  readonly declarationRevision: number;
  readonly policyVersion: string;
  readonly authorizedRoots: readonly string[];
  /** Latest local state; cached derivatives must still match it at emission. */
  readonly stateRevision: string;
}
export interface LiveDisclosureClaims extends Omit<LiveDisclosureState, "stateRevision"> {
  readonly id: string;
  readonly audience: string;
  readonly keyId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly operations: readonly DisclosureOperation[];
}
export interface LiveDisclosureCapability {
  readonly claims: LiveDisclosureClaims;
  readonly signature: string;
}
/** Fixed domain and field order: signatures cannot be reused as session proofs. */
export function liveDisclosureSigningBytes(c: LiveDisclosureClaims): Buffer {
  return Buffer.from(JSON.stringify([LIVE_DISCLOSURE_AUDIENCE, c.id, c.audience,
    c.keyId, c.principal, c.hostId, c.tenant, c.repositoryId, c.declarationId,
    c.declarationRevision, c.policyVersion, c.authorizedRoots, c.issuedAt,
    c.expiresAt, c.operations]));
}
export interface LiveDisclosureAuthOptions {
  readonly now?: () => number;
  readonly trust?: (keyId: string) => Readonly<{
    principal: string; hostId: string; tenant: string; publicKey: KeyObject;
  }> | undefined;
  readonly readState?: (repositoryId: string) => LiveDisclosureState | undefined;
  /** Undefined means revocation status is unavailable, not active. */
  readonly isRevoked?: (capabilityId: string) => boolean | undefined;
}
export type LiveDisclosureAuthorization = Refused | Readonly<{
  ok: true; claims: LiveDisclosureClaims; state: LiveDisclosureState;
}>;
export interface LiveDisclosureAuth {
  authorize(capability: unknown, operation: DisclosureOperation, repositoryId: string): LiveDisclosureAuthorization;
}

const nonempty = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !v.includes("\0");
function validClaims(c: LiveDisclosureClaims): boolean {
  return [c.id, c.keyId, c.audience, c.principal, c.hostId, c.tenant,
    c.repositoryId, c.declarationId, c.policyVersion].every(nonempty)
    && c.tenant.startsWith("local:") && Number.isSafeInteger(c.declarationRevision) && c.declarationRevision > 0
    && Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt)
    && Array.isArray(c.authorizedRoots) && c.authorizedRoots.length > 0 && c.authorizedRoots.every(nonempty)
    && Array.isArray(c.operations) && c.operations.length > 0
    && c.operations.every((op) => ["grant", "revoke", "emit"].includes(op));
}

export function createLiveDisclosureAuth(options: LiveDisclosureAuthOptions = {}): LiveDisclosureAuth {
  const now = options.now ?? Date.now;
  return { authorize(input, operation, repositoryId) {
    if (!options.trust || !options.readState || !options.isRevoked) return refuse("authority-unavailable");
    let proof: LiveDisclosureCapability;
    try {
      // Freeze caller-controlled bytes before consulting any host port.
      proof = JSON.parse(JSON.stringify(input)) as LiveDisclosureCapability;
      if (!proof || !proof.claims || !validClaims(proof.claims) || typeof proof.signature !== "string") return refuse("unverified-principal");
    } catch { return refuse("unverified-principal"); }
    try {
      const c = proof.claims;
      const trust = options.trust(c.keyId);
      if (!trust || trust.principal !== c.principal || trust.hostId !== c.hostId || trust.tenant !== c.tenant
        || trust.publicKey.asymmetricKeyType !== "ed25519"
        || !verify(null, liveDisclosureSigningBytes(c), trust.publicKey, Buffer.from(proof.signature, "base64url"))) {
        return refuse("unverified-principal");
      }
      if (c.audience !== LIVE_DISCLOSURE_AUDIENCE) return refuse("wrong-audience");
      const time = now();
      if (!Number.isSafeInteger(time)) return refuse("authority-unavailable");
      if (c.issuedAt > time || c.expiresAt <= time || c.expiresAt <= c.issuedAt) return refuse("capability-expired");
      const revoked = options.isRevoked(c.id);
      if (revoked === true) return refuse("capability-revoked");
      if (revoked !== false) return refuse("authority-unavailable");
      if (!c.operations.includes(operation)) return refuse("operation-denied");
      const state = options.readState(repositoryId);
      if (!state || c.repositoryId !== repositoryId || state.repositoryId !== repositoryId
        || ["principal", "hostId", "tenant", "declarationId", "declarationRevision"].some(
          (key) => c[key as keyof LiveDisclosureClaims] !== state[key as keyof LiveDisclosureState])
        || JSON.stringify(c.authorizedRoots) !== JSON.stringify(state.authorizedRoots)
        || !nonempty(state.stateRevision)) return refuse("scope-mismatch");
      if (state.policyVersion !== c.policyVersion) return refuse("policy-changed");
      Object.freeze(c.authorizedRoots); Object.freeze(c.operations);
      return Object.freeze({ ok: true, claims: Object.freeze(c),
        state: Object.freeze({ ...state, authorizedRoots: Object.freeze([...state.authorizedRoots]) }) });
    } catch { return refuse("authority-unavailable"); }
  } };
}
