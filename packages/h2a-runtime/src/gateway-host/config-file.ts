/** Public host configuration only; provider credentials stay upstream. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  modelProfiles,
  type ModelProfile,
  type ReasoningEffort,
} from "@sentropic/cluster-mesh/llm-mesh";
import {
  isKnownGatewayModel,
  MODEL_LAUNCH_AVAILABILITY,
  type GatewayModelId,
} from "../gateway-model-catalog/model-catalog.js";
import { validateLlmMeshRoutingConfig, type LlmMeshRoutingConfig } from "../routing-preferences.js";

/** Reasoning effort ladder shared with llm-mesh (`ReasoningEffort`). */
export type ModelRewriteEffort = ReasoningEffort;

export interface GatewayModelRewriteMatch {
  /** Requested model id, with or without its effort suffix. */
  readonly model: string;
  /** Requested effort rung; absent matches every effort. */
  readonly effort?: ModelRewriteEffort;
}

export interface GatewayModelRewriteTarget {
  /** Gateway catalog model that serves the rewritten request. */
  readonly model: string;
  /** Effort rung applied to the rewritten request. */
  readonly effort: ModelRewriteEffort;
}

export interface GatewayModelRewrite {
  readonly match: GatewayModelRewriteMatch;
  readonly target: GatewayModelRewriteTarget;
}

export interface LlmMeshConfig {
  /** Deprecated migration sinks. Never returned or persisted. */
  accounts?: readonly unknown[];
  meshAccounts?: readonly unknown[];
  /** Local port for the gateway. Default: 3002 */
  port?: number;
  /** Log file path (stdout+stderr of the gateway process). Default: ~/.sentropic/llm-mesh.log */
  logFile?: string;
  /** Public host routing policy. Provider/model knowledge remains in llm-mesh. */
  routing?: LlmMeshRoutingConfig;
  /**
   * Optional request rewrites applied by the local gateway host before
   * llm-mesh routing. Absent or empty keeps the previous behaviour.
   */
  modelRewrites?: readonly GatewayModelRewrite[];
}

export function sentropicDir(): string {
  return join(homedir(), ".sentropic");
}

/** Stable local owner, shared by account enrollment and gateway routing. */
export function llmMeshOwnerScopeRef(): string {
  return process.env.H2A_LLM_MESH_OWNER_SCOPE?.trim() || `cli:${hostname()}`;
}

export function llmMeshConfigPath(dir?: string): string {
  return join(dir ?? sentropicDir(), "llm-mesh.json");
}

const MODEL_REWRITE_EFFORTS: readonly ModelRewriteEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Effort suffixes carried by launch model ids (never `none`). */
const EFFORT_SUFFIX = /-(low|medium|high|xhigh|max)$/;

// Same narrow-cast as routing-preferences: the published llm-mesh catalog
// literal does not satisfy its own `ModelProfile` under
// exactOptionalPropertyTypes.
const MESH_MODEL_PROFILES = modelProfiles as unknown as readonly ModelProfile[];

function isModelRewriteEffort(value: unknown): value is ModelRewriteEffort {
  return typeof value === "string"
    && (MODEL_REWRITE_EFFORTS as readonly string[]).includes(value);
}

/** Model id without its effort suffix, when the id carries one. */
export function baseModelId(model: string): string {
  const suffix = EFFORT_SUFFIX.exec(model);
  return suffix ? model.slice(0, model.length - suffix[0].length) : model;
}

function effortSuffixOf(model: string): ModelRewriteEffort | undefined {
  const suffix = EFFORT_SUFFIX.exec(model);
  return suffix ? (suffix[1] as ModelRewriteEffort) : undefined;
}

function meshProfileForModel(model: string): ModelProfile | undefined {
  return MESH_MODEL_PROFILES.find((profile) => profile.modelId === model)
    ?? MESH_MODEL_PROFILES.find((profile) => profile.modelId === baseModelId(model));
}

function describeRewriteEntry(entry: GatewayModelRewrite): string {
  return `match "${entry?.match?.model}" -> target "${entry?.target?.model}"`
    + ` (effort "${entry?.target?.effort}")`;
}

