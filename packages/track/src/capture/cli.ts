import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { CliIO } from '../cli/index.js'
import { resolveJournalOfReference, type JournalResolveOptions } from '../cli/journal-reference.js'
import type { ActorId, CaptureOrigin } from '../events/types.js'
import { canonicalPath, identityOf, isInsideDir, tmpCeilingFor } from '../journal/identity.js'
import { recordCopy } from '../journal/index-store.js'
import { DomainError } from '../model/item.js'
import { trackStateHome } from '../state-home.js'
import {
  acknowledgeExpiredCapture,
  classifyCaptureEntry,
  inscribeAllClassified,
  inscribeCaptureEntry,
  type InscribeContext,
} from './inscribe.js'
import { hasInjectionMarker } from './markers.js'
import {
  appendCapture,
  CAPTURE_ACK_KINDS,
  CAPTURE_CLASS_KINDS,
  CAPTURE_ORIGINS,
  CAPTURE_STATES,
  consumeUnannouncedForSession,
  listAllCapturesByIdentity,
  listCaptures,
  sweepExpiredQueues,
  type CaptureAckKind,
  type CaptureClassKind,
  type CaptureState,
} from './queue.js'
import {
  CAPTURE_CLI_MODES,
  readCaptureRegistry,
  recordCliLastCapture,
  registerCaptureCli,
  type CaptureCliMode,
} from './registry.js'
import { maskSecrets } from './secrets.js'

const CAPTURE_USAGE = `usage: track capture <subcommand>
  add --cli <name> [--text-key <key>] [--session <id>] [--folder <dir>] [--origin <class>] [--transcript <ref>] --stdin
  register --cli <name> --version <v> --mode <direct|deferred|not-covered>
  status [--format json|text]
  list [--session <id>] [--state <state>] [--format json|text]
  remind --cli <name> --stdin [--format json|text]
  classify <captureId> (--as new-demand --title <t> | --as follow-up --demand <n> | --as decision-answer --decision <ref> | --as not-a-demand)
  inscribe (<captureId> | --all)
  acknowledge <captureId> --as <late-demand|not-a-demand|recorded-elsewhere> [--text <t> | --stdin] [--title <t>]
`

type Flags = Record<string, string | true>

function parseCaptureFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = Object.create(null) as Flags
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function opt(flags: Flags, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

function req(flags: Flags, key: string): string {
  const v = flags[key]
  if (typeof v !== 'string' || v.trim() === '') {
    throw new DomainError(`missing required --${key}`)
  }
  return v
}

function assertOnlyFlags(flags: Flags, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  const unknown = Object.keys(flags).filter((k) => !allow.has(k)).sort()
  if (unknown.length > 0) {
    throw new DomainError(`unsupported flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`)
  }
}

function assertBooleanFlag(flags: Flags, key: string): boolean {
  const v = flags[key]
  if (v === undefined) return false
  if (v !== true) throw new DomainError(`--${key} does not accept a value`)
  return true
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Exact key-extraction order from `packages/h2a/src/cli.ts:4719-4738` (plan/07 Lot 1).
 */
function extractPromptText(value: unknown, textKey?: string): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractPromptText(item, textKey)
      if (text !== undefined && text.length > 0) return text
    }
    return undefined
  }
  if (!isPlainObject(value)) return undefined
  if (textKey !== undefined) {
    const direct = extractPromptText(value[textKey])
    if (direct !== undefined && direct.length > 0) return direct
    if (isPlainObject(value['params'])) {
      const nested = extractPromptText(value['params'][textKey])
      if (nested !== undefined && nested.length > 0) return nested
    }
    return undefined
  }
  for (const key of ['prompt', 'line', 'message', 'text', 'input']) {
    const text = extractPromptText(value[key])
    if (text !== undefined && text.length > 0) return text
  }
  if (isPlainObject(value['params'])) {
    const text = extractPromptText(value['params'])
    if (text !== undefined && text.length > 0) return text
  }
  return undefined
}

function firstStringField(obj: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (obj === undefined) return undefined
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  if (isPlainObject(obj['params'])) {
    for (const key of keys) {
      const v = obj['params'][key]
      if (typeof v === 'string' && v.trim() !== '') return v.trim()
    }
  }
  return undefined
}

function readStdin(io: CliIO): string {
  return io.stdin ?? readFileSync(0, 'utf8')
}

