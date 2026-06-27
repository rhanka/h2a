# Objective Loop — h2a + track + remote

Status: draft
Date: 2026-06-26
Conductor: claude:a2a-cli:d36d7390005e
Repos: h2a/a2a-cli, track, remote

## Problem

Claude `/loop` is unreliable and Claude-centric. We need a durable, collaborative loop
primitive that can run an objective across one or more repositories, with multiple
agents and runtimes, without depending on one host's interactive loop feature.

## Goal

Provide tools in h2a + track + remote to create, supervise, relaunch, inspect and
complete an **Objective Loop**: a durable execution context for a collaborative
objective.

The objective may be backed by **one or many shared track scopes/items/WPs**. This is
important: an Objective Loop is not necessarily one track item; it can be a bundle of
common tracks spanning repos and workspaces.

## Non-goals for MVP

- Full autonomous project manager.
- Hidden daemon by default.
- Replacing track's source-of-truth for work state.
- Making h2a spawn arbitrary processes directly. h2a asks remote/runtime to spawn.

## Roles by subsystem

### h2a

- Loop identity and state.
- Agent enrollment.
- Presence and wake.
- Inbox/outbox coordination.
- Decisions and blockages.
- Conductor election / relaunch policy.
- Durable loop journal.

### track

- Repo-local source of truth for WP/items/decisions/blockers/acceptance/evidence.
- Stable explicit aggregate refs consumed by Objective Loop.
- Pure per-workspace projections: report/status/canevas/decision dossier.
- Optional pure multi-ref rollup helper in v2; no cross-repo objective mutation ownership in track v1.
- Human/machine provenance for track-local artifacts.

### remote

- Runtime registry.
- Launch local/remote agents.
- List subagents launched by remote.
- Inspect/attach/logs for local tmux and remote Pods.
- Reconcile jobs, sessions, h2a instances, track refs and loop ids.
- Hosts: claude, codex, agy, gemini, mistral/vibe where available.

## Core model

```ts
type LoopStatus =
  | 'created'
  | 'running'
  | 'waiting-human'
  | 'waiting-agent'
  | 'stalled'
  | 'degraded'
  | 'done'
  | 'failed'
  | 'cancelled';

type AgentStatus =
  | 'planned'
  | 'launching'
  | 'running'
  | 'idle'
  | 'working'
  | 'blocked'
  | 'awaiting-decision'
  | 'rate-limited'
  | 'out-of-tokens'
  | 'dead'
  | 'done'
  | 'failed'
  | 'cancelled';

type TrackRef = {
  system: 'track';
  repoKey: string;
  workspace: string;
  aggregateKind: 'item' | 'decision' | 'blocker' | 'criterion' | 'evidence' | 'wp';
  aggregateId: string;
  role: 'target' | 'dependency' | 'blocker' | 'evidence' | 'decision-gate' | 'acceptance' | 'review' | string;
  baselineCommit?: string; // baseline is per repo/ref; never global for all repos.
};

type ObjectiveLoop = {
  id: string; // h2a-owned objective aggregate id.
  ownerSystem: 'h2a';
  name: string;
  goal: string;
  status: LoopStatus;
  repos: Array<{ path: string; role?: string; remotePath?: string }>;
  refs: TrackRef[]; // IMPORTANT: one objective can bind many shared track refs.
  agents: LoopAgent[];
  policy: LoopPolicy;
  createdAt: string;
  updatedAt: string;
};

type LoopAgent = {
  id: string;
  host: 'claude' | 'codex' | 'agy' | 'gemini' | 'mistral' | 'opencode' | 'shell';
  driver?: string; // e.g. mistral can be backed by vibe if that is the actual CLI.
  role: 'conductor' | 'architect' | 'implementer' | 'reviewer' | 'critic' | 'tester' | string;
  placement: 'local' | 'remote' | 'auto' | 'headless-local' | 'headless-remote' | 'interactive-local' | 'interactive-remote';
  status: AgentStatus;
  h2aInstance?: string;
  remoteAgentId?: string;
  remoteJobId?: string;
  trackRefs?: TrackRef[];
};

type LoopPolicy = {
  tickMs: number;
  idleMs: number;
  maxRelaunches: number;
  requireHumanTypingGuard: true;
  closeWhenRefsSatisfied: boolean;
  successCriteria: 'all-targets-accepted' | 'all-targets-done-or-waived' | 'policy-expression';
  decisionGatePolicy: 'all-go-or-waived' | 'advisory-only';
};
```

