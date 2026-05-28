# Autonomous /loop — decisions log (for review & reversibility)

> Started 2026-05-28 ~09:30 EDT. Autonomous loop over the h2a TODO list until ~18:00 EDT.
> Rules: commit + push freely; **no npm release / version bump / publish** (left for review); reversible default decisions allowed, each traced below; never AI co-authoring in commits.
>
> Baseline at start: published **v0.12.0**, DECISIONS through **DEC-094**. This loop's commits land on `main` **without** version bumps — review then release.

| # | Slice | Decision (default, reversible) | Why | How to revert |
|---|---|---|---|---|
| 1 | D7 escalation | Escalation target is **symbolic** (`to: "PRINCIPAL"`, `channel: "alert"`), not a resolved actor id | The drumbeat entry carries no scope/principal, so `resolveEscalationTarget` (DEC-040) can't run yet | Carry `scope` in the drumbeat entry (D6), then resolve a concrete authority and store its id |
| 2 | D7 escalation | Escalations live in a **dedicated registry** (`<root>/.h2a/escalation/`), not the PRINCIPAL's inbox | Simplest durable, idempotent record; inbox fan-out needs a resolved principal (dep. on #1) | Add an inbox fan-out (and/or a `peer.escalated` notification topic) once #1 lands |
| 3 | EVO-0 agy host | agy `hostScenarioShipped: false` (no end-to-end scenario test yet) | The MCP-config parity is the bulk; an e2e agy scenario needs more setup | Add an agy host-MCP scenario test, flip the flag |
| 4 | EVO-0 agy host | `install-skills` left at `claude\|codex\|gemini` (no agy) | agy's `/h2a` skill travels via `agy plugin import`, a different path (matrix), not yet confirmed | Add an `agy` branch to `install-skills` once the plugin-import format is confirmed |
| — | loop infra | Loop is **rate-limit-resilient**: each turn re-derives the next slice from repo state (an un-committed slice is simply redone) and always reschedules the wakeup as its last action; iterations spaced to let transient rate-limits clear | User asked the loop to survive rate-limits | n/a (behavioral) |

## Slices completed in this loop (no release yet)

- **D7 — escalate-to-PRINCIPAL on relance-exhaustion** (DEC-095) — escalation registry + `drumbeat watch` auto-escalate + `drumbeat escalations` list + `clear` closes. 510 tests green.
- **EVO-0 — agy as a first-class host (MCP parity)** (DEC-096) — `H2A_AGY_HOST` + `host setup`/`connect`/`status` accept agy (4 hosts). 511 tests green.
