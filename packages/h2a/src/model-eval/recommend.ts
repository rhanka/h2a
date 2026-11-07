/**
 * Role recommender: cross the dated AA cache with the mapping table, the
 * quota overrides, and the owner guards.
 *
 * Rules (owner 03/11):
 * - design/spec/design-review → intelligence STRICTLY > 50, effort max
 *   (`xhigh`; agy caps at `high`, so agy serves design only as reviewer at
 *   its max effort). Most intelligent available wins; author and reviewer
 *   are two DIFFERENT models launched under distinct names.
 * - build → intelligence >= minimal threshold (configurable via
 *   `MODEL_EVAL_BUILD_MIN_INTEL`, default `30`, documented), fastest
 *   `outputTokensPerSec` wins.
 * - review → most intelligent scored (non-null intelligence) model DISTINCT
 *   from the author's, at its profile's max effort. No fixed floor beyond
 *   requiring a score: the author already passed the design floor, and the
 *   reviewer only needs a ranked, distinct alternative.
 * - Opus-class: excluded unless `ownerAuthorizedOpus` is true.
 * - Quota: seats exhausted per the local override file are excluded.
 * - Unknown AA slug (no mapping row, or row without attested launch id):
 *   excluded and reported, never guessed.
 * - Every launchable candidate lands either in `picks` or in `excluded`
 *   with a reason, so the audit trail is complete per role.
 */
import { isOpusSlug, mapAaToH2a } from "./mapping.js";
import { isSeatExhausted } from "./store.js";
import { ModelEvalError } from "./types.js";
import type {
  AaModelEntry,
  ModelEvalCandidate,
  ModelEvalEffort,
  ModelEvalExclusion,
  ModelEvalOutcome,
  ModelEvalProfile,
  ModelEvalRecommendation,
  ModelEvalRole,
  QuotaExhaustion
} from "./types.js";

export const DESIGN_MIN_INTELLIGENCE = 50;
export const DEFAULT_BUILD_MIN_INTELLIGENCE = 30;
export const BUILD_MIN_INTEL_ENV = "MODEL_EVAL_BUILD_MIN_INTEL";

/** Launch-name pattern shared with the `h2a_run` MCP tool. */
export const LAUNCH_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Profiles that accept `xhigh` (agy caps at `high`, vibe takes no effort). */
export function maxEffortFor(profile: ModelEvalProfile): ModelEvalEffort | null {
  if (profile === "agy") return "high";
  if (profile === "vibe") return null;
  return "xhigh";
}

export interface RecommendInput {
  readonly role: ModelEvalRole;
  readonly models: readonly AaModelEntry[];
  readonly source: { endpoint: string; fetchedAt: string };
  readonly overrides: readonly QuotaExhaustion[];
  readonly ownerAuthorizedOpus?: boolean;
  readonly buildMinIntelligence?: number;
  /** Required for `review`: the author's h2a model id to stay distinct from. */
  readonly authorModel?: string;
  readonly launch: { name: string; workspace: string; prompt: string };
  readonly now?: Date;
}

function seatKeys(row: { profile: string; model: string | null; aliases: readonly string[] }): string[] {
  return [row.profile, ...(row.model !== null ? [row.model] : []), ...row.aliases];
}

