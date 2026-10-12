#!/usr/bin/env node
/**
 * `npm test` entry point: run EVERY gate, report ALL failures, exit non-zero if any failed.
 *
 * WHY THIS EXISTS. `npm test` used to be a five-member `&&` chain:
 *
 *   npm run build && check-focus-vendor && check-focus-app && check-imports && run-tests
 *
 * `check-focus-app.mjs` is a PACKAGING-READINESS gate: it asserts that the committed
 * artifact under `packages/h2a/focus-app/` was built from the current `apps/focus/`
 * source. Merge 879ce8c (PR #20) changed `apps/focus/src/` without rebuilding the
 * artifact, so that gate started exiting 1 — and because it sat THIRD in an `&&`
 * chain, `run-tests.mjs` (fifth) never ran. `npm test` executed zero tests for
 * twelve merges while reporting only a complaint about artifact publishability.
 *
 * A gate about whether an artifact is PUBLISHABLE must never decide whether tests RUN.
 * Reordering alone would not fix that: it would just move the blind spot, since any
 * earlier failure in an `&&` chain still suppresses every later member. So this runner
 * removes the suppression itself rather than reshuffling it.
 *
 * CONTRACT.
 *   - Every step runs, even if an earlier step failed.
 *   - Every step is REPORTED, even if running it threw.
 *   - Every step handed to the runner must RECEIVE a verdict: a step dropped
 *     from the results (the round-3 loop-bypass shape) or removed from the
 *     list before the loop (the round-4 entry-filter shape) fails the run by
 *     name.
 *   - Each step's own stdout/stderr is inherited verbatim, in order, unmodified.
 *   - A step wired with an execution proof must OBSERVE its required tests
 *     executing: exit 0 over a missing, stale or holed report is reported as
 *     `failed` (execution-not-proven), never as a pass.
 *   - A final summary names every step with its exit code and status.
 *   - Exit 0 only if ALL steps passed.
 *   - A step that could not produce a verdict is named as such — never as passed:
 *       `skipped-because-build-failed`     the build failed, so it never ran;
 *       `timed-out`                        the step did not return before its
 *                                          explicit timeout;
 *       `inconclusive-could-not-build`     it ran, but its own prerequisite build
 *                                          failed, so it compared nothing.
 *     Both still force a non-zero exit. A status must never be wider than its
 *     evidence: reporting an un-run step as green manufactures assurance out of an
 *     absence, which is the very defect this runner exists to remove.
 *
 * Nothing is weakened relative to the old chain: the same five commands run, and
 * `npm test` still exits non-zero whenever any one of them fails. The sixth
 * step, `h2a-runtime`, CLOSES a discovery hole instead: until it existed, the
 * TypeScript suites of packages/h2a-runtime (native-terminal, session-lease,
 * proc-cpu, ...) were executed by NO gate at all — a green `npm test` said
 * nothing about them while four broken versions shipped to npm.
 *
 * THIS FILE IS TESTED OUTSIDE ITSELF. CI's independently requireable
 * `npm-test-trust-root` job invokes `packages/h2a/test/run-test-gates.test.js`
 * directly, then executes this production entrypoint without going through
 * package.json. The direct test pins package wiring, the workflow job, and this
 * file's exact production commands; discovery in `run-tests.mjs` deliberately
 * excludes it. Otherwise this runner would interpret the exit code of the tests
 * that verify it, and a one-line verdict mutation could make both itself and its
 * broken tests look green.
 *
 * The raw exit-code column and the repeated non-passing list below are diagnostics,
 * not guarantees. They help a human spot a contradictory report, but only the
 * separate direct CI test enforces that the reporter cannot grade its own exam.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TEST_DIRS, discoverTestFiles } from './run-tests.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const RUNTIME_SRC = resolve(REPO_ROOT, 'packages', 'h2a-runtime', 'src')
// SPEC 0.98.5 R8 (round-7 review finding P1): the h2a-runtime gate must prove
// EXECUTION, not discovery. The pinned vitest config writes its JSON report
// here (tmp/ is gitignored); the path is pinned BY NAME on both sides — this
// constant and the config's outputFile — so config and runner cannot drift
// apart without the trust root going red.
export const RUNTIME_EXECUTION_REPORT = resolve(REPO_ROOT, 'tmp', 'h2a-runtime-vitest-report.json')

export const PASSED = 'passed'
export const FAILED = 'failed'
export const SKIPPED = 'skipped-because-build-failed'
export const TIMED_OUT = 'timed-out'
export const INCONCLUSIVE = 'inconclusive-could-not-build'

const MINUTE_MS = 60 * 1000
const DEFAULT_STEP_TIMEOUT_MS = 3 * MINUTE_MS

/**
 * Spawn `npm run <script>` portably.
 *
 * Plain `spawnSync('npm', …)` with shell:false fails on Windows (npm is `npm.cmd`),
 * and the CI matrix includes windows-latest. When we are ourselves invoked by npm,
 * `npm_execpath` points at npm's own JS entry point, so running it under the current
 * node binary is both portable and shell-free.
 */