/**
 * Validate `modelRewrites` at load. Every failure names the offending entry:
 * the target must be a routable gateway catalog model, the target effort
 * must be allowed for that model, and the model graph must stay single-hop
 * (no chains, no loops). Returns the validated list (`[]` when absent).
 */
export function validateModelRewrites(
  rewrites: readonly GatewayModelRewrite[] | undefined,
): readonly GatewayModelRewrite[] {
  if (!rewrites || rewrites.length === 0) return [];
  const matchBases: string[] = [];
  const seenMatches = new Set<string>();
  rewrites.forEach((entry, index) => {
    const label = `modelRewrites[${index}] (${describeRewriteEntry(entry)})`;
    if (!entry || typeof entry !== "object" || !entry.match || !entry.target) {
      throw new Error(`invalid ${label}: each entry needs a match and a target`);
    }
    if (typeof entry.match.model !== "string" || !entry.match.model.trim()) {
      throw new Error(`invalid ${label}: match.model must be a non-empty string`);
    }
    if (entry.match.effort !== undefined && !isModelRewriteEffort(entry.match.effort)) {
      throw new Error(
        `invalid ${label}: match effort "${String(entry.match.effort)}" is not an effort rung`
        + ` (expected ${MODEL_REWRITE_EFFORTS.join(", ")})`,
      );
    }
    if (typeof entry.target.model !== "string" || !entry.target.model.trim()) {
      throw new Error(`invalid ${label}: target.model must be a non-empty string`);
    }
    if (!isModelRewriteEffort(entry.target.effort)) {
      throw new Error(
        `invalid ${label}: target effort "${String(entry.target.effort)}" is not an effort rung`
        + ` (expected ${MODEL_REWRITE_EFFORTS.join(", ")})`,
      );
    }
    if (!isKnownGatewayModel(entry.target.model)) {
      throw new Error(
        `invalid ${label}: target model "${entry.target.model}" is not in the gateway catalog`,
      );
    }
    const targetId = entry.target.model as GatewayModelId;
    if (!MODEL_LAUNCH_AVAILABILITY[targetId].gatewayRoute) {
      throw new Error(
        `invalid ${label}: target model "${entry.target.model}" is not routable through the gateway`,
      );
    }
    const profile = meshProfileForModel(entry.target.model);
    if (!profile) {
      throw new Error(
        `invalid ${label}: target model "${entry.target.model}" has no llm-mesh catalog profile`,
      );
    }
    const supportedEfforts = profile.capabilities.reasoning.supportedEfforts;
    if (profile.capabilities.reasoning.support === "unsupported"
      || (supportedEfforts && supportedEfforts.length > 0
        && !supportedEfforts.includes(entry.target.effort))) {
      throw new Error(
        `invalid ${label}: effort "${entry.target.effort}" is not allowed for model`
        + ` "${entry.target.model}"`
        + (supportedEfforts && supportedEfforts.length > 0
          ? ` (allowed: ${supportedEfforts.join(", ")})`
          : ""),
      );
    }
    const matchKey = `${entry.match.model}|${entry.match.effort ?? ""}`;
    if (seenMatches.has(matchKey)) {
      throw new Error(`invalid ${label}: duplicate match (model + effort already rewritten)`);
    }
    seenMatches.add(matchKey);
    matchBases.push(baseModelId(entry.match.model));
  });
  rewrites.forEach((entry, index) => {
    const label = `modelRewrites[${index}] (${describeRewriteEntry(entry)})`;
    const targetBase = baseModelId(entry.target.model);
    if (targetBase === matchBases[index]) {
      throw new Error(
        `invalid ${label}: target model "${entry.target.model}" loops back to its own`
        + " match model (loops are not allowed)",
      );
    }
    const chained = matchBases.indexOf(targetBase);
    if (chained >= 0) {
      throw new Error(
        `invalid ${label}: target model "${entry.target.model}" is itself matched by`
        + ` modelRewrites[${chained}] (chains are not allowed)`,
      );
    }
  });
  return rewrites;
}

