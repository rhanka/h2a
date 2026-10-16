/**
 * P1 host implementation of engram's injected GitHub PR page transport.
 * The composition owner supplies an approved absolute gh executable and a
 * service directory (never an observed worktree). gh alone owns credentials.
 * This module lists metadata only; it never acquires/acknowledges Git objects.
 */
import { execFile, type ExecFileException } from "node:child_process";
import { isAbsolute } from "node:path";
import {
  PR_END_PROOF,
  validatePrPage,
  validatePullRequestFact,
  type PrPageDto,
  type PullRequestFactDto,
  type QualifiedOid,
} from "../vendor/engram-live/contracts.js";
import type { GithubPrTransportPort, PrPageRequest, PrTransportResult } from "../vendor/engram-live/pr-sync.js";

export interface LiveGithubOptions {
  readonly ghPath: string;
  readonly hostDirectory: string;
  readonly timeoutMs?: number;
  readonly maxConcurrent?: number;
  readonly now?: () => number;
}

type HttpReply = { status: number; headers: Map<string, string>; body: string };
const failure = (kind: "protocol" | "offline" | "auth_required" | "rate_limited" | "unavailable"): Extract<PrTransportResult, { ok: false }> =>
  ({ ok: false, kind, message: `GitHub PR transport: ${kind}` });
const slug = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const safeHeader = (value: string) => value.length > 0 && value.length <= 8192 && !/[\x00-\x1f\x7f]/.test(value);

function position(request: PrPageRequest): { scope: string; page: number; key: string; path: string } {
  const { owner, repo } = request.repository;
  if (!slug.test(owner) || !slug.test(repo) || owner.length > 100 || repo.length > 100
    || (request.updatedAtSince !== null && (!Number.isSafeInteger(request.updatedAtSince) || request.updatedAtSince < 0))
    || (request.etag !== null && (typeof request.etag !== "string" || !safeHeader(request.etag)))) throw new Error("invalid request");
  const scope = JSON.stringify([owner, repo, request.updatedAtSince]);
  let page = 1;
  if (request.cursor !== null) {
    if (typeof request.cursor !== "string" || request.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(request.cursor)) throw new Error("invalid cursor");
    const decoded: unknown = JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1 || decoded[1] !== scope
      || !Number.isSafeInteger(decoded[2]) || decoded[2] < 2) throw new Error("foreign cursor");
    page = decoded[2] as number;
  }
  return { scope, page, key: JSON.stringify([scope, page]), path: `/repos/${owner}/${repo}/pulls` };
}

function cursorFor(scope: string, page: number): string {
  return Buffer.from(JSON.stringify([1, scope, page])).toString("base64url");
}

function parseHttp(output: string): HttpReply {
  const split = output.search(/\r?\n\r?\n/);
  if (split < 0) throw new Error("missing HTTP envelope");
  const separator = output.slice(split).match(/^\r?\n\r?\n/)![0];
  const lines = output.slice(0, split).split(/\r?\n/);
  const status = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5]\d\d)(?: .*)?$/.exec(lines.shift() ?? "");
  if (!status) throw new Error("invalid status line");
  const headers = new Map<string, string>();
  for (const line of lines) {
    const match = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+):[ \t]*(.*)$/.exec(line);
    if (!match) throw new Error("invalid HTTP header");
    const name = match[1]!.toLowerCase();
    // Duplicate control headers are ambiguous, never silently overwritten.
    if (headers.has(name)) throw new Error("duplicate HTTP header");
    headers.set(name, match[2]!);
  }
  return { status: Number(status[1]), headers, body: output.slice(split + separator.length) };
}

