/** Shared cell boundaries for Markdown table rendering and readability checks. */
export function splitMarkdownTableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map(cell => cell.trim().replace(/\\\|/g, '|'));
}
