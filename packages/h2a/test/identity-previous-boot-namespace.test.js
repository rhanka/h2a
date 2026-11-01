import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { classifyLiveness, me } from '../dist/runtime/local-files/succession-lock.js';
import { withIdentityFenceSync } from '../dist/runtime/local-files/identity-fence.js';

function fixture(t) {
  const dir=fs.mkdtempSync(join(tmpdir(),'boot-namespace-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const self=me(), token='cafe0123cafe0123cafe0123cafe0123';
  const rec={recordVersion:2,protocol:'identity-binding-fence-v1',platform:'linux',publication:'link',
    ...self,boot:self.boot==='00000000-0000-4000-8000-000000000001'?'00000000-0000-4000-8000-000000000002':'00000000-0000-4000-8000-000000000001',
    ns:self.ns==='pid:[1234]'?'pid:[5678]':'pid:[1234]',token,fenceEpoch:token,at:Date.now()};
  return {dir,lock:join(dir,'.lock'),self,rec};
}
test('should prove a previous-boot fence dead across PID namespaces without probing the PID',t=>{
  const {rec,self}=fixture(t);
  assert.equal(classifyLiveness(rec,self,{protocol:'identity',probe:()=>assert.fail('previous boot must not probe')}).verdict,'dead');
});
test('should recover a previous-boot fence across PID namespaces on qualified storage',t=>{
  // Keep the 100 ms budget deterministic while all real durable I/O executes.
  let clock=0;
  t.mock.method(performance,'now',()=>clock++);
  t.mock.method(Atomics,'wait',(_view,_index,_value,ms)=>{clock+=ms;return 'timed-out';});
  const {lock,rec}=fixture(t);fs.writeFileSync(lock,JSON.stringify(rec));
  assert.equal(withIdentityFenceSync(lock,lease=>{assert.equal(lease.recovered,true);return 42;},{timeoutMs:100,pollMs:5}),42);
  assert.equal(fs.existsSync(lock),false);
});
test('should retain a previous-boot fence on unqualified storage',t=>{
  const {lock,rec}=fixture(t);const bytes=JSON.stringify(rec);fs.writeFileSync(lock,bytes);
  const original=fs.statfsSync;fs.statfsSync=()=>({type:0x6969});syncBuiltinESMExports();
  try {assert.throws(()=>withIdentityFenceSync(lock,()=>assert.fail('unqualified storage'),{timeoutMs:30,pollMs:5}),{name:'LockTimeoutError'});
    assert.equal(fs.readFileSync(lock,'utf8'),bytes);
  }finally{fs.statfsSync=original;syncBuiltinESMExports();}
});
test('should retain foreign machines, invalid boots and same-boot foreign namespaces',t=>{
  const {rec,self}=fixture(t);
  for(const change of [{host:'1'.repeat(32)},{boot:null},{boot:'bad'},{boot:self.boot}])
    assert.equal(classifyLiveness({...rec,...change},self,{protocol:'identity',probe:()=>assert.fail('ambiguous holder')}).verdict,'undecidable');
});
