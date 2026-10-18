import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalSeats, scopeBundleHash } from '../src/vuln-fix/seats.mjs';

const seat = { id: 'a', profile: 'codex', model: 'fixture', effort: 'high', admission: { command: 'authority', args: [] } };
test('should refuse a bare quota boolean that lacks exact workspace and scope qualification evidence', async () => {
  const local = new LocalSeats({ execute: async () => ({ code: 0, stdout: '{"available":true,"guardQualified":true,"remainingUnits":10,"reservePercent":50}' }) });
  await assert.rejects(local.available(seat, '/fixture'), /scope/);
});

test('should reserve atomically through the authority before a qualified local task and bind the native plugin', async () => {
  const actions = [];
  const local = new LocalSeats({
    renderScope: async (_profile, workspace) => ({ supported: true, command: `guard --workspace ${workspace}` }),
    execute: async (_command, _args, options) => {
      const request = JSON.parse(options.input); actions.push(request.action);
      return { code: 0, stdout: JSON.stringify({ available: true, guardQualified: true, remainingUnits: 5, reservePercent: 50,
        reserved: true, reservationId: 'fixture-reservation', scope: { workspace: request.workspace, host: 'codex',
          plugin: 'h2a@sentropic', qualifiedAt: new Date().toISOString(), bundleSha256: scopeBundleHash() } }) };
    },
    importRuntime: async () => ({ runVulnerabilitySeatTask: async task => {
      assert.equal(task.nativeScope.workspace, '/fixture'); assert.equal(task.nativeScope.plugin, 'h2a@sentropic');
      assert.match(task.scopeCommand, /guard/); return { code: 0, stdout: '{}' };
    } }),
  });
  assert.equal((await local.available(seat, '/fixture')).available, true);
  const result = await local.run({ seat, workspace: '/fixture', kind: 'author' });
  assert.deepEqual(actions, ['status', 'reserve']);
  assert.equal(result.admission.reservationId, 'fixture-reservation');
});

test('should refuse missing reservations and stale scope receipts before loading any runtime', async () => {
  let imported = false;
  const local = new LocalSeats({ execute: async () => ({ code: 0, stdout: JSON.stringify({ available: true,
    guardQualified: true, remainingUnits: 5, reservePercent: 50, scope: { workspace: '/fixture', host: 'codex',
      plugin: 'h2a@sentropic', bundleSha256: scopeBundleHash(), qualifiedAt: new Date().toISOString() } }) }),
    importRuntime: async () => { imported = true; return {}; } });
  await assert.rejects(local.run({ seat, workspace: '/fixture' }), /reservation/);
  assert.equal(imported, false);
});