/** Split cache models into launchable candidates + reported exclusions. */
export function collectCandidates(
  models: readonly AaModelEntry[],
  overrides: readonly QuotaExhaustion[],
  ownerAuthorizedOpus: boolean,
  now: Date
): { candidates: ModelEvalCandidate[]; excluded: ModelEvalExclusion[] } {
  const candidates: ModelEvalCandidate[] = [];
  const excluded: ModelEvalExclusion[] = [];
  for (const entry of models) {
    // Opus guard first: withheld with or without a mapping row.
    if (isOpusSlug(entry.slug) && !ownerAuthorizedOpus) {
      excluded.push({
        slug: entry.slug,
        name: entry.name,
        reason: "opus guard: excluded without explicit owner authorization"
      });
      continue;
    }
    const row = mapAaToH2a(entry.slug);
    if (row === undefined || row.model === null) {
      excluded.push({
        slug: entry.slug,
        name: entry.name,
        reason:
          row === undefined
            ? "no mapping row: excluded (add a reviewed row to launch it)"
            : "mapped family without attested launch id: excluded"
      });
      continue;
    }
    if (row.opus && !ownerAuthorizedOpus) {
      excluded.push({
        slug: entry.slug,
        name: entry.name,
        reason: "opus guard: excluded without explicit owner authorization"
      });
      continue;
    }
    const hit = seatKeys(row)
      .map((seat) => isSeatExhausted(seat, overrides, now))
      .find((o) => o !== undefined);
    if (hit !== undefined) {
      excluded.push({
        slug: entry.slug,
        name: entry.name,
        reason: `quota: seat exhausted until ${hit.until}${hit.note ? ` (${hit.note})` : ""}`
      });
      continue;
    }
    candidates.push({ entry, row });
  }
  return { candidates, excluded };
}

function byIntelligenceDesc(a: ModelEvalCandidate, b: ModelEvalCandidate): number {
  return (b.entry.intelligence ?? -1) - (a.entry.intelligence ?? -1);
}

function gatewayFor(profile: ModelEvalProfile): "auto" | "required" | "off" {
  return profile === "agy" || profile === "muse" || profile === "vibe"
    ? "off"
    : "auto";
}

function headlessFor(profile: ModelEvalProfile): boolean {
  // muse/vibe reject headless launches (verified: no stdin prompt contract).
  return profile !== "muse" && profile !== "vibe";
}

/**
 * Design launches share one base name; the author and reviewer picks each
 * get their own suffixed launch name (mcp `name` / cli `--name` must be
 * unique — a second `h2a_run` with the same name but different arguments is
 * rejected as `launch_arguments_conflict`). The suffix is preserved while
 * the stem is truncated to fit `^[A-Za-z0-9_-]{1,64}$`.
 */
export function designLaunchName(base: string, pick: "author" | "reviewer"): string {
  const suffix = pick === "author" ? "-author" : "-reviewer";
  const stem = base.length + suffix.length <= 64 ? base : base.slice(0, 64 - suffix.length);
  return `${stem}${suffix}`;
}

function toRecommendation(
  role: ModelEvalRole,
  candidate: ModelEvalCandidate,
  effort: ModelEvalEffort | null,
  source: { endpoint: string; fetchedAt: string },
  launch: { name: string; workspace: string; prompt: string }
): ModelEvalRecommendation {
  const { entry, row } = candidate;
  const gateway = gatewayFor(row.profile);
  const headless = headlessFor(row.profile);
  const mcp: Record<string, unknown> = {
    profile: row.profile,
    name: launch.name,
    workspace: launch.workspace,
    prompt: launch.prompt,
    background: true,
    gateway,
    headless
  };
  if (row.model !== null) mcp["model"] = row.model;
  if (effort !== null) mcp["effort"] = effort;
  if (!headless) mcp["h2aSidecar"] = false;
  return {
    role,
    profile: row.profile,
    model: row.model as string,
    effort,
    gateway,
    headless,
    score: {
      intelligence: entry.intelligence,
      outputTokensPerSec: entry.outputTokensPerSec,
      latencyMs: entry.latencyMs
    },
    source: { ...source },
    mappingNote: `${entry.slug} → ${row.profile}/${row.model} (row reviewed ${row.reviewed}: ${row.note})`,
    mcp,
    cli: renderRunCommand(
      row.profile,
      row.model as string,
      effort,
      gateway,
      headless,
      launch
    )
  };
}

