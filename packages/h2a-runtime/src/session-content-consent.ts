/** Native-owned state. Only the pinned HTTPS authority and native JWS verifier can stage an allow.
 * Native protocol callers never supply a policy, scope, boolean confirmation or lease.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SessionContentAuth } from "./session-content-auth.js";
import { ConfirmationVerifier, type ConfirmationChallenge } from "./session-content-confirmation.js";
import { ContentFence } from "./session-content-fence.js";
import { ContentQueueBudget, SessionContentExport, NativeRawAdmission,type ContentReservation } from "./session-content-export.js";
import { envelope, same, sha256, retentionDeadline, type Scope, type Policy, type Project, type Lease, type Retained } from "./session-content-contract.js";
import { contentDigest } from "./session-content-json.js";
import type { NativeHistoryProvider,HistoryBookmark } from "./session-content-history.js";
interface Pending { epoch: number; projectRevision: number; sessionRevision: number; handle: object|null;
  request: Record<string, unknown>; policy: Policy;policyToken:object; scope: Scope; lease: Lease; deadline: number; purpose:'share'|'amend'; challengeId?:string;challengeDigest?:string; bookmark?:HistoryBookmark }
/** One per native host/fence, populated only after native verification and the committed ACK.
 * Boot/generation changes alter the hashed policy; a new host inherits no acceptance by importing data.
 */
