# Objective-loop h2a v0.3 MVP — plugin objective + anti-stall relance

Status: ratified-for-mvp-implementation-v0.3.2
Date: 2026-07-07
Scope: h2a objective-loop MVP, available from h2a-enabled CLIs via MCP/plugin
Supersedes-for-MVP: the launch/attach/logs-first interpretation of `2026-06-26-objective-loop-h2a-track-remote.md`
Non-goal: remote registry / attach / process logs / respawn / conductor election

## 1. Goal

The MVP objective-loop lets one or more h2a agents reach a user-defined objective without silently stalling.

A user, from any h2a-enabled CLI, MUST be able to:

1. create an objective loop;
2. enroll one or more agents;
3. let agents report useful progress;
4. run/tick a controller that detects stalled agents;
5. relance/wake live stalled agents;
6. stop or mark the objective done;
7. inspect loop status from the plugin.

The MVP is not an agent launcher. It wakes existing live agents. If no live wakeable agent exists, h2a records a visible stalled/blockage/escalation state instead of spawning replacements.

## 2. Design constraints

- Plugin-first: the control surface MUST be exposed through h2a MCP/plugin tools, not only through local CLI verbs.
- CLI parity: each plugin write/control operation SHOULD have a CLI equivalent for local scripts and tests.
- Append-only: loop state changes are journaled as events; derived status is replayable.
- Pure core / imperative shell: decision logic stays deterministic and IO-free; tmux/presence/inbox effects live in the shell.
- Human guard: wake injection MUST re-check human typing/activity at the last possible shell boundary. A deferred wake does not consume relance budget or cooldown.
- Progress is not presence: liveness proves an agent can receive a wake; it does not prove the objective is progressing.
- Track remains the work/status source of truth: the loop MUST NOT create a divergent backlog, item state machine, acceptance model, or shadow tracker. A loop is an orchestration aggregate over explicit `track` refs, potentially spanning several workspaces and repositories; h2a stores the objective id, enrolled agents, policy and journal, while work realization/acceptance/blockers stay in track projections.

## 3. Minimal data model

A loop has:

```ts
type LoopStatus = 'active' | 'done' | 'stopped' | 'blocked';
type LoopMode = 'mono' | 'collective';
type SuccessCriteria =
  | 'explicit-done'
  | 'all-targets-accepted'
  | 'all-targets-done-or-waived';

interface ObjectiveLoopMvp {
  id: string;
  name?: string;
  goal: string;
  mode: LoopMode;
  status: LoopStatus;
  refs?: string[];
  successCriteria: SuccessCriteria;
  agents: LoopAgentEnrollment[];
  policy: LoopRelancePolicy;
  doneDeclaredBy?: DoneDeclaration;
}

interface LoopAgentEnrollment {
  // Stable per-loop participant id. Defaults to `instance` when not provided.
  agentId: string;
  instance: string;
  role?: 'owner' | 'participant' | 'conductor'; // conductor is reserved in MVP, no election semantics.
  required?: boolean; // default true in mono, false in collective unless owner.
  joinedAt: string;
}

interface LoopRelancePolicy {
  tickMs: number;        // default 60_000
  idleMs: number;        // default 900_000
  cooldownMs: number;    // default max(tickMs, 300_000)
  maxRelances: number;   // default 3 per agent
}

interface DoneDeclaration {
  by: string;            // h2a instance id or 'human'
  at: string;
  note?: string;
  overrideRefs?: boolean;
}
```

Default success criteria:

- if no target refs are supplied: `explicit-done`;
- if target refs are supplied: `all-targets-accepted` unless explicitly configured otherwise;
- `explicit-done` MUST NOT silently bypass target refs. A target-ref override requires an explicit human-authored, journaled declaration with `overrideRefs: true`.

## 4. Events

The MVP introduces or requires these append-only events:

- `loop.created`
- `loop.agent-joined`
- `loop.agent-report`
- `loop.done-declared`
- `loop.stopped`
- `loop.resumed`
- `loop.tick-planned`
- `loop.action.applied`
- `loop.action.deferred`
- `loop.agent-stalled`
- `loop.blocked`, if required agents are all stalled/non-live/budget-exhausted according to §7.

`loop.agent-report` records useful progress, not heartbeat-only presence. It SHOULD include `{ agentId, instance, note, at }` and MAY include references to artifacts/commits/tasks.

## 5. Plugin/MCP control surface

The h2a plugin MUST expose these tools:

### `h2a_loop_create`

Input:

```json
{ "name": "optional", "goal": "required", "mode": "mono|collective", "refs": [], "agents": [], "policy": {} }
```

Output includes the new `loopId` and current status.

### `h2a_loop_join`

Input:

```json
{ "loopId": "required", "instance": "optional", "agentId": "optional", "role": "optional", "required": "optional" }
```

`instance` is explicit when provided. If absent, h2a may infer the calling instance from the current h2a session/environment only when exactly one caller instance is known; ambiguity is an error. `agentId` defaults to `instance` and MUST be stable and unique within the loop. A second join with the same `agentId` is idempotent only if the payload is identical; otherwise it is rejected unless a future explicit update verb exists.

### `h2a_loop_report`

Input:

```json
{ "loopId": "required", "instance": "optional", "agentId": "optional", "note": "required" }
```

This records useful progress and updates `progressActivityAt` for the agent. A mere presence heartbeat MUST NOT call this automatically. `instance` resolution follows the same rule as `join`; if one instance maps to multiple enrolled `agentId`s, the caller MUST provide an unambiguous `agentId` once the CLI/tool schema supports it, otherwise the report is rejected.

### `h2a_loop_done`

Input:

```json
{ "loopId": "required", "instance": "optional", "agentId": "optional", "note": "optional" }
```

Without target refs, this satisfies `explicit-done`. With target refs, an agent/plugin `done` records `loop.done-declared` but does not close the loop unless refs are satisfied.

Target-ref override is deliberately NOT exposed through MCP/plugin in the MVP. It is CLI-only, requires an interactive human confirmation flag, and writes `loop.done-declared` with `{ by: "human", overrideRefs: true }`. Non-interactive agents MUST NOT forge human override.

### `h2a_loop_stop`

Input:

```json
{ "loopId": "required", "reason": "optional" }
```

Sets terminal status `stopped`; subsequent ticks do not wake agents.

### `h2a_loop_tick`

Input:

```json
{ "loopId": "required", "execute": false, "now": "optional ISO-8601 dry-run only" }
```

Dry-run by default. With `execute: true`, applies safe shell actions such as wake/close/stalled escalation and MUST use the real shell clock, not caller-provided `now`.

### Resume

`resume` is CLI-only in the MVP because it is an operator/human remediation action, not an autonomous agent action. It is valid only from `blocked`; attempting to resume `active`, `done`, or `stopped` is an explicit error.

```sh
h2a loop resume <loopId> --reason <text> --confirm-human-resume
```

It writes `loop.resumed` with `{ by: "human", reason, at }`, resets loop status to `active`, and starts a new relance epoch. It is not automatic and does not spawn agents. No `h2a_loop_resume` MCP tool is exposed in the MVP.

### Existing read tools

`h2a_loop_list` and `h2a_loop_status` remain. `status` SHOULD include recent events, last tick observation, enrolled agents, `doneDeclaredBy`, relance counters, and stalled/blockage state.

## 6. CLI parity

The CLI SHOULD expose equivalent verbs:

```sh
h2a loop create --goal <text> [--name <name>] [--mode mono|collective] [--ref <ref>...]
h2a loop join <loopId> [--instance <id>] [--agent-id <id>] [--role <role>]
h2a loop report <loopId> --note <text> [--instance <id>] [--agent-id <id>]
h2a loop done <loopId> [--note <text>] [--instance <id>] [--agent-id <id>]
h2a loop done <loopId> --override-refs --confirm-human-override  # CLI-only, interactive/human path
h2a loop stop <loopId> [--reason <text>]
h2a loop tick <loopId> [--execute]
h2a loop run <loopId> [--interval-ms <n>]
h2a loop resume <loopId> --reason <text> --confirm-human-resume
```

`h2a loop run` is a foreground controller that periodically executes ticks until the loop becomes terminal (`done`, `stopped`, `blocked`) or the process is interrupted. `--interval-ms` overrides `policy.tickMs` for that runner only; it does not mutate loop policy. The MVP does not require a hidden daemon.

## 7. Relance / anti-stall semantics

### 7.1 Refs evaluation MVP

When refs are present, the pure core receives a precomputed `refsOutcome` from the shell/track adapter rather than reading track directly. The MVP adapter supports h2a/track item ids only:

```ts
interface RefsOutcome {
  allAccepted: boolean;       // all target refs are realization done AND acceptance pass
  allDoneOrWaived: boolean;   // reserved; may equal allAccepted until waive support exists
  findings?: string[];
}
```

`all-targets-accepted` closes only when `refsOutcome.allAccepted === true`. `all-targets-done-or-waived` is reserved unless the adapter can prove waived state; otherwise it MUST NOT close. No MCP waive tool is part of the MVP.

### 7.2 Tick execution idempotence and clock

Dry-run ticks MAY accept an injected `now` for reproducible planning. Executing ticks (`execute: true` / `h2a loop run`) MUST ignore caller-provided `now` and use the shell clock.

