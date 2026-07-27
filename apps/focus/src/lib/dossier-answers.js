// Where a dossier answer LIVES, and what to do when two copies disagree.
//
// The defect this exists to kill: the page kept the owner's answers in revision-scoped `localStorage`
// only. Open the same URL on a fresh browser, another port, another machine, or after clearing storage,
// and the dossier came up EMPTY — while the answers sat committed and intact in git the whole time.
// An answer whose only home is one browser profile is not recorded, it is cached.
//
// So the rule enforced here:
//
//   The committed answer set (docs/decisions/…-owner-answers.json, loaded server-side) is the DEFAULT
//   source of truth. `localStorage` is a DRAFT LAYER for edits that have not been committed yet — never
//   the only home of an answer, and never allowed to silently mask the committed set.
//
// When both exist and disagree we do NOT pick a winner quietly: `reconcileAnswerState` returns the exact
// list of decisions that differ, with both values, so the page can SAY SO. A silent pick is how the owner
// would lose the same answers a second time, only slower.
//
// Deliberately dependency-free ESM: this module is imported by the Svelte page AND executed directly by
// the repo's `node --test` suite. Logic a test can reach is logic that cannot rot unnoticed.

/**
 * @typedef {{ option: string | null, note: string }} AnswerEntry
 * @typedef {{ key: string, options: { key: string }[] }} DecisionShape
 * @typedef {{ selections: Record<string, string>, notes: Record<string, string> }} AnswerState
 */

/**
 * @typedef {object} ReplayReport
 * @property {string[]} applied        Decision keys restored from the set.
 * @property {string[]} missingDecisions Answer keys whose decision no longer exists in this revision.
 * @property {string[]} staleOptions   `KEY → option` whose option no longer exists: note replayed, selection not.
 * @property {string[]} unanswered     Decisions of THIS revision the set does not cover (cards added since).
 * @property {boolean} revisionMismatch
 */

/**
 * @typedef {object} Divergence
 * @property {string} key
 * @property {string | null} committedOption
 * @property {string | null} draftOption
 * @property {string} committedNote
 * @property {string} draftNote
 */

/** An empty state is indistinguishable from no state at all — and must be treated as such (see below). */
export function isEmptyAnswerState(/** @type {AnswerState | null | undefined} */ state) {
  if (!state) return true;
  return Object.keys(state.selections).length === 0 && Object.keys(state.notes).length === 0;
}

/**
 * Project a committed answer set onto the decisions of the CURRENT revision.
 *
 * Answers are revision-scoped: the committed set was captured against `agent-memory-2026-07-24`, the
 * dossier is at `-25`. What carries over carries over; what does not is REPORTED by key, never dropped in
 * silence. Both halves matter — answers that no longer land, and cards this set never covered.
 *
 * @param {{ revision: string, answers: Record<string, AnswerEntry> } | null | undefined} answerSet
 * @param {DecisionShape[]} decisions
 * @param {string} dossierRevision
 * @returns {{ state: AnswerState, report: ReplayReport } | null} `null` when there is no set to project.
 */
export function projectAnswerSet(answerSet, decisions, dossierRevision) {
  if (!answerSet || !answerSet.answers) return null;

  /** @type {Record<string, string>} */
  const selections = {};
  /** @type {Record<string, string>} */
  const notes = {};
  /** @type {string[]} */
  const applied = [];
  /** @type {string[]} */
  const missingDecisions = [];
  /** @type {string[]} */
  const staleOptions = [];

  for (const [key, entry] of Object.entries(answerSet.answers)) {
    const decision = decisions.find((candidate) => candidate.key === key);
    if (!decision) {
      missingDecisions.push(key);
      continue;
    }
    if (entry.option) {
      if (decision.options.some((option) => option.key === entry.option)) {
        selections[key] = entry.option;
      } else {
        // The reasoning survives even when the label it was attached to does not.
        staleOptions.push(`${key} → ${entry.option}`);
      }
    }
    if (typeof entry.note === 'string' && entry.note.length > 0) notes[key] = entry.note;
    applied.push(key);
  }

  const unanswered = decisions
    .filter((decision) => {
      const entry = answerSet.answers[decision.key];
      return !entry || (!entry.option && (entry.note ?? '').length === 0);
    })
    .map((decision) => decision.key);

  return {
    state: { selections, notes },
    report: {
      applied,
      missingDecisions,
      staleOptions,
      unanswered,
      revisionMismatch: answerSet.revision !== dossierRevision
    }
  };
}

/**
 * Rebuild a draft from raw `localStorage` payloads, keeping only what belongs to this revision.
 * Anything unparseable degrades to "no draft" — a corrupt draft must never be able to shadow the
 * committed answers.
 *
 * @param {unknown} rawSelections
 * @param {unknown} rawNotes
 * @param {DecisionShape[]} decisions
 * @returns {AnswerState}
 */
