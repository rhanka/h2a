import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { readHead } from '../events/head.js'
import { EventStore } from '../events/store.js'
import { validate } from '../events/validate.js'
import { cmdEventsContains } from './events-contains.js'
import { cmdInstallSkills } from './install-skills.js'
import { initTrackDir, resolveTrackDir, resolveTrackDirOrNull } from './resolve.js'
import type { EvidenceKind, RunResult } from '../model/acceptance.js'
import type { BlockerKind, BlockerScope, ResolutionRule } from '../model/blocker.js'
import type { DecisionKind, Dossier, DossierArtifact, Outcome } from '../model/decision.js'
import { DomainError, type Disposition, type Gate, type ItemKind, type ItemRole, type Realization, type ReopenMotive, type ScopeDecl, type SpecStatus } from '../model/item.js'
import type { Bucket } from '../report/buckets.js'
import { displayText, formatRows, type Format } from '../report/format.js'
import { Track } from '../track.js'
import type { ActorId, Provenance } from '../events/types.js'
import {
  BLOCKER_KINDS,
  BLOCKER_SCOPES,
  DECISION_KINDS,
  DISPOSITIONS,
  EVIDENCE_KINDS,
  GATES,
  ITEM_KINDS,
  ITEM_ROLES,
  REALIZE_TARGETS,
  REOPEN_MOTIVE_VALUES,
  RESOLUTION_RULES,
  RESULTS,
  ROLE_CHANGE_TARGETS,
  SPEC_TARGETS,
  type WorkEvent,
} from '../ingest/contract.js'
import { ingest, type IngestContext } from '../ingest/ingest.js'
import { applyRestructurePlan, type RestructurePlan } from './restructure-apply.js'
import { TrackReader } from '../read/contract.js'
import { queryText, reportHtml, reportInline, reportText, resolveHandle, statusText } from '../read/commands.js'
import { STATUS_LEVELS } from '../report/status-by-level.js'
import { renderSnapshot } from '../report/snapshot.js'
import { VERSION } from '../version.js'
import { durableWorkspaceId } from '../workspace-id.js'
import { desyncFindings } from './desync.js'

export interface CliIO {
  cwd: string
  out: (s: string) => void
  err: (s: string) => void
  /** Optional process environment injection for adapter/config isolation in embedders and tests. */
  env?: NodeJS.ProcessEnv
}

/**
 * A resolved CLI context: the caller's `io` plus the single `.track/events.jsonl` path resolved ONCE
 * (nearest-ancestor `.track`, or an explicit `--track-dir`/`TRACK_DIR`) — so every handler reads and
 * writes the SAME store and a subdir write can never land in a stray sidecar. `io.cwd` is still used
 * for git/actor and relative file resolution; `eventsPath` is the source of truth for the log.
 */
interface Ctx {
  io: CliIO
  eventsPath: string
}

type Flags = Record<string, string | true>

const USAGE = `usage: track <command>
  --help | help
  global read/store override: --track-dir <directory-containing-events.jsonl> (or TRACK_DIR)
    may appear before or after the command; it redirects reads AND writes to that directory
  --version | -v
  init
  item new --kind <feature|bug|chore> --title <t> --workspace <w> [--body <b>] [--parent <id>] [--role <workpackage|spec-phase|stream>] [--accountable <a>] [--responsible <a,a>] (trim actor IDs; blank responsible members are dropped)
  item reparent <itemId> [--parent <pid>] [--detach]
  item set-raci <itemId> [--accountable <a>] [--responsible <a,a>] [--client-token <t>] (trimmed blank members are rejected, unlike item new)
  item set-role <itemId> <workpackage|stream>
  item scope-declare <itemId> [--allowed <glob,glob>] [--forbidden <...>] [--conditional <...>] [--scope <json>]
  item spec-amend <itemId> --base-hash <h> --result-hash <h> --patch <json> [--decision-id <id>] [--live-doc-ref <r>] [--proposal-ref <r>] [--summary <s>] [--client-token <t>]
  item spec <itemId> <to-specify|specified>
  item realize <itemId> <in-progress|done|cancelled>
  item reopen <itemId> --motive <closed-without-owner-uat|regression-observed> --reason <r> [--client-token <t>]
  item assign-code <itemId> --code <c> [--client-token <t>]
  item show <itemId>
  item ls [--workspace <w>] [--kind <feature|bug|chore>] [--format json|text|md]
  decision new --kind <orientation|commitment> --title <t> --workspace <w> --targets <id,id> --context <c> --options-json <json> --recommendation <optionId> --rationale <r> [--accountable <a>] [--engagement-ref <e>]
  decision ls [--workspace <w>] [--outcome <pending|go|no-go|deferred>] [--format json|text|md] [--commit <sha>]
  decision outcome <decisionId> deferred
  decision select <decisionId> <optionId> [--outcome <go|no-go>]
  decision dossier <decisionId> [--context <c>] [--options-json <json> --recommendation <optionId> --rationale <r>]
  decision disposition <itemId> <orientation|commitment> <required|skipped|not-applicable>
  decision add-artifact <decisionId> --kind <h2a-decision-dossier|rendered-view|mockup> [--negotiation-ref <n>] [--dossier-hash <h>] [--view-ref <v>] [--source-dossier-hash <h>] [--label <l>] [--client-token <t>]
  blocker raise --target <id> --kind <decision|dependency> [--ref <id>] [--reason <r>] [--rule <linked-done|linked-accepted|manual>] [--scope <intra|extra>] [--engagement-ref <e>] [--owner <actor>]
  blocker resolve <blockerId>
  blocker resolve-external --engagement-ref <e>
  accept criterion <itemId> --statement <s>
  accept link <criterionId> --kind <unit|integration|e2e|manual> --locator <l>
  accept run <evidenceId> --result <pass|fail> [--commit <c>] [--env <e>] [--runner <r>]
  accept run --from <report> --format <junit|json> [--commit <c>] [--env <e>] [--runner <r>]
  accept waive <criterionId> --reason <r>
  consolidate --items <id,id> --commit <mergeCommit> [--client-token <t>]
  priority assess <itemId> --ubv <n> --tc <n> --rr <n> --js <n>
  report [--scope <container-id|code|label>] [--decisions] [--require-accepted] [--active-roster] [--wp|--flat] [--inline] [--width <n>] [--level <spec|plan|wp|lot|task>] [--raw] [--resolve <handle>] [--sub-wp] [--format json|text|md|html] [--commit <sha>] [--now <iso>]
  snapshot [--require-accepted] [--format json|text|md] [--commit <sha>]
  export-graph [--repo-key <repo:key>] [--source-id <id>] [--observed-at <iso>]
  query [--kind <k>] [--role <workpackage|spec-phase|stream>] [--workspace <w>] [--bucket <AWAITED|DROPPED|DONE|TO-DO>] [--realization <r>] [--acceptance <a>] [--format json|text|md] [--commit <sha>]
  workspace-activity --workspace <id> [--baseline-commit <sha>] [--now <iso>] [--idle-ms <ms>] [--format json|text]
  scope validate --workspace <id> [--baseline-commit <sha>] [--content <path>] [--locator <l>] [--claimed-item <id>] [--infer-delivered-out-of-scope] [--format json|text]
  validate [--commit <sha>]
  events-contains --base <log> --candidate <log> [--format json|text]
  audit [--format json|text]
  focus <decision-id> --workspace <w> [--format terminal|md|html] [--baseline-commit <sha>]
  branch import <BRANCH.md> [--commit <sha>]
  restructure apply --plan <plan.json>
  ingest <file.jsonl> --workspace <w>
  install-skills --host <claude|codex|gemini|agy|all> [--scope user|project] [--force]
  workspace-id [--cwd <path>]
`

// Write enums (ITEM_KINDS, SPEC_TARGETS, REALIZE_TARGETS, DECISION_KINDS, GATES, DISPOSITIONS,
// BLOCKER_KINDS, RESOLUTION_RULES, EVIDENCE_KINDS, RESULTS) are sourced from the ingest contract — the
// SINGLE source, so the CLI's `oneOf` checks and the WorkEvent mapper cannot diverge on accepted values.
// (`linked-accepted` openness is DERIVED at report/query time vs `--commit`, v2.2a hybrid-A; see
// src/report/blocker-status.ts.) Only CLI/read-projection enums stay local:
const REALIZATIONS = ['to-do', 'in-progress', 'done', 'cancelled', 'rejected'] as const
const FROM_FORMATS = ['junit', 'json'] as const
const BUCKETS_ARG = ['AWAITED', 'DROPPED', 'DONE', 'TO-DO'] as const
const DECISION_OUTCOMES = ['pending', 'go', 'no-go', 'deferred'] as const
// `n/a` is decision-only; `query` projects non-decision rows, so it would never match.
const ACCEPTANCES = ['fail', 'waived', 'unknown', 'stale', 'pass'] as const
// The DossierArtifact discriminator (M5 §3.1). CLI-local: the union SHAPE is validated fail-closed in the
// facade (`assertDossierArtifact`); this only gates the surface flag so an unknown --kind fails at the
// CLI boundary rather than assembling a half-built artifact.
const DOSSIER_ARTIFACT_KINDS = ['h2a-decision-dossier', 'rendered-view', 'mockup'] as const

