import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
test('capsule keeps exact hashed bytes under a Windows CRLF checkout',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),temp=mkdtempSync(join(tmpdir(),'f2-crlf-'));
 try{const prefix='packages/h2a-runtime/src/fixtures/session-content/v2/';
   const files=JSON.parse(readFileSync(join(root,prefix,'manifest.json'),'utf8')).files.map(f=>prefix+f.path);
   const checkout=spawnSync('git',['-c','core.autocrlf=true','-C',root,'checkout-index','--force','--prefix='+temp+'/', '--',...files,prefix+'manifest.json','scripts/copy-session-content-capsule.mjs'],{encoding:'utf8'});
   assert.equal(checkout.status,0,checkout.stderr);
   const result=spawnSync(process.execPath,[join(temp,'scripts/copy-session-content-capsule.mjs')],{encoding:'utf8'});
   assert.equal(result.status,0,result.stdout+result.stderr);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
