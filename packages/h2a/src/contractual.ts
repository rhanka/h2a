import {
  isContract,
  isEngagement,
  isPolicy
} from "./artifacts.js";
import type {
  H2AContract,
  H2AEngagement,
  H2APolicy
} from "./types.js";

export type H2AContractualArtifactKind = "CONTRACT" | "POLICY" | "ENGAGEMENT";

export type H2AContractualArtifact =
  | H2AContract
  | H2APolicy
  | H2AEngagement;

export type H2AContractualArtifactProfile =
  | "normative-container"
  | "durable-rule"
  | "operational-executable";

export interface H2AContractualArtifactProfileDescriptor {
  readonly kind: H2AContractualArtifactKind;
  readonly profile: H2AContractualArtifactProfile;
  readonly durable: boolean;
  readonly executable: boolean;
  readonly canContainPolicies: boolean;
  readonly canReferencePolicies: boolean;
  readonly canInstantiateEngagements: boolean;
}

export interface H2AContractualArtifactAuditResult {
  readonly ok: boolean;
  readonly kind?: string;
  readonly profile?: H2AContractualArtifactProfile;
  readonly issues: readonly string[];
}

export const H2A_CONTRACTUAL_ARTIFACT_PROFILES = Object.freeze({
  CONTRACT: Object.freeze({
    kind: "CONTRACT",
    profile: "normative-container",
    durable: true,
    executable: false,
    canContainPolicies: true,
    canReferencePolicies: true,
    canInstantiateEngagements: true
  }),
  POLICY: Object.freeze({
    kind: "POLICY",
    profile: "durable-rule",
    durable: true,
    executable: false,
    canContainPolicies: false,
    canReferencePolicies: false,
    canInstantiateEngagements: false
  }),
  ENGAGEMENT: Object.freeze({
    kind: "ENGAGEMENT",
    profile: "operational-executable",
    durable: false,
    executable: true,
    canContainPolicies: false,
    canReferencePolicies: true,
    canInstantiateEngagements: false
  })
} as const satisfies Record<
  H2AContractualArtifactKind,
  H2AContractualArtifactProfileDescriptor
>);

const CONTRACTUAL_KINDS = Object.keys(
  H2A_CONTRACTUAL_ARTIFACT_PROFILES
) as H2AContractualArtifactKind[];

const POLICY_FIELDS = [
  "rule",
  "sourceAuthority",
  "adoptionMode",
  "parameters"
] as const;

const CONTRACT_FIELDS = [
  "parties",
  "clauses",
  "engagements",
  "signatures",
  "obligations",
  "rights"
] as const;

const ENGAGEMENT_FIELDS = [
  "charter",
  "roleBindings",
  "controls",
  "successCriteria",
  "contractId",
  "amendments",
  "status"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): string[] {
  return fields.filter((field) =>
    Object.prototype.hasOwnProperty.call(value, field)
  );
}

function addCollapseIssue(
  issues: string[],
  kind: H2AContractualArtifactKind,
  collapsedKind: H2AContractualArtifactKind,
  fields: readonly string[],
  value: Record<string, unknown>
): void {
  const present = ownFields(value, fields);
  if (present.length === 0) return;
  issues.push(
    `${kind} must not carry ${collapsedKind} fields: ${present.join(", ")}`
  );
}

export function getContractualArtifactProfile(
  kind: string
): H2AContractualArtifactProfileDescriptor | undefined {
  if (!CONTRACTUAL_KINDS.includes(kind as H2AContractualArtifactKind)) {
    return undefined;
  }
  return H2A_CONTRACTUAL_ARTIFACT_PROFILES[
    kind as H2AContractualArtifactKind
  ];
}

export function auditContractualArtifact(
  value: unknown
): H2AContractualArtifactAuditResult {
  if (!isRecord(value)) {
    return { ok: false, issues: ["value is not an object"] };
  }

  const kind = typeof value.kind === "string" ? value.kind : undefined;
  if (!kind) {
    return { ok: false, issues: ["value.kind is required"] };
  }

  const descriptor = getContractualArtifactProfile(kind);
  if (!descriptor) {
    return {
      ok: false,
      kind,
      issues: [
        `${kind} is not a contractual artifact kind (expected CONTRACT, POLICY, ENGAGEMENT)`
      ]
    };
  }

  const issues: string[] = [];
  if (descriptor.kind === "CONTRACT" && !isContract(value)) {
    issues.push("CONTRACT is not structurally valid");
  }
  if (descriptor.kind === "POLICY" && !isPolicy(value)) {
    issues.push("POLICY is not structurally valid");
  }
  if (descriptor.kind === "ENGAGEMENT" && !isEngagement(value)) {
    issues.push("ENGAGEMENT is not structurally valid");
  }

  if (descriptor.kind === "CONTRACT") {
    addCollapseIssue(issues, "CONTRACT", "POLICY", POLICY_FIELDS, value);
    addCollapseIssue(issues, "CONTRACT", "ENGAGEMENT", ENGAGEMENT_FIELDS, value);
  } else if (descriptor.kind === "POLICY") {
    addCollapseIssue(issues, "POLICY", "CONTRACT", CONTRACT_FIELDS, value);
    addCollapseIssue(issues, "POLICY", "ENGAGEMENT", ENGAGEMENT_FIELDS, value);
  } else {
    addCollapseIssue(issues, "ENGAGEMENT", "CONTRACT", CONTRACT_FIELDS, value);
    addCollapseIssue(issues, "ENGAGEMENT", "POLICY", POLICY_FIELDS, value);
  }

  return {
    ok: issues.length === 0,
    kind: descriptor.kind,
    profile: descriptor.profile,
    issues
  };
}

export function assertContractualArtifactInvariants(
  value: unknown
): asserts value is H2AContractualArtifact {
  const result = auditContractualArtifact(value);
  if (!result.ok) {
    throw new Error(
      `Contractual artifact invariant violation: ${result.issues.join("; ")}`
    );
  }
}
