/** Exact literal cell text shared by report rendering and readability checks.
 * HTML-like text and Markdown links remain visible; only escaped pipes are decoded.
 */
export declare function splitMarkdownTableCells(line: string): string[];
