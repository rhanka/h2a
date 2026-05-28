# e-agentic-squad.md — consolidated review (2/3)

> 2026-05-28 — R1 [agy](./e-agentic-squad.r1-agy.md), R2 [codex](./e-agentic-squad.r2-codex.md). R3 (claude) deferred. NOTE: agy went off-script and wrote a "revised" copy into its OWN scratch (`~/.gemini/...`) — ignored; only the findings were used, applied to this repo with source-verification.

## Applied (valid)
- **Escalation authority** (both, high): N-squads now routes escalation to the train/architecture `PRINCIPAL` / portfolio `EXECUTIF`, with the RTE/`CONDUCTOR` **facilitating/routing** (not deciding) — the competent-authority invariant.
- **D_SAFE as nearest profile + delta** (both, med): clarified that this use-case **is the source** of `D_SAFE` (DEC-080), so the delta ≈ none (canonical agile-train reference); only watch points listed.
- **Mermaid edge label** (agy, med): the `FIRM == framework CONTRACT<br/>+ mission ENGAGEMENT ==>` edge label dropped the in-label `<br/>` and was quoted (edge labels don't render `<br/>` reliably).

## Rejected / deferred (verified vs source)
- "`SUBAGENTS` non-canonical" (codex, high) — **false positive**: SUBAGENTS is canonical (DEC-068, `packages/h2a/src/subagents.ts`); the eval even cites DEC-068. **Kept.**
- "scope signs the ENGAGEMENT/CONTRACT" (agy, med) — the eval already states the squad is a SCOPE that *carries* the engagement (not a signer) and the PI engagement is signed by PMX+ATL. No violation. **No change.**
- "`BINDING` invented" — echoes the real `H2ASubagentBinding` concept; informal label, substance model-correct. **Deferred** (stylistic).
- "remove agent `audit` right" / "contracted-role = MANDATAIRE not PRINCIPAL" — borderline design choices the eval makes deliberately (DEC-080 contracted-role); **deferred**, not auto-applied on a mature doc.
