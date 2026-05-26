import type { H2AAbcModelId } from "./abc.js";
import {
  H2A_ESCALATION_AUTHORITY_KINDS,
  type H2AEscalationAuthorityKind
} from "./escalation.js";

export const H2A_RECOURSE_STATES = [
  "requested",
  "accepted",
  "dismissed",
  "adjudicating",
  "decided",
  "appealed",
  "closed"
] as const;

export const H2A_RECOURSE_CONFLICT_DISPOSITIONS = [
  "escalate-not-resolve"
] as const;

export type H2ARecourseState = (typeof H2A_RECOURSE_STATES)[number];
export type H2ARecourseConflictDisposition =
  (typeof H2A_RECOURSE_CONFLICT_DISPOSITIONS)[number];

export interface H2ARecourseProfileDescriptor {
  readonly modelId: H2AAbcModelId;
  readonly label: string;
  readonly allowedStates: readonly H2ARecourseState[];
  readonly allowedDeciderKinds: readonly H2AEscalationAuthorityKind[];
  readonly defaultDeciderKind: H2AEscalationAuthorityKind;
  readonly appealable: boolean;
  readonly conflictDisposition: H2ARecourseConflictDisposition;
  readonly rationale: string;
  readonly references: readonly string[];
}

export interface H2ARecourseAuditResult {
  readonly ok: boolean;
  readonly profileId?: H2AAbcModelId;
  readonly allowedStates?: readonly H2ARecourseState[];
  readonly allowedDeciderKinds?: readonly H2AEscalationAuthorityKind[];
  readonly defaultDeciderKind?: H2AEscalationAuthorityKind;
  readonly appealable?: boolean;
  readonly adjudicatesDecisions: boolean;
  readonly issues: readonly string[];
  readonly unresolved: readonly string[];
}

const FULL_LIFECYCLE = H2A_RECOURSE_STATES;

export const H2A_RECOURSE_PROFILES = Object.freeze({
  A_ENTERPRISE: Object.freeze({
    modelId: "A_ENTERPRISE",
    label: "A - enterprise hierarchy",
    allowedStates: FULL_LIFECYCLE,
    allowedDeciderKinds: [
      "PRINCIPAL",
      "CONTROL",
      "EXTERNAL_AUTHORITY"
    ] as const,
    defaultDeciderKind: "PRINCIPAL",
    appealable: true,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Enterprise recourse defaults to PRINCIPAL adjudication; CONTROL handles domain-specific recourse (compliance, ethics, legal) and EXTERNAL_AUTHORITY (regulator, court) keeps the appeal path open.",
    references: [
      "REQ-068",
      "REQ-069",
      "REQ-071",
      "DEC-040",
      "DEC-041",
      "DEC-043",
      "DEC-046"
    ] as const
  }),
  B_ECOSYSTEM: Object.freeze({
    modelId: "B_ECOSYSTEM",
    label: "B - peer ecosystem",
    allowedStates: FULL_LIFECYCLE,
    allowedDeciderKinds: [
      "QUORUM",
      "EXTERNAL_AUTHORITY",
      "RECOURSE"
    ] as const,
    defaultDeciderKind: "QUORUM",
    appealable: true,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Peer ecosystems route recourse to a quorum of stakeholders by default; EXTERNAL_AUTHORITY covers arbitration and RECOURSE captures dedicated inter-org recourse bodies.",
    references: [
      "REQ-068",
      "REQ-069",
      "REQ-071",
      "DEC-040",
      "DEC-041",
      "DEC-043",
      "DEC-046"
    ] as const
  }),
  C_GOVERNMENT_CITIZEN: Object.freeze({
    modelId: "C_GOVERNMENT_CITIZEN",
    label: "C - public authority ecosystem",
    allowedStates: FULL_LIFECYCLE,
    allowedDeciderKinds: [
      "EXTERNAL_AUTHORITY",
      "RECOURSE",
      "PRINCIPAL"
    ] as const,
    defaultDeciderKind: "EXTERNAL_AUTHORITY",
    appealable: true,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Public-authority recourse defaults to EXTERNAL_AUTHORITY (court, regulator) with dedicated RECOURSE bodies for administrative review; PRINCIPAL remains usable for internal-administration steps before the external chain.",
    references: [
      "REQ-068",
      "REQ-069",
      "REQ-071",
      "DEC-040",
      "DEC-041",
      "DEC-043",
      "DEC-046"
    ] as const
  }),
  D_SAFE: Object.freeze({
    modelId: "D_SAFE",
    label: "D - agentic-delivery squad",
    allowedStates: FULL_LIFECYCLE,
    allowedDeciderKinds: [
      "PRINCIPAL",
      "CONTROL",
      "EXTERNAL_AUTHORITY"
    ] as const,
    defaultDeciderKind: "PRINCIPAL",
    appealable: true,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Delivery disputes resolve at the owning PRINCIPAL (epic/product); CONTROL handles architecture/security/compliance recourse; EXTERNAL_AUTHORITY keeps the contracting-firm dispute/arbitration path open.",
    references: [
      "REQ-068",
      "REQ-069",
      "REQ-071",
      "DEC-040",
      "DEC-041",
      "DEC-043",
      "DEC-046",
      "DEC-080"
    ] as const
  })
} as const satisfies Record<H2AAbcModelId, H2ARecourseProfileDescriptor>);

