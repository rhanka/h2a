import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeHash, signCanonical, createReplayGuard } from "@sentropic/h2a";
import { createLocalStore, acceptDriveInstruction, formatSignedDriveInstruction } from "../dist/index.js";

const scope = {action:"drive.instruction", direction:"from->to"};
function keys() {
  const k = generateKeyPairSync("ed25519");
  return {privateKeyPem:k.privateKey.export({format:"pem",type:"pkcs8"}).toString(), publicKeyPem:k.publicKey.export({format:"pem",type:"spki"}).toString()};
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(),"drive-consent-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const store = createLocalStore({root});
  const a=keys(), b=keys(), now=Date.now();
  for (const [id,k] of [["codex:a",a],["codex:b",b]]) store.registerInstance({id,instance:id,roles:["AGENTS"],scopes:[id],capabilities:[],endpoints:[],publicKeys:[k.publicKeyPem],acceptedPolicies:[],createdAt:new Date(now).toISOString()});
  return {root,store,a,b,now};
}

import { appendJournalEntry, createJournalEntry } from '@sentropic/h2a';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createMcpServer, authorizeDrive, verifyDriveOnReceive, remoteDriveServerForStore } from '../dist/index.js';
import { remoteDriveRejectionStatus } from '../dist/runtime/drive/index.js';
import { negotiationJournalFile } from '../dist/runtime/local-files/paths.js';
import { consentPairId, DRIVE_CONSENT_MAX_GRANT_MS, DRIVE_CONSENT_MAX_ANSWER_MS } from '../dist/runtime/drive/consent.js';

const A='codex:a',B='codex:b';
const iso=n=>new Date(n).toISOString();
function register(store,id,k,extra={}){store.registerInstance({id,instance:id,roles:['AGENTS'],scopes:[id],capabilities:[],endpoints:[],publicKeys:[k.publicKeyPem],acceptedPolicies:[],createdAt:iso(Date.now()),...extra});}
function rewriteRegistration(f,id,extra){writeFileSync(f.store.paths.instances,f.store.listInstances().map(r=>JSON.stringify(r.id===id?{...r,...extra}:r)).join('\n')+'\n');}
function bodies(f,{from=A,to=B,created=f.now,answer=created+900000,end=created+3600000,principal}={}){
  const a=f.store.findInstance(from),b=f.store.findInstance(to);
  const binding={from,to,...(a?.agentUuid?{fromAgentUuid:a.agentUuid}:{}),...(b?.agentUuid?{toAgentUuid:b.agentUuid}:{})};
  const request={kind:'h2a.drive.consent.request',v:1,requestId:randomUUID(),...binding,scope,createdAt:iso(created),answerBy:iso(answer),requestedNotAfter:iso(end)};
  const grant={kind:'h2a.drive.consent.grant',v:1,requestId:request.requestId,requestHash:computeHash(request),...binding,scope,notBefore:iso(created),notAfter:iso(end),issuedAt:iso(created),...(principal!==undefined?{principal}:{})};
  return {request,grant};
}
function event(f,p,k,by,extra={}){return {id:randomUUID(),type:p.kind.endsWith('request')?'propose':p.kind.endsWith('refusal')?'reject':p.kind.endsWith('revocation')?'withdraw':'accept',actor:{instance:by,role:'AGENTS',scope:'drive-consent'},negotiationId:consentPairId(p.from,p.to),createdAt:iso(p.issuedAt ? Date.parse(p.issuedAt) : p.createdAt ? Date.parse(p.createdAt) : f.now),body:{kind:p.kind,payload:p,signature:signCanonical(p,{by,privateKeyPem:k.privateKeyPem}),...extra}};}
// Adversarial disk fixture bypasses writer hygiene to exercise the reader.
function raw(f,e){const file=negotiationJournalFile(f.store.paths,e.negotiationId);mkdirSync(join(file,'..'),{recursive:true});const entries=f.store.readNegotiationJournal(e.negotiationId);const prev=entries.at(-1);appendFileSync(file,JSON.stringify(prev?appendJournalEntry(prev,e):createJournalEntry(e))+'\n');}
function seed(f,opts={}){const p=bodies(f,opts);raw(f,event(f,p.request,f.a,p.request.from));raw(f,event(f,p.grant,opts.to===A?f.a:f.b,p.grant.to));return p;}
function negative(p,kind,now){return {kind:'h2a.drive.consent.'+kind,v:1,from:p.request.from,to:p.request.to,requestId:p.request.requestId,requestHash:computeHash(p.request),at:iso(now)};}
async function receive(f,{now=f.now,from=A,to=B,key=f.a,store=f.store}={}){let count=0;const line=formatSignedDriveInstruction({from,to,instruction:'perform approved pair work',privateKeyPem:key.privateKeyPem,at:iso(now)});const result=await acceptDriveInstruction(line,{store,now,guard:createReplayGuard(),expectedTo:to,inject:()=>{count++;return true;}});assert.equal(count,result.ok?1:0);return result;}
function rpc(server,name,args){const result=server.callTool('h2a_drive_consent_'+name,args);assert.equal(result.isError,undefined,result.content[0].text);return JSON.parse(result.content[0].text);}
function server(f,instance,k){const s=createMcpServer({root:f.root,store:f.store,sendContext:k?{instance,privateKeyPem:k.privateKeyPem}:undefined});return s;}

