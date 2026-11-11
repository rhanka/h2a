/**
 * Schema specs for the DecisionDossierDocument (R4, contract §4.2).
 *
 * The published asset is schemas/decision-dossier-document.v1.schema.json
 * (schema ID urn:sentropic:focus:DecisionDossierDocument:1.0.0); the runtime
 * enforcement is the typed validator in src/validation/index.ts. This file
 * proves structural parity (every model family, closed negatives) and
 * semantic parity (unique IDs, resolvable targets, verbatim evidence).
 */

import { createRequire } from "node:module";
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evidenceFixture } from '../../h2a/focus-kit/test/evidence-fixtures.mjs';

import { describe, expect, it } from "vitest";

import type { DecisionDossierDocument } from "../src/model.js";
import {
  DOSSIER_SCHEMA_ID,
  DOSSIER_SCHEMA_VERSION,
  DOSSIER_V1_1_SCHEMA_ID,
  DOSSIER_V2_1_SCHEMA_ID,
  DOSSIER_V2_SCHEMA_ID,
  validateDecisionDossierDocument,
} from "../src/validation/index.js";
import { decisionDossierFixture } from "./fixture.data.js";

const require = createRequire(import.meta.url);
const schemaDoc = require("../schemas/decision-dossier-document.v1.schema.json") as {
  $schema: string;
  $id: string;
  title: string;
};

const clone = (doc: DecisionDossierDocument): unknown =>
  JSON.parse(JSON.stringify(doc)) as unknown;

describe('evidence schema version boundary', () => {
  const Ajv2020 = require('ajv/dist/2020.js');
  const validateSchema = new Ajv2020({ strict: false }).compile(require('../schemas/decision-dossier-document.v2.schema.json'));
  it.each(['image/png', 'image/jpeg'])('should require image metadata in both validators for %s', mediaType => {
    const image = evidenceFixture().sources[1];
    image.mediaType = mediaType;
    // A minimal JPEG SOF frame is sufficient for the runtime metadata contract.
    if (mediaType === 'image/jpeg') {
      const bytes = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0]);
      image.data = bytes.toString('base64'); image.size = bytes.length;
      image.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    const doc = evidenceFixture(); doc.sources[1] = image;
    expect(validateSchema(doc), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateDecisionDossierDocument(doc).ok).toBe(true);
    for (const fields of [['width'], ['height'], ['alt'], ['width', 'height', 'alt']]) {
      const invalid = structuredClone(doc);
      for (const field of fields) delete invalid.sources[1][field];
      expect(validateDecisionDossierDocument(invalid).ok).toBe(false);
      expect(validateSchema(invalid), `Missing image metadata: ${fields.join(', ')}`).toBe(false);
    }
  });
  it('should reject image metadata on text in both validators', () => {
    for (const [field, value] of [['width', 1], ['height', 1], ['alt', 'Text is not an image']]) {
      const doc = evidenceFixture(); doc.sources[0][field] = value;
      expect(validateDecisionDossierDocument(doc).ok).toBe(false);
      expect(validateSchema(doc), `Text with image metadata: ${field}`).toBe(false);
    }
  });
  it('should ship a separate closed v2 schema while preserving the original v1.0 and v2.0 bytes', () => {
    const v2 = require('../schemas/decision-dossier-document.v2.schema.json');
    expect(v2.$id).toBe('urn:sentropic:focus:DecisionDossierDocument:2.1.0');
    expect(v2.properties.schemaVersion.const).toBe(2);
    expect(v2.additionalProperties).toBe(false);
    expect(v2.required).toEqual(expect.arrayContaining(['sources','citations','annexes','evidenceGroups','schemaVersion']));
    expect(createHash('sha256').update(readFileSync(new URL('../schemas/decision-dossier-document.v1.0.schema.json', import.meta.url))).digest('hex'))
      .toBe('725bc07e7c6b6ad51a1f720cc9fb02649d8f31bc54e71c61c350fd20058c8852');
    expect(createHash('sha256').update(readFileSync(new URL('../schemas/decision-dossier-document.v2.0.schema.json', import.meta.url))).digest('hex'))
      .toBe('1a8059e5264785cd15c74b7fcfc04cbe42c575203b4232af43819e094846f5a9');
    expect(createHash('sha256').update(readFileSync(new URL('../schemas/decision-dossier-document.v1.schema.json', import.meta.url))).digest('hex'))
      .toBe('f4b5247f025e99081c20fd9a8b0ed98b32a061c4a98597010be0264e5e564c6c');
  });
  it('should reject new evidence through the frozen old validator rather than dropping it', async () => {
    const old = await import('./fixtures/validator.v1.mjs');
    expect(old.validateDecisionDossierDocument(evidenceFixture()).ok).toBe(false);
  });
});

