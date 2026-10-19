import type { DecisionDossierDocument } from '../model.js';
import type { Anchors, EditTransaction, FocusEditingManifest, ParagraphValue } from './contract.js';
export declare const paragraphAnchors: (values: ParagraphValue[], index: number) => Anchors;
export declare function diffParagraphs(baseline: ParagraphValue[], draft: ParagraphValue[], transactionId: string): EditTransaction;
/** Applies one atomic batch to source tokens. Opaque gaps are never reserialized. */
export declare function applyParagraphChanges(document: DecisionDossierDocument, manifest: FocusEditingManifest, transactions: EditTransaction[], restoreRetired?: boolean): {
    document: DecisionDossierDocument;
    manifest: FocusEditingManifest;
};
