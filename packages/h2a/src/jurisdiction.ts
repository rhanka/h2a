import type { H2AAbcModelId } from "./abc.js";

export const H2A_JURISDICTION_KINDS = [
  "territorial",
  "sectoral",
  "functional",
  "personal",
  "temporal",
  "delegated",
  "private-contract"
] as const;

export const H2A_JURISDICTION_CONFLICT_DISPOSITIONS = [
  "escalate-not-resolve"
] as const;

export type H2AJurisdictionKind = (typeof H2A_JURISDICTION_KINDS)[number];
export type H2AJurisdictionConflictDisposition =
  (typeof H2A_JURISDICTION_CONFLICT_DISPOSITIONS)[number];

export interface H2AJurisdictionProfileDescriptor {
  readonly modelId: H2AAbcModelId;
  readonly label: string;
  readonly allowedKinds: readonly H2AJurisdictionKind[];
  readonly defaultKind: H2AJurisdictionKind;
  readonly conflictDisposition: H2AJurisdictionConflictDisposition;
  readonly rationale: string;
  readonly references: readonly string[];
}

export interface H2AJurisdictionAuditResult {
  readonly ok: boolean;
  readonly profileId?: H2AAbcModelId;
  readonly allowedKinds?: readonly H2AJurisdictionKind[];
  readonly defaultKind?: H2AJurisdictionKind;
  readonly checksMembership: boolean;
  readonly issues: readonly string[];
  readonly unresolved: readonly string[];
}

export const H2A_JURISDICTION_PROFILES = Object.freeze({
  A_ENTERPRISE: Object.freeze({
    modelId: "A_ENTERPRISE",
    label: "A - enterprise hierarchy",
    allowedKinds: [
      "private-contract",
      "sectoral",
      "functional",
      "territorial"
    ] as const,
    defaultKind: "private-contract",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Enterprises operate primarily under private contract scopes; sectoral and functional jurisdictions cover regulated activities and territorial law applies where the enterprise is established.",
    references: [
      "REQ-042",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-048"
    ] as const
  }),
  B_ECOSYSTEM: Object.freeze({
    modelId: "B_ECOSYSTEM",
    label: "B - peer ecosystem",
    allowedKinds: [
      "delegated",
      "private-contract",
      "sectoral",
      "functional",
      "territorial"
    ] as const,
    defaultKind: "delegated",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Peer ecosystems most often work under jurisdiction delegated by upstream contracts; private-contract, sectoral, functional, and territorial kinds remain available for the specific cross-organization clauses.",
    references: [
      "REQ-043",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-048"
    ] as const
  }),
  C_GOVERNMENT_CITIZEN: Object.freeze({
    modelId: "C_GOVERNMENT_CITIZEN",
    label: "C - public authority ecosystem",
    allowedKinds: [
      "territorial",
      "sectoral",
      "functional",
      "personal",
      "temporal",
      "delegated"
    ] as const,
    defaultKind: "territorial",
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Public authority is territorial by default; sectoral, functional, personal, temporal, and delegated kinds capture the rest of the public-jurisdiction surface (regulator, demographic, emergency, sub-delegation).",
    references: [
      "REQ-044",
      "REQ-071",
      "DEC-041",
      "DEC-043",
      "DEC-048"
    ] as const
  })
} as const satisfies Record<H2AAbcModelId, H2AJurisdictionProfileDescriptor>);

export function getJurisdictionProfile(
  modelId: string
): H2AJurisdictionProfileDescriptor | undefined {
  if (!Object.hasOwn(H2A_JURISDICTION_PROFILES, modelId)) {
    return undefined;
  }
  return H2A_JURISDICTION_PROFILES[modelId as H2AAbcModelId];
}

export function auditJurisdictionProfile(
  modelId: string
): H2AJurisdictionAuditResult {
  const profile = getJurisdictionProfile(modelId);
  if (!profile) {
    return {
      ok: false,
      checksMembership: false,
      issues: [`unknown jurisdiction profile: ${modelId}`],
      unresolved: []
    };
  }

  const issues: string[] = [];
  const knownKinds = new Set<H2AJurisdictionKind>(H2A_JURISDICTION_KINDS);

  const allowedKinds = [...profile.allowedKinds];
  const kindSeen = new Set(allowedKinds);
  const unknownKinds = allowedKinds.filter((kind) => !knownKinds.has(kind));

  if (unknownKinds.length > 0) {
    issues.push(`unknown jurisdiction kinds: ${unknownKinds.join(", ")}`);
  }
  if (kindSeen.size !== allowedKinds.length) {
    issues.push("jurisdiction kinds must not be duplicated");
  }
  if (allowedKinds.length === 0) {
    issues.push(
      "jurisdiction profile must declare at least one allowed kind"
    );
  }
  if (!knownKinds.has(profile.defaultKind)) {
    issues.push(`unknown default jurisdiction kind: ${profile.defaultKind}`);
  } else if (!kindSeen.has(profile.defaultKind)) {
    issues.push(
      `default jurisdiction kind "${profile.defaultKind}" is not in allowedKinds`
    );
  }
  if (profile.conflictDisposition !== "escalate-not-resolve") {
    issues.push(
      `unsupported jurisdiction conflict disposition: ${profile.conflictDisposition}`
    );
  }

  return {
    ok: issues.length === 0,
    profileId: profile.modelId,
    allowedKinds: profile.allowedKinds,
    defaultKind: profile.defaultKind,
    checksMembership: false,
    issues,
    unresolved:
      issues.length === 0
        ? [
            "The profile declares allowed jurisdiction kinds and a default, but V1 does not check membership; matching a scope/actor to a jurisdiction stays in the policy layer."
          ]
        : []
  };
}
