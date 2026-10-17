import { mkdtempSync, writeFileSync, openSync, ftruncateSync, closeSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { NativeHistoryProvider, type HistoryCatalogEntry } from './session-content-history.js';
import { SessionContentArchiveExport } from './session-content-archive-export.js';
import { SessionContentConsent } from './session-content-consent.js';
import { ArchiveBudget } from './session-content-archive.js';
import { capsuleDirectory, type Policy } from './session-content-contract.js';
const fixture=(n:string)=>JSON.parse(readFileSync(new URL(n+'.v2.json',capsuleDirectory),'utf8'));
async function run(root:string,files:HistoryCatalogEntry['files'],range?:{fromRecord:number;toRecord:number}){
  const policy=fixture('project-policy').policy as Policy, scope=fixture('grant-activate').scope,provider=fixture('native-manifest').provider;
  policy.history=range?{mode:'selected',selected:[{lineageId:'lineage',checkpointId:'checkpoint',...range}]}:{mode:'existing-at-activation',selected:[]};
  const history=new NativeHistoryProvider({project:policy.project,provider,qualifiedProviders:[provider],catalog:[{lineageId:'lineage',checkpointId:'checkpoint',companions:[],files}]}),bookmark=await history.stage(policy);
  const permission={policy,scope,lease:fixture('grant-activate').lease,connectionId:'connection',provider:history,bookmark,signal:new AbortController().signal,deadline:performance.now()+60000,valid:()=>true};
  const consent={nativeHistory:()=>permission} as unknown as SessionContentConsent;
  const received:Buffer[]=[];let bytes=0;
  const manifest=await new SessionContentArchiveExport({workRoot:root,budget:new ArchiveBudget()}).export(consent,async(_m,parts)=>{
    for await(const part of parts){bytes+=part.byteLength;if(part.totalBytes<1024)received.push(Buffer.from(part.payloadB64,'base64url'));}
  });
  expect(readdirSync(root).some(n=>n.startsWith('.export-'))).toBe(false);
  return {manifest,bookmark,bytes,received};
}
it('should export more than 128 MiB within the unchanged 256 MiB archive budget',async()=>{
  const root=mkdtempSync(join(tmpdir(),'f2-large-'));
  try{
    writeFileSync(join(root,'records'),'{"n":0}\n');const files:HistoryCatalogEntry['files']=[{path:'records/a.jsonl',localPath:join(root,'records'),role:'records'}];
    for(let i=0;i<3;i++){const localPath=join(root,'blob'+i),fd=openSync(localPath,'wx');try{ftruncateSync(fd,45*1024*1024);}finally{closeSync(fd);}files.push({path:'artifacts/blob'+i+'.bin',localPath,role:'artifact'});}
    const {bytes,manifest}=await run(root,files);expect(bytes).toBe(135*1024*1024+8);expect(manifest.complete).toBe(true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('should freeze existing lineage selectors without reading or hashing their content',async()=>{
  const root=mkdtempSync(join(tmpdir(),'f2-bookmark-'));
  try{writeFileSync(join(root,'records'),'not content to parse before consent');
    const policy=fixture('project-policy').policy as Policy,provider=fixture('native-manifest').provider;policy.history={mode:'existing-at-activation',selected:[]};
    const history=new NativeHistoryProvider({project:policy.project,provider,qualifiedProviders:[provider],catalog:[{lineageId:'lineage',checkpointId:'checkpoint',companions:[],files:[{path:'records/a.jsonl',localPath:join(root,'records'),role:'records'}]}]});
    const bookmark=await history.stage(policy);
    expect(bookmark.selections).toEqual([{lineageId:'lineage',checkpointId:'checkpoint',fromRecord:null,toRecord:null}]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('should export the inclusive selected record range across ordered files and ignore artifact record counts',async()=>{
  const root=mkdtempSync(join(tmpdir(),'f2-range-'));
  try{
    writeFileSync(join(root,'a'),'{"n":0}\n{"n":1}\n');writeFileSync(join(root,'b'),'{"n":2}\n{"n":3}\n');writeFileSync(join(root,'blob'),'opaque');
    const files:HistoryCatalogEntry['files']=[{path:'records/b.data',localPath:join(root,'b'),role:'records'},{path:'artifacts/blob.bin',localPath:join(root,'blob'),role:'artifact'},{path:'records/a.data',localPath:join(root,'a'),role:'records'}];
    const {manifest,received}=await run(root,files,{fromRecord:1,toRecord:2});expect(manifest.ranges[0]).toMatchObject({fromRecord:1,toRecord:2});
    expect(Buffer.concat(received).toString()).toBe('opaque{"n":1}\n{"n":2}\n');
    await expect(run(root,files,{fromRecord:3,toRecord:7})).rejects.toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});

it('should preserve exact UTF-8 source bytes including an initial BOM in exported records',async()=>{
 const root=mkdtempSync(join(tmpdir(),'f2-exact-'));
 try{const bytes=Buffer.from('\ufeff{"text":"é €"}\r\n');writeFileSync(join(root,'records'),bytes);
   const {received}=await run(root,[{path:'records/a.jsonl',localPath:join(root,'records'),role:'records'}]);expect(Buffer.concat(received)).toEqual(bytes);
 }finally{rmSync(root,{recursive:true,force:true});}
});
