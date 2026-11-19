/**
 * Bounded Cloud Code 429 RESOURCE_EXHAUSTED retry-with-backoff and sanitized
 * retry-metadata extraction for the local h2a gateway.
 *
 * Mirrors @google/gemini-cli's classification & retry policy
 * (packages/core/src/utils/googleQuotaErrors.ts and retry.ts) without forking
 * or patching the upstream mesh SDK:
 * - Parses Google RPC error details (ErrorInfo, RetryInfo.retryDelay,
 *   QuotaFailure, quotaResetDelay, quotaResetTimeStamp) and HTTP Retry-After.
 * - Retries transient capacity/rate-limit 429s before CloudCodeProviderAdapter
 *   records a rate_limited outcome, so recovered transients never trigger
 *   llm-mesh's 60s account cooldown or 300s route-health suppression.
 * - Fails fast (no retry) on terminal quota exhaustion (PerDay/Daily,
 *   QUOTA_EXHAUSTED, INSUFFICIENT_G1_CREDITS_BALANCE, limit: 0, spending cap,
 *   or server-requested delay exceeding maxRetryDelayMs).
 * - When retries are exhausted on a transient/capacity 429, forwards the
 *   provider's retryDelay (or a short bounded transient fallback) as an HTTP
 *   Retry-After header so CloudCodeProviderAdapter / llm-mesh apply a bounded
 *   cooldown instead of falling back to 60s account / 300s route locks.
 *
 * Security boundary: NEVER logs Authorization headers, OAuth tokens, API keys,
 * prompts, emails, project identifiers, or free-form upstream prose.
 */

const MAX_ERROR_BODY_BYTES = 16_384;
const MAX_RETRY_AFTER_HEADER_SECONDS = 3_600;

/** Cloud Code API hosts eligible for 429 retry handling. */
const CLOUD_CODE_HOSTS = new Set([
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "staging-cloudcode-pa.googleapis.com",
  "autopush-cloudcode-pa.googleapis.com",
]);

/** Allowlisted ASCII tokens for structured RPC codes/reasons/quota ids. */
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9_.:/-]{1,160}$/;
/** Allowlisted compact duration strings (e.g. "3s", "1.5s", "500ms", "1m2s"). */
const SAFE_DURATION_RE = /^[0-9.a-zA-Z]{1,32}$/;
/** Secret-like substrings that must never survive into any log field. */
const SECRET_LIKE_RE = /(?:ya29\.|GOCSPX-|sk-|gw-v2-|Bearer\s|@|eyJ[A-Za-z0-9_-]+\.)/i;

const CAPACITY_MESSAGE_RE = /exhausted your capacity|capacity exceeded|MODEL_CAPACITY_EXHAUSTED/i;
const LIMIT_ZERO_RE = /limit:\s*0(?!\d|\.\d)/i;
const SPENDING_CAP_RE = /\b(spending|spend)\s+cap\b/i;
const PLEASE_RETRY_RE = /Please retry in ([0-9.]+(?:ms|s))/i;

export type CloudCode429Classification = "capacity" | "transient" | "terminal";

export interface SanitizedCloudCode429 {
  readonly endpoint?: string;
  readonly errorStatus?: string;
  readonly errorCode?: string | number;
  readonly reasons?: readonly string[];
  readonly domain?: string;
  readonly retryDelay?: string;
  readonly retryAfterMs?: number;
  readonly quotaIds?: readonly string[];
  readonly classification: CloudCode429Classification;
}

export interface CloudCodeRetryLogEvent {
  readonly event: "retry" | "recovered" | "exhausted" | "terminal";
  readonly endpoint?: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly status: number;
  readonly classification?: CloudCode429Classification;
  readonly errorStatus?: string;
  readonly reasons?: readonly string[];
  readonly retryDelay?: string;
  readonly delayMs?: number;
  readonly retryAfterSeconds?: number;
  readonly totalWaitMs?: number;
}

