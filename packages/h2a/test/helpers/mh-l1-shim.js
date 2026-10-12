import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const fixtureQualification = { schemaVersion: 1, clients: [{
  name: 'fixture-claude', version: 'fixture-qualified', platform: 'linux', nodeMajors: [22, 24],
  protocolVersions: ['2025-06-18'], initialization: true, recovery: true,
  dynamicCatalog: { protocol: true, usage: true }, usability: true, evidence: 'test-only-not-Claude-qualification'
}] };
export const initialize = { jsonrpc: '2.0', id: 'init', method: 'initialize', params: {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-claude', version: 'fixture-qualified' }
} };

/** Copy the real compiled lightweight graph; only the qualification data is a fixture. */
export function qualifiedShim(directory, manifest = fixtureQualification) {
  const base = new URL('../../dist/', import.meta.url);
  const seen = new Set();
  function copy(url) {
    if (seen.has(url.href)) return; seen.add(url.href);
    let bytes = readFileSync(url, 'utf8');
    if (url.pathname.endsWith('/mcp-central-qualification.js')) {
      assert.ok(bytes.includes('clients: Object.freeze([])'), 'only shipped empty qualification data may be replaced');
      bytes = bytes.replace('clients: Object.freeze([])', `clients: Object.freeze(${JSON.stringify(manifest.clients)})`);
    }
    const target = join(directory, url.href.slice(base.href.length));
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
    for (const match of bytes.matchAll(/^import\s+(?!type\b)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm)) {
      if (match[1].startsWith('.')) copy(new URL(match[1], url));
    }
  }
  copy(new URL('bin.js', base));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  // The fallback executes the real server in the same process, never a mock.
  writeFileSync(join(directory, 'bin-heavy.js'), `import ${JSON.stringify(new URL('bin-heavy.js', base).href)};\n`);
  return join(directory, 'bin.js');
}

export function spawnShim(bin, args, env, cwd) {
  const child = spawn(process.execPath, [bin, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = []; let stderr = ''; const waiting = new Map();
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => {
    const frame = JSON.parse(line); frames.push(frame);
    waiting.get(frame.id)?.resolve(frame);
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    for (const pending of waiting.values()) pending.reject(new Error(`shim closed ${code}/${signal}: ${stderr}`));
    resolve({ code, signal });
  }));
  const response = id => {
    const received = frames.find(frame => frame.id === id);
    if (received) return Promise.resolve(received);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`missing ${id}: ${stderr}`)); }, 5000);
      waiting.set(id, { resolve(frame) { clearTimeout(timer); waiting.delete(id); resolve(frame); },
        reject(error) { clearTimeout(timer); waiting.delete(id); reject(error); } });
    });
  };
  return { child, frames, response, get stderr() { return stderr; },
    send(message) { child.stdin.write(JSON.stringify(message) + '\n'); },
    async close() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; reader.close(); }
  };
}
