/** F2 source identity transport. Only metadata crosses this port; no content capability is granted.
 * The configured Sentropic service MUST implement session-aware introspection (§3.2).
 * A successful synthetic exchange is not evidence that that deployment exists.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { request } from "node:https";
import { performance } from "node:perf_hooks";
import { buildAuthorizeRequest } from "./sentropic/enroll-flow.js";
import { canonicalJson, contentDigest, parseStrictJson } from "./session-content-json.js";
import { confirmationNonce, type ConfirmationChallenge, type ConfirmationVerifier } from "./session-content-confirmation.js";
import { validateContentMessage, same, sha256, envelope, type Policy, type Scope, type Lease } from "./session-content-contract.js";

type Source = ConfirmationChallenge["source"];
interface Runtime { packageVersion: string; gitSha: string; packageIntegrity: string; hostBuildHash: string; exporterBuildHash: string }
interface Config {
  issuer: string; authorizeUrl: string; tokenUrl: string; clientId: string; audience: string;
  redirectUri: string; sourceServer: string; owner: ConfirmationChallenge["owner"]; source: Source;
  runtime: Runtime; capabilitiesDigest: string;
  /** Optional private PKI root. Normal TLS hostname/certificate validation remains mandatory. */
  ca?: string; monotonicNow?: () => number;
  /** Measured independently; absence disables absolute-deadline retained reads. */
  measuredClockErrorMs?: number;
}
interface LoginAttempt { verifier: string; state: string; start: number }
interface Login { accessToken: string; start: number; deadline: number; authSessionRef?: string; authSessionVersion?: number; busy: boolean; streams:Set<AbortController> }
interface SourceMetadata {
  sourceSessionId: string; owner: ConfirmationChallenge["owner"]; authSessionRef: string; authSessionVersion: number;
  authSessionExpiresAt: number; source: Source; connectionId: string; issuedAt: number; expiresAt: number;
}
interface SourceSession { metadata: SourceMetadata; token: string; start: number; deadline: number; login: Login }
function fail(): never { throw new Error("source_authority_refused"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function id(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._~-]{1,256}$/.test(value); }
function bearer(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._~+/-]{1,8192}=*$/.test(value); }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function https(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search) fail();
  return u;
}

/** Exact configured URLs, no redirects, bounded response, no insecure TLS switch or injected HTTP. */
async function requestJson(method: "GET" | "POST", url: URL, body: string | null, contentType: string | null, ca?: string, token?: string, metadata?: { nonce?: string; admission?: string; signal?: AbortSignal }): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deny = () => reject(new Error("source_authority_unavailable"));
    const req = request(url, { method, agent: false, ...(metadata?.signal ? { signal: metadata.signal } : {}), ...(ca ? { ca } : {}),
      headers: { ...(body !== null && contentType !== null ? { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body) } : {}), Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(metadata?.nonce ? { "X-H2A-Request-Nonce": metadata.nonce } : {}),
        ...(metadata?.admission ? { "X-H2A-Source-Meta": metadata.admission } : {}) } }, res => {
      if (res.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(String(res.headers["content-type"] ?? ""))
        || res.headers["content-encoding"] !== undefined) { res.destroy(); deny(); return; }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) { res.destroy(); deny(); } else chunks.push(chunk);
      });
      res.on("error", deny);
      res.on("end", () => {
        try { resolve(record(parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))))); }
        catch { deny(); }
      });
    });
    // Absolute request deadline, including slow-drip responses, independent of socket activity.
    const timer = setTimeout(() => req.destroy(new Error("authority_timeout")), 10_000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", deny);
    req.end(body ?? undefined);
  });
}
function post(url: URL, body: string, contentType: string, ca?: string, token?: string): Promise<Record<string, unknown>> {
  return requestJson("POST", url, body, contentType, ca, token);
}

