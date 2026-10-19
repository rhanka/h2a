import type { DecisionDossierDocument } from '../model.js';
/** Disclosed estimate at six UTF-8 bytes per word; raw consultation is not decision time. */
export declare function evidenceVolume(doc: DecisionDossierDocument): {
    sources: number;
    bytes: number;
    consultationMinutes: number;
};
/** All exports retain an evidence index; full raw bytes remain in the portable envelope. */
export declare function evidenceIndex(doc: DecisionDossierDocument): string;
