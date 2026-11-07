/**
 * `h2a sentropic …` end to end against a LOCAL fake authorization server + MCP resource server
 * (two loopback HTTP servers, two origins). The fake enforces what the real sentropic AS
 * enforces on the authorization_code leg (registered redirect, PKCE S256, single-use code,
 * redirect_uri echo, RFC 8707 resource, RFC 9207 iss on the response) plus the follow-up
 * refresh_token grant with rotation, and the RS checks the bearer and the workspace.
 *
 * Every secret the fake mints (authorization code, access token, refresh token, id_token
 * signature) carries SENTINEL, every failure body it can return carries SENTINEL too, and the
 * code verifier the client sends is recorded: the sentinel suite asserts none of them ever
 * reaches stdout, stderr or a thrown error.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";

import { DamagedAuthFileError, authFilePath, readAuth, serverKey, writeAuth } from "./auth-token.js";
import { registerSentropicCommand, type SentropicCliDeps } from "./cli.js";
import { pkceChallengeS256 } from "./enroll-flow.js";
import { publicErrorMessage } from "./publish-errors.js";
import { bindingFilePath, readBinding } from "./workspace-binding.js";

const SENTINEL = "zzSENTINELzz";
const CLIENT_ID = "h2a-cli-test";
const SUBJECT = "user-0b9c8f1e";
const TENANT = "tenant-acme";
const LOCAL_WS = `ws:${"c".repeat(64)}`;
const HOUR = 3_600_000;

const b64json = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const mint = (prefix: string): string => `${prefix}-${SENTINEL}-${randomBytes(12).toString("base64url")}`;
const jwt = (claims: Record<string, unknown>): string =>
  `${b64json({ alg: "EdDSA", typ: "JWT" })}.${b64json(claims)}.${SENTINEL}${randomBytes(16).toString("base64url")}`;

interface FakeOptions {
  /** advertise offline_access + refresh_token and issue rotating refresh tokens. */
  refresh?: boolean;
  /** the tid claim; null = none (multi-org account without a selection). */
  tid?: string | null;
  accessTtlSeconds?: number;
  /** the id_token carries this nonce instead of the requested one. */
  nonceOverride?: string;
  /** the iss on the authorization response; null = omitted. */
  iss?: string | null;
  redirectAllowed?: (uri: string) => boolean;
  refuseRefresh?: boolean;
  deny?: boolean;
  tokenFailure?: "500" | "malformed";
  revokeFailure?: boolean;
  noIdToken?: boolean;
  /** RS workspace membership; undefined = every workspace is accepted. */
  members?: string[];
  rsFailure?: "500";
}

interface CodeGrant {
  challenge: string;
  redirectUri: string;
  nonce: string | null;
  scope: string;
  resource: string | null;
  used: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

class FakeSentropic {
  readonly authorizeRequests: URLSearchParams[] = [];
  readonly tokenRequests: URLSearchParams[] = [];
  readonly revokeRequests: URLSearchParams[] = [];
  readonly rsRequests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = [];
  readonly accessTokens = new Map<string, { exp: number; active: boolean }>();
  readonly refreshTokens = new Map<string, { active: boolean; scope: string }>();
  private readonly codes = new Map<string, CodeGrant>();
  private as: Server | undefined;
  private rs: Server | undefined;
  asUrl = "";
  mcpUrl = "";

  constructor(readonly opts: FakeOptions = {}) {}

  get scopesSupported(): string[] {
    return [
      "openid", "profile", "email", "mcp:discover", "mcp:resources:read", "mcp:tools:invoke",
      "immo:artifacts:read", "immo:artifacts:write", ...(this.opts.refresh ? ["offline_access"] : []),
    ];
  }

  async start(): Promise<this> {
    this.as = createServer((req, res) => void this.onAs(req, res));
    this.rs = createServer((req, res) => void this.onRs(req, res));
    await new Promise<void>((r) => this.as!.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => this.rs!.listen(0, "127.0.0.1", r));
    this.asUrl = `http://127.0.0.1:${(this.as.address() as { port: number }).port}`;
    this.mcpUrl = `http://127.0.0.1:${(this.rs.address() as { port: number }).port}/api/v1/mcp`;
    return this;
  }

