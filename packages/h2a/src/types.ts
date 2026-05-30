import { isH2AWorkspaceRef } from "./identity.js";
import type { H2AWorkspaceRef } from "./identity.js";

export const H2A_PROTOCOL = "sentropic.h2a";
export const H2A_VERSION = "0.1";

export const H2A_ROLES = [
  "PRINCIPAL",
  "EXECUTIF",
  "CONDUCTOR",
  "AGENTS",
  "CONTROL",
  "MANDATAIRE"
] as const;

export const H2A_ARTIFACT_KINDS = [
  "CONTRACT",
  "POLICY",
  "ENGAGEMENT",
  "AMENDMENT",
  "MANDATE",
  "AUTHORITY",
  "SIGNATURE",
  "ENFORCEMENT_PLAN"
] as const;

export const H2A_POLICY_ADOPTION_MODES = [
  "ratified",
  "contractual",
  "imposed",
  "acknowledged"
] as const;

export const H2A_AUTHORITY_KINDS = ["instance", "quorum"] as const;

export const H2A_ENVELOPE_TYPES = [
  "register",
  "propose",
  "accept",
  "reject",
  "counter",
  "withdraw",
  "event",
  "escalate"
] as const;

export const H2A_NEGOTIATION_STATES = [
  "draft",
  "proposed",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
  "stabilized",
  "abandoned"
] as const;

export type H2ARole = (typeof H2A_ROLES)[number];
export type H2AArtifactKind = (typeof H2A_ARTIFACT_KINDS)[number];
export type H2APolicyAdoptionMode = (typeof H2A_POLICY_ADOPTION_MODES)[number];
export type H2AAuthorityKind = (typeof H2A_AUTHORITY_KINDS)[number];
export type H2AEnvelopeType = (typeof H2A_ENVELOPE_TYPES)[number];
export type H2ANegotiationState = (typeof H2A_NEGOTIATION_STATES)[number];

export interface H2AActorRef {
  instance: string;
  role: H2ARole;
  scope: string;
  mandate?: string;
}

export interface H2ASignature {
  by: string;
  alg: string;
  value: string;
}

export interface H2AEnvelope<TBody = unknown> {
  protocol: typeof H2A_PROTOCOL;
  version: typeof H2A_VERSION;
  id: string;
  type: H2AEnvelopeType;
  actor: H2AActorRef;
  target?: Partial<H2AActorRef>;
  artifactKind?: H2AArtifactKind;
  contractId?: string;
  policyIds?: string[];
  engagementId?: string;
  negotiationId?: string;
  baseArtifactHash?: string;
  causationId?: string;
  correlationId?: string;
  prevHash?: string;
  body: TBody;
  createdAt: string;
  signatures?: H2ASignature[];
}

export interface H2AActorRegistration {
  id: string;
  instance: string;
  roles: H2ARole[];
  scopes: string[];
  principal?: string;
  conductor?: string;
  capabilities: string[];
  endpoints: Array<{
    kind: "mcp" | "local-files" | "remote";
    uri: string;
  }>;
  publicKeys: string[];
  acceptedPolicies: string[];
  createdAt: string;
  /**
   * DEC-114 (agent-identity fix): the perennial agent UUID this registration
   * belongs to. Additive — pre-fix registrations omit it (their `id`/`instance`
   * is the legacy `host:label` address). The ed25519 keyring remains the sole
   * authority anchor; this is a stable cross-session correlation handle.
   */
  agentUuid?: string;
  /**
   * DEC-114: first-class WORKSPACE the agent was minted in (a traced place, not
   * an actor). Validated only when present.
   */
  workspace?: H2AWorkspaceRef;
  /** DEC-114: the agent's mutable display name. UX only, never a routing key. */
  name?: string;
}

export interface H2ANegotiationRecord {
  id: string;
  scope: string;
  parties: string[];
  subject: "contract" | "policy" | "engagement" | "amendment";
  status: H2ANegotiationState;
  requiredSigners: string[];
  baseArtifactHash?: string;
  currentArtifactHash?: string;
  deadline?: string;
}

export interface H2AContract {
  kind: "CONTRACT";
  id: string;
  parties: string[];
  scope: string;
  clauses: unknown[];
  policies: string[];
  engagements: string[];
  signatures: H2ASignature[];
  baseArtifactHash?: string;
  obligations?: unknown[];
  rights?: unknown[];
  references?: string[];
  createdAt?: string;
}

