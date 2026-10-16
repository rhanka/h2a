import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { digest, sign } from '../src/runtime/handover/wire.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';
import { authenticatedHttpRequest, readAuthenticationKey } from '../src/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';
import { liveTransactionReference } from '../src/runtime/handover/live-source.js';
import { localStorePaths, presenceFile } from '../dist/runtime/local-files/paths.js';

test('real .7 source should accept the external peer, preserve its admitted large reply and retire without deleting the successor marker', async () => {
  const { buildPackagingPrototype } = await import('../../../scripts/mh-l1-package-prototype.mjs');
  const { runIsolatedPrecheck } = await import('../src/runtime/handover/precheck.js');
  const dir = fs.mkdtempSync(join(process.env.XDG_CACHE_HOME, 'mh-l2-live-image-'));
  let source, peer, peerExit, lines, releaseTool, enterTool;
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
    await toolEntered;
    const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest, entrypoint: join(image, selection.entrypoint) };
    const oldSelection = readState(selectionPath, 'selection'); selection = { ...selection, selectionEpoch: 2 };
    replaceState(selectionPath, selection, 'selection', oldSelection);
    const precheckEvidenceDigest = await runIsolatedPrecheck(installation, target, 2, durable);
    peer = spawn(process.execPath, [fileURLToPath(new URL('./helpers/mh-l2-live-peer.mjs', import.meta.url))], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    peerExit = once(peer, 'exit'); let stderr = ''; peer.stderr.on('data', data => { stderr += data; });
    lines = createInterface({ input: peer.stdout });
    const [line] = await Promise.race([once(lines, 'line'), peerExit.then(([code]) => { throw new Error(`own peer exited ${code}: ${stderr}`); })]);
    const peerReady = JSON.parse(line); assert.equal(peerReady.processIdentity.pid, peer.pid);
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
    const call = async (operation, body = {}, expectedStatus = 200) => {
      const step = { protocolVersion: 1, mode: 'live-transfer', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
        expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision: 2, stepId: operation, payloadDigest: digest(body) };
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
    await call('barrier', { deadline: Date.now() + 60000 }); await call('freeze');
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
    const ownerPath = fs.readdirSync(durable).find(name => name.startsWith('ownership-'));
    assert.equal(readState(join(durable, ownerPath), 'ownership').value.state, 'TRANSFERRING');
    releaseTool();
    const reply = await (await running).json(); const overflow = JSON.parse(reply.result.content[0].text);
    assert.equal(overflow.code, 'response_too_large'); assert.ok(overflow.recovery.ref);
    assert.ok(fs.readFileSync(join(root, 'mcp-payloads', overflow.recovery.ref + '.bin'), 'utf8').includes('x'.repeat(1024)));
    assert.equal((await call('drain-status')).complete, true);
    // The external future peer may already own shared component control while
    // G0 is still finishing its independently admitted operations.
    const controlPath = join(durable, 'component-control.json'), control = readState(controlPath, 'componentControl');
    replaceState(controlPath, { ...control.value, revision: control.value.revision + 1,
      sourceGeneration: next.generation, ownerIdentity: next.processIdentity, ownerState: 'ACTIVE' }, 'componentControl', control);
    assert.equal((await call('retire', { publicationDigest })).state, 'RETIRED');
    await source.closed;
    assert.equal(readState(markerPath, 'marker').value.generation, next.generation);
    assert.deepEqual(fs.readFileSync(presencePath), presenceBefore);
    assert.equal(readState(join(durable, liveTransactionReference('h')), 'componentTransaction').value.state, 'RETIRED');
    assert.equal(readState(controlPath, 'componentControl').value.ownerState, 'ACTIVE');
    assert.equal(readState(controlPath, 'componentControl').value.sourceGeneration, next.generation);
    assert.equal(fs.existsSync(join(durable, 'operator-stop.json')), false);
  } finally {
    releaseTool?.(); if (source?.kind === 'started') await source.stop();
    lines?.close(); if (peer) { peer.stdin.end(); const [code] = await peerExit; assert.equal(code, 0); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