describe("DecisionDossierDocument schema asset identity", () => {
  it("publishes the stable schema IDs under draft 2020-12", () => {
    expect(DOSSIER_SCHEMA_ID).toBe(
      "urn:sentropic:focus:DecisionDossierDocument:1.0.0",
    );
    expect(DOSSIER_SCHEMA_VERSION).toBe("1.0.0");
    expect(DOSSIER_V2_SCHEMA_ID).toBe(
      "urn:sentropic:focus:DecisionDossierDocument:2.0.0",
    );
    expect(DOSSIER_V1_1_SCHEMA_ID).toBe(
      "urn:sentropic:focus:DecisionDossierDocument:1.1.0",
    );
    expect(DOSSIER_V2_1_SCHEMA_ID).toBe(
      "urn:sentropic:focus:DecisionDossierDocument:2.1.0",
    );
    expect(schemaDoc.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(schemaDoc.$id).toBe(DOSSIER_V1_1_SCHEMA_ID);
  });
});

const allFamiliesFixture = (): DecisionDossierDocument => ({
  ref: "decision:parity",
  subject: "parity",
  title: "Parity across every node family",
  hash: "sha256:parity",
  cursor: "count:7",
  sections: [
    { kind: "prose", id: "s-prose", targetRef: "s-prose", markdown: "# Hi" },
    {
      kind: "question",
      id: "s-question",
      targetRef: "s-question",
      question: "Ship it?",
      recommendedAnswer: "Yes.",
      answer: "Yes.",
      state: "validated",
    },
    {
      kind: "question",
      id: "s-open",
      targetRef: "s-open",
      question: "When?",
      state: "open",
    },
    {
      kind: "question",
      id: "s-answered",
      targetRef: "s-answered",
      question: "Who?",
      answer: "Owner.",
      state: "answered",
    },
    {
      kind: "optionSet",
      id: "s-options",
      targetRef: "s-options",
      title: "Options",
      options: [
        {
          kind: "option",
          id: "opt-a",
          targetRef: "opt-a",
          label: "A",
          body: "pros: fast",
          annotation: "accept",
          annotationComment: "Go.",
        },
        {
          kind: "option",
          id: "opt-b",
          targetRef: "opt-b",
          label: "B",
          annotation: "reject",
        },
        {
          kind: "option",
          id: "opt-c",
          targetRef: "opt-c",
          label: "C",
          annotation: "comment",
          annotationComment: "Later.",
        },
        {
          kind: "option",
          id: "opt-d",
          targetRef: "opt-d",
          label: "D",
          annotation: "none",
        },
      ],
    },
    {
      kind: "optionSet",
      id: "s-untitled-options",
      targetRef: "s-untitled-options",
      options: [],
    },
    {
      kind: "outcome",
      id: "s-outcome",
      targetRef: "s-outcome",
      modality: "amendment",
      statement: "Amend the plan.",
    },
    {
      kind: "outcome",
      id: "s-outcome-2",
      targetRef: "s-outcome-2",
      modality: "orientation",
      statement: "Head north.",
    },
    {
      kind: "outcome",
      id: "s-outcome-3",
      targetRef: "s-outcome-3",
      modality: "comment",
      statement: "Noted.",
    },
    {
      kind: "amendmentTrace",
      id: "s-trace",
      targetRef: "s-trace",
      steps: [{ at: "2026-01-01T00:00:00Z", author: "owner", summary: "Init." }],
    },
    {
      kind: "diagram",
      id: "s-diagram",
      targetRef: "s-diagram",
      syntax: "plantuml",
      source: "@startuml\nA -> B\n@enduml",
      alt: "A to B.",
    },
  ],
  interactions: [
    { name: "discuss", targetRef: "opt-c", label: "Discuss C", enabled: false },
    { name: "ratify", targetRef: "s-outcome", label: "Ratify", enabled: false },
  ],
  provenance: {
    source: "track:.track/events.jsonl",
    readAt: "2026-06-21T12:00:00.000Z",
    comprehensionEvidence: {
      subject: "architect",
      dossierHash: "sha256:parity",
      signature: "sig:abc",
    },
  },
  amendmentTrace: [
    { at: "2026-01-01T00:00:00Z", author: "owner", summary: "Init." },
  ],
});

describe("schema accepts the actual model (R4-AC03)", () => {
  it("preserves an optional opaque diagram-core SemanticDocument without a private DS dependency", () => {
    const doc = clone(allFamiliesFixture());
    const diagram = doc.sections.find(s => s.kind === "diagram")!;
    const scene = require("./diagram-core-generic.fixture.json");
    Object.assign(diagram, { scene });
    const result = validateDecisionDossierDocument(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(doc);
    for (const invalid of [null, [], "document", 42]) {
      Object.assign(diagram, { scene: invalid });
      expect(validateDecisionDossierDocument(doc).ok).toBe(false);
    }
  });
  it("every fixture validates and round-trips unchanged", () => {
    for (const doc of [decisionDossierFixture, allFamiliesFixture()]) {
      const result = validateDecisionDossierDocument(clone(doc));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(
        JSON.parse(JSON.stringify(doc)),
      );
    }
  });

  it("accepted empty and optional-field behavior matches the model", () => {
    const minimal: DecisionDossierDocument = {
      ref: "decision:minimal",
      subject: "minimal",
      title: "Minimal",
      hash: "h",
      cursor: "c",
      sections: [],
      interactions: [],
      provenance: { source: "fixture", readAt: "2026-01-01T00:00:00Z" },
      amendmentTrace: [],
    };
    expect(validateDecisionDossierDocument(clone(minimal)).ok).toBe(true);
  });
});

describe("closed runtime-schema negatives (R4-AC04)", () => {
  it("unknown field refuses with a field-path diagnostic and leaves input unmutated", () => {
    const mutated = clone(decisionDossierFixture) as Record<string, unknown>;
    (mutated.sections as Record<string, unknown>[])[0]!["surprise"] = 1;
    const before = JSON.stringify(mutated);
    const result = validateDecisionDossierDocument(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.path.includes("sections[0]")),
    ).toBe(true);
    expect(JSON.stringify(mutated)).toBe(before);
  });

  it("unknown section discriminator refuses alone", () => {
    const mutated = clone(decisionDossierFixture) as {
      sections: Array<Record<string, unknown>>;
    };
    mutated.sections[0]!["kind"] = "gallery";
    const result = validateDecisionDossierDocument(mutated);
    expect(result.ok).toBe(false);
  });

  it("a top-level option node refuses alone (options nest only in optionSet)", () => {
    const mutated = clone(decisionDossierFixture) as {
      sections: unknown[];
    };
    mutated.sections.push({
      kind: "option",
      id: "stray",
      targetRef: "stray",
      label: "Stray",
      annotation: "none",
    });
    expect(validateDecisionDossierDocument(mutated).ok).toBe(false);
  });

  it("an enabled snapshot interaction refuses alone", () => {
    const mutated = clone(decisionDossierFixture) as {
      interactions: Array<Record<string, unknown>>;
    };
    mutated.interactions[0]!["enabled"] = true;
    const result = validateDecisionDossierDocument(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.path.includes("interactions[0]")),
    ).toBe(true);
  });
});

describe("semantic validation (R4-AC05, R4-AC06)", () => {
  it("duplicate IDs refuse while root and nested targets resolve", () => {
    expect(
      validateDecisionDossierDocument(clone(decisionDossierFixture)).ok,
    ).toBe(true);
    const mutated = clone(allFamiliesFixture()) as {
      sections: Array<{ id: string }>;
    };
    mutated.sections[1]!.id = "s-prose";
    const result = validateDecisionDossierDocument(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "duplicate_id")).toBe(
      true,
    );
  });

  it("an interaction targeting nothing resolvable refuses alone", () => {
    const mutated = clone(allFamiliesFixture()) as {
      interactions: Array<{ targetRef: string }>;
    };
    mutated.interactions[0]!.targetRef = "ghost:nowhere";
    const result = validateDecisionDossierDocument(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.code === "unresolved_target"),
    ).toBe(true);
  });
});

