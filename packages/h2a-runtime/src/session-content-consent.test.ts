import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, it, expect } from "vitest";
// @ts-ignore Shared confinement helper; private roots and owned child process guards.
import { setupNativeTestEnvironment, createPrivateTestDirectory } from "../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import { SessionContentAuth } from "./session-content-auth.js";
import { ConfirmationBudget, ConfirmationVerifier, confirmationNonce, type ConfirmationChallenge } from "./session-content-confirmation.js";
import { ContentFence } from "./session-content-fence.js";
import { ContentQueueBudget,SessionContentExport } from "./session-content-export.js";
import { SessionContentConsent } from "./session-content-consent.js";
import { capsuleDirectory, envelope, sha256 } from "./session-content-contract.js";
import { contentDigest, canonicalJson } from "./session-content-json.js";
import { NativeTerminalHost, readProcessStartTime } from "./native-terminal/host.js";
import { startNativeTerminalHostServer, type NativeTerminalHostServer } from "./native-terminal/server.js";
import { NativeTerminalClient } from "./native-terminal/client.js";
import { nodePtyRawSpawner, type PtyHandle } from "./pty.js";
import { NativeHistoryProvider } from "./session-content-history.js";
import { SessionContentArchiveExport } from "./session-content-archive-export.js";
import { SessionContentImport,type ArchivePart,type ArchiveBundle } from "./session-content-import.js";
import { ArchiveBudget } from "./session-content-archive.js";
const fixture=(name:string)=>JSON.parse(readFileSync(new URL(name+'.v2.json',capsuleDirectory),'utf8'));
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-only',alg:'RS256',use:'sig'};
let root:string,server:Server,origin:string,ca:string;
let policy=fixture('project-policy').policy, scope=fixture('grant-activate').scope;
let mode='valid',stored:Buffer[]=[],bodyReads=0,acks=0;
let ackBarrier: (()=>Promise<void>) | undefined;
let archiveCopy:ArchiveBundle|undefined;
let controlResponse:ServerResponse|undefined,autoProof=true,observedChallenge:unknown;
beforeAll(async()=>{
  root=mkdtempSync(join(tmpdir(),'f2-consent-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',join(root,'key'),'-out',join(root,'cert'),'-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  ca=readFileSync(join(root,'cert'),'utf8');
  server=createServer({key:readFileSync(join(root,'key')),cert:ca},(req,res)=>{
    res.setHeader('Content-Type','application/json');
    const end=(data:unknown)=>res.end(JSON.stringify(data));
    if(req.url?.endsWith('/control')){res.setHeader('Content-Type','text/event-stream');res.flushHeaders();controlResponse=res;return;}
    if(req.url?.includes('/history/authorizations/')&&archiveCopy){const a=archiveCopy.admission;end(envelope('history-read',{authorizationId:'read',owner:archiveCopy.policy.owner,authSessionRef:'login',retained:a.retained,coverage:{kind:'native',snapshotId:a.snapshotId,manifestHash:a.manifestHash,descriptorHash:a.descriptorHash},readExpiresAt:Date.now()+60000}));return;}
    if(req.url?.includes('/history/admissions/')&&archiveCopy){end(envelope('archive-admission',{admission:archiveCopy.admission}));return;}
    if(req.url?.includes('/grants/')) {
      const now=Date.now(),nonce=req.headers['x-h2a-request-nonce'];
      const renew=req.url.endsWith('/renew');
      end(envelope(renew?'grant-refresh':'grant-activate',{requestId:req.url.split('/').at(-1),requestNonce:nonce,connectionId:'connection',...(renew?{previousScope:scope,nextScope:scope,operation:'renew'}:{scope}),
        policyDigest:contentDigest('policy',policy),lease:{id:renew?'renew-lease':'lease',requestNonce:nonce,issuedAt:now,expiresAt:now+60000}}));return;
    }
    if(req.url?.includes('/policies/')) {end({...fixture('project-policy'),policy,policyDigest:contentDigest('policy',policy)});return;}
    if(req.url?.endsWith('/fragments')) {
      const h=req.headers['x-h2a-source-meta'];
      // Admission before any data listener, as required of the receiving service.
      if(mode==='refuse-ingress'||typeof h!=='string'||req.headers.authorization!=='Bearer synthetic-source') {res.writeHead(403);res.end('{}');return;}
    }
    let body='';req.on('data',c=>{body+=c; if(req.url?.endsWith('/fragments')) bodyReads+=c.length;});
    req.on('end',()=>{void (async()=>{
      if(req.url==='/token') {end({access_token:'synthetic-access',token_type:'Bearer',expires_in:300});return;}
      const input=JSON.parse(body);
      if(req.url?.endsWith('/challenges')){observedChallenge=input;
        if(autoProof)controlResponse?.write('data: '+JSON.stringify(envelope('confirmation-proof',{challengeId:input.challenge.id,challengeDigest:input.challengeDigest,idToken:proof(input.challenge)}))+'\n\n');
        end(input);return;}
      if(req.url?.endsWith('/source/sessions') || req.url?.endsWith('/source/sessions/source-session/renew')) {
        const now=Date.now();end(envelope('source-session',{requestId:input.requestId,requestNonce:input.requestNonce,sourceSessionId:'source-session',sourceToken:'synthetic-source',owner:{issuer:origin,subject:'synthetic-owner'},authSessionRef:'login',authSessionVersion:1,authSessionExpiresAt:now+300000,source:scope.source,connectionId:'connection',issuedAt:now,expiresAt:now+60000,operations:['source-control','content-upload','source-ack']}));return;
      }
      if(req.url?.endsWith('/acks')) {
        acks++;await ackBarrier?.();end(envelope('control-result',{requestId:input.requestId,requestDigest:input.requestDigest,sourceAckDigest:mode==='wrong-ack'?'0'.repeat(64):contentDigest('ack',input),connectionId:'connection',status:'committed',reason:null}));return;
      }
      if(req.url?.endsWith('/fragments')) {
        const meta=JSON.parse(Buffer.from(req.headers['x-h2a-source-meta'] as string,'base64url').toString());
        if(meta.bodyHash!==sha256(body)||meta.bodyBytes!==Buffer.byteLength(body)) throw Error('body mismatch');
        stored.push(Buffer.from(input.payloadB64,'base64url'));
        end(envelope('ingest-ack',{requestId:meta.requestId,scopeDigest:contentDigest('scope',scope),connectionId:'connection',status:'accepted',coverage:{kind:'terminal',cursor:{scopeDigest:contentDigest('scope',scope),connectionId:'connection',channel:input.channel,rawSeq:input.rawSeq,byteOffset:input.byteOffset+input.byteLength}},retained:null,archiveAdmission:null,reason:null}));return;
      }
      res.writeHead(404);res.end('{}');
    })().catch(()=>{res.writeHead(500);res.end('{}');});});
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); const address=server.address();
  if(!address||typeof address==='string')throw Error('listener');origin='https://127.0.0.1:'+address.port;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});});
async function setup(monotonicNow?:()=>number,history?:NativeHistoryProvider){
  mode='valid';stored=[];bodyReads=0;acks=0;ackBarrier=undefined;autoProof=true;observedChallenge=undefined;
  policy=fixture('project-policy').policy;policy.owner.issuer=origin;policy.destination=origin;policy.channels.nativeHistory=false;policy.history={mode:'none',selected:[]};
  scope=fixture('grant-activate').scope;scope.owner.issuer=origin;scope.sessionIncarnation='11111111-1111-4111-8111-111111111111';
  const auth=new SessionContentAuth({issuer:origin,authorizeUrl:origin+'/authorize',tokenUrl:origin+'/token',clientId:'source-client',audience:'source-audience',redirectUri:'http://127.0.0.1:3210/callback',sourceServer:origin,owner:policy.owner,source:scope.source,runtime:fixture('capabilities').runtime,capabilitiesDigest:'a'.repeat(64),ca,measuredClockErrorMs:0,...(monotonicNow?{monotonicNow}:{})});
  const begin=auth.beginLogin(),login=await auth.completeLogin(begin.handle,{code:'code',state:new URL(begin.url).searchParams.get('state')!}),sourceSession=await auth.openSource(login);
  const fenceRoot=mkdtempSync(join(root,'fence-'));
  const verifier=new ConfirmationVerifier({issuer:origin,clientId:'confirmation-client',tenantId:scope.project.tenantId,subject:scope.owner.subject,source:scope.source,keys:[jwk],measuredClockErrorMs:0,budget:new ConfirmationBudget()});
  const fence=new ContentFence(fenceRoot),budget=new ContentQueueBudget();
  const makeSession=(sessionId:string,sessionIncarnation:string)=>new SessionContentConsent({auth,sourceSession,verifier,fence,budget,sessionId,sessionIncarnation,project:scope.project,...(monotonicNow?{monotonicNow}:{}),...(history?{history}:{})});
  const consent=makeSession(scope.sessionId,scope.sessionIncarnation);
  return {consent,auth,sourceSession,login,makeSession,budget};
}
function proof(challenge:ConfirmationChallenge){
  const now=Math.floor(Date.now()/1000),h=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
  const c=Buffer.from(JSON.stringify({iss:origin,sub:challenge.owner.subject,tenantId:challenge.project.tenantId,aud:challenge.clientId,nonce:confirmationNonce(challenge),acr:'urn:sentropic:loa:passkey-fresh',amr:['hwk','user','mfa'],exp:now+60,iat:now,auth_time:now})).toString('base64url');
  return h+'.'+c+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+c),privateKey).toString('base64url');
}
it('should keep actual native PTY refusal at zero content bytes then export only the post-ACK sentinel',async()=>{
  const {consent,budget}=await setup();let pty:PtyHandle|undefined,local='',exited=false;
  const saturated:SessionContentExport[]=[];
  const socketRoot=createPrivateTestDirectory('c-'); let hostServer:NativeTerminalHostServer|undefined,client:NativeTerminalClient|undefined;
  const host=new NativeTerminalHost({generation:'generation',registryPath:join(root,'registry.json'),replayBytesPerSession:4096,
    contentFactory:()=>consent,spawner:options=>{pty=nodePtyRawSpawner(options);pty.onData(d=>{local+=d;});pty.onExit(()=>{exited=true;});return pty;},
    reaper:{killGroup:()=>{throw Error('unexpected signal');},isGroupAlive:pgid=>{if(pgid!==pty?.pgid)throw Error('unowned pid');try{process.kill(-pgid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;return false;}},describeGroup:()=>''},readLeaderStartTime:pid=>{if(pid!==process.pid&&pid!==pty?.pid)throw Error('unowned pid');return readProcessStartTime(pid);},
    findGroupMemberToken:()=>false,groupIsOnlyZombies:()=>false});
  const wait=async(text:string)=>{const until=performance.now()+2000;while(!local.includes(text)){if(performance.now()>=until)throw Error('missing PTY witness');await new Promise(r=>setTimeout(r,5));}};
  try{
    host.create({id:'session',launchFence:{generation:'generation',incarnation:'11111111-1111-4111-8111-111111111111'},command:process.execPath,args:['-e',"process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('BEFORE_F2_SENTINEL\\n');process.stdout.write(Buffer.from([0xe2]));process.stdin.on('data',x=>{if(x.toString()==='q')process.exit(0);if(x.toString()==='a')process.stdout.write(Buffer.from([0x82,0xac]));process.stdout.write(x.toString()==='s'?'SATURATED_F2_SENTINEL\\n':'AFTER_F2_SENTINEL\\n')})"],cwd:root,env:{...process.env} as Record<string,string>,cols:80,rows:24});
    hostServer=await startNativeTerminalHostServer({socketPath:join(socketRoot,'s'),host});
    client=await NativeTerminalClient.connect(join(socketRoot,'s'));
    expect((await client.ping()).content).toBe('h2a.session-content/2');
    await wait('BEFORE_F2_SENTINEL');expect(await client.contentFlush('session','terminal.live')).toBe(false);
    expect(consent.counters.sourceContentReads).toBe(0);expect(consent.counters.contentSubscriptions).toBe(0);expect(consent.counters.serializedContentBytes).toBe(0);expect(bodyReads).toBe(0);expect(stored).toEqual([]);
    const challenge=await client.contentPrepare('session','proposal') as ConfirmationChallenge;consent.onRaw('\u001b[?1049');
    expect(await consent.flush('terminal.live')).toBe(false);
    await client.contentConfirm('session',proof(challenge));expect(consent.counters.contentSubscriptions).toBe(1);pty!.write('a');await wait('AFTER_F2_SENTINEL');
    while(await client.contentFlush('session','terminal.live')){}
    const outbound=Buffer.concat(stored).toString();expect(outbound).toContain('AFTER_F2_SENTINEL');expect(outbound).not.toContain('BEFORE_F2_SENTINEL');expect(outbound).not.toContain('1049');expect(outbound).not.toContain('€');expect(local).toContain('€');
    for(let i=0;i<4;i++){const queue=new SessionContentExport(budget);queue.reset(1);expect(queue.admit(1,'x'.repeat(1048576))).toBe(true);saturated.push(queue);}
    const ioStart=performance.now();pty!.write('s');await wait('SATURATED_F2_SENTINEL');expect(performance.now()-ioStart).toBeLessThan(1000);
    const before=bodyReads;const started=performance.now();await client.contentExclude('session');expect(performance.now()-started).toBeLessThan(1000);
    expect(consent.counters.contentSubscriptions).toBe(0);
    pty!.write('a');await new Promise(r=>setTimeout(r,20));expect(await consent.flush('terminal.live')).toBe(false);expect(bodyReads).toBe(before);
    expect(local).toContain('BEFORE_F2_SENTINEL');expect(host.readOutput('session',0).chunks.length).toBeGreaterThan(0);
    pty!.write('q');const until=performance.now()+2000;while(!exited){if(performance.now()>until)throw Error('PTY did not exit');await new Promise(r=>setTimeout(r,5));}
  }finally{for(const queue of saturated)queue.clear();client?.close();await hostServer?.close();if(pty&&!exited){const end=new Promise<void>(resolve=>pty!.onExit(()=>resolve()));pty.kill('SIGKILL');await end;}rmSync(socketRoot,{recursive:true,force:true});}
});
it('should refuse forged confirmation and let exclusion win while an activation ACK is pending',async()=>{
  const {consent}=await setup();const ch=await consent.prepare('proposal');
  await expect(consent.confirm('forged')).rejects.toThrow();expect(acks).toBe(0);
  let release!:()=>void,arrived!:()=>void;const seen=new Promise<void>(r=>{arrived=r;});
  ackBarrier=()=>{arrived();return new Promise<void>(r=>{release=r;});};
  const activation=consent.confirm(proof(ch));await seen;
  consent.onRaw('STAGED_SECRET');expect(consent.counters.sourceContentReads).toBe(0);
  consent.exclude();release();await expect(activation).rejects.toThrow();
  consent.onRaw('EXCLUDED_SECRET');expect(consent.reserve()).toBeNull();expect(bodyReads).toBe(0);expect(stored).toEqual([]);
  consent.clearExclusion();expect(consent.status().state).toBe('off');expect(consent.reserve()).toBeNull();
});
it('should refuse a mismatched ACK and discard queued bytes on lost source authority',async()=>{
  let {consent}=await setup();let ch=await consent.prepare('proposal');mode='wrong-ack';await expect(consent.confirm(proof(ch))).rejects.toThrow();
  consent.onRaw('UNCOMMITTED');expect(consent.reserve()).toBeNull();
  const second=await setup();consent=second.consent;ch=await consent.prepare('proposal');await consent.confirm(proof(ch));
  consent.onRaw('queued');second.auth.invalidate(second.sourceSession);expect(consent.reserve()).toBeNull();expect(consent.status().state).toBe('paused');expect(bodyReads).toBe(0);
});
it('should keep the old lease deadline until the exact renewal ACK commits',async()=>{
  let mono=0;const {consent}=await setup(()=>mono);const ch=await consent.prepare('proposal');await consent.confirm(proof(ch));
  const boundary=consent.status().startAfterSeq;mono=20000;await consent.renew('renew');expect(consent.status().state).toBe('active');expect(consent.status().startAfterSeq).toBe(boundary);
  let release!:()=>void,arrived!:()=>void;const seen=new Promise<void>(r=>{arrived=r;});ackBarrier=()=>{arrived();return new Promise<void>(r=>{release=r;});};
  const renewed=consent.renew('renew');await seen;mono=80000;consent.onRaw('EXPIRED');release();await expect(renewed).rejects.toThrow();
  expect(consent.status().state).toBe('paused');expect(consent.reserve()).toBeNull();expect(bodyReads).toBe(0);
});
it('should export and import an exact synthetic checkpoint only after native confirmation and committed activation',async()=>{
  const work=mkdtempSync(join(root,'history-')),sourceFile=join(work,'source.jsonl'),bytes=Buffer.from('{"type":"user","text":"inert history"}\n');writeFileSync(sourceFile,bytes);
  const provider=fixture('native-manifest').provider,history=new NativeHistoryProvider({project:fixture('project-policy').policy.project,provider,qualifiedProviders:[provider],catalog:[{lineageId:'lineage',checkpointId:'checkpoint',companions:[],files:[{path:'records/history.jsonl',localPath:sourceFile,role:'records'}]}]});
  const {consent,auth,login}=await setup(undefined,history),budget=new ArchiveBudget(),exporter=new SessionContentArchiveExport({workRoot:work,budget});
  policy.channels.nativeHistory=true;policy.history=fixture('project-policy').policy.history;
  let egress=0;const received:ArchivePart[]=[];
  const sink=async(_manifest:unknown,parts:AsyncIterable<ArchivePart>)=>{for await(const p of parts){received.push(p);egress+=p.byteLength;}};
  await expect(exporter.export(consent,sink)).rejects.toThrow();const ch=await consent.prepare('proposal');await expect(exporter.export(consent,sink)).rejects.toThrow();expect(egress).toBe(0);
  await consent.confirm(proof(ch));const manifest=await exporter.export(consent,sink);expect(egress).toBe(bytes.length);expect(manifest.complete).toBe(true);
  const retained={retainedId:'retained-export',originScopeDigest:contentDigest('scope',manifest.scope),acceptedAt:Date.now(),expiresAt:null};
  const base={archive:'h2a.session-archive/1' as const,snapshotId:manifest.snapshotId,manifestHash:manifest.manifestHash,policyDigest:manifest.policyDigest,channel:'nativeHistory' as const,retention:policy.retentionByChannel.nativeHistory,retained};
  archiveCopy={policy:structuredClone(policy),manifest,admission:{...base,descriptorHash:contentDigest('archive-admission',base)}};
  const managedRoot=mkdtempSync(join(root,'roundtrip-')),importer=new SessionContentImport({managedRoot,auth,login,budget,qualifiedProviders:[provider]});
  const result=await importer.import(envelope('import-request',{requestId:'import-export',authorizationId:'read',retained,snapshotId:manifest.snapshotId,manifestHash:manifest.manifestHash,descriptorHash:archiveCopy.admission.descriptorHash,provider,mode:'isolated-data' as const}),archiveCopy,(async function*(){yield*received;})());
  expect(result).toMatchObject({status:'imported',processStarted:false,keyboardAcquired:false,resumable:false});expect(readFileSync(join(managedRoot,result.localImportId as string,'records/history.jsonl'))).toEqual(bytes);
  // An append after the metadata bookmark cannot silently produce another complete checkpoint.
  appendFileSync(sourceFile,'{"type":"user","text":"late"}\n');let sent=false;
  await expect(exporter.export(consent,async()=>{sent=true;})).rejects.toThrow();expect(sent).toBe(false);expect(readdirSync(work).some(n=>n.startsWith('.export-'))).toBe(false);
});
it('should inherit only a natively committed future policy and require fresh inclusion after clearing exclusion',async()=>{
  const {consent,makeSession}=await setup(),existing=makeSession('existing','existing-incarnation');
  policy.sessions.future=true;const parentScope=structuredClone(scope),ch=await consent.prepare('parent');await consent.confirm(proof(ch));
  const child=makeSession('future','future-incarnation');scope={...parentScope,sessionId:'future',sessionIncarnation:'future-incarnation'};
  child.onRaw('BEFORE_CHILD');await child.applyAcceptedPolicy('future');child.onRaw('AFTER_CHILD');
  const reservation=child.reserve()!;expect(reservation.bytes.toString()).toBe('AFTER_CHILD');child.commit(reservation);
  child.exclude();child.clearExclusion();await expect(child.applyAcceptedPolicy('future')).rejects.toThrow('unconfirmed_policy');
  scope={...parentScope,sessionId:'existing',sessionIncarnation:'existing-incarnation'};
  await expect(existing.applyAcceptedPolicy('existing')).rejects.toThrow('unconfirmed_policy');
  scope=parentScope;consent.disconnect();consent.onRaw('OUTAGE_SECRET');await consent.applyAcceptedPolicy('reconnect');
  expect(consent.reserve()).toBeNull();expect(consent.status().state).toBe('active');
});
it('should run signed native confirmation through a real metadata SSE stream and pause on disconnection',async()=>{
  const {consent}=await setup(),control=consent.connectControl();
  const wait=async(predicate:()=>boolean)=>{const until=performance.now()+2000;while(!predicate()){if(performance.now()>=until)throw Error('missing control witness');await new Promise(r=>setTimeout(r,5));}};
  try{
    await control.ready;controlResponse!.write('data: '+JSON.stringify({...fixture('grant-activate'),requestId:'proposal',scope})+'\n\n');
    await wait(()=>consent.status().state==='active');expect(observedChallenge).toBeTruthy();consent.onRaw('SSE_POST_CONFIRMATION');
    expect(await consent.flush('terminal.live')).toBe(true);expect(Buffer.concat(stored).toString()).toBe('SSE_POST_CONFIRMATION');
    control.close();consent.onRaw('OFFLINE_SECRET');expect(consent.reserve()).toBeNull();expect(consent.status().state).toBe('paused');
  }finally{control.close();}
});
it('should keep metadata revocation reachable while a source confirmation is pending',async()=>{
  const {consent}=await setup();autoProof=false;const control=consent.connectControl();
  const wait=async(predicate:()=>boolean)=>{const until=performance.now()+2000;while(!predicate()){if(performance.now()>=until)throw Error('missing pending control witness');await new Promise(r=>setTimeout(r,5));}};
  try{
    await control.ready;controlResponse!.write('data: '+JSON.stringify({...fixture('grant-activate'),requestId:'proposal',scope})+'\n\n');await wait(()=>!!observedChallenge);
    controlResponse!.write('data: '+JSON.stringify(envelope('content-revoke',{requestId:'exclude',connectionId:'connection',target:{kind:'session',scope},effect:'capture',denyRevision:1,reason:'excluded'}))+'\n\n');
    await wait(()=>consent.status().state==='denied');consent.onRaw('DENIED_SECRET');expect(consent.reserve()).toBeNull();expect(bodyReads).toBe(0);expect(acks).toBe(0);
  }finally{control.close();}
});
