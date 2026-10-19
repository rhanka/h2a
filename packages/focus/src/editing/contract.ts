import type { DecisionDossierDocument } from '../model.js';
import { baseDigest, canonicalJson, returnDigest } from './digest.js';
import { validateManifest, fieldKey, sourceNodes } from './anchors.js';
import { matchesSchema, manifestSchema, returnSchema } from './structure.js';

export type Format = 'text/plain' | 'focus.markdown.p0@1';
export interface Address { nodeId: string; targetRef: string; field: 'markdown' | 'question' | 'recommendedAnswer' | 'context' | 'label' | 'body' | 'consequence' }
export interface EditingField extends Address { contentFormat: Format; blockKind: 'prose' | 'question' | 'option' }
export interface Paragraph extends Address { paragraphId: string; blockKind: 'paragraph'; parentId: null; order: number; range: { start: number; end: number; unit: 'utf16' } }
export interface FocusEditingManifest { schemaVersion: 1; manifestId: string; documentRef: string; baseHash: string; manifestBaseHash: string; fields: EditingField[]; paragraphs: Paragraph[]; retiredParagraphIds: string[] }
export interface Anchors { parentId: null; previousParagraphId: string | null; nextParagraphId: string | null }
export interface ParagraphValue extends Address { documentRef: string; paragraphId: string; blockKind: 'paragraph'; format: Format; text: string }
export interface ParagraphChange extends Address { documentRef: string; paragraphId: string; blockKind: 'paragraph'; format: Format; changeId: string;
  operation: 'replace' | 'insert' | 'delete' | 'move'; before: string | null; after: string | null; beforeAnchors: Anchors | null; anchors: Anchors }
export interface EditTransaction { transactionId: string; changes: ParagraphChange[] }
export interface Production { producerId: string; generationId: string; requestId: string }
export interface FocusReturn {
  kind: 'focus.return'; schemaVersion: 1; returnId: string; digest: string; capture: { at: string }; scope: { workspaceId: string } | null;
  source: { documentRef: string; hash: string; cursor: string; baseHash: string; manifestId: string; manifestBaseHash: string };
  production: Production | null; manifest: FocusEditingManifest;
  answers: { questionId: string; targetRef: string; optionIds: string[]; text: string | null }[];
  notes: { targetRef: string; text: string | null }[];
  editReturn: { schemaVersion: 1; mode: 'cumulative'; transactions: EditTransaction[]; supersedesReturnId?: string; supersededReturnIds: string[] };
}
export type Validation<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export const validateManifestStructure = (v: unknown): v is FocusEditingManifest => matchesSchema(manifestSchema, v);
export const validateReturnStructure = (v: unknown): v is FocusReturn => matchesSchema(returnSchema, v);
export function validateReturn(value: unknown, doc: DecisionDossierDocument, manifest: FocusEditingManifest): Validation<FocusReturn> {
  const issues: string[] = [];
  if (!validateReturnStructure(value)) return { ok: false, issues: ['unsupported-version-or-structure'] };
  try {
    if (value.digest !== returnDigest(value)) issues.push('return-digest');
    if (!validateManifest(manifest, doc).ok || !validateManifest(value.manifest, doc).ok || canonicalJson(value.manifest) !== canonicalJson(manifest)) issues.push('manifest-mismatch');
    if (value.source.documentRef !== doc.ref || value.source.hash !== doc.hash || value.source.cursor !== doc.cursor || value.source.baseHash !== baseDigest(doc) || value.source.manifestId !== manifest.manifestId || value.source.manifestBaseHash !== manifest.manifestBaseHash) issues.push('source-mismatch');
    const ancestry = value.editReturn.supersededReturnIds;
    if (ancestry.includes(value.returnId) || (ancestry.length === 0) !== (value.editReturn.supersedesReturnId === undefined) || (ancestry.length && ancestry[0] !== value.editReturn.supersedesReturnId)) issues.push('ancestry');
    const nodes = sourceNodes(doc), targets = new Set([doc.ref, ...nodes.map(n => n.targetRef)]);
    for (const note of value.notes) if (!targets.has(note.targetRef)) issues.push('note-target');
    const answerIds = new Set<string>();
    for (const answer of value.answers) {
      if (answerIds.has(answer.questionId)) issues.push('duplicate-answer'); answerIds.add(answer.questionId);
      const question = nodes.find(n => n.kind === 'question' && n.id === answer.questionId && n.targetRef === answer.targetRef);
      const options = doc.sections.flatMap(n => n.kind === 'optionSet' && n.questionId === answer.questionId ? n.options : []);
      if (!question || answer.optionIds.some(id => !options.some(o => o.id === id))) issues.push('answer-target');
    }
    const txIds = new Set<string>(), changeIds = new Set<string>();
    for (const tx of value.editReturn.transactions) {
      if (txIds.has(tx.transactionId)) issues.push('duplicate-transaction-id'); txIds.add(tx.transactionId);
      for (const change of tx.changes) {
        if (changeIds.has(change.changeId)) issues.push('duplicate-change-id'); changeIds.add(change.changeId);
        const f = manifest.fields.find(f => fieldKey(f) === fieldKey(change));
        if (!f || f.contentFormat !== change.format || change.documentRef !== doc.ref) issues.push('address');
        if (change.operation === 'move' && change.before !== change.after) issues.push('move-content');
        if (change.operation === 'insert' && (manifest.paragraphs.some(p => p.paragraphId === change.paragraphId) || manifest.retiredParagraphIds.includes(change.paragraphId))) issues.push('reused-paragraph-id');
      }
    }
  } catch { issues.push('invalid-json-value'); }
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

export interface FreezeInput {
  document: DecisionDossierDocument; manifest: FocusEditingManifest; production: Production | null; scope: FocusReturn['scope'];
  answers: FocusReturn['answers']; notes: FocusReturn['notes']; transactions: EditTransaction[]; previous?: FocusReturn; returnId: string; capturedAt: string;
}
/** Capture metadata/identity is supplied by the host, never invented by the pure core. */
export function freezeReturn(input: FreezeInput): FocusReturn {
  const { document: doc, manifest, previous } = input;
  if (previous && !validateReturn(previous, doc, manifest).ok) throw new Error('Invalid previous frozen return: recover complete ancestry');
  const value: FocusReturn = { kind: 'focus.return', schemaVersion: 1, returnId: input.returnId, digest: '', capture: { at: input.capturedAt },
    scope: input.scope, source: { documentRef: doc.ref, hash: doc.hash, cursor: doc.cursor, baseHash: manifest.baseHash, manifestId: manifest.manifestId, manifestBaseHash: manifest.manifestBaseHash },
    production: input.production, manifest, answers: input.answers, notes: input.notes,
    editReturn: { schemaVersion: 1, mode: 'cumulative', transactions: input.transactions.filter(t => t.changes.length), supersededReturnIds: previous ? [previous.returnId, ...previous.editReturn.supersededReturnIds] : [], ...(previous ? { supersedesReturnId: previous.returnId } : {}) } };
  // Re-copy/download the same completed revision without allocating a new identity.
  if (previous && canonicalJson([value.answers, value.notes, value.editReturn.transactions, value.production, value.scope]) === canonicalJson([previous.answers, previous.notes, previous.editReturn.transactions, previous.production, previous.scope])) return structuredClone(previous);
  value.digest = returnDigest(value);
  const check = validateReturn(value, doc, manifest); if (!check.ok) throw new Error(check.issues.join(', '));
  return structuredClone(value);
}