for(const state of ['absent','pending','refused','expired','revoked']) for(const path of ['self','conductor','principal','mandate','agents-only','no-shared-scope','missing-from','missing-to','missing-both']) test(`legacy_authorization_paths_are_unchanged_by_consent: ${path}/${state}`,async t=>{
  const f=fixture(t);let from=A,to=path==='self'?A:B;
  if(path==='conductor')rewriteRegistration(f,B,{conductor:A});
  if(path==='principal')rewriteRegistration(f,B,{principal:A});
  if(path==='mandate'||path==='no-shared-scope')rewriteRegistration(f,A,{roles:['PRINCIPAL'],scopes:['shared']});
  if(path==='mandate'||path==='agents-only')rewriteRegistration(f,B,{scopes:path==='agents-only'?[A]:['shared']});
  if(state!=='absent'){
    const p=bodies(f,{from,to,created:state==='expired'?f.now-7200000:f.now,answer:state==='expired'?f.now-3600000:f.now+900000,end:state==='expired'?f.now-1:f.now+3600000});
    raw(f,event(f,p.request,f.a,from));
    if(state==='refused'||state==='revoked')raw(f,event(f,negative(p,state==='refused'?'refusal':'revocation',f.now),to===A?f.a:f.b,to));
  }
  if(path.startsWith('missing')){const remove=path==='missing-both'?[A,B]:[path==='missing-from'?A:B];writeFileSync(f.store.paths.instances,f.store.listInstances().filter(r=>!remove.includes(r.id)).map(JSON.stringify).join('\n')+'\n');}
  const allowed=['self','conductor','principal','mandate'].includes(path);
  const missing=path.startsWith('missing');
  const expected=allowed?{ok:true}:{ok:false,reason:missing?'missing-registration':'unauthorized'};
  const narrow={findInstance:f.store.findInstance};assert.deepEqual(authorizeDrive(narrow,{from,to}),expected);
  if(allowed||missing||state==='absent')assert.deepEqual(authorizeDrive(f.store,{from,to},{now:f.now}),expected);
  const received=await receive(f,{from,to});
  assert.equal(received.ok,allowed);
  if(missing)assert.equal(received.reason,path==='missing-to'?'missing-registration':'no-public-key');
  if(allowed)assert.deepEqual(authorizeDrive({...f.store,findDriveConsent:()=>{throw Error('unavailable');}},{from,to}),{ok:true});
});