  async stop(): Promise<void> {
    for (const server of [this.as, this.rs]) {
      if (!server) continue;
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  env(dir: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      H2A_SENTROPIC_ISSUER: this.asUrl,
      H2A_SENTROPIC_MCP_URL: this.mcpUrl,
      H2A_SENTROPIC_CLIENT_ID: CLIENT_ID,
      H2A_SENTROPIC_HOME: dir,
      ...extra,
    };
  }

  private async onAs(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.asUrl);
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: this.asUrl,
        authorization_endpoint: `${this.asUrl}/api/v1/auth/oauth/authorize`,
        token_endpoint: `${this.asUrl}/api/v1/auth/oauth/token`,
        revocation_endpoint: `${this.asUrl}/api/v1/auth/oauth/revoke`,
        scopes_supported: this.scopesSupported,
        grant_types_supported: ["authorization_code", ...(this.opts.refresh ? ["refresh_token"] : [])],
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/api/v1/auth/oauth/authorize") return this.authorize(url.searchParams, res);
    if (url.pathname === "/api/v1/auth/oauth/token" && req.method === "POST") {
      return this.token(new URLSearchParams(await readBody(req)), res);
    }
    if (url.pathname === "/api/v1/auth/oauth/revoke" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      this.revokeRequests.push(form);
      if (this.opts.revokeFailure) return json(res, 500, { error: "server_error", detail: SENTINEL });
      const token = form.get("token") ?? "";
      const at = this.accessTokens.get(token);
      if (at) at.active = false;
      const rt = this.refreshTokens.get(token);
      if (rt) rt.active = false;
      return json(res, 200, { success: true });
    }
    return json(res, 404, { error: "not_found" });
  }

  private authorize(q: URLSearchParams, res: ServerResponse): void {
    this.authorizeRequests.push(q);
    const redirectUri = q.get("redirect_uri") ?? "";
    const allowed = this.opts.redirectAllowed ?? ((uri: string) => /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(uri));
    if (q.get("client_id") !== CLIENT_ID || !allowed(redirectUri)) {
      // The real AS answers an unregistered redirect with an error page and NEVER redirects.
      return json(res, 400, { error: "invalid_request", error_description: "redirect_uri is not registered" });
    }
    const back = (params: Record<string, string>): void => {
      const target = new URL(redirectUri);
      for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
      const state = q.get("state");
      if (state !== null) target.searchParams.set("state", state);
      if (this.opts.iss !== null) target.searchParams.set("iss", this.opts.iss ?? this.asUrl);
      res.writeHead(302, { location: target.toString() });
      res.end();
    };
    if (this.opts.deny) return back({ error: "access_denied", error_description: `denied ${SENTINEL}` });
    if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
      return back({ error: "invalid_request" });
    }
    const scopes = (q.get("scope") ?? "").split(" ").filter(Boolean);
    if (scopes.some((s) => !this.scopesSupported.includes(s))) return back({ error: "invalid_scope" });
    if (q.get("resource") !== this.mcpUrl) return back({ error: "invalid_target" });
    const code = mint("code");
    this.codes.set(code, {
      challenge: q.get("code_challenge") ?? "",
      redirectUri,
      nonce: q.get("nonce"),
      scope: scopes.join(" "),
      resource: q.get("resource"),
      used: false,
    });
    back({ code });
  }

