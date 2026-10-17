import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prioritizeNodeTestFiles } from '../../../scripts/run-tests.mjs';

test('both real package suites start before the remaining Node files without dropping any file', () => {
  const core = resolve('packages/h2a/test/mh-l6-package.test.js');
  const runtime = resolve('packages/h2a/test/mh-l6-runtime-package.test.js');
  const others = [resolve('packages/h2a/test/abc.test.js'), resolve('packages/h2a/test/mcp-central.test.js')];
  const files = prioritizeNodeTestFiles([others[0], core, others[1], runtime]);
  assert.deepEqual(files.slice(0, 2), [core, runtime]);
  assert.deepEqual(files.slice(2), others);
  assert.equal(files.length, 4);
});

function scenario(t, { failing = false, limitedCpu = false, progress = false } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ordered-node-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const order = join(root, 'started.jsonl'), report = join(root, 'evidence.json');
  const cpuHook = join(root, 'cpu-count.mjs');
  fs.writeFileSync(cpuHook, `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
    os.availableParallelism=()=>2; syncBuiltinESMExports();`);
  const files = ['z-package.test.js', 'a-small.test.js'].map(name => join(root, name));
  for (const [index, file] of files.entries()) fs.writeFileSync(file, `
    const {test}=require('node:test'), fs=require('node:fs');
    fs.appendFileSync(${JSON.stringify(order)}, ${JSON.stringify(String(index) + '\n')});
    test('actual case ${index}', async () => {
      ${limitedCpu ? `const until=Date.now()+2000;while(fs.readFileSync(${JSON.stringify(order)},'utf8').trim().split('\\n').length<2){if(Date.now()>until)throw Error('second file never started alongside the first');await new Promise(r=>setTimeout(r,5));}` : ''}
      ${progress ? 'await new Promise(r=>setTimeout(r,100));' : ''}
      ${failing && index === 1 ? "throw Error('intentional child failure')" : ''}
    });
  `);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (progress) env.H2A_TEST_NODE_PROGRESS_MS = '10';
  const result = spawnSync(process.execPath, [...(limitedCpu ? ['--import', cpuHook] : []), resolve('scripts/run-node-tests.mjs'), '--test', ...(!limitedCpu ? ['--test-concurrency=1'] : []),
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
  const { result, files, started, evidence } = scenario(t, { failing: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(started, '0\n1\n');
  assert.equal(evidence.success, false);
  assert.ok(evidence.numFailedTests > 0);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file));
});

test('two reported CPUs execute two waiting files together instead of reserving one CPU', t => {
  const { result, evidence } = scenario(t, { limitedCpu: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(evidence.numPassedTests, 2);
});

test('the runner reports its own pending file and PID before that file completes', t => {
  const { result, files } = scenario(t, { progress: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rows = result.stderr.split('\n').filter(line => line.startsWith('[node-test-progress] '))
    .map(line => JSON.parse(line.slice('[node-test-progress] '.length)));
  assert.ok(rows.some(row => row.active.some(child => files.includes(child.file) && child.pid > 0 && child.exitCode === null)), result.stderr);
});
