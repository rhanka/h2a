# EVO-9 — ATTENTION dossier-layer — design (buildable)

**Date**: 2026-05-31 · **Status**: design, validated by claude:a2a-cli — **ready to delegate** · **Refers**: EVO-9 framing (ATTENTION refinement + Opus stabilization), `2026-05-31-evo9-attention-core-design.md` (DEC-118, shipped 0.24.0), `2026-05-31-evo9-interet-design.md` (DEC-119, shipped 0.23.0 — `derivePostureConflit`), `conflit-interet.ts`, `comprehension-attestation.ts`.

## Scope (this slice)
The **risk-ranked decision dossier** + the **presenter non-bias gate** — the second ATTENTION slice, now unblocked (depends on INTÉRÊT + ATTENTION-core, both shipped). It makes a decision **informed and fully owned**: a dossier ranked by *structural* risk, presented by a **non-conflicted** presenter, comprehended (ATTENTION-core attestation) by the decider. Binds ATTENTION ↔ INTÉRÊT ↔ CONFIANCE at `decide`. **CONFIANCE itself is the next, separate slice.**

## Hard invariants (the Opus-stabilized rules — do not violate)
1. **Risk ranking = PROCEDURAL, not substantive.** Ranking *attention* ("look here first") is allowed (it is what MANDATAIRE already does); ranking *risk by a model of harm* is the forbidden "judge legitimacy". So **every ranking input is structural or declared, never an engine opinion**:
   - conflict-posture from INTÉRÊT (`derivePostureConflit` — structural),
   - a **declared** masked-impact flag (`masqueImpactCollectif` — declare, never measure),
   - structural proxies: touches a cross-scope `aval`, amends a signed artifact, empty `successCriteria`.
2. **Presenter non-bias gate ≠ INTÉRÊT stabilization gate** (same pure `derivePostureConflit`, two call-sites): the **presenter at `decide`** (this slice, earlier) vs the **signers at stabilization** (INTÉRÊT, shipped). Keep distinct subjects/moments. A presenter whose posture is `conflit-declarable` (a **decision-forcing** conflict) → the presentation is **invalid** (advisory: surface + escalate, never auto-veto).
3. **Bidirectional, human included.** The dossier is framed **relative to the decider's interest** (motivate genuine attention on what is at stake *for them*) — applies to the human decider, not only agents.
4. **Advisory, no legitimacy judgment, no measurement.** Same EVO-9 stance.

## Design — declare → derive → attest
### Core (`@sentropic/h2a`, pure)
- `deriveDecisionDossier({ record, journal, declarations, now }) -> H2ADecisionDossier`: a **pure, risk-ranked view** of an open negotiation's decision. Each dossier item carries its **ranking reason(s)** drawn ONLY from the structural/declared inputs in invariant 1 (e.g. `{ subject, postureConflit, masqueImpactCollectif, crossScopeAval, amendsSignedArtifact, missingSuccessCriteria, rank }`). `rank` orders by count/severity of *structural* flags — a deterministic ordering, not a harm score. Pure + total; table-tested.
- The dossier has a canonical hash (reuse `hashCanonical`) → it is what a **comprehension-attestation** (DEC-118) attests to ("I comprehended dossier H").
- `evaluatePresenterBias(presenter, context) -> { biased: boolean, posture }` = one call of the existing `derivePostureConflit` with `subject = presenter` at the `decide` moment. `biased = posture === "conflit-declarable"`.

### Surface (`@sentropic/h2a-cli`)
- `h2a dossier --negotiation <id>` → renders the risk-ranked dossier (advisory) + the presenter-bias verdict.
- A `decide`-time gate: when the presenter is biased, surface + `recordEscalation` (advisory; never block the declared authority). Reuse the INTÉRÊT escalation pattern.
- Comprehension flow: the decider attests comprehension of the dossier hash via the shipped `h2a attest-comprehension` (no new attestation code — reuse DEC-118).
- MCP parity optional.

## Test plan (`node:test`)
1. `deriveDecisionDossier`: ranking is deterministic + every rank reason is structural/declared (assert no input is a computed harm score); items with more structural flags rank higher; `masqueImpactCollectif` only read as declared.
2. presenter non-bias: a `conflit-declarable` presenter → `biased:true` → advisory escalation at `decide`, **stabilization still proceeds** (no veto); a clean presenter → not flagged.
3. two call-sites distinct: presenter@decide vs signers@stabilization use the same `derivePostureConflit` with different subjects.
4. dossier hash stable → a comprehension-attestation over it verifies (integration with DEC-118).
5. no legitimacy judgment / no measurement (the load-bearing EVO-9 invariant).

## Delegation note (orchestrator)
One coherent codex WP, builds on shipped INTÉRÊT + ATTENTION-core (reuse `derivePostureConflit`, `comprehension-attestation`, `hashCanonical` — do NOT reimplement). **Boundaries**: `@sentropic/h2a` (`deriveDecisionDossier` + `evaluatePresenterBias`) + `@sentropic/h2a-cli` (`h2a dossier` + decide-gate + MCP opt) + tests. Pure-first. DEC-123. Do **not** build CONFIANCE here (next slice: `postureConfiance = attentionAttested ∧ noUndisclosedCollectiveConflict`, composes this + INTÉRÊT).
