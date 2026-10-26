import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { m17Context } from './m17-ci-evidence.mjs';
import { BULK_FILES } from './bulk-test-files.mjs';
import { verifyExecutionReport } from './test-execution-evidence.mjs';
import { declaredTests } from './test-inventory.mjs';

export { BULK_FILES };
export function bulkInventory(root) {
  const inventory = JSON.parse(fs.readFileSync(join(root, 'scripts/bulk-test-inventory.json'), 'utf8'));
  assert.deepEqual(Object.keys(inventory).sort(), [...BULK_FILES].sort());
  for (const file of BULK_FILES) {
    const names = inventory[file];
    assert.ok(Array.isArray(names) && names.length > 0 && names.every(n => typeof n === 'string' && n));
    assert.equal(new Set(names).size, names.length);
    for (const { fullName } of declaredTests(fs.readFileSync(join(root, file), 'utf8'), file))
      assert.ok(names.includes(fullName), `bulk declaration missing from inventory: ${file}: ${fullName}`);
  }
  return inventory;
}
export function bulkContext(root, env = process.env) {
  const context = m17Context(root, env);
  const files = [...BULK_FILES, 'scripts/bulk-test-files.mjs', 'scripts/bulk-test-inventory.json',
    'scripts/bulk-ci-evidence.mjs', 'scripts/ci-bulk-proof.mjs', 'scripts/run-node-tests.mjs',
    'scripts/prepare-mh-test-fixtures.mjs', 'scripts/test-inventory.mjs', 'scripts/ci-owned-process.mjs',
    'packages/h2a/test/helpers/native-isolation.js'];
  return { ...context, inputs: { ...context.inputs, ...Object.fromEntries(files.map(file =>
    [file, createHash('sha256').update(fs.readFileSync(join(root, file))).digest('hex')])) } };
}
export function verifyBulkEnvelope(envelope, expected, inventory) {
  assert.deepEqual(Object.keys(envelope).sort(), ['schema', 'context', 'report', 'exit', 'cleanup'].sort());
  assert.equal(envelope.schema, 1);
  assert.deepEqual(envelope.context, expected, 'bulk proof provenance/source inputs differ');
  assert.deepEqual(envelope.exit, { code: 0, signal: null, survivingOwnedProcesses: 0 });
  assert.deepEqual(envelope.cleanup, { privateStateRemoved: true, fixturesRemoved: true });
  assert.deepEqual(Object.keys(inventory).sort(), [...BULK_FILES].sort());
  const report = envelope.report;
  assert.equal(report.success, true);
  assert.deepEqual(report.testResults.map(r => r.name).sort(), [...BULK_FILES].sort(), 'exact relative bulk identities required');
  for (const row of report.testResults) assert.deepEqual(row.assertionResults.map(a => a.fullName).sort(),
    [...inventory[row.name]].sort(), `complete bulk case identities required: ${row.name}`);
  assert.deepEqual(verifyExecutionReport(report, BULK_FILES, { requiredTests: inventory }), []);
  return report;
}
export function bulkPartition(files, envelope, context, root, inventory) {
  const full = files.map(file => resolve(root, file));
  assert.equal(new Set(full).size, full.length, 'duplicate full inventory identity');
  const external = BULK_FILES.map(file => resolve(root, file));
  for (const file of external) assert.equal(full.filter(value => value === file).length, 1, 'bulk identity absent from discovery');
  const report = verifyBulkEnvelope(envelope, context, inventory);
  const local = files.filter(file => !external.includes(resolve(root, file)));
  assert.equal(local.length + report.testResults.length, files.length);
  assert.equal(new Set([...local.map(file => resolve(root, file)), ...external]).size, files.length);
  return { local, report: { ...report, testResults: report.testResults.map(row => ({ ...row, name: resolve(root, row.name) })) } };
}
export function loadBulkPartition(files, root, env = process.env) {
  if (env.H2A_TEST_CI_BULK_REPORT === undefined) return { local: files, report: null };
  assert.ok(env.H2A_TEST_CI_BULK_REPORT, 'explicit empty bulk proof configuration');
  const context = bulkContext(root, env), path = env.H2A_TEST_CI_BULK_REPORT, info = fs.lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'bulk proof must be a regular file');
  return bulkPartition(files, JSON.parse(fs.readFileSync(path, 'utf8')), context, root, bulkInventory(root));
}