  /** A valid pair minted outside any request: what ANOTHER h2a process would hold after its own refresh. */
  mintPair(scope: string): { accessToken: string; refreshToken: string } {
    const body = this.mint(scope, null);
    return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string };
  }

  private issue(scope: string, nonce: string | null, res: ServerResponse): void {
    json(res, 200, this.mint(scope, nonce), { "cache-control": "no-store" });
  }

  private mint(scope: string, nonce: string | null): Record<string, unknown> {
    const ttl = this.opts.accessTtlSeconds ?? 3600;
    const now = Math.floor(Date.now() / 1000);
    const tid = this.opts.tid === undefined ? TENANT : this.opts.tid;
    const accessToken = jwt({
      iss: this.asUrl, sub: SUBJECT, aud: this.mcpUrl, exp: now + ttl, iat: now, jti: randomBytes(8).toString("hex"),
      scope, client_id: CLIENT_ID, ...(tid ? { tid } : {}),
    });
    this.accessTokens.set(accessToken, { exp: now + ttl, active: true });
    const body: Record<string, unknown> = { access_token: accessToken, token_type: "Bearer", expires_in: ttl, scope };
    if (scope.split(" ").includes("openid") && !this.opts.noIdToken) {
      body.id_token = jwt({
        iss: this.asUrl, aud: CLIENT_ID, sub: SUBJECT, exp: now + 3600, iat: now,
        nonce: this.opts.nonceOverride ?? nonce, email: "ada@example.test", name: "Ada", ...(tid ? { tid } : {}),
      });
    }
    if (this.opts.refresh && scope.split(" ").includes("offline_access")) {
      const refreshToken = mint("rt");
      this.refreshTokens.set(refreshToken, { active: true, scope });
      body.refresh_token = refreshToken;
    }
    return body;
  }

  private token(form: URLSearchParams, res: ServerResponse): void {
    this.tokenRequests.push(form);
    if (this.opts.tokenFailure === "500") {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`internal error ${SENTINEL}`);
      return;
    }
    if (this.opts.tokenFailure === "malformed") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(`{"access_token": "${SENTINEL}`);
      return;
    }
    const invalid = (detail: string) => json(res, 400, { error: "invalid_grant", error_description: `${detail} ${SENTINEL}` });
    if (form.get("client_id") !== CLIENT_ID) return json(res, 401, { error: "invalid_client" });
    if (form.get("grant_type") === "authorization_code") {
      const grant = this.codes.get(form.get("code") ?? "");
      if (!grant || grant.used) return invalid("code is invalid or already used");
      grant.used = true;
      if (form.get("redirect_uri") !== grant.redirectUri) return invalid("redirect_uri mismatch");
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== grant.challenge) return invalid("PKCE failed");
      const resource = form.get("resource");
      if (resource !== null && resource !== grant.resource) return invalid("resource mismatch");
      return this.issue(grant.scope, grant.nonce, res);
    }
    if (form.get("grant_type") === "refresh_token" && this.opts.refresh) {
      const presented = form.get("refresh_token") ?? "";
      if (this.opts.refuseRefresh) return invalid(`refresh token ${presented} revoked`);
      const rt = this.refreshTokens.get(presented);
      if (!rt) return invalid("unknown refresh token");
      if (!rt.active) {
        for (const other of this.refreshTokens.values()) other.active = false; // reuse detected: revoke the family
        return invalid("refresh token reuse detected");
      }
      rt.active = false; // rotation: a refresh token is good for one refresh
      return this.issue(rt.scope, null, res);
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }

  private async onRs(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://rs.invalid");
    const raw = await readBody(req);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* recorded as empty */
    }
    this.rsRequests.push({ authorization: req.headers.authorization, body });
    if (url.pathname !== "/api/v1/mcp" || req.method !== "POST") return json(res, 404, { error: "not_found" });
    if (this.opts.rsFailure === "500") return json(res, 500, { error: "server_error", detail: SENTINEL });
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const at = bearer ? this.accessTokens.get(bearer) : undefined;
    if (!at || !at.active || at.exp * 1000 <= Date.now()) {
      return json(res, 401, { error: "invalid_token", detail: SENTINEL }, {
        "www-authenticate": `Bearer error="invalid_token", resource_metadata="http://rs.invalid/.well-known/oauth-protected-resource/api/v1/mcp"`,
      });
    }
    const id = body.id ?? null;
    if (body.method === "initialize") {
      return json(res, 200, { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake" } } }, { "mcp-session-id": "sess-1" });
    }
    if (body.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    if (body.method === "tools/list") {
      const params = (body.params ?? {}) as { workspaceRef?: unknown };
      const ws = typeof params.workspaceRef === "string" ? params.workspaceRef : undefined;
      if (this.opts.members && (!ws || !this.opts.members.includes(ws))) {
        return json(res, 403, { jsonrpc: "2.0", id, error: { code: -32003, message: "access_denied" } });
      }
      return json(res, 200, { jsonrpc: "2.0", id, result: { tools: [{ name: "artifacts_list", inputSchema: {} }, { name: "artifacts_publish", inputSchema: {} }] } });
    }
    return json(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  }
}

/** A browser that follows the authorize redirect to the loopback callback. */
function simulatedBrowser(opts: {
  tamper?: (callback: URL) => URL;
  before?: (callback: URL) => Promise<void>;
} = {}) {
  const callbacks: URL[] = [];
  const open = (url: string): boolean => {
    void (async () => {
      const res = await fetch(url, { redirect: "manual" });
      await res.text();
      const location = res.headers.get("location");
      if (!location) return; // the authorization server showed an error page
      let callback = new URL(location);
      if (opts.before) await opts.before(callback);
      if (opts.tamper) callback = opts.tamper(callback);
      callbacks.push(callback);
      await fetch(callback, { redirect: "manual" }).then((r) => r.text()).catch(() => undefined);
    })();
    return true;
  };
  return { open, callbacks };
}

interface CliRun {
  code: number;
  out: string;
  err: string;
  thrown: unknown;
}

const fakes: FakeSentropic[] = [];
const runs: CliRun[] = [];
afterEach(async () => {
  await Promise.all(fakes.splice(0).map((f) => f.stop()));
});

async function fake(opts: FakeOptions = {}): Promise<FakeSentropic> {
  const f = await new FakeSentropic(opts).start();
  fakes.push(f);
  return f;
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "h2a-sentropic-cli-"));
}

