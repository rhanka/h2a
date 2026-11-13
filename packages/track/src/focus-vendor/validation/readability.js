import { isEvidenceDossier } from "../model.js";
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
    maxCellWords: 60,
    maxBlockCombinedWords: 60,
    maxSentenceWords: 22,
    maxInputLabelWords: 12,
    maxInputLabelLength: 100,
    maxCompletionCriterionSentences: 1,
    maxCompletionCriterionWords: 22,
    maxCompletionCriterionLength: 160,
};
// Acronyms and opaque codes, including L06b, MH-L3, R5 and CI-4821.
const CODE_PATTERN = /\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]*\d[A-Z0-9]*[a-z]?|[A-Z]{2,})\b/g;
// Ordinary outcome words and diagram direction syntax, not internal references.
const PLAIN_TOKENS = new Set(["GO", "NO-GO", "NO", "PENDING", "DEFERRED", "LR", "RL", "TB", "BT", "TD", "UTF-8"]);
const CHOICE_PATTERN = /\beither\b[\s\S]{0,160}?\bor\b|\bsoit\b[\s\S]{0,160}?\bsoit\b|\b(?:instead of|rather than|plut[oô]t que|versus|vs\.?|choos(?:e|ing) between|choisir entre)\b/i;
const SUBOPTION_PATTERN = /(?:^|[\n\r\u2028\u2029])\s*(?:[-*+•‣>]|\d+[.)]|[a-z][.)])\s+\S|\([a-z]\)[\s\S]*\([a-z]\)|\b(?:sub[- ]?options?|sous[- ]?options?)\b/i;
const LINE_BREAK = /[\n\r\u2028\u2029]/;
// Owner 11/11 « chasse aux pavés IA » patterns (never bypassed via glossary).
const ULID_RE = /\b01[0-9A-HJKMNP-TV-Z]{24}\b/;
const HASH_RE = /\b(?:sha256:)?[0-9a-f]{7,64}\b/i;
const INTERNAL_ID_RE = /\b(?:WP\d+(?:\.\d+)?|D-\d+|O\d{3,4}|A\d{2}|T\d{2}|r\d+-D\d+|J\d+|M\d+|Q\d+|Q-[A-Z]|F\d+|LOT-\d+|AC-\d+|rel-\d+|PR\s*#?\d+|hrpn\/#\d+)\b/;
const RAW_DIGIT_RE = /\b(?!h2a\b)\S*\d\S*\b/gi;
const TAKEAWAY_RE = /^(?:En bref\s*:\s+|In short:\s+)/;
const blank = (text) => !text?.trim();
const asRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const minutesFor = (texts) => (texts.join(" ").match(/\S+/gu)?.length ?? 0) / READABILITY_LIMITS.wordsPerMinute;
const wordsOf = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean);
const sentencesOf = (text) => String(text ?? "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
const stripHtmlAndLinks = (text) => text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
/** Check a structurally valid document; use ForPresentation for untrusted input. */
export const validateDecisionDossierReadability = (doc, options) => {
    const strict = (options?.profile ??
        (doc.ref === "decision:s1-hello" && doc.hash.startsWith("draft:s1-hello-")
            ? "legacy"
            : "strict")) === "strict";
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
            refuse(`$.readability.glossary[${i}]`, "empty_glossary_entry", "Give every glossary term a definition in plain words, present and findable when the glossary is opened.");
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
                refuse(path, "undefined_code", `Unexpanded code or acronym "${code}": define it in the glossary in plain words (folded but present and findable), or rewrite it.`);
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
        doc.evidenceGroups.forEach((g, i) => {
            visible(g.summary, `$.evidenceGroups[${i}].summary`);
            checkProseCell(g.summary, `$.evidenceGroups[${i}].summary`, { requireTakeaway: true });
        });
        doc.annexes.forEach((a, i) => {
            visible(a.title, `$.annexes[${i}].title`);
            visible(a.summary, `$.annexes[${i}].summary`);
            checkProseCell(a.summary, `$.annexes[${i}].summary`, { requireTakeaway: true });
            a.blocks.forEach((b, j) => {
                const path = `$.annexes[${i}].blocks[${j}]`;
                if (b.kind === 'text') {
                    checkCodes(b.text, `${path}.text`);
                    checkProseCell(b.text, `${path}.text`, { requireTakeaway: true });
                }
                if (b.kind === 'table') {
                    [...b.columns, ...b.rows.flat()].forEach(t => checkCodes(t, path));
                    b.rows.forEach((row, rIdx) => row.forEach((cell, cIdx) => checkProseCell(cell, `${path}.rows[${rIdx}][${cIdx}]`, { requireTakeaway: false })));
                }
            });
        });
    }
    for (const field of ["title", "subject"]) {
        visible(doc[field], `$.${field}`);
        if (blank(doc[field]))
            refuse(`$.${field}`, "empty_heading", "Name the subject and decision in a short, non-empty line the owner understands.");
        checkLine(doc[field], `$.${field}`, READABILITY_LIMITS.maxHeadingLength);
    }
    // ownerRequestQuote is a verbatim quote from the owner: count in reading time,
    // but exempt from prose rewriting and code/anti-pavés bans so it stays intact word-for-word.
    if (quote)
        shared.push(quote);
    visible(r?.stakes, "$.readability.stakes");
    checkMarkdownProse(r?.stakes, "$.readability.stakes");
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
                checkMarkdownProse(section.markdown, `${path}.markdown`);
                checkQuestionRef(section.questionId, `${path}.questionId`, CHOICE_PATTERN.test(section.markdown));
                checkInputsAndCriterion(section, path);
                break;
            case "outcome":
                visible(section.statement, `${path}.statement`);
                checkMarkdownProse(section.statement, `${path}.statement`);
                checkQuestionRef(section.questionId, `${path}.questionId`, section.modality !== "comment" || CHOICE_PATTERN.test(section.statement));
                break;
            case "diagram":
                visible(section.alt, `${path}.alt`);
                // Keep the fallback's code guard when inline source is present, and guard when undefined (reference mode).
                if (section.source !== undefined) {
                    if (section.scene === undefined)
                        visible(section.source, `${path}.source`);
                    else
                        checkCodes(section.source, `${path}.source`);
                }
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
                checkMarkdownProse(section.context, `${path}.context`);
                checkProseCell(section.recommendedAnswer, `${path}.recommendedAnswer`, { requireTakeaway: true });
                checkProseCell(section.answer, `${path}.answer`, { requireTakeaway: true });
                checkInputsAndCriterion(section, path, texts);
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
    function checkInputsAndCriterion(section, path, questionTexts) {
        section.inputs?.forEach((inp, j) => {
            if (inp.label === undefined)
                return;
            const labelPath = `${path}.inputs[${j}].label`;
            visible(inp.label, labelPath);
            if (questionTexts !== undefined)
                questionTexts.push(inp.label);
            if (strict &&
                (wordsOf(inp.label).length > READABILITY_LIMITS.maxInputLabelWords ||
                    inp.label.trim().length > READABILITY_LIMITS.maxInputLabelLength ||
                    LINE_BREAK.test(inp.label))) {
                refuse(labelPath, "input_label_too_long", `Keep each input label to one short line of at most ${READABILITY_LIMITS.maxInputLabelWords} words and ${READABILITY_LIMITS.maxInputLabelLength} characters.`);
            }
            checkProseCell(inp.label, labelPath, { requireTakeaway: false });
        });
        if (section.completionCriterion !== undefined) {
            const cc = section.completionCriterion;
            const ccPath = `${path}.completionCriterion`;
            visible(cc, ccPath);
            if (questionTexts !== undefined)
                questionTexts.push(cc);
            if (strict &&
                (sentencesOf(cc).length > READABILITY_LIMITS.maxCompletionCriterionSentences ||
                    wordsOf(cc).length > READABILITY_LIMITS.maxCompletionCriterionWords ||
                    cc.trim().length > READABILITY_LIMITS.maxCompletionCriterionLength ||
                    LINE_BREAK.test(cc))) {
                refuse(ccPath, "completion_criterion_too_long", `Keep completionCriterion to one sentence of at most ${READABILITY_LIMITS.maxCompletionCriterionWords} words and ${READABILITY_LIMITS.maxCompletionCriterionLength} characters.`);
            }
            checkProseCell(cc, ccPath, { requireTakeaway: false });
        }
    }
    function checkProseCell(rawText, path, opts) {
        if (!strict || !rawText)
            return;
        const text = (opts?.isCleaned ? rawText : stripHtmlAndLinks(rawText)).trim();
        if (!text)
            return;
        const words = wordsOf(text).length;
        if (words > READABILITY_LIMITS.maxCellWords) {
            refuse(path, "cell_max_60_words", `Keep each prose cell or paragraph to at most ${READABILITY_LIMITS.maxCellWords} words (found ${words} words).`);
        }
        const sents = sentencesOf(text);
        if (opts?.requireTakeaway !== false && sents.length > 1 && !TAKEAWAY_RE.test(text)) {
            refuse(path, "missing_en_bref_takeaway", 'Start multi-sentence prose blocks with "En bref : " or "In short: " so the reader gets the takeaway first.');
        }
        if (text.includes(";")) {
            refuse(path, "one_idea_per_sentence_no_semicolon", "Express one idea per sentence without semicolons; split into separate sentences or use a list.");
        }
        if (/[()]/.test(text)) {
            refuse(path, "one_idea_per_sentence_no_parentheses", "Express one idea per sentence without parenthetical asides; state the point directly or omit it.");
        }
        if (ULID_RE.test(text)) {
            refuse(path, "no_ulid_in_prose", "Do not embed ULIDs in prose; keep identifiers in structured fields and use plain words in text.");
        }
        if (HASH_RE.test(text)) {
            refuse(path, "no_hash_or_sha_in_prose", "Do not embed hashes or SHAs in prose; keep digests in provenance or evidence fields.");
        }
        if (INTERNAL_ID_RE.test(text)) {
            refuse(path, "no_internal_id_or_lot_code_in_prose", "Do not embed internal IDs or lot codes in prose, even if listed in the glossary; describe the subject in plain words.");
        }
        const rawDigitTokens = (text.match(RAW_DIGIT_RE) ?? []).map((tok) => tok.replace(/^[.,!?:;"'`]+|[.,!?:;"'`]+$/g, ""));
        const hasDisallowedDigitToken = rawDigitTokens.some((tok) => tok.length > 0 && !PLAIN_TOKENS.has(tok.toUpperCase()));
        if (hasDisallowedDigitToken) {
            refuse(path, "no_raw_count_or_number_in_prose", "Do not embed raw counts or numbers in prose, even if listed in the glossary; write out plain qualitative words.");
        }
        for (const s of sents) {
            const sw = wordsOf(s).length;
            if (sw > READABILITY_LIMITS.maxSentenceWords) {
                refuse(path, "sentence_max_22_words", `Keep every sentence to at most ${READABILITY_LIMITS.maxSentenceWords} words (found ${sw} words).`);
            }
            if ((s.match(/,/g) ?? []).length >= 3) {
                refuse(path, "no_enumeration_in_prose_sentence", "Avoid three or more commas in a single prose sentence; use a bullet list or table instead of inline enumerations.");
            }
            if ((s.match(/:/g) ?? []).length > 1) {
                refuse(path, "one_idea_per_sentence_max_one_colon", "Use at most one colon per sentence so each sentence carries a single clear idea.");
            }
        }
    }
    function checkMarkdownProse(markdown, path) {
        if (!strict || !markdown)
            return;
        const cleanedDoc = stripHtmlAndLinks(markdown);
        const rawLines = cleanedDoc.split(/\r?\n/);
        const blocks = [];
        let currentParagraph = [];
        let currentBullets = [];
        const flushParagraph = () => {
            if (currentParagraph.length > 0) {
                blocks.push({ kind: "paragraph", lines: currentParagraph });
                currentParagraph = [];
            }
        };
        const flushBullets = () => {
            if (currentBullets.length > 0) {
                blocks.push({ kind: "bullets", lines: currentBullets });
                currentBullets = [];
            }
        };
        for (const rawLine of rawLines) {
            const trimmed = rawLine.trim();
            if (!trimmed) {
                flushParagraph();
                flushBullets();
                continue;
            }
            if (/^#{1,6}\s+/.test(trimmed)) {
                flushParagraph();
                flushBullets();
                blocks.push({ kind: "heading", lines: [trimmed.replace(/^#{1,6}\s+/, "")] });
                continue;
            }
            if (/^\|.*\|$/.test(trimmed)) {
                flushParagraph();
                flushBullets();
                blocks.push({ kind: "table", lines: [trimmed] });
                continue;
            }
            const bulletMatch = trimmed.match(/^(?:[-*+•]|\d+[.)])\s+(.*)$/);
            if (bulletMatch) {
                flushParagraph();
                currentBullets.push(bulletMatch[1]);
                continue;
            }
            flushBullets();
            currentParagraph.push(trimmed);
        }
        flushParagraph();
        flushBullets();
        for (let idx = 0; idx < blocks.length; idx++) {
            const block = blocks[idx];
            if (block.kind === "heading") {
                checkProseCell(block.lines[0], path, { requireTakeaway: false, isCleaned: true });
            }
            else if (block.kind === "table") {
                const line = block.lines[0];
                const cells = line.slice(1, -1).split("|").map((c) => c.trim());
                if (cells.every((c) => /^[-:]+$/.test(c)))
                    continue;
                for (const cell of cells) {
                    checkProseCell(cell, path, { requireTakeaway: false, isCleaned: true });
                }
            }
            else if (block.kind === "bullets") {
                const prev = idx > 0 && blocks[idx - 1].kind === "paragraph" ? blocks[idx - 1].lines.join(" ") : "";
                const combined = [prev, ...block.lines].filter(Boolean).join(" ");
                if (wordsOf(combined).length > READABILITY_LIMITS.maxBlockCombinedWords) {
                    refuse(path, "block_combined_max_60_words", `Keep each lead-and-bullet block to at most ${READABILITY_LIMITS.maxBlockCombinedWords} words combined.`);
                }
                for (const item of block.lines) {
                    checkProseCell(item, path, { requireTakeaway: false, isCleaned: true });
                }
            }
            else {
                const text = block.lines.join(" ");
                checkProseCell(text, path, { requireTakeaway: true, isCleaned: true });
            }
        }
    }
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
            if (field !== "label") {
                checkProseCell(text, `${path}.${field}`, { requireTakeaway: true });
            }
        }
    }
};
