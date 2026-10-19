import type { FocusReturn } from './contract.js';
export interface SourceSegment {
    start: number;
    end: number;
    text: string;
    editable: boolean;
}
/** Source-preserving CommonMark + GFM tables. No Markdown reserialization. */
export declare function segmentMarkdown(source: string): SourceSegment[];
export declare function assertParagraphText(text: string, format: string): void;
export declare function encodeReturn(value: FocusReturn, format?: 'json' | 'yaml'): string;
export declare function decodeReturn(raw: string, format?: 'json' | 'yaml'): FocusReturn;