## Existing primitives to reuse

Objective Loop is not greenfield. It must reuse and clarify its relation to existing h2a/remote primitives:

- h2a `drumbeat` already records paused/blocked/out-of-tokens state and has relance paths. Loop tick should consume or delegate to drumbeat where appropriate, not duplicate stall state.
- h2a `conductor-launch` already emits launch requests when work is stalled and no conductor is live. Loop conductor management should build on this.
- h2a `wake`/drive local-tmux paths already have the human-typing guard. Any older tmux relaunch path used by loop must be upgraded to the same guard before loop can inject into interactive panes.
- remote `jobs`, `run`, `ls`, `attach`, `wake-request`, `conductor-launch` already cover pieces of the runtime. `remote agents` is a compatibility projection over those surfaces, not a replacement.

## h2a CLI surface

MVP:

```sh
h2a loop create --name <n> --goal <text> --repo <path[:role]> --track <ref> [--agent <host:role:placement>]
h2a loop list
h2a loop status <loopId> [--json]
h2a loop agents <loopId> [--json]
h2a loop attach <loopId> --agent <selector>
h2a loop logs <loopId> --agent <selector>
h2a loop tick <loopId>
h2a loop watch <loopId> [--interval-ms <n>]
h2a loop decide <loopId> <decisionId> <answer>
h2a loop stop <loopId>
```

Storage:

```txt
.h2a/loops/<loopId>/state.json
.h2a/loops/<loopId>/events.jsonl
.h2a/loops/<loopId>/objective.md
```

Events:

- `loop.created`
- `loop.track-linked`
- `loop.agent-added`
- `loop.agent-launched`
- `loop.tick`
- `loop.agent-wake-requested`
- `loop.agent-stalled`
- `loop.decision-requested`
- `loop.done`
- `loop.failed`

## remote CLI surface

Remote must first expose an agent registry projection. This is the foundation. It MUST NOT become a second source of truth: it reconciles existing `remote jobs`, `remote run`, `remote ls`, local tmux, remote Pods/control-plane sessions, h2a sessions and loop metadata into one machine-readable view.

```sh
remote agents ls [--json]
remote agents inspect <agentId> [--json]
remote agents attach <agentId>
remote agents logs <agentId>
remote agents stop <agentId>
remote agents wake <agentId>
remote agents reconcile [--json]
remote agents launch --profile <claude|codex|agy|gemini|mistral> --placement <local|remote|auto|...> --loop <loopId> --role <role> --cwd <path> --instruction <text>
```

`remote agents ls --json` should have a documented JSON schema and exit-code contract. It should reconcile:

- `remote jobs`
- local `remote run` tmux sessions
- remote control-plane sessions / Pods
- h2a live sessions
- loop ids
- track refs

Minimal JSON:

```json
{
  "id": "h2a-loop-codex-impl",
  "profile": "codex",
  "driver": null,
  "state": "running",
  "location": "local",
  "interactive": true,
  "headless": false,
  "cwd": "/home/antoinefa/src/remote",
  "tmux": { "session": "remote-h2a-loop-codex-impl", "pane": "%42" },
  "remote": { "sessionId": null, "pod": null },
  "h2a": { "instance": "codex:job:h2a-loop-codex-impl" },
  "loop": { "id": "loop:objective-runtime", "role": "implementer" },
  "trackRefs": [{ "workspace": "remote", "wp": "WP-loop-runtime" }],
  "attachable": true,
  "logsAvailable": true,
  "lastActivityAt": "2026-06-26T00:00:00.000Z"
}
```

## track requirements

