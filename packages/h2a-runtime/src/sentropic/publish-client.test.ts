/**
 * `h2a sentropic …` end to end against a LOCAL fake authorization server + MCP resource server
 * (two loopback HTTP servers, two origins).
 *
 * The fake AS behaves like the sentropic AS for the `h2a-cli` registration (sentropic
 * api/src/scripts/oauth-register-client.ts H2A_CLI_PRESET; packages/auth-hono authorize, token
 * and well-known handlers): a port-less loopback redirect (any port), PKCE S256, single-use code,
 * redirect_uri echo, RFC 8707 resource, RFC 9207 iss on the response; requested scopes checked
 * against the CLIENT's allowed scopes (not scopes_supported); offline_access and the
 * refresh_token grant advertised only by a discovery that names a refresh-eligible client_id;
 * rotating refresh tokens with reuse detection (the whole family is revoked), a refresh whose
 * resource is not the one the grant was sealed with refused (refresh-handler); an id_token only
 * when openid is requested.
 *
 * The fake RS behaves like the sentropic MCP dispatch with the workspaces_list host tool
 * (api/src/services/mcp/registry-dispatch.ts and artifacts/transport.ts on
 * feat/mcp-workspaces-list): bearer, tid and per-method scope checks; registry tools listed only
 * for a workspace the account can read; workspaces_list with closed arguments, sorted by name
 * then ref; a tool-level access_denied for a workspace the account cannot read or publish to.
 * Like train 1b (sentropic c968b8d16, api/src/routes/namespaces/mcp.ts authenticate), it checks
 * membership at authentication: the workspace a request binds (its workspaceRef, else the default
 * one, the most recent membership) must be one the account is a member of, else 403 -32003
 * access_denied — so a removed member is refused on the stale workspaceRef itself.
 *
 * Every secret the fake mints (authorization code, access token, refresh token, id_token
 * signature) carries SENTINEL, every failure body it can return carries SENTINEL too, and the
 * code verifier the client sends is recorded: the sentinel suite asserts none of them ever
 * reaches stdout, stderr or a thrown error.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";

import { DamagedAuthFileError, authFilePath, readAuth, serverKey, writeAuth } from "./auth-token.js";
import { registerSentropicCommand, type SentropicCliDeps } from "./cli.js";
import { pkceChallengeS256 } from "./enroll-flow.js";
import { openMcpSession } from "./mcp-client.js";
import { SentropicWorkspaceAccessError, publicErrorMessage } from "./publish-errors.js";
import { bindingFilePath, bindingsDir, readBinding } from "./workspace-binding.js";

const SENTINEL = "zzSENTINELzz";
const CLIENT_ID = "h2a-cli";
/** H2A_CLI_PRESET OAUTH_CLIENT_SCOPES: what the AS lets this client ask for. */
const CLIENT_ALLOWED_SCOPES = [
  "mcp:discover", "mcp:resources:read", "mcp:tools:invoke", "immo:artifacts:read", "immo:artifacts:write", "offline_access",
];
/** One token, one audience: the sentropic MCP server checks the mcp:* scopes only. */
const PUBLISH_SCOPES = ["mcp:discover", "mcp:resources:read", "mcp:tools:invoke"];
const SUBJECT = "user-0b9c8f1e";
const TENANT = "tenant-acme";
const LOCAL_WS = `ws:${"c".repeat(64)}`;
const HOUR = 3_600_000;
const BOUND = "ws-sentropic-1";

const b64json = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const mint = (prefix: string): string => `${prefix}-${SENTINEL}-${randomBytes(12).toString("base64url")}`;
const jwt = (claims: Record<string, unknown>): string =>
  `${b64json({ alg: "EdDSA", typ: "JWT" })}.${b64json(claims)}.${SENTINEL}${randomBytes(16).toString("base64url")}`;

interface DirectoryEntry {
  workspaceRef: string;
  name: string;
  role: "viewer" | "commenter" | "editor" | "admin";
  publishable: boolean;
}

/** What workspaces_list finds readable for the account by default. */
const DIRECTORY: readonly DirectoryEntry[] = Object.freeze([
  { workspaceRef: BOUND, name: "Sentropic one", role: "editor", publishable: true },
  { workspaceRef: "ws-viewer", name: "Read only", role: "viewer", publishable: false },
]);

