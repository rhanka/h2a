import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawnShim } from './mh-l1-shim.js';

export function artifact(version) {
  const root = process.env.MH_L5_ARTIFACTS;
  assert.ok(root?.startsWith('/tmp/mh-l5-artifacts-'), 'verified temporary published v1 artifacts are mandatory; never skip');
  const receipt = JSON.parse(fs.readFileSync(join(root, 'receipt.json')));
  const profile = receipt.profiles.find(p => p.version === version);
  assert.ok(profile);
  const module = join(root, version, 'node_modules/@sentropic/h2a/dist/runtime/mcp-central.js');
  assert.equal(createHash('sha256').update(fs.readFileSync(module)).digest('hex'), profile.centralSha256);
  assert.equal(JSON.parse(fs.readFileSync(join(module, '../../..', 'package.json'))).version, version);
  return pathToFileURL(module).href;
}
export async function unusedEndpoint() {
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  await new Promise(resolve => server.close(resolve)); return endpoint;
}
export function legacy(version, mode, dir, endpoint) {
  const worker = fileURLToPath(new URL('./mh-l5-v1-worker.mjs', import.meta.url));
  const process = spawnShim(worker, [artifact(version), mode, dir, join(dir, 'store'), endpoint], globalThis.process.env, dir);
  process.closed = once(process.child, 'close');
  return process;
}
export const initialize = { jsonrpc: '2.0', id: 'init', method: 'initialize', params: {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-claude', version: 'fixture-qualified' } } };