Track counter-proposal accepted: track should NOT own a first-class cross-repo Objective aggregate in v1. h2a/Objective Loop owns the objective aggregate; track provides explicit refs and pure projections. An objective may bind many refs:

```json
{
  "objectiveId": "loop:objective-runtime",
  "ownerSystem": "h2a",
  "refs": [
    { "system": "track", "repoKey": "h2a", "workspace": "h2a", "aggregateKind": "wp", "aggregateId": "WP-loop", "role": "target", "baselineCommit": "<h2a-commit>" },
    { "system": "track", "repoKey": "remote", "workspace": "remote", "aggregateKind": "wp", "aggregateId": "WP-agent-registry", "role": "target", "baselineCommit": "<remote-commit>" },
    { "system": "track", "repoKey": "track", "workspace": "track", "aggregateKind": "wp", "aggregateId": "WP-objective-rollup", "role": "dependency", "baselineCommit": "<track-commit>" }
  ]
}
```

Needed projections:

- v1: existing report/query/status/canevas per repo/workspace/baseline, called once per declared ref set.
- v1.5: optional `externalObjectiveRef`/`externalRef` metadata on local track artifacts where useful.
- v2: pure read-only multi-ref rollup helper: input refs + baseline map, output per-ref status and aggregate rollup. No mutation, no conductor, no cross-repo persistence inside track.

Objective lifecycle, global status and close policy remain h2a-owned.

## Relaunch rules

`h2a loop tick`:

1. Read loop state.
2. Read remote agents registry.
3. Read h2a sessions/inbox.
4. Read track refs rollup.
5. If an agent is missing and work pending: ask remote to launch.
6. If an agent is idle beyond policy and work pending: ask remote to wake.
7. If an agent is blocked: create/route decision.
8. If remote is unreachable: mark loop degraded, do not invent state.
9. If all track refs accepted/done: close loop.

## Mandatory safety invariant

Any wake/instruction injection into an interactive tmux pane MUST use the human-typing
guard shipped in h2a 0.74.0: if a human was active recently in the pane's session,
defer and retry later; do not mark the wake processed. This applies to h2a wake/drive, drumbeat relance, remote wake-request, remote agents wake, and any loop tick/watch path that sends keys or resumes a session.

## Machine-readable contracts

MVP must include explicit schemas/tests for:

- `remote agents ls --json` list envelope.
- `remote agents inspect <id> --json` detail envelope.
- h2a `loop` CLI verbs in the existing h2a CLI contract.
- exit codes: local-only remote control-plane unavailable must degrade gracefully for `remote agents ls --json`; attach/logs missing target should be non-zero with structured error.
- compatibility: existing `remote jobs` and `remote ls` continue to work.

## MVP order

1. remote: `remote agents ls/inspect/attach/logs` over existing jobs + local tmux.
2. h2a: loop storage + `create/list/status/agents`.
3. h2a: `attach/logs` delegating to remote agents.
4. h2a: `tick/watch` with conservative relaunch/wake.
5. track: objective multi-ref rollup/canevas.
6. remote: launch API for loop agents local/remote.
7. release and deploy: publish remote, h2a, track; then update global and remote Pods/plugins.

## Review questions

- DECIDED with track: h2a loop state stores structured typed refs from day one; no globbing and no implicit repo discovery.
- Does remote prefer extending `remote jobs` or adding first-class `remote agents`?
- What is the minimum attach/log contract that works for local tmux and remote Pods?
- DECIDED with track: h2a owns the objective aggregate; track only exposes refs/projections and optional pure rollups.
- How should Mistral be modeled if the real local CLI is `vibe`?

## Review consensus amendments v0.2

The architecture and implementation reviews converge on the following binding amendments.

### A. Ownership boundary

Objective identity and ref membership are h2a-owned. Track never owns or mutates
`ObjectiveLoop`; it exposes pure/advisory projections over supplied canonical refs.
Remote never decides loop status, never closes objectives, and never mutates track refs.