export function getRecourseProfile(
  modelId: string
): H2ARecourseProfileDescriptor | undefined {
  if (!Object.hasOwn(H2A_RECOURSE_PROFILES, modelId)) {
    return undefined;
  }
  return H2A_RECOURSE_PROFILES[modelId as H2AAbcModelId];
}

export function auditRecourseProfile(
  modelId: string
): H2ARecourseAuditResult {
  const profile = getRecourseProfile(modelId);
  if (!profile) {
    return {
      ok: false,
      adjudicatesDecisions: false,
      issues: [`unknown recourse profile: ${modelId}`],
      unresolved: []
    };
  }

  const issues: string[] = [];
  const knownStates = new Set<H2ARecourseState>(H2A_RECOURSE_STATES);
  const knownDeciders = new Set<H2AEscalationAuthorityKind>(
    H2A_ESCALATION_AUTHORITY_KINDS
  );

  const allowedStates = [...profile.allowedStates];
  const stateSeen = new Set(allowedStates);
  const unknownStates = allowedStates.filter((state) => !knownStates.has(state));

  if (unknownStates.length > 0) {
    issues.push(`unknown recourse states: ${unknownStates.join(", ")}`);
  }
  if (stateSeen.size !== allowedStates.length) {
    issues.push("recourse states must not be duplicated");
  }
  if (allowedStates.length === 0) {
    issues.push("recourse profile must declare at least one allowed state");
  }
  if (!stateSeen.has("requested")) {
    issues.push("recourse profile must include the `requested` initial state");
  }
  if (!stateSeen.has("decided") && !stateSeen.has("dismissed")) {
    issues.push(
      "recourse profile must include at least one terminal-or-final state (`decided` or `dismissed`)"
    );
  }

  const allowedDeciderKinds = [...profile.allowedDeciderKinds];
  const deciderSeen = new Set(allowedDeciderKinds);
  const unknownDeciders = allowedDeciderKinds.filter(
    (kind) => !knownDeciders.has(kind)
  );

  if (unknownDeciders.length > 0) {
    issues.push(`unknown recourse decider kinds: ${unknownDeciders.join(", ")}`);
  }
  if (deciderSeen.size !== allowedDeciderKinds.length) {
    issues.push("recourse decider kinds must not be duplicated");
  }
  if (allowedDeciderKinds.length === 0) {
    issues.push(
      "recourse profile must declare at least one allowed decider kind"
    );
  }
  if (!knownDeciders.has(profile.defaultDeciderKind)) {
    issues.push(
      `unknown default recourse decider kind: ${profile.defaultDeciderKind}`
    );
  } else if (!deciderSeen.has(profile.defaultDeciderKind)) {
    issues.push(
      `default recourse decider "${profile.defaultDeciderKind}" is not in allowedDeciderKinds`
    );
  }

  if (profile.appealable && !stateSeen.has("appealed")) {
    issues.push(
      "appealable recourse profile must include the `appealed` state"
    );
  }

  if (profile.conflictDisposition !== "escalate-not-resolve") {
    issues.push(
      `unsupported recourse conflict disposition: ${profile.conflictDisposition}`
    );
  }

  return {
    ok: issues.length === 0,
    profileId: profile.modelId,
    allowedStates: profile.allowedStates,
    allowedDeciderKinds: profile.allowedDeciderKinds,
    defaultDeciderKind: profile.defaultDeciderKind,
    appealable: profile.appealable,
    adjudicatesDecisions: false,
    issues,
    unresolved:
      issues.length === 0
        ? [
            "The profile declares lifecycle states and allowed deciders, but V1 does not adjudicate; the decision itself is produced outside the protocol by the declared authority."
          ]
        : []
  };
}
