// Loads on 0.98.5 too: the red is a behavioral timeout, never an import error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { reclaimOrMint, reclaimOrMintAsync } from '../dist/runtime/identity/bindings.js';
import { proofDeps } from './helpers/identity-proof-fixture.mjs';
import { simulatedReboot } from './helpers/legacy-proc-fixture.mjs';
for(const mode of ['sync','async'])test(`incident: ${mode} public binding path recovers a previous-boot legacy and preserves its existing identity`,async()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'incident-0985-'));const root=join(dir,'store');let restore=()=>{};
 try{const key={host:'claude',providerSessionId:'incident',workspaceId:'ws'};const deps=proofDeps(root,{verifyProof:()=>true,mint:()=>({instance:'claude:incident:id',agentUuid:'incident'}),now:()=>Date.now()});
   const first=reclaimOrMint(root,key,deps);const old=pathToFileURL(join(process.env.IDLOCK_LANE,'base/packages/h2a/dist/runtime/identity/bindings.js')).href;
   const code=`import {reclaimOrMint} from ${JSON.stringify(old)};reclaimOrMint(${JSON.stringify(root)},${JSON.stringify(key)},{verifyProof:()=>false,mint:()=>process.exit(0),now:()=>Date.now()});`;
   const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(fs.readFileSync(join(root,'identity','.lock'))).pid,child.pid);
   restore=simulatedReboot(dir);const start=performance.now();
   const result=mode==='sync'?reclaimOrMint(root,key,deps,{deadlineMs:1000}):await reclaimOrMintAsync(root,key,deps,{deadlineMs:1000});
   assert.equal(result.action,'reclaim');assert.equal(result.instance,first.instance);assert.ok(performance.now()-start<=2000);
 }finally{restore();fs.rmSync(dir,{recursive:true,force:true});}
});
