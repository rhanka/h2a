import { isEvidenceDossier } from '../model.js';
export const READABILITY_BUDGETS = { low: 2, medium: 8, high: 30 };
export const READABILITY_LIMITS = {
    minOwnerRequestQuoteLength: 8,
    minStakesLength: 20,
    minQuestionContextLength: 20,
    minOptionsPerQuestion: 2,
    maxOptionsPerQuestion: 4,
    maxQuestionReadingMinutes: 2,
    maxDossierBudgetMinutes: 30,
    wordsPerMinute: 180,
    maxHeadingLength: 100,
    maxDecisionLineLength: 300,
    maxOptionLabelLength: 100,
    maxConsequenceLength: 160,
    maxOptionBodyLength: 300,
};
// Acronyms and opaque codes, including L06b, MH-L3, R5 and CI-4821.
const CODE_PATTERN = /\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]*\d[A-Z0-9]*[a-z]?|[A-Z]{2,})\b/g;
// Ordinary outcome words and diagram direction syntax, not internal references.
const PLAIN_TOKENS = new Set(["GO", "NO-GO", "NO", "PENDING", "DEFERRED", "LR", "RL", "TB", "BT", "TD", "UTF-8"]);
const CHOICE_PATTERN = /\beither\b[\s\S]{0,160}?\bor\b|\bsoit\b[\s\S]{0,160}?\bsoit\b|\b(?:instead of|rather than|plut[oô]t que|versus|vs\.?|choos(?:e|ing) between|choisir entre)\b/i;
const SUBOPTION_PATTERN = /(?:^|[\n\r\u2028\u2029])\s*(?:[-*+•‣>]|\d+[.)]|[a-z][.)])\s+\S|\([a-z]\)[\s\S]*\([a-z]\)|\b(?:sub[- ]?options?|sous[- ]?options?)\b/i;
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const blank = (text) => !text?.trim();
const asRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const minutesFor = (texts) => (texts.join(" ").match(/\S+/gu)?.length ?? 0) / READABILITY_LIMITS.wordsPerMinute;
/** Check a structurally valid document; use ForPresentation for untrusted input. */
export const validateDecisionDossierReadability = (doc) => {
    const issues = [];
    const refuse = (path, code, message) => { issues.push({ path, code, message }); };
    const r = doc.readability;
    const quote = r?.ownerRequestQuote?.trim() ?? "";
    if (r?.noOwnerRequest === true) {
        refuse("$.readability.noOwnerRequest", quote ? "conflicting_owner_request" : "presentation_blocked", quote ? "A quoted owner request conflicts with noOwnerRequest: keep the literal request and remove the flag."
            : "No owner request: presentation is blocked until the owner's literal request is quoted.");
    }
    else if (!quote) {
        refuse("$.readability.ownerRequestQuote", "missing_owner_request", "Quote the literal owner request this dossier serves, or set noOwnerRequest to block presentation explicitly.");
    }
    else if (quote.length < READABILITY_LIMITS.minOwnerRequestQuoteLength) {
        refuse("$.readability.ownerRequestQuote", "owner_request_too_short", "Quote the full literal owner request so the owner recognizes their own intention.");
    }
    if (blank(r?.stakes)) {
        refuse("$.readability.stakes", "missing_stakes", "State why the decision matters to the owner, using plain words about cost, time or consequences.");
    }
    else if (r.stakes.trim().length < READABILITY_LIMITS.minStakesLength) {
        refuse("$.readability.stakes", "stakes_too_short", "Explain the actual consequence for the owner in at least 20 characters; an internal label is insufficient.");
    }
    const level = r?.stakesLevel;
    if (!level || !Object.hasOwn(READABILITY_BUDGETS, level)) {
        refuse("$.readability.stakesLevel", "missing_stakes_level", "Declare stakesLevel: low for a small reversible inconvenience, medium for cost/disruption, high for lasting or major impact.");
    }
    const budget = r?.readingBudgetMinutes;
    const budgetValid = budget !== undefined && Number.isFinite(budget) && budget >= 1 && budget <= READABILITY_LIMITS.maxDossierBudgetMinutes;
    if (budget === undefined) {
        refuse("$.readability.readingBudgetMinutes", "missing_reading_budget", "Declare a total reading budget in minutes proportionate to the stakes: low up to 2, medium up to 8, high up to 30.");
    }
    else if (!budgetValid) {
        refuse("$.readability.readingBudgetMinutes", "reading_budget_out_of_range", "The total reading budget must be a finite number between 1 and 30 minutes.");
    }
    else if (level && Object.hasOwn(READABILITY_BUDGETS, level) && budget > READABILITY_BUDGETS[level]) {
        refuse("$.readability.readingBudgetMinutes", "reading_budget_disproportionate", `The ${level} stakes budget is at most ${READABILITY_BUDGETS[level]} minutes; shorten this dossier or justify a different stakes level.`);
    }
    const glossary = new Map();
    r?.glossary?.forEach((entry, i) => {
        if (blank(entry.term) || blank(entry.definition)) {
            refuse(`$.readability.glossary[${i}]`, "empty_glossary_entry", "Give every glossary term a definition in plain words visible to the reader.");
        }
        else {
            const term = entry.term.trim();
            if (glossary.has(term) || entry.definition.trim() === term) {
                refuse(`$.readability.glossary[${i}]`, "invalid_glossary_entry", "Use one definition per term and expand its meaning; repeating the code does not explain it.");
            }
            if ((entry.definition.match(CODE_PATTERN) ?? []).some((code) => !PLAIN_TOKENS.has(code))) {
                refuse(`$.readability.glossary[${i}].definition`, "invalid_glossary_entry", "Explain each term independently in plain words, without itself or another code, even one defined elsewhere.");
            }
            glossary.set(term, entry.definition);
        }
    });
    const checkCodes = (text, path) => {
        for (const code of new Set(text?.match(CODE_PATTERN) ?? [])) {
            if (!PLAIN_TOKENS.has(code) && !glossary.has(code)) {
                refuse(path, "undefined_code", `Unexpanded code or acronym "${code}": define it in the visible glossary in plain words, or rewrite it.`);
            }
        }
    };
    // Shared reading time includes everything displayed outside question/option blocks.
    const shared = [];
    const visible = (text, path) => {
        checkCodes(text, path);
        if (text)
            shared.push(text);
    };
    if (isEvidenceDossier(doc)) {
        doc.sources.forEach((s, i) => { checkCodes(s.title, `$.sources[${i}].title`); checkCodes(s.alt, `$.sources[${i}].alt`); });
        doc.citations.forEach((c, i) => {
            checkCodes(c.label, `$.citations[${i}].label`);
            if (c.locator.kind === 'image')
                checkCodes(c.locator.caption, `$.citations[${i}].locator.caption`);
        });
        doc.evidenceGroups.forEach((g, i) => visible(g.summary, `$.evidenceGroups[${i}].summary`));
        doc.annexes.forEach((a, i) => {
            visible(a.title, `$.annexes[${i}].title`);
            visible(a.summary, `$.annexes[${i}].summary`);
            a.blocks.forEach((b, j) => {
                const path = `$.annexes[${i}].blocks[${j}]`;
                if (b.kind === 'text')
                    checkCodes(b.text, `${path}.text`);
                if (b.kind === 'table')
                    [...b.columns, ...b.rows.flat()].forEach(t => checkCodes(t, path));
            });
        });
    }
    for (const field of ["title", "subject"]) {
        visible(doc[field], `$.${field}`);
        if (blank(doc[field]))
            refuse(`$.${field}`, "empty_heading", "Name the subject and decision in a short, non-empty line the owner understands.");
        checkLine(doc[field], `$.${field}`, READABILITY_LIMITS.maxHeadingLength);
    }
    visible(quote, "$.readability.ownerRequestQuote");
    visible(r?.stakes, "$.readability.stakes");
    r?.glossary?.forEach((entry, i) => {
        shared.push(entry.term);
        visible(entry.definition, `$.readability.glossary[${i}].definition`);
    });
    const checkSteps = (steps, path) => {
        steps.forEach((step, i) => {
            visible(step.author, `${path}[${i}].author`);
            visible(step.summary, `${path}[${i}].summary`);
        });
    };
    checkSteps(doc.amendmentTrace, "$.amendmentTrace");
    doc.interactions.forEach((action, i) => visible(action.label, `$.interactions[${i}].label`));
    const questions = doc.sections.filter((s) => s.kind === "question");
    const questionIds = new Set(questions.map((q) => q.id));
    if (!questions.length)
        refuse("$.sections", "missing_question", "A decision dossier needs an explicit question with context, options and a recommendation.");
    const checkQuestionRef = (questionId, path, required) => {
        if (blank(questionId)) {
            if (required)
                refuse(path, "hidden_decision", "This content implies a choice without an explicit question: set questionId to the question the owner must answer.");
        }
        else if (!questionIds.has(questionId)) {
            refuse(path, "unknown_question_ref", `Question "${questionId}" does not exist in this dossier; link to an explicit question.`);
        }
    };
    const optionSets = doc.sections.filter((s) => s.kind === "optionSet");
    let totalQuestionMinutes = 0;
    doc.sections.forEach((section, i) => {
        const path = `$.sections[${i}]`;
        switch (section.kind) {
            case "prose":
                visible(section.markdown, `${path}.markdown`);
                checkQuestionRef(section.questionId, `${path}.questionId`, CHOICE_PATTERN.test(section.markdown));
                break;
            case "outcome":
                visible(section.statement, `${path}.statement`);
                checkQuestionRef(section.questionId, `${path}.questionId`, section.modality !== "comment" || CHOICE_PATTERN.test(section.statement));
                break;
            case "diagram":
                visible(section.alt, `${path}.alt`);
                // Keep the fallback's code guard, but count only the representation displayed.
                if (section.scene === undefined)
                    visible(section.source, `${path}.source`);
                else
                    checkCodes(section.source, `${path}.source`);
                // The interim renderer reads these generic@1 texts instead of the source fallback.
                for (const [family, field] of [["entities", "name"], ["relations", "label"]]) {
                    for (const [id, member] of Object.entries(asRecord(section.scene?.[family]))) {
                        const attribute = asRecord(asRecord(asRecord(member).attributes)[field]);
                        if (attribute.kind === "text" && typeof attribute.value === "string") {
                            visible(attribute.value, `${path}.scene.${family}.${id}.attributes.${field}.value`);
                        }
                    }
                }
                break;
            case "amendmentTrace":
                checkSteps(section.steps, `${path}.steps`);
                break;
            case "optionSet":
                checkQuestionRef(section.questionId, `${path}.questionId`, true);
                checkCodes(section.title, `${path}.title`);
                checkLine(section.title, `${path}.title`, READABILITY_LIMITS.maxHeadingLength);
                section.options.forEach((option, j) => checkOption(option, `${path}.options[${j}]`));
                break;
            case "question": {
                if (blank(section.question))
                    refuse(`${path}.question`, "empty_question", "State the explicit decision the owner needs to make in this question.");
                if (blank(section.context)) {
                    refuse(`${path}.context`, "missing_question_context", "Add representative context in plain words so the question can be understood on its own.");
                }
                else if (section.context.trim().length < READABILITY_LIMITS.minQuestionContextLength) {
                    refuse(`${path}.context`, "question_context_too_short", "Give representative context of at least 20 characters, including what changes for the owner.");
                }
                if (blank(section.recommendedAnswer))
                    refuse(`${path}.recommendedAnswer`, "missing_recommendation", "Recommend an option with a short reason that relates to the owner's request and stakes.");
                checkLine(section.question, `${path}.question`, READABILITY_LIMITS.maxDecisionLineLength);
                checkLine(section.recommendedAnswer, `${path}.recommendedAnswer`, READABILITY_LIMITS.maxDecisionLineLength);
                const linked = optionSets.filter((set) => set.questionId === section.id);
                const options = linked.flatMap((set) => set.options);
                if (options.length < 2 || options.length > 4)
                    refuse(path, "option_count", `Each question needs 2–4 short options; this question has ${options.length}.`);
                if (!options.some((option) => option.id === section.recommendedOptionId)) {
                    refuse(`${path}.recommendedOptionId`, "unknown_recommended_option", "Identify the recommended option by its id among this question's options, with the reason in recommendedAnswer.");
                }
                const texts = [section.question, section.context, section.recommendedAnswer, section.answer,
                    options.find((option) => option.id === section.recommendedOptionId)?.label,
                    ...linked.map((set) => set.title), ...options.flatMap((o) => [o.label, o.consequence, o.body, o.annotationComment])];
                checkCodes(section.question, `${path}.question`);
                checkCodes(section.context, `${path}.context`);
                checkCodes(section.recommendedAnswer, `${path}.recommendedAnswer`);
                checkCodes(section.answer, `${path}.answer`);
                const minutes = section.readingTimeMinutes;
                const minimum = minutesFor(texts);
                if (minutes === undefined) {
                    refuse(`${path}.readingTimeMinutes`, "missing_reading_time", "Estimate the time to read this question, context and options in readingTimeMinutes (up to 2 minutes).");
                }
                else if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 2) {
                    refuse(`${path}.readingTimeMinutes`, "reading_time_exceeded", "Each question must take a positive finite time of at most 2 minutes; shorten or split it.");
                }
                else {
                    if (minutes < minimum)
                        refuse(`${path}.readingTimeMinutes`, "reading_time_underestimated", `This question needs at least ${minimum.toFixed(2)} minutes at 180 words/minute; shorten it or correct its estimate (maximum 2 minutes).`);
                    totalQuestionMinutes += Math.max(minutes, minimum);
                }
                break;
            }
        }
    });
    if (budgetValid && totalQuestionMinutes + minutesFor(shared) > budget) {
        refuse("$.readability.readingBudgetMinutes", "reading_budget_exceeded", "The questions plus shared context and glossary exceed the declared reading budget; shorten the dossier to match its stakes.");
    }
    return issues;
    function checkLine(text, path, max) {
        if (!text)
            return;
        if (text.trim().length > max || LINE_BREAK.test(text))
            refuse(path, "decision_line_too_long", `Use one short line of at most ${max} characters; put explanation in the question context.`);
        if (SUBOPTION_PATTERN.test(text))
            refuse(path, "nested_suboptions", "Expose sub-choices as separate options or questions, without nested lists or inline branches.");
    }
    function checkOption(option, path) {
        const fields = [
            { field: "label", text: option.label, max: READABILITY_LIMITS.maxOptionLabelLength, code: "option_too_long" },
            { field: "consequence", text: option.consequence, max: READABILITY_LIMITS.maxConsequenceLength, code: "consequence_too_long" },
            { field: "body", text: option.body, max: READABILITY_LIMITS.maxOptionBodyLength, code: "option_too_long" },
            { field: "annotationComment", text: option.annotationComment, max: READABILITY_LIMITS.maxOptionBodyLength, code: "option_too_long" },
        ];
        if (blank(option.label))
            refuse(`${path}.label`, "empty_option_label", "Name this option in a few plain words so the owner can compare it at a glance.");
        if (blank(option.consequence))
            refuse(`${path}.consequence`, "missing_consequence", "Add a one-line consequence: what choosing this option changes for the owner.");
        for (const { field, text, max, code } of fields) {
            if (!text)
                continue;
            checkCodes(text, `${path}.${field}`);
            if (text.trim().length > max || LINE_BREAK.test(text))
                refuse(`${path}.${field}`, code, `Keep this option ${field} to one short line of at most ${max} characters; move necessary context to the question.`);
            if (SUBOPTION_PATTERN.test(text) || CHOICE_PATTERN.test(text))
                refuse(`${path}.${field}`, "nested_suboptions", "This option hides sub-options: expose the choices as separate options or as a separate question.");
        }
    }
};
