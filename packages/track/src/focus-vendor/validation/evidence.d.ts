import type { DecisionDossierDocumentV1, DecisionDossierDocumentV2 } from '../model.js';
import type { ValidationResult } from './index.js';
/** Dispatch before the legacy closed validator, keeping its shape and identity intact. */
export declare function checkEvidence(value: Record<string, unknown>, legacy: (v: unknown) => ValidationResult<DecisionDossierDocumentV1>): ValidationResult<DecisionDossierDocumentV2>;
