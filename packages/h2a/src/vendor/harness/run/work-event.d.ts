import type { WorkEvent, WorkEventStatus, WorkEventValue, WorkEventVerb } from '../artifacts/work-event.js';
export interface WorkEventInput {
    verb: WorkEventVerb;
    status: WorkEventStatus;
    subject?: string;
    skill?: string;
    refs?: Record<string, string>;
    detail?: Record<string, WorkEventValue>;
}
export interface WorkEventContext {
    runId: string;
    commit: string;
    branch: string;
    env: string;
    runner: string;
    /** ISO-8601 timestamp (injected by the caller — the pure driver passes a placeholder). */
    at: string;
}
/**
 * Assemble a NEUTRAL `WorkEvent` from a method/branch act. harness EMITS this artifact and never
 * writes into `@sentropic/track` — a track-side adapter ingests it (no track import here). Pure and
 * deterministic: `subject`/`skill` are dropped when absent so the JSON stays minimal and stable.
 */
export declare function toWorkEvent(input: WorkEventInput, ctx: WorkEventContext): WorkEvent;
