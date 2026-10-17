import { performance } from "node:perf_hooks";
import { contentDigest } from "./session-content-json.js";
import { envelope, validateContentMessage, validatePolicy, retentionDeadline, same, type Policy, type Manifest, type ArchiveAdmission } from "./session-content-contract.js";
export function safeArchivePath(path: string): string {
  // Conservative portable data names; no executable/configuration destination namespace.
  if(path.length>240 || !/^(records|artifacts)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path)
    || path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))
    || /\.(?:exe|dll|so|dylib|sh|bash|cmd|bat|ps1|js|mjs|cjs|ts|toml|yaml|yml)$/i.test(path)) throw new Error("unsafe_archive_path");
  return path;
}
export function validateArchiveBinding(policy: Policy, manifest: Manifest, admission: ArchiveAdmission, now: number): void {
  validatePolicy(policy);validateContentMessage(manifest);validateContentMessage(envelope("archive-admission",{admission}));
  const scope=manifest.scope,digest=contentDigest('policy',policy),origin=contentDigest('scope',scope);
  if(!manifest.complete || !policy.channels.nativeHistory || !same(policy.owner,scope.owner) || !same(policy.project,scope.project)
    || !policy.sources.some(source=>same(source,scope.source)) || policy.id!==scope.policyId || policy.revision!==scope.policyRevision
    || policy.exclusionRevision!==scope.exclusionRevision || (!policy.sessions.future&&!policy.sessions.selected.includes(scope.sessionId))
    || manifest.policyDigest!==digest || admission.policyDigest!==digest || admission.snapshotId!==manifest.snapshotId
    || admission.manifestHash!==manifest.manifestHash || admission.retained.originScopeDigest!==origin
    || !same(admission.retention,policy.retentionByChannel.nativeHistory)
    || admission.retained.expiresAt!==retentionDeadline(admission.retention,admission.retained.acceptedAt)
    || admission.retained.acceptedAt>now || (admission.retained.expiresAt!==null && now>=admission.retained.expiresAt)) throw new Error("archive_binding_refused");
  const names=manifest.files.map(file=>safeArchivePath(file.path));
  if(names.some((name,i)=>i>0 && names[i-1]!>=name) || new Set(names.map(n=>n.normalize('NFC').toLowerCase())).size!==names.length) throw new Error("archive_path_collision");
  for(const file of manifest.files) if((file.role==='records')!==(file.path.startsWith('records/'))) throw new Error("archive_role_refused");
  for(const range of manifest.ranges) {
    if(policy.history.mode==='selected'&&!policy.history.selected.some(h=>h.lineageId===range.lineageId
      && (h.checkpointId===null||h.checkpointId===range.checkpointId)
      && (h.fromRecord===null||(h.fromRecord<=range.fromRecord&&h.toRecord!==null&&h.toRecord>=range.toRecord)))) throw new Error("history_scope_refused");
  }
}
export class ArchiveJob {
  readonly cancellation=new AbortController();
  private bytes=0;private closed=false;
  constructor(private readonly release:()=>void){}
  consume(bytes:number):void {
    this.cancellation.signal.throwIfAborted();
    if(this.closed || !Number.isSafeInteger(bytes) || bytes<0 || this.bytes+bytes>268435456) {this.cancellation.abort();throw new Error('archive_work_exhausted');}
    this.bytes+=bytes;
  }
  close():void {if(!this.closed){this.closed=true;this.cancellation.abort();this.release();}}
}
/** One instance per workstation/native host. Claimed remote IDs never partition this budget. */
export class ArchiveBudget {
  private imports=0;private exports=0;private tokens=3;private at:number;
  private memory=0;
  constructor(private readonly now:()=>number=()=>performance.now()){this.at=now();}
  reserveMemory(bytes:number):()=>void {
    if(!Number.isSafeInteger(bytes)||bytes<0||this.memory+bytes>8388608)throw new Error('resource_busy');
    this.memory+=bytes;let released=false;return()=>{if(!released){released=true;this.memory-=bytes;}};
  }
  open(kind:'import'|'export'):ArchiveJob {
    if(kind==='import'?this.imports>=1:this.exports>=2)throw new Error('resource_busy');
    const now=this.now();if(now<this.at)throw new Error('rate_limited');
    this.tokens=Math.min(3,this.tokens+(now-this.at)/150000);this.at=now;
    if(this.tokens<1)throw new Error('rate_limited');this.tokens--;
    if(kind==='import')this.imports++;else this.exports++;
    return new ArchiveJob(()=>{if(kind==='import')this.imports--;else this.exports--;});
  }
}