- h2a owns: objective id, lifecycle, journal, enrolled agents, policy, authoritative refs.
- track owns: repo-local work state, acceptance, decisions, blockers, evidence, provenance.
- remote owns: runtime facts and runtime actions only.

### B. Canonical objective refs

Refs must be structured and round-trippable from day one. Opaque strings may be accepted
as CLI shorthand only if immediately parsed into this canonical form.

```ts
type ObjectiveRef =
  | TrackObjectiveRef
  | { system: string; locator: string; role: ObjectiveRefRole; metadata?: Record<string, unknown> };

type TrackObjectiveRef = {
  system: 'track';
  locator: string; // canonical stable string, round-trippable from fields below
  repoKey: string;
  workspace: string;
  aggregateKind: 'wp' | 'item' | 'decision' | 'blocker' | 'criterion' | 'evidence' | 'scope';
  aggregateId: string;
  role: ObjectiveRefRole;
  baselineCommit: string;
};

type ObjectiveRefRole =
  | 'primary'
  | 'target'
  | 'dependency'
  | 'blocker'
  | 'decision-gate'
  | 'acceptance'
  | 'review'
  | 'evidence'
  | 'advisory';
```

Rules:

- `locator`, `system`, `role`, `aggregateKind`, `aggregateId`, `repoKey`, `workspace`, and
  `baselineCommit` are required for track refs.
- Baselines are per repo/ref; never one global commit for all repos.
- No globbing and no implicit repo discovery.
- Invalid/stale/unreachable primary refs prevent automatic close.
- Non-track refs are allowed via typed refs, but MVP requires only `system:'track'`.

### C. Deterministic multi-ref completion semantics

`h2a loop tick` computes global objective status from declared refs and policy. Minimum
rollup table:

| Condition | Objective outcome |
| --- | --- |
| all primary/target refs done and accepted pass, all required decision gates go/waived, no open blocking h2a blockage | eligible-for-close |
| any primary/target ref rejected/fail | failed or waiting-human, according to policy |
| any primary/target ref stale/unknown/unreachable | degraded; not done |
| dependency ref pending | waiting-agent or stalled |
| blocker ref open | blocked |
| review ref pending | waiting-review; not close unless policy allows |
| decision-gate open | waiting-human/agent; not done |
| remote degraded but all track refs accepted | accepted-but-supervision-degraded; require explicit close or final evidence |
| advisory/evidence refs stale | degraded only if policy marks them required |

Default MVP policy: `all primary/target refs accepted pass`, `decisionGatePolicy=all-go-or-waived`,
`review` refs required only if explicitly marked required.

### D. Remote agent registry is a projection, not authority

`remote agents` is a compatibility projection over existing remote runtime surfaces:

- `remote jobs`
- `remote run` / `remote ls`
- local tmux sessions/panes
- remote Pods/control-plane sessions
- h2a direct or mirrored sessions, with existing fencing/anti-resurrection semantics
- launch metadata mirrored from h2a loop enrollment

Remote returns runtime facts plus provenance, not policy decisions.

```ts
type RemoteAgent = {
  id: string;
  kind: 'job' | 'session' | 'pod' | 'tmux' | 'composite' | 'unmanaged';
  profile: string;
  driver?: string;
  state: 'starting' | 'running' | 'idle' | 'dead' | 'failed' | 'done' | 'unknown';
  location: 'local' | 'remote' | 'mixed' | 'unknown';
  cwd?: string;
  loop?: { id: string; agentId?: string; role?: string };
  trackRefLocators?: string[];
  h2a?: { instance?: string; sessionId?: string; presenceKind?: 'direct' | 'mirror' };
  job?: { id?: string; state?: string };
  tmux?: { session?: string; window?: string; pane?: string; paneDead?: boolean };
  pod?: { namespace?: string; name?: string; container?: string; phase?: string };
  capabilities: {
    attach: boolean;
    logs: boolean;
    wake: boolean;
    stop: boolean;
    relaunch: boolean;
  };
  sources: Array<{ kind: string; id: string; freshness: 'fresh' | 'stale' | 'unknown'; confidence: 'exact' | 'partial' | 'unmanaged' }>;
  conflicts: Array<{ field: string; values: Array<{ source: string; value: unknown }> }>;
  lastActivityAt?: string;
};
```

