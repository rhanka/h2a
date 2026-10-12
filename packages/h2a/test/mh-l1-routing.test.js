import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { shouldUseCentralMcp } from '../dist/runtime/mcp-central-policy.js';

const initialize = (version = 'fixture-qualified', name = 'fixture-claude') => ({
  jsonrpc: '2.0', id: 'init', method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version }
  }
});
const manifest = { schemaVersion: 1, clients: [{
  name: 'fixture-claude', version: 'fixture-qualified', platform: 'linux', nodeMajors: [22, 24],
  protocolVersions: ['2025-06-18'], initialization: true, recovery: true,
  dynamicCatalog: { protocol: true, usage: true }, usability: true, evidence: 'fixture-only'
}] };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l1-routing-'));
  const env = { HOME: dir, H2A_ROOT: join(dir, 'store'), CLAUDE_CODE_SESSION_ID: 'conversation' };
  mkdirSync(join(dir, 'runtime'), { mode: 0o700 });
  return { dir, env, flags: { host: 'claude', 'runtime-base': join(dir, 'runtime') } };
}

test('C01 should choose stdio for unknown clientInfo before reading even malformed central configuration', () => {
  const f = fixture();
  try {
    assert.equal(shouldUseCentralMcp(f.flags, f.env, true, initialize('unqualified'), manifest), false);
    mkdirSync(join(f.dir, '.config', 'sentropic', 'h2a'), { recursive: true });
    writeFileSync(join(f.dir, '.config', 'sentropic', 'h2a', 'config.json'), '{broken');
    assert.equal(shouldUseCentralMcp(f.flags, f.env, true, initialize('unqualified'), manifest), false);
    assert.equal(shouldUseCentralMcp(f.flags, f.env, true, { method: 'initialize' }, manifest), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('C01 should admit only an exact qualified client and preserve every existing exclusion', () => {
  const f = fixture();
  try {
    assert.equal(shouldUseCentralMcp(f.flags, f.env, true, initialize(), manifest), true);
    for (const [flags, env] of [
      [{ ...f.flags, instance: 'explicit' }, f.env], [{ ...f.flags, backend: 'cluster-mesh' }, f.env],
      [f.flags, { ...f.env, H2A_MCP_CENTRAL: '0' }], [f.flags, { ...f.env, H2A_MCP_READY_NONCE: 'challenge' }],
      [f.flags, { ...f.env, H2A_ROOT: 'relative' }], [{ ...f.flags, root: join(f.dir, 'different') }, f.env],
      [{ ...f.flags, host: 'codex' }, f.env], [f.flags, { ...f.env, CLAUDE_CODE_SESSION_ID: '' }]
    ]) assert.equal(shouldUseCentralMcp(flags, env, true, initialize(), manifest), false);
    for (const changed of [ { recovery: false }, { usability: false }, { initialization: false },
      { dynamicCatalog: { protocol: true, usage: false } } ]) {
      assert.equal(shouldUseCentralMcp(f.flags, f.env, true, initialize(), {
        ...manifest, clients: [{ ...manifest.clients[0], ...changed }]
      }), false);
    }
    mkdirSync(join(f.dir, '.config', 'sentropic', 'h2a'), { recursive: true });
    writeFileSync(join(f.dir, '.config', 'sentropic', 'h2a', 'config.json'), JSON.stringify({ h2a: { central: { enabled: false } } }));
    assert.equal(shouldUseCentralMcp(f.flags, f.env, true, initialize(), manifest), false);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('C01 should retain fragmented initialize and pipelined tail exactly once without emitting a response', async () => {
  const { inspectFirstInitialize } = await import('../dist/runtime/mcp-central-initialize.js');
  const input = new PassThrough();
  const source = '\n' + JSON.stringify(initialize()) + '\r\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n';
  const reading = inspectFirstInitialize(input);
  input.write(source.slice(0, 17)); input.write(source.slice(17));
  assert.deepEqual(await reading, initialize());
  const lines = [];
  const reader = createInterface({ input });
  reader.on('line', line => lines.push(line));
  input.end();
  await new Promise(resolve => reader.once('close', resolve));
  assert.deepEqual(lines, source.split(/\r?\n/).slice(0, -1));
  const empty = new PassThrough(); const closed = inspectFirstInitialize(empty); empty.end();
  assert.equal(await closed, undefined);
});

test('C02 should keep static shim imports free of the CLI, store, SDK and native runtime', () => {
  const seen = new Set();
  function walk(url) {
    if (seen.has(url.href)) return; seen.add(url.href);
    const text = readFileSync(url, 'utf8');
    for (const match of text.matchAll(/^import\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm)) {
      const specifier = match[1];
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('.'), specifier);
      if (specifier.startsWith('.')) {
        assert.doesNotMatch(specifier, /bin-heavy|\/cli\.js|local-files|\/mcp\/|h2a-runtime/);
        walk(new URL(specifier, url));
      }
    }
  }
  walk(new URL('../dist/bin.js', import.meta.url));
  assert.ok(seen.size > 5);
});
