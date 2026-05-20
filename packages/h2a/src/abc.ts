import {
  H2A_ARTIFACT_KINDS,
  H2A_POLICY_ADOPTION_MODES,
  H2A_ROLES,
  type H2AArtifactKind,
  type H2APolicyAdoptionMode,
  type H2ARole
} from "./types.js";
import {
  H2A_ESCALATION_AUTHORITY_KINDS,
  type H2AEscalationAuthorityKind
} from "./escalation.js";

export const H2A_ABC_MODEL_IDS = [
  "A_ENTERPRISE",
  "B_ECOSYSTEM",
  "C_GOVERNMENT_CITIZEN"
] as const;

export const H2A_ABC_MODEL_CAPABILITIES = [
  "scope-first-class",
  "policy-first-class",
  "contract-engagement-separation",
  "mandated-signature",
  "deterministic-negotiation",
  "scope-authority-escalation",
  "external-authority",
  "controlled-disclosure",
  "policy-precedence",
  "recurring-obligations",
  "recourse",
  "jurisdiction"
] as const;

export type H2AAbcModelId = (typeof H2A_ABC_MODEL_IDS)[number];
export type H2AAbcTrack = "A" | "B" | "C";
export type H2AAbcTopology =
  | "enterprise-hierarchy"
  | "peer-federation"
  | "public-authority";
export type H2AAbcModelCapability =
  (typeof H2A_ABC_MODEL_CAPABILITIES)[number];
export type H2AAbcModelCapabilityStatus =
  | "shipped"
  | "partial"
  | "deferred";

export interface H2AAbcModelCapabilityDescriptor {
  readonly capability: H2AAbcModelCapability;
  readonly status: H2AAbcModelCapabilityStatus;
  readonly evidence: string;
  readonly gap?: string;
}

export interface H2AAbcModelProfileDescriptor {
  readonly id: H2AAbcModelId;
  readonly track: H2AAbcTrack;
  readonly label: string;
  readonly topology: H2AAbcTopology;
  readonly requiredRoles: readonly H2ARole[];
  readonly requiredArtifactKinds: readonly H2AArtifactKind[];
  readonly requiredPolicyAdoptionModes: readonly H2APolicyAdoptionMode[];
  readonly escalationAuthorityKinds: readonly H2AEscalationAuthorityKind[];
  readonly capabilities: readonly H2AAbcModelCapabilityDescriptor[];
}

export interface H2AAbcModelCompatibilityResult {
  readonly ok: boolean;
  readonly ready: boolean;
  readonly modelId?: H2AAbcModelId;
  readonly label?: string;
  readonly issues: readonly string[];
  readonly gaps: readonly string[];
  readonly shipped: readonly H2AAbcModelCapability[];
  readonly partial: readonly H2AAbcModelCapability[];
  readonly deferred: readonly H2AAbcModelCapability[];
}

const ALL_ARTIFACTS = [
  "CONTRACT",
  "POLICY",
  "ENGAGEMENT",
  "MANDATE",
  "AUTHORITY",
  "SIGNATURE",
  "ENFORCEMENT_PLAN"
] as const satisfies readonly H2AArtifactKind[];

const ALL_ROLES = [
  "PRINCIPAL",
  "EXECUTIF",
  "CONDUCTOR",
  "AGENTS",
  "CONTROL",
  "MANDATAIRE"
] as const satisfies readonly H2ARole[];

const ALL_SCOPE_AUTHORITIES = [
  "PRINCIPAL",
  "EXECUTIF",
  "QUORUM",
  "CONTROL",
  "EXTERNAL_AUTHORITY",
  "RECOURSE"
] as const satisfies readonly H2AEscalationAuthorityKind[];

const ALL_POLICY_ADOPTION_MODES = [
  "ratified",
  "contractual",
  "imposed",
  "acknowledged"
] as const satisfies readonly H2APolicyAdoptionMode[];

const CONSENSUAL_POLICY_ADOPTION_MODES = [
  "ratified",
  "contractual",
  "acknowledged"
] as const satisfies readonly H2APolicyAdoptionMode[];

const PUBLIC_POLICY_ADOPTION_MODES = [
  "imposed",
  "acknowledged",
  "ratified"
] as const satisfies readonly H2APolicyAdoptionMode[];

