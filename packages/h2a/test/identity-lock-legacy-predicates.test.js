import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { identitySelf } from '../dist/runtime/local-files/identity-fence.js';
import { livenessOf } from '../dist/runtime/local-files/succession-lock.js';
import { captureLegacyLock, collectLegacyEvidence } from '../dist/runtime/local-files/legacy-identity-evidence.js';
import { simulatedReboot } from './helpers/legacy-proc-fixture.mjs';

const cleanups=new WeakMap();
function defer(t,fn) {
  if(!cleanups.has(t)){cleanups.set(t,[]);t.after(()=>{for(const cleanup of cleanups.get(t).reverse())cleanup();});}
  cleanups.get(t).push(fn);
}
function fixture(t) {
  const dir=fs.mkdtempSync(join(tmpdir(),'legacy-predicate-'));
  defer(t,()=>fs.rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'.lock');
  const holder={pid:4194001,hostname:hostname(),startedAt:'2000-01-01T00:00:00.000Z'};
  const bytes=Buffer.from(JSON.stringify(holder));
  fs.writeFileSync(path,bytes);
  const context={...identitySelf(),ns:'pid:[4026531836]',timeNs:'time:[4026531834]'};
  return {dir,path,holder,bytes,context};
}
function patch(t, replacements) {
  const originals=Object.fromEntries(Object.keys(replacements).map(k=>[k,fs[k]]));
  Object.assign(fs,replacements);syncBuiltinESMExports();
  defer(t,()=>{Object.assign(fs,originals);syncBuiltinESMExports();});
}
function capture(t,x) {
  const c=captureLegacyLock(x.path,x.bytes,x.holder,x.context);
  assert.equal(typeof c.fd,'number',JSON.stringify(c));
  defer(t,()=>fs.closeSync(c.fd));
  return c;
}

test('R1: a concordant multithread zombie is undecidable; one thread proves death',()=>{
  const self=identitySelf();
  const holder={recordVersion:2,protocol:'identity-binding-fence-v1',platform:'linux',publication:'link',...self,token:'a'.repeat(32),fenceEpoch:'a'.repeat(32),at:Date.now()};
  assert.match(self.start,/^proc:/);
  for(const threads of [2,8,undefined])assert.equal(livenessOf(holder,self,{protocol:'identity',platform:'linux',probe:()=>({start:self.start,state:'Z',threads})}),'undecidable');
  assert.equal(livenessOf(holder,self,{protocol:'identity',platform:'linux',probe:()=>({start:self.start,state:'Z',threads:1})}),'dead');
});

test('R2: hostname mismatch refuses before any procfs collection',t=>{
  const x=fixture(t);x.holder.hostname=hostname()+'-foreign';const c=capture(t,x);
  let reads=0;const open=fs.openSync;
  patch(t,{openSync:(p,...args)=>{if(String(p).startsWith('/proc/')){reads++;throw Error('collection forbidden for foreign hostname');}return open(p,...args);}});
  assert.deepEqual(collectLegacyEvidence(c,performance.now()+1000,()=>x.context),{dead:false,reasonCode:'legacy-hostname-mismatch',reason:'historical hostname differs from the current hostname',structural:true});
  assert.equal(reads,0);
});

test('R3: a symlink is rejected by O_NOFOLLOW with ELOOP',t=>{
  const x=fixture(t);const link=join(x.dir,'link');fs.symlinkSync(x.path,link);
  const open=fs.openSync;let eloop=0;
  patch(t,{openSync:(p,...args)=>{try{return open(p,...args);}catch(e){if(p===link&&e.code==='ELOOP')eloop++;throw e;}}});
  const result=captureLegacyLock(link,x.bytes,x.holder,x.context);
  if(typeof result.fd==='number')fs.closeSync(result.fd);
  assert.equal(result.reasonCode,'legacy-observation-changed');assert.equal(result.dead,false);assert.equal(eloop,1);
});
test('R3: a multiply linked legacy inode is structurally unsupported',t=>{
  const x=fixture(t);fs.linkSync(x.path,join(x.dir,'second-link'));
  const result=captureLegacyLock(x.path,x.bytes,x.holder,x.context);
  if(typeof result.fd==='number')fs.closeSync(result.fd);
  assert.equal(result.reasonCode,'legacy-generation-unsupported');assert.equal(result.structural,true);
});
test('R3: a foreign effective UID has the exact owner refusal',t=>{
  const x=fixture(t);const fstat=fs.fstatSync;
  patch(t,{fstatSync:(fd,...args)=>({...fstat(fd,...args),isFile:()=>true,uid:process.geteuid()+1})});
  const result=captureLegacyLock(x.path,x.bytes,x.holder,x.context);
  if(typeof result.fd==='number')fs.closeSync(result.fd);
  assert.equal(result.reasonCode,'legacy-file-owner-unsupported');assert.equal(result.structural,true);
});
test('R3: metadata changed during capture preserves the generation',t=>{
  const x=fixture(t);const read=fs.readFileSync;
  patch(t,{readFileSync:(p,...args)=>{const result=read(p,...args);if(typeof p==='number')fs.appendFileSync(x.path,' ');return result;}});
  assert.equal(captureLegacyLock(x.path,x.bytes,x.holder,x.context).reasonCode,'legacy-observation-changed');
});

