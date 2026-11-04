/**
 * model-eval shared types.
 *
 * The h2a model-eval skill picks launch targets from the Artificial Analysis
 * (AA) index crossed with what `h2a run` can actually launch. These types are
 * the contract between the fetch/store layer, the mapping table, the role
 * recommender and the `h2a_run` / `h2a run` renderers.
 */

/** Launch profiles documented by the h2a-run skill. */
export const MODEL_EVAL_PROFILES = [
  "claude",
  "codex",
  "muse",
  "agy",
  "vibe"
] as const;
export type ModelEvalProfile = (typeof MODEL_EVAL_PROFILES)[number];

/** Effort levels accepted by `h2a_run` (agy caps at `high`, vibe takes none). */
export const MODEL_EVAL_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ModelEvalEffort = (typeof MODEL_EVAL_EFFORTS)[number];

/** Recommender roles. `review` needs the author's model id as input. */
export const MODEL_EVAL_ROLES = ["design", "build", "review"] as const;
export type ModelEvalRole = (typeof MODEL_EVAL_ROLES)[number];

/** One normalized AA index row (free-shape `/language/models/free` fields). */
export interface AaModelEntry {
  readonly slug: string;
  readonly name: string;
  /** `artificial_analysis_intelligence_index` — null when the API omits it. */
  readonly intelligence: number | null;
  readonly coding: number | null;
  /** `performance.median_output_tokens_per_second`. */
  readonly outputTokensPerSec: number | null;
  /** `performance.median_time_to_first_token_seconds` converted to ms. */
  readonly latencyMs: number | null;
  readonly priceInputPer1M: number | null;
  readonly priceOutputPer1M: number | null;
}

/** Dated AA snapshot as stored under the h2a state dir. */
export interface AaIndexCache {
  readonly source: string;
  readonly fetchedAt: string;
  readonly intelligenceIndexVersion: number | null;
  readonly models: readonly AaModelEntry[];
}

/** One row of the reviewed AA-slug → h2a-launch mapping table. */
export interface ModelEvalMappingRow {
  /** Exact AA slug match. Exactly one of `aaSlug` / `aaPrefix` is set. */
  readonly aaSlug?: string;
  /** Prefix match on the AA slug (family rule, e.g. `gemini-`). */
  readonly aaPrefix?: string;
  readonly profile: ModelEvalProfile;
  /**
   * Exact `--model` / `model` id to launch. `null` means "known family, no
   * attested launch id" — always excluded and reported.
   */
  readonly model: string | null;
  /** Nicknames also matched by quota-override seats (e.g. `terra`). */
  readonly aliases: readonly string[];
  /** Opus-class rows are withheld unless the owner explicitly authorizes. */
  readonly opus: boolean;
  /** Review stamp of this row (`YYYY-MM-DD`). */
  readonly reviewed: string;
  readonly note: string;
}

/** One exhausted seat from the local quota-override file. */
export interface QuotaExhaustion {
  /** Matches a profile name, a full model id, or a mapping alias. */
  readonly seat: string;
  /** ISO timestamp: the seat is exhausted while `now < until`. */
  readonly until: string;
  readonly note: string;
}

/** A launchable candidate: AA scores crossed with a mapping row. */
export interface ModelEvalCandidate {
  readonly entry: AaModelEntry;
  readonly row: ModelEvalMappingRow;
}

/** A model dropped from a recommendation, with the reason shown to the user. */
export interface ModelEvalExclusion {
  readonly slug: string;
  readonly name: string;
  readonly reason: string;
}

/** One directly usable per-role recommendation. */
export interface ModelEvalRecommendation {
  readonly role: ModelEvalRole;
  readonly profile: ModelEvalProfile;
  readonly model: string;
  readonly effort: ModelEvalEffort | null;
  readonly gateway: "auto" | "required" | "off";
  readonly headless: boolean;
  readonly score: {
    readonly intelligence: number | null;
    readonly outputTokensPerSec: number | null;
    readonly latencyMs: number | null;
  };
  readonly source: {
    readonly endpoint: string;
    readonly fetchedAt: string;
  };
  readonly mappingNote: string;
  /** Ready-to-send `h2a_run` MCP arguments (prompt/name/workspace filled). */
  readonly mcp: Record<string, unknown>;
  /** Ready-to-paste `h2a run … --prompt-stdin` command. */
  readonly cli: string;
}

/** Full recommender output: picks plus the audit trail. */
export interface ModelEvalOutcome {
  readonly picks: readonly ModelEvalRecommendation[];
  readonly excluded: readonly ModelEvalExclusion[];
  readonly source: {
    readonly endpoint: string;
    readonly fetchedAt: string;
  };
}

/** Typed failure — `code` is stable and asserted in tests. */
export class ModelEvalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelEvalError";
    this.code = code;
  }
}

export const MODEL_EVAL_ERROR_CODES = [
  "MODEL_EVAL_NO_SOURCE",
  "MODEL_EVAL_NO_CANDIDATE",
  "MODEL_EVAL_NO_REVIEWER",
  "MODEL_EVAL_FETCH_FAILED",
  "MODEL_EVAL_BAD_CACHE",
  "MODEL_EVAL_BAD_INPUT"
] as const;
