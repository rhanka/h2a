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

Declare a total reading-time budget proportional to the stakes. Each question, including its
context, options and recommendation, must be readable in **2 minutes** (aim for at most 400 words).
Prefer one question. For several, state their count and total time; make each self-contained.
Keep supporting evidence separate and optional to read, without hiding a choice or material risk there.

## 2. Ground the decision

Read the request, applicable repo rules and existing decisions; verify claims against sources.
When `.track/` exists, read its state using the repo's reporting workflow. Do not edit other repos
or global rules without authorization.

Quote the **literal owner request**, with date/source, and map each demand to the question,
option or acceptance criterion that addresses it. Quote the relevant passage without paraphrasing;
link longer context. Flag any departure from the request explicitly.
Use [assets/owner-criteria.template.md](assets/owner-criteria.template.md) for applicable criteria.

For complex design decisions, obtain independent Codex + Opus reviews before recommending.
Use the host's available second-opinion tool; surface disagreements. Reviews bound risks and
check owner intent; they must not inflate the dossier. A missing required review makes it
**Incomplete**; only reversible preparation may continue, and no final validation is requested.

## 3. Write a short, self-contained question

Use [assets/dossier-template.md](assets/dossier-template.md). In plain words, include:

- the exact decision and boundary, the owner's expected benefit and risk;
- representative context: current behavior, a concrete problem/scenario, affected people,
  constraints, sourced facts, assumptions and unknowns;
- **2–4 short options**, each with a one-line owner consequence including its main tradeoff,
  cost and rollback; make every implied choice explicit, with **no nested sub-options**;
- one recommendation and why, its strongest objection and what would overturn it;
- the smallest answer needed and acceptance criteria tied to the owner's words.

Spell out necessary acronyms on first use. Replace opaque codes such as `L06b` with meaningful
names; keep tracking identifiers in source links. A reader must understand the question without
opening those links. Separate `[FACT]` (with source) from `[JUDGMENT]` on decisive claims.
Present each alternative's strongest honest case, including a rejected alternative; avoid padding
pros to match counts. State presenter convenience separately from owner value, and include a brief
failure scenario. Integrate these safeguards into the question; no mandatory long appendix.

## 4. Audit, present, record

Run [assets/self-audit.md](assets/self-audit.md), fix failures and re-check before presenting.
If a necessary fact, criterion or review is missing, label **Incomplete** and ask for that input,
not approval of the decision.

Present the context and options before one final ask using the host's question tool or numbered
prose. A bare option menu is insufficient for consequential decisions. Decide-and-trace needs no ask.

Record when `.track/` exists or the owner approves tracking:

- Prepare with `track decision dossier <decisionId> --context <c>`.
- Append evidence with `track decision add-artifact`, not a dossier rewrite.
  For a human-facing dossier use `--kind rendered-view --view-ref <stable-id>`
  (optionally `--source-dossier-hash <h>`).
- Use `--kind h2a-decision-dossier --negotiation-ref <n> --dossier-hash <h>` only for real
  negotiation evidence. Never fabricate `comprehension[]`: a chat reply is not a signed attestation.
  Never record a bridge/relay principal as the human decider.

This is the agent's human-facing method; h2a negotiations remain inter-agent. Existing repo methods win.
