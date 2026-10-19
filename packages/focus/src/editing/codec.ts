import { parser, GFM } from '@lezer/markdown';
import { parseDocument, isAlias, isMap, isSeq, isScalar, stringify } from 'yaml';
import { canonicalJson } from './digest.js';
import { validateReturnStructure } from './contract.js';
import type { FocusReturn } from './contract.js';

export interface SourceSegment { start: number; end: number; text: string; editable: boolean }
const sourceParser = parser.configure(GFM);
type SyntaxNode = ReturnType<typeof sourceParser.parse>['topNode'];
/** Source-preserving CommonMark + GFM tables. No Markdown reserialization. */
export function segmentMarkdown(source: string): SourceSegment[] {
  // Lezer consumes LF. Preserve an exact offset map into the original CRLF/CR source.
  const chars: string[] = [], offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r') { chars.push('\n'); if (source[i + 1] === '\n') i++; }
    else chars.push(source[i]);
    offsets.push(i + 1);
  }
  const tree = sourceParser.parse(chars.join(''));
  const safe = (node: SyntaxNode): boolean => {
    if (!['Paragraph', 'Emphasis', 'StrongEmphasis', 'InlineCode', 'HardBreak', 'CodeMark', 'EmphasisMark', 'Escape', 'Entity'].includes(node.name)) return false;
    for (let child = node.firstChild; child; child = child.nextSibling) if (!safe(child)) return false;
    return true;
  };
  const segments: SourceSegment[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const start = offsets[node.from], end = offsets[node.to];
    segments.push({ start, end, text: source.slice(start, end), editable: node.name === 'Paragraph' && safe(node) });
  }
  return segments;
}
export function assertParagraphText(text: string, format: string): void {
  if (format === 'text/plain' || text === '') return;
  const parts = segmentMarkdown(text);
  if (parts.length !== 1 || !parts[0].editable || parts[0].start !== 0 || parts[0].end !== text.length) throw new Error('unsupported-paragraph-format');
}
export function encodeReturn(value: FocusReturn, format: 'json' | 'yaml' = 'json'): string {
  if (!validateReturnStructure(value)) throw new Error('unsupported-version-or-structure');
  canonicalJson(value);
  return format === 'json' ? JSON.stringify(value, null, 2) + '\n' : stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });
}
export function decodeReturn(raw: string, format: 'json' | 'yaml' = 'json'): FocusReturn {
  if (format !== 'json' && format !== 'yaml') throw new Error('unsupported-format');
  if (format === 'json') JSON.parse(raw); // Strict JSON syntax; YAML below also checks duplicate keys.
  const parsed = parseDocument(raw, { uniqueKeys: true, strict: true, schema: 'core' });
  if (parsed.errors.length || parsed.warnings.length) throw new Error('Invalid serialized return');
  const visit = (node: any): void => {
    if (!node) return;
    if (isAlias(node) || node.tag) throw new Error('Aliases and explicit tags are unsupported');
    if (isMap(node)) for (const pair of node.items) { if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new Error('JSON keys must be strings'); visit(pair.key); visit(pair.value); }
    if (isSeq(node)) node.items.forEach(visit);
  };
  visit(parsed.contents);
  const value = parsed.toJS({ maxAliasCount: 0 }); canonicalJson(value);
  if (!validateReturnStructure(value)) throw new Error('unsupported-version-or-structure');
  return value;
}