async function runCli(args: string[], deps: Partial<SentropicCliDeps>): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;
  let thrown: unknown;
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: (s) => out.push(s), writeErr: (s) => err.push(s) });
  const userErr = deps.err;
  registerSentropicCommand(program, {
    cwd: () => "/repo",
    resolveWorkspace: () => LOCAL_WS,
    openBrowser: () => false,
    now: () => Date.now(),
    fetch: globalThis.fetch,
    ...deps,
    out: (s) => out.push(s),
    err: (s) => {
      err.push(s);
      userErr?.(s);
    },
    setExitCode: (c) => {
      code = c;
    },
  });
  try {
    await program.parseAsync(["node", "h2a", "sentropic", ...args]);
  } catch (error) {
    thrown = error;
    if (code === 0) code = 1;
  }
  const run = { code, out: out.join(""), err: err.join(""), thrown };
  runs.push(run);
  return run;
}

async function login(f: FakeSentropic, dir: string, extra: string[] = [], deps: Partial<SentropicCliDeps> = {}) {
  const browser = simulatedBrowser();
  const run = await runCli(["login", ...extra], { env: f.env(dir), openBrowser: browser.open, ...deps });
  return { run, browser };
}

function storedToken(f: FakeSentropic, dir: string) {
  return readAuth(serverKey(f.mcpUrl), dir);
}

