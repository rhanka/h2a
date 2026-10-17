import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { capsuleDirectory, type Manifest, type ArchiveAdmission, type Policy } from "./session-content-contract.js";
import { contentDigest } from "./session-content-json.js";
import { ArchiveBudget, validateArchiveBinding, safeArchivePath } from "./session-content-archive.js";
import { NativeHistoryProvider } from "./session-content-history.js";
const fixture=(name:string)=>JSON.parse(readFileSync(new URL(name+'.v2.json',capsuleDirectory),'utf8'));
it('should bind the complete archive to its original policy, snapshot, admission and retention',()=>{
  const policy=fixture('project-policy').policy as Policy,manifest=fixture('native-manifest') as Manifest,admission=fixture('archive-admission').admission as ArchiveAdmission;
  validateArchiveBinding(policy,manifest,admission,admission.retained.acceptedAt);
  for(const mutate of [(a:ArchiveAdmission)=>{a.snapshotId='other';},(a:ArchiveAdmission)=>{a.policyDigest='f'.repeat(64);},(a:ArchiveAdmission)=>{a.retained.expiresAt=a.retained.acceptedAt+1;},(a:ArchiveAdmission)=>{a.retained.originScopeDigest='a'.repeat(64);}]){
    const a=structuredClone(admission);mutate(a);const {descriptorHash:_old,...base}=a;a.descriptorHash=contentDigest('archive-admission',base);
    expect(()=>validateArchiveBinding(policy,manifest,a,a.retained.acceptedAt)).toThrow();
  }
  expect(()=>validateArchiveBinding(policy,{...manifest,complete:false},admission,admission.retained.acceptedAt)).toThrow();
});
it('should reject traversal, alternate separators, executable configuration and colliding names',()=>{
  for(const path of ['../escape','/absolute','C:/escape','records/../x','records\\escape','records//x','records/.x','hooks/run.sh','records/a\u0000b'])expect(()=>safeArchivePath(path)).toThrow();
  expect(safeArchivePath('records/history.jsonl')).toBe('records/history.jsonl');
  const policy=fixture('project-policy').policy,manifest=fixture('native-manifest'),admission=fixture('archive-admission').admission;
  manifest.files.push({...manifest.files[0],path:'records/HISTORY.jsonl'});
  expect(()=>validateArchiveBinding(policy,manifest,admission,admission.retained.acceptedAt)).toThrow();
});
it('should share host archive slots and cumulative start budgets without queuing or cancellation refunds',()=>{
  let now=0;const b=new ArchiveBudget(()=>now),i=b.open('import'),e=b.open('export'),e2=b.open('export');
  expect(()=>b.open('import')).toThrow('resource_busy');expect(()=>b.open('export')).toThrow('resource_busy');
  i.close();e.close();e2.close();expect(()=>b.open('import')).toThrow('rate_limited');
  now=150000;const next=b.open('import');next.consume(268435456);expect(()=>next.consume(1)).toThrow('archive_work_exhausted');next.close();
  expect(()=>b.open('export')).toThrow('rate_limited');
});
it('should refuse aggregate worker-memory exhaustion before another allocation',()=>{
  const b=new ArchiveBudget(),release=b.reserveMemory(8388608);expect(()=>b.reserveMemory(1)).toThrow('resource_busy');release();release();b.reserveMemory(8388608)();
});
it('should refuse an unqualified provider or unconsented required companion before reading transcript content',async()=>{
  const policy=fixture('project-policy').policy,provider=fixture('native-manifest').provider;
  expect(()=>new NativeHistoryProvider({project:policy.project,provider,qualifiedProviders:[],catalog:[]})).toThrow('unsupported_format');
  const source=new NativeHistoryProvider({project:policy.project,provider,qualifiedProviders:[provider],catalog:[{lineageId:'lineage',checkpointId:'checkpoint',companions:['excluded-child'],files:[{path:'records/history.jsonl',localPath:'/never-open-this-fixture',role:'records'}]}]});
  await expect(source.stage(policy)).rejects.toThrow('unconsented_companion');
});
