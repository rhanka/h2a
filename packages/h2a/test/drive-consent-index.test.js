import assert from 'node:assert/strict';
import test from 'node:test';
// Permanent corpus adapted from the owner-supplied fuzz-index.mjs generator.
// Differential fuzz: derived-index decision (findDriveConsent / admission) vs projectConsent over the FULL verified journal.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const D=new URL("../dist/",import.meta.url).href;
const { computeHash, signCanonical, createReplayGuard, createLocalStore, acceptDriveInstruction, formatSignedDriveInstruction, createMcpServer, appendJournalEntry, createJournalEntry } = await import(D+"index.js");
const { negotiationJournalFile } = await import(D+"runtime/local-files/paths.js");
const { consentPairId, projectConsent } = await import(D+"runtime/drive/consent.js");
const scope={action:"drive.instruction",direction:"from->to"};
const iso=n=>new Date(n).toISOString();
const H=3600000;
function keys(){const k=generateKeyPairSync("ed25519");return {privateKeyPem:k.privateKey.export({format:"pem",type:"pkcs8"}).toString(),publicKeyPem:k.publicKey.export({format:"pem",type:"spki"}).toString()};}
const A="codex:a",B="codex:b";
for (const initialSeed of [1,2,3,4,5,6,7,42,123,999]) test(`consent index asymmetric corpus seed ${initialSeed}`, async t => {
let seed=initialSeed;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
const pick=a=>a[Math.floor(rnd()*a.length)];
for(let iter=0;iter<40;iter++){
  const root=mkdtempSync(join(tmpdir(),"fuzz-"));t.after(()=>rmSync(root,{recursive:true,force:true}));const store=createLocalStore({root});const a=keys(),b=keys();
  let now=Date.UTC(2026,0,1);
  for(const [id,k] of [[A,a],[B,b]])store.registerInstance({id,instance:id,roles:["AGENTS"],scopes:[id],capabilities:[],endpoints:[],publicKeys:[k.publicKeyPem],acceptedPolicies:[],createdAt:iso(now)});
  const bind=()=>{const ra=store.findInstance(A),rb=store.findInstance(B);return {from:A,to:B,...(ra?.agentUuid?{fromAgentUuid:ra.agentUuid}:{}),...(rb?.agentUuid?{toAgentUuid:rb.agentUuid}:{})};};
  const requests=[];const grants=[];
  const ev=(p,k,by,type)=>({id:randomUUID(),type,actor:{instance:by,role:"AGENTS",scope:"drive-consent"},negotiationId:consentPairId(A,B),createdAt:iso(now),body:{kind:p.kind,payload:p,signature:signCanonical(p,{by,privateKeyPem:k.privateKeyPem})}});
  // raw append bypasses the store writer (adversarial disk), keeps the chain valid
  const raw=e=>{const file=negotiationJournalFile(store.paths,e.negotiationId);mkdirSync(join(file,".."),{recursive:true});const entries=store.readNegotiationJournal(e.negotiationId);const prev=entries.at(-1);appendFileSync(file,JSON.stringify(prev?appendJournalEntry(prev,e):createJournalEntry(e))+"\n");};
  const write=e=>{try{ if(rnd()<0.3) raw(e); else store.recordDriveConsentEnvelope(e,now);}catch{}};
  const receive=async()=>{const line=formatSignedDriveInstruction({from:A,to:B,instruction:"go",privateKeyPem:a.privateKeyPem,at:iso(now)});return acceptDriveInstruction(line,{store,now,guard:createReplayGuard(),expectedTo:B,inject:()=>true});};
  const s=createMcpServer({root,store,sendContext:{instance:B,privateKeyPem:b.privateKeyPem}});
  for(let step=0;step<60;step++){
    now+=Math.floor(rnd()*pick([60000,H,6*H,20*H]));
    const op=pick(["request","request","grant","grant","refuse","revoke","pairrevoke","receive","receive","receive","status","reopen"]);
    if(op==="request"){const created=now+pick([0,0,0,-H,5*H,20*H]);const answer=created+pick([15*60000,H,2*H]);const end=created+pick([H,24*H,25*H,30*H]);
      const p={kind:"h2a.drive.consent.request",v:1,requestId:randomUUID(),...bind(),scope,createdAt:iso(created),answerBy:iso(answer),requestedNotAfter:iso(end)};requests.push(p);write(ev(p,a,A,"propose"));}
    else if(op==="grant"&&requests.length){const r=pick(requests);const c=Date.parse(r.createdAt);const start=pick([c,now,c+30*60000]);const end=pick([Date.parse(r.requestedNotAfter),start+H,start+24*H]);
      const g={kind:"h2a.drive.consent.grant",v:1,requestId:r.requestId,requestHash:computeHash(r),...bind(),scope,issuedAt:iso(pick([c,now,start])),notBefore:iso(start),notAfter:iso(end)};grants.push(g);write(ev(g,b,B,"accept"));}
    else if((op==="refuse"||op==="revoke")&&requests.length){const r=pick(requests);const p={kind:op==="refuse"?"h2a.drive.consent.refusal":"h2a.drive.consent.revocation",v:1,requestId:r.requestId,requestHash:computeHash(r),...bind(),at:iso(now)};const byA=op==="revoke"&&rnd()<0.5;write(ev(p,byA?a:b,byA?A:B,op==="refuse"?"reject":"withdraw"));}
    else if(op==="pairrevoke"){const p={kind:"h2a.drive.consent.revocation",v:1,...bind(),pair:true,at:iso(now),notAfter:iso(now+pick([0,H,25*H,30*H]))};write(ev(p,b,B,"withdraw"));}
    else if(op==="receive"){await receive();}
    else if(op==="status"){store.findDriveConsent(A,B,now+pick([0,0,72*H]));}
    // Differential check at the current clock: index vs full journal
    const full=store.readDriveConsentChain(A,B);
    const expected=projectConsent(store,A,B,full,now).decision;
    const got=store.findDriveConsent(A,B,now).decision;
    const fresh=createLocalStore({root}).findDriveConsent(A,B,now).decision; // reopen: reconstructed index
    for(const [label,d] of [["index",got],["reopen",fresh]]){
      const context=JSON.stringify({initialSeed,iter,step,label,expected,got:d});
      if (!expected.ok) assert.equal(d.ok,false,context);
      if (d.ok) assert.equal(expected.ok,true,context);
      if (!expected.ok && expected.reason==='consent-revoked') assert.equal(d.reason,'consent-revoked',context);

    }
    // Admission must agree with the full-journal decision too
    if(op==="receive"){const r=await receive();const okExpected=expected.ok;if(r.ok!==okExpected&&r.reason!=="consent-unavailable"){assert.fail(JSON.stringify({iter,step,expected,r}));}}
  }
  rmSync(root,{recursive:true,force:true});
}
});
