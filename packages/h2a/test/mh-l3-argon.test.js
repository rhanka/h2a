import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { fixture, json } from './helpers/mh-l3-network.js';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';
import { captureCentralAttachment } from '../dist/runtime/mcp-central-context.js';
import { bridgeCentralMcpStdio } from '../dist/runtime/mcp-central-client.js';
import { authenticatedHttpRequest } from '../src/runtime/handover/authenticated-http.js';
import { prepareAuthority } from '../src/runtime/handover/admission.js';
import { readState } from '../src/runtime/handover/state.js';
import { describeCatalogue } from '../src/runtime/handover/catalogue.js';
import { embeddedTools } from '../dist/runtime/mcp-central-descriptor.js';
import { H2A_CLI_MCP_TOOL_DESCRIPTORS } from '../dist/runtime/mcp/tools.js';

const until = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('expected observable fixture state');
};
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

for (const loss of ['SSE EOF', 'SSE error', 'missing marker']) {
  test(`recovery should defer autostart after ${loss} and let an external publication win`, async t => {
    let stream, registered = false, resumes = 0, ensures = 0, tick;
    const interval = globalThis.setInterval;
    const timerMock = t.mock.method(globalThis, 'setInterval', (fn, ms, ...args) => {
      if (ms === 1000) { tick = fn; return interval(() => {}, 60_000); }
      return interval(fn, ms, ...args);
    });
    let f;
    try {
      f = await fixture(async request => {
        const path = new URL(request.url).pathname;
        if (request.method === 'DELETE') return new Response(null, { status: 204 });
        if (path.endsWith('/register')) { registered = true; return json({ challengeNonce: 'fixture-challenge' }); }
        if (path.endsWith('/offer')) return json({ offer: null });
        if (path.endsWith('/status')) return json({ attachmentId: request.headers.get('x-h2a-auth-attachment-id'),
          generation: JSON.parse(fs.readFileSync(join(f.dir, 'run/h2a-mcp-central/marker.json'))).generation,
          transportEpoch: Number(request.headers.get('x-h2a-auth-transport-epoch')), expectedInstance: 'identity_disabled' });
        if (path.startsWith('/_h2a-central/lease/')) return json({ state: 'identity_disabled' });
        if (request.method === 'GET') return new Response(new ReadableStream({ start(c) { stream = c; } }), { headers: { 'content-type': 'text/event-stream' } });
        const body = await request.json();
        if (path === '/_h2a-central/resume') {
          resumes++; return json({ attachmentId: body.attachmentId, generation: body.expectedGeneration,
            transportEpoch: body.expectedTransportEpoch + 1, sessionId: 'resumed-session' });
        }
        if (body.method === 'initialize') return json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, 'original-session');
        if (body.id !== undefined) return json({ jsonrpc: '2.0', id: body.id, result: {} });
        return new Response(null, { status: 202 });
      }, ({ root, dir }) => ({ attachment: captureCentralAttachment(root, dir, { host: 'claude' }, { CLAUDE_CODE_SESSION_ID: 'argon-recovery' }),
        ensure: async () => { ensures++; } }));
      timerMock.mock.restore();
      f.send({ id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } });
      await f.wait(m => m.id === 'init'); await until(() => stream && registered); await flush();
      assert.equal(typeof tick, 'function');
      let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => 1);
      const markerPath = join(f.dir, 'run/h2a-mcp-central/marker.json'), publication = fs.readFileSync(markerPath);
      fs.unlinkSync(markerPath);
      if (loss === 'SSE EOF') stream.close();
      else if (loss === 'SSE error') stream.error(new Error('fixture disconnect'));
      else tick();
      await flush();
      now += 1; tick(); await flush();
      assert.equal(ensures, 0, 'a recovery tick must not reserve a competing startup before the first backoff');
      f.send({ id: 'during-gap', method: 'ping' });
      assert.equal((await f.wait(m => m.id === 'during-gap')).error.data.code, 'central_unavailable');
      assert.equal(ensures, 0, 'downstream demand must obey the same backoff');
      // The external owner publishes inside the first recovery interval.
      now += 499; fs.writeFileSync(markerPath, publication, { mode: 0o600 }); tick(); await flush();
      assert.equal(resumes, 0);
      now += 501; tick(); await until(() => resumes === 1); await flush();
      f.send({ id: 'after', method: 'ping' }); assert.ok((await f.wait(m => m.id === 'after')).result);
      assert.equal(ensures, 0); assert.equal(resumes, 1);
      // Recovery still autostarts after its bounded grace if nobody publishes.
      fs.unlinkSync(markerPath); stream.error(new Error('second fixture disconnect')); await flush();
      now += 1; tick(); await flush(); assert.equal(ensures, 0);
      now += 1000; tick(); await until(() => ensures === 1);
    } finally { t.mock.restoreAll(); await f?.close(); }
  });
}

