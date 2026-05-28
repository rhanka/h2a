# Autonomous /loop — decisions log (for review & reversibility)

> Started 2026-05-28 ~09:30 EDT. Autonomous loop over the h2a TODO list until ~18:00 EDT.
> Rules: commit + push freely; **no npm release / version bump / publish** (left for review); reversible default decisions allowed, each traced below; never AI co-authoring in commits.
>
> Baseline at start: published **v0.12.0**, DECISIONS through **DEC-094**. This loop's commits land on `main` **without** version bumps — review then release.

| # | Slice | Decision (default, reversible) | Why | How to revert |
|---|---|---|---|---|
| 1 | D7 escalation | Escalation target is **symbolic** (`to: "PRINCIPAL"`, `channel: "alert"`), not a resolved actor id | The drumbeat entry carries no scope/principal, so `resolveEscalationTarget` (DEC-040) can't run yet | Carry `scope` in the drumbeat entry (D6), then resolve a concrete authority and store its id |
| 2 | D7 escalation | Escalations live in a **dedicated registry** (`<root>/.h2a/escalation/`), not the PRINCIPAL's inbox | Simplest durable, idempotent record; inbox fan-out needs a resolved principal (dep. on #1) | Add an inbox fan-out (and/or a `peer.escalated` notification topic) once #1 lands |
| 3 | EVO-0 agy host | ~~agy `hostScenarioShipped: false`~~ → **RESOLVED**: agy added to `host-mcp-scenario.test.js` (same `mcp-serve` backend), flag now `true` | — | — |
| 4 | EVO-0 agy host | `install-skills` left at `claude\|codex\|gemini` (no agy) | agy's `/h2a` skill travels via `agy plugin import`, a different path (matrix), not yet confirmed | Add an `agy` branch to `install-skills` once the plugin-import format is confirmed |
| 5 | SysML S1 | `sysmlRefEquals` is **strict over all fields** (incl. `apiBase`, `elementHash`) | Avoids a surprising "equal but different mirror/content"; total + simple | Add a looser `sameModelState(a,b)` predicate if a use case needs it |
| 6 | SysML S2 | `resolveSysmlElement` **requires `ref.element`** (whole-project resolution throws) | Element fetch is the content-integrity case; whole-project has no single hash target | Add a project/commit elements-collection fetch when needed |
| 7 | SysML S3 | The ref is read from a fixed path `body.subject.sysmlRef` | The spec's conventional embedding location (§2) | Accept additional locations / a configurable path if artifacts embed refs elsewhere |
| 8 | SysML S4 | Query scope is **abstract** (`fetch`/`detail`/`view`), not concrete SysML API params | Repo-specific param/view-id translation is the adapter's job; V1 interop non-goal to implement the API server | Emit concrete query params once a target API & Services profile is fixed |
| — | loop infra | Loop is **rate-limit-resilient**: each turn re-derives the next slice from repo state (an un-committed slice is simply redone) and always reschedules the wakeup as its last action; iterations spaced to let transient rate-limits clear | User asked the loop to survive rate-limits | n/a (behavioral) |

## Slices completed in this loop (no release yet)

- **D7 — escalate-to-PRINCIPAL on relance-exhaustion** (DEC-095) — escalation registry + `drumbeat watch` auto-escalate + `drumbeat escalations` list + `clear` closes. 510 tests green.
- **EVO-0 — agy as a first-class host (MCP parity)** (DEC-096) — `H2A_AGY_HOST` + `host setup`/`connect`/`status` accept agy (4 hosts). 511 tests green.
- **EVO-0 — agy host-MCP e2e scenario test** (DEC-096 follow-through) — agy added to `host-mcp-scenario.test.js`, `hostScenarioShipped: true`. 512 tests green. Remaining EVO-0: `install-skills` agy target (decision #4).
- **SysML S1 — `H2ASysmlRef` pure model reference** (DEC-097) — type + `validateSysmlRef`/`isH2ASysmlRef`/`sysmlRefEquals` in core. 518 tests green.
- **SysML S2 — fetch+hash adapter** (DEC-098) — `runtime/sysml/` `resolveSysmlElement` (injectable fetch) + `hashSysmlElement`, mock-API tested. 523 tests green.
- **SysML S3 — envelope verification** (DEC-099) — `verifyEnvelopeSysmlRef` (commit-trust + content-integrity) + `extractSysmlRef` + async CLI `h2a sysml verify`. 530 tests green.
- **SysML S4 — disclosure → query scope** (DEC-100) — `sysmlQueryScope(mode)` total over DEC-045 modes. 533 tests green. **➡ SysML interop S1-S4 COMPLETE** (DEC-097..100).
- **Backlog B — `evaluations/smart-contract.md` authored** (B4) — h2a off-chain negotiation/authority ↔ on-chain execution; `{chain,address,txHash}` reference (mirrors SysML interop); off-chain boundary + gaps + compatibility hypothesis. Doc only, pending triple-review. Linked in evaluations/README.md.
