import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import type { State } from '../state/fold.js'

export interface DesyncFinding {
  kind: 'desync'
  itemId: string
  reason: string
  /** A concrete remediation suggestion (v2.2c). `validate` detects only — it NEVER applies this. */
  hint: string
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
 *
 * POLICY — ESCALATED to the conductor (two intentional, reversible defaults):
 *   (a) A MISSING path that contains whitespace (e.g. `docs/Getting Started.md`) is skipped as
 *       prose. This is IRREDUCIBLE: a spaced path is character-for-character indistinguishable from
 *       a spaced prose body that ends in a "…/foo.md" citation (both have whitespace + `/` + `.md`),
 *       so flagging the former necessarily re-flags the latter — i.e. re-opens the reported bug. The
 *       repo's spec-file convention uses hyphenated, space-free names, so precision-first is safe
 *       here today. If spaced spec filenames are ever adopted, relax the `\s` rule below (one line)
 *       and accept that prose citations will desync again.
 *   (b) A MISSING bare name (no `/`) is not validated, so `.md` domains/emails never desync. A bare
 *       spec is validated only once it exists (rule 1).
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

/**
 * SPEC §4 round-trip / desync rule: when an Item's `body` is a markdown file reference (see
 * {@link resolveMarkdownRef}), that file MUST exist and its H1 title MUST match the Item title. A
 * missing file or a title mismatch is a desync finding (MVP reports; it never auto-repairs).
 * Inline-prose bodies (the common case, incl. BRANCH-imported items and spec citations) are not file
 * references and are skipped. Each finding carries a `hint` — a suggested fix the human/agent may
 * apply (track never does).
 */
export function desyncFindings(state: State, cwd: string): DesyncFinding[] {
  const findings: DesyncFinding[] = []
  for (const item of state.items.values()) {
    const ref = item.body?.trim()
    if (ref === undefined) continue
    const resolved = resolveMarkdownRef(ref, cwd)
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
  return findings
}
