import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditHeritage } from '../../../scripts/mh-l0-heritage-audit.mjs';
import { readFileSync } from 'node:fs';

test('L0 heritage audit: relaunch roots, runtime closure and legacy native probe remain explicit', () => {
  const result = auditHeritage('0b9cf8862be689380c3bcb6e7cb35dc1e10b5cbf');
  for (const name of ['native-terminal/process.ts', 'native-terminal/journal.ts', 'native-terminal/op.ts',
    'native-terminal/supervisor.ts', 'launch-guard.ts', 'pty.ts', 'proc-identity.ts']) {
    assert.ok(result.files.some(f => f.source.endsWith(name)), name);
  }
  assert.ok(result.files.some(f => f.source === 'packages/h2a-runtime/src/index.ts'));
  assert.ok(result.files.some(f => f.source === 'packages/h2a-runtime/src/status-projection.ts'));
  assert.equal(result.legacyNativeProbe, '<stagedPkgDir>/node_modules/node-pty');
  assert.equal(result.finalDistQualification, 'blocked-until-final-0.98.6-dist');
  assert.ok(result.externalDependencies.some(d => d.specifier === 'node-pty'));
  assert.ok(result.files.every(f => /^sha256:[0-9a-f]{64}$/.test(f.sourceDigest)));
  assert.deepEqual(auditHeritage(result.ref), result);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../../docs/plan/mh-l0/heritage-source-manifest.json', import.meta.url), 'utf8')), result);
});
