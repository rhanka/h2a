# a-enterprise.md — consolidated review (2/3)

> Reviews on 2026-05-28 — R1 [agy](./a-enterprise.r1-agy.md), R2 [codex](./a-enterprise.r2-codex.md), both `revise`. R3 (claude) deferred. **Important**: the reviewers reviewed the eval **inline, without the model docs** (`README.md` / `VOCABULARY.md`), so several "high" findings are **false positives** against the actual h2a model — verified below and rejected. Only the genuinely-valid refinements were applied.

## Applied (valid)

| Finding (reviewers) | Applied change |
|---|---|
| Compatibility hypothesis lacks a profile id + delta (R1, R2) | Named **`A_ENTERPRISE`** (`H2A_ABC_MODEL_PROFILES`, `auditAbcModelCompatibility`, DEC-041) + listed deltas (external CONTROL, imposed POLICY, supplier/client CONTRACTs with external PRINCIPALs, shareholder AUTHORITY, recurring ENGAGEMENTs). |
| Topology claim too simple (R1, R2) | Header → "hierarchy (with contractual + regulatory overlays)" — matches the eval's own hypothesis ("not a single tree"). |
| Umbrella scope needs an owning PRINCIPAL (R1, R2) | Hypothesis now states the umbrella scope's owning `PRINCIPAL` is the board/shareholder body that appoints + reserves AUTHORITY over the EXECUTIF. |

## Rejected (false-positive — verified against the model)

| Finding (reviewers) | Why rejected (source) |
|---|---|
| "Remove **veto** from CONTROL" (R1, R2, high) | `README.md` line 81 lists **veto** as an endorsed "strong but minimized control" capability. The model allows CONTROL veto. **Kept.** |
| "**PARTY / RIGHTS / OBLIGATION** are non-canonical vocabulary" (R1, R2, high) | `README.md` (Q5 line 49, CONTRACT def line 60, line 74, CONTRACT schema Q1 line 90) treats **parties, obligations, reserved rights** as first-class CONTRACT/ENGAGEMENT **content** (not invented artifacts). The eval uses them as content, consistent with the model. **Kept** (the all-caps is stylistic; substance is model-correct). |
| "Model SUP/CLI scopes as signing CONTRACTs is an invariant violation" | The eval already says clients are "external mini-orgs **or external PRINCIPALs**"; the signer is the external party's PRINCIPAL, not the scope. No change needed. |

**Lesson (loop)**: triple-reviewing a *mature* eval with reviewers that lack the model docs yields many false positives; each finding was checked against `README.md`/source before applying — only 3 valid refinements landed. The demonstrated-facts discipline (see also the iso-27001 AMENDMENT false-positive).
