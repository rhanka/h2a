---
name: present-decision
description: Present consequential human decisions with a readable dossier, or choose decide-and-trace or a quick ask for smaller stakes. Covers irreversible, costly, security, contract, cross-owner and genuinely balanced choices; records the outcome in track. Agent-to-human, not h2a inter-agent negotiation.
---

# Present Decision

## Titles first

Name the subject and decision object in plain words, short enough to distinguish 50 dossiers.
Example: **Décision CI/CD Sentropic — sélection des tests et graphe des dépendances**.
Use one line; no slogan or thesis sentence. In HTML, the visible title and `<title>` must be identical.
Render it in small type in a thin band (at most 1.25rem), never a hero or a large heading occupying the screen.

## 1. Choose the right effort

Start with what changes for the owner and what risk they bear. Keep their intention central;
an agent's technical inconvenience alone does not justify a dossier.

- **Decide + trace:** local, readily reversible, clear existing pattern, no meaningful security,
  privacy, data-loss, frozen-contract or cross-owner impact, no genuinely balanced alternatives.
  State the assumption and proceed within existing authorization.
- **Quick ask:** one missing owner preference, 2–3 clear options, cheap rollback, no hard trigger.
  Give each option a one-line consequence.
- **Dossier:** irreversible or costly rollback; public/frozen contract or data-schema change;
  security, privacy, access control, migration or retention; cross-repo/owner/agent impact;
  meaningful cost, schedule or scope impact; strong disagreement or balanced alternatives;
  unknown validation criteria that could change the outcome; or explicit owner request.
  Two moderate triggers also qualify. Explain the concrete owner impact, not just the trigger.

Declare a reading budget proportional to the stakes. Each self-contained question, context,
options and recommendation must fit **2 minutes** (aim: 400 words). State question count and total time;
no choice or material risk hidden in optional evidence.

## 2. Ground the decision

Read the request, repo rules, existing decisions and `.track/` via the repo reporting workflow.
Verify claims against sources. Do not edit other repos or global rules without authorization.

Quote the **literal owner request**, with date/source. Map demands to questions, options or
acceptance criteria; flag departures. Use `assets/owner-criteria.template.md`.

Complex design requires independent Codex + Opus reviews; surface disagreements. Missing required
review means **Incomplete**: only reversible preparation continues, no final validation.

## 3. Write a short, self-contained question

Use `assets/dossier-template.md` for content. In plain words, include:

- the exact decision and boundary, the owner's expected benefit and risk;
- representative context: current behavior, a concrete problem/scenario, affected people,
  constraints, sourced facts, assumptions and unknowns;
- **2–4 short options**, each with a one-line owner consequence including its main tradeoff,
  cost and rollback; make every implied choice explicit, with **no nested sub-options**;
- one recommendation and why, its strongest objection and what would overturn it;
- the smallest answer needed and acceptance criteria tied to the owner's words.

Explain acronyms; replace opaque codes with meaningful names and source links. Distinguish
`[FACT]` (sourced) from `[JUDGMENT]`. Steelman alternatives. Separate presenter convenience from
owner value; include a brief failure scenario, no mandatory long appendix.

## 4. Audit, present, record

Run `assets/self-audit.md`, fix failures and re-check before presenting.
If a necessary fact, criterion or review is missing, label **Incomplete** and ask for that input,
not approval of the decision.

**Default dossier output: portable Focus design-system HTML, never a claude.ai artifact.**
Run `h2a focus template -o dossier.json`; replace the example with a `DecisionDossierDocument`,
including the literal request, readable options and ecosystem diagrams (`source: "ecosystem:overview"`;
also `models`, `knowledge`, `interfaces`). Then run exactly:

```sh
h2a focus build dossier.json -o dossier.html
```

The builder refuses schema/readability failures before output. Deliver/link the single HTML file;
check offline phone reading, light/dark, cards and pinch zoom. See `docs/focus/portable-dossiers.md`.
Cards only prepare a local answer; they never record approval.
Before asking, read `assets/native-questions.md`: use the exposed native question tool after a decision
dossier with a diagram. If unavailable, leave consequential decisions pending. Decide-and-trace needs no ask.

Record when `.track/` exists or the owner approves tracking:

- Create: `track decision new --kind <kind> --title <title> --workspace <workspace> --targets <targets> --context <c> --options-json <json> --recommendation <optionId> --rationale <r>`.
- Revise or migrate: `track decision dossier <decisionId> --context <c> --options-json <json> --recommendation <optionId> --rationale <r>`.
  JSON contains 2–4 options with `id`, `title`, `summary`; recommendation names one.
  Context-only edits require an already structured dossier.
- Record the owner's choice: `track decision select <decisionId> <optionId>` (default `go`;
  use `--outcome no-go` for rejection). Defer with `track decision outcome <decisionId> deferred`.
- Append evidence with `track decision add-artifact`, not a dossier rewrite.
  For a human-facing dossier use `--kind rendered-view --view-ref <stable-id>`
  (optionally `--source-dossier-hash <h>`).
- Use `--kind h2a-decision-dossier --negotiation-ref <n> --dossier-hash <h>` only for real
  negotiation evidence. Never fabricate `comprehension[]`: a chat reply is not a signed attestation.
  Never record a bridge/relay principal as the human decider.

This is the agent's human-facing method; h2a negotiations remain inter-agent. Existing repo methods win.
## Embedded evidence (H1)

Use checkout `focus template --evidence` then `focus build`: version 2,
original bytes/digests, citations, separate annexes. Keep material risks primary;
disclose consultation separately. Test offline search/download/back. DS in-canvas
controls await H2/H3. Never rewrite renderer/geometry.
