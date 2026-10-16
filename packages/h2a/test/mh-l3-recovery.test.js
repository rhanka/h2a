import nodeTest from 'node:test';
const test = (name, fn) => { if (!process.env.MH_L3_CASE || process.env.MH_L3_CASE === name) nodeTest(name, fn); };
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';
import { authenticatedHttpRequest } from '../src/runtime/handover/authenticated-http.js';
import { readState } from '../src/runtime/handover/state.js';
import { spawnShim } from './helpers/mh-l1-shim.js';

test('32 real shims should retain their PIDs and activations across 20 transport recoveries with G0 alive', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'mh-l3-recovery-')), shims = []; let source;
  try {
    const root = join(dir, 'store'), runtime = join(dir, 'run'); fs.mkdirSync(runtime, { mode: 0o700 });
    source = await startCentralMcpServer({ root, runtimeBase: runtime, physicalPrefix: dir, sessionLeaseMs: 120, idleTimeoutMs: 60000 });
    const m = readState(source.markerPath, 'marker').value;
    const status = async () => (await authenticatedHttpRequest(source.markerPath, m, new URL('/_h2a-central/status', m.endpoint))).json();
    for (let i = 0; i < 32; i++) {
      const shim = spawnShim(fileURLToPath(new URL('./helpers/mh-l3-shim.mjs', import.meta.url)),
        [fileURLToPath(new URL('../dist/runtime/mcp-central-shim.js', import.meta.url)), root, runtime, 'identity-disabled'],
        { ...process.env, H2A_ROOT: root, XDG_RUNTIME_DIR: runtime, CLAUDE_CODE_SESSION_ID: 'recovery-' + i }, dir);
      shims.push(shim);
      shim.send({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
      assert.ok((await shim.response('init')).result);
      shim.send({ jsonrpc: '2.0', id: 'ping', method: 'ping' }); assert.ok((await shim.response('ping')).result);
    }
    const pids = shims.map(s => s.child.pid);
    let value;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      value = await status();
      assert.equal(value.attachments, 32);
      if (value.transports.every(t => t.transportEpoch >= 21)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(value.transports.every(t => t.transportEpoch >= 21), JSON.stringify(value));
    assert.equal(new Set(value.transports.map(t => t.attachmentId)).size, 32);
    assert.deepEqual(shims.map(s => s.child.pid), pids);
    assert.ok(shims.every(s => s.child.exitCode === null));
    const owners = fs.readdirSync(m.stateDirectory).filter(n => n.startsWith('ownership-')).map(n => readState(join(m.stateDirectory, n), 'ownership').value);
    assert.equal(owners.length, 32); assert.ok(owners.every(o => o.ownershipEpoch === 1 && o.state === 'ACTIVE'));
    assert.equal(readState(source.markerPath, 'marker').value.generation, m.generation);
  } finally { await Promise.all(shims.map(s => s.close())); await source?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
