import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';
import { captureCentralAttachment } from '../dist/runtime/mcp-central-context.js';
import { authenticatedHttpRequest } from '../src/runtime/handover/authenticated-http.js';
import { readState } from '../src/runtime/handover/state.js';
import { descriptor } from './helpers/mh-l3-network.js';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { bridgeCentralMcpStdio } from '../dist/runtime/mcp-central-client.js';

test('real central should keep one activation past its lease and resume with fencing and idempotent attempts', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-central-')); let central;
  try {
    const root = join(dir, 'store'), runtimeBase = join(dir, 'run'); fs.mkdirSync(runtimeBase, { mode: 0o700 });
    central = await startCentralMcpServer({ root, runtimeBase, physicalPrefix: dir, sessionLeaseMs: 30, idleTimeoutMs: 60000 });
    const m = readState(central.markerPath, 'marker').value;
    const attachment = captureCentralAttachment(root, dir, { host: 'claude' }, { CLAUDE_CODE_SESSION_ID: 'resume-fixture' });
    let session, epoch = 1;
    const request = (path, method = 'GET', body) => authenticatedHttpRequest(central.markerPath, m, new URL(path, m.endpoint), {
      attachmentId: attachment.id, transportEpoch: epoch, method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'x-h2a-attachment': Buffer.from(JSON.stringify(attachment)).toString('base64url'), 'x-h2a-attachment-id': attachment.id,
        'x-h2a-transport-epoch': String(epoch), ...(session ? { 'mcp-session-id': session } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const initialized = await request('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } });
    assert.equal(initialized.status, 200); session = initialized.headers.get('mcp-session-id');
    await request('/mcp', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' });
    const catalogue = await (await request('/_h2a-central/catalogue')).json();
    assert.equal(catalogue.contractDigest, descriptor.contractDigest);
    assert.equal(m.contractDigest, descriptor.contractDigest);
    await new Promise(r => setTimeout(r, 120));
    const status = await (await request('/_h2a-central/status')).json(); assert.equal(status.attachments, 1);
    const body = { schemaVersion: 1, attachmentId: attachment.id, expectedGeneration: m.generation, expectedTransportEpoch: 1,
      resumeAttemptId: 'same-attempt', expectedInstance: 'identity_disabled', lastAcceptedNotificationSequence: 0 };
    const resumed = await request('/_h2a-central/resume', 'POST', body);
    assert.equal(resumed.status, 200, await resumed.text()); const result = await resumed.json(); assert.equal(result.transportEpoch, 2);
    assert.equal((await request('/mcp', 'POST', { jsonrpc: '2.0', id: 'stale', method: 'ping' })).status, 409);
    assert.equal((await request('/mcp', 'DELETE')).status, 409, 'an old transport cannot disconnect its resumed activation');
    assert.deepEqual(await (await request('/_h2a-central/resume', 'POST', body)).json(), result);
    assert.equal((await request('/_h2a-central/resume', 'POST', { ...body, expectedInstance: 'changed' })).status, 409);
    epoch = 2;
    assert.equal((await request('/mcp', 'POST', { jsonrpc: '2.0', id: 'new', method: 'ping' })).status, 200);
    assert.equal((await (await request('/_h2a-central/status')).json()).attachments, 1);
  } finally { await central?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real central should resume an initialize reply lost after admission without creating another activation', async t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-init-ack-')); let source, running, reader;
  const abort = new AbortController(), input = new PassThrough(), output = new PassThrough();
  let dropped = false; const original = http.createServer;
  t.mock.method(http, 'createServer', handler => original((req, res) => {
    const end = res.end.bind(res);
    res.end = function(bytes, ...rest) {
      if (!dropped && req.method === 'POST' && req.url === '/mcp' && bytes) {
        try { if (JSON.parse(bytes.toString()).payload?.body?.result?.protocolVersion) { dropped = true; res.destroy(); return res; } } catch { /* not an initialize response */ }
      }
      return end(bytes, ...rest);
    };
    handler(req, res);
  })); syncBuiltinESMExports();
  try {
    const root = join(dir, 'store'), runtimeBase = join(dir, 'run'); fs.mkdirSync(runtimeBase, { mode: 0o700 });
    source = await startCentralMcpServer({ root, runtimeBase, physicalPrefix: dir });
    const attachment = captureCentralAttachment(root, dir, { host: 'claude' }, { CLAUDE_CODE_SESSION_ID: 'lost-initialize' });
    const frames = []; reader = createInterface({ input: output }); reader.on('line', line => frames.push(JSON.parse(line)));
    running = bridgeCentralMcpStdio({ endpoint: source.endpoint, runtimeBase, stdin: input, stdout: output, signal: abort.signal, attachment });
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 'ping', method: 'ping' }) + '\n');
    for (let i = 0; !frames.some(f => f.id === 'ping') && i < 200; i++) await new Promise(r => setTimeout(r, 5));
    assert.ok(frames.find(f => f.id === 'ping')?.result, JSON.stringify(frames));
    assert.equal(dropped, true, 'the actual signed initialize result must have been lost');
    const m = readState(source.markerPath, 'marker').value;
    const status = await (await authenticatedHttpRequest(source.markerPath, m, new URL('/_h2a-central/status', source.endpoint))).json();
    assert.equal(status.attachments, 1); assert.equal(status.transports[0].transportEpoch, 2);
    assert.equal(fs.readdirSync(m.stateDirectory).filter(n => n.startsWith('ownership-')).length, 1);
  } finally {
    abort.abort(); input.end(); await running; reader?.close(); output.end();
    t.mock.restoreAll(); syncBuiltinESMExports(); await source?.stop(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('signed SSE should authenticate readiness promptly and release only its notification stream on disconnect', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-sse-close-')); let source;
  const firstAbort = new AbortController(), secondAbort = new AbortController(); let firstStream, secondStream;
  try {
    const root = join(dir, 'store'), runtimeBase = join(dir, 'run'); fs.mkdirSync(runtimeBase, { mode: 0o700 });
    source = await startCentralMcpServer({ root, runtimeBase, physicalPrefix: dir });
    const m = readState(source.markerPath, 'marker').value;
    const initialized = await authenticatedHttpRequest(source.markerPath, m, m.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }) });
    const session = initialized.headers.get('mcp-session-id'); assert.ok(session);
    const open = async signal => {
      try { return await authenticatedHttpRequest(source.markerPath, m, m.endpoint, {
        headers: { accept: 'text/event-stream', 'mcp-session-id': session }, signal: AbortSignal.any([signal, AbortSignal.timeout(500)]) }); }
      catch (e) { assert.fail('signed SSE readiness failed: ' + e.message); }
    };
    const consume = response => (async () => { for await (const _ of response.body) {} })().catch(() => {});
    const first = await open(firstAbort.signal); assert.equal(first.status, 200); firstStream = consume(first);
    firstAbort.abort(); await firstStream;
    const second = await open(secondAbort.signal); assert.equal(second.status, 200); secondStream = consume(second);
    const status = await (await authenticatedHttpRequest(source.markerPath, m, new URL('/_h2a-central/status', source.endpoint))).json();
    assert.equal(status.attachments, 1); assert.equal(status.transports[0].transportEpoch, 1);
  } finally {
    firstAbort.abort(); secondAbort.abort(); await firstStream; await secondStream;
    await source?.stop(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resume should discover an unknown expected identity without weakening the instance guard or creating another binding', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-identity-ack-')); let source, running, reader;
  const abort = new AbortController(), input = new PassThrough(), output = new PassThrough();
  try {
    const root = join(dir, 'store'), runtimeBase = join(dir, 'run'); fs.mkdirSync(runtimeBase, { mode: 0o700 });
    source = await startCentralMcpServer({ root, runtimeBase, physicalPrefix: dir });
    const m = readState(source.markerPath, 'marker').value;
    const attachment = captureCentralAttachment(root, dir, { host: 'claude', 'auto-open': 'true' }, { CLAUDE_CODE_SESSION_ID: 'unknown-expected-instance' });
    const headers = { 'content-type': 'application/json', 'x-h2a-attachment': Buffer.from(JSON.stringify(attachment)).toString('base64url') };
    const post = (body, session) => authenticatedHttpRequest(source.markerPath, m, m.endpoint, { attachmentId: attachment.id,
      method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body) });
    const initial = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } });
    const session = initial.headers.get('mcp-session-id'); assert.ok(session);
    let identity;
    for (let i=0;i<100;i++) {
      const response = await post({ jsonrpc: '2.0', id: i+2, method: 'tools/call', params: { name: 'h2a_identity_status', arguments: {} } }, session);
      const frame = await response.json(); const status = frame.result && JSON.parse(frame.result.content[0].text);
      if (status?.state === 'identity_ready') { identity=status.instance; break; }
      await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(identity); assert.equal(attachment.expectedInstance, undefined);
    const foreign = await authenticatedHttpRequest(source.markerPath, m, new URL(`/_h2a-central/shim/${attachment.id}/status`, source.endpoint), {
      attachmentId: attachment.id, headers: { 'x-h2a-attachment': Buffer.from(JSON.stringify({ ...attachment, workspace: '/foreign' })).toString('base64url') } });
    assert.equal(foreign.status,409);
    const frames=[];reader=createInterface({input:output});reader.on('line',line=>frames.push(JSON.parse(line)));
    // The first HTTP initialization was admitted but its session/identity were
    // never accepted by this consumer. Recover its existing activation.
    running=bridgeCentralMcpStdio({endpoint:source.endpoint,runtimeBase,stdin:input,stdout:output,signal:abort.signal,attachment});
    input.write(JSON.stringify({jsonrpc:'2.0',id:'init',method:'initialize',params:{protocolVersion:'2025-06-18'}})+'\n');
    input.write(JSON.stringify({jsonrpc:'2.0',id:'identity',method:'tools/call',params:{name:'h2a_identity_status',arguments:{}}})+'\n');
    for(let i=0;!frames.some(f=>f.id==='identity')&&i<200;i++)await new Promise(r=>setTimeout(r,5));
    const frame=frames.find(f=>f.id==='identity');assert.ok(frame?.result,JSON.stringify(frames));
    assert.equal(JSON.parse(frame.result.content[0].text).instance,identity);
    assert.equal(attachment.expectedInstance,identity);
    assert.equal(fs.readFileSync(join(root,'identity/bindings.jsonl'),'utf8').trim().split('\n').length,1);
    assert.equal((await (await authenticatedHttpRequest(source.markerPath,m,new URL('/_h2a-central/status',source.endpoint))).json()).attachments,1);
  } finally {abort.abort();input.end();await running;reader?.close();output.end();await source?.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
