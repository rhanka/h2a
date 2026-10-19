---
name: focus
version: 2.0.0
description: Prepare and review readable decision dossiers that trace the owner's request, expose real stakes and offer short explicit choices. Read-only snapshots; no decisions, signatures, amendments or Track writes.
category: decision
tools: []
---

# Focus — help the owner make a real decision

Method capability: `sentropic.focus.decision-dossier`. Prepare a
`DecisionDossierDocument` using schema
`urn:sentropic:focus:DecisionDossierDocument:1.0.0`
(`schemas/decision-dossier-document.v1.schema.json`). This instruction-only
skill grants no tools or write authority.

For supporting evidence, select the explicit v2 template with the freshly built
checkout CLI: `node packages/h2a/dist/bin.js focus template --evidence -o dossier.json`,
then `node packages/h2a/dist/bin.js focus build dossier.json -o dossier.html`.
It declares `schemaVersion: 2` and uses the separate schema
`urn:sentropic:focus:DecisionDossierDocument:2.0.0`. Omitting the discriminant
selects unchanged v1. Old consumers refuse v2; never strip evidence to bypass that.
Store original bytes once in `sources` (canonical base64, original SHA-256 and byte
size). Origins are frozen provenance data, never URLs/paths fetched by the reader.
Use typed `citations`, section/option `citationRefs`, `evidenceGroups`, and collapsed
`annexes`; keep choices, material risks and reservations in the primary decision.
Summaries consume its reading budget; raw evidence volume and estimated consultation
are disclosed separately. Hashes prove byte identity, not truth or owner approval.
Embedded H1 supports offline text/capture consultation, complete-source search,
original download and return to context. It does not advertise H2 DS geometry/CDN
or H3 linked exploration. DS owns renderer controls inside the canvas; Focus
declares choices/reference bindings. Do not author coordinates or invent a toolbar.

A dossier serves the owner's intention. Ask the owner to choose a path or
manage a real problem whose risk concerns them. Handle routine technical
implementation within existing authority. Double review must find missing
context, hidden commitments and risks; it must also cut jargon and unnecessary
questions. It is not a reason to produce a longer dossier.

## Prepare a dossier the owner can read on its own

- Write `title` and `subject` as non-empty single lines of at most 100
  characters. Name the concrete subject and what the owner must decide:
  “Garden shed — choose its location”, not “Ratify the plan”. Review their
  meaning against the request; the gate checks length and form, not meaning.
- Quote the owner's literal request in `readability.ownerRequestQuote`.
  Preserve their words and trace how the questions serve them. Never invent
  a quotation. If no request exists, set `noOwnerRequest: true`; this blocks
  presentation until the request is established. Do not combine it with a quote.
- State the scope and why it matters to the owner in `readability.stakes`:
  cost, disruption, consequences, reversibility. Declare `stakesLevel`: `low`
  for a small reversible inconvenience, `medium` for meaningful cost or
  disruption, `high` for lasting, contractual or major personal impact.
- Set `readingBudgetMinutes` proportionately: at most 2 / 8 / 30 minutes for
  low / medium / high stakes, including shared context and glossary. These
  caps are defaults, not permission to inflate the stakes or fill the budget.
- Each question needs representative `context`, 2–4 short options, a
  `recommendedOptionId`, and a short reason in `recommendedAnswer`. Context
  must explain the situation, scope and trade-off without making the reader
  chase another document or decode an identifier.
  Keep questions and recommendations to one line of at most 300 characters,
  option-set titles to 100. No nested lists or inline a/b branches.
- Each option needs a one-line `consequence` for the owner. Labels are at most
  100 characters, consequences 160, optional bodies/comments 300. Keep them
  flat: no nested lists, inline a/b branches or multiple decisions in one
  option. Move essential explanation to question context.
- Estimate `readingTimeMinutes` for each question, context and options together:
  positive and at most 2 minutes. The gate checks a 180-word/minute lower bound.
  Allow time to understand the trade-off, not just pronounce the words. Shorten
  or split long questions; never understate the time to pass the gate.