function eventsPathOf(trackDir: string): string {
  return join(trackDir, 'events.jsonl')
}
function store(ctx: Ctx): EventStore {
  return new EventStore(ctx.eventsPath)
}
function gitHead(cwd: string): string {
  try {
    // stdio: silence git's own stderr (off-repo, rev-parse fails — we fall back to 'HEAD').
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'HEAD'
  }
}

/**
 * CLI-boundary normalization for `--commit <c>`. The acceptance baseline is compared LITERALLY in
 * `src/accept/status.ts` (a recorded run's `commit` must equal the report's `baselineCommit`), so the
 * two ends must agree on the SAME string. The omitted default already resolves HEAD via `gitHead`,
 * but an EXPLICIT `--commit HEAD` (or a branch / short SHA) used to reach the compare verbatim — never
 * matching a run recorded under the resolved 40-char SHA → criterion `stale`, item never accepts.
 *
 * So: undefined → `gitHead(cwd)` (current HEAD SHA, same as the default). Otherwise `git rev-parse <c>`
 * resolves `HEAD`, symbolic refs, and short SHAs to the full SHA; a full SHA passes through unchanged.
 * If rev-parse fails (not a git repo / bad ref) we return `c` VERBATIM — never crash, and preserve the
 * pre-existing behavior for non-git dirs and odd literal tokens (e.g. test fixtures like `c1`).
 */
function resolveCommit(cwd: string, c: string | undefined): string {
  if (c === undefined) return gitHead(cwd)
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${c}^{commit}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return c
  }
}

function remoteKeyFromUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().replace(/\.git$/i, '')
  const sshUrl = trimmed.match(/^ssh:\/\/(?:[^@]+@)?([^/\s]+)(\/.+)$/i)
  if (sshUrl) {
    const host = sshUrl[1] ?? ''
    const path = (sshUrl[2] ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
    if (host && path) return `${host}/${path}`
  }
  const https = trimmed.match(/^https?:\/\/([^/\s]+)(\/.+)$/i)
  if (https) {
    const host = https[1] ?? ''
    const path = (https[2] ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
    if (host && path) return `${host}/${path}`
  }
  const scp = trimmed.match(/^(?:[^@]+@)?([^:/\s]+):(?!\/\/)(.+)$/)
  if (scp) {
    const host = scp[1] ?? ''
    const path = (scp[2] ?? '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/:/g, '/')
    if (host && path) return `${host}/${path}`
  }
  return undefined
}

function graphRepoKey(cwd: string): string {
  let root = cwd
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    root = cwd
  }
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const key = remoteKeyFromUrl(remoteUrl)
    if (key !== undefined) return `repo:${key}`
  } catch {
    /* fall through to local key */
  }
  const absRoot = resolve(root)
  const name = basename(absRoot)
  const hash = createHash('sha256').update(absRoot).digest('hex').slice(0, 8)
  return `repo:local/${name}@${hash}`
}

// D3: CLI writes are attributed to the LOCAL USER (never the reserved `'system'`), with `cli`
// provenance — so the immutable log honestly distinguishes a human-CLI write from an agent one.
const CLI_PROV: Provenance = { transport: 'cli', proposed: false, auth: 'local-user' }

function cliActor(cwd: string): ActorId {
  try {
    const email = execFileSync('git', ['config', 'user.email'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (email) return `human:${email}`
  } catch {
    /* not a repo / git absent — fall through */
  }
  const user = process.env['USER'] ?? process.env['USERNAME']
  return user ? `human:${user}` : 'cli:unknown'
}

/** A writer Track for CLI commands — attributed to the local user with `cli` provenance (D3). */
function writeTrack(ctx: Ctx): Track {
  return new Track(store(ctx), { by: cliActor(ctx.io.cwd), prov: CLI_PROV })
}

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
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

function req(flags: Flags, key: string): string {
  const v = flags[key]
  if (typeof v !== 'string') throw new DomainError(`missing required --${key}`)
  return v
}
function opt(flags: Flags, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}
function num(flags: Flags, key: string): number {
  const n = Number(req(flags, key))
  if (Number.isNaN(n)) throw new DomainError(`--${key} must be a number`)
  return n
}

function dossierOptions(raw: string): Dossier['options'] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new DomainError('--options-json must be a JSON array of existing Option objects')
  }
  if (!Array.isArray(parsed)) {
    throw new DomainError('--options-json must be a JSON array of existing Option objects')
  }
  return parsed as Dossier['options']
}
/** Validate a positional/flag against an allowed enum (CLI-boundary input validation). */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new DomainError(`${name} must be one of: ${allowed.join('|')} (got ${value === undefined ? '<none>' : `"${value}"`})`)
  }
  return value as T
}
function fmt(flags: Flags): Format {
  return oneOf(opt(flags, 'format') ?? 'text', ['json', 'text', 'md'], '--format')
}

function assertBooleanFlag(flags: Flags, key: string): boolean {
  const value = flags[key]
  if (value === undefined) return false
  if (value !== true) throw new DomainError(`--${key} does not accept a value`)
  return true
}

function assertOnlyFlags(flags: Flags, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  const unknown = Object.keys(flags).filter((key) => !allow.has(key)).sort()
  if (unknown.length > 0) throw new DomainError(`unsupported flag(s): ${unknown.map((key) => `--${key}`).join(', ')}`)
}

function assertValueFlag(flags: Flags, name: string): void {
  if (flags[name] === true) throw new DomainError(`--${name} requires a value`)
}

/**
 * Pull a global `--track-dir <path>` out of argv BEFORE per-command parsing, so it works regardless
 * of where the user places it. Returns the value (if any) and the argv with that flag removed.
 */
function extractTrackDirFlag(argv: string[]): { trackDirFlag?: string; rest: string[] } {
  const rest: string[] = []
  let trackDirFlag: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--track-dir') {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        trackDirFlag = next
        i++
        continue
      }
    }
    rest.push(a)
  }
  return trackDirFlag !== undefined ? { trackDirFlag, rest } : { rest }
}

const REPORT_USAGE = `usage: track report [--scope <container-id|code|label>] [--raw] [--wp] [--flat] [--inline|--width <40..240>] [--decisions] [--active-roster] [--require-accepted] [--resolve <handle>] [--commit <sha>] [--now <iso>] [--sub-wp] [--format json|text|md|html] [--track-dir <directory-containing-events.jsonl>]

--scope selects one exact role-container by its id, durable assigned code, or current derived label. The selected container and all descendants are rendered through the same four-section report; unknown or ambiguous selectors fail loudly.

--resolve <handle> resolves a report handle (a positional [n.m] row handle, or a D#/Q# dossier number) back to its item id. It is the one command the report documents for acting on a row without printing a ULID in a column. Handles are positional and per-report: resolve them against the same log and baseline the report was rendered from.

--sub-wp lists sub-WP rows beside their parent. Without it, sub-levels are aggregated into their parent on a long window (>= 14 days) and listed on a short one — the WP is the reading unit of a long report.

--now <iso> pins the window's upper bound (default: the wall clock). The report's period always runs from the first recorded event to that bound; pin it to reproduce a committed fixture byte for byte.

--track-dir is a global override and may appear before or after the command. It selects the directory that contains events.jsonl; it is especially useful for a read-only fixture. TRACK_DIR is the environment equivalent.
`

