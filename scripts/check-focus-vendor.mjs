#!/usr/bin/env node
/**
 * Drift-check for the vendored focus render-core (M2 CI gate).
 *
 * Builds `packages/focus` fresh and asserts that its compiled `dist/` is
 * byte-for-byte identical to the committed `packages/track/src/focus-vendor/`.
 * A source change that is not re-vendored (`npm run vendor:focus`) fails HERE
 * instead of drifting silently — that is the whole point.
 *
 *   npm run check:focus-vendor
 *
 * EXIT CODES — a verdict must never be wider than its evidence:
 *   0  in phase: the vendor matches a fresh build.
 *   1  DRIFT: the vendor genuinely differs from a fresh build (prints the exact
 *      missing/extra/differing files and the remediation command).
 *   2  INCONCLUSIVE: the prerequisite build failed, so no comparison was ever
 *      made. `buildFocusDist()` first runs `npm run build -w @sentropic/track`
 *      (focus type-depends on track's declarations); if track does not compile
 *      there is no fresh `dist/` to compare against. Reporting that as drift
 *      would accuse the vendor of being stale on evidence that does not exist —
 *      the vendor may be perfectly in phase. Distinguishing 2 from 1 is the same
 *      discipline as `skipped-because-build-failed` in run-test-gates.mjs, and
 *      it exists because this check was itself caught misattributing a broken
 *      track build as vendor drift.
 */
import { buildFocusDist, compareTrees, DIST_DIR, VENDOR_DIR, REPO_ROOT } from './focus-vendor-lib.mjs'
import { relative } from 'node:path'

export const EXIT_OK = 0
export const EXIT_DRIFT = 1
export const EXIT_INCONCLUSIVE = 2

try {
  buildFocusDist()
} catch (error) {
  process.stderr.write(
    'focus-vendor INCONCLUSIVE: the prerequisite build failed, so the vendor was never compared.\n' +
      `  cause: ${error instanceof Error ? error.message : String(error)}\n` +
      '  This is NOT a drift finding. The vendor may be entirely in phase; this run produced\n' +
      '  no evidence either way. Fix the build, then re-run to obtain a real verdict.\n',
  )
  process.exit(EXIT_INCONCLUSIVE)
}

const rel = (p) => relative(REPO_ROOT, p)
const { equal, missing, extra, differ } = compareTrees(DIST_DIR, VENDOR_DIR)

if (equal) {
  process.stdout.write(
    `focus-vendor OK: ${rel(VENDOR_DIR)} is byte-identical to a fresh build of packages/focus\n`,
  )
  process.exit(EXIT_OK)
}

process.stderr.write(`focus-vendor DRIFT: ${rel(VENDOR_DIR)} != fresh build of packages/focus\n`)
if (missing.length) {
  process.stderr.write(`  present in fresh build but MISSING from vendor (${missing.length}):\n`)
  for (const f of missing) process.stderr.write(`    - ${f}\n`)
}
if (extra.length) {
  process.stderr.write(`  present in vendor but ABSENT from fresh build (${extra.length}):\n`)
  for (const f of extra) process.stderr.write(`    - ${f}\n`)
}
if (differ.length) {
  process.stderr.write(`  DIFFERING contents (${differ.length}):\n`)
  for (const f of differ) process.stderr.write(`    - ${f}\n`)
}
process.stderr.write('  fix: run `npm run vendor:focus` and commit the refreshed vendor\n')
process.exit(EXIT_DRIFT)