test('bound MCP request -> target grant -> receive, principal-absent is distinct',async t=>{
  const f=fixture(t),a=server(f,A,f.a),b=server(f,B,f.b);
  const r=rpc(a,'request',{to:B,answerBy:iso(Date.now()+900000),requestedNotAfter:iso(Date.now()+3600000)});
  const start=Date.now()+1000;
  const g=rpc(b,'respond',{from:A,requestId:r.payload.requestId,decision:'grant',notBefore:iso(start),notAfter:iso(start+60000)});
  assert.equal(g.projection.decision.ok,false); // notBefore is still in the future
  assert.equal((await receive(f,{now:start})).ok,true);
  const audit=f.store.findDriveConsent(A,B,start);
  assert.equal(audit.decision.principalDecision,'principal-absent');
  assert.match(audit.limit,/0 \/ 26,964/);assert.match(audit.limit,/NOT attributable/);
  assert.ok(f.store.readDriveConsentChain(A,B).some(e=>e.body.event==='drive-admitted'));
});

test('principal required and present authorizes; missing key or bound session refuses',async t=>{
  const f=fixture(t),p=keys(),P='codex:principal';register(f.store,P,p);rewriteRegistration(f,B,{principal:P});
  const pair=bodies(f,{principal:P});raw(f,event(f,pair.request,f.a,A));raw(f,event(f,pair.grant,f.b,B));
  assert.equal((await receive(f)).reason,'consent-principal-unavailable');
  const principal=server(f,P,p);
  rpc(principal,'cosign',{from:A,to:B,grantId:computeHash(pair.grant)});
  f.now=Date.now();assert.equal((await receive(f)).ok,true);
  assert.equal(f.store.findDriveConsent(A,B,f.now).decision.principalDecision,'co-signed');
  f.store.revokeInstanceKey(P,p.publicKeyPem);
  assert.equal((await receive(f)).reason,'consent-principal-unavailable');
  assert.match(server(f,P).callTool('h2a_drive_consent_cosign',{from:A,to:B,grantId:computeHash(pair.grant)}).content[0].text,/no bound signing session/);
});

test('target cannot issue a grant without an active principal key',t=>{
  const f=fixture(t);rewriteRegistration(f,B,{principal:'codex:missing-principal'});
  const pair=bodies(f,{principal:'codex:missing-principal'});raw(f,event(f,pair.request,f.a,A));
  const out=server(f,B,f.b).callTool('h2a_drive_consent_respond',{from:A,requestId:pair.request.requestId,decision:'grant',notBefore:iso(Date.now()+1000),notAfter:iso(Date.now()+60000)});
  assert.equal(out.isError,true);assert.match(out.content[0].text,/consent-principal-unavailable/);
});

for(const kind of ['refusal','revocation'])test(`${kind} prevents receive; historical key rotation never resurrects`,async t=>{
  const f=fixture(t),p=seed(f);assert.equal((await receive(f)).ok,true);
  const k2=keys();f.store.addInstanceKey(B,k2.publicKeyPem);raw(f,event(f,negative(p,kind,f.now),k2,B));
  const code=kind==='refusal'?'consent-refused':'consent-revoked';assert.equal((await receive(f)).reason,code);
  f.store.revokeInstanceKey(B,k2.publicKeyPem);assert.equal((await receive(f)).reason,code);
  const renewed=seed(f);assert.notEqual(renewed.request.requestId,p.request.requestId);assert.equal((await receive(f)).ok,true);
});