function parseNow(flags: Flags): string {
  const raw = opt(flags, 'now')
  if (raw === undefined) return new Date().toISOString()
  if (Number.isNaN(Date.parse(raw))) {
    throw new DomainError('--now must be a valid ISO timestamp')
  }
  return raw
}

function isStateHomeWithinCeiling(folder: string, env: NodeJS.ProcessEnv): boolean {
  const ceiling = tmpCeilingFor(folder)
  if (ceiling === undefined) return true
  const stateHome = trackStateHome(env)
  return (
    isInsideDir(resolve(stateHome), resolve(ceiling)) ||
    isInsideDir(canonicalPath(stateHome), canonicalPath(ceiling))
  )
}

/**
 * `track capture add` — NEVER prints to stdout and NEVER returns non-zero (spec §7.1, T3a-l).
 */
function cmdCaptureAdd(args: string[], io: CliIO): number {
  try {
    const { positional, flags } = parseCaptureFlags(args)
    if (positional.length > 0) {
      throw new DomainError(`capture add: unexpected positional argument(s) (${positional.length})`)
    }
    assertOnlyFlags(flags, ['cli', 'text-key', 'session', 'folder', 'origin', 'transcript', 'stdin', 'now'])
    const cliName = req(flags, 'cli').trim()
    assertBooleanFlag(flags, 'stdin')
    const now = parseNow(flags)
    const procEnv = io.env ?? process.env

    const rawInput = readStdin(io)
    let parsedObj: Record<string, unknown> | undefined
    let rawText: string | undefined
    const textKey = opt(flags, 'text-key')

    try {
      const parsed: unknown = JSON.parse(rawInput)
      if (isPlainObject(parsed)) {
        parsedObj = parsed
        rawText = extractPromptText(parsed, textKey)
      } else if (typeof parsed === 'string') {
        rawText = parsed
      }
    } catch {
      // Non-JSON payload is treated as raw text
      if (textKey === undefined) rawText = rawInput.replace(/\r?\n$/u, '')
    }

    if (rawText === undefined || rawText.trim().length === 0) {
      throw new DomainError('capture add: empty message text')
    }

    const session =
      opt(flags, 'session') ??
      firstStringField(parsedObj, ['session_id', 'sessionId', 'thread_id', 'conversationId']) ??
      null

    const folderArg = opt(flags, 'folder') ?? firstStringField(parsedObj, ['cwd']) ?? io.cwd
    const folder = isAbsolute(folderArg) ? folderArg : resolve(io.cwd, folderArg)

    const transcript =
      opt(flags, 'transcript') ?? firstStringField(parsedObj, ['transcript_path']) ?? null

    const explicitOrigin = opt(flags, 'origin')
    if (explicitOrigin !== undefined && !(CAPTURE_ORIGINS as readonly string[]).includes(explicitOrigin)) {
      throw new DomainError(`capture add: --origin must be one of ${CAPTURE_ORIGINS.join('|')}`)
    }
    // Spec §7.6 l. 318: an injection marker ALWAYS makes a capture `injected`, regardless of --origin.
    let origin: CaptureOrigin
    if (hasInjectionMarker(rawText)) {
      origin = 'injected'
    } else if (explicitOrigin !== undefined) {
      origin = explicitOrigin as CaptureOrigin
    } else {
      // Track alone never concludes `owner` (spec §7.6, DS-9, plan/07 Lot 1).
      origin = 'doubtful'
    }

    const ident = identityOf(folder)
    appendCapture(
      {
        cli: cliName,
        session,
        folder: canonicalPath(folder),
        identity: ident.id,
        origin,
        rawText,
        transcript,
      },
      { env: procEnv, now },
    )

    // Record step-5 copy if resolved (lot 4a integration, plan/07 Lot 1)
    if (isStateHomeWithinCeiling(folder, procEnv)) {
      try {
        const ref = resolveJournalOfReference({ cwd: folder, processEnv: procEnv })
        if (ref.matchedStep === 5 && ref.step5CopyPath != null) {
          recordCopy(ref.identity, ref.identityRoot, ref.step5CopyPath, { env: procEnv, now })
        }
      } catch {
        // Best-effort copy recording; never fails capture
      }
    }

    // Update CLI lastCaptureAt in registry when registered
    recordCliLastCapture(cliName, now, { env: procEnv })

    return 0
  } catch (err) {
    const msg = maskSecrets(err instanceof Error ? err.message : String(err)).text
    io.err(`capture add error: ${msg}\n`)
    return 0
  }
}

