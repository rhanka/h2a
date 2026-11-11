/**
 * Readability-gate specs for the DecisionDossierDocument (focus-readable-dossiers).
 *
 * A dossier can be structurally valid yet unpresentable: technocratic, opaque
 * to the owner. The readability gate (`validateDecisionDossierReadability`)
 * refuses such dossiers with actionable messages; an accessible dossier passes.
 * The published schema stays backward compatible: every readability field is
 * optional at schema level and enforced only by the gate.
 */

import { describe, expect, it, vi } from "vitest";
import * as publicValidation from "../src/validation/index.js";
import { renderMd, renderTerminal, renderHtml } from "../src/index.js";
import { readFileSync } from "node:fs";

import type { DecisionDossierDocument } from "../src/model.js";
import { validateDecisionDossierDocument } from "../src/validation/index.js";
import {
  READABILITY_LIMITS,
  validateDecisionDossierForPresentation,
  validateDecisionDossierReadability,
} from "../src/validation/index.js";

const clone = (doc: DecisionDossierDocument): unknown =>
  JSON.parse(JSON.stringify(doc)) as unknown;

import { accessibleDossierFixture, technocraticDossierFixture } from "./readability.fixture.js";

describe("readability gate refuses the technocratic dossier with clear messages", () => {
  it("the technocratic dossier is structurally valid (schema stays backward compatible)", () => {
    expect(validateDecisionDossierDocument(clone(technocraticDossierFixture)).ok).toBe(true);
  });

  it("refuses with one actionable message per rule", () => {
    const validated = validateDecisionDossierDocument(clone(technocraticDossierFixture));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const issues = validateDecisionDossierReadability(validated.value);
    const codes = new Set(issues.map((issue) => issue.code));
    for (const expected of [
      "missing_owner_request",
      "missing_stakes",
      "missing_reading_budget",
      "missing_question_context",
      "missing_recommendation",
      "missing_reading_time",
      "option_count",
      "missing_consequence",
      "nested_suboptions",
      "undefined_code",
      "hidden_decision",
    ]) {
      expect(codes, `expected refusal code ${expected}`).toContain(expected);
    }
    for (const issue of issues) {
      expect(issue.path.length).toBeGreaterThan(0);
      expect(issue.message.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("names the offending codes and the glossary fix", () => {
    const validated = validateDecisionDossierDocument(clone(technocraticDossierFixture));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const issues = validateDecisionDossierReadability(validated.value).filter(
      (issue) => issue.code === "undefined_code",
    );
    const messages = issues.map((issue) => issue.message).join("\n");
    for (const code of ["L06b", "MH-L3", "R5"]) {
      expect(messages).toContain(code);
    }
    expect(messages).toContain("glossary");
  });

  it("limits hold: 2-minute questions, 2-4 options, short one-line options", () => {
    expect(READABILITY_LIMITS.maxQuestionReadingMinutes).toBe(2);
    expect(READABILITY_LIMITS.minOptionsPerQuestion).toBe(2);
    expect(READABILITY_LIMITS.maxOptionsPerQuestion).toBe(4);
  });
});

describe("readability gate accepts the accessible dossier", () => {
  it("the accessible dossier is structurally valid", () => {
    expect(validateDecisionDossierDocument(clone(accessibleDossierFixture)).ok).toBe(true);
  });

  it("passes the gate: quoted request, stakes, one question, defined code", () => {
    const validated = validateDecisionDossierDocument(clone(accessibleDossierFixture));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validateDecisionDossierReadability(validated.value)).toEqual([]);
  });

  it("presentation validation accepts the accessible dossier and refuses the technocratic one", () => {
    expect(validateDecisionDossierForPresentation(clone(accessibleDossierFixture)).ok).toBe(true);
    const refused = validateDecisionDossierForPresentation(clone(technocraticDossierFixture));
    expect(refused.ok).toBe(false);
  });
});

describe("no owner request blocks presentation explicitly", () => {
  it("an explicit no-owner-request flag blocks presentation even when the rest reads well", () => {
    const flagged = clone(accessibleDossierFixture) as {
      readability: Record<string, unknown>;
    };
    flagged.readability = {
      ...flagged.readability,
      ownerRequestQuote: undefined,
      noOwnerRequest: true,
    };
    const validated = validateDecisionDossierDocument(flagged);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const issues = validateDecisionDossierReadability(validated.value);
    expect(issues.some((issue) => issue.code === "presentation_blocked")).toBe(true);
    expect(
      validateDecisionDossierForPresentation(clone(accessibleDossierFixture)).ok,
    ).toBe(true);
  });

  it("a quote and the flag together refuse as conflicting", () => {
    const conflicted = clone(accessibleDossierFixture) as {
      readability: Record<string, unknown>;
    };
    conflicted.readability = {
      ...conflicted.readability,
      noOwnerRequest: true,
    };
    const validated = validateDecisionDossierDocument(conflicted);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(
      validateDecisionDossierReadability(validated.value).some(
        (issue) => issue.code === "conflicting_owner_request",
      ),
    ).toBe(true);
  });
});

// Mutations are made only to cloned in-memory fixtures; no owner state is read.
const mutate = (change: (doc: any) => void): DecisionDossierDocument => {
  const doc = clone(accessibleDossierFixture) as DecisionDossierDocument;
  change(doc);
  return doc;
};
const refusalCodes = (doc: DecisionDossierDocument): string[] =>
  validateDecisionDossierReadability(doc).map((issue) => issue.code);

describe("semantic diagram reading budget", () => {
  const withDiagram = () => mutate((d) => {
    d.readability.stakesLevel = "low";
    d.readability.readingBudgetMinutes = 2;
    d.sections[1].readingTimeMinutes = 0.8;
    d.sections.push({ kind: "diagram", id: "diagram", targetRef: "diagram", syntax: "mermaid", alt: "Workflow",
      source: 'flowchart LR\nnode["Clear name"]\n%% ' + "Invisible fallback syntax ".repeat(200),
      scene: { entities: { "entity:node": { attributes: { name: { kind: "text", value: "Clear name" } } } }, relations: {} },
    });
  });
  it("counts scene labels once and excludes fallback syntax and comments", () => {
    expect(refusalCodes(withDiagram())).toEqual([]);
  });
  it("still refuses excessive visible scene text", () => {
    const doc = withDiagram();
    (doc.sections.at(-1) as any).scene.entities["entity:node"].attributes.name.value = "Visible explanation ".repeat(200);
    expect(refusalCodes(doc)).toContain("reading_budget_exceeded");
  });
  it("still checks opaque codes in the fallback", () => {
    const doc = withDiagram();
    (doc.sections.at(-1) as any).source += "\n%% Apply MH-L3";
    expect(refusalCodes(doc)).toContain("undefined_code");
  });
});

describe("presentation cannot bypass the public readability gate", () => {
  it("exposes the gate through the published validation module", () => {
    expect(publicValidation).toHaveProperty("validateDecisionDossierForPresentation");
    expect(publicValidation).toHaveProperty("assertDecisionDossierForPresentation");
  });

  const surfaces = [
    { name: "terminal", render: renderTerminal },
    { name: "markdown", render: renderMd },
    { name: "html", render: (doc: DecisionDossierDocument) => renderHtml(doc, {
      renderMarkdown: (md) => md, sanitizeHtml: (html) => html,
    }) },
  ];
  it.each(surfaces)("$name blocks an unrequested dossier", ({ render }) => {
    const doc = mutate((d) => { d.readability.noOwnerRequest = true; delete d.readability.ownerRequestQuote; });
    expect(() => render(doc)).toThrow(/literal request/);
    expect(() => render(technocraticDossierFixture)).toThrow(/owner request/);
  });
  it.each(surfaces)("$name shows the information needed to decide", ({ render }) => {
    const text = render(accessibleDossierFixture);
    expect(text).toContain(accessibleDossierFixture.readability!.ownerRequestQuote!);
    expect(text).toContain(accessibleDossierFixture.readability!.stakes!);
    expect(text).toContain("Three spots are possible");
    expect(text).toContain("Short walk with the mower and nothing to see from the terrace.");
    expect(text).toContain("The city permit file number for this garden work.");
    expect(text).toMatch(/2 min/);
  });
  it.each(surfaces)("$name names the recommended option even when the reason does not", ({ render }) => {
    const doc = mutate((d) => { d.sections[1].recommendedAnswer = "This best protects your comfort and the terrace view."; });
    expect(render(doc)).toMatch(/préco: Along the side wall/);
  });
  it.each(surfaces)("$name groups linked options with their question regardless of source order", ({ render }) => {
    const doc = mutate((d) => {
      const question = { ...d.sections[1], id: "q-visit", targetRef: "q-visit", question: "When should we visit the possible spots?", recommendedOptionId: "visit-now" };
      const options = { ...d.sections[2], id: "visit-options", targetRef: "visit-options", questionId: "q-visit", options: [
        { ...d.sections[2].options[0], id: "visit-now", targetRef: "visit-now", label: "Visit this week" },
        { ...d.sections[2].options[1], id: "visit-later", targetRef: "visit-later", label: "Visit next week" },
      ] };
      d.readability.readingBudgetMinutes = 8;
      d.sections = [d.sections[0], d.sections[1], question, options, d.sections[2], d.sections[3]];
    });
    const before = JSON.stringify(doc);
    const text = render(doc);
    expect(text.indexOf("Back of the garden")).toBeLessThan(text.indexOf("When should we visit"));
    expect(text.match(/Back of the garden/g)).toHaveLength(1);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it("refuses before calling host rendering hooks", () => {
    const renderMarkdown = vi.fn((text: string) => text);
    const sanitizeHtml = vi.fn((text: string) => text);
    expect(() => renderHtml(technocraticDossierFixture, { renderMarkdown, sanitizeHtml })).toThrow();
    expect(renderMarkdown).not.toHaveBeenCalled();
    expect(sanitizeHtml).not.toHaveBeenCalled();
  });
});

describe("readability checks resist understated effort and hidden choices", () => {
  it.each([
    { name: "missing stakes level", change: (d: any) => { delete d.readability.stakesLevel; }, code: "missing_stakes_level" },
    { name: "low stakes with a long budget", change: (d: any) => { d.readability.stakesLevel = "low"; }, code: "reading_budget_disproportionate" },
    { name: "understated reading time", change: (d: any) => { d.sections[1].readingTimeMinutes = 0.01; }, code: "reading_time_underestimated" },
    { name: "long question", change: (d: any) => { d.sections[1].context = "A representative explanation takes time to read. ".repeat(70); }, code: "reading_time_underestimated" },
    { name: "unbudgeted shared prose", change: (d: any) => { d.sections[0].markdown = "More history to read. ".repeat(400); }, code: "reading_budget_exceeded" },
    { name: "missing recommendation target", change: (d: any) => { d.sections[1].recommendedOptionId = "absent"; }, code: "unknown_recommended_option" },
    { name: "hidden outcome", change: (d: any) => { delete d.sections[3].questionId; d.sections[3].statement = "Also enable telemetry by default."; }, code: "hidden_decision" },
    { name: "unknown outcome question", change: (d: any) => { d.sections[3].questionId = "absent"; }, code: "unknown_question_ref" },
    { name: "no explicit questions", change: (d: any) => { d.sections = [d.sections[0]]; d.interactions = []; }, code: "missing_question" },
    { name: "inline suboptions", change: (d: any) => { d.sections[2].options[0].body = "Choose (a) paint or (b) metal."; }, code: "nested_suboptions" },
    { name: "one nested bullet", change: (d: any) => { d.sections[2].options[0].body = "- Optional paid insulation"; }, code: "nested_suboptions" },
    { name: "nested consequence", change: (d: any) => { d.sections[2].options[0].consequence = "Choose either paint or metal."; }, code: "nested_suboptions" },
    { name: "CR line break", change: (d: any) => { d.sections[2].options[0].label = "Side wall\rWith fence"; }, code: "option_too_long" },
    { name: "more than two minutes", change: (d: any) => { d.sections[1].readingTimeMinutes = 3; }, code: "reading_time_exceeded" },
    { name: "invalid budget", change: (d: any) => { d.readability.readingBudgetMinutes = NaN; }, code: "reading_budget_out_of_range" },
    { name: "undefined acronym", change: (d: any) => { d.title += " with SSO"; }, code: "undefined_code" },
    { name: "undefined code in diagram", change: (d: any) => { d.sections.push({ kind: "diagram", id: "diagram", targetRef: "diagram", syntax: "mermaid", alt: "Workflow", source: "flowchart LR; MH-L3 --> R5" }); }, code: "undefined_code" },
    { name: "undefined code in amendment", change: (d: any) => { d.amendmentTrace.push({ at: "2026-10-17", author: "owner", summary: "Apply L06b" }); }, code: "undefined_code" },
    { name: "undefined acronym in glossary", change: (d: any) => { d.readability.glossary[0].definition = "The CI reference for permits."; }, code: "undefined_code" },
    { name: "undefined acronym in action", change: (d: any) => { d.interactions[0].label = "Approve CI"; }, code: "undefined_code" },
  ])("refuses $name", ({ change, code }) => {
    expect(refusalCodes(mutate(change))).toContain(code);
  });

  it("accepts explanatory comparisons linked to an explicit question", () => {
    const doc = mutate((d) => {
      d.sections[0].markdown = "En bref : choose the side wall rather than the terrace if the view matters most.";
      d.sections[0].questionId = "q-spot";
    });
    expect(refusalCodes(doc)).toEqual([]);
    expect(validateDecisionDossierDocument(doc).ok).toBe(true);
  });
  it("requires the same comparison to identify its question", () => {
    const doc = mutate((d) => { d.sections[0].markdown = "En bref : either the side wall or the terrace changes the view."; });
    expect(refusalCodes(doc)).toContain("hidden_decision");
  });
  it("accepts expanded acronyms and preserves the document without mutation", () => {
    const doc = mutate((d) => { d.title += " with SSO"; d.readability.glossary.push({ term: "SSO", definition: "Single sign on, so you need only one account." }); });
    const before = JSON.stringify(doc);
    expect(validateDecisionDossierForPresentation(doc).ok).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("published schema keeps additions optional", () => {
  it.each(["readingBudgetMinutes", "readingTimeMinutes"])("rejects non-finite %s at the structural boundary", (field) => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const doc = mutate((d) => {
        if (field === "readingBudgetMinutes") d.readability[field] = value;
        else d.sections[1][field] = value;
      });
      expect(validateDecisionDossierDocument(doc).ok).toBe(false);
    }
  });

  it("declares the same new fields as the runtime validator", () => {
    const schema = JSON.parse(readFileSync(new URL("../schemas/decision-dossier-document.v1.schema.json", import.meta.url), "utf8"));
    expect(schema.properties.readability).toEqual({ $ref: "#/$defs/readability" });
    expect(schema.required).not.toContain("readability");
    for (const [name, fields] of [
      ["questionNode", ["context", "readingTimeMinutes", "recommendedOptionId", "inputs", "completionCriterion"]],
      ["optionNode", ["consequence"]],
      ["optionSetNode", ["questionId"]],
      ["proseNode", ["questionId", "inputs", "completionCriterion"]],
      ["outcomeNode", ["questionId"]],
    ] as const) {
      for (const field of fields) {
        expect(schema.$defs[name].properties).toHaveProperty(field);
        expect(schema.$defs[name].required).not.toContain(field);
      }
    }
  });
});

// Independent-review regressions: titles, opaque codes and compact decision lines.
describe("reviewed presentation boundaries", () => {
  it.each(["title", "subject"])("requires a short non-empty single-line %s", (field) => {
    for (const text of ["", "   ", "Garden\nshed location", "Garden\rshed location", "Garden\u2028shed", "Garden\u2029shed", "x".repeat(101)]) {
      const doc = mutate((d) => { d[field] = text; });
      const result = validateDecisionDossierForPresentation(doc);
      expect(result.ok, JSON.stringify(text)).toBe(false);
      if (!result.ok) expect(result.issues.some((issue) => issue.path === "$." + field)).toBe(true);
    }
  });
  it.each(["L06B", "M1L1", "R5A", "H2A", "S3B"])("refuses unexpanded %s", (code) => {
    expect(refusalCodes(mutate((d) => { d.sections[1].context += " Ratify " + code; }))).toContain("undefined_code");
  });
  it("accepts an alphanumeric code explained independently in plain words", () => {
    const doc = mutate((d) => {
      d.sections[1].context += " Permit L06B covers both spots.";
      d.readability.glossary.push({ term: "L06B", definition: "The city permit for the garden shed." });
    });
    expect(validateDecisionDossierForPresentation(doc).ok).toBe(true);
  });
  it.each([
    [{ term: "L06b", definition: "The L06b migration." }],
    [{ term: "L06b", definition: "The L06b migration under MH-L3" }, { term: "MH-L3", definition: "Parent of L06b" }],
    [{ term: "L06b", definition: "MH-L3" }, { term: "MH-L3", definition: "The migration to a new server." }],
  ])("requires glossary definitions in plain words: %j", (...entries) => {
    const doc = mutate((d) => { d.readability.glossary.push(...entries); });
    expect(refusalCodes(doc)).toContain("invalid_glossary_entry");
  });
  it.each(["question", "recommendedAnswer", "title"])("keeps %s on one short line without subchoices", (field) => {
    for (const text of ["First\nsecond", "First\rsecond", "First\u2028second", "First\u2029second", "Choose (a) today (b) later", "- Optional paid work", "x".repeat(field === "title" ? 101 : 301)]) {
      const doc = mutate((d) => { d.sections[field === "title" ? 2 : 1][field] = text; });
      expect(validateDecisionDossierForPresentation(doc).ok, text).toBe(false);
    }
  });
  it.each([
    { name: "terminal", render: renderTerminal }, { name: "markdown", render: renderMd },
    { name: "html", render: (doc: DecisionDossierDocument) => renderHtml(doc, { renderMarkdown: (s) => s, sanitizeHtml: (s) => s }) },
  ])("$name names an already named recommendation once", ({ render }) => {
    const doc = mutate((d) => { d.sections[1].recommendedAnswer = "Along the side wall, because it keeps the view clear."; });
    const text = render(doc);
    expect(text).toContain("préco: Along the side wall, because it keeps the view clear.");
    expect(text).not.toContain("Along the side wall — Along the side wall");
  });
});
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';

it('should include evidence summaries in the primary code and reading gate', () => {
  const doc = evidenceFixture();
  doc.evidenceGroups[0].summary = 'Opaque L06b condition';
  expect(validateDecisionDossierReadability(doc).some(i => i.code === 'undefined_code')).toBe(true);
  doc.evidenceGroups[0].summary = 'support '.repeat(2000);
  expect(validateDecisionDossierReadability(doc).some(i => i.code === 'reading_budget_exceeded')).toBe(true);
});

it('should check supporting explanations while keeping raw source volume outside the primary budget', () => {
  const doc = evidenceFixture(20_000, 31);
  expect(validateDecisionDossierReadability(doc)).toEqual([]);
  doc.annexes[0].blocks[0].text = 'Undefined L06b';
  expect(validateDecisionDossierReadability(doc).some(i => i.code === 'undefined_code')).toBe(true);
});

describe("1.1.0 / 2.1.0 readability extensions & 11/11 anti-wall-of-text rules (A8, A16–A20)", () => {
  it("A8 & A16: reference diagram (source undefined), inputs[].label and completionCriterion do not crash, scan for undefined_code, and count in shared and per-question reading budgets", () => {
    const doc = mutate((d) => {
      d.sections[0].inputs = [{ ref: "spec-s0", kind: "artifact", label: "Validated garden sketch" }];
      d.sections[0].completionCriterion = "Spot approved and staked on site.";
      d.sections[1].inputs = [{ ref: "quote-q1", kind: "artifact", label: "Builder quote ready" }];
      d.sections[1].completionCriterion = "Spot confirmed with the builder.";
      d.sections.push({
        kind: "diagram",
        id: "diag-ref",
        targetRef: "diag-ref",
        alt: "Garden layout diagram.",
        sourceRef: "engram:diag-lot-map",
        renderComponent: "GanttChart",
      });
    });
    expect(refusalCodes(doc)).toEqual([]);

    // Opaque code in inputs[0].label or completionCriterion -> undefined_code
    const withCodeInInput = mutate((d) => {
      d.sections[0].inputs = [{ ref: "spec-s0", kind: "artifact", label: "Apply L06b sketch" }];
    });
    expect(refusalCodes(withCodeInInput)).toContain("undefined_code");

    const withCodeInCriterion = mutate((d) => {
      d.sections[1].completionCriterion = "Validated under MH-L3.";
    });
    expect(refusalCodes(withCodeInCriterion)).toContain("undefined_code");

    // Per-question readingTimeMinutes accounts for question inputs[].label and completionCriterion
    const understatedQuestion = mutate((d) => {
      d.sections[1].readingTimeMinutes = 0.25;
      d.sections[1].inputs = [
        { ref: "i-a", kind: "artifact", label: "First long prerequisite document for the garden shed spot" },
        { ref: "i-b", kind: "artifact", label: "Second long prerequisite document for the garden shed spot" },
      ];
      d.sections[1].completionCriterion =
        "The chosen garden shed location is staked on the ground and confirmed with the neighbour before work begins.";
    });
    expect(refusalCodes(understatedQuestion)).toContain("reading_time_underestimated");
  });

  it("A17: prose/question cell or block exceeding 60 words, input label >12 words, or completionCriterion >1 sentence/>22 words refuses", () => {
    const longParagraph =
      "En bref : we need a clear spot in the garden today. " +
      "The shed should stay close to the back door for daily tools. ".repeat(5);
    const doc = mutate((d) => {
      d.sections[0].markdown = longParagraph;
    });
    const codes = refusalCodes(doc);
    expect(
      codes.includes("block_combined_max_60_words") || codes.includes("cell_max_60_words"),
    ).toBe(true);

    const longInputLabel = mutate((d) => {
      d.sections[0].inputs = [
        {
          ref: "spec-s0",
          kind: "artifact",
          label: "One two three four five six seven eight nine ten eleven twelve thirteen words",
        },
      ];
    });
    expect(refusalCodes(longInputLabel)).toContain("input_label_too_long");

    const twoSentenceCriterion = mutate((d) => {
      d.sections[0].completionCriterion = "First sentence is short. Second sentence is forbidden.";
    });
    expect(refusalCodes(twoSentenceCriterion)).toContain("completion_criterion_too_long");
  });

  it("A18a: sentence of 25 words refuses with sentence_max_22_words", () => {
    const doc = mutate((d) => {
      d.sections[0].markdown =
        "En bref : this single sentence deliberately contains twenty five plain words so that the readability validator refuses it for exceeding the twenty two word sentence limit.";
    });
    expect(refusalCodes(doc)).toContain("sentence_max_22_words");
  });

  it("A18b: sentence with semicolon, parentheses, two colons, or inline enumeration refuses with one_idea_per_sentence_* / no_enumeration_in_prose_sentence", () => {
    const semiDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : the side wall is close; the back corner is far.";
    });
    expect(refusalCodes(semiDoc)).toContain("one_idea_per_sentence_no_semicolon");

    const parenDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : the side wall stays convenient (near the gate) all year.";
    });
    expect(refusalCodes(parenDoc)).toContain("one_idea_per_sentence_no_parentheses");

    const colonDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : spot choice: side wall: best compromise.";
    });
    expect(refusalCodes(colonDoc)).toContain("one_idea_per_sentence_max_one_colon");

    const enumDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : verify the roof, the door, the floor, the paint.";
    });
    expect(refusalCodes(enumDoc)).toContain("no_enumeration_in_prose_sentence");
  });

  it("A19: prose containing a ULID, SHA hash, internal lot/AC ID, or raw digit count refuses even when listed in glossary, while ownerRequestQuote and structured refs stay exempt", () => {
    const ulidDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : tracked under 01KM92J996B2938P895G3N3K3R in the backlog.";
    });
    expect(refusalCodes(ulidDoc)).toContain("no_ulid_in_prose");

    const shaDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : commit a3f9c02d changed the shed roof plan.";
    });
    expect(refusalCodes(shaDoc)).toContain("no_hash_or_sha_in_prose");

    const lotDoc = mutate((d) => {
      d.readability.glossary.push({ term: "WP1", definition: "The first work package." });
      d.sections[0].markdown = "En bref : this work belongs to WP1 in the plan.";
    });
    expect(refusalCodes(lotDoc)).toContain("no_internal_id_or_lot_code_in_prose");

    const countDoc = mutate((d) => {
      d.sections[0].markdown = "En bref : we compared 12 fichiers before choosing the wall.";
    });
    expect(refusalCodes(countDoc)).toContain("no_raw_count_or_number_in_prose");

    // ownerRequestQuote and structured refs (inputs[].ref, targetRef, sourceRef) are exempt
    const quoteExemptDoc = mutate((d) => {
      d.readability.ownerRequestQuote =
        "Please fix WP1 (12 fichiers; commit a3f9c02d / 01KM92J996B2938P895G3N3K3R).";
      d.sections[0].inputs = [{ ref: "engram:01KM92J996B2938P895G3N3K3R", kind: "engram", label: "Owner note" }];
      d.sections.push({
        kind: "diagram",
        id: "diag-ref",
        targetRef: "WP1-a3f9c02d",
        alt: "Garden plan.",
        sourceRef: "engram:01KM92J996B2938P895G3N3K3R",
        renderComponent: "GanttChart",
      });
    });
    expect(refusalCodes(quoteExemptDoc)).toEqual([]);
  });

  it("A20: multi-sentence block lacking an 'En bref :' / 'In short:' takeaway first refuses with missing_en_bref_takeaway", () => {
    const noTakeaway = mutate((d) => {
      d.sections[0].markdown =
        "The new shed needs a dry level base before winter. Both garden corners stay dry all year.";
    });
    expect(refusalCodes(noTakeaway)).toContain("missing_en_bref_takeaway");
  });
});