describe("PKCE S256", () => {
  it("derives the RFC 7636 appendix B challenge from its verifier", () => {
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("sends a fresh 43-character verifier whose S256 is the challenge, and a fresh state and nonce per login", async () => {
    const f = await fake();
    const dir = freshDir();
    expect((await login(f, dir)).run.code).toBe(0);
    expect((await login(f, dir)).run.code).toBe(0);
    const [a1, a2] = f.authorizeRequests;
    const [t1, t2] = f.tokenRequests;
    for (const [authz, tok] of [[a1!, t1!], [a2!, t2!]] as const) {
      const verifier = tok.get("code_verifier") ?? "";
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
      expect(pkceChallengeS256(verifier)).toBe(authz.get("code_challenge"));
      expect(authz.get("code_challenge_method")).toBe("S256");
    }
    expect(a1!.get("code_challenge")).not.toBe(a2!.get("code_challenge"));
    expect(a1!.get("state")).not.toBe(a2!.get("state"));
    expect(a1!.get("nonce")).not.toBe(a2!.get("nonce"));
    expect((a1!.get("state") ?? "").length).toBeGreaterThanOrEqual(32);
    expect((a1!.get("nonce") ?? "").length).toBeGreaterThanOrEqual(32);
  });
});

describe("h2a sentropic login", () => {
  it("signs in through the 127.0.0.1 loopback redirect and stores the token 0600 with its expiry", async () => {
    const f = await fake();
    const dir = freshDir();
    const before = Date.now();
    const { run, browser } = await login(f, dir);
    expect(run.code, run.err).toBe(0);
    const authz = f.authorizeRequests[0]!;
    const redirect = new URL(authz.get("redirect_uri") ?? "");
    expect(redirect.protocol).toBe("http:");
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(redirect.pathname).toBe("/callback");
    expect(Number(redirect.port)).toBeGreaterThan(0);
    expect(authz.get("response_type")).toBe("code");
    expect(authz.get("client_id")).toBe(CLIENT_ID);
    expect(authz.get("resource")).toBe(f.mcpUrl);
    expect((authz.get("scope") ?? "").split(" ").sort()).toEqual(
      ["email", "immo:artifacts:read", "immo:artifacts:write", "mcp:discover", "mcp:resources:read", "mcp:tools:invoke", "openid"],
    );
    const tok = f.tokenRequests[0]!;
    expect(tok.get("grant_type")).toBe("authorization_code");
    expect(tok.get("redirect_uri")).toBe(authz.get("redirect_uri"));
    expect(tok.get("client_id")).toBe(CLIENT_ID);
    expect(tok.get("resource")).toBe(f.mcpUrl);

    const stored = storedToken(f, dir);
    expect(stored?.issuer).toBe(f.asUrl);
    expect(stored?.subject).toBe(SUBJECT);
    expect(stored?.refreshToken).toBeUndefined();
    const expiresAt = Date.parse(stored?.expiresAt ?? "");
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(statSync(authFilePath(dir)).mode & 0o777).toBe(0o600);

    expect(run.err).toContain(SUBJECT);
    expect(run.err).toContain(TENANT);
    expect(run.err).toContain("/api/v1/auth/oauth/authorize?");
    // single use: once the callback was served, the loopback listener is gone.
    await expect(fetch(browser.callbacks[0]!)).rejects.toThrow();
  });

  it("prints the authorization URL as the fallback when no browser is opened", async () => {
    const f = await fake();
    const dir = freshDir();
    const browser = simulatedBrowser();
    let opened = false;
    const run = await runCli(["login", "--no-browser"], {
      env: f.env(dir),
      openBrowser: () => {
        throw new Error("the browser must not be launched with --no-browser");
      },
      err: (s) => {
        const url = /(http:\/\/127\.0\.0\.1:\d+\/api\/v1\/auth\/oauth\/authorize\?\S+)/.exec(s)?.[1];
        if (url && !opened) {
          opened = true;
          browser.open(url);
        }
      },
    });
    expect(run.code, run.err).toBe(0);
    expect(opened).toBe(true);
    expect(storedToken(f, dir)?.subject).toBe(SUBJECT);
  });

  it("refuses a callback whose state does not match: nothing exchanged, nothing stored", async () => {
    const f = await fake();
    const dir = freshDir();
    const browser = simulatedBrowser({
      tamper: (cb) => {
        cb.searchParams.set("state", "forged-state");
        return cb;
      },
    });
    const run = await runCli(["login"], { env: f.env(dir), openBrowser: browser.open });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/state/i);
    expect(f.tokenRequests).toHaveLength(0);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("serves only the registered redirect: another path or a forged Host is refused without consuming the login", async () => {
    const f = await fake();
    const dir = freshDir();
    const statuses: number[] = [];
    const browser = simulatedBrowser({
      before: async (cb) => {
        const other = new URL(cb);
        other.pathname = "/elsewhere";
        statuses.push((await fetch(other)).status);
        statuses.push(await new Promise<number>((resolve) => {
          const req = httpRequest(
            { host: "127.0.0.1", port: Number(cb.port), path: `${cb.pathname}${cb.search}`, headers: { host: "attacker.example" } },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          );
          req.on("error", () => resolve(-1));
          req.end();
        }));
      },
    });
    const run = await runCli(["login"], { env: f.env(dir), openBrowser: browser.open });
    expect(statuses).toEqual([404, 404]);
    expect(run.code, run.err).toBe(0);
    expect(f.tokenRequests).toHaveLength(1);
  });

  it("times out with a clear message when the authorization server refuses the redirect URI", async () => {
    const f = await fake({ redirectAllowed: () => false });
    const dir = freshDir();
    const browser = simulatedBrowser();
    const run = await runCli(["login", "--timeout", "1"], { env: f.env(dir), openBrowser: browser.open });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/no sign-in response/i);
    expect(run.err).toMatch(/redirect/i);
    expect(f.tokenRequests).toHaveLength(0);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("refuses an authorization response issued by another server (RFC 9207 iss mismatch)", async () => {
    const f = await fake({ iss: "https://evil.example" });
    const dir = freshDir();
    const run = (await login(f, dir)).run;
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/issuer/i);
    expect(f.tokenRequests).toHaveLength(0);
  });

  it("refuses an authorization response without iss when the server advertises it", async () => {
    const f = await fake({ iss: null });
    const dir = freshDir();
    const run = (await login(f, dir)).run;
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/iss/);
    expect(f.tokenRequests).toHaveLength(0);
  });

  it("refuses an id_token whose nonce does not match the one it sent, and stores nothing", async () => {
    const f = await fake({ nonceOverride: "another-login-nonce" });
    const dir = freshDir();
    const run = (await login(f, dir)).run;
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/nonce/i);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("refuses a token response without the id_token it needs to check the nonce", async () => {
    const f = await fake({ noIdToken: true });
    const dir = freshDir();
    const run = (await login(f, dir)).run;
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/id_token/);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("reports an authorization error by its code only, after checking state", async () => {
    const f = await fake({ deny: true });
    const dir = freshDir();
    const run = (await login(f, dir)).run;
    expect(run.code).toBe(1);
    expect(run.err).toContain("access_denied");
    expect(run.err).not.toContain(SENTINEL);
    expect(f.tokenRequests).toHaveLength(0);
  });

  it("warns when the token carries no tenant, and passes an explicit --tenant to the server", async () => {
    const f = await fake({ tid: null });
    const dir = freshDir();
    const first = (await login(f, dir)).run;
    expect(first.code, first.err).toBe(0);
    expect(first.err).toMatch(/no tenant/i);
    expect(first.err).toContain("--tenant");
    await login(f, dir, ["--tenant", "tenant-2"]);
    expect(f.authorizeRequests[1]!.get("tenant")).toBe("tenant-2");
  });

  it("refuses to start without a configured client id, before any network call", async () => {
    const f = await fake();
    const dir = freshDir();
    const run = await runCli(["login"], { env: f.env(dir, { H2A_SENTROPIC_CLIENT_ID: undefined }) });
    expect(run.code).toBe(1);
    expect(run.err).toContain("H2A_SENTROPIC_CLIENT_ID");
    expect(f.authorizeRequests).toHaveLength(0);
  });

  it("refuses an issuer that is neither https nor loopback http", async () => {
    const dir = freshDir();
    const run = await runCli(["login"], {
      env: { H2A_SENTROPIC_ISSUER: "http://auth.example", H2A_SENTROPIC_CLIENT_ID: CLIENT_ID, H2A_SENTROPIC_HOME: dir },
    });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/https/);
  });

  it("requests offline_access only when the server advertises the refresh grant", async () => {
    const plain = await fake();
    await login(plain, freshDir());
    expect(plain.authorizeRequests[0]!.get("scope")).not.toContain("offline_access");
    const refreshing = await fake({ refresh: true });
    const dir = freshDir();
    await login(refreshing, dir);
    expect(refreshing.authorizeRequests[0]!.get("scope")).toContain("offline_access");
    expect(storedToken(refreshing, dir)?.refreshToken).toContain("rt-");
  });

  it("fails cleanly on a token endpoint error or an unreadable token response, storing nothing", async () => {
    for (const tokenFailure of ["500", "malformed"] as const) {
      const f = await fake({ tokenFailure });
      const dir = freshDir();
      const run = (await login(f, dir)).run;
      expect(run.code).toBe(1);
      expect(run.err).toMatch(/token endpoint/i);
      expect(existsSync(authFilePath(dir))).toBe(false);
    }
  });
});

describe("h2a sentropic status", () => {
  it("shows account, tenant, binding and expiry — never the token", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    expect((await runCli(["bind", "ws-sentropic-1"], { env: f.env(dir) })).code).toBe(0);
    const run = await runCli(["status"], { env: f.env(dir) });
    expect(run.code).toBe(0);
    const stored = storedToken(f, dir)!;
    expect(run.out).toContain(SUBJECT);
    expect(run.out).toContain(TENANT);
    expect(run.out).toContain("ws-sentropic-1");
    expect(run.out).toContain(stored.expiresAt);
    expect(run.out).not.toContain(stored.accessToken);
    const parsed = JSON.parse((await runCli(["status", "--json"], { env: f.env(dir) })).out) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).not.toContain(stored.accessToken);
    expect(parsed).toMatchObject({ loggedIn: true, subject: SUBJECT, tenantId: TENANT, expired: false });
  });

  it("says not logged in when no token is stored", async () => {
    const f = await fake();
    const run = await runCli(["status"], { env: f.env(freshDir()) });
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/not logged in/i);
    expect(run.out).toContain("h2a sentropic login");
  });

  it("prompts a re-login once the token has expired", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["status"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
    expect(run.out).toMatch(/expired/i);
    expect(run.out).toContain("h2a sentropic login");
  });
});

