/**
 * Structured, secret-free request logging, sanitized upstream failure
 * extraction, and h2a-side upstream-429 preservation for the local gateway.
 *
 * Security boundary: NEVER logs request prompts, messages, Authorization /
 * API-key headers, OAuth tokens, raw account secrets, or free-form upstream
 * error prose (which may echo user input, emails, or project identifiers).
 */
import { AsyncLocalStorage } from "node:async_hooks";

const MAX_UPSTREAM_ERROR_BYTES = 16_384;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const MAX_COOLDOWN_ENTRIES = 512;

/** Allowlisted ASCII token characters for structured error codes/reasons/metrics. */
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9_.:/-]{1,160}$/;
/** Allowlisted characters for compact duration strings (e.g. "38s", "1h2m3s"). */
const SAFE_DURATION_RE = /^[0-9.a-zA-Z]{1,32}$/;
/** Patterns that must never survive into a log field. */
const SECRET_LIKE_RE = /(?:ya29\.|GOCSPX-|sk-|gw-v2-|Bearer\s|@|eyJ[A-Za-z0-9_-]+\.)/i;

export interface SanitizedUpstreamError {
  readonly status?: number;
  readonly endpoint?: string;
  readonly errorStatus?: string;
  readonly errorType?: string;
  readonly errorCode?: string | number;
  readonly reasons?: readonly string[];
  readonly retryDelay?: string;
  readonly retryAfterSeconds?: number;
  readonly quotaMetrics?: readonly string[];
  readonly model?: string;
}

export interface GatewayAttemptLogEntry {
  readonly provider: string;
  readonly model: string;
  readonly transport: string;
  /** Redacted diagnostic account ref (never an executable account secret). */
  readonly accountId: string;
  readonly outcome: string;
  readonly retryAfterSeconds?: number;
}

export interface GatewayRequestLogEntry {
  readonly time: string;
  readonly route: string;
  readonly method: string;
  readonly requestedModel: string | null;
  readonly rewrittenModel?: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly transport: string | null;
  /** Redacted diagnostic account ref (never an executable account secret). */
  readonly accountId: string | null;
  readonly status: number;
  readonly latencyMs: number;
  readonly outcome?: string;
  readonly planError?: string;
  readonly planDiagnostics?: readonly { readonly code?: string; readonly transport?: string }[];
  readonly remappedFrom?: number;
  readonly retryAfterSeconds?: number;
  readonly upstream?: SanitizedUpstreamError;
  readonly attempts?: readonly GatewayAttemptLogEntry[];
}

export interface PlannedCandidateDiagnostic {
  readonly candidateRef: string;
  readonly provider: string;
  readonly model: string;
  readonly transport: string;
  readonly accountId: string;
}

export interface GatewayRequestTrace {
  readonly startedAtMs: number;
  readonly time: string;
  readonly method: string;
  readonly route: string;
  requestedModel?: string;
  rewrittenModel?: string;
  negativeCacheTtlMs?: number;
  readonly plannedByCandidate: Map<string, PlannedCandidateDiagnostic>;
  resolved?: PlannedCandidateDiagnostic;
  readonly attempts: GatewayAttemptLogEntry[];
  readonly upstreamFailures: SanitizedUpstreamError[];
  planError?: {
    readonly code?: string;
    readonly diagnostics?: readonly { readonly code?: string; readonly transport?: string }[];
  };
}

export const requestTraceStorage = new AsyncLocalStorage<GatewayRequestTrace>();

