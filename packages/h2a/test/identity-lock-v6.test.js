import { proofDeps, fixtureIdentity } from './helpers/identity-proof-fixture.mjs';
import { verifyHeldDescriptorCas, refuseCullExecution } from '../../h2a-runtime/dist/identity-cull/cull.js';

import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { withIdentityFence, withIdentityFenceSync, identitySelf, readIdentityLock, reclaimOrMint, listBindings, findBinding } from '../dist/index.js';
import * as fence from '../dist/runtime/local-files/identity-fence.js';
import { breakLockAsOperator } from '../dist/runtime/local-files/succession-lock.js';
const task=process.env.IDLOCK_LANE;
const token='abcd1234abcd1234abcd1234abcd1234';
const key={host:'claude',providerSessionId:'new',workspaceId:'ws'};
const deps={verifyProof:()=>false,mint:()=>({instance:'claude:new:id',agentUuid:'id-new'}),now:()=>Date.now()};
function deadPid(){const r=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(r.status,0);return r.pid;}
function setup(label){const dir=fs.mkdtempSync(join(tmpdir(),'review-'+label+'-'));const root=join(dir,'store');const id=join(root,'identity');fs.mkdirSync(id,{recursive:true});assert.equal(fs.statfsSync(id).type>>>0,0xef53);return{dir,root,id,lock:join(id,'.lock'),journal:join(id,'bindings.jsonl')};}
function rec(over={}){return{recordVersion:2,protocol:'identity-binding-fence-v1',platform:'linux',publication:'link',...identitySelf(),token,fenceEpoch:token,at:Date.now(),...over};}
function writeLock(p,r){fs.writeFileSync(p,JSON.stringify(r));}
function clean(x){fs.rmSync(x.dir,{recursive:true,force:true});}
test('R2: an explicit unknown protocol cannot fall back to the v4 adapter',()=>{
 const x=setup('protocol');try{const r=rec({protocol:'identity-future-v9',pid:deadPid()});delete r.recordVersion;writeLock(x.lock,r);const read=readIdentityLock(x.lock);console.log('OBSERVED unknown protocol reader:',typeof read==='object'?read.kind:read);assert.equal(typeof read==='object'?read.kind:read,'unknown');}finally{clean(x);}
});
test('R2/R4: a dead o-excl SUCC is not automatically retired',async()=>{
 const x=setup('succ-oexcl');try{writeLock(x.lock,rec({pid:deadPid()}));const t='11112222333344445555666677778888';writeLock(x.lock+'.succ.'+token,rec({pid:deadPid(),token:t,fenceEpoch:t,target:token,publication:'o-excl'}));await assert.rejects(()=>withIdentityFence(x.lock,()=>{console.log('OBSERVED o-excl successor: acquisition entered');return 1;},{timeoutMs:100,pollMs:10}),{name:'LockTimeoutError'});}finally{clean(x);}
});
test('R4: an old writer winning republication must not concatenate its row onto a fragment',()=>{
 const x=setup('old-writer');const unlink=fs.unlinkSync;let injected=false;
 try{writeLock(x.lock,rec({pid:deadPid()}));fs.writeFileSync(x.journal,'{"fragment');
  fs.unlinkSync=function(path,...args){const result=unlink(path,...args);if(path===x.lock&&!injected){injected=true;const oldUrl=pathToFileURL(task+'/base/packages/h2a/dist/runtime/identity/bindings.js').href;const script='import { reclaimOrMint } from '+JSON.stringify(oldUrl)+';reclaimOrMint('+JSON.stringify(x.root)+', {host:"claude",providerSessionId:"old",workspaceId:"ws"}, {verifyProof:()=>false,mint:()=>({instance:"claude:old:id",agentUuid:"id-old"}),now:()=>Date.now()});';const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);console.log('OBSERVED old writer: appended while original tail was unterminated');}return result;};syncBuiltinESMExports();
  reclaimOrMint(x.root,key,proofDeps(x.root,deps));assert.equal(injected,true);assert.equal(findBinding(x.root,{...key,providerSessionId:'old'})?.agentUuid,'id-old','old writer successful binding must remain visible');
 }finally{fs.unlinkSync=unlink;syncBuiltinESMExports();clean(x);}
});
test('R4: a failed separator fsync must preserve the recovery barrier',()=>{
 const x=setup('fsync');const open=fs.openSync;const sync=fs.fsyncSync;let appendFd;let injected=0;
 try{writeLock(x.lock,rec({pid:deadPid()}));fs.writeFileSync(x.journal,'{"fragment');
  fs.openSync=function(path,flags,...args){const fd=open(path,flags,...args);if(path===x.journal&&flags==='a')appendFd=fd;return fd;};fs.fsyncSync=function(fd){if(fd===appendFd){injected++;throw Object.assign(new Error('review-injected separator fsync EIO'),{code:'EIO'});}return sync(fd);};syncBuiltinESMExports();
  assert.throws(()=>reclaimOrMint(x.root,key,proofDeps(x.root,deps)),{code:'EIO'});assert.equal(injected,1);console.log('OBSERVED after separator fsync EIO: lock exists=',fs.existsSync(x.lock));assert.equal(fs.existsSync(x.lock),true,'original recovery barrier must remain');
 }finally{fs.openSync=open;fs.fsyncSync=sync;syncBuiltinESMExports();clean(x);}
});
test('R5: readers ignore a complete JSON suffix without newline',()=>{
 const x=setup('reader');try{fs.writeFileSync(x.journal,JSON.stringify({...key,instance:'claude:unfinished:id',agentUuid:'unfinished',at:new Date().toISOString()}));console.log('OBSERVED rows from unterminated JSON:',listBindings(x.root).length);assert.deepEqual(listBindings(x.root),[]);}finally{clean(x);}
});
test('R5/R6: explicit legacy unlock neutralizes the journal before withdrawal',()=>{
 const x=setup('operator');try{writeLock(x.lock,{pid:deadPid(),hostname:'isolated-fixture',startedAt:new Date().toISOString()});fs.writeFileSync(x.journal,'{"fragment');const holder=readIdentityLock(x.lock);assert.equal(holder.kind,'legacy');const r=(fence.breakIdentityLockAsOperator ?? breakLockAsOperator)(x.lock,{expectToken:holder.holder.token,assertDead:true});assert.equal(r.broken,true);console.log('OBSERVED operator: broken=true, tail terminated=',fs.readFileSync(x.journal,'utf8').endsWith('\n'));assert.equal(fs.readFileSync(x.journal,'utf8'),' {"fragment\n'.slice(1));}finally{clean(x);}
});
test('R7: normal release after the budget cannot authorize a late acquisition',async()=>{
 const x=setup('deadline');let timer;try{writeLock(x.lock,{pid:process.pid,hostname:'isolated-fixture',startedAt:new Date().toISOString()});timer=setTimeout(()=>fs.unlinkSync(x.lock),150);const start=performance.now();await assert.rejects(()=>withIdentityFence(x.lock,()=>{console.log('OBSERVED late acquisition ms=',Math.round(performance.now()-start));return 1;},{timeoutMs:100,pollMs:200}),{name:'LockTimeoutError'});}finally{clearTimeout(timer);clean(x);}
});
test('R5: a minted binding has a durable exclusive CAS slot before its append',()=>{
 const x=setup('slot-order'); const write=fs.writeSync; const append=fs.appendFileSync; let saw=false;
 const inspect=()=>{ const path=join(x.id,'commits'); assert.ok(fs.existsSync(path),'CAS directory must precede append');
   const slots=fs.readdirSync(path).filter(n=>n.endsWith('.json')); assert.equal(slots.length,1);
   const slot=JSON.parse(fs.readFileSync(join(path,slots[0]),'utf8')); assert.ok(slot.line.endsWith('\n')); saw=true; };
 try { fs.appendFileSync=(path,...args)=>{if(path===x.journal)inspect();return append(path,...args);};
   const open=fs.openSync; const fds=new Set(); fs.openSync=(path,...args)=>{const fd=open(path,...args);if(path===x.journal)fds.add(fd);return fd;};
   fs.writeSync=(fd,data,...args)=>{if(fds.has(fd)&&String(data)!=='\n')inspect();return write(fd,data,...args);};syncBuiltinESMExports();
   try { reclaimOrMint(x.root,key,proofDeps(x.root,deps)); assert.equal(saw,true); } finally {fs.openSync=open;}
 } finally {fs.writeSync=write;fs.appendFileSync=append;syncBuiltinESMExports();clean(x);}
});
test('R5: an incomplete foreign slot blocks mint and retains the fence',()=>{
 const x=setup('slot-integrity');try{fs.mkdirSync(join(x.id,'commits'));fs.writeFileSync(join(x.id,'commits','a'.repeat(32)+'.genesis.json'),'{"incomplete');
   assert.throws(()=>reclaimOrMint(x.root,key,proofDeps(x.root,deps)),e=>e.reasonCode==='binding-commit-integrity'&&e.cause==='identity_storage_failed');
   assert.equal(fs.existsSync(x.lock),true);assert.equal(fs.existsSync(x.journal),false);
 }finally{clean(x);}
});
test('R4: ordinary acquisition preserves its fence on an append fsync failure',()=>{
 const x=setup('append-fsync'); const open=fs.openSync;const sync=fs.fsyncSync;let fd;
 try{fs.openSync=(p,flags,...args)=>{const r=open(p,flags,...args);if(p===x.journal&&flags==='a')fd=r;return r;};fs.fsyncSync=(r)=>{if(r===fd)throw Object.assign(new Error('append EIO'),{code:'EIO'});return sync(r);};syncBuiltinESMExports();
   assert.throws(()=>reclaimOrMint(x.root,key,proofDeps(x.root,deps)),{code:'EIO'});assert.equal(fs.existsSync(x.lock),true);
 }finally{fs.openSync=open;fs.fsyncSync=sync;syncBuiltinESMExports();clean(x);}
});
test('R1/R2: cull verification publishes the common v2 identity fence and keeps execution disabled',()=>{
 const x=setup('cull');try{const bytes=Buffer.from('{"host":"claude"}\n');fs.writeFileSync(x.journal,bytes);let held;
   const result=verifyHeldDescriptorCas({bindingPath:x.journal,expectedSize:bytes.length,expectedSha256:'sha256:'+createHash('sha256').update(bytes).digest('hex'),
     writerInventory:{complete:true,paths:[{id:'reclaimOrMint',writesBindings:true,requiresCanonicalFence:true,fenceProtocol:'identity-binding-fence-v1',fenceEpochRequired:true}]},
     afterPreflight:()=>{held=JSON.parse(fs.readFileSync(x.lock));},rename:()=>assert.fail('execution must remain disabled')});
   assert.equal(result.state,'STAGING_VERIFIED');assert.equal(held.recordVersion,2);assert.equal(held.publication,'link');assert.equal('acquiredAt' in held,false);
   assert.ok(refuseCullExecution().refusalCodes.includes('EXECUTION_DISABLED_PENDING_SEPARATE_OWNER_GO'));
 }finally{clean(x);}
});
test('R8: two independent processes elect one successor and never overlap critical sections',async()=>{
 const x=setup('concurrency');const children=[];try{writeLock(x.lock,rec({pid:process.pid,boot:'00000000-0000-4000-8000-000000000001'}));const marker=join(x.dir,'markers');
   const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(import.meta.dirname,'helpers/identity-fence-child.mjs'),x.lock,marker],{stdio:['ignore','pipe','pipe']});children.push(child);let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));});
   const results=await Promise.all([run(),run()]);assert.equal(results.filter(r=>r.recovered).length,1);const rows=fs.readFileSync(marker,'utf8').trim().split('\n');assert.equal(rows.length,4);assert.equal(rows[0].replace('enter','exit'),rows[1]);assert.equal(rows[2].replace('enter','exit'),rows[3]);assert.equal(fs.existsSync(x.lock),false);
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');clean(x);}
});
test('R8: a previous-boot record with a live PID is recovered without a targeted probe',()=>{
 const x=setup('stale-live');const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});const kill=process.kill;const read=fs.readFileSync;let probes=0;
 try{writeLock(x.lock,rec({pid:child.pid,boot:'00000000-0000-4000-8000-000000000001'}));
   process.kill=(pid,signal)=>{if(pid===child.pid)probes++;return kill(pid,signal);};fs.readFileSync=(p,...args)=>{if(p===`/proc/${child.pid}/stat`||p===`/proc/${child.pid}/status`)probes++;return read(p,...args);};syncBuiltinESMExports();
   assert.equal(withIdentityFenceSync(x.lock,lease=>lease.recovered,{timeoutMs:500}),true);assert.equal(probes,0);
 }finally{process.kill=kill;fs.readFileSync=read;syncBuiltinESMExports();child.kill('SIGKILL');clean(x);}
});
for(const [caseIndex, mutation] of [
 r=>({...r,recordVersion:3}),r=>({...r,protocol:'future'}),r=>({...r,extra:true}),r=>({...r,pid:Number.MAX_SAFE_INTEGER+1})
].entries())test(`R2: v2 invalid discriminator/field case ${caseIndex+1} never falls back`,()=>{const x=setup('forms');try{writeLock(x.lock,mutation(rec()));const result=readIdentityLock(x.lock);assert.ok(result==='unknown'||result==='corrupt');}finally{clean(x);}});
test('R5: a durable slot survives a real child exit and its winner is recovered without another mint',()=>{
 const x=setup('slot-crash');try{fixtureIdentity(x.root,'claude:winner:id','winner');
   const url=pathToFileURL(join(import.meta.dirname,'../dist/runtime/identity/bindings.js')).href;
   const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {reclaimOrMint} from ${JSON.stringify(url)};const open=fs.openSync,write=fs.writeSync;let journal;fs.openSync=(p,...args)=>{const fd=open(p,...args);if(p===${JSON.stringify(x.journal)}&&args[0]==='a')journal=fd;return fd;};fs.writeSync=(fd,...args)=>{if(fd===journal)process.exit(0);return write(fd,...args);};syncBuiltinESMExports();reclaimOrMint(${JSON.stringify(x.root)},${JSON.stringify(key)},{verifyProof:()=>true,mint:()=>({instance:'claude:winner:id',agentUuid:'winner'}),now:()=>Date.now()});`;
   const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(x.lock),true);
   fs.writeFileSync(join(x.root,'registry','keys.jsonl'),Array.from({length:20000},()=>JSON.stringify({instance:'unrelated',type:'added',publicKey:'irrelevant',at:'now'})+'\n').join(''));
   const readFile=fs.readFileSync;let protectedBytes=0;const owns=()=>{const paths=[x.lock,...fs.readdirSync(x.id).filter(n=>n.includes('.succ.')&&!n.includes('.tmp.')).map(n=>join(x.id,n))];return paths.some(p=>{try{return JSON.parse(readFile(p)).pid===process.pid;}catch{return false;}});};
   fs.readFileSync=(p,...args)=>{const bytes=readFile(p,...args);if(String(p).startsWith(join(x.root,'registry'))&&owns())protectedBytes+=Buffer.byteLength(bytes);return bytes;};syncBuiltinESMExports();
   let mints=0;let recovered;try{recovered=reclaimOrMint(x.root,key,{verifyProof:()=>true,mint:()=>{mints++;throw new Error('second mint masks the CAS winner');},now:()=>Date.now()});}
   finally{fs.readFileSync=readFile;syncBuiltinESMExports();}
   assert.equal(recovered.instance,'claude:winner:id');assert.equal(mints,0);assert.equal(findBinding(x.root,key).agentUuid,'winner');assert.ok(protectedBytes<65536,`cold slot proof prepared outside possession, observed ${protectedBytes} bytes inside`);
 }finally{clean(x);}
});
test('R5: admission does not read the complete registry or key-event journal under identity possession',()=>{
 const x=setup('receipt-bound');const open=fs.openSync,close=fs.closeSync,read=fs.readSync,readFile=fs.readFileSync;const fds=new Map();let protectedBytes=0;
 try{reclaimOrMint(x.root,key,proofDeps(x.root,deps));const keys=join(x.root,'registry','keys.jsonl');fs.writeFileSync(keys,Array.from({length:20000},()=>JSON.stringify({instance:'unrelated',type:'added',publicKey:'irrelevant',at:'now'})+'\n').join(''));
   fs.openSync=(p,...args)=>{const fd=open(p,...args);fds.set(fd,p);return fd;};fs.closeSync=fd=>{fds.delete(fd);return close(fd);};
   fs.readSync=(fd,b,...args)=>{const n=read(fd,b,...args);if(String(fds.get(fd)).startsWith(join(x.root,'registry'))&&fs.existsSync(x.lock))protectedBytes+=n;return n;};
   fs.readFileSync=(p,...args)=>{const data=readFile(p,...args);if(String(p).startsWith(join(x.root,'registry'))&&fs.existsSync(x.lock))protectedBytes+=Buffer.byteLength(data);return data;};syncBuiltinESMExports();
   const r=reclaimOrMint(x.root,key,{...deps,verifyProof:()=>true,mint:()=>assert.fail('must reclaim')});assert.equal(r.action,'reclaim');assert.ok(protectedBytes<65536,`bounded targeted receipt reads, observed ${protectedBytes} bytes`);
 }finally{fs.openSync=open;fs.closeSync=close;fs.readSync=read;fs.readFileSync=readFile;syncBuiltinESMExports();clean(x);}
});
test('R2: inability to publish a linked successor produces a bounded explicit refusal',async()=>{
 const x=setup('no-link-recovery');const link=fs.linkSync;try{writeLock(x.lock,rec({pid:deadPid()}));fs.linkSync=()=>{throw Object.assign(new Error('synthetic unsupported link'),{code:'EPERM'});};syncBuiltinESMExports();
   await assert.rejects(()=>withIdentityFence(x.lock,()=>assert.fail('cannot recover with o-excl election'),{timeoutMs:100,pollMs:10}),e=>{assert.equal(e.diagnostic.reasonCode,'fs-no-atomic-publish');return true;});
   assert.ok(fs.existsSync(x.lock));assert.equal(fs.readdirSync(x.id).some(n=>n.includes('.succ.')),false);
 }finally{fs.linkSync=link;syncBuiltinESMExports();clean(x);}
});
test('R2: nominal binding acquisition remains available with exclusive-create publication',()=>{
 const x=setup('no-link-nominal');const link=fs.linkSync;try{fs.linkSync=()=>{throw Object.assign(new Error('synthetic unsupported link'),{code:'EPERM'});};syncBuiltinESMExports();
   const result=reclaimOrMint(x.root,key,proofDeps(x.root,deps));assert.equal(result.action,'mint');assert.equal(findBinding(x.root,key).instance,result.instance);assert.equal(fs.existsSync(x.lock),false);
 }finally{fs.linkSync=link;syncBuiltinESMExports();clean(x);}
});
test('R7: civil clock jumps cannot shorten or extend the monotone acquisition budget',async()=>{
 const x=setup('civil-clock');const now=Date.now;let count=0;try{writeLock(x.lock,rec());Date.now=()=>now()+(++count%2?100000:-100000);
   const start=performance.now();await assert.rejects(()=>withIdentityFence(x.lock,()=>assert.fail('live lock'),{timeoutMs:100,pollMs:10}),{name:'LockTimeoutError'});assert.ok(performance.now()-start>=90);assert.ok(performance.now()-start<600);
 }finally{Date.now=now;clean(x);}
});
test('R3: inconsistent zombie stat/status observations never authorize retirement',async()=>{
 const x=setup('zombie-coherence');const open=fs.openSync,read=fs.readFileSync;try{const record=rec();writeLock(x.lock,record);
   const stat=read(`/proc/${process.pid}/stat`,'utf8').replace(/\) [A-Za-z] /,') Z ');const statFile=join(x.dir,'stat'),statusFile=join(x.dir,'status');
   fs.writeFileSync(statFile,stat);fs.writeFileSync(statusFile,`Pid:\t${process.pid}\nTgid:\t${process.pid}\nState:\tS (sleeping)\nThreads:\t1\n`);
   const map=p=>p===`/proc/${process.pid}/stat`?statFile:p===`/proc/${process.pid}/status`?statusFile:p;
   fs.openSync=(p,...args)=>open(map(p),...args);fs.readFileSync=(p,...args)=>read(map(p),...args);syncBuiltinESMExports();
   await assert.rejects(()=>withIdentityFence(x.lock,()=>assert.fail('inconsistent zombie cannot be proven dead'),{timeoutMs:100,pollMs:10}),{name:'LockTimeoutError'});assert.ok(fs.existsSync(x.lock));
 }finally{fs.openSync=open;fs.readFileSync=read;syncBuiltinESMExports();clean(x);}
});
test('R5: a legacy complete JSON primitive suffix is neutralized without wedging resolution',()=>{
 const x=setup('primitive-tail');try{fs.writeFileSync(x.journal,'null');const result=reclaimOrMint(x.root,key,proofDeps(x.root,deps));
   assert.equal(result.action,'mint');assert.ok(fs.readFileSync(x.journal,'utf8').startsWith('null\n'));assert.equal(findBinding(x.root,key).instance,result.instance);
 }finally{clean(x);}
});
test('R5: fixed CAS vectors include the newline and the provider host in kh',()=>{
 const x=setup('CAS-vector');const link=fs.linkSync;let seen=false;
 try{fs.linkSync=(source,target,...args)=>{if(String(target).startsWith(join(x.id,'commits')+'/')&&String(target).endsWith('.json')) {
     const slot=JSON.parse(fs.readFileSync(source));assert.equal(slot.line,'{"host":"h","providerSessionId":"s","workspaceId":"w","instance":"h:fixture:id","agentUuid":"id","at":"1970-01-01T00:00:00.000Z"}\n');
     assert.equal(slot.lineId,'33f1bfa047dad3f783c74efdbf5d5dd1e06233f9500c98c17cc34ec0b35ea988');assert.equal(slot.kh,'6684fa0ace3365c1fabe008e26a1498d');assert.equal(slot.pred,'genesis');seen=true;
   }return link(source,target,...args);};syncBuiltinESMExports();
   reclaimOrMint(x.root,{host:'h',providerSessionId:'s',workspaceId:'w'},proofDeps(x.root,{verifyProof:()=>false,mint:()=>({instance:'h:fixture:id',agentUuid:'id'}),now:()=>0}));assert.equal(seen,true);
 }finally{fs.linkSync=link;syncBuiltinESMExports();clean(x);}
});
