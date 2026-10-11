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
      {
        id: 'h2a-runtime',
        command: 'node_modules/.bin/vitest',
        args: ['run', '--config', 'packages/h2a-runtime/vitest.config.ts'],
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
function sentinelRunnerSource({ brokenId, dropInLoop, dropAtEntry }) {
  let source = RUNNER_SOURCE
  const beforeImport = source
  source = source.replace(
    "import { TEST_DIRS, discoverTestFiles } from './run-tests.mjs'",
    "const TEST_DIRS = ['(trust-root sentinel stub)']\nconst discoverTestFiles = () => []",
  )
  assert.notEqual(source, beforeImport, 'the import splice must apply to the real runner source')
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
${STEPS.map((step) => `  ${JSON.stringify({
    id: step.id,
    description: `sentinel command for the real gate ${step.id}`,
    command: process.execPath,
    args: sentinelArgs(step.id),
    timeoutMs: 30000,
  })}`).join(',\n')}
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
