import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {join,dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startCentralMcpServer} from '../dist/runtime/mcp-central.js';
import {authenticatedHttpRequest,readAuthenticationKey} from '../src/runtime/handover/authenticated-http.js';
import {sign,digest} from '../src/runtime/handover/wire.js';
import {validate} from '../src/runtime/handover/formats.js';
import {publishState,readState} from '../src/runtime/handover/state.js';

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
  // MH-L3: a lost lease does not prove the shim dead. Preserve the original
  // readiness oracle, then explicitly disconnect the quarantined transport.
  await delay(250);
  const status=await authenticatedHttpRequest(server.markerPath,marker,new URL('/_h2a-central/status',server.endpoint));
  const observed=await status.json();assert.equal(observed.attachments,1);assert.equal(observed.transports[0].state,'quarantined');
  const disconnected=await authenticatedHttpRequest(server.markerPath,marker,server.endpoint,{method:'DELETE',headers:{'mcp-session-id':response.headers.get('mcp-session-id')}});
  assert.equal(disconnected.status,200);
  await Promise.race([server.closed,delay(2500).then(()=>{throw Error('orphan did not retire');})]);
  assert.equal(fs.existsSync(server.markerPath),false);
 }finally{await server?.stop();fs.rmSync(directory,{recursive:true,force:true});}
});

test('should survive a starved event loop between durable readiness and first use',async()=>{
 const directory=fs.mkdtempSync(join(process.env.XDG_CACHE_HOME,'mh-l4-idle-'));let server;
 try{
  const root=join(directory,'store'),runtimeBase=join(directory,'runtime');for(const p of [root,runtimeBase])fs.mkdirSync(p,{mode:0o700});
  server=await startCentralMcpServer({root,runtimeBase,physicalPrefix:directory,env:{},idleTimeoutMs:100,sessionLeaseMs:100,
   beforeExclusiveMarkerPublish:()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);}});
  assert.equal(server.kind,'started');
  // CI shard preemption can stall this process past idleTimeoutMs before the
  // first request (ECONNRESET / challenge_connection_lost). Starved loop
  // time is not idle time: the server must still serve the first use.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  const marker=JSON.parse(fs.readFileSync(server.markerPath,'utf8'));
  const response=await authenticatedHttpRequest(server.markerPath,marker,server.endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'idle-fixture',version:'1'}}})});
  assert.equal(response.status,200);await response.text();
  await delay(250);
  const status=await authenticatedHttpRequest(server.markerPath,marker,new URL('/_h2a-central/status',server.endpoint));
  const observed=await status.json();assert.equal(observed.attachments,1);assert.equal(observed.transports[0].state,'quarantined');
  const disconnected=await authenticatedHttpRequest(server.markerPath,marker,server.endpoint,{method:'DELETE',headers:{'mcp-session-id':response.headers.get('mcp-session-id')}});
  assert.equal(disconnected.status,200);
  await Promise.race([server.closed,delay(2500).then(()=>{throw Error('orphan did not retire');})]);
  assert.equal(fs.existsSync(server.markerPath),false);
 }finally{await server?.stop();fs.rmSync(directory,{recursive:true,force:true});}
});