export interface CloudCodeRetryPolicy {
  /** Maximum total attempts (initial try + retries) for transient 429s. */
  readonly maxAttempts?: number;
  /**
   * Maximum total attempts for MODEL_CAPACITY_EXHAUSTED / EXCEEDED
   * (mirrors Gemini CLI MAX_SILENT_CAPACITY_ATTEMPTS = 3).
   */
  readonly maxCapacityAttempts?: number;
  /** Initial exponential backoff delay when upstream supplies no retryDelay. */
  readonly initialDelayMs?: number;
  /** Upper bound for exponential backoff when upstream supplies no retryDelay. */
  readonly maxDelayMs?: number;
  /**
   * Maximum single server-requested retryDelay we will wait inside one gateway
   * HTTP request; larger requested delays are treated as terminal for this
   * request and forwarded via Retry-After.
   */
  readonly maxRetryDelayMs?: number;
  /** Hard cap on cumulative retry wait time across all attempts for one request. */
  readonly maxTotalWaitMs?: number;
  /**
   * Fallback HTTP Retry-After seconds synthesized when a transient/capacity 429
   * exhausts retries without an upstream Retry-After / retryDelay, preventing
   * llm-mesh from falling back to its 60s account / 300s route-health locks.
   */
  readonly transientFallbackCooldownSeconds?: number;
  /** Injectable sleep for deterministic tests. */
  readonly sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  /** Injectable RNG in [0, 1) for deterministic jitter in tests. */
  readonly random?: () => number;
  /** Structured sanitized log sink (defaults to process.stdout.write). */
  readonly onLog?: (event: CloudCodeRetryLogEvent) => void;
}

export interface ResolvedCloudCodeRetryPolicy {
  readonly maxAttempts: number;
  readonly maxCapacityAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRetryDelayMs: number;
  readonly maxTotalWaitMs: number;
  readonly transientFallbackCooldownSeconds: number;
  readonly sleep: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  readonly random: () => number;
  readonly onLog: (event: CloudCodeRetryLogEvent) => void;
}

function createAbortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

export function defaultAbortableSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function formatCloudCodeRetryLogLine(event: CloudCodeRetryLogEvent): string {
  return `[gateway-host] cloud-code-retry ${JSON.stringify(event)}\n`;
}

export const DEFAULT_CLOUD_CODE_RETRY_POLICY: ResolvedCloudCodeRetryPolicy = {
  maxAttempts: 5,
  maxCapacityAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 15_000,
  maxRetryDelayMs: 30_000,
  maxTotalWaitMs: 45_000,
  transientFallbackCooldownSeconds: 5,
  sleep: defaultAbortableSleep,
  random: Math.random,
  onLog: (event) => {
    process.stdout.write(formatCloudCodeRetryLogLine(event));
  },
};

function resolvePolicy(overrides?: CloudCodeRetryPolicy): ResolvedCloudCodeRetryPolicy {
  return {
    maxAttempts: Math.max(1, Math.floor(overrides?.maxAttempts ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.maxAttempts)),
    maxCapacityAttempts: Math.max(
      1,
      Math.floor(overrides?.maxCapacityAttempts ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.maxCapacityAttempts),
    ),
    initialDelayMs: Math.max(0, overrides?.initialDelayMs ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.initialDelayMs),
    maxDelayMs: Math.max(0, overrides?.maxDelayMs ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.maxDelayMs),
    maxRetryDelayMs: Math.max(0, overrides?.maxRetryDelayMs ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.maxRetryDelayMs),
    maxTotalWaitMs: Math.max(0, overrides?.maxTotalWaitMs ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.maxTotalWaitMs),
    transientFallbackCooldownSeconds: Math.max(
      1,
      Math.min(
        Math.ceil(
          overrides?.transientFallbackCooldownSeconds
            ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.transientFallbackCooldownSeconds,
        ),
        MAX_RETRY_AFTER_HEADER_SECONDS,
      ),
    ),
    sleep: overrides?.sleep ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.sleep,
    random: overrides?.random ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.random,
    onLog: overrides?.onLog ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.onLog,
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

function isCloudCodeDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const sanitized = domain.replace(/[^a-zA-Z0-9.-]/g, "");
  return CLOUD_CODE_HOSTS.has(sanitized);
}

/**
 * Parse Google protobuf durations ("3s", "1.5s", "500ms") and Go compound
 * durations ("1m30s", "1h2m3s") into positive milliseconds.
 */
export function parseGoogleDurationMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const protoMatch = /^(\d+(?:\.\d+)?)s$/i.exec(trimmed);
  if (protoMatch?.[1]) {
    const ms = Number.parseFloat(protoMatch[1]) * 1_000;
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined;
  }
  let totalMs = 0;
  let matched = false;
  let consumed = 0;
  const partRe = /(\d+(?:\.\d+)?)(ms|s|m|h)/gi;
  for (const match of trimmed.matchAll(partRe)) {
    const numStr = match[1];
    const unit = match[2]?.toLowerCase();
    if (!numStr || !unit) continue;
    const val = Number.parseFloat(numStr);
    if (!Number.isFinite(val)) return undefined;
    matched = true;
    consumed += match[0].length;
    if (unit === "ms") totalMs += val;
    else if (unit === "s") totalMs += val * 1_000;
    else if (unit === "m") totalMs += val * 60_000;
    else if (unit === "h") totalMs += val * 3_600_000;
  }
  if (!matched || consumed !== trimmed.length || totalMs <= 0) return undefined;
  return Math.round(totalMs);
}

