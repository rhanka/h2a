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
export const GEMINI_4_CARBON = "gemini-4-carbon";
export const GEMINI_3_8_FLASH = "gemini-3.8-flash";
export const CLAUDE_FABLE_5_1 = "claude-fable-5-1";
export const CLAUDE_FABLE_5_2 = "claude-fable-5-2";
export const MUSE_SPARK_1_3 = "muse-spark-1.3";
export const MUSE_SPARK_1_3_CONTRIBUTOR = "muse-spark-1.3-contributor";
export const MUSE_WONDER_1_0 = "muse-wonder-1.0";
export const MUSE_EMBER_1_0 = "muse-ember-1.0";
export const MUSE_WONDER_FULL_1_0 = "muse-wonder-full-1.0";

export const GATEWAY_MODEL_IDS = [
  GEMINI_4_ARGON,
  GEMINI_4_CARBON,
  GEMINI_3_8_FLASH,
  CLAUDE_FABLE_5_1,
  CLAUDE_FABLE_5_2,
  MUSE_SPARK_1_3,
  MUSE_SPARK_1_3_CONTRIBUTOR,
  MUSE_WONDER_1_0,
  MUSE_EMBER_1_0,
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
    "gemini-4-carbon": GEMINI_4_CARBON,
    "gemini-4-carbon-high": GEMINI_4_CARBON,
    "gemini-4-carbon-medium": GEMINI_4_CARBON,
    "gemini-4-carbon-low": GEMINI_4_CARBON,
    "gemini-carbon": GEMINI_4_CARBON,
    "gemini-carbon-high": GEMINI_4_CARBON,
    carbon: GEMINI_4_CARBON,
    "carbon-high": GEMINI_4_CARBON,
    "carbon-medium": GEMINI_4_CARBON,
    "carbon-low": GEMINI_4_CARBON,
    "gemini-3.8-flash": GEMINI_3_8_FLASH,
    "gemini-3.8-flash-high": GEMINI_3_8_FLASH,
    flash: GEMINI_3_8_FLASH,
    "flash-high": GEMINI_3_8_FLASH,
    "claude-fable-5-1": CLAUDE_FABLE_5_1,
    "claude-fable-5.1": CLAUDE_FABLE_5_1,
    "fable-5-1": CLAUDE_FABLE_5_1,
    "fable-5.1": CLAUDE_FABLE_5_1,
    "fable5.1": CLAUDE_FABLE_5_1,
    fable51: CLAUDE_FABLE_5_1,
    "claude-fable-5-2": CLAUDE_FABLE_5_2,
    "claude-fable-5.2": CLAUDE_FABLE_5_2,
    "fable-5-2": CLAUDE_FABLE_5_2,
    "fable-5.2": CLAUDE_FABLE_5_2,
    "fable5.2": CLAUDE_FABLE_5_2,
    fable52: CLAUDE_FABLE_5_2,
    fable: CLAUDE_FABLE_5_2,
    "muse-spark-1.3": MUSE_SPARK_1_3,
    "muse-spark-1.3-contributor": MUSE_SPARK_1_3_CONTRIBUTOR,
    "muse-spark": MUSE_SPARK_1_3,
    spark: MUSE_SPARK_1_3,
    "muse-wonder-1.0": MUSE_WONDER_1_0,
    "muse-wonder": MUSE_WONDER_1_0,
    "muse-ember-1.0": MUSE_EMBER_1_0,
    "muse-ember": MUSE_EMBER_1_0,
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
  return Object.hasOwn(GATEWAY_MODEL_ALIASES, key)
    ? GATEWAY_MODEL_ALIASES[key]
    : undefined;
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
  "fable-5.2/base": {
    cloud: GEMINI_4_CARBON,
    cloudEffort: "high",
    muse: GEMINI_4_CARBON,
    museEffort: "max",
  },
  "fable-5.2/medium": {
    cloud: GEMINI_4_CARBON,
    cloudEffort: "high",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "high",
  },
  "fable-5.2/high": {
    cloud: GEMINI_4_CARBON,
    cloudEffort: "high",
    muse: GEMINI_4_CARBON,
    museEffort: "max",
  },
  "fable-5.2/xhigh": {
    cloud: GEMINI_4_CARBON,
    cloudEffort: "high",
    muse: GEMINI_4_CARBON,
    museEffort: "max",
  },
  "fable-5.2/max": {
    cloud: GEMINI_4_CARBON,
    cloudEffort: "high",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "max",
  },
  "fable-5.2/low": {
    cloud: GEMINI_4_CARBON,
    cloudEffort: "high",
    muse: MUSE_SPARK_1_3_CONTRIBUTOR,
    museEffort: "medium",
  },
};

const CLAUDE_LAUNCH_ALIAS_TO_FAMILY: Readonly<Record<string, string>> = {
  "claude-fable-5-1": "fable-5.1/base",
  "claude-fable-5-1-medium": "fable-5.1/medium",
  "claude-fable-5-1-high": "fable-5.1/high",
  "claude-fable-5-1-xhigh": "fable-5.1/xhigh",
  "claude-fable-5-1-max": "fable-5.1/max",
  "claude-fable-5-1-low": "fable-5.1/low",
  "claude-fable-5-2": "fable-5.2/base",
  "claude-fable-5-2-medium": "fable-5.2/medium",
  "claude-fable-5-2-high": "fable-5.2/high",
  "claude-fable-5-2-xhigh": "fable-5.2/xhigh",
  "claude-fable-5-2-max": "fable-5.2/max",
  "claude-fable-5-2-low": "fable-5.2/low",
};

export function claudeGatewaySlot(
  family: string,
): ClaudeGatewaySlot | undefined {
  const rawKey = family.trim().toLowerCase();
  const key = Object.hasOwn(CLAUDE_LAUNCH_ALIAS_TO_FAMILY, rawKey)
    ? CLAUDE_LAUNCH_ALIAS_TO_FAMILY[rawKey]!
    : rawKey;
  return Object.hasOwn(CLAUDE_GATEWAY_MODEL_MAP, key)
    ? CLAUDE_GATEWAY_MODEL_MAP[key]
    : undefined;
}
