import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CLEANSE_BASELINE = 'packages/h2a/test/native-cleanse-baseline.test.js';
export const CONTRACT_PREFIX = 'H2A_CLEANSE_CONTRACT ';

export function readCleanseLedger() {
  const ledger = JSON.parse(readFileSync(new URL('./native-cleanse-contracts.json', import.meta.url), 'utf8'));
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(Object.keys(ledger.contracts).length, 42, 'the frozen L0 ledger must list all 42 contracts');
  for (const [id, entry] of Object.entries(ledger.contracts)) {
    assert.ok(id && ['RED', 'GREEN'].includes(entry.state), 'invalid contract ledger state');
    assert.equal(entry.state === 'RED', !!entry.signature, id + ': RED requires an exact failure signature');
  }
  return ledger.contracts;
}

// Ignore only fixture location, Node installation, the synthetic candidate
// version and the current repository version. Historical payload/configuration
// bytes and other assertion values still count. Normalize the candidate first:
// its version can contain the repository version as a prefix.
function canonical(value, context) {
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'string') {
    for (const [from, to] of [[context.root, '<fixture>'], [process.execPath, '<node>'],
      [context.version, '<candidate-version>'], [context.repoVersion, '<repo-version>']]) {
      if (from) value = value.replaceAll(from, to);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(v => canonical(v, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k], context)]));
  return value;
}

export function observeContract({ id, lot, actual, expected, evidence }, context = {}) {
  try {
    assert.deepEqual(actual, expected, `${id} (${lot})`);
    return { id, state: 'GREEN' };
  } catch (error) {
    assert.equal(error.code, 'ERR_ASSERTION');
    context = { ...context, repoVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version };
    return { id, state: 'RED', signature: canonical({ name: error.name, code: error.code,
      operator: error.operator, actual: error.actual, expected: error.expected,
      message: error.message.split('\n')[0],
      evidenceSha256: createHash('sha256').update(JSON.stringify(canonical(evidence, context))).digest('hex'),
    }, context) };
  }
}

export function contractFailure(result, ledger) {
  const expected = ledger[result.id];
  if (!expected) return `${result.id}: contract missing from committed ledger`;
  try { assert.deepEqual(result, { id: result.id, ...expected }); }
  catch {
    return `${result.id}: ledger ${expected.state} -> observed ${result.state}` +
      (expected.state === result.state ? ' with a different failure signature' : '; update the ledger in the same change');
  }
}

export function verifyCleanseContracts(report, requiredFiles, ledger) {
  if (!requiredFiles.some(file => file.replaceAll('\\', '/').endsWith('/' + CLEANSE_BASELINE))) return [];
  ledger ??= readCleanseLedger();
  const file = report?.testResults?.find(file => file.name.replaceAll('\\', '/').endsWith('/' + CLEANSE_BASELINE));
  const results = file?.cleanseContracts ?? [];
  const failures = [], seen = new Set();
  for (const result of results) {
    if (seen.has(result.id)) failures.push(`${result.id}: duplicate contract result`);
    seen.add(result.id);
    const failure = contractFailure(result, ledger);
    if (failure) failures.push(failure);
  }
  for (const id of Object.keys(ledger)) {
    if (!seen.has(id)) failures.push(`${id}: contract result missing from execution report`);
    const assertion = file?.assertionResults?.find(a => a.fullName === 'L0 contract: ' + id);
    if (assertion?.status !== 'passed') failures.push(`${id}: ledger assertion did not pass`);
  }
  return failures;
}
