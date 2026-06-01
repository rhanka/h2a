# soc2.md — consolidated review (2/3)

> Reviews on 2026-05-28 — R1 agy, R2 codex **both verdict `revise`**, strongly concurring. R3 (claude/opus) deferred (recurrent timeouts). Foreground run from a neutral tmp dir (autonomous loop). Accepted changes applied to `evaluations/soc2.md`.

## Consensus findings → action

| # | Finding (reviewers) | Severity | Applied change |
|---|---|---|---|
| 1 | **SOC 2 framed as a "certification" you "pass"** — it is a CPA **attestation/examination → report/opinion** (R1, R2) | high | "certification" → "attestation"; "passes a SOC 2 examination" → "obtains an unmodified SOC 2 report"; heading → "Attestation / examination common questions". |
| 2 | **Service auditor mis-modelled as `AUTHORITY`** (R1, R2) | high | Diagram + Q5 + hypothesis: the CPA/service auditor is an external **`CONTROL`** (examines/opines); the imposing party (AICPA framework / customer / regulator) is the external **`AUTHORITY`**. |
| 3 | **h2a evidence overclaimed** — "the journal *is* the operating-effectiveness evidence / proves operation" (R2) | high | Reframed throughout: the journal is the **signed control-event record** the Type II examination draws on; **the CPA's testing renders the effectiveness opinion**. "Operating-effectiveness evidence" row `✅`→`~`. |
| 4 | **`CONTROL` wording blurs role vs system action** (R2) | med | TSC row: a `POLICY` clause **audited by a `CONTROL` (h2a records the audit)**, not "h2a audits" / "signed CONTROL". |
| 5 | **Confidentiality/Privacy fit overstated** (R2) | med | Row `✅`→`~`: disclosure supports evidence-sharing + evidences related controls, but does not by itself satisfy the Privacy/Confidentiality TSC. |
| 6 | **`ENGAGEMENT` scope not explicit** (R1) | med | ENGAGEMENT bullet: scoped to the system under examination (SOC 2 system boundary). |
| 7 | **`recourse` omitted** (R1) | low | ENFORCEMENT_PLAN bullet: exceptions/CUEC failures escalate via `recourse` to the scope's competent authority. |
| 8 | **Mermaid edge fragile + overclaiming** (R2) | low | `EVID -. "is the journal over PER" .-> H` → `EVID -.->|"journal records control events over PER"| H`. |

`AMENDMENT`/`recourse` pre-cleared as canonical in the rubric (post the iso-27001 false-positive). Demonstrated-facts discipline maintained.
