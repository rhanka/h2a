import type { FocusReturn } from './contract.js';
export interface SourceSegment {
    start: number;
    end: number;
    text: string;
    editable: boolean;
}
/** Source-preserving CommonMark + GFM tables. No Markdown reserialization. */
export declare function segmentMarkdown(source: string): SourceSegment[];
/** Plain narrative fields: one unit per block of non-blank lines. Exact source
 * offsets, CRLF/CR aware, no trimming and no normalization: blank lines stay
 * structural gaps owned by the manifest, never paragraph content. */
export declare function segmentText(source: string): SourceSegment[];
export declare function assertParagraphText(text: string, format: string): void;
export declare function encodeReturn(value: FocusReturn, format?: 'json' | 'yaml'): string;
export declare function decodeReturn(raw: string, format?: 'json' | 'yaml'): FocusReturn;
