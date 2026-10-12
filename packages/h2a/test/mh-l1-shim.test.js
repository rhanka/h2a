import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import test from 'node:test';
import { startCentralMcpServer } from '../dist/runtime/mcp-central.js';
import { centralOperator } from '../dist/runtime/mcp-central-operator.js';
import { initialize, qualifiedShim, spawnShim } from './helpers/mh-l1-shim.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l1-shim-'));
  const env = { PATH: process.env.PATH, HOME: join(dir, 'home'), H2A_ROOT: join(dir, 'store'),
    XDG_RUNTIME_DIR: join(dir, 'run'), XDG_CONFIG_HOME: join(dir, 'config'), XDG_STATE_HOME: join(dir, 'state'),
    XDG_CACHE_HOME: join(dir, 'cache'), REMOTE_CLI_CONFIG_HOME: join(dir, 'home'),
    CLAUDE_CODE_SESSION_ID: 'fixture-conversation' };
  for (const name of ['home', 'run', 'config', 'state', 'cache', 'repo']) mkdirSync(join(dir, name), { mode: 0o700 });
  return { dir, env, repo: join(dir, 'repo'), root: env.H2A_ROOT, runtimeBase: env.XDG_RUNTIME_DIR };
}
async function endpoint() {
  const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
  const value = `http://127.0.0.1:${socket.address().port}/mcp`;
  await new Promise(resolve => socket.close(resolve)); return value;
}

test('C01 should replay unknown initialize and its pipelined tail into the real stdio server without central or project writes', async () => {
  const f = fixture(); let shim;
  try {
    const project = join(f.repo, '.mcp.json'); const bytes = '{ "mcpServers" : {"foreign":{"command":"fixture"}} }\r\n';
    writeFileSync(project, bytes);
    const config = join(f.env.HOME, '.config/sentropic/h2a'); mkdirSync(config, { recursive: true });
    writeFileSync(join(config, 'config.json'), '{broken');
    shim = spawnShim(fileURLToPath(new URL('../dist/bin.js', import.meta.url)), ['mcp-serve', '--host', 'claude'], f.env, f.repo);
    shim.child.stdin.write(JSON.stringify(initialize) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }) + '\n');
    assert.ok((await shim.response('init')).result);
    assert.ok((await shim.response('list')).result.tools.some(tool => tool.name === 'h2a_identity_status'));
    assert.match(shim.stderr, /claude_version_unqualified/);
    assert.equal(existsSync(join(f.runtimeBase, 'h2a-mcp-central')), false);
    assert.equal(readFileSync(project, 'utf8'), bytes);
  } finally { await shim?.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('C01 should route an exact fixture client through the real shim and central with one attachment for a pipelined handshake', async () => {
  const f = fixture(); let shim; let central;
  try {
    central = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: await endpoint() } });
    shim = spawnShim(qualifiedShim(join(f.dir, 'light')), ['mcp-serve', '--host', 'claude', '--runtime-base', f.runtimeBase], f.env, f.repo);
    const pid = shim.child.pid;
    shim.child.stdin.write([initialize, { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'list', method: 'tools/list' }].map(message => JSON.stringify(message) + '\n').join(''));
    assert.ok((await shim.response('init')).result);
    const list = await shim.response('list'); assert.equal(list.error, undefined);
    assert.ok(list.result.tools.some(tool => tool.name === 'h2a_identity_status'));
    assert.equal((await centralOperator('status', { runtimeBase: f.runtimeBase })).attachments, 1);
    assert.equal(shim.child.pid, pid); assert.equal(shim.child.exitCode, null);
    assert.ok(shim.frames.every(frame => frame && frame.jsonrpc === '2.0'));
    assert.doesNotMatch(shim.stderr, /claude_version_unqualified/);
  } finally { await shim?.close(); await central?.stop(); rmSync(f.dir, { recursive: true, force: true }); }
});