export function npmRunCommand(script) {
  const execPath = process.env.npm_execpath
  if (execPath && /\.(c?js|mjs)$/i.test(execPath)) {
    return { command: process.execPath, args: [execPath, 'run', script] }
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', script],
    shell: process.platform === 'win32',
  }
}

/**
 * The gates, in a deliberate order: the build first (so that failures in the steps
 * that need it are attributable), then the three readiness checks, then the suite.
 *
 * `requiresBuild` marks the steps that cannot produce a meaningful verdict without
 * the ROOT build, and is deliberately narrow:
 *   - `tests` runs `packages/h2a/test/*.test.js`, which import the COMPILED `dist/`
 *     output of `tsc -b`. Without the build its result is meaningless.
 *   - `check:focus-app` only hashes `apps/focus/` sources and the committed artifact.
 *   - `lint:focus-imports` is a static lint over `apps/focus/src`.
 *
 * `check:focus-vendor` is the subtle one, and an earlier revision of this comment got
 * it wrong by calling it build-independent. It does NOT depend on the root `tsc -b`,
 * but it is not independent of building either: `buildFocusDist()` runs
 * `npm run build -w @sentropic/track` itself, so a broken track build makes it fail.
 * It must therefore keep running when the root build fails for an unrelated reason
 * (it still yields a real verdict then), while distinguishing "I could not build"
 * from "the vendor drifted" on its own — which is what `inconclusiveExitCode` below
 * consumes. Marking it `requiresBuild` would hide a check that usually still works;
 * leaving it undifferentiated let a broken build masquerade as vendor drift, which is
 * a misattributed failure of exactly the kind this runner exists to remove.
 */
