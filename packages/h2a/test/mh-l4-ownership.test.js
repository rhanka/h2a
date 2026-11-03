import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marker, identity } from './helpers/mh-l0-fixtures.js';
import { OwnershipRegistry, OperationLedger } from '../src/runtime/handover/ownership.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';

test('should fence a stale owner while admitted operations retain separate rights', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l4-owner-'));
  try {
    const registry = new OwnershipRegistry({ directory, generation: marker().generation, processIdentity: identity });
    const token = registry.claim({ attachmentId:'a', presenceSessionId:'s', expectedInstance:'i' });
    const ledger = new OperationLedger(registry);
    const op = ledger.begin(token, 'call-1', 'call');
    registry.freeze(token, 'h');
    assert.throws(() => registry.assertOwner(token), /ownership_fenced/);
    assert.equal(ledger.drain().calls, 1);
    assert.doesNotThrow(() => ledger.assertOperation(op));
    const path = registry.ownerPath('a');
    const observed = readState(path, 'ownership');
    registry.withLock(() => replaceState(path, { ...observed.value, ownershipEpoch:2,
      ownerGeneration:'33333333-3333-4333-8333-333333333333', ownerProcessIdentity:{...identity,startTime:457} }, 'ownership', observed));
    assert.throws(() => registry.assertOwner(token), /ownership_fenced/);
    ledger.finish(op, {ok:true});
    assert.equal(ledger.drain().complete, true);
    const events = ledger.effects('a');
    assert.equal(events.length, 1);
    assert.equal(events[0].destination, 'current-owner');
    assert.equal(events[0].operationId, 'call-1');
    assert.equal(ledger.effects('a').length, 1);
    assert.throws(() => registry.abort(token,'h'), /ownership_fenced/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('should reconcile freeze after lost ACK and reject different handover tuples', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'mh-l4-owner-'));
  try {
    const options = { directory, generation:marker().generation, processIdentity:identity };
    const registry = new OwnershipRegistry(options);
    const token = registry.claim({ attachmentId:'a', presenceSessionId:'s', expectedInstance:'i' });
    registry.freeze(token,'h');
    const restarted = new OwnershipRegistry(options);
    assert.equal(restarted.freeze(token,'h').state, 'FROZEN');
    assert.throws(() => restarted.freeze(token,'other'), /handover_conflict/);
    restarted.abort(token,'h');
    assert.doesNotThrow(() => restarted.assertOwner(token));
    restarted.close(token);
    assert.throws(() => restarted.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}), /ownership_exists/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});


test('should close ownership admissions after publication fsync uncertainty until explicit reconciliation', t => {
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-uncertain-'));
 try{
  const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity});
  const token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'});
  const fsync=fs.fsyncSync;let injected=false;
  t.mock.method(fs,'fsyncSync',fd=>{if(!injected&&fs.fstatSync(fd).isDirectory()){injected=true;throw Error('injected directory fsync failure');}return fsync(fd);});
  assert.throws(()=>registry.freeze(token,'h'),/persistence_indeterminate/);
  assert.throws(()=>registry.claim({attachmentId:'b',presenceSessionId:'s2',expectedInstance:'i'}),/reconciliation_required/);
  assert.throws(()=>registry.assertOwner(token),/reconciliation_required/);
  t.mock.restoreAll();registry.reconcile();
  assert.equal(registry.freeze(token,'h').state,'FROZEN');
  assert.throws(()=>registry.assertOwner(token),/ownership_fenced/);
 }finally{t.mock.restoreAll();fs.rmSync(directory,{recursive:true,force:true});}
});


test('should refuse only the stale ownership epoch even when generation and process stay identical',()=>{
 const directory=fs.mkdtempSync(join(tmpdir(),'mh-l4-epoch-'));
 try{
 const registry=new OwnershipRegistry({directory,generation:marker().generation,processIdentity:identity});
 const token=registry.claim({attachmentId:'a',presenceSessionId:'s',expectedInstance:'i'}),path=registry.ownerPath('a'),old=readState(path,'ownership');
 registry.withLock(()=>replaceState(path,{...old.value,ownershipEpoch:2},'ownership',old));
 assert.throws(()=>registry.assertOwner(token),/ownership_fenced/);
 assert.doesNotThrow(()=>registry.assertOwner(registry.token(readState(path,'ownership').value)));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
