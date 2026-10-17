import { assertDecisionDossierForPresentation } from "../validation/index.js";
/** Validate before hooks, then keep each question and its choices together. */
export const preparePresentation = (value) => {
    const doc = assertDecisionDossierForPresentation(value);
    const optionSets = doc.sections.filter((section) => section.kind === "optionSet");
    const sections = doc.sections.flatMap((section) => {
        if (section.kind === "optionSet")
            return [];
        if (section.kind !== "question")
            return [section];
        const linked = optionSets.filter((set) => set.questionId === section.id);
        const recommended = linked.flatMap((set) => set.options)
            .find((option) => option.id === section.recommendedOptionId);
        return [
            { ...section, recommendedAnswer: `${recommended.label} — ${section.recommendedAnswer}` },
            ...linked,
        ];
    });
    return { ...doc, sections };
};