export function createRequestTrace(method: string, route: string, nowMs = Date.now()): GatewayRequestTrace {
  return {
    startedAtMs: nowMs,
    time: new Date(nowMs).toISOString(),
    method,
    route,
    plannedByCandidate: new Map(),
    attempts: [],
    upstreamFailures: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || !SAFE_IDENTIFIER_RE.test(trimmed)) return undefined;
  if (SECRET_LIKE_RE.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeDuration(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || !SAFE_DURATION_RE.test(trimmed)) return undefined;
  if (SECRET_LIKE_RE.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeEndpoint(url: unknown): string | undefined {
  if (typeof url !== "string" || !url) return undefined;
  try {
    const parsed = new URL(url);
    return sanitizeIdentifier(parsed.pathname);
  } catch {
    return undefined;
  }
}

function clampRetrySeconds(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

/**
 * Parse Google protobuf durations ("38s", "42.5s") and Go/Google metadata
 * durations ("500ms", "1h2m3s", "2m15s") into positive integer seconds.
 */
export function parseRetryDelaySeconds(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const protoMatch = /^(\d+(?:\.\d+)?)s$/i.exec(trimmed);
  if (protoMatch?.[1]) {
    return clampRetrySeconds(Number.parseFloat(protoMatch[1]));
  }
  let totalSeconds = 0;
  let matched = false;
  let consumedLength = 0;
  const partRe = /(\d+(?:\.\d+)?)(ms|s|m|h)/gi;
  for (const match of trimmed.matchAll(partRe)) {
    const numStr = match[1];
    const unit = match[2]?.toLowerCase();
    if (!numStr || !unit) continue;
    const value = Number.parseFloat(numStr);
    if (!Number.isFinite(value)) return undefined;
    matched = true;
    consumedLength += match[0].length;
    if (unit === "ms") totalSeconds += value / 1000;
    else if (unit === "s") totalSeconds += value;
    else if (unit === "m") totalSeconds += value * 60;
    else if (unit === "h") totalSeconds += value * 3600;
  }
  if (!matched || consumedLength !== trimmed.length) return undefined;
  return clampRetrySeconds(totalSeconds);
}

/** Parse an HTTP Retry-After header (delta-seconds or HTTP-date) into seconds. */
export function parseRetryAfterHeaderSeconds(
  raw: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    return clampRetrySeconds(Number.parseInt(trimmed, 10));
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs) && dateMs > nowMs) {
    return clampRetrySeconds((dateMs - nowMs) / 1000);
  }
  return undefined;
}

function unwrapErrorEnvelope(parsed: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const rec = asRecord(item);
      const inner = asRecord(rec?.error);
      if (inner) return inner;
    }
    return undefined;
  }
  const rec = asRecord(parsed);
  if (!rec) return undefined;
  return asRecord(rec.error) ?? rec;
}

/**
 * Extract only allowlisted, sanitized structured error fields from an upstream
 * HTTP failure response. Never returns raw message text, prompts, or secrets.
 */
