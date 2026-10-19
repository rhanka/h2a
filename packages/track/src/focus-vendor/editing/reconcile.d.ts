import type { DecisionDossierDocument } from '../model.js';
import type { EditTransaction, FocusEditingManifest, Production } from './contract.js';
export interface EditingSnapshot {
    document: DecisionDossierDocument;
    manifest: FocusEditingManifest;
}
export interface EditingConflict {
    paragraphId?: string;
    reason: string;
    baseline?: string | null;
    lineageApplied?: string | null;
    current?: string | null;
    requested?: string | null;
}
export interface EditReceipt {
    returnId: string;
    digest: string;
    status: string;
    baseHash?: string;
    resultHash?: string;
    previousStatus?: string;
    transactions: {
        transactionId: string;
        changeIds: string[];
        status: string;
    }[];
    conflicts: EditingConflict[];
}
export interface ReturnLineage {
    baseHash: string;
    manifestBaseHash: string;
    production: Production;
    head?: {
        returnId: string;
        supersededReturnIds: string[];
    };
    tombstones: string[];
    seen: {
        returnId: string;
        digest: string;
        receipt: EditReceipt;
    }[];
    applied: EditTransaction[];
    applications: {
        returnId: string;
        baseHash: string;
        resultHash: string;
        transactions: EditTransaction[];
    }[];
}
export interface ReconcileInput {
    baseline: EditingSnapshot;
    current: EditingSnapshot;
    value: unknown;
    production: Production;
    lineage?: ReturnLineage;
}
export interface ReconcileResult extends EditingSnapshot {
    ok: boolean;
    lineage: ReturnLineage;
    receipt: EditReceipt;
    conflicts: EditingConflict[];
}
/** Data in/data out. Persistence and the final publication boundary belong to the host. */
export declare function reconcile(input: ReconcileInput): ReconcileResult;
