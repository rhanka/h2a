import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { managedImage } from './helpers/mh-l5-image.js';
import { createManifest } from '../src/runtime/handover/image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { readState,replaceState } from '../src/runtime/handover/state.js';
const test=(name,body)=>{if(!process.env.MH_L6_CASE||process.env.MH_L6_CASE===name)nodeTest(name,body);};
let shared;after(async()=>{if(shared)await shared.close();});
async function fixture(){
 if(shared)return shared;
 const f=await managedImage();shared=f;
 const version=f.payload.coreVersion.split('.').map(Number);version[2]++;f.availableVersion=version.join('.');
 fs.copyFileSync(new URL('./helpers/mh-l6-execution-harness.mjs',import.meta.url),join(f.image,'execution-harness.mjs'));
 fs.writeFileSync(join(f.image,'unguarded-child.mjs'),"if(process.env.EXTERNAL_MODULE_URL)await import(process.env.EXTERNAL_MODULE_URL);process.stdout.write(JSON.stringify({verified:Boolean(globalThis[Symbol.for('sentropic.h2a.image-context/v1')]),nodePath:process.env.NODE_PATH??null})+'\\n');");
 const manifest=createManifest(f.image,f.payload.manifest),manifestDigest=digest(manifest),root=join(f.installation.managedRoot,'images',manifestDigest.slice(7));
 fs.writeFileSync(join(f.image,'manifest.json'),JSON.stringify(manifest)+'\n');fs.renameSync(f.image,root);f.image=root;f.payload={...f.payload,root,manifest,manifestDigest};
 globalThis[Symbol.for('h2a.test.closedBuildReceipt')]?.({kind:'image',digest:manifestDigest,entrypoints:['execution-harness.mjs']});
 const old=readState(f.selectionPath,'selection');replaceState(f.selectionPath,{...old.value,selectionEpoch:old.value.selectionEpoch+1,manifestDigest},'selection',old);
 return f;
}
function run(f,mode,extra={}){
 fs.writeFileSync(join(f.dir,'external-app.mjs'),"import fs from'node:fs';import{basename}from'node:path';process.stdout.write(JSON.stringify({label:basename(process.argv[2]),hasBytes:fs.readFileSync(process.argv[2]).length>0,restricted:Boolean(globalThis[Symbol.for('sentropic.h2a.image-context/v1')])})+'\\n');");
 fs.rmSync(join(f.dir,'unverified-worker'),{force:true});const cache=join(f.root,'upgrade-check.json');fs.writeFileSync(cache,JSON.stringify({checkedAt:Date.now(),latest:mode==='boot-auto'?f.payload.coreVersion:f.availableVersion}));
 const env={...process.env,H2A_ROOT:f.root,EXECUTION_MARKER:join(f.dir,'unverified-worker'),JOURNAL_LOG:join(f.dir,mode==='journal-alter'?'altered-journal.log':'journal.log'),npm_config_prefix:f.dir,npm_config_cache:join(f.dir,'npm-cache'),npm_config_offline:'true',EXTERNAL_PROGRAM:join(f.dir,'external-app.mjs'),...extra};delete env.NODE_OPTIONS;delete env.NODE_PATH;delete env.H2A_UPGRADE_REEXECED;
 const r=spawnSync(process.execPath,[join(f.image,'execution-harness.mjs'),mode],{env,cwd:f.dir,encoding:'utf8',timeout:20000});
 assert.equal(r.error,undefined,r.stderr);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}

test('U12 should prevent the real MCP boot worker from executing code changed after its parent verified the image',async()=>{
 const f=await fixture(),r=run(f,'boot-alter');assert.equal(r.marker,false,'a real production boot worker must not execute altered image code');
 assert.equal(r.code,1);assert.match(r.stderr,/payload_mismatch/);assert.equal(r.serverCode,0);
 assert.ok(r.identity.pid>0);assert.ok(Number.isSafeInteger(r.identity.birth)&&r.identity.birth>0);
});

for(const mode of ['journal','identity'])test('U12 should run the real '+mode+' child from its verified image and join its exit',async()=>{
 const f=await fixture(),r=run(f,mode);assert.equal(r.code,0,JSON.stringify(r));assert.equal(r.preload,true);assert.equal(r.marker,false);
 assert.ok(r.identity.pid>0);assert.ok(Number.isSafeInteger(r.identity.birth)&&r.identity.birth>0);
 if(mode==='journal'){assert.equal(r.observed.written,true);assert.equal(r.rows.length,1);assert.equal(r.rows[0].generation,'fixture-journal');}
 else{assert.equal(r.result.kind,'resolved',JSON.stringify(r));assert.equal(r.result.value.instance,'claude:fixture-identity');assert.equal(r.result.value.delegationEligible,false);assert.equal(r.result.value.privateKeyPath,'');}
});
for(const mode of ['journal','identity'])test('U12 should prevent the real '+mode+' child from executing late altered code',async()=>{
 const f=await fixture(),r=run(f,mode+'-alter');assert.equal(r.marker,false,'altered '+mode+' code must have no effect');assert.equal(r.code,1);assert.equal(r.preload,true);
 if(mode==='journal'){assert.match(r.stderr,/payload_mismatch/);assert.deepEqual(r.rows,[]);}
 else{assert.equal(r.result.kind,'exit');assert.match(r.diagnostics.join('\n'),/payload_mismatch/);}
});

