# EVO-10 — Availability / negotiation-neglect detection — design (buildable)

**Date**: 2026-05-31 · **Status**: design, validated by claude:a2a-cli — **ready to delegate** · **Refers**: framing `2026-05-30-evo10-availability-framing.md`, DEC-085/086 (presence/drumbeat), DEC-092 (EVO-3 blockage), DEC-111 (D5 decider).

## Problem (recap)
`mcp-serve` auto-heartbeats every 5s, so a peer blocked on a user prompt stays `live` with zero attention — `inferStall` (stale beat / out-of-tokens) and the D5 watchdog (durable *stop* registry) both miss it. A real incident froze a negotiation ~3h. We close the gap with the **lighter option**: an orthogonal attention flag + a neglect detector that does **not** trust the peer's honesty.

## Ratified decisions (claude, 2026-05-31)
- **(i) `busy-on-user` = an orthogonal optional `attention` field on `H2ASession`** (NOT a `H2A_WORK_STATUSES` member). Keeps the frozen status enum frozen; the incident is "heartbeat ≠ attention", so attention is its own axis.
- **(ii) First action = notify BOTH** the neglecting peer AND the waiting peer. The *waiting-peer* notice is the one that would have unblocked the 3h incident in minutes.
- **Scope = lighter option only.** The heavier availability-worker sub-agent is **deferred** (needs EVO-1 + EVO-7/EVO-9 mandates to make autonomous acks safe; ack-and-hold only). The detection rule remains valuable regardless.

## Buildable scope (the WP)
1. **Core** — additive `attention?: "free" | "busy-on-user"` on `H2ASession` + `isH2ASession` validation (when present). A `busy-on-user` older than `busyMaxMs` is treated as `live` for detection (a forever-busy flag must not mask neglect). Auto-clears on process exit (15s presence expiry).
2. **Core (pure)** — `inferNegotiationNeglect({ record, journal, presence, now, neglectMs })`: for each open negotiation, for each party that is **process-alive AND subscribed**, if the **last journal entry is authored by someone else**, is **older than `neglectMs`**, and the party **has not acted since** → that party is neglecting. `attention:"busy-on-user"` **enriches the reason** ("confirmed busy" vs the worse "live-but-neglecting / silent"), it is **not a precondition**. Guards (no false positives): only arm when the last move wasn't the party's; **suppress if the party has an active in-scope EVO-3 blockage**; a turn where the party is a **required signer** is the strongest signal. Pure + total; table-tested.
3. **Runtime** — `scanNegotiationNeglect(store, sessions)`: join open negotiations × parties × presence, return findings.
4. **Wire into `drumbeatTick`** as a **second finding source** (`reason: "negotiation-neglected"`). Advisory default = **notify** (analogue of D5's safe `relance`). **NOT** written to the durable stop registry / `markDrumbeatTerminal` — it is **self-healing** (evaporates the moment the party acts). Per-`(instance, negotiationId)` last-notified **anti-flap**. Past a cap → `recordEscalation` with a **new reason `negotiation-neglected`**.
5. **Decider composition** — a persisting neglect finding past `deciderAfter` is handed to the existing `ReflexiveDecider` (relance = re-notify, escalate = PRINCIPAL, reroute = reassign the turn). Reuse D5; audit in `decisions.jsonl`.
6. **MCP** — set/clear `attention` (around the user-prompt wait) + surface `attention` in `discover_sessions`.
7. **Notification** — notify the **waiting** party (reuse an existing topic, e.g. the EVO-3 `peer.*` channel) — the load-bearing unblock — AND the neglecting party.
8. **Host plugin** — set/clear `attention` around the prompt wait: **claude first** (reliable via hooks); codex/gemini/agy best-effort self-report — **document the gap** (the detection rule is the safety net that does not trust the flag).

## Invariants
- Advisory-first, no veto, no legitimacy judgment (it notices a *structural* fact: someone else moved last and the party is silent past a threshold). Never auto-acts on the party's behalf (that is the deferred sub-agent).
- Additive only: one optional session field + pure classifier + a second drumbeat finding source + one escalation reason. Frozen `H2A_WORK_STATUSES` untouched.
- Tokens neutral/English (`attention`, `busy-on-user`, `negotiation-neglected`) — runtime identifiers, not the FR concept lineage.

## Test plan (`node:test`)
1. `attention` field + `isH2ASession` validation (present/absent/invalid). 2. `inferNegotiationNeglect` table tests: neglect fires (other moved last, older than neglectMs, party alive+subscribed, no action since); does NOT fire when the party moved last / within neglectMs / not subscribed / has an active in-scope blockage; `busy-on-user` enriches but is not required; stale `busy-on-user` (> busyMaxMs) treated as live. 3. `scanNegotiationNeglect` join. 4. `drumbeatTick` second finding: advisory notify + anti-flap (no re-notify before the party acts/next window) + escalate past cap + NOT in durable registry. 5. decider composition (reuse D5). 6. MCP set/clear + discover surfacing.

## Delegation note (orchestrator)
One coherent codex WP, **independent** of ATTENTION-core / INTÉRÊT / identity / drive (different files). **Boundaries**: `@sentropic/h2a` (`attention` field + `inferNegotiationNeglect`), `@sentropic/h2a-cli` (`scanNegotiationNeglect` + drumbeat wiring + MCP + host-plugin set/clear), tests, docs + DEC-121 + VOCABULARY. Pure-first. Do **not** build the heavier availability-worker sub-agent (deferred).