const BASE_SHIPPED_CAPABILITIES = [
  {
    capability: "scope-first-class",
    status: "shipped",
    evidence: "roles, artifacts, negotiations, and escalations carry scope"
  },
  {
    capability: "policy-first-class",
    status: "shipped",
    evidence: "POLICY is a core artifact with adoption mode and source authority"
  },
  {
    capability: "contract-engagement-separation",
    status: "shipped",
    evidence: "DEC-039 contractual artifact profiles are executable"
  },
  {
    capability: "mandated-signature",
    status: "shipped",
    evidence: "MANDATE/AUTHORITY/SIGNATURE are core artifacts and signing matrix is enforced"
  },
  {
    capability: "deterministic-negotiation",
    status: "shipped",
    evidence: "NEGOTIATION ledger, canonical hashes, signatures, and stabilization are implemented"
  },
  {
    capability: "scope-authority-escalation",
    status: "shipped",
    evidence: "DEC-040 resolves escalation target by scope/channel/trigger/domain"
  },
  {
    capability: "external-authority",
    status: "shipped",
    evidence: "DEC-040 exposes EXTERNAL_AUTHORITY as an escalation authority kind"
  }
] as const satisfies readonly H2AAbcModelCapabilityDescriptor[];

export const H2A_ABC_MODEL_PROFILES = Object.freeze({
  A_ENTERPRISE: Object.freeze({
    id: "A_ENTERPRISE",
    track: "A",
    label: "A - traditional enterprise",
    topology: "enterprise-hierarchy",
    requiredRoles: ALL_ROLES,
    requiredArtifactKinds: ALL_ARTIFACTS,
    requiredPolicyAdoptionModes: ALL_POLICY_ADOPTION_MODES,
    escalationAuthorityKinds: ALL_SCOPE_AUTHORITIES,
    capabilities: [
      ...BASE_SHIPPED_CAPABILITIES,
      {
        capability: "controlled-disclosure",
        status: "partial",
        evidence: "CONTROL roles and evidence hashes exist",
        gap: "controlled disclosure still lacks standard redaction/evidence-package limits"
      },
      {
        capability: "recurring-obligations",
        status: "partial",
        evidence: "CONTRACT can carry obligations and ENGAGEMENT can execute work",
        gap: "recurring obligations are identified but not yet a first-class schedule/schema"
      },
      {
        capability: "recourse",
        status: "partial",
        evidence: "RECOURSE is an escalation authority kind",
        gap: "recourse has routing vocabulary but no adjudication lifecycle"
      },
      {
        capability: "policy-precedence",
        status: "deferred",
        evidence: "policy conflicts can be escalated",
        gap: "policy precedence is not yet resolved by a V1 engine"
      }
    ] as const
  }),
  B_ECOSYSTEM: Object.freeze({
    id: "B_ECOSYSTEM",
    track: "B",
    label: "B - multi-organization ecosystem",
    topology: "peer-federation",
    requiredRoles: ALL_ROLES,
    requiredArtifactKinds: ALL_ARTIFACTS,
    requiredPolicyAdoptionModes: CONSENSUAL_POLICY_ADOPTION_MODES,
    escalationAuthorityKinds: ALL_SCOPE_AUTHORITIES,
    capabilities: [
      ...BASE_SHIPPED_CAPABILITIES,
      {
        capability: "controlled-disclosure",
        status: "partial",
        evidence: "hashes and references can support evidence packages",
        gap: "controlled disclosure across partners lacks a standard evidence-package profile"
      },
      {
        capability: "recourse",
        status: "partial",
        evidence: "RECOURSE and QUORUM targets can be declared in ENFORCEMENT_PLAN",
        gap: "recourse/deadlock handling is routable but not procedurally specified"
      },
      {
        capability: "policy-precedence",
        status: "deferred",
        evidence: "conflicts can block signatures or escalate",
        gap: "policy precedence across peer organizations is not yet resolved by a V1 engine"
      }
    ] as const
  }),
  C_GOVERNMENT_CITIZEN: Object.freeze({
    id: "C_GOVERNMENT_CITIZEN",
    track: "C",
    label: "C - government and citizen ecosystem",
    topology: "public-authority",
    requiredRoles: ALL_ROLES,
    requiredArtifactKinds: ALL_ARTIFACTS,
    requiredPolicyAdoptionModes: PUBLIC_POLICY_ADOPTION_MODES,
    escalationAuthorityKinds: ALL_SCOPE_AUTHORITIES,
    capabilities: [
      ...BASE_SHIPPED_CAPABILITIES,
      {
        capability: "recourse",
        status: "partial",
        evidence: "RECOURSE is a first-class escalation authority kind",
        gap: "recourse routing exists but appeal/adjudication lifecycle remains open"
      },
      {
        capability: "jurisdiction",
        status: "partial",
        evidence: "scope can encode territorial or sectoral boundaries",
        gap: "jurisdiction is represented by scope strings, not yet by a structured schema"
      },
      {
        capability: "controlled-disclosure",
        status: "partial",
        evidence: "hashes and references can support minimized proofs",
        gap: "controlled disclosure for public authority evidence is not yet standardized"
      },
      {
        capability: "policy-precedence",
        status: "deferred",
        evidence: "imposed policies and external authorities are representable",
        gap: "policy precedence between public law, contracts, and local policies is unresolved"
      }
    ] as const
  })
} as const satisfies Record<H2AAbcModelId, H2AAbcModelProfileDescriptor>);