export interface MatchedModelRewrite {
  readonly entry: GatewayModelRewrite;
  /** Model id exactly as requested by the client. */
  readonly fromModel: string;
  /** Requested effort rung, when the request carries one. */
  readonly requestedEffort?: ModelRewriteEffort;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Requested effort of an incoming gateway request body. Claude Code carries
 * the effort in the model id suffix (launch alias such as
 * `claude-opus-5-5-medium`) or in an explicit `reasoning.effort` /
 * `reasoning_effort` field; `thinking.budget_tokens` is a token ceiling and
 * never selects a rung by itself. Explicit fields win over the suffix.
 */
export function requestedEffortOf(body: Record<string, unknown>): ModelRewriteEffort | undefined {
  const reasoning = asRecord(body.reasoning);
  if (isModelRewriteEffort(reasoning?.effort)) return reasoning.effort;
  if (isModelRewriteEffort(body.reasoning_effort)) return body.reasoning_effort;
  return typeof body.model === "string" ? effortSuffixOf(body.model) : undefined;
}

/**
 * First entry matching the request body, in config order. An entry matches
 * when its model equals the requested id or its effort-stripped base, and
 * its effort (when set) equals the requested effort.
 */
export function matchModelRewrite(
  rewrites: readonly GatewayModelRewrite[],
  body: Record<string, unknown>,
): MatchedModelRewrite | undefined {
  if (typeof body.model !== "string" || !body.model) return undefined;
  const fromModel = body.model;
  const base = baseModelId(fromModel);
  const requestedEffort = requestedEffortOf(body);
  for (const entry of rewrites) {
    if (entry.match.model !== fromModel && entry.match.model !== base) continue;
    if (entry.match.effort !== undefined && entry.match.effort !== requestedEffort) continue;
    return {
      entry,
      fromModel,
      ...(requestedEffort !== undefined ? { requestedEffort } : {}),
    };
  }
  return undefined;
}

/**
 * Rewritten body: target model plus the target effort on every effort
 * carrier the canonical ingress reads. `thinking` (budget included) is
 * preserved untouched.
 */
export function applyModelRewrite(
  body: Record<string, unknown>,
  entry: GatewayModelRewrite,
): Record<string, unknown> {
  const reasoning = asRecord(body.reasoning);
  return {
    ...body,
    model: entry.target.model,
    reasoning: { ...(reasoning ?? {}), effort: entry.target.effort },
    ...(typeof body.reasoning_effort === "string"
      ? { reasoning_effort: entry.target.effort }
      : {}),
  };
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writePrivateMetadata(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function readLlmMeshConfig(dir?: string): LlmMeshConfig | null {
  const config = readJson<Omit<LlmMeshConfig, "accounts" | "meshAccounts"> & {
    accounts?: unknown;
    meshAccounts?: unknown;
  }>(llmMeshConfigPath(dir));
  if (!config) return null;
  const { accounts: _legacyAccounts, meshAccounts: _legacyPublicIds, ...publicConfig } = config;
  return publicConfig;
}

export function writeLlmMeshConfig(config: LlmMeshConfig, dir?: string): void {
  // The facade/keyring own credentials. Keep only public enrollment metadata
  // in llm-mesh.json, including when migrating a pre-facade configuration.
  const {
    accounts: _legacyCredentialRecords,
    meshAccounts: _legacyPublicIds,
    ...publicConfig
  } = config;
  if (publicConfig.routing) validateLlmMeshRoutingConfig(publicConfig.routing);
  if (publicConfig.modelRewrites) validateModelRewrites(publicConfig.modelRewrites);
  writePrivateMetadata(llmMeshConfigPath(dir), publicConfig);
}

export function updateLlmMeshRoutingConfig(
  routing: LlmMeshRoutingConfig | undefined,
  dir?: string,
): LlmMeshConfig {
  const config = readLlmMeshConfig(dir) ?? {};
  const next = routing
    ? { ...config, routing: validateLlmMeshRoutingConfig(routing) }
    : (() => {
        const copy = { ...config };
        delete copy.routing;
        return copy;
      })();
  writeLlmMeshConfig(next, dir);
  return next;
}