An executing tick MUST hold a per-loop lock/lease while applying effects. Before each wake injection, the shell MUST reread the journal and recompute the agent cooldown/budget guard.

Applied wake idempotence is based on deterministic `actionId = hash(loopId, agentId, "wake", relanceEpoch, nextRelanceOrdinal)`, where `nextRelanceOrdinal = appliedRelanceCount + 1` after replaying the journal. If an `applied` event with that `actionId` already exists, the shell MUST NOT inject again.

Deferred wake events are intentionally retryable: `loop.action.deferred` MUST use a separate `attemptId = hash(loopId, agentId, "wake-deferred", relanceEpoch, tickId)` and MUST NOT block a future wake after human activity stops. `tickId` is a unique id generated and journaled for each executing tick, so deferred attempts are visible and intentionally at-least-once. Deferred events do not increment `appliedRelanceCount`, do not update `lastWakeAppliedAt`, and do not consume cooldown.

This is an at-most-once best-effort contract for applied effects under concurrent controllers and crash/retry while preserving retryability of human-guard deferrals.

### 7.3 Agent activity and relance planning

The pure tick input MUST distinguish:

```ts
interface AgentActivity {
  live: boolean;                 // can receive wake now
  presenceLastSeenAt?: number;   // liveness only
  progressActivityAt?: number;   // useful progress from reports/events
  lastWakeAppliedAt?: number;
  appliedRelanceCount: number;   // since latest progress report or resume epoch
  relanceEpoch: number;          // increments on resume and on progress reset
}
```

A live agent is wakeable only if h2a has a concrete local wake path, e.g. a fresh presence/session with tmux context. Presence alone is not progress.

For each enrolled agent while the loop is `active` and not complete:

1. If `live === false`: emit/plan `loop.agent-stalled` for that agent and visible escalation; do not spawn.
2. Else if no `progressActivityAt` exists, use `joinedAt` or loop creation time as the initial progress baseline.
3. If `now - progressActivityAt <= idleMs`: no relance.
4. If `now - lastWakeAppliedAt <= cooldownMs`: no relance.
5. If `appliedRelanceCount >= maxRelances`: mark that agent stalled and escalate.
6. Otherwise plan a `wake` action with `nextRelanceOrdinal = appliedRelanceCount + 1`.

A successful `loop.agent-report` that records useful progress resets that agent's `appliedRelanceCount` to 0 for future planning and advances that agent's relance epoch monotonically. Epochs are per-agent monotone counters; resume advances each still-enrolled agent epoch to at least `max(currentAgentEpoch, loopResumeEpoch) + 1`. `loop.resumed` starts a new loop relance epoch and clears stalled status/counters for agents still enrolled; it does not delete historical events.

Wake action shell behavior:

- re-check human activity immediately before injection;
- if human-active, record `loop.action.deferred` with reason `human-active`; do not consume budget/cooldown;
- if injection succeeds, record `loop.action.applied` with action `wake`, agent id, instance, and target;
- failed injection records a visible failure/stalled event and does not silently loop forever.

Mono vs collective:

- mono: one owner/participant is expected; relance that agent. If the required mono agent is non-live or exhausts relance budget, the loop becomes `blocked`.
- collective: relance each stalled live participant independently with per-agent cooldown/budget. A single stalled optional participant does not block the loop while another required/non-stalled participant can still act. The loop becomes `blocked` only when every required enrolled agent is stalled/non-live/budget-exhausted, or when there are no enrolled agents capable of progress. No quorum or conductor election in MVP.

`blocked` is terminal for automatic wake: ticks MUST NOT wake agents while blocked. Recovery is explicit and CLI-only: a human/operator may run `h2a loop resume <loopId> --confirm-human-resume` after fixing enrollment/session state. Resume writes `loop.resumed`, starts a new relance epoch, resets relance counters/stalled flags for still-enrolled agents, and does not erase prior history.

### 7.4 Presence-aware wake amendment (2026-07-09)

The pure tick core MUST receive h2a presence as a first-class plain-data input, independently from the runtime `remote-agents` projection. Interactive Claude/Codex sessions may be live on the h2a bus, with a fresh `launchContext.tmux`, without appearing in `@sentropic/h2a-runtime` projection. In that case the loop MUST plan a `wake`, not a `request-launch`.

Decision precedence while work is pending:

1. If the enrolled agent has fresh h2a presence with `launchContext.tmux`, and the runtime projection is missing, degraded, dead, or idle/detached, plan `wake`.
2. If the enrolled agent has fresh h2a presence with `launchContext.tmux` but the runtime projection says the agent is actively running, do not wake.
3. If no wakeable presence exists but the runtime projection shows the agent idle/detached, plan `wake`.
4. If no wakeable presence exists and the non-degraded runtime projection is missing/dead, plan `request-launch`.
5. If the runtime projection is degraded and no wakeable presence exists, do not invent a launch request from incomplete data.

