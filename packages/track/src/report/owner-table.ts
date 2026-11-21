import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { CaptureOrigin, TrackEvent } from '../events/types.js'
import { isOwnerGateTitle, isSettled, type DecisionState } from '../model/decision.js'
import type { DemandState } from '../model/demand.js'
import { DomainError, type ItemState } from '../model/item.js'
import {
  isValidMeasuredVelocityProvenance,
  REPORT_STAGES,
  REPORT_STATUSES,
  type ReportEtaEntry,
  type ReportStage,
  type ReportStatus,
} from '../model/report-status.js'
import type { State } from '../state/fold.js'
import { effectiveOpenBlockersForItem } from './blocker-status.js'
import { cleanDisplayText, shortDecisionSubject, type Format } from './format.js'
import {
  deriveItemStageStatus,
  STAGE_RANK,
} from './stage-status.js'
import {
  evaluateEtaDeadline,
  qualifyVelocityEta,
  type VelocityEtaBindingInput,
} from './velocity-eta.js'
import {
  formatBlockingDecisionTodoCause,
  formatPartialScopeNoDecisionsSentence,
  formatStrictEmptyRefLabel,
  MOTIF_CAPTURE_INACTIVE,
  MOTIF_POLICY_ABSENT,
} from './owner-table-strings.js'

export const OWNER_TABLE_HEADERS = [
  '#',
  'Statut',
  'Étape',
  'ETA (étape cible)',
  'Ta demande',
  'Fait',
  'À faire (qui)',
  'Décision',
] as const

export type OwnerTableRowKind = 'demand-title' | 'lot' | 'single'

export interface OwnerTableRow {
  /** Row layout kind: `'demand-title'` (multi-lot header), `'lot'` (child lot row), or `'single'` (1-lot/standalone). */
  kind?: OwnerTableRowKind | undefined
  /** Parent demand id when `kind === 'lot'`. */
  parentDemandId?: string | undefined
  /** Stable 1..N request number across all requests (0 when unnumbered). */
  num: number
  /** Underlying demand or item aggregate id. */
  id: string
  /** Derived status (`undefined` on a `'demand-title'` row, which renders `—`). */
  status?: ReportStatus | undefined
  /** True when the owner explicitly placed a `not-started` request on pause (`⚪ en pause`). */
  pausedByOwner?: boolean | undefined
  /** Stage proven by a recorded link (`undefined` renders as `—`). */
  stage?: ReportStage | undefined
  /** Optional stage explicitly requested by the owner (`<stage> (demandée)`). */
  requestedStage?: ReportStage | undefined
  /** Up to 2 target-stage ETAs. */
  etas: ReportEtaEntry[]
  /** `Ta demande` cell. */
  request: string
  /** `Fait` cell (must carry a recorded witness link/fact for `on-track` and `done`, or reason for `withdrawn`). */
  done: string
  /** `À faire (qui)` cell (must carry cause for `blocked`, including `bloqué par D#` when `decisionBlocking`). */
  todo: string
  /** `D#` tokens referenced by this row. */
  decisionRefs: string[]
  /** Subset of `decisionRefs` whose targets are all withdrawn or archived (`D# (décision sans objet)`). */
  sansObjetDecisionRefs?: string[] | undefined
  /** Subset of `decisionRefs` that have an active decision blocker on this row (`🚩 D# bloquante`). */
  blockingDecisionRefs?: string[] | undefined
  /** Additive identity links to decisions targeting this row (including OWNER GATEs). */
  decisionIds?: string[] | undefined
  /** Subset of `decisionIds` that have an active decision blocker on this row. */
  blockingDecisionIds?: string[] | undefined
  /** Subset of `decisionIds` whose targets are all withdrawn or archived. */
  sansObjetDecisionIds?: string[] | undefined
  /** True when at least one referenced decision blocks the row (`🚩 D# bloquante`). */
  decisionBlocking?: boolean | undefined
  /** True when a conformity witness is recorded at the current stage. */
  hasWitness?: boolean | undefined
  /** Earliest recorded creation timestamp for this row's demand or item (ISO-8601). */
  createdAt?: string | undefined
  /** True when the demand's `demand.raised` event carried `prov.transport === 'capture'` (lot 3a). */
  captured?: boolean | undefined
  /** Attribution origin when captured (lot 3a, DS-9). */
  captureOrigin?: CaptureOrigin | undefined
  /** Optional short title given at classification (lot 3a, judged separately from captured text). */
  capturedTitle?: string | undefined
  /** Captured verbatim text (lot 3a, judged separately from short title). */
  capturedText?: string | undefined
  /** True when a private term was masked at inscription into a versioned journal (lot 3a). */
  maskedAtInscription?: boolean | undefined
}

export interface OwnerTableDecisionOption {
  letter: string
  label: string
  consequence: string
}

export type OwnerTableDecisionKind = 'decision' | 'owner-gate'

export interface OwnerTableDecision {
  ref: string
  id: string
  kind?: OwnerTableDecisionKind | undefined
  question: string
  options: OwnerTableDecisionOption[]
  recommendedLetter: string
  recommendation: string
  dossierLink?: string
  blocking?: boolean | undefined
  /** True when every target of this unanswered decision is withdrawn (`⚫ retiré`) or archived (`décision sans objet`). */
  sansObjet?: boolean | undefined
  /** ISO-8601 timestamp when the decision (or source item for synthetic expectations) was created. */
  createdAt?: string | undefined
  /** True when the decision outcome is `deferred`. */
  deferred?: boolean | undefined
  /** Number of unanswered dossier questions (`dossier.qa` entries with empty/missing `answer`). */
  openQuestionCount?: number | undefined
  /** Target session name extracted for an OWNER GATE decision (`Target instance and session: <value>`). */
  session?: string | undefined
}

export interface OwnerTableView {
  kind: 'owner-table-report'
  rows: OwnerTableRow[]
  decisions: OwnerTableDecision[]
  replyLine: string
  /** All request numbers ever registered in the journal (used to detect missing unarchived rows). */
  registeredNumbers: number[]
  /** Request numbers explicitly archived by an owner archive event (`demand.owner-archived` or `archived`). */
  archivedNumbers: number[]
  /** Optional local policy configuration or path for the private-name gate. */
  policy?: OwnerTablePolicy
  policyPath?: string
  defaultPolicyPath?: string
  statePolicyPath?: string
}

export interface OwnerTablePolicyEntry {
  salt?: string
  hash: string
}

export interface OwnerTablePolicy {
  salt?: string
  /** Salted SHA-256 hex digests of private terms (never the raw terms themselves). */
  privateTermHashes?: readonly (string | OwnerTablePolicyEntry)[]
}

export interface AuditOwnerTableOptions {
  policy?: OwnerTablePolicy
  policyPath?: string
  defaultPolicyPath?: string
  statePolicyPath?: string
}

export type OwnerTableGateCode =
  | 'no-owner-demands'
  | 'missing-row'
  | 'blocked-without-cause'
  | 'missing-witness'
  | 'invalid-eta'
  | 'invalid-decision'
  | 'internal-jargon'
  | 'banned-word'
  | 'journal-integrity'
  | 'document-desync'
  | 'decision-unnumbered'

export const OWNER_TABLE_NO_DEMANDS_MESSAGE =
  'aucune demande owner numérotée dans le journal (.track) — tableau owner refusé ' +
  '(des demandes ou décisions owner ouvertes peuvent exister hors journal ; ' +
  'enregistre une demande avec `track demand raise --text <text>`, ' +
  'ou utilise `track report --status-table` pour la vue technique)'

export const OWNER_TABLE_ALL_ARCHIVED_MESSAGE =
  'aucune demande owner active dans le journal (.track) — toutes les demandes numérotées sont archivées, ' +
  'tableau owner vide refusé'

export function formatOwnerTableNoJournalMessage(cwd: string, reason?: string): string {
  const detail =
    reason !== undefined && reason.trim() !== ''
      ? reason.trim()
      : `aucun journal .track trouvé depuis ${cwd} et aucune captation active`
  return (
    `REFUSED: dossier non couvert — ${detail} — tableau owner refusé ` +
    `(des demandes ou décisions owner ouvertes peuvent exister hors journal). ` +
    `Passe --track-dir <dossier> (ou TRACK_DIR) vers le journal concerné, ou initialise un journal avec \`track init\`.`
  )
}

export type OwnerTableCell =
  | 'request'
  | 'done'
  | 'todo'
  | 'eta'
  | 'decision'
  | 'status'
  | 'stage'

export type OwnerTableGateCheck =
  | 'demands.none'
  | 'demands.all-archived'
  | 'row.unnumbered'
  | 'registry.duplicate'
  | 'registry.missing'
  | 'registry.hole'
  | 'row.order'
  | 'row.lot-orphan'
  | 'row.title-few-lots'
  | 'row.request-missing'
  | 'row.lot-format'
  | 'row.title-field'
  | 'row.status-invalid'
  | 'row.stage-invalid'
  | 'row.stage-done-mismatch'
  | 'status.unproven'
  | 'row.withdrawn-no-reason'
  | 'row.blocked-no-cause'
  | 'row.blocking-not-blocked'
  | 'row.blocking-no-cause'
  | 'row.blocking-no-ref'
  | 'row.withdrawn-blocking'
  | 'row.title-blocking-inconsistent'
  | 'eta.too-many'
  | 'eta.invalid-stage'
  | 'eta.invalid-source'
  | 'eta.committed-no-by'
  | 'eta.unknown-with-date'
  | 'eta.measured-unproven'
  | 'eta.missing-date'
  | 'eta.missed-status'
  | 'eta.terminal-active'
  | 'eta.missing'
  | 'decision.duplicate-ref'
  | 'decision.unlisted'
  | 'decision.sans-objet-inconsistent'
  | 'decision.sans-objet-blocking'
  | 'decision.no-row'
  | 'decision.to-instruct'
  | 'decision.no-dossier'
  | 'decision.unnumbered'
  | 'text.commit-hash'
  | 'text.internal-id'
  | 'text.jargon'
  | 'text.reserved'
  | 'journal.integrity'
  | 'document.desync'

export interface OwnerTableGateViolation {
  code: OwnerTableGateCode
  check?: OwnerTableGateCheck
  rowNum?: number
  rowId?: string
  cell?: OwnerTableCell
  decisionRef?: string
  decisionId?: string
  message: string
}

export interface OwnerTableAudit {
  ok: boolean
  violations: OwnerTableGateViolation[]
  notices?: string[]
}

const BANNED_STEMS: readonly string[] = [
  Buffer.from([0x68, 0x6f, 0x6e, 0x6e, 0xc3, 0xaa, 0x74]).toString('utf8'),
  Buffer.from([0x68, 0x6f, 0x6e, 0x6e, 0x65, 0x74]).toString('utf8'),
  Buffer.from([0x68, 0x6f, 0x6e, 0x65, 0x73, 0x74, 0x6c, 0x79]).toString('utf8'),
]

