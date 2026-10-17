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

import { describe, expect, it } from "vitest";

import type { DecisionDossierDocument } from "../src/model.js";
import {
  DOSSIER_SCHEMA_ID,
  DOSSIER_SCHEMA_VERSION,
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

describe("DecisionDossierDocument schema asset identity", () => {
  it("publishes the stable schema ID under draft 2020-12", () => {
    expect(DOSSIER_SCHEMA_ID).toBe(
      "urn:sentropic:focus:DecisionDossierDocument:1.0.0",
    );
    expect(DOSSIER_SCHEMA_VERSION).toBe("1.0.0");
    expect(schemaDoc.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(schemaDoc.$id).toBe(DOSSIER_SCHEMA_ID);
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
    required: readonly string[],
    properties: readonly string[],
  ): void => {
    const def = defsOf(doc)[name];
    expect(def, `$defs.${name} exists`).toBeDefined();
    expect(def["type"]).toBe("object");
    expect(def["additionalProperties"]).toBe(false);
    expect(def["required"]).toEqual([...required]);
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
      ["amendmentStep", "amendmentTraceNode", "comprehensionEvidence", "diagramNode", "glossaryEntry", "interaction", "optionNode", "optionSetNode", "outcomeNode", "proseNode", "provenance", "questionNode", "readability", "section"],
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

    checkClosedObjectDef(doc, "proseNode", ["kind", "id", "targetRef", "markdown"], ["kind", "id", "targetRef", "markdown", "questionId"]);
    expect(propsOf(doc, "proseNode")["kind"]).toEqual({ const: "prose" });
    expect(propsOf(doc, "proseNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "proseNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "proseNode")["markdown"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["kind"]).toEqual({ const: "question" });
    expect(propsOf(doc, "questionNode")["id"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["targetRef"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["question"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["recommendedAnswer"]).toEqual({ type: "string" });
    expect(propsOf(doc, "questionNode")["answer"]).toEqual({ type: "string" });
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
    expect(propsOf(doc, "diagramNode")["source"]).toEqual({ type: "string" });
    expect(propsOf(doc, "diagramNode")["alt"]).toEqual({ type: "string" });
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
    checkClosedObjectDef(doc, "questionNode", ["kind", "id", "targetRef", "question", "state"], ["kind", "id", "targetRef", "question", "recommendedAnswer", "answer", "state", "context", "readingTimeMinutes", "recommendedOptionId"]);
    checkClosedObjectDef(doc, "optionNode", ["kind", "id", "targetRef", "label", "annotation"], ["kind", "id", "targetRef", "label", "body", "annotation", "annotationComment", "consequence"]);
    checkClosedObjectDef(doc, "optionSetNode", ["kind", "id", "targetRef", "options"], ["kind", "id", "targetRef", "title", "options", "questionId"]);
    expect(propsOf(doc, "optionSetNode")["options"]).toEqual({
      type: "array",
      items: { $ref: "#/$defs/optionNode" },
    });
    checkClosedObjectDef(doc, "outcomeNode", ["kind", "id", "targetRef", "modality", "statement"], ["kind", "id", "targetRef", "modality", "statement", "questionId"]);
    checkClosedObjectDef(doc, "amendmentTraceNode", ["kind", "id", "targetRef", "steps"], ["kind", "id", "targetRef", "steps"]);
    checkClosedObjectDef(doc, "diagramNode", ["kind", "id", "targetRef", "syntax", "source", "alt"], ["kind", "id", "targetRef", "syntax", "source", "alt"]);
    checkClosedObjectDef(doc, "interaction", ["name", "targetRef", "label", "enabled"], ["name", "targetRef", "label", "enabled"]);
    expect(propsOf(doc, "interaction")["enabled"]).toEqual({ const: false });
    checkClosedObjectDef(doc, "comprehensionEvidence", ["subject", "dossierHash"], ["subject", "dossierHash", "signature"]);
    checkClosedObjectDef(doc, "provenance", ["source", "readAt"], ["source", "readAt", "comprehensionEvidence"]);
    expect(propsOf(doc, "provenance")["comprehensionEvidence"]).toEqual({
      $ref: "#/$defs/comprehensionEvidence",
    });
    checkClosedObjectDef(doc, "amendmentStep", ["at", "author", "summary"], ["at", "author", "summary"]);

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