export class SessionContentAuth {
  get sourceClientId():string{return this.config.clientId;}
  get issuer():string{return this.config.issuer;}
  private readonly config: Config;
  private readonly now: () => number;
  private attempts = new Map<object, LoginAttempt>();
  private logins = new WeakMap<object, Login>();
  private sessions = new WeakMap<object, SourceSession>();
  private inFlight = 0;
  private controlOpen=false;
  private readResponses=new WeakMap<object,{start:number;deadline:number;login:Login}>();
  constructor(config: Config) {
    this.config = { ...config, owner: structuredClone(config.owner), source: structuredClone(config.source), runtime: { ...config.runtime } };
    this.now = config.monotonicNow ?? (() => performance.now());
    const issuer = https(config.issuer), server = https(config.sourceServer);
    if (server.href !== server.origin + "/" || config.sourceServer !== server.origin
      || https(config.authorizeUrl).origin !== issuer.origin || https(config.tokenUrl).origin !== issuer.origin
      || config.owner.issuer !== config.issuer || !id(config.owner.subject) || !id(config.clientId)
      || !id(config.source.bindingId) || !/^[a-f0-9]{64}$/.test(config.capabilitiesDigest)) fail();
    const redirect = new URL(config.redirectUri);
    if (redirect.username || redirect.password || redirect.hash || redirect.search
      || !(redirect.protocol === "https:" || (redirect.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(redirect.hostname)))) fail();
  }
  beginLogin(): { handle: object; url: string } {
    const now = this.now();
    for (const [handle, attempt] of this.attempts) if (now < attempt.start || now >= attempt.start + 300_000) this.attempts.delete(handle);
    if (this.attempts.size >= 4) throw new Error("resource_busy");
    const req = buildAuthorizeRequest({ authorizeUrl: this.config.authorizeUrl, clientId: this.config.clientId,
      redirectUri: this.config.redirectUri, scope: "openid" });
    const url = new URL(req.url); url.searchParams.set("audience", this.config.audience);
    const handle = Object.freeze({}); this.attempts.set(handle, { verifier: req.verifier, state: req.state, start: now });
    return { handle, url: url.href };
  }
  async completeLogin(handle: object, callback: { code: string; state: string }): Promise<object> {
    const attempt = this.attempts.get(handle); this.attempts.delete(handle);
    if (!attempt || this.now() < attempt.start || this.now() >= attempt.start + 300_000
      || typeof callback.state !== "string" || Buffer.byteLength(callback.state) !== Buffer.byteLength(attempt.state)
      || !timingSafeEqual(Buffer.from(callback.state), Buffer.from(attempt.state))
      || !id(callback.code) || this.inFlight >= 4) return fail();
    this.inFlight++;
    try {
      const start = this.now();
      const form = new URLSearchParams({ grant_type: "authorization_code", client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri, code: callback.code, code_verifier: attempt.verifier });
      const response = await post(https(this.config.tokenUrl), form.toString(), "application/x-www-form-urlencoded", this.config.ca);
      if (!bearer(response.access_token) || response.token_type !== "Bearer"
        || !integer(response.expires_in) || response.expires_in <= 0 || response.expires_in > 86400) return fail();
      const deadline = start + response.expires_in * 1000;
      if (this.now() < start || this.now() >= deadline) return fail();
      // No decoded ID token establishes identity. The source service resolves the access token
      // with confidential session-aware introspection; native never receives that client secret.
      const login = Object.freeze({});
      this.logins.set(login, { accessToken: response.access_token, start, deadline, busy: false, streams:new Set() }); return login;
    } finally { this.inFlight--; }
  }
  async openSource(loginHandle: object): Promise<object> {
    const login = this.logins.get(loginHandle), start = this.now();
    if (!login || start < login.start || start >= login.deadline || login.busy || this.inFlight >= 4) return fail();
    this.inFlight++; login.busy = true;
    try {
      const requestId = randomBytes(32).toString("base64url"), requestNonce = randomBytes(32).toString("base64url");
      const cfg = this.config;
      const body = canonicalJson({ protocol: "h2a.session-content", protocolVersion: 2, kind: "source-open", requestId, requestNonce,
        bindingId: cfg.source.bindingId, sourceGeneration: cfg.source.sourceGeneration, sourceBootId: cfg.source.sourceBootId,
        runtime: cfg.runtime, capabilitiesDigest: cfg.capabilitiesDigest });
      const response = await post(new URL(`/api/v1/auth/session/content/${cfg.source.bindingId}/source/sessions`, cfg.sourceServer),
        body, "application/json", cfg.ca, login.accessToken);
      const expected = ["protocol", "protocolVersion", "kind", "requestId", "requestNonce", "sourceSessionId", "sourceToken", "owner",
        "authSessionRef", "authSessionVersion", "authSessionExpiresAt", "source", "connectionId", "issuedAt", "expiresAt", "operations"];
      if (Object.keys(response).length !== expected.length || Object.keys(response).some(k => !expected.includes(k))
        || response.protocol !== "h2a.session-content" || response.protocolVersion !== 2 || response.kind !== "source-session"
        || response.requestId !== requestId || response.requestNonce !== requestNonce
        || canonicalJson(response.owner) !== canonicalJson(cfg.owner) || canonicalJson(response.source) !== canonicalJson(cfg.source)
        || !id(response.sourceSessionId) || !id(response.authSessionRef) || !id(response.connectionId) || !bearer(response.sourceToken)
        || !integer(response.authSessionVersion) || !integer(response.authSessionExpiresAt)
        || !integer(response.issuedAt) || !integer(response.expiresAt) || response.expiresAt <= response.issuedAt
        || response.expiresAt - response.issuedAt > 60_000 || response.expiresAt > response.authSessionExpiresAt
        || canonicalJson(response.operations) !== canonicalJson(["source-control", "content-upload", "source-ack"])
        || (login.authSessionRef !== undefined && (response.authSessionRef !== login.authSessionRef || response.authSessionVersion !== login.authSessionVersion))) return fail();
      const deadline = Math.min(login.deadline, start + (response.expiresAt - response.issuedAt));
      if (this.now() < start || this.now() >= deadline) return fail();
      login.authSessionRef = response.authSessionRef; login.authSessionVersion = response.authSessionVersion;
      const metadata: SourceMetadata = { sourceSessionId: response.sourceSessionId, owner: structuredClone(cfg.owner),
        authSessionRef: response.authSessionRef, authSessionVersion: response.authSessionVersion,
        authSessionExpiresAt: response.authSessionExpiresAt, source: structuredClone(cfg.source),
        connectionId: response.connectionId, issuedAt: response.issuedAt, expiresAt: response.expiresAt };
      const handle = Object.freeze({}); this.sessions.set(handle, { metadata, token: response.sourceToken, start, deadline, login });
      return handle;
    } catch {
      // A failed authority check pauses all dependent handles, not just the current request.
      for(const stream of login.streams)stream.abort();login.streams.clear();login.deadline = -1;
      return fail();
    } finally { this.inFlight--; login.busy = false; }
  }
  metadata(handle: object): SourceMetadata {
    const session = this.sessions.get(handle), now = this.now();
    if (!session || now < session.start || now >= session.deadline || now >= session.login.deadline) return fail();
    return structuredClone(session.metadata);
  }
  async renewSource(handle: object): Promise<void> {
    const old=this.metadata(handle),session=this.sessions.get(handle)!,login=session.login,start=this.now();
    if(login.busy||this.inFlight>=4) throw new Error("resource_busy");
    login.busy=true;this.inFlight++;
    try {
      const requestId=randomBytes(32).toString("base64url"),requestNonce=randomBytes(32).toString("base64url"),cfg=this.config;
      const body=envelope("source-open",{requestId,requestNonce,bindingId:cfg.source.bindingId,sourceGeneration:cfg.source.sourceGeneration,
        sourceBootId:cfg.source.sourceBootId,runtime:cfg.runtime,capabilitiesDigest:cfg.capabilitiesDigest});
      const url=new URL(`/api/v1/auth/session/content/${old.source.bindingId}/source/sessions/${old.sourceSessionId}/renew`,cfg.sourceServer);
      const response=await post(url,canonicalJson(body),"application/json",cfg.ca,login.accessToken);validateContentMessage(response);
      const deadline=Math.min(login.deadline,start+(response.expiresAt as number)-(response.issuedAt as number));
      if(response.kind!=="source-session" || response.requestId!==requestId || response.requestNonce!==requestNonce
        || response.sourceSessionId!==old.sourceSessionId || response.connectionId!==old.connectionId || !same(response.owner,old.owner)
        || !same(response.source,old.source) || response.authSessionRef!==old.authSessionRef || response.authSessionVersion!==old.authSessionVersion
        || !bearer(response.sourceToken) || this.now()<start || this.now()>=deadline || this.now()>=session.deadline || this.now()>=login.deadline) return fail();
      session.metadata={...old,issuedAt:response.issuedAt as number,expiresAt:response.expiresAt as number,authSessionExpiresAt:response.authSessionExpiresAt as number};
      session.token=response.sourceToken;session.start=start;session.deadline=deadline;
    } catch {this.invalidate(handle);return fail();} finally {login.busy=false;this.inFlight--;}
  }
  /** Trusted native component resolves these over pinned HTTPS; wire callers supply only an opaque proposal id.
   * These endpoint paths are preparatory until the receiving Sentropic implementation consumes the capsule.
   */
  async resolveGrant(handle: object, proposalId: string): Promise<{ request: Record<string, unknown>; policy: Policy; deadline: number }> {
    if (!id(proposalId) || this.inFlight >= 4) return fail();
    const metadata = this.metadata(handle), session = this.sessions.get(handle)!;
    const start = this.now(), nonce = randomBytes(32).toString("base64url"); this.inFlight++;
    try {
      const base = `/api/v1/auth/session/content/${this.config.source.bindingId}/source/sessions/${metadata.sourceSessionId}`;
      const grant = await requestJson("GET", new URL(`${base}/grants/${proposalId}`, this.config.sourceServer), null, null, this.config.ca, session.token, { nonce });
      validateContentMessage(grant);
      if (!["grant-activate", "grant-refresh"].includes(String(grant.kind)) || grant.requestId !== proposalId
        || grant.requestNonce !== nonce || grant.connectionId !== metadata.connectionId) return fail();
      const scope = (grant.scope ?? grant.nextScope) as Scope, lease = grant.lease as Lease;
      if (!same(scope.owner, metadata.owner) || !same(scope.source, metadata.source) || lease.requestNonce !== nonce) return fail();
      const policyMessage = await requestJson("GET", new URL(`${base}/policies/${encodeURIComponent(scope.policyId)}/${scope.policyRevision}`, this.config.sourceServer), null, null, this.config.ca, session.token);
      validateContentMessage(policyMessage, { policyDigest: grant.policyDigest as string });
      if (policyMessage.kind !== "project-policy") return fail();
      this.metadata(handle);
      const deadline = Math.min(session.deadline, start + lease.expiresAt - lease.issuedAt);
      if (this.now() < start || this.now() >= deadline) return fail();
      return { request: grant, policy: policyMessage.policy as Policy, deadline };
    } catch { this.invalidate(handle); return fail(); } finally { this.inFlight--; }
  }
  async commitAck(handle: object, ack: Record<string, unknown>): Promise<Record<string, unknown>> {
    const meta = this.metadata(handle), session = this.sessions.get(handle)!;
    if (this.inFlight >= 4) return fail();
    validateContentMessage(ack); this.inFlight++;
    try {
      const url = new URL(`/api/v1/auth/session/content/${meta.source.bindingId}/source/sessions/${meta.sourceSessionId}/acks`, this.config.sourceServer);
      const response = await post(url, canonicalJson(ack), "application/json", this.config.ca, session.token);
      validateContentMessage(response); this.metadata(handle); return response;
    } catch { this.invalidate(handle); return fail(); } finally { this.inFlight--; }
  }
  /** Metadata survives an interrupted capture boundary; it contains no terminal bytes. */
  async sendGap(handle:object,gap:Record<string,unknown>):Promise<void>{
    const meta=this.metadata(handle),session=this.sessions.get(handle)!;validateContentMessage(gap);
    if(gap.kind!=='terminal-gap'||!same((gap.scope as Scope).source,meta.source)||this.inFlight>=4)return fail();
    this.inFlight++;
    try{const response=await requestJson('POST',new URL('/api/v1/auth/session/content/'+meta.source.bindingId+'/source/acks',this.config.sourceServer),canonicalJson(gap),'application/json',this.config.ca,session.token);this.metadata(handle);if(!same(response,gap))return fail();}
    finally{this.inFlight--;}
  }
  async sendSnapshot(handle:object,manifest:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
    return this.sendNative(handle,manifest,'native-manifest','snapshots',signal);
  }
  async sendSegment(handle:object,part:Record<string,unknown>,signal:AbortSignal):Promise<Record<string,unknown>>{
    return this.sendNative(handle,part,'native-part','segments',signal);
  }
  private async sendNative(handle:object,message:Record<string,unknown>,kind:string,route:string,signal:AbortSignal):Promise<Record<string,unknown>>{
    const meta=this.metadata(handle),session=this.sessions.get(handle)!;validateContentMessage(message);
    const scope=message.scope as Scope;
    if(message.kind!==kind||message.connectionId!==meta.connectionId||!same(scope.source,meta.source)||!same(scope.owner,meta.owner)||this.inFlight>=4)return fail();
    signal.throwIfAborted();
    const body=canonicalJson(message),path='/api/v1/auth/session/content/'+meta.source.bindingId+'/source/'+route;
    const admission=envelope('source-admission',{method:'POST',path,sourceSessionId:meta.sourceSessionId,connectionId:meta.connectionId,
      requestId:randomBytes(32).toString('base64url'),scopeDigest:contentDigest('scope',scope),leaseId:message.leaseId,bodyBytes:Buffer.byteLength(body),bodyHash:sha256(body)});
    const header=Buffer.from(canonicalJson(admission)).toString('base64url');if(header.length>8192)return fail();
    const abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});session.login.streams.add(abort);
    const timer=setTimeout(cancel,Math.max(0,Math.min(session.deadline,session.login.deadline)-this.now()));timer.unref();this.inFlight++;
    try{
      this.metadata(handle);signal.throwIfAborted();
      const response=await requestJson('POST',new URL(path,this.config.sourceServer),body,'application/json',this.config.ca,session.token,{admission:header,signal:abort.signal});
      this.metadata(handle);abort.signal.throwIfAborted();validateContentMessage(response);
      const coverage=response.coverage as Record<string,unknown>;
      if(response.kind!=='ingest-ack'||response.requestId!==admission.requestId||response.scopeDigest!==admission.scopeDigest||response.connectionId!==meta.connectionId
        ||!['accepted','duplicate'].includes(String(response.status))||coverage?.kind!=='native'||coverage.snapshotId!==message.snapshotId
        ||(kind==='native-part'&&(coverage.fileSha256!==message.fileSha256||coverage.acceptedThroughByteOffset!==(message.byteOffset as number)+(message.byteLength as number))))return fail();
      return response;
    }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);session.login.streams.delete(abort);this.inFlight--;}
  }
  async sendFragment(handle: object, fragment: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const meta = this.metadata(handle), session = this.sessions.get(handle)!;
    validateContentMessage(fragment);
    if (fragment.kind!=="terminal-fragment" || fragment.connectionId!==meta.connectionId
      || !same((fragment.scope as Scope).source,meta.source) || this.inFlight>=4) return fail();
    const body=canonicalJson(fragment), path=`/api/v1/auth/session/content/${meta.source.bindingId}/fragments`;
    const admission=envelope("source-admission",{method:"POST",path,sourceSessionId:meta.sourceSessionId,connectionId:meta.connectionId,
      requestId:randomBytes(32).toString("base64url"),scopeDigest:contentDigest("scope",fragment.scope),leaseId:fragment.leaseId,
      bodyBytes:Buffer.byteLength(body),bodyHash:sha256(body)});
    const header=Buffer.from(canonicalJson(admission)).toString("base64url");
    if(header.length>8192) return fail();
    this.inFlight++;
    try {
      const response=await requestJson("POST",new URL(path,this.config.sourceServer),body,"application/json",this.config.ca,session.token,{admission:header,signal});
      validateContentMessage(response); this.metadata(handle);
      if(response.requestId!==admission.requestId) return fail(); return response;
    } finally { this.inFlight--; }
  }
  async authorizeHistoryRead(loginHandle: object, authorizationId: string): Promise<Record<string,unknown>> {
    const login=this.logins.get(loginHandle),now=this.now(),skew=this.config.measuredClockErrorMs;
    if(!login || now<login.start || now>=login.deadline || !id(authorizationId) || this.inFlight>=4
      || skew===undefined || !Number.isFinite(skew) || skew<0 || skew>5000) return fail();
    const wall=Date.now();this.inFlight++;
    try {
      const url=new URL(`/api/v1/auth/session/content/${this.config.source.bindingId}/history/authorizations/${authorizationId}`,this.config.sourceServer);
      const response=await requestJson("GET",url,null,null,this.config.ca,login.accessToken);validateContentMessage(response);
      if(response.kind!=="history-read" || response.authorizationId!==authorizationId || !same(response.owner,this.config.owner)
        || !id(response.authSessionRef) || (login.authSessionRef!==undefined && response.authSessionRef!==login.authSessionRef)
        || !integer(response.readExpiresAt) || response.readExpiresAt<=Date.now()+skew || this.now()>=login.deadline) return fail();
      const deadline=Math.min(login.deadline,now+response.readExpiresAt-wall-skew);
      if(this.now()<now||this.now()>=deadline||Math.abs((Date.now()-wall)-(this.now()-now))>1000)return fail();
      login.authSessionRef=response.authSessionRef;this.readResponses.set(response,{start:now,deadline,login});return response;
    } finally {this.inFlight--;}
  }
  assertHistoryRead(response:Record<string,unknown>):void{
    const value=this.readResponses.get(response),now=this.now();
    if(!value||now<value.start||now>=value.deadline||now>=value.login.deadline)return fail();
  }
  async resolveArchiveAdmission(loginHandle: object, descriptorHash: string): Promise<Record<string,unknown>> {
    const login=this.logins.get(loginHandle),now=this.now();
    if(!login || now<login.start || now>=login.deadline || !/^[a-f0-9]{64}$/.test(descriptorHash) || this.inFlight>=4) return fail();
    this.inFlight++;
    try {
      const url=new URL(`/api/v1/auth/session/content/${this.config.source.bindingId}/history/admissions/${descriptorHash}`,this.config.sourceServer);
      const response=await requestJson("GET",url,null,null,this.config.ca,login.accessToken);validateContentMessage(response);
      if(response.kind!=="archive-admission" || (response.admission as Record<string,unknown>).descriptorHash!==descriptorHash || this.now()>=login.deadline) return fail();
      return response;
    } finally {this.inFlight--;}
  }
  async publishChallenge(handle:object,challenge:ConfirmationChallenge):Promise<void>{
    const meta=this.metadata(handle),session=this.sessions.get(handle)!;
    if(!same(challenge.source,meta.source)||!same(challenge.owner,meta.owner)||this.inFlight>=4)return fail();
    const message=envelope('confirmation-challenge',{challenge,challengeDigest:contentDigest('confirmation',challenge)});validateContentMessage(message);
    this.inFlight++;
    try{
      const url=new URL(`/api/v1/auth/session/content/${meta.source.bindingId}/source/sessions/${meta.sourceSessionId}/challenges`,this.config.sourceServer);
      const response=await post(url,canonicalJson(message),'application/json',this.config.ca,session.token);
      if(!same(response,message))return fail();this.metadata(handle);
    }finally{this.inFlight--;}
  }
  /** Metadata-only, bounded SSE. A stream event itself never authorizes capture or an action. */
  watchControl(handle:object,onMessage:(message:Record<string,unknown>)=>void,onClose:()=>void):{ready:Promise<void>;close:()=>void}{
    const meta=this.metadata(handle),session=this.sessions.get(handle)!;
    if(this.controlOpen)throw new Error('resource_busy');this.controlOpen=true;
    let ended=false,settled=false,resolveReady!:()=>void,rejectReady!:(e:Error)=>void;
    const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
    let headersTimer:NodeJS.Timeout,expiryTimer:NodeJS.Timeout;
    const finish=()=>{if(ended)return;ended=true;this.controlOpen=false;clearTimeout(headersTimer);clearTimeout(expiryTimer);
      if(!settled){settled=true;rejectReady(new Error('source_control_unavailable'));}
      req.destroy();try{onClose();}catch{/* Native denial/outcome errors never escape a socket callback. */}};
    const url=new URL(`/api/v1/auth/session/content/${meta.source.bindingId}/source/sessions/${meta.sourceSessionId}/control`,this.config.sourceServer);
    const req=request(url,{method:'GET',agent:false,...(this.config.ca?{ca:this.config.ca}:{}),headers:{Accept:'text/event-stream',Authorization:`Bearer ${session.token}`}},res=>{
      clearTimeout(headersTimer);
      if(res.statusCode!==200||!/^text\/event-stream(?:\s*;|$)/i.test(String(res.headers['content-type']??''))||res.headers['content-encoding']!==undefined){res.destroy();finish();return;}
      settled=true;resolveReady();const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',data='';
      res.on('data',(bytes:Buffer)=>{try{
        this.metadata(handle);buffer+=decoder.decode(bytes,{stream:true});if(Buffer.byteLength(buffer)+Buffer.byteLength(data)>65536)throw new Error('control_oversize');
        let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);
          if(line===''){
            if(data){const message=record(parseStrictJson(data,65536));data='';validateContentMessage(message);
              if(!['grant-activate','grant-refresh','content-revoke','confirmation-proof'].includes(String(message.kind)))return finish();
              for(const scope of [message.scope,message.previousScope,message.nextScope])if(scope&&(!same((scope as Scope).source,meta.source)||!same((scope as Scope).owner,meta.owner)))return finish();
              onMessage(message);
            }
          }else if(line.startsWith('data:')){data+=line.slice(5).replace(/^ /,'')+'\n';if(Buffer.byteLength(data)>65536)throw new Error('control_oversize');}
          else if(!line.startsWith(':'))throw new Error('control_frame_refused');
        }
      }catch{finish();}});
      res.on('error',finish);res.on('end',finish);res.on('close',finish);
    });
    headersTimer=setTimeout(finish,10000);expiryTimer=setTimeout(finish,Math.max(0,session.deadline-this.now()));headersTimer.unref();expiryTimer.unref();
    req.on('error',finish);req.end();return {ready,close:finish};
  }
  /** Observed invalidation is immediate locally. No reconnect or silent login reparenting. */
  invalidate(handle: object): void {
    const session = this.sessions.get(handle);
    if (session) { for(const stream of session.login.streams)stream.abort();session.login.streams.clear();session.deadline = -1; session.login.deadline = -1; this.sessions.delete(handle); }
  }
}