test('real central should register the retained shim catalogue as inventory without granting compatibility', async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-argon-register-'));
  const input = new PassThrough(), output = new PassThrough(), abort = new AbortController();
  const tools = structuredClone(embeddedTools), served = describeCatalogue(tools);
  const index = H2A_CLI_MCP_TOOL_DESCRIPTORS.findIndex(t => t.name === 'h2a_identity_status');
  const original = H2A_CLI_MCP_TOOL_DESCRIPTORS[index];
  let central, running, reader, tick, polls = 0;
  const createServer = http.createServer;
  t.mock.method(http, 'createServer', handler => createServer((req, res) => {
    if (req.url?.endsWith('/offer')) polls++;
    handler(req, res);
  })); syncBuiltinESMExports();
  try {
    assert.ok(index >= 0);
    // A real central with a changed normative contract; the compiled shim
    // retains its own embedded catalogue and must advertise that exact view.
    H2A_CLI_MCP_TOOL_DESCRIPTORS[index] = { ...structuredClone(original), inputSchema: {
      type: 'object', properties: { argonRequired: { type: 'boolean' } }, required: ['argonRequired'] } };
    const root = join(dir, 'store'), runtimeBase = join(dir, 'run'); fs.mkdirSync(runtimeBase, { mode: 0o700 });
    central = await startCentralMcpServer({ root, runtimeBase, physicalPrefix: dir });
    const marker = readState(central.markerPath, 'marker').value;
    assert.notEqual(marker.descriptorDigest, served.descriptorDigest); assert.notEqual(marker.contractDigest, served.contractDigest);
    const attachment = captureCentralAttachment(root, dir, { host: 'claude' }, { CLAUDE_CODE_SESSION_ID: 'argon-register' });
    const frames = []; reader = createInterface({ input: output }); reader.on('line', line => frames.push(JSON.parse(line)));
    const interval = globalThis.setInterval;
    const timerMock = t.mock.method(globalThis, 'setInterval', (fn, ms) => { tick = fn; return interval(() => {}, 60_000); });
    running = bridgeCentralMcpStdio({ runtimeBase, stdin: input, stdout: output, signal: abort.signal, attachment });
    timerMock.mock.restore();
    const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    send({ id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    send({ id: 'ping', method: 'ping' }); await until(() => frames.some(m => m.id === 'ping'));
    assert.ok(frames.find(m => m.id === 'ping').result);
    const headers = { 'content-type': 'application/json', 'x-h2a-attachment': Buffer.from(JSON.stringify(attachment)).toString('base64url') };
    const request = (path, body, epoch = 1) => authenticatedHttpRequest(central.markerPath, marker, new URL(path, central.endpoint), {
      attachmentId: attachment.id, transportEpoch: epoch, headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const path = `/_h2a-central/shim/${attachment.id}`;
    const inventory = await (await request(path + '/offer')).json();
    assert.ok(inventory.challengeNonce, 'a divergent catalogue must not suppress registration or offer polling');
    assert.deepEqual(inventory.sourceView, { generation: null, buildId: 'npm-unmanaged', profileId: `linux-${process.arch}-node${process.versions.node.split('.')[0]}`,
      descriptorDigest: served.descriptorDigest, contractDigest: served.contractDigest });
    assert.equal(inventory.offer, null); assert.equal(inventory.acceptance, null);
    const beforePoll = polls; tick(); await until(() => polls > beforePoll);
    send({ id: 'list', method: 'tools/list' }); send({ id: 'blocked', method: 'tools/call', params: { name: 'h2a_identity_status', arguments: {} } });
    await until(() => frames.some(m => m.id === 'list') && frames.some(m => m.id === 'blocked'));
    assert.deepEqual(frames.find(m => m.id === 'list').result.tools, tools);
    assert.equal(frames.find(m => m.id === 'blocked').error.data.code, 'tool_unavailable_on_generation');
    assert.equal(frames.some(m => m.method === 'notifications/tools/list_changed'), false);
    const advertisement = { attachmentId: attachment.id, shimVersion: '0.98.7', shimBuildId: 'npm-unmanaged', shimProcessIdentity: attachment.shimProcessIdentity,
      attachmentProtocol: 1, handoverProtocol: 1, downstreamProtocolVersion: '2025-06-18', servedDescriptorDigest: served.descriptorDigest,
      servedContractDigest: served.contractDigest, supportedCheckpointVersions: [1], capabilities: { listChanged: true, attachTransfer: true,
        admissionProof: true, transportResume: true }, clientQualification: { profileId: inventory.sourceView.profileId }, sourceView: inventory.sourceView };
    for (const field of ['servedDescriptorDigest', 'servedContractDigest']) {
      const changed = { ...advertisement, [field]: marker[field === 'servedDescriptorDigest' ? 'descriptorDigest' : 'contractDigest'] };
      changed.sourceView = { ...inventory.sourceView, [field === 'servedDescriptorDigest' ? 'descriptorDigest' : 'contractDigest']: changed[field] };
      assert.equal((await request(path + '/register', changed)).status, 200, 'each advertised digest may differ independently from the central');
    }
    for (const bad of [
      { ...advertisement, servedContractDigest: 'invalid' },
      { ...advertisement, sourceView: { ...inventory.sourceView, descriptorDigest: marker.descriptorDigest } },
      { ...advertisement, sourceView: { ...inventory.sourceView, profileId: 'foreign-profile' } },
      { ...advertisement, sourceView: { ...inventory.sourceView, generation: 'invalid-generation' } },
      { ...advertisement, shimProcessIdentity: { ...attachment.shimProcessIdentity, startTime: attachment.shimProcessIdentity.startTime + 1 } }
    ]) assert.equal((await request(path + '/register', bad)).status, 409);
    assert.equal((await request(path + '/register', advertisement, 2)).status, 409, 'transport fencing still binds the advertisement');
    assert.equal((await request(path + '/ack', {})).status, 409, 'inventory grants no compatibility acknowledgement');
    const { sourceView, ...legacy } = advertisement;
    assert.equal((await request(path + '/register', legacy)).status, 409, 'a divergent legacy inventory needs explicit provenance');
    const equalLegacy = { ...legacy, servedDescriptorDigest: marker.descriptorDigest, servedContractDigest: marker.contractDigest };
    assert.equal((await request(path + '/register', equalLegacy)).status, 200, 'equal-catalogue legacy clients stay supported');
    const registration = await (await request(path + '/offer')).json();
    assert.equal((await (await request(path + '/register', equalLegacy)).json()).inventoryRevision, registration.inventoryRevision, 'same inventory is idempotent');
  } finally {
    abort.abort(); input.end(); await running; reader?.close(); output.end();
    H2A_CLI_MCP_TOOL_DESCRIPTORS[index] = original; await central?.stop();
    t.mock.restoreAll(); syncBuiltinESMExports(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('authority should reject group or world writable physical prefixes including umask 0002 worktrees', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-argon-prefix-')), mask = process.umask(0o002);
  try {
    const physicalPrefix = join(dir, 'worktree'), directory = join(dir, 'runtime'), root = join(dir, 'store');
    fs.mkdirSync(physicalPrefix, { mode: 0o777 }); process.umask(mask);
    assert.equal(fs.statSync(physicalPrefix).mode & 0o777, 0o775, 'reproduce a Git worktree created under umask 0002');
    await assert.rejects(prepareAuthority({ directory, root, physicalPrefix }), /prefix_owner_mismatch/);
    assert.deepEqual(fs.readdirSync(directory), [], 'unsafe prefix cannot acquire an authority anchor or keys');
    fs.chmodSync(physicalPrefix, 0o777);
    await assert.rejects(prepareAuthority({ directory, root, physicalPrefix }), /prefix_owner_mismatch/);
    fs.chmodSync(physicalPrefix, 0o755);
    assert.ok((await prepareAuthority({ directory, root, physicalPrefix })).rootKey);
    assert.equal(fs.statSync(physicalPrefix).mode & 0o777, 0o755, 'admission does not rewrite prefix permissions');
  } finally { process.umask(mask); fs.rmSync(dir, { recursive: true, force: true }); }
});
