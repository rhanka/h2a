/**
 * Fetch + cache layer for the Artificial Analysis index.
 *
 * Data source: AA Data API v2 `GET /language/models/free` (headline indices,
 * median performance, pricing). Auth: `x-api-key` header read from
 * `ARTIFICIAL_ANALYSIS_API_KEY` **by name only** — the value is never logged,
 * never echoed, never persisted.
 *
 * Every state-dir value names the parent state dir: `$MODEL_EVAL_STATE_DIR`,
 * `--state-dir`, `$H2A_ROOT`, or `~/h2a-workspace/.h2a` (the shared-bus
 * default from `cli.ts`). The module always appends the `model-eval/`
 * segment itself, so the cache files land at:
 *   `<stateDir>/model-eval/aa-index.json`          dated AA snapshot
 *   `<stateDir>/model-eval/quota-overrides.json`   local exhausted-seat list
 *
 * Offline rule: work from the cache with its date shown; typed refusal
 * (`MODEL_EVAL_NO_SOURCE`) only when there is no cache and no fetch is
 * possible (no key or no network).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ModelEvalError } from "./types.js";
import type { AaIndexCache, AaModelEntry, QuotaExhaustion } from "./types.js";

export const AA_API_BASE = "https://artificialanalysis.ai/api/v2";
export const AA_FREE_ENDPOINT = "/language/models/free";
export const AA_API_KEY_ENV = "ARTIFICIAL_ANALYSIS_API_KEY";
export const MODEL_EVAL_STATE_SUBDIR = "model-eval";
export const MODEL_EVAL_CACHE_FILE = "aa-index.json";
export const MODEL_EVAL_QUOTA_FILE = "quota-overrides.json";

/**
 * State dir: the given dir (or, when omitted, `$MODEL_EVAL_STATE_DIR`, then
 * `$H2A_ROOT`, then the bus default) names the parent state dir; the
 * `model-eval/` segment is always appended by this function.
 */
export function resolveModelEvalStateDir(explicit?: string): string {
  if (explicit !== undefined && explicit.length > 0) return join(explicit, MODEL_EVAL_STATE_SUBDIR);
  const override = process.env["MODEL_EVAL_STATE_DIR"];
  if (override !== undefined && override.length > 0) return join(override, MODEL_EVAL_STATE_SUBDIR);
  const root = process.env["H2A_ROOT"];
  const base =
    root !== undefined && root.length > 0
      ? root
      : join(homedir(), "h2a-workspace", ".h2a");
  return join(base, MODEL_EVAL_STATE_SUBDIR);
}

export function cacheFilePath(stateDir?: string): string {
  return join(resolveModelEvalStateDir(stateDir), MODEL_EVAL_CACHE_FILE);
}

export function quotaFilePath(stateDir?: string): string {
  return join(resolveModelEvalStateDir(stateDir), MODEL_EVAL_QUOTA_FILE);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/**
 * Normalize one free-shape `data[]` item; null when slug/name are missing.
 * Also accepts an already-normalized cache entry (flat fields win), so a
 * cache written by this helper always reloads losslessly.
 */
export function normalizeAaModel(raw: unknown): AaModelEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const slug = rec["slug"];
  const name = rec["name"];
  if (typeof slug !== "string" || slug.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  const evaluations =
    typeof rec["evaluations"] === "object" && rec["evaluations"] !== null
      ? (rec["evaluations"] as Record<string, unknown>)
      : {};
  const performance =
    typeof rec["performance"] === "object" && rec["performance"] !== null
      ? (rec["performance"] as Record<string, unknown>)
      : {};
  const pricing =
    typeof rec["pricing"] === "object" && rec["pricing"] !== null
      ? (rec["pricing"] as Record<string, unknown>)
      : {};
  const ttftSec = numOrNull(performance["median_time_to_first_token_seconds"]);
  const flatLatency = numOrNull(rec["latencyMs"]);
  return {
    slug,
    name,
    intelligence:
      numOrNull(rec["intelligence"]) ??
      numOrNull(evaluations["artificial_analysis_intelligence_index"]),
    coding:
      numOrNull(rec["coding"]) ??
      numOrNull(evaluations["artificial_analysis_coding_index"]),
    outputTokensPerSec:
      numOrNull(rec["outputTokensPerSec"]) ??
      numOrNull(performance["median_output_tokens_per_second"]),
    latencyMs: flatLatency ?? (ttftSec === null ? null : ttftSec * 1000),
    priceInputPer1M:
      numOrNull(rec["priceInputPer1M"]) ??
      numOrNull(pricing["price_1m_input_tokens"]),
    priceOutputPer1M:
      numOrNull(rec["priceOutputPer1M"]) ??
      numOrNull(pricing["price_1m_output_tokens"])
  };
}

export interface AaFetchResult {
  readonly cache: AaIndexCache;
  /** Raw items skipped for missing slug/name. */
  readonly skipped: number;
}

export type FetchFn = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Fetch every page of the free endpoint. `apiKey` travels only in the
 * `x-api-key` header. Throws `MODEL_EVAL_FETCH_FAILED` (message carries the
 * status, never the key).
 */
export async function fetchAaIndex(
  apiKey: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn
): Promise<AaFetchResult> {
  const models: AaModelEntry[] = [];
  let skipped = 0;
  let intelligenceIndexVersion: number | null = null;
  let page = 1;
  for (;;) {
    let payload: unknown;
    try {
      const res = await fetchFn(
        `${AA_API_BASE}${AA_FREE_ENDPOINT}?page=${page}`,
        {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000)
        }
      );
      if (!res.ok) {
        throw new ModelEvalError(
          "MODEL_EVAL_FETCH_FAILED",
          `AA free endpoint returned HTTP ${res.status} (page ${page}).`
        );
      }
      payload = await res.json();
    } catch (error) {
      if (error instanceof ModelEvalError) throw error;
      throw new ModelEvalError(
        "MODEL_EVAL_FETCH_FAILED",
        `AA fetch failed (page ${page}): ${(error as Error).message}`
      );
    }
    const rec =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : {};
    if (intelligenceIndexVersion === null) {
      intelligenceIndexVersion = numOrNull(rec["intelligence_index_version"]);
    }
    const data = rec["data"];
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      const entry = normalizeAaModel(item);
      if (entry === null) {
        skipped += 1;
        continue;
      }
      models.push(entry);
    }
    const pagination =
      typeof rec["pagination"] === "object" && rec["pagination"] !== null
        ? (rec["pagination"] as Record<string, unknown>)
        : null;
    if (pagination?.["has_more"] !== true) break;
    page += 1;
    if (page > 50) break;
  }
  if (models.length === 0) {
    throw new ModelEvalError(
      "MODEL_EVAL_FETCH_FAILED",
      `AA free endpoint returned no usable models (skipped ${skipped}): refusing to cache an empty index.`
    );
  }
  return {
    cache: {
      source: `aa-api-v2:${AA_FREE_ENDPOINT}`,
      fetchedAt: new Date().toISOString(),
      intelligenceIndexVersion,
      models
    },
    skipped
  };
}

