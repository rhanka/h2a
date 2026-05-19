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
  }>;
  triggers: Array<{
    name: string;
    condition: string;
  }>;
  references?: string[];
}
