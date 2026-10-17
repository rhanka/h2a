import type { DecisionDossierDocument } from "../src/model.js";

const baseProvenance = (hash: string) => ({
  source: "fixture",
  readAt: "2026-10-14T12:00:00Z",
  comprehensionEvidence: {
    subject: "readability",
    dossierHash: hash,
    signature: "sig:readability",
  },
});

/** Structurally valid but technocratic: opaque codes, no owner trace, no stakes. */
export const technocraticDossierFixture: DecisionDossierDocument = {
  ref: "decision:technocratic",
  subject: "L06b rollout under MH-L3",
  title: "Ratify the R5 migration for CI-4821",
  hash: "sha256:technocratic",
  cursor: "v1",
  sections: [
    {
      kind: "prose",
      id: "ctx",
      targetRef: "ctx",
      markdown:
        "The L06b component must converge with MH-L3 before R5. Either we migrate everything now or we keep the legacy path running.",
    },
    {
      kind: "question",
      id: "q-migrate",
      targetRef: "q-migrate",
      question: "Should we apply the L06b plan?",
      state: "open",
    },
    {
      kind: "optionSet",
      id: "opts-migrate",
      targetRef: "opts-migrate",
      questionId: "q-migrate",
      title: "L06b variants",
      options: [
        {
          kind: "option",
          id: "opt-a",
          targetRef: "opt-a",
          label: "Full L06b cutover",
          body: "Cut over in one go.",
          annotation: "none",
        },
        {
          kind: "option",
          id: "opt-b",
          targetRef: "opt-b",
          label: "Phased L06b cutover",
          annotation: "none",
        },
        {
          kind: "option",
          id: "opt-c",
          targetRef: "opt-c",
          label: "Keep legacy",
          annotation: "none",
        },
        {
          kind: "option",
          id: "opt-d",
          targetRef: "opt-d",
          label: "Hybrid path",
          annotation: "none",
        },
        {
          kind: "option",
          id: "opt-e",
          targetRef: "opt-e",
          label: "Defer to next cycle",
          body: "Either (a) defer the L06b scope, (b) split it per team:\n- team one takes the core\n- team two takes the edge\nOr (c) drop it.",
          annotation: "none",
        },
      ],
    },
    {
      kind: "optionSet",
      id: "opts-shadow",
      targetRef: "opts-shadow",
      title: "Shadow choices",
      options: [
        {
          kind: "option",
          id: "opt-shadow",
          targetRef: "opt-shadow",
          label: "Quietly switch the default",
          body: "Flip it without asking.",
          annotation: "none",
        },
      ],
    },
    {
      kind: "outcome",
      id: "decision:technocratic:outcome",
      targetRef: "decision:technocratic:outcome",
      modality: "decision",
      statement: "Apply the L06b plan under MH-L3.",
    },
  ],
  interactions: [
    {
      name: "ratifyOutcome",
      targetRef: "decision:technocratic:outcome",
      label: "Ratify the decision",
      enabled: false,
    },
  ],
  provenance: baseProvenance("sha256:technocratic"),
  amendmentTrace: [],
};

/** Accessible: quoted owner request, plain stakes, one 2-minute question, glossary. */
export const accessibleDossierFixture: DecisionDossierDocument = {
  ref: "decision:garden-shed",
  subject: "Where to put the garden shed",
  title: "Where should we put the garden shed so it stays handy without spoiling the view?",
  hash: "sha256:accessible",
  cursor: "v1",
  readability: {
    ownerRequestQuote:
      "Tell me where to put the shed: I want it handy for the mower but I do not want to see it from the terrace.",
    stakes:
      "A wrong spot means carrying the mower across the garden every week and looking at a metal box from the terrace for years.",
    stakesLevel: "medium",
    readingBudgetMinutes: 4,
    glossary: [
      {
        term: "CI-4821",
        definition: "The city permit file number for this garden work.",
      },
    ],
  },
  sections: [
    {
      kind: "prose",
      id: "ctx",
      targetRef: "ctx",
      markdown:
        "You asked where to put the shed. The terrace view matters to you, and the mower must stay easy to reach. Permit file CI-4821 already covers all three spots below.",
    },
    {
      kind: "question",
      id: "q-spot",
      targetRef: "q-spot",
      question: "Which spot should we approve for the shed?",
      context:
        "Three spots are possible: each one trades walking distance against what you see from the terrace. The permit covers all three, so only your comfort decides.",
      recommendedAnswer: "The side wall: short walk, hidden from the terrace.",
      recommendedOptionId: "opt-side",
      state: "open",
      readingTimeMinutes: 2,
    },
    {
      kind: "optionSet",
      id: "opts-spot",
      targetRef: "opts-spot",
      questionId: "q-spot",
      title: "Possible spots",
      options: [
        {
          kind: "option",
          id: "opt-side",
          targetRef: "opt-side",
          label: "Along the side wall",
          body: "Two steps from the gate, hidden by the hedge.",
          consequence: "Short walk with the mower and nothing to see from the terrace.",
          annotation: "none",
        },
        {
          kind: "option",
          id: "opt-back",
          targetRef: "opt-back",
          label: "Back of the garden",
          consequence: "Invisible from the house but a long walk with the mower.",
          annotation: "none",
        },
        {
          kind: "option",
          id: "opt-terrace",
          targetRef: "opt-terrace",
          label: "Next to the terrace",
          consequence: "No walking at all but the shed fills the terrace view.",
          annotation: "none",
        },
      ],
    },
    {
      kind: "outcome",
      id: "decision:garden-shed:outcome",
      targetRef: "decision:garden-shed:outcome",
      modality: "decision",
      statement: "Approve one shed spot; the side wall is recommended.",
      questionId: "q-spot",
    },
  ],
  interactions: [
    {
      name: "ratifyOutcome",
      targetRef: "decision:garden-shed:outcome",
      label: "Ratify the decision",
      enabled: false,
    },
  ],
  provenance: baseProvenance("sha256:accessible"),
  amendmentTrace: [],
};