/** Parse HTTP Retry-After header (delta-seconds or HTTP-date) into positive ms. */
export function parseRetryAfterHeaderMs(
  raw: string | null | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs) && dateMs > nowMs) {
    return Math.round(dateMs - nowMs);
  }
  return undefined;
}

function unwrapGoogleError(parsed: unknown): Record<string, unknown> | undefined {
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
 * Inspect and classify a Cloud Code HTTP 429 response, returning only
 * allowlisted sanitized metadata and a retry classification matching
 * @google/gemini-cli's googleQuotaErrors.ts.
 */
export function classifyCloudCode429(input: {
  readonly url?: string;
  readonly headers?: Headers;
  readonly bodyText?: string;
  readonly maxRetryDelayMs?: number;
  readonly nowMs?: number;
}): SanitizedCloudCode429 {
  const nowMs = input.nowMs ?? Date.now();
  const maxRetryDelayMs = input.maxRetryDelayMs ?? DEFAULT_CLOUD_CODE_RETRY_POLICY.maxRetryDelayMs;
  let endpoint: string | undefined;
  if (input.url) {
    try {
      endpoint = sanitizeIdentifier(new URL(input.url).pathname);
    } catch {
      endpoint = undefined;
    }
  }

  const headerRetryMs = parseRetryAfterHeaderMs(input.headers?.get("retry-after"), nowMs);

  let errorStatus: string | undefined;
  let errorCode: string | number | undefined;
  let rawMessage = "";
  const reasons = new Set<string>();
  const quotaIds = new Set<string>();
  let domain: string | undefined;
  let retryInfoDelay: string | undefined;
  let retryInfoMs: number | undefined;
  let metadataDelay: string | undefined;
  let metadataDelayMs: number | undefined;
  let hasPerDayQuota = false;
  let hasPerMinuteQuota = false;
  let hasCapacityReason = false;
  let hasTerminalReason = false;
  let hasRateLimitReason = false;

  if (input.bodyText) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.bodyText.slice(0, MAX_ERROR_BODY_BYTES)) as unknown;
    } catch {
      parsed = undefined;
    }
    const errObj = unwrapGoogleError(parsed);
    if (errObj) {
      errorStatus = sanitizeIdentifier(errObj.status);
      if (typeof errObj.code === "number" && Number.isInteger(errObj.code)) {
        errorCode = errObj.code;
      } else {
        errorCode = sanitizeIdentifier(errObj.code);
      }
      if (typeof errObj.message === "string") {
        rawMessage = errObj.message;
      }

      const details = Array.isArray(errObj.details) ? errObj.details : [];
      for (const rawDetail of details) {
        const detail = asRecord(rawDetail);
        if (!detail) continue;

        const detailType = typeof detail["@type"] === "string" ? detail["@type"] : "";
        const reason = sanitizeIdentifier(detail.reason);
        if (reason) {
          reasons.add(reason);
          if (reason === "MODEL_CAPACITY_EXHAUSTED" || reason === "MODEL_CAPACITY_EXCEEDED") {
            hasCapacityReason = true;
          } else if (reason === "QUOTA_EXHAUSTED" || reason === "INSUFFICIENT_G1_CREDITS_BALANCE") {
            hasTerminalReason = true;
          } else if (reason === "RATE_LIMIT_EXCEEDED") {
            hasRateLimitReason = true;
          }
        }

        const detailDomain = sanitizeIdentifier(detail.domain);
        if (detailDomain && !domain) domain = detailDomain;

        if (detailType.endsWith("RetryInfo") || typeof detail.retryDelay === "string") {
          const rawDelay = sanitizeDuration(detail.retryDelay);
          if (rawDelay && !retryInfoDelay) {
            retryInfoDelay = rawDelay;
            retryInfoMs = parseGoogleDurationMs(rawDelay);
          }
        }

        const metadata = asRecord(detail.metadata);
        if (metadata) {
          const metaDelay = sanitizeDuration(metadata.quotaResetDelay);
          if (metaDelay) {
            if (!metadataDelay) metadataDelay = metaDelay;
            if (metadataDelayMs === undefined) {
              metadataDelayMs = parseGoogleDurationMs(metaDelay);
            }
          }
          if (metadataDelayMs === undefined && typeof metadata.quotaResetTimeStamp === "string") {
            const tsMs = Date.parse(metadata.quotaResetTimeStamp);
            if (Number.isFinite(tsMs) && tsMs > nowMs) {
              metadataDelayMs = Math.round(tsMs - nowMs);
            }
          }
          const quotaLimit = sanitizeIdentifier(metadata.quota_limit);
          if (quotaLimit) {
            quotaIds.add(quotaLimit);
            if (/PerDay|Daily/i.test(quotaLimit)) hasPerDayQuota = true;
            if (/PerMinute/i.test(quotaLimit)) hasPerMinuteQuota = true;
          }
        }

        const violations = Array.isArray(detail.violations) ? detail.violations : [];
        for (const rawViolation of violations) {
          const violation = asRecord(rawViolation);
          if (!violation) continue;
          const qid = sanitizeIdentifier(violation.quotaId);
          if (qid) {
            quotaIds.add(qid);
            if (/PerDay|Daily/i.test(qid)) hasPerDayQuota = true;
            if (/PerMinute/i.test(qid)) hasPerMinuteQuota = true;
          }
          const metric = sanitizeIdentifier(violation.quotaMetric);
          if (metric) quotaIds.add(metric);
        }
      }
    }
  }

  let messageRetryDelay: string | undefined;
  let messageRetryMs: number | undefined;
  if (rawMessage) {
    const match = PLEASE_RETRY_RE.exec(rawMessage);
    if (match?.[1]) {
      messageRetryDelay = sanitizeDuration(match[1]);
      messageRetryMs = parseGoogleDurationMs(match[1]);
    }
  }

  const retryDelay = retryInfoDelay ?? metadataDelay ?? messageRetryDelay;
  const parsedRetryAfterMs = headerRetryMs ?? retryInfoMs ?? metadataDelayMs ?? messageRetryMs;
  const retryAfterMs = parsedRetryAfterMs ?? (hasPerMinuteQuota ? 60_000 : undefined);

  let classification: CloudCode429Classification;
  if (
    LIMIT_ZERO_RE.test(rawMessage)
    || SPENDING_CAP_RE.test(rawMessage)
    || hasPerDayQuota
    || hasTerminalReason
  ) {
    classification = "terminal";
  } else if (hasCapacityReason || CAPACITY_MESSAGE_RE.test(rawMessage)) {
    classification = retryAfterMs !== undefined && retryAfterMs > maxRetryDelayMs
      ? "terminal"
      : "capacity";
  } else if (hasRateLimitReason && isCloudCodeDomain(domain)) {
    // Mirrors googleQuotaErrors.ts:309530-309553: RATE_LIMIT_EXCEEDED on Cloud Code
    // requires a bounded retryDelay to be treated as retryable.
    classification = retryAfterMs !== undefined && retryAfterMs <= maxRetryDelayMs
      ? "transient"
      : "terminal";
  } else if (retryAfterMs !== undefined) {
    classification = retryAfterMs > maxRetryDelayMs ? "terminal" : "transient";
  } else {
    // Bare 429 RESOURCE_EXHAUSTED (no details[], no Retry-After)
    classification = "transient";
  }

  return {
    ...(endpoint ? { endpoint } : {}),
    ...(errorStatus ? { errorStatus } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(reasons.size > 0 ? { reasons: [...reasons] } : {}),
    ...(domain ? { domain } : {}),
    ...(retryDelay ? { retryDelay } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(quotaIds.size > 0 ? { quotaIds: [...quotaIds] } : {}),
    classification,
  };
}

function requestUrlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isEligibleCloudCodeRequest(
  input: Parameters<typeof fetch>[0],
  urlStr: string,
  init?: RequestInit,
): boolean {
  if (input instanceof Request && input.body !== null) return false;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "POST") return false;
  try {
    const parsed = new URL(urlStr);
    return CLOUD_CODE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      return (await response.text()).slice(0, MAX_ERROR_BODY_BYTES);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < MAX_ERROR_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const remaining = MAX_ERROR_BODY_BYTES - total;
        chunks.push(value.byteLength > remaining ? value.subarray(0, remaining) : value);
        total += Math.min(value.byteLength, remaining);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } catch {
    return "";
  }
}

