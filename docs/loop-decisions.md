# Autonomous /loop — decisions log (for review & reversibility)

> Started 2026-05-28 ~09:30 EDT. Autonomous loop over the h2a TODO list until ~18:00 EDT.
> Rules: commit + push freely; **no npm release / version bump / publish** (left for review); reversible default decisions allowed, each traced below; never AI co-authoring in commits.
>
> Baseline at start: published **v0.12.0**, DECISIONS through **DEC-094**. This loop's commits land on `main` **without** version bumps — review then release.

| # | Slice | Decision (default, reversible) | Why | How to revert |
|---|---|---|---|---|
| 1 | D7 escalation | Escalation target is **symbolic** (`to: "PRINCIPAL"`, `channel: "alert"`), not a resolved actor id | The drumbeat entry carries no scope/principal, so `resolveEscalationTarget` (DEC-040) can't run yet | Carry `scope` in the drumbeat entry (D6), then resolve a concrete authority and store its id |
| 2 | D7 escalation | Escalations live in a **dedicated registry** (`<root>/.h2a/escalation/`), not the PRINCIPAL's inbox | Simplest durable, idempotent record; inbox fan-out needs a resolved principal (dep. on #1) | Add an inbox fan-out (and/or a `peer.escalated` notification topic) once #1 lands |

## Slices completed in this loop (no release yet)

- **D7 — escalate-to-PRINCIPAL on relance-exhaustion** (DEC-095) — escalation registry + `drumbeat watch` auto-escalate + `drumbeat escalations` list + `clear` closes. 510 tests green.