Merge/precedence rules:

1. Exact `remoteAgentId` / job id wins for runtime identity.
2. h2a `instance + sessionId` links presence but does not override runtime state if stale.
3. tmux pane id identifies local interactive attachment; dead panes set `capabilities.attach=false`.
4. Pod uid/name identifies remote attachment; ended Pods remain inspectable only if logs exist.
5. Conflicts are reported in `conflicts[]`; remote does not silently choose loop policy state.

### E. Remote JSON contract

`remote agents ls --json` returns a list envelope, not a single object:

```json
{
  "kind": "remote-agents-list",
  "version": 1,
  "agents": [],
  "warnings": [],
  "degraded": false
}
```

`remote agents inspect <id> --json`:

```json
{
  "kind": "remote-agent-detail",
  "version": 1,
  "agent": {},
  "related": {
    "jobs": [],
    "sessions": [],
    "logs": []
  },
  "warnings": []
}
```

Exit-code contract:

- `0`: success, even if remote control-plane unavailable but local projection succeeded with `degraded=true`.
- `1`: target not found / invalid arguments / no such attach/log source.
- `2`: unavailable capability.
- `3`: transport/control-plane failure when requested source is mandatory.
- `4`: unsafe action deferred, e.g. human-active pane for injection.

Stderr must be human-readable; machine state stays on stdout JSON for `--json`.

### F. Attach/logs source behavior

MVP options:

```sh
remote agents logs <id> [--tail <n>] [--since <iso>] [--follow]
remote agents attach <id> [--source tmux|pod|job|auto]
```

Behavior:

- local tmux attach: attach/switch to tmux session/pane.
- local tmux logs: capture pane/history; if pane dead, return last captured log if available.
- headless job logs: output log file if present, otherwise structured `logs=false` error.
- remote Pod attach: use control-plane/Pod attach where available; otherwise `unavailable capability`.
- remote Pod logs: stream/tail pod/container logs if control-plane reachable.
- no-TTY attach: non-zero with structured error and recommendation to use logs.

### G. Action model: wake/relaunch/replacement/injection are distinct

Events:

- `loop.agent-wake-requested`
- `loop.agent-relaunch-requested`
- `loop.agent-replacement-spawn-requested`
- `loop.agent-instruction-injection-requested`

Remote action outcomes:

```ts
type RemoteActionOutcome =
  | 'injected'
  | 'deferred-human-active'
  | 'not-wakeable'
  | 'not-found'
  | 'queued'
  | 'failed'
  | 'unauthorized'
  | 'capability-unavailable';
```

A simple wake must never trigger a headless replacement spawn unless the loop policy
explicitly permits replacement.

### H. Human-typing safety boundary

The human-typing guard is mandatory at the last possible boundary before any tmux
send-keys or equivalent interactive injection. It applies to:

- h2a wake/drive
- drumbeat local relaunchers
- remote wake-request
- remote agents wake
- remote agents launch when reusing an existing interactive pane
- h2a loop tick/watch paths

If deferred due to human activity, the action remains pending and retryable.

### I. MVP release gates and tests

M0 spec/contract:

- h2a loop CLI contract entries for `create/list/status/agents/attach/logs`.
- remote JSON schemas for `agents ls/inspect`.
- tests for schema stability and exit codes.

M1 read-only supervision:

- h2a loop storage/status with structured refs.
- h2a loop agents joins remote projection + h2a sessions + track projections.
- remote agents projection over existing jobs/local tmux.
- tests for conflict reporting and degraded control-plane.

M2 conservative action:

- h2a loop tick can request wake/launch via existing wake-request/conductor-launch.
- no replacement spawn from wake unless explicit policy.
- typing-guard tests for every tmux injection path.

M3 track helper optional:

- pure read-only multi-ref rollup helper if needed; no objective mutation in track.

