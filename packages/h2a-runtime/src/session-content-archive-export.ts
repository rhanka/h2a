import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { lstat,mkdtemp,rm } from "node:fs/promises";
import { join,isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { SessionContentConsent } from "./session-content-consent.js";
import { ArchiveBudget } from "./session-content-archive.js";
import { envelope,validateContentMessage,type Manifest } from "./session-content-contract.js";
import { contentDigest } from "./session-content-json.js";
import type { ArchivePart } from "./session-content-import.js";
/** Internal data transport port. The configured adapter must honor the cancellation signal;
 * production publication/admission remains with the authenticated Sentropic service.
 */
export type ArchiveSink=(manifest:Manifest,parts:AsyncIterable<ArchivePart>,signal:AbortSignal)=>Promise<void>;
export class SessionContentArchiveExport {
  constructor(private readonly config:{workRoot:string;budget:ArchiveBudget}){}
  async export(consent:SessionContentConsent,sink:ArchiveSink):Promise<Manifest>{
    const permission=consent.nativeHistory();
    if(!permission.valid())throw new Error('content_refused');
    const job=this.config.budget.open('export');let releaseMemory:(()=>void)|undefined,worker:Worker|undefined,stage:string|undefined,sequence=0;
    const cancellation=new SharedArrayBuffer(4),flag=new Int32Array(cancellation);
    const abort=()=>{Atomics.store(flag,0,1);job.cancellation.abort();void worker?.terminate();};
    permission.signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,Math.max(0,permission.deadline-performance.now()));timer.unref();
    const check=()=>{job.cancellation.signal.throwIfAborted();if(!permission.valid())throw new Error('content_refused');};
    const call=(operation:string,data:unknown)=>new Promise<any>((resolve,reject)=>{
      if(job.cancellation.signal.aborted){reject(new Error('archive_cancelled'));return;}
      const id=++sequence;
      const cleanup=()=>{worker!.off('message',message);worker!.off('error',error);worker!.off('exit',error);};
      const error=()=>{cleanup();reject(new Error('archive_worker_failed'));};
      const message=(m:{id:number;ok:boolean;result:unknown})=>{if(m.id===id){cleanup();m.ok?resolve(m.result):reject(new Error('archive_worker_refused'));}};
      worker!.on('message',message);worker!.once('error',error);worker!.once('exit',error);worker!.postMessage({id,operation,data});
    });
    try{
      check();const inventory=permission.provider.resolve(permission.bookmark);
      releaseMemory=this.config.budget.reserveMemory(2*Buffer.byteLength(JSON.stringify(inventory))+262144);
      const info=await lstat(this.config.workRoot);if(!isAbsolute(this.config.workRoot)||!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw new Error('unsafe_archive_root');
      job.consume(inventory.files.reduce((n,f)=>n+Number(f.identity.size),0));stage=await mkdtemp(join(this.config.workRoot,'.export-'));
      const source=import.meta.url.endsWith('.ts');worker=new Worker(new URL(source?'./session-content-archive-worker.ts':'./session-content-archive-worker.js',import.meta.url),{
        execArgv:source?['--import',new URL('./session-content-test-loader.mjs',import.meta.url).href]:[]});
      worker.on('error',()=>job.cancellation.abort());worker.on('exit',code=>{if(code!==0)job.cancellation.abort();});
      const outcome=await call('snapshot',{files:inventory.files,stage,cancellation,deadline:permission.deadline}) as {path:string;role:'records'|'artifact';bytes:number;sha256:string;lineageId:string;records:number}[];
      check();await permission.provider.recheck(permission.bookmark);check();
      const files=outcome.map(({path,role,bytes,sha256})=>({path,role,bytes,sha256}));
      const ranges=inventory.entries.map(entry=>({lineageId:entry.lineageId,checkpointId:entry.checkpointId,fromRecord:0,
        toRecord:outcome.filter(f=>f.lineageId===entry.lineageId).reduce((n,f)=>n+f.records,0)-1,
        inventoryHash:contentDigest('inventory',files.filter(f=>outcome.some(o=>o.path===f.path&&o.lineageId===entry.lineageId)))}));
      const body=envelope('native-manifest',{scope:permission.scope,connectionId:permission.connectionId,leaseId:permission.lease.id,archive:'h2a.session-archive/1' as const,
        snapshotId:randomUUID(),policyDigest:contentDigest('policy',permission.policy),provider:permission.provider.provider,ranges,files,complete:true,resumable:false as const});
      const manifest:Manifest={...body,manifestHash:contentDigest('manifest',body)};validateContentMessage(manifest);
      let complete=false;
      const parts=(async function*(){
        for(const file of files){let offset=0;
          do{check();const data=await call('read-part',{stage,path:file.path,totalBytes:file.bytes,byteOffset:offset});check();job.consume(data.byteLength);
            const part=envelope('native-part',{scope:manifest.scope,connectionId:manifest.connectionId,leaseId:manifest.leaseId,snapshotId:manifest.snapshotId,fileSha256:file.sha256,...data}) as ArchivePart;
            yield part;offset+=part.byteLength;
          }while(offset<file.bytes);
        }
        complete=true;
      })();
      const rejected=new Promise<never>((_,reject)=>{if(job.cancellation.signal.aborted)reject(new Error('archive_cancelled'));
        else job.cancellation.signal.addEventListener('abort',()=>reject(new Error('archive_cancelled')),{once:true});});
      await Promise.race([sink(manifest,parts,job.cancellation.signal),rejected]);check();
      if(!complete)throw new Error('incomplete_archive_transport');await permission.provider.recheck(permission.bookmark);check();return manifest;
    }finally{clearTimeout(timer);permission.signal.removeEventListener('abort',abort);await worker?.terminate();if(stage)await rm(stage,{recursive:true,force:true});releaseMemory?.();job.close();}
  }
}
