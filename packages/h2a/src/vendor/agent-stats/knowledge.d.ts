export interface ApplicabilityInput {
    lockedDigest: string;
    currentDigest: string;
    lockedFingerprint: Record<string, unknown>;
    currentFingerprint: Record<string, unknown>;
    allowOldSnapshot?: boolean;
}
export interface ApplicabilityResult {
    applicability: "applicable" | "conditional-historical" | "incomplete";
    historyPreserved: true;
    boundsNewRegime: boolean;
}
export declare function checkApplicability(input: ApplicabilityInput): ApplicabilityResult;
export interface MemoryBags {
    admitted?: unknown[];
    denied?: unknown[];
    stale?: unknown[];
    superseded?: unknown[];
}
export interface ExportInput {
    observations: Array<{
        id: string;
        value: number;
    }>;
    memory?: MemoryBags;
}
export interface ExportResult {
    observations: Array<{
        id: string;
        value: number;
    }>;
    manifest: {
        digest: string;
        observationCount: number;
    };
    memoryAdmitted: number;
    trackMutated: false;
}
export declare function exportKnowledge(input: ExportInput): ExportResult;
export declare function importKnowledge(manifest: {
    digest: string;
    observationCount: number;
}, observations: Array<{
    id: string;
    value: number;
}>): {
    observations: Array<{
        id: string;
        value: number;
    }>;
};
//# sourceMappingURL=knowledge.d.ts.map