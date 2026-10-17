import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionContentAuth, ConfirmationCodeFlow, PinnedConfirmationJwks } from "./session-content-auth.js";
import { ConfirmationBudget, ConfirmationVerifier, confirmationNonce, type ConfirmationChallenge } from "./session-content-confirmation.js";
import { generateKeyPairSync, sign } from "node:crypto";

let root: string, server: Server, origin: string, ca: string;
let mode = "valid", requests: { path: string; headers: Record<string, unknown>; body: string }[] = [];
let sourceReplyHook: (() => void) | undefined;
let idToken = "not-an-api-token";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "issuer-key", alg: "RS256", use: "sig" };
const source = { workstationId: "workstation", bindingId: "binding", bindingVersion: 1,
  sourceId: "source", sourceGeneration: "generation", sourceBootId: "boot" };
const runtime = { packageVersion: "0.98.7", gitSha: "a".repeat(40), packageIntegrity: "sha512-test",
  hostBuildHash: "b".repeat(64), exporterBuildHash: "c".repeat(64) };
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cm2-auth-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", join(root, "key.pem"), "-out", join(root, "cert.pem"), "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  ca = readFileSync(join(root, "cert.pem"), "utf8");
  server = createServer({ key: readFileSync(join(root, "key.pem")), cert: ca }, (req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      requests.push({ path: req.url!, headers: req.headers, body });
      if (mode === "redirect") { res.writeHead(307, { location: `${origin}/stolen` }); res.end(); return; }
      if (mode === "unavailable") { res.writeHead(503); res.end(); return; }
      res.setHeader("Content-Type", "application/json");
      if (mode === "oversize") { res.end(JSON.stringify({ padding: "x".repeat(70_000) })); return; }
      if (req.url === "/jwks") { res.end(JSON.stringify({ keys: [jwk] })); return; }
      if (req.url === "/token") {
        const token: Record<string, unknown> = { access_token: "synthetic-access", token_type: "Bearer", expires_in: 300,
          id_token: idToken };
        if (mode === "missing-expiry") delete token.expires_in;
        if (mode === "id-token-only") delete token.access_token;
        res.end(JSON.stringify(token)); return;
      }
      const input = JSON.parse(body);
      const now = Date.now();
      const output = { protocol: "h2a.session-content", protocolVersion: 2, kind: "source-session",
        requestId: input.requestId, requestNonce: input.requestNonce,
        sourceSessionId: "source-session", sourceToken: "synthetic-source", owner: { issuer: origin, subject: "owner" },
        authSessionRef: mode === "other-login" ? "other-login" : "login-record",
        authSessionVersion: 1, authSessionExpiresAt: now + 300_000, source,
        connectionId: "connection", issuedAt: now, expiresAt: now + 60_000,
        operations: ["source-control", "content-upload", "source-ack"] };
      if (mode === "wrong-owner") output.owner.subject = "intruder";
      if (mode === "wrong-source") output.source = { ...source, sourceBootId: "other-boot" };
      if (mode === "wrong-nonce") output.requestNonce = "unrequested";
      if (mode === "long-lease") output.expiresAt = now + 60_001;
      if (mode === "wrong-operations") output.operations.push("input");
      if (mode === "old-version") output.protocolVersion = 1;
      if (mode === "duplicate-json") { res.end(JSON.stringify(output).replace('"protocolVersion":2', '"protocolVersion":1,"protocolVersion":2')); return; }
      sourceReplyHook?.();
      res.end(JSON.stringify(output));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test listener");
  origin = `https://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  if (root) rmSync(root, { recursive: true, force: true });
});
function config() {
  return { issuer: origin, authorizeUrl: `${origin}/authorize`, tokenUrl: `${origin}/token`,
    clientId: "source-client", audience: "source-audience", redirectUri: "http://127.0.0.1:3210/callback",
    sourceServer: origin, owner: { issuer: origin, subject: "owner" }, source, runtime,
    capabilitiesDigest: "d".repeat(64), ca };
}
async function login(auth: SessionContentAuth) {
  const attempt = auth.beginLogin();
  const url = new URL(attempt.url);
  return auth.completeLogin(attempt.handle, { code: "synthetic-code", state: url.searchParams.get("state")! });
}

describe("session content source authentication", () => {
  it("should perform real pinned HTTPS PKCE and send access credentials only in their intended exchange", async () => {
    mode = "valid"; requests = [];
    const auth = new SessionContentAuth(config());
    const attempt = auth.beginLogin(), url = new URL(attempt.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("audience")).toBe("source-audience");
    const identity = await auth.completeLogin(attempt.handle, { code: "synthetic-code", state: url.searchParams.get("state")! });
    const session = await auth.openSource(identity);
    expect(auth.metadata(session)).toMatchObject({ authSessionRef: "login-record", source });
    expect(requests.map(r => r.path)).toEqual(["/token", "/api/v1/auth/session/content/binding/source/sessions"]);
    const form = new URLSearchParams(requests[0]!.body);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    expect(requests[1]!.headers.authorization).toBe("Bearer synthetic-access");
    expect(requests[1]!.body).not.toContain("synthetic-access");
    expect(JSON.stringify(auth.metadata(session))).not.toMatch(/synthetic-(access|source)|not-an-api-token/);
    auth.invalidate(session);
    expect(() => auth.metadata(session)).toThrow();
  });
  it("should reject mismatched and replayed callbacks before a token request", async () => {
    mode = "valid"; requests = [];
    const auth = new SessionContentAuth(config()), a = auth.beginLogin();
    await expect(auth.completeLogin(a.handle, { code: "code", state: "wrong" })).rejects.toThrow();
    await expect(auth.completeLogin(a.handle, { code: "code", state: new URL(a.url).searchParams.get("state")! })).rejects.toThrow();
    expect(requests).toEqual([]);
  });
  it("should refuse redirects, unavailable authority, untrusted TLS and oversized replies", async () => {
    for (const value of ["redirect", "unavailable", "oversize"]) {
      mode = value; requests = [];
      await expect(login(new SessionContentAuth(config()))).rejects.toThrow();
      expect(requests).toHaveLength(1);
    }
    mode = "valid"; requests = [];
    const { ca: _testCa, ...untrusted } = config();
    await expect(login(new SessionContentAuth(untrusted))).rejects.toThrow();
    expect(requests).toEqual([]);
  });
  it("should reject missing token expiry and never substitute an ID token for an API access token", async () => {
    for (const value of ["missing-expiry", "id-token-only"]) {
      mode = value; requests = [];
      await expect(login(new SessionContentAuth(config()))).rejects.toThrow();
      expect(requests.map(r => r.path)).toEqual(["/token"]);
    }
  });
  it("should reject invalid source identity, nonce, authority bounds, operations and wire versions", async () => {
    for (const value of ["wrong-owner", "wrong-source", "wrong-nonce", "long-lease", "wrong-operations", "old-version", "duplicate-json"]) {
      mode = "valid"; requests = [];
      const auth = new SessionContentAuth(config()), identity = await login(auth);
      mode = value;
      await expect(auth.openSource(identity)).rejects.toThrow();
      expect(requests).toHaveLength(2);
    }
  });
  it("should pin the original login reference across source reauthorization", async () => {
    mode = "valid";
    const auth = new SessionContentAuth(config()), identity = await login(auth);
    await auth.openSource(identity);
    mode = "other-login";
    await expect(auth.openSource(identity)).rejects.toThrow();
  });
  it("should expire a source from request-send monotonic time and never from reply receipt", async () => {
    mode = "valid"; let monotonic = 0;
    const auth = new SessionContentAuth({ ...config(), monotonicNow: () => monotonic });
    const identity = await login(auth);
    sourceReplyHook = () => { monotonic = 30_000; };
    let session: object;
    try { session = await auth.openSource(identity); } finally { sourceReplyHook = undefined; }
    expect(auth.metadata(session)).toBeDefined();
    monotonic = 60_000;
    expect(() => auth.metadata(session)).toThrow();
    monotonic = -1;
    expect(() => auth.metadata(session)).toThrow();
  });
  it("should invalidate every source dependent on an observed denied login, including sibling handles", async () => {
    mode = "valid";
    const auth = new SessionContentAuth(config()), identity = await login(auth);
    const a = await auth.openSource(identity), b = await auth.openSource(identity);
    auth.invalidate(a);
    expect(() => auth.metadata(b)).toThrow();
    await expect(auth.openSource(identity)).rejects.toThrow();
    mode = "valid";
    const other = new SessionContentAuth(config()), otherIdentity = await login(other);
    const c = await other.openSource(otherIdentity);
    mode = "unavailable";
    await expect(other.openSource(otherIdentity)).rejects.toThrow();
    expect(() => other.metadata(c)).toThrow();
  });
  it("should reject insecure or cross-issuer endpoints without opening a connection", () => {
    for (const patch of [{ tokenUrl: "http://127.0.0.1/token" }, { tokenUrl: "https://attacker.example/token" },
      { sourceServer: `${origin}/unexpected` }, { redirectUri: "http://attacker.example/callback" }]) {
      expect(() => new SessionContentAuth({ ...config(), ...patch })).toThrow();
    }
  });
  it("should exchange a dedicated fresh confirmation with PKCE and verify its signed native nonce", async () => {
    mode = "valid"; requests = [];
    const now = Date.now(), mono = () => 1000;
    const ch: ConfirmationChallenge = { id: "fresh", owner: { issuer: origin, subject: "owner" },
      source, project: { tenantId: "tenant", workspaceId: "workspace", workspaceIncarnation: "wi", projectId: "project" },
      clientId: "confirmation-client", purpose: "share", target: { kind: "policy", policyDigest: "a".repeat(64) },
      random: Buffer.alloc(32, 1).toString("base64url"), issuedAt: now, expiresAt: now + 60_000 };
    const verifier = new ConfirmationVerifier({ issuer: origin, subject: "owner", tenantId: "tenant", clientId: ch.clientId,
      source, keys: [jwk], wallNow: () => now, monotonicNow: mono, measuredClockErrorMs: 0, budget: new ConfirmationBudget(mono) });
    const nativePending = verifier.stage(ch);
    const flow = new ConfirmationCodeFlow({ ...config(), sourceClientId: "source-client", clientId: ch.clientId, monotonicNow: mono });
    const a = flow.begin(ch), url = new URL(a.url);
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("nonce")).toBe(confirmationNonce(ch));
    expect(url.searchParams.get("client_id")).toBe(ch.clientId);
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
    const c = Buffer.from(JSON.stringify({ iss: origin, sub: "owner", tenantId: "tenant", aud: ch.clientId,
      nonce: confirmationNonce(ch), acr: "urn:sentropic:loa:passkey-fresh", amr: ["hwk", "user", "mfa"],
      exp: Math.floor(now / 1000) + 60, iat: Math.floor(now / 1000), auth_time: Math.floor(now / 1000) })).toString("base64url");
    idToken = `${h}.${c}.${sign("RSA-SHA256", Buffer.from(`${h}.${c}`), privateKey).toString("base64url")}`;
    let commits = 0;
    try {
      const proof = await flow.complete(a.handle, { code: "code", state: url.searchParams.get("state")! });
      expect(verifier.consume(nativePending, proof, { commit() { commits++; } })).toBeDefined();
      await expect(flow.complete(a.handle, { code: "code", state: url.searchParams.get("state")! })).rejects.toThrow();
      expect(commits).toBe(1);
      expect(requests).toHaveLength(1);
    } finally { idToken = "not-an-api-token"; }
  });
  it("should load only the pinned issuer JWKS with bounded refresh and no token-selected URL", async () => {
    mode = "valid"; requests = [];
    let mono = 0;
    const loader = new PinnedConfirmationJwks({ issuer: origin, jwksUrl: `${origin}/jwks`, ca, monotonicNow: () => mono });
    const verifier = new ConfirmationVerifier({ issuer: origin, subject: "owner", tenantId: "tenant", clientId: "confirmation-client",
      source, keys: [jwk], measuredClockErrorMs: 0, budget: new ConfirmationBudget() });
    await loader.refresh(verifier);
    await expect(loader.refresh(verifier)).rejects.toThrow(/rate_limited/);
    expect(requests.map(r => r.path)).toEqual(["/jwks"]);
    expect(requests[0]!.headers.authorization).toBeUndefined();
    mono += 60_000;
    await loader.refresh(verifier);
    expect(requests).toHaveLength(2);
    expect(() => new PinnedConfirmationJwks({ issuer: origin, jwksUrl: "https://attacker.example/jwks" })).toThrow();
    expect(() => new ConfirmationCodeFlow({ ...config(), sourceClientId: "source-client" })).toThrow();
  });
  it("should keep exchanging confirmations inside the pending bound and cancel their results", async () => {
    mode = "unavailable";
    const flow = new ConfirmationCodeFlow({ ...config(), sourceClientId: "source-client", clientId: "confirmation-client" });
    const now = Date.now();
    const ch: ConfirmationChallenge = { id: "bounded", owner: { issuer: origin, subject: "owner" }, source,
      project: { tenantId: "tenant", workspaceId: "workspace", workspaceIncarnation: "wi", projectId: "project" },
      clientId: "confirmation-client", purpose: "share", target: { kind: "policy", policyDigest: "a".repeat(64) },
      random: Buffer.alloc(32, 1).toString("base64url"), issuedAt: now, expiresAt: now + 60_000 };
    const pending: Promise<unknown>[] = [];
    try {
      for (let i = 0; i < 16; i++) {
        const a = flow.begin({ ...ch, id: `bounded-${i}` });
        pending.push(flow.complete(a.handle, { code: "code", state: new URL(a.url).searchParams.get("state")! }).catch(e => e));
      }
      expect(() => flow.begin(ch)).toThrow(/resource_busy/);
    } finally { flow.cancelAll(); await Promise.all(pending); }
  });
  it("should reject a JWKS loader whose pinned issuer differs from the native verifier", async () => {
    mode = "valid";
    const loader = new PinnedConfirmationJwks({ issuer: `${origin}/another-issuer`, jwksUrl: `${origin}/jwks`, ca });
    const verifier = new ConfirmationVerifier({ issuer: origin, subject: "owner", tenantId: "tenant", clientId: "confirmation-client",
      source, keys: [jwk], measuredClockErrorMs: 0, budget: new ConfirmationBudget() });
    await expect(loader.refresh(verifier)).rejects.toThrow();
  });
});
