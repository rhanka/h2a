import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startCentralMcpServer} from '../dist/runtime/mcp-central.js';
import {authenticatedHttpRequest} from '../src/runtime/handover/authenticated-http.js';

test('should start the idle interval at durable readiness after slow source preparation',async()=>{
 const directory=fs.mkdtempSync(join(process.env.XDG_CACHE_HOME,'mh-l4-idle-'));let server;
 try{
  const root=join(directory,'store'),runtimeBase=join(directory,'runtime');for(const p of [root,runtimeBase])fs.mkdirSync(p,{mode:0o700});
  server=await startCentralMcpServer({root,runtimeBase,physicalPrefix:directory,env:{},idleTimeoutMs:100,sessionLeaseMs:100,
   beforeExclusiveMarkerPublish:()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}});
  assert.equal(server.kind,'started');
  const marker=JSON.parse(fs.readFileSync(server.markerPath,'utf8'));
  const response=await authenticatedHttpRequest(server.markerPath,marker,server.endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'idle-fixture',version:'1'}}})});
  assert.equal(response.status,200);await response.text();
  await Promise.race([server.closed,delay(2500).then(()=>{throw Error('orphan did not retire');})]);
  assert.equal(fs.existsSync(server.markerPath),false);
 }finally{await server?.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
