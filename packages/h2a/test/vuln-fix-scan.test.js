import assert from 'node:assert/strict';
import test from 'node:test';
import { npmFindings, osvFindings, publicPackages, scanLocks } from '../src/vuln-fix/scan.mjs';

const vulnerability = { name: 'unsafe', severity: 'high', nodes: ['node_modules/unsafe'],
  via: [{ source: 42, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] };
const audit = { vulnerabilities: { unsafe: vulnerability }, metadata: { vulnerabilities: { high: 1 } } };
const lock = { lockfileVersion: 3, packages: {
  '': { name: 'private-root', version: '1.0.0' },
  'node_modules/unsafe': { version: '1.2.3', resolved: 'https://registry.npmjs.org/unsafe/-/unsafe-1.2.3.tgz' },
  'node_modules/private': { version: '1.0.0', resolved: 'https://private.example/private.tgz' },
  'node_modules/linked': { link: true, resolved: 'packages/linked' },
} };

test('should retain npm HIGH/CRITICAL paths and advisory identities', () => {
  assert.equal(npmFindings(audit, 'apps/a/package-lock.json')[0].severity, 'high');
  assert.deepEqual(npmFindings(audit, 'package-lock.json')[0].aliases, ['GHSA-aaaa-bbbb-cccc']);
  assert.equal(npmFindings({ vulnerabilities: { a: { ...vulnerability, severity: 'low' } } }, 'lock').length, 0);
});

test('should fail closed on malformed npm output and npm error objects', () => {
  for (const bad of [{}, { error: { code: 'ENETWORK' }, vulnerabilities: {} }, { vulnerabilities: [] },
    { vulnerabilities: { unsafe: { severity: 'surprise' } } }]) {
    assert.throws(() => npmFindings(bad, 'lock'));
  }
});

test('should send only public registry resolved identities to OSV', () => {
  assert.deepEqual(publicPackages(lock).map(x => [x.name, x.version]), [['unsafe', '1.2.3']]);
  assert.throws(() => publicPackages({ lockfileVersion: 1, dependencies: {} }), /lockfile/);
});

test('should keep unknown OSV severity for triage and ignore withdrawn advisories', () => {
  const entry = { id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1234'] };
  assert.equal(osvFindings(entry, { name: 'unsafe', version: '1.2.3', paths: ['node_modules/unsafe'] }, 'lock')[0].severity, 'unknown');
  assert.deepEqual(osvFindings({ ...entry, withdrawn: '2026-01-01' }, {}, 'lock'), []);
  assert.equal(osvFindings({ ...entry, database_specific: { severity: 'CRITICAL' } }, {}, 'lock')[0].severity, 'critical');
});

test('should hydrate OSV batch IDs and preserve alias overlap with npm evidence', async () => {
  const calls = [];
  const result = await scanLocks({ root: '/fixture', locks: ['package-lock.json'], readLock: () => lock,
    command: async () => ({ code: 1, stdout: JSON.stringify(audit), stderr: '' }),
    request: async (url, body) => { calls.push([url, body]); return url.endsWith('querybatch')
      ? { results: [{ vulns: [{ id: 'GHSA-aaaa-bbbb-cccc' }] }] }
      : { id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1234'], database_specific: { severity: 'HIGH' } }; } });
  assert.equal(result.complete, true);
  assert.equal(result.findings.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].queries.length, 1);
  assert.ok(result.findings.every(x => x.aliases.includes('GHSA-aaaa-bbbb-cccc')));
});

test('should distinguish valid audit exit 1 from network or schema failure', async () => {
  for (const output of [{ code: 2, stdout: JSON.stringify(audit) }, { code: 1, stdout: '{}' },
    { code: 1, stdout: '{"error":{"code":"ENETWORK"}}' }]) {
    const result = await scanLocks({ root: '/fixture', locks: ['package-lock.json'], readLock: () => lock,
      command: async () => output, osv: false });
    assert.equal(result.complete, false);
    assert.ok(result.errors.length);
  }
});

test('should report OSV failures and empty lock coverage rather than claim clean', async () => {
  const opts = { root: '/fixture', locks: ['package-lock.json'], readLock: () => lock,
    command: async () => ({ code: 0, stdout: '{"vulnerabilities":{}}' }),
    request: async () => { throw new Error('network unavailable'); } };
  assert.equal((await scanLocks(opts)).complete, false);
  assert.equal((await scanLocks({ ...opts, locks: [] })).complete, false);
});
