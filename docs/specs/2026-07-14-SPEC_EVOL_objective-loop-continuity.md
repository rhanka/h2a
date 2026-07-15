# SPEC EVOL — Objective Loop continuity and guarded relaunch

Status: implementation-ready, pending integration review
Date: 2026-07-14
Scope: `@sentropic/h2a` Objective Loop create/join/report/tick/run surfaces

## Evidence and root cause

The live loop `loop-mre4avom` was created by MCP with `agents=[]`, `repos=[]`, and
`refs=[]`. Its append-only journal then accumulated hundreds of valid
`loop.tick` observations with `outcome=running` and `actions=[noop]`.

This is not a scheduler race. Three contracts form a dead end:

1. `h2a_loop_create` accepts only a goal and therefore creates an empty loop.
2. The pure tick iterates enrolled agents; an empty set correctly offers no wake
   or launch action, but reports the state as healthy `running`.
3. `h2a_loop_report` rejects a non-enrolled conductor and gives no explicit
   recovery path.

For enrolled agents, local tmux wake already exists and durable drumbeat status
is folded into presence. However, wake enforces only cooldown, not
`maxRelaunches`; missing/dead agents produce an ask-only `request-launch` whose
sink records success without starting anything.

## Decisions

### D1 — Empty creation is explicit

`h2a_loop_create` MUST reject a request that supplies neither an explicit
participant instance nor `allowEmpty:true`. An explicit instance is enrolled as
part of the create operation. `allowEmpty:true` preserves advanced staged
orchestration without making an empty shell the default. CLI create with one or
more planned `--agent` entries remains valid.

No caller identity is inferred from process state, presence, or a singleton
session.

### D2 — Empty loops remain recoverable, not terminal

A tick over an empty loop returns an actionable `stalled` plan explaining that
an agent must join. It does not write `blocked`, `failed`, or another terminal
status. Explicit join remains available.

`h2a_loop_report` MAY combine recovery and progress only when all of these hold:

- `autoJoin:true` is explicit;
- `instance` is explicit;
- the loop currently has zero agents.

Otherwise report fails with an error naming `h2a_loop_join` as the remedy.

### D3 — Launch specification is explicit and durable

An enrolled or planned loop agent MAY carry:

```ts
interface H2ALoopLaunchSpec {
  profile: "claude" | "codex"; // only profiles supported by structured h2a run V1
  workspace: string; // absolute, existing, durable directory outside /tmp
  prompt: string;    // non-empty; never placed in argv
  model: string;     // non-empty; no implicit default
  name: string;      // required safe unique session name; never derived
  effort?: "low" | "medium" | "high" | "xhigh";
  gateway?: "auto" | "required" | "off";
}
```

`gateway:"required"` is Claude-only. Codex rejects it because the current
gateway cannot truthfully apply that posture; Codex `auto` is effectively
`direct`.

Create/join MCP surfaces accept this structure directly. CLI create/join accept
it only through `--launch-stdin`, never as an argv JSON value. Partial or invalid specs are rejected before persistence. Existing loops and agents
without a launch spec remain readable and wakeable; they are never spawnable.

At action time the workspace must still be inside the controller startup
workspace or one of the loop's explicitly declared repository roots. The
persisted agent host must still equal the launch profile. Both are rechecked
immediately before spawn so a forged/stale state cannot widen launch authority.

### D4 — Wake first, run only from a complete launch spec

Fresh tmux presence with idle, paused, or out-of-tokens evidence continues to
use the last-moment human-guarded local tmux driver.

Missing/dead agents are launchable only when D3 is complete and valid at action
time. The canonical child invocation is an argv array equivalent to:

```text
h2a run <profile> <workspace> --prompt-stdin --background --json --no-attach --h2a
  --model <model> --name <name> [--effort <effort>] [--gw|--no-gw]
```

The prompt is written to child stdin. No shell is involved. Success requires a
zero exit, parseable JSON, the expected background-session result, and a
compatible runtime capability/version. The result must prove an interactive
background session, exact `%pane` target, positive PID, h2a sidecar, exact attach metadata, and the
effective `gateway|direct` posture (never the requested `auto` token).
Unsupported deployed runtimes fail closed and write a visible failed action.

The loop implementation depends only on the CLI contract and an injected
process seam, not on the MCP `h2a_run` implementation.

### D5 — One durable safety budget

For both wake and launch, `loop.action.applied` and `loop.action.failed` consume
one attempt and advance the latest-at timestamp. They are bounded per agent by:

- cooldown = `max(policy.tickMs, 300_000)`;
- budget = `policy.maxRelaunches`.

`loop.action.deferred` caused by the human typing guard consumes neither. The
journal is the source for replay; no volatile counter may widen the budget after
a controller restart.

### D6 — Observable failures, no invented continuity

Missing launch fields, an absent workspace, unsupported CLI capability,
runtime-version skew, invalid JSON, unsafe/duplicate session name, or child failure
must never be reported as an applied relaunch. The action is failed or skipped
with an actionable reason and remains bounded by D5 where an external attempt
was made.

The launcher does not claim that a new process has joined the loop. Enrollment
continues through the existing explicit `h2a_loop_join` contract, normally
driven by the launch prompt/plugin after the process starts.

## Compatibility

- Stored loops are additive: `launch` is optional.
- Core API callers may still build an empty loop for tests/staged orchestration;
  the stricter default is at MCP create.
- CLI `loop create --agent` remains valid without a launch spec.
- Existing applied/deferred action events remain replayable.
- The 2026-07-07 MVP non-launch rule is evolved only for explicitly launchable
  agents; no arbitrary or inferred spawn is introduced.

## Acceptance

1. Default MCP create cannot persist an accidental empty loop.
2. An intentional empty loop yields a stalled/actionable tick and can recover by
   join or explicit empty-loop `autoJoin` report.
3. Out-of-tokens/paused live tmux sessions wake through the guarded driver.
4. Failed and applied attempts survive restart and enforce cooldown/budget;
   deferrals do not consume either.
5. Missing/dead agents without a complete launch spec never spawn.
6. Complete launch specs invoke canonical `h2a run` with prompt on stdin and a
   strict JSON/capability check.
7. No `.track` write, shell concatenation, or prompt-in-argv exists in the diff.