export function extractSanitizedUpstreamError(input: {
  readonly status?: number;
  readonly headers?: Headers;
  readonly bodyText?: string;
  readonly url?: string;
  readonly nowMs?: number;
}): SanitizedUpstreamError {
  const nowMs = input.nowMs ?? Date.now();
  const endpoint = sanitizeEndpoint(input.url);
  const headerRetrySeconds = parseRetryAfterHeaderSeconds(
    input.headers?.get("retry-after"),
    nowMs,
  );

  let errorStatus: string | undefined;
  let errorType: string | undefined;
  let errorCode: string | number | undefined;
  const reasons = new Set<string>();
  const quotaMetrics = new Set<string>();
  let retryInfoDelay: string | undefined;
  let retryInfoSeconds: number | undefined;
  let metadataRetryDelay: string | undefined;
  let metadataRetrySeconds: number | undefined;
  let model: string | undefined;

  if (input.bodyText) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.bodyText.slice(0, MAX_UPSTREAM_ERROR_BYTES)) as unknown;
    } catch {
      parsed = undefined;
    }
    const errObj = unwrapErrorEnvelope(parsed);
    if (errObj) {
      errorStatus = sanitizeIdentifier(errObj.status);
      errorType = sanitizeIdentifier(errObj.type);
      if (typeof errObj.code === "number" && Number.isInteger(errObj.code)) {
        errorCode = errObj.code;
      } else {
        errorCode = sanitizeIdentifier(errObj.code);
      }

      const details = Array.isArray(errObj.details) ? errObj.details : [];
      for (const rawDetail of details) {
        const detail = asRecord(rawDetail);
        if (!detail) continue;

        const reason = sanitizeIdentifier(detail.reason);
        if (reason) reasons.add(reason);

        const rawRetryDelay = sanitizeDuration(detail.retryDelay);
        if (rawRetryDelay && !retryInfoDelay) {
          retryInfoDelay = rawRetryDelay;
          retryInfoSeconds = parseRetryDelaySeconds(rawRetryDelay);
        }

        const metadata = asRecord(detail.metadata);
        if (metadata) {
          const metaModel = sanitizeIdentifier(metadata.model);
          if (metaModel && !model) model = metaModel;
          const metaDelay = sanitizeDuration(metadata.quotaResetDelay);
          if (metaDelay) {
            if (!metadataRetryDelay) metadataRetryDelay = metaDelay;
            if (metadataRetrySeconds === undefined) {
              metadataRetrySeconds = parseRetryDelaySeconds(metaDelay);
            }
          }
          if (metadataRetrySeconds === undefined && typeof metadata.quotaResetTimeStamp === "string") {
            const tsMs = Date.parse(metadata.quotaResetTimeStamp);
            if (Number.isFinite(tsMs) && tsMs > nowMs) {
              metadataRetrySeconds = clampRetrySeconds((tsMs - nowMs) / 1000);
            }
          }
        }

        const violations = Array.isArray(detail.violations) ? detail.violations : [];
        for (const rawViolation of violations) {
          const violation = asRecord(rawViolation);
          if (!violation) continue;
          const metric = sanitizeIdentifier(violation.quotaMetric);
          if (metric) quotaMetrics.add(metric);
          const quotaId = sanitizeIdentifier(violation.quotaId);
          if (quotaId) quotaMetrics.add(quotaId);
          const dims = asRecord(violation.quotaDimensions);
          const dimModel = sanitizeIdentifier(dims?.model);
          if (dimModel && !model) model = dimModel;
        }
      }
    }
  }

  const retryDelay = retryInfoDelay ?? metadataRetryDelay;
  const retryAfterSeconds = headerRetrySeconds ?? retryInfoSeconds ?? metadataRetrySeconds;

  return {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(errorStatus ? { errorStatus } : {}),
    ...(errorType ? { errorType } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(reasons.size > 0 ? { reasons: [...reasons] } : {}),
    ...(retryDelay ? { retryDelay } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(quotaMetrics.size > 0 ? { quotaMetrics: [...quotaMetrics] } : {}),
    ...(model ? { model } : {}),
  };
}

function requestUrlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function readBoundedErrorText(response: Response): Promise<string | undefined> {
  try {
    const cloned = response.clone();
    const reader = cloned.body?.getReader();
    if (!reader) {
      return (await cloned.text()).slice(0, MAX_UPSTREAM_ERROR_BYTES);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < MAX_UPSTREAM_ERROR_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const remaining = MAX_UPSTREAM_ERROR_BYTES - total;
        chunks.push(value.byteLength > remaining ? value.subarray(0, remaining) : value);
        total += Math.min(value.byteLength, remaining);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } catch {
    return undefined;
  }
}

/**
 * Wrap the upstream provider fetch used by llm-mesh runtime clients.
 * On any non-2xx response (or network error), extracts sanitized structured
 * error metadata into the active AsyncLocalStorage request trace.
 *
 * When upstream returns 429 with Google JSON RetryInfo.retryDelay (or
 * quotaResetDelay) and no HTTP Retry-After header, forwards that delay as
 * an HTTP Retry-After header so llm-mesh's adapter and health cache honor
 * the provider's requested window instead of falling back to 300s.
 */
export function createObservedUpstreamFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = requestUrlOf(input);
    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (error) {
      const trace = requestTraceStorage.getStore();
      if (trace) {
        const rec = asRecord(error);
        const rawCode = rec?.code ?? (error instanceof Error ? error.name : undefined);
        const errorCode = sanitizeIdentifier(rawCode);
        const endpoint = sanitizeEndpoint(url);
        trace.upstreamFailures.push({
          ...(endpoint ? { endpoint } : {}),
          ...(errorCode ? { errorCode } : {}),
        });
      }
      throw error;
    }

    if (response.ok) return response;

    const bodyText = await readBoundedErrorText(response);
    const extracted = extractSanitizedUpstreamError({
      status: response.status,
      headers: response.headers,
      ...(bodyText !== undefined ? { bodyText } : {}),
      url,
    });
    const trace = requestTraceStorage.getStore();
    if (trace) {
      trace.upstreamFailures.push(extracted);
    }

    if (
      response.status === 429 &&
      !response.headers.has("retry-after") &&
      extracted.retryAfterSeconds !== undefined &&
      extracted.retryAfterSeconds > 0
    ) {
      const headers = new Headers(response.headers);
      headers.set("retry-after", String(extracted.retryAfterSeconds));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  };
}

export interface RateLimitCooldownRecord {
  readonly untilMs: number;
  readonly provider?: string;
  readonly model?: string;
  readonly transport?: string;
  readonly accountId?: string;
  readonly upstream?: SanitizedUpstreamError;
}

export interface ActiveRateLimitCooldown {
  readonly remainingSeconds: number;
  readonly provider?: string;
  readonly model?: string;
  readonly transport?: string;
  readonly accountId?: string;
  readonly upstream?: SanitizedUpstreamError;
}

/**
 * Bounded per-host memory of active upstream 429 cooldowns so that when
 * llm-mesh's InMemoryRouteHealth or account cooldown suppresses the only
 * candidate(s) and throws RoutePlanError('no-route'), h2a preserves 429
 * (with remaining Retry-After) instead of masking it as 503 No route.
 */
export class RateLimitCooldownTracker {
  private readonly entries = new Map<string, RateLimitCooldownRecord>();

  private key(ownerScopeRef: string, requestedModel: string): string {
    return `${ownerScopeRef}\u001f${requestedModel}`;
  }

  record(
    ownerScopeRef: string,
    requestedModel: string,
    input: {
      readonly ttlMs: number;
      readonly nowMs?: number;
      readonly provider?: string;
      readonly model?: string;
      readonly transport?: string;
      readonly accountId?: string;
      readonly upstream?: SanitizedUpstreamError;
    },
  ): void {
    const nowMs = input.nowMs ?? Date.now();
    const ttlMs = Math.min(Math.max(input.ttlMs, 1_000), 3_600_000);
    const entryKey = this.key(ownerScopeRef, requestedModel);
    this.entries.delete(entryKey);
    this.entries.set(entryKey, {
      untilMs: nowMs + ttlMs,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.transport ? { transport: input.transport } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.upstream ? { upstream: input.upstream } : {}),
    });
    this.evict(nowMs);
  }

  clear(ownerScopeRef: string, requestedModel: string): void {
    this.entries.delete(this.key(ownerScopeRef, requestedModel));
  }

  getActive(
    ownerScopeRef: string,
    requestedModel: string,
    nowMs = Date.now(),
  ): ActiveRateLimitCooldown | undefined {
    this.evict(nowMs);
    const entry = this.entries.get(this.key(ownerScopeRef, requestedModel));
    if (!entry || entry.untilMs <= nowMs) return undefined;
    return {
      remainingSeconds: Math.max(1, Math.ceil((entry.untilMs - nowMs) / 1000)),
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.transport ? { transport: entry.transport } : {}),
      ...(entry.accountId ? { accountId: entry.accountId } : {}),
      ...(entry.upstream ? { upstream: entry.upstream } : {}),
    };
  }

  private evict(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.untilMs <= nowMs) this.entries.delete(key);
    }
    while (this.entries.size > MAX_COOLDOWN_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export const INFERENCE_ROUTES = new Set([
  "/v1/messages",
  "/v1/chat/completions",
  "/responses",
  "/v1/responses",
]);

/**
 * Build a wire-appropriate HTTP 429 rate-limit response from a 503 response
 * that masked an upstream 429. Removes `x-should-retry: false`, sets
 * `Retry-After`, and preserves gateway correlation headers.
 */
export function remapRateLimited503Response(
  original: Response,
  route: string,
  retryAfterSeconds: number,
): Response {
  const safeRetry = Math.max(1, Math.min(Math.ceil(retryAfterSeconds), MAX_RETRY_AFTER_SECONDS));
  const headers = new Headers();
  const requestId = original.headers.get("x-sentropic-request-id");
  if (requestId) headers.set("x-sentropic-request-id", requestId);
  const served = original.headers.get("x-sentropic-served");
  if (served) headers.set("x-sentropic-served", served);
  headers.set("content-type", "application/json; charset=UTF-8");
  headers.set("retry-after", String(safeRetry));

  const body = route === "/v1/messages"
    ? {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "upstream rate limit exceeded",
        },
      }
    : {
        error: {
          message: "upstream rate limit exceeded",
          type: "rate_limit_error",
          code: "rate_limit_exceeded",
        },
      };

  return new Response(JSON.stringify(body), {
    status: 429,
    headers,
  });
}

