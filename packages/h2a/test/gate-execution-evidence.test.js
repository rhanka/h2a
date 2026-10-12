import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { verifyExecutionReport, discoverSuites, readInventory, readTrainRequirements } from '../../../scripts/test-execution-evidence.mjs'
import { configContractFailures } from '../../../scripts/test-config-contract.mjs'
import { releaseContractFailures } from '../../../scripts/release-workflow-contract.mjs'
import { declaredTests, declarationFailures, policyFor, readDeclaredNonTests } from '../../../scripts/test-inventory.mjs'
import { runGates, verifyRuntimeExecution, listRuntimeSuiteFiles } from '../../../scripts/run-test-gates.mjs'
import { listNodeTrackSuiteFiles } from '../../../scripts/run-tests.mjs'
import { observeNodeTrackEntry } from './helpers/node-track-observation-lab.js'
import { observeSmoke } from './helpers/smoke-observation-lab.js'
import nodeEvidenceReporter from '../../../scripts/node-evidence-reporter.mjs'

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const runtimeConfig = fs.readFileSync(join(repo, 'packages/h2a-runtime/vitest.config.ts'), 'utf8')
const workflow = YAML.parse(fs.readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
const smoke = fs.readFileSync(join(repo, 'scripts/smoke-artifact.mjs'), 'utf8')
const nodeTrack = fs.readFileSync(join(repo, 'scripts/run-tests.mjs'), 'utf8')
test('Node execution evidence merges relative and absolute events for the same suite', async () => {
  const file = 'packages/h2a/test/gate-execution-evidence.test.js'
  async function* events() {
    yield { type: 'test:dequeue', data: { file, name: 'required', nesting: 0 } }
    yield { type: 'test:pass', data: { file: resolve(file), name: 'required', nesting: 0 } }
  }
  const result = await nodeEvidenceReporter(events()).next()
  const observed = JSON.parse(result.value)
  assert.equal(observed.testResults.length, 1, 'one suite must have one canonical execution identity')
  assert.equal(observed.testResults[0].name, resolve(file))
  assert.equal(observed.numPassedTests, 1)
  assert.deepEqual(verifyExecutionReport(observed, [resolve(file)]), [])
})
const report = (file) => ({ success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
  testResults: [{ name: file, status: 'passed', assertionResults: [{ fullName: 'required', status: 'passed' }] }] })

for (const option of ['dangerouslyIgnoreUnhandledErrors: true', 'onUnhandledError: () => false', 'onUnhandledError: () => {}', 'onUnhandledError: async () => false']) {
  test(`A01: reject asynchronous-error suppression ${option}`, () => {
    assert.ok(configContractFailures(runtimeConfig.replace('environment: "node",', `environment: "node",\n${option},`), 'runtime').length > 0)
  })
}

for (const marker of ['// test.skip("debt")', 'const example = "ctx.skip("', 'describe.skipIf(false)("required", () => {})', 'test.skip("unrelated debt", () => {})']) {
  test(`A02: a source marker grants no skip permission: ${marker}`, () => {
    const lab = fs.mkdtempSync(join(tmpdir(), 'evidence-skip-'))
    try {
      const file = join(lab, 'a.test.ts'); fs.writeFileSync(file, marker)
      const skipped = report(file); skipped.testResults[0].assertionResults[0].status = 'skipped'; skipped.numPassedTests = 0; skipped.numPendingTests = 1
      assert.ok(verifyRuntimeExecution(skipped, [file]).length > 0)
    } finally { fs.rmSync(lab, { recursive: true, force: true }) }
  })
}

for (const source of ['// test("required", () => {})', 'test("renamed", () => {})', 'const title = "required";', 'function removed() {}']) {
  test(`A03: normative test declaration cannot disappear: ${source}`, () => {
    const lab = fs.mkdtempSync(join(tmpdir(), 'evidence-inventory-'))
    try { fs.writeFileSync(join(lab, 'a.test.ts'), source); assert.ok(declarationFailures(lab, { 'a.test.ts': ['required'] }).length > 0) }
    finally { fs.rmSync(lab, { recursive: true, force: true }) }
  })
}

for (const [name, mutate] of [
  ['inert entry', (s) => s.replace('if (invokedDirectly) {\n  main();', 'if (false) {\n  main();')],
  ['filtered Node names', (s) => s.replace('"--test",', '"--test", "--test-name-pattern=ABSENT",')],
  ['omitted native suite', (s) => s.replace('!== RUNNER_TEST_FILE)', '!== RUNNER_TEST_FILE && !file.endsWith("native-inventory-absence.test.js"))')],
  ['omitted Track execution', (s) => s.replace('const vitestStatuses = vitestSuites.map((suite) => {', 'const vitestStatuses = [].map((suite) => {')],
]) test(`A04: production entry rejects ${name}`, () => {
  const mutant = mutate(nodeTrack); assert.notEqual(mutant, nodeTrack, 'mutation must apply')
  assert.throws(() => observeNodeTrackEntry(mutant, repo))
})

const verifyStep = (w, run) => w.jobs.verify.steps.find((step) => step.run === run)
const workflowMutants = {
  A05: [
    (w) => { verifyStep(w, 'npm test').shell = 'bash -c "exit 0 # {0}"' },
    (w) => { w.defaults = { run: { shell: 'bash -c "exit 0 # {0}"' } } },
    (w) => { w.jobs.verify.defaults = { run: { 'working-directory': 'other-tree' } } },
    (w) => { w.jobs.verify.env = { BASH_ENV: '/tmp/ignore.sh' } },
  ],
  A06: [
    (w) => { w.jobs.verify.steps.splice(3, 0, { uses: 'actions/checkout@v4', with: { ref: 'b'.repeat(40) } }) },
    (w) => { w.jobs.verify.steps[0].with.ref = 'v0.98.4' },
    (w) => { w.jobs.verify.steps.splice(4, 0, { run: 'git reset --hard other-sha' }) },
    (w) => { verifyStep(w, 'npm test')['working-directory'] = 'other-checkout' },
  ],
  A07: [
    (w) => { const s=w.jobs.verify.steps, p=s.findIndex((step)=>String(step.run??'').includes('npm pack --workspace')), [pack]=s.splice(p,1); s.splice(s.length-1,0,pack) },
    (w) => { w.jobs.verify.steps.splice(-1,0,{run:'npm pack --workspace @sentropic/h2a-runtime --pack-destination dist-tarballs'}) },
    (w) => { verifyStep(w, 'npm run smoke:artifact -- --tarballs dist-tarballs').run = 'npm run smoke:artifact' },
    (w) => { w.jobs.verify.steps.splice(-1,0,{run:'cp other.tgz dist-tarballs/sentropic-h2a-runtime-0.98.5.tgz'}) },
  ],
  A08: [
    (w) => { w.jobs.publish.steps.splice(3,0,{run:'printf broken >> dist-tarballs/sentropic-h2a-runtime-0.98.5.tgz'}) },
    (w) => { w.jobs.publish.steps.splice(3,0,{run:'npm pack --workspace @sentropic/h2a --pack-destination dist-tarballs'}) },
    (w) => { const s=w.jobs.publish.steps.find((step)=>String(step.run??'').includes('npm publish "dist-tarballs/sentropic-h2a-runtime-')); s.run=s.run.replace('if ! npm publish', 'printf broken >> dist-tarballs/sentropic-h2a-runtime-${v}.tgz\nif ! npm publish') },
    (w) => { w.jobs.publish.steps.splice(3,0,{uses:'actions/download-artifact@v4',with:{name:'other-bytes',path:'dist-tarballs'}}) },
  ],
  A09: [
    (w) => { w.jobs.emergency={needs:'verify',if:'${{ always() }}',steps:[{run:'npm publish --workspace @sentropic/h2a'}]} },
    (w) => { w.jobs.publish.steps.push({run:'npm publish --workspace @sentropic/h2a'}) },
    (w) => { w.jobs.verify.steps.push({run:'npm publish --workspace @sentropic/h2a-runtime'}) },
    (w) => { w.jobs.publish.steps.find((step)=>String(step.run??'').includes('npm publish "dist-tarballs/sentropic-h2a-cli-')).run+='\nnpm publish --workspace @sentropic/h2a-cli\n' },
  ],
  A10: [
    (w) => { w.jobs.publish.steps.find((step)=>step.uses==='actions/download-artifact@v4').with['run-id']='123' },
    (w) => { w.jobs.verify.steps.find((step)=>step.uses==='actions/upload-artifact@v4').with.path='other-tarballs/' },
    (w) => { w.jobs.publish.steps.find((step)=>step.uses==='actions/download-artifact@v4').with.repository='other/repo' },
    (w) => { w.jobs.publish.steps.find((step)=>step.uses==='actions/download-artifact@v4').with.path='another-context' },
  ],
  A12: [
    (w) => { const s=w.jobs.verify.steps,i=s.findIndex((step)=>step.uses==='actions/setup-node@v4'),[setup]=s.splice(i,1);s.push(setup) },
    (w) => { w.jobs.verify.steps.splice(3,0,{run:'echo /node22/bin >> "$GITHUB_PATH"'}) },
    (w) => { w.jobs.verify.env={PATH:'/node22/bin'} },
    (w) => { w.jobs.verify.steps.find((step)=>step.uses==='actions/setup-node@v4').with['node-version']='22' },
  ],
}
export { workflowMutants }
for (const [id, mutations] of Object.entries(workflowMutants)) mutations.forEach((mutate,index) => test(`${id}.${index}: reject changed release execution plan`, () => {
  const mutant=structuredClone(workflow);mutate(mutant)
  assert.ok(releaseContractFailures(mutant).length > 0)
}))

for (const [name, mutate] of [
  ['inert PTY helper', (s) => s.replace('async function provePtyOperation(lab, client, sessionId) {', 'async function provePtyOperation(lab, client, sessionId) { return;')],
  ['missing cold seed', (s) => s.replace("  seedPreviousBootRows(cold, 'smoke-cold-boot')", '')],
  ['missing faulty bytes', (s) => s.replace(/^\s*faulty\.write\(.*$/gm, '')],
  ['missing stderr close', (s) => s.replace('  stderrHost.stderr.destroy()', '')],
]) test(`A11: smoke rejects ${name}`, async () => {
  const mutant=mutate(smoke);assert.notEqual(mutant,smoke)
  await assert.rejects(observeSmoke(mutant,join(repo,'scripts/smoke-artifact.mjs')))
})

for (const errno of ['EACCES', 'ENOENT', 'EIO', 'EPERM']) test(`A13: a subtree read failure (${errno}) invalidates the whole inventory`, () => {
  const lab=fs.mkdtempSync(join(tmpdir(),'evidence-discovery-'))
  const original=fs.default.readdirSync
  try {
    fs.mkdirSync(join(lab,'child'));fs.writeFileSync(join(lab,'root.test.ts'),'');fs.writeFileSync(join(lab,'child/a.test.ts'),'')
    fs.default.readdirSync=(path,...args)=>{if(String(path)===join(lab,'child'))throw Object.assign(new Error(errno),{code:errno});return original(path,...args)}
    syncBuiltinESMExports();assert.deepEqual(discoverSuites(lab),[])
  } finally {fs.default.readdirSync=original;syncBuiltinESMExports();fs.rmSync(lab,{recursive:true,force:true})}
})

for (const [name, mutate] of [
  ['zero counters', (r)=>{r.numTotalTests=0;r.numPassedTests=0}],
  ['duplicate suite hides failure', (r)=>{r.testResults.unshift({...r.testResults[0],status:'failed'})}],
  ['failed suite with passed child', (r)=>{r.testResults[0].status='failed'}],
  ['duplicate assertion identity', (r)=>{r.testResults[0].assertionResults.push({...r.testResults[0].assertionResults[0]});r.numTotalTests++;r.numPassedTests++}],
]) test(`A14: reject report with ${name}`,()=>{
  const r=report('/tmp/required.test.ts');mutate(r);assert.ok(verifyExecutionReport(r,['/tmp/required.test.ts']).length>0)
})

for (const errno of ['EACCES','EPERM','EIO','ENOTEMPTY']) test(`A15: failed report cleanup (${errno}) rejects stale readable evidence`,()=>{
  const lab=fs.mkdtempSync(join(tmpdir(),'evidence-freshness-')),path=join(lab,'report.json'),file=join(lab,'a.test.ts')
  const original=fs.default.rmSync
  try {
    fs.writeFileSync(path,JSON.stringify(report(file)))
    fs.default.rmSync=(target,...args)=>{if(target===path)throw Object.assign(new Error(errno),{code:errno});return original(target,...args)}
    syncBuiltinESMExports()
    assert.equal(runGates([{id:'h2a-runtime',command:process.execPath,args:['-e','process.exit(0)'],reportPath:path,requiredFiles:()=>[file],verifyExecution:verifyRuntimeExecution}],{scope:'',stdio:'ignore',write:()=>{},writeErr:()=>{}}),1)
  } finally {fs.default.rmSync=original;syncBuiltinESMExports();fs.rmSync(lab,{recursive:true,force:true})}
})

test('Node execution reporter produces a consistent report of a real targeted file',()=>{
  const lab=fs.mkdtempSync(join(tmpdir(),'node-reporter-proof-'))
  try {
    const file=join(lab,'fixture.test.mjs'),output=join(lab,'report.json')
    fs.writeFileSync(file,'import {test,describe} from "node:test";describe("parent",()=>{test("one",()=>{});test("two",()=>{})});')
    const env={...process.env,HOME:lab,XDG_RUNTIME_DIR:lab};delete env.NODE_TEST_CONTEXT
    const run=spawnSync(process.execPath,['--test',`--test-reporter=${join(repo,'scripts/node-evidence-reporter.mjs')}`,`--test-reporter-destination=${output}`,file],{env,encoding:'utf8',timeout:30000})
    assert.equal(run.status,0,run.stderr)
    const r=JSON.parse(fs.readFileSync(output,'utf8'))
    assert.deepEqual(verifyExecutionReport(r,[file],{requiredTests:{[file]:['parent one','parent two']}}),[])
  } finally {fs.rmSync(lab,{recursive:true,force:true})}
})

test('inventory parser ignores comments and strings containing test declarations',()=>{
  assert.deepEqual(declaredTests('// test("fake",()=>{});\nconst text=\'test("fake",()=>{})\'; test("real",()=>{});','fixture.ts').map((t)=>t.fullName),['real'])
})

test('A03: the 0.98.5 candidate requires the named spec scenarios independently of files left on disk',()=>{
  const lab=fs.mkdtempSync(join(tmpdir(),'train-inventory-'))
  try {
    fs.mkdirSync(join(lab,'scripts'));fs.mkdirSync(join(lab,'packages/h2a-runtime'),{recursive:true})
    fs.writeFileSync(join(lab,'scripts/test-inventory.json'),'{}')
    fs.copyFileSync(join(repo,'scripts/spec-0985-test-inventory.json'),join(lab,'scripts/spec-0985-test-inventory.json'))
    const manifest=join(lab,'packages/h2a-runtime/package.json')
    fs.writeFileSync(manifest,JSON.stringify({version:'0.98.4'}))
    assert.deepEqual(readTrainRequirements(lab),{files:[],titles:[]})
    fs.writeFileSync(manifest,JSON.stringify({version:'0.98.5'}))
    const required=readTrainRequirements(lab)
    assert.equal(required.titles.length,29)
    assert.ok(Object.hasOwn(readInventory(lab),'packages/h2a-runtime/src/native-terminal/crash-safe-log.test.ts'))
    assert.equal(declarationFailures(lab,{}).length,29)
    const file=join(lab,'a.test.ts')
    assert.equal(verifyExecutionReport(report(file),[file],{requiredTitles:required.titles.map((entry)=>entry.anyOf)}).length,29)
  } finally {fs.rmSync(lab,{recursive:true,force:true})}
})

test('train scenarios must be declared inside the gate assigned to execute them', () => {
  const declarations = Object.fromEntries([
    ['node', listNodeTrackSuiteFiles()], ['runtime', listRuntimeSuiteFiles()],
  ].map(([scope, files]) => [scope, files.flatMap(file =>
    declaredTests(fs.readFileSync(file, 'utf8'), file).map(test => test.fullName))]))
  const misplaced = readTrainRequirements(repo).titles.filter(entry =>
    !entry.anyOf.some(title => declarations[entry.scope]?.some(name =>
      name === title || name.endsWith(' ' + title))))
  assert.deepEqual(misplaced, [], 'every required scenario must be satisfiable by its assigned execution report')
})

test('RC 0.98.6 declared non-tests accept only exact identities and report lifecycle changes', () => {
  const lab = fs.mkdtempSync(join(tmpdir(), 'non-test-policy-'))
  try {
    const file = join(lab, 'fixture.test.mjs')
    const entry = { file, fullName: 'disabled case', status: 'skipped', reason: 'Owner-declared non-test' }
    const policy = { declaredNonTests: [entry] }
    const observed = report(file)
    observed.testResults[0].assertionResults.push({ fullName: entry.fullName, status: entry.status })
    observed.numTotalTests++; observed.numPendingTests++
    assert.deepEqual(verifyExecutionReport(observed, [file], policy), [])
    for (const changedEntry of [{ ...entry, fullName: 'another case' }, { ...entry, file: join(lab, 'other.test.mjs') }]) {
      assert.ok(verifyExecutionReport(observed, [file], { declaredNonTests: [changedEntry] }).some(f => f.includes('not an authorized test result')))
    }
    for (const status of ['passed', 'failed', 'todo']) {
      const changed = structuredClone(observed)
      changed.testResults[0].assertionResults[1].status = status
      changed.numPendingTests--; changed[{ passed: 'numPassedTests', failed: 'numFailedTests', todo: 'numTodoTests' }[status]]++
      assert.ok(verifyExecutionReport(changed, [file], policy).some(f => f.includes('declared non-test changed status')))
    }
    assert.ok(verifyExecutionReport(report(file), [file], policy).some(f => f.includes('declared non-test disappeared')))
    const normative = { ...policy, requiredTests: { [file]: [entry.fullName] } }
    assert.ok(verifyExecutionReport(observed, [file], normative).some(f => f.includes('normative test absent or not passed')))
    assert.ok(verifyExecutionReport(observed, [file], { ...policy, requiredTitles: [entry.fullName] }).some(f => f.includes('normative scenario absent or not passed')))
  } finally { fs.rmSync(lab, { recursive: true, force: true }) }
})

test('RC 0.98.6 production policy is a versioned list of exactly 38 named non-tests', () => {
  const manifest = JSON.parse(fs.readFileSync(join(repo, 'scripts/test-non-tests-0986.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.release, '0.98.6')
  assert.equal(manifest.ownerDecision, "s'ils sont désactivés ce n'est pas un pb ce ne sont pas encore des tests")
  assert.equal(manifest.entries.length, 38)
  assert.equal(manifest.entries.filter(e => e.status === 'skipped').length, 17)
  assert.equal(manifest.entries.filter(e => e.status === 'todo').length, 21)
  assert.equal(new Set(manifest.entries.map(e => e.file + ' :: ' + e.fullName)).size, 38)
  for (const entry of manifest.entries) assert.ok(entry.file && entry.fullName && entry.reason.trim())
  const node = policyFor(repo, readInventory(repo), 'node')
  assert.equal(node.declaredNonTests.length, 38)
  assert.deepEqual(policyFor(repo, readInventory(repo), 'runtime').declaredNonTests, [])
})

test('RC 0.98.6 invalid or duplicate non-test declarations fail closed', () => {
  const lab = fs.mkdtempSync(join(tmpdir(), 'non-test-manifest-'))
  try {
    fs.mkdirSync(join(lab, 'scripts'))
    const path = join(lab, 'scripts/test-non-tests-0986.json')
    const manifest = JSON.parse(fs.readFileSync(join(repo, 'scripts/test-non-tests-0986.json'), 'utf8'))
    for (const mutate of [m => { m.schemaVersion = 2 }, m => { m.release = '0.98.7' }, m => { m.entries[0].reason = '' }, m => { m.entries[0].status = 'passed' }, m => { m.entries.push(m.entries[0]) }]) {
      const changed = structuredClone(manifest); mutate(changed)
      fs.writeFileSync(path, JSON.stringify(changed))
      assert.throws(() => readDeclaredNonTests(lab))
    }
  } finally { fs.rmSync(lab, { recursive: true, force: true }) }
})

test('RC 0.98.6 removing a declared non-test suite invalidates discovery', () => {
  const original = fs.default.readdirSync
  try {
    fs.default.readdirSync = (path, ...args) => {
      const entries = original(path, ...args)
      return String(path) === join(repo, 'packages/h2a/test') ? entries.filter(entry => entry !== 'pty-objective-loop.test.js') : entries
    }
    syncBuiltinESMExports()
    assert.deepEqual(listNodeTrackSuiteFiles(), [])
  } finally { fs.default.readdirSync = original; syncBuiltinESMExports() }
})

test('RC 0.98.6 an unlisted skip mutation fails the gate over real Node execution evidence', () => {
  const lab = fs.mkdtempSync(join(tmpdir(), 'non-test-mutation-'))
  try {
    const file = join(lab, 'fixture.test.mjs'), output = join(lab, 'report.json')
    const policy = { declaredNonTests: [{ file, fullName: 'disabled case', status: 'skipped', reason: 'Owner-declared non-test' }] }
    const original = 'import {test} from "node:test"; test("required",()=>{}); test.skip("disabled case",()=>{}); test("other",()=>{});'
    const run = (source) => {
      fs.writeFileSync(file, source)
      const previous = process.env.NODE_TEST_CONTEXT
      delete process.env.NODE_TEST_CONTEXT
      try {
        return runGates([{ id: 'non-test-mutation', command: process.execPath,
          args: ['--test', `--test-reporter=${join(repo, 'scripts/node-evidence-reporter.mjs')}`, `--test-reporter-destination=${output}`, file],
          reportPath: output, requiredFiles: () => [file], verifyExecution: r => verifyExecutionReport(r, [file], policy),
        }], { scope: '', stdio: 'ignore', write: () => {}, writeErr: () => {} })
      } finally {
        if (previous === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = previous
      }
    }
    assert.equal(run(original), 0, 'the exact declared non-test is accepted')
    const mutant = original.replace('test("other"', 'test.skip("other"')
    assert.notEqual(mutant, original)
    assert.equal(run(mutant), 1, 'exit 0 from Node cannot authorize the unlisted skip')
    const observed = JSON.parse(fs.readFileSync(output, 'utf8'))
    assert.ok(verifyExecutionReport(observed, [file], policy).some(f => f.includes('other') && f.includes('not an authorized test result')))
    assert.equal(run(original), 0, 'restoring the mutation restores the gate')
  } finally { fs.rmSync(lab, { recursive: true, force: true }) }
})
