# Drumbeat D5 — Reflexive Watchdog (design)

**Date**: 2026-05-29 (rev. 3, 2026-05-30 post-review) · **Feature**: Drumbeat D5 · **Status**: ratified design, pre-implementation
**Refers**: DEC-084/085/086 (drumbeat), DEC-091 (relaunchers), DEC-095 (escalation/D7), DEC-092 (blockage/EVO-3).

## Problem

`drumbeat watch` today is **binary**: `scanDrumbeat` returns `findings` (relance until the
`--max-relances` cap) and `exhausted` (escalate). Every stalled agent is relanced blindly until
the cap, even when relancing is pointless or wrong. D5 inserts a **judgment step** — a *reflexive
watchdog* — that decides, per stalled agent, between **relance / finish / escalate / reroute**.

## Ratified decisions (brainstorm 2026-05-29, hardened by a spec/plan review 2026-05-30)

1. **Invocation** — a pluggable **`ReflexiveDecider`** (like the relauncher adapters); the default
   real adapter shells out a host CLI headless. **Opt-in** (`--decider`).
2. **Decision context** — the **finding only** (no transcript). Untrusted fields (`instance`,
   `launchContext`) are clearly delimited in the prompt as data, not instructions (injection guard).
3. **Cadence (cost guard)** — consult the decider **only after K relances** (`--decider-after`,
   default 1). The effective window is `[deciderAfter, maxRelances)`; `--decider-after` must be
   `< --max-relances` (validated, else exit 1). Advisory mode still consults the decider each beat
   in that window (a known, documented cost — see Safety).
4. **Rollout = advisory-first** — by default the decider's choice is **logged but NOT applied**; the
   watch does the safe default (`relance`). Applied only with **`--decider-enforce`**.
5. **`reroute` = escalate-with-hint (v1)** — routed through **escalation** (`recordEscalation`,
   reason `reroute-suggested`), so it actually reaches the PRINCIPAL who reassigns. It does **not**
   raise a peer blockage: a review showed that path is a silent no-op (a blockage in an empty/unknown
   scope is pushed to no subscriber) and conflates "I am blocked" with "take my work". A true
   peer-to-peer hand-off waits until EVO-3 supports ownership transfer.
6. **`finish` = guarded to `done` only** — clears the entry **only** when `workStatus === "done"`
   (the sole real completion signal); every other status → `escalate`. A review found `paused` is the
   stop-hook **default for an unexpected stop**, so `{paused, done}` would silently abandon normal
   stops — hence `done`-only. A `finish` is always recorded in the decision log (a recoverable trace),
   never a bare unlink without a trail.
7. **Terminal lifecycle** — after an enforced terminal action the entry is **marked terminal**
   (`markDrumbeatTerminal`), and `scanDrumbeat` **skips terminal entries** — instead of a destructive
   `clearDrumbeatEntry` that a later `recordStop` (which resets `relanceCount` to 0) would re-arm into
   a slow loop. `finish` on `done` clears (the agent is genuinely complete); `escalate`/`reroute`
   mark terminal. A genuine fresh `recordStop` overwrites the entry (new budget) by design.
8. **Audit** — an **append-only decision log** (`decisions.jsonl`) recording `decided` vs `applied`.

## Architecture

```
scanDrumbeat → findings[]  (skips done + terminal; entries at/over cap are `exhausted`, not findings)
   └ for each finding:
        relanceCount < K (--decider-after) ?  ── yes ─▶ relance (cheap, as today)
                                              │ no
        decision = decider.decide(finding)    │
        record decisions.jsonl (decided + applied)
                                              │
        --decider-enforce ? ── no ─▶ applied = relance (safe default)
                                              │ yes
        relance ─▶ relauncher.relance(finding)                     (counts against the cap)
        finish  ─▶ workStatus === "done" ? clearDrumbeatEntry : escalate
        escalate─▶ recordEscalation(reason "watchdog-escalate") + markDrumbeatTerminal
        reroute ─▶ recordEscalation(reason "reroute-suggested")  + markDrumbeatTerminal
```

`exhausted` entries still escalate via the unchanged `onExhausted`/D7 path.

## Components

### Core — `@sentropic/h2a` (pure, no I/O)

```ts
export type H2AReflexiveAction = "relance" | "finish" | "escalate" | "reroute";
export interface H2AReflexiveDecision { readonly action: H2AReflexiveAction; readonly reason?: string; }
/** Total — never throws; unknown/missing/garbage → { action: "relance" }. Mirrors parseOrgManifest. */
export function parseReflexiveDecision(text: string): H2AReflexiveDecision;
```