export const STEPS = [
  {
    id: 'build',
    description: 'npm run build (@sentropic/track + tsc -b)',
    ...npmRunCommand('build'),
    timeoutMs: 3 * MINUTE_MS,
  },
  {
    id: 'check:focus-vendor',
    description: 'vendored focus render-core is in phase',
    command: process.execPath,
    args: ['scripts/check-focus-vendor.mjs'],
    timeoutMs: 3 * MINUTE_MS,
    // check-focus-vendor.mjs exits 2 when its prerequisite build failed and it
    // therefore compared nothing. That is not drift and must not be reported as one.
    inconclusiveExitCode: 2,
  },
  {
    id: 'check:focus-app',
    description: 'packaged Focus artifact matches its source',
    command: process.execPath,
    args: ['scripts/check-focus-app.mjs'],
    timeoutMs: 2 * MINUTE_MS,
  },
  {
    id: 'lint:focus-imports',
    description: 'no forbidden @sentropic/track value-imports in apps/focus/src',
    command: process.execPath,
    args: ['apps/focus/scripts/check-imports.mjs'],
    timeoutMs: MINUTE_MS,
  },
  {
    id: 'tests',
    description: 'node --test over the discovered suite',
    command: process.execPath,
    args: ['scripts/run-tests.mjs'],
    requiresBuild: true,
    timeoutMs: 4 * MINUTE_MS,
  },
  {
    id: 'h2a-runtime',
    description: 'TypeScript suites of packages/h2a-runtime (src/**/*.test.ts) via vitest',
    // SPEC 0.98.5 R8.1 pins this command EXACTLY; the trust-root test
    // (packages/h2a/test/run-test-gates.test.js) asserts the exact string, so
    // any silent replacement — an inert wrapper, a redirect to a lighter
    // config, a dropped `--config` — makes the independent gate go red.
    // Relative path + no PATH lookup: run from REPO_ROOT, node_modules/.bin is
    // where `npm ci` puts vitest, and a missing binary is a reported
    // spawn-error (a FAILED verdict), never a silent skip.
    command: 'node_modules/.bin/vitest',
    args: ['run', '--config', 'packages/h2a-runtime/vitest.config.ts'],
    requiresBuild: true,
    timeoutMs: 10 * MINUTE_MS,
    // SPEC 0.98.5 R8 (round-7 finding P1): exit 0 from vitest is not evidence
    // that the required suites ran — a config-level testNamePattern/exclude
    // makes vitest exit 0 over tests that never executed. The step therefore
    // carries its own execution proof: the report the pinned config writes is
    // pruned before the run (freshness) and verified after it (identity and
    // executed-count per required suite). A hole in the proof fails the step
    // even when the command exited 0.
    reportPath: RUNTIME_EXECUTION_REPORT,
    requiredFiles: listRuntimeSuiteFiles,
    verifyExecution: verifyRuntimeExecution,
  },
]

/** Turn a spawnSync result into a reportable exit code. */
export function classifyRun(run) {
  if (run.error?.code === 'ETIMEDOUT') return TIMED_OUT
  if (run.error) return 'spawn-error'
  if (run.signal) return `signal:${run.signal}`
  return run.status ?? 1
}

/**
 * The process exit code for a set of results. Exit 0 requires that EVERY step
 * passed — stated positively, on purpose.
 *
 * The tempting form is to enumerate the bad outcomes:
 *   if (failed.length === 0 && skipped.length === 0 && inconclusive.length === 0) return 0
 * That is one deletion away from a false green: drop a term and a whole category of
 * non-verdict silently becomes acceptable. It also fails OPEN for any status added
 * later, since a new status nobody remembered to enumerate would count as fine.
 *
 * `every(status === PASSED)` inverts that. Anything that is not an observed pass —
 * a failure, an un-run step, an inconclusive one, or a status invented next year —
 * fails closed by construction, with no list to forget to update. An empty result
 * set is likewise not a pass: nothing observed is not the same as nothing wrong.
 */
export function exitCodeFor(results) {
  if (!Array.isArray(results) || results.length === 0) return 1
  return results.every((r) => r.status === PASSED) ? 0 : 1
}

/** The verdict for a code, honouring a step's declared inconclusive code. */
export function verdictFor(code, step) {
  if (code === 0) return PASSED
  if (code === TIMED_OUT) return TIMED_OUT
  if (step && step.inconclusiveExitCode !== undefined && code === step.inconclusiveExitCode) {
    return INCONCLUSIVE
  }
  return FAILED
}

function normalizePath(p) {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/**
 * The REQUIRED runtime suite set: every *.test.ts under
 * packages/h2a-runtime/src, enumerated from the FILESYSTEM (never from a list
 * that can rot). A read failure yields an empty set on purpose: the verifier
 * below then fails closed — "the required set could not be enumerated" —
 * instead of grading an unknown scope as proven.
 */
export function listRuntimeSuiteFiles() {
  const files = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(join(dir, entry.name))
      } else if (entry.name.endsWith('.test.ts')) {
        files.push(normalizePath(join(dir, entry.name)))
      }
    }
  }
  walk(RUNTIME_SRC)
  return files.sort()
}