function computeNextWaitMs(input: {
  readonly classification: CloudCode429Classification;
  readonly attempt: number;
  readonly currentDelayMs: number;
  readonly retryAfterMs?: number;
  readonly random: () => number;
}): { readonly waitMs: number; readonly nextCurrentDelayMs: number } {
  const r = Math.min(Math.max(input.random(), 0), 0.999999);
  if (input.retryAfterMs !== undefined && input.retryAfterMs > 0) {
    // Mirrors Gemini CLI retry.ts:310457-310468: honour retryDelay as floor
    // with +0..20% positive jitter so we never retry earlier than requested.
    const base = Math.max(input.currentDelayMs, input.retryAfterMs);
    const waitMs = Math.round(base + base * 0.2 * r);
    return { waitMs, nextCurrentDelayMs: base * 2 };
  }
  if (input.classification === "capacity") {
    // Mirrors Gemini CLI retry.ts:310380: short capacity backoff (1s then 3s)
    const base = input.attempt === 1 ? 1_000 : 3_000;
    const waitMs = Math.round(base + base * 0.2 * r);
    return { waitMs, nextCurrentDelayMs: base * 2 };
  }
  // Mirrors Gemini CLI retry.ts:310473-310479: exponential backoff with ±30% jitter.
  const jitter = input.currentDelayMs * 0.3 * (r * 2 - 1);
  const waitMs = Math.max(0, Math.round(input.currentDelayMs + jitter));
  return { waitMs, nextCurrentDelayMs: input.currentDelayMs * 2 };
}

