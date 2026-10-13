import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Participants} from '../dist/runtime/handover/participants.js';
import {OwnershipRegistry,OperationLedger} from '../dist/runtime/handover/ownership.js';
import {LaunchJournal} from '../dist/runtime/handover/launch-memo.js';
import {writePresence,updatePresence,readPresence,deletePresence} from '../dist/runtime/local-files/presence.js';
import {createMcpServer} from '../dist/runtime/mcp/server.js';
import {executeH2aRunWithAsyncSpawn} from '../dist/runtime/mcp/agent-launch.js';
import {identity,marker,hash} from './helpers/mh-l0-fixtures.js';

test('should close admissions at barrier and bind presence mutations to the exact session',()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-cut-')),root=join(directory,'store');fs.mkdirSync(root,{mode:0o700});
 try{
 const p=new Participants({directory,root,marker:marker(),writerProof:{evidenceDigest:hash,verify:()=> 'qualified'}}),a=p.attach('a',{workspace:directory}),b=p.attach('b',{workspace:directory});
 const one=a.runOwner(()=>createMcpServer({root,participant:a})),two=b.runOwner(()=>createMcpServer({root,participant:b}));a.bind(one);b.bind(two);
 const s1=a.runOwner(()=>one.sessions.open({instance:'one'})),s2=b.runOwner(()=>two.sessions.open({instance:'two'}));
 assert.throws(()=>a.runOwner(()=>updatePresence(root,s2.sessionId,{state:'closed'})),/presence_ownership_mismatch/);
 assert.throws(()=>a.runOwner(()=>deletePresence(root,s2.sessionId)),/presence_ownership_mismatch/);
 assert.equal(readPresence(root,s2.sessionId).state,'live');
 p.barrier('h');assert.throws(()=>a.call(()=>{throw Error('must not run');}),/store_admission_closed/);
 assert.throws(()=>a.executeLaunch({name:'new',workspace:directory,prompt:'brief'},()=>{throw Error('must not spawn');}),/store_admission_closed/);
 p.abort('h');a.runOwner(()=>one.sessions.closeAll());b.runOwner(()=>two.sessions.closeAll());
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('should propagate the reserved token through the real async subprocess seam',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-async-token-'));
 try{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{throw Error('unexpected kill');};
 const request={profile:'claude',name:'worker',workspace:directory,prompt:'brief',background:true,gateway:'off',headless:true,h2aSidecar:false,launchAuthority:{token:'reserved-token',launchId:'id',onSpawn:()=>{}}};
 const fake=(_command,_args,options)=>{
 assert.equal(options.env.H2A_RUN_LAUNCH_TOKEN,'reserved-token');
 queueMicrotask(()=>{child.stdout.write(JSON.stringify({kind:'h2a.run.failure',version:1,state:'not-started',code:'native-name-collision',phase:'admission',id:'worker',socketPath:join(directory,'socket'),launchId:'worker',creationAttempted:false,retrySafe:true,prompt:{delivered:false}}));child.emit('close',1);});return child;};
 const result=await executeH2aRunWithAsyncSpawn(request,fake,1000,{});assert.equal(result.state,'not-started');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('should detect conflicting launch parameters through the MCP server cache',async()=>{
 const directory=fs.mkdtempSync(join(process.env.XDG_CACHE_HOME,'mh-l4-cache-'));const root=join(directory,'store');fs.mkdirSync(root,{mode:0o700});
 try{
 const p=new Participants({directory,root,marker:marker()}),a=p.attach('a',{workspace:directory});let spawned=0;
 const mcp=a.runOwner(()=>createMcpServer({root,workspaceRoot:directory,participant:a,runExecutor:()=>{spawned++;return {state:'started',ok:true,prompt:{delivered:true}};}}));a.bind(mcp);
 const args={profile:'claude',name:'worker',prompt:'first',workspace:directory,background:true};
 await mcp.callTool('h2a_run',args);const conflict=await mcp.callTool('h2a_run',{...args,prompt:'second'});
 assert.match(JSON.stringify(conflict),/launch_arguments_conflict/);assert.equal(spawned,1);
 mcp.notifications.stop();mcp.sessions.closeAll();
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('should reconcile a final memo after a crash before operation closure without executing again',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-final-cut-'));
 try{
 const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity}),token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}),ledger=new OperationLedger(registry),journal=new LaunchJournal({registry,token,ledger,root:directory});
 const finish=ledger.finish.bind(ledger);ledger.finish=()=>{throw Error('crash after memo');};
 const request={name:'worker',workspace:directory,prompt:'brief'};let spawned=0;
 assert.throws(()=>journal.launch(request,()=>{spawned++;return {state:'started',ok:true,prompt:{delivered:true}};}),/crash after memo/);
 ledger.finish=finish;
 assert.equal(journal.memos()[0].state,'completed');assert.equal(ledger.drain().children,1);
 const recovered=new LaunchJournal({registry,token,ledger,root:directory});assert.equal((await recovered.launch(request,()=>{spawned++;})).state,'started');
 assert.equal(ledger.drain().complete,true);assert.equal(spawned,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
