import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Participants} from '../dist/runtime/handover/participants.js';
import {createMcpServer} from '../dist/runtime/mcp/server.js';
import {ColdAdministration} from '../src/runtime/handover/administration.js';
import {digest} from '../src/runtime/handover/wire.js';
import {marker,identity,hash} from './helpers/mh-l0-fixtures.js';

test('should refuse unknown/legacy writers before freeze and recover eligibility only from maintained closure proof',()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-eligibility-')),root=join(directory,'store');fs.mkdirSync(root,{mode:0o700});
 try{
  let verdict='store_writer_set_unknown';
  const participants=new Participants({directory,root,marker:marker(),writerProof:{evidenceDigest:hash,verify:()=>verdict}});
  assert.throws(()=>participants.assertEligible(),/store_writer_set_unknown/);
  verdict='legacy_writer_unfenced';assert.throws(()=>participants.assertEligible(),/legacy_writer_unfenced/);
  verdict='qualified';assert.doesNotThrow(()=>participants.assertEligible());
  verdict='legacy_writer_unfenced';assert.throws(()=>participants.freeze('h'),/legacy_writer_unfenced/);
  assert.equal(participants.writerControl().gate,'OPEN');
  verdict='qualified';participants.barrier('h');assert.equal(participants.writerControl().gate,'BARRIER');
  participants.abort('h');assert.equal(participants.writerControl().gate,'OPEN');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('should export a complete source checkpoint and wait for admitted callbacks before freezing',async()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-participant-')),root=join(directory,'store');fs.mkdirSync(root,{mode:0o700});
 try{
  const participants=new Participants({directory,root,marker:marker(),writerProof:{evidenceDigest:hash,verify:()=> 'qualified'}});
  const attachment=participants.attach('a',{workspace:directory});
  const mcp=attachment.runOwner(()=>createMcpServer({root,participant:attachment}));attachment.bind(mcp);
  const session=attachment.runOwner(()=>mcp.sessions.open({instance:'i'}));
  const operation=attachment.begin('callback');
  participants.barrier('h');assert.throws(()=>participants.freeze('h'),/callbacks_pending/);
  attachment.finish(operation,{delivered:true});
  participants.freeze('h');
  const receipt=participants.checkpoint('h');assert.equal(receipt.references.length,1);
  const owner=participants.registry.owners()[0];
  const checkpoint=participants.registry.loadCheckpoint(receipt.references[0],owner.checkpointHash);
  assert.equal(checkpoint.attachmentId,'a');assert.equal(checkpoint.presence[0].sessionId,session.sessionId);
  for(const key of ['context','identity','downstreamProtocol','servedCatalogue','subscriptions','observedPeers','observedInbox','notifications','negotiations','truncation','blockages','producedSequence','deliveredSequence','wakeState','terminalReferences','delegationReferences','launches'])assert.ok(Object.hasOwn(checkpoint,key),key);
  assert.throws(()=>attachment.runOwner(()=>mcp.sessions.touch(session.sessionId)),/ownership_fenced/);
  assert.deepEqual(participants.checkpoint('h'),receipt);
  participants.abort('h');assert.doesNotThrow(()=>attachment.runOwner(()=>mcp.sessions.touch(session.sessionId)));
  await attachment.close(()=>{mcp.notifications.stop();mcp.sessions.closeAll();});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('should serialize administrative barrier/freeze/abort with conforming writers and a fresh inventory',()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-admin-')),root=join(directory,'store');fs.mkdirSync(root,{mode:0o700});
 try{
  const m=marker(),p=new Participants({directory,root,marker:m,writerProof:{evidenceDigest:hash,verify:()=> 'qualified'}});
  const a=p.attach('a',{workspace:directory}),mcp=a.runOwner(()=>createMcpServer({root,participant:a}));a.bind(mcp);
  const inventoryRevision=p.inventory().revision;
  const admin=new ColdAdministration({directory,marker:m,inventory:()=>p.inventory(),drain:()=>p.drain(),
   assertEligible:()=>p.assertEligible(),barrier:tx=>p.barrier(tx.handoverId),abort:tx=>p.abort(tx.handoverId),
   reconcileParticipants:tx=>p.reconcileTransaction(tx),freeze:(_,tx)=>p.freeze(tx.handoverId),checkpoint:(_,tx)=>p.checkpoint(tx.handoverId),
   authorizeTarget:()=>{},verifyPrecheck:()=>{},close:()=>{}});
  const step=(operation,payload={})=>admin.execute(operation,{protocolVersion:1,mode:'cold-stop',upgradeId:'u',handoverId:'h',transactionEpoch:1,expectedGeneration:m.generation,expectedPublicationEpoch:m.publicationEpoch,inventoryRevision,stepId:operation,payloadDigest:digest(payload)},payload,identity);
  step('reserve',{target:{packageVersion:'0.98.7',buildId:'next',manifestDigest:hash,entrypoint:join(directory,'next')},selectionEpoch:2,precheckEvidenceDigest:hash});
  step('barrier',{deadline:Date.now()+10000});step('freeze');step('checkpoint');
  assert.equal(admin.status().state,'FROZEN');step('abort');assert.equal(p.writerControl().gate,'OPEN');
  mcp.notifications.stop();mcp.sessions.closeAll();
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
