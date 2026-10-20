/**
 * Tests for scripts/run-test-gates.mjs — the runner behind `npm test`.
 *
 * WHY THIS FILE EXISTS. This runner decides whether every future green in this
 * repository is trustworthy, and it was for a while the only ungated thing in the
 * chain. A mutation review found two ONE-LINE edits that produced a confident,
 * undetected false green:
 *
 *   M1  the verdict line, so a failed step reports `passed`  -> npm test exit 0
 *   M4  the exit rule, so a skipped step still exits 0       -> npm test exit 0
 *
 * Both SURVIVED when this file ran inside the runner it verifies: an M1 mutation
 * made the outer runner call its failed inner test a pass. CI now invokes this
 * file directly, outside that runner; run-tests.mjs deliberately excludes it from
 * `npm test` discovery. The tests below make both mutations fail loudly there.
 *
 * The runner is driven through `runGates()` with SYNTHETIC steps: real `node -e`
 * subprocesses with chosen exit codes. That exercises the true code path — spawn,
 * classification, verdict, aggregation, exit code — without invoking the real gates.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { discoverTestFiles, RUNNER_TEST_FILE, listNodeTrackSuiteFiles, verifyNodeTrackExecution } from '../../../scripts/run-tests.mjs'

import { configContractFailures } from '../../../scripts/test-config-contract.mjs'
import { readInventory, inventoryFailures, verifyExecutionReport, readTrainRequirements } from '../../../scripts/test-execution-evidence.mjs'
import { declarationFailures } from '../../../scripts/test-inventory.mjs'
import { observeNodeTrackEntry } from './helpers/node-track-observation-lab.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const PACKAGE_JSON = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'))
const CI_WORKFLOW = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
// pathToFileURL, not the bare path: on Windows an absolute path starts with a
// drive letter, which the ESM loader reads as an unsupported URL scheme
// ("Received protocol 'd:'"). CI's windows-latest legs caught exactly that.
const RUNNER = pathToFileURL(
  resolve(HERE, '..', '..', '..', 'scripts', 'run-test-gates.mjs'),
).href

const {
  runGates,
  verdictFor,
  classifyRun,
  exitCodeFor,
  PASSED,
  FAILED,
  SKIPPED,
  TIMED_OUT,
  INCONCLUSIVE,
  STEPS,
  RUNTIME_EXECUTION_REPORT,
  verifyRuntimeExecution,
  listRuntimeSuiteFiles,
} = await import(RUNNER)

function workflowJobBlock(source, id) {
  const marker = `  ${id}:\n`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `workflow must contain a ${id} job`)
  const fromJob = source.slice(start)
  const nextJob = fromJob.slice(marker.length).search(/\n  [a-zA-Z0-9_-]+:\n/)
  return nextJob === -1
    ? fromJob
    : fromJob.slice(0, marker.length + nextJob)
}

test('CI budgets leave headroom above the measured fifteen-minute integration run', () => {
  for (const id of ['build-and-test', 'npm-test-trust-root']) {
    const job = workflowJobBlock(CI_WORKFLOW, id)
    assert.match(job, /^    timeout-minutes: 25$/m)
  }
})

test('suite timing ranks Node and Vitest evidence and warns about slow suites', async () => {
  const { reportSuiteDurations } = await import('../../../scripts/report-test-durations.mjs')
  let output = ''
  reportSuiteDurations({ testResults: [
    { name: 'quick.test.js', durationMs: 12 },
    { name: 'slow.test.ts', startTime: 1000, endTime: 81000 },
    { name: 'middle.test.js', durationMs: 2000 },
    { name: 'unknown.test.js' },
  ] }, { label: 'fixture', write: text => { output += text }, limit: 2 })
  assert.match(output, /80\.0s slow\.test\.ts[\s\S]*2\.0s middle\.test\.js/)
  assert.doesNotMatch(output, /quick\.test\.js/)
  assert.match(output, /WARNING.*1 suite.*60\.0s/)
  assert.match(output, /1 suite.*without timing/)
})

test('Node timing counts top-level durations once and preserves execution verdicts', async () => {
  const { default: reporter } = await import('../../../scripts/node-evidence-reporter.mjs')
  async function* events() {
    yield { type: 'test:pass', data: { file: '/tmp/timing.test.js', name: 'nested', nesting: 1, details: { duration_ms: 20 } } }
    yield { type: 'test:pass', data: { file: '/tmp/timing.test.js', name: 'parent', nesting: 0, details: { type: 'suite', duration_ms: 30 } } }
    yield { type: 'test:fail', data: { file: '/tmp/timing.test.js', name: 'other', nesting: 0, details: { duration_ms: 10 } } }
  }
  let report
  for await (const chunk of reporter(events())) report = JSON.parse(chunk)
  assert.equal(report.testResults[0].durationMs, 40)
  assert.equal(report.success, false)
  assert.equal(report.numPassedTests, 1)
  assert.equal(report.numFailedTests, 1)
})

test('gate prints suite timing even when execution fails, without upgrading the verdict', () => {
  const lab = mkdtempSync(join(tmpdir(), 'gate-timing-'))
  try {
    const reportPath = join(lab, 'report.json')
    const io = capture()
    const code = runGates([step('broken-suite', 1, {
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({testResults:[{name:'broken.test.js',durationMs:70000}]}));process.exit(1)`],
      reportPath,
    })], io.options)
    assert.equal(code, 1)
    assert.match(io.text, /70\.0s broken\.test\.js/)
    assert.match(io.text, /broken-suite\s+failed\s+exit 1/)
  } finally { rmSync(lab, { recursive: true, force: true }) }
})

/** A synthetic step that exits with the given code. */
function step(id, exitCode, extra = {}) {
  return {
    id,
    description: `synthetic step exiting ${exitCode}`,
    command: process.execPath,
    args: ['-e', `process.exit(${exitCode})`],
    ...extra,
  }
}

/** Collect a run's output instead of inheriting it. */
function capture() {
  const out = []
  const err = []
  return {
    out,
    err,
    get text() {
      return out.join('') + err.join('')
    },
    options: {
      write: (s) => out.push(s),
      writeErr: (s) => err.push(s),
      stdio: 'ignore',
      // Keep the scope disclosure out of these assertions; it walks the repo and
      // is covered separately.
      scope: '',
    },
  }
}

test('negative control: all steps passing yields exit 0', () => {
  const io = capture()
  const code = runGates([step('a', 0), step('b', 0)], io.options)
  assert.equal(code, 0)
  assert.match(io.text, /All 2 steps passed\./)
})

test('M1: a failed step must yield exit 1, never a pass', () => {
  const io = capture()
  const code = runGates([step('ok', 0), step('bad', 1)], io.options)
  assert.equal(code, 1, 'a failing step must make npm test fail')
  assert.match(io.text, /FAILED steps \(1\): bad/)
  // The verdict itself, not merely the exit code: M1 flipped this word.
  assert.match(io.text, /bad\s+failed\s+exit 1/)
  assert.doesNotMatch(io.text, /All \d+ steps passed\./)
})

test('M1 at the unit: verdictFor never calls a non-zero code passed', () => {
  assert.equal(verdictFor(0, {}), PASSED)
  for (const code of [1, 2, 127, 'spawn-error', 'threw', 'signal:SIGKILL']) {
    assert.equal(verdictFor(code, {}), FAILED, `code ${code} must not be ${PASSED}`)
  }
})

test('M4: a skipped step must yield exit 1, never a pass', () => {
  const io = capture()
  const code = runGates(
    [step('build', 1), step('tests', 0, { requiresBuild: true })],
    io.options,
  )
  assert.equal(code, 1, 'a skipped step has no verdict and must not produce a green')
  assert.match(io.text, new RegExp(`tests\\s+${SKIPPED}`))
  assert.match(io.text, /NOT RUN because the build failed \(1\): tests/)
  assert.doesNotMatch(io.text, /All \d+ steps passed\./)
})

