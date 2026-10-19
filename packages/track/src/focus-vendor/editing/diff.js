import { fieldKey, readParagraphs, sealManifest, sourceNode } from './anchors.js';
import { baseDigest, canonicalJson } from './digest.js';
import { assertParagraphText } from './codec.js';
export const paragraphAnchors = (values, index) => ({ parentId: null, previousParagraphId: values[index - 1]?.paragraphId ?? null, nextParagraphId: values[index + 1]?.paragraphId ?? null });
export function diffParagraphs(baseline, draft, transactionId) {
    for (const list of [baseline, draft])
        if (new Set(list.map(p => p.paragraphId)).size !== list.length)
            throw new Error('duplicate-paragraph-id');
    const changes = [];
    const emit = (p, operation, before, after, beforeAnchors, anchors) => {
        const { text: _text, ...address } = p;
        changes.push({ ...address, operation, before, after, beforeAnchors, anchors, changeId: `${transactionId}:${changes.length + 1}` });
    };
    const keys = [...new Set([...baseline, ...draft].map(fieldKey))];
    for (const key of keys) {
        const work = baseline.filter(p => fieldKey(p) === key).map(p => ({ ...p })), desired = draft.filter(p => fieldKey(p) === key);
        for (let i = work.length - 1; i >= 0; i--)
            if (!desired.some(p => p.paragraphId === work[i].paragraphId)) {
                const anchors = paragraphAnchors(work, i);
                emit(work[i], 'delete', work[i].text, null, anchors, anchors);
                work.splice(i, 1);
            }
        for (const p of desired) {
            const index = work.findIndex(w => w.paragraphId === p.paragraphId);
            if (index >= 0 && work[index].text !== p.text) {
                const anchors = paragraphAnchors(work, index);
                emit(p, 'replace', work[index].text, p.text, anchors, anchors);
                work[index].text = p.text;
            }
        }
        desired.forEach((p, index) => {
            const at = work.findIndex(w => w.paragraphId === p.paragraphId);
            if (at === index)
                return;
            const before = at < 0 ? null : paragraphAnchors(work, at);
            if (at >= 0)
                work.splice(at, 1);
            const anchors = { parentId: null, previousParagraphId: work[index - 1]?.paragraphId ?? null, nextParagraphId: work[index]?.paragraphId ?? null };
            emit(p, at < 0 ? 'insert' : 'move', at < 0 ? null : p.text, p.text, before, anchors);
            work.splice(index, 0, p);
        });
    }
    return { transactionId, changes };
}
/** Applies one atomic batch to source tokens. Opaque gaps are never reserialized.
 * A retired identity is restored only when explicitly listed in `restoreIds`:
 * reviving any other retired identity silently reassigns it (D13). */
export function applyParagraphChanges(document, manifest, transactions, restoreIds = null) {
    const values = readParagraphs(document, manifest), changes = transactions.flatMap(t => t.changes);
    if (!changes.length)
        return { document: structuredClone(document), manifest: structuredClone(manifest) };
    const next = structuredClone(document), paragraphs = [], retired = new Set(manifest.retiredParagraphIds);
    for (const f of manifest.fields) {
        const key = fieldKey(f), source = sourceNode(document, f)[f.field];
        const ps = manifest.paragraphs.filter(p => fieldKey(p) === key).sort((a, b) => a.range.start - b.range.start);
        const tokens = [];
        let offset = 0;
        for (const p of ps) {
            tokens.push({ text: source.slice(offset, p.range.start) }, { text: source.slice(p.range.start, p.range.end), value: values.find(v => v.paragraphId === p.paragraphId) });
            offset = p.range.end;
        }
        tokens.push({ text: source.slice(offset) });
        const active = () => tokens.filter(t => t.value).map(t => t.value);
        for (const c of changes.filter(c => fieldKey(c) === key)) {
            if (c.documentRef !== document.ref || c.format !== f.contentFormat)
                throw new Error('address');
            let tokenIndex = tokens.findIndex(t => t.value?.paragraphId === c.paragraphId);
            const list = active(), index = list.findIndex(p => p.paragraphId === c.paragraphId);
            if (c.operation === 'insert') {
                if (values.some(p => p.paragraphId === c.paragraphId) || (retired.has(c.paragraphId) && !restoreIds?.has(c.paragraphId)) || tokenIndex >= 0 || c.before !== null || c.after === null)
                    throw new Error('reused-paragraph-id');
            }
            else {
                if (index < 0 || list[index].text !== c.before)
                    throw new Error('paragraph-precondition');
                if (canonicalJson(paragraphAnchors(list, index)) !== canonicalJson(c.beforeAnchors))
                    throw new Error('structural-precondition');
                // Topology-preserving operations carry the same anchors out as in: a
                // forged output topology would otherwise apply cleanly and break its
                // own revocation with a structural-precondition failure.
                if ((c.operation === 'replace' || c.operation === 'delete') && canonicalJson(c.anchors) !== canonicalJson(c.beforeAnchors))
                    throw new Error('structural-precondition');
            }
            if (c.after !== null)
                assertParagraphText(c.after, c.format);
            if (c.operation === 'replace') {
                if (c.after === null)
                    throw new Error('replace-value');
                tokens[tokenIndex] = { text: c.after, value: { ...list[index], text: c.after } };
                continue;
            }
            if (c.operation === 'delete') {
                if (c.after !== null)
                    throw new Error('delete-value');
                tokens.splice(tokenIndex, 1);
                retired.add(c.paragraphId);
                continue;
            }
            if (c.operation === 'move') {
                if (c.after !== c.before)
                    throw new Error('move-content');
                tokens.splice(tokenIndex, 1);
            }
            const now = active(), previous = c.anchors.previousParagraphId, following = c.anchors.nextParagraphId;
            const position = previous === null ? 0 : now.findIndex(p => p.paragraphId === previous) + 1;
            if ((previous !== null && position === 0) || (now[position]?.paragraphId ?? null) !== following || c.anchors.parentId !== null)
                throw new Error('ambiguous-placement');
            tokenIndex = previous === null ? (following === null ? tokens.length : tokens.findIndex(t => t.value?.paragraphId === following)) : tokens.findIndex(t => t.value?.paragraphId === previous) + 1;
            const value = { documentRef: document.ref, nodeId: c.nodeId, targetRef: c.targetRef, field: c.field, paragraphId: c.paragraphId, blockKind: 'paragraph', format: c.format, text: c.after };
            tokens.splice(tokenIndex, 0, ...(previous === null ? [] : [{ text: '\n\n' }]), { text: c.after, value }, ...(previous === null && following !== null ? [{ text: '\n\n' }] : []));
            retired.delete(c.paragraphId);
        }
        let text = '', order = 0;
        for (const token of tokens) {
            if (token.value)
                paragraphs.push({ nodeId: f.nodeId, targetRef: f.targetRef, field: f.field, paragraphId: token.value.paragraphId, blockKind: 'paragraph', parentId: null, order: order++, range: { start: text.length, end: text.length + token.text.length, unit: 'utf16' } });
            text += token.text;
        }
        sourceNode(next, f)[f.field] = text;
    }
    if (changes.some(c => !manifest.fields.some(f => fieldKey(f) === fieldKey(c))))
        throw new Error('unsupported-field');
    return { document: next, manifest: sealManifest({ schemaVersion: 1, manifestId: manifest.manifestId, documentRef: manifest.documentRef, baseHash: baseDigest(next), fields: structuredClone(manifest.fields), paragraphs, retiredParagraphIds: [...retired] }) };
}