const WORKSPACES_LIST = { name: "workspaces_list", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const REGISTRY_TOOLS = [{ name: "artifacts_list", inputSchema: {} }, { name: "artifacts_publish", inputSchema: {} }];

interface FakeOptions {
  /** h2a-cli is refresh-eligible: its discovery advertises offline_access + refresh_token, refresh tokens rotate. */
  refresh?: boolean;
  /** the tid claim; null = none (multi-org account without a selection). */
  tid?: string | null;
  /** the sub claim (default SUBJECT). */
  sub?: string;
  accessTtlSeconds?: number;
  /** the scope the token endpoint grants instead of the requested one. */
  grantedScope?: string;
  /** access token claims overridden (consistency checks). */
  accessClaims?: Record<string, unknown>;
  /** issue an id_token although openid was not requested. */
  idTokenAlways?: boolean;
  /** the id_token carries this nonce instead of the requested one. */
  nonceOverride?: string;
  /** the iss on the authorization response; null = omitted. */
  iss?: string | null;
  redirectAllowed?: (uri: string) => boolean;
  refuseRefresh?: boolean;
  deny?: boolean;
  tokenFailure?: "500" | "malformed";
  revokeFailure?: boolean;
  /** the workspaces the account can read now (workspaces_list, registry tools); default DIRECTORY. */
  directory?: readonly DirectoryEntry[];
  /**
   * the workspaces the account is a member of (train 1b: resolveMemberWorkspace at
   * authentication); default the directory's, in order. The workspace a request binds — its
   * params.workspaceRef, or else the default one (the first member) — outside them is refused:
   * 403 -32003 access_denied on tools/list and on every tools/call. The host tool ignores a
   * workspaceRef and binds the default one, so it is refused only for an account with no member
   * workspace at all.
   */
  members?: readonly string[];
  /**
   * the RS advertises and serves the workspaces_list host tool (default true). false = sentropic
   * main before train 1b: no host tool, no membership check at authentication, and tools/list
   * for a workspace the account cannot bind (the default one included) answers the catch-all
   * JSON-RPC -32603 Internal error.
   */
  workspacesTool?: boolean;
  /** the workspace the server falls back to without params.workspaceRef (default: the first member; BOUND before train 1b). */
  defaultWorkspace?: string;
  /** workspaces_list finds the current credential unreadable: 403 -32003. */
  directoryDenied?: boolean;
  /** a workspace-bound tools/call is refused at authentication: 403 -32003 access_denied. */
  callDenied?: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const noArguments = (value: unknown): boolean => value === undefined || (isRecord(value) && Object.keys(value).length === 0);

class FakeSentropic {
  readonly discoveryRequests: URLSearchParams[] = [];
  readonly authorizeRequests: URLSearchParams[] = [];
  readonly tokenRequests: URLSearchParams[] = [];
  readonly revokeRequests: URLSearchParams[] = [];
  readonly rsRequests: Array<{ authorization: string | undefined; body: Record<string, unknown> }> = [];
  readonly accessTokens = new Map<string, { exp: number; active: boolean; scopes: string[]; tid: string | undefined }>();
  readonly refreshTokens = new Map<string, { active: boolean; scope: string; resource: string }>();
  private readonly codes = new Map<string, CodeGrant>();
  private as: Server | undefined;
  private rs: Server | undefined;
  asUrl = "";
  mcpUrl = "";

  constructor(readonly opts: FakeOptions = {}) {}

  get directory(): readonly DirectoryEntry[] {
    return this.opts.directory ?? DIRECTORY;
  }

  get members(): readonly string[] {
    return this.opts.members ?? this.directory.map((entry) => entry.workspaceRef);
  }

  /** The params of every tools/call the RS received, in order. */
  get toolCalls(): Array<Record<string, unknown>> {
    return this.rsRequests.filter((r) => r.body.method === "tools/call").map((r) => (isRecord(r.body.params) ? r.body.params : {}));
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
      this.discoveryRequests.push(url.searchParams);
      // wellknown-handler: refresh is advertised per client, for ?client_id=<refresh-eligible>.
      const eligible = this.opts.refresh === true && url.searchParams.get("client_id") === CLIENT_ID;
      return json(res, 200, {
        issuer: this.asUrl,
        authorization_endpoint: `${this.asUrl}/api/v1/auth/oauth/authorize`,
        token_endpoint: `${this.asUrl}/api/v1/auth/oauth/token`,
        revocation_endpoint: `${this.asUrl}/api/v1/auth/oauth/revoke`,
        scopes_supported: [
          "openid", "profile", "email", "mcp:discover", "mcp:resources:read", "mcp:tools:invoke", "immo:read", "immo:search",
          "immo:documents:read", "immo:artifacts:read", "immo:artifacts:write", ...(eligible ? ["offline_access"] : []),
        ],
        grant_types_supported: ["authorization_code", "client_credentials", ...(eligible ? ["refresh_token"] : [])],
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
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
    // Registered port-less (http://127.0.0.1/callback): any loopback port is accepted (RFC 8252 §7.3).
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
    // validateScope: offline_access for a refresh-eligible client only, and every scope inside
    // the CLIENT's allowed scopes — scopes_supported is descriptive and decides nothing.
    const scopes = (q.get("scope") ?? "").split(" ").filter(Boolean);
    if (scopes.includes("offline_access") && !this.opts.refresh) return back({ error: "invalid_scope" });
    if (scopes.some((s) => !CLIENT_ALLOWED_SCOPES.includes(s))) return back({ error: "invalid_scope" });
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
    const body = this.mint(scope, null, this.mcpUrl);
    return { accessToken: body.access_token as string, refreshToken: body.refresh_token as string };
  }

  private issue(scope: string, nonce: string | null, resource: string, res: ServerResponse): void {
    json(res, 200, this.mint(scope, nonce, resource), { "cache-control": "no-store" });
  }

  /** `resource` is the one the grant was sealed with at the authorize step. */
  private mint(scope: string, nonce: string | null, resource: string): Record<string, unknown> {
    const ttl = this.opts.accessTtlSeconds ?? 3600;
    const now = Math.floor(Date.now() / 1000);
    const tid = this.opts.tid === undefined ? TENANT : this.opts.tid;
    const sub = this.opts.sub ?? SUBJECT;
    const granted = this.opts.grantedScope ?? scope;
    const accessToken = jwt({
      iss: this.asUrl, sub, aud: this.mcpUrl, exp: now + ttl, iat: now, jti: randomBytes(8).toString("hex"),
      scope: granted, client_id: CLIENT_ID, ...(tid ? { tid } : {}), ...this.opts.accessClaims,
    });
    this.accessTokens.set(accessToken, { exp: now + ttl, active: true, scopes: granted.split(" ").filter(Boolean), tid: tid ?? undefined });
    const body: Record<string, unknown> = { access_token: accessToken, token_type: "Bearer", expires_in: ttl, scope: granted };
    // token-handler: an id_token only when openid was granted.
    if (scope.split(" ").includes("openid") || this.opts.idTokenAlways) {
      const idNonce = this.opts.nonceOverride ?? nonce;
      body.id_token = jwt({
        iss: this.asUrl, aud: CLIENT_ID, sub, exp: now + 3600, iat: now, ...(idNonce ? { nonce: idNonce } : {}), ...(tid ? { tid } : {}),
      });
    }
    if (this.opts.refresh && scope.split(" ").includes("offline_access")) {
      const refreshToken = mint("rt");
      this.refreshTokens.set(refreshToken, { active: true, scope, resource });
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
      return this.issue(grant.scope, grant.nonce, grant.resource ?? this.mcpUrl, res);
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
      // refresh-handler: one resource at most, and the one the grant was sealed with (before the
      // token is consumed).
      const resources = form.getAll("resource");
      if (resources.length > 1) return json(res, 400, { error: "invalid_target", error_description: `one resource ${SENTINEL}` });
      if (resources.length === 1 && resources[0] !== rt.resource) return invalid("resource does not match the original grant");
      rt.active = false; // rotation: a refresh token is good for one refresh
      return this.issue(rt.scope, null, rt.resource, res);
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
    const params = isRecord(body.params) ? body.params : {};
    const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}): void =>
      json(res, status, { jsonrpc: "2.0", id, error: { code, message, data: { detail: SENTINEL } } }, headers);
    const scopeRefused = (scope: string): void =>
      rpcError(403, -32003, "insufficient_scope", { "www-authenticate": `Bearer error="insufficient_scope", scope="${scope}"` });
    const toolResult = (payload: unknown, isError: boolean): void =>
      json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError } });
    const train1b = this.opts.workspacesTool !== false;
    const hostTool = body.method === "tools/call" && params.name === "workspaces_list" && train1b;
    // The workspace a request binds: params.workspaceRef (ignored by the host tool, which binds
    // none), else a default. Train 1b (mcp.ts authenticate → resolveMemberWorkspace) honours it
    // for a member only, its default being the most recent membership; sentropic main before it
    // falls back to a default of its own choosing, with no membership check.
    const requested = typeof params.workspaceRef === "string" && !hostTool ? params.workspaceRef : undefined;
    const workspace = requested ?? this.opts.defaultWorkspace ?? (train1b ? this.members[0] : BOUND);
    const member = workspace !== undefined && this.members.includes(workspace);
    const readable = this.directory.find((entry) => entry.workspaceRef === workspace);
    if (body.method === "tools/list") {
      if (!at.scopes.includes("mcp:discover")) return scopeRefused("mcp:discover");
      if (!at.tid) return rpcError(403, -32003, "access_denied");
      // Train 1b: a non-member workspace (or no default one) is refused at authentication.
      if (train1b && !member) return rpcError(403, -32003, "access_denied");
      if (!readable && !train1b) {
        // sentropic main: discover binds the workspace, and the throw becomes the catch-all -32603.
        return json(res, 200, { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
      }
      return json(res, 200, { jsonrpc: "2.0", id, result: { tools: [
        // transport.discover: no bindable workspace hides the registry tools, the host tool stays.
        ...(readable ? REGISTRY_TOOLS : []),
        ...(train1b ? [WORKSPACES_LIST] : []),
      ] } });
    }
    if (body.method === "tools/call" && typeof params.name === "string") {
      if (hostTool && !noArguments(params.arguments)) return rpcError(400, -32600, "invalid_request");
      if (!at.scopes.includes("mcp:tools:invoke")) return scopeRefused("mcp:tools:invoke");
      if (!at.tid) return rpcError(403, -32003, "access_denied");
      if (train1b && !member) return rpcError(403, -32003, "access_denied");
      if (hostTool) {
        if (this.opts.directoryDenied) return rpcError(403, -32003, "access_denied");
        const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
        const workspaces = [...this.directory].sort((a, b) => order(a.name, b.name) || order(a.workspaceRef, b.workspaceRef));
        return toolResult({ workspaces }, false);
      }
      if (this.opts.callDenied) return rpcError(403, -32003, "access_denied");
      // transport.invoke: an unknown tool, an unreadable workspace or a write without publish
      // rights is a tool-level access_denied.
      const known = REGISTRY_TOOLS.some((tool) => tool.name === params.name);
      if (!known || !readable || (params.name === "artifacts_publish" && !readable.publishable)) {
        return toolResult({ error: "access_denied", detail: SENTINEL }, true);
      }
      return toolResult({ ok: true, workspaceRef: workspace }, false);
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

/** One raw HTTP exchange on the loopback receiver (a request target no fetch would send). */
function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1");
    socket.setTimeout(2000, () => socket.destroy());
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => undefined);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
    socket.write(text);
  });
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

const refreshGrants = (f: FakeSentropic) => f.tokenRequests.filter((t) => t.get("grant_type") === "refresh_token");

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
    expect((authz.get("scope") ?? "").split(" ").sort()).toEqual([...PUBLISH_SCOPES].sort());
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

  it("asks only for the MCP scopes the h2a-cli client is registered for: no openid, email nor immo scope", async () => {
    const f = await fake();
    const { run } = await login(f, freshDir());
    expect(run.code, run.err).toBe(0);
    const scopes = (f.authorizeRequests[0]!.get("scope") ?? "").split(" ");
    expect([...scopes].sort()).toEqual([...PUBLISH_SCOPES].sort());
    for (const scope of scopes) expect(CLIENT_ALLOWED_SCOPES).toContain(scope);
    expect(scopes.filter((s) => s === "openid" || s === "email" || s.startsWith("immo:"))).toEqual([]);
  });

  it("signs in without openid: no id_token is needed, the account comes from the access token", async () => {
    const f = await fake();
    const dir = freshDir();
    const { run } = await login(f, dir);
    expect(run.code, run.err).toBe(0);
    expect(f.tokenRequests).toHaveLength(1);
    expect(storedToken(f, dir)?.subject).toBe(SUBJECT);
    expect(run.err).toContain(`account ${SUBJECT}`);
    expect(run.err).toContain(`tenant ${TENANT}`);
  });

  it("refuses an access token minted for another issuer, client or resource server, or without a subject, and stores nothing", async () => {
    for (const accessClaims of [
      { iss: "https://other-as.example" },
      { client_id: "another-client" },
      { aud: "https://other-rs.example/api/v1/mcp" },
      { sub: "" },
    ]) {
      const f = await fake({ accessClaims });
      const dir = freshDir();
      const { run } = await login(f, dir);
      expect(run.code, JSON.stringify(accessClaims)).toBe(1);
      expect(run.err).toMatch(/access token/);
      expect(existsSync(authFilePath(dir))).toBe(false);
    }
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
    const run = await runCli(["login", "--timeout", "1"], { env: f.env(dir), openBrowser: browser.open });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/state/i);
    expect(f.tokenRequests).toHaveLength(0);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("lets no forged callback consume the login: a wrong state is refused and the real callback still completes it", async () => {
    const f = await fake();
    const dir = freshDir();
    const statuses: number[] = [];
    const browser = simulatedBrowser({
      before: async (cb) => {
        // A web page guessing the loopback port fires a callback of its own first.
        const forged = new URL(cb);
        forged.searchParams.set("state", "forged-state");
        forged.searchParams.set("code", "attacker-code");
        statuses.push((await fetch(forged)).status);
      },
    });
    const run = await runCli(["login"], { env: f.env(dir), openBrowser: browser.open });
    expect(statuses).toEqual([400]);
    expect(run.code, run.err).toBe(0);
    expect(run.err).toMatch(/state/i);
    expect(f.tokenRequests).toHaveLength(1);
    expect(f.tokenRequests[0]!.get("code")).not.toBe("attacker-code");
    expect(storedToken(f, dir)?.subject).toBe(SUBJECT);
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

  it("answers a malformed request target with a 404, without crashing or consuming the login", async () => {
    const f = await fake();
    const dir = freshDir();
    const answers: string[] = [];
    const browser = simulatedBrowser({
      before: async (cb) => {
        answers.push(await rawRequest(Number(cb.port), `GET http://[::1 HTTP/1.1\r\nHost: 127.0.0.1:${cb.port}\r\nConnection: close\r\n\r\n`));
      },
    });
    const run = await runCli(["login"], { env: f.env(dir), openBrowser: browser.open });
    expect(answers[0]).toMatch(/^HTTP\/1\.1 404 /);
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
    const f = await fake({ idTokenAlways: true, nonceOverride: "another-login-nonce" });
    const dir = freshDir();
    const run = (await login(f, dir)).run;
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/nonce/i);
    expect(existsSync(authFilePath(dir))).toBe(false);
  });

  it("checks an id_token the server sends anyway against the nonce of this login, and accepts the matching one", async () => {
    const f = await fake({ idTokenAlways: true });
    const dir = freshDir();
    const { run } = await login(f, dir);
    expect(run.code, run.err).toBe(0);
    expect((f.authorizeRequests[0]!.get("nonce") ?? "").length).toBeGreaterThanOrEqual(32);
    expect(storedToken(f, dir)?.subject).toBe(SUBJECT);
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

  it("warns when the server grants fewer scopes than publishing needs", async () => {
    const f = await fake({ grantedScope: "mcp:discover mcp:resources:read" });
    const { run } = await login(f, freshDir());
    expect(run.code, run.err).toBe(0);
    expect(run.err).toMatch(/mcp:tools:invoke was not granted/);
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

  it("requests offline_access only when discovery for this client advertises the refresh grant", async () => {
    const plain = await fake();
    await login(plain, freshDir());
    expect(plain.authorizeRequests[0]!.get("scope")).not.toContain("offline_access");
    const refreshing = await fake({ refresh: true });
    const dir = freshDir();
    const { run } = await login(refreshing, dir);
    expect(run.code, run.err).toBe(0);
    // The AS advertises refresh per client: the discovery read names ours.
    expect(refreshing.discoveryRequests.map((q) => q.get("client_id"))).toEqual([CLIENT_ID]);
    expect((refreshing.authorizeRequests[0]!.get("scope") ?? "").split(" ").sort()).toEqual([...PUBLISH_SCOPES, "offline_access"].sort());
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
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    const run = await runCli(["status"], { env: f.env(dir) });
    expect(run.code).toBe(0);
    const stored = storedToken(f, dir)!;
    expect(run.out).toContain(SUBJECT);
    expect(run.out).toContain(TENANT);
    expect(run.out).toContain(BOUND);
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
    const bound = await runCli(["bind", BOUND], { env: f.env(dir) });
    expect(bound.code, bound.err).toBe(0);
    const record = readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir);
    expect(record).toMatchObject({ localWorkspace: LOCAL_WS, workspaceId: BOUND, tenantId: TENANT, subject: SUBJECT });
    const path = bindingFilePath(serverKey(f.mcpUrl), LOCAL_WS, dir);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // A routing choice only: none of the listing (role, publishable, name) is kept.
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")) as object).sort()).toEqual(
      ["boundAt", "localWorkspace", "server", "subject", "tenantId", "workspaceId"],
    );
    const unbound = await runCli(["unbind"], { env: f.env(dir) });
    expect(unbound.code).toBe(0);
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)).toBeUndefined();
    expect((await runCli(["status"], { env: f.env(dir) })).out).toMatch(/not bound/i);
  });

  it("refuses to bind outside a git workspace, or before any login", async () => {
    const f = await fake();
    const dir = freshDir();
    const noLogin = await runCli(["bind", BOUND], { env: f.env(dir) });
    expect(noLogin.code).toBe(1);
    expect(noLogin.err).toContain("h2a sentropic login");
    await login(f, dir);
    const noGit = await runCli(["bind", BOUND], { env: f.env(dir), resolveWorkspace: () => undefined });
    expect(noGit.code).toBe(1);
    expect(noGit.err).toMatch(/git/);
  });

  it("checks the workspace against workspaces_list: one the account cannot read or cannot publish to is refused, nothing recorded", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    const unknown = await runCli(["bind", "ws-unknown"], { env: f.env(dir) });
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("ws-unknown");
    expect(unknown.err).toContain("h2a sentropic workspaces");
    const viewer = await runCli(["bind", "ws-viewer"], { env: f.env(dir) });
    expect(viewer.code).toBe(1);
    expect(viewer.err).toMatch(/not publishable/);
    expect(viewer.err).toContain("viewer");
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)).toBeUndefined();
    const accepted = await runCli(["bind", BOUND], { env: f.env(dir) });
    expect(accepted.code, accepted.err).toBe(0);
    expect(accepted.err).toContain("Sentropic one");
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)?.workspaceId).toBe(BOUND);
    // The workspace in question travels as params.workspaceRef: train 1b refuses a non-member one
    // at tools/list already (403 access_denied); the others get the closed, argument-free call.
    const lists = f.rsRequests.filter((r) => r.body.method === "tools/list");
    expect(lists.map((r) => (r.body.params as { workspaceRef?: string }).workspaceRef)).toEqual(["ws-unknown", "ws-viewer", BOUND]);
    expect(f.toolCalls).toEqual([
      { name: "workspaces_list", arguments: {}, workspaceRef: "ws-viewer" },
      { name: "workspaces_list", arguments: {}, workspaceRef: BOUND },
    ]);
  });

  it("detects workspaces_list by its presence in tools/list: absent, the bind is recorded unchecked with a warning and the tool is never called", async () => {
    const f = await fake({ workspacesTool: false });
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["bind", BOUND], { env: f.env(dir) });
    expect(run.code, run.err).toBe(0);
    expect(run.err).toMatch(/does not offer workspaces_list/);
    expect(run.err).toMatch(/without validation/);
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)?.workspaceId).toBe(BOUND);
    expect(f.rsRequests.some((r) => r.body.method === "tools/list")).toBe(true);
    expect(f.toolCalls).toHaveLength(0);
  });

  it("before workspaces_list, reads a -32603 on tools/list as the tool absent: the bind is recorded unchecked, with both warnings", async () => {
    const f = await fake({ workspacesTool: false });
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["bind", "ws-other-tenant"], { env: f.env(dir) });
    expect(run.code, run.err).toBe(0);
    expect(run.err).toMatch(/without validation/);
    expect(run.err).toContain("-32603");
    expect(readBinding(serverKey(f.mcpUrl), LOCAL_WS, dir)?.workspaceId).toBe("ws-other-tenant");
    expect(f.toolCalls).toHaveLength(0);
    // The listing was asked for that very workspace: params.workspaceRef is always sent.
    const lists = f.rsRequests.filter((r) => r.body.method === "tools/list");
    expect(lists.map((r) => (r.body.params as { workspaceRef?: string }).workspaceRef)).toEqual(["ws-other-tenant"]);
  });

  it("reads the list afresh at every bind and never stores it", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    // The account loses its publish rights after the bind: the next bind sees it at once.
    f.opts.directory = [{ workspaceRef: BOUND, name: "Sentropic one", role: "viewer", publishable: false }];
    const again = await runCli(["bind", BOUND], { env: f.env(dir) });
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/not publishable/);
    expect(f.toolCalls.filter((c) => c.name === "workspaces_list")).toHaveLength(2);
    expect(readdirSync(dir).sort()).toEqual(["h2a-auth.json", "h2a-bindings"]);
    expect(readdirSync(bindingsDir(dir))).toHaveLength(1);
    const stored = readFileSync(bindingFilePath(serverKey(f.mcpUrl), LOCAL_WS, dir), "utf8");
    for (const listed of ["publishable", "role", "Sentropic one", "ws-viewer", "workspaces"]) expect(stored).not.toContain(listed);
  });
});

