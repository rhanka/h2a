import { parser, GFM } from '@lezer/markdown';
import { parseDocument, isAlias, isMap, isSeq, isScalar, stringify } from 'yaml';
import { canonicalJson } from './digest.js';
import { validateReturnStructure } from './contract.js';
const sourceParser = parser.configure(GFM);
/** Source-preserving CommonMark + GFM tables. No Markdown reserialization. */
export function segmentMarkdown(source) {
    // Lezer consumes LF. Preserve an exact offset map into the original CRLF/CR source.
    const chars = [], offsets = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\r') {
            chars.push('\n');
            if (source[i + 1] === '\n')
                i++;
        }
        else
            chars.push(source[i]);
        offsets.push(i + 1);
    }
    const tree = sourceParser.parse(chars.join(''));
    const safe = (node) => {
        if (!['Paragraph', 'Emphasis', 'StrongEmphasis', 'InlineCode', 'HardBreak', 'CodeMark', 'EmphasisMark', 'Escape', 'Entity'].includes(node.name))
            return false;
        for (let child = node.firstChild; child; child = child.nextSibling)
            if (!safe(child))
                return false;
        return true;
    };
    const segments = [];
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        const start = offsets[node.from], end = offsets[node.to];
        segments.push({ start, end, text: source.slice(start, end), editable: node.name === 'Paragraph' && safe(node) });
    }
    return segments;
}
/** Plain narrative fields: one unit per block of non-blank lines. Exact source
 * offsets, CRLF/CR aware, no trimming and no normalization: blank lines stay
 * structural gaps owned by the manifest, never paragraph content. */
export function segmentText(source) {
    if (source === '')
        return [];
    const parts = source.split(/(\r\n|\n|\r)/);
    const lines = [];
    let offset = 0;
    for (let i = 0; i < parts.length; i += 2) {
        const text = parts[i];
        lines.push({ start: offset, end: offset + text.length, text });
        offset += text.length + (parts[i + 1] ?? '').length;
    }
    const segments = [];
    let open = null;
    const close = (last) => {
        segments.push({ start: lines[open].start, end: lines[last].end, text: source.slice(lines[open].start, lines[last].end), editable: true });
        open = null;
    };
    lines.forEach((line, index) => {
        if (/^[ \t]*$/.test(line.text)) {
            if (open !== null)
                close(index - 1);
        }
        else if (open === null)
            open = index;
    });
    if (open !== null)
        close(lines.length - 1);
    return segments;
}
const lineBreak = String.raw `(?:\r\n|\n|\r)`;
const singleBreak = new RegExp(`^${lineBreak}$`);
const leadingBreak = new RegExp(`^${lineBreak}`);
const trailingBreak = new RegExp(`${lineBreak}$`);
/** A text/plain paragraph is one block of non-blank lines (segmentText) with
 * at most one soft line break kept at each edge (case 3: "A\n", "\nB",
 * "\nA\n", CRLF/CR included). Blank lines stay structural gaps owned by the
 * manifest, never paragraph content: stripping more than one edge break still
 * leaves an edge break behind, so "A\n\n" or "\n\nB" keep failing. A lone
 * single break ("\n", "\r\n", "\r") is representable as its own unit. */
export function isRepresentablePlainText(text) {
    if (text === '')
        return true;
    if (singleBreak.test(text))
        return true;
    let core = text;
    const lead = core.match(leadingBreak);
    if (lead)
        core = core.slice(lead[0].length);
    const trail = core.match(trailingBreak);
    if (trail)
        core = core.slice(0, -trail[0].length);
    if (core === '')
        return false;
    const parts = segmentText(core);
    return parts.length === 1 && parts[0].start === 0 && parts[0].end === core.length;
}
export function assertParagraphText(text, format) {
    if (text === '')
        return;
    if (format === 'text/plain') {
        if (isRepresentablePlainText(text))
            return;
        throw new Error('unsupported-paragraph-format');
    }
    const parts = segmentMarkdown(text);
    if (parts.length !== 1 || !parts[0].editable || parts[0].start !== 0 || parts[0].end !== text.length)
        throw new Error('unsupported-paragraph-format');
}
export function encodeReturn(value, format = 'json') {
    if (!validateReturnStructure(value))
        throw new Error('unsupported-version-or-structure');
    canonicalJson(value);
    return format === 'json' ? JSON.stringify(value, null, 2) + '\n' : stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });
}
export function decodeReturn(raw, format = 'json') {
    if (format !== 'json' && format !== 'yaml')
        throw new Error('unsupported-format');
    if (format === 'json')
        JSON.parse(raw); // Strict JSON syntax; YAML below also checks duplicate keys.
    const parsed = parseDocument(raw, { uniqueKeys: true, strict: true, schema: 'core' });
    if (parsed.errors.length || parsed.warnings.length)
        throw new Error('Invalid serialized return');
    const visit = (node) => {
        if (!node)
            return;
        if (isAlias(node) || node.tag)
            throw new Error('Aliases and explicit tags are unsupported');
        if (isMap(node))
            for (const pair of node.items) {
                if (!isScalar(pair.key) || typeof pair.key.value !== 'string')
                    throw new Error('JSON keys must be strings');
                visit(pair.key);
                visit(pair.value);
            }
        if (isSeq(node))
            node.items.forEach(visit);
    };
    visit(parsed.contents);
    const value = parsed.toJS({ maxAliasCount: 0 });
    canonicalJson(value);
    if (!validateReturnStructure(value))
        throw new Error('unsupported-version-or-structure');
    return value;
}
