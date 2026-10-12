import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveLiveIdentity } from '../dist/runtime/identity/live.js';

test('B incident: the real MCP JSON-RPC stdio transport reaches identity_ready within two seconds and reclaims the old identity',async()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'idlock-stdio-'));const root=join(dir,'store');let child;
 try{const readers={env:name=>name==='CLAUDE_CODE_SESSION_ID'?'stdio-incident':undefined,codexThreadForCwd:()=>undefined,geminiSessionForCwd:()=>undefined,agyConversationForCwd:()=>undefined};
   const first=resolveLiveIdentity({root,cwd:dir,host:'claude',name:'incident',readers});
   const base=pathToFileURL(join(process.env.IDLOCK_LANE,'base/packages/h2a/dist/runtime/identity/bindings.js')).href;
   const code=`import {reclaimOrMint} from ${JSON.stringify(base)};reclaimOrMint(${JSON.stringify(root)},{host:'claude',providerSessionId:'stdio-incident',workspaceId:'ws'},{verifyProof:()=>false,mint:()=>process.exit(0),now:()=>Date.now()});`;
   const holder=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(holder.status,0,holder.stderr);
   const start=performance.now();child=spawn(process.execPath,['--import',join(import.meta.dirname,'helpers/legacy-reboot-loader.mjs'),join(import.meta.dirname,'helpers/identity-stdio-child.mjs'),root],
     {env:{...process.env,IDLOCK_SIM_ROOT:root,CLAUDE_CODE_SESSION_ID:'stdio-incident'},stdio:['pipe','pipe','pipe']});
   let buffer='',stderr='';let sequence=0;const responses=new Map();
   child.stderr.on('data',b=>stderr+=b);child.stdout.on('data',b=>{buffer+=b;for(let end=buffer.indexOf('\n');end>=0;end=buffer.indexOf('\n')){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let row;try{row=JSON.parse(line);}catch{continue;}if(responses.has(row.id)){responses.get(row.id)(row);responses.delete(row.id);}}});
   const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{responses.delete(id);reject(new Error('RPC timeout: '+stderr));},2000);responses.set(id,row=>{clearTimeout(timer);resolve(row);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
   const init=await rpc('initialize',{});assert.ok(init.result.serverInfo);
   let state;while(performance.now()-start<2000){const response=await rpc('tools/call',{name:'h2a_identity_status',arguments:{}});assert.ok(response.result);state=JSON.parse(response.result.content[0].text);if(state.state==='identity_ready')break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(state.state,'identity_ready',stderr);assert.equal(state.instance,first.instance);assert.ok(performance.now()-start<=2000);
 }finally{if(child && child.exitCode===null){child.stdin.end();await new Promise(r=>setTimeout(r,100));if(child.exitCode===null)child.kill('SIGKILL');}fs.rmSync(dir,{recursive:true,force:true});}
});
test('R7: the actual 0.98.5 parent accepts a 0.98.6 worker with a v1 request and ignorable observations',async()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'idlock-old-parent-'));const root=join(dir,'store');let controller;
 try{const readers={env:name=>name==='CLAUDE_CODE_SESSION_ID'?'old-parent':undefined,codexThreadForCwd:()=>undefined,geminiSessionForCwd:()=>undefined,agyConversationForCwd:()=>undefined};
   const first=resolveLiveIdentity({root,cwd:dir,host:'claude',name:'fixture',readers});
   const base=join(process.env.IDLOCK_LANE,'base/packages/h2a/dist');const binder=pathToFileURL(join(base,'runtime/identity/bindings.js')).href;
   const code=`import {reclaimOrMint} from ${JSON.stringify(binder)};reclaimOrMint(${JSON.stringify(root)},{host:'claude',providerSessionId:'old-parent',workspaceId:'ws'},{verifyProof:()=>false,mint:()=>process.exit(0),now:()=>Date.now()});`;
   const holder=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(holder.status,0,holder.stderr);
   const parentFile=join(base,'runtime/mcp/identity-state.js');const original=fs.readFileSync(parentFile,'utf8');const anchor='new URL("../identity/worker.js", import.meta.url)';assert.equal(original.split(anchor).length,2);
   const worker=pathToFileURL(join(import.meta.dirname,'../dist/runtime/identity/worker.js')).href;const copied=join(base,'runtime/mcp/identity-parent-compat.js');fs.writeFileSync(copied,original.replace(anchor,`new URL(${JSON.stringify(worker)})`));
   const {createIdentityController}=await import(pathToFileURL(copied));const start=performance.now();
   controller=createIdentityController({request:{root,cwd:root,host:'claude',name:'fixture',providerEnv:{CLAUDE_CODE_SESSION_ID:'old-parent',IDLOCK_SIM_ROOT:root,NODE_OPTIONS:process.env.NODE_OPTIONS+' --import '+join(import.meta.dirname,'helpers/legacy-reboot-loader.mjs')}},timeoutMs:2000,activate:identity=>({ok:true,sessionId:'compatible'})});controller.start();
   while(controller.status().state==='identity_pending' && performance.now()-start<2000)await new Promise(r=>setTimeout(r,10));
   assert.equal(controller.status().state,'identity_ready');assert.equal(controller.status().instance,first.instance);
 }finally{controller?.cancel('transport_closed');await new Promise(r=>setTimeout(r,100));fs.rmSync(dir,{recursive:true,force:true});}
});
