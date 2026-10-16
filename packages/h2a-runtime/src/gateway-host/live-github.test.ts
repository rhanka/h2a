import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveGithubTransport } from "./live-github.js";
import { runPrSyncPass, type PrPageRequest, type PrSyncPersistencePort } from "../vendor/engram-live/pr-sync.js";
import { PR_END_PROOF, type PrObjectJobDto, type PrSyncCursorDto, type PullRequestFactDto } from "../vendor/engram-live/contracts.js";

const repository = { owner: "acme", repo: "project" };
const request: PrPageRequest = { repository, cursor: null, updatedAtSince: null, etag: null };
const oid = (n: number) => n.toString(16).padStart(40, "0");
function pr(n: number, extra: Record<string, unknown> = {}) {
  return {
    number: n, state: n % 3 === 1 ? "open" : "closed", draft: n % 4 === 0,
    updated_at: "2026-10-16T12:00:00Z", merged_at: n % 3 === 0 ? "2026-10-16T11:00:00Z" : null,
    merge_commit_sha: n % 3 === 0 ? oid(n + 3000) : null,
    url: `https://api.github.com/repos/acme/project/pulls/${n}`,
    base: { sha: oid(1), ref: "main", repo: { full_name: "acme/project" } },
    head: { sha: oid(n + 1000), ref: `topic-${n}`, repo: { full_name: "fork/project" } },
    ...extra,
  };
}
const link = (page: number, rel = "next", extra = "") =>
  `<https://api.github.com/repos/acme/project/pulls?state=all&sort=updated&direction=asc&per_page=100&page=${page}${extra}>; rel="${rel}"`;