/** Persist a fetched snapshot (atomic enough for a local cache file). */
export function saveCache(cache: AaIndexCache, stateDir?: string): string {
  const path = cacheFilePath(stateDir);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return path;
}

/** Load the dated cache; throws `MODEL_EVAL_BAD_CACHE` / `MODEL_EVAL_NO_SOURCE`. */
export function loadCache(stateDir?: string): AaIndexCache {
  const path = cacheFilePath(stateDir);
  if (!existsSync(path)) {
    throw new ModelEvalError(
      "MODEL_EVAL_NO_SOURCE",
      `No AA cache at ${path} and no fetch was requested. ` +
        `Set ${AA_API_KEY_ENV} and run fetch first, or work where a cache exists.`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new ModelEvalError(
      "MODEL_EVAL_BAD_CACHE",
      `AA cache at ${path} is not valid JSON: ${(error as Error).message}`
    );
  }
  const rec =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  if (
    rec === null ||
    typeof rec["fetchedAt"] !== "string" ||
    !Array.isArray(rec["models"])
  ) {
    throw new ModelEvalError(
      "MODEL_EVAL_BAD_CACHE",
      `AA cache at ${path} misses fetchedAt/models.`
    );
  }
  const models: AaModelEntry[] = [];
  for (const item of rec["models"] as unknown[]) {
    const entry = normalizeAaModel(item);
    if (entry !== null) models.push(entry);
  }
  return {
    source: typeof rec["source"] === "string" ? rec["source"] : "unknown",
    fetchedAt: rec["fetchedAt"] as string,
    intelligenceIndexVersion: numOrNull(rec["intelligenceIndexVersion"]),
    models
  };
}

/**
 * Load the local exhausted-seat list. Missing file → no overrides (not an
 * error). Malformed file or malformed entry → `MODEL_EVAL_BAD_CACHE`
 * (fail-closed: a misspelled exhausted seat must never be recommended).
 *
 * Format: `{ "exhausted": [{ "seat": "codex", "until": "<ISO>", "note": "…" }] }`
 * `seat` matches a profile name, a full model id, or a mapping alias.
 */
export function loadQuotaOverrides(stateDir?: string): QuotaExhaustion[] {
  const path = quotaFilePath(stateDir);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new ModelEvalError(
      "MODEL_EVAL_BAD_CACHE",
      `Quota file at ${path} is not valid JSON: ${(error as Error).message}`
    );
  }
  const rec =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  const list = rec !== null && Array.isArray(rec["exhausted"]) ? rec["exhausted"] : null;
  if (list === null) {
    throw new ModelEvalError(
      "MODEL_EVAL_BAD_CACHE",
      `Quota file at ${path} misses exhausted[].`
    );
  }
  const out: QuotaExhaustion[] = [];
  for (const item of list as unknown[]) {
    const r =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : null;
    const seat = r?.["seat"];
    const until = r?.["until"];
    if (
      typeof seat !== "string" ||
      seat.length === 0 ||
      typeof until !== "string" ||
      !Number.isFinite(new Date(until).getTime())
    ) {
      throw new ModelEvalError(
        "MODEL_EVAL_BAD_CACHE",
        `Quota file at ${path} has a malformed entry (want { seat, until ISO }): ${JSON.stringify(item)}.`
      );
    }
    out.push({
      seat,
      until,
      note: typeof r?.["note"] === "string" ? (r?.["note"] as string) : ""
    });
  }
  return out;
}

/** True while `now < until` (invalid dates never exhaust — belt and braces, entries are validated at load). */
export function isSeatExhausted(
  seat: string,
  overrides: readonly QuotaExhaustion[],
  now: Date = new Date()
): QuotaExhaustion | undefined {
  const needle = seat.toLowerCase();
  return overrides.find((o) => {
    if (o.seat.toLowerCase() !== needle) return false;
    const until = new Date(o.until).getTime();
    return Number.isFinite(until) && now.getTime() < until;
  });
}
