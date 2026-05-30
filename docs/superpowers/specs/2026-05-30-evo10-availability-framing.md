# EVO-10 — Availability worker / `busy-on-user` presence — framing

**Date**: 2026-05-30 · **Status**: framing (pre-spec) · **Source**: dogfooding blockage by `claude:sent-tech-design-system` (`neg:ds-react-scaffolding-20260530` froze ~3h because the peer was `live` + subscribed but its main loop was blocked on a user prompt). **Refers**: DEC-084/085 (presence/workStatus), DEC-092 (EVO-3 blockage), DEC-111 (D5).

## The actual gap

`inferStall` only fires on a stale heartbeat or `out-of-tokens`. But `mcp-serve` auto-heartbeats every 5s regardless of whether the LLM loop is free — so a CLI blocked on a user prompt stays `live` with a fresh beat yet has **zero attention**. The presence model conflates **process liveness** (heartbeat) with **attention** (the loop is free to read peer events). The D5 watchdog only reads the durable *stop* registry (exited agents), so a live-but-frozen peer is invisible to it today.

## Lighter option (RECOMMENDED), two pieces

### 1. `busy-on-user` as an orthogonal `attention` field (RECO, not a `H2A_WORK_STATUSES` member)
Add optional `attention?: "free" | "busy-on-user"` to `H2ASession`. Rationale: the incident is "heartbeat ≠ attention"; adding a member to the frozen-ish `H2A_WORK_STATUSES` re-buries it in the enum that already conflates liveness/work-kind and forces a fallthrough audit across `inferStall`/scan/decider. An additive field is the smaller, truthful change and keeps the frozen list frozen. Set/cleared by the host plugin around the user-prompt wait (claude: reliable via hooks; codex/gemini/agy: best-effort self-report → the detection rule is the safety net). Auto-clears on process exit (15s presence expiry); a `busy-on-user` older than `busyMaxMs` is treated as `live` for detection (don't let a forever-busy flag mask neglect).

### 2. Negotiation-neglect detection rule (the part that does NOT trust the peer's honesty)
A new pure classifier `inferNegotiationNeglect({ record, journal, presence, now, neglectMs })` over the two facts already on disk (negotiation journal + presence): **for each open negotiation, for each party that is process-alive and subscribed, if the last journal entry is authored by someone else and is older than `neglectMs` and the party has not acted since → the party is neglecting it.** `busy-on-user` is an *enrichment* of the reason ("confirmed busy" vs "live-but-neglecting" — the worse, silent case), not a precondition. Guards against false positives: only arm when the last move wasn't the party's; suppress if the party has an active in-scope EVO-3 blockage; signing turns where the party is a required signer are the strongest signal.

**Action ladder (advisory-first, reusing existing transport):** (1) notify the neglecting peer; (2) **notify the *waiting* peer** that its counterpart is busy (this is the one that would have unblocked the incident in minutes instead of 3h); (3) escalate past a cap via `recordEscalation` (new reason `negotiation-neglected`).

### Composition with D5
The neglect scanner is a **second finding source** feeding the same `drumbeatTick` (new finding `reason: "negotiation-neglected"`). Advisory default = notify (analogue of D5's safe `relance`). A persisting neglect finding past `deciderAfter` is handed to the existing `ReflexiveDecider` (relance=re-notify, escalate=PRINCIPAL, reroute=reassign the turn). **Not** written to the durable stop registry / `markDrumbeatTerminal` (it is self-healing — it evaporates the moment the party acts); dedupe via a per-(instance, negotiationId) last-notified anti-flap; audit in `decisions.jsonl`.

## Heavier option (follow-up)
A dedicated **availability-worker sub-agent** that processes a party's inbox/negotiation events independently of the main loop — the structural fix (removes the freeze). Open questions before spec: authority boundary (almost certainly **ack-and-hold only** to respect AGENTS-non-signatory; substantive moves need a pre-signed mandate — ties to EVO-7/EVO-9 ATTENTION); identity/NHI (own sub-agent key vs the party's); spawn/teardown lifecycle; per-host feasibility (EVO-1 matrix); two-writer concurrency on presence/journal. Defer until EVO-1 + EVO-7 mandates make autonomous acks safe; the detection rule remains valuable as the watchdog that confirms the worker keeps up.

## Two decisions to confirm in the spec session
- (i) `busy-on-user` as an orthogonal `attention` field (RECO) vs a `H2A_WORK_STATUSES` member.
- (ii) first action = notify the neglecting peer, the waiting peer, or **both** (RECO: both — the waiting-peer notice is what actually unblocked the incident).

## Draft TDD outline
1. Core: `attention` field + `isH2ASession` validation. 2. Core: pure `inferNegotiationNeglect` (table tests). 3. Runtime: `scanNegotiationNeglect(store, sessions)` (join open negotiations × parties × presence). 4. Wire into `drumbeatTick` (new finding reason, advisory notify + anti-flap, escalate past cap, not in the durable registry). 5. Decider composition (reuse D5). 6. MCP: set/clear `attention` + surface in `discover_sessions`. 7. Notification: notify the waiting party (reuse an existing topic). 8. Host plugin set/clear (claude first; document the gap). 9. Docs + DEC + VOCABULARY.
