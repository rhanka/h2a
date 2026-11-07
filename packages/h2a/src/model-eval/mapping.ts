/**
 * Reviewed AA-slug → h2a-launch mapping table.
 *
 * Each row is evidence-backed (see `reviewed` + `note`). Slugs observed on
 * the AA leaderboard page on 2026-11-04; launch ids attested by the h2a-run
 * skill (same date). Unknown slugs are EXCLUDED and reported — never guessed.
 *
 * One source slug per launch id: a recommendation score always comes from
 * the single reviewed slug mapped to that launch id, never borrowed from a
 * sibling slug. Withheld slugs (`gpt-5-5-pro`, `gpt-5-5-instant-06-26`) share
 * the `gpt-5.6-terra` launch id without sourced equivalence, so they stay
 * unmapped and surface as "no mapping row" exclusions. There are no prefix
 * rules: an unreviewed slug stays excluded even inside a known family.
 *
 * To add a row: resolve the exact launch id from the live gateway catalog
 * (`GET <ANTHROPIC_BASE_URL>/v1/models` when a gateway runs, else the
 * provider-native id), set `reviewed` to today, keep the one-slug-per-id
 * invariant (asserted in `packages/h2a/test/model-eval.test.js`), and extend
 * the fixture in that same test file.
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
    aaSlug: "gemini-3-7-flash",
    profile: "agy",
    model: "gemini-3.7-flash-high",
    aliases: [],
    opus: false,
    reviewed: MODEL_EVAL_MAPPING_REVIEWED,
    note: "Gemini Flash via agy (id attested by h2a-run skill)."
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

/** Exact slug match only; no match → undefined. */
export function mapAaToH2a(slug: string): ModelEvalMappingRow | undefined {
  return MODEL_EVAL_MAPPING.find((row) => row.aaSlug === slug);
}
