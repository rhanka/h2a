import type { H2AAbcModelId } from "./abc.js";

export const H2A_OBLIGATION_CADENCES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "on-event",
  "ad-hoc"
] as const;

export const H2A_RECURRING_OBLIGATION_CONFLICT_DISPOSITIONS = [
  "escalate-not-resolve"
] as const;

export type H2AObligationCadence = (typeof H2A_OBLIGATION_CADENCES)[number];
export type H2ARecurringObligationConflictDisposition =
  (typeof H2A_RECURRING_OBLIGATION_CONFLICT_DISPOSITIONS)[number];

export interface H2ARecurringObligationProfileDescriptor {
  readonly modelId: H2AAbcModelId;
  readonly label: string;
  readonly allowedCadences: readonly H2AObligationCadence[];
  readonly defaultCadence: H2AObligationCadence;
  readonly defaultGraceDays: number;
  readonly defaultReportingThresholdDays: number;
  readonly conflictDisposition: H2ARecurringObligationConflictDisposition;
  readonly rationale: string;
  readonly references: readonly string[];
}

export interface H2ARecurringObligationAuditResult {
  readonly ok: boolean;
  readonly profileId?: H2AAbcModelId;
  readonly allowedCadences?: readonly H2AObligationCadence[];
  readonly defaultCadence?: H2AObligationCadence;
  readonly defaultGraceDays?: number;
  readonly defaultReportingThresholdDays?: number;
  readonly schedulesExecutions: boolean;
  readonly issues: readonly string[];
  readonly unresolved: readonly string[];
}

export const H2A_RECURRING_OBLIGATION_PROFILES = Object.freeze({
  A_ENTERPRISE: Object.freeze({
    modelId: "A_ENTERPRISE",
    label: "A - enterprise hierarchy",
    allowedCadences: [
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "yearly",
      "on-event"
    ] as const,
    defaultCadence: "monthly",
    defaultGraceDays: 7,
    defaultReportingThresholdDays: 3,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Enterprises run a wide cadence spectrum (operational dailies up to yearly filings); monthly is the V1 default with a short grace window and an internal alert ahead of breach.",
    references: [
      "REQ-063",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-047"
    ] as const
  }),
  B_ECOSYSTEM: Object.freeze({
    modelId: "B_ECOSYSTEM",
    label: "B - peer ecosystem",
    allowedCadences: [
      "monthly",
      "quarterly",
      "yearly",
      "on-event",
      "ad-hoc"
    ] as const,
    defaultCadence: "quarterly",
    defaultGraceDays: 14,
    defaultReportingThresholdDays: 7,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Cross-organization commitments rarely sub-month; quarterly is the V1 default, with longer grace and earlier alerts to absorb partner-side scheduling.",
    references: [
      "REQ-063",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-047"
    ] as const
  }),
  C_GOVERNMENT_CITIZEN: Object.freeze({
    modelId: "C_GOVERNMENT_CITIZEN",
    label: "C - public authority ecosystem",
    allowedCadences: [
      "monthly",
      "quarterly",
      "yearly",
      "on-event"
    ] as const,
    defaultCadence: "yearly",
    defaultGraceDays: 30,
    defaultReportingThresholdDays: 15,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Citizen/administration obligations are dominated by yearly filings with explicit statutory grace; on-event covers regulatory notifications outside the calendar.",
    references: [
      "REQ-063",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-047"
    ] as const
  }),
  D_SAFE: Object.freeze({
    modelId: "D_SAFE",
    label: "D - agentic-delivery squad",
    allowedCadences: [
      "daily",
      "weekly",
      "monthly",
      "quarterly",
      "on-event"
    ] as const,
    defaultCadence: "weekly",
    defaultGraceDays: 2,
    defaultReportingThresholdDays: 1,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Agile delivery runs fast cadences: weekly/bi-weekly iterations within a quarterly PI, plus dailies; short grace and an early alert match the tight feedback loop. on-event covers PI-boundary commitments.",
    references: [
      "REQ-063",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-047",
      "DEC-080"
    ] as const
  })
} as const satisfies Record<H2AAbcModelId, H2ARecurringObligationProfileDescriptor>);

export function getRecurringObligationProfile(
  modelId: string
): H2ARecurringObligationProfileDescriptor | undefined {
  if (!Object.hasOwn(H2A_RECURRING_OBLIGATION_PROFILES, modelId)) {
    return undefined;
  }
  return H2A_RECURRING_OBLIGATION_PROFILES[modelId as H2AAbcModelId];
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
  );
}

export function auditRecurringObligationProfile(
  modelId: string
): H2ARecurringObligationAuditResult {
  const profile = getRecurringObligationProfile(modelId);
  if (!profile) {
    return {
      ok: false,
      schedulesExecutions: false,
      issues: [`unknown recurring obligation profile: ${modelId}`],
      unresolved: []
    };
  }

  const issues: string[] = [];
  const knownCadences = new Set<H2AObligationCadence>(H2A_OBLIGATION_CADENCES);

  const allowedCadences = [...profile.allowedCadences];
  const cadenceSeen = new Set(allowedCadences);
  const unknownCadences = allowedCadences.filter(
    (cadence) => !knownCadences.has(cadence)
  );

  if (unknownCadences.length > 0) {
    issues.push(`unknown obligation cadences: ${unknownCadences.join(", ")}`);
  }
  if (cadenceSeen.size !== allowedCadences.length) {
    issues.push("obligation cadences must not be duplicated");
  }
  if (allowedCadences.length === 0) {
    issues.push(
      "recurring obligation profile must declare at least one allowed cadence"
    );
  }
  if (!knownCadences.has(profile.defaultCadence)) {
    issues.push(
      `unknown default obligation cadence: ${profile.defaultCadence}`
    );
  } else if (!cadenceSeen.has(profile.defaultCadence)) {
    issues.push(
      `default obligation cadence "${profile.defaultCadence}" is not in allowedCadences`
    );
  }
  if (!isNonNegativeInteger(profile.defaultGraceDays)) {
    issues.push(
      `defaultGraceDays must be a non-negative integer, got ${String(profile.defaultGraceDays)}`
    );
  }
  if (!isNonNegativeInteger(profile.defaultReportingThresholdDays)) {
    issues.push(
      `defaultReportingThresholdDays must be a non-negative integer, got ${String(profile.defaultReportingThresholdDays)}`
    );
  }
  if (
    isNonNegativeInteger(profile.defaultGraceDays) &&
    isNonNegativeInteger(profile.defaultReportingThresholdDays) &&
    profile.defaultReportingThresholdDays > profile.defaultGraceDays
  ) {
    issues.push(
      `defaultReportingThresholdDays (${profile.defaultReportingThresholdDays}) must not exceed defaultGraceDays (${profile.defaultGraceDays})`
    );
  }
  if (profile.conflictDisposition !== "escalate-not-resolve") {
    issues.push(
      `unsupported recurring obligation conflict disposition: ${profile.conflictDisposition}`
    );
  }

  return {
    ok: issues.length === 0,
    profileId: profile.modelId,
    allowedCadences: profile.allowedCadences,
    defaultCadence: profile.defaultCadence,
    defaultGraceDays: profile.defaultGraceDays,
    defaultReportingThresholdDays: profile.defaultReportingThresholdDays,
    schedulesExecutions: false,
    issues,
    unresolved:
      issues.length === 0
        ? [
            "The profile declares cadence shape, grace, and reporting thresholds, but V1 does not schedule, fire, or evaluate obligations; runtime tracking stays in the policy layer."
          ]
        : []
  };
}
