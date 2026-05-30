# Drumbeat D5 — Reflexive Watchdog (design)

**Date**: 2026-05-29 (rev. 2026-05-30) · **Feature**: Drumbeat D5 · **Status**: ratified design, pre-implementation
**Refers**: DEC-084/085/086 (drumbeat), DEC-091 (relaunchers), DEC-095 (escalation/D7), DEC-092 (blockage/EVO-3).

## Problem

`drumbeat watch` today is **binary**: `scanDrumbeat` returns `findings` (relance until the
`--max-relances` cap) and `exhausted` (escalate). Every stalled agent is relanced blindly until
the cap, even when relancing is pointless or wrong. D5 inserts a **judgment step** — a *reflexive
watchdog* — that decides, per stalled agent, between **relance / finish / escalate / reroute**.

## Ratified decisions (brainstorm, 2026-05-29 → 30)

1. **Invocation** = a pluggable **`ReflexiveDecider`** interface (like the relauncher adapters); the
   default real adapter shells out a **host CLI headless**. The decider is **opt-in** (`--decider`).
2. **Decision context** = the **finding only** (no transcript, no extra store reads). YAGNI.
3. **Cadence (cost guard)** = the decider is consulted **only after K relances** (`--decider-after`,
   default 1) — relance cheaply first; spend an AI call only when relancing isn't working. Bounds
   cost and avoids an AI call on every beat for every finding.
4. **Rollout = advisory-first** = by default the decider's choice is **logged but NOT applied**; the
   watch does the safe default (relance, or escalate at the cap). Actions are applied only with
   **`--decider-enforce`**. Lets the operator observe decision quality before delegating action.
5. **`reroute` = advisory** = raises a **`blockage`** in scope signalling "needs pickup" — it does
   **NOT** copy the stalled agent's `launchContext` into a peer's inbox (that would hand work +
   possible secrets to an unauthorised peer, and nothing consumes an inbox automatically). A peer
   or the PRINCIPAL picks it up via the existing EVO-3 blockage loop.
6. **`finish` = guarded** = clears the entry only when the recorded `workStatus ∈ {paused, done}`
   (a deliberate stop); for an active/interrupted status (`working`, `out-of-tokens`, `blocked`) a
   `finish` is suspect → falls back to `escalate`. In practice finish mostly escalates (safe) and
   clears only clearly-deliberate stops — **no false abandonment**.
7. **Audit** = an **append-only decision log** (`decisions.jsonl`), recording `decided` vs `applied`.

## Architecture

```
scanDrumbeat → findings[] ──for each──▶ relanceCount < K ? ── yes ─▶ relance (cheap, as today)
                                              │ no
                                              ▼
                                   decider.decide(finding) ─▶ { action, reason? }
                                              │
                                   record decisions.jsonl (decided + applied)
                                              │
                            --decider-enforce ? ── no ─▶ safe default (relance / cap→escalate)
                                              │ yes
                                              ▼
   relance ─▶ relauncher.relance(finding)                 (counts against --max-relances)
   finish  ─▶ workStatus ∈ {paused,done} ? clear : escalate
   escalate─▶ recordEscalation (D7) + mark entry           (terminal)
   reroute ─▶ raiseBlockage(instance, scope, reason) + mark entry   (terminal, advisory)
```

`exhausted` entries still go straight to escalation (unchanged). After a **terminal applied action**
(`finish` clear, `escalate`, `reroute`) the entry is cleared/marked so it is **not re-decided next
beat** (no decision loop).

## Components

### Core — `@sentropic/h2a` (pure, no I/O)

```ts
export type H2AReflexiveAction = "relance" | "finish" | "escalate" | "reroute";

export interface H2AReflexiveDecision {
  readonly action: H2AReflexiveAction;
  readonly reason?: string;
}

/** Parse + validate a decider's JSON output. Total — never throws. Unknown/missing action →
 *  `{ action: "relance" }` (the safe fallback). Mirrors `parseOrgManifest`. */
export function parseReflexiveDecision(text: string): H2AReflexiveDecision;
```

`target` is dropped from the decision shape: reroute is advisory (blockage-only), so no peer
target is needed. The parser is the only D5 logic in core — keeps subagent-output parsing pure and
dependency-free; decision *interpretation* (clear/escalate/blockage) is CLI-runtime (touches the store).

### CLI runtime — `packages/h2a-cli/src/runtime/drumbeat/`

```ts
export interface ReflexiveDecider {
  decide(finding: H2ADrumbeatFinding): H2AReflexiveDecision | Promise<H2AReflexiveDecision>;
}
```

- **`loggingDecider`** (default when no `--decider`): always `{ action: "relance" }` → behaviour is
  **identical to today**. The reflexive watchdog is strictly opt-in.