describe("h2a sentropic workspaces", () => {
  it("lists the id, role, publishable flag and name of each workspace from workspaces_list, never the token", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["workspaces"], { env: f.env(dir), resolveWorkspace: () => undefined });
    expect(run.code, run.err).toBe(0);
    expect(run.out).toMatch(/ws-viewer\s+viewer\s+no\s+Read only/);
    expect(run.out).toMatch(/ws-sentropic-1\s+editor\s+yes\s+Sentropic one/);
    expect(run.out.indexOf("ws-viewer")).toBeLessThan(run.out.indexOf(BOUND)); // the server's order
    const stored = storedToken(f, dir)!;
    expect(run.out + run.err).not.toContain(stored.accessToken);
    expect(f.toolCalls).toEqual([{ name: "workspaces_list", arguments: {} }]);
    const parsed = JSON.parse((await runCli(["workspaces", "--json"], { env: f.env(dir) })).out) as { workspaces: unknown[] };
    expect(parsed.workspaces).toEqual([
      { workspaceRef: "ws-viewer", name: "Read only", role: "viewer", publishable: false, boundHere: false },
      { workspaceRef: BOUND, name: "Sentropic one", role: "editor", publishable: true, boundHere: false },
    ]);
    expect(JSON.stringify(parsed)).not.toContain(stored.accessToken);
  });

  it("marks the workspace bound here and carries its workspaceRef on the call", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    const run = await runCli(["workspaces"], { env: f.env(dir) });
    expect(run.code, run.err).toBe(0);
    expect(run.out).toMatch(/^\* ws-sentropic-1\s/m);
    expect(run.out).toMatch(/^ {2}ws-viewer\s/m);
    expect(f.toolCalls.at(-1)).toEqual({ name: "workspaces_list", arguments: {}, workspaceRef: BOUND });
  });

  it("says when the resource server does not offer workspaces_list yet, and calls nothing", async () => {
    const f = await fake({ workspacesTool: false });
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["workspaces"], { env: f.env(dir) });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/does not offer workspaces_list/);
    expect(run.err).toContain("h2a sentropic bind");
    expect(f.toolCalls).toHaveLength(0);
  });

  it("before workspaces_list, reads a -32603 on tools/list as the tool not offered, and calls nothing", async () => {
    // The server's default workspace cannot be bound (none, or the most recent one in another tenant).
    const f = await fake({ workspacesTool: false, defaultWorkspace: "ws-in-another-tenant" });
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["workspaces"], { env: f.env(dir), resolveWorkspace: () => undefined });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/does not offer workspaces_list/);
    expect(run.err).toContain("h2a sentropic bind");
    expect(f.toolCalls).toHaveLength(0);
  });

  it("prompts a re-login when the resource server refuses the credential", async () => {
    const f = await fake({ directoryDenied: true });
    const dir = freshDir();
    await login(f, dir);
    const run = await runCli(["workspaces"], { env: f.env(dir) });
    expect(run.code).toBe(1);
    expect(run.err).toContain("access_denied");
    expect(run.err).toContain("h2a sentropic login");
  });

  it("after the account is removed from the bound workspace, lists the others without the stale workspaceRef and says the binding is stale", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    // The membership row is deleted: train 1b refuses BOUND at authentication, and workspaces_list no longer lists it.
    f.opts.members = ["ws-viewer"];
    f.opts.directory = DIRECTORY.filter((entry) => entry.workspaceRef !== BOUND);
    const tools = await runCli(["tools", "--preprod"], { env: f.env(dir) });
    expect(tools.code).toBe(1);
    expect(tools.err).toContain(`refused workspace ${BOUND} (access_denied)`);
    expect(tools.err).toContain("h2a sentropic workspaces");
    expect(tools.err).toContain("h2a sentropic unbind");
    const before = f.rsRequests.length;
    const listed = await runCli(["workspaces"], { env: f.env(dir) });
    expect(listed.code, listed.err).toBe(0);
    expect(listed.out).toMatch(/ws-viewer\s+viewer\s+no\s+Read only/);
    expect(listed.out).not.toContain(BOUND);
    expect(listed.err).toContain(
      `the workspace bound here (${BOUND}) is no longer accessible to this account: bind another one, or \`h2a sentropic unbind\``,
    );
    expect(listed.err).not.toContain("* = bound here");
    // One refusal of the stale workspaceRef, then the listing read without it.
    const calls = f.rsRequests
      .slice(before)
      .filter((r) => r.body.method === "tools/list" || r.body.method === "tools/call")
      .map((r) => [r.body.method, (r.body.params as { workspaceRef?: string }).workspaceRef]);
    expect(calls).toEqual([["tools/list", BOUND], ["tools/list", undefined], ["tools/call", undefined]]);
    const parsed = JSON.parse((await runCli(["workspaces", "--json"], { env: f.env(dir) })).out) as Record<string, unknown>;
    expect(parsed).toMatchObject({ boundWorkspaceRef: BOUND, staleBinding: true });
    // `unbind`, the way out the warning names, ends it.
    expect((await runCli(["unbind"], { env: f.env(dir) })).code).toBe(0);
    const after = await runCli(["workspaces"], { env: f.env(dir) });
    expect(after.code, after.err).toBe(0);
    expect(after.err).not.toContain("no longer accessible");
    expect(JSON.parse((await runCli(["workspaces", "--json"], { env: f.env(dir) })).out)).toMatchObject({ staleBinding: false });
  });

  it("tells an account the resource server finds no workspace for to join one or bind, not to log in again", async () => {
    // Train 1b: tools/list without a workspaceRef binds the account's default member workspace; with none it is refused.
    const f = await fake({ directory: [] });
    const dir = freshDir();
    await login(f, dir);
    for (const args of [["workspaces"], ["tools", "--preprod"]]) {
      const run = await runCli(args, { env: f.env(dir), resolveWorkspace: () => undefined });
      expect(run.code, args.join(" ")).toBe(1);
      expect(run.err).toContain("the resource server finds no workspace for this account (access_denied without a workspaceRef)");
      expect(run.err).toContain("join one, or `h2a sentropic bind <workspace-id>`");
      expect(run.err).not.toContain("h2a sentropic login");
    }
    const lists = f.rsRequests.filter((r) => r.body.method === "tools/list");
    expect(lists).toHaveLength(2);
    for (const list of lists) expect((list.body.params as { workspaceRef?: string }).workspaceRef).toBeUndefined();
    expect(f.toolCalls).toHaveLength(0);
  });

  it("prints a server-chosen name without control or bidirectional formatting characters", async () => {
    const f = await fake({
      directory: [{ workspaceRef: "ws-x", name: "Evil\u001b[2J‮name\u0007⁦", role: "editor", publishable: true }],
    });
    const dir = freshDir();
    await login(f, dir);
    for (const args of [["workspaces"], ["workspaces", "--json"]]) {
      const run = await runCli(args, { env: f.env(dir) });
      expect(run.code, run.err).toBe(0);
      expect(run.out).toContain("Evil");
      for (const line of run.out.split("\n")) expect(line).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(run.out).not.toContain("\\u001b");
    }
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
    await runCli(["bind", BOUND], { env: f.env(dir) });
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir) });
    expect(run.code, run.err).toBe(0);
    expect(run.out).toContain("artifacts_list");
    expect(run.out).toContain("artifacts_publish");
    const list = f.rsRequests.filter((r) => r.body.method === "tools/list").at(-1)!;
    expect(list.authorization).toBe(`Bearer ${storedToken(f, dir)!.accessToken}`);
    expect((list.body.params as { workspaceRef?: string }).workspaceRef).toBe(BOUND);
  });

  it("refuses a resource server other than sentropic preprod or a loopback test server, before any network call", async () => {
    const dir = freshDir();
    const mcpUrl = "https://rs.example.test/api/v1/mcp";
    writeAuth({
      server: serverKey(mcpUrl),
      issuer: "https://preprod.auth.sent-tech.ca",
      accessToken: `at-${SENTINEL}`,
      expiresAt: new Date(Date.now() + HOUR).toISOString(),
      subject: SUBJECT,
    }, dir);
    const calls: string[] = [];
    const run = await runCli(["tools", "--preprod"], {
      env: { H2A_SENTROPIC_MCP_URL: mcpUrl, H2A_SENTROPIC_CLIENT_ID: CLIENT_ID, H2A_SENTROPIC_HOME: dir },
      resolveWorkspace: () => undefined,
      fetch: async (input) => {
        calls.push(String(input));
        throw new TypeError("network disabled in this test");
      },
    });
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/limited to/);
    expect(calls).toEqual([]);
  });

  it("refuses a binding made by another account or in another tenant, and asks to bind again", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    for (const change of [{ tid: "tenant-other" }, { sub: "user-other" }]) {
      Object.assign(f.opts, { tid: TENANT, sub: SUBJECT }, change);
      expect((await login(f, dir)).run.code).toBe(0);
      const before = f.rsRequests.length;
      const run = await runCli(["tools", "--preprod"], { env: f.env(dir) });
      expect(run.code, JSON.stringify(change)).toBe(1);
      expect(run.err).toMatch(/another account or in another tenant/);
      expect(run.err).toContain("h2a sentropic bind");
      expect(f.rsRequests.length).toBe(before);
    }
  });

  it("invites to re-run the workspaces command when the account no longer has the bound workspace", async () => {
    const f = await fake();
    const dir = freshDir();
    await login(f, dir);
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    // Revoked after the bind: the server lists no publish tool for it any more.
    f.opts.directory = DIRECTORY.filter((entry) => entry.workspaceRef !== BOUND);
    const run = await runCli(["tools", "--preprod"], { env: f.env(dir) });
    expect(run.code).toBe(1);
    expect(run.err).toContain(BOUND);
    expect(run.err).toContain("h2a sentropic workspaces");
  });

  it("before workspaces_list, a -32603 for want of a default workspace is unblocked by binding: tools/list then carries the bound workspaceRef", async () => {
    const f = await fake({ workspacesTool: false, defaultWorkspace: "ws-in-another-tenant" });
    const dir = freshDir();
    await login(f, dir);
    const unbound = await runCli(["tools", "--preprod"], { env: f.env(dir), resolveWorkspace: () => undefined });
    expect(unbound.code).toBe(1);
    expect(unbound.err).toContain("-32603");
    expect(unbound.err).toContain("h2a sentropic bind");
    expect((await runCli(["bind", BOUND], { env: f.env(dir) })).code).toBe(0);
    const bound = await runCli(["tools", "--preprod"], { env: f.env(dir) });
    expect(bound.code, bound.err).toBe(0);
    expect(bound.out).toContain("artifacts_publish");
    const lists = f.rsRequests.filter((r) => r.body.method === "tools/list");
    expect((lists.at(-1)!.body.params as { workspaceRef?: string }).workspaceRef).toBe(BOUND);
    expect(f.toolCalls).toHaveLength(0);
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

describe("MCP tools/call on the publish path", () => {
  async function session(opts: FakeOptions = {}) {
    const f = await fake(opts);
    const dir = freshDir();
    expect((await login(f, dir)).run.code).toBe(0);
    const token = storedToken(f, dir)!;
    return { f, mcp: await openMcpSession({ fetch: globalThis.fetch, mcpUrl: f.mcpUrl, token, clientVersion: "test" }) };
  }

  it("carries params.workspaceRef of the bound workspace next to name and arguments", async () => {
    const { f, mcp } = await session();
    const result = await mcp.callTool({ name: "artifacts_publish", arguments: { title: "t" }, workspaceRef: BOUND });
    expect(result.isError).toBe(false);
    expect(result.payload).toEqual({ ok: true, workspaceRef: BOUND });
    expect(f.toolCalls).toEqual([{ name: "artifacts_publish", arguments: { title: "t" }, workspaceRef: BOUND }]);
  });

  it("never sends a workspace-bound tools/call without a workspaceRef", async () => {
    const { f, mcp } = await session();
    await expect(mcp.callTool({ name: "artifacts_publish", arguments: {}, workspaceRef: undefined })).rejects.toThrow(/bind/);
    expect(f.toolCalls).toHaveLength(0);
  });

  it("turns a revocation between bind and publish into a clean access_denied that invites to re-run the workspaces command", async () => {
    const { f, mcp } = await session();
    for (const revoke of [
      () => {
        f.opts.directory = [{ workspaceRef: BOUND, name: "Sentropic one", role: "viewer", publishable: false }];
      },
      () => {
        f.opts.callDenied = true;
      },
    ]) {
      revoke();
      let error: unknown;
      try {
        await mcp.callTool({ name: "artifacts_publish", arguments: {}, workspaceRef: BOUND });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(SentropicWorkspaceAccessError);
      const message = publicErrorMessage(error);
      expect(message).toContain("access_denied");
      expect(message).toContain(BOUND);
      expect(message).toContain("h2a sentropic workspaces");
      expect(inspect(error, { depth: 8 })).not.toContain(SENTINEL);
    }
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
    const refresh = refreshGrants(f)[0]!;
    expect(refresh.get("refresh_token")).toBe(first.refreshToken);
    expect(refresh.get("client_id")).toBe(CLIENT_ID);
    // RFC 8707 on the refresh too: the one resource the grant was sealed with (the AS compares it as is).
    expect(refresh.getAll("resource")).toEqual([f.mcpUrl]);
    const second = storedToken(f, dir)!;
    expect(second.refreshToken).toBeDefined();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(readFileSync(authFilePath(dir), "utf8")).not.toContain(first.refreshToken!);
    expect(Date.parse(second.expiresAt!)).toBeGreaterThan(later);
    // The next refresh presents the rotated token, never the old one.
    const again = await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => later + 2 * HOUR });
    expect(again.code, again.err).toBe(0);
    expect(refreshGrants(f)[1]!.get("refresh_token")).toBe(second.refreshToken);
    expect(refreshGrants(f)[1]!.getAll("resource")).toEqual([f.mcpUrl]);
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

  it("serializes concurrent refreshes: one refresh grant, and the rotated pair survives reuse detection", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    const later = Date.now() + 2 * HOUR;
    const [a, b] = await Promise.all([
      runCli(["tools", "--preprod"], { env: f.env(dir), now: () => later }),
      runCli(["tools", "--preprod"], { env: f.env(dir), now: () => later }),
    ]);
    expect(a.code, a.err).toBe(0);
    expect(b.code, b.err).toBe(0);
    expect(refreshGrants(f)).toHaveLength(1);
    const stored = storedToken(f, dir)!;
    expect(f.refreshTokens.get(stored.refreshToken!)?.active).toBe(true);
    expect(existsSync(`${authFilePath(dir)}.refresh.lock`)).toBe(false);
  });

  it("waits for a refresh lock another process holds, then refuses without presenting the refresh token", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    const lock = `${authFilePath(dir)}.refresh.lock`;
    writeFileSync(lock, "4242:another-process", { mode: 0o600 });
    const run = await runCli(["tools", "--preprod"], {
      env: f.env(dir),
      now: () => Date.now() + 2 * HOUR,
      refreshLockWaitMs: 300,
    } as Partial<SentropicCliDeps>);
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/another h2a process is refreshing/);
    expect(refreshGrants(f)).toHaveLength(0);
    expect(readFileSync(lock, "utf8")).toBe("4242:another-process");
    expect(f.rsRequests).toHaveLength(0);
  });

  it("uses the pair the lock holder rotated meanwhile, and breaks a stale lock left by a dead process", async () => {
    const f = await fake({ refresh: true });
    const dir = freshDir();
    await login(f, dir);
    const first = storedToken(f, dir)!;
    const lock = `${authFilePath(dir)}.refresh.lock`;
    const later = Date.now() + 2 * HOUR;
    writeFileSync(lock, "4242:another-process", { mode: 0o600 });
    const theirs = f.mintPair(f.refreshTokens.get(first.refreshToken!)!.scope);
    setTimeout(() => {
      // The live holder finishes its own rotation, then releases its lock.
      writeAuth({ ...first, accessToken: theirs.accessToken, refreshToken: theirs.refreshToken, expiresAt: new Date(later + HOUR).toISOString() }, dir);
      rmSync(lock, { force: true });
    }, 150);
    const waited = await runCli(["tools", "--preprod"], {
      env: f.env(dir),
      now: () => later,
      refreshLockWaitMs: 5000,
    } as Partial<SentropicCliDeps>);
    expect(waited.code, waited.err).toBe(0);
    expect(refreshGrants(f)).toHaveLength(0);
    expect(f.rsRequests.find((r) => r.body.method === "tools/list")?.authorization).toBe(`Bearer ${theirs.accessToken}`);
    // A dead holder: its lock is older than any refresh lasts, so it is broken and the refresh runs.
    writeFileSync(lock, "4243:dead-process", { mode: 0o600 });
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(lock, old, old);
    const broke = await runCli(["tools", "--preprod"], {
      env: f.env(dir),
      now: () => later + 2 * HOUR,
      refreshLockWaitMs: 5000,
    } as Partial<SentropicCliDeps>);
    expect(broke.code, broke.err).toBe(0);
    expect(refreshGrants(f)).toHaveLength(1);
    expect(refreshGrants(f)[0]!.get("refresh_token")).toBe(theirs.refreshToken);
    expect(existsSync(lock)).toBe(false);
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
        await runCli(["workspaces"], { env: f.env(dir) });
        await runCli(["bind", BOUND], { env: f.env(dir) });
        await runCli(["workspaces", "--json"], { env: f.env(dir) });
        await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
        await runCli(["logout"], { env: f.env(dir) });
      } },
      { opts: { refresh: true }, steps: async (f, dir) => {
        f.opts.refuseRefresh = true;
        await runCli(["tools", "--preprod"], { env: f.env(dir), now: () => Date.now() + 2 * HOUR });
      } },
      { opts: {}, steps: async (f, dir) => {
        await runCli(["bind", "ws-unknown"], { env: f.env(dir) });
        await runCli(["bind", "ws-viewer"], { env: f.env(dir) });
        await runCli(["bind", BOUND], { env: f.env(dir) });
        f.opts.directory = DIRECTORY.filter((entry) => entry.workspaceRef !== BOUND);
        await runCli(["tools", "--preprod"], { env: f.env(dir) });
        await runCli(["workspaces"], { env: f.env(dir) });
        await runCli(["workspaces", "--json"], { env: f.env(dir) });
        f.opts.directoryDenied = true;
        await runCli(["workspaces"], { env: f.env(dir) });
        await runCli(["bind", BOUND], { env: f.env(dir) });
      } },
      { opts: { directory: [] }, steps: async (f, dir) => {
        await runCli(["workspaces"], { env: f.env(dir), resolveWorkspace: () => undefined });
        await runCli(["tools", "--preprod"], { env: f.env(dir), resolveWorkspace: () => undefined });
      } },
      { opts: { workspacesTool: false }, steps: async (f, dir) => {
        await runCli(["workspaces"], { env: f.env(dir) });
        await runCli(["bind", "ws-anything"], { env: f.env(dir) });
      } },
      { opts: { workspacesTool: false, defaultWorkspace: "ws-in-another-tenant" }, steps: async (f, dir) => {
        await runCli(["tools", "--preprod"], { env: f.env(dir), resolveWorkspace: () => undefined });
        await runCli(["workspaces"], { env: f.env(dir), resolveWorkspace: () => undefined });
        await runCli(["bind", BOUND], { env: f.env(dir) });
        await runCli(["tools", "--preprod"], { env: f.env(dir) });
      } },
      { opts: {}, steps: async (f, dir) => {
        f.opts.rsFailure = "500";
        await runCli(["tools", "--preprod"], { env: f.env(dir) });
        await runCli(["workspaces"], { env: f.env(dir) });
        delete f.opts.rsFailure;
        for (const at of f.accessTokens.values()) at.active = false;
        await runCli(["tools", "--preprod"], { env: f.env(dir) });
        await runCli(["bind", BOUND], { env: f.env(dir) });
        f.opts.revokeFailure = true;
        await runCli(["logout"], { env: f.env(dir) });
      } },
      { opts: { tokenFailure: "500" }, steps: async () => {} },
      { opts: { tokenFailure: "malformed" }, steps: async () => {} },
      { opts: { deny: true }, steps: async () => {} },
      { opts: { idTokenAlways: true, nonceOverride: "x" }, steps: async () => {} },
      { opts: { accessClaims: { aud: "https://other-rs.example/api/v1/mcp" } }, steps: async () => {} },
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
    expect(runs.length).toBeGreaterThan(20);
    expect(verifiers.length).toBeGreaterThan(5);
    for (const run of runs) {
      const rendered = [run.out, run.err, run.thrown === undefined ? "" : inspect(run.thrown, { depth: 8 })].join("\n");
      expect(rendered).not.toContain(SENTINEL);
      for (const verifier of verifiers) expect(rendered).not.toContain(verifier);
    }
  });
});
