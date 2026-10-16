#!/usr/bin/env node
// Deterministic model substitute, not a real-CLI qualification. It drives the
// unchanged h2a MCP and accepts ONLY a verified product wake from its real PTY.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROBE, REPLY } from './xcli-lab.mjs';

const profile = process.argv[2];
const prompt = process.argv.at(-1);
const role = process.env.H2A_NATIVE_TARGET_SESSION === 'h2a-receiver' ? 'receiver' : 'sender';
const build = process.env.XCLI_BUILD;
const { createLocalStore, parseSignedDriveInstruction, verifySignedDriveInstruction, createReplayGuard } =
  await import(pathToFileURL(join(build, 'packages/h2a/dist/index.js')));
const store = createLocalStore({ root: process.env.H2A_ROOT });
const { waitForIdentity } = await import(pathToFileURL(join(build, 'packages/h2a/test/helpers/identity-readiness.js')));

function endpoint() {
  // Deliberately use the native configuration locations, independently of
  // descriptor.path. This fixture emulates these layouts, not their full parsers.
  const paths = {
    claude: join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME, '.claude'), '.claude.json'),
    codex: join(process.env.CODEX_HOME, 'config.toml'),
    agy: join(process.env.HOME, '.gemini/config/mcp_config.json'),
    gemini: join(process.env.HOME, '.gemini/settings.json'),
    muse: join(process.env.XDG_CONFIG_HOME, 'muse/settings.json'),
    vibe: join(process.env.VIBE_HOME, 'config.toml'),
  };
  const raw = fs.readFileSync(paths[profile], 'utf8');
  if (!['codex', 'vibe'].includes(profile)) {
    const settings = JSON.parse(raw);
    if (profile === 'muse') assert.equal(settings.schema_version, 1, 'native Muse requires settings schema_version 1');
    return settings.mcpServers.h2a;
  }
  const expected = profile === 'codex' ? '[mcp_servers.h2a]' : '[[mcp_servers]]';
  assert.ok(raw.includes(expected), 'native TOML table required');
  const command = JSON.parse(/^command = (.+)$/m.exec(raw)?.[1]);
  const args = JSON.parse(/^args = (.+)$/m.exec(raw)?.[1]);
  return { command, args };
}

const config = endpoint();
assert.equal(config.command, 'h2a', 'fixture must launch the private witnessed product shim');
const mcp = spawn(config.command, config.args, { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] });
let next = 1;
const requests = new Map();
createInterface({ input: mcp.stdout }).on('line', line => {
  const rpc = JSON.parse(line);
  const pending = requests.get(rpc.id);
  if (!pending) return; // notifications alone never trigger this simulated model
  requests.delete(rpc.id);
  clearTimeout(pending.timer);
  if (rpc.error || rpc.result?.isError) pending.reject(new Error('MCP request rejected'));
  else pending.resolve(rpc.result);
});
function call(method, params) {
  const id = next++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('MCP fixture deadline')); }, 15000);
    requests.set(id, { resolve, reject, timer });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function tool(name, args) {
  const result = await call('tools/call', { name, arguments: args });
  const value = JSON.parse(result.content[0].text);
  assert.ok(!value.error, 'MCP tool must succeed');
  return value;
}
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: `simulated-${profile}`, version: '1' } });
mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
await call('tools/list', {});
const identity = await waitForIdentity(() => tool('h2a_identity_status', {}),
  () => new Promise(r => setTimeout(r, 50)));
assert.equal(identity.state, 'identity_ready');
assert.equal(identity.signingAvailable, true);
const instance = identity.instance;
const guard = createReplayGuard();
process.stdin.setRawMode(true);
process.stdin.resume();
let input = '', processing = Promise.resolve();
process.stdin.on('data', bytes => {
  input += bytes.toString().replace(/\x1b\[20[01]~/g, '');
  let index;
  while ((index = input.search(/[\r\n]/)) !== -1) {
    const line = input.slice(0, index);
    input = input.slice(index + 1);
    if (!line) continue;
    if (process.env.XCLI_DROP_WAKE === '1') continue;
    processing = processing.then(async () => {
      const parsed = parseSignedDriveInstruction(line);
      assert.ok(parsed && parsed.payload.to === instance, 'wake must address this exact identity');
      const verified = verifySignedDriveInstruction(line, {
        resolvePublicKeys: name => store.listInstanceKeys(name), guard, now: Date.now(),
      });
      assert.equal(verified.ok, true, 'simulated model must reject unsigned or replayed wakes');
      assert.ok(parsed.payload.instruction.includes('[h2a-wake reason=inbox '));
      const value = await tool('h2a_inbox', { action: 'read', instance });
      if (role === 'receiver') {
        const message = value.envelopes.find(e => e.body?.text === PROBE && e.target?.instance === instance);
        assert.ok(message, 'wake must expose the actual probe envelope');
        await tool('h2a_send', { to: message.actor.instance, message: REPLY });
      }
    }).catch(() => process.exit(73));
  }
});
if (role === 'sender') {
  const target = /to exactly ([^,\s]+), message exactly/.exec(prompt)?.[1];
  assert.ok(target && target !== instance, 'sender and receiver must have distinct identities');
  await tool('h2a_send', { to: target, message: PROBE });
}
process.stdout.write(`Simulated ${profile} model\r\nReady · ${process.cwd()}\r\n${profile === 'codex' ? '›' : '❯'} \r\n`);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { mcp.kill('SIGTERM'); process.exit(0); });
mcp.once('exit', () => process.exit(74));