/**
 * Static skip markers: a suite file that DECLARES its own skips. The runtime
 * suites carry committed, review-sanctioned skips — platform-conditional
 * `describe.skipIf(process.platform !== "linux")`, tool-availability
 * `skipIf(tmux/cc)`, `ctx.skip`, and two tracked-debt unconditional ones —
 * so a skipped file is tolerated ONLY when its own source carries such a
 * marker. A skip in a file with NO marker is a silent removal: the exact
 * shape this gate exists to reject. A file whose source cannot be read
 * counts as unmarked (fail closed).
 */
const STATIC_SKIP_MARKERS = [
  /\.skip(?:If)?\s*\(/,
  /\.todo\s*\(/,
  /\.fixme\s*\(/,
  /\bctx\.skip\s*\(/,
  /\.runIf\s*\(/,
  /\bx(?:it|test|describe)\s*\(/,
]

function fileDeclaresSkips(file) {
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    return false
  }
  return STATIC_SKIP_MARKERS.some((marker) => marker.test(source))
}

/**
 * The EXECUTION proof of the h2a-runtime gate. Discovery — vitest being
 * handed the right config — proves nothing about what actually ran: the
 * round-7 review added `testNamePattern: "^C7_NO_TEST_HAS_THIS_NAME$"` to
 * the pinned config and the runner stayed green at exit 0 while every native
 * test silently became "ignored". This function grades the report the run
 * just produced, by identity and executed count per required suite, and
 * returns a failure for every hole:
 *
 *   - report missing or unreadable        no evidence at all;
 *   - required set empty/unenumerable     no scope, so no proof possible;
 *   - a required file ABSENT from the     an exclude/include edit or a cold
 *     report                               path — the file never ran;
 *   - a reported file OUTSIDE the         the report does not correspond
 *     required set                        to the pinned discovery;
 *   - an assertion whose status is        a skip, a filter, a todo — a
 *     neither passed nor failed, in a     required test silently not run
 *     file with NO declared skip marker   (sanctioned, declared skips in
 *                                          marked files are the only
 *                                          tolerance);
 *   - a required file with ZERO executed  the whole suite was filtered away
 *     tests (unmarked file)               while its source declares no skip;
 *   - non-integer or self-inconsistent    a report that lies about its own
 *     summary counts                      totals is not evidence.
 *
 * Exit 0 from vitest is NOT proof; this list empty is.
 */
export function verifyRuntimeExecution(report, requiredFiles) {
  const failures = []
  if (!report || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    return [
      'the execution report is missing or unreadable: with no report there is no evidence that any required test executed',
    ]
  }
  const required = Array.isArray(requiredFiles) ? requiredFiles.map(normalizePath) : []
  if (required.length === 0) {
    return [
      'the required runtime suite set is empty or could not be enumerated: with no required set, no execution can be proven',
    ]
  }
  const byFile = new Map()
  for (const result of report.testResults) {
    if (!result || typeof result.name !== 'string') {
      failures.push('the report contains a file result without a name: it proves nothing')
      continue
    }
    byFile.set(normalizePath(result.name), result)
  }
  for (const file of byFile.keys()) {
    if (!required.includes(file)) {
      failures.push(
        `${file} appears in the report but is not part of the required suite set: ` +
          'the report does not correspond to the pinned discovery',
      )
    }
  }
  for (const requiredFile of required) {
    const result = byFile.get(requiredFile)
    if (!result) {
      failures.push(
        `${requiredFile} was NEVER EXECUTED: it is a required suite and the report contains no run of it ` +
          '(an exclude/include/absence in the effective config shows up exactly here)',
      )
      continue
    }
    const assertions = result.assertionResults
    if (!Array.isArray(assertions)) {
      failures.push(`${requiredFile} carries no per-test results in the report: its tests cannot be accounted for`)
      continue
    }
    const declaredSkips = fileDeclaresSkips(requiredFile)
    let executed = 0
    for (const assertion of assertions) {
      const status = assertion?.status
      if (status === 'passed' || status === 'failed') {
        executed += 1
        continue
      }
      if (declaredSkips) continue
      failures.push(
        `${requiredFile} :: "${assertion?.fullName ?? assertion?.title ?? 'an unnamed test'}" has status ` +
          `"${status ?? 'missing'}": a required test skipped, filtered out, todo'd or otherwise never run must fail ` +
          'the gate — a suite whose own source declares no skip marker cannot lose tests silently ' +
          '(round-7 finding P1: testNamePattern left the native tests "ignored" behind an exit 0)',
      )
    }
    if (executed === 0 && !declaredSkips) {
      failures.push(
        `${requiredFile} executed ZERO tests: every test in it was skipped or filtered away while its source ` +
          'declares no skip marker — discovery is not execution',
      )
    }
  }
  const counts = [
    report.numTotalTests,
    report.numPassedTests,
    report.numFailedTests,
    report.numPendingTests,
    report.numTodoTests,
  ]
  if (counts.some((n) => !Number.isInteger(n))) {
    failures.push(
      'the report does not carry integer total/passed/failed/pending/todo counts: the executed-count proof cannot be evaluated',
    )
  } else if (
    report.numTotalTests !==
    report.numPassedTests + report.numFailedTests + report.numPendingTests + report.numTodoTests
  ) {
    failures.push('the report summary counts do not add up to its own per-test statuses: the report is inconsistent')
  }
  return failures
}


const DIR_PRUNE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'tmp',
  '.svelte-kit',
  '.h2a',
  'coverage',
  '.claude',
])

function countTestTsFiles(root) {
  let total = 0
  let underRuntimeSrc = 0
  let underTrackSrc = 0
  const walk = (dir, rel) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DIR_PRUNE.has(entry.name)) continue
        walk(join(dir, entry.name), `${rel}${entry.name}/`)
      } else if (entry.name.endsWith('.test.ts')) {
        total += 1
        if (rel.startsWith('packages/h2a-runtime/src/')) underRuntimeSrc += 1
        if (rel.startsWith('packages/track/src/')) underTrackSrc += 1
      }
    }
  }
  walk(root, '')
  return { total, underRuntimeSrc, underTrackSrc }
}

