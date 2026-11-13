import type { FocusDocument } from '../model.js';
/** Disclosed estimate at six UTF-8 bytes per word; raw consultation is not decision time. */
export declare function evidenceVolume(doc: FocusDocument): {
    sources: number;
    bytes: number;
    consultationMinutes: number;
};
/** All exports retain an evidence index; full raw bytes remain in the portable envelope. */
export declare function evidenceIndex(doc: FocusDocument): string;
/** Reports retain appendix contents in every export; the evidence index keeps provenance. */
export declare function reportAnnexes(doc: FocusDocument, format: 'html' | 'markdown' | 'terminal'): string;