for(const arm of ['target-key-revoked','grant-expired','answer-expired','48h-grant','answer-cap','widened-window','scope','cross-pair','artifactHash','wrong-signer','tamper','identity-rebind'])test(`reader guard ${arm} with positive control`,async t=>{
  const f=fixture(t);let p=bodies(f);raw(f,event(f,p.request,f.a,A));
  if(arm==='answer-expired'){
    assert.equal((await receive(f,{now:f.now+900000})).reason,'consent-expired');
    const renewed=seed(f,{created:f.now+900000});assert.ok(renewed);assert.equal((await receive(f,{now:f.now+900001})).ok,true);return;
  }
  let g=event(f,p.grant,f.b,B);
  if(arm==='48h-grant')g=event(f,{...p.grant,notAfter:iso(f.now+48*3600000)},f.b,B);
  if(arm==='widened-window')g=event(f,{...p.grant,notAfter:iso(f.now+3600001)},f.b,B);
  if(arm==='scope')g=event(f,{...p.grant,scope:{action:'drive.*',direction:'from->to'}},f.b,B);
  if(arm==='cross-pair')g=event(f,{...p.grant,from:'codex:x'},f.b,B),g.negotiationId=consentPairId(A,B);
  if(arm==='artifactHash')g.body.signature=signCanonical({artifactHash:computeHash(p.grant)},{by:B,privateKeyPem:f.b.privateKeyPem});
  if(arm==='wrong-signer')g.body.signature=signCanonical(p.grant,{by:B,privateKeyPem:f.a.privateKeyPem});
  if(arm==='tamper')g.body.payload.notAfter=iso(f.now+3600010);
  if(arm==='answer-cap'){
    p=bodies(f,{answer:f.now+DRIVE_CONSENT_MAX_ANSWER_MS+1,end:f.now+DRIVE_CONSENT_MAX_ANSWER_MS+60000});raw(f,event(f,p.request,f.a,A));g=event(f,p.grant,f.b,B);
  }
  raw(f,g);
  if(arm==='target-key-revoked'){assert.equal((await receive(f)).ok,true);f.store.revokeInstanceKey(B,f.b.publicKeyPem);assert.equal((await receive(f)).ok,false);const k=keys();f.store.addInstanceKey(B,k.publicKeyPem);f.b=k;seed(f);assert.equal((await receive(f)).ok,true);return;}
  if(arm==='grant-expired'){assert.equal((await receive(f,{now:f.now+3599999})).ok,true);assert.equal((await receive(f,{now:f.now+3600000})).reason,'consent-expired');seed(f,{created:f.now+3600000});assert.equal((await receive(f,{now:f.now+3600001})).ok,true);return;}
  if(arm==='identity-rebind')rewriteRegistration(f,B,{agentUuid:randomUUID()});
  assert.equal((await receive(f)).ok,false);
  seed(f);assert.equal((await receive(f)).ok,true);
});

test('namespace/stabilize guards; unsupported MCP identity arguments; legitimate grant unaffected',async t=>{
  const f=fixture(t),p=seed(f),id=consentPairId(A,B);
  assert.throws(()=>f.store.appendNegotiationEvent(id,event(f,p.grant,f.b,B)),/Reserved/);
  assert.throws(()=>f.store.stabilizeNegotiation(id),/drive-consent/);
  for(const extra of [{instance:B},{privateKeyPem:f.b.privateKeyPem}]){
    const out=server(f,A,f.a).callTool('h2a_drive_consent_respond',{from:A,requestId:p.request.requestId,decision:'grant',...extra});assert.equal(out.isError,true);assert.match(out.content[0].text,/unsupported argument/);
  }
  assert.equal((await receive(f)).ok,true);
  assert.equal((await receive(f,{from:B,to:A,key:f.b})).reason,'unauthorized');
});

test('forged negative evidence is ignored and reported, not a denial',async t=>{
  const f=fixture(t),p=seed(f);raw(f,event(f,negative(p,'revocation',f.now),f.a,'codex:outsider'));
  assert.equal((await receive(f)).ok,true);assert.ok(f.store.findDriveConsent(A,B,f.now).anomalies.length);
});

test('restart, receiver clock rollback, and transport freshness remain distinct',async t=>{
  const f=fixture(t);seed(f);assert.equal((await receive(f,{now:f.now+600000})).ok,true);
  const reopened=createLocalStore({root:f.root});assert.equal((await receive(f,{now:f.now+3600000,store:reopened})).reason,'consent-expired');
  assert.equal((await receive(f,{now:f.now,store:reopened})).reason,'consent-unavailable');
  seed(f,{created:f.now+3600001});assert.equal((await receive(f,{now:f.now+3600002,store:reopened})).ok,true);
});