describe("h2a sentropic bind / unbind", () => {
  it("records the explicit choice for this local workspace, persisted 0600, shown by status, removed by unbind", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    const bound = await runCli(["bind", "ws-sentropic-1"], { env: f.env(dir) });
    expect(bound.code, bound.err).toBe(0);
    const record = readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir);
    expect(record).toMatchObject({ localWorkspace: LOCAL_WS, workspaceId: "ws-sentropic-1", tenantId: TENANT, subject: SUBJECT });
    expect(statSync(bindingFilePath(serverKey(f.mcpUrl), LOCAL_WS, dir)).mode & 0o777).toBe(0o600);
    const unbound = await runCli(["unbind"], { env: f.env(dir) });
    expect(unbound.code).toBe(0);
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)).toBeUndefined();
    expect((await runCli(["status"], { env: f.env(dir) })).out).toMatch(/not bound/i);
  });

  it("refuses to bind outside a git workspace, or before any login", async () => {
    const f = await fake();
    const dir = freshDir();
    const noLogin = await runCli(["bind", "ws-sentropic-1"], { env: f.env(dir) });
    expect(noLogin.code).toBe(1);
    expect(noLogin.err).toContain("h2a sentropic login");
    await login(f, dir);
    const noGit = await runCli(["bind", "ws-sentropic-1"], { env: f.env(dir), resolveWorkspace: () => undefined });
    expect(noGit.code).toBe(1);
    expect(noGit.err).toMatch(/git/);
  });

  it("--verify asks the resource server and records nothing for a workspace it refuses", async () => {
    const f = await fake({ members: ["ws-member"] });
    const dir = freshDir();
    await login(f, dir);
    const refused = await runCli(["bind", "ws-other", "--verify"], { env: f.env(dir) });
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/access_denied/);
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)).toBeUndefined();
    const accepted = await runCli(["bind", "ws-member", "--verify"], { env: f.env(dir) });
    expect(accepted.code, accepted.err).toBe(0);
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)?.workspaceId).toBe("ws-member");
  });
});

