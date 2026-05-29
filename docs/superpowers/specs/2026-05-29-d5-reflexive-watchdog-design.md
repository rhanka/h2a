# Drumbeat D5 — Reflexive Watchdog (design)

**Date**: 2026-05-29 · **Feature**: Drumbeat D5 · **Status**: ratified design, pre-implementation
**Refers**: DEC-084/085/086 (drumbeat), DEC-091 (relaunchers), DEC-095 (escalation/D7), DEC-092 (blockage/EVO-3), DEC-109/110 (org effective view).

## Problem

`drumbeat watch` today is **binary**: `scanDrumbeat` returns `findings` (relance until the
`--max-relances` cap) and `exhausted` (escalate). Every stalled agent is relanced blindly until
the cap, even when relancing is pointless (work already done) or wrong (it should be re-routed or
escalated immediately). D5 inserts a **judgment step** — a *reflexive watchdog* — that decides,
per stalled agent, between **relance / finish / escalate / reroute** instead of always relancing.

## Ratified decisions (brainstorm, 2026-05-29)

1. **reroute** = re-delegate via **inbox + blockage** (reuse existing primitives, no topology picker).
2. **Invocation** = a pluggable **`ReflexiveDecider`** interface (like the relauncher adapters); the
   default adapter shells out a **host CLI headless**. Opt-in.