interface ConfirmationFlowConfig {
  issuer: string; authorizeUrl: string; tokenUrl: string; clientId: string; sourceClientId: string;
  redirectUri: string; ca?: string; monotonicNow?: () => number;
}
/** Dedicated public-client flow; only the native verifier may consume the resulting proof.
 * prompt=login is requested, but the IdP MUST independently enforce one fresh UV event per attempt.
 * This client cannot establish that server invariant by inspecting an ID token.
 */
export class ConfirmationCodeFlow {
  private readonly config: ConfirmationFlowConfig;
  private readonly now: () => number;
  private attempts = new Map<object, LoginAttempt & { deadline: number }>();
  private inFlight = 0;
  private cancellationEpoch = 0;
  constructor(config: ConfirmationFlowConfig) {
    this.config = { ...config }; this.now = config.monotonicNow ?? (() => performance.now());
    const issuer = https(config.issuer);
    if (https(config.authorizeUrl).origin !== issuer.origin || https(config.tokenUrl).origin !== issuer.origin
      || !id(config.clientId) || !id(config.sourceClientId) || config.clientId === config.sourceClientId) fail();
    const redirect = new URL(config.redirectUri);
    if (redirect.username || redirect.password || redirect.search || redirect.hash
      || !(redirect.protocol === "https:" || (redirect.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(redirect.hostname)))) fail();
  }
  begin(challenge: ConfirmationChallenge): { handle: object; url: string } {
    const now = this.now(), wall = Date.now();
    for (const [key, attempt] of this.attempts) if (now < attempt.start || now >= attempt.deadline) this.attempts.delete(key);
    if (this.attempts.size + this.inFlight >= 16) throw new Error("resource_busy");
    if (challenge.owner.issuer !== this.config.issuer || challenge.clientId !== this.config.clientId
      || challenge.expiresAt <= wall || challenge.expiresAt - challenge.issuedAt > 60_000 || challenge.issuedAt > wall) return fail();
    const req = buildAuthorizeRequest({ authorizeUrl: this.config.authorizeUrl, clientId: this.config.clientId,
      redirectUri: this.config.redirectUri, scope: "openid" });
    const url = new URL(req.url);
    url.searchParams.set("prompt", "login"); url.searchParams.set("nonce", confirmationNonce(challenge));
    const handle = Object.freeze({}); this.attempts.set(handle, { verifier: req.verifier, state: req.state,
      start: now, deadline: now + challenge.expiresAt - wall });
    return { handle, url: url.href };
  }
  async complete(handle: object, callback: { code: string; state: string }): Promise<string> {
    const attempt = this.attempts.get(handle); this.attempts.delete(handle);
    if (!attempt || this.now() < attempt.start || this.now() >= attempt.deadline || !id(callback.code)
      || typeof callback.state !== "string" || Buffer.byteLength(callback.state) !== Buffer.byteLength(attempt.state)
      || !timingSafeEqual(Buffer.from(callback.state), Buffer.from(attempt.state))) return fail();
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri, code: callback.code, code_verifier: attempt.verifier });
    const epoch = this.cancellationEpoch;
    this.inFlight++;
    try {
      const response = await post(https(this.config.tokenUrl), form.toString(), "application/x-www-form-urlencoded", this.config.ca);
      if (epoch !== this.cancellationEpoch || typeof response.id_token !== "string" || response.id_token.length > 24576
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(response.id_token)
        || this.now() < attempt.start || this.now() >= attempt.deadline) return fail();
      return response.id_token;
    } finally { this.inFlight--; }
  }
  cancelAll(): void { this.cancellationEpoch++; this.attempts.clear(); }
}