/** Quote one argv word when it leaves the safe literal set. */
export function quoteArg(word: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render the reference `h2a run` CLI form (see the h2a-run skill).
 * Prompt travels on stdin (`--prompt-stdin`); never in argv.
 * Gateway mirrors the runtime launcher: `required` → `--gw`,
 * `off` → `--no-gw`, `auto` → no flag (direct by default).
 */
export function renderRunCommand(
  profile: ModelEvalProfile,
  model: string,
  effort: ModelEvalEffort | null,
  gateway: "auto" | "required" | "off",
  headless: boolean,
  launch: { name: string; workspace: string }
): string {
  const parts = ["h2a", "run", profile, quoteArg(launch.workspace), "--model", quoteArg(model)];
  if (effort !== null) parts.push("--effort", effort);
  if (gateway === "required") parts.push("--gw");
  else if (gateway === "off") parts.push("--no-gw");
  parts.push("--name", quoteArg(launch.name));
  if (headless) {
    parts.push("--no-attach", "--background", "--json", "--headless", "--no-h2a");
  }
  parts.push("--prompt-stdin");
  return parts.join(" ");
}

/** Build-min-intelligence: explicit arg > env > documented default. */
export function resolveBuildMinIntelligence(explicit?: number): number {
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit)) {
      throw new ModelEvalError(
        "MODEL_EVAL_BAD_INPUT",
        `Invalid build intelligence floor ${explicit}: pass a finite number via --build-min-intel or $${BUILD_MIN_INTEL_ENV}.`
      );
    }
    return explicit;
  }
  const raw = process.env[BUILD_MIN_INTEL_ENV];
  if (raw !== undefined && raw.length > 0) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new ModelEvalError(
        "MODEL_EVAL_BAD_INPUT",
        `Invalid $${BUILD_MIN_INTEL_ENV} value ${JSON.stringify(raw)}: set a finite number or unset it for the default.`
      );
    }
    return parsed;
  }
  return DEFAULT_BUILD_MIN_INTELLIGENCE;
}

function validateLaunchName(name: string): void {
  if (!LAUNCH_NAME_PATTERN.test(name)) {
    throw new ModelEvalError(
      "MODEL_EVAL_BAD_INPUT",
      `Invalid launch name ${JSON.stringify(name)}: want ^[A-Za-z0-9_-]{1,64}$ (h2a_run name contract).`
    );
  }
}