function nextPage(header: string | undefined, path: string, current: number): number | null {
  if (header === undefined) return null; // GitHub REST's explicit lack of continuation.
  const relations = new Map<string, number>();
  for (const part of header.split(",")) {
    const match = /^\s*<([^<>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    if (!match) throw new Error("invalid Link proof");
    const url = new URL(match[1]!);
    if (url.origin !== "https://api.github.com" || url.username || url.password || url.hash || url.pathname !== path) throw new Error("foreign Link");
    const params = url.searchParams;
    const expected: Record<string, string> = { state: "all", sort: "updated", direction: "asc", per_page: "100" };
    if ([...params.keys()].length !== 5 || params.getAll("page").length !== 1) throw new Error("foreign Link query");
    for (const [key, value] of Object.entries(expected)) {
      if (params.getAll(key).length !== 1 || params.get(key) !== value) throw new Error("foreign Link filter");
    }
    const text = params.get("page")!;
    const page = Number(text);
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(page)) throw new Error("invalid page");
    const relation = match[2]!;
    if (relations.has(relation)) throw new Error("duplicate Link relation");
    if ((relation === "next" && page !== current + 1) || (relation === "prev" && page !== current - 1)
      || (relation === "first" && page !== 1) || (relation === "last" && page < current)) throw new Error("contradictory Link");
    relations.set(relation, page);
  }
  const next = relations.get("next") ?? null;
  const last = relations.get("last");
  if (last !== undefined && ((next === null && last !== current) || (next !== null && last < next))) throw new Error("contradictory last page");
  return next;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
  return value as Record<string, unknown>;
}

function observedOid(value: unknown): QualifiedOid {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error("invalid OID");
  return { algorithm: value.length === 40 ? "sha1" : "sha256", oid: value };
}

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error("invalid timestamp");
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time <= 0) throw new Error("invalid timestamp");
  return time;
}

function observation(value: unknown, request: PrPageRequest, path: string): PullRequestFactDto {
  const row = record(value);
  const base = record(row.base);
  const head = record(row.head);
  const identity = `${request.repository.owner}/${request.repository.repo}`;
  if (row.url !== `https://api.github.com${path}/${row.number}` || record(base.repo).full_name !== identity) throw new Error("foreign PR");
  if (row.state !== "open" && row.state !== "closed") throw new Error("unknown PR state");
  const merged = row.merged_at !== null;
  if (merged) timestamp(row.merged_at);
  if (merged && row.state !== "closed") throw new Error("contradictory state");
  const fact: PullRequestFactDto = {
    repositoryOwner: request.repository.owner, repositoryRepo: request.repository.repo,
    number: row.number as number, state: merged ? "merged" : row.state,
    isDraft: row.draft as boolean, updatedAt: timestamp(row.updated_at),
    headOid: observedOid(head.sha), headRef: head.ref as string,
    baseOid: observedOid(base.sha), baseRef: base.ref as string,
    // A live PR's synthetic test-merge commit is not observed merge evidence.
    mergeOid: merged && row.merge_commit_sha !== null ? observedOid(row.merge_commit_sha) : null,
    mergeStrategy: "unknown",
  };
  if (!validatePullRequestFact(fact).ok) throw new Error("invalid fact");
  return fact;
}

function retryDelay(headers: Map<string, string>, now: number): number {
  const after = headers.get("retry-after");
  let delay = 60_000;
  if (after !== undefined) {
    const seconds = /^\d+(?:\.\d+)?$/.test(after) ? Number(after) * 1000 : Date.parse(after) - now;
    if (Number.isFinite(seconds)) delay = seconds;
  } else if (headers.has("x-ratelimit-reset")) {
    const reset = Number(headers.get("x-ratelimit-reset")) * 1000 - now;
    if (Number.isFinite(reset)) delay = reset;
  }
  return Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.ceil(delay)));
}

function isThrottled(reply: HttpReply): boolean {
  if (reply.status === 429) return true;
  if (reply.status !== 403) return false;
  if (reply.headers.get("x-ratelimit-remaining") === "0" || reply.headers.has("retry-after")) return true;
  // Secondary limits may omit Retry-After. Inspect only for classification;
  // the provider body and stderr never become a diagnostic or stored fact.
  try {
    const message: unknown = record(JSON.parse(reply.body)).message;
    return typeof message === "string" && /secondary rate limit|API rate limit exceeded|abuse detection/i.test(message);
  } catch { return false; }
}