/** Bounded loader for one configured issuer. An unknown kid cannot select an endpoint. */
export class PinnedConfirmationJwks {
  private readonly config: { issuer: string; jwksUrl: string; ca?: string; monotonicNow?: () => number };
  private readonly now: () => number;
  private lastStart = -Infinity;
  private busy = false;
  constructor(config: { issuer: string; jwksUrl: string; ca?: string; monotonicNow?: () => number }) {
    this.config = { ...config }; this.now = config.monotonicNow ?? (() => performance.now());
    if (https(config.jwksUrl).origin !== https(config.issuer).origin) fail();
  }
  async refresh(verifier: ConfirmationVerifier): Promise<void> {
    if (verifier.issuer !== this.config.issuer) return fail();
    const now = this.now();
    if (this.busy || now < this.lastStart || now - this.lastStart < 60_000) throw new Error("rate_limited");
    this.lastStart = now; this.busy = true;
    try {
      const response = await requestJson("GET", https(this.config.jwksUrl), null, null, this.config.ca);
      if (!Array.isArray(response.keys) || response.keys.length < 1 || response.keys.length > 16) return fail();
      // replaceKeys validates all key material atomically before replacing the current set.
      verifier.replaceKeys(response.keys);
    } finally { this.busy = false; }
  }
}
