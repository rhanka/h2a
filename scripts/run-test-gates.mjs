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
 *   - Each step's own stdout/stderr is inherited verbatim, in order, unmodified.
 *   - A final summary names every step with its exit code and status.
 *   - Exit 0 only if ALL steps passed.
 *   - A step that could not meaningfully run because `npm run build` failed is
 *     reported as SKIPPED (because build failed) — never as passed. A step that did
 *     not run must never be reported green: a status must not be wider than its
 *     evidence.
 *
 * Nothing is weakened relative to the old chain: the same five commands run, and
 * `npm test` still exits non-zero whenever any one of them fails.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

/**
 * Spawn `npm run <script>` portably.
 *
 * Plain `spawnSync('npm', …)` with shell:false fails on Windows (npm is `npm.cmd`),
 * and the CI matrix includes windows-latest. When we are ourselves invoked by npm,
 * `npm_execpath` points at npm's own JS entry point, so running it under the current
 * node binary is both portable and shell-free.
 */
function npmRunCommand(script) {
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
 * that need it are attributable), then the three cheap readiness checks, then the
 * test suite.
 *
 * `requiresBuild` marks the steps that cannot produce a meaningful verdict without
 * the root build, and is deliberately narrow:
 *   - `tests` runs `packages/h2a/test/*.test.js`, which import the COMPILED `dist/`
 *     output of `tsc -b`. Without the build its result is meaningless.
 *   - `check:focus-vendor` builds `packages/focus` itself (see focus-vendor-lib.mjs),
 *     so it does not depend on the root build.
 *   - `check:focus-app` only hashes `apps/focus/` sources and the committed artifact.
 *   - `lint:focus-imports` is a static lint over `apps/focus/src`.
 * Those last three therefore still run — and still report honestly — even if the
 * build is broken.
 */
const STEPS = [
  {
    id: 'build',
    description: 'npm run build (@sentropic/track + tsc -b)',
    ...npmRunCommand('build'),
  },
  {
    id: 'check:focus-vendor',
    description: 'vendored focus render-core is in phase',
    command: process.execPath,
    args: ['scripts/check-focus-vendor.mjs'],
  },
  {
    id: 'check:focus-app',
    description: 'packaged Focus artifact matches its source',
    command: process.execPath,
    args: ['scripts/check-focus-app.mjs'],
  },
  {
    id: 'lint:focus-imports',
    description: 'no forbidden @sentropic/track value-imports in apps/focus/src',
    command: process.execPath,
    args: ['apps/focus/scripts/check-imports.mjs'],
  },
  {
    id: 'tests',
    description: 'node --test over the discovered suite',
    command: process.execPath,
    args: ['scripts/run-tests.mjs'],
    requiresBuild: true,
  },
]

const PASSED = 'passed'
const FAILED = 'failed'
const SKIPPED = 'skipped-because-build-failed'

const results = []
let buildFailed = false

for (const step of STEPS) {
  if (step.requiresBuild && buildFailed) {
    process.stdout.write(
      `\n=== ${step.id} — SKIPPED: the build failed, so this step cannot produce a meaningful verdict ===\n`,
    )
    results.push({ id: step.id, status: SKIPPED, code: null, ms: 0 })
    continue
  }

  process.stdout.write(`\n=== ${step.id} — ${step.description} ===\n`)
  // MONOTONIC, not Date.now(). A wall clock can jump (NTP correction, suspend,
  // a container clock resync) and an elapsed time computed by subtracting two
  // wall-clock readings then reports nonsense — this runner once printed a
  // 27-second test step as "27121.0s" for exactly that reason. A reported
  // number that a clock jump can falsify is not a measurement.
  const startedAt = performance.now()
  const run = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: step.shell ?? false,
  })
  const ms = performance.now() - startedAt

  let code
  if (run.error) {
    process.stderr.write(`run-test-gates: ${step.id} could not be spawned: ${run.error.message}\n`)
    code = 'spawn-error'
  } else if (run.signal) {
    code = `signal:${run.signal}`
  } else {
    code = run.status ?? 1
  }

  const status = code === 0 ? PASSED : FAILED
  if (status === FAILED && step.id === 'build') buildFailed = true
  results.push({ id: step.id, status, code, ms })
}

const width = Math.max(...results.map((r) => r.id.length))
process.stdout.write('\n=== npm test summary ===\n')
for (const r of results) {
  const code = r.status === SKIPPED ? 'not run' : `exit ${r.code}`
  const time = r.status === SKIPPED ? '' : ` (${(r.ms / 1000).toFixed(1)}s)`
  process.stdout.write(`  ${r.id.padEnd(width)}  ${r.status.padEnd(28)} ${code}${time}\n`)
}

const failed = results.filter((r) => r.status === FAILED)
const skipped = results.filter((r) => r.status === SKIPPED)

// This summary reports STEPS, not coverage. `tests` covers exactly the files
// scripts/run-tests.mjs discovers, which is a subset of the repository's test
// files; other tests exist that this run neither executes nor type-checks. Say
// what ran and let what did not run stay visible — do not print a line that
// could be read as "everything is covered".
process.stdout.write(
  '\n  scope: these are step results, not a coverage claim. The tests step covers\n' +
    '  only the files scripts/run-tests.mjs discovers, not every test file in the repo.\n',
)

if (failed.length === 0 && skipped.length === 0) {
  process.stdout.write(`\nAll ${results.length} steps passed.\n`)
  process.exit(0)
}

if (failed.length > 0) {
  process.stderr.write(`\nFAILED steps (${failed.length}): ${failed.map((r) => r.id).join(', ')}\n`)
}
if (skipped.length > 0) {
  process.stderr.write(
    `NOT RUN because the build failed (${skipped.length}): ${skipped.map((r) => r.id).join(', ')}\n` +
      '  These have NO verdict. Fix the build and re-run before treating them as green.\n',
  )
}
process.exit(1)