describe("published JSON Schema parity with the TS validator (rev352-F3)", () => {
  const defsOf = (doc: unknown): Record<string, Record<string, unknown>> =>
    (doc as Record<string, unknown>)["$defs"] as Record<string, Record<string, unknown>>;

  const propsOf = (doc: unknown, defName: string): Record<string, Record<string, unknown>> =>
    defsOf(doc)[defName]!["properties"] as Record<string, Record<string, unknown>>;

  const checkClosedObjectDef = (
    doc: unknown,
    name: string,
    required: readonly string[] | undefined,
    properties: readonly string[],
  ): void => {
    const def = defsOf(doc)[name];
    expect(def, `$defs.${name} exists`).toBeDefined();
    expect(def["type"]).toBe("object");
    expect(def["additionalProperties"]).toBe(false);
    expect(def["required"]).toEqual(required === undefined ? undefined : [...required]);
    expect(Object.keys(def["properties"] as Record<string, unknown>).sort()).toEqual(
      [...properties].sort(),
    );
  };

  const checkEnum = (doc: unknown, defName: string, field: string, values: readonly string[]): void => {
    expect(propsOf(doc, defName)[field], `${defName}.${field} exists`).toBeDefined();
    expect(propsOf(doc, defName)[field]!["enum"]).toEqual([...values]);
  };

  const checkParity = (doc: unknown): void => {
    const schema = doc as Record<string, unknown>;
    expect(schema["type"]).toBe("object");
    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toEqual([
      "ref", "subject", "title", "hash", "cursor",
      "sections", "interactions", "provenance", "amendmentTrace",
    ]);
    expect(Object.keys(defsOf(doc)).sort()).toEqual(
      ["amendmentStep", "amendmentTraceNode", "comprehensionEvidence", "diagramNode", "glossaryEntry", "interaction", "optionNode", "optionSetNode", "outcomeNode", "proseNode", "provenance", "questionNode", "readability", "section", "sectionInput"],
    );
    expect(defsOf(doc)["section"]!["oneOf"]).toEqual([
      { $ref: "#/$defs/proseNode" },
      { $ref: "#/$defs/questionNode" },
      { $ref: "#/$defs/optionSetNode" },
      { $ref: "#/$defs/outcomeNode" },
      { $ref: "#/$defs/amendmentTraceNode" },
      { $ref: "#/$defs/diagramNode" },
    ]);

    const rootProps = (schema["properties"] as Record<string, Record<string, unknown>>);
    expect(rootProps["ref"]).toEqual({ type: "string" });
    expect(rootProps["subject"]).toEqual({ type: "string" });
    expect(rootProps["title"]).toEqual({ type: "string" });
    expect(rootProps["hash"]).toEqual({ type: "string" });
    expect(rootProps["cursor"]).toEqual({ type: "string" });
    expect(rootProps["sections"]).toEqual({ type: "array", items: { $ref: "#/$defs/section" } });
    expect(rootProps["interactions"]).toEqual({ type: "array", items: { $ref: "#/$defs/interaction" } });
    expect(rootProps["provenance"]).toEqual({ $ref: "#/$defs/provenance" });
    expect(rootProps["amendmentTrace"]).toEqual({ type: "array", items: { $ref: "#/$defs/amendmentStep" } });

    checkClosedObjectDef(doc, "sectionInput", ["ref", "kind"], ["ref", "kind", "label"]);
    expect(propsOf(doc, "sectionInput")["ref"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });
    expect(propsOf(doc, "sectionInput")["kind"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });
    expect(propsOf(doc, "sectionInput")["label"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });

    checkClosedObjectDef(doc, "proseNode", ["kind", "id", "targetRef", "markdown"], ["kind", "id", "targetRef", "markdown", "questionId", "inputs", "completionCriterion"]);
    expect(propsOf(doc, "proseNode")["kind"]).toEqual({ const: "prose" });
    expect(propsOf(doc, "proseNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "proseNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "proseNode")["markdown"]).toEqual({ type: "string" });
    expect(propsOf(doc, "proseNode")["inputs"]).toEqual({ type: "array", items: { $ref: "#/$defs/sectionInput" } });
    expect(propsOf(doc, "proseNode")["completionCriterion"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });
    expect(propsOf(doc, "questionNode")["kind"]).toEqual({ const: "question" });
    expect(propsOf(doc, "questionNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["question"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["recommendedAnswer"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["answer"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["inputs"]).toEqual({ type: "array", items: { $ref: "#/$defs/sectionInput" } });
    expect(propsOf(doc, "questionNode")["completionCriterion"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });
    expect(propsOf(doc, "optionNode")["kind"]).toEqual({ const: "option" });
    expect(propsOf(doc, "optionNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionNode")["label"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionNode")["body"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionNode")["annotationComment"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionSetNode")["kind"]).toEqual({ const: "optionSet" });
    expect(propsOf(doc, "optionSetNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionSetNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "optionSetNode")["title"]).toEqual({ type: "string" });
    expect(propsOf(doc, "outcomeNode")["kind"]).toEqual({ const: "outcome" });
    expect(propsOf(doc, "outcomeNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "outcomeNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "outcomeNode")["statement"]).toEqual({ type: "string" });
    expect(propsOf(doc, "amendmentTraceNode")["kind"]).toEqual({ const: "amendmentTrace" });
    expect(propsOf(doc, "amendmentTraceNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "amendmentTraceNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "amendmentTraceNode")["steps"]).toEqual({
      type: "array",
      items: { $ref: "#/$defs/amendmentStep" },
    });
    expect(propsOf(doc, "diagramNode")["kind"]).toEqual({ const: "diagram" });
    expect(propsOf(doc, "diagramNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "diagramNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "diagramNode")["source"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });
    expect(propsOf(doc, "diagramNode")["alt"]).toEqual({ type: "string", pattern: "^[\\s\\S]*\\S[\\s\\S]*$" });
    expect(propsOf(doc, "diagramNode")["scene"]).toMatchObject({ type: "object" });
    expect(propsOf(doc, "diagramNode")["sourceRef"]).toEqual({ type: "string", pattern: "^[A-Za-z][A-Za-z0-9+.-]*:\\S+$" });
    expect(propsOf(doc, "diagramNode")["renderComponent"]).toEqual({ type: "string", pattern: "^[A-Za-z][A-Za-z0-9-]*$" });
    expect(defsOf(doc)["diagramNode"]!["allOf"]).toHaveLength(6);
    expect(propsOf(doc, "interaction")["name"]).toEqual({ type: "string" });
    expect(propsOf(doc, "interaction")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "interaction")["label"]).toEqual({ type: "string" });
    expect(propsOf(doc, "comprehensionEvidence")["subject"]).toEqual({ type: "string" });
    expect(propsOf(doc, "comprehensionEvidence")["dossierHash"]).toEqual({ type: "string" });
    expect(propsOf(doc, "comprehensionEvidence")["signature"]).toEqual({ type: "string" });
    expect(propsOf(doc, "provenance")["source"]).toEqual({ type: "string" });
    expect(propsOf(doc, "provenance")["readAt"]).toEqual({ type: "string" });
    expect(propsOf(doc, "amendmentStep")["at"]).toEqual({ type: "string" });
    expect(propsOf(doc, "amendmentStep")["author"]).toEqual({ type: "string" });
    expect(propsOf(doc, "amendmentStep")["summary"]).toEqual({ type: "string" });
    checkClosedObjectDef(doc, "questionNode", ["kind", "id", "targetRef", "question", "state"], ["kind", "id", "targetRef", "question", "recommendedAnswer", "answer", "state", "context", "readingTimeMinutes", "recommendedOptionId", "inputs", "completionCriterion"]);
    checkClosedObjectDef(doc, "optionNode", ["kind", "id", "targetRef", "label", "annotation"], ["kind", "id", "targetRef", "label", "body", "annotation", "annotationComment", "consequence"]);
    checkClosedObjectDef(doc, "optionSetNode", ["kind", "id", "targetRef", "options"], ["kind", "id", "targetRef", "title", "options", "questionId"]);
    expect(propsOf(doc, "optionSetNode")["options"]).toEqual({
      type: "array",
      items: { $ref: "#/$defs/optionNode" },
    });
    checkClosedObjectDef(doc, "outcomeNode", ["kind", "id", "targetRef", "modality", "statement"], ["kind", "id", "targetRef", "modality", "statement", "questionId"]);
    checkClosedObjectDef(doc, "amendmentTraceNode", ["kind", "id", "targetRef", "steps"], ["kind", "id", "targetRef", "steps"]);
    checkClosedObjectDef(doc, "diagramNode", ["kind", "id", "targetRef", "alt"], ["kind", "id", "targetRef", "syntax", "source", "alt", "scene", "sourceRef", "renderComponent"]);
    checkClosedObjectDef(doc, "interaction", ["name", "targetRef", "label", "enabled"], ["name", "targetRef", "label", "enabled"]);
    expect(propsOf(doc, "interaction")["enabled"]).toEqual({ const: false });
    checkClosedObjectDef(doc, "comprehensionEvidence", ["subject", "dossierHash"], ["subject", "dossierHash", "signature"]);
    checkClosedObjectDef(doc, "provenance", ["source", "readAt"], ["source", "readAt", "comprehensionEvidence"]);
    expect(propsOf(doc, "provenance")["comprehensionEvidence"]).toEqual({
      $ref: "#/$defs/comprehensionEvidence",
    });
    checkClosedObjectDef(doc, "amendmentStep", ["at", "author", "summary"], ["at", "author", "summary"]);

    checkClosedObjectDef(doc, "readability", undefined, ["ownerRequestQuote", "noOwnerRequest", "stakes", "stakesLevel", "readingBudgetMinutes", "glossary"]);
    checkClosedObjectDef(doc, "glossaryEntry", ["term", "definition"], ["term", "definition"]);
    for (const field of ["ownerRequestQuote", "stakes"]) expect(propsOf(doc, "readability")[field]).toEqual({ type: "string" });
    expect(propsOf(doc, "readability")["noOwnerRequest"]).toEqual({ type: "boolean" });
    expect(propsOf(doc, "readability")["readingBudgetMinutes"]).toEqual({ type: "number" });
    expect(propsOf(doc, "readability")["glossary"]).toEqual({ type: "array", items: { $ref: "#/$defs/glossaryEntry" } });
    for (const field of ["term", "definition"]) expect(propsOf(doc, "glossaryEntry")[field]).toEqual({ type: "string" });
    checkEnum(doc, "readability", "stakesLevel", ["low", "medium", "high"]);
    checkEnum(doc, "questionNode", "state", ["open", "answered", "validated"]);
    checkEnum(doc, "optionNode", "annotation", ["none", "accept", "reject", "comment"]);
    checkEnum(doc, "outcomeNode", "modality", ["decision", "orientation", "amendment", "comment"]);
    checkEnum(doc, "diagramNode", "syntax", ["mermaid", "plantuml"]);
  };

  it("published asset matches the validator contract", () => {
    checkParity(schemaDoc);
  });

  interface SchemaDrift {
    readonly name: string;
    readonly mutate: (doc: Record<string, unknown>) => void;
  }

  const drifts: readonly SchemaDrift[] = [
    ...["readability", "glossaryEntry"].flatMap((name) => [
      { name: "opened " + name, mutate: (doc: Record<string, unknown>) => { defsOf(doc)[name]!["additionalProperties"] = true; } },
      { name: "changed required " + name, mutate: (doc: Record<string, unknown>) => { defsOf(doc)[name]!["required"] = ["invented"]; } },
      { name: "added property " + name, mutate: (doc: Record<string, unknown>) => { propsOf(doc, name)["invented"] = { type: "string" }; } },
    ]),
    { name: "changed stakes enum", mutate: (doc) => { propsOf(doc, "readability")["stakesLevel"]!["enum"] = ["low"]; } },
    { name: "changed glossary definition type", mutate: (doc) => { propsOf(doc, "glossaryEntry")["definition"] = { type: "number" }; } },
    { name: "changed reading budget type", mutate: (doc) => { propsOf(doc, "readability")["readingBudgetMinutes"] = { type: "string" }; } },
    { name: "retargeted glossary entries", mutate: (doc) => { propsOf(doc, "readability")["glossary"] = { type: "array", items: { $ref: "#/$defs/interaction" } }; } },
    {
      name: "narrowed question state enum",
      mutate: (doc) => { propsOf(doc, "questionNode")["state"]!["enum"] = ["open"]; },
    },
    {
      name: "dropped question state required",
      mutate: (doc) => {
        defsOf(doc)["questionNode"]!["required"] = ["kind", "id", "targetRef", "question"];
      },
    },
    {
      name: "opened proseNode",
      mutate: (doc) => { defsOf(doc)["proseNode"]!["additionalProperties"] = true; },
    },
    {
      name: "relaxed interaction enabled",
      mutate: (doc) => { propsOf(doc, "interaction")["enabled"]!["const"] = true; },
    },
    {
      name: "root sections retargeted to interaction",
      mutate: (doc) => {
        ((doc as Record<string, unknown>)["properties"] as Record<string, unknown>)["sections"] = {
          type: "array",
          items: { $ref: "#/$defs/interaction" },
        };
      },
    },
    {
      name: "question kind constant drifted",
      mutate: (doc) => { propsOf(doc, "questionNode")["kind"] = { const: "query" }; },
    },
    {
      name: "outcome kind constant drifted",
      mutate: (doc) => { propsOf(doc, "outcomeNode")["kind"] = { const: "result" }; },
    },
    {
      name: "diagram kind freed",
      mutate: (doc) => { propsOf(doc, "diagramNode")["kind"] = { type: "string" }; },
    },
    {
      name: "prose markdown typed as number",
      mutate: (doc) => { propsOf(doc, "proseNode")["markdown"] = { type: "number" }; },
    },
    {
      name: "trace steps retargeted to interaction",
      mutate: (doc) => {
        propsOf(doc, "amendmentTraceNode")["steps"] = {
          type: "array",
          items: { $ref: "#/$defs/interaction" },
        };
      },
    },
    {
      name: "provenance readAt typed as integer",
      mutate: (doc) => { propsOf(doc, "provenance")["readAt"] = { type: "integer" }; },
    },
    {
      name: "evidence signature typed as boolean",
      mutate: (doc) => { propsOf(doc, "comprehensionEvidence")["signature"] = { type: "boolean" }; },
    },
  ];

  it.each(drifts)("$name breaks parity while the old identity test stays green", ({ mutate }) => {
    const drifted = JSON.parse(JSON.stringify(schemaDoc)) as Record<string, unknown>;
    mutate(drifted);
    expect(() => checkParity(drifted)).toThrow();
    expect(drifted["$id"]).toBe(schemaDoc.$id);
    expect(drifted["$schema"]).toBe(schemaDoc.$schema);
  });

  interface DossierEnumMutant {
    readonly name: string;
    readonly mutate: (doc: Record<string, unknown>) => void;
  }

  // allFamiliesFixture sections: 0 prose, 1 question, 4 optionSet, 6 outcome, 10 diagram.
  const enumMutants: readonly DossierEnumMutant[] = [
    {
      name: "question state",
      mutate: (doc) => { ((doc["sections"] as Array<Record<string, unknown>>)[1]!)["state"] = "draft"; },
    },
    {
      name: "option annotation",
      mutate: (doc) => {
        (((doc["sections"] as Array<Record<string, unknown>>)[4]!)["options"] as Array<Record<string, unknown>>)[0]!["annotation"] = "maybe";
      },
    },
    {
      name: "outcome modality",
      mutate: (doc) => { ((doc["sections"] as Array<Record<string, unknown>>)[6]!)["modality"] = "verdict"; },
    },
    {
      name: "diagram syntax",
      mutate: (doc) => { ((doc["sections"] as Array<Record<string, unknown>>)[10]!)["syntax"] = "dot"; },
    },
  ];

  it.each(enumMutants)("$name refuses with invalid_enum", ({ mutate }) => {
    const doc = clone(allFamiliesFixture()) as unknown as Record<string, unknown>;
    mutate(doc);
    const result = validateDecisionDossierDocument(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "invalid_enum")).toBe(true);
  });
});

describe("provenance source and interaction targets (rev352-F5)", () => {
  it("empty and blank provenance sources validate: the published schema binds any string", () => {
    for (const source of ["", "   "]) {
      const mutated = clone(decisionDossierFixture) as {
        provenance: { source: string };
      };
      mutated.provenance.source = source;
      expect(validateDecisionDossierDocument(mutated).ok).toBe(true);
    }
  });

  it("the dossier ref itself resolves as an interaction target (whole-dossier amend)", () => {
    expect(decisionDossierFixture.interactions[1]!.targetRef).toBe(
      decisionDossierFixture.ref,
    );
    expect(validateDecisionDossierDocument(clone(decisionDossierFixture)).ok).toBe(true);
  });

  it("a section id distinct from its targetRef resolves as an interaction target", () => {
    const doc = clone(allFamiliesFixture()) as {
      sections: Array<{ id: string }>;
      interactions: Array<{ targetRef: string }>;
    };
    doc.sections[0]!.id = "renamed-prose";
    doc.interactions[0]!.targetRef = "renamed-prose";
    expect(validateDecisionDossierDocument(doc).ok).toBe(true);
  });
});

describe("semantic validation (R4-AC05, R4-AC06, continued)", () => {
  it("evidence attester is preserved verbatim; forged evidence refuses", () => {
    const result = validateDecisionDossierDocument(
      clone(decisionDossierFixture),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance.comprehensionEvidence?.subject).toBe(
      "Focus-M1 L1 render-core packaging",
    );
    expect(result.value.provenance.comprehensionEvidence?.signature).toBe(
      "sig:deadbeef",
    );
    expect(result.value.amendmentTrace).toEqual(
      decisionDossierFixture.amendmentTrace,
    );
    const forged = clone(decisionDossierFixture) as {
      provenance: { comprehensionEvidence: { dossierHash: string } };
    };
    forged.provenance.comprehensionEvidence.dossierHash = "sha256:forged";
    const forgedResult = validateDecisionDossierDocument(forged);
    expect(forgedResult.ok).toBe(false);
    if (forgedResult.ok) return;
    expect(
       forgedResult.issues.some(
        (issue) => issue.code === "evidence_mismatch",
      ),
    ).toBe(true);
  });
});

describe("1.1.0 / 2.1.0 diagram reference mode, inputs[] and completionCriterion (A1–A3, A6–A7, A10–A15)", () => {
  const Ajv2020 = require("ajv/dist/2020.js");
  const ajvV1 = new Ajv2020({ strict: false }).compile(schemaDoc);
  const ajvV2 = new Ajv2020({ strict: false }).compile(
    require("../schemas/decision-dossier-document.v2.schema.json"),
  );

  it("A1: inline diagram (syntax + source) remains valid on v1.1 and v2.1", () => {
    const v1Doc = clone(allFamiliesFixture());
    expect(ajvV1(v1Doc)).toBe(true);
    expect(validateDecisionDossierDocument(v1Doc).ok).toBe(true);
    const v2Doc = evidenceFixture();
    expect(ajvV2(v2Doc)).toBe(true);
    expect(validateDecisionDossierDocument(v2Doc).ok).toBe(true);
  });

  it("A2: reference diagram (sourceRef + renderComponent, without syntax/source/scene) validates on v1.1", () => {
    for (const sourceRef of ["engram:roadmap-layout-engine-gantt", "ENGRAM:x", "Engram:x"]) {
      const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      const idx = doc.sections.findIndex((s) => s.kind === "diagram");
      doc.sections[idx] = {
        kind: "diagram",
        id: "s-diagram",
        targetRef: "s-diagram",
        alt: "Architecture des lots.",
        sourceRef,
        renderComponent: "GanttChart",
      };
      expect(ajvV1(doc), JSON.stringify(ajvV1.errors)).toBe(true);
      const res = validateDecisionDossierDocument(doc);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toEqual(doc);
    }
  });

  it("A3: reference diagram (sourceRef + renderComponent) validates on v2.1", () => {
    const doc = evidenceFixture();
    doc.sections.push({
      kind: "diagram",
      id: "s-diagram-ref",
      targetRef: "s-diagram-ref",
      alt: "Architecture des lots.",
      sourceRef: "engram:roadmap-layout-engine-gantt",
      renderComponent: "GanttChart",
    });
    expect(ajvV2(doc), JSON.stringify(ajvV2.errors)).toBe(true);
    const res = validateDecisionDossierDocument(doc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(doc);
  });

  it("A6 & A7: prose and question accept inputs[] and completionCriterion on v1.1 and v2.1", () => {
    const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
    doc.sections[0]!["inputs"] = [
      { ref: "spec-s0", kind: "artifact", label: "Cadrage validé" },
      { ref: "engram:audit-n3", kind: "engram" },
    ];
    doc.sections[0]!["completionCriterion"] = "Décision tranchée et signée";
    doc.sections[1]!["inputs"] = [
      { ref: "bench-q1", kind: "benchmark", label: "Mesures latence" },
    ];
    doc.sections[1]!["completionCriterion"] = "Option retenue par le propriétaire";
    expect(ajvV1(doc), JSON.stringify(ajvV1.errors)).toBe(true);
    const res = validateDecisionDossierDocument(doc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(doc);

    const v2 = evidenceFixture();
    v2.sections[0].inputs = [{ ref: "spec-s0", kind: "artifact", label: "Cadrage validé" }];
    v2.sections[0].completionCriterion = "Décision tranchée et signée";
    const q = v2.sections.find((s: { kind: string }) => s.kind === "question");
    q.inputs = [{ ref: "bench-q1", kind: "benchmark", label: "Mesures latence" }];
    q.completionCriterion = "Option retenue par le propriétaire";
    expect(ajvV2(v2), JSON.stringify(ajvV2.errors)).toBe(true);
    const resV2 = validateDecisionDossierDocument(v2);
    expect(resV2.ok).toBe(true);
  });

  it("A10: diagram with neither source nor sourceRef refuses with diagram_source_missing and fails JSON Schema", () => {
    const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
    const idx = doc.sections.findIndex((s) => s.kind === "diagram");
    doc.sections[idx] = {
      kind: "diagram",
      id: "s-diagram",
      targetRef: "s-diagram",
      alt: "Orphan diagram.",
    };
    expect(ajvV1(doc)).toBe(false);
    const res = validateDecisionDossierDocument(doc);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.some((i) => i.code === "diagram_source_missing")).toBe(true);
    }
  });

  it("A11: diagram mixing inline and reference fields, missing syntax/source/alt, or missing renderComponent refuses in both runtime and JSON Schema", () => {
    const makeWithDiagram = (diagram: Record<string, unknown>) => {
      const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      const idx = doc.sections.findIndex((s) => s.kind === "diagram");
      doc.sections[idx] = { kind: "diagram", id: "s-diagram", targetRef: "s-diagram", alt: "Alt.", ...diagram };
      return doc;
    };
    const makeV2WithDiagram = (diagram: Record<string, unknown>) => {
      const doc = evidenceFixture();
      const idx = doc.sections.findIndex((s: { kind: string }) => s.kind === "diagram");
      doc.sections[idx] = { kind: "diagram", id: "s-diagram", targetRef: "s-diagram", alt: "Alt.", ...diagram };
      return doc;
    };

    // Both source and sourceRef -> diagram_source_conflict
    const both = makeWithDiagram({
      syntax: "mermaid",
      source: "flowchart LR\nA-->B",
      sourceRef: "engram:diag-lot-map",
      renderComponent: "GanttChart",
    });
    expect(ajvV1(both)).toBe(false);
    expect(ajvV2(makeV2WithDiagram({
      syntax: "mermaid",
      source: "flowchart LR\nA-->B",
      sourceRef: "engram:diag-lot-map",
      renderComponent: "GanttChart",
    }))).toBe(false);
    const resBoth = validateDecisionDossierDocument(both);
    expect(resBoth.ok).toBe(false);
    if (!resBoth.ok) expect(resBoth.issues.some((i) => i.code === "diagram_source_conflict")).toBe(true);

    // source without syntax -> diagram_source_conflict on .syntax (A2)
    const missingSyntax = makeWithDiagram({ source: "flowchart LR\nA-->B" });
    expect(ajvV1(missingSyntax)).toBe(false);
    expect(ajvV2(makeV2WithDiagram({ source: "flowchart LR\nA-->B" }))).toBe(false);
    const resMissingSyntax = validateDecisionDossierDocument(missingSyntax);
    expect(resMissingSyntax.ok).toBe(false);
    if (!resMissingSyntax.ok) {
      expect(
        resMissingSyntax.issues.some(
          (i) => i.code === "diagram_source_conflict" && i.path.endsWith(".syntax"),
        ),
      ).toBe(true);
    }

    // syntax without source (and without sourceRef) -> diagram_source_missing + diagram_source_conflict (A2)
    const syntaxWithoutSource = makeWithDiagram({ syntax: "mermaid" });
    expect(ajvV1(syntaxWithoutSource)).toBe(false);
    expect(ajvV2(makeV2WithDiagram({ syntax: "mermaid" }))).toBe(false);
    const resSyntaxWithoutSource = validateDecisionDossierDocument(syntaxWithoutSource);
    expect(resSyntaxWithoutSource.ok).toBe(false);
    if (!resSyntaxWithoutSource.ok) {
      expect(resSyntaxWithoutSource.issues.some((i) => i.code === "diagram_source_missing")).toBe(true);
      expect(resSyntaxWithoutSource.issues.some((i) => i.code === "diagram_source_conflict")).toBe(true);
    }

    // missing alt on inline or reference diagram -> missing_field on .alt (A2)
    for (const noAltDiagram of [
      { kind: "diagram", id: "s-diagram", targetRef: "s-diagram", syntax: "mermaid", source: "flowchart LR\nA-->B" },
      { kind: "diagram", id: "s-diagram", targetRef: "s-diagram", sourceRef: "engram:diag-lot-map", renderComponent: "GanttChart" },
    ]) {
      const v1NoAlt = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      const idx1 = v1NoAlt.sections.findIndex((s) => s.kind === "diagram");
      v1NoAlt.sections[idx1] = noAltDiagram;
      expect(ajvV1(v1NoAlt)).toBe(false);
      const v2NoAlt = evidenceFixture();
      const idx2 = v2NoAlt.sections.findIndex((s: { kind: string }) => s.kind === "diagram");
      v2NoAlt.sections[idx2] = noAltDiagram;
      expect(ajvV2(v2NoAlt)).toBe(false);
      const resNoAlt = validateDecisionDossierDocument(v1NoAlt);
      expect(resNoAlt.ok).toBe(false);
      if (!resNoAlt.ok) {
        expect(resNoAlt.issues.some((i) => i.code === "missing_field" && i.path.endsWith(".alt"))).toBe(true);
      }
    }

    // sourceRef without renderComponent -> diagram_source_conflict
    const missingComp = makeWithDiagram({ sourceRef: "engram:diag-lot-map" });
    expect(ajvV1(missingComp)).toBe(false);
    expect(ajvV2(makeV2WithDiagram({ sourceRef: "engram:diag-lot-map" }))).toBe(false);
    const resMissingComp = validateDecisionDossierDocument(missingComp);
    expect(resMissingComp.ok).toBe(false);
    if (!resMissingComp.ok) expect(resMissingComp.issues.some((i) => i.code === "diagram_source_conflict" && i.path.endsWith(".renderComponent"))).toBe(true);

    // renderComponent without sourceRef (on inline diagram) -> diagram_source_conflict
    const extraComp = makeWithDiagram({
      syntax: "mermaid",
      source: "flowchart LR\nA-->B",
      renderComponent: "GanttChart",
    });
    expect(ajvV1(extraComp)).toBe(false);
    expect(ajvV2(makeV2WithDiagram({
      syntax: "mermaid",
      source: "flowchart LR\nA-->B",
      renderComponent: "GanttChart",
    }))).toBe(false);
    const resExtraComp = validateDecisionDossierDocument(extraComp);
    expect(resExtraComp.ok).toBe(false);
    if (!resExtraComp.ok) expect(resExtraComp.issues.some((i) => i.code === "diagram_source_conflict" && i.path.endsWith(".renderComponent"))).toBe(true);

    // sourceRef with syntax or scene -> diagram_source_conflict
    for (const conflict of [
      { sourceRef: "engram:diag-lot-map", renderComponent: "GanttChart", syntax: "mermaid" },
      { sourceRef: "engram:diag-lot-map", renderComponent: "GanttChart", scene: { documentId: "doc:1" } },
    ]) {
      const doc = makeWithDiagram(conflict);
      expect(ajvV1(doc)).toBe(false);
      expect(ajvV2(makeV2WithDiagram(conflict))).toBe(false);
      const res = validateDecisionDossierDocument(doc);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.some((i) => i.code === "diagram_source_conflict")).toBe(true);
    }
  });

  it("A12: optionSet, outcome, amendmentTrace and diagram refuse inputs and completionCriterion with unknown_field", () => {
    for (const kind of ["optionSet", "outcome", "amendmentTrace", "diagram"] as const) {
      for (const [field, value] of [
        ["inputs", [{ ref: "r1", kind: "artifact", label: "Label" }]],
        ["completionCriterion", "Done"],
      ] as const) {
        const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
        const target = doc.sections.find((s) => s.kind === kind)!;
        target[field] = value;
        expect(ajvV1(doc)).toBe(false);
        const res = validateDecisionDossierDocument(doc);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.issues.some((i) => i.code === "unknown_field")).toBe(true);
      }
    }
  });

  it("A13 & A14: inputs[].ref/kind required, non-blank ref/kind/label, and duplicate_input_ref within node or across linked prose<->question (not shared targetRef)", () => {
    // missing kind -> missing_field
    const missingKind = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
    missingKind.sections[0]!["inputs"] = [{ ref: "r1", label: "Label" }];
    expect(ajvV1(missingKind)).toBe(false);
    const resKind = validateDecisionDossierDocument(missingKind);
    expect(resKind.ok).toBe(false);
    if (!resKind.ok) expect(resKind.issues.some((i) => i.code === "missing_field" && i.path.endsWith(".kind"))).toBe(true);

    // blank ref, kind, or label -> invalid_type
    for (const badInput of [
      { ref: "", kind: "artifact", label: "Valid" },
      { ref: "   ", kind: "artifact", label: "Valid" },
      { ref: "r1", kind: "", label: "Valid" },
      { ref: "r1", kind: "   ", label: "Valid" },
      { ref: "r1", kind: "artifact", label: "" },
      { ref: "r1", kind: "artifact", label: "  \t " },
    ]) {
      const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      doc.sections[0]!["inputs"] = [badInput];
      expect(ajvV1(doc)).toBe(false);
      const res = validateDecisionDossierDocument(doc);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.some((i) => i.code === "invalid_type")).toBe(true);
    }

    // duplicate ref in same node -> duplicate_input_ref
    const sameNodeDup = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
    sameNodeDup.sections[0]!["inputs"] = [
      { ref: "dup-ref", kind: "artifact", label: "First" },
      { ref: "dup-ref", kind: "artifact", label: "Second" },
    ];
    const resSame = validateDecisionDossierDocument(sameNodeDup);
    expect(resSame.ok).toBe(false);
    if (!resSame.ok) expect(resSame.issues.some((i) => i.code === "duplicate_input_ref")).toBe(true);

    // duplicate ref across prose and question linked by prose.questionId === question.id -> duplicate_input_ref
    const crossNodeDup = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
    crossNodeDup.sections[0]!["questionId"] = "s-question";
    crossNodeDup.sections[0]!["inputs"] = [{ ref: "shared-ref", kind: "artifact", label: "In prose" }];
    crossNodeDup.sections[1]!["inputs"] = [{ ref: "shared-ref", kind: "artifact", label: "In question" }];
    const resCross = validateDecisionDossierDocument(crossNodeDup);
    expect(resCross.ok).toBe(false);
    if (!resCross.ok) expect(resCross.issues.some((i) => i.code === "duplicate_input_ref")).toBe(true);

    // A14: prose and question sharing only targetRef (without prose.questionId === question.id) do NOT trigger duplicate_input_ref
    const unlinkedSharedTarget = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
    unlinkedSharedTarget.sections[0]!["targetRef"] = "shared-target";
    unlinkedSharedTarget.sections[0]!["inputs"] = [{ ref: "shared-ref", kind: "artifact", label: "In prose" }];
    unlinkedSharedTarget.sections[1]!["targetRef"] = "shared-target";
    unlinkedSharedTarget.sections[1]!["inputs"] = [{ ref: "shared-ref", kind: "artifact", label: "In question" }];
    expect(validateDecisionDossierDocument(unlinkedSharedTarget).ok).toBe(true);
  });

  it("A14b: blank completionCriterion, diagram.alt, or diagram.source refuses with invalid_type in both runtime and JSON Schema (A6, A12)", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      doc.sections[0]!["completionCriterion"] = blank;
      expect(ajvV1(doc)).toBe(false);
      const v2 = evidenceFixture();
      v2.sections[0].completionCriterion = blank;
      expect(ajvV2(v2)).toBe(false);
      const res = validateDecisionDossierDocument(doc);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.some((i) => i.code === "invalid_type" && i.path.endsWith(".completionCriterion"))).toBe(true);

      // blank diagram.alt on inline and reference diagrams
      for (const baseDiagram of [
        { kind: "diagram", id: "s-diagram", targetRef: "s-diagram", syntax: "mermaid", source: "flowchart LR\nA-->B", alt: blank },
        { kind: "diagram", id: "s-diagram", targetRef: "s-diagram", sourceRef: "engram:diag-lot-map", renderComponent: "GanttChart", alt: blank },
      ]) {
        const v1Alt = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
        const idx1 = v1Alt.sections.findIndex((s) => s.kind === "diagram");
        v1Alt.sections[idx1] = baseDiagram;
        expect(ajvV1(v1Alt)).toBe(false);
        const v2Alt = evidenceFixture();
        const idx2 = v2Alt.sections.findIndex((s: { kind: string }) => s.kind === "diagram");
        v2Alt.sections[idx2] = baseDiagram;
        expect(ajvV2(v2Alt)).toBe(false);
        const resAlt = validateDecisionDossierDocument(v1Alt);
        expect(resAlt.ok).toBe(false);
        if (!resAlt.ok) {
          expect(resAlt.issues.some((i) => i.code === "invalid_type" && i.path.endsWith(".alt"))).toBe(true);
        }
      }

      // blank diagram.source on inline diagram
      const v1Source = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      const idxSrc1 = v1Source.sections.findIndex((s) => s.kind === "diagram");
      v1Source.sections[idxSrc1] = {
        kind: "diagram",
        id: "s-diagram",
        targetRef: "s-diagram",
        syntax: "mermaid",
        source: blank,
        alt: "Valid alt.",
      };
      expect(ajvV1(v1Source)).toBe(false);
      const v2Source = evidenceFixture();
      const idxSrc2 = v2Source.sections.findIndex((s: { kind: string }) => s.kind === "diagram");
      v2Source.sections[idxSrc2] = {
        kind: "diagram",
        id: "s-diagram",
        targetRef: "s-diagram",
        syntax: "mermaid",
        source: blank,
        alt: "Valid alt.",
      };
      expect(ajvV2(v2Source)).toBe(false);
      const resSource = validateDecisionDossierDocument(v1Source);
      expect(resSource.ok).toBe(false);
      if (!resSource.ok) {
        expect(resSource.issues.some((i) => i.code === "invalid_type" && i.path.endsWith(".source"))).toBe(true);
      }
    }
  });

  it("A15: invalid renderComponent or sourceRef pattern refuses with invalid_type in both runtime and JSON Schema", () => {
    for (const badComp of ["123Bad", "Diagram_Flow", "", "   ", "-LeadingDash"]) {
      const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      const idx = doc.sections.findIndex((s) => s.kind === "diagram");
      doc.sections[idx] = {
        kind: "diagram",
        id: "s-diagram",
        targetRef: "s-diagram",
        alt: "Alt",
        sourceRef: "engram:diag-lot-map",
        renderComponent: badComp,
      };
      expect(ajvV1(doc)).toBe(false);
      const res = validateDecisionDossierDocument(doc);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.some((i) => i.code === "invalid_type" && i.path.endsWith(".renderComponent"))).toBe(true);
    }

    for (const badRef of ["diag-lot-map", "engram:has spaces", "", "   ", "1bad:ref", "engram:"]) {
      const doc = clone(allFamiliesFixture()) as { sections: Array<Record<string, unknown>> };
      const idx = doc.sections.findIndex((s) => s.kind === "diagram");
      doc.sections[idx] = {
        kind: "diagram",
        id: "s-diagram",
        targetRef: "s-diagram",
        alt: "Alt",
        sourceRef: badRef,
        renderComponent: "GanttChart",
      };
      expect(ajvV1(doc)).toBe(false);
      const res = validateDecisionDossierDocument(doc);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.some((i) => i.code === "invalid_type" && i.path.endsWith(".sourceRef"))).toBe(true);
    }
  });
});