/**
 * The exit rule is tested DIRECTLY, on constructed result sets, not only through
 * the step loop.
 *
 * Why it must be separate: in the current gate topology a step can only be skipped
 * when the build itself is recorded non-passing, so the run already fails on the
 * build's account. That makes "skipped still exits 0" unreachable through the loop
 * — an equivalent mutant — and a loop-level test would pass with the mutation in
 * place, which is exactly what happened on the first attempt here. Testing the rule
 * on its own reaches the state the loop cannot, and covers statuses that do not
 * exist yet.
 */
test('exit rule: exit 0 requires every step to have passed', () => {
  assert.equal(exitCodeFor([{ status: PASSED }, { status: PASSED }]), 0)
  assert.equal(exitCodeFor([]), 1, 'nothing observed is not the same as nothing wrong')
  for (const bad of [FAILED, SKIPPED, TIMED_OUT, INCONCLUSIVE, 'a-status-invented-next-year']) {
    assert.equal(
      exitCodeFor([{ status: PASSED }, { status: bad }]),
      1,
      `a run containing ${bad} must not exit 0`,
    )
  }
})

test('exit rule: a lone skipped step is enough to fail the run', () => {
  // The mutation this kills: whitelisting SKIPPED in the exit condition.
  assert.equal(exitCodeFor([{ status: SKIPPED }]), 1)
  assert.equal(exitCodeFor([{ status: INCONCLUSIVE }]), 1)
})

test('a skipped step is never reported as passed', () => {
  const io = capture()
  runGates([step('build', 1), step('tests', 0, { requiresBuild: true })], io.options)
  assert.doesNotMatch(io.text, /tests\s+passed/)
  assert.match(io.text, /not run/)
})

test('a timed-out step is named as a non-verdict and later steps still run', () => {
  const io = capture()
  const code = runGates(
    [
      {
        id: 'hung',
        description: 'never exits',
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 50,
      },
      step('after-timeout', 0),
    ],
    io.options,
  )
  assert.equal(code, 1, 'a step without an exit code must fail the run')
  assert.match(io.text, new RegExp(`hung\\s+${TIMED_OUT}\\s+no exit`))
  assert.match(io.text, /TIMED OUT \(1\): hung/)
  assert.match(io.text, /after-timeout\s+passed\s+exit 0/)
  assert.match(io.text, /=== npm test summary ===/)
  assert.doesNotMatch(io.text, /hung\s+passed/)
  assert.doesNotMatch(io.text, /All \d+ steps passed\./)
})

test('every step appears in the summary, including after a failure', () => {
  const io = capture()
  const ids = ['one', 'two', 'three', 'four']
  runGates([step('one', 0), step('two', 1), step('three', 0), step('four', 1)], io.options)
  for (const id of ids) {
    assert.match(io.text, new RegExp(`\\b${id}\\b`), `${id} must be named in the summary`)
  }
  assert.match(io.text, /FAILED steps \(2\): two, four/)
})

test('a later step still runs after an earlier one fails', () => {
  const io = capture()
  // If the first failure short-circuited, "late" would never be reported at all.
  const code = runGates([step('early', 1), step('late', 0)], io.options)
  assert.equal(code, 1)
  assert.match(io.text, /late\s+passed\s+exit 0/)
})

test('spawn-error is a failure, not a pass', () => {
  const io = capture()
  const code = runGates(
    [{ id: 'missing', description: 'nonexistent binary', command: '/nonexistent/binary/xyz', args: [] }],
    io.options,
  )
  assert.equal(code, 1)
  assert.match(io.text, /missing\s+failed/)
})

test('death by signal is a failure, not a pass', () => {
  const io = capture()
  const code = runGates(
    [
      {
        id: 'killed',
        description: 'kills itself',
        command: process.execPath,
        args: ['-e', 'process.kill(process.pid, "SIGKILL")'],
      },
    ],
    io.options,
  )
  assert.equal(code, 1)
  assert.match(io.text, /killed\s+failed/)
  // The invariant that matters everywhere: violent death is never a pass.
  assert.doesNotMatch(io.text, /killed\s+passed/)
  // The `signal:` rendering itself is POSIX-only. Windows has no real signals —
  // node emulates process.kill by terminating the child, so spawnSync reports a
  // plain non-zero status and no signal. Asserting `signal:` unconditionally
  // made this test red on both windows legs while the behaviour was correct.
  // classifyRun's signal mapping is covered portably by its own unit test below.
  if (process.platform !== 'win32') {
    assert.match(io.text, /signal:SIG/)
  }
})

test('a5: a throwing step is reported, and later steps are still reported', () => {
  const io = capture()
  // args:42 makes spawnSync throw a TypeError. It used to abandon the summary.
  const code = runGates(
    [
      { id: 'malformed', description: 'bad args', command: process.execPath, args: 42 },
      step('after', 0),
    ],
    io.options,
  )
  assert.equal(code, 1)
  assert.match(io.text, /malformed\s+failed\s+exit threw/)
  assert.match(io.text, /after\s+passed/, 'the summary must not be abandoned by a throw')
})

test('a10: an empty step list must never report success', () => {
  const io = capture()
  assert.equal(runGates([], io.options), 1)
  assert.doesNotMatch(io.text, /All 0 steps passed\./)
  assert.match(io.text, /REFUSING/)
})

test('inconclusive is distinct from both passed and failed, and still fails the run', () => {
  const io = capture()
  const code = runGates([step('vendor', 2, { inconclusiveExitCode: 2 })], io.options)
  assert.equal(code, 1, 'an inconclusive step must not produce a green')
  assert.match(io.text, new RegExp(`vendor\\s+${INCONCLUSIVE}`))
  assert.match(io.text, /INCONCLUSIVE \(1\): vendor/)
  assert.doesNotMatch(io.text, /vendor\s+passed/)
  // Drift (exit 1) must still read as a real failure, not as inconclusive.
  const io2 = capture()
  runGates([step('vendor', 1, { inconclusiveExitCode: 2 })], io2.options)
  assert.match(io2.text, /vendor\s+failed/)
})

test('the raw exit code is printed next to every verdict', () => {
  // Defence in depth: a flipped verdict cannot also launder its own evidence,
  // because the row would read absurdly (e.g. "passed exit 1").
  const io = capture()
  runGates([step('a', 0), step('b', 3)], io.options)
  assert.match(io.text, /a\s+passed\s+exit 0/)
  assert.match(io.text, /b\s+failed\s+exit 3/)
})

test('failures are rendered twice, so dropping one rendering cannot hide them', () => {
  const io = capture()
  runGates([step('boom', 1)], io.options)
  const inTable = /boom\s+failed\s+exit 1/.test(io.text)
  const inList = /FAILED steps \(1\): boom/.test(io.text)
  assert.ok(inTable && inList, 'a failure must appear in both the table and the failed list')
})

test('classifyRun maps spawnSync results to reportable codes', () => {
  assert.equal(classifyRun({ status: 0 }), 0)
  assert.equal(classifyRun({ status: 7 }), 7)
  assert.equal(classifyRun({ error: new Error('nope') }), 'spawn-error')
  assert.equal(
    classifyRun({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }),
    TIMED_OUT,
  )
  assert.equal(classifyRun({ signal: 'SIGTERM' }), 'signal:SIGTERM')
  assert.equal(classifyRun({ status: null }), 1, 'an unknown status must not read as success')
})

test('the real STEPS list is non-empty and contains the test runner', () => {
  assert.ok(STEPS.length > 0, 'an empty gate list would make npm test vacuous')
  const ids = STEPS.map((s) => s.id)
  assert.ok(ids.includes('tests'), 'the suite must be one of the gates')
  assert.ok(ids.includes('build'))
  const tests = STEPS.find((s) => s.id === 'tests')
  assert.equal(tests.requiresBuild, true, 'the suite depends on the compiled dist')
  // run-tests grants Node and Track ten minutes each, sequentially.
  assert.ok(tests.timeoutMs > 2 * 10 * 60_000,
    'the outer Node/Track gate must allow both child deadlines and report verification')
  for (const step of STEPS) {
    assert.ok(Number.isInteger(step.timeoutMs) && step.timeoutMs > 0, `${step.id} needs a bounded timeout`)
  }
})

