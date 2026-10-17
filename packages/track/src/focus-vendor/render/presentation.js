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
        const answer = section.recommendedAnswer.trim();
        const label = recommended.label.trim();
        const alreadyNamed = answer.toLowerCase().startsWith(label.toLowerCase())
            && /^(?:$|[\s,:;.!?—–-])/.test(answer.slice(label.length));
        return [
            { ...section, recommendedAnswer: alreadyNamed ? answer : `${label} — ${answer}` },
            ...linked,
        ];
    });
    return { ...doc, sections };
};