export function readDraft(rawSelections, rawNotes, decisions) {
  /** @type {Record<string, string>} */
  const selections = {};
  /** @type {Record<string, string>} */
  const notes = {};

  if (rawSelections && typeof rawSelections === 'object' && !Array.isArray(rawSelections)) {
    const source = /** @type {Record<string, unknown>} */ (rawSelections);
    for (const decision of decisions) {
      const optionKey = source[decision.key];
      if (typeof optionKey === 'string' && decision.options.some((o) => o.key === optionKey)) {
        selections[decision.key] = optionKey;
      }
    }
  }
  if (rawNotes && typeof rawNotes === 'object' && !Array.isArray(rawNotes)) {
    const source = /** @type {Record<string, unknown>} */ (rawNotes);
    for (const decision of decisions) {
      const note = source[decision.key];
      if (typeof note === 'string' && note.length > 0) notes[decision.key] = note;
    }
  }
  return { selections, notes };
}

/**
 * Which decisions the draft answers DIFFERENTLY from the committed set.
 *
 * Scoped to keys the committed set actually covers: answering a card added since (D8–D13) is an ADDITION,
 * not a disagreement, and flagging it would cry wolf until the warning means nothing. Comparison is on the
 * pair (option, note) because the note is the reasoning — a draft that keeps the option and loses the note
 * has diverged on the part that matters.
 *
 * @param {AnswerState} draft
 * @param {AnswerState} committed
 * @param {{ revision: string, answers: Record<string, AnswerEntry> } | null | undefined} answerSet
 * @returns {Divergence[]}
 */
export function diffAgainstCommitted(draft, committed, answerSet) {
  if (!answerSet || !answerSet.answers) return [];
  /** @type {Divergence[]} */
  const out = [];
  for (const key of Object.keys(answerSet.answers)) {
    // Only keys that survived the projection onto this revision can be compared at all.
    const covered = key in committed.selections || key in committed.notes;
    if (!covered) continue;
    const committedOption = committed.selections[key] ?? null;
    const draftOption = draft.selections[key] ?? null;
    const committedNote = committed.notes[key] ?? '';
    const draftNote = draft.notes[key] ?? '';
    if (committedOption !== draftOption || committedNote !== draftNote) {
      out.push({ key, committedOption, draftOption, committedNote, draftNote });
    }
  }
  return out;
}

/**
 * Decide what the page shows on load, and whether it owes the reader an explanation.
 *
 * An EMPTY draft counts as no draft — this is not a detail, it is the bug. The previous page persisted
 * `{}` into `localStorage` on every mount, so the owner's browser held a present-but-empty draft. Treating
 * "present" as "authoritative" is precisely what showed them an empty dossier while their answers sat in
 * git. Emptiness is absence of an answer, never an answer of absence.
 *
 * Precedence when a NON-empty draft disagrees: the draft is displayed (it is the human's unsaved work and
 * discarding it would be the same crime in the other direction) but `divergences` is non-empty, so the page
 * must name the disagreement and offer the committed set. Displayed, but never silently.
 *
 * @param {AnswerState | null} draft
 * @param {{ state: AnswerState, report: ReplayReport } | null} committed
 * @param {{ revision: string, answers: Record<string, AnswerEntry> } | null | undefined} answerSet
 * @returns {{ state: AnswerState, origin: 'committed' | 'draft' | 'empty', divergences: Divergence[] }}
 */
export function reconcileAnswerState(draft, committed, answerSet) {
  const committedState = committed ? committed.state : { selections: {}, notes: {} };

  if (isEmptyAnswerState(draft)) {
    return {
      state: committedState,
      origin: committed ? 'committed' : 'empty',
      divergences: []
    };
  }

  const draftState = /** @type {AnswerState} */ (draft);
  if (!committed) return { state: draftState, origin: 'draft', divergences: [] };

  const divergences = diffAgainstCommitted(draftState, committedState, answerSet);
  return {
    // No divergence means the draft IS the committed set — call it what it is, so the page does not
    // display a "local draft" warning about data identical to what is in git.
    state: draftState,
    origin: divergences.length > 0 ? 'draft' : 'committed',
    divergences
  };
}

/**
 * The answers the reader currently holds, in the shape the h2a envelope and the JSON export both use.
 * One builder, so what the CLI receives and what the clipboard yields can never drift apart.
 *
 * @param {AnswerState} state
 * @param {DecisionShape[]} decisions
 * @returns {{ decisionKey: string, optionKey: string | null, note: string }[]}
 */
export function collectAnswers(state, decisions) {
  return decisions.map((decision) => ({
    decisionKey: decision.key,
    optionKey: state.selections[decision.key] ?? null,
    note: (state.notes[decision.key] ?? '').trim()
  }));
}

/**
 * The subset worth transmitting: a decision with neither option nor note carries no information.
 * @param {AnswerState} state
 * @param {DecisionShape[]} decisions
 */
export function collectAnsweredOnly(state, decisions) {
  return collectAnswers(state, decisions).filter((a) => a.optionKey || a.note.length > 0);
}
