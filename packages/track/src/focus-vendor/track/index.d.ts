/**
 * `@sentropic/focus/track` — the read binding over `@sentropic/track/read` (Focus-M1 L2).
 *
 * Per SPEC_VOL_FOCUS §4b L2: binds the private `packages/focus` render-core to the REAL
 * `@sentropic/track` read API, replacing L1's local `DecisionDossierViewFixture` type + mapper.
 * A `TrackReader` read is PURE / read-only / clockless — NO auth, NO identity, NO clock (the L4
 * write lot is where identity enters). This module:
 *   1. reads a real `DecisionDossierView` from a track event log via
 *      `new TrackReader(eventsPath).canevas(workspace, { baselineCommit, decisionId }).dossier`,
 *   2. reads the ordered `amendmentTrace(decisionId)` for the same decision,
 *   3. maps both into the concrete L1 `DecisionDossierDocument`.
 *
 * It binds to the VERSIONED `@sentropic/track/read` subpath (NOT track's non-versioned barrel) and
 * gates on `reader.contractVersion` (the additive-only READ contract — consumers gate on it).
 */
import type { AmendmentStep as TrackAmendmentStep, DecisionDossierView, ItemId } from "@sentropic/track/read";
import type { DecisionDossierDocument } from "../model.js";
/**
 * The major-compatible `@sentropic/track/read` READ contract this binding was written against.
 * The contract is additive-only within a major; we accept any matching major (gate below).
 */
export declare const EXPECTED_TRACK_READ_MAJOR = 1;
/** Locator of a real decision in a track event log. `workspace` scopes the canevas materialization. */
export interface FocusTrackQuery {
    /** The workspace the decision lives in (scopes the per-workspace canevas). */
    readonly workspace: string;
    /** The caller-supplied baseline commit (track holds no git; the adapter owns it). */
    readonly baselineCommit: string;
    /** The decision aggregate id to surface as a full dossier. */
    readonly decisionId: ItemId;
}
/** Thrown when the installed `@sentropic/track/read` contract major is incompatible. */
export declare class TrackContractMismatchError extends Error {
    readonly actual: string;
    readonly expectedMajor: number;
    constructor(actual: string, expectedMajor: number);
}
/** Thrown when a `decisionId` is not present (or not a decision) in the read log. */
export declare class DecisionNotFoundError extends Error {
    readonly decisionId: ItemId;
    constructor(decisionId: ItemId);
}
/**
 * Map a REAL track `DecisionDossierView` + its ordered `amendmentTrace` into the concrete L1
 * `DecisionDossierDocument`. The comprehension evidence is carried VERBATIM from the nested
 * `dossier.artifacts[] (kind:'h2a-decision-dossier').comprehension[]` (subject/hash/sig intact).
 */
export declare const toDecisionDossierDocument: (view: DecisionDossierView, amendmentTrace: readonly TrackAmendmentStep[], meta: {
    readonly source: string;
    readonly readAt: string;
    readonly cursor: string;
}) => DecisionDossierDocument;
/**
 * Read a real decision from a track event log and project it into a `DecisionDossierDocument`.
 *
 * PURE / read-only / clockless: the `readAt` timestamp is CALLER-supplied (track holds no clock),
 * and no auth/identity is involved. The binding gates on `reader.contractVersion` (additive-only
 * READ contract) and throws `TrackContractMismatchError` on an incompatible major.
 *
 * @param eventsPath  path to the track event log (`.track/events.jsonl`)
 * @param query       workspace + baseline commit + decision id
 * @param readAt      caller-supplied ISO-8601 read timestamp (no clock in track)
 */
export declare const readDecisionDossier: (eventsPath: string, query: FocusTrackQuery, readAt: string) => DecisionDossierDocument;