for(const method of ['spawn','spawnSync','execFile','execFileSync'])test('U12 should allow an external Node application to receive image data through '+method,async()=>{
 const f=await fixture(),r=run(f,'external-'+method);assert.equal(r.code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{label:'manifest.json',hasBytes:true,restricted:false});
});
for(const method of ['spawn','execFile','execFileSync'])test('U12 should install the reader before an unguarded internal entry through '+method,async()=>{
 const f=await fixture(),r=run(f,'internal-'+method);assert.equal(r.code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{verified:true,nodePath:null});
});
for(const method of ['spawn','execFile','execFileSync'])test('U12 should refuse an external late import from the internal '+method+' entry',async()=>{
 const f=await fixture(),decoy=join(f.dir,'external-module.mjs');fs.writeFileSync(decoy,`import fs from'node:fs';fs.writeFileSync(${JSON.stringify(join(f.dir,'unverified-worker'))},'loaded');`);
 const r=run(f,'internal-'+method,{EXTERNAL_MODULE_URL:new URL('file://'+decoy).href});assert.equal(r.code,1,r.stderr);assert.match(r.stderr,/image_external_module/);assert.equal(r.marker,false);
});
for(const mode of ['boot-check','boot-auto'])test('U12 should run the real file boot worker in '+mode+' mode without network or prefix escape',async()=>{
 const f=await fixture(),selectionBefore=fs.readFileSync(f.selectionPath,'utf8'),r=run(f,mode);assert.equal(r.code,0,r.stderr);assert.equal(r.stdout,'');
 if(mode==='boot-check')assert.ok(r.stderr.includes(`${f.availableVersion} available (current ${f.payload.coreVersion})`),r.stderr);
 // Since LOT-1 the worker enters the single H4 pass. Offline the automatic
 // pass is a recorded best-effort no-op (target_unresolvable): the failure
 // surfaces once per TTL window (like the legacy non-quiet outcomes),
 // writes no legacy staged-engine cache fields, advances no journal
 // transaction and leaves the durable selection alone.
 else{assert.ok(r.stderr.includes('auto-upgrade target_unresolvable (current '),r.stderr);
  assert.equal(r.cache.lastAutoOutcome,'no-op');assert.equal(r.cache.lastAutoReason,'target_unresolvable');assert.ok(r.cache.lastAutoAt>0);
  assert.equal(r.cache.lastOutcome,undefined,'no legacy staged-engine outcome');assert.equal(r.cache.lastAttemptVersion,undefined,'no legacy attempt version');
  assert.equal(fs.readFileSync(f.selectionPath,'utf8'),selectionBefore,'durable selection untouched');
  const txDir=join(f.installation.managedRoot,'state','upgrade','transactions');
  assert.deepEqual(fs.existsSync(txDir)?fs.readdirSync(txDir):[],[],'no journal transaction opened');}
});

for(const mode of ['alias-fork','alias-node','alias-spawn'])test('U12 should bind physical image execution through '+mode+' before any external effect',async()=>{
 const f=await fixture(),decoy=join(f.dir,'alias-external-module.mjs');fs.writeFileSync(decoy,`import fs from'node:fs';fs.writeFileSync(${JSON.stringify(join(f.dir,'unverified-worker'))},'loaded');`);
 const r=run(f,mode,{EXTERNAL_MODULE_URL:new URL('file://'+decoy).href});assert.equal(r.marker,false,'a physical image alias must retain the image reader');assert.equal(r.code,1);assert.match(r.stderr,/image_external_module/);
});

test('U12 should refuse an unqualified Node URL entry before it can escape the image reader',async()=>{
 const f=await fixture(),decoy=join(f.dir,'uri-external-module.mjs');fs.writeFileSync(decoy,`import fs from'node:fs';fs.writeFileSync(${JSON.stringify(join(f.dir,'unverified-worker'))},'loaded');`);
 const r=run(f,'entry-uri',{EXTERNAL_MODULE_URL:new URL('file://'+decoy).href});assert.equal(r.marker,false,'a URL entry must not bypass the image reader');assert.equal(r.blockedBeforeSpawn,true);assert.match(r.stderr,/external_loader_unqualified/);
});

test('U12 should leave opaque data arguments untouched after identifying the image entry',async()=>{
 assert.notEqual(process.getuid(),0,'qualification requires an ordinary owned prefix');const f=await fixture(),r=run(f,'opaque-data');assert.equal(r.code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{verified:true,nodePath:null});
});

test('U12 should guard the real boot file on a direct Node entry outside its parent launcher',async()=>{
 const f=await fixture(),decoy=join(f.dir,'direct-worker-loader.mjs');fs.writeFileSync(decoy,'export {};\n');fs.writeFileSync(join(f.root,'upgrade-check.json'),JSON.stringify({checkedAt:Date.now(),latest:'0.98.6'}));
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 const r=spawnSync(process.execPath,['--import='+decoy,join(f.image,'node_modules/@sentropic/h2a/dist/runtime/upgrade/boot-worker.js'),f.root,'3600000','check'],{env,cwd:f.dir,encoding:'utf8',timeout:15000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/external_loader_unqualified/);assert.equal(r.stdout,'');
});