- **`subagentDecider({ command, runtime, timeoutMs })`**: shells out a host CLI **headless** (the
  triple-review pattern: foreground, `</dev/null`, bounded `timeoutMs`, default 60 s). Prompt =
  the **finding only** (instance, reason, relanceCount, launchContext, workStatus), asking for JSON
  `{action, reason}`. Stdout → `parseReflexiveDecision`. **Any failure** (non-zero exit, timeout,
  unparseable) → `{ action: "relance" }` — never worse than today. `runtime` (spawn) is injected so
  it is testable without a real CLI.

### Watch beat dispatch (`runDrumbeatBeat`)

For each `finding`:
1. If `relanceCount < K` (`--decider-after`, default 1) → `relance` directly (skip the decider — cost guard).
2. Else `decision = await decider.decide(finding)`; **always** append a `decisions.jsonl` record.
3. If **not** `--decider-enforce` → apply the **safe default** (`relance`; or, at the cap, `escalate`)
   and record `applied` = that default (so advisory mode is visible vs `decided`).
4. If `--decider-enforce` → apply `decision.action`:

| action     | effect (enforced)                                                                       |
|------------|-----------------------------------------------------------------------------------------|
| `relance`  | `relauncher.relance(finding)` → if issued, `markRelanced` (counts against the cap).     |
| `finish`   | clear iff `workStatus ∈ {paused, done}`; else `escalate`.                                |
| `escalate` | `recordEscalation(...)` (D7) even under the cap; mark the entry terminal.                |
| `reroute`  | `raiseBlockage(instance, scope, reason)` (advisory, EVO-3); mark the entry terminal.     |

### Audit log

`<root>/.h2a/drumbeat/decisions.jsonl`, append-only, one record per consulted finding:

```jsonc
{ "instance":"claude:p1", "decided":"finish", "applied":"escalate",
  "reason":"looks done", "decider":"subagent", "enforced":false, "at":"2026-05-30T..." }
```

`decided` = decider output; `applied` = what the watch actually did (advisory default, or the
enforced action after guards). New store path `drumbeatDecisions` +
`recordDrumbeatDecision`/`listDrumbeatDecisions` (mirrors the subagent-audit log).

### CLI surface (`drumbeat watch`)

- `--decider <logging|COMMAND>` (default `logging`).
- `--decider-after <K>` (default 1) — minimum `relanceCount` before the decider is consulted.
- `--decider-enforce` (default off) — apply decisions instead of just logging them.
- `--max-relances`, `--relauncher`, `--interval-ms` unchanged; the cap still governs `relance`.

## Safety / anti-loop

- No `--decider` → `logging` → behaviour identical to today.
- Decider consulted only after K relances; any decider failure/timeout → `relance`.
- Decider call bounded (`</dev/null` + `timeoutMs`) so the watchdog cannot stall on it.
- Advisory-first: actions apply only with `--decider-enforce`; otherwise just logged.
- Terminal applied actions (`finish` clear / `escalate` / `reroute`) mark/clear the entry → not
  re-decided next beat. `--max-relances` still caps `relance`.

## Testing

- **Core** (pure): `parseReflexiveDecision` — valid each action; unknown/missing → `relance`;
  malformed JSON → `relance`.
- **CLI** (`runtime` injected): `subagentDecider` maps a fake command's JSON stdout to each action;
  non-zero exit / timeout / garbage → `relance`. `runDrumbeatBeat`:
  - `relanceCount < K` → relance, decider never called;
  - advisory (no enforce) → decider called + `decisions.jsonl` written, but action = safe default
    (`decided` ≠ `applied` recorded);
  - enforce → `finish` clears only for `paused/done` (else escalate); `escalate` records + marks
    terminal; `reroute` raises a blockage + marks terminal; a terminal entry is not re-decided.

## Out of scope (v1 — YAGNI)

- A learned/heuristic decider (only `logging` default + `subagentDecider`).
- reroute **hand-off** (copying launchContext to a peer inbox) — advisory blockage only for now;
  full hand-off needs a task-aware context + authorisation model.
- Enriched context (transcript tail, inbox/escalation signals) — finding only.
- A CLI verb to read the decision log (the JSONL is inspectable; add later if needed).

## Files touched

- `packages/h2a/src/drumbeat-decision.ts` (new) + index export — `H2AReflexiveDecision`,
  `parseReflexiveDecision`.
- `packages/h2a-cli/src/runtime/drumbeat/deciders.ts` (new) — `ReflexiveDecider`, `loggingDecider`,
  `subagentDecider`.
- `packages/h2a-cli/src/runtime/drumbeat/watch.ts` — K-gate, decider, advisory/enforce, dispatch,
  terminal-marking.
- `packages/h2a-cli/src/runtime/drumbeat/decisions.ts` (new) + `local-files/{paths,store}.ts` —
  `decisions.jsonl` + `recordDrumbeatDecision`/`listDrumbeatDecisions`.
- `packages/h2a-cli/src/cli.ts` + `cli-contract.ts` — `drumbeat watch --decider/--decider-after/--decider-enforce`.
- Tests as above + a `DEC-111` entry.
