import { statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { canonicalPath, identityOf, isInsideDir, tmpCeilingFor } from '../journal/identity.js'
import { attachSatellite, designateJournal, recordCopy } from '../journal/index-store.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'
import type { CliIO } from './index.js'
import { resolveJournalOfReference, type JournalResolveOptions } from './journal-reference.js'

const JOURNAL_USAGE =
  'usage: track journal <which [--format json|text] | designate <dir> [--by <name>] | attach --to <dir>>\n'

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function parseSimpleFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith('--')) {
      const name = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next
        i++
      } else {
        flags[name] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function assertStateHomeWithinCeiling(cwd: string, targetPath: string, procEnv: NodeJS.ProcessEnv): void {
  const ceiling = tmpCeilingFor(cwd) ?? tmpCeilingFor(targetPath)
  if (ceiling === undefined) return
  const stateHome = trackStateHome(procEnv)
  const absState = resolve(stateHome)
  const absCeiling = resolve(ceiling)
  const realCeiling = canonicalPath(ceiling)
  if (!isInsideDir(absState, absCeiling) && !isInsideDir(canonicalPath(stateHome), realCeiling)) {
    throw new DomainError(
      `state home ${stateHome} lies outside temporary root ${ceiling}; set TRACK_STATE_HOME under the temporary root`,
    )
  }
}

/**
 * `track journal which [--format json|text]`
 * `track journal designate <dir> [--by <name>]`
 * `track journal attach --to <dir>`
 *
 * Dispatched before store resolution: `which` is a pure read (V4); `designate` and `attach` are
 * the only commands that persist a designation or satellite attachment in `journals.json`.
 */
export function cmdJournal(
  args: string[],
  io: CliIO,
  resolveOpts: JournalResolveOptions,
): number {
  const sub = args[0]
  const { positional, flags } = parseSimpleFlags(args.slice(1))
  const procEnv = io.env ?? process.env

  if (sub === 'which') {
    if (positional.length > 0) {
      throw new DomainError(`unexpected argument(s) for journal which: ${positional.join(' ')}`)
    }
    for (const k of Object.keys(flags)) {
      if (k !== 'format') throw new DomainError(`unknown flag --${k} for journal which`)
    }
    const rawFormat = flags['format']
    if (rawFormat === true) throw new DomainError('--format requires a value (json|text)')
    const format = rawFormat ?? 'text'
    if (format !== 'json' && format !== 'text') {
      throw new DomainError('--format must be one of: json|text')
    }

    const ref = resolveJournalOfReference({ ...resolveOpts, processEnv: procEnv })
    if (format === 'json') {
      const payload = {
        identity: ref.identity,
        identityKind: ref.identityKind,
        startFolder: ref.startFolder,
        rewrittenFrom: ref.rewrittenFrom,
        steps: ref.steps,
        journal: ref.journal,
        exists: ref.exists,
        resolution: ref.resolution,
        designated: ref.designated,
        inscriptionAllowed: ref.inscriptionAllowed,
        knownCopies: ref.knownCopies,
      }
      io.out(`${JSON.stringify(payload, null, 2)}\n`)
      return 0
    }

    const lines: string[] = [
      `identity: ${ref.identity} (${ref.identityKind})`,
      `startFolder: ${ref.startFolder}`,
    ]
    if (ref.rewrittenFrom !== null) {
      lines.push(`rewrittenFrom: ${ref.rewrittenFrom}`)
    }
    lines.push('steps:')
    for (const s of ref.steps) {
      lines.push(`  ${s.step}. ${s.name}: ${s.outcome}`)
    }
    lines.push(`journal: ${ref.journal ?? 'none'}`)
    lines.push(`exists: ${String(ref.exists)}`)
    lines.push(`resolution: ${ref.resolution ?? 'none'}`)
    lines.push(`designated: ${String(ref.designated)}`)
    lines.push(`inscriptionAllowed: ${String(ref.inscriptionAllowed)}`)
    lines.push(`knownCopies: ${ref.knownCopies}`)
    io.out(`${lines.join('\n')}\n`)
    return 0
  }

  if (sub === 'designate') {
    const dirArg = positional[0]
    if (dirArg === undefined || positional.length > 1) {
      io.err('usage: track journal designate <dir> [--by <name>]\n')
      return 2
    }
    for (const k of Object.keys(flags)) {
      if (k !== 'by') throw new DomainError(`unknown flag --${k} for journal designate`)
    }
    const byFlag = flags['by']
    if (byFlag === true) throw new DomainError('--by requires a value')
    const by = (byFlag ?? procEnv['TRACK_ACTOR'] ?? procEnv['USER'] ?? 'owner').trim() || 'owner'

    const targetAbs = canonicalPath(resolve(io.cwd, dirArg))
    if (!isDir(targetAbs)) {
      throw new DomainError(`journal designate: directory does not exist: ${dirArg}`)
    }
    assertStateHomeWithinCeiling(io.cwd, targetAbs, procEnv)

    const isDotTrack = basename(targetAbs) === '.track'
    const journalPath = isDotTrack ? targetAbs : join(targetAbs, '.track')
    const folderPath = isDotTrack ? dirname(targetAbs) : targetAbs
    if (!isDir(journalPath)) {
      throw new DomainError(
        `journal designate: no .track directory found at ${journalPath}. Run \`track init\` there first.`,
      )
    }

    const ident = identityOf(folderPath)
    // Record copy at step 5 before/alongside designation (plan/06 Lot 2).
    recordCopy(ident.id, ident.root, journalPath, { env: procEnv })
    const entry = designateJournal(ident.id, ident.root, journalPath, by, { env: procEnv })
    io.out(
      `designated ${entry.reference!.path} for ${ident.id} (${ident.kind}) by ${entry.reference!.by} at ${entry.reference!.at}\n`,
    )
    return 0
  }

  if (sub === 'attach') {
    if (positional.length > 0) {
      throw new DomainError(`unexpected argument(s) for journal attach: ${positional.join(' ')}`)
    }
    for (const k of Object.keys(flags)) {
      if (k !== 'to') throw new DomainError(`unknown flag --${k} for journal attach`)
    }
    const toFlag = flags['to']
    if (toFlag === undefined || toFlag === true) {
      io.err('usage: track journal attach --to <dir>\n')
      return 2
    }

    const conductorAbs = canonicalPath(resolve(io.cwd, toFlag))
    if (!isDir(conductorAbs)) {
      throw new DomainError(`journal attach: conductor directory does not exist: ${toFlag}`)
    }
    assertStateHomeWithinCeiling(io.cwd, conductorAbs, procEnv)

    const satRef = resolveJournalOfReference({ cwd: io.cwd, processEnv: procEnv })
    const condIdent = identityOf(conductorAbs)
    if (satRef.identity === condIdent.id) {
      throw new DomainError(`journal attach: cannot attach ${satRef.identity} to itself`)
    }

    const entry = attachSatellite(satRef.identity, satRef.identityRoot, condIdent.id, { env: procEnv })
    io.out(
      `attached ${satRef.identity} (root ${entry.root}) to conductor ${condIdent.id}\n`,
    )
    return 0
  }

  io.err(JOURNAL_USAGE)
  return 2
}
