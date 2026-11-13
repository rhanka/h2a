/** Shared cell boundaries for Markdown table rendering and readability checks. */
export function splitMarkdownTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'));
}