function buildFinal429Response(
  original: Response,
  bodyText: string,
  info: SanitizedCloudCode429,
  policy: ResolvedCloudCodeRetryPolicy,
): { readonly response: Response; readonly retryAfterSeconds?: number } {
  const headers = new Headers(original.headers);
  let retryAfterSeconds: number | undefined;

  if (info.retryAfterMs !== undefined && info.retryAfterMs > 0) {
    retryAfterSeconds = Math.max(
      1,
      Math.min(Math.ceil(info.retryAfterMs / 1_000), MAX_RETRY_AFTER_HEADER_SECONDS),
    );
    // Forward server-requested delay as integer Retry-After so
    // CloudCodeProviderAdapter / llm-mesh honor it instead of 60s / 300s defaults.
    if (!headers.has("retry-after")) {
      headers.set("retry-after", String(retryAfterSeconds));
    }
  } else if (info.classification !== "terminal" && !headers.has("retry-after")) {
    // Transient/capacity/bare 429 with no Retry-After: bound llm-mesh's
    // account cooldown and route-health TTL instead of locking for 60s / 300s.
    retryAfterSeconds = policy.transientFallbackCooldownSeconds;
    headers.set("retry-after", String(retryAfterSeconds));
  }

  return {
    response: new Response(bodyText, {
      status: original.status,
      statusText: original.statusText,
      headers,
    }),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

/**
 * Wrap a fetch implementation with bounded Cloud Code 429 retry-with-backoff.
 * Non-Cloud-Code requests and non-429 responses pass through untouched.
 */
export function createCloudCodeRetryFetch(
  baseFetch: typeof fetch = fetch,
  overrides?: CloudCodeRetryPolicy,
): typeof fetch {
  const policy = resolvePolicy(overrides);

  return async (input, init) => {
    const urlStr = requestUrlOf(input);
    if (!isEligibleCloudCodeRequest(input, urlStr, init)) {
      return baseFetch(input, init);
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    let attempt = 0;
    let currentDelayMs = policy.initialDelayMs;
    let totalWaitMs = 0;

    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      attempt += 1;
      const response = await baseFetch(input, init);

      if (response.status !== 429) {
        if (attempt > 1) {
          let endpoint: string | undefined;
          try {
            endpoint = sanitizeIdentifier(new URL(urlStr).pathname);
          } catch {
            endpoint = undefined;
          }
          policy.onLog({
            event: "recovered",
            ...(endpoint ? { endpoint } : {}),
            attempt,
            maxAttempts: policy.maxAttempts,
            status: response.status,
            totalWaitMs,
          });
        }
        return response;
      }

      const bodyText = await readBoundedResponseText(response);
      const info = classifyCloudCode429({
        url: urlStr,
        headers: response.headers,
        bodyText,
        maxRetryDelayMs: policy.maxRetryDelayMs,
      });

      const effectiveMaxAttempts = info.classification === "capacity"
        ? Math.min(policy.maxAttempts, policy.maxCapacityAttempts)
        : policy.maxAttempts;

      if (info.classification === "terminal") {
        const finalRes = buildFinal429Response(response, bodyText, info, policy);
        policy.onLog({
          event: "terminal",
          ...(info.endpoint ? { endpoint: info.endpoint } : {}),
          attempt,
          maxAttempts: effectiveMaxAttempts,
          status: 429,
          classification: info.classification,
          ...(info.errorStatus ? { errorStatus: info.errorStatus } : {}),
          ...(info.reasons ? { reasons: info.reasons } : {}),
          ...(info.retryDelay ? { retryDelay: info.retryDelay } : {}),
          ...(finalRes.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: finalRes.retryAfterSeconds }
            : {}),
          totalWaitMs,
        });
        return finalRes.response;
      }

      const { waitMs, nextCurrentDelayMs } = computeNextWaitMs({
        classification: info.classification,
        attempt,
        currentDelayMs,
        ...(info.retryAfterMs !== undefined ? { retryAfterMs: info.retryAfterMs } : {}),
        random: policy.random,
      });

      const remainingBudgetMs = policy.maxTotalWaitMs - totalWaitMs;
      const canRetry = attempt < effectiveMaxAttempts && waitMs <= remainingBudgetMs;

      if (!canRetry) {
        const finalRes = buildFinal429Response(response, bodyText, info, policy);
        policy.onLog({
          event: "exhausted",
          ...(info.endpoint ? { endpoint: info.endpoint } : {}),
          attempt,
          maxAttempts: effectiveMaxAttempts,
          status: 429,
          classification: info.classification,
          ...(info.errorStatus ? { errorStatus: info.errorStatus } : {}),
          ...(info.reasons ? { reasons: info.reasons } : {}),
          ...(info.retryDelay ? { retryDelay: info.retryDelay } : {}),
          ...(finalRes.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: finalRes.retryAfterSeconds }
            : {}),
          totalWaitMs,
        });
        return finalRes.response;
      }

      policy.onLog({
        event: "retry",
        ...(info.endpoint ? { endpoint: info.endpoint } : {}),
        attempt,
        maxAttempts: effectiveMaxAttempts,
        status: 429,
        classification: info.classification,
        ...(info.errorStatus ? { errorStatus: info.errorStatus } : {}),
        ...(info.reasons ? { reasons: info.reasons } : {}),
        ...(info.retryDelay ? { retryDelay: info.retryDelay } : {}),
        delayMs: waitMs,
      });

      await policy.sleep(waitMs, signal);
      totalWaitMs += waitMs;
      currentDelayMs = Math.min(policy.maxDelayMs, nextCurrentDelayMs);
    }
  };
}