for(const kind of ['different','absent'])test(`R4: ${kind} time namespace prevents collection`,t=>{
  const x=fixture(t),c=capture(t,x);const restore=simulatedReboot(x.dir,{timeNs:'time:[123]'});defer(t,restore);
  if(kind==='absent') {const readlink=fs.readlinkSync;patch(t,{readlinkSync:(p,...args)=>{if(p==='/proc/self/ns/time')throw Object.assign(Error('absent namespace'),{code:'ENOENT'});return readlink(p,...args);}});}
  const result=collectLegacyEvidence(c,performance.now()+1000,()=>x.context);
  assert.equal(result.dead,false);assert.equal(result.reasonCode,'legacy-proc-view-unsupported');
});

// Civil clock and proc sources are frozen ONLY in this fixture. Each independent
// date is tested at -1, equality and +1 ms of the exact conservative boundary.
for(const source of ['startedAt','mtimeMs','ctimeMs'])for(const offset of [-1,0,1])test(`R5: ${source} at date margin ${offset} ms`,t=>{
  const x=fixture(t);const now=2_000_000_000_000,boot=now-100_000,bound=boot-2000;
  const old=bound-1000;x.holder.startedAt=new Date(source==='startedAt'?bound+offset:old).toISOString();
  const restore=simulatedReboot(x.dir,{now,uptime:100});defer(t,restore);
  const fstat=fs.fstatSync,lstat=fs.lstatSync;
  const dates=s=>({...s,isFile:()=>true,mtimeMs:source==='mtimeMs'?bound+offset:old,ctimeMs:source==='ctimeMs'?bound+offset:old});
  patch(t,{fstatSync:(...args)=>dates(fstat(...args)),lstatSync:(...args)=>dates(lstat(...args))});
  const c=capture(t,x);const result=collectLegacyEvidence(c,performance.now()+1000,()=>x.context);
  assert.equal(result.dead,offset<0,JSON.stringify(result));assert.equal(result.reasonCode,offset<0?'legacy-global-pid-absent':'legacy-time-evidence-unavailable');
});
for(const source of ['startedAt','mtimeMs','ctimeMs'])test(`R5: future ${source} never authorizes death`,t=>{
  const x=fixture(t),now=2_000_000_000_000;const restore=simulatedReboot(x.dir,{now,uptime:100});defer(t,restore);
  if(source==='startedAt')x.holder.startedAt=new Date(now+1).toISOString();
  const fstat=fs.fstatSync,lstat=fs.lstatSync;
  const dates=s=>({...s,isFile:()=>true,mtimeMs:source==='mtimeMs'?now+1:now-200_000,ctimeMs:source==='ctimeMs'?now+1:now-200_000});
  patch(t,{fstatSync:(...args)=>dates(fstat(...args)),lstatSync:(...args)=>dates(lstat(...args))});
  const result=collectLegacyEvidence(capture(t,x),performance.now()+1000,()=>x.context);
  assert.equal(result.dead,false);assert.equal(result.reasonCode,'legacy-time-evidence-unavailable');
});
for(const offset of [-2001,-2000,-1999,1999,2000,2001])test(`R5: btime/uptime agreement at ${offset} ms`,t=>{
  const x=fixture(t),now=2_000_000_000_000;const restore=simulatedReboot(x.dir,{now,uptime:100-offset/1000});defer(t,restore);
  // Override only btime: actual decimal uptime retains the millisecond bound.
  const open=fs.openSync,stat=join(x.dir,'btime-bound');fs.writeFileSync(stat,`btime ${(now-100_000)/1000}\n`);
  patch(t,{openSync:(p,...args)=>open(p==='/proc/stat'?stat:p,...args)});
  const result=collectLegacyEvidence(capture(t,x),performance.now()+1000,()=>x.context);
  assert.equal(result.dead,Math.abs(offset)<=2000,JSON.stringify(result));assert.equal(result.reasonCode,Math.abs(offset)<=2000?'legacy-global-pid-absent':'legacy-time-evidence-unavailable');
});