test('package.json wires npm test to the production gate entrypoint', () => {
  assert.equal(
    PACKAGE_JSON.scripts?.test,
    'node scripts/run-test-gates.mjs',
    'an inert or redirected scripts.test must fail the independent trust-root test',
  )
})

test('the real STEPS list invokes the exact production commands', () => {
  const npmExecPath = process.env.npm_execpath
  const expectedBuild = npmExecPath && /\.(c?js|mjs)$/i.test(npmExecPath)
    ? {
        command: process.execPath,
        args: [npmExecPath, 'run', 'build'],
        shell: false,
      }
    : {
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        args: ['run', 'build'],
        shell: process.platform === 'win32',
      }

  assert.deepEqual(
    STEPS.map((step) => ({
      id: step.id,
      command: step.command,
      args: step.args,
      shell: Boolean(step.shell),
      requiresBuild: Boolean(step.requiresBuild),
      inconclusiveExitCode: step.inconclusiveExitCode ?? null,
      reportPath: step.reportPath ?? null,
    })),
    [
      {
        id: 'build',
        ...expectedBuild,
        requiresBuild: false,
        inconclusiveExitCode: null,
        reportPath: null,
      },
      {
        id: 'check:focus-vendor',
        command: process.execPath,
        args: ['scripts/check-focus-vendor.mjs'],
        shell: false,
        requiresBuild: false,
        inconclusiveExitCode: 2,
        reportPath: null,
      },
      {
        id: 'check:focus-app',
        command: process.execPath,
        args: ['scripts/check-focus-app.mjs'],
        shell: false,
        requiresBuild: false,
        inconclusiveExitCode: null,
        reportPath: null,
      },
      {
        id: 'lint:focus-imports',
        command: process.execPath,
        args: ['apps/focus/scripts/check-imports.mjs'],
        shell: false,
        requiresBuild: false,
        inconclusiveExitCode: null,
        reportPath: null,
      },
      {
        id: 'tests',
        command: process.execPath,
        args: ['scripts/run-tests.mjs'],
        shell: false,
        requiresBuild: true,
        inconclusiveExitCode: null,
        reportPath: resolve(REPO_ROOT, 'tmp/node-track-report.json'),
      },
      {
        id: 'h2a-runtime',
        command: 'node_modules/.bin/vitest',
        args: ['run', '--config', 'packages/h2a-runtime/vitest.config.ts'],
        shell: false,
        requiresBuild: true,
        inconclusiveExitCode: null,
        reportPath: RUNTIME_EXECUTION_REPORT,
      },
    ],
    'IDs alone are not evidence: replacing a production command with an inert command must fail',
  )
})

test('CI exposes an independent, stable npm-test-trust-root job', () => {
  assert.match(CI_WORKFLOW, /^  pull_request:\n    branches: \[main\]$/m)
  const job = workflowJobBlock(CI_WORKFLOW, 'npm-test-trust-root')

  assert.match(job, /^    name: npm-test-trust-root$/m)
  assert.match(job, /uses: actions\/checkout@v4/)
  assert.match(job, /uses: actions\/setup-node@v4/)
  assert.match(job, /^          node-version: "22"$/m)
  assert.doesNotMatch(job, /^    needs:/m, 'the trust root must not inherit another job verdict')

  const commands = [...job.matchAll(/^\s+(?:- )?run:\s*(.+)$/gm)].map((match) => match[1])
  assert.deepEqual(
    commands,
    [
      // Round-1 (code-review astra-8/sol-9, wonder-P3): the job provisions
      // AND qualifies the L0 filesystem barrier (bubblewrap) before any
      // test-sandbox invocation — no unconfined fallback.
      'command -v bwrap >/dev/null || { sudo apt-get update && sudo apt-get install -y bubblewrap; } && bwrap --version',
      'npm ci',
      'npm install --global @openai/codex@0.145.0 @anthropic-ai/claude-code@2.1.296',
      'node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/run-test-gates.test.js',
      'node scripts/run-test-gates.mjs',
    ],
    'the dedicated job must verify the runner and then execute its real entrypoint',
  )
})

test('the runner test is not discovered through the runner it verifies', () => {
  assert.ok(!discoverTestFiles().includes(RUNNER_TEST_FILE))
})

// ---------------------------------------------------------------------------
// SPEC 0.98.5 R8.1 — `npm test` must DISCOVER the TypeScript suites of
// packages/h2a-runtime. Until the `h2a-runtime` step existed, those suites
// (native-terminal, session-lease, proc-cpu, ...) ran in NO gate at all, and
// four broken versions reached npm behind a green `npm test`.
// ---------------------------------------------------------------------------

const H2A_RUNTIME_COMMAND =
  'node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts'
const RUNNER_SOURCE = readFileSync(
  resolve(REPO_ROOT, 'scripts', 'run-test-gates.mjs'),
  'utf8',
)

function stepCommandLine(step) {
  return [step.command, ...(step.args ?? [])].join(' ')
}

test('R8.1: a dedicated h2a-runtime step exists and runs the exact pinned command', () => {
  const step = STEPS.find((s) => s.id === 'h2a-runtime')
  assert.ok(step, 'npm test must contain a step named h2a-runtime')
  assert.equal(
    stepCommandLine(step),
    H2A_RUNTIME_COMMAND,
    'the h2a-runtime command is pinned exactly by the spec: any replacement — inert wrapper, lighter config, dropped --config — must fail here',
  )
  assert.equal(step.requiresBuild, true, 'a broken build must yield NO verdict for the runtime suites, not a misleading one')
  // The step must sit in the production list itself, not beside it.
  assert.ok(
    STEPS.some((s) => s.id === 'h2a-runtime'),
    'the exact-command step above must be the one wired into STEPS',
  )
})

