import type { DecisionDossierDocument } from "../model.js";
/** Validate before hooks, then keep each question and its choices together. */
export declare const preparePresentation: (value: DecisionDossierDocument) => DecisionDossierDocument;
