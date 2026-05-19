import {
  H2A_ARTIFACT_KINDS,
  H2A_AUTHORITY_KINDS,
  H2A_POLICY_ADOPTION_MODES,
  H2A_ROLES,
  type H2AAmendment,
  type H2AArtifactKind,
  type H2AAuthority,
  type H2AContract,
  type H2AEnforcementPlan,
  type H2AEngagement,
  type H2AMandate,
  type H2APolicy,
  type H2ARole,
  type H2ASignature
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isArrayOf<T>(value: unknown, check: (entry: unknown) => entry is T): value is T[] {
  return Array.isArray(value) && value.every((entry) => check(entry));
}

function isRole(value: unknown): value is H2ARole {
  return typeof value === "string" && H2A_ROLES.includes(value as H2ARole);
}

function isArtifactKind(value: unknown): value is H2AArtifactKind {
  return typeof value === "string" && H2A_ARTIFACT_KINDS.includes(value as H2AArtifactKind);
}

export function isSignature(value: unknown): value is H2ASignature {
  return (
    isRecord(value) &&
    typeof value.by === "string" &&
    typeof value.alg === "string" &&
    typeof value.value === "string"
  );
}

export function isContract(value: unknown): value is H2AContract {
  if (!isRecord(value)) return false;
  return (
    value.kind === "CONTRACT" &&
    typeof value.id === "string" &&
    isStringArray(value.parties) &&
    typeof value.scope === "string" &&
    Array.isArray(value.clauses) &&
    isStringArray(value.policies) &&
    isStringArray(value.engagements) &&
    isArrayOf(value.signatures, isSignature)
  );
}

export function isPolicy(value: unknown): value is H2APolicy {
  if (!isRecord(value)) return false;
  return (
    value.kind === "POLICY" &&
    typeof value.id === "string" &&
    typeof value.scope === "string" &&
    typeof value.rule === "string" &&
    typeof value.sourceAuthority === "string" &&
    typeof value.adoptionMode === "string" &&
    H2A_POLICY_ADOPTION_MODES.includes(
      value.adoptionMode as (typeof H2A_POLICY_ADOPTION_MODES)[number]
    )
  );
}

export function isEngagement(value: unknown): value is H2AEngagement {
  if (!isRecord(value)) return false;
  if (value.kind !== "ENGAGEMENT") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.scope !== "string") return false;
  if (!isRecord(value.charter)) return false;
  if (!Array.isArray(value.roleBindings)) return false;
  for (const binding of value.roleBindings) {
    if (!isRecord(binding)) return false;
    if (!isRole(binding.role)) return false;
    if (typeof binding.instance !== "string") return false;
  }
  return (
    isStringArray(value.controls) &&
    isStringArray(value.policies) &&
    Array.isArray(value.successCriteria)
  );
}

export function isAmendment(value: unknown): value is H2AAmendment {
  if (!isRecord(value)) return false;
  if (value.kind !== "AMENDMENT") return false;
  if (typeof value.id !== "string") return false;
  if (!isArtifactKind(value.targetKind)) return false;
  if (typeof value.targetId !== "string") return false;
  if (typeof value.baseArtifactHash !== "string") return false;
  if (!Array.isArray(value.changes)) return false;
  for (const change of value.changes) {
    if (!isRecord(change)) return false;
    if (typeof change.op !== "string") return false;
    if (typeof change.path !== "string") return false;
  }
  return isArrayOf(value.signatures, isSignature);
}

export function isMandate(value: unknown): value is H2AMandate {
  if (!isRecord(value)) return false;
  return (
    value.kind === "MANDATE" &&
    typeof value.id === "string" &&
    typeof value.instance === "string" &&
    isRole(value.role) &&
    typeof value.scope === "string" &&
    isStringArray(value.rights)
  );
}

export function isAuthority(value: unknown): value is H2AAuthority {
  if (!isRecord(value)) return false;
  if (value.kind !== "AUTHORITY") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.authorityKind !== "string") return false;
  if (
    !H2A_AUTHORITY_KINDS.includes(
      value.authorityKind as (typeof H2A_AUTHORITY_KINDS)[number]
    )
  ) {
    return false;
  }
  if (!isStringArray(value.members)) return false;
  if (value.authorityKind === "quorum") {
    if (typeof value.threshold !== "number") return false;
    if (!Number.isInteger(value.threshold) || value.threshold < 1) return false;
    if (value.threshold > value.members.length) return false;
  }
  return true;
}

export function isEnforcementPlan(value: unknown): value is H2AEnforcementPlan {
  if (!isRecord(value)) return false;
  if (value.kind !== "ENFORCEMENT_PLAN") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.scope !== "string") return false;
  if (!Array.isArray(value.controls)) return false;
  if (!Array.isArray(value.escalations)) return false;
  if (!Array.isArray(value.triggers)) return false;
  return true;
}
