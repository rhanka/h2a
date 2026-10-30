import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { BULK_FILES, bulkInventory, bulkContext, verifyBulkEnvelope, bulkPartition, loadBulkPartition } from '../../../scripts/bulk-ci-evidence.mjs';
import { verifyExecutionReport } from '../../../scripts/test-execution-evidence.mjs';
import { recordCiOwnedProcess } from '../../../scripts/ci-owned-process.mjs';

function assertGraph(workflow) {
  const { jobs } = YAML.parse(workflow);
  assert.ok(jobs['bulk-qualification'], 'the nine bulk suites must have an independently failing producer');
  const producer = jobs['bulk-qualification'];
  assert.equal(producer['runs-on'], 'ubuntu-latest');
  assert.equal(producer['timeout-minutes'], 25);
  assert.equal(producer.strategy['fail-fast'], false);
  assert.deepEqual(producer.strategy.matrix.node, ['22', '24']);
  for (const step of producer.steps) {
    assert.equal(step.if, undefined); assert.equal(step['continue-on-error'], undefined);
  }
  assert.deepEqual(producer.steps.filter(s => s.run).map(s => s.run), ['npm ci', 'npm run build',
    'node --test packages/h2a/test/bulk-ci-evidence.test.js', 'node scripts/ci-bulk-proof.mjs']);
  assert.deepEqual(producer.steps.find(s => s.uses === 'actions/upload-artifact@v4').with,
    {name:'bulk-${{ github.run_id }}-${{ github.run_attempt }}-node${{ matrix.node }}',path:'tmp/bulk-export/proof.json','if-no-files-found':'error','retention-days':7});
  for (const name of ['build-and-test', 'npm-test-trust-root']) {
    assert.deepEqual(jobs[name].needs, ['m17-qualification', 'bulk-qualification']);
    assert.equal(jobs[name].if, '${{ always() }}');
    assert.deepEqual(jobs[name].steps.filter(s => s.name === 'Require both complete bulk qualifications'),
      [{name:'Require both complete bulk qualifications',env:{BULK_RESULT:'${{ needs.bulk-qualification.result }}'},run:'test "$BULK_RESULT" = success'}]);
    assert.deepEqual(jobs[name].steps.filter(s => s.uses === 'actions/download-artifact@v4' && s.with.path === 'tmp/bulk-import'),
      [{uses:'actions/download-artifact@v4',with:{name:'bulk-${{ github.run_id }}-${{ github.run_attempt }}-node' + (name === 'build-and-test' ? '${{ matrix.node }}' : '22'),path:'tmp/bulk-import'}}]);
    assert.ok(jobs[name].steps.some(s => s.env?.H2A_TEST_CI_BULK_REPORT === '${{ github.workspace }}/tmp/bulk-import/proof.json'));
  }
}
test('both consumers require the complete same-run bulk producer and download their exact profile', () => {
  assertGraph(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
});
test('bulk CI negative controls reject skipped-green, optional and foreign-profile proofs', () => {
  const source = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  for (const [before, after] of [
    ['needs: [m17-qualification, bulk-qualification]', 'needs: [m17-qualification]'],
    ['run: test "$BULK_RESULT" = success', 'run: true'],
    ['needs.bulk-qualification.result','needs.bulk-qualification.outputs.optional'],
    ['name: bulk-${{ github.run_id }}-${{ github.run_attempt }}-node22','name: bulk-last-success-node22'],
    ['H2A_TEST_CI_BULK_REPORT:', 'OPTIONAL_BULK_REPORT:'],
    ['run: node --test packages/h2a/test/bulk-ci-evidence.test.js', 'run: true'],
    ['      - name: Require both complete bulk qualifications\n','      - name: Require both complete bulk qualifications\n        if: false\n'],
    ['      - name: Execute every bulk packaging and corpus case\n','      - name: Execute every bulk packaging and corpus case\n        continue-on-error: true\n'],
    ['          path: tmp/bulk-export/proof.json\n          if-no-files-found: error','          path: tmp/bulk-export/proof.json\n          if-no-files-found: warn'],
  ]) { assert.ok(source.includes(before)); assert.throws(() => assertGraph(source.replaceAll(before, after)), before); }
});

const inventory = bulkInventory(process.cwd());
const context = {repository:'rhanka/h2a',workflow:'ci',runId:'123',attempt:'1',sha:'a'.repeat(40),node:process.version,platform:'linux',arch:process.arch,inputs:{'package-lock.json':'b'.repeat(64)}};
function proof() {
  const results = BULK_FILES.map(name => ({name,status:'passed',assertionResults:inventory[name].map(fullName => ({fullName,status:'passed'}))}));
  const count = results.reduce((n,r)=>n+r.assertionResults.length,0);
  return {schema:1,context:structuredClone(context),report:{success:true,numTotalTests:count,numPassedTests:count,numFailedTests:0,numPendingTests:0,numTodoTests:0,testResults:results},
    exit:{code:0,signal:null,survivingOwnedProcesses:0},cleanup:{privateStateRemoved:true,fixturesRemoved:true}};
}
test('bulk evidence admits exactly the nine files and all 76 original case identities', () => {
  assert.equal(proof().report.numTotalTests, 76);
  assert.equal(verifyBulkEnvelope(proof(), context, inventory).numPassedTests, 76);
  assert.deepEqual(loadBulkPartition(BULK_FILES, process.cwd(), {}), {local:BULK_FILES,report:null});
  assert.throws(()=>loadBulkPartition(BULK_FILES,process.cwd(),{H2A_TEST_CI_BULK_REPORT:''}));
  assert.throws(()=>loadBulkPartition(BULK_FILES,process.cwd(),{H2A_TEST_CI_BULK_REPORT:'/absent'}),/GitHub-only/);
});
for (const key of Object.keys(context)) test(`bulk proof rejects stale or foreign ${key}`, () => {
  const value=proof();value.context[key]=key==='inputs'?{}:'foreign';
  assert.throws(()=>verifyBulkEnvelope(value,context,inventory));
});
const corruptions = {
  'unknown envelope field':v=>{v.optional=true;}, 'unknown schema':v=>{v.schema=2;},
  'failed process':v=>{v.exit.code=1;}, 'cancelled process':v=>{v.exit.signal='SIGTERM';},
  'live child':v=>{v.exit.survivingOwnedProcesses=1;}, 'private state':v=>{v.cleanup.privateStateRemoved=false;},
  'remaining fixture':v=>{v.cleanup.fixturesRemoved=false;}, 'failed suite':v=>{v.report.testResults[0].status='failed';},
  'report failure':v=>{v.report.success=false;}, 'unhandled error':v=>{v.report.unhandledErrors=['bad'];},
  'missing file':v=>{v.report.testResults.pop();}, 'foreign file':v=>{v.report.testResults[0].name='foreign.test.js';},
  'absolute path':v=>{v.report.testResults[0].name=resolve(BULK_FILES[0]);},
  'traversal path':v=>{v.report.testResults[0].name='other/../'+BULK_FILES[0];},
  'duplicate file':v=>{v.report.testResults.push(structuredClone(v.report.testResults[0]));},
  'missing dynamic case':v=>{v.report.testResults[2].assertionResults.pop();v.report.numTotalTests--;v.report.numPassedTests--;},
  'foreign case':v=>{v.report.testResults[0].assertionResults[0].fullName='short sample';},
  'duplicate case':v=>{v.report.testResults[0].assertionResults.push(structuredClone(v.report.testResults[0].assertionResults[0]));},
  'false count':v=>{v.report.numPassedTests++;},
  'skip':v=>{v.report.testResults[0].assertionResults[0].status='skipped';v.report.numPassedTests--;v.report.numPendingTests++;},
  'TODO':v=>{v.report.testResults[0].assertionResults[0].status='todo';v.report.numPassedTests--;v.report.numTodoTests++;},
};
for(const [name,mutate]of Object.entries(corruptions))test(`bulk proof rejects ${name}`,()=>{
  const value=proof();mutate(value);assert.throws(()=>verifyBulkEnvelope(value,context,inventory));
});
test('bulk partitions and the unchanged final inventory verifier reject holes and overlap', () => {
  const other='packages/h2a/test/other.test.js',files=[...BULK_FILES,other],root=process.cwd();
  const partition=bulkPartition(files,proof(),context,root,inventory);
  assert.deepEqual(partition.local,[other]);
  assert.throws(()=>bulkPartition([...files,BULK_FILES[0]],proof(),context,root,inventory));
  assert.throws(()=>bulkPartition(files.slice(1),proof(),context,root,inventory));
  const merged=structuredClone(partition.report);
  merged.testResults.push({name:resolve(other),status:'passed',assertionResults:[{fullName:'other',status:'passed'}]});
  merged.numTotalTests++;merged.numPassedTests++;
  const required=files.map(f=>resolve(f));
  assert.deepEqual(verifyExecutionReport(merged,required),[]);
  merged.testResults.pop();merged.numTotalTests--;merged.numPassedTests--;
  assert.ok(verifyExecutionReport(merged,required).some(s=>s.includes('NEVER EXECUTED')));
  merged.testResults.push(structuredClone(merged.testResults[0]));
  assert.ok(verifyExecutionReport(merged,required).some(s=>s.includes('duplicate suite')));
});
test('owned observation requires GitHub context and an owned regular ledger, then records the exact birth', () => {
  const directory=fs.mkdtempSync(join(tmpdir(),'bulk-ci-run-')),ledger=join(directory,'children.jsonl');
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'rhanka/h2a',GITHUB_WORKFLOW:'ci',H2A_TEST_CI_OWNED_LEDGER:ledger};
  try {
    fs.writeFileSync(ledger,'',{mode:0o600});
    assert.throws(()=>recordCiOwnedProcess(process.pid,{...env,GITHUB_ACTIONS:'false'}),/GitHub-only/);
    recordCiOwnedProcess(process.pid,env);
    const row=JSON.parse(fs.readFileSync(ledger,'utf8'));
    assert.equal(row.pid,process.pid);
    const stat=fs.readFileSync('/proc/self/stat','utf8');
    assert.equal(row.birth,stat.slice(stat.lastIndexOf(') ')+2).split(' ')[19]);
    fs.symlinkSync(ledger,join(directory,'alias.jsonl'));
    assert.throws(()=>recordCiOwnedProcess(process.pid,{...env,H2A_TEST_CI_OWNED_LEDGER:join(directory,'alias.jsonl')}));
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('bulk producer runs every case and seals only after successful execution and cleanup', () => {
  // Lightweight controller fixture, not a qualification of the real packages.
  const source=process.cwd(),root=fs.mkdtempSync(join(tmpdir(),'bulk-producer-contract-'));
  const run=(command,args,env=process.env)=>spawnSync(command,args,{cwd:root,env,encoding:'utf8',timeout:30000});
  const git=(...args)=>{const r=run('git',args);assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout.trim();};
  try {
    for(const file of ['scripts/bulk-ci-evidence.mjs','scripts/bulk-test-files.mjs','scripts/bulk-test-inventory.json','scripts/ci-bulk-proof.mjs',
      'scripts/m17-ci-evidence.mjs','scripts/ci-m17-proof.mjs','scripts/run-node-tests.mjs','scripts/node-evidence-reporter.mjs','scripts/cleanse-contract-ledger.mjs','scripts/test-execution-evidence.mjs','scripts/test-inventory.mjs',
      'scripts/ci-owned-process.mjs','packages/h2a/test/helpers/native-isolation.js',
      '.github/workflows/ci.yml','packages/h2a/test/bulk-ci-evidence.test.js',
      ...['image','wire','formats','schemas'].map(n=>`packages/h2a/src/runtime/handover/${n}.js`)]) {
      fs.mkdirSync(join(root,file,'..'),{recursive:true});fs.copyFileSync(join(source,file),join(root,file));
    }
    fs.mkdirSync(join(root,'packages/h2a/test/helpers'),{recursive:true});
    for(const f of ['package-lock.json','packages/h2a/test/mh-l5-concurrency.test.js','packages/h2a/test/helpers/mh-l5-campaign.js','packages/h2a/test/helpers/mh-l5-writer.mjs'])fs.writeFileSync(join(root,f),'{}\n');
    for(const file of BULK_FILES)fs.writeFileSync(join(root,file),`import test from 'node:test';import assert from 'node:assert/strict';import{spawn}from'node:child_process';\n`+inventory[file].map((name,n)=>`test(${JSON.stringify(name)},()=>{${file===BULK_FILES[0]&&n===0?"assert.ok(!process.env.BULK_FIXTURE_FAILURE,'fixture failure');if(process.env.BULK_FIXTURE_SURVIVOR){const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env:process.env});c.unref();}":''}});`).join('\n'));
    fs.writeFileSync(join(root,'scripts/prepare-mh-test-fixtures.mjs'),`import fs from 'node:fs';import{join}from'node:path';const path=join(process.env.TMPDIR,'owned-fixture');fs.mkdirSync(path,{mode:0o700});fs.writeFileSync(join(process.env.H2A_TEST_CI_BULK_OUTPUT,'prepared.json'),JSON.stringify({fixture:path,state:join(process.env.TMPDIR,'..')}));console.log(JSON.stringify({owned:[path],env:{}}));\n`);
    fs.writeFileSync(join(root,'package.json'),'{"type":"module"}\n');
    fs.writeFileSync(join(root,'.gitignore'),'tmp/\nnode_modules/\n');
    fs.symlinkSync(join(source,'node_modules'),join(root,'node_modules'),'dir');
    git('init','--quiet');git('config','user.name','Bulk contract fixture');git('config','user.email','bulk-fixture@example.invalid');git('add','.');
    git('-c','core.hooksPath=/dev/null','commit','--quiet','-m','test: private bulk controller fixture');
    const output=join(root,'tmp/export'),env={...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'rhanka/h2a',GITHUB_WORKFLOW:'ci',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:git('rev-parse','HEAD'),H2A_TEST_CI_BULK_OUTPUT:output};
    delete env.NODE_TEST_CONTEXT;delete env.MH_L6_CASE;
    const partial=run(process.execPath,['scripts/ci-bulk-proof.mjs'],{...env,MH_L6_CASE:'one'});
    assert.notEqual(partial.status,0);assert.equal(fs.existsSync(output),false);
    const result=run(process.execPath,['scripts/ci-bulk-proof.mjs'],env);
    assert.equal(result.status,0,result.stdout+result.stderr);
    const value=JSON.parse(fs.readFileSync(join(output,'proof.json'),'utf8'));
    assert.equal(value.report.numPassedTests,76);assert.equal(value.report.numPendingTests,0);assert.equal(value.report.numTodoTests,0);
    assert.deepEqual(verifyBulkEnvelope(value,bulkContext(root,env),bulkInventory(root)),value.report);
    const cleaned=directory=>{const paths=JSON.parse(fs.readFileSync(join(directory,'prepared.json'),'utf8'));assert.equal(fs.existsSync(paths.fixture),false);assert.equal(fs.existsSync(paths.state),false);};
    cleaned(output);
    const imported=loadBulkPartition([...BULK_FILES,'other.test.js'],root,{...env,H2A_TEST_CI_BULK_REPORT:join(output,'proof.json')});
    assert.deepEqual(imported.local,['other.test.js']);
    assert.throws(()=>loadBulkPartition(BULK_FILES,root,{...env,GITHUB_RUN_ATTEMPT:'2',H2A_TEST_CI_BULK_REPORT:join(output,'proof.json')}));
    fs.symlinkSync(join(output,'proof.json'),join(output,'alias.json'));
    assert.throws(()=>loadBulkPartition(BULK_FILES,root,{...env,H2A_TEST_CI_BULK_REPORT:join(output,'alias.json')}),/regular file/);
    const failedOutput=join(root,'tmp/failed');
    const failed=run(process.execPath,['scripts/ci-bulk-proof.mjs'],{...env,H2A_TEST_CI_BULK_OUTPUT:failedOutput,BULK_FIXTURE_FAILURE:'1'});
    assert.notEqual(failed.status,0);assert.equal(fs.existsSync(join(failedOutput,'proof.json')),false);
    cleaned(failedOutput);
    const liveOutput=join(root,'tmp/live');
    const live=run(process.execPath,['scripts/ci-bulk-proof.mjs'],{...env,H2A_TEST_CI_BULK_OUTPUT:liveOutput,BULK_FIXTURE_SURVIVOR:'1'});
    assert.notEqual(live.status,0);assert.match(live.stderr,/bulk left owned processes alive/);
    assert.equal(fs.existsSync(join(liveOutput,'proof.json')),false);cleaned(liveOutput);
    assert.notEqual(run(process.execPath,['scripts/ci-bulk-proof.mjs'],env).status,0,'stale output refused');
    fs.appendFileSync(join(root,BULK_FILES[0]),'\n// dirty source\n');
    assert.throws(()=>bulkContext(root,env));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