describe("h2a sentropic tools --preprod (MCP tools/list)", () => {
  it("refuses without the explicit --preprod flag and calls nothing", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["tools"], { env: f.env(dir) });
    expect(run.code).toBe(1);
    expect(run.err).toContain("--preprod");
    expect(f.rsRequests).toHaveLength(0);
  });

  it("lists the tools of the bound workspace with the stored bearer token", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    await runCli(["bind", "ws-sentropic-1"], { env: f.env(dir) });
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir) });
    expect(run.code, run.err).toBe(0);
    expect(run.out).toContain("artifacts_list");
    expect(run.out).toContain("artifacts_publish");
    const list = f.rsRequests.find((r) => r.body.method === "tools/list")!;
    expect(list.authorization).toBe(`Bearer ${storedToken(f, dir)!.accessToken}`);
    expect((list.body.params as { workspaceRef?: string }).workspaceRef).toBe("ws-sentropic-1");
  });

  it("prompts a re-login for an expired token and never reaches the resource server", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/expired/i);
    expect(run.err).toContain("h2a sentropic login");
    expect(run.thrown).toBeUndefined();
    expect(f.rsRequests).toHaveLength(0);
  });

  it("prompts a re-login when the resource server rejects the token", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    for (const at of f.accessTokens.values()) at.active = false;
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir) });
    expect(run.code).toBe(1);
    expect(run.err).toContain("invalid_token");
    expect(run.err).toContain("h2a sentropic login");
  });
});

describe("refresh-token rotation (when the server issues refresh tokens)", () => {
  it("rotates on every refresh: the stored pair is replaced and the old refresh token is never kept", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    const first = storedToken(f, dir)!;
    const later = Date.now() + 2 * HOUR;
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => later });
    expect(run.code, run.err).toBe(0);
    const refresh = f.tokenRequests.find((t) => t.get("grant_type") === "refresh_token")!;
    expect(refresh.get("refresh_token")).toBe(first.refreshToken);
    expect(refresh.get("client_id")).toBe(CLIENT_ID);
    const second = storedToken(f, dir)!;
    expect(second.refreshToken).toBeDefined();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(readFileSync(authFilePath(dir), "utf8")).not.toContain(first.refreshToken!);
    expect(Date.parse(second.expiresAt!)).toBeGreaterThan(later);
    // The next refresh presents the rotated token, never the old one.
    const again = await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => later + 2 * HOUR });
    expect(again.code, again.err).toBe(0);
    const refreshes = f.tokenRequests.filter((t) => t.get("grant_type") === "refresh_token");
    expect(refreshes[1]!.get("refresh_token")).toBe(second.refreshToken);
  });

  it("keeps the pair another process rotated while this refresh was in flight (compare-and-set)", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    const first = storedToken(f, dir)!;
    const later = Date.now() + 2 * HOUR;
    const theirs = f.mintPair(f.refreshTokens.get(first.refreshToken!)!.scope);
    // Another h2a process finishes its own rotation between our refresh answer and our store write.
    const racingFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (String(init?.body ?? "").includes("grant_type=refresh_token")) {
        writeAuth({ ...first, accessToken: theirs.accessToken, refreshToken: theirs.refreshToken, expiresAt: new Date(later + HOUR).toISOString() }, dir);
      }
      return res;
    };
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => later, fetch: racingFetch });
    expect(run.code, run.err).toBe(0);
    const stored = storedToken(f, dir)!;
    expect(stored.refreshToken).toBe(theirs.refreshToken);
    expect(stored.accessToken).toBe(theirs.accessToken);
    const list = f.rsRequests.find((r) => r.body.method === "tools/list")!;
    expect(list.authorization).toBe(`Bearer ${theirs.accessToken}`);
  });

  it("a refused refresh prompts a re-login, drops the dead token, and does not crash", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    f.opts.refuseRefresh = true;
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
    expect(run.code).toBe(1);
    expect(run.thrown).toBeUndefined();
    expect(run.err).toContain("invalid_grant");
    expect(run.err).toContain("h2a sentropic login");
    expect(storedToken(f, dir)).toBeUndefined();
    expect(f.rsRequests).toHaveLength(0);
  });
});

