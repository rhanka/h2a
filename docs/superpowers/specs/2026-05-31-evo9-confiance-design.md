# EVO-9 — CONFIANCE (postureConfiance) — design (buildable)

**Date**: 2026-05-31 · **Status**: design, validated by claude:a2a-cli — **ready to delegate** (build AFTER the dossier-layer lands) · **Refers**: EVO-9 framing, `2026-05-31-evo9-attention-core-design.md` (DEC-118, shipped 0.24.0 — `comprehension-attestation`), `2026-05-31-evo9-interet-design.md` (DEC-119, shipped 0.23.0 — `derivePostureConflit`), `2026-05-31-evo9-attention-dossier-design.md` (DEC-123, in progress — `deriveDecisionDossier`).

## Scope (the LAST EVO-9 slice)
The **composite advisory trust posture** of an engagement/decision:

> **`postureConfiance = attentionAttested ∧ noUndisclosedCollectiveConflict`**

It is a **derived, advisory predicate** — it composes the two shipped/in-flight pieces and asserts *nothing new*; it just reports whether the conditions for a fully-owned, non-conflicted decision hold. **No veto, no legitimacy judgment, no measurement** (the EVO-9 stance throughout). Build this only once the dossier-layer (DEC-123) is merged, since `attentionAttested` references the dossier hash.

## Definition (both terms are structural facts already on disk)
- **`attentionAttested`** — the required decider(s) for the decision each have a **valid `comprehension-attestation`** (DEC-118) whose `dossierHash` equals the hash of the **current** decision dossier (`deriveDecisionDossier`, DEC-123). I.e. they comprehended the *latest* dossier, not a stale one. (Re-deriving the dossier and comparing the hash is what makes this honest: a changed dossier invalidates a prior attestation.)
- **`noUndisclosedCollectiveConflict`** — **no** required signer has a `conflit-declarable` posture (`derivePostureConflit`, DEC-119) that is **undisclosed** (no matching `declaration-interet` / disclosure on the journal). Reuses the INTÉRÊT derivation verbatim.

## Design — pure derivation, advisory surface
### Core (`@sentropic/h2a`, pure)
- `derivePostureConfiance({ record, journal, dossier, declarations, attestations, now }) -> H2APostureConfiance` where the result is `"etablie" | "reservee" | "non-etablie"` **plus the reasons** (which term failed + which subjects):
  - `etablie` = both terms hold;
  - `reservee` = attention attested but a disclosed (declared) conflict remains in play (the decider may still proceed, informed);
  - `non-etablie` = attention not attested over the current dossier, OR an **undisclosed** collective conflict.
  Pure + total; composes `deriveDecisionDossier` + `derivePostureConflit` + comprehension-attestation verification (reuse `verifyComprehensionAttestation`). **No new primitives** — only composition.

### Surface (`@sentropic/h2a-cli`)
- `h2a confiance --negotiation <id>` → advisory read of `postureConfiance` + the failing reasons.
- At `decide`/stabilization: surface `postureConfiance` as an **advisory** annotation (reuse the INTÉRÊT/dossier advisory-event pattern). **Never** block stabilization on it (the declared authority decides; CONFIANCE only informs).
- MCP parity optional.

## Test plan (`node:test`)
1. `etablie` when all required deciders have a fresh comprehension-attestation over the current dossier hash AND no undisclosed declarable conflict.
2. `non-etablie` when the dossier changed after the attestation (hash mismatch) — the load-bearing freshness test.
3. `non-etablie` on an undisclosed `conflit-declarable` signer; `reservee` once it is disclosed.
4. advisory only: a `non-etablie` posture does NOT block `stabilizeNegotiation` (no veto).
5. no measurement / no legitimacy judgment (composition of structural facts only).

## Delegation note (orchestrator)
One coherent codex WP — **pure composition**, reuse `deriveDecisionDossier` (DEC-123), `derivePostureConflit` (DEC-119), `verifyComprehensionAttestation` (DEC-118); do NOT reimplement any of them. **Boundaries**: `@sentropic/h2a` (`derivePostureConfiance`) + `@sentropic/h2a-cli` (`h2a confiance` + advisory annotation + MCP opt) + tests. Pure-first. DEC-124. **Build only after DEC-123 (dossier-layer) is merged.** This closes EVO-9 (VALEUR · MUTUALISATION · INTÉRÊT · ATTENTION-core · ATTENTION dossier · CONFIANCE).
