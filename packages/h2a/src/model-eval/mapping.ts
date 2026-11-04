/**
 * Reviewed AA-slug → h2a-launch mapping table.
 *
 * Each row is evidence-backed (see `reviewed` + `note`). Slugs observed on
 * the AA leaderboard page on 2026-11-04; launch ids attested by the h2a-run
 * skill (same date). Unknown slugs are EXCLUDED and reported — never guessed.
 *
 * To add a row: resolve the exact launch id from the live gateway catalog
 * (`GET <ANTHROPIC_BASE_URL>/v1/models` when a gateway runs, else the
 * provider-native id), set `reviewed` to today, and extend the fixture in
 * `packages/h2a/test/model-eval.test.js`.
 */
import type { ModelEvalMappingRow } from "./types.js";

export const MODEL_EVAL_MAPPING_REVIEWED = "2026-11-04";

export const MODEL_EVAL_MAPPING: readonly ModelEvalMappingRow[] = [
  {
    aaSlug: "gpt-5-3-codex",
    profile: "codex",
    model: "gpt-5.6-terra",
    aliases: ["terra"],
    opus: false,
    reviewed: MODEL_EVAL_MAPPING_REVIEWED,
    note: "Codex-lane GPT (Terra xhigh class per h2a-run skill)."
  },
  {
    aaSlug: "gpt-5-5-pro",
    profile: "codex",
    model: "gpt-5.6-terra",
    aliases: ["terra"],
    opus: false,
    reviewed: MODEL_EVAL_MAPPING_REVIEWED,
    note: "Pro GPT launched through the codex lane (Terra xhigh)."
  },
  {
    aaSlug: "gpt-5-5-instant-06-26",
    profile: "codex",
    model: "gpt-5.6-terra",
    aliases: ["terra"],
    opus: false,
    reviewed: MODEL_EVAL_MAPPING_REVIEWED,
    note: "Fast GPT variant; strong build-lane (velocity) candidate."
  },
  {
    aaPrefix: "gemini-",
    profile: "agy",
    model: "gemini-3.7-flash-high",
    aliases: [],
    opus: false,
    reviewed: MODEL_EVAL_MAPPING_REVIEWED,
    note: "Family rule: Gemini models launch via agy (id attested by h2a-run skill)."
  }
];

/**
 * Opus-class AA slugs are withheld by default (owner guard), even without a
 * mapping row: any slug in the opus family is excluded unless the caller
 * passes `ownerAuthorizedOpus: true` AND a row provides a launch id.
 */
export function isOpusSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  return s.includes("opus");
}

/** Exact slug match wins over prefix match; no match → undefined. */
export function mapAaToH2a(slug: string): ModelEvalMappingRow | undefined {
  const exact = MODEL_EVAL_MAPPING.find((row) => row.aaSlug === slug);
  if (exact) return exact;
  return MODEL_EVAL_MAPPING.find(
    (row) => row.aaPrefix !== undefined && slug.startsWith(row.aaPrefix)
  );
}
