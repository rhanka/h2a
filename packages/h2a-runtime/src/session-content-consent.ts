/** Native-owned state. Only the pinned HTTPS authority and native JWS verifier can stage an allow.
 * Native protocol callers never supply a policy, scope, boolean confirmation or lease.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SessionContentAuth } from "./session-content-auth.js";
import { ConfirmationVerifier, type ConfirmationChallenge } from "./session-content-confirmation.js";
import { ContentFence } from "./session-content-fence.js";
import { ContentQueueBudget, SessionContentExport, type ContentReservation } from "./session-content-export.js";
import { envelope, same, sha256, retentionDeadline, type Scope, type Policy, type Project, type Lease, type Retained } from "./session-content-contract.js";
import { contentDigest } from "./session-content-json.js";
interface Pending { epoch: number; projectRevision: number; sessionRevision: number; handle: object;
  request: Record<string, unknown>; policy: Policy; scope: Scope; lease: Lease; deadline: number; challenge: ConfirmationChallenge }
export class SessionContentConsent {
  private state: "off" | "pending" | "active" | "paused" | "denied" = "off";
  private rawSeq = 0;
  private epoch = 0;
  private startAfterSeq: number | null = null;
  private pending: Pending | null = null;
  private active: Pending | null = null;
  private sending: AbortController | null = null;
  private readonly queue: SessionContentExport;
  private readonly now: () => number;
  private readonly wall: () => number;
  private readonly projectKey: string;
  private readonly sessionKey: string;
  readonly counters = { sourceContentReads:0, contentSubscriptions:0, serializedContentBytes:0, exportBytes:0, gaps:0 };
  constructor(private readonly config: { auth: SessionContentAuth; sourceSession: object; verifier: ConfirmationVerifier;
    fence: ContentFence; budget: ContentQueueBudget; sessionId: string; sessionIncarnation: string; project: Project;
    monotonicNow?: () => number; wallNow?: () => number }) {
    this.now = config.monotonicNow ?? (()=>performance.now()); this.wall = config.wallNow ?? Date.now;
    this.queue = new SessionContentExport(config.budget);
    this.projectKey = contentDigest("local-project",config.project);
    this.sessionKey = contentDigest("local-session",{project:config.project,sessionId:config.sessionId,sessionIncarnation:config.sessionIncarnation});
  }
  private denied(): boolean { return this.config.fence.denied(this.projectKey) || this.config.fence.denied(this.sessionKey); }
  assertNativeSession(id: string, incarnation: string, generation: string): void {
    if(id!==this.config.sessionId || incarnation!==this.config.sessionIncarnation
      || this.config.auth.metadata(this.config.sourceSession).source.sourceGeneration!==generation) throw new Error("unsupported_source");
  }
  private pause(reason: "paused" | "denied" = "paused"): void {
    this.sending?.abort(); this.sending=null;
    if(this.pending) this.config.verifier.cancel(this.pending.handle);
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
    if (p.epoch !== this.epoch || this.now() >= p.deadline || this.denied()
      || this.config.fence.revision(this.projectKey) !== p.projectRevision || this.config.fence.revision(this.sessionKey) !== p.sessionRevision) return false;
    try { this.config.auth.metadata(this.config.sourceSession); return true; } catch { return false; }
  }
  status(): { state: string; rawSeq: number; startAfterSeq: number | null } {
    if (this.state === "active" && (!this.active || !this.fresh(this.active))) this.pause();
    return {state:this.state,rawSeq:this.rawSeq,startAfterSeq:this.startAfterSeq};
  }
  async prepare(proposalId: string): Promise<ConfirmationChallenge> {
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
        || scope.exclusionRevision!==policy.exclusionRevision || !policy.sessions.selected.includes(scope.sessionId)) throw new Error("scope_refused");
      // Native history requires an independently qualified provider barrier, never legacy capture/mtime.
      if (policy.channels.nativeHistory) throw new Error("unsupported_format");
      const input: Omit<ConfirmationChallenge,"issuedAt"|"expiresAt">={id:randomUUID(),owner:scope.owner,project:scope.project,source:scope.source,
        clientId:this.config.verifier.clientId,purpose:r.kind==="grant-activate"?"share":"amend",target:{kind:"policy",policyDigest:r.policyDigest as string},
        random:randomBytes(32).toString("base64url")};
      const {handle,challenge}=this.config.verifier.create(input,Math.floor(Math.min(60000,Math.max(0,resolved.deadline-this.now()))));
      this.pending={epoch,projectRevision,sessionRevision,handle,request:r,policy,scope,lease:r.lease as Lease,deadline:resolved.deadline,challenge};
      return structuredClone(challenge);
    } catch(e) { if(epoch===this.epoch) this.pause(); throw e; }
  }
  async confirm(idToken: string): Promise<void> {
    const p=this.pending; if(!p || !this.fresh(p)) { this.pause(); throw new Error("invalid_confirmation"); }
    this.config.verifier.consume(p.handle,idToken,{commit:(id,proof)=>{
      if(!this.fresh(p)) throw new Error("excluded");
      this.config.fence.consume(this.sessionKey,p.sessionRevision,id,proof);
    }});
    this.startAfterSeq=this.rawSeq;
    const ack=envelope("source-ack",{requestId:p.request.requestId,requestDigest:contentDigest("control",p.request),connectionId:p.request.connectionId,
      operation:p.challenge.purpose==="share"?"activate":"amend",status:"staged",scope:p.scope,boundary:{startAfterSeq:this.rawSeq,native:null},lease:p.lease,reason:null});
    try {
      const result=await this.config.auth.commitAck(this.config.sourceSession,ack);
      if(!this.fresh(p) || result.kind!=="control-result" || result.status!=="committed" || result.reason!==null
        || result.requestId!==ack.requestId || result.requestDigest!==ack.requestDigest || result.sourceAckDigest!==contentDigest("ack",ack)
        || result.connectionId!==ack.connectionId) throw new Error("ack_refused");
      this.queue.reset(this.epoch); this.active=p; this.pending=null; this.state="active";
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
        operation:"renew",status:"staged",scope:old.scope,boundary:{startAfterSeq:this.startAfterSeq,native:null},lease:r.lease,reason:null});
      const response=await this.config.auth.commitAck(this.config.sourceSession,ack);
      if(!this.fresh(old) || epoch!==this.epoch || this.now()>=resolved.deadline || response.kind!=="control-result"
        || response.status!=="committed" || response.reason!==null || response.requestId!==r.requestId
        || response.requestDigest!==ack.requestDigest || response.sourceAckDigest!==contentDigest("ack",ack)
        || response.connectionId!==r.connectionId) throw new Error("renewal_refused");
      // Fence old reservations and bytes before switching the lease, preserving the raw boundary.
      this.sending?.abort(); this.sending=null; this.epoch++; this.queue.reset(this.epoch);
      this.active={...old,epoch:this.epoch,request:r,lease:r.lease as Lease,deadline:resolved.deadline};
    } catch(e) { if(epoch===this.epoch) this.pause(); throw e; }
  }
  /** Called at the host's raw PTY admission, before TerminalResetRelay. Off/pending do not inspect/copy/hash text. */
  onRaw(data: string): void {
    this.rawSeq++;
    if(this.status().state!=="active") return;
    if(!this.active!.policy.channels.terminalLive && !this.active!.policy.channels.terminalCache) return;
    this.counters.sourceContentReads++;
    if(!this.queue.admit(this.rawSeq,data)) this.pause();
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
