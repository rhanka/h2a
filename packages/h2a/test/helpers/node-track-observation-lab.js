import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LANE_TEST_FILES } from '../../../../scripts/run-tests.mjs'

export function observeNodeTrackEntry(source, repoRoot) {
  const root = mkdtempSync(join(tmpdir(), 'node-track-observation-'))
  try {
    for (const dir of ['scripts', 'packages/h2a/test', 'packages/focus-interactive/test', 'packages/track/src', 'packages/agent-stats/tests', 'legacy/packages/h2a-runtime/dist/native-terminal', 'home', 'run']) mkdirSync(join(root, dir), { recursive: true })
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
    writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify(Object.fromEntries([...files, track].map((file) => [file, ['required execution']]))))
    writeFileSync(join(root, 'scripts/test-skip-exceptions.json'), '[]')
    writeFileSync(join(root, 'scripts/test-non-tests-0986.json'), JSON.stringify({ schemaVersion: 1, release: '0.98.6', entries: [] }))
    // Legacy-host provisioning short-circuits on a preset valid dir, so the
    // lab proves the execution boundary without building history here.
    const legacyEntry = 'packages/h2a-runtime/dist/native-terminal/process.js'
    writeFileSync(join(root, 'legacy', legacyEntry), '')
    const markers = join(root, 'observed.json')
    let copy = source
    for (const module of ['test-execution-evidence', 'test-inventory']) copy = copy.replace(`"./${module}.mjs"`, JSON.stringify(pathToFileURL(resolve(repoRoot, `scripts/${module}.mjs`)).href))
    writeFileSync(join(root, 'scripts/run-tests.mjs'), copy)
    // Substitute the child-process boundary, preserving production discovery,
    // entry, commands, loop, evidence validation and exit aggregation.
    writeFileSync(join(root, 'mock-spawn.mjs'), `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = ${JSON.stringify(root)}, files = ${JSON.stringify(files)}, track = ${JSON.stringify(track)}, agentStats = ${JSON.stringify(agentStats)}, laneFiles = ${JSON.stringify(LANE_TEST_FILES)};
const observed=[];
cp.spawnSync=(command,args,options)=>{
  if (typeof args[0] === 'string' && args[0].endsWith('identity-isolated-run.mjs')) {
    if(command!==process.execPath || args.some((arg)=>/name-pattern|skip-pattern|test-only/.test(arg)) || JSON.stringify(args.slice(1))!==JSON.stringify(laneFiles)) throw Error('lane suite omitted or filtered required lane files');
    observed.push('Lane');writeFileSync(${JSON.stringify(markers)},JSON.stringify(observed));
    return {status:0};
  }
  const node=args.includes('--test');
  const suite=options.cwd.endsWith('packages/agent-stats')?'AgentStats':'Track';
  const actual=node ? args.filter((arg)=>arg.endsWith('.test.js')).map((arg)=>resolve(options.cwd,arg)) : args.filter((arg)=>arg.endsWith('.test.ts')).map((arg)=>resolve(options.cwd,arg));
  const required=(node?files:(suite==='AgentStats'?[agentStats]:[track])).map((file)=>resolve(root,file));
  if(command!==process.execPath || args.some((arg)=>/name-pattern|skip-pattern|test-only/.test(arg)) || JSON.stringify(actual.sort())!==JSON.stringify(required.sort())) throw Error('effective command omitted or filtered required tests');
  const path=node ? args.find((arg)=>arg.startsWith('--test-reporter-destination=') && !arg.endsWith('=stdout')).split('=').slice(1).join('=') : args.find((arg)=>arg.startsWith('--outputFile=')).split('=').slice(1).join('=');
  if(!path || (node && !args.some((arg)=>arg.includes('node-evidence-reporter.mjs'))) || (!node && !args.includes('--reporter=json'))) throw Error('no execution reporter');
  writeFileSync(path,JSON.stringify({success:true,numTotalTests:actual.length,numPassedTests:actual.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,testResults:actual.map((name)=>({name,status:'passed',assertionResults:[{fullName:'required execution',status:'passed'}]}))}));
  observed.push(node?'Node':suite);writeFileSync(${JSON.stringify(markers)},JSON.stringify(observed));
  return {status:0};
};syncBuiltinESMExports();
`)
    const env = { ...process.env, HOME: join(root, 'home'), XDG_RUNTIME_DIR: join(root, 'run'), XDG_CONFIG_HOME: join(root, 'home/.config'), XDG_STATE_HOME: join(root, 'home/.local/state'), TMPDIR: root, H2A_TEST_LEGACY_HOST_DIR: join(root, 'legacy') }
    delete env.NODE_TEST_CONTEXT
    delete env.H2A_TEST_REPORT_PATH
    const result = spawnSync(process.execPath, ['--import', join(root, 'mock-spawn.mjs'), join(root, 'scripts/run-tests.mjs')], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    assert.equal(result.status, 0, `Node/Track production entry did not prove execution:\n${result.stdout}${result.stderr}`)
    assert.deepEqual(JSON.parse(readFileSync(markers, 'utf8')), ['Node', 'Track', 'AgentStats', 'Lane'], 'each production suite must actually reach the execution boundary')
  } finally { rmSync(root, { recursive: true, force: true }) }
}
