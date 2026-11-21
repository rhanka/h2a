import {
  formatMotifAllArchived,
  formatMotifDecisionsPending,
  formatMotifDecisionsToComplete,
  formatMotifDesyncDocs,
  formatMotifMaskedCells,
  formatMotifOpenQuestions,
  formatMotifOwnerGates,
  formatMotifRowsToComplete,
  formatMotifToAttach,
  MOTIF_CAPTURE_INACTIVE,
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
}

/**
 * Evaluate V1 conditions (a) to (f) and return motifs in the fixed order of annex F.
 * - Condition (f) is the constant `false` (DS-1).
 * - Before lot 3a, capture is inactive (`captation inactive` replaces motifs 3 and 4).
 */
export function evaluateOwnerTableScope(input: EvaluateScopeInput): OwnerTableScopeEvaluation {
  const motifs: OwnerTableScopeMotif[] = []

  // Scope motifs (annex F order 1..5):
  // Order 2: capture inactive before lot 3a (replaces orders 3 and 4).
  motifs.push({ kind: 'scope', text: MOTIF_CAPTURE_INACTIVE })
  // Order 5: private-term policy absent.
  if (!input.policyFound) {
    motifs.push({ kind: 'scope', text: MOTIF_POLICY_ABSENT })
  }

  // Gap motifs (annex F order 9..18):
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