test('all new policy refusals map explicitly to HTTP 403; infrastructure to 503',()=>{
  for(const code of ['consent-pending','consent-refused','consent-expired','consent-revoked','consent-invalid','consent-principal-unavailable'])assert.equal(remoteDriveRejectionStatus(code),403);
  assert.equal(remoteDriveRejectionStatus('consent-unavailable'),503);
});

test('HTTP receive honors target authority; sender mirror cannot authorize another store',async t=>{
  const f=fixture(t),other=fixture(t); // replace mirror registrations with the same identities/keys
  writeFileSync(other.store.paths.instances,readFileSync(f.store.paths.instances));
  seed(f);let count=0;
  const s=remoteDriveServerForStore(other.store,{to:B,now:()=>f.now,inject:()=>{count++;return true;}});s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>s.close());
  const url=`http://127.0.0.1:${s.address().port}/h2a/drive`;
  const post=()=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line:formatSignedDriveInstruction({from:A,to:B,instruction:'continue',privateKeyPem:f.a.privateKeyPem,at:iso(f.now)})})});
  assert.equal((await post()).status,403);assert.equal(count,0);
  other.a=f.a;other.b=f.b;other.now=f.now;const p=seed(other);assert.equal((await post()).status,202);assert.equal(count,1);
  raw(other,event(other,negative(p,'revocation',f.now),f.b,B));assert.equal((await post()).status,403);assert.equal(count,1);
});

import { withLockSync } from '../dist/runtime/local-files/locks.js';

test('a single injected receiver clock authorizes; real backdated writes remain refused',async t=>{
  const f=fixture(t);f.now-=60000;const p=seed(f);
  assert.equal((await receive(f)).ok,true);
  assert.equal(verifyDriveOnReceive(f.store,formatSignedDriveInstruction({from:A,to:B,instruction:'second receiver path',privateKeyPem:f.a.privateKeyPem,at:iso(f.now)}),{to:B,now:f.now,guard:createReplayGuard()}).ok,true);
  const renewed=bodies(f,{created:f.now+1});
  assert.throws(()=>f.store.recordDriveConsentEnvelope(event(f,renewed.request,f.a,A),f.now-1),/clock rollback/);
  const malformed=event(f,renewed.grant,f.b,B);malformed.createdAt=iso(f.now);
  raw(f,event(f,negative(p,'revocation',f.now),f.b,B));raw(f,event(f,renewed.request,f.a,A));raw(f,malformed);
  assert.equal((await receive(f,{now:f.now+1})).ok,false);
  seed(f,{created:f.now+2});assert.equal((await receive(f,{now:f.now+2})).ok,true);
});

test('lock contention fails closed and authorizes again after release',async t=>{
  const f=fixture(t);seed(f);const store=createLocalStore({root:f.root,lockTimeoutMs:1});
  withLockSync(join(store.paths.registry,'.lock'),()=>assert.equal(verifyDriveOnReceive(store,formatSignedDriveInstruction({from:A,to:B,instruction:'go',privateKeyPem:f.a.privateKeyPem,at:iso(f.now)}),{to:B,now:f.now,guard:createReplayGuard()}).reason,'consent-unavailable'));
  assert.equal((await receive(f,{store})).ok,true);
});

test('mutable accepted state and inbox-only grant never authorize',async t=>{
  const f=fixture(t),p=bodies(f),id=consentPairId(A,B);
  f.store.openNegotiation({id,scope:'drive-consent',parties:[A,B],subject:'drive-consent',status:'proposed',requiredSigners:[B],createdAt:iso(f.now),updatedAt:iso(f.now)});
  raw(f,event(f,p.request,f.a,A));
  f.store.updateNegotiationStatus(id,'accepted');
  // An inbox file is transport only, even with a valid target signature.
  f.store.putInboxMessage(A,{protocol:'sentropic.h2a',version:'0.1',...event(f,p.grant,f.b,B)});
  assert.equal(f.store.readInbox(A).length,1);
  assert.equal((await receive(f)).reason,'consent-pending');
  raw(f,event(f,p.grant,f.b,B));assert.equal((await receive(f)).ok,true);
});

