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
 *   - Each step's own stdout/stderr is inherited verbatim, in order, unmodified.
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
 * `npm test` still exits non-zero whenever any one of them fails.
 *
 * THIS FILE IS TESTED OUTSIDE ITSELF. CI invokes
 * `packages/h2a/test/run-test-gates.test.js` directly in its own step; discovery in
 * `run-tests.mjs` deliberately excludes that file. Otherwise this runner would
 * interpret the exit code of the tests that verify it, and a one-line verdict
 * mutation could make both itself and its broken tests look green.
 *
 * CEILING: this breaks the circularity for the workflow, not for `npm test`.
 * `npm test` delegates its verdict to this runner, so a mutated runner can still
 * green its own failed self-test. The separate direct CI step carries the entire
 * guarantee. This excluded self-test asserts scripts.test; the discovered
 * test-gate-wiring.test.js asserts the CI and release wiring that invokes this
 * file, so each side guards the other's otherwise-unreachable failure mode.
 *
 * The raw exit-code column and the repeated non-passing list below are diagnostics,
 * not guarantees. They help a human spot a contradictory report, but only the
 * separate direct CI test enforces that the reporter cannot grade its own exam.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TEST_DIRS, discoverTestFiles } from './run-tests.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

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
      }
    }
  }
  walk(root, '')
  return { total, underRuntimeSrc }
}

/**
 * The scope disclosure, COMPUTED AT RUNTIME so it cannot rot into a stale boast.
 *
 * An unquantified hedge next to a confident green reads as boilerplate: "not every
 * test file" is equally true of 99% coverage. So state the actual numbers, name the
 * directories discovery looks in, and say plainly that the excluded files are not
 * even type-checked — otherwise a reader may reasonably assume `tsc` at least sees
 * them. It does not: `packages/h2a-runtime/tsconfig.json` excludes every `*.test.ts`,
 * and that package has no `scripts` block wiring vitest into anything.
 */
export function describeScope() {
  let ran
  try {
    ran = discoverTestFiles().length
  } catch {
    ran = 0
  }
  const { total, underRuntimeSrc } = countTestTsFiles(REPO_ROOT)
  return (
    '\n  scope of this run (counted now, not hard-coded):\n' +
    `    ran         ${ran} *.test.js files, discovered in ${TEST_DIRS.join(' and ')}\n` +
    `    NOT run     ${total} *.test.ts files, ${underRuntimeSrc} of them under packages/h2a-runtime/src\n` +
    '    Those *.test.ts files are neither executed NOR type-checked: h2a-runtime\n' +
    "    tsconfig excludes every *.test.ts, and no npm script runs vitest.\n" +
    '    A green below means these steps passed. It says nothing about that code.\n'
  )
}

/**
 * Run every step and return the process exit code. Never calls process.exit, so it
 * can be driven from tests with synthetic steps.
 */
export function runGates(steps, options = {}) {
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

    const status = verdictFor(code, step)
    if (status !== PASSED && step.id === 'build') buildFailed = true
    results.push({ id: step.id, status, code, ms, timeoutMs })
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