export function formatGatewayRequestLogLine(entry: GatewayRequestLogEntry): string {
  return `[gateway-host] request ${JSON.stringify(entry)}\n`;
}

/**
 * Safely extract a thrown adapter error's sanitized status/code/retry info
 * when an error originates inside an adapter without going through fetch
 * (e.g. CloudCodeRuntimeClient catalogue miss 404 or a test mock planner).
 */
export function extractSanitizedThrownError(error: unknown): SanitizedUpstreamError | undefined {
  const rec = asRecord(error);
  if (!rec) return undefined;
  const status = typeof rec.statusCode === "number"
    ? rec.statusCode
    : typeof rec.status === "number"
      ? rec.status
      : undefined;
  const errorCode = typeof rec.code === "number" && Number.isInteger(rec.code)
    ? rec.code
    : sanitizeIdentifier(rec.code);
  const errorType = sanitizeIdentifier(rec.type);
  const retryAfterMs = typeof rec.retryAfterMs === "number" && rec.retryAfterMs > 0
    ? rec.retryAfterMs
    : undefined;
  const retryAfterSeconds = retryAfterMs !== undefined
    ? clampRetrySeconds(retryAfterMs / 1000)
    : undefined;
  if (
    status === undefined &&
    errorCode === undefined &&
    errorType === undefined &&
    retryAfterSeconds === undefined
  ) {
    return undefined;
  }
  return {
    ...(status !== undefined ? { status } : {}),
    ...(errorType ? { errorType } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}
