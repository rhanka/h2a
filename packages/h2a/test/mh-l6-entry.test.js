import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { managedImage } from './helpers/mh-l5-image.js';
import {createManifest} from '../src/runtime/handover/image.js';
import {digest} from '../src/runtime/handover/wire.js';
import {readState,replaceState} from '../src/runtime/handover/state.js';
const test=(name,body)=>{if(!process.env.MH_L6_CASE||process.env.MH_L6_CASE===name)nodeTest(name,body);};

test('U12 should reject an external loading profile on the real direct image CLI before reporting its version',async t=>{
 const f=await fixture();
 const decoy=join(f.dir,'external-loader.mjs');fs.writeFileSync(decoy,'export {};\n');
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 const r=spawnSync(process.execPath,['--import='+decoy,join(f.image,'dist/bin.js'),'--version'],{env,encoding:'utf8',timeout:15000});
 assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1,r.stdout+r.stderr);
 assert.match(r.stderr,/external_loader_unqualified/);assert.equal(r.stdout,'');
});

let shared;
after(async()=>{if(shared)await shared.close();});
async function fixture(){return shared??=await managedImage();}
function run(f,entry=join(f.image,'dist/bin.js'),args=[]){const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;const r=spawnSync(process.execPath,[...args,entry,'--version'],{env,encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;}
async function descriptor(f,value,body,probeSource){
 const original=f.image,ep=join(original,'execution.json'),mp=join(original,'manifest.json'),eb=fs.readFileSync(ep),mb=fs.readFileSync(mp);
 const epMode=fs.statSync(ep).mode&0o777;
 const bin=join(original,'dist/bin.js'),binBytes=fs.readFileSync(bin);
 let moved;
 try{
  if(value===null)fs.unlinkSync(ep);else fs.writeFileSync(ep,JSON.stringify(value)+'\n');
  if(probeSource)fs.writeFileSync(bin,probeSource);
  const manifest=createManifest(original,JSON.parse(mb));fs.writeFileSync(mp,JSON.stringify(manifest)+'\n');
  const manifestDigest=digest(manifest);moved=join(f.installation.managedRoot,'images',manifestDigest.slice(7));fs.renameSync(original,moved);f.image=moved;
  globalThis[Symbol.for('h2a.test.closedBuildReceipt')]?.({kind:'image',digest:manifestDigest});
  const old=readState(f.selectionPath,'selection');replaceState(f.selectionPath,{...old.value,selectionEpoch:old.value.selectionEpoch+1,manifestDigest},'selection',old);
  await body();
 }finally{
  if(moved){fs.renameSync(moved,original);f.image=original;}
  fs.writeFileSync(ep,eb,{mode:epMode});fs.chmodSync(ep,epMode);fs.writeFileSync(mp,mb);fs.writeFileSync(bin,binBytes);
  const old=readState(f.selectionPath,'selection');replaceState(f.selectionPath,{...old.value,selectionEpoch:old.value.selectionEpoch+1,manifestDigest:f.payload.manifestDigest},'selection',old);
 }
}

test('U12 should execute the real image CLI with qualified memory options and its exact version',async()=>{
 const f=await fixture(),r=run(f,undefined,['--max-old-space-size=256']);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),f.payload.coreVersion);
});
test('U12 should require the immutable loader on the real direct image path',async()=>{
 const f=await fixture(),p=join(f.installation.managedRoot,'bootstrap',f.payload.execution.filename),bytes=fs.readFileSync(p);
 try{fs.unlinkSync(p);const r=run(f);assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.stdout,'');assert.match(r.stderr,/ENOENT/);}finally{fs.writeFileSync(p,bytes,{mode:0o700});}
});
test('U12 should verify the loader before even its first instruction executes on a direct image path',async()=>{
 const f=await fixture(),p=join(f.installation.managedRoot,'bootstrap',f.payload.execution.filename),bytes=fs.readFileSync(p),marker=join(f.dir,'unverified-loader-effect');
 try{fs.writeFileSync(p,`import{writeFileSync as unverifiedEffect}from'node:fs';unverifiedEffect(${JSON.stringify(marker)},'loaded');\n`+bytes);const r=run(f);assert.equal(r.status,1);assert.match(r.stderr,/image_loader_integrity/);assert.equal(fs.existsSync(marker),false);}finally{fs.writeFileSync(p,bytes);fs.rmSync(marker,{force:true});}
});
test('U12 should refuse an unknown execution descriptor even when its payload hash is valid',async()=>{
 const f=await fixture(),value=JSON.parse(fs.readFileSync(join(f.image,'execution.json')));await descriptor(f,{...value,unknown:true},async()=>{const r=run(f);assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/image_execution_descriptor_invalid/);assert.equal(r.stdout,'');});
});
test('U12 should refuse a missing execution descriptor on an otherwise valid image',async()=>{
 const f=await fixture();await descriptor(f,null,async()=>{const r=run(f);assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/ENOENT/);assert.equal(r.stdout,'');});
});
test('U12 should route the real mutable npm entry into the verified selected image',async()=>{
 const f=await fixture(),npm=join(f.dir,'lib/node_modules/@sentropic/h2a');fs.cpSync(join(f.image,'node_modules/@sentropic/h2a'),npm,{recursive:true});
 const path=join(npm,'package.json'),meta=JSON.parse(fs.readFileSync(path));meta.version='99.99.99';fs.writeFileSync(path,JSON.stringify(meta));
 const r=run(f,join(npm,'dist/bin.js'));assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),f.payload.coreVersion);
});

test('U04 should preserve the exact selected argv entry and PID when the real npm router imports it',async()=>{
 const f=await fixture(),npm=join(f.dir,'lib/node_modules/@sentropic/h2a');fs.cpSync(join(f.image,'node_modules/@sentropic/h2a'),npm,{recursive:true});
 const value=JSON.parse(fs.readFileSync(join(f.image,'execution.json')));
 const probe="process.stdout.write(JSON.stringify({entry:process.argv[1],pid:process.pid,root:globalThis[Symbol.for('sentropic.h2a.image-context/v1')].root})+'\\n');";
 await descriptor(f,value,async()=>{const r=run(f,join(npm,'dist/bin.js'));assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.entry,join(f.image,'dist/bin.js'));assert.equal(result.pid,r.pid);assert.equal(result.root,f.image);},probe);
});
