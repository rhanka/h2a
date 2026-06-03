# EVO-1 completion — inbox wake (durable bug #3)

Status: **design** (to build). Closes the passive-bus gap: an idle agent is woken
when a message lands in its inbox, with a clear h2a-tagged wake reason.

## Problem

The bus is passive: a live-but-idle agent never reacts to a new inbox envelope
until a human prompts it. EVO-1 shipped the **drive primitives** (signed drive
instruction, `nativeBackchannelDriver` for codex/claude/gemini, `h2a drive
serve/receive`, drumbeat relaunchers) but **no packaged thing watches the inbox
and triggers the wake**.

## Key realization — the home of the wake is `mcp-serve`, not a new wrapper

The `h2a mcp-serve` process that each host already runs (EVO-6/DEC-105
`--auto-open`) is, while alive:
- **connected** (a live session) and **heartbeating** its presence (so bug #2's
  keepalive is already handled *while mcp-serve runs*),
- **subscribed to `inbox.envelope_arrived`** (it already gets notified on every
  new inbox message).

So the missing piece is small: **on `inbox.envelope_arrived`, inject an
h2a-tagged wake prompt into the host CLI** via the existing
`nativeBackchannelDriver`. No separate watcher process is needed when mcp-serve
runs; a standalone wrapper is only the fallback for hosts that don't run a
persistent mcp-serve or expose no control channel.

## Design

**Primary: mcp-serve wake hook.** Add an opt-in wake path to `mcp-serve`
(`--wake <driver|command>` / `H2A_WAKE`): on `inbox.envelope_arrived` for this
instance, if the host is idle, build a **signed drive instruction** (reuse
`formatSignedDriveInstruction` — so the host's `drive receive` verify-before-act
gate validates it) carrying a wake prompt, and inject via the native driver.

**Fallback: `h2a watch-inbox` verb.** Standalone long-running verb (like `drive
serve`) for hosts without a persistent mcp-serve: polls the instance inbox,
keepalives presence, injects the same wake on new envelopes.

**Wake-reason tag (the user-facing ask).** The injected line must say *why* the
agent woke, neutrally and explicitly. Format:

```
[h2a-wake reason=inbox from=<sender-instance> topic=<topic> count=<n> at=<iso>]
automatic message from h2a — <n> new inbox envelope(s); run /h2a receive to process.
```

The bracketed tag is machine-parseable + signed (drive line); the sentence is the
neutral human-visible reason. No silent injection — the human always sees the tag.

## Testable core (TDD first)

- `decideInboxWake(seenIds: Set<string>, inbox: H2AEnvelope[]): { fresh: H2AEnvelope[], wake: string } | null`
  — pure: returns the new (unseen) envelopes + the formatted wake line, or null if
  nothing new. Dedups by envelope id (persist `seenIds` across ticks). No I/O.
- `formatWakeLine(fresh): string` — the tag + neutral sentence above.
The process/driver wiring (mcp-serve hook, watch-inbox loop) sits on top and
reuses `nativeBackchannelDriver` + `formatSignedDriveInstruction` (already tested).

## Invariants

- **Verify-before-act**: the wake is a signed drive instruction; the host gate
  (`acceptDriveInstruction`) validates signature/freshness/authority before the
  host acts (no unsigned injection across the trust boundary).
- **Idle-only / no storm**: wake only when the host is idle (not mid-turn);
  coalesce multiple arrivals into one wake; debounce.
- **2-package**: the decision core can be pure (`@sentropic/h2a`); the driver +
  mcp-serve wiring stay in `@sentropic/h2a-cli`.

## Also fixes

- Bug #2 keepalive: mcp-serve already heartbeats while alive; the wake hook makes
  "alive" meaningful (the agent actually reacts), so a live presence ⇒ reactive.

## Build order

1. `decideInboxWake` + `formatWakeLine` (pure, TDD).
2. mcp-serve `--wake` hook wiring `inbox.envelope_arrived → nativeBackchannelDriver`.
3. `h2a watch-inbox` fallback verb.
4. Per-host wake-driver smoke (codex/claude).