### CLI runtime — `packages/h2a-cli/src/runtime/drumbeat/`

- **`ReflexiveDecider { decide(finding): H2AReflexiveDecision | Promise<…> }`**.
- **`loggingDecider`** (default): always `relance` → identical to today when `--decider` is omitted.
- **`subagentDecider({ command, runtime, timeoutMs })`**: shells out a host CLI headless. The prompt
  is passed as a **command argument** (host CLIs read the task from argv, not stdin) with **stdin
  closed**; bounded `timeoutMs` (default 60 s). Any failure (non-zero exit, timeout, unparseable) →
  `relance`. `DeciderRuntime.run(command, prompt, timeoutMs)` is injected for tests.
- **`decisions.ts`** — `recordDrumbeatDecision`/`listDrumbeatDecisions` over
  `<root>/.h2a/drumbeat/decisions.jsonl` (same dir/file style as `registry.ts`, **not** the store).

### Registry / scan changes

- `H2ADrumbeatEntry` gains `terminal?: { action: H2AReflexiveAction; at: string }`.
- `markDrumbeatTerminal(root, instance, action, now?)` sets it (overwrite, like `markRelanced`).
- `scanDrumbeat` skips entries where `entry.terminal` is set (in addition to the existing `done` skip).

### Watch dispatch (`drumbeatTick`)

`DrumbeatTickOptions` gains `decider?`, `deciderAfter?` (default 1), `enforce?`, `deciderLabel?`, and
the effect hooks `onEscalate?(finding, decision)` / `onReroute?(finding, decision)` (injected, like
the existing `onExhausted`, so the escalation wiring stays in `cli.ts`). `finish`-clear and the audit
write are done in `watch.ts` (it already imports the registry).

### CLI surface (`drumbeat watch`)

- `--decider <logging|COMMAND>` (default `logging`).
- `--decider-after <K>` (default 1; must be `< --max-relances`).
- `--decider-enforce` (default off).
- `--max-relances`, `--relauncher`, `--interval-ms` unchanged.

## Safety / anti-loop / cost

- No `--decider` → behaviour identical to today.
- Decider consulted only in `[deciderAfter, maxRelances)`; any failure/timeout → `relance`.
- Decider call bounded (stdin closed + `timeoutMs`) so the watchdog cannot stall on it. **Known cost:**
  in advisory mode the decider is consulted every beat in the window and the verdict is discarded
  (the price of observing decision quality); and a foreground `spawnSync` per finding serialises a
  beat — documented in `--help`/DEC-111; throttling/parallelism is a later refinement.
- Terminal actions mark the entry; `scanDrumbeat` skips terminal → not re-decided. `--max-relances`
  still caps `relance`.
- **Authority note (DEC-111):** `--decider-enforce` delegates "abandon / escalate / reroute agent X"
  to a headless CLI's JSON output. Advisory-first is the default mitigation; the prompt delimits the
  agent-controlled fields as untrusted data.

## Testing

- **Core**: `parseReflexiveDecision` — each action; unknown/missing/garbage → `relance`.
- **CLI**: `subagentDecider` maps a fake runtime's stdout to each action; non-zero/timeout/garbage →
  `relance`; the prompt is forwarded as the command **argument**. `recordDrumbeatDecision`/`list`
  round-trip. `drumbeatTick`: below K the decider is never called; advisory logs `decided≠applied`
  and applies `relance`; enforce: `finish` clears only on `done` (else escalate); `escalate`/`reroute`
  call the hook + mark terminal; a terminal entry is skipped by the next scan.

## Out of scope (v1 — YAGNI)

- A learned/heuristic decider (only `logging` + `subagentDecider`).
- Peer-to-peer reroute hand-off (needs EVO-3 ownership transfer) — v1 reroute escalates with a hint.
- Enriched context (transcript/inbox/escalation signals) — finding only.
- Decider call throttling/parallelism — documented cost for now.
- A CLI verb to read the decision log (the JSONL is inspectable).

## Files touched

- `packages/h2a/src/drumbeat-decision.ts` (new) + index export.
- `packages/h2a-cli/src/runtime/drumbeat/deciders.ts` (new), `decisions.ts` (new),
  `watch.ts` / `scan.ts` / `registry.ts` / `index.ts` (modify), and the cli `index.ts` re-export list.
- `packages/h2a-cli/src/runtime/escalation/registry.ts` — add reasons `watchdog-escalate`, `reroute-suggested`.
- `packages/h2a-cli/src/cli.ts` (`runDrumbeatWatch` + `--help`) + `cli-contract.ts`.
- `DECISIONS.md` — DEC-111.
