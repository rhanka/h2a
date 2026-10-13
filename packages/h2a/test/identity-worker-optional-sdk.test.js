import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createIdentityController} from '../dist/runtime/mcp/identity-state.js';

test('should resolve a real identity when unrelated transport SDK modules are unavailable in its worker', async t => {
  const root=mkdtempSync(join(tmpdir(),'identity-core-only-'));
  const loader=join(root,'deny-sdk.mjs'),preload=join(root,'preload.mjs');
  writeFileSync(loader,`export async function load(url,context,next){
    if(url.includes('/node_modules/@modelcontextprotocol/sdk/'))throw new Error('optional transport SDK unavailable in identity worker');
    return next(url,context);
  }`);
  writeFileSync(preload,`import {register} from 'node:module';
    if(process.argv[1]?.endsWith('/runtime/identity/worker.js'))register(${JSON.stringify(pathToFileURL(loader).href)});
  `);
  const controller=createIdentityController({request:{root,cwd:root,host:'claude',name:'core-only',providerEnv:{
    CLAUDE_CODE_SESSION_ID:'isolated-core-only',NODE_OPTIONS:((process.env.NODE_OPTIONS??'')+' --import='+pathToFileURL(preload).href).trim()
  }},activate:()=>({ok:true,sessionId:'isolated-core-only'})});
  t.after(()=>{controller.cancel('transport_closed');rmSync(root,{recursive:true,force:true});});
  controller.start();
  while(controller.status().state==='identity_pending')await new Promise(resolve=>setTimeout(resolve,20));
  const state=controller.status();
  assert.equal(state.state,'identity_ready',JSON.stringify(state));
  const bindings=readFileSync(join(root,'identity','bindings.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(bindings.length,1);
  assert.equal(bindings[0].instance,state.instance);
});