`request-launch` remains ASK-only: it records a visible request/escalation path and MUST NOT spawn an agent. The MVP implementation continues to execute local wakes through the existing guarded local tmux shell driver. Inbox/self-wake delivery may replace or augment that shell path later, but it is not required by this amendment.

Degradation semantics are source-specific:

- degraded track/ref rollup is closure-critical and remains a hard no-execute guard;
- degraded runtime agent projection is not a global no-execute guard when fresh h2a presence proves a local tmux wake path;
- degraded runtime projection MUST be surfaced in the tick plan so operators can distinguish presence-only wake from fully healthy runtime planning.

## 8. Completion semantics

A loop becomes `done` when:

- `successCriteria = explicit-done` and `loop.done-declared` exists; or
- target refs satisfy the configured track/ref policy; or
- a human-authored override explicitly closes despite refs.

After terminal status (`done`, `stopped`, `blocked`), ticks MUST NOT wake agents. `blocked` can only return to `active` via explicit CLI-only `loop.resumed` by a human/operator after remediation; it never resumes just because presence later reappears. `loop.agent-report` after `done`, `stopped`, or `blocked` is rejected unless the loop has first been resumed from `blocked`.

## 9. Exclusions from MVP

Explicitly out of scope:

- automatic launch/respawn/replacement of agents;
- remote agents registry as source of truth;
- `loop attach` and process-log retrieval beyond existing status/journal;
- conductor election and collective quorum;
- arbitrary policy expressions;
- hidden background daemon;
- non-local wake paths unless already represented by a safe h2a shell driver.

## 10. Implementation plan

### PR1 — Durable spec + CLI/MCP surface

Add plugin tools and CLI verbs for create/join/report/done/stop/tick. Preserve existing list/status. Add schema and contract tests. Document per-CLI plugin configuration as a required MVP deliverable.

### PR2 — Pure core: explicit done + progress idle

Extend the loop fold/tick input with done declarations, agent enrollments, progress activity, relance counters, terminal states, and deterministic wake/stalled planning. Add table-driven pure tests.

### PR3 — Imperative shell: wake and escalation

Wire planned wake actions to the existing local tmux wake driver where available. Enforce human guard, cooldown, budget, action events, and visible stalled/blockage/escalation on dead agents or exhausted relance budget.

### PR4 — Foreground controller

Implement `h2a loop run` as a foreground periodic executor that exits on terminal loop state and respects stop/done/blockage.

### PR5 — Plugin availability docs/smokes

Provide documented plugin setup/smoke for supported CLIs (at least Claude, Codex, Gemini, agy/antigravity) so the MVP requirement “from all h2a-enabled CLIs” is testable.

## 11. Event payload minimums

PR1 contract tests MUST freeze minimal payloads:

- `loop.agent-joined`: `{ loopId, agentId, instance, role?, required?, at }`
- `loop.agent-report`: `{ loopId, agentId, instance, note, at, artifacts? }`
- `loop.done-declared`: `{ loopId, by, note?, overrideRefs?, at }`
- `loop.tick-planned`: `{ loopId, tickId, now, execute, plannedActions[] }`
- `loop.action.applied`: `{ loopId, actionId, action, agentId?, at, target? }`
- `loop.action.deferred`: `{ loopId, attemptId, action, agentId?, reason, at }`
- `loop.agent-stalled`: `{ loopId, agentId, reason, at }`
- `loop.blocked`: `{ loopId, reason, stalledAgents, at }`
- `loop.created`: `{ loopId, name?, goal, mode, refs?, policy, at }`
- `loop.stopped`: `{ loopId, reason?, at }`
- `loop.resumed`: `{ loopId, by: "human", reason, at, relanceEpoch }`

## 12. Review evidence

This v0.3.2 text was officially reviewed after materialization:

- Fable5 direct Anthropic review: `accept-with-changes`, ratifiable for MVP implementation, no blocking issues.
- Codex 5.5 xhigh review: `accept-with-changes`, ratifiable for MVP implementation, no blocking issues.

The remaining reviewer notes are implementation clarifications to freeze in PR1/PR2 contract tests, not ratification blockers.

## 13. Ratification criteria

This spec is ratifiable for MVP implementation if reviewers agree that:

1. objective creation/enrollment/progress/done is plugin-accessible;
2. relance is based on useful-progress idle, not presence heartbeat;
3. wake is local/live-agent-only in MVP;
4. no auto-spawn/remote-registry/attach/logs/conductor behavior is required for MVP;
5. target refs, when present, are not silently bypassed by agent-declared done;
6. blocked/resume and concurrent execute tick semantics are deterministic.