/**
 * The scope disclosure, COMPUTED AT RUNTIME so it cannot rot into a stale boast.
 *
 * An unquantified hedge next to a confident green reads as boilerplate: "not every
 * test file" is equally true of 99% coverage. So state the actual numbers, name the
 * directories discovery looks in, and say plainly what remains outside every gate:
 * *.test.ts files outside h2a-runtime and track are not even type-checked —
 * otherwise a reader may reasonably assume `tsc` at least sees them.
 */
export function describeScope() {
  let ran
  try {
    ran = discoverTestFiles().length
  } catch {
    ran = 0
  }
  const { total, underRuntimeSrc, underTrackSrc } = countTestTsFiles(REPO_ROOT)
  const notRun = Math.max(total - underRuntimeSrc - underTrackSrc, 0)
  return (
    '\n  scope of this run (counted now, not hard-coded):\n' +
    `    ran         ${ran} *.test.js files, discovered in ${TEST_DIRS.join(' and ')}\n` +
    '    ran         ' +
    `${underRuntimeSrc} *.test.ts files under packages/h2a-runtime/src, via the h2a-runtime step\n` +
    `    ran         ${underTrackSrc} *.test.ts files under packages/track/src, via the Track vitest suite\n` +
    `    NOT run     ${notRun} *.test.ts files elsewhere in the tree\n` +
    '    h2a-runtime tsconfig still excludes every *.test.ts from type-checking;\n' +
    '    the h2a-runtime step EXECUTES them but proves no type-level property.\n'
  )
}

/**
 * Run every step and return the process exit code. Never calls process.exit, so it
 * can be driven from tests with synthetic steps.
 */
