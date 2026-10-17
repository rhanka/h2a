import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { lstat, readdir, open, mkdtemp, rename, rm, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { SessionContentAuth } from "./session-content-auth.js";
import { ArchiveBudget,safeArchivePath } from "./session-content-archive.js";
import { envelope, validateContentMessage, same, type Policy, type Manifest, type ArchiveAdmission, type Provider } from "./session-content-contract.js";
export interface ArchiveBundle { policy:Policy; manifest:Manifest; admission:ArchiveAdmission }
export interface ImportRequest { protocol:"h2a.session-content";protocolVersion:2;kind:"import-request";requestId:string;authorizationId:string;
  retained:ArchiveAdmission['retained'];snapshotId:string;manifestHash:string;descriptorHash:string;provider:Provider;mode:"isolated-data" }
export interface ArchivePart { protocol:"h2a.session-content";protocolVersion:2;kind:"native-part";scope:Manifest['scope'];connectionId:string;leaseId:string;
  snapshotId:string;fileSha256:string;byteOffset:number;byteLength:number;totalBytes:number;payloadB64:string;payloadHash:string;final:boolean }
function refuse():never{throw new Error('import_refused');}
export class SessionContentImport {
  private readonly providers:readonly Provider[];
  constructor(private readonly config:{managedRoot:string;auth:SessionContentAuth;login:object;budget:ArchiveBudget;qualifiedProviders:readonly Provider[];now?:()=>number}) {
    if(!isAbsolute(config.managedRoot)||config.managedRoot===process.env.HOME)refuse();
    this.providers=structuredClone(config.qualifiedProviders);
  }
  private now():number{return (this.config.now??Date.now)();}
  private async authorized(request:ImportRequest,bundle:ArchiveBundle):Promise<()=>void>{
    if(!this.providers.some(p=>same(p,request.provider)))throw new Error('unsupported_format');
    const read=await this.config.auth.authorizeHistoryRead(this.config.login,request.authorizationId);
    const coverage=read.coverage as Record<string,unknown>;
    const stored=await this.config.auth.resolveArchiveAdmission(this.config.login,request.descriptorHash);
    if(coverage.kind!=='native' || !same(read.retained,request.retained) || !same(bundle.admission,stored.admission)
      || !same(bundle.admission.retained,request.retained) || coverage.snapshotId!==request.snapshotId || coverage.manifestHash!==request.manifestHash
      || coverage.descriptorHash!==request.descriptorHash || bundle.admission.snapshotId!==request.snapshotId
      || bundle.admission.manifestHash!==request.manifestHash || bundle.admission.descriptorHash!==request.descriptorHash
      || !same(bundle.manifest.provider,request.provider)
      || !same(read.owner,bundle.policy.owner) || (read.readExpiresAt as number)<=this.now())refuse();
    const assert=()=>{this.config.auth.assertHistoryRead(read);if((read.readExpiresAt as number)<=this.now())refuse();};assert();return assert;
  }
  private async root():Promise<void>{
    const info=await lstat(this.config.managedRoot);
    if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid()))refuse();
    const names=await readdir(this.config.managedRoot),marker=join(this.config.managedRoot,'.h2a-session-imports');
    if(!names.includes('.h2a-session-imports')){
      if(names.length)refuse();const handle=await open(marker,'wx',0o600);try{await handle.writeFile('h2a.session-archive/1\n');await handle.sync();}finally{await handle.close();}
    }else{const st=await lstat(marker);if(!st.isFile()||st.nlink!==1||st.isSymbolicLink()||await readFile(marker,'utf8')!=='h2a.session-archive/1\n')refuse();}
  }
  async import(request:ImportRequest,bundle:ArchiveBundle,parts:AsyncIterable<ArchivePart>,signal?:AbortSignal):Promise<Record<string,unknown>>{
    validateContentMessage(request);await this.authorized(request,bundle);
    const job=this.config.budget.open('import');let releaseMemory:(()=>void)|undefined,worker:Worker|undefined,stage:string|undefined;
    const localImportId='import-'+randomUUID();let sequence=0,committed=false,succeeded=false;
    const call=(operation:string,data:unknown,transfer:Transferable[]=[])=>new Promise<void>((resolve,reject)=>{
      if(job.cancellation.signal.aborted){reject(new Error('import_cancelled'));return;}
      const id=++sequence;
      const cleanup=()=>{worker!.off('message',message);worker!.off('error',error);worker!.off('exit',exit);};
      const message=(m:{id:number;ok:boolean})=>{if(m.id===id){cleanup();m.ok?resolve():reject(new Error('import_worker_refused'));}};
      const error=()=>{cleanup();reject(new Error('import_worker_failed'));},exit=()=>error();
      worker!.on('message',message);worker!.once('error',error);worker!.once('exit',exit);worker!.postMessage({id,operation,data},transfer as import('node:worker_threads').Transferable[]);
    });
    const abort=()=>{job.cancellation.abort();void worker?.terminate();};signal?.addEventListener('abort',abort,{once:true});
    try{
      signal?.throwIfAborted();job.consume(0);
      releaseMemory=this.config.budget.reserveMemory(2*Buffer.byteLength(JSON.stringify(bundle))+262144);
      await this.root();stage=await mkdtemp(join(this.config.managedRoot,'.staging-'));
      const source=import.meta.url.endsWith('.ts');
      worker=new Worker(new URL(source?'./session-content-archive-worker.ts':'./session-content-archive-worker.js',import.meta.url),{
        execArgv:source?['--import',new URL('./session-content-test-loader.mjs',import.meta.url).href]:[]});
      worker.on('error',()=>job.cancellation.abort());worker.on('exit',code=>{if(code!==0)job.cancellation.abort();});
      await call('initialize',{...bundle,stage,now:this.now()});
      const iterator=parts[Symbol.asyncIterator]();
      try { for(;;){
        job.cancellation.signal.throwIfAborted();
        let cancel:(()=>void)|undefined;
        // Subscribe before invoking a caller's iterator: next() itself may synchronously cancel.
        const interrupted=new Promise<never>((_,reject)=>{cancel=()=>reject(new Error('import_cancelled'));
          if(job.cancellation.signal.aborted)cancel();else job.cancellation.signal.addEventListener('abort',cancel,{once:true});});
        const next=await Promise.race([interrupted,Promise.resolve().then(()=>iterator.next())])
          .finally(()=>{if(cancel)job.cancellation.signal.removeEventListener('abort',cancel);});
        if(next.done)break;const part=next.value;
        signal?.throwIfAborted();job.cancellation.signal.throwIfAborted();
        // Check encoded bounds before decoding; every decoded byte counts, including duplicates/retries.
        if(typeof part.payloadB64!=='string'||part.payloadB64.length>1048576||part.payloadB64.length%4===1
          || Math.floor(part.payloadB64.length*3/4)>262144||!/^[A-Za-z0-9_-]*$/.test(part.payloadB64))refuse();
        const bytes=Uint8Array.from(Buffer.from(part.payloadB64,'base64url'));job.consume(bytes.length);
        if(bytes.length>262144||Buffer.from(bytes).toString('base64url')!==part.payloadB64)refuse();
        const {payloadB64:_encoded,...metadata}=part;
        await call('part',{part:metadata,bytes},[bytes.buffer]);
      }} finally {void iterator.return?.().catch(()=>{});}
      const assertRead=await this.authorized(request,bundle);signal?.throwIfAborted();job.consume(0);
      const descriptor={localImportId,authorizationId:request.authorizationId,snapshotId:request.snapshotId,manifestHash:request.manifestHash,descriptorHash:request.descriptorHash,
        resumable:false,processStarted:false,keyboardAcquired:false};
      await call('finish',{descriptor,now:this.now()});
      signal?.throwIfAborted();job.consume(0);assertRead();
      if(bundle.admission.retained.expiresAt!==null && this.now()>=bundle.admission.retained.expiresAt)refuse();
      await worker.terminate();worker=undefined;
      assertRead();
      await rename(stage,join(this.config.managedRoot,localImportId));stage=undefined;committed=true;
      const dir=await open(this.config.managedRoot,'r');try{await dir.sync();}finally{await dir.close();}
      assertRead();if(bundle.admission.retained.expiresAt!==null&&this.now()>=bundle.admission.retained.expiresAt)refuse();
      succeeded=true;return envelope('import-result',{requestId:request.requestId,snapshotId:request.snapshotId,manifestHash:request.manifestHash,descriptorHash:request.descriptorHash,
        status:'imported',reason:null,localImportId,expiresAt:bundle.admission.retained.expiresAt,resumable:false,processStarted:false,keyboardAcquired:false});
    }finally{
      signal?.removeEventListener('abort',abort);await worker?.terminate();if(stage)await rm(stage,{recursive:true,force:true});
      if(committed&&!succeeded)await rm(join(this.config.managedRoot,localImportId),{recursive:true,force:true});
      releaseMemory?.();job.close();
    }
  }
  async describe(localImportId:string):Promise<unknown>{
    if(!/^import-[a-f0-9-]{36}$/.test(localImportId))refuse();
    const raw=await readFile(join(this.config.managedRoot,localImportId,'bundle.json'),'utf8');
    if(Buffer.byteLength(raw)>8388608)refuse();const bundle=JSON.parse(raw);
    if(bundle.descriptor.expiresAt!==null&&this.now()>=bundle.descriptor.expiresAt)refuse();
    return bundle.descriptor;
  }
  /** Managed data reads keep their original deadline and independently recheck current read authority.
   * A source connection/capture lease is never needed to read an already admitted copy.
   */
  async *readData(localImportId:string,path:string,authorizationId:string,signal?:AbortSignal):AsyncGenerator<Buffer>{
    safeArchivePath(path);await this.describe(localImportId);signal?.throwIfAborted();
    const directory=join(this.config.managedRoot,localImportId),stored=JSON.parse(await readFile(join(directory,'bundle.json'),'utf8'));
    const bundle:ArchiveBundle={policy:stored.policy,manifest:stored.manifest,admission:stored.admission};
    const request=envelope('import-request',{requestId:'read-'+randomUUID(),authorizationId,retained:bundle.admission.retained,
      snapshotId:bundle.manifest.snapshotId,manifestHash:bundle.manifest.manifestHash,descriptorHash:bundle.admission.descriptorHash,
      provider:bundle.manifest.provider,mode:'isolated-data' as const});
    await this.authorized(request,bundle);signal?.throwIfAborted();
    const file=bundle.manifest.files.find(f=>f.path===path);if(!file)refuse();
    const release=this.config.budget.reserveMemory(2*Buffer.byteLength(JSON.stringify(bundle))+2097152);
    const source=import.meta.url.endsWith('.ts'),worker=new Worker(new URL(source?'./session-content-archive-worker.ts':'./session-content-archive-worker.js',import.meta.url),{
      execArgv:source?['--import',new URL('./session-content-test-loader.mjs',import.meta.url).href]:[]});
    let sequence=0,failed=false;worker.on('error',()=>{failed=true;});worker.on('exit',()=>{failed=true;});
    const abort=()=>{failed=true;void worker.terminate();};signal?.addEventListener('abort',abort,{once:true});
    const call=(operation:string,data:unknown)=>new Promise<any>((resolve,reject)=>{
      if(failed){reject(new Error('managed_read_refused'));return;}
      const id=++sequence,cleanup=()=>{worker.off('message',message);worker.off('error',error);worker.off('exit',error);};
      const error=()=>{cleanup();reject(new Error('managed_read_refused'));};
      const message=(m:{id:number;ok:boolean;result:unknown})=>{if(m.id===id){cleanup();m.ok?resolve(m.result):error();}};
      worker.on('message',message);worker.once('error',error);worker.once('exit',error);worker.postMessage({id,operation,data});
    });
    try{
      await call('initialize',{...bundle,stage:directory,now:this.now()});let offset=0;
      do{
        await this.describe(localImportId);const assertRead=await this.authorized(request,bundle);signal?.throwIfAborted();
        const part=await call('read-part',{stage:directory,path,totalBytes:file.bytes,byteOffset:offset});
        await this.describe(localImportId);signal?.throwIfAborted();assertRead();
        const bytes=Buffer.from(part.payloadB64,'base64url');offset+=bytes.length;yield bytes;
      }while(offset<file.bytes);
    }finally{signal?.removeEventListener('abort',abort);await worker.terminate();release();}
  }
}
