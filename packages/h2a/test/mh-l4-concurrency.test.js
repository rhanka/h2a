import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createLocalStore} from '../dist/runtime/local-files/store.js';
import {establishWriterControl,mutationLock} from '../dist/runtime/handover/mutation.js';

test('should serialize eight conforming writers without losing acknowledged registry or inbox writes',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-concurrency-')),root=join(directory,'store');fs.mkdirSync(root,{mode:0o700});
 try{
  const store=createLocalStore({root});establishWriterControl(root,directory);
  const module=pathToFileURL(resolve('packages/h2a/dist/runtime/local-files/store.js')).href;
  const workers=Array.from({length:8},(_,actor)=>new Promise((accept,reject)=>{
   const script='import {createLocalStore} from '+JSON.stringify(module)+';const store=createLocalStore({root:process.argv[1]});for(let n=0;n<20;n++){const id=process.argv[2]+":"+n;store.registerInstance({id,publicKey:"key",roles:[],scopes:[],createdAt:"now"});store.putInboxMessage("recipient",{protocol:"sentropic.h2a",version:"0.1",id,type:"event",actor:{instance:id,role:"AGENTS",scope:"scope:default"},body:{kind:"message",topic:"MESSAGE",text:id},createdAt:new Date().toISOString()});}';
   const child=spawn(process.execPath,['--input-type=module','-e',script,root,String(actor)],{env:process.env,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',x=>{errors+=x;});child.on('error',reject);child.on('close',code=>code===0?accept():reject(Error(errors+' exit '+code)));
  }));await Promise.all(workers);
  assert.equal(store.listInstances().length,160);assert.equal(new Set(store.listInstances().map(x=>x.id)).size,160);
  assert.equal(store.readInbox('recipient').length,160);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('should release the filesystem exclusion after killing only its spawned lock holder',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-lock-crash-'));let child;
 try{
  const module=pathToFileURL(resolve('packages/h2a/dist/runtime/handover/mutation.js')).href;
  const script='import {mutationLock} from '+JSON.stringify(module)+';mutationLock(process.argv[1],()=>{process.stdout.write("locked"+String.fromCharCode(10));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);});';
  child=spawn(process.execPath,['--input-type=module','-e',script,directory],{env:process.env,stdio:['ignore','pipe','pipe']});
  const closed=once(child,'close');
  const data=await Promise.race([once(child.stdout,'data'),closed.then(value=>{throw Error('lock child exited before ready '+value);})]);assert.equal(data[0].toString(),'locked\n');
  child.kill('SIGKILL');await closed;
  let acquired=false;mutationLock(directory,()=>{acquired=true;});assert.equal(acquired,true);
 }finally{if(child?.exitCode===null&&child?.signalCode===null)child.kill('SIGKILL');fs.rmSync(directory,{recursive:true,force:true});}
});
