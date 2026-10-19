import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { sourceBuild } from './xcli-lab.mjs';

test('a launched Gemini peer survives the strict registry read needed by native wake', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'h2a-qual-'));
  try {
    const build = sourceBuild(root);
    const registry = await import(pathToFileURL(join(build.path, 'packages/h2a-runtime/dist/registry.js')));
    assert.equal(registry.coerceRegistryTool('gemini'), 'gemini', 'launch must enroll Gemini instead of silently ignoring it');
    assert.equal(registry.coerceRegistryTool('gemini-cli'), 'gemini');
    assert.equal(registry.coerceRegistryTool('unknown-cli'), undefined, 'unknown tools must remain refused');
    const path = join(root, 'registry.json');
    registry.enroll({ id: 'receiver', tool: 'gemini', kind: 'local-native', source: 'run',
      sessionClass: 'human', cwd: join(root, 'workspace'), tmuxSession: 'h2a-receiver' }, path);
    const loaded = registry.loadRegistry(path);
    assert.equal(loaded.state, 'ok', 'native wake must read the registry containing the Gemini receiver');
    assert.equal(loaded.entries[0].tool, 'gemini');
    const value = JSON.parse(fs.readFileSync(path, 'utf8'));
    value.entries[0].tool = 'unknown-cli';
    fs.writeFileSync(path, JSON.stringify(value));
    const rejected = registry.loadRegistry(path);
    assert.ok(rejected.state !== 'ok' || rejected.entries.length === 0, 'a malformed tool must never enter the registry view');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
