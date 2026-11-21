import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { canonicalPath, isInsideDir, isJournalIdentity, tmpCeilingFor } from '../journal/identity.js'
import { readJournalIndex, type JournalIndexV1 } from '../journal/index-store.js'
import type { State } from '../state/fold.js'
import { trackStateHome } from '../state-home.js'

export interface DesyncFinding {
  kind: 'desync'
  itemId: string
  reason: string
  /** A concrete remediation suggestion (v2.2c). `validate` detects only — it NEVER applies this. */
  hint: string
}

export interface DesyncEvaluationOptions {
  /** Pre-loaded journal index (avoids repeated disk reads when caller already loaded it). */
  index?: JournalIndexV1 | undefined
  /** Environment for resolving `TRACK_STATE_HOME` when `index` is not supplied. */
  env?: NodeJS.ProcessEnv | undefined
  /** True when the journal itself resides outside any repository (under state home). */
  offRepo?: boolean | undefined
  /** Fallback project root for legacy items in an off-repo journal. */
  fallbackRoot?: string | null | undefined
}

export interface DesyncEvaluationResult {
  findings: DesyncFinding[]
  /** Count of markdown references whose owning identity has no recorded project root in the index. */
  unverifiedCount: number
}

/**
 * Decide whether an item `body` is a markdown *file reference* (SPEC §4 round-trip). Returns the
 * resolved path plus whether it exists on disk, or `null` for everything that is NOT a reference —
 * prose, a `.md`-suffixed domain/email, or any body that is not unambiguously a single path.
 *
 * The round-trip rule must also fire on a *missing* file, so existence alone cannot be the gate: for
 * an absent file we still need a syntactic decision "did the author mean a path?". That decision is
 * deliberately CONSERVATIVE — precision over recall — because the reported defect was prose being
 * mistaken for a path, and a `.md`-suffix is a false signal (`.md` is also Moldova's ccTLD, and any
 * sentence can end in a "…foo.md" citation). The gate is:
 *
 *   1. If the resolved path EXISTS on disk, it is a reference (ground truth — bare or nested, with
 *      spaces or not). This is what validates a real spec file's H1 against the item title.
 *   2. Otherwise it is a reference only when the body is a single, unambiguous path *token*:
 *        - it contains a directory separator `/` (a nested path such as `docs/specs/foo.md`); a
 *          bare word / domain / email like `service.md` or `contact@service.md` is NOT a reference
 *          unless it actually exists (rule 1), so `.md` TLDs never desync;
 *        - it contains NO whitespace — prose that merely cites a spec ("… Spec: docs/x.md") has
 *          interior whitespace and is not a path token;
 *        - it contains no `:` — a glued prose label ("Ref:docs/x.md", "See:docs/x.md") is prose,
 *          not a clean path (`:` is not used in this repo's paths).
 */
function resolveMarkdownRef(body: string, cwd: string): { path: string; exists: boolean } | null {
  if (!body.endsWith('.md')) return null
  const path = isAbsolute(body) ? body : join(cwd, body)
  if (existsSync(path)) return { path, exists: true }
  if (/\s/.test(body)) return null // prose / spaced citation — not a single path token
  if (!body.includes('/')) return null // bare word / domain / email that does not exist
  if (body.includes(':')) return null // glued prose label (Ref:/See:/Spec:) — not a clean path
  return { path, exists: false } // a clean, nested, missing path: a genuine desync
}

/** Syntactic check for a relative `.md` document reference when its project folder is unknown. */
function isRelativeMarkdownRefCandidate(body: string): boolean {
  if (!body.endsWith('.md')) return false
  if (/\s/.test(body)) return false
  if (body.includes(':')) return false
  if (body.includes('@')) return false
  return body.includes('/') || /^[A-Za-z0-9._-]+\.md$/u.test(body)
}

