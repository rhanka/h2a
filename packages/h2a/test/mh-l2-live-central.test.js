import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { digest, sign } from '../src/runtime/handover/wire.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';
import { authenticatedHttpRequest, readAuthenticationKey } from '../src/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';
import { liveTransactionReference } from '../src/runtime/handover/live-source.js';
import { localStorePaths, presenceFile } from '../dist/runtime/local-files/paths.js';

test('real .7 source should accept the external peer, preserve its admitted large reply and retire without deleting the successor marker', async () => {
  const { buildPackagingPrototype } = await import('../../../scripts/mh-l1-package-prototype.mjs');
  const { runIsolatedPrecheck } = await import('../src/runtime/handover/precheck.js');
  let dir;
  assert.doesNotThrow(() => {
    dir = fs.mkdtempSync(join(process.env.H2A_HANDOVER_TEST_TMPDIR || process.env.TMPDIR || tmpdir(), 'mh-l2-live-image-'));
  });
  const priorTmpdir = process.env.TMPDIR;
  // The injected run still enforces durable-workspace separation. Keep its
  // workspace in this private fixture and its OS scratch in a distinct child.
  process.env.TMPDIR = join(dir, 'tmp');
  fs.mkdirSync(process.env.TMPDIR, { mode: 0o700 });
  let source, peer, peerExit, lines, releaseTool, enterTool, originalFailure;
  const toolEntered = new Promise(resolve => { enterTool = resolve; });
  try {
    const managedRoot = join(dir, 'h2a-managed', String(process.getuid()));
    const images = join(managedRoot, 'images'), state = join(managedRoot, 'state'), root = join(dir, 'store'), runtime = join(dir, 'run');
    for (const path of [images, state, root, runtime]) fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    const payload = await buildPackagingPrototype(join(dir, 'payload'), { buildId: 'fixture-live-source' });
    const image = join(images, payload.manifestDigest.slice(7)); fs.renameSync(payload.root, image);
    const installation = { schemaVersion: 1, canonicalPrefix: dir, uid: process.getuid(), managedRoot,
      prefixId: digest({ canonicalPrefix: dir, uid: process.getuid() }) };
    publishState(join(managedRoot, 'installation.json'), installation, 'installation');
    const npmBin = join(dir, 'lib', 'node_modules', '@sentropic', 'h2a', 'dist', 'bin.js');
    fs.mkdirSync(join(dir, 'bin'), { mode: 0o700 }); fs.mkdirSync(join(npmBin, '..'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(npmBin, '// private npm-router fixture\n', { mode: 0o600 }); fs.symlinkSync(npmBin, join(dir, 'bin', 'h2a'));
    const selectionPath = join(state, 'selected-build.json');
    let selection = { schemaVersion: 1, prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(), selectionEpoch: 1,
      packageVersion: payload.manifest.packageVersion, buildId: payload.manifest.buildId, manifestDigest: payload.manifestDigest,
      entrypoint: 'dist/bin.js', previousSelectionReference: null, upgradeId: 'u' };
    publishState(selectionPath, selection, 'selection');
    const { startCentralMcpServer } = await import(join(image, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js'));
    source = await startCentralMcpServer({ root, runtimeBase: runtime, writerProof: { evidenceDigest: payload.manifestDigest, verify: () => 'qualified' },
      runExecutor: () => { enterTool(); return new Promise(resolve => { releaseTool = () => resolve({ state: 'started', ok: true,
        prompt: { delivered: true }, padding: 'x'.repeat(2 * 1024 * 1024) }); }); } });
    assert.equal(source.kind, 'started');
    const markerPath = source.markerPath, m = readState(markerPath, 'marker').value, durable = m.stateDirectory;
    let session;
    const post = body => authenticatedHttpRequest(markerPath, m, m.endpoint, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-h2a-workspace': encodeURIComponent(dir), ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body) });
    const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'passive-live-fixture', version: '1' } } });
    assert.equal(initialized.status, 200); session = initialized.headers.get('mcp-session-id');
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const opened = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'h2a_session_open', arguments: { instance: 'live-fixture' } } });
    assert.equal(opened.status, 200);
    const running = post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'h2a_run', arguments: {
      profile: 'claude', name: 'retained-g0', prompt: 'fixture', workspace: dir, background: true, h2aSidecar: false } } });
    // A failing assertion must report its cause even when cleanup closes the
    // deliberately suspended HTTP call. The original promise is still awaited.
    void running.catch(() => {});
    await Promise.race([toolEntered, running.then(async response => {
      throw new Error('fixture tool finished before entering the injected executor: ' + JSON.stringify(await response.json()));
    })]);
    const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest, entrypoint: join(image, selection.entrypoint) };
    const oldSelection = readState(selectionPath, 'selection'); selection = { ...selection, selectionEpoch: 2 };
    replaceState(selectionPath, selection, 'selection', oldSelection);
    const precheckEvidenceDigest = await runIsolatedPrecheck(installation, target, 2, durable);
    peer = spawn(process.execPath, [fileURLToPath(new URL('./helpers/mh-l2-live-peer.mjs', import.meta.url))], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    peerExit = once(peer, 'exit'); let stderr = ''; peer.stderr.on('data', data => { stderr += data; });
    lines = createInterface({ input: peer.stdout });
    const [line] = await Promise.race([once(lines, 'line'), peerExit.then(([code]) => { throw new Error(`own peer exited ${code}: ${stderr}`); })]);
    const peerReady = JSON.parse(line); assert.equal(peerReady.processIdentity.pid, peer.pid);
    const peerCommand = async command => {
      const reply = Promise.race([once(lines, 'line'), peerExit.then(([code]) => { throw new Error(`own peer exited ${code}: ${stderr}`); })]);
      peer.stdin.write(JSON.stringify(command) + '\n');
      const [line] = await reply, result = JSON.parse(line);
      if (result.error) throw new Error(result.error);
      return result;
    };
    const next = { ...m, generation: '33333333-3333-4333-8333-333333333333', publicationEpoch: { ...m.publicationEpoch, counter: m.publicationEpoch.counter + 1 },
      predecessorGeneration: m.generation, processIdentity: peerReady.processIdentity, pid: peer.pid, endpoint: peerReady.endpoint };
    const coordinator = currentIdentity(), upgradeDirectory = join(state, 'upgrade');
    for (const path of [join(upgradeDirectory, 'transactions'), join(upgradeDirectory, 'receipts')]) fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    const ticket = { schemaVersion: 1, upgradeId: 'u', controllerEpoch: 2, expectedRevision: 1, delegatedBuildId: target.buildId,
      targetManifestDigest: target.manifestDigest, delegatedControllerIdentity: coordinator, ticketNonce: 'private-fixture-ticket', expiresAt: Date.now() + 60000 };
    const receipt = { schemaVersion: 1, upgradeId: 'u', controllerEpoch: 2, previousRevision: 1, delegatedControllerIdentity: coordinator,
      delegatedBuildId: target.buildId, targetManifestDigest: target.manifestDigest, ticketDigest: digest(ticket) };
    const receiptDigest = digest(receipt);
    publishState(join(upgradeDirectory, 'ticket.json'), ticket, 'delegationTicket');
    publishState(join(upgradeDirectory, 'receipts', `${receiptDigest.slice(7)}.json`), receipt, 'delegationReceipt');
    publishState(join(upgradeDirectory, 'transactions', 'u.json'), { schemaVersion: 1, upgradeId: 'u', revision: 2,
      prefixId: installation.prefixId, canonicalPrefix: dir, uid: process.getuid(), requestedTarget: target.packageVersion, resolvedTarget: target.packageVersion,
      artifactDigests: {}, targetManifestDigest: target.manifestDigest, origin: 'manual', initiatorIdentity: coordinator, controllerIdentity: coordinator,
      controllerBuildId: target.buildId, controllerEpoch: 2, controllerAuthorityState: 'ACTIVE', delegationState: 'DELEGATED', delegatedBuildId: target.buildId,
      delegationReceiptDigest: receiptDigest, privateTicketReference: 'ticket.json', installationState: 'ACTIVATING', selectionEpoch: 2,
      previousSelectionReference: null, componentTransactions: { mcp: relative(state, join(durable, liveTransactionReference('h'))) },
      observations: {}, verification: {}, createdAt: Date.now(), updatedAt: Date.now() }, 'upgradeTransaction');
    const key = readAuthenticationKey(markerPath, m), signingContext = { service: m.service, namespaceId: m.namespaceId, generation: m.generation };
    const save = (kind, value) => {
      if (kind === 'authorization') value = { ...value, ticketMac: sign(createHash('sha256').update(ticket.ticketNonce).digest(),
        'requests', signingContext, { purpose: 'live-source-ticket', authorization: value }) };
      const signed = { ...value, mac: sign(key, 'compatibility', signingContext, value) }, hash = digest(signed);
      publishState(join(durable, `live-${kind}-${hash.slice(7)}.json`), signed, kind === 'authorization' ? 'liveSourceAuthorization' : 'liveSourcePublication'); return hash;
    };
    let inventoryObservation = 0;
    const call = async (operation, body = {}, expectedStatus = 200) => {
      const step = { protocolVersion: 1, mode: 'live-transfer', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
        expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: 2,
        stepId: operation === 'inventory' ? `inventory-${++inventoryObservation}` : operation, payloadDigest: digest(body) };
      const response = await authenticatedHttpRequest(markerPath, m, new URL(`/_h2a-central/admin/${operation}`, m.endpoint), { method: 'POST', body: JSON.stringify({ step, payload: body, coordinator }) });
      const value = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(value)); return value;
    };
    const authorizationDigest = save('authorization', { schemaVersion: 1, purpose: 'live-source-authorization', source: m, targetPublication: next, target,
      authorization: { upgradeId: 'u', handoverId: 'h', transactionEpoch: 1, controllerEpoch: 2, selectedManifestDigest: target.manifestDigest,
        delegatedControllerIdentity: coordinator, delegationReceiptDigest: receiptDigest }, inventoryRevision: 2, selectionEpoch: 2, issuedAt: Date.now(), expiresAt: Date.now() + 60000 });
    const unsigned = await fetch(new URL('/_h2a-central/admin/reserve', m.endpoint), { method: 'POST', body: '{}' });
    assert.equal(unsigned.status, 401); await unsigned.text();
    const reserved = await call('reserve', { target, controllerEpoch: 2, selectionEpoch: 2, precheckEvidenceDigest, authorizationDigest });
    assert.equal(reserved.state, 'RESERVED'); assert.equal((await call('describe')).liveCoordinator, false);
    const refuseDelete = async state => {
      const before = await call('inventory');
      const response = await authenticatedHttpRequest(markerPath, m, m.endpoint, { method: 'DELETE', headers: { 'mcp-session-id': session } });
      assert.equal(response.status, 409, `DELETE must preserve the ${state} inventory`);
      assert.deepEqual(await response.json(), { error: 'admission_closed', accepted: false, execution: 'not_started' });
      const after = await call('inventory');
      assert.equal(after.revision, before.revision);
      assert.deepEqual(after.transports, before.transports);
    };
    await call('barrier', { deadline: Date.now() + 60000 }); await refuseDelete('BARRIER');
    await call('freeze'); await refuseDelete('FROZEN');
    const checkpoints = await call('checkpoint');
    const checkpoint = readState(join(durable, checkpoints.references[0]), 'checkpoint').value;
    assert.equal(checkpoint.context.workspace, dir); assert.equal(checkpoint.presence.length, 1);
    const presencePath = presenceFile(localStorePaths(root), checkpoint.presence[0].sessionId);
    const presenceBefore = fs.readFileSync(presencePath);
    const publicationDigest = save('publication', { schemaVersion: 1, purpose: 'live-source-publication', authorizationDigest,
      markerDigest: digest(next), checkpointReferences: checkpoints.references });
    assert.equal((await call('retire', { publicationDigest }, 409)).error, 'live_publication_mismatch');
    replaceState(markerPath, next, 'marker', readState(markerPath, 'marker'));
    assert.equal((await call('retire', { publicationDigest }, 409)).error, 'drain_blocked');
    await refuseDelete('PUBLISHED');
    const ownerPath = fs.readdirSync(durable).find(name => name.startsWith('ownership-'));
    assert.equal(readState(join(durable, ownerPath), 'ownership').value.state, 'TRANSFERRING');
    const acquisition = await peerCommand({ operation: 'acquire', target: next, root, markerPath,
      attachmentId: checkpoint.attachmentId, checkpointHash: digest(checkpoint), sourceGeneration: m.generation, handoverId: 'h' });
    assert.equal(acquisition.acquired, true);
    assert.equal(fs.readFileSync(join(root, 'g1-admitted-work'), 'utf8'), 'G1 admitted while G0 drains');
    releaseTool();
    const reply = await (await running).json(); const overflow = JSON.parse(reply.result.content[0].text);
    assert.equal(overflow.code, 'response_too_large'); assert.ok(overflow.recovery.ref);
    assert.ok(fs.readFileSync(join(root, 'mcp-payloads', overflow.recovery.ref + '.bin'), 'utf8').includes('x'.repeat(1024)));
    assert.equal((await call('drain-status')).complete, true);
    const controlPath = join(durable, 'component-control.json');
    assert.equal((await call('retire', { publicationDigest })).state, 'RETIRED');
    await source.closed;
    assert.equal(readState(markerPath, 'marker').value.generation, next.generation);
    assert.deepEqual(fs.readFileSync(presencePath), presenceBefore);
    assert.equal(readState(join(durable, liveTransactionReference('h')), 'componentTransaction').value.state, 'RETIRED');
    assert.equal(readState(controlPath, 'componentControl').value.ownerState, 'ACTIVE');
    assert.equal(readState(controlPath, 'componentControl').value.sourceGeneration, next.generation);
    assert.equal(readState(join(durable, ownerPath), 'ownership').value.ownerGeneration, next.generation);
    const newOperation = readState(join(durable, `operation-${digest(acquisition.operationId).slice(7)}.json`), 'admittedOperation').value;
    assert.equal(newOperation.state, 'pending'); assert.equal(newOperation.executionOwner.pid, peer.pid);
    assert.equal(fs.existsSync(join(durable, 'operator-stop.json')), false);
    assert.equal((await peerCommand({ operation: 'complete' })).completed, true);
  } catch (error) {
    originalFailure = error; throw error;
  } finally {
    let stopError;
    try { releaseTool?.(); if (source?.kind === 'started') await source.stop(); } catch (error) { stopError = error; }
    try { lines?.close(); if (peer) { peer.stdin.end(); const [code] = await peerExit; if (!originalFailure) assert.equal(code, 0); } }
    finally {
      if (priorTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = priorTmpdir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (!originalFailure && stopError) throw stopError;
  }
});
