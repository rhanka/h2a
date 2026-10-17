import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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

/** Copy the whole compiled server next to the fixture qualification data, so every
 * spawned process (serve, connect, auto-started daemon) derives the same physical
 * prefix and entrypoint from a single code location. Only the qualification data
 * is a fixture; everything else is byte-identical, never a mock. Bare imports
 * resolve through a node_modules symlink to the workspace root, which never
 * affects prefix or entrypoint derivation. */
export function qualifiedShim(directory, manifest = fixtureQualification) {
  const basePath = fileURLToPath(new URL('../../dist/', import.meta.url));
  const packageRoot = join(basePath, '..');
  // Registry publishers load package-owned assets relative to dist. Preserve
  // that layout and its real metadata in the copied fixture package.
  const registry = join(packageRoot, 'registry');
  const packaged = existsSync(registry);
  const compiled = packaged ? join(directory, 'dist') : directory;
  const modules = join(basePath, '..', '..', '..', 'node_modules');
  assert.ok(existsSync(modules), 'workspace node_modules must be installed for the fixture shim');
  const copyTree = (source) => {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name.endsWith('.map')) continue;
      const from = join(source, entry.name);
      const to = join(compiled, relative(basePath, from));
      if (entry.isDirectory()) { copyTree(from); continue; }
      if (!entry.isFile()) continue;
      mkdirSync(dirname(to), { recursive: true });
      if (from.endsWith('/mcp-central-qualification.js')) {
        const bytes = readFileSync(from, 'utf8');
        assert.ok(bytes.includes('clients: Object.freeze([])'), 'only shipped empty qualification data may be replaced');
        writeFileSync(to, bytes.replace('clients: Object.freeze([])', `clients: Object.freeze(${JSON.stringify(manifest.clients)})`));
      } else copyFileSync(from, to);
    }
  };
  copyTree(basePath);
  if (packaged) {
    cpSync(registry, join(directory, 'registry'), { recursive: true });
    cpSync(join(packageRoot, 'fixtures'), join(directory, 'fixtures'), { recursive: true });
    copyFileSync(join(packageRoot, 'package.json'), join(directory, 'package.json'));
  } else writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  symlinkSync(modules, join(directory, 'node_modules'), 'dir');
  return join(compiled, 'bin.js');
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
