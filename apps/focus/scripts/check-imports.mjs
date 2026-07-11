#!/usr/bin/env node
// import-lint (spec 2026-07-11-unified-report-presentation-layer §3/§4) — forbid BARREL value-imports of
// `@sentropic/track` anywhere under apps/focus/src.
//
// WHY. The `@sentropic/track` barrel (`.` export) `export *`s node-only surfaces (`cli`/`mcp`/`events`,
// which pull `fs`/`child_process`/the MCP SDK). A STATIC value-import of the barrel from this SvelteKit app
// would poison the Vite/SSR bundle. Only the PURE subpath `@sentropic/track/report/friendly` (module-level
// pure: it transitively imports only `directive.ts` TYPES) may be statically value-imported. Any other
// `@sentropic/track…` reference must be `import type` (erased) or a runtime dynamic `import()` of the built
// dist by PATH (as `lib/server/report-view.ts` does, deliberately, to keep it out of the static graph).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', 'src')
const ALLOWED_SUBPATH = '@sentropic/track/report/friendly'
const EXTS = new Set(['.ts', '.js', '.mjs', '.svelte'])

/** Recursively list source files under a directory. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (EXTS.has(extname(p))) out.push(p)
  }
  return out
}

// A STATIC import statement (`import … from '<spec>'`) OR `export … from '<spec>'`. We inspect the leading
// keyword to tell a type-only import (`import type …` / `export type …`, erased) from a value import.
const STATIC_RE = /(^|\n)\s*(import|export)(\s+type\b)?\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g

const violations = []
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(STATIC_RE)) {
    const isType = m[3] !== undefined // `import type` / `export type`
    const spec = m[4]
    if (!spec.startsWith('@sentropic/track')) continue
    if (spec === ALLOWED_SUBPATH) continue // the pure subpath — value or type, both fine
    if (isType) continue // type-only import of any track surface is erased — safe
    violations.push({ file, spec, snippet: m[0].trim() })
  }
}

if (violations.length > 0) {
  console.error('import-lint: forbidden barrel/value import of @sentropic/track in apps/focus/src.')
  console.error(`Only \`${ALLOWED_SUBPATH}\` may be statically value-imported; use \`import type\` or a`)
  console.error('runtime dynamic import() of the built dist path for anything else.\n')
  for (const v of violations) {
    console.error(`  ${v.file}\n    ${v.snippet}\n      → imports "${v.spec}" (not the pure subpath, not \`import type\`)`)
  }
  process.exit(1)
}

console.log('import-lint: ok — no forbidden @sentropic/track value-imports in apps/focus/src.')
