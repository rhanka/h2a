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
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { discoverTestFiles, RUNNER_TEST_FILE } from '../../../scripts/run-tests.mjs'

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
    })),
    [
      {
        id: 'build',
        ...expectedBuild,
        requiresBuild: false,
        inconclusiveExitCode: null,
      },
      {
        id: 'check:focus-vendor',
        command: process.execPath,
        args: ['scripts/check-focus-vendor.mjs'],
        shell: false,
        requiresBuild: false,
        inconclusiveExitCode: 2,
      },
      {
        id: 'check:focus-app',
        command: process.execPath,
        args: ['scripts/check-focus-app.mjs'],
        shell: false,
        requiresBuild: false,
        inconclusiveExitCode: null,
      },
      {
        id: 'lint:focus-imports',
        command: process.execPath,
        args: ['apps/focus/scripts/check-imports.mjs'],
        shell: false,
        requiresBuild: false,
        inconclusiveExitCode: null,
      },
      {
        id: 'tests',
        command: process.execPath,
        args: ['scripts/run-tests.mjs'],
        shell: false,
        requiresBuild: true,
        inconclusiveExitCode: null,
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
      'npm ci',
      'node --test packages/h2a/test/run-test-gates.test.js',
      'node scripts/run-test-gates.mjs',
    ],
    'the dedicated job must verify the runner and then execute its real entrypoint',
  )
})

test('the runner test is not discovered through the runner it verifies', () => {
  assert.ok(!discoverTestFiles().includes(RUNNER_TEST_FILE))
})
