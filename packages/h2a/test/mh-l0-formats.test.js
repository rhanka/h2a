import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, schemas, classifyMarker } from '../src/runtime/handover/formats.js';
import { marker, evidence } from './helpers/mh-l0-fixtures.js';
import { mkdtempSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishState } from '../src/runtime/handover/state.js';
import { v1Reader } from './helpers/mh-l0-v1-reader.js';

test('M18b/M18c format: v2 retains every v1 field, decoy and separate auth reference', () => {
  const m = marker();
  assert.equal(validate('marker', m), m);
  assert.equal(classifyMarker(m, m.prefixId), 'v2');
  const v1 = Object.fromEntries(['endpoint', 'generation', 'pid', 'startedAt', 'token'].map(k => [k, m[k]]));
  assert.equal(classifyMarker(v1, m.prefixId), 'legacy');
  for (const patch of [{ schemaVersion: 3 }, { token: '' }, { state: 'starting' },
    { pid: 124 }, { rootKey: 'secret' }, { endpoint: 'http://localhost:43210/mcp' },
    { endpoint: 'http://127.0.0.1:43210/mcp?x=1' }, { authKeyReference: '../secret' }]) {
    assert.throws(() => validate('marker', { ...m, ...patch }));
  }
  assert.throws(() => classifyMarker({ ...m, prefixId: `sha256:${'b'.repeat(64)}` }, m.prefixId),
    /foreign_installation_authority/);
});

test('M10b format: future builds are open, schema/provenance fields are closed', () => {
  const e = evidence();
  assert.equal(validate('compatibilityEvidence', e), e);
  for (const patch of [{ schemaVersion: 2 }, { expiresAt: 999 }, { mode: 'live-strategy' },
    { authorization: { ...e.authorization, controllerEpoch: -1 } }, { mac: 'x'.repeat(64) }]) {
    assert.throws(() => validate('compatibilityEvidence', { ...e, ...patch }));
  }
  for (const key of Object.keys(e)) {
    const invalid = { ...e }; delete invalid[key];
    assert.throws(() => validate('compatibilityEvidence', invalid), key);
  }
});

test('formats cover all L0 persistence families and reject unknown versions', () => {
  assert.equal(Object.isFrozen(schemas.marker.properties.schemaVersion), true);
  assert.throws(() => { schemas.marker.properties.schemaVersion.const = 99; });
  for (const name of ['namespace', 'authorityDomain', 'readiness', 'request', 'frame',
    'administration', 'resume', 'inventory', 'ownership', 'checkpoint', 'launchMemo',
    'componentTransaction', 'selection', 'upgradeTransaction', 'delegationTicket', 'manifest']) {
    assert.ok(schemas[name], name);
    assert.throws(() => validate(name, { schemaVersion: 99 }), name);
  }
  assert.throws(() => validate('unknown', {}));
});

test('published v1 reader accepts the actual v2 file and rejects insecure permissions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-v1-reader-'));
  try {
    const read = await v1Reader(dir); const path = join(dir, 'marker.json');
    const m = { ...marker(), uid: process.getuid() }; publishState(path, m, 'marker');
    assert.deepEqual(read(path), Object.fromEntries(['endpoint', 'generation', 'pid', 'startedAt', 'token'].map(k => [k, m[k]])));
    chmodSync(path, 0o644); assert.throws(() => read(path), /mode/);
    const exported = JSON.parse(readFileSync(new URL('../../../docs/plan/mh-l0/schemas.json', import.meta.url), 'utf8'));
    assert.deepEqual(exported.$defs, schemas);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