test('admission rechecks revocation and key removal after successful preflight',async t=>{
  for(const mutation of ['revoke','key']){
    const f=fixture(t),p=seed(f);assert.equal((await receive(f)).ok,true);
    const store={...f.store,commitDriveConsentAdmission(...args){
      if(mutation==='revoke')raw(f,event(f,negative(p,'revocation',f.now),f.b,B));
      else f.store.revokeInstanceKey(B,f.b.publicKeyPem);
      return f.store.commitDriveConsentAdmission(...args);
    }};
    assert.equal((await receive(f,{store})).ok,false);
  }
});

test('missing durations reject; exact read-time caps permit a valid grant',async t=>{
  const f=fixture(t),a=server(f,A,f.a);
  assert.equal(a.callTool('h2a_drive_consent_request',{to:B}).isError,true);
  seed(f,{answer:f.now+DRIVE_CONSENT_MAX_ANSWER_MS,end:f.now+DRIVE_CONSENT_MAX_GRANT_MS});
  assert.equal((await receive(f)).ok,true);
});

test('status and authorization reads append nothing, including absent and refused pairs',async t=>{
  const f=fixture(t);
  assert.deepEqual(await receive(f),{ok:false,reason:'unauthorized'});
  assert.equal(f.store.readDriveConsentChain(A,B).length,0);
  rpc(server(f),'status',{from:A,to:B});
  assert.equal(f.store.readDriveConsentChain(A,B).length,0);
  const p=seed(f);assert.equal((await receive(f)).ok,true);
  raw(f,event(f,negative(p,'refusal',f.now),f.b,B));
  const before=readFileSync(negotiationJournalFile(f.store.paths,consentPairId(A,B)),'utf8');
  assert.equal((await receive(f)).reason,'consent-refused');
  const status=rpc(server(f),'status',{from:A,to:B});
  assert.equal(status.decision.reason,'consent-refused');
  assert.equal(readFileSync(negotiationJournalFile(f.store.paths,consentPairId(A,B)),'utf8'),before);
  assert.match(status.limit,/NOT attributable/);
});

test('one pair revoke without requestId defeats two live grants in either order',async t=>{
  for(const reverse of [false,true]){
    const f=fixture(t);seed(f);seed(f);
    assert.equal((await receive(f)).ok,true);
    const rev=rpc(server(f,B,f.b),'revoke',{from:A,to:B});
    assert.equal(rev.payload.pair,true);
    assert.equal((await receive(f,{now:Date.now()})).reason,'consent-revoked');
    seed(f,{created:Date.now()}); // A conflicting later grant cannot bypass it.
    assert.equal((await receive(f,{now:Date.now()})).reason,'consent-revoked');
    if(reverse){
      const entries=f.store.readDriveConsentChain(A,B).filter(e=>e.body.kind!=='drive-consent.audit').reverse();
      const file=negotiationJournalFile(f.store.paths,consentPairId(A,B));
      writeFileSync(file,'');let previous;
      for(const entry of entries){const {protocol,version,sequence,prevHash,contentHash,...payload}=entry;previous=previous?appendJournalEntry(previous,payload):createJournalEntry(payload);appendFileSync(file,JSON.stringify(previous)+'\n');}
      assert.equal((await receive(f,{now:Date.now()})).reason,'consent-revoked');
    }
  }
});

for(const options of [{lockMode:'lease'},{readOnly:true}])test('unavailable admission store preserves plain unauthorized HTTP 403 '+JSON.stringify(options),async t=>{
  const f=fixture(t),store=createLocalStore({root:f.root,...options});
  const result=await receive(f,{store});assert.equal(result.reason,'unauthorized');
  assert.equal(remoteDriveRejectionStatus(result.reason),403);
  seed(f);assert.equal((await receive(f,{store})).reason,'consent-unavailable');
});

test('principal added after grant reports principal unavailable',async t=>{
  const f=fixture(t);seed(f);rewriteRegistration(f,B,{principal:'codex:p'});
  assert.equal((await receive(f)).reason,'consent-principal-unavailable');
});

