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

function scenario(t, { failing = false, limitedCpu = false, progress = false, isolated = false, transfer = false, burst = false } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'ordered-node-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const order = join(root, 'started.jsonl'), report = join(root, 'evidence.json');
  const cpuHook = join(root, 'cpu-count.mjs');
  fs.writeFileSync(cpuHook, `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module';
    os.availableParallelism=()=>2; syncBuiltinESMExports();`);
  const names = burst ? ['mh-l5-concurrency.test.js', 'mcp-identity-burst.test.js']
    : transfer ? ['z-package.test.js', 'mh-l3-transfer.test.js', 'mcp-central-attachments.test.js']
    : ['z-package.test.js', isolated ? 'mcp-central-attachments.test.js' : 'a-small.test.js'];
  const files = names.map(name => join(root, name));
  for (const [index, file] of files.entries()) fs.writeFileSync(file, `
    const {test}=require('node:test'), fs=require('node:fs');
    fs.appendFileSync(${JSON.stringify(order)}, ${JSON.stringify(String(index) + '\n')});
    test('actual case ${index}', async () => {
      ${limitedCpu ? `const until=Date.now()+2000;while(fs.readFileSync(${JSON.stringify(order)},'utf8').trim().split('\\n').length<2){if(Date.now()>until)throw Error('second file never started alongside the first');await new Promise(r=>setTimeout(r,5));}` : ''}
      ${progress ? 'await new Promise(r=>setTimeout(r,100));' : ''}
      ${isolated && index === 1 ? `await new Promise(r=>setTimeout(r,100));require('node:assert/strict').equal(fs.readFileSync(${JSON.stringify(order)},'utf8'),'1\\n');` : ''}
      ${transfer && index > 0 ? `await new Promise(r=>setTimeout(r,100));require('node:assert/strict').equal(fs.readFileSync(${JSON.stringify(order)},'utf8'),${JSON.stringify(index === 2 ? '2\n' : '2\n1\n')});` : ''}
      ${failing && index === 1 ? "throw Error('intentional child failure')" : ''}
    });
  `);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (progress) env.H2A_TEST_NODE_PROGRESS_MS = '10';
  const result = spawnSync(process.execPath, [...(limitedCpu ? ['--import', cpuHook] : []), resolve('scripts/run-node-tests.mjs'), '--test', ...(!limitedCpu ? [`--test-concurrency=${isolated || transfer ? 4 : 1}`] : []),
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

test('daemon startup qualification completes alone before the same runner executes every remaining file', t => {
  const { result, files, started, evidence } = scenario(t, { isolated: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(started, '1\n0\n');
  assert.equal(evidence.success, true);
  assert.equal(evidence.numPassedTests, 2);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file && row.assertionResults.some(a => a.status === 'passed')));
});

test('a failed standalone daemon suite remains failed while every remaining file still executes', t => {
  const { result, files, started, evidence } = scenario(t, { isolated: true, failing: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(started, '1\n0\n');
  assert.equal(evidence.success, false);
  assert.equal(evidence.numFailedTests, 1);
  assert.equal(evidence.numPassedTests, 1);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file));
});

test('the 36-process identity startup qualification finishes before the backend campaign starts', t => {
  const { result, files, started, evidence } = scenario(t, { isolated: true, burst: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(started, '1\n0\n');
  assert.equal(evidence.success, true);
  assert.equal(evidence.numPassedTests, 2);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file && row.assertionResults.some(a => a.status === 'passed')));
});

test('bounded daemon and handover qualifications each finish alone before the parallel package phase', t => {
  const { result, files, started, evidence } = scenario(t, { transfer: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(started, '2\n1\n0\n');
  assert.equal(evidence.success, true);
  assert.equal(evidence.numPassedTests, 3);
  for (const file of files) assert.ok(evidence.testResults.some(row => row.name === file && row.assertionResults.some(a => a.status === 'passed')));
});

test('bulk package and backend campaigns wait for bounded protocol qualification and all execute together', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'node-bulk-phase-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = join(root, 'started.jsonl'), finished = join(root, 'protocol-finished'), report = join(root, 'evidence.json');
  const names = ['protocol.test.js', 'mh-l6-package.test.js', 'mh-l6-runtime-package.test.js', 'drive-consent-index.test.js', 'candidate-artifacts.test.js'];
  const files = names.map(name => join(root, name));
  for (const [index, file] of files.entries()) fs.writeFileSync(file, `
    const {test}=require('node:test'),fs=require('node:fs'),assert=require('node:assert/strict');
    fs.appendFileSync(${JSON.stringify(started)},${JSON.stringify(index + '\n')});
    test('actual phase case ${index}',async()=>{
      ${index === 0 ? `await new Promise(r=>setTimeout(r,100));assert.equal(fs.readFileSync(${JSON.stringify(started)},'utf8'),'0\\n');fs.writeFileSync(${JSON.stringify(finished)},'done');`
        : `assert.equal(fs.readFileSync(${JSON.stringify(finished)},'utf8'),'done');const end=Date.now()+2000;while(fs.readFileSync(${JSON.stringify(started)},'utf8').trim().split('\\n').length<5){if(Date.now()>end)throw Error('bulk files did not run together');await new Promise(r=>setTimeout(r,5));}`}
    });`);
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [resolve('scripts/run-node-tests.mjs'),'--test','--test-concurrency=4',
    '--test-reporter=spec',`--test-reporter=${resolve('scripts/node-evidence-reporter.mjs')}`,
    '--test-reporter-destination=stdout',`--test-reporter-destination=${report}`,...files],{env,encoding:'utf8',timeout:15_000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const rows=fs.readFileSync(started,'utf8').trim().split('\n').map(Number);
  assert.equal(rows[0],0);
  assert.deepEqual(rows.slice(1).sort(),[1,2,3,4]);
  const evidence=JSON.parse(fs.readFileSync(report,'utf8'));
  assert.equal(evidence.success,true);
  assert.equal(evidence.numPassedTests,5);
  for(const file of files)assert.ok(evidence.testResults.some(row=>row.name===file&&row.assertionResults.some(a=>a.status==='passed')));
});

function overlappingCampaign(t, failing = false) {
  const root=fs.mkdtempSync(join(tmpdir(),'node-overlap-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const report=join(root,'evidence.json'), marker=name=>join(root,name);
  const names=['mh-l5-concurrency.test.js','protocol.test.js','mh-l6-package.test.js'];
  const files=names.map(name=>join(root,name));
  const wait=`async function wait(path){const end=Date.now()+2000;while(!fs.existsSync(path)){if(Date.now()>end)throw Error('campaign and remaining suites were serialized');await new Promise(r=>setTimeout(r,5));}}`;
  fs.writeFileSync(files[0],`const {test}=require('node:test'),fs=require('node:fs');${wait}
    test('actual backend case',async()=>{fs.writeFileSync(${JSON.stringify(marker('backend'))},'started');
      ${failing ? "throw Error('intentional backend failure');" : `await wait(${JSON.stringify(marker('bulk-finished'))});`}
    });`);
  fs.writeFileSync(files[1],`const {test}=require('node:test'),fs=require('node:fs');${wait}
    test('actual remaining case',async()=>{await wait(${JSON.stringify(marker('backend'))});fs.writeFileSync(${JSON.stringify(marker('protocol-finished'))},'done');});`);
  fs.writeFileSync(files[2],`const {test}=require('node:test'),fs=require('node:fs'),assert=require('node:assert/strict');
    test('actual bulk case',()=>{assert.equal(fs.readFileSync(${JSON.stringify(marker('protocol-finished'))},'utf8'),'done');fs.writeFileSync(${JSON.stringify(marker('bulk-finished'))},'done');});`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,[resolve('scripts/run-node-tests.mjs'),'--test','--test-concurrency=2',
    '--test-reporter=spec',`--test-reporter=${resolve('scripts/node-evidence-reporter.mjs')}`,
    '--test-reporter-destination=stdout',`--test-reporter-destination=${report}`,...files],{env,encoding:'utf8',timeout:15_000});
  return {result,files,evidence:JSON.parse(fs.readFileSync(report,'utf8'))};
}

test('the long backend overlaps remaining suites while bulk packages retain their protocol barrier',t=>{
  const {result,files,evidence}=overlappingCampaign(t);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(evidence.success,true);
  assert.equal(evidence.numPassedTests,3);
  assert.equal(evidence.testResults.length,3);
  for(const file of files)assert.ok(evidence.testResults.some(row=>row.name===file&&row.assertionResults.some(a=>a.status==='passed')));
});

test('a failed overlapping backend remains failed and every remaining suite still executes',t=>{
  const {result,files,evidence}=overlappingCampaign(t,true);
  assert.equal(result.status,1,result.stdout+result.stderr);
  assert.equal(evidence.success,false);
  assert.equal(evidence.numFailedTests,1);
  assert.equal(evidence.numPassedTests,2);
  assert.equal(evidence.testResults.length,3);
  for(const file of files)assert.ok(evidence.testResults.some(row=>row.name===file));
});