describe("h2a sentropic logout", () => {
  it("revokes on the server, then removes the token locally", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    const stored = storedToken(f, dir)!;
    const run = await runCli(["logout"], { env: f.env(dir) });
    expect(run.code, run.err).toBe(0);
    const revoked = f.revokeRequests.map((r) => r.get("token"));
    expect(revoked).toContain(stored.accessToken);
    expect(revoked).toContain(stored.refreshToken);
    expect(storedToken(f, dir)).toBeUndefined();
    expect((await runCli(["status"], { env: f.env(dir) })).out).toMatch(/not logged in/i);
  });

  it("still removes the token locally when the server revocation fails, and --local-only calls nothing", async () => {
    const f = await fake({ revokeFailure: true });
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["logout"], { env: f.env(dir) });
    expect(run.code).toBe(0);
    expect(run.err).toMatch(/revocation/i);
    expect(storedToken(f, dir)).toBeUndefined();
    const g = await fake();
    const dir2 = freshDir();
    await login(g, dir2);
    expect((await runCli(["logout", "--local-only"], { env: g.env(dir2) })).code).toBe(0);
    expect(g.revokeRequests).toHaveLength(0);
    expect(storedToken(g, dir2)).toBeUndefined();
  });
});

describe("no secret ever reaches the output or an error (sentinel)", () => {
  it("prints no lower-level error text: a parse error quoting bytes, or a store error carrying them as cause", () => {
    let parseError: unknown;
    try {
      JSON.parse(SENTINEL);
    } catch (error) {
      parseError = error;
    }
    expect(String(parseError)).toContain(SENTINEL); // V8 quotes the bytes it failed on…
    expect(publicErrorMessage(parseError)).not.toContain(SENTINEL); // …and the CLI line never does.
    // Even a store error that carried such an error as its cause prints its own message only.
    const damaged = new DamagedAuthFileError("/state/h2a-auth.json", "unreadable", { cause: parseError as NodeJS.ErrnoException });
    expect(publicErrorMessage(damaged)).not.toContain(SENTINEL);
    expect(publicErrorMessage(new Error(SENTINEL))).not.toContain(SENTINEL);
  });


  it("never prints the code, the code verifier, an access, refresh or id token, nor a server body", async () => {
    runs.length = 0;
    const verifiers: string[] = [];
    const scenarios: Array<{ opts: FakeOptions; steps: (f: FakeSentropic, dir: string) => Promise<void> }> = [
      { opts: { refresh: true }, steps: async (f, dir) => {
        await runCli(["status", "--json"], { env: f.env(dir) });
        await runCli(["bind", "ws-sentropic-1", "--verify"], { env: f.env(dir) });
        await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
        await runCli(["logout"], { env: f.env(dir) });
      } },
      { opts: { refresh: true }, steps: async (f, dir) => {
        f.opts.refuseRefresh = true;
        await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
      } },
      { opts: {}, steps: async (f, dir) => {
        f.opts.rsFailure = "500";
        await runCli(["tools", "--preprod"], { env: f.env(dir) });
        delete f.opts.rsFailure;
        for (const at of f.accessTokens.values()) at.active = false;
        await runCli(["tools", "--preprod"], { env: f.env(dir) });
        f.opts.revokeFailure = true;
        await runCli(["logout"], { env: f.env(dir) });
      } },
      { opts: { tokenFailure: "500" }, steps: async () => {} },
      { opts: { tokenFailure: "malformed" }, steps: async () => {} },
      { opts: { deny: true }, steps: async () => {} },
      { opts: { nonceOverride: "x" }, steps: async () => {} },
    ];
    // Unexpected failures inside the CLI: their own messages (which may quote anything) never print.
    const unexpected = await fake();
    const unexpectedDir = freshDir();
    await login(unexpected, unexpectedDir);
    await runCli(["status"], {
      env: unexpected.env(unexpectedDir),
      resolveWorkspace: () => {
        throw new Error(`git exploded on ${SENTINEL}`);
      },
    });
    await runCli(["tools", "--preprod"], {
      env: unexpected.env(unexpectedDir),
      fetch: async () => {
        throw new TypeError(`fetch failed for http://127.0.0.1/callback?code=${SENTINEL}`);
      },
    });
    expect(runs.slice(-2).every((run) => run.code === 1)).toBe(true);
    for (const scenario of scenarios) {
      const f = await fake(scenario.opts);
      const dir = freshDir();
      await login(f, dir);
      await scenario.steps(f, dir);
      verifiers.push(...f.tokenRequests.map((t) => t.get("code_verifier")).filter((v): v is string => !!v));
    }
    expect(runs.length).toBeGreaterThan(10);
    expect(verifiers.length).toBeGreaterThan(3);
    for (const run of runs) {
      const rendered = [run.out, run.err, run.thrown === undefined ? "" : inspect(run.thrown, { depth: 8 })].join("\n");
      expect(rendered).not.toContain(SENTINEL);
      for (const verifier of verifiers) expect(rendered).not.toContain(verifier);
    }
  });
});