test('admission replay survives fresh guards and reconstruction on restart',async t=>{
  const f=fixture(t);seed(f);
  const line=formatSignedDriveInstruction({from:A,to:B,instruction:'once',privateKeyPem:f.a.privateKeyPem,at:iso(f.now)});
  const accept=store=>acceptDriveInstruction(line,{store,now:f.now,guard:createReplayGuard(),expectedTo:B,inject:()=>true});
  assert.equal((await accept(f.store)).ok,true);
  assert.equal((await accept(f.store)).reason,'replayed');
  assert.equal((await accept(createLocalStore({root:f.root}))).reason,'replayed');
});

test('startup and periodic full verification detect alteration of covered history outside registry lock',async t=>{
  const f=fixture(t);seed(f);assert.equal((await receive(f)).ok,true);
  let periodic;
  t.mock.method(globalThis,'setInterval',(callback,ms)=>{assert.equal(ms,60000);periodic=callback;return {unref(){}};});
  const reopened=createLocalStore({root:f.root,lockTimeoutMs:1});
  assert.equal(typeof periodic,'function');
  const file=negotiationJournalFile(f.store.paths,consentPairId(A,B));
  const bytes=readFileSync(file,'utf8');
  writeFileSync(file,bytes.replace('drive.instruction','drive.instructioX'));
  withLockSync(join(f.store.paths.registry,'.lock'),()=>periodic());
  assert.equal((await receive(f,{store:reopened})).reason,'consent-invalid');
  assert.equal((await receive(f,{store:createLocalStore({root:f.root})})).reason,'consent-invalid');
  writeFileSync(file,bytes);
  assert.equal((await receive(f,{store:reopened})).ok,true);
});

test('future status reads do not consume current authority or advance the high-water mark',async t=>{
  const f=fixture(t);seed(f);assert.equal((await receive(f)).ok,true);
  assert.equal(f.store.findDriveConsent(A,B,f.now+72*3600000).decision.ok,false);
  assert.equal((await receive(f)).ok,true);
});

for (const kind of ["refusal", "revocation"]) test(`aged ${kind} still overrides a live request in existing journals`, async t => {
  const f=fixture(t), H=3600000, created=f.now+24*H;
  const p=bodies(f,{created,answer:created+H,end:created+25*H});
  p.grant.notBefore=iso(created+H);
  raw(f,event(f,negative(p,kind,f.now),f.b,B));
  raw(f,event(f,p.request,f.a,A));
  raw(f,event(f,p.grant,f.b,B));
  const advance=f.now+48*H+1000;
  const next=bodies(f,{created:advance});
  f.store.recordDriveConsentEnvelope(event(f,next.request,f.a,A),advance);
  const now=advance+1000;
  const {projectConsent}=await import("../dist/runtime/drive/consent.js");
  const expected=projectConsent(f.store,A,B,f.store.readDriveConsentChain(A,B),now).decision;
  assert.deepEqual(expected,{ok:false,reason:kind==="refusal"?"consent-refused":"consent-revoked"});
  for (const store of [f.store,createLocalStore({root:f.root})]) {
    assert.deepEqual(store.findDriveConsent(A,B,now).decision,expected);
    assert.equal((await receive(f,{store,now})).reason,expected.reason);
  }
});

test("envelope admission rejects orphan evidence and request clock skew without writes", t => {
  const f=fixture(t), p=bodies(f);
  for (const payload of [p.grant,negative(p,"refusal",f.now),negative(p,"revocation",f.now),{...p.grant,pair:true}]) {
    assert.throws(()=>f.store.recordDriveConsentEnvelope(event(f,payload,f.b,B),f.now),/orphan evidence/);
  }
  for (const delta of [-60001,60001]) {
    const request=bodies(f,{created:f.now+delta}).request;
    assert.throws(()=>f.store.recordDriveConsentEnvelope(event(f,request,f.a,A),f.now),/request clock skew/);
  }
  assert.equal(f.store.readDriveConsentChain(A,B).length,0);
  for (const delta of [-60000,60000]) {
    const request=bodies(f,{created:f.now+delta}).request;
    assert.doesNotThrow(()=>f.store.recordDriveConsentEnvelope(event(f,request,f.a,A),f.now));
  }
  f.store.recordDriveConsentEnvelope(event(f,p.request,f.a,A),f.now);
  assert.equal(f.store.recordDriveConsentEnvelope(event(f,p.grant,f.b,B),f.now).decision.ok,true);
});