3. **Decision context** = the **finding only** (no transcript, no extra store reads). YAGNI.
4. **`finish` guard** = **corroborate the recorded work-status** (don't silently abandon active work).
5. **Audit** = an **append-only decision log** (`decisions.jsonl`).

## Architecture

A decision step between `scanDrumbeat` and the relauncher, inside `runDrumbeatBeat`:

```
scanDrumbeat → findings[] ──for each──▶ decider.decide(finding) ─▶ { action, reason?, target? }
                                                                     │
   relance ─▶ relauncher.relance(finding)         (counts against --max-relances, as today)
   finish  ─▶ corroborate workStatus → clearDrumbeatEntry | escalate
   escalate─▶ recordEscalation (D7), even under the cap
   reroute ─▶ deliver launchContext to a same-scope peer inbox + raiseBlockage | escalate
                                                                     │
                                              append-only decisions.jsonl (every decision)
```

`exhausted` entries keep going straight to escalation (unchanged). The decider is consulted only
for `findings`.

## Components

### Core — `@sentropic/h2a` (pure, no I/O)

```ts
export type H2AReflexiveAction = "relance" | "finish" | "escalate" | "reroute";

export interface H2AReflexiveDecision {
  readonly action: H2AReflexiveAction;
  readonly reason?: string;
  /** For `reroute`: an optional preferred peer; if absent the watch picks one in scope. */
  readonly target?: string;
}

/**
 * Parse + validate a decider's JSON output. Total — never throws. Unknown/missing
 * action → `{ action: "relance" }` (the safe fallback). Mirrors `parseOrgManifest`.
 */
export function parseReflexiveDecision(text: string): H2AReflexiveDecision;
```

The parser is the only D5 logic in core: it keeps subagent-output parsing pure and testable, with
no dependency. The *interpretation* of a decision (clear/escalate/reroute) is CLI-runtime because it
touches the store.

### CLI runtime — `packages/h2a-cli/src/runtime/drumbeat/`

```ts
export interface ReflexiveDecider {
  decide(finding: H2ADrumbeatFinding): H2AReflexiveDecision | Promise<H2AReflexiveDecision>;
}
```

- **`loggingDecider`** (default): always `{ action: "relance" }` → behavior is **identical to today**
  when no decider is configured. The reflexive watchdog is strictly opt-in.
- **`subagentDecider({ command, runtime, timeoutMs })`**: shells out a host CLI **headless** (the
  triple-review pattern: foreground, `</dev/null`, bounded `timeoutMs`, default 60 s). The prompt
  carries the **finding only** (instance, reason, relanceCount, launchContext, workStatus) and asks
  for a one-line decision as JSON `{action, reason, target?}`. The stdout is run through
  `parseReflexiveDecision`. **Any failure** (non-zero exit, timeout, unparseable) → `{ action:
  "relance" }` — never worse than today. `runtime` is injected (spawn) so it is testable without a
  real CLI.

### Watch beat dispatch (`runDrumbeatBeat`)

For each `finding`, call `decider.decide(finding)`, log the decision, then:

| action     | effect                                                                                  |
|------------|-----------------------------------------------------------------------------------------|
| `relance`  | `relauncher.relance(finding)` → if issued, `markRelanced` (counts against the cap). As today. |
| `finish`   | **Guard**: clear only if `workStatus ∈ {paused, done}` (a deliberate stop). For an interrupted/active status (`working`, `out-of-tokens`, `blocked`) a `finish` is **suspect** → fall back to `escalate`. When allowed → `clearDrumbeatEntry`. |
| `escalate` | `recordEscalation(...)` (D7), even if under `--max-relances`.                            |
| `reroute`  | Pick a peer: a same-scope instance from the **effective org view** (`effectiveOrgInstances`, EVO-7), excluding the stalled instance; prefer `decision.target` if it is a valid same-scope peer. Deliver the stalled `launchContext` as an envelope into that peer's inbox (`putInboxMessage`) **and** `raiseBlockage(instance, scope, reason)` to signal the hand-off. **No eligible peer → `escalate`.** |

Every decision (including fallbacks and the resolved final action) is appended to the audit log.

### Audit log

`<root>/.h2a/drumbeat/decisions.jsonl`, append-only, one record per decision:

```jsonc
{ "instance": "claude:p1", "decided": "reroute", "applied": "reroute",
  "reason": "blocked on missing token", "decider": "subagent", "at": "2026-05-29T..." }
```

`decided` = what the decider returned; `applied` = what the watch actually did after guards/fallbacks
(so a `finish`→`escalate` downgrade is visible). New store path `drumbeatDecisions` + a
`recordDrumbeatDecision`/`listDrumbeatDecisions` pair (mirrors the subagent-audit log).

### CLI surface

`drumbeat watch --decider <logging|COMMAND>` (default `logging`). When a command string is given,
the `subagentDecider` wraps it. No other flags change; `--max-relances`, `--relauncher`, `--interval-ms`
are unchanged and still apply (the cap governs `relance` decisions).

## Safety / anti-loop

- Decider unavailable / errors / times out → `relance` (today's behavior; never worse).
- The decider call is bounded (`</dev/null` + `timeoutMs`) so the watchdog itself cannot stall.
- `finish`, `escalate`, `reroute` are **terminal** for that entry this beat (no relance loop).
- `--max-relances` still caps `relance`; an exhausted entry escalates regardless of the decider.

## Testing

- **Core** (`org-parse`-style, pure): `parseReflexiveDecision` — valid each action; unknown/missing
  action → `relance`; malformed JSON → `relance`; `reroute` with/without `target`.
- **CLI** (`runtime` injected): `subagentDecider` maps a fake command's JSON stdout to each action;
  non-zero exit / timeout / garbage → `relance`. `runDrumbeatBeat` with a fake decider + fake
  store/relauncher dispatches all four actions correctly: `finish` clears only for `paused/done`
  (else escalates); `reroute` delivers to a same-scope peer + raises a blockage, and escalates when
  no peer exists; every path writes one `decisions.jsonl` record with `decided`/`applied`.

## Out of scope (v1 — YAGNI)

- A learned/heuristic decider (only `logging` default + `subagentDecider` ship).
- Multi-peer reroute fan-out (one peer per reroute).
- Enriched context (transcript tail, inbox/escalation signals) — finding only.
- A CLI verb to read the decision log (the file is inspectable; add later if needed).

## Files touched

- `packages/h2a/src/drumbeat-decision.ts` (new) + index export — `H2AReflexiveDecision`,
  `parseReflexiveDecision`.
- `packages/h2a-cli/src/runtime/drumbeat/deciders.ts` (new) — `ReflexiveDecider`, `loggingDecider`,
  `subagentDecider`.
- `packages/h2a-cli/src/runtime/drumbeat/watch.ts` — dispatch the four actions; consult the decider.
- `packages/h2a-cli/src/runtime/drumbeat/registry.ts` (or a new `decisions.ts`) +
  `local-files/{paths,store}.ts` — `decisions.jsonl` + record/list.
- `packages/h2a-cli/src/cli.ts` + `cli-contract.ts` — `drumbeat watch --decider`.
- Tests as above + a `DEC-111` entry.
