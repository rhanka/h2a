import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
const { assessLegacyExclusion } = await import('../dist/runtime/upgrade/legacy-exclusion.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {};
});
const test = (name, fn) => { if (!process.env.MH_L6_CASE || name === process.env.MH_L6_CASE) nodeTest(name, fn); };
function established(detail = 'observed in fixture') {
  return { established: true, detail };
}
function full() {
  return { workersTerminated: established('no legacy worker pid alive, no late mutation observed'),
    relaunchSourcesClosed: established('supervisor and autostart entries removed under lock'),
    futureStartsRouted: established('future starts resolve to the managed launcher entry'),
    installerReintroductionBarred: established('retained processes cannot exec the legacy installer') };
}

test('B2 should report fenced only when all four closures are established with stated basis', () => {
  assert.equal(typeof assessLegacyExclusion, 'function', 'legacy exclusion verdict producer required');
  const verdict = assessLegacyExclusion(full());
  assert.equal(verdict.fenced, true);
  assert.equal(verdict.reason, 'legacy_exclusion_verified');
  assert.deepEqual(verdict.missing, []);
  assert.equal(Object.isFrozen(verdict), true);
});

test('B2 should report unfenced when legacy workers may still terminate late', () => {
  const verdict = assessLegacyExclusion({ ...full(), workersTerminated: { established: false, detail: 'worker still alive' } });
  assert.equal(verdict.fenced, false);
  assert.equal(verdict.reason, 'legacy_installer_unfenced');
  assert.deepEqual(verdict.missing, ['workersTerminated']);
});

test('B2 should report unfenced when relaunch sources stay open', () => {
  const verdict = assessLegacyExclusion({ ...full(), relaunchSourcesClosed: { established: false, detail: 'autostart entry present' } });
  assert.equal(verdict.fenced, false);
  assert.equal(verdict.reason, 'legacy_installer_unfenced');
  assert.deepEqual(verdict.missing, ['relaunchSourcesClosed']);
});

test('B2 should report unfenced when future starts are not routed', () => {
  const verdict = assessLegacyExclusion({ ...full(), futureStartsRouted: { established: false, detail: 'npm bin still primary' } });
  assert.equal(verdict.fenced, false);
  assert.equal(verdict.reason, 'legacy_installer_unfenced');
  assert.deepEqual(verdict.missing, ['futureStartsRouted']);
});

test('B2 should report unfenced when retained processes may reintroduce the installer', () => {
  const verdict = assessLegacyExclusion({ ...full(), installerReintroductionBarred: { established: false, detail: 'absolute installer path reachable' } });
  assert.equal(verdict.fenced, false);
  assert.equal(verdict.reason, 'legacy_installer_unfenced');
  assert.deepEqual(verdict.missing, ['installerReintroductionBarred']);
});

test('B2 should report unfenced when a closure lacks its stated basis', () => {
  for (const evidence of [{ ...full(), workersTerminated: { established: true, detail: '' } },
    { ...full(), workersTerminated: { established: true } },
    { ...full(), workersTerminated: { established: 'yes', detail: 'observed in fixture' } },
    (() => { const partial = full(); delete partial.relaunchSourcesClosed; return partial; })()]) {
    const verdict = assessLegacyExclusion(evidence);
    assert.equal(verdict.fenced, false);
    assert.equal(verdict.reason, 'legacy_installer_unfenced');
    assert.ok(verdict.missing.length > 0);
  }
});

test('B2 should refuse an invalid exclusion envelope instead of verdicting', () => {
  for (const evidence of [null, undefined, 42, 'fenced', []]) {
    assert.throws(() => assessLegacyExclusion(evidence), /legacy_exclusion_evidence_invalid/);
  }
});

test('B2 should tolerate forward-compatible extra closures once the four are established', () => {
  const verdict = assessLegacyExclusion({ ...full(), admissionSourcesDrained: { established: true, detail: 'future gate' } });
  assert.equal(verdict.fenced, true);
  assert.equal(verdict.reason, 'legacy_exclusion_verified');
});
