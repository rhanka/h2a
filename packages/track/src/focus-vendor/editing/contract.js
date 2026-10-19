import { baseDigest, canonicalJson, returnDigest } from './digest.js';
import { validateManifest, fieldKey, sourceNodes } from './anchors.js';
import { matchesSchema, manifestSchema, returnSchema } from './structure.js';
export const validateManifestStructure = (v) => matchesSchema(manifestSchema, v);
export const validateReturnStructure = (v) => matchesSchema(returnSchema, v);
export function validateReturn(value, doc, manifest) {
    const issues = [];
    if (!validateReturnStructure(value))
        return { ok: false, issues: ['unsupported-version-or-structure'] };
    try {
        if (value.digest !== returnDigest(value))
            issues.push('return-digest');
        if (!validateManifest(manifest, doc).ok || !validateManifest(value.manifest, doc).ok || canonicalJson(value.manifest) !== canonicalJson(manifest))
            issues.push('manifest-mismatch');
        if (value.source.documentRef !== doc.ref || value.source.hash !== doc.hash || value.source.cursor !== doc.cursor || value.source.baseHash !== baseDigest(doc) || value.source.manifestId !== manifest.manifestId || value.source.manifestBaseHash !== manifest.manifestBaseHash)
            issues.push('source-mismatch');
        const ancestry = value.editReturn.supersededReturnIds;
        if (ancestry.includes(value.returnId) || (ancestry.length === 0) !== (value.editReturn.supersedesReturnId === undefined) || (ancestry.length && ancestry[0] !== value.editReturn.supersedesReturnId))
            issues.push('ancestry');
        const nodes = sourceNodes(doc), targets = new Set([doc.ref, ...nodes.map(n => n.targetRef)]);
        for (const note of value.notes)
            if (!targets.has(note.targetRef))
                issues.push('note-target');
        const answerIds = new Set();
        for (const answer of value.answers) {
            if (answerIds.has(answer.questionId))
                issues.push('duplicate-answer');
            answerIds.add(answer.questionId);
            const question = nodes.find(n => n.kind === 'question' && n.id === answer.questionId && n.targetRef === answer.targetRef);
            const options = doc.sections.flatMap(n => n.kind === 'optionSet' && n.questionId === answer.questionId ? n.options : []);
            if (!question || answer.optionIds.some(id => !options.some(o => o.id === id)))
                issues.push('answer-target');
        }
        const txIds = new Set(), changeIds = new Set();
        for (const tx of value.editReturn.transactions) {
            if (txIds.has(tx.transactionId))
                issues.push('duplicate-transaction-id');
            txIds.add(tx.transactionId);
            for (const change of tx.changes) {
                if (changeIds.has(change.changeId))
                    issues.push('duplicate-change-id');
                changeIds.add(change.changeId);
                const f = manifest.fields.find(f => fieldKey(f) === fieldKey(change));
                if (!f || f.contentFormat !== change.format || change.documentRef !== doc.ref)
                    issues.push('address');
                if (change.operation === 'move' && change.before !== change.after)
                    issues.push('move-content');
                if (change.operation === 'insert' && (manifest.paragraphs.some(p => p.paragraphId === change.paragraphId) || manifest.retiredParagraphIds.includes(change.paragraphId)))
                    issues.push('reused-paragraph-id');
            }
        }
    }
    catch {
        issues.push('invalid-json-value');
    }
    return issues.length ? { ok: false, issues } : { ok: true, value };
}
/** Capture metadata/identity is supplied by the host, never invented by the pure core. */
export function freezeReturn(input) {
    const { document: doc, manifest, previous } = input;
    if (previous && !validateReturn(previous, doc, manifest).ok)
        throw new Error('Invalid previous frozen return: recover complete ancestry');
    const value = { kind: 'focus.return', schemaVersion: 1, returnId: input.returnId, digest: '', capture: { at: input.capturedAt },
        scope: input.scope, source: { documentRef: doc.ref, hash: doc.hash, cursor: doc.cursor, baseHash: manifest.baseHash, manifestId: manifest.manifestId, manifestBaseHash: manifest.manifestBaseHash },
        production: input.production, manifest, answers: input.answers, notes: input.notes,
        editReturn: { schemaVersion: 1, mode: 'cumulative', transactions: input.transactions.filter(t => t.changes.length), supersededReturnIds: previous ? [previous.returnId, ...previous.editReturn.supersededReturnIds] : [], ...(previous ? { supersedesReturnId: previous.returnId } : {}) } };
    // Re-copy/download the same completed revision without allocating a new identity.
    if (previous && canonicalJson([value.answers, value.notes, value.editReturn.transactions, value.production, value.scope]) === canonicalJson([previous.answers, previous.notes, previous.editReturn.transactions, previous.production, previous.scope]))
        return structuredClone(previous);
    value.digest = returnDigest(value);
    const check = validateReturn(value, doc, manifest);
    if (!check.ok)
        throw new Error(check.issues.join(', '));
    return structuredClone(value);
}
