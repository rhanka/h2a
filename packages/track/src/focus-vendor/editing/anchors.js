import { baseDigest, canonicalJson, manifestDigest } from './digest.js';
import { manifestSchema, matchesSchema } from './structure.js';
import { segmentMarkdown, segmentText } from './codec.js';
export const fieldKey = (a) => canonicalJson([a.nodeId, a.targetRef, a.field]);
/** An emptied narrative field keeps one empty unit: `""` is content (D14), so an
 * empty source still carries its paragraph identity instead of zero units. */
const textSegments = (source) => source === '' ? [{ start: 0, end: 0, editable: true }] : segmentText(source);
export function sourceNodes(doc) {
    return doc.sections.flatMap(s => s.kind === 'optionSet' ? [s, ...s.options] : [s]);
}
export function sourceNode(doc, address) {
    const found = sourceNodes(doc).filter(n => n.id === address.nodeId && n.targetRef === address.targetRef);
    if (found.length !== 1)
        throw new Error('missing-or-ambiguous-node');
    return found[0];
}
export function editableFields(doc) {
    const allowed = { prose: ['markdown'], question: ['question', 'recommendedAnswer', 'context'], option: ['label', 'body', 'consequence'] };
    return sourceNodes(doc).flatMap(n => (allowed[n.kind] ?? []).filter(field => typeof n[field] === 'string').map(field => ({
        nodeId: n.id, targetRef: n.targetRef, field: field, contentFormat: field === 'markdown' ? 'focus.markdown.p0@1' : 'text/plain', blockKind: n.kind,
    })));
}
export function sealManifest(value) {
    return { ...value, manifestBaseHash: manifestDigest(value) };
}
/** Legacy seed only. A revised source MUST carry an explicit mapping instead of reseeding. */
export function seedManifest(doc) {
    const baseHash = baseDigest(doc), fields = editableFields(doc);
    const paragraphs = fields.flatMap(f => {
        const source = sourceNode(doc, f)[f.field];
        const segments = f.contentFormat === 'text/plain' ? textSegments(source) : segmentMarkdown(source);
        return segments.filter(s => s.editable).map((s, order) => ({ nodeId: f.nodeId, targetRef: f.targetRef, field: f.field,
            paragraphId: `paragraph:${baseDigest([baseHash, fieldKey(f), order]).slice(7)}`, blockKind: 'paragraph', parentId: null, order,
            range: { start: s.start, end: s.end, unit: 'utf16' } }));
    });
    return sealManifest({ schemaVersion: 1, manifestId: `manifest:${baseHash.slice(7)}`, documentRef: doc.ref, baseHash, fields, paragraphs, retiredParagraphIds: [] });
}
export function validateManifest(value, doc) {
    if (!matchesSchema(manifestSchema, value))
        return { ok: false, issues: ['manifest-structure'] };
    const m = value, issues = [];
    try {
        if (m.documentRef !== doc.ref || m.baseHash !== baseDigest(doc) || m.manifestBaseHash !== manifestDigest(m))
            issues.push('manifest-digest-or-base');
        const allowed = editableFields(doc), fieldIds = new Set(), ids = new Set();
        for (const f of m.fields) {
            const key = fieldKey(f);
            if (fieldIds.has(key) || !allowed.some(a => canonicalJson(a) === canonicalJson(f)))
                issues.push('unsupported-or-duplicate-field');
            fieldIds.add(key);
            const source = sourceNode(doc, f)[f.field];
            const ps = m.paragraphs.filter(p => fieldKey(p) === key).sort((a, b) => a.order - b.order);
            const segments = f.contentFormat === 'text/plain' ? textSegments(source) : segmentMarkdown(source);
            let end = 0;
            ps.forEach((p, index) => {
                if (p.order !== index || p.range.start < end || p.range.end < p.range.start || p.range.end > source.length)
                    issues.push('ambiguous-range');
                // An empty text/plain paragraph holds no characters, so it never matches a
                // text block: it is a zero-length unit owned by a structural gap (D14).
                // It is representable outside any block (source edge, block boundary or
                // blank gap), never strictly inside one.
                const emptyGapUnit = f.contentFormat === 'text/plain' && p.range.start === p.range.end &&
                    !segments.some(s => s.start < p.range.start && p.range.start < s.end);
                if (!segments.some(s => s.editable && s.start === p.range.start && s.end === p.range.end) && !emptyGapUnit && !(p.range.start === p.range.end && f.contentFormat !== 'text/plain'))
                    issues.push('unsupported-range');
                end = p.range.end;
            });
        }
        for (const p of m.paragraphs) {
            if (ids.has(p.paragraphId) || m.retiredParagraphIds.includes(p.paragraphId) || !fieldIds.has(fieldKey(p)))
                issues.push('ambiguous-paragraph');
            ids.add(p.paragraphId);
        }
    }
    catch {
        issues.push('invalid-manifest');
    }
    return issues.length ? { ok: false, issues } : { ok: true, value: m };
}
/** Explicit producer correspondence, including retirements. Never matches by text similarity. */
export function carryManifest(doc, previous, paragraphs) {
    const active = new Set(paragraphs.map(p => p.paragraphId));
    const m = sealManifest({ schemaVersion: 1, manifestId: previous.manifestId, documentRef: doc.ref, baseHash: baseDigest(doc), fields: editableFields(doc),
        paragraphs: structuredClone(paragraphs), retiredParagraphIds: [...new Set([...previous.retiredParagraphIds, ...previous.paragraphs.filter(p => !active.has(p.paragraphId)).map(p => p.paragraphId)])] });
    const result = validateManifest(m, doc);
    if (!result.ok)
        throw new Error(result.issues.join(', '));
    return m;
}
export function readParagraphs(doc, manifest) {
    const check = validateManifest(manifest, doc);
    if (!check.ok)
        throw new Error(check.issues.join(', '));
    return manifest.fields.flatMap(f => manifest.paragraphs.filter(p => fieldKey(p) === fieldKey(f)).sort((a, b) => a.order - b.order).map(p => ({
        documentRef: doc.ref, nodeId: p.nodeId, targetRef: p.targetRef, field: p.field, paragraphId: p.paragraphId, blockKind: 'paragraph',
        format: f.contentFormat, text: sourceNode(doc, p)[p.field].slice(p.range.start, p.range.end),
    })));
}
