import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {resolveLiveIdentityAsync} from '../dist/runtime/identity/live.js';
import {createLocalStore} from '../dist/index.js';
import {LockTimeoutError} from '../dist/runtime/local-files/locks.js';
import {labRoot,startLiveHolder} from './helpers/mcp-fix-lab.js';

function request(root,id){return {root,cwd:root,host:'claude',name:'contention',readers:{
 env:name=>name==='CLAUDE_CODE_SESSION_ID'?id:undefined,
 codexThreadForCwd:()=>undefined,geminiSessionForCwd:()=>undefined,agyConversationForCwd:()=>undefined}};}
function slowKeySync(root,ms){
 const old={openSync:fs.openSync,closeSync:fs.closeSync,fsyncSync:fs.fsyncSync};const files=new Map();
 const descriptor=Object.getOwnPropertyDescriptor(performance,'now'),wait=Atomics.wait,now=Date.now,base=Date.now();let clock=0;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
 Date.now=()=>base+clock;
 Atomics.wait=(array,index,value,timeout)=>{if(Number.isFinite(timeout))clock+=Math.max(0,timeout);return wait(array,index,value,0);};
 fs.openSync=(path,...args)=>{const fd=old.openSync(path,...args);files.delete(fd);if(String(path)===join(root,'keys') || String(path).startsWith(join(root,'keys')+'/'))files.set(fd,String(path));return fd;};
 fs.closeSync=fd=>{files.delete(fd);return old.closeSync(fd);};
 // A controlled monotonic cost clock charges ms for each key-file fsync
 // and the requested lock waits. All real fsyncs still execute; CPU/disk
 // scheduling belongs to the separate real-process 20 s MCP regressions.
 fs.fsyncSync=fd=>{
  const result=old.fsyncSync(fd);
  if(files.has(fd) && files.get(fd)!==join(root,'keys'))clock+=ms;
  return result;
 };
 syncBuiltinESMExports();
 return ()=>{Object.assign(fs,old);Atomics.wait=wait;Date.now=now;if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;syncBuiltinESMExports();};
}

test('should bind within one deadline after registry contention with slow durable key syncs',async()=>{
 const root=labRoot();const holder=startLiveHolder({root,lock:'registry'});const mintMemo={},prepCache={};let restore=()=>{};
 try {
  await holder.ready;restore=slowKeySync(root,250);
  const deadline=performance.now()+2000;
  const options=()=>({mintMemo,prepCache,registryLockTimeoutMs:20,deadlineMs:Math.max(0,deadline-performance.now())});
  for(let i=0;i<4;i++)await assert.rejects(resolveLiveIdentityAsync(request(root,'slow-sync'),options()),e=>e instanceof LockTimeoutError && e.lockPath===join(root,'registry','.lock'));
  await holder.stop();
  const result=await resolveLiveIdentityAsync(request(root,'slow-sync'),options());
  assert.ok(performance.now()<deadline,'contention and durable publication share the original 2 s deadline');
  assert.equal(result.action,'mint');
  assert.equal(createLocalStore({root}).listInstances().length,1);
  assert.equal(fs.readFileSync(join(root,'identity','bindings.jsonl'),'utf8').trim().split('\n').length,1);
 }finally{restore();await holder.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('should reread a replaced keypair between contended attempts before registering or binding it',async()=>{
 const root=labRoot();const holder=startLiveHolder({root,lock:'registry'});const mintMemo={},prepCache={};
 try {
  await holder.ready;const options={mintMemo,prepCache,registryLockTimeoutMs:20,deadlineMs:2000};
  await assert.rejects(resolveLiveIdentityAsync(request(root,'rotated-sync'),options),e=>e instanceof LockTimeoutError);
  const paths=join(root,'keys',mintMemo.value.instance.replace(/[:/]/g,'-'));
  const pair=generateKeyPairSync('ed25519');const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
  fs.writeFileSync(paths+'.key.pem',pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  fs.writeFileSync(paths+'.pub.pem',publicKey);
  await holder.stop();
  const result=await resolveLiveIdentityAsync(request(root,'rotated-sync'),options);
  assert.equal(fs.readFileSync(result.publicKeyPath,'utf8'),publicKey);
  assert.deepEqual(createLocalStore({root}).listInstanceKeys(result.instance),[publicKey]);
  assert.equal(fs.readFileSync(join(root,'identity','bindings.jsonl'),'utf8').trim().split('\n').length,1);
 }finally{await holder.stop();fs.rmSync(root,{recursive:true,force:true});}
});
