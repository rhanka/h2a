import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { digest, sign } from '../src/runtime/handover/wire.js';
import { publishState, readState, replaceState } from '../src/runtime/handover/state.js';
import { authenticatedHttpRequest, readAuthenticationKey } from '../src/runtime/handover/authenticated-http.js';
import { currentIdentity } from '../src/runtime/handover/admission.js';
import { liveTransactionReference } from '../src/runtime/handover/live-source.js';
import { describeCatalogue } from '../src/runtime/handover/catalogue.js';
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from '../dist/runtime/mcp/tools.js';
import { spawnShim } from './helpers/mh-l1-shim.js';
import { localStorePaths, presenceFile } from '../dist/runtime/local-files/paths.js';

test('M21 real compiled shim should attach-transfer to the conformance peer while its real old central preserves G0 work', async t => {
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
  let source, shim, peer, peerExit, lines, releaseTool, releaseCancelled, enterTool, enterCancelled, originalFailure;
  const toolEntered = new Promise(resolve => { enterTool = resolve; });
  const cancelledEntered = new Promise(resolve => { enterCancelled = resolve; });
  let launches = 0;
  const enteredWithin = async (promise, label) => {
    let timer;
    try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new assert.AssertionError({ message: label })), 3000); })]); }
    finally { clearTimeout(timer); }
  };
  let ackLost = false, sourceAuth, sourceEvents;
  const admittedCalls = [], cancellations = [];
  const originalCreateServer = http.createServer;
  t.mock.method(http, 'createServer', handler => originalCreateServer((req, res) => {
    let wire = '';
    req.on('data', bytes => { wire += bytes; });
    req.on('end', () => {
      try {
        const envelope = JSON.parse(wire), message = JSON.parse(envelope.body ?? 'null');
        if (message?.method === 'tools/call' && message.params?.name === 'h2a_run') admittedCalls.push(message);
        if (message?.method === 'notifications/cancelled') cancellations.push(message);
        if (envelope.method === 'GET' && req.url === '/mcp') sourceEvents = res;
      } catch { /* Challenge traffic contains no application envelope. */ }
    });
    const end = res.end.bind(res);
    res.end = function(bytes, ...rest) {
      if (!ackLost && req.url?.startsWith('/_h2a-central/shim/') && req.url.endsWith('/ack') && bytes) {
        const frame = JSON.parse(bytes.toString());
        if (frame.payload?.body?.proofId === 'm21-proof') { ackLost = true; res.destroy(); return res; }
      }
      return end(bytes, ...rest);
    }; handler(req, res);
  })); syncBuiltinESMExports();
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
    const { ConnectionAuthentication } = await import(join(image, 'node_modules/@sentropic/h2a/dist/runtime/handover/authentication.js'));
    const frame = ConnectionAuthentication.prototype.frame;
    t.mock.method(ConnectionAuthentication.prototype, 'frame', function(...args) { sourceAuth = this; return frame.apply(this, args); });
    source = await startCentralMcpServer({ root, runtimeBase: runtime, writerProof: { evidenceDigest: payload.manifestDigest, verify: () => 'qualified' },
      runExecutor: () => { const first = ++launches === 1; if (first) enterTool(); else enterCancelled(); return new Promise(resolve => {
        const release = () => resolve({ state: 'started', ok: true, prompt: { delivered: true }, padding: 'x'.repeat(2 * 1024 * 1024) });
        if (first) releaseTool = release; else releaseCancelled = release; }); } });
    assert.equal(source.kind, 'started');
    const markerPath = source.markerPath, m = readState(markerPath, 'marker').value, durable = m.stateDirectory;
    shim = spawnShim(fileURLToPath(new URL('./helpers/mh-l3-shim.mjs', import.meta.url)),
      [join(image, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central-shim.js'), root, runtime],
      { ...process.env, H2A_ROOT: root, XDG_RUNTIME_DIR: runtime, CLAUDE_CODE_SESSION_ID: 'real-shim-m21' }, dir);
    const rpc = async (id, method, params) => { shim.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }); return shim.response(id); };
    assert.ok((await rpc('init', 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })).result);
    let instance;
    for (let i = 0; i < 60; i++) {
      const reply = await rpc('identity-' + i, 'tools/call', { name: 'h2a_identity_status', arguments: {} });
      const status = reply.result && JSON.parse(reply.result.content[0].text);
      if (status?.state === 'identity_ready') { instance = status.instance; break; }
      await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(instance, shim.stderr);
    shim.send({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'h2a_run', _meta: { progressToken: 17 }, arguments: {
      profile: 'claude', name: 'retained-g0', prompt: 'fixture', workspace: dir, background: true, h2aSidecar: false } } });
    await enteredWithin(toolEntered, 'the numeric G0 call must be admitted');
    shim.send({ jsonrpc: '2.0', id: '17', method: 'tools/call', params: { name: 'h2a_run', _meta: { progressToken: '17' }, arguments: {
      profile: 'claude', name: 'cancelled-g0', prompt: 'fixture', workspace: dir, background: true, h2aSidecar: false } } });
    await enteredWithin(cancelledEntered, 'the string G0 call must be admitted independently of the numeric ID');
    const target = { packageVersion: selection.packageVersion, buildId: selection.buildId, manifestDigest: selection.manifestDigest, entrypoint: join(image, selection.entrypoint) };
    const oldSelection = readState(selectionPath, 'selection'); selection = { ...selection, selectionEpoch: 2 };
    replaceState(selectionPath, selection, 'selection', oldSelection);
    const precheckEvidenceDigest = await runIsolatedPrecheck(installation, target, 2, durable);
    peer = spawn(process.execPath, [fileURLToPath(new URL('./helpers/mh-l3-peer.mjs', import.meta.url))], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const targetDescriptor = describeCatalogue([...JSON.parse(JSON.stringify(H2A_CLI_MCP_TOOL_DESCRIPTORS)),
      { name: 'fixture_added', description: 'Conformance peer only', inputSchema: { type: 'object', additionalProperties: false } }]);
    const next = { ...m, descriptorDigest: targetDescriptor.descriptorDigest, contractDigest: targetDescriptor.contractDigest,
      generation: '33333333-3333-4333-8333-333333333333', publicationEpoch: { ...m.publicationEpoch, counter: m.publicationEpoch.counter + 1 },
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
    let inventoryObservation = 0, inventoryRevision = 1;
    const call = async (operation, body = {}, expectedStatus = 200) => {
      const step = { protocolVersion: 1, mode: 'live-transfer', upgradeId: 'u', handoverId: 'h', transactionEpoch: 1,
        expectedGeneration: m.generation, expectedPublicationEpoch: m.publicationEpoch, inventoryRevision,
        stepId: operation === 'inventory' ? `inventory-${++inventoryObservation}` : operation, payloadDigest: digest(body) };
      const response = await authenticatedHttpRequest(markerPath, m, new URL(`/_h2a-central/admin/${operation}`, m.endpoint), { method: 'POST', body: JSON.stringify({ step, payload: body, coordinator }) });
      const value = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(value)); return value;
    };
    inventoryRevision = (await call('inventory')).revision;
    const authorizationDigest = save('authorization', { schemaVersion: 1, purpose: 'live-source-authorization', source: m, targetPublication: next, target,
      authorization: { upgradeId: 'u', handoverId: 'h', transactionEpoch: 1, controllerEpoch: 2, selectedManifestDigest: target.manifestDigest,
        delegatedControllerIdentity: coordinator, delegationReceiptDigest: receiptDigest }, inventoryRevision, selectionEpoch: 2, issuedAt: Date.now(), expiresAt: Date.now() + 60000 });
    const unsigned = await fetch(new URL('/_h2a-central/admin/reserve', m.endpoint), { method: 'POST', body: '{}' });
    assert.equal(unsigned.status, 401); await unsigned.text();
    const reserved = await call('reserve', { target, controllerEpoch: 2, selectionEpoch: 2, precheckEvidenceDigest, authorizationDigest });
    assert.equal(reserved.state, 'RESERVED'); assert.equal((await call('describe')).liveCoordinator, false);
    await call('barrier', { deadline: Date.now() + 60000 });
    await call('freeze');
    const checkpoints = await call('checkpoint');
    const checkpoint = readState(join(durable, checkpoints.references[0]), 'checkpoint').value;
    assert.equal(checkpoint.context.workspace, dir); assert.equal(checkpoint.presence.length, 1);
    const presencePath = presenceFile(localStorePaths(root), checkpoint.presence[0].sessionId);
    const presenceBefore = fs.readFileSync(presencePath);
    const inventory = await call('inventory'); assert.equal(inventory.shims.length, 1);
    const item = inventory.shims[0], descriptor = targetDescriptor;
    assert.equal(item.shimBuildId, payload.manifest.buildId);
    assert.equal(item.shimVersion, payload.manifest.packageVersion);
    const offerUrl = new URL('/_h2a-central/shim/' + item.attachmentId + '/offer', m.endpoint);
    const offering = await authenticatedHttpRequest(markerPath, m, offerUrl, { attachmentId: item.attachmentId });
    const challenge = await offering.json();
    const report = { fixture: 'no-semantic-verifier', verdict: 'additive-compatible' };
    const proofBody = { schemaVersion: 1, proofId: 'm21-proof', mode: 'handover', namespaceId: m.namespaceId, root, uid: m.uid,
      attester: { generation: m.generation, publicationEpoch: m.publicationEpoch, processIdentity: m.processIdentity, buildId: m.buildId },
      verifier: { algorithmVersion: 'conformance-only', buildId: next.buildId, reportDigest: digest(report), verdict: 'additive-compatible' },
      authorization: { upgradeId: 'u', handoverId: 'h', transactionEpoch: 1, controllerEpoch: 2, selectedManifestDigest: next.manifestDigest,
        delegatedControllerIdentity: coordinator, delegationReceiptDigest: receiptDigest },
      source: challenge.sourceView, target: { generation: next.generation, publicationEpoch: next.publicationEpoch, endpoint: next.endpoint,
        buildId: next.buildId, manifestDigest: next.manifestDigest, descriptorDigest: descriptor.descriptorDigest, contractDigest: descriptor.contractDigest, catalogueRevision: 1 },
      attachmentId: item.attachmentId, inventoryRevision: inventory.revision, issuedAt: Date.now(), expiresAt: Date.now() + 60000, challengeNonce: challenge.challengeNonce };
    const proof = { ...proofBody, mac: sign(key, 'compatibility', signingContext, proofBody) };
    const offer = { proof, descriptor, report, targetPublication: next, catalogueRevision: 1 };
    const badOffers = [
      o => { o.proof.mac = '0'.repeat(64); },
      o => { o.proof.challengeNonce = 'foreign-nonce'; },
      o => { o.proof.inventoryRevision++; },
      o => { o.proof.authorization.controllerEpoch++; },
      o => { o.proof.mode = 'catalogue'; },
      o => { o.targetPublication.endpoint = 'http://127.0.0.1:1/mcp'; },
      o => { o.report.fixture = 'altered-report'; }
    ];
    for (let i = 0; i < badOffers.length; i++) {
      const bad = structuredClone(offer); badOffers[i](bad);
      if (i !== 0) { const { mac, ...body } = bad.proof; bad.proof.mac = sign(key, 'compatibility', signingContext, body); }
      const refused = await authenticatedHttpRequest(markerPath, m, offerUrl, { method: 'POST', body: JSON.stringify(bad) });
      assert.equal(refused.status, 409, `invalid offer ${i}: ${await refused.text()}`);
    }
    const offered = await authenticatedHttpRequest(markerPath, m, offerUrl, { method: 'POST', body: JSON.stringify(offer) });
    assert.equal(offered.status, 200, await offered.text());
    let acknowledged;
    for (let i = 0; i < 100; i++) {
      const response = await authenticatedHttpRequest(markerPath, m, offerUrl, { attachmentId: item.attachmentId });
      acknowledged = (await response.json()).acceptance;
      if (acknowledged) break; await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(acknowledged?.proofDigest, digest(proof), shim.stderr);
    assert.equal(ackLost, true, 'the actual ACK response was lost after its durable acceptance');
    assert.equal((await peerCommand({ operation: 'prepare', target: next, key: key.toString('hex'), descriptor,
      root, markerPath, attachmentId: checkpoint.attachmentId, checkpointHash: digest(checkpoint), sourceGeneration: m.generation,
      handoverId: 'h', proofDigest: digest(proof), instance })).prepared, true);
    const publicationDigest = save('publication', { schemaVersion: 1, purpose: 'live-source-publication', authorizationDigest,
      markerDigest: digest(next), checkpointReferences: checkpoints.references });
    assert.equal((await call('retire', { publicationDigest }, 409)).error, 'live_publication_mismatch');
    replaceState(markerPath, next, 'marker', readState(markerPath, 'marker'));
    assert.equal((await call('retire', { publicationDigest }, 409)).error, 'drain_blocked');
    const probes = join(root, 'g1-catalogue-probes');
    for (let i = 0; !fs.existsSync(probes) && i < 100; i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(fs.existsSync(probes), 'the shim must verify the actual target catalogue before new admissions');
    const premature = await rpc('before-catalogue-correction', 'tools/list');
    assert.equal(premature.result.tools.some(t => t.name === 'fixture_added'), false, 'wrong target revision cannot change the served view');
    assert.equal(fs.existsSync(join(root, 'g1-admitted-work')), false);
    assert.equal((await peerCommand({ operation: 'catalogue-correct' })).corrected, true);
    let g1;
    for (let i = 0; i < 60; i++) {
      const listed = await rpc('list-g1-' + i, 'tools/list');
      if (!listed.result.tools.some(t => t.name === 'fixture_added')) { await new Promise(r => setTimeout(r, 100)); continue; }
      assert.ok(shim.frames.some(f => f.method === 'notifications/tools/list_changed'), 'installed catalogue must be visible immediately after listChanged');
      g1 = await rpc('g1-' + i, 'tools/call', { name: 'fixture_added', arguments: {} });
      if (g1.result) break; await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(g1?.result, JSON.stringify(g1) + shim.stderr);
    assert.equal(JSON.parse(g1.result.content[0].text).generation, next.generation, shim.stderr);
    assert.equal(fs.readFileSync(join(root, 'g1-admitted-work'), 'utf8'), 'G1 admitted while G0 drains');
    assert.notEqual(admittedCalls[0].id, admittedCalls[1].id);
    assert.notEqual(admittedCalls[0].params._meta.progressToken, admittedCalls[1].params._meta.progressToken);
    assert.ok(sourceEvents && !sourceEvents.destroyed, 'G0 notification transport must remain during G1 admissions');
    const progress = sourceAuth.frame({ jsonrpc: '2.0', method: 'notifications/progress', params: {
      progressToken: admittedCalls[0].params._meta.progressToken, progress: 7 } }, {
      channel: 'notifications', attachmentId: item.attachmentId, transportEpoch: 1, requestUid: null });
    sourceEvents.write('data: ' + JSON.stringify(progress) + '\n\n');
    for (let i = 0; !shim.frames.some(f => f.method === 'notifications/progress') && i < 100; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(shim.frames.find(f => f.method === 'notifications/progress')?.params.progressToken, 17);
    assert.ok(Number(fs.readFileSync(probes, 'utf8')) >= 2);
    const ownerPath = fs.readdirSync(durable).find(name => name.startsWith('ownership-'));
    assert.equal(readState(join(durable, ownerPath), 'ownership').value.ownerGeneration, next.generation);
    shim.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: '17' } });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(fs.existsSync(join(root, 'g1-cancellation')), false, 'cancellation must target G0 while G1 is current');
    assert.equal(cancellations.at(-1)?.params.requestId, admittedCalls[1].id);
    const reused = await rpc('17', 'tools/call', { name: 'fixture_added', arguments: {} });
    assert.equal(JSON.parse(reused.result.content[0].text).generation, next.generation);
    releaseCancelled();
    releaseTool();
    const reply = await shim.response(17); const overflow = JSON.parse(reply.result.content[0].text);
    assert.equal(overflow.code, 'response_too_large'); assert.ok(overflow.recovery.ref);
    assert.ok(fs.readFileSync(join(root, 'mcp-payloads', overflow.recovery.ref + '.bin'), 'utf8').includes('x'.repeat(1024)));
    assert.equal((await call('drain-status')).complete, true);
    assert.equal(shim.frames.filter(f => f.id === '17').length, 1, 'a late cancelled G0 result cannot settle a reused G1 ID');
    const beforeReuse = shim.frames.length;
    shim.send({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'fixture_added', arguments: {} } });
    for (let i = 0; !shim.frames.slice(beforeReuse).some(f => f.id === 17) && i < 100; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(JSON.parse(shim.frames.slice(beforeReuse).find(f => f.id === 17)?.result.content[0].text).generation, next.generation);
    assert.equal(launches, 2, 'neither old call may be replayed');
    const controlPath = join(durable, 'component-control.json');
    assert.equal((await call('retire', { publicationDigest })).state, 'RETIRED');
    await source.closed;
    assert.equal(readState(markerPath, 'marker').value.generation, next.generation);
    assert.deepEqual(fs.readFileSync(presencePath), presenceBefore);
    assert.equal(readState(join(durable, liveTransactionReference('h')), 'componentTransaction').value.state, 'RETIRED');
    assert.equal(readState(controlPath, 'componentControl').value.ownerState, 'ACTIVE');
    assert.equal(readState(controlPath, 'componentControl').value.sourceGeneration, next.generation);
    assert.equal(readState(join(durable, ownerPath), 'ownership').value.ownerGeneration, next.generation);
    const newOperation = fs.readdirSync(durable).filter(n => n.startsWith('operation-')).map(n => readState(join(durable, n), 'admittedOperation').value).find(op => op.ownerGeneration === next.generation);
    assert.equal(newOperation.state, 'pending'); assert.equal(newOperation.executionOwner.pid, peer.pid);
    assert.equal(fs.existsSync(join(durable, 'operator-stop.json')), false);
    assert.equal((await peerCommand({ operation: 'complete' })).completed, true);
  } catch (error) {
    originalFailure = error; throw error;
  } finally {
    let stopError;
    await shim?.close();
    try { releaseTool?.(); releaseCancelled?.(); if (source?.kind === 'started') await source.stop(); } catch (error) { stopError = error; }
    try { lines?.close(); if (peer) { peer.stdin.end(); const [code] = await peerExit; if (!originalFailure) assert.equal(code, 0); } }
    finally {
      if (priorTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = priorTmpdir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (!originalFailure && stopError) throw stopError;
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});
