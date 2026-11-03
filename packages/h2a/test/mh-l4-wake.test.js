import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync} from 'node:crypto';
import {OwnershipRegistry,OperationLedger} from '../src/runtime/handover/ownership.js';
import {WakeJournal} from '../src/runtime/handover/wake.js';
import {createInboxWakeHandler} from '../dist/runtime/drive/inbox-wake.js';
import {identity,marker} from './helpers/mh-l0-fixtures.js';
const envelope=id=>({protocol:'sentropic.h2a',version:'0.1',id,type:'event',actor:{instance:'peer',role:'AGENTS',scope:'scope:default'},body:{kind:'message',topic:'MESSAGE',text:'hello'},createdAt:new Date().toISOString()});

test('should serialize wakes, persist intent before injection and suppress unknown envelopes after restart',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-wake-'));
 try {
  const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity});
  const token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}), ledger=new OperationLedger(registry);
  const journal=new WakeJournal({registry,token,ledger}); let injections=0, release;
  const gate=new Promise(r=>{release=r;}), inbox=[];
  const deps={instance:'i',readInbox:()=>inbox,privateKeyPem:generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}).toString(),journal,driver:{drive:async()=>{
   injections++; assert.equal(journal.snapshot().intents[0].state,'unknown'); await gate; throw new Error('lost drive receipt');
  }}};
  const handler=createInboxWakeHandler(deps); inbox.push(envelope('e'));
  const one=handler(),two=handler(); release(); await Promise.all([one,two]);
  assert.equal(injections,1); assert.equal(ledger.drain().effects,1);
  const restarted=new WakeJournal({registry,token,ledger});
  assert.deepEqual(restarted.eligibleEnvelopeIds(['e','new']),['new']);
  assert.equal(await restarted.perform(['e'],'signed line',async()=>{injections++;return true;}),false);
  assert.equal(injections,1);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('should retry a proven deferred wake but never inject from a frozen owner',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-wake-'));
 try {
  const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity});
  const token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}),ledger=new OperationLedger(registry), journal=new WakeJournal({registry,token,ledger});let calls=0;
  assert.equal(await journal.perform(['e'],'old signed line',async line=>{calls++;assert.equal(line,'old signed line');return false;}),false);
  assert.equal(await journal.perform(['e'],'fresh signed line',async line=>{calls++;assert.equal(line,'fresh signed line');return true;}),true);
  assert.equal(calls,2);assert.equal(ledger.drain().complete,true);
  assert.equal(await journal.perform(['e'],'line',async()=>{calls++;return true;}),false);
  registry.freeze(token,'h');
  await assert.rejects(()=>journal.perform(['new'],'line',async()=>{calls++;return true;}),/ownership_fenced/);
  assert.equal(calls,2);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