// Deliberate age-boundary corpus complements the seeded fuzz generator.
for (const mode of ['request','pair','pair-expired','renewal','late-request','late-pair-request']) test(
  'index revocation fidelity corpus: '+mode, async t => {
    const {projectConsent}=await import('../dist/runtime/drive/consent.js');
    const f=fixture(t), H=3600000, p=seed(f);
    const at=f.now+72*H;
    if (!mode.startsWith('late-')) {
      const rev=mode.startsWith('pair')
        ? {kind:'h2a.drive.consent.revocation',v:1,from:A,to:B,pair:true,
            at:iso(mode==='pair'?at:f.now),notAfter:iso(mode==='pair'?at+H:f.now+H)}
        : negative(p,'revocation',f.now);
      // Old RECEIPT, independently signed time window (historical disk fixture).
      raw(f,event(f,rev,f.b,B));
    }
    if (mode.startsWith('late-')) {
      const middle=bodies(f,{created:f.now+24*H});
      f.store.recordDriveConsentEnvelope(event(f,middle.request,f.a,A),f.now+24*H);
    }
    const next=bodies(f,{created:at});
    f.store.recordDriveConsentEnvelope(event(f,next.request,f.a,A),at);
    // Advance the persisted pruning clock and exercise the warm index.
    f.store.findDriveConsent(A,B,at);
    if (mode.startsWith('late-')) {
      const rev={...negative(p,'revocation',at),...(mode==='late-pair-request'?{pair:true,notAfter:iso(at)}:{})};
      f.store.recordDriveConsentEnvelope(event(f,rev,f.b,B),at);
    }
    if (mode==='renewal') f.store.recordDriveConsentEnvelope(event(f,next.grant,f.b,B),at);
    const full=projectConsent(f.store,A,B,f.store.readDriveConsentChain(A,B),at).decision;
    if (mode==='renewal') assert.equal(full.ok,true);
    else assert.equal(full.reason,mode==='pair-expired'?'consent-expired':'consent-revoked');
    for (const store of [f.store,createLocalStore({root:f.root})]) {
      const indexed=store.findDriveConsent(A,B,at).decision;
      if (!full.ok) assert.equal(indexed.ok,false);
      if (indexed.ok) assert.equal(full.ok,true);
      if (full.reason==='consent-revoked') assert.equal(indexed.reason,'consent-revoked');
      if (mode==='renewal'||mode==='pair-expired') assert.deepEqual(indexed,full);
    }
  });

test('full verification emits the deadline-derived escalation signal', async t => {
  const {MCP_IDENTITY_TIMEOUT_MS}=await import('../dist/runtime/mcp/identity-state.js');
  const lines=[];
  t.mock.method(console,'error',line=>lines.push(JSON.parse(line)));
  let ticks=0;
  // Only the measurement clock is controlled; no timer or timeout is changed.
  t.mock.method(performance,'now',()=>ticks++ * MCP_IDENTITY_TIMEOUT_MS * 0.1);
  fixture(t);
  const signal=lines.find(line=>line.event==='drive-consent.full-verification');
  assert.ok(signal);
  assert.equal(signal.thresholdMs,MCP_IDENTITY_TIMEOUT_MS*signal.budgetFraction);
  assert.equal(signal.budgetFraction,0.1);
  assert.equal(signal.due,true);
  assert.equal(signal.action,'ESCALATE debt -> due');
  assert.equal(signal.track,'01M39VC11XBNSE8W2ASMQRRKZV');
});
