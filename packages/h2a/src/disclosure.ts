import type { H2AAbcModelId } from "./abc.js";

export const H2A_DISCLOSURE_MODES = [
  "denied",
  "hash-only",
  "attestation",
  "evidence-package",
  "redacted-view",
  "full-view"
] as const;

export const H2A_DISCLOSURE_CONFLICT_DISPOSITIONS = [
  "escalate-not-resolve"
] as const;

export type H2ADisclosureMode = (typeof H2A_DISCLOSURE_MODES)[number];
export type H2ADisclosureConflictDisposition =
  (typeof H2A_DISCLOSURE_CONFLICT_DISPOSITIONS)[number];

export interface H2ADisclosureProfileDescriptor {
  readonly modelId: H2AAbcModelId;
  readonly label: string;
  readonly allowedModes: readonly H2ADisclosureMode[];
  readonly defaultMode: H2ADisclosureMode;
  readonly conflictDisposition: H2ADisclosureConflictDisposition;
  readonly rationale: string;
  readonly references: readonly string[];
}

export interface H2ADisclosureAuditResult {
  readonly ok: boolean;
  readonly profileId?: H2AAbcModelId;
  readonly allowedModes?: readonly H2ADisclosureMode[];
  readonly defaultMode?: H2ADisclosureMode;
  readonly producesProjection: boolean;
  readonly issues: readonly string[];
  readonly unresolved: readonly string[];
}

export const H2A_DISCLOSURE_PROFILES = Object.freeze({
  A_ENTERPRISE: Object.freeze({
    modelId: "A_ENTERPRISE",
    label: "A - enterprise hierarchy",
    allowedModes: [
      "full-view",
      "redacted-view",
      "evidence-package",
      "attestation",
      "hash-only"
    ] as const,
    defaultMode: "redacted-view",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Enterprise V1 allows full-view inside the scope and uses redacted-view as the default for cross-domain CONTROL; evidence-package, attestation, and hash-only cover third parties.",
    references: ["REQ-070", "REQ-071", "DEC-041", "DEC-043", "DEC-045"] as const
  }),
  B_ECOSYSTEM: Object.freeze({
    modelId: "B_ECOSYSTEM",
    label: "B - peer ecosystem",
    allowedModes: [
      "redacted-view",
      "evidence-package",
      "attestation",
      "hash-only"
    ] as const,
    defaultMode: "evidence-package",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Cross-organization ecosystems must not expose full-view by default; evidence-package is the V1 baseline, with attestation and hash-only available for lighter disclosure.",
    references: ["REQ-070", "REQ-071", "DEC-041", "DEC-043", "DEC-045"] as const
  }),
  C_GOVERNMENT_CITIZEN: Object.freeze({
    modelId: "C_GOVERNMENT_CITIZEN",
    label: "C - public authority ecosystem",
    allowedModes: [
      "full-view",
      "redacted-view",
      "evidence-package",
      "attestation",
      "hash-only"
    ] as const,
    defaultMode: "evidence-package",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Public-authority contexts may require full-view by mandated authority, but citizen and inter-administration exchanges default to evidence-package with redacted-view available on demand.",
    references: ["REQ-070", "REQ-071", "DEC-041", "DEC-043", "DEC-045"] as const
  }),
  D_SAFE: Object.freeze({
    modelId: "D_SAFE",
    label: "D - agentic-delivery squad",
    allowedModes: [
      "full-view",
      "redacted-view",
      "evidence-package",
      "attestation",
      "hash-only"
    ] as const,
    defaultMode: "redacted-view",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "A squad works full-view inside its own scope, but a contracted external delivery firm and cross-scope CONTROL get redacted-view by default; evidence-package/attestation/hash-only cover the contracting-firm boundary.",
    references: ["REQ-070", "REQ-071", "DEC-041", "DEC-043", "DEC-045", "DEC-080"] as const
  })
} as const satisfies Record<H2AAbcModelId, H2ADisclosureProfileDescriptor>);

export function getDisclosureProfile(
  modelId: string
): H2ADisclosureProfileDescriptor | undefined {
  if (!Object.hasOwn(H2A_DISCLOSURE_PROFILES, modelId)) {
    return undefined;
  }
  return H2A_DISCLOSURE_PROFILES[modelId as H2AAbcModelId];
}

export function auditDisclosureProfile(
  modelId: string
): H2ADisclosureAuditResult {
  const profile = getDisclosureProfile(modelId);
  if (!profile) {
    return {
      ok: false,
      producesProjection: false,
      issues: [`unknown disclosure profile: ${modelId}`],
      unresolved: []
    };
  }

  const issues: string[] = [];
  const knownModes = new Set<H2ADisclosureMode>(H2A_DISCLOSURE_MODES);
  const allowedModes = [...profile.allowedModes];
  const seenModes = new Set(allowedModes);

  const unknownModes = allowedModes.filter((mode) => !knownModes.has(mode));
  if (unknownModes.length > 0) {
    issues.push(`unknown disclosure modes: ${unknownModes.join(", ")}`);
  }
  if (seenModes.size !== allowedModes.length) {
    issues.push("disclosure modes must not be duplicated");
  }
  if (allowedModes.length === 0) {
    issues.push("disclosure profile must declare at least one allowed mode");
  }
  if (!knownModes.has(profile.defaultMode)) {
    issues.push(`unknown default disclosure mode: ${profile.defaultMode}`);
  } else if (!seenModes.has(profile.defaultMode)) {
    issues.push(
      `default disclosure mode "${profile.defaultMode}" is not in allowedModes`
    );
  }
  if (profile.conflictDisposition !== "escalate-not-resolve") {
    issues.push(
      `unsupported disclosure conflict disposition: ${profile.conflictDisposition}`
    );
  }

  return {
    ok: issues.length === 0,
    profileId: profile.modelId,
    allowedModes: profile.allowedModes,
    defaultMode: profile.defaultMode,
    producesProjection: false,
    issues,
    unresolved:
      issues.length === 0
        ? [
            "The profile declares allowed disclosure modes, but V1 does not produce projections; consumers must redact, package, or attest content in their own policy layer."
          ]
        : []
  };
}
