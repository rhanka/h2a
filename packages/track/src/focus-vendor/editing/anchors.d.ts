import type { DecisionDossierDocument } from '../model.js';
import type { Address, EditingField, FocusEditingManifest, Paragraph, ParagraphValue, Validation } from './contract.js';
export declare const fieldKey: (a: Address) => string;
export declare function sourceNodes(doc: DecisionDossierDocument): Record<string, any>[];
export declare function sourceNode(doc: DecisionDossierDocument, address: Address): Record<string, any>;
export declare function editableFields(doc: DecisionDossierDocument): EditingField[];
export declare function sealManifest(value: Omit<FocusEditingManifest, 'manifestBaseHash'>): FocusEditingManifest;
/** Legacy seed only. A revised source MUST carry an explicit mapping instead of reseeding. */
export declare function seedManifest(doc: DecisionDossierDocument): FocusEditingManifest;
export declare function validateManifest(value: unknown, doc: DecisionDossierDocument): Validation<FocusEditingManifest>;
/** Explicit producer correspondence, including retirements. Never matches by text similarity. */
export declare function carryManifest(doc: DecisionDossierDocument, previous: FocusEditingManifest, paragraphs: Paragraph[]): FocusEditingManifest;
export declare function readParagraphs(doc: DecisionDossierDocument, manifest: FocusEditingManifest): ParagraphValue[];
