import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { hostname,tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { readIdentityLock } from '../dist/runtime/local-files/identity-fence.js';
const helper=fileURLToPath(new URL('./helpers/identity-election-barrier.mjs',import.meta.url));
let prefix;
test.before(()=>{
 prefix=fs.mkdtempSync(join(tmpdir(),'published-unlock-'));
 const installed=spawnSync('npm',['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','@sentropic/h2a@0.98.5','@sentropic/h2a-runtime@0.98.5'],{env:{...process.env,npm_config_ignore_scripts:'true'},encoding:'utf8',timeout:60_000});
 assert.equal(installed.status,0,installed.stdout+installed.stderr);
 assert.equal(JSON.parse(fs.readFileSync(join(prefix,'node_modules/@sentropic/h2a/package.json'))).version,'0.98.5');
 console.log('Published CLI installed: npm install --prefix '+prefix+' --ignore-scripts @sentropic/h2a@0.98.5; exit '+installed.status);
});
test.after(()=>fs.rmSync(prefix,{recursive:true,force:true}));
const wait=async(read,accept,deadline=performance.now()+15_000)=>{for(;;){const value=read();if(accept(value))return value;assert.ok(performance.now()<deadline,'race observation deadline: '+JSON.stringify(value));await new Promise(r=>setTimeout(r,5));}};

for(const winner of ['old','recovery'])test(`R6: published 0.98.5 unlock vs recovery, ${winner} wins the real election`,async()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'unlock-race-')),root=join(dir,'store'),lock=join(root,'identity/.lock');fs.mkdirSync(join(root,'identity'),{recursive:true});
 const dead=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(dead.status,0);
 const record={pid:dead.pid,hostname:hostname(),startedAt:new Date().toISOString(),protocol:'identity-binding-fence-v1',fenceEpoch:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
 const original=Buffer.from(JSON.stringify(record));fs.writeFileSync(lock,original);
 const generation=readIdentityLock(lock).holder.token,children=[];
 const worker=join(dir,'recovery.mjs');
 const fence=pathToFileURL(resolve(import.meta.dirname,'../dist/runtime/local-files/identity-fence.js')).href;
 const fixture=pathToFileURL(resolve(import.meta.dirname,'helpers/legacy-proc-fixture.mjs')).href;
 fs.writeFileSync(worker,`import fs from 'node:fs';import {withIdentityFence} from ${JSON.stringify(fence)};import {simulatedReboot} from ${JSON.stringify(fixture)};const restore=simulatedReboot(${JSON.stringify(dir)});try{await withIdentityFence(${JSON.stringify(lock)},async lease=>{fs.writeFileSync(${JSON.stringify(join(dir,'recovery.held'))},JSON.stringify({recovered:lease.recovered,pid:process.pid}));const end=performance.now()+15000;while(!fs.existsSync(${JSON.stringify(join(dir,'recovery.release'))})){if(performance.now()>=end)throw Error('possession deadline');await new Promise(r=>setTimeout(r,5));}},{timeoutMs:15000,pollMs:5});}finally{restore();}`);
 function launch(role,args) {
  const child=spawn(process.execPath,args,{cwd:dir,env:{...process.env,H2A_ROOT:root,H2A_TEST_ELECTION_DIR:dir,H2A_TEST_ELECTION_ROLE:role,H2A_TEST_ELECTION_PATH:lock+'.succ.'+generation,NODE_OPTIONS:(process.env.NODE_OPTIONS??'')+' --import='+helper},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const exit=once(child,'exit');children.push(child);return{child,exit,output:()=>({stdout,stderr})};
 }
 const oldBin=join(prefix,'node_modules/@sentropic/h2a/dist/bin.js'),unlock=['identity','unlock','--root',root,'--token',generation,'--assert-dead'];
 try {
  const old=launch('old',[oldBin,...unlock]),recovery=launch('recovery',[worker]);
  await wait(()=>['old','recovery'].every(role=>fs.existsSync(join(dir,role+'.before'))),Boolean);
  fs.writeFileSync(join(dir,winner+'.go'),'release');await wait(()=>fs.existsSync(join(dir,winner+'.elected')),Boolean);
  const loser=winner==='old'?'recovery':'old';fs.writeFileSync(join(dir,loser+'.go'),'release');
  await wait(()=>fs.existsSync(join(dir,loser+'.lost'))||fs.existsSync(join(dir,loser+'.elected')),Boolean);
  assert.deepEqual(fs.readFileSync(lock),original,'no contender removes the old generation before its elected owner retires it');
  assert.equal(fs.existsSync(join(dir,loser+'.elected')),false,'exactly one exclusive link wins');
  if(winner==='recovery'){assert.equal((await old.exit)[0],1);assert.equal(JSON.parse(old.output().stdout).broken,false);}
  fs.writeFileSync(join(dir,winner+'.retire'),'release');
  if(winner==='old'){assert.equal((await old.exit)[0],0,JSON.stringify(old.output()));assert.equal(JSON.parse(old.output().stdout).broken,true);}
  const held=await wait(()=>fs.existsSync(join(dir,'recovery.held'))?JSON.parse(fs.readFileSync(join(dir,'recovery.held'))):undefined,Boolean);
  assert.equal(held.recovered,winner==='recovery');
  const replacement=fs.readFileSync(lock);assert.equal(JSON.parse(replacement).pid,recovery.child.pid);
  const stale=spawnSync(process.execPath,[oldBin,...unlock],{cwd:dir,env:{...process.env,H2A_ROOT:root},encoding:'utf8',timeout:15_000});
  assert.equal(stale.status,1,stale.stderr);assert.equal(JSON.parse(stale.stdout).reason,'token-mismatch');
  assert.deepEqual(fs.readFileSync(lock),replacement,'old unlock cannot lose the fresh held lock');
  fs.writeFileSync(join(dir,'recovery.release'),'release');assert.equal((await recovery.exit)[0],0,JSON.stringify(recovery.output()));
  assert.equal(fs.existsSync(lock),false);assert.equal(fs.readdirSync(join(root,'identity')).some(n=>n.includes('.succ.')),false);
  console.log(JSON.stringify({winner,exclusiveWinners:1,oldExit:old.child.exitCode,recoveryExit:recovery.child.exitCode,freshLockPreserved:true}));
 }finally{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const gone=once(child,'exit');child.kill('SIGKILL');await gone;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