export function runGates(steps, options = {}) {
  // Round-4 review finding F01: the round-3 guard below compared the results
  // against the `steps` PARAMETER, so reassigning it on the very first line
  // (`steps = steps.filter(...)`) laundered the dropped step out of the very
  // list the guard checks against. A module is strict-mode code: `arguments`
  // keeps the argument values AS PASSED, independent of any later parameter
  // reassignment, so the verdict-completeness guard is computed against the
  // list the CALLER handed in — which no statement inside this function,
  // including a first-line filter, can rewrite.
  const handedSteps = Array.isArray(arguments[0]) ? [...arguments[0]] : []
  const write = options.write ?? ((s) => process.stdout.write(s))
  const writeErr = options.writeErr ?? ((s) => process.stderr.write(s))

  // a10: an empty work list must never yield a green. "All 0 steps passed." is the
  // incident's own shape — a vacuous pass produced by having nothing to do.
  if (!Array.isArray(steps) || steps.length === 0) {
    writeErr('run-test-gates: REFUSING to report success with an empty step list.\n')
    return 1
  }

  const results = []
  let buildFailed = false

  for (const step of steps) {
    if (step.requiresBuild && buildFailed) {
      write(`\n=== ${step.id} — SKIPPED: the build failed, so this step cannot produce a meaningful verdict ===\n`)
      results.push({ id: step.id, status: SKIPPED, code: null, ms: 0 })
      continue
    }

    write(`\n=== ${step.id} — ${step.description} ===\n`)
    // Freshness of the execution proof: prune the step's report BEFORE the
    // run, so a file left by an earlier invocation can never be graded as
    // this run's evidence.
    if (typeof step.reportPath === 'string') {
      try {
        rmSync(step.reportPath, { force: true })
      } catch {
        // A prune failure surfaces below: the verify then cannot read the
        // report and fails closed.
      }
    }
    // MONOTONIC, not Date.now(). A wall clock can jump (NTP correction, suspend,
    // a container clock resync) and an elapsed time computed by subtracting two
    // wall-clock readings then reports nonsense — this runner once printed a
    // 27-second test step as "27121.0s" for exactly that reason. A reported
    // number that a clock jump can falsify is not a measurement.
    const startedAt = performance.now()
    const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
    let code
    try {
      const run = spawnSync(step.command, step.args, {
        cwd: options.cwd ?? REPO_ROOT,
        stdio: options.stdio ?? 'inherit',
        shell: step.shell ?? false,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      })
      code = classifyRun(run)
      if (code === 'spawn-error') {
        writeErr(`run-test-gates: ${step.id} could not be spawned: ${run.error.message}\n`)
      }
    } catch (error) {
      // a5: a malformed step (bad args, bad option types) used to escape as an
      // uncaught TypeError, abandoning the summary entirely and never mentioning
      // the later steps. The contract is that EVERY step is reported, so a throw
      // becomes a reportable verdict rather than an exit path.
      code = 'threw'
      writeErr(`run-test-gates: ${step.id} threw: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    const ms = performance.now() - startedAt

    let status = verdictFor(code, step)

    // The execution proof: a step wired with one must OBSERVE its required
    // tests executing. A green exit code alone is not evidence (round-7
    // finding P1), so the proof is deliberately the LAST word on a pass — it
    // can only DOWNGRADE a pass to a failure, never upgrade anything.
    if (status === PASSED && typeof step.verifyExecution === 'function') {
      let report = null
      try {
        report = JSON.parse(readFileSync(step.reportPath, 'utf8'))
      } catch {
        report = null
      }
      let required = null
      try {
        required = typeof step.requiredFiles === 'function' ? step.requiredFiles() : null
      } catch {
        required = null
      }
      let proofFailures
      try {
        proofFailures = step.verifyExecution(report, required)
      } catch (error) {
        proofFailures = [
          `the execution proof itself threw: ${error instanceof Error ? error.message : String(error)}`,
        ]
      }
      if (!Array.isArray(proofFailures)) {
        proofFailures = ['the execution proof returned no verdict list']
      }
      if (proofFailures.length > 0) {
        status = FAILED
        code = 'execution-not-proven'
        for (const proofFailure of proofFailures.slice(0, 5)) {
          writeErr(`run-test-gates: ${step.id} exit 0 is NOT a pass — execution not proven: ${proofFailure}\n`)
        }
        if (proofFailures.length > 5) {
          writeErr(`run-test-gates: ${step.id} execution proof: ...and ${proofFailures.length - 5} more holes\n`)
        }
      }
    }

    if (status !== PASSED && step.id === 'build') buildFailed = true
    results.push({ id: step.id, status, code, ms, timeoutMs })
  }

  // Round-3 review finding N02 + round-4 finding F01: a `continue` targeting
  // one step id inside the loop, or a `steps = steps.filter(...)` reassignment
  // BEFORE it, dropped a step from the results entirely — a broken runtime
  // suite was never executed and the run still exited 0. A step handed to
  // this runner must RECEIVE a verdict: absence from the results is not
  // evidence about the step, it is a hole shaped exactly like the step it
  // erased. Checked against the ids of the steps ACTUALLY handed in (the
  // entry snapshot above, immune to reassignment), so the real ids stay in
  // the execution proof.
  const dropped = handedSteps
    .map((step, index) => ({ id: step?.id, observed: results[index]?.id }))
    .filter((entry) => entry.observed !== entry.id)
  if (dropped.length > 0) {
    writeErr(
      `run-test-gates: REFUSING to report success: ${dropped.map((d) => d.id).join(', ')} ` +
        'were handed to the runner but received no verdict. A step dropped without a verdict is the ' +
        'bypass shape of the round-3 review: its suite never ran, and its absence is not evidence.\n',
    )
    return 1
  }

  const width = Math.max(...results.map((r) => r.id.length))
  const statusWidth = Math.max(...results.map((r) => r.status.length))
  write('\n=== npm test summary ===\n')
  for (const r of results) {
    // Diagnostic #1: print the raw exit code next to every returned verdict. A
    // contradiction ("passed exit 1") is useful evidence for a human, but it is
    // not an enforcement mechanism; the direct CI test above is that mechanism.
    const code = r.status === SKIPPED
      ? 'not run'
      : r.status === TIMED_OUT
        ? `no exit (timed out after ${r.timeoutMs}ms)`
        : `exit ${r.code}`
    const time = r.status === SKIPPED ? '' : ` (${(r.ms / 1000).toFixed(1)}s)`
    write(`  ${r.id.padEnd(width)}  ${r.status.padEnd(statusWidth)}  ${code}${time}\n`)
  }

  const failed = results.filter((r) => r.status === FAILED)
  const skipped = results.filter((r) => r.status === SKIPPED)
  const timedOut = results.filter((r) => r.status === TIMED_OUT)
  const inconclusive = results.filter((r) => r.status === INCONCLUSIVE)

  write(options.scope ?? describeScope())

  if (exitCodeFor(results) === 0) {
    write(`\nAll ${results.length} steps passed.\n`)
    return 0
  }

  // Diagnostic #2: name every non-passing step a second time. This makes a report
  // easier to audit, but it is not a guarantee against a mutated reporter.
  if (failed.length > 0) {
    writeErr(`\nFAILED steps (${failed.length}): ${failed.map((r) => r.id).join(', ')}\n`)
  }
  if (inconclusive.length > 0) {
    writeErr(
      `INCONCLUSIVE (${inconclusive.length}): ${inconclusive.map((r) => r.id).join(', ')}\n` +
        '  These could not build their own prerequisite, so they compared nothing.\n' +
        '  This is NOT a finding against what they check. Fix the build to get a verdict.\n',
    )
  }
  if (timedOut.length > 0) {
    writeErr(
      `TIMED OUT (${timedOut.length}): ${timedOut.map((r) => r.id).join(', ')}\n` +
        '  These produced no exit code and therefore no verdict. Fix the hang and re-run.\n',
    )
  }
  if (skipped.length > 0) {
    writeErr(
      `NOT RUN because the build failed (${skipped.length}): ${skipped.map((r) => r.id).join(', ')}\n` +
        '  These have NO verdict. Fix the build and re-run before treating them as green.\n',
    )
  }
  return 1
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  process.exit(runGates(STEPS))
}
