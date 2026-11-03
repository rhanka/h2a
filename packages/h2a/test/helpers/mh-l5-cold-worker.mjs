// Process-crash cuts in the real compiled cold administration kernel. Listener
// and controller policy are fixtures; the transaction machine is never replaced.
import fs from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ColdAdministration } from '../../dist/runtime/handover/administration.js';
import { readState, publishState } from '../../dist/runtime/handover/state.js';
import { currentIdentity } from '../../dist/runtime/handover/admission.js';
import { reserveSuccessorAttempt, failSuccessor } from '../../dist/runtime/handover/successor.js';
import { prepareAuthority, ownerLiveness } from '../../dist/runtime/handover/admission.js';
import { acquirePreclaim } from '../../dist/runtime/handover/authority.js';
import { classifyDurableProcFrame } from '../../dist/runtime/handover/proc-identity.js';
import { marker as fixtureMarker } from './mh-l0-fixtures.js';
import { digest } from '../../dist/runtime/handover/wire.js';
const [directory, mode = 'admin'] = process.argv.slice(2);
const sourcePath = join(directory, 'source.json'), markerPath = join(directory, 'marker.json');
const emit = value => fs.writeSync(1, JSON.stringify(value) + '\n');
if (mode === 'attempt') {
  const identity = currentIdentity(), config = JSON.parse(fs.readFileSync(join(directory, 'attempt-config.json')));
  const authority = await prepareAuthority({ directory: join(directory, 'anchor'), root: config.root, physicalPrefix: directory });
  let lock;
  try {
    lock = await acquirePreclaim(authority.domain, identity, authority.lockKey, classifyDurableProcFrame);
    const tx = readState(config.path, 'componentTransaction').value;
    const ticket = reserveSuccessorAttempt(config.path, { sourceLiveness: ownerLiveness({ processIdentity: tx.source.processIdentity }, identity),
      candidateLiveness: tx.state === 'STARTING' ? 'unknown' : 'dead', selectionEpoch: 2,
      targetManifestDigest: tx.target.manifestDigest, paused: false });
    emit({ id: 'ready', ticket });
  } catch (error) { emit({ id: 'ready', error: error.message }); }
  finally { await lock?.release(); }
  process.exitCode = 0;
} else {
  let m;
  if (fs.existsSync(sourcePath)) m = JSON.parse(fs.readFileSync(sourcePath));
  else {
    m = { ...fixtureMarker(), uid: process.getuid(), stateDirectory: directory, processIdentity: currentIdentity(), pid: process.pid };
    m.publicationEpoch = { bootId: m.processIdentity.bootId, counter: 1 };
    fs.writeFileSync(sourcePath, JSON.stringify(m)); publishState(markerPath, m, 'marker');
  }
  let armed, syncs = 0;
  const cut = stage => {
    if (armed !== stage) return;
    emit({ id: 'cut', stage }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  };
  const sync = fs.fsyncSync, rename = fs.renameSync;
  fs.fsyncSync = fd => {
    if (armed) { syncs++; if (syncs === 1) cut('before-file-sync'); }
    sync(fd);
    if (armed && syncs === 1) cut('after-file-sync');
    if (armed && syncs === 2) cut('after-directory-sync');
  };
  fs.renameSync = (...args) => { const result = rename(...args); if (armed) cut('after-rename'); return result; };
  const coordinator = fixtureMarker().processIdentity;
  const options = { directory, marker: m, now: () => JSON.parse(fs.readFileSync(join(directory, 'clock.json'))),
    inventory: () => ({ revision: 1 }), drain: () => ({ revision: 1, calls: JSON.parse(fs.readFileSync(join(directory, 'calls.json'))), children: 0, briefs: 0, callbacks: 0, effects: 0 }),
    authorizeTarget: () => {}, verifyPrecheck: () => {},
    close: () => {
      cut('listener-close');
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
      cut('marker-cleanup');
      fs.appendFileSync(join(directory, 'closed.jsonl'), JSON.stringify({ state: admin.status().state, sourceGeneration: m.generation }) + '\n');
    } };
  const admin = new ColdAdministration(options);
  const step = (operation, payload = {}, stepId = operation) => admin.execute(operation, { protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h',
    transactionEpoch: 1, expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: 1,
    stepId, payloadDigest: digest(payload) }, payload, coordinator);
  emit({ id: 'ready', source: m, status: admin.status() });
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    const command = JSON.parse(line);
    try {
      armed = command.cut; syncs = 0;
      let result;
      if (command.operation === 'reconcile') result = admin.reconcile();
      else if (command.operation === 'pause') result = admin.operatorStop();
      else if (command.operation === 'expire') result = admin.expire();
      else if (command.operation === 'resume') result = admin.resume();
      else if (command.operation === 'fail') result = failSuccessor(command.path, command.ticket, 'fixture-crash', 'dead');
      else result = step(command.operation, command.payload, command.stepId);
      emit({ id: command.id, result, open: admin.admissionsOpen(), status: admin.status() });
    } catch (error) { emit({ id: command.id, error: error.message, open: admin.admissionsOpen(), status: admin.status() }); }
    finally { armed = undefined; }
  });
  process.stdin.once('end', () => { lines.close(); });
}
