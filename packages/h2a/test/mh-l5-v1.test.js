import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';
import { readState } from '../src/runtime/handover/state.js';
import { readAuthenticationKey } from '../src/runtime/handover/authenticated-http.js';
import { spawnShim, qualifiedShim } from './helpers/mh-l1-shim.js';
import { artifact, legacy, unusedEndpoint, initialize } from './helpers/mh-l5-v1.js';
const test = (name, fn) => { if (!process.env.MH_L5_CASE || name === process.env.MH_L5_CASE) nodeTest(name, fn); };
const fixture = () => fs.mkdtempSync(join(tmpdir(), 'mh-l5-v1-'));
const markerPath = dir => join(dir, 'h2a-mcp-central/marker.json');
const start = (dir, env = {}) => startCentralMcpServer({ root: join(dir, 'store'), runtimeBase: dir, physicalPrefix: dir, env });

for (const version of ['0.98.5', '0.98.6']) {
  test(`M18 ${version} dead legacy marker without durable provenance must never become an invented death proof`, async () => {
    const dir = fixture(); let owner;
    try {
      owner = legacy(version, 'start', dir, await unusedEndpoint());
      assert.equal((await owner.response('ready')).kind, 'started');
      const path = markerPath(dir), before = fs.readFileSync(path), ino = fs.statSync(path).ino;
      owner.child.kill('SIGKILL'); await owner.closed;
      await assert.rejects(start(dir), /owner_liveness_unknown/);
      assert.deepEqual(fs.readFileSync(path), before); assert.equal(fs.statSync(path).ino, ino);
      assert.equal(fs.existsSync(join(dir, 'store/.h2a-writer-control')), false);
    } finally { await owner?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test(`M18b ${version} starter must preserve fixed and discovered .7 markers and reclaim only the invalid control`, async () => {
    const dir = fixture(); let central, child, originalFailure;
    try {
      for (const fixed of [false, true]) {
        const endpoint = fixed ? await unusedEndpoint() : undefined;
        central = await start(dir, endpoint ? { H2A_MCP_CENTRAL_ENDPOINT: endpoint } : {});
        const path = central.markerPath, before = fs.readFileSync(path), ino = fs.statSync(path).ino;
        const marker = JSON.parse(before);
        const old = await import(artifact(version));
        const config = old.centralMcpClientEndpoint({ H2A_MCP_CENTRAL: '1', H2A_MCP_CENTRAL_ENDPOINT: marker.endpoint }, { runtimeBase: dir });
        assert.ok(config.args.includes(marker.endpoint));
        child = legacy(version, 'start', dir, await unusedEndpoint());
        assert.match((await child.response('ready')).error, /LIVE central MCP/);
        assert.deepEqual(fs.readFileSync(path), before); assert.equal(fs.statSync(path).ino, ino);
        await child.close(); child = undefined; await central.stop(); central = undefined;
      }
      fs.writeFileSync(markerPath(dir), '{invalid', { mode: 0o600 });
      child = legacy(version, 'start', dir, await unusedEndpoint());
      assert.equal((await child.response('ready')).kind, 'started', child.stderr);
      child.send({ stop: true }); await child.closed;
    } catch (error) { originalFailure = error; throw error; }
    finally {
      await child?.close();
      try { await central?.stop(); }
      catch (error) { if (!originalFailure) throw error; console.log('cleanup after negative fixture: ' + error.message); }
      finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  });

  test(`M18c ${version} bridge sends only the decoy to a foreign listener and .7 refuses it`, async () => {
    const dir = fixture(); let central, bridge, foreign;
    try {
      central = await start(dir); const m = readState(central.markerPath, 'marker').value;
      const secret = readAuthenticationKey(central.markerPath, m), captured = [];
      const refused = await fetch(m.endpoint, { method: 'POST', headers: { authorization: `Bearer ${m.token}` }, body: JSON.stringify(initialize) });
      assert.equal(refused.status, 401); await refused.text();
      const body = fs.readFileSync(central.markerPath); await central.stop(); central = undefined;
      foreign = createServer(async (request, response) => {
        let body = ''; for await (const chunk of request) body += chunk;
        captured.push({ headers: request.headers, body }); response.writeHead(401).end();
      }).listen(Number(new URL(m.endpoint).port), '127.0.0.1'); await once(foreign, 'listening');
      fs.writeFileSync(markerPath(dir), body, { mode: 0o600 });
      bridge = legacy(version, 'bridge', dir, m.endpoint); bridge.send(initialize);
      assert.equal((await bridge.closed)[0], 1); assert.match(bridge.stderr, /HTTP 401/);
      assert.equal(captured.length, 1); assert.equal(captured[0].headers.authorization, `Bearer ${m.token}`);
      assert.equal(captured[0].body, JSON.stringify(initialize));
      const bytes = JSON.stringify(captured);
      assert.ok(!bytes.includes(secret.toString('hex'))); assert.ok(!bytes.includes(secret.toString('base64')));
      assert.ok(!Object.keys(captured[0].headers).some(h => h.startsWith('x-h2a-auth')));
    } finally {
      await bridge?.close(); await central?.stop();
      if (foreign) { foreign.closeAllConnections(); await new Promise(resolve => foreign.close(resolve)); }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`M19 T8 T9 ${version} live v1 refuses .7 takeover, routes fresh sessions to stdio and keeps an already chosen shim open`, async () => {
    const dir = fixture(); let owner, client, shim, successor;
    try {
      const endpoint = await unusedEndpoint(); owner = legacy(version, 'start', dir, endpoint);
      assert.equal((await owner.response('ready')).kind, 'started', owner.stderr);
      const path = markerPath(dir), before = fs.readFileSync(path), ino = fs.statSync(path).ino;
      for (let scan = 0; scan < 2; scan++) assert.equal((await fetch(new URL('/_h2a-central/ping', endpoint))).status, 200);
      await assert.rejects(start(dir), /owner_liveness_unknown|owner_alive_incompatible/);
      assert.deepEqual(fs.readFileSync(path), before); assert.equal(fs.statSync(path).ino, ino);
      assert.equal(owner.child.exitCode, null); assert.equal(owner.child.signalCode, null);
      const bin = qualifiedShim(join(dir, 'compiled'));
      const config = join(dir, '.mcp.json'); const configBytes = '{"mcpServers":{"foreign":{"command":"foreign"}}}\n';
      fs.writeFileSync(config, configBytes);
      client = spawnShim(bin, ['mcp-serve', '--host', 'claude', '--runtime-base', dir],
        { ...process.env, H2A_ROOT: join(dir, 'store'), CLAUDE_CODE_SESSION_ID: 'legacy-fresh' }, dir);
      client.send(initialize); assert.ok((await client.response('init')).result);
      client.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } });
      const useful = await client.response(1); assert.ok(useful.result); assert.notEqual(useful.result.isError, true);
      assert.equal(fs.readFileSync(config, 'utf8'), configBytes);
      shim = spawnShim(fileURLToPath(new URL('./helpers/mh-l3-shim.mjs', import.meta.url)),
        [fileURLToPath(new URL('../dist/runtime/mcp-central-shim.js', import.meta.url)), join(dir, 'store'), dir, 'identity-disabled'],
        { ...process.env, H2A_ROOT: join(dir, 'store') }, dir);
      shim.send(initialize); assert.ok((await shim.response('init')).result);
      shim.send({ jsonrpc: '2.0', id: 'remote', method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } });
      assert.match(JSON.stringify(await shim.response('remote')), /legacy_requires_cold_upgrade/);
      shim.send({ jsonrpc: '2.0', id: 'backoff', method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } });
      const backoff = await shim.response('backoff');
      assert.equal(backoff.error.data.code, 'legacy_requires_cold_upgrade');
      assert.equal(backoff.error.message, 'legacy_requires_cold_upgrade');
      assert.equal(shim.child.exitCode, null); assert.equal(shim.child.signalCode, null);
      assert.deepEqual(fs.readFileSync(path), before);
      const shimPid = shim.child.pid;
      owner.send({ stop: true }); await owner.closed;
      successor = await start(dir);
      let recovered;
      for (let i = 0; i < 30; i++) {
        const id = 'after-legacy-' + i;
        shim.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } });
        recovered = await shim.response(id);
        if (recovered.result) break; await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(recovered.result, JSON.stringify(recovered)); assert.notEqual(recovered.result.isError, true);
      assert.equal(shim.child.pid, shimPid); assert.equal(shim.child.exitCode, null);
      assert.equal(fs.readFileSync(config, 'utf8'), configBytes);
    } finally { await shim?.close(); await client?.close(); await owner?.close(); await successor?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test(`M20 T4 ${version} persisted endpoint stays fixed and a POST after its real central stops closes the v1 bridge`, async () => {
    const dir = fixture(); let owner, bridge, replacement;
    try {
      const endpoint = await unusedEndpoint(); owner = legacy(version, 'start', dir, endpoint);
      assert.equal((await owner.response('ready')).kind, 'started', owner.stderr);
      const old = await import(artifact(version));
      const persisted = old.centralMcpClientEndpoint({ H2A_MCP_CENTRAL: '1', H2A_MCP_CENTRAL_ENDPOINT: endpoint }, { runtimeBase: dir });
      assert.deepEqual(persisted.args.slice(0, 3), ['mcp-central-connect', '--endpoint', endpoint]);
      bridge = legacy(version, 'bridge', dir, endpoint); bridge.send(initialize);
      assert.ok((await bridge.response('init')).result);
      bridge.send({ jsonrpc: '2.0', id: 'useful', method: 'tools/call', params: { name: 'h2a_discover_instances', arguments: {} } });
      assert.ok((await bridge.response('useful')).result);
      owner.send({ stop: true }); await owner.closed;
      bridge.send({ jsonrpc: '2.0', id: 'after-stop', method: 'tools/list' });
      assert.equal((await bridge.closed)[0], 1); assert.match(bridge.stderr, /cannot reach/);
      replacement = await start(dir, { H2A_MCP_CENTRAL_ENDPOINT: endpoint });
      const marker = readState(replacement.markerPath, 'marker').value;
      assert.equal(marker.endpoint, endpoint); assert.equal(marker.endpointMode, 'fixed'); assert.equal(marker.handoverCapabilities.endpointPinned, true);
      const configured = old.centralMcpClientEndpoint({ H2A_MCP_CENTRAL: '1', H2A_MCP_CENTRAL_ENDPOINT: endpoint }, { runtimeBase: dir });
      assert.deepEqual(configured, persisted);
      assert.throws(() => old.centralMcpClientEndpoint({ H2A_MCP_CENTRAL: '1', H2A_MCP_CENTRAL_ENDPOINT: 'http://127.0.0.1:1/mcp' }, { runtimeBase: dir }), /does not match/);
    } finally { await bridge?.close(); await owner?.close(); await replacement?.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
