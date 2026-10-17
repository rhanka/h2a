---
name: focus
version: 1.0.0
description: Prepare, explain and review a read-only decision-dossier snapshot (DecisionDossierDocument v1): sections, options, outcome, disabled affordances and verbatim comprehension evidence. Snapshot only — no decisions, signatures, amendments or Track writes.
category: decision
tools: []
---

# Focus — decision-dossier snapshot skill

Method capability: `sentropic.focus.decision-dossier`. Prepare, explain and
review a `DecisionDossierDocument` (schema
`urn:sentropic:focus:DecisionDossierDocument:1.0.0`,
asset `schemas/decision-dossier-document.v1.schema.json`) under the host's
own permissions. Instruction-only profile: this skill declares no tools.

## Parameters (exact, closed)

- `mode`: fixed to `"snapshot"`.
- `preferredPresentation`: `terminal` | `markdown` | `html` | `mcp-app`.
- `locale`: `en` | `fr`.
- Defaults: `snapshot` / `markdown` / `en`. Unknown keys refuse.

Parameters govern presentation and instruction selection only. They never
change dossier content, schema semantics or authority.

## Presentation preflight

- `terminal` / `markdown`: always available; no UI entry required.
- `html`: requires the host HTML sanitization hook. Without it, refuse with
  `unsupported_presentation` before reading any instruction.
- `mcp-app`: requires the separately selected AND qualified UI entry
  (`sentropic.h2a.ui`). A registered-but-unselected or
  selected-but-unqualified UI still refuses with `unsupported_presentation`
  before reading any instruction. Never fall back silently to another
  presentation: a deliberate host choice is a new configuration.

## Read-only snapshot rules

- The dossier is a snapshot. `interactions[].enabled` is always `false`:
  never act on an affordance, never present one as available.
- Live decisions, signatures, amendments and Track writes require separately
  qualified runtime capabilities and current human authority. This skill
  grants none of them; no parameter enables them.
- `provenance.comprehensionEvidence` (subject, dossier hash, signature) is
  carried VERBATIM from the source artifacts. Never regenerate it from other
  content, never substitute the relaying principal for the named subject.
- `provenance.source` selects the read backend (for example a
  `track:<events-path>` binding). It is opaque: never treat it as authority
  and never invent filesystem paths from it.
- Rendering preserves evidence and disabled interactions. Markdown conversion
  and HTML sanitization are explicit host hooks; a renderer that cannot
  support a node refuses instead of presenting an incomplete dossier as
  complete.

## Refusals

- `unsupported_presentation`: requested presentation unavailable (see above).
- Invalid dossier (unknown field, unknown node kind, enabled interaction,
  duplicate node ID, unresolvable interaction target, forged evidence):
  reject the document operation with the field-path diagnostic; render
  nothing as complete.