export function runCli(rawArgv: string[], io: CliIO): number | Promise<number> {
  const { trackDirFlag, rest: argv } = extractTrackDirFlag(rawArgv)
  const cmd = argv[0]
  const rest = argv.slice(1)
  if (cmd === '--help' || cmd === 'help' || cmd === undefined) {
    io.out(USAGE)
    return 0
  }
  if (cmd === 'report' && rest.length === 1 && rest[0] === '--help') {
    io.out(REPORT_USAGE)
    return 0
  }
  const trackDirEnv = process.env['TRACK_DIR']
  const resolveOpts = {
    cwd: io.cwd,
    ...(trackDirFlag !== undefined ? { flag: trackDirFlag } : {}),
    ...(trackDirEnv !== undefined ? { env: trackDirEnv } : {}),
  }
  try {
    // `decision ls` is an inspection surface, not a write verb. Route it through the same serve-empty
    // read path as report/query so it never creates a sidecar and can be used by a fresh reporting agent.
    if (cmd === 'decision' && rest[0] === 'ls') {
      const trackDir = resolveTrackDirOrNull(resolveOpts)
      if (trackDir === null) {
        io.err(
          `track: no .track resolved from ${io.cwd}. Run \`track init\` to create one ` +
            `(the ONLY command that does), or pass --track-dir / TRACK_DIR. Serving an empty view.\n`,
        )
      }
      return cmdDecisionLs(rest, {
        io,
        eventsPath: trackDir !== null ? eventsPathOf(trackDir) : eventsPathOf(join(resolve(io.cwd), '.track')),
      })
    }
    switch (cmd) {
      case '--version':
      case '-v':
      case 'version':
        io.out(`${VERSION}\n`)
        return 0
      case 'init': {
        // The ONLY command that creates a `.track` — at cwd/.track (or an explicit override).
        const dir = initTrackDir(resolveOpts)
        mkdirSync(dir, { recursive: true })
        io.out(`Initialized .track/ in ${dirname(dir)}\n`)
        return 0
      }
      case 'install-skills':
        // Deploys the in-repo `skills/` bundle onto a host agent's native location ON DEMAND. It
        // touches no `.track` store, so it dispatches alongside `init` (before store resolution).
        return cmdInstallSkills(rest, io)
      case 'workspace-id':
        // Prints the durable, multi-worktree workspace id (WP4) for the repo at `--cwd` (default
        // io.cwd). A PURE read of git metadata — touches no `.track` store, so it dispatches here
        // alongside `init`/`install-skills`, before store resolution.
        return cmdWorkspaceId(rest, io)
      case 'events-contains':
        // PURE record-only event-id containment (DESIGN Lot B, B0b) over two EXPLICIT `.track` log
        // PATHS. Git-free AND store-free: it never resolves a `.track` dir (the paths are supplied),
        // so it dispatches here alongside install-skills/workspace-id, before store resolution.
        return cmdEventsContains(rest, io)
      // READ commands SERVE-EMPTY (launch/serve alignment): they resolve via the non-throwing
      // `resolveTrackDirOrNull`, so an unadopted repo yields rc=0 + an honest-empty view + a stderr
      // `track init` hint, never a boot crash. NEVER creates. A bad EXPLICIT override still throws
      // (user error → the outer catch → rc=1). The reader over a nonexistent log already reads empty.
      case 'report':
      case 'snapshot':
      case 'export-graph':
      case 'query':
      case 'validate':
      case 'scope':
      case 'focus':
      case 'audit':
      case 'workspace-activity': {
        const trackDir = resolveTrackDirOrNull(resolveOpts)
        if (trackDir === null) {
          io.err(
            `track: no .track resolved from ${io.cwd}. Run \`track init\` to create one ` +
              `(the ONLY command that does), or pass --track-dir / TRACK_DIR. Serving an empty view.\n`,
          )
        }
        // null ⇒ bind a NONEXISTENT cwd/.track/events.jsonl: reads return empty, and no write occurs
        // (reads never create), so nothing is materialized on disk.
        const ctx: Ctx = {
          io,
          eventsPath: trackDir !== null ? eventsPathOf(trackDir) : eventsPathOf(join(resolve(io.cwd), '.track')),
        }
        switch (cmd) {
          case 'report':
            return cmdReport(rest, ctx)
          case 'snapshot':
            return cmdSnapshot(rest, ctx)
          case 'export-graph':
            return cmdExportGraph(rest, ctx)
          case 'query':
            return cmdQuery(rest, ctx)
          case 'validate':
            return cmdValidate(rest, ctx, trackDir === null)
          case 'scope':
            return cmdScope(rest, ctx)
          case 'focus':
            // The ONLY async command (dynamic `import('../focus-vendor/index.js')`); it returns a Promise<number>
            // and OWNS its full error→rc map internally (the outer sync try/catch can't see async
            // rejections). `runCli` returns `number | Promise<number>`; `bin.ts` awaits it.
            return cmdFocus(rest, ctx, trackDir === null)
          case 'workspace-activity':
            return cmdWorkspaceActivity(rest, ctx)
          case 'audit':
            return cmdAudit(rest, ctx)
        }
        io.err(USAGE)
        return 2
      }
      // Every MUTATING command resolves the nearest-ancestor `.track` and FAILS LOUD if none exists. The
      // USAGE/rc=2 branch for an UNKNOWN command is reached BEFORE resolution (a typo must not be masked
      // by a "no .track" error), so `resolveTrackDir` runs only for a recognized command.
      case 'item':
      case 'decision':
      case 'blocker':
      case 'accept':
      case 'consolidate':
      case 'priority':
      case 'branch':
      case 'restructure':
      case 'ingest': {
        const ctx: Ctx = { io, eventsPath: eventsPathOf(resolveTrackDir(resolveOpts)) }
        switch (cmd) {
          case 'item':
            return cmdItem(rest, ctx)
          case 'restructure':
            return cmdRestructure(rest, ctx)
          case 'decision':
            return cmdDecision(rest, ctx)
          case 'blocker':
            return cmdBlocker(rest, ctx)
          case 'accept':
            return cmdAccept(rest, ctx)
          case 'consolidate':
            return cmdConsolidate(rest, ctx)
          case 'priority':
            return cmdPriority(rest, ctx)
          case 'branch':
            return cmdBranch(rest, ctx)
          case 'ingest':
            return cmdIngest(rest, ctx)
        }
        // unreachable — the outer case list and this inner switch are identical
        io.err(USAGE)
        return 2
      }
      default:
        io.err(USAGE)
        return 2
    }
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function rowsOut(rows: unknown[], format: Format, io: CliIO): void {
  io.out(format === 'json' ? `${JSON.stringify(rows, null, 2)}\n` : formatRows(rows as never, format))
}

/**
 * `track workspace-id [--cwd <path>]` — print the durable, machine- & path-independent workspace id
 * (WP4) for the git repo at `--cwd` (default the CLI cwd). On a git repo it prints `ws:<sha256>` (rc=0);
 * a non-git dir is out of scope, so it prints an honest stderr line + rc=1 (no machine+path fallback).
 * Touches no `.track` store.
 */
function cmdWorkspaceId(args: string[], io: CliIO): number {
  const { flags } = parseFlags(args)
  const target = opt(flags, 'cwd') ?? io.cwd
  const cwd = isAbsolute(target) ? target : resolve(io.cwd, target)
  const id = durableWorkspaceId(cwd)
  if (id === undefined) {
    io.err(`track: not a git repo — no durable workspace id (${cwd})\n`)
    return 1
  }
  io.out(`${id}\n`)
  return 0
}

function cmdItem(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const sub = args[0]
  const { positional, flags } = parseFlags(args.slice(1))
  const track = writeTrack(ctx)
  if (sub === 'new') {
    const id = track.createItem({
      kind: oneOf(req(flags, 'kind'), ITEM_KINDS, '--kind') as ItemKind,
      title: req(flags, 'title'),
      workspace: req(flags, 'workspace'),
      ...(opt(flags, 'body') !== undefined ? { body: req(flags, 'body') } : {}),
      ...(opt(flags, 'parent') !== undefined ? { parentId: req(flags, 'parent') } : {}),
      ...(opt(flags, 'role') !== undefined ? { role: oneOf(req(flags, 'role'), ITEM_ROLES, '--role') as ItemRole } : {}),
      ...(opt(flags, 'accountable') !== undefined ? { accountable: req(flags, 'accountable') } : {}),
      ...(opt(flags, 'responsible') !== undefined
        ? { responsible: req(flags, 'responsible').split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
      ...(opt(flags, 'engagement-ref') !== undefined ? { engagementRef: req(flags, 'engagement-ref') } : {}),
    })
    io.out(`${id}\n`)
    return 0
  }
  if (sub === 'reparent') {
    // `--parent <pid>` moves; `--detach` (or neither) detaches to root (Workpackages §2).
    const detach = flags['detach'] === true
    const parent = opt(flags, 'parent')
    if (parent !== undefined && detach) {
      throw new DomainError('item reparent: use --parent <pid> OR --detach, not both')
    }
    track.reparentItem(positional[0]!, detach ? undefined : parent)
    io.out('ok\n')
    return 0
  }
  if (sub === 'set-raci') {
    const accountable = opt(flags, 'accountable')
    const responsible = opt(flags, 'responsible')
    if (accountable === undefined && responsible === undefined) {
      throw new DomainError('item set-raci requires --accountable and/or --responsible')
    }
    const clientToken = opt(flags, 'client-token')
    if (clientToken !== undefined && store(ctx).readAll().some((event) => event.clientToken === clientToken)) {
      io.out('no-op: client-token already applied\n')
      return 0
    }
    track.setRaci(positional[0]!, {
      ...(accountable !== undefined ? { accountable } : {}),
      ...(responsible !== undefined
        ? { responsible: responsible.split(',').map((s) => s.trim()) }
        : {}),
    }, clientToken)
    io.out('ok\n')
    return 0
  }
  if (sub === 'scope-declare') {
    // Scope §B(a) — declare INERT path-scope globs on a WP/spec-phase. A comma-separated glob list per
    // axis (`--allowed`/`--forbidden`/`--conditional`), OR a `--scope <json>` object; the two are
    // mutually exclusive. The facade validates the shape fail-closed (assertScopeDecl) and rejects a
    // non-role item. track STORES globs, NEVER matches them.
    const globs = (v: string | undefined): string[] | undefined =>
      v === undefined ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean)
    const jsonInput = opt(flags, 'scope')
    let scope: ScopeDecl
    if (jsonInput !== undefined) {
      if (opt(flags, 'allowed') !== undefined || opt(flags, 'forbidden') !== undefined || opt(flags, 'conditional') !== undefined) {
        throw new DomainError('item scope-declare: use --scope <json> OR --allowed/--forbidden/--conditional, not both')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonInput)
      } catch {
        throw new DomainError('item scope-declare: --scope must be valid JSON')
      }
      scope = parsed as ScopeDecl
    } else {
      const allowed = globs(opt(flags, 'allowed'))
      const forbidden = globs(opt(flags, 'forbidden'))
      const conditional = globs(opt(flags, 'conditional'))
      scope = {
        ...(allowed !== undefined ? { allowed } : {}),
        ...(forbidden !== undefined ? { forbidden } : {}),
        ...(conditional !== undefined ? { conditional } : {}),
      }
    }
    track.declareScope(positional[0]!, scope)
    io.out('ok\n')
    return 0
  }
  if (sub === 'spec-amend') {
    // M5 (canevas) — record ONE owner-approved LIVE spec amendment (a verbatim JsonPatch + opaque
    // baseHash/resultHash integrity tags) on the existing item aggregate. `--patch <json>` is a JsonPatch
    // array (parsed here only to JSON, NEVER applied/validated by track); `amendSpec` validates the shape
    // fail-closed (assertSpecAmend). `--client-token` gives append-once idempotency. track records the
    // amendment, NEVER mutates a spec field destructively (the amendment trace IS the value).
    const itemId = positional[0]!
    let patch: unknown
    try {
      patch = JSON.parse(req(flags, 'patch'))
    } catch {
      throw new DomainError('item spec-amend: --patch must be valid JSON (a JsonPatch array)')
    }
    const decisionId = opt(flags, 'decision-id')
    const liveDocRef = opt(flags, 'live-doc-ref')
    const proposalRef = opt(flags, 'proposal-ref')
    const summary = opt(flags, 'summary')
    const amend = {
      itemId,
      baseHash: req(flags, 'base-hash'),
      resultHash: req(flags, 'result-hash'),
      patch: patch as never,
      ...(decisionId !== undefined ? { decisionId } : {}),
      ...(liveDocRef !== undefined ? { liveDocRef } : {}),
      ...(proposalRef !== undefined ? { proposalRef } : {}),
      ...(summary !== undefined ? { summary } : {}),
    }
    const clientToken = opt(flags, 'client-token')
    // Idempotency (v2.3c) at the CLI boundary (mirrors `decision add-artifact`): the facade stamps the token
    // but does not itself dedup, so a retried --client-token is skipped HERE or it would append twice.
    if (clientToken !== undefined && store(ctx).readAll().some((e) => e.clientToken === clientToken)) {
      io.out('no-op: client-token already applied\n')
      return 0
    }
    track.amendSpec(itemId, amend, clientToken)
    io.out('ok\n')
    return 0
  }
  if (sub === 'set-role') {
    // A2 — BOUNDED container↔container role mutation (workpackage↔stream). `setRole` re-checks the item is a
    // mutable container AND re-runs the whole-neighborhood nesting invariant fail-closed before any append.
    track.setRole(positional[0]!, oneOf(positional[1], ROLE_CHANGE_TARGETS, 'set-role') as ItemRole)
    io.out('ok\n')
    return 0
  }
  if (sub === 'spec') {
    track.setSpec(positional[0]!, oneOf(positional[1], SPEC_TARGETS, 'spec') as SpecStatus)
    io.out('ok\n')
    return 0
  }
  if (sub === 'realize') {
    track.setRealization(positional[0]!, oneOf(positional[1], REALIZE_TARGETS, 'realize') as Realization)
    io.out('ok\n')
    return 0
  }
  if (sub === 'reopen') {
    // Regression expression — reopen a terminally-closed item (done/cancelled → in-progress) WITH its motive.
    // Deliberately a SEPARATE verb from `item realize`, which keeps done/cancelled terminal. `--client-token`
    // gives append-once idempotency at the CLI boundary (mirrors `assign-code`/`spec-amend`): without it a
    // retry would hit "not closed" — the item is already reopened — instead of reading as the no-op it is.
    const itemId = positional[0]!
    const motive = oneOf(req(flags, 'motive'), REOPEN_MOTIVE_VALUES, '--motive') as ReopenMotive
    const reason = req(flags, 'reason')
    const clientToken = opt(flags, 'client-token')
    if (clientToken !== undefined && store(ctx).readAll().some((e) => e.clientToken === clientToken)) {
      io.out('no-op: client-token already applied\n')
      return 0
    }
    track.reopenItem(itemId, { motive, reason }, clientToken)
    io.out(`reopened ${itemId} (${motive})\n`)
    return 0
  }
  if (sub === 'assign-code') {
    // A1 (wp-codes) — assign a durable, re-assignable display `code` to a workpackage/spec-phase (the
    // canonical write; `assignCode` enforces roster-global uniqueness, re-asserted under the lock).
    // `--client-token` gives append-once idempotency (mirrors `spec-amend`'s CLI-boundary dedup).
    const itemId = positional[0]!
    const code = req(flags, 'code')
    const clientToken = opt(flags, 'client-token')
    if (clientToken !== undefined && store(ctx).readAll().some((e) => e.clientToken === clientToken)) {
      io.out('no-op: client-token already applied\n')
      return 0
    }
    track.assignCode(itemId, code, clientToken)
    io.out(`assigned code "${code}" to ${itemId}\n`)
    return 0
  }
  if (sub === 'show') {
    io.out(`${JSON.stringify(track.state().items.get(positional[0]!) ?? null, null, 2)}\n`)
    return 0
  }
  if (sub === 'ls') {
    const rows = track.query(
      {
        ...(opt(flags, 'kind') !== undefined ? { kind: oneOf(req(flags, 'kind'), ITEM_KINDS, '--kind') } : {}),
        ...(opt(flags, 'workspace') !== undefined ? { workspace: req(flags, 'workspace') } : {}),
      },
      { baselineCommit: resolveCommit(io.cwd, opt(flags, 'commit')) },
    )
    rowsOut(rows, fmt(flags), io)
    return 0
  }
  io.err('usage: track item <new|reparent|set-raci|set-role|scope-declare|spec-amend|spec|realize|assign-code|show|ls>\n')
  return 2
}

/**
 * DESIGN R4 — `track audit [--format json|text]`: the deterministic structural findings (read-only). Serves
 * empty on an unadopted repo (the reader over a nonexistent log reads empty).
 */
function cmdAudit(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { flags } = parseFlags(args)
  const findings = new TrackReader(ctx.eventsPath).audit()
  if ((opt(flags, 'format') ?? 'text') === 'json') {
    io.out(`${JSON.stringify(findings, null, 2)}\n`)
    return 0
  }
  if (findings.length === 0) {
    io.out('no findings\n')
    return 0
  }
  for (const f of findings) {
    const subject = f.itemId ?? f.wpRootId ?? (f.itemIds !== undefined ? f.itemIds.join(',') : f.workspace) ?? ''
    io.out(`[${f.severity}] ${f.kind} ${subject}: ${f.detail}\n`)
  }
  return 0
}

/**
 * DESIGN R5 — `track restructure apply --plan <plan.json>`: apply a RATIFIED restructuring plan (the only
 * caller that opens an `item.restructure`-granting channel). Append-only + idempotent (clientToken dedup);
 * the post-apply intention/closure/orphan GATE throws a DomainError (→ rc=1) on any violation.
 */
function cmdRestructure(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const sub = args[0]
  const { flags } = parseFlags(args.slice(1))
  if (sub !== 'apply') {
    io.err('usage: track restructure apply --plan <plan.json>\n')
    return 2
  }
  const planFile = req(flags, 'plan')
  const raw = readFileSync(isAbsolute(planFile) ? planFile : join(io.cwd, planFile), 'utf8')
  let plan: RestructurePlan
  try {
    plan = JSON.parse(raw) as RestructurePlan
  } catch {
    throw new DomainError('restructure apply: --plan must be a valid JSON plan file')
  }
  const res = applyRestructurePlan(ctx.eventsPath, plan, { by: cliActor(io.cwd) })
  io.out(`applied ${res.applied} edge(s) of ${res.edges} (${res.alreadyApplied} already applied) [plan ${res.planHash}]\n`)
  return 0
}

function cmdDecision(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const sub = args[0]
  const { positional, flags } = parseFlags(args.slice(1))
  const track = writeTrack(ctx)
  if (sub === 'new') {
    const id = track.createDecision({
      decisionKind: oneOf(req(flags, 'kind'), DECISION_KINDS, '--kind') as DecisionKind,
      title: req(flags, 'title'),
      workspace: req(flags, 'workspace'),
      targets: req(flags, 'targets').split(',').map((s) => s.trim()).filter(Boolean),
      dossier: {
        context: req(flags, 'context'),
        options: dossierOptions(req(flags, 'options-json')),
        qa: [],
        recommendation: { optionId: req(flags, 'recommendation'), rationale: req(flags, 'rationale') },
      },
      ...(opt(flags, 'accountable') !== undefined ? { accountable: req(flags, 'accountable') } : {}),
      ...(opt(flags, 'engagement-ref') !== undefined ? { engagementRef: req(flags, 'engagement-ref') } : {}),
    })
    io.out(`${id}\n`)
    return 0
  }
  if (sub === 'outcome') {
    track.setOutcome(positional[0]!, oneOf(positional[1], ['deferred'], 'outcome') as Outcome)
    io.out('ok\n')
    return 0
  }
  if (sub === 'dossier') {
    // Merge: a context-only edit preserves a structured dossier. A legacy dossier must provide the
    // full options/recommendation triplet here; the facade validates it fail-closed.
    const current = track.state().decisions.get(positional[0]!)?.dossier
    if (current === undefined) throw new DomainError(`unknown decision ${positional[0]!}`)
    const optionJson = opt(flags, 'options-json')
    const recommendation = opt(flags, 'recommendation')
    const rationale = opt(flags, 'rationale')
    if ((recommendation === undefined) !== (rationale === undefined)) {
      throw new DomainError('--recommendation and --rationale must be supplied together')
    }
    if (optionJson !== undefined && recommendation === undefined && current.recommendation === undefined) {
      throw new DomainError('migrating a legacy dossier requires --recommendation and --rationale')
    }
    track.reviseDossier(positional[0]!, {
      ...current,
      context: opt(flags, 'context') ?? current.context,
      ...(optionJson !== undefined ? { options: dossierOptions(optionJson) } : {}),
      ...(recommendation !== undefined ? { recommendation: { optionId: recommendation, rationale: rationale! } } : {}),
    })
    io.out('ok\n')
    return 0
  }
  if (sub === 'select') {
    const outcome = opt(flags, 'outcome')
    track.selectDecisionOption(
      positional[0]!,
      positional[1]!,
      outcome === undefined ? 'go' : oneOf(outcome, ['go', 'no-go'], '--outcome') as 'go' | 'no-go',
    )
    io.out('ok\n')
    return 0
  }
  if (sub === 'disposition') {
    track.setDisposition(
      positional[0]!,
      oneOf(positional[1], GATES, 'gate') as Gate,
      oneOf(positional[2], DISPOSITIONS, 'disposition') as Exclude<Disposition, 'completed'>,
    )
    io.out('ok\n')
    return 0
  }
  if (sub === 'add-artifact') {
    // Append ONE record-only DossierArtifact (M5 §3.2) — a pointer to an h2a decision dossier / rendered
    // view / mockup. The CLI assembles the discriminated branch from flags by --kind; `addDecisionArtifact`
    // validates fail-closed (assertDossierArtifact), so a malformed union throws → rc=1. `--client-token`
    // gives append-once idempotency. The CLI relays comprehension[] only via the ingest seam, never here:
    // a local human deciding in chat is NOT a signed h2a attestation, so the CLI does not fake one.
    const decisionId = positional[0]!
    const kind = oneOf(opt(flags, 'kind'), DOSSIER_ARTIFACT_KINDS, '--kind')
    // Assemble the discriminated branch from flags by --kind, but DON'T pre-validate the branch-specific
    // fields here: `assertDossierArtifact` (inside addDecisionArtifact) is the SINGLE fail-closed authority
    // for the union (it owns the exact "requires a dossierHash"/"requires a viewRef" wording), so a missing
    // field surfaces the union error verbatim — CLI/facade/ingest stay in lockstep. `as DossierArtifact` is
    // the assembly cast; the runtime check is the validator's.
    const artifact = {
      kind,
      ...(opt(flags, 'negotiation-ref') !== undefined ? { negotiationRef: opt(flags, 'negotiation-ref') } : {}),
      ...(opt(flags, 'dossier-hash') !== undefined ? { dossierHash: opt(flags, 'dossier-hash') } : {}),
      ...(opt(flags, 'view-ref') !== undefined ? { viewRef: opt(flags, 'view-ref') } : {}),
      ...(opt(flags, 'source-dossier-hash') !== undefined ? { sourceDossierHash: opt(flags, 'source-dossier-hash') } : {}),
      ...(opt(flags, 'label') !== undefined ? { label: opt(flags, 'label') } : {}),
    } as DossierArtifact
    const clientToken = opt(flags, 'client-token')
    // Idempotency (v2.3c) at the CLI boundary: the facade stamps the token onto the event but does NOT
    // itself dedup (that is the ingest seam's job; the CLI is the local primary writer). So a retried
    // `--client-token` must be skipped HERE, or it would append twice. Mirror the seam: if any prior event
    // already carries this token, it landed — no-op, rc=0. Touches no contract and no write guard.
    if (clientToken !== undefined && store(ctx).readAll().some((e) => e.clientToken === clientToken)) {
      io.out('no-op: client-token already applied\n')
      return 0
    }
    track.addDecisionArtifact(decisionId, artifact, clientToken)
    io.out('ok\n')
    return 0
  }
  io.err('usage: track decision <new|outcome|select|dossier|disposition|add-artifact>\n')
  return 2
}

function cmdBlocker(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const sub = args[0]
  const { positional, flags } = parseFlags(args.slice(1))
  const track = writeTrack(ctx)
  if (sub === 'raise') {
    const rawOwner = opt(flags, 'owner')
    const owner = rawOwner?.trim()
    if (rawOwner !== undefined && owner === '') {
      throw new DomainError('blocker raise: --owner must be a non-empty actor')
    }
    const id = track.openBlocker({
      targetId: req(flags, 'target'),
      kind: oneOf(req(flags, 'kind'), BLOCKER_KINDS, '--kind') as BlockerKind,
      ...(opt(flags, 'ref') !== undefined ? { ref: req(flags, 'ref') } : {}),
      reason: opt(flags, 'reason') ?? '',
      ...(opt(flags, 'rule') !== undefined
        ? { resolutionRule: oneOf(req(flags, 'rule'), RESOLUTION_RULES, '--rule') as ResolutionRule }
        : {}),
      ...(opt(flags, 'scope') !== undefined
        ? { scope: oneOf(req(flags, 'scope'), BLOCKER_SCOPES, '--scope') as BlockerScope }
        : {}),
      ...(opt(flags, 'engagement-ref') !== undefined ? { engagementRef: req(flags, 'engagement-ref') } : {}),
      ...(owner !== undefined ? { owner } : {}),
    })
    io.out(`${id}\n`)
    return 0
  }
  if (sub === 'resolve') {
    track.resolveBlocker(positional[0]!)
    io.out('ok\n')
    return 0
  }
  if (sub === 'resolve-external') {
    // A local CLI human is the trust root — explicitly unscoped (resolves the engagement's deps everywhere).
    // WHITELISTED no-op: 0 matches is a genuine no-op (nothing to resolve / idempotent retry) and is the
    // ONLY case where this command persists nothing — say so explicitly rather than implying a write.
    const ids = track.resolveExternalDependency(req(flags, 'engagement-ref'), 'all-workspaces')
    io.out(
      ids.length === 0
        ? `no-op: 0 external dependency blocker(s) matched\n`
        : `resolved ${ids.length} external dependency blocker(s)\n`,
    )
    return 0
  }
  io.err('usage: track blocker <raise|resolve|resolve-external>\n')
  return 2
}

function cmdAccept(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const sub = args[0]
  const { positional, flags } = parseFlags(args.slice(1))
  const track = writeTrack(ctx)
  if (sub === 'criterion') {
    io.out(`${track.addCriterion(positional[0]!, req(flags, 'statement'))}\n`)
    return 0
  }
  if (sub === 'link') {
    io.out(
      `${track.linkEvidence(positional[0]!, oneOf(req(flags, 'kind'), EVIDENCE_KINDS, '--kind') as EvidenceKind, req(flags, 'locator'))}\n`,
    )
    return 0
  }
  if (sub === 'run') {
    const commit = resolveCommit(io.cwd, opt(flags, 'commit'))
    const env = opt(flags, 'env') ?? 'ci'
    const runner = opt(flags, 'runner') ?? 'cli'
    const from = opt(flags, 'from')
    if (from !== undefined) {
      const content = readFileSync(isAbsolute(from) ? from : join(io.cwd, from), 'utf8')
      const format = oneOf(req(flags, 'format'), FROM_FORMATS, '--format')
      // WHITELISTED no-op: an idempotent re-ingest (every asserted result already latest in the log)
      // records nothing — say "no-op" rather than "ingested 0 run(s)", which reads like a silent write.
      const n = track.ingestRuns(content, format, { commit, env, runner })
      io.out(n === 0 ? `no-op: 0 run(s) ingested (already current)\n` : `ingested ${n} run(s)\n`)
      return 0
    }
    track.recordRun(positional[0]!, {
      commit,
      env,
      runner,
      result: oneOf(req(flags, 'result'), RESULTS, '--result') as RunResult,
    })
    io.out('ok\n')
    return 0
  }
  if (sub === 'waive') {
    track.waive(positional[0]!, req(flags, 'reason'))
    io.out('ok\n')
    return 0
  }
  io.err('usage: track accept <criterion|link|run|waive>\n')
  return 2
}

/**
 * `track consolidate --items <id,id> --commit <mergeCommit> [--client-token <t>]` — the squash/rebase HEAL
 * (acceptance-freshness lifecycle). The `--items` are CALLER-AUTHORITATIVE (track has no branch→item link);
 * for each done item it appends `realization.anchored{reason:'consolidate'}` + re-stamps its pass runs at the
 * resolved merge commit (append-only; no mutation). `--client-token` gives append-once idempotency.
 */
function cmdConsolidate(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { flags } = parseFlags(args)
  const track = writeTrack(ctx)
  const items = req(flags, 'items')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (items.length === 0) throw new DomainError('consolidate: --items must list at least one itemId')
  const commit = resolveCommit(io.cwd, req(flags, 'commit'))
  const clientToken = opt(flags, 'client-token')
  // Mirror the seam idempotency: a retried --client-token must be skipped HERE (the consolidate batch is
  // also deduped under the store lock, but the explicit pre-check gives an honest "no-op" line).
  if (clientToken !== undefined && store(ctx).readAll().some((e) => e.clientToken === clientToken)) {
    io.out('no-op: client-token already applied\n')
    return 0
  }
  track.consolidate(items, commit, clientToken)
  io.out('ok\n')
  return 0
}

function cmdPriority(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const sub = args[0]
  const { positional, flags } = parseFlags(args.slice(1))
  const track = writeTrack(ctx)
  if (sub === 'assess') {
    const a = track.assessPriority(positional[0]!, {
      userBusinessValue: num(flags, 'ubv'),
      timeCriticality: num(flags, 'tc'),
      riskReductionOpportunityEnablement: num(flags, 'rr'),
      jobSize: num(flags, 'js'),
    })
    io.out(`wsjf score ${a.score}\n`)
    return 0
  }
  io.err('usage: track priority assess <itemId> --ubv --tc --rr --js\n')
  return 2
}

function cmdReport(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { positional, flags } = parseFlags(args)
  if (positional.length > 0) throw new DomainError(`unexpected report argument(s): ${positional.join(' ')}`)
  for (const name of ['commit', 'format', 'level', 'width', 'resolve', 'now', 'scope']) assertValueFlag(flags, name)
  const scope = opt(flags, 'scope')
  // Criterion 10b — the one documented command that turns a short report handle back into an item.
  if (opt(flags, 'resolve') !== undefined) {
    assertOnlyFlags(flags, ['resolve', 'scope', 'commit', 'require-accepted'])
    io.out(
      resolveHandle(
        new TrackReader(ctx.eventsPath),
        {
          baselineCommit: resolveCommit(io.cwd, opt(flags, 'commit')),
          requireAccepted: assertBooleanFlag(flags, 'require-accepted'),
        },
        req(flags, 'resolve'),
        scope,
      ),
    )
    return 0
  }
  const raw = assertBooleanFlag(flags, 'raw')
  if (raw) {
    assertOnlyFlags(flags, ['raw', 'commit', 'require-accepted', 'format'])
    return emitSnapshot(flags, ctx, true)
  }
  // Scope §A/§B — `--level <spec|plan|wp|lot|task>` switches to the status(level) projection.
  // Otherwise the WP/table conductor is the default; `--flat` is the legacy opt-out.
  if (opt(flags, 'level') !== undefined) {
    assertOnlyFlags(flags, ['level', 'commit', 'require-accepted', 'format'])
    assertBooleanFlag(flags, 'require-accepted')
    io.out(
      statusText(
        new TrackReader(ctx.eventsPath),
        oneOf(req(flags, 'level'), STATUS_LEVELS, '--level'),
        {
          baselineCommit: resolveCommit(io.cwd, opt(flags, 'commit')),
          requireAccepted: assertBooleanFlag(flags, 'require-accepted'),
        },
        fmt(flags),
      ),
    )
    return 0
  }
  assertOnlyFlags(flags, [
    'commit', 'require-accepted', 'decisions', 'active-roster', 'wp', 'flat', 'inline', 'width', 'format', 'now',
    'sub-wp', 'scope',
  ])
  const rawFormat = opt(flags, 'format')
  if (rawFormat !== undefined && !['json', 'text', 'md', 'html'].includes(rawFormat)) {
    throw new DomainError('--format must be one of: json|text|md|html')
  }
  const widthArg = opt(flags, 'width')
  const inlineFlag = assertBooleanFlag(flags, 'inline')
  const inline = inlineFlag || widthArg !== undefined
  const format = oneOf(rawFormat ?? 'text', ['json', 'text', 'md', 'html'], '--format')
  if (inline && format !== 'text') throw new DomainError('--inline/--width accepts no --format, or --format text')
  const requireAccepted = assertBooleanFlag(flags, 'require-accepted')
  const requestedDecisions = assertBooleanFlag(flags, 'decisions')
  const activeRoster = assertBooleanFlag(flags, 'active-roster')
  const wp = assertBooleanFlag(flags, 'wp')
  const flat = assertBooleanFlag(flags, 'flat')
  if (wp && flat) throw new DomainError('--wp and --flat are mutually exclusive')
  if (format === 'json' && flat) throw new DomainError('--flat is only meaningful for text or md reports')
  if (format === 'html' && flat) throw new DomainError('--format html is always the deterministic conductor and rejects --flat')
  if (scope !== undefined && flat) throw new DomainError('--scope requires the four-section conductor and rejects --flat')
  if (scope !== undefined && activeRoster) throw new DomainError('--scope includes the complete subtree and rejects --active-roster')
  let width: number | undefined
  if (widthArg !== undefined) {
    if (!/^\d+$/u.test(widthArg)) throw new DomainError('--width must be an integer in [40,240]')
    width = Number(widthArg)
    if (width < 40 || width > 240) throw new DomainError('--width must be an integer in [40,240]')
  }
  if (scope !== undefined && inline) throw new DomainError('--scope preserves the validated report shape and rejects --inline/--width')
  if (scope !== undefined && (format === 'md' || format === 'html')) {
    throw new DomainError('--scope currently supports the owner text report and JSON projection only')
  }
  // Every format is a deterministic read over the folded log. The default human view is
  // the conductor; --flat explicitly requests the legacy bucket projection. JSON preserves
  // its established flat machine contract unless --wp is explicit, so --flat is rejected there
  // instead of being silently accepted as a no-op. Contextual prose remains advisory agent work;
  // no report format invokes an adapter, gateway, subprocess, or model.
  const options = {
    baselineCommit: resolveCommit(io.cwd, opt(flags, 'commit')),
    requireAccepted,
    // The owner-facing conductor always classifies decision dossiers. JSON keeps its
    // established opt-in decision payload, while --flat retains the legacy opt-in.
    decisions: scope !== undefined || requestedDecisions || (!flat && format !== 'json'),
    wpTree: scope !== undefined || wp || (!flat && format !== 'json'),
    activeRoster,
  }
  // Criterion 21 — the report's window runs from the first recorded event to NOW. The clock is injected
  // HERE (the same boundary pattern as `workspace-activity --now`) so the library stays clockless and a
  // committed fixture stays byte-reproducible by pinning `--now`.
  const nowArg = opt(flags, 'now')
  if (nowArg !== undefined && Number.isNaN(new Date(nowArg).getTime())) {
    throw new DomainError('--now must be an ISO timestamp')
  }
  const now = nowArg ?? new Date().toISOString()
  // Criterion 25 — the EXPLICIT owner request for sub-WP rows. Without it the reading unit follows the
  // window: the WP on a long one, the sub-level on a short one.
  const subWp = assertBooleanFlag(flags, 'sub-wp')
  const reader = new TrackReader(ctx.eventsPath)
  if (inline) {
    io.out(reportInline(reader, options, width === undefined ? {} : { width }))
  } else if (format === 'html') {
    io.out(reportHtml(reader, options, now, subWp))
  } else {
    io.out(reportText(reader, options, format, now, subWp, scope))
  }
  return 0
}

function emitSnapshot(flags: Flags, ctx: Ctx, allowRaw: boolean): number {
  const { io } = ctx
  assertOnlyFlags(flags, allowRaw ? ['raw', 'commit', 'require-accepted', 'format'] : ['commit', 'require-accepted', 'format'])
  const format = oneOf(opt(flags, 'format') ?? 'json', ['json', 'text', 'md'], '--format')
  const baselineInput = opt(flags, 'commit') ?? 'HEAD'
  const resolvedCommit = resolveCommit(io.cwd, baselineInput)
  const reader = new TrackReader(ctx.eventsPath)
  io.out(
    renderSnapshot(
      reader.snapshot({
        baselineInput,
        resolvedCommit,
        requireAccepted: assertBooleanFlag(flags, 'require-accepted'),
      }),
      format,
    ),
  )
  return 0
}

function cmdSnapshot(args: string[], ctx: Ctx): number {
  const { positional, flags } = parseFlags(args)
  if (positional.length > 0) throw new DomainError(`unexpected snapshot argument(s): ${positional.join(' ')}`)
  for (const name of ['commit', 'format']) assertValueFlag(flags, name)
  return emitSnapshot(flags, ctx, false)
}

function cmdExportGraph(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { flags } = parseFlags(args)
  const reader = new TrackReader(ctx.eventsPath)
  const fragment = reader.graphExport({
    repoKey: opt(flags, 'repo-key') ?? graphRepoKey(io.cwd),
    sourceId: opt(flags, 'source-id') ?? durableWorkspaceId(io.cwd) ?? 'track',
    observedAt: opt(flags, 'observed-at') ?? new Date().toISOString(),
  })
  io.out(`${JSON.stringify(fragment, null, 2)}\n`)
  return 0
}

function cmdQuery(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { flags } = parseFlags(args)
  const reader = new TrackReader(ctx.eventsPath)
  io.out(
    queryText(
      reader,
      {
      ...(opt(flags, 'kind') !== undefined ? { kind: oneOf(req(flags, 'kind'), ITEM_KINDS, '--kind') } : {}),
      ...(opt(flags, 'role') !== undefined ? { role: oneOf(req(flags, 'role'), ITEM_ROLES, '--role') as ItemRole } : {}),
      ...(opt(flags, 'workspace') !== undefined ? { workspace: req(flags, 'workspace') } : {}),
      ...(opt(flags, 'bucket') !== undefined ? { bucket: oneOf(req(flags, 'bucket'), BUCKETS_ARG, '--bucket') as Bucket } : {}),
      ...(opt(flags, 'realization') !== undefined
        ? { realization: oneOf(req(flags, 'realization'), REALIZATIONS, '--realization') as Realization }
        : {}),
      ...(opt(flags, 'acceptance') !== undefined
        ? { acceptance: oneOf(req(flags, 'acceptance'), ACCEPTANCES, '--acceptance') as never }
        : {}),
      },
      { baselineCommit: resolveCommit(io.cwd, opt(flags, 'commit')) },
      fmt(flags),
    ),
  )
  return 0
}

/**
 * List decision dossiers without a renderer cap. `structure` makes the prose-only migration state explicit;
 * only a structured dossier has durable alternatives + a durable recommendation to render as a choice.
 */
function cmdDecisionLs(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { positional, flags } = parseFlags(args.slice(1))
  if (positional.length > 0) throw new DomainError(`unexpected decision ls argument(s): ${positional.join(' ')}`)
  assertOnlyFlags(flags, ['workspace', 'outcome', 'format', 'commit'])
  for (const name of ['workspace', 'outcome', 'format', 'commit']) assertValueFlag(flags, name)
  const format = fmt(flags)
  const baselineCommit = resolveCommit(io.cwd, opt(flags, 'commit'))
  const reader = new TrackReader(ctx.eventsPath)
  const workspace = opt(flags, 'workspace')
  const outcome = opt(flags, 'outcome') !== undefined ? oneOf(req(flags, 'outcome'), DECISION_OUTCOMES, '--outcome') : undefined
  const rows = reader.decisionDossiers({ baselineCommit })
    .filter((decision) => (workspace === undefined || decision.workspace === workspace) && (outcome === undefined || decision.outcome === outcome))
    .map(({ dossier, ...decision }) => ({
      ...decision,
      options: dossier.options,
      ...(dossier.recommendation !== undefined ? { recommendation: dossier.recommendation } : {}),
    }))
  if (format === 'json') {
    io.out(`${JSON.stringify(rows, null, 2)}\n`)
    return 0
  }
  const lines = rows.map((decision) => {
    const safe = (value: string): string => displayText(value, format)
    const recommendation = safe(decision.recommendation?.optionId ?? '-')
    const line = `${safe(decision.id)} · ${safe(decision.workspace)} · ${safe(decision.outcome)} · ${safe(decision.structure ?? 'unstructured')} · options:${decision.options.length} · recommendation:${recommendation} — ${safe(decision.title)}`
    return format === 'md' ? `- ${line}` : line
  })
  io.out(lines.length > 0 ? `${lines.join('\n')}\n` : '')
  return 0
}

/**
 * `track workspace-activity --workspace <id> [--baseline-commit <sha>] [--now <iso>] [--idle-ms <ms>]
 * [--format json|text]` — a poll surface over the shipped, CLOCKLESS `TrackReader.workspaceActivity`
 * (0.10.4). h2a is itself an MCP stdio server, so it can't be a client of track's MCP — it shells out
 * to this verb to poll one workspace for conductor-launch gating. A pure READ (no append); routed
 * through the serve-empty path so an unadopted repo yields honest-empty + rc=0, never a crash.
 *
 * `--baseline-commit` resolves via `resolveCommit` (so `--baseline-commit HEAD` works post-0.10.8); the
 * omitted default is the current HEAD SHA. `--now` defaults to the system clock READ AT THE CLI BOUNDARY
 * — the library stays clockless (same pattern as `report` resolving git HEAD at the boundary). `--idle-ms`
 * is omitted unless passed, so the method's own 24h default applies.
 */
function cmdWorkspaceActivity(args: string[], ctx: Ctx): number {
  const { io } = ctx
  const { flags } = parseFlags(args)
  const workspace = opt(flags, 'workspace')
  if (workspace === undefined) {
    io.err('usage: track workspace-activity --workspace <id> [--baseline-commit <sha>] [--now <iso>] [--idle-ms <ms>] [--format json|text]\n')
    return 2
  }
  const format = oneOf(opt(flags, 'format') ?? 'text', ['json', 'text'], '--format')
  const reader = new TrackReader(ctx.eventsPath)
  const activity = reader.workspaceActivity(workspace, {
    baselineCommit: resolveCommit(io.cwd, opt(flags, 'baseline-commit')),
    now: opt(flags, 'now') ?? new Date().toISOString(),
    ...(opt(flags, 'idle-ms') !== undefined ? { idleMs: num(flags, 'idle-ms') } : {}),
  })
  if (format === 'json') {
    io.out(`${JSON.stringify(activity)}\n`)
    return 0
  }
  // text: a readable summary — `pending: N`, each pending item, each stalled item, then `latestEventAt`.
  const lines = [`pending: ${activity.pending}`]
  for (const p of activity.pendingItems ?? []) lines.push(`pending-item ${p.bucket} ${p.id} ${p.title} [${p.realization}]`)
  for (const s of activity.stalled) lines.push(`${s.reason} ${s.id} ${s.title} (since ${s.since})`)
  lines.push(`latestEventAt: ${activity.latestEventAt ?? '-'}`)
  io.out(`${lines.join('\n')}\n`)
  return 0
}

/**
 * Minimal HTML entity escape for the focus HTML render hook — escapes the five XML-significant chars so
 * markdown prose injected into the document can't break out of its `<pre>` wrapper. focus's own
 * `defaultHtmlHooks` are NOT exported, so track supplies its own (no markdown/sanitizer lib in core).
 */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Render hooks the focus HTML renderer requires (focus carries NO marked/DOMPurify, and its
 * `defaultHtmlHooks` is not exported). `renderMarkdown` emits prose verbatim inside an escaped
 * `<pre>` (no markdown engine in track core); `sanitizeHtml` is identity — track's HTML is for a
 * trusted local-CLI surface, not untrusted network output. An L4/web host would supply real hooks.
 */
const HTML_HOOKS = {
  renderMarkdown: (md: string): string => `<pre class="focus-md-raw">${htmlEscape(md)}</pre>`,
  sanitizeHtml: (h: string): string => h,
}

/**
 * `track focus <decision-id> --workspace <w> [--format terminal|md|html] [--baseline-commit <sha>]` —
 * a READ-ONLY render of a track decision as a focus DecisionDossierDocument (focus@0.3.0 is itself
 * read-only). track resolves the store THE TRACK WAY (`ctx.eventsPath` — NO `--events-path`; track owns
 * store resolution via `--track-dir`/`TRACK_DIR`/ancestor-walk) and the baseline commit via `resolveCommit`,
 * then calls focus's `readDecisionDossier(eventsPath, {workspace, baselineCommit, decisionId}, readAt)` and
 * dispatches the render-core (terminal/md/html). It is the HOME of Focus (`stp focus` is a shortcut alias).
 *
 * ASYNC (the only such command): `../focus-vendor/index.js` is an `integrated dependency` consumed via dynamic
 * `import()`, so track's CORE stays publishable with ZERO knowledge of focus and `track focus` is an
 * additive, opt-in capability. A MODULE_NOT_FOUND (focus not installed) maps to rc=1 + an install hint.
 *
 * Error map (preserves focus's scriptable exit codes): missing decision-id/--workspace → 2 + usage;
 * `DecisionNotFoundError` → 3; `TrackContractMismatchError` → 4; focus-not-installed → 1 + hint; other → 1.
 */
async function cmdFocus(args: string[], ctx: Ctx, _noStore: boolean): Promise<number> {
  const { io } = ctx
  const FOCUS_USAGE = 'usage: track focus <decision-id> --workspace <w> [--format terminal|md|html] [--baseline-commit <sha>]\n'
  const { positional, flags } = parseFlags(args)
  try {
    assertOnlyFlags(flags, ['workspace', 'format', 'baseline-commit'])
    for (const name of ['workspace', 'format', 'baseline-commit']) assertValueFlag(flags, name)
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  // decision-id is positional + REQUIRED; --workspace is a REQUIRED flag (both gate at the CLI boundary
  // with rc=2 + usage, never reaching focus). Validate BEFORE the dynamic import so a usage error is
  // independent of whether focus is installed.
  const decisionId = positional[0]
  const workspace = opt(flags, 'workspace')
  if (decisionId === undefined || workspace === undefined) {
    io.err(FOCUS_USAGE)
    return 2
  }
  // `--format` is validated via the shared `oneOf` (CLI-boundary input check) BEFORE the import too, so a
  // bad format fails fast as a usage error rather than a render error.
  let format: 'terminal' | 'md' | 'html'
  try {
    format = oneOf(opt(flags, 'format') ?? 'terminal', ['terminal', 'md', 'html'], '--format')
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const baselineCommit = resolveCommit(io.cwd, opt(flags, 'baseline-commit'))
  const decision = new TrackReader(ctx.eventsPath)
    .report({ baselineCommit, decisions: true })
    .decisions
    ?.find((candidate) => candidate.id === decisionId)
  if (decision !== undefined && decision.workspace !== workspace) {
    io.err(`error: decision ${decisionId} belongs to workspace ${decision.workspace}, not ${workspace}\n`)
    return 3
  }

  // Load the focus render binding + core. focus is an integrated dependency → a MODULE_NOT_FOUND means the
  // integrated focus renderer is unavailable: map it to rc=1 + a helpful hint (NOT a stack trace).
  let focusTrack: typeof import('../focus-vendor/track/index.js')
  let core: typeof import('../focus-vendor/index.js')
  try {
    focusTrack = await import('../focus-vendor/track/index.js')
    core = await import('../focus-vendor/index.js')
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      io.err('error: rendering requires ../focus-vendor/index.js — run `npm i ../focus-vendor/index.js`\n')
      return 1
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  try {
    // PURE / read-only / clockless: `readAt` is supplied at the CLI boundary (track holds no clock), the
    // baseline commit resolves HEAD/refs/short-SHA → 40-char, and `ctx.eventsPath` is the single store.
    const doc = focusTrack.readDecisionDossier(
      ctx.eventsPath,
      { workspace, baselineCommit, decisionId },
      new Date().toISOString(),
    )
    const rendered =
      format === 'md' ? core.renderMd(doc) : format === 'html' ? core.renderHtml(doc, HTML_HOOKS) : core.renderTerminal(doc)
    io.out(rendered.endsWith('\n') ? rendered : `${rendered}\n`)
    return 0
  } catch (error) {
    // Preserve focus's scriptable exit codes: a missing decision is rc=3, an incompatible read contract
    // is rc=4 (both detected via `instanceof` from the focus/track import — same module, real classes).
    if (error instanceof focusTrack.DecisionNotFoundError) {
      io.err(`error: ${error.message}\n`)
      return 3
    }
    if (error instanceof focusTrack.TrackContractMismatchError) {
      io.err(`error: ${error.message}\n`)
      return 4
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

/**
 * `track scope validate --workspace <id> --baseline-commit <sha> [--content <path>] [--locator <l>]
 * [--claimed-item <id>] [--infer-delivered-out-of-scope] [--format json|text]` — Scope §B(b). A PURE,
 * read-only, fail-closed, ADVISORY validation over `TrackReader.scopeValidate`. Routed through the
 * serve-empty read path. The rc is ADVISORY: 0 even on semantic findings (it is NOT a commit gate);
 * non-zero ONLY when the sidecar is stale (fail-closed) or an error is thrown. `--content` is a FILE
 * path read at the CLI boundary (the library takes the content string); `--baseline-commit` resolves
 * via resolveCommit (so HEAD/refs work).
 */
function cmdScope(args: string[], ctx: Ctx): number {
  const { io } = ctx
  if (args[0] !== 'validate') {
    io.err('usage: track scope validate --workspace <id> --baseline-commit <sha> [--content <path>] [--locator <l>] [--claimed-item <id>] [--infer-delivered-out-of-scope] [--format json|text]\n')
    return 2
  }
  const { flags } = parseFlags(args.slice(1))
  const workspace = opt(flags, 'workspace')
  if (workspace === undefined) {
    io.err('usage: track scope validate --workspace <id> --baseline-commit <sha> [--content <path>] [--locator <l>] [--claimed-item <id>] [--infer-delivered-out-of-scope] [--format json|text]\n')
    return 2
  }
  const format = oneOf(opt(flags, 'format') ?? 'text', ['json', 'text'], '--format')
  const contentPath = opt(flags, 'content')
  const content = contentPath !== undefined ? readFileSync(isAbsolute(contentPath) ? contentPath : join(io.cwd, contentPath), 'utf8') : undefined
  const reader = new TrackReader(ctx.eventsPath)
  const result = reader.scopeValidate({
    workspace,
    baselineCommit: resolveCommit(io.cwd, opt(flags, 'baseline-commit')),
    ...(content !== undefined ? { content } : {}),
    ...(opt(flags, 'locator') !== undefined ? { locator: req(flags, 'locator') } : {}),
    ...(opt(flags, 'claimed-item') !== undefined ? { claimedItemId: req(flags, 'claimed-item') } : {}),
    ...(flags['infer-delivered-out-of-scope'] === true ? { inferDeliveredOutOfScope: true } : {}),
  })
  if (format === 'json') {
    io.out(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    const lines = [`status: ${result.status}`]
    for (const w of result.perWp) {
      const ev = w.evidenceStatus !== undefined ? ` evidence:${w.evidenceStatus}` : ''
      lines.push(`${w.label} ${w.wpId} ${w.declared ? 'declared' : 'undeclared'} ${w.semanticStatus}${ev}`)
    }
    for (const f of result.findings) lines.push(`finding: ${f.code}${f.wpId !== undefined ? ` (${f.wpId})` : ''} — ${f.message}`)
    io.out(`${lines.join('\n')}\n`)
  }
  // ADVISORY rc: a stale sidecar is fail-closed (rc=1); semantic findings are advisory (rc=0).
  return result.status === 'stale' ? 1 : 0
}

function cmdValidate(args: string[], ctx: Ctx, noStore = false): number {
  const { io } = ctx
  const { flags } = parseFlags(args)
  void flags
  const s = store(ctx)
  let events
  try {
    events = s.readAll()
  } catch (error) {
    io.out(`INVALID: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  // Serve-empty: no `.track` resolved ⇒ an absent store is an INTEGRAL empty stream (ok:true), with a
  // no-store warning already on stderr (rc=0). A MALFORMED *existing* log still fails-closed above (rc=1).
  if (noStore) {
    io.out(`OK: no .track store — 0 events, integral empty stream\n`)
    return 0
  }
  const integrity = validate(events, readHead(ctx.eventsPath))
  const desync = desyncFindings(new Track(s).state(), io.cwd)
  const findings = [...integrity.findings.map((f) => ({ ...f })), ...desync]
  if (findings.length === 0) {
    io.out(`OK: ${events.length} events, integrity + desync clean\n`)
    return 0
  }
  io.out(`INVALID: ${integrity.findings.length} integrity + ${desync.length} desync finding(s)\n`)
  io.out(`${JSON.stringify(findings, null, 2)}\n`)
  return 1
}

function cmdBranch(args: string[], ctx: Ctx): number {
  const { io } = ctx
  if (args[0] !== 'import') {
    io.err('usage: track branch import <BRANCH.md> [--commit <sha>]\n')
    return 2
  }
  const { positional, flags } = parseFlags(args.slice(1))
  const file = positional[0]
  if (file === undefined) {
    io.err('usage: track branch import <BRANCH.md> [--commit <sha>]\n')
    return 2
  }
  const content = readFileSync(isAbsolute(file) ? file : join(io.cwd, file), 'utf8')
  const track = writeTrack(ctx)
  const result = track.importBranch(content, {
    locator: file,
    fileSlug: basename(file).replace(/\.md$/, ''),
    commit: resolveCommit(io.cwd, opt(flags, 'commit')),
  })
  io.out(`Imported ${result.branchSlug}: ${result.created} created, ${result.updated} updated\n`)
  return 0
}

/**
 * `track ingest <file.jsonl> --workspace <w>` — apply a neutral WorkEvent stream (M2b channel ①). A
 * local-user channel pinned to one workspace; provenance is `transport:'import'` to keep batch ingest
 * distinguishable from interactive CLI writes in the audit log. Same shape as `branch import` /
 * `accept run --from`: a local-file adapter, not a network transport.
 */
function cmdIngest(args: string[], cliCtx: Ctx): number {
  const { io } = cliCtx
  const { positional, flags } = parseFlags(args)
  const file = positional[0]
  if (file === undefined) {
    io.err('usage: track ingest <file.jsonl> --workspace <w>\n')
    return 2
  }
  const workspace = req(flags, 'workspace')
  const raw = readFileSync(isAbsolute(file) ? file : join(io.cwd, file), 'utf8')
  const events: WorkEvent[] = []
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    try {
      events.push(JSON.parse(trimmed) as WorkEvent)
    } catch {
      throw new DomainError(`ingest: malformed JSON on line ${i + 1}`)
    }
  })
  const ctx: IngestContext = {
    by: cliActor(io.cwd),
    workspace,
    prov: { transport: 'import', proposed: false, auth: 'local-user' },
  }
  const s = store(cliCtx)
  // `ingest().count` is the INPUT length, not the persisted count (a dedup'd WorkEvent is skipped, not
  // appended). To classify a genuine no-op we compare the persisted log length before/after: if nothing
  // new landed, EVERY event was a dedup'd retry — say "no-op" explicitly (WHITELISTED), never imply a write.
  const before = s.readAll().length
  const result = ingest(events, ctx, s)
  const after = s.readAll().length
  if (after === before) {
    io.out('no-op: 0 event(s) ingested (already applied)\n')
    return 0
  }
  for (const id of result.ids) io.out(`${id ?? '-'}\n`)
  return 0
}