export class NativeContentPolicies {
  private sequence=0;
  private sessions=new Map<string,{id:string;projectKey:string;birth:number;invalidate:(policy:Policy)=>void}>();
  private accepted=new Map<string,{projectKey:string;revision:number;at:number;identity:string;policyRevision:number;futureSince:Map<string,number>;selected:Map<string,number>}>();
  private floors=new Map<string,{revision:number;digest:string}>();
  private tokens=new WeakMap<object,{key:string;revision:number;digest:string}>();
  private identity(policy:Policy):string{return contentDigest('local-policy',{id:policy.id,owner:policy.owner,project:policy.project});}
  current(policy:Policy):boolean{
    const floor=this.floors.get(this.identity(policy));return !!floor&&floor.revision===policy.revision&&floor.digest===contentDigest('policy',policy);
  }
  currentToken(token:object):boolean{const value=this.tokens.get(token),floor=value&&this.floors.get(value.key);return !!value&&!!floor&&floor.revision===value.revision&&floor.digest===value.digest;}
  stage(policy:Policy):object{
    const key=this.identity(policy),digest=contentDigest('policy',policy),old=this.floors.get(key);
    if(old&&(policy.revision<old.revision||(policy.revision===old.revision&&digest!==old.digest)))throw new Error('stale_policy');
    if(!old&&this.floors.size>=256)throw new Error('resource_busy');
    if(!old||policy.revision>old.revision){this.floors.set(key,{revision:policy.revision,digest});for(const session of this.sessions.values())session.invalidate(policy);}
    const token=Object.freeze({});this.tokens.set(token,{key,revision:policy.revision,digest});return token;
  }
  register(key:string,id:string,projectKey:string,invalidate:(policy:Policy)=>void):number{
    const old=this.sessions.get(key);if(old){old.invalidate=invalidate;return old.birth;}
    if(this.sessions.size>=256)throw new Error('resource_busy');const birth=++this.sequence;
    this.sessions.set(key,{id,projectKey,birth,invalidate});return birth;
  }
  remember(policy:Policy,projectKey:string,revision:number,fence:ContentFence):void{
    if(!this.current(policy))throw new Error('stale_policy');
    const digest=contentDigest('policy',policy),old=this.accepted.get(digest);
    if(!old&&this.accepted.size>=256)throw new Error('resource_busy');
    const identity=this.identity(policy),prior=[...this.accepted.values()].filter(p=>p.identity===identity&&p.revision===revision&&p.policyRevision<policy.revision).sort((a,b)=>b.policyRevision-a.policyRevision)[0];
    const at=++this.sequence;
    const value=old&&old.revision===revision?old:{projectKey,revision,at,identity,policyRevision:policy.revision,futureSince:new Map<string,number>(),selected:new Map<string,number>()};
    if(policy.sessions.future)for(const source of policy.sources){const key=contentDigest('source',source);value.futureSince.set(key,prior?.futureSince.get(key)??value.futureSince.get(key)??at);}
    for(const [key,s] of this.sessions)if(s.projectKey===projectKey&&policy.sessions.selected.includes(s.id))value.selected.set(key,fence.revision(key));
    this.accepted.set(digest,value);
  }
  permits(policy:Policy,projectKey:string,projectRevision:number,sessionKey:string,sessionRevision:number,birth:number,source:Scope['source']):boolean{
    if(!this.current(policy))return false;
    const a=this.accepted.get(contentDigest('policy',policy));
    if(!a||a.projectKey!==projectKey||a.revision!==projectRevision)return false;
    const futureSince=a.futureSince.get(contentDigest('source',source));
    return a.selected.get(sessionKey)===sessionRevision || (policy.sessions.future&&futureSince!==undefined&&birth>futureSince&&sessionRevision===0);
  }
}
const hostPolicies=new WeakMap<ContentFence,NativeContentPolicies>();
export class SessionContentConsent {
  private state: "off" | "pending" | "active" | "paused" | "denied" = "off";
  private rawSeq = 0;
  private epoch = 0;
  private startAfterSeq: number | null = null;
  private pending: Pending | null = null;
  private active: Pending | null = null;
  private sending: AbortController | null = null;
  private captureCancellation=new AbortController();
  private controlBusy=false;
  private controlConfirming=false;
  private readonly queue: SessionContentExport;
  private readonly now: () => number;
  private readonly wall: () => number;
  private readonly projectKey: string;
  private readonly sessionKey: string;
  private readonly policies:NativeContentPolicies;
  private readonly birth:number;
  private admission:NativeRawAdmission|null=null;
  private subscription:{dispose:()=>void}|null=null;
  readonly counters = { sourceContentReads:0, contentSubscriptions:0, serializedContentBytes:0, exportBytes:0, gaps:0 };
  constructor(private readonly config: { auth: SessionContentAuth; sourceSession: object; verifier: ConfirmationVerifier;
    fence: ContentFence; budget: ContentQueueBudget; sessionId: string; sessionIncarnation: string; project: Project;
    monotonicNow?: () => number; wallNow?: () => number; history?:NativeHistoryProvider;policies?:NativeContentPolicies }) {
    if(config.verifier.clientId===config.auth.sourceClientId||config.verifier.issuer!==config.auth.issuer)throw new Error('invalid_confirmation_configuration');
    this.now = config.monotonicNow ?? (()=>performance.now()); this.wall = config.wallNow ?? Date.now;
    this.queue = new SessionContentExport(config.budget);
    this.projectKey = contentDigest("local-project",config.project);
    this.sessionKey = contentDigest("local-session",{project:config.project,sessionId:config.sessionId,sessionIncarnation:config.sessionIncarnation});
    this.policies=config.policies??hostPolicies.get(config.fence)??new NativeContentPolicies();hostPolicies.set(config.fence,this.policies);
    this.birth=this.policies.register(this.sessionKey,config.sessionId,this.projectKey,policy=>{
      if([this.active,this.pending].some(p=>p&&p.policy.id===policy.id&&same(p.policy.owner,policy.owner)&&same(p.policy.project,policy.project)&&p.policy.revision<policy.revision))this.pause();
    });
  }
  private denied(): boolean { return this.config.fence.denied(this.projectKey) || this.config.fence.denied(this.sessionKey); }
  bindRawAdmission(admission:NativeRawAdmission):void{
    if(this.admission||this.state!=='off')throw new Error('unsupported_source');this.admission=admission;
  }
  private sequence():number{return this.admission?.sequence??this.rawSeq;}
  private subscribe():void{
    if(this.admission&&(this.active!.policy.channels.terminalLive||this.active!.policy.channels.terminalCache)){
      this.subscription=this.admission.subscribe((seq,bytes)=>{try{this.onRawBytes(seq,bytes);}catch{this.disconnect();}});
      this.counters.contentSubscriptions=this.admission.subscriptions;
    }
  }
  assertNativeSession(id: string, incarnation: string, generation: string): void {
    if(id!==this.config.sessionId || incarnation!==this.config.sessionIncarnation
      || this.config.auth.metadata(this.config.sourceSession).source.sourceGeneration!==generation) throw new Error("unsupported_source");
  }
  private pause(reason: "paused" | "denied" = "paused"): void {
    this.subscription?.dispose();this.subscription=null;this.counters.contentSubscriptions=0;
    this.captureCancellation.abort();
    this.sending?.abort(); this.sending=null;
    if(this.pending?.handle) this.config.verifier.cancel(this.pending.handle);
    this.epoch++; this.queue.clear(); this.pending = null; this.active = null; this.state = reason;
    this.counters.gaps++;
  }
  /** Reserved path: no network, pending quota or archive job slot. */
  exclude(target: "project" | "session" = "session"): void {
    this.pause("denied"); this.config.verifier.cancelAll();
    this.config.fence.deny(target === "project" ? this.projectKey : this.sessionKey);
  }
  clearExclusion(target: "project" | "session" = "session"): void {
    this.pause(); this.config.fence.clear(target === "project" ? this.projectKey : this.sessionKey); this.state = "off";
  }
  disconnect(): void { this.pause(); this.config.verifier.cancelAll(); }
  private fresh(p: Pending): boolean {
    if (p.epoch !== this.epoch || this.now() >= p.deadline || this.denied() || !this.policies.currentToken(p.policyToken)
      || this.config.fence.revision(this.projectKey) !== p.projectRevision || this.config.fence.revision(this.sessionKey) !== p.sessionRevision) return false;
    try { this.config.auth.metadata(this.config.sourceSession); return true; } catch { return false; }
  }
  status(): { state: string; rawSeq: number; startAfterSeq: number | null } {
    if(this.state!=='denied'&&this.denied())this.pause('denied');
    if (this.state === "active" && (!this.active || !this.fresh(this.active))) this.pause();
    return {state:this.state,rawSeq:this.sequence(),startAfterSeq:this.startAfterSeq};
  }
  async prepare(proposalId: string): Promise<ConfirmationChallenge> {
    return (await this.preparePolicy(proposalId,false))!;
  }
  /** Reconnect/selected/future-child application consults native acceptance, never a server receipt boolean. */
  async applyAcceptedPolicy(proposalId:string):Promise<void>{await this.preparePolicy(proposalId,true);}
  private async preparePolicy(proposalId:string,reuse:boolean):Promise<ConfirmationChallenge|null>{
    this.pause(); if (this.denied()) { this.state="denied"; throw new Error("excluded"); }
    const epoch=this.epoch, projectRevision=this.config.fence.revision(this.projectKey), sessionRevision=this.config.fence.revision(this.sessionKey);
    this.state="pending";
    try {
      const resolved=await this.config.auth.resolveGrant(this.config.sourceSession,proposalId);
      const r=resolved.request, scope=(r.scope ?? r.nextScope) as Scope, policy=resolved.policy;
      if (epoch!==this.epoch || this.denied() || projectRevision!==this.config.fence.revision(this.projectKey)
        || sessionRevision!==this.config.fence.revision(this.sessionKey)) throw new Error("excluded");
      if (r.kind!=="grant-activate" && !(r.kind==="grant-refresh" && r.operation==="amend")) throw new Error("invalid_grant");
      if (scope.sessionId!==this.config.sessionId || scope.sessionIncarnation!==this.config.sessionIncarnation
        || !same(scope.project,this.config.project) || !same(scope.owner,policy.owner) || !same(scope.project,policy.project)
        || !policy.sources.some(source=>same(source,scope.source)) || scope.policyId!==policy.id || scope.policyRevision!==policy.revision
        || scope.exclusionRevision!==policy.exclusionRevision || (!reuse&&!policy.sessions.selected.includes(scope.sessionId))) throw new Error("scope_refused");
      // Native history requires an independently qualified provider barrier, never legacy capture/mtime.
      if (policy.channels.nativeHistory && !this.config.history) throw new Error("unsupported_format");
      const policyToken=this.policies.stage(policy);
      const purpose=r.kind==='grant-activate'?'share' as const:'amend' as const;
      if(reuse){
        if(!this.policies.permits(policy,this.projectKey,projectRevision,this.sessionKey,sessionRevision,this.birth,scope.source))throw new Error('unconfirmed_policy');
        const p:Pending={epoch,projectRevision,sessionRevision,handle:null,request:r,policy,policyToken,scope,lease:r.lease as Lease,deadline:resolved.deadline,purpose};
        this.pending=p;await this.activate(p);return null;
      }
      const input: Omit<ConfirmationChallenge,"issuedAt"|"expiresAt">={id:randomUUID(),owner:scope.owner,project:scope.project,source:scope.source,
        clientId:this.config.verifier.clientId,purpose:r.kind==="grant-activate"?"share":"amend",target:{kind:"policy",policyDigest:r.policyDigest as string},
        random:randomBytes(32).toString("base64url")};
      const {handle,challenge}=this.config.verifier.create(input,Math.floor(Math.min(60000,Math.max(0,resolved.deadline-this.now()))));
      this.pending={epoch,projectRevision,sessionRevision,handle,request:r,policy,policyToken,scope,lease:r.lease as Lease,deadline:resolved.deadline,purpose,
        challengeId:challenge.id,challengeDigest:contentDigest('confirmation',challenge)};
      return structuredClone(challenge);
    } catch(e) { if(epoch===this.epoch) this.pause(); throw e; }
  }
  async confirm(idToken: string): Promise<void> {
    const p=this.pending; if(!p?.handle || !this.fresh(p)) { this.pause(); throw new Error("invalid_confirmation"); }
    this.config.verifier.consume(p.handle,idToken,{commit:(id,proof)=>{
      if(!this.fresh(p)) throw new Error("excluded");
      this.config.fence.consume(this.sessionKey,p.sessionRevision,id,proof);
    }});
    await this.activate(p);
  }
  private async activate(p:Pending):Promise<void>{
    this.startAfterSeq=this.sequence();
    if(p.policy.channels.nativeHistory){
      try{p.bookmark=await this.config.history!.stage(p.policy);if(!this.fresh(p))throw new Error('excluded');}
      catch(e){if(p.epoch===this.epoch)this.pause();throw e;}
    }
    const ack=envelope("source-ack",{requestId:p.request.requestId,requestDigest:contentDigest("control",p.request),connectionId:p.request.connectionId,
      operation:p.purpose==="share"?"activate":"amend",status:"staged",scope:p.scope,boundary:{startAfterSeq:this.startAfterSeq,native:p.bookmark?{provider:p.bookmark.provider,selections:p.bookmark.selections,boundaryId:p.bookmark.boundaryId}:null},lease:p.lease,reason:null});
    try {
      const result=await this.config.auth.commitAck(this.config.sourceSession,ack);
      if(!this.fresh(p) || result.kind!=="control-result" || result.status!=="committed" || result.reason!==null
        || result.requestId!==ack.requestId || result.requestDigest!==ack.requestDigest || result.sourceAckDigest!==contentDigest("ack",ack)
        || result.connectionId!==ack.connectionId) throw new Error("ack_refused");
      if(p.handle)this.policies.remember(p.policy,this.projectKey,p.projectRevision,this.config.fence);
      this.queue.reset(this.epoch); this.captureCancellation=new AbortController(); this.active=p; this.pending=null; this.state="active";
      this.subscribe();
    } catch(e) { if(p.epoch===this.epoch) this.pause(); throw e; }
  }
  async renew(proposalId: string): Promise<void> {
    const old=this.active;
    if(!old || !this.fresh(old)) { this.pause(); throw new Error("authority_invalidated"); }
    // Keep the prior mutually committed expiry throughout the asynchronous renewal handshake.
    const epoch=this.epoch;
    try {
      await this.config.auth.renewSource(this.config.sourceSession);
      const resolved=await this.config.auth.resolveGrant(this.config.sourceSession,proposalId),r=resolved.request;
      if(!this.fresh(old) || epoch!==this.epoch || r.kind!=="grant-refresh" || r.operation!=="renew"
        || !same(r.previousScope,old.scope) || !same(r.nextScope,old.scope) || !same(resolved.policy,old.policy)
        || r.connectionId!==old.request.connectionId) throw new Error("renewal_refused");
      const ack=envelope("source-ack",{requestId:r.requestId,requestDigest:contentDigest("control",r),connectionId:r.connectionId,
        operation:"renew",status:"staged",scope:old.scope,boundary:{startAfterSeq:this.startAfterSeq,native:old.bookmark?{provider:old.bookmark.provider,selections:old.bookmark.selections,boundaryId:old.bookmark.boundaryId}:null},lease:r.lease,reason:null});
      const response=await this.config.auth.commitAck(this.config.sourceSession,ack);
      if(!this.fresh(old) || epoch!==this.epoch || this.now()>=resolved.deadline || response.kind!=="control-result"
        || response.status!=="committed" || response.reason!==null || response.requestId!==r.requestId
        || response.requestDigest!==ack.requestDigest || response.sourceAckDigest!==contentDigest("ack",ack)
        || response.connectionId!==r.connectionId) throw new Error("renewal_refused");
      // Fence old reservations and bytes before switching the lease, preserving the raw boundary.
      this.sending?.abort(); this.sending=null; this.epoch++; this.queue.reset(this.epoch);
      this.captureCancellation.abort();this.captureCancellation=new AbortController();
      this.active={...old,epoch:this.epoch,request:r,lease:r.lease as Lease,deadline:resolved.deadline};
    } catch(e) { if(epoch===this.epoch) this.pause(); throw e; }
  }
  get sessionId():string{return this.config.sessionId;}
  /** Called by the native source multiplexer; all allow paths still resolve pinned HTTPS/native proofs. */
  acceptControl(message:Record<string,unknown>):void{
      if(message.kind==='content-revoke'){
        const target=message.target as Record<string,unknown>;
        if(message.effect==='read')return;
        if(target.kind==='project'&&same(target.project,this.config.project)){this.exclude('project');return;}
        const scope=target.scope as Scope|undefined;
        if(target.kind==='session'&&scope?.sessionId===this.config.sessionId&&scope.sessionIncarnation===this.config.sessionIncarnation
          &&same(scope.project,this.config.project)&&same(scope.source,this.config.auth.metadata(this.config.sourceSession).source))this.exclude();
        return;
      }
      if(message.kind==='confirmation-proof'){
        if(this.controlConfirming||!this.pending||message.challengeId!==this.pending.challengeId||message.challengeDigest!==this.pending.challengeDigest)return;
        this.controlConfirming=true;void this.confirm(message.idToken as string).catch(()=>this.disconnect()).finally(()=>{this.controlConfirming=false;});return;
      }
      if(this.controlBusy)return;this.controlBusy=true;
      void (async()=>{
        if(message.kind==='grant-refresh'&&message.operation==='renew'){await this.renew(message.requestId as string);return;}
        try{await this.applyAcceptedPolicy(message.requestId as string);}
        catch(e){
          if((e as Error).message!=='unconfirmed_policy')throw e;
          const challenge=await this.prepare(message.requestId as string);await this.config.auth.publishChallenge(this.config.sourceSession,challenge);
        }
      })().catch(()=>this.disconnect()).finally(()=>{this.controlBusy=false;});
  }
  connectControl():{ready:Promise<void>;close:()=>void}{
    const source=new SessionContentSource(this.config.auth,this.config.sourceSession);source.attach(this);return source.start();
  }
  /** Called at the host's raw PTY admission, before TerminalResetRelay. Off/pending do not inspect/copy/hash text. */
  onRaw(data: string): void {
    this.rawSeq++;
    if(this.status().state!=="active") return;
    if(!this.active!.policy.channels.terminalLive && !this.active!.policy.channels.terminalCache) return;
    this.counters.sourceContentReads++;
    if(!this.queue.admit(this.rawSeq,data)) this.pause();
  }
  private onRawBytes(seq:number,bytes:Buffer):void{
    if(this.status().state!=='active')return;
    this.counters.sourceContentReads++;if(!this.queue.admit(seq,bytes))this.pause();
  }
  reserve(): ContentReservation | null { return this.status().state==="active"?this.queue.reserve():null; }
  fragment(reservation: ContentReservation, channel: "terminal.live" | "terminal.cache"): Record<string,unknown> {
    const p=this.active;
    if(!p || this.status().state!=="active" || !this.queue.current(reservation)
      || !(channel==="terminal.live"?p.policy.channels.terminalLive:p.policy.channels.terminalCache)) throw new Error("content_refused");
    const result=envelope("terminal-fragment",{scope:p.scope,connectionId:p.request.connectionId,leaseId:p.lease.id,channel,
      rawSeq:reservation.rawSeq,byteOffset:reservation.byteOffset,byteLength:reservation.bytes.length,totalBytes:reservation.totalBytes,
      payloadB64:reservation.bytes.toString("base64url"),payloadHash:sha256(reservation.bytes),final:reservation.final});
    this.counters.serializedContentBytes+=reservation.bytes.length; return result;
  }
  commit(reservation: ContentReservation): void { if(this.status().state!=="active") return; this.queue.commit(reservation); }
  nativeHistory():{policy:Policy;scope:Scope;lease:Lease;connectionId:string;provider:NativeHistoryProvider;bookmark:HistoryBookmark;signal:AbortSignal;deadline:number;valid:()=>boolean}{
    const p=this.active;
    if(!p||this.status().state!=='active'||!p.policy.channels.nativeHistory||!p.bookmark||!this.config.history)throw new Error('history_scope_refused');
    return {policy:structuredClone(p.policy),scope:structuredClone(p.scope),lease:{...p.lease},connectionId:p.request.connectionId as string,
      provider:this.config.history,bookmark:p.bookmark,signal:this.captureCancellation.signal,deadline:p.deadline,valid:()=>this.fresh(p)};
  }
  async flush(channel: "terminal.live" | "terminal.cache"): Promise<boolean> {
    if(this.sending) throw new Error("resource_busy");
    const reservation=this.reserve(); if(!reservation) return false;
    const message=this.fragment(reservation,channel), abort=new AbortController(); this.sending=abort;
    const p=this.active!;
    try {
      const ack=await this.config.auth.sendFragment(this.config.sourceSession,message,abort.signal);
      const coverage=ack.coverage as Record<string,unknown>, cursor=coverage?.cursor as Record<string,unknown>;
      if(!this.fresh(p) || !this.queue.current(reservation) || ack.kind!=="ingest-ack" || !["accepted","duplicate"].includes(String(ack.status))
        || ack.connectionId!==p.request.connectionId || ack.scopeDigest!==contentDigest("scope",p.scope) || coverage?.kind!=="terminal"
        || cursor?.scopeDigest!==ack.scopeDigest || cursor.connectionId!==ack.connectionId
        || cursor?.channel!==channel || cursor.rawSeq!==reservation.rawSeq || cursor.byteOffset!==reservation.byteOffset+reservation.bytes.length) throw new Error("ingest_refused");
      const retained=ack.retained as Retained|null;
      if(channel==="terminal.live" ? retained!==null : !retained || retained.originScopeDigest!==ack.scopeDigest
        || retentionDeadline(p.policy.retentionByChannel.terminalCache,retained.acceptedAt)!==retained.expiresAt) throw new Error("retention_refused");
      this.counters.exportBytes+=reservation.bytes.length; this.queue.commit(reservation); return true;
    } catch(e) { if(p.epoch===this.epoch) this.pause(); throw e; }
    finally { if(this.sending===abort) this.sending=null; }
  }
}
/** One bounded metadata stream per authenticated source, routed across native sessions. */
export class SessionContentSource {
  private readonly sessions=new Map<string,SessionContentConsent>();
  constructor(private readonly auth:SessionContentAuth,private readonly handle:object){}
  attach(session:SessionContentConsent):void{
    if(this.sessions.has(session.sessionId)||this.sessions.size>=256)throw new Error('resource_busy');this.sessions.set(session.sessionId,session);
  }
  start():{ready:Promise<void>;close:()=>void}{
    for(const session of this.sessions.values())session.disconnect();
    return this.auth.watchControl(this.handle,message=>{
      const scope=(message.scope??message.nextScope) as Scope|undefined;
      if(scope){this.sessions.get(scope.sessionId)?.acceptControl(message);return;}
      const target=message.target as {kind:string;scope?:Scope}|undefined;
      if(target?.kind==='session'){this.sessions.get(target.scope!.sessionId)?.acceptControl(message);return;}
      for(const session of this.sessions.values())session.acceptControl(message);
    },()=>{for(const session of this.sessions.values())session.disconnect();});
  }
}
