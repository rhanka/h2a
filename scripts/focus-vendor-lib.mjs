#!/usr/bin/env node
/**
 * Shared helpers for the deterministic focus re-vendor (M2).
 *
 * WHY THIS EXISTS
 * `track focus` renders a decision dossier by dynamically importing a COMPILED
 * copy of the read-only focus render-core that lives at
 * `packages/track/src/focus-vendor/`. `@sentropic/track` MUST NOT depend on
 * `@sentropic/focus` at runtime (focus depends on track => that would be a
 * cycle), so we cannot repoint `track focus` at the package. Instead the
 * package `packages/focus` is the AUTHORITATIVE source and the vendor is a
 * generated, byte-for-byte snapshot of its `tsc` output (`dist/`).
 *
 * This module centralises the build + path + compare logic so the re-vendor
 * script (`vendor-focus.mjs`) and the drift-check (`check-focus-vendor.mjs`)
 * agree on EXACTLY one definition of "the vendor equals a fresh build".
 *
 * DETERMINISM
 * The vendor is `packages/focus/dist` passed through ONE deterministic, pinned
 * transform: the trailing `//# sourceMappingURL=` line is stripped from every
 * emitted `.js`/`.d.ts` (see `stripSourceMappingComment`). Everything else —
 * including the `.js.map`/`.d.ts.map` files — is copied byte-for-byte. `tsc`
 * output is deterministic for a pinned TypeScript version + source + tsconfig,
 * so a fresh build + this transform reproduces the committed bytes exactly.
 * That is what makes the drift-check airtight: any source change that is not
 * re-vendored fails the build instead of drifting silently.
 *
 * WHY STRIP THE sourceMappingURL COMMENT
 * From the vendor location `packages/track/src/focus-vendor/`, a map's
 * `sources: ["../src/…"]` resolves to a path that does not exist (the sources
 * live in `packages/focus/src`, not next to the vendor). Left in place, the
 * `//# sourceMappingURL=` comment makes any source-map-aware loader (vitest,
 * `--enable-source-maps`) emit "Sourcemap points to missing source files"
 * warnings on every run. Stripping the comment — while KEEPING the `.map`
 * files as untouched drift sentinels — reproduces the deliberate, warning-free
 * shape the vendor already shipped, and is exactly reversible.
 */
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..')

/** Authoritative source package that owns the render-core. */
export const FOCUS_DIR = join(REPO_ROOT, 'packages/focus')
/** Fresh `tsc` output of `packages/focus`. */
export const DIST_DIR = join(FOCUS_DIR, 'dist')
/** The vendored snapshot consumed by `track focus` via dynamic import. */
export const VENDOR_DIR = join(REPO_ROOT, 'packages/track/src/focus-vendor')

function run(cmd, args, label) {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // npm is a .cmd shim on Windows; a shell lets spawnSync resolve it there.
    shell: process.platform === 'win32',
  })
  if (res.error) {
    throw new Error(`${label} failed to start: ${res.error.message}`)
  }
  if (res.status !== 0) {
    throw new Error(`${label} exited with code ${res.status}`)
  }
}

/**
 * Build `packages/focus` into `dist/` from scratch, deterministically.
 *
 * `packages/focus` type-depends on `@sentropic/track` (public `.` + `/read`
 * entrypoints), so track's declarations must exist first. `--force` bypasses
 * the incremental `.tsbuildinfo` so the emit is a pure function of the source.
 */
export function buildFocusDist() {
  // 1) track's public .d.ts are focus's compile-time dependency.
  run('npm', ['run', 'build', '-w', '@sentropic/track'], 'build @sentropic/track')
  // 2) fresh, non-incremental focus emit.
  run('npx', ['tsc', '-b', 'packages/focus', '--force'], 'tsc -b packages/focus')
}

/**
 * The vendor bytes for one compiled file. `.js`/`.d.ts` have their trailing
 * `//# sourceMappingURL=…` comment removed; every other file (incl. `.map`) is
 * returned unchanged. Idempotent: applying it to an already-stripped buffer is
 * a no-op, so `compareTrees(distTransform, vendor)` and `syncVendorFromDist`
 * share ONE definition of the vendor shape.
 */
export function expectedVendorBytes(relPath, distBytes) {
  if (!(relPath.endsWith('.js') || relPath.endsWith('.d.ts'))) return distBytes
  // Normalize CRLF→LF: tsc emits the platform's newline (CRLF on Windows CI), so a
  // fresh Windows build otherwise "drifts" from the LF vendor byte-for-byte. Applied to
  // BOTH the compare path and the re-vendor path (this is the single vendor-shape def),
  // so the snapshot is deterministic on every OS. Vendor stays LF (no-op on Linux).
  const text = distBytes.toString('utf8').replace(/\r\n/g, '\n')
  // tsc appends the map comment as the final line (no trailing newline). Remove
  // it and the newline that separated it from the last real line.
  const stripped = text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, '\n')
  return Buffer.from(stripped, 'utf8')
}

/** Recursively list files under `root`, returned as sorted repo-relative-to-root paths. */
export function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) walk(abs)
      else out.push(relative(root, abs).split('\\').join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/**
 * Compare the vendor against the EXPECTED shape derived from a fresh `dist`
 * (fresh build passed through `expectedVendorBytes`). Returns
 * `{ equal, missing, extra, differ }` with paths relative to each root.
 */
export function compareTrees(distRoot, vendorRoot) {
  const expected = new Set(listFiles(distRoot))
  const actual = new Set(listFiles(vendorRoot))
  const missing = [...expected].filter((f) => !actual.has(f)) // in fresh build, not in vendor
  const extra = [...actual].filter((f) => !expected.has(f)) // in vendor, not in fresh build
  const differ = []
  for (const f of expected) {
    if (!actual.has(f)) continue
    // Normalize BOTH sides through the same vendor-shape transform (strips sourceMappingURL
    // + CRLF→LF). The committed vendor is LF, but Windows CI checks it out via git autocrlf
    // as CRLF, so the raw `have` bytes carry CRLF there — normalize it too, else false drift.
    const want = expectedVendorBytes(f, readFileSync(join(distRoot, f)))
    const have = expectedVendorBytes(f, readFileSync(join(vendorRoot, f)))
    if (!want.equals(have)) differ.push(f)
  }
  const equal = missing.length === 0 && extra.length === 0 && differ.length === 0
  return { equal, missing, extra, differ }
}

/**
 * Replace `VENDOR_DIR` with the transformed copy of `DIST_DIR` (see
 * `expectedVendorBytes`). Idempotent: a second run over an in-phase tree
 * reproduces the same bytes.
 */
export function syncVendorFromDist() {
  rmSync(VENDOR_DIR, { recursive: true, force: true })
  for (const rel of listFiles(DIST_DIR)) {
    const bytes = expectedVendorBytes(rel, readFileSync(join(DIST_DIR, rel)))
    const dest = join(VENDOR_DIR, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, bytes)
  }
  return listFiles(VENDOR_DIR)
}