export function cmdCapture(
  args: string[],
  io: CliIO,
  resolveOpts: JournalResolveOptions,
  resolveActorFn: (cwd: string) => ActorId,
  writerTokenFile?: string,
): number {
  const sub = args[0]
  const rest = args.slice(1)
  const procEnv = io.env ?? process.env

  if (sub === 'add') {
    return cmdCaptureAdd(rest, io)
  }

  if (sub === 'register') {
    const { positional, flags } = parseCaptureFlags(rest)
    if (positional.length > 0) {
      throw new DomainError(`capture register: unexpected argument(s) (${positional.length})`)
    }
    assertOnlyFlags(flags, ['cli', 'version', 'mode', 'now'])
    const cliName = req(flags, 'cli')
    const version = req(flags, 'version')
    const mode = req(flags, 'mode')
    if (!(CAPTURE_CLI_MODES as readonly string[]).includes(mode)) {
      throw new DomainError(`capture register: --mode must be one of ${CAPTURE_CLI_MODES.join('|')}`)
    }
    const now = parseNow(flags)
    const entry = registerCaptureCli(
      { cli: cliName, version, mode: mode as CaptureCliMode },
      { env: procEnv, now },
    )
    io.out(`registered ${cliName} (${entry.version}) mode=${entry.mode}\n`)
    return 0
  }

  if (sub === 'status') {
    const { positional, flags } = parseCaptureFlags(rest)
    if (positional.length > 0) {
      throw new DomainError(`capture status: unexpected argument(s) (${positional.length})`)
    }
    assertOnlyFlags(flags, ['format', 'now'])
    const format = opt(flags, 'format') ?? 'text'
    if (format !== 'json' && format !== 'text') {
      throw new DomainError('--format must be one of: json|text')
    }
    const now = parseNow(flags)
    const registry = readCaptureRegistry(procEnv)
    const allByIdentity = listAllCapturesByIdentity({ env: procEnv, now })
    const identities: Record<string, Record<CaptureState, number>> = {}
    for (const [id, entries] of allByIdentity) {
      const counts: Record<CaptureState, number> = {
        captured: 0,
        classified: 0,
        inscribed: 0,
        dismissed: 0,
        expired: 0,
        acknowledged: 0,
      }
      for (const e of entries) counts[e.state] += 1
      identities[id] = counts
    }
    if (format === 'json') {
      io.out(`${JSON.stringify({ registry, identities }, null, 2)}\n`)
      return 0
    }
    const lines: string[] = ['clis:']
    const cliNames = Object.keys(registry.clis).sort()
    if (cliNames.length === 0) {
      lines.push('  (none)')
    } else {
      for (const name of cliNames) {
        const c = registry.clis[name]!
        lines.push(`  ${name} ${c.version} mode=${c.mode} lastCaptureAt=${c.lastCaptureAt ?? 'none'}`)
      }
    }
    lines.push('queues:')
    const idKeys = Object.keys(identities).sort()
    if (idKeys.length === 0) {
      lines.push('  (empty)')
    } else {
      for (const id of idKeys) {
        const c = identities[id]!
        lines.push(
          `  ${id}: captured=${c.captured} classified=${c.classified} inscribed=${c.inscribed} dismissed=${c.dismissed} expired=${c.expired} acknowledged=${c.acknowledged}`,
        )
      }
    }
    io.out(`${lines.join('\n')}\n`)
    return 0
  }

  if (sub === 'list') {
    const { positional, flags } = parseCaptureFlags(rest)
    if (positional.length > 0) {
      throw new DomainError(`capture list: unexpected argument(s) (${positional.length})`)
    }
    assertOnlyFlags(flags, ['session', 'state', 'format', 'now'])
    const format = opt(flags, 'format') ?? 'text'
    if (format !== 'json' && format !== 'text') {
      throw new DomainError('--format must be one of: json|text')
    }
    const stateFilter = opt(flags, 'state')
    if (stateFilter !== undefined && !(CAPTURE_STATES as readonly string[]).includes(stateFilter)) {
      throw new DomainError(`capture list: --state must be one of ${CAPTURE_STATES.join('|')}`)
    }
    const sessionFilter = opt(flags, 'session')
    const now = parseNow(flags)
    const ident = identityOf(io.cwd)
    const entries = listCaptures(ident.id, {
      env: procEnv,
      now,
      ...(sessionFilter !== undefined ? { session: sessionFilter } : {}),
      ...(stateFilter !== undefined ? { state: stateFilter as CaptureState } : {}),
    })
    if (format === 'json') {
      io.out(`${JSON.stringify(entries, null, 2)}\n`)
      return 0
    }
    for (const e of entries) {
      io.out(`${e.id}\t${e.at}\t${e.state}\t${e.origin}\t${e.cli}\t${e.session ?? '-'}\n`)
    }
    return 0
  }

  if (sub === 'remind') {
    const { positional, flags } = parseCaptureFlags(rest)
    if (positional.length > 0) {
      throw new DomainError(`capture remind: unexpected argument(s) (${positional.length})`)
    }
    assertOnlyFlags(flags, ['cli', 'stdin', 'session', 'folder', 'format', 'now'])
    req(flags, 'cli')
    assertBooleanFlag(flags, 'stdin')
    const format = opt(flags, 'format') ?? 'text'
    if (format !== 'json' && format !== 'text') {
      throw new DomainError('--format must be one of: json|text')
    }
    const now = parseNow(flags)
    const raw = readStdin(io)
    let parsedObj: Record<string, unknown> | undefined
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isPlainObject(parsed)) parsedObj = parsed
    } catch {
      // ignore non-JSON
    }
    const session =
      opt(flags, 'session') ??
      firstStringField(parsedObj, ['session_id', 'sessionId', 'thread_id', 'conversationId'])
    const folderArg = opt(flags, 'folder') ?? firstStringField(parsedObj, ['cwd']) ?? io.cwd
    const folder = isAbsolute(folderArg) ? folderArg : resolve(io.cwd, folderArg)
    const ident = identityOf(folder)

    const entries =
      session !== undefined
        ? consumeUnannouncedForSession(ident.id, session, { env: procEnv, now })
        : (sweepExpiredQueues({ env: procEnv, now }), [])
    if (format === 'json') {
      io.out(`${JSON.stringify(entries, null, 2)}\n`)
      return 0
    }
    for (const e of entries) {
      io.out(`${e.id}\t${e.at}\t${e.origin}\t${e.size}B\n`)
    }
    return 0
  }

  const inscribeCtx = (now: string): InscribeContext => ({
    resolveOpts: { ...resolveOpts, processEnv: procEnv },
    by: resolveActorFn(io.cwd),
    tokenInput: {
      ...(writerTokenFile !== undefined ? { writerTokenFile } : {}),
      env: procEnv,
    },
    env: procEnv,
    now,
  })

  if (sub === 'classify') {
    const { positional, flags } = parseCaptureFlags(rest)
    const captureId = positional[0]
    if (captureId === undefined || positional.length > 1) {
      io.err(CAPTURE_USAGE)
      return 2
    }
    assertOnlyFlags(flags, ['as', 'title', 'demand', 'decision', 'now'])
    const asRaw = req(flags, 'as')
    if (!(CAPTURE_CLASS_KINDS as readonly string[]).includes(asRaw)) {
      throw new DomainError(`capture classify: --as must be one of ${CAPTURE_CLASS_KINDS.join('|')}`)
    }
    const now = parseNow(flags)
    const demandRaw = opt(flags, 'demand')
    let demandNumber: number | undefined
    if (demandRaw !== undefined) {
      if (!/^\d+$/u.test(demandRaw) || Number(demandRaw) < 1) {
        throw new DomainError('capture classify: --demand must be a positive integer')
      }
      demandNumber = Number(demandRaw)
    }
    const ident = identityOf(io.cwd)
    const res = classifyCaptureEntry(
      {
        captureId,
        as: asRaw as CaptureClassKind,
        title: opt(flags, 'title'),
        demandNumber,
        decisionRef: opt(flags, 'decision'),
      },
      ident.id,
      inscribeCtx(now),
    )

    if (asRaw === 'not-a-demand') {
      io.out(`dismissed ${res.entry.id}\n`)
      return 0
    }
    if (res.inscribed && res.receipt !== undefined) {
      if (res.receipt.demandNumber !== undefined && res.receipt.demandId !== undefined) {
        io.out(`inscribed ${res.entry.id} -> ${res.receipt.demandId} #${res.receipt.demandNumber}\n`)
      } else if (res.receipt.decisionId !== undefined) {
        io.out(`inscribed ${res.entry.id} -> decision ${res.receipt.decisionId}\n`)
      } else {
        io.out(`inscribed ${res.entry.id}\n`)
      }
      return 0
    }
    io.out(
      `classified ${res.entry.id} (captée, pas encore inscrite : ${res.deferredReason ?? 'journal verrouillé'})\n`,
    )
    return 0
  }

  if (sub === 'inscribe') {
    const { positional, flags } = parseCaptureFlags(rest)
    assertOnlyFlags(flags, ['all', 'now'])
    const all = assertBooleanFlag(flags, 'all')
    if (all && positional.length > 0) {
      throw new DomainError('capture inscribe: --all does not accept a <captureId>')
    }
    if (!all && positional.length !== 1) {
      io.err('usage: track capture inscribe (<captureId> | --all)\n')
      return 2
    }
    const now = parseNow(flags)
    const ident = identityOf(io.cwd)
    const ctx = inscribeCtx(now)
    if (all) {
      const results = inscribeAllClassified(ident.id, ctx)
      if (results.length === 0) {
        io.out('no-op: 0 classified capture(s) waiting\n')
        return 0
      }
      for (const r of results) {
        if (r.receipt.demandNumber !== undefined && r.receipt.demandId !== undefined) {
          io.out(`inscribed ${r.entry.id} -> ${r.receipt.demandId} #${r.receipt.demandNumber}\n`)
        } else if (r.receipt.decisionId !== undefined) {
          io.out(`inscribed ${r.entry.id} -> decision ${r.receipt.decisionId}\n`)
        } else {
          io.out(`inscribed ${r.entry.id}\n`)
        }
      }
      return 0
    }
    const r = inscribeCaptureEntry(positional[0]!, ident.id, ctx)
    if (r.receipt.demandNumber !== undefined && r.receipt.demandId !== undefined) {
      io.out(`inscribed ${r.entry.id} -> ${r.receipt.demandId} #${r.receipt.demandNumber}\n`)
    } else if (r.receipt.decisionId !== undefined) {
      io.out(`inscribed ${r.entry.id} -> decision ${r.receipt.decisionId}\n`)
    } else {
      io.out(`inscribed ${r.entry.id}\n`)
    }
    return 0
  }

  if (sub === 'acknowledge') {
    const { positional, flags } = parseCaptureFlags(rest)
    const captureId = positional[0]
    if (captureId === undefined || positional.length > 1) {
      io.err('usage: track capture acknowledge <captureId> --as <late-demand|not-a-demand|recorded-elsewhere> [--text <t> | --stdin] [--title <t>]\n')
      return 2
    }
    assertOnlyFlags(flags, ['as', 'text', 'stdin', 'title', 'now'])
    const asRaw = req(flags, 'as')
    if (!(CAPTURE_ACK_KINDS as readonly string[]).includes(asRaw)) {
      throw new DomainError(`capture acknowledge: --as must be one of ${CAPTURE_ACK_KINDS.join('|')}`)
    }
    const useStdin = assertBooleanFlag(flags, 'stdin')
    const textFlag = opt(flags, 'text')
    if (useStdin && textFlag !== undefined) {
      throw new DomainError('capture acknowledge: --text and --stdin are mutually exclusive')
    }
    const text = useStdin ? readStdin(io).replace(/\r?\n$/u, '') : textFlag
    const now = parseNow(flags)
    const ident = identityOf(io.cwd)
    const acked = acknowledgeExpiredCapture(
      {
        captureId,
        as: asRaw as CaptureAckKind,
        text,
        title: opt(flags, 'title'),
      },
      ident.id,
      inscribeCtx(now),
    )
    if (acked.acknowledgement?.demandNumber !== undefined && acked.acknowledgement.demandId !== undefined) {
      io.out(
        `acknowledged ${acked.id} (late-demand -> ${acked.acknowledgement.demandId} #${acked.acknowledgement.demandNumber})\n`,
      )
    } else {
      io.out(`acknowledged ${acked.id} (${asRaw})\n`)
    }
    return 0
  }

  io.err(CAPTURE_USAGE)
  return 2
}
