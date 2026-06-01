# nhi.md — consolidated triple-review

> Three independent headless reviews on 2026-05-27 — R1 agy/Antigravity Gemini 3.5, R2 codex/gpt-5.5, R3 claude/opus 4.7. **All three verdicts: `accept-with-changes`.** All changes below were applied to `evaluations/nhi.md`.

## Consensus findings → action

| # | Finding (reviewers) | Severity | Applied change |
|---|---|---|---|
| 1 | "strong" overclaims coverage for a *coordination* protocol — key custody/IAM/rotation-completion are external (R2, R3) | high/med | Added a **coverage legend** reframing ✅ as "strong *primitive*; full prevention depends on key custody/IAM/deployment outside h2a". |
| 2 | Internal inconsistency: hypothesis said "strong on NHI1/NHI9" but the table marks them partial (R3) | med | Hypothesis reconciled — NHI1/NHI9 moved to **partial**; "strong" kept only for NHI4/5/7. |
| 3 | SP 800-207 overstated ("open challenge / unsolved at the spec level"; verbatim NHI terms) (R2, R3) | high/med | Softened to "discusses NPEs and notes their authentication/audit as a concern in a ZTA, leaving NPE governance to the implementation". |
| 4 | "standardized/relayed by CSA" overstates — OWASP owns it (R2, R3) | low | Changed to "**endorsed by** the CSA". |
| 5 | Mermaid node B `{…}`/`⊆` in an unquoted `[…]` label can break the renderer (R1, R2, R3) | low | All node labels **quoted**; added a note that the diagram shows representative risks, not all ten. |
| 6 | "agent-identity governance layer" implies IAM/inventory ownership (R2, R3) | low | Reworded to "**protocol-level agent-identity coordination & provenance layer**; not a secrets vault, IAM, or NHI-inventory platform". |
| 7 | OWASP `/2025/` URL may 404; ~100:1 ratio is vendor-dependent (R1, R3) | low | URL changed to the project base; ratio softened to "cited from ~10:1 to ~100:1". |
| 8 | Vocabulary: uppercase artifact references (R1, R2, R3) | low | `mandate`→`MANDATE` in the diagram; kept legitimate mechanism names (subagent/registry/journal/keyring are real h2a constructs, not artifacts). |

## Cross-check (R3)
OWASP NHI Top 10 item names and CSF 2.0's six functions (incl. the new `govern`) verified accurate — the flagged items were consistency/overclaim/sourcing refinements, **no factual errors in the NHI list itself**.

## Mechanism note
Reviews were run from a neutral tmp dir with the document inline in the prompt and tools disabled where supported, so reviewers performed pure analysis (no repo access). First exercise of the BACKLOG triple-review protocol via the agy/codex/claude CLIs.
