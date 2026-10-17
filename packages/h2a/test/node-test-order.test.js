import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function scenario(t, failing = false) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ordered-node-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const order = join(root, 'started.jsonl'), report = join(root, 'evidence.json');
  const files = ['z-package.test.js', 'a-small.test.js'].map(name => join(root, name));
  for (const [index, file] of files.entries()) fs.writeFileSync(file, `
    const {test}=require('node:test'), fs=require('node:fs');
    fs.appendFileSync(${JSON.stringify(order)}, ${JSON.stringify(String(index) + '\n')});
    test('actual case ${index}', () => { ${failing && index === 1 ? "throw Error('intentional child failure')" : ''} });
  `);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [resolve('scripts/run-node-tests.mjs'), '--test', '--test-concurrency=1',
    '--test-reporter=spec', `--test-reporter=${resolve('scripts/node-evidence-reporter.mjs')}`,
    '--test-reporter-destination=stdout', `--test-reporter-destination=${report}`, ...files],
  { env, encoding: 'utf8', timeout: 15_000 });
  return { result, files, started: fs.readFileSync(order, 'utf8'), evidence: JSON.parse(fs.readFileSync(report, 'utf8')) };
}

test('the production Node runner starts explicit files in priority order and records every real case', t => {
  const { result, files, started, evidence } = scenario(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(started, '0\n1\n', 'Node CLI lexical sorting must not postpone the expensive first file');
  assert.equal(evidence.success, true);
  assert.equal(evidence.numPassedTests, 2);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file && row.assertionResults.some(a => a.status === 'passed')));
});

test('the production Node runner reports a failing child and still executes the other explicit file', t => {
  const { result, files, started, evidence } = scenario(t, true);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(started, '0\n1\n');
  assert.equal(evidence.success, false);
  assert.ok(evidence.numFailedTests > 0);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file));
});
