import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OwnershipRegistry,OperationLedger} from '../src/runtime/handover/ownership.js';
import {LaunchJournal} from '../src/runtime/handover/launch-memo.js';
import {identity,marker} from './helpers/mh-l0-fixtures.js';

function fixture(){
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-launch-'));
 const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity});
 const token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}),ledger=new OperationLedger(registry);
 return {directory,registry,token,ledger,journal:new LaunchJournal({registry,token,ledger,root:directory})};
}

test('should reserve before spawn, conflict on arguments and drain child/brief after a launching reply',async()=>{
 const f=fixture();
 try {
  const request={name:'worker',workspace:f.directory,prompt:'brief'}, original={...request};let spawns=0,release;
  const pending=new Promise(r=>{release=r;});
  const launched=f.journal.launch(request,async enriched=>{
   spawns++; assert.equal(f.journal.memos()[0].state,'launching');
   assert.ok(enriched.launchAuthority.token); enriched.launchAuthority.onSpawn(identity);
   await pending; return {state:'started',ok:true,prompt:{delivered:true}};
  });
  assert.equal((await f.journal.launch(original,()=>{spawns++;})).state,'launching');
  assert.throws(()=>f.journal.launch({...request,prompt:'other'},()=>{}),/launch_arguments_conflict/);
  assert.equal(f.ledger.drain().children,1);assert.equal(f.ledger.drain().briefs,1);
  f.registry.freeze(f.token,'h');
  release(); const result=await launched;
  assert.equal(result.state,'started'); assert.equal(spawns,1);
  assert.equal(f.ledger.drain().complete,true);
  assert.equal(f.journal.memos()[0].briefReceipt.delivered,true);
  const restarted=new LaunchJournal({registry:f.registry,token:f.token,ledger:f.ledger,root:f.directory});
  assert.deepEqual(await restarted.launch(original,()=>{spawns++;}),result);
  assert.equal(spawns,1);
 }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('should reconcile token-bound existing launch.json without a second spawn or brief',async()=>{
 const f=fixture();
 try {
  const request={name:'worker',workspace:f.directory,prompt:'brief'};let token,spawns=0;
  const result=await f.journal.launch(request,async enriched=>{spawns++;token=enriched.launchAuthority.token;throw new Error('spawn ACK lost');});
  assert.equal(result.state,'unknown');assert.equal(f.ledger.drain().complete,false);
  const receipt=join(f.directory,'.h2a','runs','worker','launch.json');fs.mkdirSync(join(receipt,'..'),{recursive:true});
  fs.writeFileSync(receipt,JSON.stringify({token:'foreign',state:'started',ownership:{}}));
  assert.equal(f.journal.reconcile(request).state,'unknown');
  fs.writeFileSync(receipt,JSON.stringify({token,state:'started',ownership:{host:'native',sessions:[]}}));
  const recovered=f.journal.reconcile(request);
  assert.equal(recovered.state,'unknown'); // started alone is not a brief-delivery receipt.
  assert.equal(f.journal.memos()[0].briefReceipt,null);
  assert.equal((await f.journal.launch(request,()=>{spawns++;})).state,'unknown');assert.equal(spawns,1);
  fs.writeFileSync(receipt,JSON.stringify({token,state:'stopped',ownership:{host:'native',sessions:[]}}));
  assert.equal(f.journal.reconcile(request).state,'stopped');
  assert.equal(f.ledger.drain().complete,true);
  assert.equal((await f.journal.launch(request,()=>{spawns++;})).state,'stopped');assert.equal(spawns,1);
 }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