function resolveOwnerTablePolicy(
  options?: AuditOwnerTableOptions,
  view?: OwnerTableView,
): { policy?: OwnerTablePolicy; notice?: string } {
  const direct = options?.policy ?? view?.policy
  if (direct !== undefined) {
    return { policy: direct }
  }
  const rawPath =
    options?.policyPath ??
    view?.policyPath ??
    process.env['TRACK_OWNER_POLICY_FILE'] ??
    process.env['TRACK_OWNER_REPORT_POLICY']
  if (rawPath === undefined || rawPath.trim() === '') {
    const defaultLocalPolicy = options?.defaultPolicyPath ?? view?.defaultPolicyPath
    if (
      defaultLocalPolicy !== undefined &&
      defaultLocalPolicy.trim() !== '' &&
      existsSync(defaultLocalPolicy.trim())
    ) {
      const parsed = JSON.parse(readFileSync(defaultLocalPolicy.trim(), 'utf8')) as OwnerTablePolicy
      return { policy: parsed }
    }
    const stateLocalPolicy = options?.statePolicyPath ?? view?.statePolicyPath
    if (
      stateLocalPolicy !== undefined &&
      stateLocalPolicy.trim() !== '' &&
      existsSync(stateLocalPolicy.trim())
    ) {
      const parsed = JSON.parse(readFileSync(stateLocalPolicy.trim(), 'utf8')) as OwnerTablePolicy
      return { policy: parsed }
    }
    return {
      notice:
        'Private-name gate skipped: no unversioned local policy file configured (set --policy <path> or TRACK_OWNER_POLICY_FILE).',
    }
  }
  const trimmed = rawPath.trim()
  if (!existsSync(trimmed)) {
    return {
      notice: `Private-name gate skipped: local policy file not found at ${trimmed}.`,
    }
  }
  const parsed = JSON.parse(readFileSync(trimmed, 'utf8')) as OwnerTablePolicy
  return { policy: parsed }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function matchesPrivateTermToken(token: string, policy: OwnerTablePolicy): boolean {
  if (policy.privateTermHashes === undefined || policy.privateTermHashes.length === 0) {
    return false
  }
  const nfcLower = token.normalize('NFC').toLowerCase()
  const nfdStripped = token.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  const variants = nfcLower === nfdStripped ? [nfcLower] : [nfcLower, nfdStripped]
  const defaultSalt = policy.salt ?? ''

  for (const entry of policy.privateTermHashes) {
    let salt = defaultSalt
    let targetHash: string
    if (typeof entry === 'string') {
      const colonIdx = entry.lastIndexOf(':')
      if (colonIdx > 0 && /^[0-9a-f]{64}$/iu.test(entry.slice(colonIdx + 1))) {
        salt = entry.slice(0, colonIdx)
        targetHash = entry.slice(colonIdx + 1).toLowerCase()
      } else {
        targetHash = entry.toLowerCase()
      }
    } else {
      salt = entry.salt ?? defaultSalt
      targetHash = entry.hash.toLowerCase()
    }
    for (const tok of variants) {
      if (salt !== '') {
        if (sha256Hex(`${salt}:${tok}`) === targetHash || sha256Hex(`${salt}${tok}`) === targetHash) {
          return true
        }
      } else if (sha256Hex(tok) === targetHash) {
        return true
      }
    }
  }
  return false
}

export const PRIVATE_TERM_MASK_PLACEHOLDER = '[terme masqué]'

/**
 * Replace any token matching `policy.privateTermHashes` with `[terme masqué]` (spec §7.5, plan/07 Lot 4).
 * Uses the exact same normalization & salted SHA-256 matching rules as `matchesPrivateTermPolicy`.
 */
export function maskPrivateTermsWithPolicy(
  text: string,
  policy: OwnerTablePolicy | undefined,
): { text: string; masked: boolean; count: number } {
  if (policy?.privateTermHashes === undefined || policy.privateTermHashes.length === 0) {
    return { text, masked: false, count: 0 }
  }
  let count = 0
  const out = text.replace(/[\p{L}\p{N}_-]+/gu, (compound) => {
    if (matchesPrivateTermToken(compound, policy)) {
      count += 1
      return PRIVATE_TERM_MASK_PLACEHOLDER
    }
    return compound.replace(/[\p{L}\p{N}]+/gu, (part) => {
      if (matchesPrivateTermToken(part, policy)) {
        count += 1
        return PRIVATE_TERM_MASK_PLACEHOLDER
      }
      return part
    })
  })
  return { text: out, masked: count > 0, count }
}

function matchesPrivateTermPolicy(text: string, policy: OwnerTablePolicy | undefined): boolean {
  if (policy?.privateTermHashes === undefined || policy.privateTermHashes.length === 0) {
    return false
  }
  const nfcLower = text.normalize('NFC').toLowerCase()
  const nfdStripped = text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  const tokens = new Set<string>()
  for (const variant of [nfcLower, nfdStripped]) {
    for (const tok of variant.split(/[^\p{L}\p{N}_-]+/u)) {
      if (tok.length > 0) tokens.add(tok)
    }
    for (const tok of variant.split(/[^\p{L}\p{N}]+/u)) {
      if (tok.length > 0) tokens.add(tok)
    }
  }
  if (tokens.size === 0) return false

  const defaultSalt = policy.salt ?? ''
  for (const entry of policy.privateTermHashes) {
    let salt = defaultSalt
    let targetHash: string
    if (typeof entry === 'string') {
      const colonIdx = entry.lastIndexOf(':')
      if (colonIdx > 0 && /^[0-9a-f]{64}$/iu.test(entry.slice(colonIdx + 1))) {
        salt = entry.slice(0, colonIdx)
        targetHash = entry.slice(colonIdx + 1).toLowerCase()
      } else {
        targetHash = entry.toLowerCase()
      }
    } else {
      salt = entry.salt ?? defaultSalt
      targetHash = entry.hash.toLowerCase()
    }
    for (const tok of tokens) {
      if (salt !== '') {
        if (sha256Hex(`${salt}:${tok}`) === targetHash || sha256Hex(`${salt}${tok}`) === targetHash) {
          return true
        }
      } else if (sha256Hex(tok) === targetHash) {
        return true
      }
    }
  }
  return false
}

const COMMIT_HASH_RE = /\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/iu
const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/u
const JARGON_RE =
  /\b(?:worktrees?|subagents?|bwrap|tmux|pty-host|events\.jsonl|aggregateId|specStatus|realizedCommit|lanes?|shards?)\b|(?:^|[^\p{L}\p{N}])claude:[a-z0-9_.:-]+/iu
const WP_INTERNAL_RE = /\bWP-?\d+\b/u
const PRIVATE_PATH_RE = new RegExp(
  String.raw`(?:^|[\s(])/(?:home|Users|tmp|var/folders)/[^\s)]+`,
  'iu',
)
const PRIVATE_DIGEST_RE = /\bsha256[:=][0-9a-f]{8,}\b/iu

export function formatOwnerStatusCell(
  row: Pick<OwnerTableRow, 'kind' | 'status' | 'pausedByOwner'>,
): string {
  if (row.kind === 'demand-title' || row.status === undefined) {
    return '—'
  }
  switch (row.status) {
    case 'on-track':
      return '🔵 sur la voie'
    case 'waiting':
      return '🟡 en attente'
    case 'unforeseen':
      return '🟠 dérive'
    case 'blocked':
      return '🔴 bloqué'
    case 'not-started':
      return row.pausedByOwner === true ? '⚪ en pause' : '⚪ pas commencé'
    case 'done':
      return '✅ fait'
    case 'withdrawn':
      return '⚫ retiré'
    case 'not-qualified':
      return '— sans témoin'
  }
}

export function formatOwnerStageCell(row: Pick<OwnerTableRow, 'stage' | 'requestedStage'>): string {
  if (row.stage === undefined || (row.stage as string) === '—') {
    return '—'
  }
  if (row.requestedStage !== undefined && row.requestedStage === row.stage) {
    return `${row.stage} (demandée)`
  }
  return row.stage
}

export function formatOwnerEtaEntry(eta: ReportEtaEntry): string {
  const target = eta.targetLabel !== undefined && eta.targetLabel.trim() !== ''
    ? `${eta.targetStage} (${eta.targetLabel.trim()})`
    : eta.targetStage
  const sourceText =
    eta.source === 'measured'
      ? 'mesuré'
      : eta.source === 'committed'
        ? `engagé : ${eta.by ?? ''}`
        : 'inconnu'
  if (eta.slip !== undefined) {
    if (eta.when === '—' || eta.when === eta.slip.initialWhen) {
      return `${target} → ${eta.when} (dépassé : ${eta.slip.initialWhen}, ${sourceText})`
    }
    return `${target} → ${eta.when} (${sourceText}, glissement depuis ${eta.slip.initialWhen})`
  }
  return `${target} → ${eta.when} (${sourceText})`
}

export function formatOwnerEtaCell(etas: readonly ReportEtaEntry[]): string {
  if (etas.length === 0) return '—'
  return etas.map(formatOwnerEtaEntry).join(' · ')
}

export function formatOwnerDecisionCell(
  row: Pick<
    OwnerTableRow,
    'status' | 'decisionRefs' | 'sansObjetDecisionRefs' | 'decisionBlocking' | 'blockingDecisionRefs'
  >,
): string {
  if (row.decisionRefs.length === 0) return '—'
  if (row.status === 'withdrawn') {
    return row.decisionRefs.map((ref) => `${ref} (décision sans objet)`).join(' · ')
  }
  const sansObjetSet = new Set(row.sansObjetDecisionRefs ?? [])
  const blockingSet =
    row.blockingDecisionRefs !== undefined
      ? new Set(row.blockingDecisionRefs)
      : row.decisionBlocking === true
        ? new Set(row.decisionRefs)
        : new Set<string>()
  return row.decisionRefs
    .map((ref) => {
      if (sansObjetSet.has(ref)) return `${ref} (décision sans objet)`
      return blockingSet.has(ref) ? `🚩 ${ref} bloquante` : ref
    })
    .join(' · ')
}

function checkTextGates(
  text: string,
  context: {
    rowNum?: number
    rowId?: string
    cell?: OwnerTableCell
    decisionRef?: string
    decisionId?: string
    field: string
  },
  violations: OwnerTableGateViolation[],
  policy?: OwnerTablePolicy,
): void {
  const loc = {
    ...(context.rowNum !== undefined ? { rowNum: context.rowNum } : {}),
    ...(context.rowId !== undefined ? { rowId: context.rowId } : {}),
    ...(context.cell !== undefined ? { cell: context.cell } : {}),
    ...(context.decisionRef !== undefined ? { decisionRef: context.decisionRef } : {}),
    ...(context.decisionId !== undefined ? { decisionId: context.decisionId } : {}),
  }
  if (COMMIT_HASH_RE.test(text)) {
    violations.push({
      code: 'internal-jargon',
      check: 'text.commit-hash',
      ...loc,
      message: `${context.field} contains a commit hash`,
    })
  }
  if (ULID_RE.test(text)) {
    violations.push({
      code: 'internal-jargon',
      check: 'text.internal-id',
      ...loc,
      message: `${context.field} contains an internal ULID`,
    })
  }
  const checkWpToken = context.field.includes('"Fait"') || context.field.includes('"À faire (qui)"')
  if (JARGON_RE.test(text) || (checkWpToken && WP_INTERNAL_RE.test(text))) {
    violations.push({
      code: 'internal-jargon',
      check: 'text.jargon',
      ...loc,
      message: `${context.field} contains internal jargon`,
    })
  }
  const nfcLower = text.normalize('NFC').toLowerCase()
  const nfdStripped = text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  const hasBannedStem = BANNED_STEMS.some((stem) => nfcLower.includes(stem) || nfdStripped.includes(stem))
  const hasPrivateTerm = matchesPrivateTermPolicy(text, policy)
  if (hasBannedStem || hasPrivateTerm || PRIVATE_PATH_RE.test(text) || PRIVATE_DIGEST_RE.test(text)) {
    violations.push({
      code: 'banned-word',
      check: 'text.reserved',
      ...loc,
      message: `${context.field} contains a banned word, private term, private path, or private digest`,
    })
  }
}

/** Check whether a label or arbitrary display string trips any text gate (for label fallback). */
export function hasTextGateViolation(text: string, options?: AuditOwnerTableOptions): boolean {
  const { policy } = resolveOwnerTablePolicy(options)
  const probe: OwnerTableGateViolation[] = []
  checkTextGates(text, { field: 'label' }, probe, policy)
  return probe.length > 0
}

function isBlankOrDash(value: string | undefined): boolean {
  if (value === undefined) return true
  const trimmed = value.trim()
  return trimmed === '' || trimmed === '—' || trimmed === '-'
}

function isDecisionIncomplete(
  d: Pick<OwnerTableDecision, 'question' | 'options' | 'recommendedLetter' | 'recommendation'>,
): boolean {
  const validRecommendedLetter =
    !isBlankOrDash(d.recommendedLetter) && d.options.some((o) => o.letter === d.recommendedLetter)
  return (
    isBlankOrDash(d.question) ||
    d.options.length < 2 ||
    !validRecommendedLetter ||
    isBlankOrDash(d.recommendation)
  )
}

function strictDecisionLabel(d: OwnerTableDecision): string {
  if (d.ref.trim() !== '') return d.ref.trim()
  if (d.kind === 'owner-gate') return formatStrictEmptyRefLabel('owner-gate')
  return formatStrictEmptyRefLabel('decision', !isDecisionIncomplete(d))
}

function parseDecisionRefNumber(ref: string): number {
  const m = /^D(\d+)$/u.exec(ref.trim())
  return m !== null ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

function auditRowEtaEntries(
  row: OwnerTableRow,
  violations: OwnerTableGateViolation[],
  policy: OwnerTablePolicy | undefined,
  requireMissedSlipStatus: boolean,
): void {
  if (row.etas.length > 2) {
    violations.push({
      code: 'invalid-eta',
      check: 'eta.too-many',
      rowNum: row.num,
      rowId: row.id,
      cell: 'eta',
      message: `row #${row.num} carries ${row.etas.length} ETAs (maximum 2 allowed)`,
    })
  }
  for (const eta of row.etas) {
    if (!(REPORT_STAGES as readonly string[]).includes(eta.targetStage)) {
      violations.push({
        code: 'invalid-eta',
        check: 'eta.invalid-stage',
        rowNum: row.num,
        rowId: row.id,
        cell: 'eta',
        message: `row #${row.num} has an ETA without a valid target stage`,
      })
    }
    if (eta.source !== 'measured' && eta.source !== 'committed' && eta.source !== 'unknown') {
      violations.push({
        code: 'invalid-eta',
        check: 'eta.invalid-source',
        rowNum: row.num,
        rowId: row.id,
        cell: 'eta',
        message: `row #${row.num} has an ETA without a valid source (measured|committed|unknown)`,
      })
    }
    if (eta.source === 'committed' && isBlankOrDash(eta.by)) {
      violations.push({
        code: 'invalid-eta',
        check: 'eta.committed-no-by',
        rowNum: row.num,
        rowId: row.id,
        cell: 'eta',
        message: `row #${row.num} has a committed ETA without naming who committed ("by")`,
      })
    }
    if (eta.source === 'unknown' && !isBlankOrDash(eta.when)) {
      violations.push({
        code: 'invalid-eta',
        check: 'eta.unknown-with-date',
        rowNum: row.num,
        rowId: row.id,
        cell: 'eta',
        message: `row #${row.num} has an unknown ETA with a target date (must be "—")`,
      })
    }
    if (eta.source === 'measured') {
      if (
        !isValidMeasuredVelocityProvenance(eta.measured) ||
        STAGE_RANK[eta.targetStage] < STAGE_RANK['dev']
      ) {
        violations.push({
          code: 'invalid-eta',
          check: 'eta.measured-unproven',
          rowNum: row.num,
          rowId: row.id,
          cell: 'eta',
          message: `row #${row.num} has a measured ETA without qualified velocity provenance (sampleCount > 0 and matching digests)`,
        })
      }
    }
    if ((eta.source === 'measured' || eta.source === 'committed') && isBlankOrDash(eta.when) && eta.slip === undefined) {
      violations.push({
        code: 'invalid-eta',
        check: 'eta.missing-date',
        rowNum: row.num,
        rowId: row.id,
        cell: 'eta',
        message: `row #${row.num} has a ${eta.source} ETA without a target date`,
      })
    }
    if (
      requireMissedSlipStatus &&
      eta.slip !== undefined &&
      row.pausedByOwner !== true &&
      row.status !== 'unforeseen' &&
      row.status !== 'blocked' &&
      row.status !== 'withdrawn'
    ) {
      violations.push({
        code: 'invalid-eta',
        check: 'eta.missed-status',
        rowNum: row.num,
        rowId: row.id,
        cell: 'eta',
        message: `row #${row.num} has a missed ETA and must be 🟠 dérive (or 🔴 bloqué)`,
      })
    }
    if (eta.by !== undefined) {
      checkTextGates(eta.by, { rowNum: row.num, rowId: row.id, cell: 'eta', field: `row #${row.num} ETA "by"` }, violations, policy)
    }
    if (eta.targetLabel !== undefined) {
      checkTextGates(eta.targetLabel, { rowNum: row.num, rowId: row.id, cell: 'eta', field: `row #${row.num} ETA "targetLabel"` }, violations, policy)
    }
    checkTextGates(eta.when, { rowNum: row.num, rowId: row.id, cell: 'eta', field: `row #${row.num} ETA "when"` }, violations, policy)
    if (eta.slip?.initialWhen !== undefined) {
      checkTextGates(eta.slip.initialWhen, { rowNum: row.num, rowId: row.id, cell: 'eta', field: `row #${row.num} ETA slip "initialWhen"` }, violations, policy)
    }
    if (eta.slip?.reason !== undefined) {
      checkTextGates(eta.slip.reason, { rowNum: row.num, rowId: row.id, cell: 'eta', field: `row #${row.num} ETA slip "reason"` }, violations, policy)
    }
  }
}

/**
 * Blocking gates on the owner table (Owner Decisions 14/11 & 15/11).
 * The render refuses (`ok === false`) on any violation.
 */
export function auditOwnerTable(
  view: OwnerTableView,
  options?: AuditOwnerTableOptions,
): OwnerTableAudit {
  const violations: OwnerTableGateViolation[] = []
  const { policy, notice } = resolveOwnerTablePolicy(options, view)
  const archivedSet = new Set(view.archivedNumbers)
  const seenNums = new Set<number>()

  const hasNumberedRow = view.rows.some((row) => Number.isInteger(row.num) && row.num >= 1)
  if (view.registeredNumbers.length === 0 && !hasNumberedRow) {
    violations.push({
      code: 'no-owner-demands',
      check: 'demands.none',
      message: OWNER_TABLE_NO_DEMANDS_MESSAGE,
    })
  } else if (view.rows.length === 0) {
    violations.push({
      code: 'no-owner-demands',
      check: 'demands.all-archived',
      message: OWNER_TABLE_ALL_ARCHIVED_MESSAGE,
    })
  }

  let prevTopLevelNum = 0
  let activeTitleRow: OwnerTableRow | undefined
  let lotCountForActiveTitle = 0

  for (const row of view.rows) {
    const rowKind: OwnerTableRowKind = row.kind ?? 'single'
    if (!Number.isInteger(row.num) || row.num < 1) {
      violations.push({
        code: 'missing-row',
        check: 'row.unnumbered',
        rowNum: row.num,
        rowId: row.id,
        cell: 'request',
        message: `row #${String(row.num)} must have a positive integer request number`,
      })
    }
    if (rowKind === 'lot') {
      if (
        activeTitleRow === undefined ||
        row.parentDemandId === undefined ||
        row.parentDemandId !== activeTitleRow.id ||
        row.num !== activeTitleRow.num
      ) {
        violations.push({
          code: 'missing-row',
          check: 'row.lot-orphan',
          rowNum: row.num,
          rowId: row.id,
          cell: 'request',
          message: `lot row #${row.num} (${row.id}) must immediately follow its parent demand-title row`,
        })
      } else {
        lotCountForActiveTitle++
      }
    } else {
      if (activeTitleRow !== undefined && lotCountForActiveTitle < 2) {
        violations.push({
          code: 'missing-row',
          check: 'row.title-few-lots',
          rowNum: activeTitleRow.num,
          rowId: activeTitleRow.id,
          cell: 'request',
          message: `demand-title row #${activeTitleRow.num} must be followed by at least 2 lot rows`,
        })
      }
      if (seenNums.has(row.num)) {
        violations.push({
          code: 'missing-row',
          check: 'registry.duplicate',
          rowNum: row.num,
          rowId: row.id,
          cell: 'request',
          message: `duplicate request number #${row.num}`,
        })
      }
      if (prevTopLevelNum > 0 && row.num <= prevTopLevelNum) {
        violations.push({
          code: 'missing-row',
          check: 'row.order',
          rowNum: row.num,
          rowId: row.id,
          cell: 'request',
          message: `rows must be in strictly ascending # order`,
        })
      }
      seenNums.add(row.num)
      prevTopLevelNum = row.num
      if (rowKind === 'demand-title') {
        activeTitleRow = row
        lotCountForActiveTitle = 0
      } else {
        activeTitleRow = undefined
        lotCountForActiveTitle = 0
      }
    }
  }
  if (activeTitleRow !== undefined && lotCountForActiveTitle < 2) {
    violations.push({
      code: 'missing-row',
      check: 'row.title-few-lots',
      rowNum: activeTitleRow.num,
      rowId: activeTitleRow.id,
      cell: 'request',
      message: `demand-title row #${activeTitleRow.num} must be followed by at least 2 lot rows`,
    })
  }

  for (const registered of view.registeredNumbers) {
    if (!seenNums.has(registered) && !archivedSet.has(registered)) {
      violations.push({
        code: 'missing-row',
        check: 'registry.missing',
        rowNum: registered,
        message: `request #${registered} is missing without an owner archive event`,
      })
    }
  }

  const allKnownNums = new Set([...seenNums, ...archivedSet])
  if (allKnownNums.size > 0) {
    const maxNum = Math.max(...allKnownNums)
    for (let n = 1; n <= maxNum; n++) {
      if (!allKnownNums.has(n)) {
        violations.push({
          code: 'missing-row',
          check: 'registry.hole',
          rowNum: n,
          message: `request #${n} is missing from 1..${maxNum} without an owner archive event`,
        })
      }
    }
  }

  const decisionById = new Map<string, OwnerTableDecision>()
  const decisionMap = new Map<string, OwnerTableDecision>()
  for (const d of view.decisions) {
    decisionById.set(d.id, d)
    if (d.ref.trim() !== '') {
      if (decisionMap.has(d.ref)) {
        violations.push({
          code: 'invalid-decision',
          check: 'decision.duplicate-ref',
          decisionRef: d.ref,
          decisionId: d.id,
          message: `duplicate decision ref ${d.ref}`,
        })
      }
      decisionMap.set(d.ref, d)
    }
  }

  const referencedDecisionIds = new Set<string>()
  const referencedDecisions = new Set<string>()

  for (const row of view.rows) {
    const rowKind: OwnerTableRowKind = row.kind ?? 'single'
    if (isBlankOrDash(row.request)) {
      violations.push({
        code: 'missing-row',
        check: 'row.request-missing',
        rowNum: row.num,
        rowId: row.id,
        cell: 'request',
        message: `row #${row.num} is missing its owner request text`,
      })
    } else if (rowKind === 'lot' && !/^↳ lot \d+ — \S/u.test(row.request)) {
      violations.push({
        code: 'missing-row',
        check: 'row.lot-format',
        rowNum: row.num,
        rowId: row.id,
        cell: 'request',
        message: `lot row #${row.num} must be formatted as "↳ lot N — <title>"`,
      })
    }

    if (rowKind === 'demand-title') {
      if (row.status !== undefined) {
        violations.push({
          code: 'missing-witness',
          check: 'row.title-field',
          rowNum: row.num,
          rowId: row.id,
          cell: 'status',
          message: `demand-title row #${row.num} must not carry a status (got "${String(row.status)}")`,
        })
      }
      if (row.stage !== undefined) {
        violations.push({
          code: 'missing-witness',
          check: 'row.title-field',
          rowNum: row.num,
          rowId: row.id,
          cell: 'stage',
          message: `demand-title row #${row.num} must not carry a stage (got "${String(row.stage)}")`,
        })
      }
      if (row.done.trim() !== '—') {
        violations.push({
          code: 'missing-witness',
          check: 'row.title-field',
          rowNum: row.num,
          rowId: row.id,
          cell: 'done',
          message: `demand-title row #${row.num} must have "—" in "Fait"`,
        })
      }
      if (row.todo.trim() !== '—') {
        violations.push({
          code: 'missing-witness',
          check: 'row.title-field',
          rowNum: row.num,
          rowId: row.id,
          cell: 'todo',
          message: `demand-title row #${row.num} must have "—" in "À faire (qui)"`,
        })
      }
      if (row.pausedByOwner === true) {
        violations.push({
          code: 'missing-witness',
          check: 'row.title-field',
          rowNum: row.num,
          rowId: row.id,
          cell: 'status',
          message: `demand-title row #${row.num} must not carry pausedByOwner`,
        })
      }
      if (row.hasWitness === true) {
        violations.push({
          code: 'missing-witness',
          check: 'row.title-field',
          rowNum: row.num,
          rowId: row.id,
          cell: 'done',
          message: `demand-title row #${row.num} must not carry hasWitness`,
        })
      }
      const expectedTitleBlocking =
        (row.blockingDecisionIds?.length ?? 0) > 0 || (row.blockingDecisionRefs?.length ?? 0) > 0
          ? true
          : undefined
      const hasUnlistedBlockingId =
        row.decisionIds !== undefined &&
        (row.blockingDecisionIds ?? []).some((id) => !row.decisionIds!.includes(id))
      const hasUnlistedBlockingRef = (row.blockingDecisionRefs ?? []).some(
        (ref) => !row.decisionRefs.includes(ref),
      )
      if (row.decisionBlocking !== expectedTitleBlocking || hasUnlistedBlockingId || hasUnlistedBlockingRef) {
        violations.push({
          code: 'invalid-decision',
          check: 'row.title-blocking-inconsistent',
          rowNum: row.num,
          rowId: row.id,
          cell: 'decision',
          message: `demand-title row #${row.num} has inconsistent decisionBlocking / blockingDecisionRefs`,
        })
      }
      auditRowEtaEntries(row, violations, policy, false)
    } else {
      if (row.status === undefined || !(REPORT_STATUSES as readonly string[]).includes(row.status)) {
        violations.push({
          code: 'missing-witness',
          check: 'row.status-invalid',
          rowNum: row.num,
          rowId: row.id,
          cell: 'status',
          message: `row #${row.num} has invalid status "${String(row.status)}"`,
        })
      }
      if (row.stage !== undefined && !(REPORT_STAGES as readonly string[]).includes(row.stage)) {
        violations.push({
          code: 'missing-witness',
          check: 'row.stage-invalid',
          rowNum: row.num,
          rowId: row.id,
          cell: 'stage',
          message: `row #${row.num} has invalid stage "${String(row.stage)}"`,
        })
      }

      // Gate: 🔴 without a cause in À faire
      if (row.status === 'blocked') {
        if (isBlankOrDash(row.todo)) {
          violations.push({
            code: 'blocked-without-cause',
            check: 'row.blocked-no-cause',
            rowNum: row.num,
            rowId: row.id,
            cell: 'todo',
            message: `row #${row.num} is 🔴 bloqué without a cause in "À faire (qui)"`,
          })
        }
      }

      // Gate: blocking decision must make row 🔴 bloqué with "bloqué par ..." in À faire
      if (row.decisionBlocking === true) {
        if ((row.decisionIds?.length ?? 0) === 0 && row.decisionRefs.length === 0) {
          violations.push({
            code: 'invalid-decision',
            check: 'row.blocking-no-ref',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            message: `row #${row.num} is marked decisionBlocking without any D#`,
          })
        }
        if (row.status !== 'blocked') {
          violations.push({
            code: 'blocked-without-cause',
            check: 'row.blocking-not-blocked',
            rowNum: row.num,
            rowId: row.id,
            cell: 'status',
            message: `row #${row.num} has a blocking decision (🚩) and must be 🔴 bloqué`,
          })
        }
        if (!/bloqué par (?:D\d+|OWNER GATE|décision à (?:instruire|numéroter))/u.test(row.todo)) {
          violations.push({
            code: 'blocked-without-cause',
            check: 'row.blocking-no-cause',
            rowNum: row.num,
            rowId: row.id,
            cell: 'todo',
            message: `row #${row.num} has a blocking decision (🚩) and must state "bloqué par D#" in "À faire (qui)"`,
          })
        }
      }

      // Gate: ✅ or 🔵 without a witness; merged is never ✅ fait; stage 'done' requires ✅ fait; ⚫ without reason
      if (row.status !== 'done' && row.status !== 'withdrawn' && row.stage === 'done') {
        violations.push({
          code: 'missing-witness',
          check: 'row.stage-done-mismatch',
          rowNum: row.num,
          rowId: row.id,
          cell: 'stage',
          message: `row #${row.num} cannot have stage "done" while status is "${String(row.status)}" (stage "done" requires ✅ fait)`,
        })
      }
      if (row.status === 'done') {
        if (row.stage !== 'done') {
          violations.push({
            code: 'missing-witness',
            check: 'status.unproven',
            rowNum: row.num,
            rowId: row.id,
            cell: 'stage',
            message: `row #${row.num} cannot be ✅ fait at stage "${String(row.stage ?? '—')}" (requires stage "done")`,
          })
        }
        if (row.hasWitness !== true || isBlankOrDash(row.done)) {
          violations.push({
            code: 'missing-witness',
            check: 'status.unproven',
            rowNum: row.num,
            rowId: row.id,
            cell: 'done',
            message: `row #${row.num} is ✅ fait without a recorded witness in "Fait"`,
          })
        }
      } else if (row.status === 'on-track') {
        if (row.stage === undefined || row.hasWitness !== true || isBlankOrDash(row.done)) {
          violations.push({
            code: 'missing-witness',
            check: 'status.unproven',
            rowNum: row.num,
            rowId: row.id,
            cell: 'done',
            message: `row #${row.num} is 🔵 sur la voie without a conformity witness at stage "${String(row.stage ?? '—')}"`,
          })
        }
      } else if (row.status === 'withdrawn') {
        if (isBlankOrDash(row.done)) {
          violations.push({
            code: 'missing-witness',
            check: 'row.withdrawn-no-reason',
            rowNum: row.num,
            rowId: row.id,
            cell: 'done',
            message: `row #${row.num} is ⚫ retiré without a reason in "Fait"`,
          })
        }
        if ((row.blockingDecisionIds?.length ?? 0) > 0 || (row.blockingDecisionRefs?.length ?? 0) > 0) {
          violations.push({
            code: 'invalid-decision',
            check: 'row.withdrawn-blocking',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            message: `row #${row.num} is ⚫ retiré and must not carry blocking decisions`,
          })
        }
      }

      // Gate: ETA without a target stage or a source (up to 2 ETAs per row)
      if ((row.status === 'done' || row.status === 'withdrawn') && row.etas.length > 0) {
        violations.push({
          code: 'invalid-eta',
          check: 'eta.terminal-active',
          rowNum: row.num,
          rowId: row.id,
          cell: 'eta',
          message: `row #${row.num} is terminal (${row.status}) and must not carry active ETAs`,
        })
      }
      if (row.etas.length === 0 && row.status !== 'done' && row.status !== 'withdrawn') {
        violations.push({
          code: 'invalid-eta',
          check: 'eta.missing',
          rowNum: row.num,
          rowId: row.id,
          cell: 'eta',
          message: `row #${row.num} is missing an ETA entry (target stage + source required)`,
        })
      }
      auditRowEtaEntries(row, violations, policy, true)
    }

    // Gate: row pointing to unlisted decisions or inconsistent sansObjet / withdrawn decision links (by identity + explicit refs)
    const emittedRowDecisionKeys = new Set<string>()
    const rowSansObjetIdSet = new Set(row.sansObjetDecisionIds ?? [])
    const rowBlockingIdSet = new Set(row.blockingDecisionIds ?? [])
    if (row.decisionIds !== undefined) {
      for (const dId of rowSansObjetIdSet) {
        const dec = decisionById.get(dId)
        const dLabel = dec !== undefined ? strictDecisionLabel(dec) : 'décision'
        if (!row.decisionIds.includes(dId)) {
          violations.push({
            code: 'invalid-decision',
            check: 'decision.sans-objet-inconsistent',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            ...(dec?.ref ? { decisionRef: dec.ref } : {}),
            decisionId: dId,
            message: `row #${row.num} lists ${dLabel} in sansObjetDecisionIds without including it in decisionIds`,
          })
        }
        if (rowBlockingIdSet.has(dId)) {
          emittedRowDecisionKeys.add(`decision.sans-objet-blocking:${dId}`)
          violations.push({
            code: 'invalid-decision',
            check: 'decision.sans-objet-blocking',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            ...(dec?.ref ? { decisionRef: dec.ref } : {}),
            decisionId: dId,
            message: `row #${row.num} cannot mark decision ${dLabel} as both sansObjet and blocking`,
          })
        }
      }
      for (const dId of row.decisionIds) {
        referencedDecisionIds.add(dId)
        const dec = decisionById.get(dId)
        if (dec === undefined) {
          violations.push({
            code: 'invalid-decision',
            check: 'decision.unlisted',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            decisionId: dId,
            message: `row #${row.num} points to unlisted decision`,
          })
        } else {
          if (dec.ref !== '') referencedDecisions.add(dec.ref)
          const dLabel = strictDecisionLabel(dec)
          if (row.status === 'withdrawn' && dec.sansObjet !== true) {
            emittedRowDecisionKeys.add(`withdrawn-not-sans-objet:${dId}`)
            violations.push({
              code: 'invalid-decision',
              check: 'decision.sans-objet-inconsistent',
              rowNum: row.num,
              rowId: row.id,
              cell: 'decision',
              ...(dec.ref !== '' ? { decisionRef: dec.ref } : {}),
              decisionId: dec.id,
              message: `row #${row.num} is ⚫ retiré and references decision ${dLabel} which is not marked sansObjet`,
            })
          }
          if (rowSansObjetIdSet.has(dId) && dec.sansObjet !== true) {
            emittedRowDecisionKeys.add(`row-marks-non-sans-objet:${dId}`)
            violations.push({
              code: 'invalid-decision',
              check: 'decision.sans-objet-inconsistent',
              rowNum: row.num,
              rowId: row.id,
              cell: 'decision',
              ...(dec.ref !== '' ? { decisionRef: dec.ref } : {}),
              decisionId: dec.id,
              message: `row #${row.num} marks decision ${dLabel} in sansObjetDecisionRefs, but decision ${dLabel} is not sansObjet`,
            })
          }
          if (dec.sansObjet === true && !rowSansObjetIdSet.has(dId)) {
            emittedRowDecisionKeys.add(`missing-sans-objet-mark:${dId}`)
            violations.push({
              code: 'invalid-decision',
              check: 'decision.sans-objet-inconsistent',
              rowNum: row.num,
              rowId: row.id,
              cell: 'decision',
              ...(dec.ref !== '' ? { decisionRef: dec.ref } : {}),
              decisionId: dec.id,
              message: `row #${row.num} references sans-objet decision ${dLabel} without listing it in sansObjetDecisionRefs`,
            })
          }
        }
      }
    }

    const rowSansObjetSet = new Set(row.sansObjetDecisionRefs ?? [])
    for (const ref of rowSansObjetSet) {
      if (!row.decisionRefs.includes(ref)) {
        violations.push({
          code: 'invalid-decision',
          check: 'decision.sans-objet-inconsistent',
          rowNum: row.num,
          rowId: row.id,
          cell: 'decision',
          decisionRef: ref,
          message: `row #${row.num} lists ${ref} in sansObjetDecisionRefs without including it in decisionRefs`,
        })
      }
      if ((row.blockingDecisionRefs ?? []).includes(ref)) {
        const dec = decisionMap.get(ref)
        if (dec === undefined || !emittedRowDecisionKeys.has(`decision.sans-objet-blocking:${dec.id}`)) {
          violations.push({
            code: 'invalid-decision',
            check: 'decision.sans-objet-blocking',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            decisionRef: ref,
            ...(dec !== undefined ? { decisionId: dec.id } : {}),
            message: `row #${row.num} cannot mark decision ${ref} as both sansObjet and blocking`,
          })
        }
      }
    }
    for (const ref of row.decisionRefs) {
      referencedDecisions.add(ref)
      const dec = decisionMap.get(ref)
      if (dec === undefined) {
        violations.push({
          code: 'invalid-decision',
          check: 'decision.unlisted',
          rowNum: row.num,
          rowId: row.id,
          cell: 'decision',
          decisionRef: ref,
          message: `row #${row.num} points to unlisted decision ${ref}`,
        })
      } else {
        referencedDecisionIds.add(dec.id)
        if (
          row.status === 'withdrawn' &&
          dec.sansObjet !== true &&
          !emittedRowDecisionKeys.has(`withdrawn-not-sans-objet:${dec.id}`)
        ) {
          violations.push({
            code: 'invalid-decision',
            check: 'decision.sans-objet-inconsistent',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            decisionRef: ref,
            decisionId: dec.id,
            message: `row #${row.num} is ⚫ retiré and references decision ${ref} which is not marked sansObjet`,
          })
        }
        if (
          rowSansObjetSet.has(ref) &&
          dec.sansObjet !== true &&
          !emittedRowDecisionKeys.has(`row-marks-non-sans-objet:${dec.id}`)
        ) {
          violations.push({
            code: 'invalid-decision',
            check: 'decision.sans-objet-inconsistent',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            decisionRef: ref,
            decisionId: dec.id,
            message: `row #${row.num} marks decision ${ref} in sansObjetDecisionRefs, but decision ${ref} is not sansObjet`,
          })
        }
        if (
          dec.sansObjet === true &&
          !rowSansObjetSet.has(ref) &&
          !emittedRowDecisionKeys.has(`missing-sans-objet-mark:${dec.id}`)
        ) {
          violations.push({
            code: 'invalid-decision',
            check: 'decision.sans-objet-inconsistent',
            rowNum: row.num,
            rowId: row.id,
            cell: 'decision',
            decisionRef: ref,
            decisionId: dec.id,
            message: `row #${row.num} references sans-objet decision ${ref} without listing it in sansObjetDecisionRefs`,
          })
        }
      }
    }

    // Gate: commit hash, ULID, internal jargon, or banned word in owner text
    if (row.captured === true) {
      if (row.capturedTitle !== undefined && row.capturedTitle.trim() !== '') {
        checkTextGates(
          row.capturedTitle,
          { rowNum: row.num, rowId: row.id, cell: 'request', field: `row #${row.num} "Ta demande" (title)` },
          violations,
          policy,
        )
      }
      if (row.capturedText !== undefined && row.capturedText.trim() !== '') {
        checkTextGates(
          row.capturedText,
          { rowNum: row.num, rowId: row.id, cell: 'request', field: `row #${row.num} "Ta demande" (text)` },
          violations,
          policy,
        )
      }
    } else {
      checkTextGates(row.request, { rowNum: row.num, rowId: row.id, cell: 'request', field: `row #${row.num} "Ta demande"` }, violations, policy)
    }
    checkTextGates(row.done, { rowNum: row.num, rowId: row.id, cell: 'done', field: `row #${row.num} "Fait"` }, violations, policy)
    checkTextGates(row.todo, { rowNum: row.num, rowId: row.id, cell: 'todo', field: `row #${row.num} "À faire (qui)"` }, violations, policy)
  }

  // Gate: decision without a row, or decision missing question / options / recommendation / dossierLink
  for (const d of view.decisions) {
    const isOwnerGate = d.kind === 'owner-gate'
    const dLabel = strictDecisionLabel(d)
    const dRefOpt = d.ref.trim() !== '' ? { decisionRef: d.ref } : {}

    if (d.sansObjet === true && d.blocking === true) {
      violations.push({
        code: 'invalid-decision',
        check: 'decision.sans-objet-blocking',
        ...dRefOpt,
        decisionId: d.id,
        message: `decision ${dLabel} is sans objet and must not be marked blocking`,
      })
    }

    if (isOwnerGate) {
      // OWNER GATE bypasses E4-E6 decision checks; text gates still apply to displayed fields.
      if (d.session !== undefined && d.session.trim() !== '') {
        checkTextGates(
          d.session,
          { decisionId: d.id, field: `decision ${dLabel} session` },
          violations,
          policy,
        )
      }
      continue
    }

    const isReferenced =
      referencedDecisionIds.has(d.id) || (d.ref.trim() !== '' && referencedDecisions.has(d.ref))
    if (!isReferenced && d.sansObjet !== true) {
      violations.push({
        code: 'invalid-decision',
        check: 'decision.no-row',
        ...dRefOpt,
        decisionId: d.id,
        message: `decision ${dLabel} is not referenced by any row`,
      })
    }
    if (isDecisionIncomplete(d)) {
      violations.push({
        code: 'invalid-decision',
        check: 'decision.to-instruct',
        ...dRefOpt,
        decisionId: d.id,
        message: `decision ${dLabel} must carry a question, at least 2 options with consequences, and a valid recommendation`,
      })
    }
    if (isBlankOrDash(d.dossierLink)) {
      violations.push({
        code: 'invalid-decision',
        check: 'decision.no-dossier',
        ...dRefOpt,
        decisionId: d.id,
        message: `decision ${dLabel} is missing a dossier link`,
      })
    }
    checkTextGates(d.question, { ...dRefOpt, decisionId: d.id, field: `decision ${dLabel} question` }, violations, policy)
    checkTextGates(d.recommendation, { ...dRefOpt, decisionId: d.id, field: `decision ${dLabel} recommendation` }, violations, policy)
    if (d.dossierLink !== undefined) {
      checkTextGates(d.dossierLink, { ...dRefOpt, decisionId: d.id, field: `decision ${dLabel} dossierLink` }, violations, policy)
    }
    for (const opt of d.options) {
      checkTextGates(
        `${opt.label} ${opt.consequence}`,
        { ...dRefOpt, decisionId: d.id, field: `decision ${dLabel} option ${opt.letter}` },
        violations,
        policy,
      )
    }
  }

  if (view.replyLine !== undefined && view.replyLine !== '') {
    checkTextGates(view.replyLine, { field: 'replyLine' }, violations, policy)
  }

  // Class E9 (lot 2): structured decision without a registered number — appended AFTER existing
  // strict audit findings so `--strict` keeps lot-0 ordering and adds `[decision-unnumbered]` after.
  for (const d of view.decisions) {
    if (d.kind === 'owner-gate') continue
    if (isDecisionIncomplete(d)) continue
    if (d.ref.trim() === '') {
      violations.push({
        code: 'decision-unnumbered',
        check: 'decision.unnumbered',
        decisionId: d.id,
        message: `decision ${strictDecisionLabel(d)} has no registered number`,
      })
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    ...(notice !== undefined ? { notices: [notice] } : {}),
  }
}

function escapePipeCell(value: string): string {
  return cleanDisplayText(value).replace(/\|/gu, '\\|')
}

/**
 * Render the owner table in Markdown (`md` / `text`) or JSON (`json`).
 * Refuses with a `DomainError` (`REFUSED: ...`) if any blocking gate fails.
 */
export function renderOwnerTable(
  view: OwnerTableView,
  format: Format = 'md',
  options?: AuditOwnerTableOptions,
): string {
  const audit = auditOwnerTable(view, options)
  if (!audit.ok) {
    const details = audit.violations.map((v) => `- [${v.code}] ${v.message}`).join('\n')
    throw new DomainError(`REFUSED: owner table failed blocking gates:\n${details}`)
  }
  if (format === 'json') {
    return JSON.stringify(view, null, 2) + '\n'
  }

  const lines: string[] = [
    `| ${OWNER_TABLE_HEADERS.join(' | ')} |`,
    '| ---: | --- | --- | --- | --- | --- | --- | --- |',
  ]

  for (const row of view.rows) {
    const cells = [
      String(row.num),
      formatOwnerStatusCell(row),
      formatOwnerStageCell(row),
      escapePipeCell(formatOwnerEtaCell(row.etas)),
      escapePipeCell(row.request),
      escapePipeCell(row.done),
      escapePipeCell(row.todo),
      escapePipeCell(formatOwnerDecisionCell(row)),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }

  lines.push('')
  lines.push("**Décisions qui t'attendent**")
  lines.push('')
  if (view.decisions.length === 0) {
    const scopeMotifs =
      audit.notices !== undefined && audit.notices.length > 0
        ? [MOTIF_CAPTURE_INACTIVE, MOTIF_POLICY_ABSENT]
        : [MOTIF_CAPTURE_INACTIVE]
    lines.push(formatPartialScopeNoDecisionsSentence(scopeMotifs))
  } else {
    for (const d of view.decisions) {
      const refHeading = d.sansObjet === true ? `**${d.ref}** (décision sans objet)` : `**${d.ref}**`
      lines.push(`- ${refHeading} — ${cleanDisplayText(d.question)}`)
      for (const opt of d.options) {
        lines.push(`  - **${opt.letter} · ${cleanDisplayText(opt.label)}** — ${cleanDisplayText(opt.consequence)}`)
      }
      const dossierSuffix =
        d.dossierLink !== undefined && d.dossierLink.trim() !== ''
          ? ` · Dossier : ${d.dossierLink.trim()}`
          : ''
      lines.push(`  - Reco : **${d.recommendedLetter}** (${cleanDisplayText(d.recommendation)})${dossierSuffix}`)
    }
  }
  const hasReservedReply = view.replyLine.includes('aucune décision en attente')
  if (view.replyLine !== '' && !hasReservedReply) {
    lines.push('')
    lines.push(`\`${view.replyLine}\``)
  }

  return lines.join('\n') + '\n'
}

export function optionLetter(index: number): string {
  let n = Math.max(0, Math.floor(index))
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function defaultTargetStageFor(stage: ReportStage | undefined, requestedStage?: ReportStage): ReportStage {
  if (stage === undefined) {
    return requestedStage ?? 'spec'
  }
  if (requestedStage !== undefined && STAGE_RANK[requestedStage] > STAGE_RANK[stage]) {
    return requestedStage
  }
  switch (stage) {
    case 'brainstorm':
      return 'spec'
    case 'spec':
    case 'plan':
      return 'dev'
    case 'dev':
    case 'test':
      return 'pr'
    case 'pr':
    case 'review':
      return 'merged'
    case 'merged':
      return 'published'
    case 'published':
      return 'preprod'
    case 'preprod':
      return 'prod'
    case 'prod':
    case 'done':
      return 'done'
  }
}

/**
 * Legacy prose helper (never applied to gated owner-table cells so blocking gates
 * cannot be bypassed by silent text rewriting).
 */
export function normalizeLegacyOwnerProse(input: string): string {
  let out = input
  out = out.replace(PRIVATE_DIGEST_RE, 'empreinte vérifiée')
  out = out.replace(PRIVATE_PATH_RE, ' (chemin local)')
  out = out.replace(ULID_RE, 'réf. interne')
  out = out.replace(/\(\s*(?=[0-9a-f]{7,40}\s*\))(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\s*\)/giu, '')
  out = out.replace(COMMIT_HASH_RE, 'rév.')
  out = out.replace(/\b[a-z0-9_.-]+\/[a-z0-9_.-]+#(\d+)\b/giu, '#$1')
  out = out.replace(/\brealization=to-do\b/giu, 'non démarré')
  out = out.replace(/\brealization=in-progress\b/giu, 'en cours')
  out = out.replace(/\brealization=done\b/giu, 'réalisé')
  out = out.replace(/\bspec=to-specify\b/giu, 'à spécifier')
  out = out.replace(/\brecette=unknown\b/giu, 'recette non qualifiée')
  out = out.replace(/\bworktrees?\b/giu, 'espace')
  out = out.replace(/\bsubagents?\b/giu, 'agent')
  out = out.replace(/\bbwrap\b/giu, 'bac à sable')
  out = out.replace(/\btmux\b/giu, 'terminal')
  out = out.replace(/\bpty-host\b/giu, 'hôte terminal')
  out = out.replace(/\bevents\.jsonl\b/giu, 'journal')
  out = out.replace(/\baggregateId\b/giu, 'identifiant')
  out = out.replace(/\bspecStatus\b/giu, 'état de spec')
  out = out.replace(/\brealizedCommit\b/giu, 'ancrage')
  out = out.replace(/\blanes?\b/giu, 'piste')
  out = out.replace(/\bshards?\b/giu, 'lot')
  return cleanDisplayText(out)
}

export interface ProjectOwnerTableOptions {
  baselineCommit?: string
  workspace?: string
  now?: string
  policy?: OwnerTablePolicy
  policyPath?: string
  defaultPolicyPath?: string
  statePolicyPath?: string
  /**
   * Optional velocity-estimator bindings (#376) keyed by demandId, itemId, or request number string.
   * Each binding is qualified via `qualifyVelocityEta`: labelled `mesuré` (`source: 'measured'`)
   * ONLY when all inputs are qualified, otherwise `inconnu` (`source: 'unknown'`).
   */
  velocityBindings?:
    | ReadonlyMap<string, VelocityEtaBindingInput | readonly VelocityEtaBindingInput[]>
    | Readonly<Record<string, VelocityEtaBindingInput | readonly VelocityEtaBindingInput[]>>
}

function hasValidArchiveDecision(state: State, decisionId: string | undefined): boolean {
  if (decisionId === undefined || decisionId.trim() === '') return false
  const dec = state.decisions.get(decisionId)
  return dec !== undefined && dec.outcome === 'go'
}

/**
 * Project the folded `State` and event log into an `OwnerTableView`.
 * Pure read-time projection: never invents request numbers, causes, withdrawal reasons,
 * stages without links, or recommendations, and never rewrites gated text.
 */
export function projectOwnerTable(
  state: State,
  events: readonly TrackEvent[],
  options: ProjectOwnerTableOptions = {},
): OwnerTableView {
  const baselineCommit = options.baselineCommit ?? 'HEAD'
  const registeredNumbers = new Set<number>()
  const archivedNumbers = new Set<number>()
  const everOwnerItemIds = new Set<string>()
  const historicalItemNumbers = new Map<string, number>()
  const historicalItemRequests = new Map<string, string>()
  const createdAtByAggregate = new Map<string, string>()

  const promotedItemIds = new Set<string>()
  for (const demand of state.demands.values()) {
    for (const itemId of demand.itemIds ?? []) promotedItemIds.add(itemId)
  }

  for (const ev of events) {
    if (
      typeof ev.at === 'string' &&
      !createdAtByAggregate.has(ev.aggregateId) &&
      (ev.type === 'demand.raised' ||
        ev.type === 'item.created' ||
        ev.type === 'decision.created' ||
        ev.type === 'item.report-updated')
    ) {
      createdAtByAggregate.set(ev.aggregateId, ev.at)
    }
    if (ev.type === 'demand.owner-numbered') {
      const demand = state.demands.get(ev.aggregateId)
      if (options.workspace !== undefined && demand !== undefined && demand.workspace !== options.workspace) continue
      const num = (ev.payload as { number?: number }).number
      if (typeof num === 'number' && Number.isInteger(num) && num >= 1) {
        registeredNumbers.add(num)
      }
    } else if (ev.type === 'item.report-updated') {
      const item = state.items.get(ev.aggregateId)
      if (options.workspace !== undefined && item !== undefined && item.workspace !== options.workspace) continue
      const payload = ev.payload as {
        ownerNumber?: number
        ownerSummary?: string
        ownerRequest?: string
      } | undefined
      if (typeof payload?.ownerNumber === 'number' && Number.isInteger(payload.ownerNumber) && payload.ownerNumber >= 1) {
        if (!promotedItemIds.has(ev.aggregateId)) {
          registeredNumbers.add(payload.ownerNumber)
        }
        historicalItemNumbers.set(ev.aggregateId, payload.ownerNumber)
      }
      const histReq =
        typeof payload?.ownerSummary === 'string' && payload.ownerSummary.trim() !== ''
          ? payload.ownerSummary.trim()
          : typeof payload?.ownerRequest === 'string' && payload.ownerRequest.trim() !== ''
            ? payload.ownerRequest.trim()
            : undefined
      if (histReq !== undefined) {
        historicalItemRequests.set(ev.aggregateId, histReq)
      }
      if (payload?.ownerNumber !== undefined || histReq !== undefined) {
        everOwnerItemIds.add(ev.aggregateId)
      }
    }
  }

  for (const demand of state.demands.values()) {
    if (options.workspace !== undefined && demand.workspace !== options.workspace) continue
    if (demand.ownerNumber !== undefined) {
      registeredNumbers.add(demand.ownerNumber)
      if (demand.archived !== undefined && hasValidArchiveDecision(state, demand.archived.decisionId)) {
        archivedNumbers.add(demand.ownerNumber)
      }
    }
  }
  for (const item of state.items.values()) {
    if (options.workspace !== undefined && item.workspace !== options.workspace) continue
    if (promotedItemIds.has(item.id)) continue
    const num = item.report?.ownerNumber ?? historicalItemNumbers.get(item.id)
    if (item.report?.ownerNumber !== undefined) {
      registeredNumbers.add(item.report.ownerNumber)
    }
    if (
      num !== undefined &&
      item.report?.archived !== undefined &&
      hasValidArchiveDecision(state, item.report.archived.decisionId)
    ) {
      archivedNumbers.add(num)
    }
  }

  interface CandidateSubject {
    kind: 'demand' | 'item'
    id: string
    explicitNumber?: number
    demand?: DemandState
    items: ItemState[]
  }

  const candidates: CandidateSubject[] = []

  for (const demand of state.demands.values()) {
    if (options.workspace !== undefined && demand.workspace !== options.workspace) continue
    if (demand.archived !== undefined && hasValidArchiveDecision(state, demand.archived.decisionId)) continue
    const promoted = (demand.itemIds ?? [])
      .map((id) => state.items.get(id))
      .filter((it): it is ItemState => it !== undefined)
    candidates.push({
      kind: 'demand',
      id: demand.id,
      ...(demand.ownerNumber !== undefined ? { explicitNumber: demand.ownerNumber } : {}),
      demand,
      items: promoted,
    })
  }

  for (const item of state.items.values()) {
    if (options.workspace !== undefined && item.workspace !== options.workspace) continue
    if (promotedItemIds.has(item.id)) continue
    if (item.report?.archived !== undefined && hasValidArchiveDecision(state, item.report.archived.decisionId)) continue
    const resolvedItemNumber = item.report?.ownerNumber ?? historicalItemNumbers.get(item.id)
    const hasOwnerMeta =
      everOwnerItemIds.has(item.id) ||
      resolvedItemNumber !== undefined ||
      item.report?.ownerSummary !== undefined ||
      item.report?.ownerRequest !== undefined
    if (!hasOwnerMeta) continue
    candidates.push({
      kind: 'item',
      id: item.id,
      ...(resolvedItemNumber !== undefined ? { explicitNumber: resolvedItemNumber } : {}),
      items: [item],
    })
  }

  const numberedCandidates = candidates.map((c) => ({
    ...c,
    num: c.explicitNumber ?? 0,
  }))
  numberedCandidates.sort((a, b) => {
    if (a.num > 0 && b.num > 0) return a.num - b.num
    if (a.num > 0) return -1
    if (b.num > 0) return 1
    return 0
  })

  const pauseDecisionIds = new Set<string>()
  for (const item of state.items.values()) {
    if (options.workspace !== undefined && item.workspace !== options.workspace) continue
    if (
      item.report?.pausedByOwner === true &&
      item.report.pauseDecisionId !== undefined &&
      item.report.pauseDecisionId.trim() !== ''
    ) {
      const dec = state.decisions.get(item.report.pauseDecisionId)
      if (dec !== undefined && (dec.outcome === 'go' || dec.outcome === 'deferred')) {
        pauseDecisionIds.add(dec.id)
      }
    }
  }

  const isTargetArchived = (targetId: string, seen = new Set<string>()): boolean => {
    if (seen.has(targetId)) return false
    seen.add(targetId)
    const dem = state.demands.get(targetId)
    if (dem !== undefined) {
      return dem.archived !== undefined && hasValidArchiveDecision(state, dem.archived.decisionId)
    }
    const it = state.items.get(targetId)
    if (it === undefined) return false
    if (it.report?.archived !== undefined && hasValidArchiveDecision(state, it.report.archived.decisionId)) {
      return true
    }
    if (it.demandId !== undefined && isTargetArchived(it.demandId, seen)) return true
    for (const parentDem of state.demands.values()) {
      if (parentDem.itemIds?.includes(it.id) && isTargetArchived(parentDem.id, seen)) return true
    }
    if (it.parentId !== undefined && isTargetArchived(it.parentId, seen)) return true
    return false
  }

  const isTargetWithdrawnOrArchived = (targetId: string, seen = new Set<string>()): boolean => {
    if (isTargetArchived(targetId)) return true
    if (seen.has(targetId)) return false
    seen.add(targetId)
    const dem = state.demands.get(targetId)
    if (dem !== undefined) {
      if (dem.status === 'rejected' || dem.status === 'duplicate') return true
      const itemIds = dem.itemIds ?? []
      return itemIds.length > 0 && itemIds.every((id) => isTargetWithdrawnOrArchived(id, new Set(seen)))
    }
    const it = state.items.get(targetId)
    if (it === undefined) return false
    if (it.realization === 'cancelled' || it.realization === 'rejected') return true
    if (it.demandId !== undefined) {
      const parentDem = state.demands.get(it.demandId)
      if (parentDem !== undefined && (parentDem.status === 'rejected' || parentDem.status === 'duplicate')) {
        return true
      }
    }
    for (const parentDem of state.demands.values()) {
      if (
        parentDem.itemIds?.includes(it.id) &&
        (parentDem.status === 'rejected' || parentDem.status === 'duplicate')
      ) {
        return true
      }
    }
    if (it.parentId !== undefined && isTargetWithdrawnOrArchived(it.parentId, seen)) return true
    return false
  }

  // Every unsettled decision in the workspace (except owner-pause deferrals) is listed,
  // including legacy decisions without options (which fail Gate 5 instead of silently disappearing)
  const pendingDecisions: DecisionState[] = []
  for (const decision of state.decisions.values()) {
    if (options.workspace !== undefined && decision.workspace !== options.workspace) continue
    if (
      isSettled(decision.outcome) ||
      (decision.outcome === 'deferred' && pauseDecisionIds.has(decision.id))
    ) {
      continue
    }
    pendingDecisions.push(decision)
  }

  const extractOwnerGateSession = (context: string | undefined): string | undefined => {
    if (context === undefined) return undefined
    for (const line of context.split('\n')) {
      const match = /^\s*Target instance and session:\s*(.+?)\s*$/iu.exec(line)
      if (match !== null && match[1] !== undefined && match[1].trim() !== '') {
        return match[1].trim()
      }
    }
    return undefined
  }

  const sansObjetDecisionIds = new Set<string>()
  const decisionRefById = new Map<string, string>()
  const ownerDecisionById = new Map<string, OwnerTableDecision>()
  const ownerDecisions: OwnerTableDecision[] = pendingDecisions.map((d) => {
    const isGate = isOwnerGateTitle(d.title)
    const sansObjet =
      d.targets.length > 0 && d.targets.every((targetId) => isTargetWithdrawnOrArchived(targetId))
    if (sansObjet) {
      sansObjetDecisionIds.add(d.id)
    }
    const question = cleanDisplayText(shortDecisionSubject(d.title))
    const rawOptions = Array.isArray(d.dossier?.options) ? d.dossier.options : []
    const optionsList: OwnerTableDecisionOption[] = rawOptions.map((opt, optIdx) => ({
      letter: optionLetter(optIdx),
      label: cleanDisplayText(opt.title),
      consequence: cleanDisplayText(opt.summary),
    }))
    const recOptionId = d.dossier?.recommendation?.optionId
    const recRationale = d.dossier?.recommendation?.rationale
    const recIdx =
      recOptionId !== undefined ? rawOptions.findIndex((o) => o.id === recOptionId) : -1
    const recommendedLetter = recIdx >= 0 ? optionLetter(recIdx) : ''
    const recommendation =
      recIdx >= 0 && recRationale !== undefined && recRationale.trim() !== ''
        ? cleanDisplayText(recRationale)
        : ''
    // Stable decision numbers (lot 2): positional numbering is removed. OWNER GATE, E5 (incomplete
    // dossier — hides even a recorded number until complete), and E9 (no registered number) carry
    // internal `ref: ''` (JSON `null`).
    const incomplete = isDecisionIncomplete({
      question,
      options: optionsList,
      recommendedLetter,
      recommendation,
    })
    const ref =
      isGate || incomplete
        ? ''
        : d.ownerNumber !== undefined && Number.isInteger(d.ownerNumber) && d.ownerNumber >= 1
          ? `D${d.ownerNumber}`
          : ''
    decisionRefById.set(d.id, ref)
    const artifactLink = d.dossier?.artifacts?.find((a) => a.kind === 'rendered-view')?.viewRef
    const hasOpenBlocker =
      !sansObjet &&
      !pauseDecisionIds.has(d.id) &&
      [...state.blockers.values()].some(
        (b) => b.open && b.kind === 'decision' && b.ref === d.id,
      )
    const rawQa = Array.isArray(d.dossier?.qa) ? d.dossier.qa : []
    const openQuestionCount = rawQa.filter(
      (q) => q.answer === undefined || q.answer.trim() === '',
    ).length
    const createdAt = createdAtByAggregate.get(d.id)
    const session = isGate ? extractOwnerGateSession(d.dossier?.context) : undefined
    const entry: OwnerTableDecision = {
      ref,
      id: d.id,
      kind: isGate ? 'owner-gate' : 'decision',
      question,
      options: optionsList,
      recommendedLetter,
      recommendation,
      ...(artifactLink !== undefined ? { dossierLink: artifactLink } : {}),
      blocking: hasOpenBlocker,
      ...(sansObjet ? { sansObjet: true } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      deferred: d.outcome === 'deferred',
      openQuestionCount,
      ...(session !== undefined ? { session } : {}),
    }
    ownerDecisionById.set(d.id, entry)
    return entry
  })

  const decisionTargetsItem = (
    d: DecisionState,
    item: ItemState | undefined,
    demandIdForSingle?: string,
  ): boolean => {
    for (const targetId of d.targets) {
      if (demandIdForSingle !== undefined && targetId === demandIdForSingle) return true
      if (item !== undefined && targetId === item.id) return true
      const visited = new Set<string>()
      let curr = state.items.get(targetId)
      while (curr !== undefined && !visited.has(curr.id)) {
        visited.add(curr.id)
        if (item !== undefined && curr.id === item.id) return true
        if (demandIdForSingle !== undefined && curr.demandId === demandIdForSingle) return true
        curr = curr.parentId !== undefined ? state.items.get(curr.parentId) : undefined
      }
    }
    return false
  }

  const projectSingleOrLotRow = (params: {
    rowKind: 'single' | 'lot'
    num: number
    rowId: string
    parentDemandId?: string
    demand?: DemandState
    item?: ItemState
    request: string
    requestedStage?: ReportStage
  }): OwnerTableRow => {
    const { rowKind, num, rowId, parentDemandId, demand, item, request, requestedStage } = params
    const report = item?.report
    const derived =
      item !== undefined ? deriveItemStageStatus(state, events, item, baselineCommit) : undefined

    let stage: ReportStage | undefined
    let status: ReportStatus
    let hasWitness = false
    let pausedByOwner = false

    if (item === undefined && demand !== undefined) {
      stage = undefined
      if (demand.status === 'rejected' || demand.status === 'duplicate') {
        status = 'withdrawn'
      } else if (demand.status === 'parked') {
        if (demand.parkReason !== undefined && demand.parkReason.trim() !== '') {
          status = 'not-started'
          pausedByOwner = true
        } else {
          status = 'not-qualified'
        }
      } else {
        status = 'not-started'
      }
    } else if (derived !== undefined) {
      stage = derived.linkedStage
      hasWitness =
        stage !== undefined &&
        derived.qualified &&
        derived.linkedStageEvidence !== undefined &&
        derived.linkedStageEvidence.trim() !== ''
      pausedByOwner = derived.status === 'not-started' && derived.pausedByOwner === true
      status = derived.status
      if (status === 'on-track' && (!hasWitness || stage === undefined || stage === 'done')) {
        status = 'not-qualified'
      } else if (status === 'done' && (stage !== 'done' || !hasWitness)) {
        status = hasWitness && stage !== undefined && stage !== 'done' ? 'on-track' : 'not-qualified'
      }
    } else {
      status = 'not-started'
    }

    // Decisions linked to this specific row (a lot row never reads decisions targeting the demand or sibling lots)
    const linkedDecisionIds = new Set<string>()
    for (const d of pendingDecisions) {
      if (decisionTargetsItem(d, item, rowKind === 'single' ? demand?.id : undefined)) {
        if (status !== 'withdrawn' || sansObjetDecisionIds.has(d.id)) {
          linkedDecisionIds.add(d.id)
        }
      }
    }
    const rowDecisionIds: string[] = [...linkedDecisionIds]
    const explicitRefs = status === 'withdrawn' ? [] : (report?.decisionRefs ?? [])
    const rowDecisionRefs = [
      ...explicitRefs,
      ...rowDecisionIds
        .map((id) => decisionRefById.get(id))
        .filter((r): r is string => r !== undefined && r !== ''),
    ]
    const uniqueDecisionRefs = [...new Set(rowDecisionRefs)]

    const openDecisionBlockers =
      item === undefined || status === 'withdrawn'
        ? []
        : (() => {
            const itPauseId =
              item.report?.pausedByOwner === true && item.report.pauseDecisionId !== undefined
                ? item.report.pauseDecisionId
                : undefined
            const itOwnerPaused = itPauseId !== undefined && pauseDecisionIds.has(itPauseId)
            return effectiveOpenBlockersForItem(state, item.id, baselineCommit).filter((b) => {
              if (b.kind !== 'decision') return false
              if (itOwnerPaused && (b.ref === undefined || b.ref === itPauseId)) return false
              if (b.ref !== undefined && pauseDecisionIds.has(b.ref)) return false
              return true
            })
          })()

    const blockingDecisionIdSet = new Set<string>()
    const blockingDecisionRefSet = new Set<string>()
    if (status !== 'withdrawn') {
      for (const dId of linkedDecisionIds) {
        const isBlockingThisRow =
          openDecisionBlockers.some((b) => b.ref === undefined || b.ref === dId) ||
          (rowKind === 'single' &&
            demand !== undefined &&
            [...state.blockers.values()].some(
              (b) => b.open && b.kind === 'decision' && b.targetId === demand.id && b.ref === dId,
            ))
        if (isBlockingThisRow) {
          blockingDecisionIdSet.add(dId)
          const ref = decisionRefById.get(dId)
          if (ref !== undefined && ref !== '') blockingDecisionRefSet.add(ref)
        }
      }
      if (!pausedByOwner && report?.decisionBlocking === true) {
        for (const dId of rowDecisionIds) blockingDecisionIdSet.add(dId)
        for (const ref of uniqueDecisionRefs) blockingDecisionRefSet.add(ref)
      }
    }

    // Also incorporate item.report.decisionExpectations if set and no native Decision exists
    if (
      status !== 'withdrawn' &&
      report?.decisionExpectations !== undefined &&
      rowDecisionIds.length === 0 &&
      uniqueDecisionRefs.length === 0
    ) {
      // Synthetic `:expectation` decisions retain identity and qualify as E5 without invented numbering.
      const ref = ''
      const syntheticId = `${rowId}:expectation`
      rowDecisionIds.push(syntheticId)
      if (report.decisionBlocking === true || openDecisionBlockers.length > 0) {
        blockingDecisionIdSet.add(syntheticId)
      }
      const opts = report.decisionExpectations.options.map((o, idx) => ({
        letter: optionLetter(idx),
        label: cleanDisplayText(o.label),
        consequence: cleanDisplayText(o.consequence),
      }))
      const syntheticCreatedAt =
        createdAtByAggregate.get(item?.id ?? rowId) ?? createdAtByAggregate.get(rowId)
      const syntheticEntry: OwnerTableDecision = {
        ref,
        id: syntheticId,
        kind: 'decision',
        question: cleanDisplayText(report.decisionExpectations.question),
        options: opts,
        recommendedLetter: '',
        recommendation: '',
        ...(report.decisionExpectations.dossier !== undefined
          ? { dossierLink: report.decisionExpectations.dossier }
          : {}),
        blocking: blockingDecisionIdSet.has(syntheticId),
        ...(syntheticCreatedAt !== undefined ? { createdAt: syntheticCreatedAt } : {}),
        deferred: false,
        openQuestionCount: 0,
      }
      decisionRefById.set(syntheticId, ref)
      ownerDecisionById.set(syntheticId, syntheticEntry)
      ownerDecisions.push(syntheticEntry)
    }

    const sansObjetDecisionIdSet = new Set<string>()
    const sansObjetDecisionRefSet = new Set<string>()
    for (const dId of linkedDecisionIds) {
      if (sansObjetDecisionIds.has(dId)) {
        sansObjetDecisionIdSet.add(dId)
        const ref = decisionRefById.get(dId)
        if (ref !== undefined && ref !== '') sansObjetDecisionRefSet.add(ref)
      }
    }
    const rowSansObjetIds = rowDecisionIds.filter((dId) => sansObjetDecisionIdSet.has(dId))
    const rowBlockingIds = rowDecisionIds.filter((dId) => blockingDecisionIdSet.has(dId))
    const sansObjetDecisionRefs = uniqueDecisionRefs.filter((ref) => sansObjetDecisionRefSet.has(ref))
    const blockingDecisionRefs = uniqueDecisionRefs.filter((ref) => blockingDecisionRefSet.has(ref))
    const decisionBlocking =
      status !== 'withdrawn' &&
      (rowBlockingIds.length > 0 ||
        blockingDecisionRefs.length > 0 ||
        (!pausedByOwner && report?.decisionBlocking === true))

    if (decisionBlocking) {
      status = 'blocked'
    }

    const toEtaEntry = (j: ReportEtaEntry): ReportEtaEntry => ({
      targetStage: j.targetStage,
      ...(j.targetLabel !== undefined ? { targetLabel: j.targetLabel } : {}),
      when: j.when,
      source: j.source,
      ...(j.by !== undefined ? { by: j.by } : {}),
      ...(j.slip !== undefined ? { slip: j.slip } : {}),
      ...(j.measured !== undefined ? { measured: j.measured } : {}),
    })

    interface SingleItemEtaSlot {
      entry: ReportEtaEntry
      origin: 'item' | 'demand' | 'velocity'
    }

    const baseSlots: SingleItemEtaSlot[] = []
    const itemEtas =
      item?.etaJournal !== undefined && item.etaJournal.length > 0
        ? item.etaJournal.filter((j) => j.delivered !== true)
        : (report?.etas ?? [])
    for (const j of itemEtas) {
      baseSlots.push({ entry: toEtaEntry(j), origin: 'item' })
    }
    if (rowKind === 'single' && demand?.etaJournal !== undefined) {
      for (const j of demand.etaJournal.filter((entry) => entry.delivered !== true)) {
        baseSlots.push({ entry: toEtaEntry(j), origin: 'demand' })
      }
    }

    const lookupVelocityInputs = (): VelocityEtaBindingInput[] => {
      if (options.velocityBindings === undefined) return []
      // A lot row reads ONLY its own item id; never the parent demand or request number
      const keysToTry =
        rowKind === 'lot'
          ? item !== undefined
            ? [item.id]
            : []
          : [
              rowId,
              ...(item !== undefined && item.id !== rowId ? [item.id] : []),
              ...(num > 0 ? [String(num)] : []),
            ]
      const matched: VelocityEtaBindingInput[] = []
      const seenKeys = new Set<string>()
      for (const k of keysToTry) {
        if (seenKeys.has(k)) continue
        seenKeys.add(k)
        const found =
          options.velocityBindings instanceof Map
            ? options.velocityBindings.get(k)
            : (
                options.velocityBindings as Readonly<
                  Record<string, VelocityEtaBindingInput | readonly VelocityEtaBindingInput[]>
                >
              )[k]
        if (found !== undefined) {
          const list = Array.isArray(found) ? found : [found as VelocityEtaBindingInput]
          matched.push(...list)
        }
      }
      return matched
    }

    const velocityInputs = lookupVelocityInputs()
    const velocitySlots: SingleItemEtaSlot[] = velocityInputs.map((vInput) => {
      const priorSlot =
        baseSlots.find((s) => s.entry.targetStage === vInput.targetStage && s.entry.slip !== undefined) ??
        baseSlots.find((s) => s.entry.targetStage === vInput.targetStage)
      const qualified = qualifyVelocityEta({
        ...vInput,
        ...(vInput.slip !== undefined
          ? { slip: vInput.slip }
          : priorSlot?.entry.slip !== undefined
            ? { slip: priorSlot.entry.slip }
            : {}),
      })
      return {
        entry: qualified.eta,
        origin: 'velocity',
      }
    })

    const rawSlots = [...velocitySlots, ...baseSlots]
    const evaluatedSlots = rawSlots.map((slot) => ({
      ...evaluateEtaDeadline(slot.entry, stage, {
        ...(options.now !== undefined ? { now: options.now } : {}),
        pausedByOwner,
      }),
      origin: slot.origin,
    }))

    const displaySlots = evaluatedSlots.filter(
      (ev) => stage === undefined || STAGE_RANK[stage] < STAGE_RANK[ev.eta.targetStage],
    )
    const anyEtaMissed = displaySlots.some((ev) => ev.missed)

    let etas: ReportEtaEntry[]
    if (status === 'done' || status === 'withdrawn') {
      etas = []
    } else if (displaySlots.length > 0) {
      const byStage = new Map<
        ReportStage,
        { eta: ReportEtaEntry; missed: boolean; origin: 'item' | 'demand' | 'velocity' }
      >()
      for (const ev of displaySlots) {
        const prev = byStage.get(ev.eta.targetStage)
        if (prev === undefined || (!prev.missed && ev.missed)) {
          byStage.set(ev.eta.targetStage, ev)
        }
      }
      const unique = [...byStage.values()]
      unique.sort(
        (a, b) =>
          (b.missed ? 1 : 0) - (a.missed ? 1 : 0) ||
          STAGE_RANK[a.eta.targetStage] - STAGE_RANK[b.eta.targetStage],
      )
      etas = unique.slice(0, 2).map((ev) => ev.eta)
    } else {
      etas = [
        {
          targetStage: defaultTargetStageFor(stage, requestedStage),
          when: '—',
          source: 'unknown',
        },
      ]
    }

    if (anyEtaMissed && status !== 'withdrawn' && status !== 'done' && status !== 'blocked') {
      status = 'unforeseen'
    }

    // Done cell (`Fait`)
    let doneText: string
    if (status === 'withdrawn') {
      const itemFacts = report?.facts?.trim() !== '' ? report?.facts?.trim() : undefined
      let settledDecisionReason: string | undefined
      if (item !== undefined) {
        const linkedSettled = [...state.decisions.values()]
          .filter((d) => d.targets.includes(item.id) && d.outcome === 'no-go')
          .sort((a, b) => (a.id < b.id ? -1 : 1))
        for (const decision of linkedSettled) {
          const selected = decision.dossier.options.find((o) => o.id === decision.dossier.selectedOptionId)
          const cand = selected?.summary?.trim() || selected?.title?.trim()
          if (cand !== undefined && cand !== '') {
            settledDecisionReason = cand
            break
          }
        }
      }
      const reopenReason =
        item?.reopenings?.at(-1)?.reason?.trim() !== '' ? item?.reopenings?.at(-1)?.reason?.trim() : undefined
      const reason =
        (rowKind === 'single' ? demand?.rejectReason : undefined) ??
        itemFacts ??
        settledDecisionReason ??
        reopenReason
      doneText = reason !== undefined && reason.trim() !== '' ? cleanDisplayText(reason) : '—'
    } else {
      const parts: string[] = []
      if (report?.facts !== undefined && report.facts.trim() !== '') {
        parts.push(cleanDisplayText(report.facts))
      }
      if (
        parts.length === 0 &&
        derived?.linkedStageEvidence !== undefined &&
        derived.linkedStageEvidence.trim() !== ''
      ) {
        parts.push(`Preuve : ${cleanDisplayText(derived.linkedStageEvidence)}`)
      }
      doneText = parts.length > 0 ? parts.join(' · ') : '—'
    }

    // Todo cell (`À faire (qui)`) — never inject a fallback cause when blocked
    let todoText: string
    if (status === 'withdrawn') {
      todoText = '—'
    } else {
      const openBlockers =
        item !== undefined ? effectiveOpenBlockersForItem(state, item.id, baselineCommit) : []
      const blockerReasons = openBlockers
        .filter((b) => b.kind !== 'decision')
        .map((b) => cleanDisplayText(b.reason))
        .filter((r) => r.length > 0)

      const baseTodoParts: string[] = []
      if (rowBlockingIds.length > 0) {
        for (const dId of rowBlockingIds) {
          const dec = ownerDecisionById.get(dId)
          if (dec === undefined) continue
          const isGate = dec.kind === 'owner-gate'
          const incomplete = !isGate && isDecisionIncomplete(dec)
          const isToNumber = !isGate && !incomplete && dec.ref === ''
          baseTodoParts.push(
            formatBlockingDecisionTodoCause({
              kind: dec.kind ?? 'decision',
              ref: dec.ref !== '' ? dec.ref : null,
              isToInstruct: incomplete,
              isToNumber,
              session: dec.session ?? null,
            }),
          )
        }
      } else if (blockingDecisionRefs.length > 0) {
        for (const ref of blockingDecisionRefs) {
          baseTodoParts.push(
            formatBlockingDecisionTodoCause({
              kind: 'decision',
              ref,
              isToInstruct: false,
            }),
          )
        }
      }
      if (blockerReasons.length > 0) {
        baseTodoParts.push(...new Set(blockerReasons))
      }
      if (report?.waitingOn !== undefined && report.waitingOn.trim() !== '') {
        const w = `attente : ${cleanDisplayText(report.waitingOn)}`
        if (!baseTodoParts.includes(w)) baseTodoParts.push(w)
      }
      if (report?.nextAction !== undefined && report.nextAction.trim() !== '') {
        const na = cleanDisplayText(report.nextAction)
        if (!baseTodoParts.includes(na)) baseTodoParts.push(na)
      } else if (report?.proposal !== undefined && report.proposal.trim() !== '') {
        const pr = cleanDisplayText(report.proposal)
        if (!baseTodoParts.includes(pr)) baseTodoParts.push(pr)
      }
      if (
        baseTodoParts.length === 0 &&
        rowKind === 'single' &&
        demand !== undefined &&
        item === undefined &&
        status !== 'blocked'
      ) {
        if (demand.status === 'parked' && demand.parkReason !== undefined && demand.parkReason.trim() !== '') {
          baseTodoParts.push(`en pause (${cleanDisplayText(demand.parkReason)})`)
        }
      }
      todoText = baseTodoParts.length > 0 ? baseTodoParts.join(' ; ') : '—'
    }

    const rowCreatedAt =
      createdAtByAggregate.get(rowId) ??
      (item !== undefined ? createdAtByAggregate.get(item.id) : undefined)

    const capturedDemand = rowKind === 'single' && demand?.captured === true ? demand : undefined
    const capturedTitle = capturedDemand !== undefined ? (capturedDemand.ownerSummary ?? capturedDemand.raw.title) : undefined
    const capturedText = capturedDemand !== undefined ? capturedDemand.raw.text : undefined

    return {
      kind: rowKind,
      ...(parentDemandId !== undefined ? { parentDemandId } : {}),
      num,
      id: rowId,
      status,
      ...(pausedByOwner ? { pausedByOwner: true } : {}),
      ...(stage !== undefined ? { stage } : {}),
      ...(requestedStage !== undefined ? { requestedStage } : {}),
      etas,
      request,
      done: doneText,
      todo: todoText,
      decisionRefs: uniqueDecisionRefs,
      ...(sansObjetDecisionRefs.length > 0 ? { sansObjetDecisionRefs } : {}),
      ...(blockingDecisionRefs.length > 0 ? { blockingDecisionRefs } : {}),
      decisionIds: rowDecisionIds,
      ...(rowBlockingIds.length > 0 ? { blockingDecisionIds: rowBlockingIds } : {}),
      ...(rowSansObjetIds.length > 0 ? { sansObjetDecisionIds: rowSansObjetIds } : {}),
      ...(decisionBlocking ? { decisionBlocking: true } : {}),
      hasWitness,
      ...(rowCreatedAt !== undefined ? { createdAt: rowCreatedAt } : {}),
      ...(capturedDemand !== undefined
        ? {
            captured: true,
            ...(capturedDemand.captureOrigin !== undefined ? { captureOrigin: capturedDemand.captureOrigin } : {}),
            ...(capturedTitle !== undefined && capturedTitle.trim() !== '' ? { capturedTitle: cleanDisplayText(capturedTitle) } : {}),
            ...(capturedText !== undefined ? { capturedText: cleanDisplayText(capturedText) } : {}),
            ...(capturedDemand.maskedAtInscription === true ? { maskedAtInscription: true } : {}),
          }
        : {}),
    }
  }

  const rows: OwnerTableRow[] = []

  for (const c of numberedCandidates) {
    if (c.kind === 'demand' && c.items.length > 1) {
      const demand = c.demand!
      const rawTitleRequest =
        demand.ownerSummary ?? demand.raw.title ?? demand.raw.text ?? ''
      const titleRequest = cleanDisplayText(rawTitleRequest)

      // Decisions targeting the demand itself (not individual lots)
      const titleDecisionIds: string[] = []
      for (const d of pendingDecisions) {
        if (d.targets.includes(demand.id)) {
          titleDecisionIds.push(d.id)
        }
      }
      const titleDecisionRefs = titleDecisionIds
        .map((id) => decisionRefById.get(id))
        .filter((r): r is string => r !== undefined && r !== '')
      const titleSansObjetIds = titleDecisionIds.filter((dId) => sansObjetDecisionIds.has(dId))
      const titleSansObjetRefs = titleSansObjetIds
        .map((dId) => decisionRefById.get(dId))
        .filter((r): r is string => r !== undefined && r !== '')
      const titleBlockingIds = titleDecisionIds.filter(
        (dId) =>
          !sansObjetDecisionIds.has(dId) &&
          [...state.blockers.values()].some(
            (b) => b.open && b.kind === 'decision' && b.targetId === demand.id && b.ref === dId,
          ),
      )
      const titleBlockingRefs = titleBlockingIds
        .map((dId) => decisionRefById.get(dId))
        .filter((r): r is string => r !== undefined && r !== '')

      // Demand-level ETA (demand.eta-set) shows on the title row only if set, with its own slip/rebaseline logic
      const activeDemandEtas = (demand.etaJournal ?? []).filter((j) => j.delivered !== true)
      const titleEtas: ReportEtaEntry[] =
        activeDemandEtas.length > 0
          ? activeDemandEtas
              .map((j) =>
                evaluateEtaDeadline(
                  {
                    targetStage: j.targetStage,
                    ...(j.targetLabel !== undefined ? { targetLabel: j.targetLabel } : {}),
                    when: j.when,
                    source: j.source,
                    ...(j.by !== undefined ? { by: j.by } : {}),
                    ...(j.slip !== undefined ? { slip: j.slip } : {}),
                    ...(j.measured !== undefined ? { measured: j.measured } : {}),
                  },
                  undefined,
                  {
                    ...(options.now !== undefined ? { now: options.now } : {}),
                  },
                ),
              )
              .sort(
                (a, b) =>
                  (b.missed ? 1 : 0) - (a.missed ? 1 : 0) ||
                  STAGE_RANK[a.eta.targetStage] - STAGE_RANK[b.eta.targetStage],
              )
              .slice(0, 2)
              .map((ev) => ev.eta)
          : []

      const titleCreatedAt = createdAtByAggregate.get(demand.id)
      const titleCapturedTitle = demand.captured === true ? (demand.ownerSummary ?? demand.raw.title) : undefined
      rows.push({
        kind: 'demand-title',
        num: c.num,
        id: demand.id,
        ...(demand.requestedStage !== undefined ? { requestedStage: demand.requestedStage } : {}),
        etas: titleEtas,
        request: titleRequest,
        done: '—',
        todo: '—',
        decisionRefs: titleDecisionRefs,
        ...(titleSansObjetRefs.length > 0 ? { sansObjetDecisionRefs: titleSansObjetRefs } : {}),
        ...(titleBlockingRefs.length > 0 ? { blockingDecisionRefs: titleBlockingRefs } : {}),
        decisionIds: titleDecisionIds,
        ...(titleSansObjetIds.length > 0 ? { sansObjetDecisionIds: titleSansObjetIds } : {}),
        ...(titleBlockingIds.length > 0
          ? { blockingDecisionIds: titleBlockingIds, decisionBlocking: true }
          : {}),
        ...(titleCreatedAt !== undefined ? { createdAt: titleCreatedAt } : {}),
        ...(demand.captured === true
          ? {
              captured: true,
              ...(demand.captureOrigin !== undefined ? { captureOrigin: demand.captureOrigin } : {}),
              ...(titleCapturedTitle !== undefined && titleCapturedTitle.trim() !== ''
                ? { capturedTitle: cleanDisplayText(titleCapturedTitle) }
                : {}),
              capturedText: cleanDisplayText(demand.raw.text),
              ...(demand.maskedAtInscription === true ? { maskedAtInscription: true } : {}),
            }
          : {}),
      })

      c.items.forEach((lotItem, idx) => {
        const rawLotTitle =
          lotItem.report?.ownerSummary ?? lotItem.report?.ownerRequest ?? lotItem.title
        const cleanedLotTitle = cleanDisplayText(rawLotTitle)
        const lotRequest =
          cleanedLotTitle === ''
            ? ''
            : /^↳ lot \d+ — /u.test(cleanedLotTitle)
              ? cleanedLotTitle
              : `↳ lot ${idx + 1} — ${cleanedLotTitle}`
        rows.push(
          projectSingleOrLotRow({
            rowKind: 'lot',
            num: c.num,
            rowId: lotItem.id,
            parentDemandId: demand.id,
            item: lotItem,
            request: lotRequest,
            ...(lotItem.report?.requestedStage !== undefined
              ? { requestedStage: lotItem.report.requestedStage }
              : {}),
          }),
        )
      })
    } else {
      const primaryItem = c.items[0]
      const report = primaryItem?.report
      const rawRequest =
        c.kind === 'demand'
          ? (c.demand?.ownerSummary ??
            report?.ownerSummary ??
            report?.ownerRequest ??
            c.demand?.raw.title ??
            c.demand?.raw.text ??
            '')
          : (report?.ownerSummary ??
            report?.ownerRequest ??
            historicalItemRequests.get(primaryItem?.id ?? c.id) ??
            '')
      const request = cleanDisplayText(rawRequest)
      const requestedStage = c.demand?.requestedStage ?? report?.requestedStage
      rows.push(
        projectSingleOrLotRow({
          rowKind: 'single',
          num: c.num,
          rowId: c.id,
          ...(c.demand !== undefined ? { demand: c.demand } : {}),
          ...(primaryItem !== undefined ? { item: primaryItem } : {}),
          request,
          ...(requestedStage !== undefined ? { requestedStage } : {}),
        }),
      )
    }
  }

  const replyEligible = ownerDecisions
    .filter(
      (d) =>
        d.kind !== 'owner-gate' &&
        d.ref !== '' &&
        d.recommendedLetter !== '' &&
        d.recommendation !== '',
    )
    .sort((a, b) => parseDecisionRefNumber(a.ref) - parseDecisionRefNumber(b.ref))
  const replyLine =
    replyEligible.length > 0
      ? `Réponse : ${replyEligible.map((d) => `${d.ref} ${d.recommendedLetter}`).join(' · ')}`
      : ''

  return {
    kind: 'owner-table-report',
    rows,
    decisions: ownerDecisions,
    replyLine,
    registeredNumbers: [...registeredNumbers].sort((a, b) => a - b),
    archivedNumbers: [...archivedNumbers].sort((a, b) => a - b),
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
    ...(options.policyPath !== undefined ? { policyPath: options.policyPath } : {}),
    ...(options.defaultPolicyPath !== undefined ? { defaultPolicyPath: options.defaultPolicyPath } : {}),
    ...(options.statePolicyPath !== undefined ? { statePolicyPath: options.statePolicyPath } : {}),
  }
}