test('should re-challenge once when a handshake connection dies before dispatch',async()=>{
 // A dead keep-alive socket between challenge and POST (shard pressure RSTs
 // it, or a closing server answers Connection: close) must not fail the
 // operation: the POST was never sent, so a fresh challenge is safe and the
 // server observes exactly one POST. Real root key, real MACs, forged only
 // in placement (marker + authority state pointing at the double).
 const seed=fs.mkdtempSync(join(process.env.XDG_CACHE_HOME,'mh-l4-idle-'));
 for(const p of [join(seed,'store'),join(seed,'runtime')])fs.mkdirSync(p,{mode:0o700});
 const tmp=await startCentralMcpServer({root:join(seed,'store'),runtimeBase:join(seed,'runtime'),physicalPrefix:seed,env:{}});
 const marker0=JSON.parse(fs.readFileSync(tmp.markerPath,'utf8'));
 const key=readAuthenticationKey(tmp.markerPath,marker0);
 const domain0=readState(join(dirname(tmp.markerPath),'authority-domain.json'),'authorityDomain').value;
 const secret0=readState(join(marker0.stateDirectory,marker0.authKeyReference),'secret').value;
 await tmp.stop();
 let challenges=0,posts=0;
 const context=m=>({service:m.service,namespaceId:m.namespaceId,generation:m.generation});
 const fake=createServer((incoming,outgoing)=>{
  const path=new URL(incoming.url,'http://x').pathname;
  if(incoming.method==='GET'&&(path.startsWith('/_h2a-central/challenge/')||path.startsWith('/_h2a-central/control-challenge/'))){
   challenges++;
   const m=fake.marker;
   const payload={schemaVersion:1,clientNonce:path.split('/').at(-1),serverNonce:randomBytes(32).toString('hex'),connectionNonce:randomBytes(32).toString('hex'),
    service:m.service,namespaceId:m.namespaceId,generation:m.generation,publicationEpoch:m.publicationEpoch,processIdentity:m.processIdentity,
    endpoint:m.endpoint,endpointMode:m.endpointMode,root:m.root,uid:m.uid,state:m.state,packageVersion:m.packageVersion,buildId:m.buildId,
    manifestDigest:m.manifestDigest,mcpProtocolVersions:m.mcpProtocolVersions,descriptorDigest:m.descriptorDigest,contractDigest:m.contractDigest,
    capabilities:m.handoverCapabilities,challengeValidityMs:30000};
   const headers={'content-type':'application/json'};
   if(challenges===1)headers.connection='close';
   outgoing.writeHead(200,headers);
   outgoing.end(JSON.stringify(validate('readiness',{...payload,mac:sign(key,'readiness',context(m),payload)})));
   return;
  }
  if(incoming.method==='POST'){
   posts++;
   let raw='';
   incoming.on('data',c=>{raw+=c;});
   incoming.on('end',()=>{
    const m=fake.marker;
    const proof=JSON.parse(Buffer.from(String(incoming.headers['x-h2a-proof']),'base64url').toString());
    const header={schemaVersion:1,generation:m.generation,attachmentId:'control',transportEpoch:1,channel:'responses',sequence:1,
     payloadDigest:digest({status:200,headers:{},body:{ok:true}}),requestUid:proof.requestUid};
    const frame={header:validate('frame',{...header,mac:sign(key,'responses',context(m),header)}),
     payload:{status:200,headers:{},body:{ok:true}}};
    outgoing.writeHead(200,{'content-type':'application/json'});
    outgoing.end(JSON.stringify(frame));
   });
   return;
  }
  outgoing.writeHead(404);outgoing.end();
 });
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 const directory=fs.mkdtempSync(join(process.env.XDG_CACHE_HOME,'mh-l4-idle-'));
 const markerPath=join(directory,'marker.json'),stateDirectory=join(directory,'state');
 fs.mkdirSync(stateDirectory,{recursive:true,mode:0o700});
 const marker={...marker0,endpoint:`http://127.0.0.1:${fake.address().port}/mcp`,stateDirectory};
 fs.writeFileSync(markerPath,JSON.stringify(marker));
 fake.marker=marker;
 publishState(join(directory,'authority-domain.json'),{...domain0,canonicalMarkerLocation:markerPath},'authorityDomain');
 publishState(join(stateDirectory,marker.authKeyReference),
  {...secret0,authorityBinding:digest({canonicalMarkerLocation:markerPath,prefixId:marker.prefixId,uid:marker.uid})},'secret');
 try{
  const response=await authenticatedHttpRequest(markerPath,marker,new URL('/_h2a-central/status',marker.endpoint));
  assert.equal(response.status,200);await response.text();
  assert.equal(challenges,2);assert.equal(posts,1);
 }finally{
  fake.close();
  fs.rmSync(seed,{recursive:true,force:true});fs.rmSync(directory,{recursive:true,force:true});
 }
});
