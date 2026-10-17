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
export interface LiveDisclosureOptions {
  readonly auth: LiveDisclosureAuth;
  readonly now?: () => number;
  /** Must durably append synchronously or throw; unavailable audit denies emission. */
  readonly audit?: (event: DisclosureAuditEvent) => void;
  readonly loadEvidence: (ids: readonly string[]) => Promise<readonly LiveDisclosureEvidence[]>;
  /** Current host L4b exclusion policy. Absence/incompatibility never falls back. */
  readonly contentPolicy?: () => Readonly<{
    version: string; allows(evidence: LiveDisclosureEvidence): boolean;
  }> | undefined;
  readonly transport: (providerId: string) => LiveExternalTransport | undefined;
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
const protectedPath = (p: string): boolean => p.split("/").some((part) =>
  /^\.env/i.test(part) || /^\.ssh$/i.test(part) || /^(id_(rsa|dsa|ecdsa|ed25519)|credentials)(\.|$)/i.test(part)
  || /\.(pem|key|p12|pfx)$/i.test(part));
// Defence in depth; the current L4b policy remains mandatory. This cannot
// establish the absence of unknown secrets, nor override withheld provenance.
const containsKnownSecret = (text: string): boolean =>
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{20,})/.test(text);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

