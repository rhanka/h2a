import type { DecisionDossierDocument } from '../model.js';
export type Format = 'text/plain' | 'focus.markdown.p0@1';
export interface Address {
    nodeId: string;
    targetRef: string;
    field: 'markdown' | 'question' | 'recommendedAnswer' | 'context' | 'label' | 'body' | 'consequence';
}
export interface EditingField extends Address {
    contentFormat: Format;
    blockKind: 'prose' | 'question' | 'option';
}
export interface Paragraph extends Address {
    paragraphId: string;
    blockKind: 'paragraph';
    parentId: null;
    order: number;
    range: {
        start: number;
        end: number;
        unit: 'utf16';
    };
}
export interface FocusEditingManifest {
    schemaVersion: 1;
    manifestId: string;
    documentRef: string;
    baseHash: string;
    manifestBaseHash: string;
    fields: EditingField[];
    paragraphs: Paragraph[];
    retiredParagraphIds: string[];
}
export interface Anchors {
    parentId: null;
    previousParagraphId: string | null;
    nextParagraphId: string | null;
}
export interface ParagraphValue extends Address {
    documentRef: string;
    paragraphId: string;
    blockKind: 'paragraph';
    format: Format;
    text: string;
}
export interface ParagraphChange extends Address {
    documentRef: string;
    paragraphId: string;
    blockKind: 'paragraph';
    format: Format;
    changeId: string;
    operation: 'replace' | 'insert' | 'delete' | 'move';
    before: string | null;
    after: string | null;
    beforeAnchors: Anchors | null;
    anchors: Anchors;
}
export interface EditTransaction {
    transactionId: string;
    changes: ParagraphChange[];
}
export interface Production {
    producerId: string;
    generationId: string;
    requestId: string;
}
export interface FocusReturn {
    kind: 'focus.return';
    schemaVersion: 1;
    returnId: string;
    digest: string;
    capture: {
        at: string;
    };
    scope: {
        workspaceId: string;
    } | null;
    source: {
        documentRef: string;
        hash: string;
        cursor: string;
        baseHash: string;
        manifestId: string;
        manifestBaseHash: string;
    };
    production: Production | null;
    manifest: FocusEditingManifest;
    answers: {
        questionId: string;
        targetRef: string;
        optionIds: string[];
        text: string | null;
    }[];
    notes: {
        targetRef: string;
        text: string | null;
    }[];
    editReturn: {
        schemaVersion: 1;
        mode: 'cumulative';
        transactions: EditTransaction[];
        supersedesReturnId?: string;
        supersededReturnIds: string[];
    };
}
export type Validation<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    issues: string[];
};
export declare const validateManifestStructure: (v: unknown) => v is FocusEditingManifest;
export declare const validateReturnStructure: (v: unknown) => v is FocusReturn;
export declare function validateReturn(value: unknown, doc: DecisionDossierDocument, manifest: FocusEditingManifest): Validation<FocusReturn>;
export interface FreezeInput {
    document: DecisionDossierDocument;
    manifest: FocusEditingManifest;
    production: Production | null;
    scope: FocusReturn['scope'];
    answers: FocusReturn['answers'];
    notes: FocusReturn['notes'];
    transactions: EditTransaction[];
    previous?: FocusReturn;
    returnId: string;
    capturedAt: string;
}
/** Capture metadata/identity is supplied by the host, never invented by the pure core. */
export declare function freezeReturn(input: FreezeInput): FocusReturn;
