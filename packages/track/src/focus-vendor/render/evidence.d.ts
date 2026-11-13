import type { FocusDocument } from '../model.js';
/** Shared bibliography order and literal origin; never turn an untrusted URI into a link. */
export declare function bibliography(doc: Parameters<typeof evidenceVolume>[0]): {
    number: number;
    anchorId: string;
    citation: import("../model.js").EvidenceCitation;
    source: import("../model.js").EvidenceSource;
    location: string;
}[];
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
