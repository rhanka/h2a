import type { EvidenceSource } from '../model.js';
export declare const isTextSource: (media: string) => boolean;
export declare function checkSources(value: unknown, register: (id: string, path: string) => void): {
    sources: EvidenceSource[];
    lineCounts: Map<string, number>;
};
