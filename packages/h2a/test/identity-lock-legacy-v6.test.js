import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { hostname } from 'node:os';
import { reclaimOrMint, withIdentityFence, readIdentityLock } from '../dist/index.js';
import { reclaimOrMintAsync } from '../dist/runtime/identity/bindings.js';
import { proofDeps } from './helpers/identity-proof-fixture.mjs';
import { simulatedReboot } from './helpers/legacy-proc-fixture.mjs';
import { identitySelf } from '../dist/runtime/local-files/identity-fence.js';
const key={host:'claude',providerSessionId:'legacy-incident',workspaceId:'ws'};
function setup(){const dir=fs.mkdtempSync(join(tmpdir(),'idlock-B-'));const root=join(dir,'store');fs.mkdirSync(join(root,'identity'),{recursive:true});return{dir,root,lock:join(root,'identity','.lock')};}
function legacy(x){const source=pathToFileURL(join(process.env.IDLOCK_LANE,'base/packages/h2a/dist/runtime/identity/bindings.js')).href;
 const code=`import {reclaimOrMint} from ${JSON.stringify(source)};reclaimOrMint(${JSON.stringify(x.root)},${JSON.stringify(key)},{verifyProof:()=>false,mint:()=>process.exit(0),now:()=>Date.now()});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(fs.existsSync(x.lock),true);const rec=JSON.parse(fs.readFileSync(x.lock));assert.equal(rec.pid,child.pid);return rec;
}
for(const mode of ['sync','async'])test(`B incident: ${mode} recovers real 0.98.5 legacy after simulated reboot and preserves identity`,async()=>{
 const x=setup();let restore=()=>{};try{
   const deps=proofDeps(x.root,{verifyProof:()=>true,mint:()=>({instance:'claude:original:id',agentUuid:'original'}),now:()=>Date.now()});
   const original=reclaimOrMint(x.root,key,deps);legacy(x);const bytes=fs.readFileSync(x.lock);assert.equal(readIdentityLock(x.lock).kind,'legacy');
   restore=simulatedReboot(x.dir);let mints=0;const same={...deps,mint:()=>{mints++;throw new Error('unexpected remint');}};
   const start=performance.now();const result=mode==='sync' ? reclaimOrMint(x.root,key,same,{deadlineMs:1000}) : await reclaimOrMintAsync(x.root,key,same,{deadlineMs:1000});
   assert.equal(result.action,'reclaim');assert.equal(result.instance,original.instance);assert.equal(mints,0);assert.ok(performance.now()-start<=2000);assert.equal(fs.existsSync(x.lock),false);assert.ok(bytes.length>0);
 }finally{restore();fs.rmSync(x.dir,{recursive:true,force:true});}
});
for(const [name,options,reason] of [
 ['inner PID collision',{innerPid:true},'legacy-pid-present'],
 ['unsupported namespace',{pidNs:'pid:[123]'},'legacy-proc-view-unsupported'],
 ['malformed status',{invalidStatus:true},'legacy-inventory-incomplete'],
 ['process limit',{entries:Array.from({length:8193},(_,i)=>String(i+1))},'legacy-inventory-incomplete'],
 ['recent dates',{uptime:86500},'legacy-time-evidence-unavailable'],
 ['invalid btime',{btime:'btime invalid\n'},'legacy-time-evidence-unavailable'],
 ['hidepid',{hidepid:'2'},'legacy-proc-view-unsupported'],
 ['protected overmount',{mount:'2 1 0:2 / /proc/stat rw - tmpfs tmpfs rw\n'},'legacy-proc-view-unsupported'],
 ['status EIO',{entries:[String(process.pid),'4194000'],statusError:'EIO'},'legacy-inventory-incomplete']
])test(`B doubt: ${name} retains the exact legacy generation`,async()=>{
 const x=setup();let restore=()=>{};try{const rec=legacy(x);const before=fs.readFileSync(x.lock);restore=simulatedReboot(x.dir,{...options,...(options.innerPid?{innerPid:rec.pid}:{})});
   await assert.rejects(()=>withIdentityFence(x.lock,()=>assert.fail('must not enter'),{timeoutMs:150,pollMs:10}),e=>{assert.equal(e.diagnostic.reasonCode,reason);assert.equal(e.diagnostic.bootClass,'unknown');return true;});assert.deepEqual(fs.readFileSync(x.lock),before);
 }finally{restore();fs.rmSync(x.dir,{recursive:true,force:true});}
});
for(const mutation of [
 r=>({...r,pid:0}),r=>({...r,pid:4194305}),r=>({...r,startedAt:'2026-02-30T00:00:00.000Z'}),
 r=>({...r,fenceEpoch:r.fenceEpoch.toUpperCase()}),r=>({...r,fenceEpoch:'00000000-0000-1000-8000-000000000001'}),
 r=>({...r,extra:true}),r=>({...r,recordVersion:2}),r=>({...r,protocol:'unknown'})
])test('B2: malformed complete legacy never falls back to an incomplete legacy or adapter',()=>{const x=setup();try{const r={pid:123,hostname:hostname(),startedAt:'2026-01-01T00:00:00.000Z',protocol:'identity-binding-fence-v1',fenceEpoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
 fs.writeFileSync(x.lock,JSON.stringify(mutation(r)));const result=readIdentityLock(x.lock);assert.ok(result==='unknown'||result==='corrupt');
 }finally{fs.rmSync(x.dir,{recursive:true,force:true});}});
for(const rewrite of [s=>s+'\n',s=>s+' ',s=>s.replace('"pid":123','"pid":1,"pid":123'),s=>JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(s)).reverse()))])
 test('B2: noncanonical bytes are never automatically eligible',()=>{const x=setup();try{const r={pid:123,hostname:hostname(),startedAt:'2026-01-01T00:00:00.000Z',protocol:'identity-binding-fence-v1',fenceEpoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
 fs.writeFileSync(x.lock,rewrite(JSON.stringify(r)));const result=readIdentityLock(x.lock);assert.ok(result==='corrupt'||result==='unknown'||result.eligible===false);
 }finally{fs.rmSync(x.dir,{recursive:true,force:true});}});
for(const options of [{mount:'2 1 0:2 / /proc/sys/fs/binfmt_misc rw - binfmt_misc binfmt_misc rw\n'}, {entries:[String(process.pid),'4194000']}])
 test('B5: harmless binfmt_misc and vanished process entries do not prevent a complete proof',async()=>{const x=setup();let restore=()=>{};try{legacy(x);restore=simulatedReboot(x.dir,options);
   assert.equal(await withIdentityFence(x.lock,lease=>lease.recovered,{timeoutMs:1000}),true);
 }finally{restore();fs.rmSync(x.dir,{recursive:true,force:true});}});
for(const kind of ['live','o-excl','exhausted'])test(`B6: ${kind} succession blocks legacy recovery without removing any generation`,async()=>{
 const x=setup();let restore=()=>{};try{legacy(x);restore=simulatedReboot(x.dir);const original=fs.readFileSync(x.lock);const generation=readIdentityLock(x.lock).holder.token;let predecessor=generation;
   const count=kind==='exhausted'?8:1;
   for(let i=0;i<count;i++){const token=String(i+1).padStart(32,'0');const pid=kind==='live'?process.pid:spawnSync(process.execPath,['-e','process.exit(0)']).pid;
     fs.writeFileSync(x.lock+'.succ.'+predecessor,JSON.stringify({recordVersion:2,protocol:'identity-binding-fence-v1',platform:'linux',publication:kind==='o-excl'?'o-excl':'link',...identitySelf(),pid,token,fenceEpoch:token,target:generation,at:Date.now()}));predecessor=token;}
   await assert.rejects(()=>withIdentityFence(x.lock,()=>assert.fail('blocked succession'),{timeoutMs:150,pollMs:10}),e=>{assert.equal(e.diagnostic.blockerType,'SUCC',JSON.stringify(e.diagnostic));assert.equal(e.diagnostic.reasonCode,kind==='live'?'holder-live':kind==='o-excl'?'publication-o-excl':'succ-chain-exhausted');return true;});
   assert.deepEqual(fs.readFileSync(x.lock),original);assert.equal(fs.readdirSync(join(x.root,'identity')).filter(n=>n.includes('.succ.')).length,count);
 }finally{restore();fs.rmSync(x.dir,{recursive:true,force:true});}});
test('B5: a real live legacy writer with its lock FD closed is retained, then normal release permits acquisition',async()=>{
 const x=setup();let child,restore=()=>{};let timer;try{const binder=pathToFileURL(join(process.env.IDLOCK_LANE,'base/packages/h2a/dist/runtime/identity/bindings.js')).href;
   const marker=join(x.dir,'release'),ready=join(x.dir,'ready');
   const code=`import fs from 'node:fs';import {reclaimOrMint} from ${JSON.stringify(binder)};reclaimOrMint(${JSON.stringify(x.root)},${JSON.stringify(key)},{verifyProof:()=>false,mint:()=>{fs.writeFileSync(${JSON.stringify(ready)},'ready');while(!fs.existsSync(${JSON.stringify(marker)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);return {instance:'claude:live:id',agentUuid:'live'};},now:()=>Date.now()});`;
   child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore'});const end=performance.now()+2000;while(!fs.existsSync(ready)){assert.ok(performance.now()<end);await new Promise(r=>setTimeout(r,10));}
   const holder=JSON.parse(fs.readFileSync(x.lock));assert.equal(holder.pid,child.pid);restore=simulatedReboot(x.dir,{innerPid:child.pid});let observed;
   const observations=[];timer=setTimeout(()=>fs.writeFileSync(marker,'release'),100);
   const result=await withIdentityFence(x.lock,lease=>lease.recovered,{timeoutMs:1000,pollMs:10,onBlocker:info=>{observations.push(info.reasonCode);}});
   assert.ok(observations.includes('legacy-pid-present'));assert.equal(result,false);
 }finally{clearTimeout(timer);restore();if(child?.exitCode===null)child.kill('SIGKILL');fs.rmSync(x.dir,{recursive:true,force:true});}
});

test('B5: simulated boot sources stay coherent while succession workers start under load', async()=>{
 const x=setup();const realNow=Date.now;let delay=0;let restore=()=>{};
 try {
   legacy(x);
   Date.now=()=>realNow()+delay;
   restore=simulatedReboot(x.dir);
   delay=5000;
   assert.equal(await withIdentityFence(x.lock,lease=>lease.recovered,{timeoutMs:1000}),true);
   assert.equal(fs.existsSync(x.lock),false);
 }finally{restore();Date.now=realNow;fs.rmSync(x.dir,{recursive:true,force:true});}
});
