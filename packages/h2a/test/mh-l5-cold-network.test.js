import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnShim } from './helpers/mh-l1-shim.js';
import { managedImage } from './helpers/mh-l5-image.js';
import { digest } from '../src/runtime/handover/wire.js';
import { readState, replaceState } from '../src/runtime/handover/state.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';
import { authenticatedHttpRequest } from '../src/runtime/handover/authenticated-http.js';
import { runIsolatedPrecheck } from '../src/runtime/handover/precheck.js';
import { launchCentral } from '../src/runtime/handover/launch.js';

for (const fault of ['file-sync', 'directory-sync', 'lost-commit-ack']) test(`M23 M24 real central ${fault} must keep one durable stop and one reserved successor`, async t => {
  const f = await managedImage(); let source, controller, injected = false, armed = false, syncs = 0;
  const createServer = http.createServer, fsync = fs.fsyncSync;
  try {
    t.mock.method(http, 'createServer', handler => createServer((req, res) => {
      const end = res.end.bind(res);
      res.end = function(bytes, ...rest) {
        if (armed && !injected && fault === 'lost-commit-ack' && req.url === '/_h2a-central/admin/commit-stop' && bytes &&
          JSON.parse(bytes.toString()).payload?.body?.state === 'STOP_COMMITTED') {
          injected = true; res.destroy(); return res;
        }
        return end(bytes, ...rest);
      }; handler(req, res);
    })); syncBuiltinESMExports();
    const { startCentralMcpServer } = await import(join(f.image, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js'));
    source = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtime,
      writerProof: { evidenceDigest: f.payload.manifestDigest, verify: () => 'qualified' } });
    const markerPath = source.markerPath, m = readState(markerPath, 'marker').value, directory = m.stateDirectory;
    const selection = { ...f.selection, selectionEpoch: 2 };
    replaceState(f.selectionPath, selection, 'selection', readState(f.selectionPath, 'selection'));
    const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest,
      entrypoint: join(f.image, selection.entrypoint) };
    const precheck = await runIsolatedPrecheck(f.installation, target, 2, directory), coordinator = currentIdentity();
    if (fault === 'lost-commit-ack') {
      controller = spawnShim(fileURLToPath(new URL('./helpers/mh-l5-controller.mjs', import.meta.url)), [markerPath], process.env, f.dir);
      assert.equal((await controller.response('ready')).coordinator.pid, controller.child.pid);
    }
    const call = async (operation, payload = {}) => {
      if (controller) {
        controller.send({ id: operation, operation, payload });
        const result = await controller.response(operation);
        if (result.error) throw new Error(result.error);
        return result;
      }
      const step = { protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
        expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: 1,
        stepId: operation, payloadDigest: digest(payload) };
      const response = await authenticatedHttpRequest(markerPath, m, new URL('/_h2a-central/admin/' + operation, m.endpoint),
        { method: 'POST', body: JSON.stringify({ step, payload, coordinator }) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call('reserve', { target, selectionEpoch: 2, precheckEvidenceDigest: precheck })).status, 200);
    const barrier = await call('barrier', { deadline: Date.now() + 10000 });
    assert.equal((await call('freeze')).status, 200); assert.equal((await call('checkpoint')).status, 200);
    const drain = await call('drain-status'); assert.equal(drain.body.complete, true);
    const payload = { sourceGeneration: m.generation, sourceProcessIdentity: m.processIdentity, barrierId: barrier.body.barrierId,
      expectedDrainRevision: drain.body.revision, expectedInventoryRevision: 1, targetBuildId: target.buildId,
      targetManifestDigest: target.manifestDigest, targetEntrypoint: target.entrypoint, selectionEpoch: 2, precheckEvidenceDigest: precheck };
    const txPath = join(directory, readState(join(directory, 'component-control.json'), 'componentControl').value.activeTransaction);
    t.mock.method(fs, 'fsyncSync', fd => {
      if (armed && !injected && fault !== 'lost-commit-ack' && ++syncs === (fault === 'file-sync' ? 1 : 2)) {
        injected = true; throw new Error('injected-' + fault);
      }
      return fsync(fd);
    });
    armed = true;
    if (fault === 'lost-commit-ack') await assert.rejects(call('commit-stop', payload));
    else {
      const failed = await call('commit-stop', payload); assert.equal(failed.status, 409);
      assert.match(failed.body.error, fault === 'file-sync' ? /injected-file-sync/ : /persistence_indeterminate/);
    }
    armed = false; assert.equal(injected, true);
    if (fault === 'file-sync') {
      assert.equal(readState(txPath, 'componentTransaction').value.state, 'DRAINING');
      assert.equal(readState(markerPath, 'marker').value.generation, m.generation);
      assert.equal((await call('commit-stop', payload)).status, 200);
    }
    await source.closed;
    if (controller) { await controller.close(); assert.equal(controller.child.signalCode, 'SIGTERM'); }
    assert.equal(fs.existsSync(markerPath), false); assert.equal(readState(txPath, 'componentTransaction').value.state, 'STOPPED');
    t.mock.restoreAll(); syncBuiltinESMExports();
    const contenders = await Promise.allSettled([launchCentral(f.startOptions), launchCentral(f.startOptions)]);
    const successes = contenders.filter(r => r.status === 'fulfilled'); assert.ok(successes.length >= 1);
    for (const r of contenders.filter(r => r.status === 'rejected')) assert.match(r.reason.message, /authority_lock_unavailable|owner_alive|startup_reserved/);
    const g1 = readState(markerPath, 'marker').value;
    assert.notEqual(g1.generation, m.generation); assert.equal(g1.buildId, target.buildId); assert.equal(g1.manifestDigest, target.manifestDigest);
    assert.equal(g1.predecessorGeneration, m.generation); assert.equal(f.children.length, 1);
    const tx = readState(txPath, 'componentTransaction').value;
    assert.equal(tx.state, 'READY'); assert.equal(tx.successorReservation.attempts, 1);
    assert.equal(fs.existsSync(join(directory, 'operator-stop.json')), false);
  } finally {
    armed = false; t.mock.restoreAll(); syncBuiltinESMExports(); await controller?.close();
    try { await source?.stop(); } finally { await f.close(); }
  }
});
