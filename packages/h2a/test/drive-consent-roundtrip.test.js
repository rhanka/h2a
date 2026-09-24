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
test("p2p_target_signed_consent_roundtrip_allows_drive_after_absent_denial",async t=>{
  const {store,a,b,now}=fixture(t);
  const from="codex:a",to="codex:b";
  let injections=0;
  const receive=()=>acceptDriveInstruction(formatSignedDriveInstruction({from,to,instruction:"continue",privateKeyPem:a.privateKeyPem}),{store,guard:createReplayGuard(),expectedTo:to,inject:()=>{injections++;return true;}});
  assert.deepEqual(await receive(),{ok:false,reason:"unauthorized"});
  assert.equal(injections,0);
  const iso=n=>new Date(n).toISOString();
  const request={kind:"h2a.drive.consent.request",v:1,requestId:randomUUID(),from,to,scope,createdAt:iso(now),answerBy:iso(now+900000),requestedNotAfter:iso(now+3600000)};
  const grant={kind:"h2a.drive.consent.grant",v:1,requestId:request.requestId,requestHash:computeHash(request),from,to,scope,notBefore:iso(now),notAfter:iso(now+3600000),issuedAt:iso(now)};
  const id="drive-consent:"+computeHash({from,to});
  store.openNegotiation({id,scope:"drive-consent",parties:[from,to],subject:"drive-consent",status:"proposed",requiredSigners:[to],createdAt:iso(now),updatedAt:iso(now)});
  for (const [payload,k,by,type] of [[request,a,from,"propose"],[grant,b,to,"accept"]]) {
    const event={id:randomUUID(),type,actor:{instance:by,role:"AGENTS",scope:"drive-consent"},negotiationId:id,createdAt:iso(now),body:{kind:payload.kind,payload,signature:signCanonical(payload,{by,privateKeyPem:k.privateKeyPem})}};
    // The baseline uses existing journal primitives; production namespace writes
    // after implementation go through the dedicated admission boundary.
    if (store.recordDriveConsentEnvelope) store.recordDriveConsentEnvelope(event);
    else store.appendNegotiationEvent(id,event);
  }
  const result=await receive();
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(injections,1);
});