function loadIndexWithCeiling(cwd: string, options: DesyncEvaluationOptions): JournalIndexV1 {
  if (options.index !== undefined) return options.index
  const procEnv = options.env ?? process.env
  const ceiling = tmpCeilingFor(cwd)
  if (ceiling !== undefined) {
    const stateHome = trackStateHome(procEnv)
    const absState = resolve(stateHome)
    const absCeiling = resolve(ceiling)
    const realCeiling = canonicalPath(ceiling)
    if (!isInsideDir(absState, absCeiling) && !isInsideDir(canonicalPath(stateHome), realCeiling)) {
      return { version: 1, identities: {} }
    }
  }
  try {
    return readJournalIndex(procEnv)
  } catch {
    return { version: 1, identities: {} }
  }
}

/**
 * Evaluate document desynchronisation findings and unverified document references (spec DS-7,
 * lot 4a). Items carrying a project/folder identity (`ws:` / `dir:`) resolve against the `root`
 * recorded in `journals.json`; an identity with no recorded root is not checked and is counted
 * under `unverifiedCount`. Legacy items in an in-repo journal keep lot 1's rule: `cwd`.
 */
export function evaluateDesync(
  state: State,
  cwd: string,
  options: DesyncEvaluationOptions = {},
): DesyncEvaluationResult {
  const findings: DesyncFinding[] = []
  let unverifiedCount = 0
  let index: JournalIndexV1 | undefined

  for (const item of state.items.values()) {
    const ref = item.body?.trim()
    if (ref === undefined || !ref.endsWith('.md')) continue

    let baseDir: string | null
    if (isAbsolute(ref)) {
      baseDir = cwd
    } else if (isJournalIdentity(item.workspace)) {
      if (index === undefined) index = loadIndexWithCeiling(cwd, options)
      const recordedRoot = index.identities[item.workspace]?.root
      if (recordedRoot !== undefined && recordedRoot.trim() !== '') {
        baseDir = recordedRoot
      } else {
        if (isRelativeMarkdownRefCandidate(ref)) unverifiedCount++
        continue
      }
    } else if (options.offRepo === true) {
      if (options.fallbackRoot !== undefined && options.fallbackRoot !== null && options.fallbackRoot.trim() !== '') {
        baseDir = options.fallbackRoot
      } else {
        if (isRelativeMarkdownRefCandidate(ref)) unverifiedCount++
        continue
      }
    } else {
      // Journal inside a repository whose items carry no identity: keep lot 1 rule.
      baseDir = cwd
    }

    const resolved = resolveMarkdownRef(ref, baseDir)
    if (resolved === null) continue
    if (!resolved.exists) {
      findings.push({
        kind: 'desync',
        itemId: item.id,
        reason: `referenced markdown missing: ${ref}`,
        hint: `create "${ref}" with an H1 "# ${item.title}", or point the item body elsewhere`,
      })
      continue
    }
    const h1 = /^#\s+(.+?)\s*$/m.exec(readFileSync(resolved.path, 'utf8'))?.[1]
    if (h1 === undefined) {
      // SPEC §4 requires the H1 to MATCH the title; a file with no H1 cannot match.
      findings.push({
        kind: 'desync',
        itemId: item.id,
        reason: `referenced markdown has no H1: ${ref}`,
        hint: `add a first-line H1 "# ${item.title}" to "${ref}"`,
      })
    } else if (h1 !== item.title) {
      findings.push({
        kind: 'desync',
        itemId: item.id,
        reason: `H1 "${h1}" != item title "${item.title}" (${ref})`,
        hint: `align them: set the item title to "${h1}", or the H1 in "${ref}" to "# ${item.title}"`,
      })
    }
  }
  return { findings, unverifiedCount }
}

/**
 * SPEC §4 round-trip / desync rule: when an Item's `body` is a markdown file reference (see
 * {@link resolveMarkdownRef}), that file MUST exist and its H1 title MUST match the Item title. A
 * missing file or a title mismatch is a desync finding (MVP reports; it never auto-repairs).
 */
export function desyncFindings(
  state: State,
  cwd: string,
  options: DesyncEvaluationOptions = {},
): DesyncFinding[] {
  return evaluateDesync(state, cwd, options).findings
}
