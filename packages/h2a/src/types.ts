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
  "AMENDMENT"
] as const;

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