/** The caller owns scheduling/durable backoff; a single call never sleeps. */
export function createLiveGithubTransport(options: LiveGithubOptions): GithubPrTransportPort {
  if (!isAbsolute(options.ghPath) || !isAbsolute(options.hostDirectory)) throw new Error("approved gh and service directory must be absolute");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const concurrency = options.maxConcurrent ?? 2;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("invalid transport budget");
  const now = options.now ?? Date.now;
  const cache = new Map<string, PrPageDto>();
  let active = 0;
  const waiters: (() => void)[] = [];

  async function fetch(request: PrPageRequest): Promise<PrTransportResult> {
    let pos: ReturnType<typeof position>;
    try { pos = position(request); } catch { return failure("protocol"); }
    const endpoint = `${pos.path.slice(1)}?state=all&sort=updated&direction=asc&per_page=100&page=${pos.page}`;
    const cached = cache.get(pos.key);
    // A persisted ETag without its page is insufficient to interpret 304.
    const validator = cached?.etag && cached.etag === request.etag ? request.etag : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const args = ["api", "--hostname", "github.com", "--method", "GET", "--include",
        "--header", "Accept: application/vnd.github+json", "--header", "X-GitHub-Api-Version: 2022-11-28"];
      if (attempt === 0 && validator) args.push("--header", `If-None-Match: ${validator}`);
      args.push(endpoint);
      const result = await new Promise<{ output: string; error: ExecFileException | null }>(resolve => {
        execFile(options.ghPath, args, {
          cwd: options.hostDirectory, encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, GH_HOST: "github.com", GH_DEBUG: "", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", PAGER: "cat" },
          windowsHide: true,
        }, (error, stdout) => resolve({ output: stdout, error }));
      });
      if (result.error && (result.error.code === "ENOENT" || result.error.code === "EACCES")) return failure("unavailable");
      if (result.error && ("killed" in result.error && result.error.killed || result.error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")) return failure("offline");
      let reply: HttpReply;
      try { reply = parseHttp(result.output); } catch { return failure(result.error ? "offline" : "protocol"); }
      const { status, headers } = reply;
      if (status === 304) {
        if (attempt === 0 && validator && cached && (!headers.has("etag") || headers.get("etag") === validator)) {
          // An ETag validates the body, not a past end-of-list proof: another
          // page may have appeared while this page's items stayed unchanged.
          // A 304 without current Link evidence requires an unconditional GET.
          if (headers.has("link")) {
            try {
              const next = nextPage(headers.get("link"), pos.path, pos.page);
              const page: PrPageDto = {
                items: structuredClone(cached.items), etag: cached.etag ?? null,
                nextCursor: next === null ? null : cursorFor(pos.scope, next), hasMore: next !== null,
                ...(next === null ? { endProof: PR_END_PROOF } : {}),
              };
              if (!validatePrPage(page).ok) return failure("protocol");
              cache.set(pos.key, structuredClone(page));
              return { ok: true, page };
            } catch { return failure("protocol"); }
          }
        }
        if (attempt === 0) continue;
        return failure("protocol");
      }
      if (isThrottled(reply)) {
        return { ...failure("rate_limited"), retryAfterMs: retryDelay(headers, now()) };
      }
      if (status === 401 || status === 403) return failure("auth_required");
      if (status === 404 || status === 410) return failure("unavailable");
      if (status >= 500) return failure("offline");
      if (status !== 200 || result.error) return failure("protocol");
      try {
        const body: unknown = JSON.parse(reply.body);
        if (!Array.isArray(body) || body.length > 100) return failure("protocol");
        const next = nextPage(headers.get("link"), pos.path, pos.page);
        // Validate all rows before applying the local updatedAt filter.
        // REST pulls has no since filter: enumerate all pages, filter locally.
        const facts = body.map(row => observation(row, request, pos.path));
        const etag = headers.get("etag") ?? null;
        if (etag !== null && !safeHeader(etag)) return failure("protocol");
        const page: PrPageDto = {
          items: facts.filter(fact => request.updatedAtSince === null || fact.updatedAt >= request.updatedAtSince),
          nextCursor: next === null ? null : cursorFor(pos.scope, next), hasMore: next !== null,
          ...(next === null ? { endProof: PR_END_PROOF } : {}), etag,
        };
        if (!validatePrPage(page).ok) return failure("protocol");
        cache.set(pos.key, structuredClone(page));
        return { ok: true, page };
      } catch { return failure("protocol"); }
    }
    return failure("protocol");
  }

  return {
    async fetchPage(request) {
      if (active >= concurrency) await new Promise<void>(resolve => waiters.push(resolve));
      else active++;
      try { return await fetch(request); }
      finally {
        const next = waiters.shift();
        if (next) next(); else active--;
      }
    },
  };
}
