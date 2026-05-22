import type { H2AAbcModelId } from "./abc.js";

export const H2A_POLICY_PRECEDENCE_TIERS = [
  "public-authority",
  "contractual",
  "federated",
  "local"
] as const;

export const H2A_POLICY_PRECEDENCE_CONFLICT_DISPOSITIONS = [
  "escalate-not-resolve"
] as const;

export type H2APolicyPrecedenceTier =
  (typeof H2A_POLICY_PRECEDENCE_TIERS)[number];
export type H2APolicyPrecedenceConflictDisposition =
  (typeof H2A_POLICY_PRECEDENCE_CONFLICT_DISPOSITIONS)[number];

export interface H2APolicyPrecedenceProfileDescriptor {
  readonly modelId: H2AAbcModelId;
  readonly label: string;
  readonly orderedTiers: readonly H2APolicyPrecedenceTier[];
  readonly conflictDisposition: H2APolicyPrecedenceConflictDisposition;
  readonly rationale: string;
  readonly references: readonly string[];
}

export interface H2APolicyPrecedenceAuditResult {
  readonly ok: boolean;
  readonly profileId?: H2AAbcModelId;
  readonly orderedTiers?: readonly H2APolicyPrecedenceTier[];
  readonly resolvesConflicts: boolean;
  readonly issues: readonly string[];
  readonly unresolved: readonly string[];
}

export const H2A_POLICY_PRECEDENCE_PROFILES = Object.freeze({
  A_ENTERPRISE: Object.freeze({
    modelId: "A_ENTERPRISE",
    label: "A - enterprise hierarchy",
    orderedTiers: [
      "public-authority",
      "contractual",
      "local",
      "federated"
    ] as const,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Enterprise V1 reads public authority and contracts before local operating policies; peer/federated policy remains explicit and escalated when it conflicts.",
    references: ["REQ-041", "DEC-039", "DEC-041"] as const
  }),
  B_ECOSYSTEM: Object.freeze({
    modelId: "B_ECOSYSTEM",
    label: "B - peer ecosystem",
    orderedTiers: [
      "public-authority",
      "contractual",
      "federated",
      "local"
    ] as const,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Peer ecosystems read shared/federated policy before local participant policy after public and contractual constraints.",
    references: ["REQ-041", "DEC-039", "DEC-041"] as const
  }),
  C_GOVERNMENT_CITIZEN: Object.freeze({
    modelId: "C_GOVERNMENT_CITIZEN",
    label: "C - public authority ecosystem",
    orderedTiers: [
      "public-authority",
      "contractual",
      "federated",
      "local"
    ] as const,
    conflictDisposition: "escalate-not-resolve",
    rationale:
      "Public-authority contexts read imposed public policy first; contracts and delegated/federated rules remain explicit below that surface.",
    references: ["REQ-041", "DEC-039", "DEC-041"] as const
  })
} as const satisfies Record<H2AAbcModelId, H2APolicyPrecedenceProfileDescriptor>);

export function getPolicyPrecedenceProfile(
  modelId: string
): H2APolicyPrecedenceProfileDescriptor | undefined {
  if (!Object.hasOwn(H2A_POLICY_PRECEDENCE_PROFILES, modelId)) {
    return undefined;
  }
  return H2A_POLICY_PRECEDENCE_PROFILES[modelId as H2AAbcModelId];
}

export function auditPolicyPrecedenceProfile(
  modelId: string
): H2APolicyPrecedenceAuditResult {
  const profile = getPolicyPrecedenceProfile(modelId);
  if (!profile) {
    return {
      ok: false,
      resolvesConflicts: false,
      issues: [`unknown policy precedence profile: ${modelId}`],
      unresolved: []
    };
  }

  const issues: string[] = [];
  const orderedTiers = [...profile.orderedTiers];
  const knownTiers = new Set(H2A_POLICY_PRECEDENCE_TIERS);
  const seenTiers = new Set(orderedTiers);
  const unknownTiers = orderedTiers.filter((tier) => !knownTiers.has(tier));
  const missingTiers = H2A_POLICY_PRECEDENCE_TIERS.filter(
    (tier) => !seenTiers.has(tier)
  );

  if (unknownTiers.length > 0) {
    issues.push(`unknown policy precedence tiers: ${unknownTiers.join(", ")}`);
  }
  if (seenTiers.size !== orderedTiers.length) {
    issues.push("policy precedence tiers must not be duplicated");
  }
  if (missingTiers.length > 0) {
    issues.push(`missing policy precedence tiers: ${missingTiers.join(", ")}`);
  }
  if (profile.conflictDisposition !== "escalate-not-resolve") {
    issues.push(
      `unsupported policy precedence conflict disposition: ${profile.conflictDisposition}`
    );
  }

  return {
    ok: issues.length === 0,
    profileId: profile.modelId,
    orderedTiers: profile.orderedTiers,
    resolvesConflicts: false,
    issues,
    unresolved:
      issues.length === 0
        ? [
            "The profile declares precedence order, but V1 does not select a winning policy automatically; conflicts must escalate through the declared authority surface."
          ]
        : []
  };
}
