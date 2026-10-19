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
/** A text/plain paragraph is one block of non-blank lines (segmentText) with
 * at most one soft line break kept at each edge (case 3: "A\n", "\nB",
 * "\nA\n", CRLF/CR included). Blank lines stay structural gaps owned by the
 * manifest, never paragraph content: stripping more than one edge break still
 * leaves an edge break behind, so "A\n\n" or "\n\nB" keep failing. A lone
 * single break ("\n", "\r\n", "\r") is representable as its own unit. */
export declare function isRepresentablePlainText(text: string): boolean;
export declare function assertParagraphText(text: string, format: string): void;
export declare function encodeReturn(value: FocusReturn, format?: 'json' | 'yaml'): string;
export declare function decodeReturn(raw: string, format?: 'json' | 'yaml'): FocusReturn;
