import type { CaptureCliMode } from '../capture/registry.js'
import {
  formatMotifAllArchived,
  formatMotifCapturedNotInscribed,
  formatMotifDecisionsPending,
  formatMotifDecisionsToComplete,
  formatMotifDesyncDocs,
  formatMotifExpiredUnclassified,
  formatMotifMaskedCells,
  formatMotifOpenQuestions,
  formatMotifOwnerGates,
  formatMotifRowsToComplete,
  formatMotifToAttach,
  formatMotifUnclassified,
  MOTIF_CAPTURE_INACTIVE,
  MOTIF_CAPTURE_PARTIAL,
  MOTIF_FREE_TEXT_QUESTIONS,
  MOTIF_POLICY_ABSENT,
  MOTIF_ZERO_DEMANDS,
} from './owner-table-strings.js'

export interface OwnerTableScopeMotif {
  kind: 'scope' | 'gap'
  text: string
}

export interface OwnerTableScopeEvaluation {
  /** Always `false` in this evolution (DS-1: free-text agent questions condition (f) is not qualified). */
  complete: false
  motifs: OwnerTableScopeMotif[]
}

export interface EvaluateScopeInput {
  policyFound: boolean
  activeDemands: number
  archivedDemands: number
  toAttach: number
  rowsToComplete: number
  decisionsToComplete: number
  decisionsPending: number
  ownerGates: number
  openQuestionCount: number
  maskedCells: number
  desyncCount: number
  /** Registered CLIs for capture scope motifs (orders 2, 3, 4; lot 3a). */
  captureClis?: readonly { cli: string; mode: CaptureCliMode | 'unqualified' }[]
  /** Queue gap counts (orders 6, 7, 8; lot 3a). */
  unclassifiedCount?: number
  expiredUnclassifiedCount?: number
  capturedNotInscribedCount?: number
}

/**
 * Evaluate V1 conditions (a) to (f) and return motifs in the fixed order of annex F.
 * - Condition (f) is the constant `false` (DS-1).
 * - Order 2 (`captation inactive`) fires when no registered CLI is `direct` or `deferred`,
 *   and replaces orders 3 and 4.
 * - Orders 6..8 emit queue gap counts from lot 3a.
 */
export function evaluateOwnerTableScope(input: EvaluateScopeInput): OwnerTableScopeEvaluation {
  const motifs: OwnerTableScopeMotif[] = []
  const clis = input.captureClis ?? []
  const captureActiveInRegistry = clis.some((c) => c.mode === 'direct' || c.mode === 'deferred')

  // Scope motifs (annex F order 2..5; order 1 is prepended when unassignedJournal):
  if (!captureActiveInRegistry) {
    // Order 2: capture inactive (replaces orders 3 and 4).
    motifs.push({ kind: 'scope', text: MOTIF_CAPTURE_INACTIVE })
  } else {
    // Order 3: at least one registered CLI is not `direct`.
    if (clis.some((c) => c.mode !== 'direct')) {
      motifs.push({ kind: 'scope', text: MOTIF_CAPTURE_PARTIAL })
    }
    // Order 4: condition (f) — always emitted whenever capture is not inactive (DS-1).
    motifs.push({ kind: 'scope', text: MOTIF_FREE_TEXT_QUESTIONS })
  }
  // Order 5: private-term policy absent.
  if (!input.policyFound) {
    motifs.push({ kind: 'scope', text: MOTIF_POLICY_ABSENT })
  }

  // Gap motifs (annex F order 6..18; order 19 is appended when unverifiedDocs > 0):
  // Order 6: unclassified messages in queue.
  const unclassified = input.unclassifiedCount ?? 0
  if (unclassified > 0) {
    motifs.push({ kind: 'gap', text: formatMotifUnclassified(unclassified) })
  }
  // Order 7: expired unclassified traces in queue.
  const expiredUnclassified = input.expiredUnclassifiedCount ?? 0
  if (expiredUnclassified > 0) {
    motifs.push({ kind: 'gap', text: formatMotifExpiredUnclassified(expiredUnclassified) })
  }
  // Order 8: classified entries waiting for inscription.
  const capturedNotInscribed = input.capturedNotInscribedCount ?? 0
  if (capturedNotInscribed > 0) {
    motifs.push({ kind: 'gap', text: formatMotifCapturedNotInscribed(capturedNotInscribed) })
  }
  // Order 9 / 10: 0 demands registered vs all archived.
  if (input.activeDemands === 0) {
    if (input.archivedDemands > 0) {
      motifs.push({ kind: 'gap', text: formatMotifAllArchived(input.archivedDemands) })
    } else {
      motifs.push({ kind: 'gap', text: MOTIF_ZERO_DEMANDS })
    }
  }
  // Order 11: E1 demands to attach.
  if (input.toAttach > 0) {
    motifs.push({ kind: 'gap', text: formatMotifToAttach(input.toAttach) })
  }
  // Order 12: E3 rows to complete.
  if (input.rowsToComplete > 0) {
    motifs.push({ kind: 'gap', text: formatMotifRowsToComplete(input.rowsToComplete) })
  }
  // Order 13: E4/E5/E6/E9 decisions to complete.
  if (input.decisionsToComplete > 0) {
    motifs.push({ kind: 'gap', text: formatMotifDecisionsToComplete(input.decisionsToComplete) })
  }
  // Order 14: clean pending decisions.
  if (input.decisionsPending > 0) {
    motifs.push({ kind: 'gap', text: formatMotifDecisionsPending(input.decisionsPending) })
  }
  // Order 15: open OWNER GATEs.
  if (input.ownerGates > 0) {
    motifs.push({ kind: 'gap', text: formatMotifOwnerGates(input.ownerGates) })
  }
  // Order 16: open dossier questions.
  if (input.openQuestionCount > 0) {
    motifs.push({ kind: 'gap', text: formatMotifOpenQuestions(input.openQuestionCount) })
  }
  // Order 17: E7 masked cells.
  if (input.maskedCells > 0) {
    motifs.push({ kind: 'gap', text: formatMotifMaskedCells(input.maskedCells) })
  }
  // Order 18: E8 desynchronised documents.
  if (input.desyncCount > 0) {
    motifs.push({ kind: 'gap', text: formatMotifDesyncDocs(input.desyncCount) })
  }

  return {
    complete: false,
    motifs,
  }
}