test('R8.1: the pinned vitest config exists and covers src/**/*.test.ts', () => {
  const configPath = resolve(REPO_ROOT, 'packages', 'h2a-runtime', 'vitest.config.ts')
  let config
  try {
    config = readFileSync(configPath, 'utf8')
  } catch {
    assert.fail(`the pinned config must exist at exactly ${configPath}`)
  }
  assert.match(
    config,
    /include:\s*\[\s*['"]src\/\*\*\/\*\.test\.ts['"]\s*\]/,
    'the config must cover src/**/*.test.ts so new runtime suites are discovered, not enumerated',
  )
})

/**
 * R8.1 — round-6 review finding P1: the config test above pinned the include
 * pattern TEXTUALLY, so adding `exclude: ["src/native-terminal/**"]` to the
 * pinned config kept this whole trust root green (30/30, exit 0) while the
 * native-terminal suites vanished from the gate's EFFECTIVE discovery — a red
 * native suite stopped counting against a release the moment it stopped
 * matching the glob, and the runner reported the step green over a run that no
 * longer contained it.
 *
 * The qualification below closes the hole by EXECUTION, not text: it drives
 * vitest's own file discovery (`vitest list --filesOnly` — glob resolution
 * only: no test file is imported, nothing executes, no build is required)
 * through the pinned config and requires the discovered set to equal EVERY
 * `*.test.ts` that exists on disk under packages/h2a-runtime/src. The suites
 * are enumerated by the FILESYSTEM, not by this test, so the guard keeps
 * holding when new suites land (crash-safe-log, crash-safety.functional, ...)
 * and any include/exclude edit that silently drops one file — or all of
 * them — surfaces as a set difference, file by file.
 */
test('R8.1: EFFECTIVE discovery — the pinned config must actually discover every runtime *.test.ts', () => {
  const lab = mkdtempSync(join(tmpdir(), 'h2a-runtime-discovery-'))
  try {
    const result = spawnSync(process.execPath, [
      resolve(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
      'list',
      '--filesOnly',
      '--config',
      'packages/h2a-runtime/vitest.config.ts',
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      // Confinement: the discovery probe runs against a temp runtime dir, never real state.
      env: { ...process.env, XDG_RUNTIME_DIR: lab, TMPDIR: lab },
    })
    assert.equal(
      result.status,
      0,
      `vitest discovery through the pinned config must itself succeed:\n${result.stdout}\n${result.stderr}`,
    )
    const onDisk = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue
          walk(join(dir, entry.name))
        } else if (entry.name.endsWith('.test.ts')) {
          onDisk.push(join(dir, entry.name))
        }
      }
    }
    walk(resolve(REPO_ROOT, 'packages', 'h2a-runtime', 'src'))
    onDisk.sort()
    assert.ok(onDisk.length > 0, 'the runtime package must keep TypeScript suites for the gate to discover')
    const discovered = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.test.ts'))
      .map((line) => resolve(REPO_ROOT, line))
      .sort()
    assert.deepEqual(
      discovered,
      onDisk,
      'the gate only grades the files vitest EFFECTIVELY discovers: an exclude (round-6: exclude: ["src/native-terminal/**"] left every textual pin green while 14 native suites left the run) or an include edit that silently drops a suite shows up here as a missing file',
    )
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// SPEC 0.98.5 R8.1 — EXECUTION, not discovery (round-7 review finding P1).
// The round-6 qualification proved the pinned config DISCOVERS every runtime
// *.test.ts — and the reviewer then made every one of them silently not run
// with a one-line `testNamePattern` in that same config: vitest exited 0 over
// "14 tests ignored" and the whole trust root stayed green. Discovery proves
// what CAN run; only an observed report proves what DID run. The proofs below
// pin the mechanism at three levels:
//   - STRUCTURE: the config wires the JSON report the runner verifies, and no
//     test-removing option may appear in it at all;
//   - UNIT: the verifier grades reports by executed identity and count;
//   - EXECUTION: through the pinned config's own text (in a lab), the
//     reviewer's exact mutation — and exclude, and a file-level skip in an
//     unmarked suite — turns the gate verdict red while vitest still exits 0;
//     and the runner itself (in a sentinel copy) refuses a green exit code
//     over an absent, stale or holed report.
// ---------------------------------------------------------------------------

const RUNTIME_CONFIG = readFileSync(
  resolve(REPO_ROOT, 'packages', 'h2a-runtime', 'vitest.config.ts'),
  'utf8',
)
// Structural pins target the EFFECTIVE config code: comments are stripped, so
// a banned option cannot hide inside a comment and a comment cannot trip the
// denylist.
const RUNTIME_CONFIG_CODE = RUNTIME_CONFIG
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '')

test('R8.1 execution: the h2a-runtime step carries an EXECUTION proof, not just a command', () => {
  const step = STEPS.find((s) => s.id === 'h2a-runtime')
  assert.ok(step)
  assert.equal(step.reportPath, RUNTIME_EXECUTION_REPORT, 'the step must read the report the pinned config writes')
  assert.equal(typeof step.requiredFiles, 'function', 'the required suite set must be enumerated at run time, not frozen into a list')
  assert.strictEqual(
    step.verifyExecution,
    verifyRuntimeExecution,
    'identity: the step must run the exported verifier, not a local weaker copy',
  )
  assert.equal(
    RUNTIME_EXECUTION_REPORT,
    resolve(REPO_ROOT, 'tmp', 'h2a-runtime-vitest-report.json'),
    'the report path is pinned exactly (gitignored tmp/)',
  )
  const required = listRuntimeSuiteFiles()
  assert.ok(required.length > 0, 'the required runtime suite set must be non-empty')
  for (const file of required) {
    assert.ok(
      file.startsWith(resolve(REPO_ROOT, 'packages', 'h2a-runtime', 'src')),
      `${file} must live under packages/h2a-runtime/src`,
    )
  }
})

test('R8.1 execution: the pinned config wires the report the gate verifies — and no test-removing option hides in it', () => {
  // The reporter wiring: the default output stays for humans, plus the JSON
  // report the runner reads after the run.
  assert.match(
    RUNTIME_CONFIG_CODE,
    /reporters:\s*\[\s*["']default["']/,
    'the pinned config must keep the default reporter alongside the JSON report',
  )
  assert.match(
    RUNTIME_CONFIG_CODE,
    /\[\s*["']json["'],\s*\{\s*outputFile:/,
    'the pinned config must write a JSON report with an explicit outputFile',
  )
  // Config and runner must name the SAME file: a drift between the file the
  // config writes and the file the runner reads voids the whole proof.
  assert.match(RUNTIME_CONFIG_CODE, /h2a-runtime-vitest-report\.json/, 'the config must name the pinned report file')
  assert.match(RUNNER_SOURCE, /h2a-runtime-vitest-report\.json/, 'the runner must name the pinned report file')
  // DENYLIST: no option that can remove a required test may appear in the
  // pinned config AT ALL — not neutralized, not commented out, absent. This
  // is the structural half of the round-7 fix: `testNamePattern` left the
  // entire trust root green while 14 native tests silently never ran.
  for (const banned of ['testNamePattern', 'namePattern', 'passWithNoTests', 'exclude', 'skip', 'only', 'todo', 'grep', 'disabled']) {
    assert.doesNotMatch(
      RUNTIME_CONFIG_CODE,
      new RegExp(`\\b${banned}\\b`),
      `the pinned vitest config must not contain "${banned}": a config-level filter/pattern/skip can silently remove required tests while vitest exits 0 (round-7 finding P1)`,
    )
  }
})

test('R8.1 execution: verifyRuntimeExecution grades reports by executed identity and count', () => {
  // These reports describe a synthetic lab, not the integrated release train.
  const verifyLabExecution = verifyExecutionReport
  const lab = mkdtempSync(join(tmpdir(), 'h2a-exec-unit-'))
  try {
    const unmarked = join(lab, 'unmarked.test.ts')
    writeFileSync(unmarked, 'import { test } from "vitest"\n')
    const marked = join(lab, 'marked.test.ts')
    writeFileSync(
      marked,
      'import { test } from "vitest"\ndescribe.skipIf(process.platform === "win32")("declared platform skip", () => {})\n',
    )
    const reportOf = (entries, overrides = {}) => {
      let passed = 0
      let failed = 0
      let pending = 0
      let todo = 0
      const testResults = entries.map(([file, assertions]) => ({
        name: file,
        status: assertions.some((a) => a.status === 'failed') ? 'failed' : 'passed',
        assertionResults: assertions,
      }))
      for (const [, assertions] of entries) {
        for (const a of assertions) {
          if (a.status === 'passed') passed += 1
          else if (a.status === 'failed') failed += 1
          else if (a.status === 'skipped') pending += 1
          else todo += 1
        }
      }
      return {
        numTotalTests: passed + failed + pending + todo,
        numPassedTests: passed,
        numFailedTests: failed,
        numPendingTests: pending,
        numTodoTests: todo,
        testResults,
        ...overrides,
      }
    }
    const a = (status, fullName = 'a test') => ({ status, fullName })

    // A complete, all-executed report over the required set is the ONE
    // accepted shape.
    assert.deepEqual(
      verifyLabExecution(
        reportOf([[unmarked, [a('passed')]], [marked, [a('passed', 'one'), a('passed', 'two')]]]),
        [unmarked, marked],
      ),
      [],
      'every required suite present, every test executed: the accepted shape',
    )
    // No report / no required set: fail closed.
    assert.ok(verifyLabExecution(null, [unmarked]).length > 0, 'a missing report can never be a proof')
    assert.ok(
      verifyLabExecution(reportOf([[unmarked, [a('passed')]]]), []).length > 0,
      'an empty required set can never be a proof',
    )
    // A required file ABSENT from the report never executed.
    const absent = verifyLabExecution(reportOf([[unmarked, [a('passed')]]]), [unmarked, marked])
    assert.ok(
      absent.some((f) => f.includes('NEVER EXECUTED') && f.includes('marked.test.ts')),
      'a required suite missing from the report must be named as never executed',
    )
    // A reported file OUTSIDE the required set: the report does not match the pinned discovery.
    const stranger = join(lab, 'stranger.test.ts')
    const extra = verifyLabExecution(reportOf([[unmarked, [a('passed')]], [stranger, [a('passed')]]]), [unmarked])
    assert.ok(
      extra.some((f) => f.includes('not part of the required suite set')),
      'a reported file outside the required set must fail the proof',
    )
    // A skipped or todo'd test in an UNMARKED file is a silent removal.
    for (const status of ['skipped', 'todo']) {
      const skipped = verifyLabExecution(reportOf([[unmarked, [a('passed'), a(status)]]]), [unmarked])
      assert.ok(
        skipped.some((f) => f.includes(`"${status}"`)),
        `a ${status} test in a suite that declares no skip marker must fail the gate`,
      )
    }
    // A status-less assertion is not an executed test either.
    const statusless = verifyLabExecution(reportOf([[unmarked, [a('passed'), {}]]]), [unmarked])
    assert.ok(statusless.some((f) => f.includes('"missing"') || f.includes('unnamed')), 'an assertion without a status proves nothing')
    // A declaration or comment cannot authorize a skipped assertion.
    assert.ok(verifyLabExecution(reportOf([[marked, [a('skipped')]]]), [marked]).length > 0)
    // An unmarked file with ZERO executed tests: the whole suite was filtered away.
    const zero = verifyLabExecution(reportOf([[unmarked, [a('skipped')]]]), [unmarked])
    assert.ok(zero.some((f) => f.includes('executed ZERO tests') || f.includes('missing or unreadable')), 'a filtered-away suite must fail by executed count')
    // The summary counts must exist and add up.
    const shapeless = JSON.parse(JSON.stringify(reportOf([[unmarked, [a('passed')]]])))
    delete shapeless.numTotalTests
    assert.ok(
      verifyLabExecution(shapeless, [unmarked]).length > 0,
      'a report without integer summary counts proves nothing',
    )
    const lying = reportOf([[unmarked, [a('passed', 'one'), a('skipped', 'two')]]], { numTotalTests: 2, numPendingTests: 0 })
    assert.ok(
      verifyLabExecution(lying, [unmarked]).some((f) => f.includes('do not add up')),
      'a report whose totals contradict its own statuses is not evidence',
    )
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})

test('R8.1 execution (lab): through the pinned config, a filter or skip that removes a required test turns the gate red', () => {
  const verifyLabExecution = verifyExecutionReport
  mkdirSync(join(REPO_ROOT, 'tmp'), { recursive: true })
  const lab = mkdtempSync(join(REPO_ROOT, 'tmp', 'h2a-exec-lab-'))
  try {
    mkdirSync(join(lab, 'src'), { recursive: true })
    const writeSuite = () => {
      writeFileSync(join(lab, 'src', 'a.test.ts'),
        'import { test, expect } from "vitest"\n' +
        'test("a one", () => { expect(1).toBe(1) })\n' +
        'test("a two", () => { expect(2).toBe(2) })\n')
      writeFileSync(join(lab, 'src', 'b.test.ts'),
        'import { test, expect } from "vitest"\n' +
        'test("b one", () => { expect(1).toBe(1) })\n')
    }
    writeSuite()
    // The required set: enumerated from the lab filesystem exactly the way the
    // gate enumerates the real one.
    const required = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name))
        else if (entry.name.endsWith('.test.ts')) required.push(join(dir, entry.name))
      }
    }
    walk(join(lab, 'src'))
    required.sort()

    // The lab config is the REAL pinned config text with two splices — the
    // repo-only isolation setup, and a lab-local report file — plus whatever
    // mutation is under test. The reporter wiring itself is the production
    // text: this is the pinned config executing, not a lookalike.
    const labConfig = (mutate) => {
      let source = RUNTIME_CONFIG
      const beforeSetup = source
      source = source.replace(/^\s*setupFiles:.*$\n?/m, '')
      assert.notEqual(source, beforeSetup, 'the setupFiles splice must apply to the real config')
      const beforeOut = source
      source = source.replace('"../../tmp/h2a-runtime-vitest-report.json"', '"report.json"')
      assert.notEqual(source, beforeOut, 'the outputFile splice must apply to the real config')
      source = source.replace('../../scripts/test-config-contract.mjs', pathToFileURL(resolve(REPO_ROOT, 'scripts/test-config-contract.mjs')).href)
      if (mutate) source = mutate(source)
      const configPath = join(lab, 'vitest.config.ts')
      writeFileSync(configPath, source)
      return configPath
    }
    // The gate's own reading of the run: the command's exit code AND the
    // execution proof the runner would apply to the report the run wrote.
    const runGate = (configPath) => {
      const reportPath = join(lab, 'report.json')
      rmSync(reportPath, { force: true })
      const run = spawnSync('node_modules/.bin/vitest', ['run', '--config', configPath], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        // Confinement: the probe runs against temp dirs only.
        env: { ...process.env, XDG_RUNTIME_DIR: lab, TMPDIR: lab, H2A_TEST_REPORT_PATH: reportPath },
      })
      let report = null
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'))
      } catch {
        report = null
      }
      return {
        exit: run.status,
        failures: verifyLabExecution(report, required),
        output: `${run.stdout}\n${run.stderr}`,
      }
    }

    // (1) CLEAN: every required suite executes — the proof holds green.
    const clean = runGate(labConfig())
    assert.equal(clean.exit, 0, `the clean lab suite must pass:\n${clean.output}`)
    assert.deepEqual(clean.failures, [], `the clean lab suite must PROVE execution:\n${clean.failures.join('\n')}`)

    // (2) THE REVIEWER'S EXACT MUTATION (round-7 finding P1): testNamePattern
    // in the pinned config. Vitest itself stays exit 0 — that IS the false
    // green — but the execution proof must now fail the gate.
    const pattern = runGate(labConfig((source) =>
      source.replace('environment: "node",', 'environment: "node",\n    testNamePattern: "^C7_NO_TEST_HAS_THIS_NAME$",'),
    ))
    assert.equal(
      pattern.exit,
      1,
      'the effective config must reject a pattern before it removes tests',
    )
    assert.ok(
      pattern.failures.some((f) => f.includes('executed ZERO tests') || f.includes('missing or unreadable')),
      `a rejected config must leave no accepted execution proof:\n${pattern.failures.join('\n')}`,
    )

    // (3) exclude: a required file silently leaves the run — vitest exit 0.
    const excluded = runGate(labConfig((source) =>
      source.replace('include: ["src/**/*.test.ts"],', 'include: ["src/**/*.test.ts"],\n    exclude: ["src/b.test.ts"],'),
    ))
    assert.equal(excluded.exit, 1, `the effective config must reject excludes:\n${excluded.output}`)
    assert.ok(
      excluded.failures.some((f) => (f.includes('NEVER EXECUTED') && f.includes('b.test.ts')) || f.includes('missing or unreadable')),
      `an excluded required file must be named as never executed:\n${excluded.failures.join('\n')}`,
    )

    // (4) An explicit skip still requires an identity-scoped exception.
    writeFileSync(join(lab, 'src', 'b.test.ts'),
      'import { test, expect } from "vitest"\n' +
      'test("b one", () => { expect(1).toBe(1) })\n' +
      'test.skip("b declared tracked debt", () => { expect(1).toBe(1) })\n')
    const declared = runGate(labConfig())
    assert.equal(declared.exit, 0)
    assert.deepEqual(
      declared.failures.length > 0,
      true,
      `a skip declaration cannot authorize losing the required test:\n${declared.failures.join('\n')}`,
    )

    // (5) Whole-suite platform declarations grant no global skip exception.
    writeFileSync(join(lab, 'src', 'b.test.ts'),
      'import { test, expect, describe } from "vitest"\n' +
      '// emulates the committed describe.skipIf(process.platform !== "linux") suites\n' +
      'describe.skipIf(true)("declared platform suite", () => {\n' +
      '  test("b one", () => { expect(1).toBe(1) })\n' +
      '})\n')
    const sanctioned = runGate(labConfig())
    assert.equal(sanctioned.exit, 0, `the declared-skip lab suite must pass:\n${sanctioned.output}`)
    assert.deepEqual(
      sanctioned.failures.length > 0,
      true,
      `whole-suite skips must leave holes in the proof:\n${sanctioned.failures.join('\n')}`,
    )
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})

/**
 * The trust root's essential checks as a PURE function, so the negative
 * control can run them against a RIGGED runner and observe them go red.
 * These mirror the assertions above; keeping them in one place is what makes
 * the control meaningful (it exercises the checks, not a copy of them).
 */
function trustRootFailures({ runnerSource, steps, packageTestScript }) {
  const failures = []
  const step = steps.find((s) => s.id === 'h2a-runtime')
  if (!step) {
    failures.push('no h2a-runtime step: the runtime suites would run in no gate')
  } else if (stepCommandLine(step) !== H2A_RUNTIME_COMMAND) {
    failures.push('the h2a-runtime command is not the exact pinned string')
  } else if (
    step.reportPath !== RUNTIME_EXECUTION_REPORT ||
    typeof step.requiredFiles !== 'function' ||
    typeof step.verifyExecution !== 'function'
  ) {
    failures.push(
      'the h2a-runtime step does not carry the full execution proof (reportPath + requiredFiles + verifyExecution): ' +
        'exit 0 could again be graded as execution while a filter silently removed required tests',
    )
  }
  if (!/if \(invokedDirectly\) \{\s*process\.exit\(runGates\(STEPS\)\)\s*\}/.test(runnerSource)) {
    failures.push('direct invocation does not route through runGates(STEPS): the runner could exit 0 without running the suites')
  }
  if (packageTestScript !== 'node scripts/run-test-gates.mjs') {
    failures.push('npm test is not wired to the production gate entrypoint')
  }
  return failures
}

test('R8.1: the trust root is green on the real runner', () => {
  assert.deepEqual(trustRootFailures({
    runnerSource: RUNNER_SOURCE,
    steps: STEPS,
    packageTestScript: PACKAGE_JSON.scripts?.test,
  }), [])
})

test('R8.1 negative control: a rigged runner returning 0 without running the suites fails the trust root', () => {
  // Rigging 1: the runner's direct-invocation tail exits 0 immediately —
  // exactly the "wrapper returns 0 without launching the suites" publication
  // hole of the 0.98.2-0.98.4 incidents.
  const inertTail = RUNNER_SOURCE.replace(
    'process.exit(runGates(STEPS))',
    'process.exit(0)',
  )
  assert.notEqual(inertTail, RUNNER_SOURCE, 'the rigging must actually apply to the real tail')
  assert.ok(trustRootFailures({
    runnerSource: inertTail,
    steps: STEPS,
    packageTestScript: PACKAGE_JSON.scripts?.test,
  }).length > 0, 'a rigged tail returning 0 must fail the trust root')

  // Rigging 2: the h2a-runtime ID survives but its command is inert — the
  // verdict column would read "passed" while no suite ever ran.
  const riggedSteps = STEPS.map((s) =>
    s.id === 'h2a-runtime'
      ? { ...s, command: process.execPath, args: ['-e', 'process.exit(0)'] }
      : s,
  )
  assert.ok(trustRootFailures({
    runnerSource: RUNNER_SOURCE,
    steps: riggedSteps,
    packageTestScript: PACKAGE_JSON.scripts?.test,
  }).length > 0, 'an inert command behind the preserved h2a-runtime id must fail the trust root')

  // Rigging 3: the whole gate list is dropped — "all 0 steps passed".
  assert.ok(trustRootFailures({
    runnerSource: RUNNER_SOURCE,
    steps: [],
    packageTestScript: PACKAGE_JSON.scripts?.test,
  }).length > 0, 'an empty gate list must fail the trust root')

  // Rigging 4 (round-7 class 1): the command string survives verbatim but the
  // execution proof is stripped — vitest still runs, still exits 0 over a
  // testNamePattern'd config, and nothing grades what actually executed.
  const prooflessSteps = STEPS.map((s) =>
    s.id === 'h2a-runtime'
      ? { ...s, reportPath: undefined, requiredFiles: undefined, verifyExecution: undefined }
      : s,
  )
  assert.ok(trustRootFailures({
    runnerSource: RUNNER_SOURCE,
    steps: prooflessSteps,
    packageTestScript: PACKAGE_JSON.scripts?.test,
  }).length > 0, 'a pinned command without the execution proof must fail the trust root')
})

/**
 * R8.1 — the trust root must also EXECUTE the runner's real entry, not only
 * read its source. Round-2 review finding: mutating the runner to
 * `const invokedDirectly = false` produced an inert `node scripts/run-test-gates.mjs`
 * — exit 0, ZERO suites executed — while every source-level assertion above
 * stayed green (the `if (invokedDirectly)` tail text survived verbatim).
 *
 * The check below runs a self-contained copy of the REAL runner source in a
 * temp dir: the only splices are the `./run-tests.mjs` import (stubbed — the
 * copy lives alone), REPO_ROOT (pinned to the lab, so the scope walk cannot
 * leave it) and the COMMANDS of the real STEPS (each becomes a sentinel
 * writing one marker file — the real gates must not run here). The entry
 * tail — the `invokedDirectly` gate and `process.exit(runGates(STEPS))` — is
 * the production source, verbatim.
 *
 * Round-4 review finding F01/N02: the sentinel copies used to REPLACE the
 * step ids wholesale ('sentinel-observed', ...), so a production bypass
 * naming a REAL id (`h2a-runtime`) never met its own name in the proof —
 * the runner's own guard caught it, but the trust root stayed 29/29 green
 * over the mutated runner. The REAL ids are now preserved VERBATIM and only
 * their commands become sentinels, so every bypass shape that names a real
 * id lands on a step this proof actually watches, in execution (the marker
 * files) and in the report (the summary).
 */
function sentinelRunnerSource({ brokenId, dropInLoop, dropAtEntry, executionProof }) {
  let source = RUNNER_SOURCE
  const beforeImport = source
  source = source.replace(
    "import { TEST_DIRS, discoverTestFiles, listNodeTrackSuiteFiles, NODE_TRACK_EXECUTION_REPORT, verifyNodeTrackExecution } from './run-tests.mjs'",
    "const TEST_DIRS = ['(trust-root sentinel stub)']\nconst discoverTestFiles = () => []\nconst listNodeTrackSuiteFiles = () => []\nconst NODE_TRACK_EXECUTION_REPORT = 'unused'\nconst verifyNodeTrackExecution = () => []",
  )
  assert.notEqual(source, beforeImport, 'the import splice must apply to the real runner source')
  source = source.replaceAll("'./test-execution-evidence.mjs'", JSON.stringify(pathToFileURL(resolve(REPO_ROOT, 'scripts/test-execution-evidence.mjs')).href))
  source = source.replaceAll("'./test-inventory.mjs'", JSON.stringify(pathToFileURL(resolve(REPO_ROOT, 'scripts/test-inventory.mjs')).href))
  source = source.replaceAll("'./report-test-durations.mjs'", JSON.stringify(pathToFileURL(resolve(REPO_ROOT, 'scripts/report-test-durations.mjs')).href))
  source = source.replace("const inventory = readInventory(REPO_ROOT)", "const inventory = {}").replace("policyFor(REPO_ROOT, inventory, 'runtime')", "{}")
  const beforeRoot = source
  source = source.replace("const REPO_ROOT = resolve(HERE, '..')", 'const REPO_ROOT = HERE')
  assert.notEqual(source, beforeRoot, 'the REPO_ROOT splice must apply to the real runner source')
  if (dropInLoop) {
    const beforeDrop = source
    // The round-3 review's exact mutation shape: a loop-level `continue`
    // targeting one REAL step id. The dropped step executes NO suite and
    // leaves NO result entry — the runner must refuse to report success
    // over it.
    source = source.replace(
      'for (const step of steps) {',
      `for (const step of steps) {\n    if (step.id === '${dropInLoop}') continue`,
    )
    assert.notEqual(source, beforeDrop, 'the loop-bypass splice must apply to the real runner source')
  }
  if (dropAtEntry) {
    const beforeDrop = source
    // The round-4 review's exact mutation shape (finding F01): the step is
    // filtered out of the list BEFORE the loop, so the round-3 guard — which
    // compared the results against the (reassigned) `steps` parameter — saw a
    // list that no longer contained it. The runner must refuse here too.
    source = source.replace(
      'export function runGates(steps, options = {}) {',
      `export function runGates(steps, options = {}) {\n  steps = steps.filter((step) => step.id !== '${dropAtEntry}')`,
    )
    assert.notEqual(source, beforeDrop, 'the entry-filter splice must apply to the real runner source')
  }
  const markerName = (id) => id.replace(/[^a-zA-Z0-9-]/g, '_')
  const sentinelArgs = (id) => [
    '-e',
    `require('node:fs').writeFileSync(process.env.TRUST_ROOT_SENTINEL_DIR + '/${markerName(id)}', 'executed');process.exit(${id === brokenId ? 1 : 0})`,
  ]
  const sentinelSteps = `export const STEPS = [
${STEPS.map((step) => {
    // When an execution proof is requested for the runtime gate, the sentinel
    // step writes a lab report (or deliberately writes NOTHING for the
    // stale-report proof) and carries the REAL reportPath/requiredFiles/
    // verifyExecution wiring against the copy's own exported verifier — so
    // the proof below exercises the runner's actual prune-then-verify path.
    if (executionProof && step.id === 'h2a-runtime') {
      const writeReport = executionProof.report === 'SKIP'
        ? ''
        : `require('node:fs').writeFileSync(${JSON.stringify(executionProof.reportPath)}, ${JSON.stringify(JSON.stringify(executionProof.report))});`
      return `  {
  id: 'h2a-runtime',
  description: 'sentinel runtime gate writing an execution report',
  command: ${JSON.stringify(process.execPath)},
  args: ${JSON.stringify(['-e', `require('node:fs').writeFileSync(process.env.TRUST_ROOT_SENTINEL_DIR + '/${markerName('h2a-runtime')}', 'executed');${writeReport}process.exit(0)`])},
  timeoutMs: 30000,
  reportPath: ${JSON.stringify(executionProof.reportPath)},
  requiredFiles: () => ${JSON.stringify(executionProof.requiredFiles)},
  verifyExecution: verifyRuntimeExecution,
}`
    }
    return `  ${JSON.stringify({
      id: step.id,
      description: `sentinel command for the real gate ${step.id}`,
      command: process.execPath,
      args: sentinelArgs(step.id),
      timeoutMs: 30000,
    })}`
  }).join(',\n')}
]
`
  const beforeSteps = source
  source = source.replace(/export const STEPS = \[[\s\S]*?\n\]\n/, sentinelSteps)
  assert.ok(
    source.includes(`'/${markerName(STEPS[0].id)}'`),
    'the STEPS splice must apply: the copy must carry the REAL ids with sentinel commands, not the real gates',
  )
  assert.ok(source !== beforeSteps, 'the copy must differ from the runner it verifies beyond the stubs')
  return source
}

test('R8.1 execution: direct invocation of the runner entry is OBSERVED — an inert entry cannot pass', () => {
  const lab = mkdtempSync(join(tmpdir(), 'h2a-trust-root-entry-'))
  try {
    const sentinelDir = join(lab, 'markers')
    const markerPath = (id) => join(sentinelDir, id.replace(/[^a-zA-Z0-9-]/g, '_'))
    const runCopy = (name, brokenId) => {
      writeFileSync(join(lab, name), sentinelRunnerSource({ brokenId }))
      rmSync(sentinelDir, { recursive: true, force: true })
      mkdirSync(sentinelDir, { recursive: true })
      const result = spawnSync(process.execPath, [join(lab, name)], {
        cwd: lab,
        encoding: 'utf8',
        env: { ...process.env, TRUST_ROOT_SENTINEL_DIR: sentinelDir },
        timeout: 60_000,
      })
      return result
    }

    const clean = runCopy('runner-clean.mjs', undefined)
    assert.equal(clean.status, 0, `the clean entry must exit 0\n${clean.stdout}${clean.stderr}`)
    for (const step of STEPS) {
      assert.ok(
        existsSync(markerPath(step.id)),
        `OBSERVED EXECUTION of ${step.id}: the round-4 finding was a bypass naming a REAL id while the proof watched only synthetic ids — every real gate id must execute here`,
      )
      assert.match(
        clean.stdout,
        new RegExp(`${step.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+passed\\s+exit 0`),
        `${step.id} must be reported as passed with its real id`,
      )
    }
    assert.match(clean.stdout, new RegExp(`All ${STEPS.length} steps passed\\.`))

    const broken = runCopy('runner-broken.mjs', 'h2a-runtime')
    assert.equal(
      broken.status,
      1,
      `a broken runtime suite must make the direct entry exit non-zero — an entry that swallows its verdict is a second inert wrapper\n${broken.stdout}${broken.stderr}`,
    )
    for (const step of STEPS) {
      assert.ok(
        existsSync(markerPath(step.id)),
        `the step ${step.id} must run even when another fails: no failure may suppress a later verdict`,
      )
    }
    assert.match(broken.stdout, /h2a-runtime\s+failed\s+exit 1/)
    assert.match(broken.stderr, /FAILED steps \(1\): h2a-runtime/)
    assert.doesNotMatch(broken.stdout, /All \d+ steps passed\./)
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})

/**
 * R8.1 — round-3 review finding N02: a `continue` targeting `h2a-runtime`
 * inside the step loop dropped the step from the results entirely. A broken
 * runtime suite was NEVER executed, the summary said nothing about it, and
 * the runner still exited 0.
 *
 * The property this pins: EVERY step handed to the runner must RECEIVE a
 * verdict. A step absent from the results is not evidence about that step,
 * and the runner must refuse exit 0 while naming the REAL step IDs that were
 * dropped — the IDs stay in the execution proof, in the refusal and in the
 * marker that must stay ABSENT (the bypassed suite never ran).
 */
test('R8.1 execution: a step dropped by the loop cannot launder the run — the round-3 bypass', () => {
  const lab = mkdtempSync(join(tmpdir(), 'h2a-trust-root-bypass-'))
  try {
    const sentinelDir = join(lab, 'markers')
    mkdirSync(sentinelDir, { recursive: true })
    // The reviewer's exact mutation: bypass one REAL step id inside the loop.
    // The bypassed step carries a BROKEN suite, so if it were executed the
    // run would fail on its own account; if it is silently dropped, only the
    // refusal to grade a step it never saw can make the run fail.
    writeFileSync(
      join(lab, 'runner-bypass.mjs'),
      sentinelRunnerSource({ brokenId: 'h2a-runtime', dropInLoop: 'h2a-runtime' }),
    )
    const result = spawnSync(process.execPath, [join(lab, 'runner-bypass.mjs')], {
      cwd: lab,
      encoding: 'utf8',
      env: { ...process.env, TRUST_ROOT_SENTINEL_DIR: sentinelDir },
      timeout: 60_000,
    })
    assert.equal(
      result.status,
      1,
      `a step dropped by the loop must not yield exit 0 — the bypassed runtime suite would never run and the run would still read green\n${result.stdout}${result.stderr}`,
    )
    assert.match(
      result.stderr,
      /h2a-runtime[\s\S]{0,120}no verdict|no verdict[\s\S]{0,120}h2a-runtime/,
      'the refusal must NAME the dropped step by its REAL id: the IDs belong in the execution proof',
    )
    assert.ok(
      !existsSync(join(sentinelDir, 'h2a_runtime')),
      'the bypassed step must NOT have executed: its sentinel marker must stay absent',
    )
    assert.doesNotMatch(result.stdout, /All \d+ steps passed\./)
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})

/**
 * R8.1 — round-4 review finding F01: filtering `h2a-runtime` out of `steps`
 * BEFORE the loop left the round-3 guard comparing the results against an
 * already-filtered list: the broken runtime suite was never executed and
 * BOTH the runner and this trust root exited 0. The verdict-completeness
 * guard must be computed against the list the CALLER handed in, not the
 * (reassignable) parameter — hence the entry snapshot in production, and
 * hence this negative control: the entry-filter shape on a REAL id must
 * refuse exit 0 and name it.
 */
test('R8.1 execution: a step dropped BEFORE the loop cannot launder the run — the round-4 entry filter', () => {
  const lab = mkdtempSync(join(tmpdir(), 'h2a-trust-root-entry-bypass-'))
  try {
    const sentinelDir = join(lab, 'markers')
    mkdirSync(sentinelDir, { recursive: true })
    writeFileSync(
      join(lab, 'runner-entry-bypass.mjs'),
      sentinelRunnerSource({ brokenId: 'h2a-runtime', dropAtEntry: 'h2a-runtime' }),
    )
    const result = spawnSync(process.execPath, [join(lab, 'runner-entry-bypass.mjs')], {
      cwd: lab,
      encoding: 'utf8',
      env: { ...process.env, TRUST_ROOT_SENTINEL_DIR: sentinelDir },
      timeout: 60_000,
    })
    assert.equal(
      result.status,
      1,
      `a step filtered out before the loop must not yield exit 0 — this is the round-4 false green: the runtime suite never ran and the runner still read green\n${result.stdout}${result.stderr}`,
    )
    assert.match(
      result.stderr,
      /h2a-runtime[\s\S]{0,120}no verdict|no verdict[\s\S]{0,120}h2a-runtime/,
      'the refusal must NAME the filtered-out step by its REAL id',
    )
    assert.ok(
      !existsSync(join(sentinelDir, 'h2a_runtime')),
      'the filtered-out step must NOT have executed: its sentinel marker must stay absent',
    )
    assert.doesNotMatch(result.stdout, /All \d+ steps passed\./)
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})

/**
 * R8.1 — round-7 finding P1, at the RUNNER level. The sentinel copy below is
 * the REAL runner source (verified by the existing entry/bypass proofs); its
 * h2a-runtime sentinel writes a lab execution report — or deliberately
 * writes nothing, to prove the prune — and carries the step's REAL wiring:
 * reportPath, requiredFiles and the copy's own exported verifyRuntimeExecution.
 * The runner must then refuse a green exit code over an absent, STALE or
 * holed report: exit 0 is a verdict about the process, never about the tests.
 */
test('R8.1 execution (runner lab): the runner refuses a green exit over an absent, stale or holed report', () => {
  mkdirSync(join(REPO_ROOT, 'tmp'), { recursive: true })
  const lab = mkdtempSync(join(REPO_ROOT, 'tmp', 'h2a-runner-exec-'))
  try {
    const sentinelDir = join(lab, 'markers')
    const reportPath = join(lab, 'report.json')
    const requiredFiles = [join(lab, 'src', 'a.test.ts'), join(lab, 'src', 'b.test.ts')]
    // The lab required files deliberately do NOT exist: the verifier must
    // treat unreadable sources as unmarked (fail closed), exactly like a
    // report that cannot be tied to its sources.
    const completeReport = {
      numTotalTests: 3,
      numPassedTests: 3,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          name: requiredFiles[0],
          status: 'passed',
          assertionResults: [
            { status: 'passed', fullName: 'a one' },
            { status: 'passed', fullName: 'a two' },
          ],
        },
        { name: requiredFiles[1], status: 'passed', assertionResults: [{ status: 'passed', fullName: 'b one' }] },
      ],
    }
    const holedReport = {
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 1,
      numTodoTests: 0,
      testResults: [
        completeReport.testResults[0],
        {
          name: requiredFiles[1],
          status: 'passed',
          assertionResults: [{ status: 'skipped', fullName: 'b silently dropped' }],
        },
      ],
    }
    const missingFileReport = {
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [completeReport.testResults[0]],
    }
    const run = (report) => {
      rmSync(sentinelDir, { recursive: true, force: true })
      mkdirSync(sentinelDir, { recursive: true })
      writeFileSync(
        join(lab, 'runner.mjs'),
        sentinelRunnerSource({ executionProof: { reportPath, requiredFiles, report } }),
      )
      return spawnSync(process.execPath, [join(lab, 'runner.mjs')], {
        cwd: lab,
        encoding: 'utf8',
        env: { ...process.env, TRUST_ROOT_SENTINEL_DIR: sentinelDir },
        timeout: 60_000,
      })
    }

    // (1) A complete, all-executed report: green — for the observed reason.
    const complete = run(completeReport)
    assert.equal(complete.status, 0, `a proven run must stay green:\n${complete.stdout}${complete.stderr}`)
    assert.match(complete.stdout, /h2a-runtime\s+passed\s+exit 0/)
    assert.ok(existsSync(join(sentinelDir, 'h2a-runtime')), 'the runtime sentinel must have executed')

    // (2) A hole: one required test skipped in an unmarked suite. The
    // sentinel still exits 0; the runner must refuse the pass.
    const holed = run(holedReport)
    assert.equal(
      holed.status,
      1,
      `exit 0 over a skipped required test must not read green:\n${holed.stdout}${holed.stderr}`,
    )
    assert.match(holed.stdout, /h2a-runtime\s+failed/)
    assert.match(holed.stderr, /execution not proven/)
    assert.match(holed.stderr, /"skipped"/)

    // (3) A required file missing from the report.
    const missing = run(missingFileReport)
    assert.equal(
      missing.status,
      1,
      `exit 0 over a report missing a required suite must not read green:\n${missing.stdout}${missing.stderr}`,
    )
    assert.match(missing.stderr, /NEVER EXECUTED/)

    // (4) STALENESS: a complete report left by an earlier run, and a
    // sentinel that writes nothing this time. The runner must prune the
    // report BEFORE the run and refuse the stale evidence — without the
    // prune, this exact case would read green.
    writeFileSync(reportPath, JSON.stringify(completeReport))
    const stale = run('SKIP')
    assert.equal(
      stale.status,
      1,
      `a stale report must not be graded as this run's evidence:\n${stale.stdout}${stale.stderr}`,
    )
    assert.match(stale.stderr, /missing or unreadable/)
    assert.match(stale.stdout, /h2a-runtime\s+failed/)
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})


test('C9 A01/A03/A04: effective config and versioned test inventory are mandatory', () => {
  assert.deepEqual(configContractFailures(RUNTIME_CONFIG, 'runtime'), [])
  assert.deepEqual(configContractFailures(readFileSync(resolve(REPO_ROOT, 'packages/track/vitest.config.ts'), 'utf8'), 'track'), [])
  const inventory = readInventory(REPO_ROOT)
  assert.deepEqual(declarationFailures(REPO_ROOT, inventory), [])
  assert.deepEqual(inventoryFailures(REPO_ROOT, inventory, [...listRuntimeSuiteFiles(), ...listNodeTrackSuiteFiles()]), [])
  assert.strictEqual(STEPS.find((step) => step.id === 'tests').verifyExecution, verifyNodeTrackExecution)
  assert.strictEqual(STEPS.find((step) => step.id === 'h2a-runtime').verifyExecution, verifyRuntimeExecution)
  if (readTrainRequirements(REPO_ROOT).titles.length) {
    assert.ok(verifyRuntimeExecution({ testResults: [] }, listRuntimeSuiteFiles())
      .some((failure) => failure.includes('normative scenario absent or not passed')),
      'the production verifier must still enforce the integrated train scenarios')
  }
  for (const id of ['tests', 'h2a-runtime']) assert.equal(STEPS.find((step) => step.id === id).invocationEvidence, true, `${id} evidence must belong to its own invocation`)
  const source = readFileSync(resolve(REPO_ROOT, 'scripts/run-tests.mjs'), 'utf8')
  assert.match(source, /if \(invokedDirectly\) \{\s*main\(\);\s*\}/)
  assert.match(source, /process\.argv\[1\] && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/)
  assert.doesNotMatch(source, /--test-name-pattern|--test-skip-pattern|--test-only|--passWithNoTests/)
  assert.ok(source.includes('--test-reporter=spec') && source.includes('node-evidence-reporter.mjs'))
})

test('C9 A04: execute the effective Node/Track entry and observe both required suites', () => {
  observeNodeTrackEntry(readFileSync(resolve(REPO_ROOT, 'scripts/run-tests.mjs'), 'utf8'), REPO_ROOT)
})
