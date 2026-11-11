/** Pure presentation gate. Schema validity alone does not make a dossier readable.
 * Semantic intent, quotation authenticity and proportional stakes still need review.
 */
import type { DecisionDossierDocument } from "../model.js";
import type { ValidationIssue } from "./index.js";
export type ReadabilityProfile = "strict" | "legacy";
export interface ReadabilityOptions {
    readonly profile?: ReadabilityProfile;
}
export declare const READABILITY_BUDGETS: {
    readonly low: 2;
    readonly medium: 8;
    readonly high: 30;
};
export declare const READABILITY_LIMITS: {
    readonly minOwnerRequestQuoteLength: 8;
    readonly minStakesLength: 20;
    readonly minQuestionContextLength: 20;
    readonly minOptionsPerQuestion: 2;
    readonly maxOptionsPerQuestion: 4;
    readonly maxQuestionReadingMinutes: 2;
    readonly maxDossierBudgetMinutes: 30;
    readonly wordsPerMinute: 180;
    readonly maxHeadingLength: 100;
    readonly maxDecisionLineLength: 300;
    readonly maxOptionLabelLength: 100;
    readonly maxConsequenceLength: 160;
    readonly maxOptionBodyLength: 300;
    readonly maxCellWords: 60;
    readonly maxBlockCombinedWords: 60;
    readonly maxSentenceWords: 22;
    readonly maxInputLabelWords: 12;
    readonly maxInputLabelLength: 100;
    readonly maxCompletionCriterionSentences: 1;
    readonly maxCompletionCriterionWords: 22;
    readonly maxCompletionCriterionLength: 160;
};
/** Check a structurally valid document; use ForPresentation for untrusted input. */
export declare const validateDecisionDossierReadability: (doc: DecisionDossierDocument, options?: ReadabilityOptions) => ValidationIssue[];
