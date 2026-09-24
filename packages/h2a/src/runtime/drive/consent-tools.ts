import {randomUUID} from 'node:crypto';
import {computeHash,signCanonical,type H2AJournalPayload} from '@sentropic/h2a';
import type {LocalStore} from '../local-files/store.js';
import type {H2ASendSigner} from '../send.js';
import {consentPairId,consentScope,evidence,instant,verified,DRIVE_CONSENT_MAX_ANSWER_MS,DRIVE_CONSENT_MAX_GRANT_MS} from './consent.js';

export const CONSENT_TOOLS = ['h2a_drive_consent_request','h2a_drive_consent_respond','h2a_drive_consent_cosign','h2a_drive_consent_revoke','h2a_drive_consent_status'] as const;
const fields:Record<string,string[]>={
  h2a_drive_consent_request:['to','answerBy','requestedNotAfter','purpose'],
  h2a_drive_consent_respond:['from','requestId','decision','notBefore','notAfter','reason'],
  h2a_drive_consent_cosign:['from','to','grantId'],
  h2a_drive_consent_revoke:['from','to','requestId','reason'],
  h2a_drive_consent_status:['from','to']
};
/** The signer comes only from the trusted MCP sidecar, never tool arguments. */
export function handleDriveConsent(store:LocalStore,signer:H2ASendSigner|undefined,name:string,args:Record<string,unknown>={}) {
  try {
    for(const key of Object.keys(args)) if(!fields[name]?.includes(key)) throw Error('unsupported argument: '+key);
    const text=(key:string):string=>{if(typeof args[key]!=='string'||!args[key])throw Error('required argument: '+key);return args[key] as string;};
    if(name==='h2a_drive_consent_status')return result(store.findDriveConsent(text('from'),text('to')));
    if(!signer)throw Error('consent-principal-unavailable: no bound signing session');
    const identity=store.findInstance(signer.instance);
    if(!identity||identity.id!==signer.instance)throw Error('consent-invalid: bound identity not registered');
    const now=Date.now(),at=new Date(now).toISOString();
    let from=name==='h2a_drive_consent_request'?signer.instance:text('from');
    let to=name==='h2a_drive_consent_respond'?signer.instance:text('to');
    const a=store.findInstance(from),b=store.findInstance(to);
    if(!a||!b)throw Error('missing-registration');
    const bindings={from,to,...(a.agentUuid?{fromAgentUuid:a.agentUuid}:{}),...(b.agentUuid?{toAgentUuid:b.agentUuid}:{})};
    let payload:Record<string,unknown>,type:H2AJournalPayload['type'];
    const entries=store.readDriveConsentChain(from,to);
    if(name==='h2a_drive_consent_request'){
      const answerBy=text('answerBy'),requestedNotAfter=text('requestedNotAfter');
      if(!(instant(answerBy)>now && instant(answerBy)-now<=DRIVE_CONSENT_MAX_ANSWER_MS && instant(requestedNotAfter)>=instant(answerBy) && instant(requestedNotAfter)-now<=DRIVE_CONSENT_MAX_GRANT_MS+DRIVE_CONSENT_MAX_ANSWER_MS))throw Error('consent-invalid: dates');
      payload={kind:'h2a.drive.consent.request',v:1,requestId:randomUUID(),...bindings,scope:consentScope,createdAt:at,answerBy,requestedNotAfter,...(args.purpose!==undefined?{purpose:args.purpose}:{})};type='propose';
    }else if(name==='h2a_drive_consent_cosign'){
      if(b.principal===undefined || signer.instance!==b.principal)throw Error('consent-principal-unavailable: session is not the registered principal');
      const grant=entries.map(e=>e.body).filter(evidence).find(e=>e.payload.kind==='h2a.drive.consent.grant'&&computeHash(e.payload)===text('grantId'));
      if(!grant || !verified(store,grant.payload,grant.signature,to))throw Error('consent-invalid: target grant');
      const coSignature=signCanonical(grant.payload,{by:signer.instance,privateKeyPem:signer.privateKeyPem});
      if(!verified(store,grant.payload,coSignature,b.principal))throw Error('consent-principal-unavailable: no active principal signing key');
      const projection=store.recordDriveConsentEnvelope({id:randomUUID(),type:'accept',actor:{instance:to,role:'AGENTS',scope:'drive-consent'},negotiationId:consentPairId(from,to),createdAt:at,body:{...grant,coSignature}});
      return result(projection);
    }else{
      const requestId=text('requestId');
      const request=entries.map(e=>e.body).filter(evidence).find(e=>e.payload.kind==='h2a.drive.consent.request'&&e.payload.requestId===requestId);
      if(!request)throw Error('consent-invalid: unknown request');
      const common={v:1,requestId,requestHash:computeHash(request.payload),...bindings};
      if(name==='h2a_drive_consent_revoke'){
        if(signer.instance!==from&&signer.instance!==to)throw Error('consent-invalid: parties only');
        payload={kind:'h2a.drive.consent.revocation',...common,at,...(args.reason!==undefined?{reason:args.reason}:{})};type='withdraw';
      }else if(text('decision')==='refuse'){
        payload={kind:'h2a.drive.consent.refusal',...common,at,...(args.reason!==undefined?{reason:args.reason}:{})};type='reject';
      }else if(text('decision')==='grant'){
        if(b.principal!==undefined && (!store.findInstance(b.principal)||!store.listInstanceKeys(b.principal).length))throw Error('consent-principal-unavailable: no active principal key; no provisioning');
        if(entries.some(e=>evidence(e.body)&&e.body.payload.requestId===requestId&&['h2a.drive.consent.refusal','h2a.drive.consent.revocation','h2a.drive.consent.grant'].includes(e.body.payload.kind as string)))throw Error('consent-invalid: already decided');
        const notBefore=text('notBefore'),notAfter=text('notAfter');
        if(now>=instant(request.payload.answerBy)||instant(notBefore)<now||!(instant(notAfter)>instant(notBefore))||instant(notAfter)-instant(notBefore)>DRIVE_CONSENT_MAX_GRANT_MS||instant(notAfter)>instant(request.payload.requestedNotAfter))throw Error('consent-invalid: grant dates');
        payload={kind:'h2a.drive.consent.grant',...common,scope:consentScope,issuedAt:at,notBefore,notAfter,...(b.principal!==undefined?{principal:b.principal}:{})};type='accept';
      }else throw Error('consent-invalid: decision');
    }
    const signature=signCanonical(payload,{by:signer.instance,privateKeyPem:signer.privateKeyPem});
    const projection=store.recordDriveConsentEnvelope({id:randomUUID(),type,actor:{instance:signer.instance,role:identity.roles[0]??'AGENTS',scope:'drive-consent'},negotiationId:consentPairId(from,to),createdAt:at,body:{kind:String(payload.kind),payload,signature}});
    return result({payload,projection});
  }catch(error){return {isError:true as const,content:[{type:'text' as const,text:error instanceof Error?error.message:String(error)}]};}
}
function result(value:unknown){return {content:[{type:'text' as const,text:JSON.stringify(value)}]};}
