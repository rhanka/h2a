import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LANE_TEST_FILES } from '../../../../scripts/run-tests.mjs'

export function observeNodeTrackEntry(source, repoRoot, { preparedNpmCache = false, parallel = false, boundedWorkers = false, failedSuite } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'node-track-observation-'))
  try {
    for (const dir of ['scripts', 'packages/h2a/test', 'packages/focus-interactive/test', 'packages/track/src', 'packages/agent-stats/tests', 'packages/focus/tests', 'legacy/packages/h2a-runtime/dist/native-terminal', 'home', 'run']) mkdirSync(join(root, dir), { recursive: true })
    const files = ['packages/h2a/test/native-inventory-absence.test.js', 'packages/focus-interactive/test/sentinel.test.js']
    for (let i = 0; i < 149; i++) files.push(`packages/h2a/test/filler-${i}.test.js`)
    for (const file of files) writeFileSync(join(root, file), '')
    const track = 'packages/track/src/required.test.ts'
    writeFileSync(join(root, track), '')
    // AgentStats discovery must find at least one suite file; its report is
    // deliberately outside the verified node+track scope, so it stays out of
    // the fake inventory (inventory keys must all be discovered).
    const agentStats = 'packages/agent-stats/tests/required.test.ts'
    writeFileSync(join(root, agentStats), '')
    // Focus discovery must find at least one suite file; like AgentStats, its
    // report stays outside the verified node+track scope.
    const focus = 'packages/focus/tests/required.spec.ts'
    writeFileSync(join(root, focus), '')
    writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify(Object.fromEntries([...files, track].map((file) => [file, ['required execution']]))))
    writeFileSync(join(root, 'scripts/test-skip-exceptions.json'), '[]')
    writeFileSync(join(root, 'scripts/test-non-tests-0986.json'), JSON.stringify({ schemaVersion: 1, release: '0.98.6', entries: [] }))
    // Legacy-host provisioning short-circuits on a preset valid dir, so the
    // lab proves the execution boundary without building history here.
    const legacyEntry = 'packages/h2a-runtime/dist/native-terminal/process.js'
    writeFileSync(join(root, 'legacy', legacyEntry), '')
    const markers = join(root, 'observed.json')
    let copy = source
    for (const module of ['test-execution-evidence', 'test-inventory', 'historical-test-ref', 'report-test-durations', 'm17-ci-evidence', 'bulk-ci-evidence']) copy = copy.replace(`"./${module}.mjs"`, JSON.stringify(pathToFileURL(resolve(repoRoot, `scripts/${module}.mjs`)).href))
    writeFileSync(join(root, 'scripts/run-tests.mjs'), copy)
    // Substitute the child-process boundary, preserving production discovery,
    // entry, commands, loop, evidence validation and exit aggregation.
    writeFileSync(join(root, 'mock-spawn.mjs'), `
import cp from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = ${JSON.stringify(root)}, files = ${JSON.stringify(files)}, track = ${JSON.stringify(track)}, agentStats = ${JSON.stringify(agentStats)}, focus = ${JSON.stringify(focus)}, laneFiles = ${JSON.stringify(LANE_TEST_FILES)};
const observed=[];
cp.spawnSync=(command,args,options)=>{
  if (args.join(' ') === 'config get cache') return {status:0, stdout:resolve(root,'prepared-cache')+'\\n'};
  ${preparedNpmCache ? `if(options.env.npm_config_cache!==resolve(root,'prepared-cache')) throw Error('Prepared npm cache lost during HOME isolation: '+options.env.npm_config_cache);
  if(!options.env.HOME.startsWith(resolve(root,'tmp/test-runtime'))) throw Error('Test HOME must remain isolated');` : ''}
  if (typeof args[0] === 'string' && args[0].endsWith('prepare-mh-test-fixtures.mjs')) {
    if(command!==process.execPath) throw Error('fixture producer must use the candidate Node');
    observed.push('Fixtures');writeFileSync(${JSON.stringify(markers)},JSON.stringify(observed));
    return {status:0,stdout:JSON.stringify({env:{MH_L5_ARTIFACTS:root+'/published',MH_L6_NATIVE_ASSETS:root+'/native'},owned:[]})};
  }
  if (${parallel} && !args.includes('--test') && !options.asyncSuite) return {status:124};
  if (typeof args[0] === 'string' && args[0].endsWith('identity-isolated-run.mjs')) {
    if(command!==process.execPath || args.some((arg)=>/name-pattern|skip-pattern|test-only/.test(arg)) || JSON.stringify(args.slice(1))!==JSON.stringify(laneFiles)) throw Error('lane suite omitted or filtered required lane files');
    observed.push('Lane');writeFileSync(${JSON.stringify(markers)},JSON.stringify(observed));
    return {status:${failedSuite === 'Lane' ? 1 : 0}};
  }
  const node=args.includes('--test');
  if (${boundedWorkers} && !node && !args.includes('--maxWorkers=1')) throw Error('parallel suites must share the CPU budget');
  if(!options.env.MH_L5_ARTIFACTS || !options.env.MH_L6_NATIVE_ASSETS) throw Error('mandatory MH fixtures were not passed to the suites');
  const suite=options.cwd.endsWith('packages/agent-stats')?'AgentStats':(options.cwd.endsWith('packages/focus')?'Focus':'Track');
  const actual=node ? args.filter((arg)=>arg.endsWith('.test.js')).map((arg)=>resolve(options.cwd,arg)) : args.filter((arg)=>arg.endsWith('.test.ts')||arg.endsWith('.spec.ts')).map((arg)=>resolve(options.cwd,arg));
  const required=(node?files:(suite==='AgentStats'?[agentStats]:(suite==='Focus'?[focus]:[track]))).map((file)=>resolve(root,file));
  if(command!==process.execPath || args.some((arg)=>/name-pattern|skip-pattern|test-only/.test(arg)) || JSON.stringify(actual.sort())!==JSON.stringify(required.sort())) throw Error('effective command omitted or filtered required tests');
  const path=node ? args.find((arg)=>arg.startsWith('--test-reporter-destination=') && !arg.endsWith('=stdout')).split('=').slice(1).join('=') : args.find((arg)=>arg.startsWith('--outputFile=')).split('=').slice(1).join('=');
  if(!path || (node && !args.some((arg)=>arg.includes('node-evidence-reporter.mjs'))) || (!node && !args.includes('--reporter=json'))) throw Error('no execution reporter');
  writeFileSync(path,JSON.stringify({success:true,numTotalTests:actual.length,numPassedTests:actual.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,testResults:actual.map((name)=>({name,status:'passed',assertionResults:[{fullName:'required execution',status:'passed'}]}))}));
  observed.push(node?'Node':suite);writeFileSync(${JSON.stringify(markers)},JSON.stringify(observed));
  return {status:suite===${JSON.stringify(failedSuite ?? '')}?1:0};
};
let launched=0;
cp.spawn=(command,args,options)=>{
  launched++;
  const child=new EventEmitter();child.kill=()=>true;
  process.nextTick(()=>{
    if (${parallel} && launched!==4) throw Error('independent suites were serialized');
    const result=cp.spawnSync(command,args,{...options,asyncSuite:true});
    child.emit('close',result.status,null);
  });
  return child;
};syncBuiltinESMExports();
`)
    const env = { ...process.env, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'run'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_STATE_HOME: join(root, 'home/.local/state'), TMPDIR: root, H2A_TEST_LEGACY_HOST_DIR: join(root, 'legacy') }
    delete env.NODE_TEST_CONTEXT
    delete env.H2A_TEST_REPORT_PATH
    if (preparedNpmCache) { delete env.npm_config_cache; delete env.NPM_CONFIG_CACHE }
    const result = spawnSync(process.execPath, ['--import', join(root, 'mock-spawn.mjs'), join(root, 'scripts/run-tests.mjs')], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    assert.equal(result.status, failedSuite ? 1 : 0, `Node/Track production entry did not prove execution:\n${result.stdout}${result.stderr}`)
    assert.deepEqual(JSON.parse(readFileSync(markers, 'utf8')), ['Fixtures', 'Node', 'Track', 'AgentStats', 'Focus', 'Lane'], 'each production suite must actually reach the execution boundary after its prerequisites')
  } finally { rmSync(root, { recursive: true, force: true }) }
}
