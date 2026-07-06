export type WorkEventVerb = 'brainstorm' | 'debug' | 'review' | 'plan' | 'branch' | 'test' | 'skills';
export type WorkEventStatus = 'opened' | 'closed' | 'requested' | 'recorded';
/** A neutral detail value — primitives or string lists only (JSON-stable, ingester-friendly). */
export type WorkEventValue = string | number | boolean | string[];
export interface WorkEvent {
    schemaVersion: 1;
    kind: 'work-event';
    /** The harness verb that produced this event. */
    verb: WorkEventVerb;
    /** Lifecycle marker of the act. */
    status: WorkEventStatus;
    /** Free-form subject of the act (topic, symptom, target, lot, slug). */
    subject?: string;
    /** The `harness/*` skill the host should load for the reasoning (method verbs). */
    skill?: string;
    /** Opaque references (spec path, decision id, thread, BRANCH.md path). */
    refs: Record<string, string>;
    /** Structured neutral detail bag (peers, category, host, recipe steps). */
    detail: Record<string, WorkEventValue>;
    runId: string;
    commit: string;
    branch: string;
    env: string;
    runner: string;
    /** ISO-8601 timestamp. */
    at: string;
}