- Every option set names its `questionId`; every decision, orientation or
  amendment outcome names the question it resolves. Choice-bearing prose also
  names its question. Audit *every* implied commitment, including defaults,
  rollout, spending and permissions. Split independent commitments into explicit
  questions. A reference alone does not prove that the question covers the text.
- Prefer plain words to codes such as `L06b`, `MH-L3`, `R5` or build identifiers,
  and to unexplained acronyms. If necessary, define each term in
  `readability.glossary` with a meaning the owner understands. The renderers show
  this glossary. Each definition must stand alone in plain words, with no
  self-reference or other code, even one defined elsewhere in the glossary.

Bad: “Ratify L06b under MH-L3? A: migrate, with a/b variants. B: defer.”
The request, stakes, consequences and recommendation are missing; several
choices are hidden behind codes.

Good (about one minute):
> Your request: “Keep the garden shed handy without spoiling the terrace view.”
> Stakes: the wrong spot means a longer walk every week or a blocked view for years.
> Question: where should the shed go? The permit covers both spots; only comfort differs.
> Side wall: a short walk and a clear terrace view.
> Back of garden: a longer walk, invisible from the house.
> Recommendation: side wall, because it meets both parts of your request.

Encode the good example as one question, two linked options, the recommended
option's id and reason, the literal quote and stakes, a declared stakes level,
and reading estimates. Let the renderer arrange the supplied questions/options;
never hand-author four parallel walls of text or imply that snapshot cards are
clickable.

## Validate before presentation

Use `validateDecisionDossierForPresentation` (or its throwing counterpart
`assertDecisionDossierForPresentation`) from `@sentropic/focus/validate`.
The three public renderers enforce this gate before invoking host hooks.
Refusals carry a field path, code and an actionable explanation. Correct the
content and present the complete dossier; do not silently omit refused material.

New fields stay optional in schema version 1 so historical data still parses
through `validateDecisionDossierDocument`. Structural validity is insufficient
for presentation. Legacy Track projections lacking readability information are
blocked; never synthesize an owner request to make them pass. New Track dossiers
carry `subject`, `readability`, `questionId` for shared context/outcome, and
question context, reading time and recommendation on `qa`. Each option summary
is its consequence; `options[].questionId` overrides the shared question link
when a dossier contains several questions.

The gate checks structure, code definitions, reading lengths and explicit links.
It cannot prove a quotation is authentic, prose is clear, stakes are honest,
or every semantic choice has been exposed. Author and reviewer must verify
those properties against the request. Review should reduce the owner's reading
burden while preserving the real stakes and every relevant choice.

## Host parameters and presentation availability

Closed parameters: `mode: "snapshot"`; `preferredPresentation` is `terminal`,
`markdown`, `html` or `mcp-app`; `locale` is `en` or `fr`. Defaults:
`snapshot` / `markdown` / `en`. Unknown keys refuse. Parameters choose presentation
and instruction selection; they do not change content or authority.

Terminal and Markdown are always available. HTML requires the host sanitization
hook. `mcp-app` requires registered, selected **and qualified** `sentropic.h2a.ui`.
Otherwise refuse with `unsupported_presentation` before reading any instruction;
never silently change the requested presentation.

## Snapshot and provenance boundaries

`interactions[].enabled` is always `false`; never act on an affordance or present
it as available. Live decisions, signatures, amendments and Track writes require
separately qualified capabilities and current human authority.

Carry `provenance.comprehensionEvidence` (subject, dossier hash, signature)
verbatim. Never regenerate it or substitute a relay principal for the named
subject. `provenance.source` is an opaque read-backend binding; never infer
authority or invent filesystem paths from it.

Markdown conversion and HTML sanitization are explicit host hooks. Unsupported
nodes, unknown fields, enabled interactions, duplicate ids, unresolved targets
and forged evidence refuse with field diagnostics; never render an incomplete
dossier as complete.