function missingValues<T extends string>(
  values: readonly T[],
  allowed: readonly T[]
): string[] {
  return values.filter((value) => !allowed.includes(value));
}

function collectByStatus(
  capabilities: readonly H2AAbcModelCapabilityDescriptor[],
  status: H2AAbcModelCapabilityStatus
): H2AAbcModelCapability[] {
  return capabilities
    .filter((entry) => entry.status === status)
    .map((entry) => entry.capability);
}

export function getAbcModelProfile(
  modelId: string
): H2AAbcModelProfileDescriptor | undefined {
  if (!H2A_ABC_MODEL_IDS.includes(modelId as H2AAbcModelId)) {
    return undefined;
  }
  return H2A_ABC_MODEL_PROFILES[modelId as H2AAbcModelId];
}

export function auditAbcModelCompatibility(
  modelId: string
): H2AAbcModelCompatibilityResult {
  const profile = getAbcModelProfile(modelId);
  if (!profile) {
    return {
      ok: false,
      ready: false,
      issues: [`unknown ABC model: ${modelId}`],
      gaps: [],
      shipped: [],
      partial: [],
      deferred: []
    };
  }

  const issues: string[] = [];
  const missingRoles = missingValues(profile.requiredRoles, H2A_ROLES);
  const missingArtifacts = missingValues(
    profile.requiredArtifactKinds,
    H2A_ARTIFACT_KINDS
  );
  const missingAdoptionModes = missingValues(
    profile.requiredPolicyAdoptionModes,
    H2A_POLICY_ADOPTION_MODES
  );
  const missingAuthorityKinds = missingValues(
    profile.escalationAuthorityKinds,
    H2A_ESCALATION_AUTHORITY_KINDS
  );
  const missingCapabilities = missingValues(
    profile.capabilities.map((entry) => entry.capability),
    H2A_ABC_MODEL_CAPABILITIES
  );

  if (missingRoles.length > 0) {
    issues.push(`unknown roles: ${missingRoles.join(", ")}`);
  }
  if (missingArtifacts.length > 0) {
    issues.push(`unknown artifact kinds: ${missingArtifacts.join(", ")}`);
  }
  if (missingAdoptionModes.length > 0) {
    issues.push(`unknown policy adoption modes: ${missingAdoptionModes.join(", ")}`);
  }
  if (missingAuthorityKinds.length > 0) {
    issues.push(`unknown escalation authority kinds: ${missingAuthorityKinds.join(", ")}`);
  }
  if (missingCapabilities.length > 0) {
    issues.push(`unknown ABC capabilities: ${missingCapabilities.join(", ")}`);
  }

  const shipped = collectByStatus(profile.capabilities, "shipped");
  const partial = collectByStatus(profile.capabilities, "partial");
  const deferred = collectByStatus(profile.capabilities, "deferred");
  const gaps = profile.capabilities
    .filter((entry) => entry.status !== "shipped")
    .map((entry) => `${entry.capability}: ${entry.gap ?? entry.evidence}`);

  return {
    ok: issues.length === 0,
    ready: issues.length === 0 && partial.length === 0 && deferred.length === 0,
    modelId: profile.id,
    label: profile.label,
    issues,
    gaps,
    shipped,
    partial,
    deferred
  };
}