type Reply = { status?: number; headers?: Record<string, string>; body?: unknown; delay?: number; raw?: string; exitCode?: number };
let root: string;
let ghPath: string;
let traces: { args: string[]; cwd: string; home: string; runtime: string; host: string; debug: string }[];
let handler: (url: URL, headers: Record<string, string | string[] | undefined>) => Reply;
let transport: ReturnType<typeof createLiveGithubTransport>;
let responses: Set<ServerResponse>;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "h2a-live-github-"));
  for (const key of ["HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "GH_CONFIG_DIR"]) vi.stubEnv(key, root);
  vi.stubEnv("GH_HOST", "untrusted.invalid");
  vi.stubEnv("GH_DEBUG", "api");
  traces = [];
  responses = new Set();
  handler = () => ({ body: [] });
  const server = createServer((req, res) => {
    responses.add(res);
    res.on("close", () => responses.delete(res));
    const trace = JSON.parse(Buffer.from(String(req.headers["x-fixture-trace"]), "base64").toString());
    traces.push(trace);
    const reply = handler(new URL(req.url!, "http://fixture"), req.headers);
    const send = () => {
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    };
    if (reply.delay) {
      const timer = setTimeout(send, reply.delay);
      res.on("close", () => clearTimeout(timer));
    } else send();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake GitHub did not bind");
  closeServer = async () => {
    for (const res of responses) res.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  ghPath = join(root, "approved-gh");
  // A disposable CLI boundary: real child process and HTTP, loopback only.
  // It deliberately has no route to an installed gh or owner's credentials.
  writeFileSync(ghPath, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] !== 'api' || args.includes('token') || args.includes('--paginate')) process.exit(90);
const endpoint = args.find(arg => arg.startsWith('repos/'));
const headers = {};
for (let i=0;i<args.length;i++) if(args[i]==='--header') { const [k,...v]=args[++i].split(':'); headers[k.toLowerCase()] = v.join(':').trim(); }
headers['x-fixture-trace'] = Buffer.from(JSON.stringify({ args, cwd:process.cwd(), home:process.env.HOME, runtime:process.env.XDG_RUNTIME_DIR, host:process.env.GH_HOST, debug:process.env.GH_DEBUG })).toString('base64');
const response = await fetch('http://127.0.0.1:${address.port}/'+endpoint, {headers});
const reply = await response.json();
if(reply.raw!==undefined) process.stdout.write(reply.raw);
else {
  process.stdout.write('HTTP/2.0 '+(reply.status??200)+' Fixture\\r\\n');
  for(const [k,v] of Object.entries(reply.headers??{})) process.stdout.write(k+': '+v+'\\r\\n');
  process.stdout.write('\\r\\n'+JSON.stringify(reply.body??[]));
}
if ((reply.status??200)>=400 || reply.exitCode) { process.stderr.write('secret-fixture-token must never escape'); process.exitCode=reply.exitCode??1; }
`, { mode: 0o700 });
  transport = createLiveGithubTransport({ ghPath, hostDirectory: root });
});
afterEach(async () => {
  await closeServer?.();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function memoryPersistence() {
  let cursor: PrSyncCursorDto | null = null;
  const facts = new Map<string, PullRequestFactDto>();
  const jobs = new Map<string, PrObjectJobDto>();
  const key = (job: PrObjectJobDto) => `${job.prNumber}:${job.headOid.oid}`;
  const persistence: PrSyncPersistencePort = {
    loadCursor: async () => cursor,
    saveCursor: async value => { cursor = value; },
    saveObservation: async value => { facts.set(JSON.stringify(value), value); },
    listObservations: async () => [...facts.values()],
    recordObjectJob: async job => { if (!jobs.has(key(job))) jobs.set(key(job), job); },
    updateObjectJob: async job => { jobs.set(key(job), job); },
    listObjectJobs: async () => [...jobs.values()],
  };
  return { persistence, facts, jobs };
}

describe("live GitHub transport", () => {
  it("should consume every page and state through the real neutral engine while retaining moved heads and failed jobs", async () => {
    handler = url => {
      const page = Number(url.searchParams.get("page"));
      return page === 1 ? { headers: { link: link(2) }, body: Array.from({ length: 100 }, (_, i) => pr(i + 1)) }
        : page === 2 ? { headers: { link: link(3) }, body: [pr(100), ...Array.from({ length: 99 }, (_, i) => pr(i + 101))] }
        : { headers: { link: link(2, "prev") }, body: Array.from({ length: 52 }, (_, i) => pr(i + 200)) };
    };
    const store = memoryPersistence();
    const first = await runPrSyncPass({ repository, now: 1800000000000, sweepKind: "full" }, { transport, persistence: store.persistence });
    expect(first.state).toBe("complete");
    expect(first.stats).toMatchObject({ pages: 3, unique: 251, duplicates: 1 });
    expect(new Set(first.observations.map(pr => pr.state))).toEqual(new Set(["open", "closed", "merged"]));
    expect(first.observations.some(pr => pr.isDraft)).toBe(true);
    const failed = [...store.jobs.values()][0]!;
    await store.persistence.updateObjectJob({ ...failed, state: "failed", lastError: "unavailable" });
    handler = () => ({ body: [pr(1, { head: { sha: oid(9000), ref: "moved" } })] });
    const second = await runPrSyncPass({ repository, now: 1800000001000, sweepKind: "incremental" }, { transport, persistence: store.persistence });
    expect(second.observations).toHaveLength(252);
    expect(store.jobs.size).toBe(252);
    expect([...store.jobs.values()].find(job => job.headOid.oid === failed.headOid.oid)?.state).toBe("failed");
    expect(second.coverage.find(c => c.axis === "object-availability")?.state).toBe("unavailable");
    for (const trace of traces) {
      const endpoint = new URL(trace.args.find(arg => arg.startsWith("repos/"))!, "https://api.github.com/");
      expect(endpoint.pathname).toBe("/repos/acme/project/pulls");
      expect(endpoint.searchParams.get("state")).toBe("all");
      expect(trace.args).toContain("--include");
      expect(trace.args).not.toContain("--paginate");
      expect(trace.cwd).toBe(root);
      expect(trace.home).toBe(root);
      expect(trace.runtime).toBe(root);
      expect(trace.host).toBe("github.com");
      expect(trace.debug).toBe("");
    }
  });

  it("should bind continuations and termination to repository and filter, even for empty filtered pages", async () => {
    handler = url => Number(url.searchParams.get("page")) === 1
      ? { headers: { link: link(2) }, body: [pr(1)] }
      : { body: [pr(2, { updated_at: "2026-10-17T12:00:00Z" })] };
    const filtered = { ...request, updatedAtSince: Date.parse("2026-10-17T00:00:00Z") };
    const first = await transport.fetchPage(filtered);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.kind);
    expect(first.page).toMatchObject({ items: [], hasMore: true });
    const count = traces.length;
    for (const changed of [{ repository: { owner: "other", repo: "project" } }, { updatedAtSince: null }, { cursor: "2" }]) {
      expect(await transport.fetchPage({ ...filtered, cursor: first.page.nextCursor, ...changed })).toMatchObject({ ok: false, kind: "protocol" });
    }
    expect(traces).toHaveLength(count);
    const last = await transport.fetchPage({ ...filtered, cursor: first.page.nextCursor });
    expect(last).toMatchObject({ ok: true, page: { hasMore: false, nextCursor: null, endProof: PR_END_PROOF, items: [{ number: 2 }] } });
  });

  it.each([
    ["foreign host", link(2).replace("api.github.com", "evil.invalid")],
    ["foreign repository", link(2).replace("acme/project", "foreign/project")],
    ["foreign state", link(2, "next", "&state=open")],
    ["wrong filter", link(2).replace("sort=updated", "sort=created")],
    ["backward page", link(1)],
    ["skipped page", link(3)],
    ["duplicate next", `${link(2)}, ${link(3)}`],
    ["contradictory last", `${link(2)}, ${link(1, "last")}`],
    ["unproven last", link(3, "last")],
    ["malformed", "not a link"],
    ["credentials", link(2).replace("https://", "https://user@")],
    ["extra query", link(2, "next", "&unknown=1")],
  ])("should refuse %s pagination without claiming completeness", async (_label, value) => {
    handler = () => ({ headers: { link: value }, body: [pr(1)] });
    expect(await transport.fetchPage(request)).toMatchObject({ ok: false, kind: "protocol" });
    expect(traces).toHaveLength(1);
  });

  it.each([
    ["foreign row", [pr(1, { url: "https://api.github.com/repos/other/project/pulls/1" })]],
    ["foreign base", [pr(1, { base: { sha: oid(1), ref: "main", repo: { full_name: "foreign/project" } } })]],
    ["missing identity", [pr(1, { url: undefined })]],
    ["invalid oid", [pr(1, { head: { sha: "bad", ref: "topic" } })]],
    ["invalid date", [pr(1, { updated_at: "bad" })]],
    ["contradictory state", [pr(1, { state: "open", merged_at: "2026-10-16T11:00:00Z" })]],
    ["unknown state", [pr(1, { state: "mystery" })]],
    ["non-array", { message: "truncated" }],
    ["oversized page", Array.from({ length: 101 }, (_, i) => pr(i + 1))],
  ])("should refuse %s facts before filtering or persistence", async (_label, body) => {
    handler = () => ({ body });
    const store = memoryPersistence();
    const result = await runPrSyncPass({ repository, now: 1800000000000, sweepKind: "full" }, { transport, persistence: store.persistence });
    expect(result).toMatchObject({ state: "stale", cursor: { lastSuccessAt: null, pendingRetry: { kind: "protocol" } } });
    expect(store.facts.size).toBe(0);
  });

  it("should replay 304 only with the exact cached page and isolate ETags by filter, cursor and repository", async () => {
    let calls = 0;
    handler = (_url, headers) => {
      calls++;
      if (headers["if-none-match"]) return { status: 304, headers: { etag: '"same"', link: link(2) } };
      return { headers: { etag: '"same"', link: link(2) }, body: [pr(1)] };
    };
    const first = await transport.fetchPage(request);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.kind);
    expect(await transport.fetchPage({ ...request, etag: '"same"' })).toEqual(first);
    expect(traces.at(-1)?.args).toContain('If-None-Match: "same"');
    // Consumer mutation cannot corrupt the cached listing/proof.
    try { (first.page.items as unknown[]).length = 0; } catch { /* frozen snapshots are also valid */ }
    const replay = await transport.fetchPage({ ...request, etag: '"same"' });
    expect(replay.ok && replay.page.items).toHaveLength(1);
    for (const changed of [{ updatedAtSince: 1 }, { repository: { owner: "other", repo: "project" } }, { cursor: first.page.nextCursor }]) {
      handler = () => ({ body: [] });
      expect((await transport.fetchPage({ ...request, ...changed, etag: '"same"' })).ok).toBe(true);
      expect(traces.at(-1)?.args.some(a => a.startsWith("If-None-Match:"))).toBe(false);
    }
    expect(calls).toBe(3);
  });

  it("should recover from a 304 without a cached page by retrying unconditionally and refuse a repeated 304", async () => {
    let calls = 0;
    handler = () => ++calls === 1 ? { status: 304 } : { body: [pr(1)] };
    expect(await transport.fetchPage({ ...request, etag: '"persisted-before-restart"' })).toMatchObject({ ok: true, page: { items: [{ number: 1 }] } });
    expect(calls).toBe(2);
    handler = () => ({ status: 304 });
    expect(await transport.fetchPage(request)).toMatchObject({ ok: false, kind: "protocol" });
  });

  it("should accept a cached HTTP 304 even when gh exits nonzero for that HTTP status", async () => {
    handler = () => ({ headers: { etag: '"cached"' }, body: [pr(1)] });
    const first = await transport.fetchPage(request);
    handler = () => ({ status: 304, exitCode: 1, headers: { link: link(1, "last") } });
    expect(await transport.fetchPage({ ...request, etag: '"cached"' })).toEqual(first);
  });

  it("should re-prove pagination when a 304 lacks Link evidence instead of replaying a stale terminator", async () => {
    handler = () => ({ headers: { etag: '"cached"' }, body: [pr(1)] });
    expect(await transport.fetchPage(request)).toMatchObject({ ok: true, page: { hasMore: false } });
    handler = (_url, headers) => headers["if-none-match"] ? { status: 304 }
      : { headers: { etag: '"cached"', link: link(2) }, body: [pr(1)] };
    const result = await transport.fetchPage({ ...request, etag: '"cached"' });
    expect(result).toMatchObject({ ok: true, page: { hasMore: true } });
    expect(result.ok && result.page.endProof).toBeUndefined();
    expect(traces).toHaveLength(3);
  });

  it("should refuse foreign pagination evidence on a cached HTTP 304", async () => {
    handler = () => ({ headers: { etag: '"cached"' }, body: [pr(1)] });
    await transport.fetchPage(request);
    handler = () => ({ status: 304, headers: { link: link(2).replace("api.github.com", "foreign.invalid") } });
    expect(await transport.fetchPage({ ...request, etag: '"cached"' })).toMatchObject({ ok: false, kind: "protocol" });
  });

  it.each(["You have exceeded a secondary rate limit", "API rate limit exceeded", "You have triggered an abuse detection mechanism"])(
    "should schedule a bounded retry for headerless GitHub throttling: %s", async message => {
      handler = () => ({ status: 403, body: { message: `${message}: secret-fixture-token` } });
      const result = await transport.fetchPage(request);
      expect(result).toMatchObject({ ok: false, kind: "rate_limited", retryAfterMs: 60000 });
      expect(JSON.stringify(result)).not.toContain("secret-fixture-token");
    },
  );

  it.each([
    [401, {}, "auth_required"], [403, {}, "auth_required"], [404, {}, "unavailable"],
    [429, { "retry-after": "2" }, "rate_limited"],
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000010" }, "rate_limited"],
    [403, { "retry-after": "Fri, 15 Jan 2027 08:00:10 GMT" }, "rate_limited"],
    [503, {}, "offline"], [302, {}, "protocol"],
  ])("should classify HTTP %i with headers %j, preserve last success and keep diagnostics secret-free", async (status, headers, kind) => {
    handler = () => ({ body: [pr(1)] });
    const store = memoryPersistence();
    await runPrSyncPass({ repository, now: 1800000000000, sweepKind: "full" }, { transport, persistence: store.persistence });
    handler = () => ({ status, headers, body: { message: "secret-fixture-token must never escape" } });
    const controlled = createLiveGithubTransport({ ghPath, hostDirectory: root, now: () => 1800000000000 });
    const result = await controlled.fetchPage(request);
    expect(result).toMatchObject({ ok: false, kind });
    if (status === 429) expect(result).toMatchObject({ retryAfterMs: 2000 });
    if (status === 403 && "x-ratelimit-reset" in headers) expect(result).toMatchObject({ retryAfterMs: 10000 });
    expect(JSON.stringify(result)).not.toContain("secret-fixture-token");
    const stale = await runPrSyncPass({ repository, now: 1800000001000, sweepKind: "full" }, { transport: controlled, persistence: store.persistence });
    expect(stale).toMatchObject({ state: "stale", cursor: { lastSuccessAt: 1800000000000, pendingRetry: { kind } } });
    expect(stale.observations).toHaveLength(1);
    handler = () => ({ body: [] });
    const resumed = await runPrSyncPass({ repository, now: 1800000002000, sweepKind: "full" }, { transport: controlled, persistence: store.persistence });
    expect(resumed).toMatchObject({ state: "complete", cursor: { pendingRetry: null } });
    expect(resumed.observations).toHaveLength(1);
  });

  it.each(["", "[]", "HTTP/2.0 200 OK\r\n\r\n{", "HTTP/2.0 200 OK\r\nLink: a\r\nLink: b\r\n\r\n[]"]) (
    "should reject malformed or ambiguous HTTP output %j", async raw => {
      handler = () => ({ raw });
      expect(await transport.fetchPage(request)).toMatchObject({ ok: false, kind: "protocol" });
    },
  );

  it("should enforce concurrency and terminate an owned gh child at the request deadline", async () => {
    let active = 0;
    let peak = 0;
    handler = () => {
      peak = Math.max(peak, ++active);
      const timer = setTimeout(() => active--, 100);
      timer.unref();
      return { body: [], delay: 100 };
    };
    const bounded = createLiveGithubTransport({ ghPath, hostDirectory: root, maxConcurrent: 2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => bounded.fetchPage(request)));
    expect(results.every(r => r.ok)).toBe(true);
    expect(peak).toBe(2);
    handler = () => ({ body: [], delay: 3000 });
    const timed = createLiveGithubTransport({ ghPath, hostDirectory: root, timeoutMs: 500 });
    const start = Date.now();
    expect(await timed.fetchPage(request)).toMatchObject({ ok: false, kind: "offline" });
    expect(Date.now() - start).toBeLessThan(2000);
    const missing = createLiveGithubTransport({ ghPath: join(root, "missing-gh"), hostDirectory: root });
    expect(await missing.fetchPage(request)).toMatchObject({ ok: false, kind: "unavailable" });
  });

  it("should reject unapproved paths and invalid requests before invoking gh", async () => {
    expect(() => createLiveGithubTransport({ ghPath: "gh", hostDirectory: root })).toThrow();
    expect(() => createLiveGithubTransport({ ghPath, hostDirectory: "." })).toThrow();
    for (const extra of [
      { repository: { owner: "../bad", repo: "p" } }, { etag: "bad\r\nInjected: yes" },
      { updatedAtSince: -1 }, { updatedAtSince: Number.NaN }, { cursor: "https://evil.invalid" },
    ]) expect(await transport.fetchPage({ ...request, ...extra })).toMatchObject({ ok: false, kind: "protocol" });
    expect(traces).toHaveLength(0);
    expect(readFileSync(ghPath, "utf8")).toContain("127.0.0.1");
  });
});
