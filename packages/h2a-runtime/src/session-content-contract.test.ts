import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it,vi } from "vitest";
import { validateContentMessage, capsuleDirectory } from "./session-content-contract.js";
import { contentDigest, canonicalJson } from "./session-content-json.js";
import { ConfirmationBudget, ConfirmationVerifier } from "./session-content-confirmation.js";
import { Ajv2020 } from "ajv/dist/2020.js";
const read = (name: string) => JSON.parse(readFileSync(new URL(name, capsuleDirectory), "utf8"));
describe("session content capsule", () => {
  it("should refuse an oversized encoded fragment before allocating its decoded buffer",()=>{
    const fragment=read('terminal-fragment.v2.json'),encoded=Buffer.alloc(262145).toString('base64url');
    fragment.payloadB64=encoded;fragment.byteLength=0;fragment.totalBytes=0;
    const original=Buffer.from;let decoded=0;
    const spy=vi.spyOn(Buffer,'from').mockImplementation((value:any,...args:any[])=>{if(value===encoded&&args[0]==='base64url')decoded++;return Reflect.apply(original,Buffer,[value,...args]);});
    try{expect(()=>validateContentMessage(fragment)).toThrow();expect(decoded).toBe(0);}finally{spy.mockRestore();}
  });
  it("should typecheck the exact pinned message fixture bytes rather than a drifting duplicate",()=>{
    const text=readFileSync(new URL('./session-content-fixture-types.typecheck.ts',import.meta.url),'utf8');
    const typed=JSON.parse(text.slice(text.indexOf('const fixtures=')+'const fixtures='.length,text.indexOf(' as const satisfies')));
    const names=readdirSync(capsuleDirectory).filter(n=>n.endsWith('.v2.json')&&!n.includes('vectors'));
    expect(Object.keys(typed)).toHaveLength(names.length);
    for(const name of names){const value=read(name);expect(typed[value.kind]).toEqual(value);}
  });
  it("should expose a strict interoperable JSON Schema with ACK and history-state combinations",()=>{
    const validate=new Ajv2020({strict:true,allErrors:true}).compile(read('schema.json'));
    for(const name of readdirSync(capsuleDirectory).filter(n=>n.endsWith('.v2.json')&&!n.includes('vectors')))expect(validate(read(name)),name+JSON.stringify(validate.errors)).toBe(true);
    const ack=read('source-ack.v2.json');ack.status='applied';expect(validate(ack)).toBe(false);
    const policy=read('project-policy.v2.json');policy.policy.history.mode='none';expect(validate(policy)).toBe(false);
  });
  it("should validate every positive fixture and refuse unknown nested fields and wire versions", () => {
    for (const name of readdirSync(capsuleDirectory).filter(n => n.endsWith('.v2.json') && !n.includes('vectors'))) {
      const value = read(name); validateContentMessage(value);
      expect(() => validateContentMessage({ ...value, protocolVersion: 1 })).toThrow();
      expect(() => validateContentMessage({ ...value, extra: true })).toThrow();
    }
    const policy = read('project-policy.v2.json'); policy.policy.owner.extra = true;
    expect(() => validateContentMessage(policy)).toThrow();
  });
  it("should pin all capsule bytes and reproduce canonical digest vectors", () => {
    const manifest = read('manifest.json');
    expect(manifest.files.map((f: {path:string})=>f.path)).toEqual(readdirSync(capsuleDirectory).filter(n=>n.endsWith('.json')&&n!=='manifest.json').sort());
    for (const file of manifest.files) {
      const bytes = readFileSync(new URL(file.path, capsuleDirectory));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    for (const vector of read('vectors.v2.json').canonical) {
      expect(canonicalJson(vector.input)).toBe(vector.canonicalUtf8);
      expect(contentDigest(vector.purpose, vector.input)).toBe(vector.digest);
    }
    expect(read('capabilities.v2.json').native).toEqual([]);
  });
  it("should verify actual synthetic signed nonce bytes and reject forged or replayed proof", () => {
    const v=read('confirmation-vectors.v2.json');
    const verifier = new ConfirmationVerifier({ issuer:v.challenge.owner.issuer, subject:v.challenge.owner.subject,
      tenantId:v.challenge.project.tenantId, clientId:v.challenge.clientId, source:v.challenge.source,
      keys:v.jwks.keys, measuredClockErrorMs:v.measuredClockErrorMs, wallNow:()=>v.wallNow,
      monotonicNow:()=>v.monotonicNow, budget:new ConfirmationBudget(()=>v.monotonicNow) });
    const pending=verifier.stage(v.challenge); let consumed=0;
    expect(()=>verifier.consume(pending,v.forged,{commit:()=>{consumed++;}})).toThrow();
    verifier.consume(pending,v.valid,{commit:()=>{consumed++;}});
    expect(()=>verifier.consume(pending,v.valid,{commit:()=>{consumed++;}})).toThrow();
    expect(consumed).toBe(1);
  });
  it("should refuse digest substitutions, invalid bounds and partial archive receipts", () => {
    for (const c of read('refusals.v2.json').cases) {
      const value=read(c.fixture); const parts=c.mutation.pointer.slice(1).split('/');
      let parent=value; for(const p of parts.slice(0,-1)) parent=parent[p];
      parent[parts.at(-1)!]=c.mutation.value;
      expect(()=>validateContentMessage(value, {policyDigest:read('project-policy.v2.json').policyDigest}),c.name).toThrow();
    }
    const ack=read('source-ack.v2.json'); ack.status='applied';
    expect(()=>validateContentMessage(ack)).toThrow();
    const part=read('terminal-fragment.v2.json'); part.byteLength++;
    expect(()=>validateContentMessage(part)).toThrow();
    const policy=read('project-policy.v2.json'); policy.policy.history.selected[0].toRecord=1;
    expect(()=>validateContentMessage(policy)).toThrow();
  });
});
