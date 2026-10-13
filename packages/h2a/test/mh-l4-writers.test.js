import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { establishWriterControl, updateWriterControl, withExecution, writerDirectory } from '../dist/runtime/handover/mutation.js';
import { OwnershipRegistry, OperationLedger } from '../dist/runtime/handover/ownership.js';
import { createLocalStore } from '../dist/runtime/local-files/store.js';
import { writePresence, readPresence, reapAllDeadPresence, listPresence } from '../dist/runtime/local-files/presence.js';
import { raiseBlockage } from '../dist/runtime/blockage/registry.js';
import { createPayloadStore } from '../dist/runtime/mcp/payload-store.js';
import { marker, identity } from './helpers/mh-l0-fixtures.js';
const session = {sessionId:'s',instance:'i',host:'claude',pid:123,startedAt:'2026-01-01T00:00:00.000Z',heartbeatAt:'2026-01-01T00:00:00.000Z',state:'live',interests:{scopes:[],negotiations:[]},subscribedTopics:[]};

test('should revalidate registry, inbox, presence, blockage and payload writes at the barrier', () => {
  const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-write-')), root=join(directory,'store');
  fs.mkdirSync(root,{mode:0o700});
  try {
    const store=createLocalStore({root});
    establishWriterControl(root,directory);
    const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity,lockDirectory:writerDirectory(root)});
    const token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}), ledger=new OperationLedger(registry);
    const authority={root,registry,token,ledger};
    withExecution(authority,()=>writePresence(root,session));
    const operation=ledger.begin(token,'op','call');
    updateWriterControl(root,{gate:'BARRIER',handoverId:'h'});
    registry.freeze(token,'h');
    assert.throws(()=>store.registerInstance({id:'intruder',publicKey:'key',roles:[],scopes:[],createdAt:'now'}),/store_admission_closed/);
    assert.throws(()=>withExecution(authority,()=>writePresence(root,session)),/ownership_fenced/);
    assert.throws(()=>raiseBlockage(root,{instance:'i',scope:'scope',reason:'blocked'}),/store_admission_closed/);
    assert.throws(()=>createPayloadStore(root).persistOutput(Buffer.from('output')),/store_admission_closed/);
    assert.throws(()=>store.putInboxMessage('i',{}),/store_admission_closed/);
    withExecution({...authority,operation},()=>store.registerInstance({id:'admitted',publicKey:'key',roles:[],scopes:[],createdAt:'now'}));
    assert.equal(store.findInstance('admitted').id,'admitted');
    assert.throws(()=>withExecution({...authority,operation},()=>writePresence(root,session)),/ownership_fenced/);
    ledger.finish(operation,{ok:true});
    assert.throws(()=>withExecution({...authority,operation},()=>store.registerInstance({id:'late'})),/operation_fenced/);
    const before=fs.readdirSync(join(root,'presence'));
    listPresence(root,{now:Date.now(),sweep:false});
    assert.deepEqual(fs.readdirSync(join(root,'presence')),before);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('should refuse janitor cleanup when a snapshot has been replaced during liveness proof', () => {
  const root=fs.mkdtempSync(join(tmpdir(),'mh-l4-janitor-'));
  try {
    writePresence(root,session);
    const reaped=reapAllDeadPresence(root,()=>{
      writePresence(root,{...session,pid:456,heartbeatAt:new Date().toISOString()});
      return false;
    });
    assert.deepEqual(reaped,[]);
    assert.equal(readPresence(root,'s').pid,456);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('should keep preparatory readOnly opens pure and reject every mutating method', () => {
  const root=fs.mkdtempSync(join(tmpdir(),'mh-l4-prep-'));
  try {
    const store=createLocalStore({root,readOnly:true,initialize:false});
    assert.deepEqual(fs.readdirSync(root),[]);
    assert.deepEqual(store.listInstances(),[]);
    assert.throws(()=>store.openNegotiation({id:'n'}),/storage_readonly/);
    assert.throws(()=>store.putInboxMessage('i',{}),/storage_readonly/);
    assert.deepEqual(fs.readdirSync(root),[]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
