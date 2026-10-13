import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentityController, forkIdentityWorker } from '../dist/runtime/mcp/identity-state.js';
import { existsSync } from 'node:fs';
import { createMcpServer } from '../dist/runtime/mcp/server.js';
import { identitySelf } from '../dist/runtime/local-files/identity-fence.js';
test('R7: a parent timer retains the current contention observation and rejects old attempts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'idlock-mcp-'));let cb;let context;const logs=[];
 const c=createIdentityController({request:{root,host:'claude',cwd:root},timeoutMs:50,retryMinIntervalMs:0,
   log:l=>logs.push(l),spawnWorker:(_r,_b,ctx)=>{context=ctx;return {onObservation:f=>cb=f,onError(){},onResolved(){},onExitWithoutResult(){},cancel(){}};},activate:()=>{throw new Error('must not activate');}});
 try{c.start();assert.equal(typeof cb,'function','observations must be wired');assert.equal(context.diagnosticKey.length,64);
   const attemptId=c.status().attemptId;const diagnostic={blockerType:'LOCK',generation:'legacy-'+ 'a'.repeat(64),target:'unknown',reasonCode:'legacy-pid-present',reason:'PID present',pid:123,machineClass:'unknown',bootClass:'unknown',ns:'unknown',start:'unknown',retryCondition:'interval'};
   cb({attemptId,sequence:1,diagnostic,stabilityKey:'same'});cb({attemptId:'obsolete',sequence:100,diagnostic:{...diagnostic,reasonCode:'wrong'},stabilityKey:'same'});
   await new Promise(r=>setTimeout(r,80));const st=c.status();assert.equal(st.cause,'identity_timeout');assert.equal(st.diagnostic.reasonCode,'legacy-pid-present');assert.equal(st.retryCondition,'interval');assert.equal(st.diagnostic.bootClass,'unknown');assert.match(st.message,/legacy-pid-present/);assert.ok(logs.some(l=>l.includes('legacy-pid-present')));
   const firstKey=context.diagnosticKey;assert.equal(c.retry(),true);assert.equal(context.diagnosticKey,firstKey);assert.equal(c.status().lastFailure.diagnostic.reasonCode,'legacy-pid-present');
 }finally{c.cancel('transport_closed');rmSync(root,{recursive:true,force:true});}
});
test('R7: the guarded MCP tool preserves the same diagnostic and actual retry delay as status',async()=>{
 const root=mkdtempSync(join(tmpdir(),'idlock-guard-'));const diagnostic={reasonCode:'legacy-pid-present',bootClass:'unknown',retryCondition:'interval'};
 const state={state:'identity_failed',attemptId:'a',cause:'identity_timeout',message:'Legacy identity lock retained (legacy-pid-present)',retryable:true,elapsedMs:20,retryCondition:'interval',retryAfterMs:17,diagnostic};
 const identity={status:()=>state,retry:()=>false,signer:()=>undefined};
 try{const server=createMcpServer({root,identity});const response=await server.callTool('h2a_send',{});const error=JSON.parse(response.content[0].text);
   assert.equal(error.message,state.message);assert.equal(error.retryAfterMs,17);assert.equal(error.retryCondition,'interval');assert.deepEqual(error.diagnostic,diagnostic);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('R7: real worker IPC delivers the blocker before the parent timer and MCP stays responsive',async()=>{
 const root=mkdtempSync(join(tmpdir(),'idlock-ipc-'));mkdirSync(join(root,'identity'));const token='b'.repeat(32);const logs=[];
 writeFileSync(join(root,'identity','.lock'),JSON.stringify({recordVersion:2,protocol:'identity-binding-fence-v1',platform:'linux',publication:'link',...identitySelf(),token,fenceEpoch:token,at:Date.now()}));
 const c=createIdentityController({request:{root,cwd:root,host:'claude',name:'fixture',providerEnv:{CLAUDE_CODE_SESSION_ID:'ipc-observation'}},timeoutMs:1200,retryMinIntervalMs:500,log:l=>logs.push(l),activate:()=>assert.fail('live holder cannot be stolen')});
 try{const server=createMcpServer({root,identity:c});c.start();const start=performance.now();const pending=await server.callTool('h2a_identity_status',{});assert.ok(performance.now()-start<100);assert.ok(pending.content.length>0);
   await new Promise(r=>setTimeout(r,1350));const state=c.status();assert.equal(state.cause,'identity_timeout');assert.equal(state.diagnostic.reasonCode,'holder-live');assert.equal(state.retryCondition,'interval');assert.match(state.message,/holder-live/);assert.ok(logs.some(l=>l.includes('holder-live')));
   const guarded=JSON.parse((await server.callTool('h2a_send',{})).content[0].text);assert.equal(guarded.message,state.message);assert.equal(guarded.diagnostic.machineFingerprint,state.diagnostic.machineFingerprint);
 }finally{c.cancel('transport_closed');await new Promise(r=>setTimeout(r,100));rmSync(root,{recursive:true,force:true});}
});
test('R7: fork and worker startup consume the parent deadline before any mint or binding publication',async()=>{
 const root=mkdtempSync(join(tmpdir(),'idlock-startup-'));let worker;
 try{const deadlineNs=(process.hrtime.bigint()+50_000_000n).toString();
   worker=forkIdentityWorker({root,cwd:root,host:'claude',name:'startup',providerEnv:{CLAUDE_CODE_SESSION_ID:'slow-start',NODE_OPTIONS:process.env.NODE_OPTIONS+' --import '+join(import.meta.dirname,'helpers/identity-worker-slow-start.mjs')}},50,undefined,{attemptId:'startup',diagnosticKey:'a'.repeat(64),deadlineNs});
   const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker did not report within bound')),2000);worker.onError(cause=>{clearTimeout(timer);resolve({cause});});worker.onExitWithoutResult(()=>{clearTimeout(timer);reject(new Error('no terminal response'));});worker.onResolved(()=>{clearTimeout(timer);resolve({resolved:true});});});
   assert.equal(result.cause,'identity_timeout');assert.equal(existsSync(join(root,'identity','bindings.jsonl')),false);assert.equal(existsSync(join(root,'keys')),false);
 }finally{worker?.cancel('transport_closed');await new Promise(r=>setTimeout(r,100));rmSync(root,{recursive:true,force:true});}
});
