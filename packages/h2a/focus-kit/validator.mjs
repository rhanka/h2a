/*!
MIT License

Copyright (c) 2025 Fabien Antoine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// packages/focus/src/validation/readability.ts
var READABILITY_BUDGETS = { low: 2, medium: 8, high: 30 };
var READABILITY_LIMITS = {
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
  maxOptionBodyLength: 300
};
var CODE_PATTERN = /\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]*\d[A-Z0-9]*[a-z]?|[A-Z]{2,})\b/g;
var PLAIN_TOKENS = /* @__PURE__ */ new Set(["GO", "NO-GO", "NO", "PENDING", "DEFERRED", "LR", "RL", "TB", "BT", "TD", "UTF-8"]);
var CHOICE_PATTERN = /\beither\b[\s\S]{0,160}?\bor\b|\bsoit\b[\s\S]{0,160}?\bsoit\b|\b(?:instead of|rather than|plut[oô]t que|versus|vs\.?|choos(?:e|ing) between|choisir entre)\b/i;
var SUBOPTION_PATTERN = /(?:^|[\n\r\u2028\u2029])\s*(?:[-*+•‣>]|\d+[.)]|[a-z][.)])\s+\S|\([a-z]\)[\s\S]*\([a-z]\)|\b(?:sub[- ]?options?|sous[- ]?options?)\b/i;
var LINE_BREAK = /[\n\r\u2028\u2029]/;
var blank = (text) => !text?.trim();
var minutesFor = (texts) => (texts.join(" ").match(/\S+/gu)?.length ?? 0) / READABILITY_LIMITS.wordsPerMinute;
var validateDecisionDossierReadability = (doc) => {
  const issues = [];
  const refuse = (path, code, message) => {
    issues.push({ path, code, message });
  };
  const r = doc.readability;
  const quote = r?.ownerRequestQuote?.trim() ?? "";
  if (r?.noOwnerRequest === true) {
    refuse(
      "$.readability.noOwnerRequest",
      quote ? "conflicting_owner_request" : "presentation_blocked",
      quote ? "A quoted owner request conflicts with noOwnerRequest: keep the literal request and remove the flag." : "No owner request: presentation is blocked until the owner's literal request is quoted."
    );
  } else if (!quote) {
    refuse("$.readability.ownerRequestQuote", "missing_owner_request", "Quote the literal owner request this dossier serves, or set noOwnerRequest to block presentation explicitly.");
  } else if (quote.length < READABILITY_LIMITS.minOwnerRequestQuoteLength) {
    refuse("$.readability.ownerRequestQuote", "owner_request_too_short", "Quote the full literal owner request so the owner recognizes their own intention.");
  }
  if (blank(r?.stakes)) {
    refuse("$.readability.stakes", "missing_stakes", "State why the decision matters to the owner, using plain words about cost, time or consequences.");
  } else if (r.stakes.trim().length < READABILITY_LIMITS.minStakesLength) {
    refuse("$.readability.stakes", "stakes_too_short", "Explain the actual consequence for the owner in at least 20 characters; an internal label is insufficient.");
  }
  const level = r?.stakesLevel;
  if (!level || !Object.hasOwn(READABILITY_BUDGETS, level)) {
    refuse("$.readability.stakesLevel", "missing_stakes_level", "Declare stakesLevel: low for a small reversible inconvenience, medium for cost/disruption, high for lasting or major impact.");
  }
  const budget = r?.readingBudgetMinutes;
  const budgetValid = budget !== void 0 && Number.isFinite(budget) && budget >= 1 && budget <= READABILITY_LIMITS.maxDossierBudgetMinutes;
  if (budget === void 0) {
    refuse("$.readability.readingBudgetMinutes", "missing_reading_budget", "Declare a total reading budget in minutes proportionate to the stakes: low up to 2, medium up to 8, high up to 30.");
  } else if (!budgetValid) {
    refuse("$.readability.readingBudgetMinutes", "reading_budget_out_of_range", "The total reading budget must be a finite number between 1 and 30 minutes.");
  } else if (level && Object.hasOwn(READABILITY_BUDGETS, level) && budget > READABILITY_BUDGETS[level]) {
    refuse("$.readability.readingBudgetMinutes", "reading_budget_disproportionate", `The ${level} stakes budget is at most ${READABILITY_BUDGETS[level]} minutes; shorten this dossier or justify a different stakes level.`);
  }
  const glossary = /* @__PURE__ */ new Map();
  r?.glossary?.forEach((entry, i) => {
    if (blank(entry.term) || blank(entry.definition)) {
      refuse(`$.readability.glossary[${i}]`, "empty_glossary_entry", "Give every glossary term a definition in plain words visible to the reader.");
    } else {
      const term = entry.term.trim();
      if (glossary.has(term) || entry.definition.trim() === term) {
        refuse(`$.readability.glossary[${i}]`, "invalid_glossary_entry", "Use one definition per term and expand its meaning; repeating the code does not explain it.");
      }
      if ((entry.definition.match(CODE_PATTERN) ?? []).some((code) => !PLAIN_TOKENS.has(code))) {
        refuse(
          `$.readability.glossary[${i}].definition`,
          "invalid_glossary_entry",
          "Explain each term independently in plain words, without itself or another code, even one defined elsewhere."
        );
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
  const shared = [];
  const visible = (text, path) => {
    checkCodes(text, path);
    if (text) shared.push(text);
  };
  for (const field of ["title", "subject"]) {
    visible(doc[field], `$.${field}`);
    if (blank(doc[field])) refuse(
      `$.${field}`,
      "empty_heading",
      "Name the subject and decision in a short, non-empty line the owner understands."
    );
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
  if (!questions.length) refuse("$.sections", "missing_question", "A decision dossier needs an explicit question with context, options and a recommendation.");
  const checkQuestionRef = (questionId, path, required) => {
    if (blank(questionId)) {
      if (required) refuse(path, "hidden_decision", "This content implies a choice without an explicit question: set questionId to the question the owner must answer.");
    } else if (!questionIds.has(questionId)) {
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
        visible(section.source, `${path}.source`);
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
        if (blank(section.question)) refuse(`${path}.question`, "empty_question", "State the explicit decision the owner needs to make in this question.");
        if (blank(section.context)) {
          refuse(`${path}.context`, "missing_question_context", "Add representative context in plain words so the question can be understood on its own.");
        } else if (section.context.trim().length < READABILITY_LIMITS.minQuestionContextLength) {
          refuse(`${path}.context`, "question_context_too_short", "Give representative context of at least 20 characters, including what changes for the owner.");
        }
        if (blank(section.recommendedAnswer)) refuse(`${path}.recommendedAnswer`, "missing_recommendation", "Recommend an option with a short reason that relates to the owner's request and stakes.");
        checkLine(section.question, `${path}.question`, READABILITY_LIMITS.maxDecisionLineLength);
        checkLine(section.recommendedAnswer, `${path}.recommendedAnswer`, READABILITY_LIMITS.maxDecisionLineLength);
        const linked = optionSets.filter((set) => set.questionId === section.id);
        const options = linked.flatMap((set) => set.options);
        if (options.length < 2 || options.length > 4) refuse(path, "option_count", `Each question needs 2\u20134 short options; this question has ${options.length}.`);
        if (!options.some((option) => option.id === section.recommendedOptionId)) {
          refuse(`${path}.recommendedOptionId`, "unknown_recommended_option", "Identify the recommended option by its id among this question's options, with the reason in recommendedAnswer.");
        }
        const texts = [
          section.question,
          section.context,
          section.recommendedAnswer,
          section.answer,
          options.find((option) => option.id === section.recommendedOptionId)?.label,
          ...linked.map((set) => set.title),
          ...options.flatMap((o) => [o.label, o.consequence, o.body, o.annotationComment])
        ];
        checkCodes(section.question, `${path}.question`);
        checkCodes(section.context, `${path}.context`);
        checkCodes(section.recommendedAnswer, `${path}.recommendedAnswer`);
        checkCodes(section.answer, `${path}.answer`);
        const minutes = section.readingTimeMinutes;
        const minimum = minutesFor(texts);
        if (minutes === void 0) {
          refuse(`${path}.readingTimeMinutes`, "missing_reading_time", "Estimate the time to read this question, context and options in readingTimeMinutes (up to 2 minutes).");
        } else if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 2) {
          refuse(`${path}.readingTimeMinutes`, "reading_time_exceeded", "Each question must take a positive finite time of at most 2 minutes; shorten or split it.");
        } else {
          if (minutes < minimum) refuse(`${path}.readingTimeMinutes`, "reading_time_underestimated", `This question needs at least ${minimum.toFixed(2)} minutes at 180 words/minute; shorten it or correct its estimate (maximum 2 minutes).`);
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
    if (!text) return;
    if (text.trim().length > max || LINE_BREAK.test(text)) refuse(
      path,
      "decision_line_too_long",
      `Use one short line of at most ${max} characters; put explanation in the question context.`
    );
    if (SUBOPTION_PATTERN.test(text)) refuse(
      path,
      "nested_suboptions",
      "Expose sub-choices as separate options or questions, without nested lists or inline branches."
    );
  }
  function checkOption(option, path) {
    const fields = [
      { field: "label", text: option.label, max: READABILITY_LIMITS.maxOptionLabelLength, code: "option_too_long" },
      { field: "consequence", text: option.consequence, max: READABILITY_LIMITS.maxConsequenceLength, code: "consequence_too_long" },
      { field: "body", text: option.body, max: READABILITY_LIMITS.maxOptionBodyLength, code: "option_too_long" },
      { field: "annotationComment", text: option.annotationComment, max: READABILITY_LIMITS.maxOptionBodyLength, code: "option_too_long" }
    ];
    if (blank(option.label)) refuse(`${path}.label`, "empty_option_label", "Name this option in a few plain words so the owner can compare it at a glance.");
    if (blank(option.consequence)) refuse(`${path}.consequence`, "missing_consequence", "Add a one-line consequence: what choosing this option changes for the owner.");
    for (const { field, text, max, code } of fields) {
      if (!text) continue;
      checkCodes(text, `${path}.${field}`);
      if (text.trim().length > max || LINE_BREAK.test(text)) refuse(`${path}.${field}`, code, `Keep this option ${field} to one short line of at most ${max} characters; move necessary context to the question.`);
      if (SUBOPTION_PATTERN.test(text) || CHOICE_PATTERN.test(text)) refuse(`${path}.${field}`, "nested_suboptions", "This option hides sub-options: expose the choices as separate options or as a separate question.");
    }
  }
};

// packages/focus/src/validation/index.ts
var DOSSIER_SCHEMA_ID = "urn:sentropic:focus:DecisionDossierDocument:1.0.0";
var DOSSIER_SCHEMA_VERSION = "1.0.0";
var DecisionDossierValidationError = class extends Error {
  issues;
  constructor(issues) {
    super(
      `invalid DecisionDossierDocument: ${issues.map((issue2) => `${issue2.path} ${issue2.code}: ${issue2.message}`).join("; ")}`
    );
    this.name = "DecisionDossierValidationError";
    this.issues = issues;
  }
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var issue = (path, code, message) => ({
  path,
  code,
  message
});
var checkClosedObject = (value, path, allowed, required, stringKeys, issues) => {
  if (!isRecord(value)) {
    issues.push(issue(path, "invalid_type", "expected an object"));
    return void 0;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push(issue(`${path}.${key}`, "unknown_field", "field not in the closed schema"));
    }
  }
  for (const key of required) {
    if (value[key] === void 0) {
      issues.push(issue(`${path}.${key}`, "missing_field", "required field is missing"));
    }
  }
  for (const key of stringKeys) {
    if (value[key] !== void 0 && typeof value[key] !== "string") {
      issues.push(issue(`${path}.${key}`, "invalid_type", "expected a string"));
    }
  }
  return value;
};
var checkEnum = (value, path, allowed, issues) => {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(
      issue(path, "invalid_enum", `expected one of: ${allowed.join(" | ")}`)
    );
  }
};
var TOP_REQUIRED = [
  "ref",
  "subject",
  "title",
  "hash",
  "cursor",
  "sections",
  "interactions",
  "provenance",
  "amendmentTrace"
];
var TOP_STRINGS = ["ref", "subject", "title", "hash", "cursor"];
var TOP_ALLOWED = [...TOP_REQUIRED, "readability"];
var checkOptionNode = (value, path, issues) => {
  const start = issues.length;
  const node = checkClosedObject(
    value,
    path,
    ["kind", "id", "targetRef", "label", "body", "annotation", "annotationComment", "consequence"],
    ["kind", "id", "targetRef", "label", "annotation"],
    ["id", "targetRef", "label", "body", "annotationComment", "consequence"],
    issues
  );
  if (node === void 0) return void 0;
  if (node["kind"] !== "option") {
    issues.push(issue(`${path}.kind`, "invalid_discriminator", 'expected "option"'));
  }
  checkEnum(node["annotation"], `${path}.annotation`, ["none", "accept", "reject", "comment"], issues);
  if (issues.length !== start) return void 0;
  return {
    kind: "option",
    id: node["id"],
    targetRef: node["targetRef"],
    label: node["label"],
    ...typeof node["body"] === "string" ? { body: node["body"] } : {},
    annotation: node["annotation"],
    ...typeof node["annotationComment"] === "string" ? { annotationComment: node["annotationComment"] } : {},
    ...typeof node["consequence"] === "string" ? { consequence: node["consequence"] } : {}
  };
};
var checkAmendmentStep = (value, path, issues) => {
  const start = issues.length;
  const step = checkClosedObject(
    value,
    path,
    ["at", "author", "summary"],
    ["at", "author", "summary"],
    ["at", "author", "summary"],
    issues
  );
  if (step === void 0 || issues.length !== start) return void 0;
  return { at: step["at"], author: step["author"], summary: step["summary"] };
};
var checkSectionNode = (value, path, issues) => {
  if (!isRecord(value)) {
    issues.push(issue(path, "invalid_type", "expected an object"));
    return void 0;
  }
  const kind = value["kind"];
  if (kind !== "prose" && kind !== "question" && kind !== "optionSet" && kind !== "outcome" && kind !== "amendmentTrace" && kind !== "diagram") {
    issues.push(
      issue(
        `${path}.kind`,
        typeof kind === "undefined" ? "missing_field" : "unknown_node_kind",
        `unknown section kind ${typeof kind === "string" ? `"${kind}"` : " discriminant"}`
      )
    );
    return void 0;
  }
  const start = issues.length;
  switch (kind) {
    case "prose": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "markdown", "questionId"],
        ["kind", "id", "targetRef", "markdown"],
        ["id", "targetRef", "markdown", "questionId"],
        issues
      );
      if (node === void 0 || issues.length !== start) return void 0;
      return { kind: "prose", id: node["id"], targetRef: node["targetRef"], markdown: node["markdown"], ...typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {} };
    }
    case "question": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "question", "recommendedAnswer", "answer", "state", "context", "readingTimeMinutes", "recommendedOptionId"],
        ["kind", "id", "targetRef", "question", "state"],
        ["id", "targetRef", "question", "recommendedAnswer", "answer", "context", "recommendedOptionId"],
        issues
      );
      if (node === void 0) return void 0;
      checkEnum(node["state"], `${path}.state`, ["open", "answered", "validated"], issues);
      if (node["readingTimeMinutes"] !== void 0 && (typeof node["readingTimeMinutes"] !== "number" || !Number.isFinite(node["readingTimeMinutes"]))) {
        issues.push(issue(`${path}.readingTimeMinutes`, "invalid_type", "expected a finite number"));
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "question",
        id: node["id"],
        targetRef: node["targetRef"],
        question: node["question"],
        ...typeof node["recommendedAnswer"] === "string" ? { recommendedAnswer: node["recommendedAnswer"] } : {},
        ...typeof node["answer"] === "string" ? { answer: node["answer"] } : {},
        state: node["state"],
        ...typeof node["context"] === "string" ? { context: node["context"] } : {},
        ...typeof node["recommendedOptionId"] === "string" ? { recommendedOptionId: node["recommendedOptionId"] } : {},
        ...typeof node["readingTimeMinutes"] === "number" ? { readingTimeMinutes: node["readingTimeMinutes"] } : {}
      };
    }
    case "optionSet": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "title", "options", "questionId"],
        ["kind", "id", "targetRef", "options"],
        ["id", "targetRef", "title", "questionId"],
        issues
      );
      if (node === void 0) return void 0;
      const options = [];
      if (!Array.isArray(node["options"])) {
        issues.push(issue(`${path}.options`, "invalid_type", "expected an array"));
      } else {
        node["options"].forEach((option, index) => {
          const checked = checkOptionNode(option, `${path}.options[${index}]`, issues);
          if (checked !== void 0) options.push(checked);
        });
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "optionSet",
        id: node["id"],
        targetRef: node["targetRef"],
        ...typeof node["title"] === "string" ? { title: node["title"] } : {},
        options,
        ...typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}
      };
    }
    case "outcome": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "modality", "statement", "questionId"],
        ["kind", "id", "targetRef", "modality", "statement"],
        ["id", "targetRef", "statement", "questionId"],
        issues
      );
      if (node === void 0) return void 0;
      checkEnum(node["modality"], `${path}.modality`, ["decision", "orientation", "amendment", "comment"], issues);
      if (issues.length !== start) return void 0;
      return {
        kind: "outcome",
        id: node["id"],
        targetRef: node["targetRef"],
        modality: node["modality"],
        statement: node["statement"],
        ...typeof node["questionId"] === "string" ? { questionId: node["questionId"] } : {}
      };
    }
    case "amendmentTrace": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "steps"],
        ["kind", "id", "targetRef", "steps"],
        ["id", "targetRef"],
        issues
      );
      if (node === void 0) return void 0;
      const steps = [];
      if (!Array.isArray(node["steps"])) {
        issues.push(issue(`${path}.steps`, "invalid_type", "expected an array"));
      } else {
        node["steps"].forEach((step, index) => {
          const checked = checkAmendmentStep(step, `${path}.steps[${index}]`, issues);
          if (checked !== void 0) steps.push(checked);
        });
      }
      if (issues.length !== start) return void 0;
      return {
        kind: "amendmentTrace",
        id: node["id"],
        targetRef: node["targetRef"],
        steps
      };
    }
    case "diagram": {
      const node = checkClosedObject(
        value,
        path,
        ["kind", "id", "targetRef", "syntax", "source", "alt"],
        ["kind", "id", "targetRef", "syntax", "source", "alt"],
        ["id", "targetRef", "source", "alt"],
        issues
      );
      if (node === void 0) return void 0;
      checkEnum(node["syntax"], `${path}.syntax`, ["mermaid", "plantuml"], issues);
      if (issues.length !== start) return void 0;
      return {
        kind: "diagram",
        id: node["id"],
        targetRef: node["targetRef"],
        syntax: node["syntax"],
        source: node["source"],
        alt: node["alt"]
      };
    }
  }
};
var checkInteraction = (value, path, issues) => {
  const start = issues.length;
  const affordance = checkClosedObject(
    value,
    path,
    ["name", "targetRef", "label", "enabled"],
    ["name", "targetRef", "label", "enabled"],
    ["name", "targetRef", "label"],
    issues
  );
  if (affordance === void 0) return void 0;
  if (affordance["enabled"] !== false) {
    issues.push(
      issue(`${path}.enabled`, "enabled_action", "snapshot interactions must stay disabled (enabled:false)")
    );
  }
  if (issues.length !== start) return void 0;
  return {
    name: affordance["name"],
    targetRef: affordance["targetRef"],
    label: affordance["label"],
    enabled: false
  };
};
var checkGlossaryEntry = (value, path, issues) => {
  const start = issues.length;
  const entry = checkClosedObject(
    value,
    path,
    ["term", "definition"],
    ["term", "definition"],
    ["term", "definition"],
    issues
  );
  if (entry === void 0 || issues.length !== start) return void 0;
  return { term: entry["term"], definition: entry["definition"] };
};
var checkReadability = (value, path, issues) => {
  const start = issues.length;
  const block = checkClosedObject(
    value,
    path,
    ["ownerRequestQuote", "noOwnerRequest", "stakes", "stakesLevel", "readingBudgetMinutes", "glossary"],
    [],
    ["ownerRequestQuote", "stakes"],
    issues
  );
  if (block === void 0) return void 0;
  if (block["stakesLevel"] !== void 0) {
    checkEnum(block["stakesLevel"], `${path}.stakesLevel`, ["low", "medium", "high"], issues);
  }
  if (block["noOwnerRequest"] !== void 0 && typeof block["noOwnerRequest"] !== "boolean") {
    issues.push(issue(`${path}.noOwnerRequest`, "invalid_type", "expected a boolean"));
  }
  if (block["readingBudgetMinutes"] !== void 0 && (typeof block["readingBudgetMinutes"] !== "number" || !Number.isFinite(block["readingBudgetMinutes"]))) {
    issues.push(issue(`${path}.readingBudgetMinutes`, "invalid_type", "expected a finite number"));
  }
  let glossary;
  if (block["glossary"] !== void 0) {
    glossary = [];
    if (!Array.isArray(block["glossary"])) {
      issues.push(issue(`${path}.glossary`, "invalid_type", "expected an array"));
    } else {
      block["glossary"].forEach((entry, index) => {
        const checked = checkGlossaryEntry(entry, `${path}.glossary[${index}]`, issues);
        if (checked !== void 0) glossary.push(checked);
      });
    }
  }
  if (issues.length !== start) return void 0;
  return {
    ...typeof block["ownerRequestQuote"] === "string" ? { ownerRequestQuote: block["ownerRequestQuote"] } : {},
    ...typeof block["noOwnerRequest"] === "boolean" ? { noOwnerRequest: block["noOwnerRequest"] } : {},
    ...typeof block["stakes"] === "string" ? { stakes: block["stakes"] } : {},
    ...block["stakesLevel"] !== void 0 ? { stakesLevel: block["stakesLevel"] } : {},
    ...typeof block["readingBudgetMinutes"] === "number" ? { readingBudgetMinutes: block["readingBudgetMinutes"] } : {},
    ...glossary !== void 0 ? { glossary } : {}
  };
};
var validateDecisionDossierStructure = (value) => {
  const issues = [];
  const doc = checkClosedObject(value, "$", [...TOP_ALLOWED], [...TOP_REQUIRED], [...TOP_STRINGS], issues);
  if (doc === void 0) return { ok: false, issues };
  const sections = [];
  if (!Array.isArray(doc["sections"])) {
    issues.push(issue("$.sections", "invalid_type", "expected an array"));
  } else {
    doc["sections"].forEach((section, index) => {
      const checked = checkSectionNode(section, `$.sections[${index}]`, issues);
      if (checked !== void 0) sections.push(checked);
    });
  }
  const interactions = [];
  if (!Array.isArray(doc["interactions"])) {
    issues.push(issue("$.interactions", "invalid_type", "expected an array"));
  } else {
    doc["interactions"].forEach((interaction, index) => {
      const checked = checkInteraction(interaction, `$.interactions[${index}]`, issues);
      if (checked !== void 0) interactions.push(checked);
    });
  }
  let provenance;
  const rawProvenance = checkClosedObject(
    doc["provenance"],
    "$.provenance",
    ["source", "readAt", "comprehensionEvidence"],
    ["source", "readAt"],
    ["source", "readAt"],
    issues
  );
  if (rawProvenance !== void 0) {
    let evidence;
    if (rawProvenance["comprehensionEvidence"] !== void 0) {
      const evidenceStart = issues.length;
      const rawEvidence = checkClosedObject(
        rawProvenance["comprehensionEvidence"],
        "$.provenance.comprehensionEvidence",
        ["subject", "dossierHash", "signature"],
        ["subject", "dossierHash"],
        ["subject", "dossierHash", "signature"],
        issues
      );
      if (rawEvidence !== void 0 && issues.length === evidenceStart) {
        evidence = {
          subject: rawEvidence["subject"],
          dossierHash: rawEvidence["dossierHash"],
          ...typeof rawEvidence["signature"] === "string" ? { signature: rawEvidence["signature"] } : {}
        };
      }
    }
    provenance = {
      source: rawProvenance["source"],
      readAt: rawProvenance["readAt"],
      ...evidence !== void 0 ? { comprehensionEvidence: evidence } : {}
    };
  }
  const amendmentTrace = [];
  if (!Array.isArray(doc["amendmentTrace"])) {
    issues.push(issue("$.amendmentTrace", "invalid_type", "expected an array"));
  } else {
    doc["amendmentTrace"].forEach((step, index) => {
      const checked = checkAmendmentStep(step, `$.amendmentTrace[${index}]`, issues);
      if (checked !== void 0) amendmentTrace.push(checked);
    });
  }
  let readability;
  if (doc["readability"] !== void 0) {
    readability = checkReadability(doc["readability"], "$.readability", issues);
  }
  if (issues.length > 0 || provenance === void 0 || doc["readability"] !== void 0 && readability === void 0) {
    return { ok: false, issues };
  }
  if (typeof doc["ref"] !== "string" || typeof doc["subject"] !== "string" || typeof doc["title"] !== "string" || typeof doc["hash"] !== "string" || typeof doc["cursor"] !== "string") {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      ref: doc["ref"],
      subject: doc["subject"],
      title: doc["title"],
      hash: doc["hash"],
      cursor: doc["cursor"],
      sections,
      interactions,
      provenance,
      amendmentTrace,
      ...readability !== void 0 ? { readability } : {}
    }
  };
};
var validateDecisionDossierSemantics = (doc) => {
  const issues = [];
  const seen = /* @__PURE__ */ new Map();
  const registerId = (id, path) => {
    const first = seen.get(id);
    if (first !== void 0) {
      issues.push(issue(path, "duplicate_id", `node id "${id}" already used at ${first}`));
    } else {
      seen.set(id, path);
    }
  };
  doc.sections.forEach((section, index) => {
    const path = `$.sections[${index}]`;
    registerId(section.id, `${path}.id`);
    if (section.kind === "optionSet") {
      section.options.forEach((option, optionIndex) => {
        registerId(option.id, `${path}.options[${optionIndex}].id`);
      });
    }
  });
  const resolvable = /* @__PURE__ */ new Set([doc.ref]);
  for (const section of doc.sections) {
    resolvable.add(section.id);
    resolvable.add(section.targetRef);
    if (section.kind === "optionSet") {
      for (const option of section.options) {
        resolvable.add(option.id);
        resolvable.add(option.targetRef);
      }
    }
  }
  doc.interactions.forEach((interaction, index) => {
    if (!resolvable.has(interaction.targetRef)) {
      issues.push(
        issue(
          `$.interactions[${index}].targetRef`,
          "unresolved_target",
          `interaction target "${interaction.targetRef}" resolves to no node`
        )
      );
    }
  });
  const evidence = doc.provenance.comprehensionEvidence;
  if (evidence !== void 0 && evidence.dossierHash !== doc.hash) {
    issues.push(
      issue(
        "$.provenance.comprehensionEvidence.dossierHash",
        "evidence_mismatch",
        "comprehension evidence does not match the snapshot hash"
      )
    );
  }
  return issues;
};
var validateDecisionDossierDocument = (value) => {
  const structural = validateDecisionDossierStructure(value);
  if (!structural.ok) return structural;
  const semantic = validateDecisionDossierSemantics(structural.value);
  if (semantic.length > 0) return { ok: false, issues: semantic };
  return structural;
};
var assertDecisionDossierDocument = (value) => {
  const result = validateDecisionDossierDocument(value);
  if (!result.ok) throw new DecisionDossierValidationError(result.issues);
  return result.value;
};
var validateDecisionDossierForPresentation = (value) => {
  const result = validateDecisionDossierDocument(value);
  if (!result.ok) return result;
  const issues = validateDecisionDossierReadability(result.value);
  return issues.length > 0 ? { ok: false, issues } : result;
};
var assertDecisionDossierForPresentation = (value) => {
  const result = validateDecisionDossierForPresentation(value);
  if (!result.ok) throw new DecisionDossierValidationError(result.issues);
  return result.value;
};
export {
  DOSSIER_SCHEMA_ID,
  DOSSIER_SCHEMA_VERSION,
  DecisionDossierValidationError,
  READABILITY_BUDGETS,
  READABILITY_LIMITS,
  assertDecisionDossierDocument,
  assertDecisionDossierForPresentation,
  validateDecisionDossierDocument,
  validateDecisionDossierForPresentation,
  validateDecisionDossierReadability,
  validateDecisionDossierSemantics,
  validateDecisionDossierStructure
};
