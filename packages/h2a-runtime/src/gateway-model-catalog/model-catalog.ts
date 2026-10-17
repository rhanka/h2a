/**
 * h2a embedded gateway model catalog — H0 mirror of the published #662
 * surface (llm-mesh 0.26.0 / llm-gateway 0.20.0).
 *
 * Canonical routing knowledge stays in llm-mesh; this module only names the
 * model ids `h2a run --model` accepts and normalizes readable aliases to
 * their exact canonical id (identity-only normalization, no cross-model
 * mapping). Unknown names resolve to undefined so the exact-model default
 * never silently maps them.
 */

export const GEMINI_4_ARGON = "gemini-4-argon";
export const GEMINI_3_8_FLASH = "gemini-3.8-flash";
export const MUSE_SPARK_1_3 = "muse-spark-1.3";
export const MUSE_SPARK_1_3_CONTRIBUTOR = "muse-spark-1.3-contributor";
export const MUSE_WONDER_1_0 = "muse-wonder-1.0";
export const MUSE_WONDER_FULL_1_0 = "muse-wonder-full-1.0";

export const GATEWAY_MODEL_IDS = [
  GEMINI_4_ARGON,
  GEMINI_3_8_FLASH,
  MUSE_SPARK_1_3,
  MUSE_SPARK_1_3_CONTRIBUTOR,
  MUSE_WONDER_1_0,
  MUSE_WONDER_FULL_1_0,
] as const;

export type GatewayModelId = (typeof GATEWAY_MODEL_IDS)[number];

/** Readable aliases accepted by `h2a run --model` (spec §6.6). */
export const GATEWAY_MODEL_ALIASES: Readonly<Record<string, GatewayModelId>> =
  {
    "gemini-4-argon": GEMINI_4_ARGON,
    "gemini-4-argon-high": GEMINI_4_ARGON,
    "gemini-argon": GEMINI_4_ARGON,
    argon: GEMINI_4_ARGON,
    "argon-high": GEMINI_4_ARGON,
    "gemini-3.8-flash": GEMINI_3_8_FLASH,
    "gemini-3.8-flash-high": GEMINI_3_8_FLASH,
    flash: GEMINI_3_8_FLASH,
    "flash-high": GEMINI_3_8_FLASH,
    "muse-spark-1.3": MUSE_SPARK_1_3,
    "muse-spark-1.3-contributor": MUSE_SPARK_1_3_CONTRIBUTOR,
    "muse-spark": MUSE_SPARK_1_3,
    spark: MUSE_SPARK_1_3,
    "muse-wonder-1.0": MUSE_WONDER_1_0,
    "muse-wonder": MUSE_WONDER_1_0,
    wonder: MUSE_WONDER_1_0,
    "muse-wonder-full-1.0": MUSE_WONDER_FULL_1_0,
    "muse-wonder-full": MUSE_WONDER_FULL_1_0,
    "wonder-full": MUSE_WONDER_FULL_1_0,
  };

export function isKnownGatewayModel(value: string): value is GatewayModelId {
  return (GATEWAY_MODEL_IDS as readonly string[]).includes(value);
}

/** Identity-only normalization: alias → canonical id, else undefined. */
export function resolveGatewayModelAlias(
  value: string,
): GatewayModelId | undefined {
  const key = value.trim().toLowerCase();
  return GATEWAY_MODEL_ALIASES[key];
}

/**
 * Claude-family gateway mapping (spec §6.6): requested alias family →
 * cloud slot (Gemini) and Muse slot. Effort is advisory; the mesh validates
 * it against transport capability. Unmentioned legacy families keep llm-mesh's
 * own table and are absent here by design.
 */
export type ClaudeGatewaySlot = {
  readonly cloud: GatewayModelId;
  readonly cloudEffort: string;
  readonly muse: GatewayModelId;
  readonly museEffort: string;
};

export const CLAUDE_GATEWAY_MODEL_MAP: Readonly<
  Record<string, ClaudeGatewaySlot>
> = {
  "opus-5.5/base": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "high",
  },
  "opus-5.5/medium": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "high",
  },
  "opus-5.5/high": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "xhigh",
  },
  "opus-5.5/xhigh": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_FULL_1_0,
    museEffort: "max",
  },
  "opus-5.5/max": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_FULL_1_0,
    museEffort: "max",
  },
  "opus-5.5/low": {
    cloud: GEMINI_3_8_FLASH,
    cloudEffort: "high",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "medium",
  },
  "sonnet-5.5/high": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "xhigh",
  },
  "sonnet-5.5/xhigh": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "max",
  },
  "sonnet-5.5/max": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_FULL_1_0,
    museEffort: "max",
  },
  "sonnet-5.5/medium": {
    cloud: GEMINI_3_8_FLASH,
    cloudEffort: "high",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "high",
  },
  "sonnet-5.5/low": {
    cloud: GEMINI_3_8_FLASH,
    cloudEffort: "medium",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "medium",
  },
  "fable-5.1/base": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "max",
  },
  "fable-5.1/medium": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "high",
  },
  "fable-5.1/high": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "max",
  },
  "fable-5.1/xhigh": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "max",
  },
  "fable-5.1/max": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "max",
  },
  "fable-5.1/low": {
    cloud: GEMINI_4_ARGON,
    cloudEffort: "high",
    muse: MUSE_WONDER_1_0,
    museEffort: "medium",
  },
};

export function claudeGatewaySlot(
  family: string,
): ClaudeGatewaySlot | undefined {
  return CLAUDE_GATEWAY_MODEL_MAP[family.trim().toLowerCase()];
}