export function recommend(input: RecommendInput): ModelEvalOutcome {
  validateLaunchName(input.launch.name);
  const now = input.now ?? new Date();
  const { candidates, excluded } = collectCandidates(
    input.models,
    input.overrides,
    input.ownerAuthorizedOpus ?? false,
    now
  );
  if (candidates.length === 0) {
    throw new ModelEvalError(
      "MODEL_EVAL_NO_CANDIDATE",
      `No launchable model for role '${input.role}': ` +
        `${excluded.length} excluded (${excluded.map((e) => e.reason).join("; ") || "empty index"}).`
    );
  }
  if (input.role === "design") {
    // Effort max is per-profile (agy caps at `high` — it rejects `xhigh`).
    const eligible = candidates.filter(
      (c) =>
        c.entry.intelligence !== null &&
        c.entry.intelligence > DESIGN_MIN_INTELLIGENCE &&
        maxEffortFor(c.row.profile) !== null
    );
    const roleExcluded: ModelEvalExclusion[] = candidates
      .filter((c) => !eligible.includes(c))
      .map((c) => ({
        slug: c.entry.slug,
        name: c.entry.name,
        reason:
          c.entry.intelligence === null
            ? "design: unscored (no intelligence index), excluded"
            : c.entry.intelligence <= DESIGN_MIN_INTELLIGENCE
              ? `design: intelligence ${c.entry.intelligence} ≤ ${DESIGN_MIN_INTELLIGENCE}, excluded`
              : "design: profile takes no effort, excluded"
      }));
    if (eligible.length === 0) {
      throw new ModelEvalError(
        "MODEL_EVAL_NO_CANDIDATE",
        `No model with intelligence > ${DESIGN_MIN_INTELLIGENCE} for design.`
      );
    }
    const sorted = [...eligible].sort(byIntelligenceDesc);
    const author = sorted[0]!;
    const reviewer = sorted.find((c) => c.row.model !== author.row.model);
    if (reviewer === undefined) {
      throw new ModelEvalError(
        "MODEL_EVAL_NO_REVIEWER",
        "Design needs two different models (author + reviewer) but only one is eligible."
      );
    }
    const picked = new Set([author, reviewer]);
    const unpicked: ModelEvalExclusion[] = sorted
      .filter((c) => !picked.has(c))
      .map((c) => ({
        slug: c.entry.slug,
        name: c.entry.name,
        reason: "design: eligible but not selected (a more intelligent pick won)"
      }));
    return {
      picks: [
        toRecommendation(
          "design",
          author,
          maxEffortFor(author.row.profile),
          input.source,
          { ...input.launch, name: designLaunchName(input.launch.name, "author") }
        ),
        toRecommendation(
          "design",
          reviewer,
          maxEffortFor(reviewer.row.profile),
          input.source,
          { ...input.launch, name: designLaunchName(input.launch.name, "reviewer") }
        )
      ],
      excluded: [...excluded, ...roleExcluded, ...unpicked],
      source: { ...input.source }
    };
  }
  if (input.role === "build") {
    const minIntel = resolveBuildMinIntelligence(input.buildMinIntelligence);
    const eligible = candidates.filter(
      (c) =>
        c.entry.intelligence !== null &&
        c.entry.intelligence >= minIntel &&
        c.entry.outputTokensPerSec !== null
    );
    const roleExcluded: ModelEvalExclusion[] = candidates
      .filter((c) => !eligible.includes(c))
      .map((c) => ({
        slug: c.entry.slug,
        name: c.entry.name,
        reason:
          c.entry.intelligence === null
            ? "build: unscored (no intelligence index), excluded"
            : c.entry.intelligence < minIntel
              ? `build: intelligence ${c.entry.intelligence} below threshold ${minIntel}, excluded`
              : "build: unknown output speed, excluded"
      }));
    if (eligible.length === 0) {
      throw new ModelEvalError(
        "MODEL_EVAL_NO_CANDIDATE",
        `No model with intelligence >= ${minIntel} and known output speed for build.`
      );
    }
    const sorted = [...eligible].sort(
      (a, b) => (b.entry.outputTokensPerSec as number) - (a.entry.outputTokensPerSec as number)
    );
    const winner = sorted[0]!;
    const effort = maxEffortFor(winner.row.profile);
    const unpicked: ModelEvalExclusion[] = sorted
      .slice(1)
      .map((c) => ({
        slug: c.entry.slug,
        name: c.entry.name,
        reason: "build: eligible but not selected (a faster pick won)"
      }));
    return {
      picks: [toRecommendation("build", winner, effort, input.source, input.launch)],
      excluded: [...excluded, ...roleExcluded, ...unpicked],
      source: { ...input.source }
    };
  }
  // review: most intelligent scored model distinct from the author's.
  if (input.authorModel === undefined || input.authorModel.length === 0) {
    throw new ModelEvalError(
      "MODEL_EVAL_BAD_INPUT",
      "Role 'review' needs authorModel (the author's h2a model id)."
    );
  }
  const eligible = candidates
    .filter((c) => c.row.model !== input.authorModel && c.entry.intelligence !== null)
    .sort(byIntelligenceDesc);
  const roleExcluded: ModelEvalExclusion[] = candidates
    .filter((c) => !eligible.includes(c))
    .map((c) => ({
      slug: c.entry.slug,
      name: c.entry.name,
      reason:
        c.row.model === input.authorModel
          ? "review: same model as the author, excluded"
          : "review: unscored (no intelligence index), excluded"
    }));
  if (eligible.length === 0) {
    throw new ModelEvalError(
      "MODEL_EVAL_NO_CANDIDATE",
      `No model distinct from author '${input.authorModel}' for review.`
    );
  }
  const winner = eligible[0]!;
  const effort = maxEffortFor(winner.row.profile);
  const unpicked: ModelEvalExclusion[] = eligible
    .slice(1)
    .map((c) => ({
      slug: c.entry.slug,
      name: c.entry.name,
      reason: "review: eligible but not selected (a more intelligent pick won)"
    }));
  return {
    picks: [toRecommendation("review", winner, effort, input.source, input.launch)],
    excluded: [...excluded, ...roleExcluded, ...unpicked],
    source: { ...input.source }
  };
}
