# Report mode — short specification

Focus can present an informational report without asking the reader to decide.
The first intended consumer is the detection benchmark v12: retain its tables,
light and dark chart assets, glossary, sources, citations and appendices without
inventing a question or recommendation.

## Contract

- A report declares `kind: "report"` and `schemaVersion: 2`. Its schema is
  `urn:sentropic:focus:ReportDocument:1.0.0`, exported as
  `@sentropic/focus/schemas/report-document.v1`. The version of this new document
  family is independent of the reused evidence envelope version.
- The registry appends this schema. All four existing decision schema files,
  IDs and digests stay frozen. Absence of `kind` retains decision behaviour;
  unknown kinds refuse. Reports permit prose, diagrams and history, with empty
  interactions. Questions, option sets, outcomes and `questionId` refuse.
- `validateFocusDocument` / `validateFocusForPresentation` dispatch explicitly.
  Existing `validateDecisionDossier*` / `assertDecisionDossier*` APIs remain
  decision-only, including the mandatory question at presentation time.
- Reports start with an “En bref :” (or “In short:”) prose summary. All source
  integrity, citation, glossary, owner traceability and 11/11 readability gates
  remain active. Reports always use strict readability, even with historical
  fixture identifiers. The implicit-choice wording guard remains active too;
  describe observations without introducing alternatives for the reader.
- Reading time is the existing shared-text sum at 180 words/minute: prose,
  chart labels, glossary and evidence/appendix summaries, with no question time.
  Raw source bytes and appendix blocks keep their separate consultation budget.

## Presentation and build

`h2a focus build report.json -o report.html` uses the explicit document kind;
there is no bypass flag. Reports do not need the decision-specific ecosystem
flowchart: chart images can be embedded sources with image citations. Existing
diagram syntax and layout checks still apply whenever a diagram is supplied.
The portable App labels the document “Rapport”, renders escaped Markdown table
cells, and offers no question count, recommendation or selection prompt. Both
themes, source consultation/download and appendix tables remain available.
Core HTML, Markdown and terminal exports retain appendix block contents and the
source/citation index. Image inspection and original-byte downloads remain the
portable HTML renderer's responsibility, as for evidence dossiers.

`packages/focus/tests/fixtures/benchmark-report.json` is a synthetic regression
fixture with a table, two labelled chart placeholders, glossary, citations and
an appendix. It does not reproduce or attest the benchmark PDF's measurements.
Converting that PDF requires its actual contents; no benchmark data is invented.

## Decision-only boundary

Consumers that admit only decision dossiers keep their existing schema allowlist
and `assertDecisionDossierForPresentation` gate. That API rejects `kind: "report"`
as an unknown field. Report acceptance requires an explicit choice of the generic
dispatcher and report schema; updating the validator or renderer does not enable it.

Generated schemas, validator and renderer are refreshed by
`node scripts/build-focus-dossier.mjs`; the Track vendor is refreshed by
`npm run vendor:focus`. Registry digests use `npm run registry:sync -w
@sentropic/focus`. No generated copy is edited by hand.
