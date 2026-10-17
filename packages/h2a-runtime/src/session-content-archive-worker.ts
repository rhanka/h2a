/** Bounded data-only worker. Never imports process launch, restore, keyboard or provider execution APIs. */
import { parentPort } from "node:worker_threads";
import { createHash, type Hash } from "node:crypto";
import { openSync, closeSync, writeSync, readSync, fsyncSync, mkdirSync, readFileSync, fstatSync, unlinkSync, constants } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseStrictJson } from "./session-content-json.js";
import { dirname, join } from "node:path";
import { validateArchiveBinding, safeArchivePath } from "./session-content-archive.js";
import { validateContentMessage, envelope, same, sha256, type Manifest, type Policy, type ArchiveAdmission } from "./session-content-contract.js";
let manifest:Manifest,policy:Policy,admission:ArchiveAdmission,stage:string;
let index=0,offset=0,fd:number|null=null,hash:Hash|null=null;
const directories=new Set<string>();
function close():void {if(fd!==null){closeSync(fd);fd=null;}hash=null;}
function refuse():never{throw new Error('archive_worker_refused');}
parentPort!.on('message',(message:{id:number;operation:string;data:any})=>{
  try {
    const d=message.data;
    if(message.operation==='snapshot'){
      const outcomes=[];let processed=0;const positions=new Map<string,number>();const cancelled=new Int32Array(d.cancellation);
      const check=()=>{if(Atomics.load(cancelled,0)!==0||performance.now()>=d.deadline)refuse();};
      for(const file of d.files){
        check();const input=openSync(file.localPath,constants.O_RDONLY|constants.O_NOFOLLOW);
        let output:number|null=null;
        try{
          const identity=()=>{const s=fstatSync(input,{bigint:true});if(!s.isFile()||s.nlink!==1n)refuse();return {dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};};
          if(!same(identity(),file.identity))refuse();
          const path=join(d.stage,safeArchivePath(file.path));mkdirSync(dirname(path),{recursive:true,mode:0o700});output=openSync(path,'wx',0o600);
          const buffer=Buffer.alloc(262144),digest=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let position=0,tail='',records=0,writtenBytes=0,firstLine=true;
          const selection=d.selections.find((s:any)=>s.lineageId===file.lineageId);
          const write=(bytes:Buffer)=>{digest.update(bytes);let n=0;while(n<bytes.length)n+=writeSync(output!,bytes,n,bytes.length-n);writtenBytes+=bytes.length;};
          while(position<Number(file.identity.size)){
            check();const length=readSync(input,buffer,0,Math.min(buffer.length,Number(file.identity.size)-position),position);if(!length)refuse();processed+=length;if(processed>268435456)refuse();
            const bytes=buffer.subarray(0,length);
            if(file.role==='records'){
              tail+=decoder.decode(bytes,{stream:true});let newline:number;
              while((newline=tail.indexOf('\n'))>=0){const line=tail.slice(0,newline);tail=tail.slice(newline+1);if(!line||line.length>262144)refuse();const record=parseStrictJson(firstLine&&line.charCodeAt(0)===0xfeff?line.slice(1):line,262144);firstLine=false;if(!record||typeof record!=='object'||Array.isArray(record))refuse();const recordIndex=positions.get(file.lineageId)??0;positions.set(file.lineageId,recordIndex+1);if(selection?.fromRecord==null||(recordIndex>=selection.fromRecord&&recordIndex<=selection.toRecord)){write(Buffer.from(line+'\n'));records++;}}
              if(tail.length>262144)refuse();
            }
            if(file.role!=='records')write(bytes);position+=length;
          }
          if(file.role==='records'&&tail+decoder.decode()!=='')refuse();
          if(!same(identity(),file.identity))refuse();fsyncSync(output);
          if(file.role==='records'&&records===0){closeSync(output);output=null;unlinkSync(path);continue;}
          outcomes.push({path:file.path,role:file.role,bytes:writtenBytes,sha256:digest.digest('hex'),lineageId:file.lineageId,records});
        }finally{closeSync(input);if(output!==null)closeSync(output);}
      }
      for(const selection of d.selections){const count=positions.get(selection.lineageId)??0;if(count===0||(selection.toRecord!==null&&selection.toRecord>=count))refuse();}
      check();parentPort!.postMessage({id:message.id,ok:true,result:outcomes});return;
    }else if(message.operation==='read-part'){
      const input=openSync(join(d.stage,safeArchivePath(d.path)),constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const stat=fstatSync(input);
        if(!stat.isFile()||stat.nlink!==1||stat.size!==d.totalBytes||d.byteOffset<0||d.byteOffset>d.totalBytes
          || (manifest&&!manifest.files.some(f=>f.path===d.path&&f.bytes===d.totalBytes)))refuse();
        const length=Math.min(262144,d.totalBytes-d.byteOffset),bytes=Buffer.alloc(length);
        if(readSync(input,bytes,0,length,d.byteOffset)!==length)refuse();
        const result={byteOffset:d.byteOffset,byteLength:length,totalBytes:d.totalBytes,payloadB64:bytes.toString('base64url'),payloadHash:sha256(bytes),final:d.byteOffset+length===d.totalBytes};
        parentPort!.postMessage({id:message.id,ok:true,result});return;
      }finally{closeSync(input);}
    }else if(message.operation==='initialize') {
      policy=d.policy;manifest=d.manifest;admission=d.admission;stage=d.stage;
      validateArchiveBinding(policy,manifest,admission,d.now);index=0;offset=0;
    }else if(message.operation==='part'){
      const part=d.part,bytes=Buffer.from(d.bytes);
      validateContentMessage({...part,payloadB64:bytes.toString('base64url')});
      if(bytes.length>262144 || bytes.length!==part.byteLength || sha256(bytes)!==part.payloadHash
        || !same(part.scope,manifest.scope) || part.connectionId!==manifest.connectionId || part.leaseId!==manifest.leaseId
        || part.snapshotId!==manifest.snapshotId || part.kind!=='native-part' || part.protocolVersion!==2 || part.protocol!=='h2a.session-content') refuse();
      const file=manifest.files[index];if(!file || file.sha256!==part.fileSha256 || file.bytes!==part.totalBytes || offset!==part.byteOffset
        || offset+bytes.length>file.bytes || part.final!==(offset+bytes.length===file.bytes)) refuse();
      if(fd===null){const path=join(stage,safeArchivePath(file.path));mkdirSync(dirname(path),{recursive:true,mode:0o700});
        let directory=dirname(path);while(directory!==stage){directories.add(directory);directory=dirname(directory);}directories.add(stage);
        fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);hash=createHash('sha256');}
      let written=0;while(written<bytes.length)written+=writeSync(fd,bytes,written,bytes.length-written);
      hash!.update(bytes);offset+=bytes.length;
      if(part.final){if(hash!.digest('hex')!==file.sha256)refuse();fsyncSync(fd);close();index++;offset=0;}
    }else if(message.operation==='finish'){
      if(fd!==null || index!==manifest.files.length)refuse();
      validateArchiveBinding(policy,manifest,admission,d.now);
      const descriptor={...d.descriptor,expiresAt:admission.retained.expiresAt};
      const out=openSync(join(stage,'bundle.json'),'wx',0o600);
      try{const bytes=Buffer.from(JSON.stringify({policy,manifest,admission,descriptor}));let n=0;while(n<bytes.length)n+=writeSync(out,bytes,n,bytes.length-n);fsyncSync(out);}finally{closeSync(out);}
      for(const path of [...directories].sort((a,b)=>b.length-a.length)){const dir=openSync(path,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
    }else if(message.operation==='abort'){close();}
    else refuse();
    parentPort!.postMessage({id:message.id,ok:true});
  }catch{close();parentPort!.postMessage({id:message.id,ok:false});}
});
