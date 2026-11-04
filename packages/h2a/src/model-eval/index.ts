/**
 * model-eval public surface (re-exported by the package index).
 */
export type {
  AaIndexCache,
  AaModelEntry,
  ModelEvalCandidate,
  ModelEvalEffort,
  ModelEvalExclusion,
  ModelEvalMappingRow,
  ModelEvalOutcome,
  ModelEvalProfile,
  ModelEvalRecommendation,
  ModelEvalRole,
  QuotaExhaustion
} from "./types.js";
export {
  MODEL_EVAL_EFFORTS,
  MODEL_EVAL_ERROR_CODES,
  MODEL_EVAL_PROFILES,
  MODEL_EVAL_ROLES,
  ModelEvalError
} from "./types.js";
export { MODEL_EVAL_MAPPING, MODEL_EVAL_MAPPING_REVIEWED } from "./mapping.js";
export { isOpusSlug, mapAaToH2a } from "./mapping.js";
export {
  AA_API_BASE,
  AA_API_KEY_ENV,
  AA_FREE_ENDPOINT,
  MODEL_EVAL_CACHE_FILE,
  MODEL_EVAL_QUOTA_FILE,
  MODEL_EVAL_STATE_SUBDIR,
  cacheFilePath,
  fetchAaIndex,
  isSeatExhausted,
  loadCache,
  loadQuotaOverrides,
  normalizeAaModel,
  quotaFilePath,
  resolveModelEvalStateDir,
  saveCache
} from "./store.js";
export type { AaFetchResult, FetchFn } from "./store.js";
export {
  BUILD_MIN_INTEL_ENV,
  DEFAULT_BUILD_MIN_INTELLIGENCE,
  DESIGN_MIN_INTELLIGENCE,
  collectCandidates,
  maxEffortFor,
  recommend,
  renderRunCommand,
  resolveBuildMinIntelligence
} from "./recommend.js";
export type { RecommendInput } from "./recommend.js";
