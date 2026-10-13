import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest } from '../src/runtime/handover/wire.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';
import { authenticatedHttpRequest } from '../src/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';

test('should checkpoint a real source attachment and reject a cancellation string inside new tool arguments', async () => {
  const { buildPackagingPrototype } = await import('../../../scripts/mh-l1-package-prototype.mjs');
  const { launchCentral } = await import('../src/runtime/handover/launch.js');
  const { runIsolatedPrecheck } = await import('../src/runtime/handover/precheck.js');
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l2-image-'));
  let source, successor;
  const children = [];
  try {
    const managedRoot = join(dir, 'h2a-managed', String(process.getuid()));
    const images = join(managedRoot, 'images'), state = join(managedRoot, 'state'), root = join(dir, 'store'), runtime = join(dir, 'run');
    for (const path of [images, state, root, runtime]) fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    const payload = await buildPackagingPrototype(join(dir, 'payload'), { buildId: 'fixture-l2-source' });
    const image = join(images, payload.manifestDigest.slice(7)); fs.renameSync(payload.root, image);
    const installation = { schemaVersion: 1, canonicalPrefix: dir, uid: process.getuid(), managedRoot,
      prefixId: digest({ canonicalPrefix: dir, uid: process.getuid() }) };
    publishState(join(managedRoot, 'installation.json'), installation, 'installation');
    const npmBin = join(dir, 'lib', 'node_modules', '@sentropic', 'h2a', 'dist', 'bin.js');
    fs.mkdirSync(join(dir, 'bin'), { mode: 0o700 }); fs.mkdirSync(join(npmBin, '..'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(npmBin, '// npm router fixture; MH-L6 owns installation\n', { mode: 0o600 });
    fs.symlinkSync(npmBin, join(dir, 'bin', 'h2a'));
    let selection = { schemaVersion: 1, prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(),
      selectionEpoch: 1, packageVersion: payload.manifest.packageVersion, buildId: payload.manifest.buildId,
      manifestDigest: payload.manifestDigest, entrypoint: 'dist/bin.js', previousSelectionReference: null, upgradeId: 'u' };
    const selectionPath = join(state, 'selected-build.json'); publishState(selectionPath, selection, 'selection');
    const environment = { ...process.env, H2A_ROOT: root, XDG_RUNTIME_DIR: runtime };
    delete environment.NODE_PATH; delete environment.NODE_OPTIONS;
    const directory = join(runtime, 'h2a-mcp-central');
    const startOptions = { directory, root, installation, fallbackEntry: join(image, 'dist/bin.js'), environment, kind: 'controller', onSpawn: child => children.push(child) };
    const { startCentralMcpServer } = await import(join(image, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js'));
    source = await startCentralMcpServer({ root, runtimeBase: runtime, writerProof: {
      evidenceDigest: payload.manifestDigest, verify: () => 'qualified'
    } });
    assert.equal(source.kind, 'started');
    const markerPath = source.markerPath, m = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const post = async body => authenticatedHttpRequest(markerPath, m, m.endpoint, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-h2a-workspace': encodeURIComponent(dir) }, body: JSON.stringify(body) });
    const initialized = await post({ jsonrpc:'2.0', id:1, method:'initialize', params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'mh-l4-fixture',version:'1'}} });
    assert.equal(initialized.status,200);
    const downstream = (await initialized.json()).result.protocolVersion;
    const inventoryRevision = 2;
    const durableDirectory = m.stateDirectory;
    assert.ok(durableDirectory.startsWith(join(managedRoot, 'state', 'mcp')));
    const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest,
      entrypoint: join(image, selection.entrypoint) };
    selection = { ...selection, selectionEpoch: 2 };
    const old = readState(selectionPath, 'selection');
    replaceState(selectionPath, selection, 'selection', old);
    const evidence = await runIsolatedPrecheck(installation, target, 2, durableDirectory);
    const precheck = readState(join(durableDirectory, `precheck-${evidence.slice(7)}.json`), 'precheckEvidence');
    assert.equal(precheck.value.cleanupVerified, true);
    assert.notEqual(precheck.value.trialIdentity.pid, process.pid);
    assert.equal(JSON.parse(fs.readFileSync(markerPath)).generation, m.generation);
    const coordinator = currentIdentity();
    const call = async (operation, body, expectedStatus = 200) => {
      const step = { protocolVersion: 1, mode: 'cold-stop', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
        expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision,
        stepId: operation, payloadDigest: digest(body) };
      const response = await authenticatedHttpRequest(markerPath, m, new URL(`/_h2a-central/admin/${operation}`, m.endpoint),
        { method: 'POST', body: JSON.stringify({ step, payload: body, coordinator }) });
      const result = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(result)); return result;
    };
    const refused = await call('reserve', { target, selectionEpoch: 2, precheckEvidenceDigest: `sha256:${'f'.repeat(64)}` }, 409);
    assert.equal(refused.error, 'precheck_evidence_mismatch');
    await call('reserve', { target, selectionEpoch: 2, precheckEvidenceDigest: evidence });
    const pinsDirectory = join(managedRoot, 'state', 'pins');
    const pins = fs.readdirSync(pinsDirectory); assert.equal(pins.length, 1);
    const barrier = await call('barrier', { deadline: Date.now()+10000 });
    const bypass = await post({ jsonrpc:'2.0', id:2, method:'tools/call', params:{name:'h2a_run',arguments:{profile:'claude',name:'blocked',prompt:'notifications/cancelled'}} });
    assert.equal(bypass.status,409);
    assert.equal((await bypass.json()).accepted,false);
    await call('freeze', {});
    const checkpoint = await call('checkpoint', {});
    assert.equal(checkpoint.references.length,1);
    const saved = readState(join(durableDirectory, checkpoint.references[0]), 'checkpoint').value;
    assert.equal(saved.downstreamProtocol,downstream);
    assert.equal(saved.context.workspace,dir);
    assert.ok(saved.servedCatalogue.length > 10);
    assert.deepEqual(await call('checkpoint', {}),checkpoint);
    const drain = await call('drain-status', {});
    assert.equal(drain.complete, true);
    await call('commit-stop', { sourceGeneration: m.generation, sourceProcessIdentity: m.processIdentity,
      barrierId: barrier.barrierId, expectedDrainRevision: drain.revision, expectedInventoryRevision: inventoryRevision,
      targetBuildId: target.buildId, targetManifestDigest: target.manifestDigest, targetEntrypoint: target.entrypoint,
      selectionEpoch: 2, precheckEvidenceDigest: evidence });
    const deadline = Date.now()+3000;
    while (fs.existsSync(markerPath) && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(fs.existsSync(join(durableDirectory, 'operator-stop.json')), false);
  } finally {
    // PIDs were created by launchCentral above; no pattern or unrelated PID.
    if (source?.kind === 'started') await source.stop();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      child.ref(); const ended = new Promise(resolve => child.once('close', resolve)); child.kill('SIGTERM'); await ended;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
