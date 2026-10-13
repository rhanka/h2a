import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import { OwnershipRegistry } from '../src/runtime/handover/ownership.js';
import { NotificationDispatcher } from '../dist/runtime/mcp/notifications.js';
import {identity,marker} from './helpers/mh-l0-fixtures.js';

test('should preserve notification dedup and separate production, delivery and CLI acknowledgement', () => {
 const root=fs.mkdtempSync(join(tmpdir(),'mh-l4-notify-'));
 try {
  const session={sessionId:'s',instance:'i',interests:{scopes:[],negotiations:[]},subscribedTopics:['inbox.envelope_arrived']};
  const registry={list:()=>[session],scanFresh:()=>[session]};
  const inbox=[{id:'e'}], store={readInbox:()=>inbox}; let seq;
  const dispatcher=new NotificationDispatcher(registry,store,root,(_,sequence)=>{seq=sequence;return {accepted:false};},1000);
  dispatcher.tick(); dispatcher.tick();
  assert.equal(seq,1);
  const before=dispatcher.checkpointState();
  assert.equal(before.producedSequence,1); assert.equal(before.deliveredSequence,0);
  assert.equal(before.notifications[0].key,before.notifications[0].key);
  dispatcher.markDelivered(1);
  const delivered=dispatcher.checkpointState();
  assert.equal(delivered.deliveredSequence,1);
  assert.equal(delivered.notifications[0].applicationAcknowledged,false);
  assert.deepEqual(delivered.snapshots[0].observedInbox,[]);
  dispatcher.setSink(()=>({accepted:true})); dispatcher.tick();
  assert.deepEqual(dispatcher.checkpointState().snapshots[0].observedInbox,['e']);
  assert.equal(dispatcher.checkpointState().producedSequence,1);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('should persist every checkpoint field, reconcile a lost ACK and reject hash, epoch or payload changes',()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-checkpoint-'));
 try {
  const options={directory,generation:marker().generation,processIdentity:identity};
  const registry=new OwnershipRegistry(options), token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'});
  const snapshot={schemaVersion:1,attachmentId:'a',ownershipEpoch:1,context:{workspace:'/laboratory'},identity:{instance:'i'},presence:{sessionId:'s'},downstreamProtocol:'2025-06-18',servedCatalogue:{tools:[{name:'h2a_run'}]},subscriptions:['inbox.envelope_arrived'],observedPeers:['peer'],observedInbox:['e'],notifications:[{key:'e',applicationAcknowledged:false}],negotiations:[{id:'n',count:3,hash:'last'}],truncation:[{id:'n',oldCount:4}],blockages:['blocked'],producedSequence:4,deliveredSequence:3,wakeState:{seen:['boot'],intents:[{state:'unknown'}]},terminalReferences:[{pty:'p'}],delegationReferences:[{delegator:'d'}],launches:[{launchId:'l',state:'launching'}]};
  registry.freeze(token,'h'); const receipt=registry.checkpoint(token,snapshot);
  const recovered=new OwnershipRegistry(options);
  assert.deepEqual(recovered.checkpoint(token,snapshot),receipt);
  assert.deepEqual(recovered.loadCheckpoint(receipt.reference,receipt.checkpointHash),snapshot);
  assert.throws(()=>recovered.checkpoint(token,{...snapshot,deliveredSequence:4}),/checkpoint_conflict/);
  assert.throws(()=>recovered.checkpoint(token,{...snapshot,ownershipEpoch:2}),/checkpoint_binding_mismatch/);
  assert.throws(()=>recovered.loadCheckpoint('../escape',receipt.checkpointHash),/checkpoint_reference_invalid/);
  const bytes=fs.readFileSync(join(directory,receipt.reference));
  fs.appendFileSync(join(directory,receipt.reference),' ');
  assert.throws(()=>recovered.loadCheckpoint(receipt.reference,receipt.checkpointHash),/noncanonical_state/);
  assert.throws(()=>recovered.fence(token,'h',receipt.checkpointHash),/noncanonical_state/);
  fs.writeFileSync(join(directory,receipt.reference),bytes);
  assert.equal(recovered.fence(token,'h',receipt.checkpointHash).state,'TRANSFERRING');
  assert.equal(recovered.fence(token,'h',receipt.checkpointHash).state,'TRANSFERRING');
  assert.throws(()=>recovered.abort(token,'h'),/ownership_fenced/);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
