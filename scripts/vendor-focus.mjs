#!/usr/bin/env node
/**
 * Re-vendor the focus render-core (M2).
 *
 * Builds `packages/focus` and synchronises its compiled `dist/` verbatim into
 * `packages/track/src/focus-vendor/` — the copy that `track focus` imports
 * dynamically. Run this whenever `packages/focus/src` changes; the committed
 * vendor is then proven in phase with the authoritative source.
 *
 *   npm run vendor:focus
 *
 * NO runtime dependency `@sentropic/track -> @sentropic/focus` is introduced:
 * this is a build-time snapshot, not a package link.
 */
import { buildFocusDist, syncVendorFromDist, VENDOR_DIR, REPO_ROOT } from './focus-vendor-lib.mjs'
import { relative } from 'node:path'

buildFocusDist()
const files = syncVendorFromDist()
process.stdout.write(
  `re-vendored ${files.length} files into ${relative(REPO_ROOT, VENDOR_DIR)} from a fresh build of packages/focus\n`,
)
