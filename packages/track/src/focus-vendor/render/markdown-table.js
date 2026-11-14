/** Exact literal cell text shared by report rendering and readability checks.
 * HTML-like text and Markdown links remain visible; only escaped pipes are decoded.
 */
export function splitMarkdownTableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map(cell => cell.trim().replace(/\\\|/g, '|'));
}