export interface H2APolicy {
  kind: "POLICY";
  id: string;
  scope: string;
  rule: string;
  sourceAuthority: string;
  adoptionMode: H2APolicyAdoptionMode;
  version?: string;
  parameters?: Record<string, unknown>;
  references?: string[];
}

export interface H2AEngagement {
  kind: "ENGAGEMENT";
  id: string;
  scope: string;
  charter: Record<string, unknown>;
  roleBindings: Array<{
    role: H2ARole;
    instance: string;
    binding?: string;
  }>;
  controls: string[];
  policies: string[];
  successCriteria: unknown[];
  contractId?: string;
  amendments?: string[];
  status?: H2ANegotiationState;
  /**
   * VALEUR (EVO-9). Optional id of the **downstream** engagement this one feeds
   * — the next link in the value chain. Additive: the chain is derived by `aval`
   * traversal (`deriveValueChain`), never stored as an object. Must not collide
   * with the CONTRACT/POLICY field profiles (passes the collapse-guard).
   */
  aval?: string;
  /**
   * VALEUR (EVO-9). Optional name of the **upstream** finalité this engagement
   * serves — the *linkable, named finalité* the INTENTION/`successCriteria`
   * already express, made explicit so the value chain reads end-to-end.
   */
  finaliteAmont?: string;
}

export interface H2AAmendment {
  kind: "AMENDMENT";
  id: string;
  targetKind: H2AArtifactKind;
  targetId: string;
  baseArtifactHash: string;
  changes: Array<{
    op: string;
    path: string;
    value?: unknown;
  }>;
  signatures: H2ASignature[];
  reason?: string;
  createdAt?: string;
}

export interface H2AMandate {
  kind: "MANDATE";
  id: string;
  instance: string;
  role: H2ARole;
  scope: string;
  rights: string[];
  authorityId?: string;
  expiresAt?: string;
  conditions?: Record<string, unknown>;
}

export interface H2AAuthority {
  kind: "AUTHORITY";
  id: string;
  authorityKind: H2AAuthorityKind;
  members: string[];
  threshold?: number;
  scope?: string;
}

export interface H2AEnforcementPlan {
  kind: "ENFORCEMENT_PLAN";
  id: string;
  scope: string;
  controls: Array<{
    domain: string;
    instance: string;
    rights?: string[];
  }>;
  escalations: Array<{
    trigger: string;
    target: string;
    channel?: "advise" | "decide" | "alert";
    scope?: string;
    authorityKind?:
      | "PRINCIPAL"
      | "EXECUTIF"
      | "QUORUM"
      | "CONTROL"
      | "EXTERNAL_AUTHORITY"
      | "RECOURSE";
    domain?: string;
  }>;
  triggers: Array<{
    name: string;
    condition: string;
  }>;
  references?: string[];
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * DEC-114: structural guard for `H2AActorRegistration`. The store has always
 * appended whatever JSON it was handed; this guard lets the registration path
 * validate the additive identity fields **when present** while keeping every
 * pre-fix record valid (the new fields are all optional). It checks the
 * already-required core fields plus `agentUuid?` / `workspace?` / `name?`.
 */
export function isH2AActorRegistration(
  value: unknown
): value is H2AActorRegistration {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.instance !== "string" || v.instance.length === 0) return false;
  if (!Array.isArray(v.roles)) return false;
  if (!isStringList(v.scopes)) return false;
  if (!isStringList(v.capabilities)) return false;
  if (!Array.isArray(v.endpoints)) return false;
  if (!isStringList(v.publicKeys)) return false;
  if (!isStringList(v.acceptedPolicies)) return false;
  if (typeof v.createdAt !== "string") return false;
  if (v.principal !== undefined && typeof v.principal !== "string") return false;
  if (v.conductor !== undefined && typeof v.conductor !== "string") return false;
  if (v.agentUuid !== undefined && typeof v.agentUuid !== "string") return false;
  if (v.workspace !== undefined && !isH2AWorkspaceRef(v.workspace)) return false;
  if (v.name !== undefined && typeof v.name !== "string") return false;
  return true;
}
