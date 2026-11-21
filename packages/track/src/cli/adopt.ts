import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { applyAdoptionPlan, formatApplyResultLines } from '../adopt/apply.js'
import { buildAdoptionPlan } from '../adopt/plan.js'
import type { ActorId } from '../events/types.js'
import { DomainError } from '../model/item.js'
import { formatOwnerTableNoJournalMessage } from '../report/owner-table.js'
import { resolveJournalOfReference } from './journal-reference.js'
import type { ResolveOptions } from './resolve.js'

export interface AdoptCliIO {
  cwd: string
  out: (s: string) => void
  err: (s: string) => void
  env?: NodeJS.ProcessEnv
}

type Flags = Record<string, string | true>

function parseAdoptFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = {}
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

function assertOnlyFlags(flags: Flags, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  const unknown = Object.keys(flags).filter((k) => !allow.has(k)).sort()
  if (unknown.length > 0) {
    throw new DomainError(`unsupported flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`)
  }
}

function assertValueFlag(flags: Flags, key: string): void {
  if (flags[key] === true) throw new DomainError(`--${key} requires a value`)
}

function canonicalExistingAncestor(targetPath: string): string {
  let cur = resolve(targetPath)
  const suffix: string[] = []
  for (;;) {
    try {
      const real = realpathSync(cur)
      return suffix.length === 0 ? real : join(real, ...suffix.reverse())
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return resolve(targetPath)
      suffix.push(relative(parent, cur))
      cur = parent
    }
  }
}

function isInsideDir(candidatePath: string, containerDir: string): boolean {
  const rel = relative(canonicalExistingAncestor(containerDir), canonicalExistingAncestor(candidatePath))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function cmdAdopt(
  args: string[],
  io: AdoptCliIO,
  resolveOpts: ResolveOptions,
  resolveCommitFn: (cwd: string, commit?: string) => string,
  resolveActorFn: (cwd: string) => ActorId,
): number {
  const sub = args[0]
  if (sub === 'plan') {
    const { positional, flags } = parseAdoptFlags(args.slice(1))
    if (positional.length > 0) {
      throw new DomainError(`unexpected adopt plan argument(s): ${positional.join(' ')}`)
    }
    assertOnlyFlags(flags, ['out', 'now', 'commit', 'policy'])
    for (const key of ['out', 'now', 'commit', 'policy']) assertValueFlag(flags, key)

    const nowArg = opt(flags, 'now')
    if (nowArg !== undefined && Number.isNaN(new Date(nowArg).getTime())) {
      throw new DomainError('--now must be an ISO timestamp')
    }

    const ref = resolveJournalOfReference(resolveOpts)
    if (ref.trackDir === null) {
      throw new DomainError(formatOwnerTableNoJournalMessage(io.cwd, ref.reason))
    }

    const outFlag = opt(flags, 'out')
    let outPath: string | undefined
    if (outFlag !== undefined) {
      outPath = isAbsolute(outFlag) ? resolve(outFlag) : resolve(io.cwd, outFlag)
      if (isInsideDir(outPath, ref.trackDir)) {
        throw new DomainError('adopt plan: --out must point outside the journal folder')
      }
    }

    const plan = buildAdoptionPlan(join(ref.trackDir, 'events.jsonl'), {
      baselineCommit: resolveCommitFn(io.cwd, opt(flags, 'commit')),
      now: nowArg ?? new Date().toISOString(),
      ...(opt(flags, 'policy') !== undefined ? { policyPath: opt(flags, 'policy')! } : {}),
    })
    const serialized = `${JSON.stringify(plan, null, 2)}\n`

    if (outPath !== undefined) {
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, serialized, 'utf8')
    }
    io.out(serialized)
    return 0
  }

  if (sub === 'apply') {
    const { positional, flags } = parseAdoptFlags(args.slice(1))
    if (positional.length !== 1) {
      io.err('usage: track adopt apply <plan.json> [--writer-token-file <path>] [--now <iso>] [--commit <sha>] [--policy <path>]\n')
      return 2
    }
    assertOnlyFlags(flags, ['writer-token-file', 'now', 'commit', 'policy'])
    for (const key of ['writer-token-file', 'now', 'commit', 'policy']) assertValueFlag(flags, key)

    const nowArg = opt(flags, 'now')
    if (nowArg !== undefined && Number.isNaN(new Date(nowArg).getTime())) {
      throw new DomainError('--now must be an ISO timestamp')
    }

    const ref = resolveJournalOfReference(resolveOpts)
    if (ref.trackDir === null) {
      throw new DomainError(formatOwnerTableNoJournalMessage(io.cwd, ref.reason))
    }

    const planArg = positional[0]!
    const planPath = isAbsolute(planArg) ? planArg : resolve(io.cwd, planArg)
    let parsedPlan: unknown
    try {
      parsedPlan = JSON.parse(readFileSync(planPath, 'utf8'))
    } catch {
      throw new DomainError(`adopt apply: cannot read valid JSON plan from ${planArg}`)
    }

    const tokenFileArg = opt(flags, 'writer-token-file')
    const writerTokenFile =
      tokenFileArg !== undefined
        ? isAbsolute(tokenFileArg)
          ? tokenFileArg
          : resolve(io.cwd, tokenFileArg)
        : undefined

    const result = applyAdoptionPlan(join(ref.trackDir, 'events.jsonl'), parsedPlan, {
      by: resolveActorFn(io.cwd),
      baselineCommit: resolveCommitFn(io.cwd, opt(flags, 'commit')),
      ...(nowArg !== undefined ? { now: nowArg } : {}),
      ...(opt(flags, 'policy') !== undefined ? { policyPath: opt(flags, 'policy')! } : {}),
      ...(writerTokenFile !== undefined ? { writerTokenFile } : {}),
    })
    io.out(formatApplyResultLines(result))
    return result.refused > 0 ? 1 : 0
  }

  io.err('usage: track adopt <plan [--out <file>]|apply <plan.json>>\n')
  return 2
}
