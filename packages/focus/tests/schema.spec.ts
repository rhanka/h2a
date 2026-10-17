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
