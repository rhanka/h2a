/** Pair/time consent. The journal, not negotiation status or inboxes, is authority. */
import { computeHash, verifyCanonical, type H2AJournalEntry, type H2ASignature } from '@sentropic/h2a';
import type { LocalStore } from '../local-files/store.js';

export const DRIVE_CONSENT_DEFAULT_ANSWER_MS = 15 * 60 * 1000;
export const DRIVE_CONSENT_MAX_ANSWER_MS = 60 * 60 * 1000;
export const DRIVE_CONSENT_DEFAULT_GRANT_MS = 60 * 60 * 1000;
export const DRIVE_CONSENT_MAX_GRANT_MS = 24 * 60 * 60 * 1000;
export const DRIVE_CONSENT_LIMIT = 'Signatures prove active-key possession, not intent. Source: owner build brief decision 2, 2026-09-24: earlier measurement of 53,904 private-key files under one OS account in /home/antoinefa/h2a-workspace/.h2a/keys, including a direct cross-lane key read. Source: ~/h2a-workspace/.h2a/registry/instances.jsonl, count 2026-09-24: 0 / 26,964 live registrations carry a principal, so conditional co-signing is inert on that fleet. Source: ~/h2a-workspace/.h2a/keys/, measurement 2026-09-24: 26,964 private keys, mode 0600, all owned by the current uid; any same-uid lane can read a principal key, so co-signature is explicit but NOT attributable to human intent. Out-of-band principal custody does not exist; per-agent custody deferred to Track 01M38WH19VE7VGW8QY0P9NHHVX.';
export type ConsentReason = 'unauthorized' | 'consent-pending' | 'consent-refused' | 'consent-expired' | 'consent-revoked' | 'consent-invalid' | 'consent-unavailable' | 'consent-principal-unavailable';
export type ConsentDecision = {ok:true;via:'consent';grantId:string;requestId:string;notAfter:string;principalDecision:'principal-absent'|'co-signed'} | {ok:false;reason:ConsentReason};
export interface ConsentProjection { decision:ConsentDecision; anomalies:string[]; requests:number; limit:typeof DRIVE_CONSENT_LIMIT; }
export interface ConsentEvidence {kind:string;payload:Record<string,unknown>;signature:H2ASignature;coSignature?:H2ASignature;}
export const consentPairId = (from:string,to:string):string => 'drive-consent:'+computeHash({from,to});
export const isConsentId = (id:string):boolean => id.startsWith('drive-consent:') || id.startsWith('drive-consent-');
export const consentScope = {action:'drive.instruction',direction:'from->to'} as const;
export function instant(value:unknown):number {
  if(typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const n=Date.parse(value); return Number.isFinite(n) && new Date(n).toISOString()===value ? n : NaN;
}
function record(x:unknown):x is Record<string,unknown>{return !!x && typeof x==='object' && !Array.isArray(x);}
export function evidence(x:unknown):x is ConsentEvidence {
  return record(x) && typeof x.kind==='string' && record(x.payload) && record(x.signature);
}
type ConsentReader=Pick<LocalStore,'findInstance'|'listInstanceKeys'|'listKeyEvents'>;
export function verified(store:ConsentReader,payload:unknown,signature:H2ASignature|undefined,by:string,historical=false):boolean {
  if(!signature || signature.by!==by || signature.alg!=='ed25519') return false;
  const keys=historical ? [...(store.findInstance(by)?.publicKeys??[]),...store.listKeyEvents().filter(k=>k.instance===by&&k.type==='added').map(k=>k.publicKey)] : store.listInstanceKeys(by);
  return keys.some(key=>{try{return verifyCanonical(payload,signature,key);}catch{return false;}});
}
/** No authority may depend on writer-supplied policy or cached verified flags. */
export function projectConsent(store:ConsentReader,from:string,to:string,entries:readonly H2AJournalEntry<unknown>[],now:number):ConsentProjection {
  const anomalies:string[]=[];
  const done=(decision:ConsentDecision,requests=0):ConsentProjection=>({decision,anomalies,requests,limit:DRIVE_CONSENT_LIMIT});
  if(!Number.isFinite(now)) return done({ok:false,reason:'consent-unavailable'});
  const a=store.findInstance(from),b=store.findInstance(to);
  if(!a||!b) return done({ok:false,reason:'consent-invalid'});
  const events:Array<{body:ConsentEvidence;entry:H2AJournalEntry<unknown>}>=[];
  for(const entry of entries){
    if(record(entry.body) && entry.body.kind==='drive-consent.audit') continue;
    if(!evidence(entry.body) || entry.body.kind!==entry.body.payload.kind || entry.negotiationId!==consentPairId(from,to)) {anomalies.push(entry.id);continue;}
    const p=entry.body.payload;
    if(p.v!==1 || p.from!==from || p.to!==to || !['h2a.drive.consent.request','h2a.drive.consent.grant','h2a.drive.consent.refusal','h2a.drive.consent.revocation'].includes(String(p.kind))){anomalies.push(entry.id);continue;}
    events.push({body:entry.body,entry});
  }
  const bound=(p:Record<string,unknown>)=>p.fromAgentUuid===a.agentUuid && p.toAgentUuid===b.agentUuid;
  const requests=events.filter(({body,entry})=>{
    const p=body.payload;
    if(p.kind!=='h2a.drive.consent.request')return false;
    const created=instant(p.createdAt),answer=instant(p.answerBy),end=instant(p.requestedNotAfter);
    const valid=bound(p) && typeof p.requestId==='string' && /^[a-f0-9-]{32,36}$/.test(p.requestId) && record(p.scope) && computeHash(p.scope)===computeHash(consentScope) && answer>created && answer-created<=DRIVE_CONSENT_MAX_ANSWER_MS && end>=answer && end-created<=DRIVE_CONSENT_MAX_GRANT_MS+DRIVE_CONSENT_MAX_ANSWER_MS && (p.purpose===undefined || (typeof p.purpose==='string' && Buffer.byteLength(p.purpose)<=1024)) && verified(store,p,body.signature,from,true);
    if(!valid) anomalies.push(entry.id);
    return valid;
  });
  if(!requests.length) return done({ok:false,reason:events.length?'consent-invalid':'unauthorized'});
  const decisions:ConsentDecision[]=[];
  for(const {body:requestBody} of requests){
    const request=requestBody.payload,hash=computeHash(request);
    const related=events.filter(({body})=>body.payload.requestId===request.requestId && body.payload.requestHash===hash);
    const terminal=(kind:string,party:boolean)=>related.some(({body,entry})=>{
      if(body.payload.kind!==kind)return false;
      const by=body.signature.by;
      const valid=(by===to || (party&&by===from)) && verified(store,body.payload,body.signature,by,true) && Number.isFinite(instant(body.payload.at));
      if(!valid)anomalies.push(entry.id);
      return valid;
    });
    if(terminal('h2a.drive.consent.revocation',true)){decisions.push({ok:false,reason:'consent-revoked'});continue;}
    if(terminal('h2a.drive.consent.refusal',false)){decisions.push({ok:false,reason:'consent-refused'});continue;}
    const grants=related.filter(({body,entry})=>{
      const p=body.payload;
      if(p.kind!=='h2a.drive.consent.grant')return false;
      const start=instant(p.notBefore),end=instant(p.notAfter),issued=instant(p.issuedAt),committed=instant(entry.createdAt);
      const valid=bound(p) && p.principal===b.principal && record(p.scope) && computeHash(p.scope)===computeHash(request.scope) && Number.isFinite(start) && end>start && end-start<=DRIVE_CONSENT_MAX_GRANT_MS && end<=instant(request.requestedNotAfter) && start>=issued && issued>=instant(request.createdAt) && issued<instant(request.answerBy) && committed>=issued && committed<instant(request.answerBy) && verified(store,p,body.signature,to);
      if(!valid)anomalies.push(entry.id);
      return valid;
    });
    if(new Set(grants.map(g=>computeHash(g.body.payload))).size>1){decisions.push({ok:false,reason:'consent-invalid'});continue;}
    if(!grants.length){decisions.push({ok:false,reason:now>=instant(request.answerBy)?'consent-expired':related.some(e=>e.body.payload.kind==='h2a.drive.consent.grant')?'consent-invalid':'consent-pending'});continue;}
    const g=grants[0].body.payload;
    if(now>=instant(g.notAfter)){decisions.push({ok:false,reason:'consent-expired'});continue;}
    if(now<instant(g.notBefore)){decisions.push({ok:false,reason:'consent-pending'});continue;}
    // Undefined is a separate successful policy branch, never co-signature-satisfied.
    if(b.principal===undefined){decisions.push({ok:true,via:'consent',grantId:computeHash(g),requestId:String(request.requestId),notAfter:String(g.notAfter),principalDecision:'principal-absent'});continue;}
    if(!store.findInstance(b.principal) || !store.listInstanceKeys(b.principal).length || !grants.some(({body})=>verified(store,g,body.coSignature,b.principal!))){decisions.push({ok:false,reason:'consent-principal-unavailable'});continue;}
    decisions.push({ok:true,via:'consent',grantId:computeHash(g),requestId:String(request.requestId),notAfter:String(g.notAfter),principalDecision:'co-signed'});
  }
  const success=decisions.find(d=>d.ok);
  const priority:ConsentReason[]=['consent-revoked','consent-refused','consent-principal-unavailable','consent-invalid','consent-expired','consent-pending','unauthorized'];
  return done(success??priority.map(reason=>decisions.find(d=>!d.ok&&d.reason===reason)).find(Boolean)??{ok:false,reason:'consent-invalid'},requests.length);
}
