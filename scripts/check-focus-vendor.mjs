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
 * Exit 0 = in phase; exit 1 = drift (prints the exact missing/extra/differing
 * files and the remediation command).
 */
import { buildFocusDist, compareTrees, DIST_DIR, VENDOR_DIR, REPO_ROOT } from './focus-vendor-lib.mjs'
import { relative } from 'node:path'

buildFocusDist()

const rel = (p) => relative(REPO_ROOT, p)
const { equal, missing, extra, differ } = compareTrees(DIST_DIR, VENDOR_DIR)

if (equal) {
  process.stdout.write(
    `focus-vendor OK: ${rel(VENDOR_DIR)} is byte-identical to a fresh build of packages/focus\n`,
  )
  process.exit(0)
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
process.exit(1)
