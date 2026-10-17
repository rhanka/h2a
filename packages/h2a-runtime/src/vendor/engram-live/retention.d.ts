// Vendored from rhanka/engram@545a57b8911ab108e84fa1778e0f268fe11bf1de: engram-live/retention.ts.
// Compiled with TypeScript 5.9.3 (ES2022/NodeNext, declarations); do not hand-edit.
import { type LiveScope, type RetentionCoverageReportDto, type RetentionReceiptDto, type RetentionReceiptQuery, type RetentionRequestDto, type SelectedRootDto } from "./contracts.js";
export declare class RetentionError extends Error {
    constructor(message: string);
}
/**
 * THE injected retention port (plan/09 R1: a port, never a base). Engram
 * defines the contract only; h2a implements durable acquisition and the
 * private store behind it. Receipts are scoped by tenant + clone and
 * durable across passes; the port never carries file content.
 */
export interface RetentionPort {
    recordRequest(request: RetentionRequestDto): Promise<{
        received: true;
    }>;
    recordReceipt(receipt: RetentionReceiptDto): Promise<{
        received: true;
    }>;
    loadReceipts(query: RetentionReceiptQuery): Promise<{
        receipts: readonly RetentionReceiptDto[];
    }>;
}
export interface RetentionPassInput {
    readonly roots: readonly SelectedRootDto[];
    readonly scope: LiveScope;
    /** Injected evaluation time for requestedAt (ms); the engine reads no clock. */
    readonly now: number;
}
export interface RetentionPassStats {
    readonly requests: number;
    readonly receipts: number;
    readonly missing: number;
}
export interface RetentionPassOutcome {
    /** "complete": every request has its scoped durable receipt. "gaps": otherwise. */
    readonly state: "complete" | "gaps";
    readonly requests: readonly RetentionRequestDto[];
    readonly coverage: readonly RetentionCoverageReportDto[];
    readonly stats: RetentionPassStats;
}
/**
 * Derive one retention request per distinct root OID, sorted by OID.
 * Pure and total over valid inputs: no count cap, no age filter, no
 * pruning — an old default branch, an expired window branch kept as a
 * previously-ingested root, a PR head of any state and a detached HEAD
 * each yield exactly one request.
 */
export declare function deriveRetentionRequests(roots: readonly SelectedRootDto[], scope: LiveScope, now: number): RetentionRequestDto[];
/**
 * Run one retention pass: record every request, then require every scoped
 * durable receipt. Deterministic over the injected inputs; the port is the
 * only effect. A receipt satisfies a request only under the exact same
 * tenant, clone, algorithm and OID; cross-scope receipts never satisfy.
 */
export declare function runRetentionPass(input: RetentionPassInput, port: RetentionPort): Promise<RetentionPassOutcome>;
