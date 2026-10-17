import { execFileSync } from "node:child_process";
import { mkdtempSync,readFileSync,rmSync,readdirSync,existsSync } from "node:fs";
import { createServer,type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll,afterAll,it,expect } from "vitest";
import { SessionContentAuth } from "./session-content-auth.js";
import { ArchiveBudget } from "./session-content-archive.js";
import { SessionContentImport,type ArchivePart,type ArchiveBundle,type ImportRequest } from "./session-content-import.js";
import { capsuleDirectory,envelope,type Provider } from "./session-content-contract.js";
import { contentDigest } from "./session-content-json.js";
const fixture=(name:string)=>JSON.parse(readFileSync(new URL(name+'.v2.json',capsuleDirectory),'utf8'));
let root:string,server:Server,origin:string,ca:string,bundle:ArchiveBundle,request:ImportRequest,part:ArchivePart,revoked=false;
beforeAll(async()=>{
  root=mkdtempSync(join(tmpdir(),'f2-import-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',join(root,'key'),'-out',join(root,'cert'),'-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});ca=readFileSync(join(root,'cert'),'utf8');
  server=createServer({key:readFileSync(join(root,'key')),cert:ca},(req,res)=>{
    res.setHeader('Content-Type','application/json');const end=(x:unknown)=>res.end(JSON.stringify(x));
    if(req.url==='/token'){req.resume();end({access_token:'synthetic-read-access',token_type:'Bearer',expires_in:300});return;}
    if(revoked||req.headers.authorization!=='Bearer synthetic-read-access'){res.writeHead(403);res.end('{}');return;}
    if(req.url?.includes('/authorizations/')){end(envelope('history-read',{authorizationId:'read',owner:bundle.policy.owner,authSessionRef:'read-login',retained:bundle.admission.retained,
      coverage:{kind:'native',snapshotId:bundle.manifest.snapshotId,manifestHash:bundle.manifest.manifestHash,descriptorHash:bundle.admission.descriptorHash},readExpiresAt:Math.min(Date.now()+60000,bundle.admission.retained.expiresAt??Number.MAX_SAFE_INTEGER)}));return;}
    if(req.url?.includes('/admissions/')){end(envelope('archive-admission',{admission:bundle.admission}));return;}
    res.writeHead(404);res.end('{}');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error('listener');origin='https://127.0.0.1:'+a.port;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});});
async function setup(finite=false){
  revoked=false;const policy=fixture('project-policy').policy,manifest=fixture('native-manifest'),admission=fixture('archive-admission').admission;
  policy.owner.issuer=origin;policy.destination=origin;manifest.scope.owner.issuer=origin;
  if(finite)policy.retentionByChannel.nativeHistory={mode:'duration',durationSeconds:60};
  manifest.policyDigest=contentDigest('policy',policy);const {manifestHash:_manifest,...base}=manifest;manifest.manifestHash=contentDigest('manifest',base);
  admission.policyDigest=manifest.policyDigest;admission.manifestHash=manifest.manifestHash;admission.retention=policy.retentionByChannel.nativeHistory;
  admission.retained.originScopeDigest=contentDigest('scope',manifest.scope);admission.retained.acceptedAt=Date.now()-1000;admission.retained.expiresAt=finite?admission.retained.acceptedAt+60000:null;
  const {descriptorHash:_admission,...a}=admission;admission.descriptorHash=contentDigest('archive-admission',a);
  bundle={policy,manifest,admission};part=fixture('native-part');part.scope=manifest.scope;
  request={...fixture('import-request'),retained:admission.retained,manifestHash:manifest.manifestHash,descriptorHash:admission.descriptorHash};
  const auth=new SessionContentAuth({issuer:origin,authorizeUrl:origin+'/authorize',tokenUrl:origin+'/token',clientId:'source-client',audience:'source-audience',redirectUri:'http://127.0.0.1:3210/callback',sourceServer:origin,owner:policy.owner,source:manifest.scope.source,runtime:fixture('capabilities').runtime,capabilitiesDigest:'a'.repeat(64),ca,measuredClockErrorMs:0});
  const start=auth.beginLogin(),login=await auth.completeLogin(start.handle,{code:'code',state:new URL(start.url).searchParams.get('state')!});
  const managedRoot=mkdtempSync(join(root,'managed-'));let now=Date.now();
  const importer=new SessionContentImport({managedRoot,auth,login,budget:new ArchiveBudget(),qualifiedProviders:[manifest.provider],now:()=>now});
  return {importer,managedRoot,expire:()=>{now=admission.retained.expiresAt??Number.MAX_SAFE_INTEGER;}};
}
it('should round-trip a complete synthetic archive into an isolated data directory without execution',async()=>{
  const {importer,managedRoot}=await setup();
  const result=await importer.import(request,bundle,(async function*(){yield part;})());
  expect(result).toMatchObject({status:'imported',expiresAt:null,resumable:false,processStarted:false,keyboardAcquired:false});
  expect(readFileSync(join(managedRoot,result.localImportId as string,'records/history.jsonl'))).toEqual(Buffer.from(part.payloadB64,'base64url'));
  expect(await importer.describe(result.localImportId as string)).toMatchObject({descriptorHash:bundle.admission.descriptorHash,expiresAt:null});
  expect(readdirSync(managedRoot).filter(n=>n.startsWith('.staging'))).toEqual([]);
});
it('should refuse substituted policies or admissions before reading any file part',async()=>{
  const {importer,managedRoot}=await setup();let reads=0;
  for(const change of [(b:ArchiveBundle)=>{b.policy.owner.subject='other';},(b:ArchiveBundle)=>{b.admission.snapshotId='other';},(b:ArchiveBundle)=>{b.manifest.files[0]!.path='../escape';}]){
    const altered=structuredClone(bundle);change(altered);
    await expect(importer.import(request,altered,(async function*(){reads++;yield part;})())).rejects.toThrow();
  }
  expect(reads).toBe(0);expect(readdirSync(managedRoot).filter(n=>n.startsWith('import-'))).toEqual([]);
});
it('should abort corrupt, missing and conflicting parts without any committed import or staging residue',async()=>{
  const {importer,managedRoot}=await setup();
  await expect(importer.import(request,bundle,(async function*(){yield {...part,payloadHash:'f'.repeat(64)};})())).rejects.toThrow();
  await expect(importer.import(request,bundle,(async function*(){})())).rejects.toThrow();
  await expect(importer.import(request,bundle,(async function*(){yield part;yield part;})())).rejects.toThrow();
  expect(readdirSync(managedRoot).filter(n=>n!=='.h2a-session-imports')).toEqual([]);
});
it('should recheck read revocation before commit and retain the original managed-copy expiry',async()=>{
  let s=await setup();await expect(s.importer.import(request,bundle,(async function*(){yield part;revoked=true;})())).rejects.toThrow();
  expect(readdirSync(s.managedRoot).filter(n=>n.startsWith('import-'))).toEqual([]);
  s=await setup(true);const result=await s.importer.import(request,bundle,(async function*(){yield part;})());
  expect(result.expiresAt).toBe(bundle.admission.retained.expiresAt);s.expire();await expect(s.importer.describe(result.localImportId as string)).rejects.toThrow();
});
it('should cancel an active import and refuse excess parts without leaving a committed directory',async()=>{
  let s=await setup();const cancel=new AbortController();
  await expect(s.importer.import(request,bundle,(async function*(){yield part;cancel.abort();})(),cancel.signal)).rejects.toThrow();
  expect(readdirSync(s.managedRoot).filter(n=>n!=='.h2a-session-imports')).toEqual([]);
  s=await setup();const payload=Buffer.alloc(262145).toString('base64url');
  await expect(s.importer.import(request,bundle,(async function*(){yield {...part,payloadB64:payload,byteLength:262145};})())).rejects.toThrow();
  expect(readdirSync(s.managedRoot).filter(n=>n!=='.h2a-session-imports')).toEqual([]);
});
it('should release the import slot when cancellation interrupts a stalled part iterator',async()=>{
  const {importer,managedRoot}=await setup(),cancel=new AbortController();
  const parts=(async function*(){yield part;cancel.abort();await new Promise<void>(()=>{});})();
  const start=performance.now();await expect(importer.import(request,bundle,parts,cancel.signal)).rejects.toThrow();
  expect(performance.now()-start).toBeLessThan(1000);expect(readdirSync(managedRoot).filter(n=>n!=='.h2a-session-imports')).toEqual([]);
});
it('should read admitted data with the source offline and refuse revoked or expired managed reads',async()=>{
  let s=await setup();let result=await s.importer.import(request,bundle,(async function*(){yield part;})());
  const collect=async(importer:SessionContentImport,id:string)=>{const chunks:Buffer[]=[];for await(const bytes of importer.readData(id,'records/history.jsonl','read'))chunks.push(bytes);return Buffer.concat(chunks);};
  expect(await collect(s.importer,result.localImportId as string)).toEqual(Buffer.from(part.payloadB64,'base64url'));
  revoked=true;await expect(collect(s.importer,result.localImportId as string)).rejects.toThrow();
  s=await setup(true);result=await s.importer.import(request,bundle,(async function*(){yield part;})());s.expire();await expect(collect(s.importer,result.localImportId as string)).rejects.toThrow();
});
it('should refuse unsupported provider tuples before consuming any part',async()=>{
  const {importer}=await setup();let reads=0;
  await expect(importer.import({...request,provider:{...request.provider,cliVersion:'unsupported'}},bundle,(async function*(){reads++;yield part;})())).rejects.toThrow('unsupported_format');expect(reads).toBe(0);
});
