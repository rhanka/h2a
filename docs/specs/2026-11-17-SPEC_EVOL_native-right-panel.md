# SPEC EVOL — Retractable right panel for the native terminal (sessions, decisions, Track objectives and loops)

Date: 2026-11-17 · Revision: r2 full pass (owner: « reprends bien la spec »; supersedes r1 in this same file).
Status: specification only. This document adds no product code, no test code and no configuration.
Owner source: verbatim of 2026-11-17 (initial need, mockup **A · Tree + tabs**, owner notes, shortcut wish, then three addenda the same evening: mouse click, objective-loop default rule, native-loop engagement always explicit, multi-project objectives). Owner notes override the mockup wherever they differ.
Build alignment: lot L0 in §12 is word-for-word the scope of the parallel build lane (`feat/native-right-panel-l0`, read-only panel behind a default-OFF flag, F12 + click, sessions, decisions, 1-column collapsed marker, targeted for the next 0.98 release). Where that lane had already fixed a constant at spec time (flag names, width, strip), this spec adopts it and says so; everything else is contract for later lots.
Layout rule (owner, 2026-11-16): schemas first, no wall of text, long technical tables folded in annexes, no code in the body.

## Layout schema (mockup A, as amended by the owner notes and addenda)

```text
┌──────────────────────────────────────────────────────────┬─────────────────────────────┐
│ CLI (child PTY, reduced width)                           │ [core] [docs] [shared]      │  meta-workspace tabs
│                                                          │ ─────────────────────────── │
│                                                          │ SESSIONS                    │
│                                                          │ ●  conductor · claude  gw   │  ↻ obj build-098 · native ✓
│                                                          │ ◆* api · codex       direct │  * = decision/question/loop gap
│                                                          │ ✖* lane-3 · agy        gw   │  ↻ obj api-42 · NOT ENGAGED *
│                                                          │   ▸ 2 delegated (hidden)    │
│                                                          │ OBJECTIVES (meta-workspace) │
│                                                          │ ◎ build-098  h2a+track ↻ on │  one row per objective,
│                                                          │ ◎* api-42    api      ↻ off │  projects cited, §5.5
│                                                          │ DECISIONS / QUESTIONS       │
│                                                          │ ◆* D12 gateway posture  →   │
│                                                          │ ?* Q3  which base image  →  │
│                                                          │ TRACK · last-week           │
│                                                          │ 14 done · 3 blocked · …     │
│                                                          │ ┌─ selected session ──────┐ │
│                                                          │ │ (bottom sub-pane)       │ │
│                                                          │ └─────────────────────────┘ │
├──────────────────────────────────────────────────────────┴─────────────────────────────┤
│ claude · conductor · attached  J… I… L…  gw … requested→upstream · deleg lane-3,… ▸▸ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Collapsed mode (panel closed, feature enabled): the CLI keeps its width minus **one** reserved marker column, and the bottom bar carries the clickable toggle marker:

```text
┌────────────────────────────────────────────────────────────────────────────┬─┐
│ CLI (full width minus 1 column)                                            │*│  lit: another session needs attention
├────────────────────────────────────────────────────────────────────────────┴─┤
│ … bottom bar …  ▸▸  (click opens the panel; F12 too)                       │ │
└────────────────────────────────────────────────────────────────────────────┴─┘
```

Loop state is never implicit. Every session row resolves to exactly one of these displayed states (§5.2); `*` appears exactly on the rows that need the owner:

```text
no objective bound ──► "no objective"            (no loop expected, no *)
objective candidate ─► "objective available"     (unbound Track work exists; no * in v1, §5.2)
bound + engaged ─────► "↻ native" or "↻ h2a"     (mechanism named, last tick/verdict shown)
bound + NOT engaged ─► "↻ NOT ENGAGED *"         (the 19:05/19:10 alert case)
bound + unattended ──► "↻ unattended *"          (opted in, no fresh executor heartbeat)
bound + waiting ─────► "↻ waiting-human *"       (decision/question blocks the loop)
terminal ────────────► "↻ done / stopped / …"    (word shown, no *)
source unreadable ───► "loop unknown ?"          (never rendered as engaged or as clear)
```

## 1. Purpose, scope, non-goals

The bottom status bar (PR #443, merged) proved the pattern: the native terminal host reserves screen space the child CLI never sees and renders h2a state there. The owner asks for the same pattern on the right: a retractable panel that makes the fleet of sessions, the pending decisions/questions, the Track state **and the objective-loop state of every session** visible and actionable without leaving the current CLI — by keyboard **and by mouse click**.

In scope: one reserved right area in the native attach view (open panel + 1-column collapsed marker); read models reused from `h2a restore`, the status projection, the loops store and Track; per-session objective binding and explicit loop state, including objectives spanning several projects at meta-workspace level; engagement of loops through each CLI's native mechanism where one exists, with the h2a objective loop as the named fallback; a Track pane summarised only through the existing gateway; asynchronous decision answers over `h2a send`; a keyboard + mouse scheme that survives the owner's real terminal (VTE 0.84).

Out of scope: any implementation in this PR (lots in §12 are the implementation contract); a new provider, credential or network route; a second grouping, objective or loop store; silent auto-enrolment of loops (see §5.4 — the default rule is *expected + alerted + one action to engage*, never invisible enrolment); changes to Track's writer rules; tmux-hosted rendering beyond what existing projections report; mobile or web rendering.

## 2. Owner requirement register (source of truth for traceability)

Wording is condensed from the 2026-11-17 verbatim; R-numbers are this spec's stable ids. The full mapping requirement → section → lot → acceptance test is Annex C.

| # | Requirement | Source in the verbatim |
|---|---|---|
| R1 | Retractable right panel continuing the bottom-bar pattern in the native terminal | initial need |
| R2 | All sessions / workspaces visible, meta-workspace tabs on top to switch | initial need + mockup A |
| R3 | Clickable panel; shortcuts must not conflict with CLI shortcuts | initial need; made explicit for the mouse at ~18:55 (R15) |
| R4 | Pending/blocking decisions and other blocking or question states visible at a glance | initial need |
| R5 | From a decision, reach its dossier (md file, Sentropic artifact, Claude artifact) | initial need + owner notes (R18) |
| R6 | Track report over a chosen period, summarised by a low-cost third-party LLM from the recent status | initial need |
| R7 | Decisions answerable asynchronously w.r.t. sessions: answer recorded, concerned LLM informed by h2a message | initial need |
| R8 | Meta-workspaces: homogeneous sets of tabs across several projects/sessions, like `h2a restore` window groups | initial need |
| R9 | “In progress” sessions = the active sessions, as `h2a restore` sees them | owner note |
| R10 | Each session switchable (gw) with a model-mapping switch | owner note; `/gw` restarts the same session (shortcut wish) |
| R11 | Objective loops and sub-sessions browsable; sub-sessions hidden by default from the human main list | owner note |
| R12 | Colour **plus** `*` marks attention on a session's decision/question stakes | owner notes on mockup A |
| R13 | Track keeps the “active” objectives | owner notes on mockup A |
| R14 | Gateway handling stays as in the bottom bar; the bottom bar lists the delegated sessions of the selected session | owner notes on mockup A |
| R15 | **Every element of the right panel and of the bottom bar is mouse-clickable**, in addition to the keyboard | addendum ~18:55 |
| R16 | Proposed keyboard grammar to be checked for realism: opener + `/s` (default) `/d` `/t` `/a`, Tab next tab, Esc back to CLI, `/gw`, `/c` | shortcut wish |
| R17 | Collapsed mode: the right bar lights as soon as **another** session is blocked or has a question/session stake | owner notes on mockup A |
| R18 | On a decision: go to the dossier **or** open the session, e.g. in a bottom sub-pane of the right panel | owner notes on mockup A |
| R19 | Track is the single source of objectives; **a session with an engaged Track objective runs in objective loop by default**; no loop only when no objective is engaged | addendum ~19:05 |
| R20 | When a CLI has an objective it could pursue, loop state is **always explicit** (engaged or not, never implicit), in the panel and in the bottom bar; not-engaged-while-an-objective-exists is an alert (`*`) | precision ~19:10 |
| R21 | The loop is engaged **through the tool's own native loop mechanism** where one exists (e.g. Claude Code `/loop` + ScheduleWakeup; Codex/agy/Muse equivalents when they exist), otherwise through the h2a objective loop — never through a hidden parallel mechanism | precision ~19:10 |
| R22 | An objective and its loop may **span several projects**; attachment is at meta-workspace level: the objective appears once with its sessions per project, loop state stays explicit per session and aggregated per objective, and each concerned project's Track source is cited (no silent copy between journals) | reminder ~19:12 |
| R23 | First shippable version fast, wanted in the next 0.98 release (drives the L0 cut in §12) | owner, 17/11 (build-lane brief) |

Decisions already taken and therefore **not** open questions: mockup A layout (R2); symbol + colour + `*`, never colour alone (R12, §10); restore inventory and restore groups as the session/tab base (R8/R9); sub-sessions hidden by default (R11); gw/model display stays in the bottom bar (R14); Track as objective source with the default-loop rule (R19); native-mechanism-first engagement (R21); multi-project attachment at meta-workspace level (R22). Everything still undecided is in §13, each with options and a recommendation.

## 3. Grounded facts (code as of `origin/main`, 2026-11-17; L0 lane state noted separately)

Facts read in the repository; design choices cite them as F-numbers. Three r1 statements are corrected here and flagged inline (strip width, `/gw` mapping scope, loop-status vocabulary drift).

### 3.1 Native terminal host and bottom bar (PR #443, merged)

| # | Fact | Source |
|---|---|---|
| F1 | The bottom bar is rendered by `NativeStatusBarController` in the attach path: it reserves exactly one row (`childRows()` returns `rows - 1` while active), clamps the child scroll region (DECSTBM), repaints at most every 1 s, requires ≥ 10 rows, and restores geometry/modes on detach/exit. Child resize goes through `client.resize(lease, cols, rows)`. | [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:466), [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:603), [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:1515) |
| F2 | The attach input path intercepts exactly one byte for itself today: `DETACH_BYTE` `0x1c` (`Ctrl-\`) is consumed by `runAttach` and never reaches the child; all other input is forwarded to the child. Host-captured keys therefore have an existing seam, and capture order vs. detach must be specified (§9). | [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:64), [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:1490) |
| F3 | `TerminalModeTracker` records the **child CLI's** DEC private modes `1000/1002/1003/1004/1006/1015/2004`, alternate screen, kitty keyboard stacks (per screen) and `modifyOtherKeys`, and can emit exact reset/restore sequences. On `origin/main` it exposes **no accessor** for “child mouse tracking on/off” — the recorded set is private. Mouse routing (§9) needs that accessor; the L0 lane adds `isMouseTrackingEnabled()` (B3). The kitty state tracked here is CLI↔h2a-model only; it does not upgrade what the outer VTE terminal sends (K-facts in §9). | [terminal-modes.ts](../../packages/h2a-runtime/src/native-terminal/terminal-modes.ts:2), [terminal-modes.ts](../../packages/h2a-runtime/src/native-terminal/terminal-modes.ts:103) |
| F4 | The native host distinguishes controller and observer attachments: `acquireController` (single writer lease, incl. an automation variant gated on no-recent-human) vs. `attachObserver` / `readOutput` (read-only replay). The decision sub-pane (§4.3) is an observer; it must never take the controller lease of a session a human is driving. | [client.ts](../../packages/h2a-runtime/src/native-terminal/client.ts:166), [client.ts](../../packages/h2a-runtime/src/native-terminal/client.ts:169) |
| F5 | Bottom-bar enablement: default **on**, disabled by `H2A_STATUS_BAR=off`-family env values, `H2A_NO_STATUS_BAR`, or config `statusBar:false` / `h2a.statusBar:false`; unreadable config defaults to enabled and never crashes attach. The panel flag mirrors the *shape* but inverts the default (B2): default **off** per the L0 brief. | [config.ts](../../packages/h2a-runtime/src/config.ts:495) |
| F6 | Bar data is `NativeStatusBarSnapshot` (cli, session, link state, role, workload `J/I/L` each with `degraded`, `delegatedSessions: number \| "unknown"`, `gateway: H2AGatewayStatusV1` with `requestedModel → upstreamModel`); degraded data renders `?`, never a fabricated zero. `renderNativeStatusBarLine` already renders `gw <state>`, the route token and the bare `deleg <n>` count. | [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:40), [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:690), [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:1497) |

### 3.2 Restore inventory, groups, delegations

| # | Fact | Source |
|---|---|---|
| F7 | Restore discovery returns `DiscoveredSession[]` (project, tool `claude\|codex\|agy\|muse\|vibe`, sid, cwd, origin `registry\|scan`, `gatewayMode` pin, host kind, `restoreClass: human \| unclassified`). Registry rows are `human` only through `isHumanFacingSession` (recorded delegation always excluded); transcript-scan rows are always `unclassified`. Restore's plan deliberately includes **dead-but-restorable** sessions (relaunching them is its job) — the panel's “active” list is therefore the *live subset* of this inventory, liveness taken from the registry/native-host/tmux views, never assumed (§4.2). | [restore.ts](../../packages/h2a-runtime/src/restore.ts:64), [restore.ts](../../packages/h2a-runtime/src/restore.ts:273), [restore.ts](../../packages/h2a-runtime/src/restore.ts:558) |
| F8 | `groupSessions(sessions, LayoutConfig)` produces `LayoutWindow[]` (title + tabs): explicit `LayoutConfig.groups` first (their projects leave the shared pool), then shared round-robin windows; registry-backed sessions are never collapsed by the per-project scan cap. Remote (`remote:true`) groups are filled by the caller from SCW, not by local discovery. These windows are the panel's meta-workspace tabs (§4.2); there is no second grouping config in v1. | [restore.ts](../../packages/h2a-runtime/src/restore.ts:842), [config.ts](../../packages/h2a-runtime/src/config.ts:49) |
| F9 | Delegated executions are a separate, provenance-gated projection (`H2ADelegatedExecutionV1`: delegator instance + tmux session, tool, state `pending\|running\|throttled\|failed`). Work without proven delegator identity degrades the projection instead of being attributed by guess. The panel reuses this exact posture for sub-sessions (§4.2): unattributed work shows as degraded, never silently attached to a session. | [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:60), [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:356) |
| F10 | Session resume argv is per profile and already centralised (`claude`/`agy`: `--resume <id>`; `codex`/`muse`: `resume <id>` subcommand leading argv; `vibe`: `--resume`). Any panel-driven relaunch (§8) must go through this mapping with the session's **own** conversation id, never “most recent”. | [profiles.ts](../../packages/h2a-runtime/src/profiles.ts:39) |

### 3.3 Objective loops: store, engine, supervisor, drumbeat (three distinct mechanisms)

| # | Fact | Source |
|---|---|---|
| F11 | The **h2a objective loop** is a durable store: `<h2a-root>/loops/<loopId>/{state.json, events.jsonl, objective.md}` (plus `executor.heartbeat` when supervised). `H2AObjectiveLoop` carries `goal`, `status`, `repos[]`, `refs[]` (Track refs), `agents[]` (host, role, `h2aInstance`, optional validated launch spec — claude/codex only) and `policy`. One objective binding many Track refs across repos/workspaces is the canonical model, not an extension. CLI verbs: `loop create/join/report/done/stop/list/status/agents/logs/tick/watch/enable-auto-tick`; MCP mirrors `h2a_loop_*`. | [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:49), [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:165), [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:299), [cli-contract.ts](../../packages/h2a/src/cli-contract.ts:177), [cli.ts](../../packages/h2a/src/cli.ts:549) |
| F12 | Canonical loop statuses (store): `created, running, waiting-human, waiting-agent, stalled, degraded, done, failed, cancelled, active, stopped, blocked`. Terminal-for-automatic-wake: `done, failed, cancelled, stopped, blocked` (`blocked` included on purpose: recovery is explicit). Auto-tick live set: `created, running, active, waiting-agent, waiting-human, stalled, degraded`. Member checks are fail-closed (unknown status ⇒ never auto-ticked). | [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:7), [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:482), [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:500) |
| F13 | Auto-ticking is **opt-in per loop** (`policy.autoTick === true`, default `false`; legacy loops read as not opted in), frozen globally by `H2A_LOOP_AUTOTICK_OFF`, and executed only by the durable supervisor under a per-loop single-writer executor lease with a lease-safety timeout. Each successful tick stamps `executor.heartbeat`; `loopAttendance` is the read-side fail-closed predicate (`attended \| unattended \| not-applicable`) any reader can evaluate. The supervisor is **never on a default code path** — if nobody runs it, opted-in loops read `unattended`, which is a displayed state, not an error to hide. | [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:145), [loop/index.ts](../../packages/h2a/src/runtime/loop/index.ts:538), [supervisor.ts](../../packages/h2a/src/runtime/loop/supervisor.ts:163), [supervisor.ts](../../packages/h2a/src/runtime/loop/supervisor.ts:334) |
| F14 | One tick = gather (agents projection, h2a presence incl. self-declared `workStatus` folded from the drumbeat registry, Track refs rollup, inbox escalations) → pure `planLoopTick` → record `loop.tick` (outcome, degraded, action types, dry-run flag) → optionally execute guarded actions (`request-launch, wake, route-decision, close, noop`). Wake requires independent idle evidence (R3 gate) plus the human-typing guard re-checked at injection time; a degraded Track source never auto-closes. There is **no stored iteration counter**: “iteration” and “last verdict” must be derived from `events.jsonl` (`loop.tick` count + last outcome/reasons) — §5.6 defines this derivation. | [tick.ts](../../packages/h2a/src/runtime/loop/engine/tick.ts:41), [decision.ts](../../packages/h2a/src/runtime/loop/engine/decision.ts:209), [adapters.ts](../../packages/h2a/src/runtime/loop/engine/adapters.ts:99) |
| F15 | Track ref resolution today runs `track query --format json` once per loop repo cwd and indexes rows by bare aggregate id across repos. For a multi-project objective the panel must resolve **per ref** `(repoKey, workspace, aggregateKind, aggregateId)` against that project's own store and cite it (§5.5); a bare-id merge loses provenance even where ULIDs make collision unlikely. Track stores are per-repo: nearest-ancestor `.track/events.jsonl`, or explicit `--track-dir`/`TRACK_DIR`. | [adapters.ts](../../packages/h2a/src/runtime/loop/engine/adapters.ts:184), [cli/index.ts](../../packages/track/src/cli/index.ts:58) |
| F16 | **Vocabulary drift (r1 correction).** The bottom-bar loop counter (`readLoopsStatusCount`) validates `state.json` against a *different* status set (`waiting-ci`, `waiting-review`, `Incrementing`, `paused`, …) and policy fields (`tickIntervalSec`, inline `executor`) than the canonical store writes (F12; `tickMs`, separate heartbeat file). A loop written by the store can therefore read as `degraded` in the bar counter. The panel must read loops through the canonical store shapes (F11–F13), and lot L2 owns reconciling or bypassing the bar counter — the two surfaces must never disagree (§5.6, §10). | [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:732), [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:1183) |
| F17 | **Drumbeat is not the objective loop.** Drumbeat is the external anti-stall relance (`workStatus: working\|paused\|done\|blocked\|out-of-tokens` reported via per-host Stop hooks / poll, `h2a drumbeat watch`, capped relances, escalation). The objective-loop engine *consumes* drumbeat signals; the panel displays loop state from the loop store and work status from presence/drumbeat as two named signals, never merged into one invented state. Repo documentation states the native-loop asymmetry plainly: only Claude Code has a `/loop`-style self-wake; codex/agy/gemini have none, which is why the external mechanisms exist (§5.3 re-verifies per installed binary). | [session.ts](../../packages/h2a/src/session.ts:53), [drumbeat.md](../../docs/drumbeat.md:9), [cli-contract.ts](../../packages/h2a/src/cli-contract.ts:649) |

### 3.4 Track: objectives, decisions, report

| # | Fact | Source |
|---|---|---|
| F18 | Track has **no first-class cross-repo “objective” aggregate** (accepted counter-proposal in the objective-loop design: h2a owns the objective/loop aggregate; Track provides explicit refs and pure projections). An “objective” in Track terms is a referenced aggregate — item / workpackage (`wp`) / decision / blocker / criterion / evidence — addressed by `TrackObjectiveRef` (`repoKey, workspace, aggregateKind, aggregateId, role, baselineCommit`, roles incl. `primary, target, decision-gate, acceptance`). §5.1 builds the panel's binding model on this fact; it invents no Track-side objective entity. | [contract.ts](../../packages/track/src/read/contract.ts:105), [contract.ts](../../packages/track/src/read/contract.ts:139), [2026-06-26 objective-loop design](../../docs/specs/2026-06-26-objective-loop-h2a-track-remote.md:231) |
| F19 | Track items carry `realization: to-do\|in-progress\|done\|cancelled\|rejected`, container roles (`workpackage\|spec-phase\|stream`), and RACI fields `accountable` / `responsible[]` plus `engagementRef`. “Active” in report rendering means non-terminal: `--active-roster` omits terminal roots from the *human* roster only (JSON always carries the full forest with `terminal` flags — machine consumers filter themselves). R13 (“Track keeps active objectives”) maps to this semantics (§5.1, §6). | [item.ts](../../packages/track/src/model/item.ts:45), [commands.ts](../../packages/track/src/read/commands.ts:311) |
| F20 | Decisions are `DecisionState` (`outcome: pending\|go\|no-go\|deferred`, `targets[]`, `workspace`, `accountable`, typed `Dossier` with options/qa/recommendation and discriminated `artifacts[]`: `h2a-decision-dossier` (negotiationRef + hash), `rendered-view`, `mockup`). Answers are recorded by `track decision select <id> <optionId>` (structured) / `decision outcome`; `track focus <id>` renders one dossier read-only. Unanswered `qa[]` entries are the question signal. | [decision.ts](../../packages/track/src/model/decision.ts:12), [decision.ts](../../packages/track/src/model/decision.ts:54), [cli/index.ts](../../packages/track/src/cli/index.ts:93), [cli/index.ts](../../packages/track/src/cli/index.ts:117) |
| F21 | `track report --status-table` is the validated four-section report (fait / à-faire / blocked / décisions). Period selectors: `--period today\|week\|month\|all\|last-week\|last-day` or `--since/--until` (mutually exclusive); a status-table request without selector defaults to rolling **last-week**; a selected period bounds the *fait* window only — open work (à-faire) is always the full current projection. Journal revision pinning exists (`--expect-events/--expect-head`, resolve-context cursor `count+head`) — the summary cache key in §6. | [commands.ts](../../packages/track/src/read/commands.ts:281), [commands.ts](../../packages/track/src/read/commands.ts:387), [cli/index.ts](../../packages/track/src/cli/index.ts:489) |

### 3.5 Gateway, messaging, relaunch

| # | Fact | Source |
|---|---|---|
| F22 | Per-session gateway posture is a launch pin (`gatewayMode: gateway\|direct`, explicit provenance only, re-emitted as `--gw/--no-gw` on restore). Effective route per session is observed from the gateway ledger (`requestedModel → upstreamModel`, state, account label) via the same local-base-URL resolution the bar uses. Launch-time model choice goes through the closed gateway catalog + aliases (`gemini-3.8-flash` alias `flash`, `gemini-4-argon/carbon`, `claude-fable-5-1/5-2`, `muse-*`) and the Claude-family slot map. | [restore.ts](../../packages/h2a-runtime/src/restore.ts:74), [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:819), [model-catalog.ts](../../packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts:12) |
| F23 | **PR #462 scope (r1 correction).** PR #462 (open, `feat/gw-model-rewrite`, stacked on #458) adds `modelRewrites` to the **gateway-host-global** config (`~/.sentropic/llm-mesh.json`): entries `{match:{model, effort?}, target:{model, effort}}`, first match wins, validated at gateway startup (routable catalog target, allowed effort, no chains/loops), applied to `POST /v1/messages` + `/v1/chat/completions` before routing, surfaced per request via `x-h2a-model-rewrite` header + one log line. It is **not** a per-session mapping and changing it requires a gateway restart (`h2a llm-mesh restart`). Routing profiles (`LlmMeshRoutingConfig`: policy/profiles/activeProfile) are likewise host-global. Consequence for `/gw` (§8): the per-session levers that exist are posture pin + relaunch model; rewrites/profiles are display-and-link only in v1. On `origin/main` the config has no `modelRewrites` field yet. | [config-file.ts](../../packages/h2a-runtime/src/gateway-host/config-file.ts:7), [routing-preferences.ts](../../packages/h2a-runtime/src/routing-preferences.ts:23), [PR #462](https://github.com/rhanka/h2a/pull/462) |
| F24 | `h2a send <target> <message>` deposits one signed message in the local peer inbox (or `--backend cluster-mesh`); the target may be an exact instance or a *unique* registered/live display name; exit codes `0/1/2/3` distinguish delivery outcomes; sender resolution never guesses among several candidates. Deposit is delivery **to the inbox**, not proof the agent acted — §7 keeps that distinction in the UI wording. | [cli-contract.ts](../../packages/h2a/src/cli-contract.ts:168), [cli.ts](../../packages/h2a/src/cli.ts:634) |
| F25 | Killing/restarting is guarded everywhere it exists: tmux relaunch requires complete liveness evidence (`decideRelaunchSafety` → `isRelaunchKillable`; missing evidence = alive, never kill), plans skip live/indeterminate/unknown-convId sessions and refuse convId collisions; native sessions stop only by exact incarnation (`stopIfIncarnation`) under the controller lease, and restore re-enters live attach-only rows by exact managed name with no resume id invented. §8 inherits all of it: the panel adds **no** new kill path. | [relaunch.ts](../../packages/h2a-runtime/src/relaunch.ts:222), [relaunch.ts](../../packages/h2a-runtime/src/relaunch.ts:595), [client.ts](../../packages/h2a-runtime/src/native-terminal/client.ts:211), [restore.ts](../../packages/h2a-runtime/src/restore.ts:102) |

### 3.6 L0 build-lane facts (adopted by this spec, §12 lot L0)

Observed 2026-11-17 in the parallel lane worktree (`feat/native-right-panel-l0`, two uncommitted files `native-terminal/right-panel.ts` + `right-panel.test.ts` at observation time; wiring into `op.ts` not yet present). These are alignment inputs, not `origin/main` facts:

| # | Fact | Consequence |
|---|---|---|
| B1 | Toggle sequence `F12` (`ESC [ 24 ~`); split sequences buffered, never leaked to the CLI. In panel focus: `/s` sessions (default), `/d` decisions, `/t` track (L0 renders “track: not in L0”), `Tab` cycles meta-workspace tabs, `Esc` returns focus to the CLI **without closing** the panel. | §9 adopts this exactly; r1's “Esc closes” reading is dropped. |
| B2 | Enablement: env `H2A_RIGHT_PANEL` (explicit `1/true/on/yes/enabled`; explicit off wins over config), else config `rightPanel.enabled === true`; **default OFF**. Width: env `H2A_RIGHT_PANEL_WIDTH` else `rightPanel.width`, default **32**, clamped 20–60. | §4.1 names these as the L0 flag surface; §13 OQ-2/OQ-3 only confirm persistence via `/c` later. |
| B3 | Geometry: open reserves panel width, collapsed reserves **1 column** (r1 correction — r1 said 2); opening refused when the child would fall below **40 columns** (strip kept). Rendering sets DECLRMM left/right margins (`?69`) while open and SGR mouse (`?1000h ?1006h`) while open, restoring both on close/dispose. Mouse routing zones: `panel \| cli \| native-selection (Shift) \| status-marker` (bottom-bar row right of the child); CLI-zone events forward only when the CLI itself enabled mouse tracking (needs F3 accessor). | §4.1/§4.5/§9 adopt the constants and zones, and add the two gaps the lane had not yet closed at observation time: collapsed-state clicking needs mouse reporting while collapsed (§9.3), and child-output column clamping + resize wiring live in the attach integration, not in the controller alone (§12 L0 acceptance). |
| B4 | Snapshot builders already encode owner rules: delegated sessions filtered out of the human list; decisions from Track rows with `outcome ∈ {pending, deferred}` only, unanswered `qa` ⇒ `question` kind, dossier link shown as text and surfaced on click as an `open-link` action carrying the target text (L0 opens nothing). Collapsed marker: `*` lit when another session needs attention or a decision is pending, `?` when degraded. | §4.2–§4.5 adopt; §4.5 fixes the one underspecified point (what `attentionCount` counts, with dedup) so spec, lane tests and bar counters agree. |

### 3.7 Owner terminal and installed CLIs (probed 2026-11-17 on this machine)

| # | Fact | Probe |
|---|---|---|
| F26 | Owner terminal: GNOME Terminal 3.58.0 using **VTE 0.84.0**; ptyxis (same VTE family) is the other frontend in scope. All keyboard/mouse facts in §9 are stated against VTE behaviour. | `gnome-terminal --version` |
| F27 | Installed CLI binaries: `claude` 2.1.327, `agy` 1.5.10, `muse` 1.4.23 present; **`codex` absent from PATH**. `--help` surfaces expose resume/continue forms for all present CLIs but **no loop/cron/schedule verb** on any of them; `muse sessions --json [--watch]` lists live sessions (liveness only); `agy` additionally exposes one-shot `--print` / NDJSON stream modes and a remote-control daemon. Native-loop mechanisms, where they exist, are therefore *in-session* surfaces (slash commands / tools), not outer CLI verbs — §5.3 inventories them per CLI with evidence levels and a re-verification gate, because in-session surfaces drift between versions and `codex` could not be probed locally. | `claude/agy/muse --help`, `muse sessions --help` (Annex D) |

## 4. Layout contract

### 4.1 Reserved geometry and enablement (mirrors the bottom bar, column axis)

The panel is a second reserved area owned by the attach layer, exactly as the bottom bar is (F1). The child PTY never learns the full terminal size:

- **Feature flag (L0 surface, B2).** Env `H2A_RIGHT_PANEL` wins over config `rightPanel.enabled`; default **OFF**. With the flag off, nothing is constructed and attach behaviour is byte-identical to today (L0 acceptance proves it). Width: `H2A_RIGHT_PANEL_WIDTH` > `rightPanel.width` > **32**, clamped to 20–60. Unreadable config means “not enabled” for the panel (inverse of the bar's F5 default, because the panel changes child geometry and mouse mode); attach never crashes on config either way.
- **Open:** child receives `cols − panelWidth` columns and `rows − 1` rows (bottom bar unchanged). **Collapsed (feature on, panel closed):** child receives `cols − 1` columns; the single marker column (B3) stays reserved for the whole attach so open/close are the only two child geometries. **Feature off:** child receives full `cols`.
- **Minimums.** Opening is refused (marker kept, panel stays collapsed, no layout corruption) when the child would fall below **40 columns** (B3); the existing ≥ 10-row rule for the bottom bar is unchanged, and below it neither reserved area paints. Width is fixed per attach in v1 (no drag-resize); changing it is a `/c` setting applied at next open (§8/§9, lot L7).
- **Clamping.** The headless model is sized to the *child* area (`childCols × childRows`); child output addressing beyond `childCols` is clipped exactly as row addressing beyond `childRows` is clamped today (F1 machinery extended to the column axis — the one genuinely new risk, isolated in L0). DECLRMM margins (`?69`, B3) are an optimisation for repaint containment only: rendering must stay correct via absolute cursor addressing if the outer terminal ignores them, and `?69l` is restored on close/detach/exit. No behaviour may depend on VTE honouring `?69`.
- **Repaint and restore.** Snapshot-driven repaint, at most one time-driven repaint per second (F1 rates). Resize/detach/exit/reconnect restore full geometry, child modes (F3 reset/restore symmetry), mouse reporting (§9.3) and margins. A panel fault degrades to `?` in the marker column — never a corrupted child screen, never a fabricated all-clear (F6 posture).

### 4.2 Meta-workspace tabs and the session tree

- **Tabs = restore windows (R8).** One tab per `LayoutWindow` from `groupSessions` over the restore inventory (F8): explicit layout groups first, then shared windows. Tab label = window title. No panel-specific grouping config in v1; a derived **Attention** tab (blocked/question/loop-gap across workspaces) adds no config and is proposed as OQ-8 — it is *not* in L0.
- **Sessions = active sessions as restore sees them (R9), made precise.** The list is the restore inventory (registry sessions merged with scan discovery, F7) restricted to (a) the tab's projects and (b) sessions with positive liveness evidence in the same views restore/host code already consults (registry row not ended + native-host or tmux presence). Dead-but-restorable rows (which restore would *relaunch*) are **not** “active”: they are omitted from the main list and, from lot L1, reachable under a `▸ n restorable` expander so nothing restore knows is hidden. Scan-origin (`unclassified`, transcript-guessed) rows join the main list only when matched to a live host session (same tool + cwd in the native/tmux view); matched rows keep an `unclassified` marking (§10) rather than being promoted to human sessions, and unmatched scan rows fall back to the restorable expander. A session appears in exactly one tab; dual-host-ambiguous identities (F7 resolver `ambiguous`) appear once, marked `unknown`, with no action enabled on them.
- **Row content.** Status symbol + colour + `*` (§10), session label, tool, gateway short form in the bottom-bar vocabulary (`gw` + `requested→upstream` when observed, `direct`, `gw ?` when unknown, F6/F22), and — from lot L2 — the explicit loop token of §5.2 (e.g. `↻ native`, `↻ NOT ENGAGED *`). In L0 the loop token is absent (not faked as engaged or clear); §12 states this limit in the L0 PR body.
- **Sub-sessions (R11).** Delegated executions (F9) are hidden by default under their delegating human session as `▸ n delegated`, expandable in place (keyboard and click). They never appear as top-level human rows. Executions whose delegator cannot be proven degrade the expander (`deleg ?`) instead of being attached by guess (F9).
- **Loops/objectives browsing (R11).** From lot L2 each session with a bound objective (§5.1) carries a `▸ objective/loop` expander (objective refs, loop status, last tick/verdict, attendance), and the panel gains the meta-workspace objectives list of §5.5. In L0/L1 loops are not rendered in the panel; the bottom-bar `L` counter stays as-is (with F16's drift called out until L2 reconciles it).
- **Selection.** One selected session (reverse-video row, §10). Selecting drives §4.4 (bottom-bar delegated names) and §4.3 (sub-pane target); it never steals CLI input focus (§9 focus model) and never attaches as controller to another session (F4).

### 4.3 Decisions / questions list and the bottom sub-pane

- **Sources (R4).** Track decisions with `outcome ∈ {pending, deferred}` (F20); questions = dossier `qa[]` entries without an answer, plus objective loops in `waiting-human` (F12) from lot L2 and h2a inbox `escalate` envelopes for enrolled loop agents where the tick engine already surfaces them (F14). L0 scope is Track decisions/questions only (B4). One list: decisions first, then questions, oldest first within each class; each row shows `◆`/`?`, `*` while unanswered, short title, age, concerned workspace/session when recorded, and the dossier link text when present.
- **Which Track journal(s)?** Decisions are read from the Track store of each project represented in the current meta-workspace tab (nearest-ancestor `.track` per project cwd, F15), each row citing its source workspace. A project without a readable store contributes a `decisions unknown (?)` line for that project — never an empty-list all-clear. L0 may ship with the attached session's project store only **if** the PR body states that limit; multi-store reading is required by L1 at the latest (§12).
- **Activation (R5/R18) offers exactly two targets.** (a) *Dossier:* a local md path renders as read-only plain text in the sub-pane; a Focus artifact renders via `track focus <id>` (read-only, F20); a `rendered-view`/`mockup` artifact ref or external (e.g. claude.ai) link opens through the system opener — the panel never fetches or executes artifact content itself. In L0, activation only surfaces the link *target text* (B4 `open-link` action); actually opening is lot L3. (b) *Session:* the concerned session opens in the bottom sub-pane as a **read-only observer** (F4) in v1; a non-live session shows last known state + “not live — no sub-pane”, never a blank pane. Interactive take-over is OQ-6, not v1.
- **Sub-pane geometry.** The sub-pane is the lower part of the right panel (owner note R18), sized as a fixed fraction of panel height in v1 (proposal: 40 %, `/c`-adjustable in L7), with its own header naming what it shows (dossier ref or session + `observer`). Panel input can never reach an observed session's PTY (L3 proves input isolation by byte-diff).

### 4.4 Bottom bar: unchanged home of gw/model, plus two owner amendments

- Gateway/model display **stays in the bottom bar** (R14): `gw <state>` + `requested→upstream` (F6) is not duplicated as panel state; panel rows show only the short form (§4.2) and `/gw` (§8) drives the same controls the bar displays.
- **Delegated names (R14).** For the *selected* session, `deleg <n>` expands to its delegated session names (comma-separated, truncated with `…`; degradation order: route token drops before delegated names, then names truncate, then fall back to the count). With no panel selection, today's count rendering is byte-identical. (Lot L1; needs the snapshot to carry names, not only the F6 count — §11.)
- **Loop state of the attached session (R20).** From lot L2 the bar carries the attached session's loop token next to `L`, so “panel and bottom bar display the state” holds even with the panel collapsed. The bar uses compact forms in 1:1 mapping with §5.2 (`↻native`, `↻h2a`, `↻OFF*` = NOT ENGAGED, `↻unatt*` = unattended, `↻wait*` = waiting-human, `↻done`, `loop?` = unknown; `no-obj` = no objective bound) — same states, shorter words, same `*` rule (§10). Until L2/F16 reconciliation, the existing `L` counter is left untouched rather than extended with drifting vocabulary.
- **Toggle marker (R15).** The bar's right end carries the clickable panel marker (`▸▸` / lit `▸▸*`); clicking it toggles the panel (§9.3 `status-marker` zone). It is present whenever the feature flag is on, including while collapsed — which is what forces the mouse-reporting rule in §9.3.

### 4.5 Collapsed marker column (1 column)

- **Lit rule (R17, made countable).** The marker is lit (`*` on filled background, §10) iff at least one *attention subject other than the attached session* exists: another session blocked/failed, with a pending decision or unanswered question, or — from L2 — bound-but-not-engaged/unattended/waiting-human (§5.2). The attached session's own stakes never light its own marker (they are visible in its CLI + bottom bar). A pending decision with no recorded session lights the marker (it needs the owner; B4 behaviour adopted).
- **`attentionCount` definition (spec fixes B4's underspecified point).** Count *subjects*, deduplicated: each other-session needing attention counts once no matter how many stakes it carries, plus each pending decision/question **not** attributable to an already-counted session counts once. The count is shown in the panel header and (from L2) reconciled with the bar `L`/`J` attention numbers — the 1-column marker itself shows only `*` (a count digit does not fit one column next to `*`; widening to 2 columns is OQ-4, default: stay at 1).
- **Unlit/degraded.** Unlit = plain `│`, visually silent. Any source needed for the lit rule being unreadable renders `?` (muted) — never unlit-as-all-clear. Marker state derives from the same snapshot as the open panel (one derivation, §11).

## 5. Objectives and loops (R19–R22)

This section is the r2 addition that r1 lacked. Vocabulary is fixed first, because three different things are all called “loop” in this codebase (F17) and the panel must never conflate them:

- **Track objective** — work recorded in Track and referenced explicitly (§5.1). Track is the source (R19); the panel and h2a only reference it.
- **h2a objective loop** — the durable h2a store + tick engine + optional supervisor (F11–F14). This is h2a's own loop and the universal fallback (R21).
- **Native CLI loop** — a CLI's in-session self-continuation mechanism (§5.3). It lives inside the agent session; h2a can request and observe it only indirectly.
- **Drumbeat** — external anti-stall relance on `workStatus` (F17). A signal source for the tick engine, displayed as work status, never labelled “loop engaged”.

### 5.1 What “objective” and “engaged” mean, operationally

Track owns no cross-repo objective aggregate (F18), so the panel's objective is a **referenced set**:

- An **objective** is identified by an h2a objective loop's declared refs (F11): one or more `TrackObjectiveRef`s (F18) with at least one `primary`/`target` role, each resolved in its own project's Track journal (§5.5). The loop's `goal` text is display text; the refs are the identity. A loop with zero refs is a free-text goal (`explicit-done` policy in the store) — shown as “goal (no Track ref)”, never presented as a Track objective.
- **Active objective (R13):** the loop is non-terminal (F12) **and** at least one `primary`/`target` ref is not proven terminal-satisfied. Per ref, terminal means: item realization in `done/cancelled/rejected` with the tick mapping's satisfied reading, decision outcome settled, container terminal (F19 test, machine-filtered from full-forest JSON; exact per-kind mapping is the tick rollup's, §5.5). Individually satisfied refs stay visible as satisfied inside a still-active objective. Unresolvable refs (store missing/unreadable, id absent) yield `unknown` — never “satisfied”, and never by themselves “inactive” (F14 posture).
- **Session ↔ objective binding** (“this session has an objective it could pursue”, R20) is a *recorded* relation, resolved in this priority order — never inferred from titles, cwds alone, or open-work counts:
  1. **Loop enrolment:** the loop's `agents[]` contains the session's h2a instance (`h2aInstance`, F11) — set by `h2a loop join` / `h2a_loop_join`. Strongest evidence; carries the agent role.
  2. **Track assignment:** a referenced aggregate (or its `primary`/`target` item) names the session's instance/actor in `accountable` or `responsible[]` (F19).
  3. **Launch binding:** the session was launched for the loop (loop agent launch spec name / launch context recording the loop id where the launcher recorded one). If no surface recorded it, this tier is empty — the panel does not reconstruct it from process argv.
- **Candidate (unbound) objectives:** active Track objectives in the session's workspace(s) with no binding to this session (e.g. an unfilled planned agent slot on a loop whose repos include the session's project, or active `primary` work with no accountable session). Candidates are *listed* (objectives view, §5.5) so R20's “could pursue” is visible, but in v1 they do **not** raise the per-session `*` — only bound-but-not-engaged does (§5.2). Widening the alert to candidates is OQ-9 (recommendation: no — every session in a busy repo would alert permanently).
- A session may be bound to several objectives and an objective to several sessions (multi-agent loops, F11). Per-session display shows each binding; the aggregate per-objective state is §5.5.

### 5.2 The default rule and the explicit per-session state machine (R19/R20)

Owner rule: *bound active objective ⇒ objective loop is the expected state; no bound objective ⇒ no loop expected.* The panel (and, from L2, the bottom bar for the attached session, §4.4) renders exactly one state per (session, bound objective) pair — collapsed to the worst state on the session row when several bindings exist, expandable to each pair:

| Displayed state | Token (row) | `*` | Meaning (evidence required; §5.4/§5.6) |
|---|---|---|---|
| No objective bound | `no objective` | — | No tier-1/2/3 binding to any active objective. No loop expected (R19 second clause). |
| Objective available | `◎ available` | — | No binding, but ≥1 candidate in the session's workspace(s). Informational (OQ-9). |
| Engaged, native | `↻ native` | — | Bound; native mechanism attested engaged for this agent (§5.3/§5.4 evidence) and loop not in an attention status. |
| Engaged, h2a | `↻ h2a` | — | Bound; no native mechanism (or native declined/unavailable) **and** h2a loop opted in + `attended` (F13), or `loop watch` running for it. Mechanism always named — `native` vs `h2a` is never blurred (R21). |
| Engaged, waiting | `↻ waiting-human` / `↻ waiting-agent` | `*` on waiting-human | Loop status `waiting-human` (decision/question blocks) or `waiting-agent`. Links to the blocking decision/question row (§4.3). |
| **Not engaged** | `↻ NOT ENGAGED` | `*` | Bound to an active objective, loop in a live non-terminal status, but **neither** native engagement attested **nor** h2a auto-tick opted-in/attended. This is the 19:10 alert case (R20) and counts as an attention subject (§4.5). |
| Unattended | `↻ unattended` | `*` | Bound, h2a loop opted in, but `loopAttendance = unattended` (no fresh heartbeat — supervisor down/absent, F13). Distinct from not-engaged: the fix is “start/observe the supervisor”, not “engage”. |
| Stalled / degraded loop | `↻ stalled` / `↻ degraded` | `*` | Loop status `stalled`/`degraded` (F12), or last tick degraded (F14). Reason text from the last tick is shown in the expander. |
| Terminal | `↻ done` / `stopped` / `blocked` / `failed` / `cancelled` | `*` on `blocked`/`failed` only | F12 terminal set. Word always shown; `done` also requires the ref rollup to agree before the objective leaves the active list (§5.5). |
| Unknown | `loop unknown ?` | — | Loops store, Track store or presence unreadable for this pair. Never rendered as engaged, never as clear; the expander names which source failed. |

Rules that keep this table sound:

- **Silence is never “engaged”.** Native engagement needs positive attestation (§5.4): a loop enrolment + engagement record, refreshed by agent reports; stale attestation (older than the loop's `tickMs` × 3, the F13 staleness constant) decays to NOT ENGAGED, not to engaged-forever. h2a engagement needs opt-in + attendance, both read-side (F13).
- **Kill-switch visible.** When `H2A_LOOP_AUTOTICK_OFF` freezes auto-ticking (F13), h2a-engaged rows render `↻ h2a (frozen)` and the objectives header says so — a frozen fleet must not read as per-session faults.
- **Work status stays separate.** Drumbeat `workStatus` (`working/paused/blocked/out-of-tokens`, F17) renders as the session's work token, not merged into the loop token: a session can be `working` with loop NOT ENGAGED (exactly the gap R20 wants visible) or `paused` with loop engaged-native (self-wake pending).
- The state machine is a **read model** in lot L2 (no writes). Engagement *actions* that change state are lot L6 (§5.4).

### 5.3 Native loop mechanisms per CLI: inventory, engagement, observation, fallback (R21)

Evidence levels: **[repo]** = stated in this repo's docs/code; **[bin]** = verified against the installed binary's `--help` on 2026-11-17 (F27, Annex D); **[sess]** = in-session surface of the running harness (drifts by version — each build lot re-verifies before freezing, §12). “None” below means *no mechanism h2a can engage and observe on current evidence* — the spec then names the h2a fallback instead of inventing one.

| CLI | Native loop mechanism (evidence) | How h2a engages it (§5.4 protocol) | How h2a observes it | Fallback when absent/unavailable |
|---|---|---|---|---|
| **Claude Code** (`claude` 2.1.327) | In-session dynamic self-paced `/loop` + `ScheduleWakeup` (and scheduled-prompt/cron tools in-session); repo doc: “only Claude Code has [a `/loop`] … a self-wake” [repo F17]. No outer loop verb in `--help` [bin F27]. Stop hook can report `workStatus` [repo]. Limits: self-wake cannot recover an exited/out-of-tokens session [repo]. | At launch: initial prompt instructs the agent to (a) `h2a_loop_join` the bound loop, (b) start its native `/loop` on the objective text + loop id, (c) report engagement (§5.4 record). For an already-running session: `h2a send` for-info engage request (§5.4) — **never** raw PTY slash-typing outside the guarded wake path. | Enrolment event + engagement attestation + periodic `h2a_loop_report` notes (F11/F14); presence + `workStatus`; last native iteration is *not* directly readable from outside — the panel shows h2a-side tick/verdict (§5.6) and “native” as the mechanism name, with attestation age. Stale attestation ⇒ NOT ENGAGED (§5.2). | h2a objective loop (supervisor/watch) + drumbeat relance for exited sessions. Panel token switches to `↻ h2a` — visibly, never silently. |
| **Codex** (absent from PATH here) | **None on current evidence.** Repo doc groups codex with “no `/loop`-style mechanism at all” [repo F17]; resume is `codex resume <id>` [repo F10]; Stop-hook reporting exists via plugin `hooks.json` [repo drumbeat D6]. Binary could not be probed on this machine [bin F27] — any newer in-session automation surface is *unverified* and must not be speculated into the design. | No native engagement step. `h2a loop join` enrolment still applies (agent row, launch spec allowed for codex, F11) so state/observation stay uniform. | Loop store + presence + `workStatus` + tick verdicts (F14). Attendance proves the *h2a* executor only. | **h2a objective loop is the mechanism** (`↻ h2a`): supervisor auto-tick (opt-in) or `loop watch`, wake via guarded relance (tmux send-keys / native-PTY wake transports already in the tick adapters). Re-probe gate: lot L6 re-runs Annex D probes on the then-installed `codex` binary before freezing this row. |
| **agy** (Antigravity, 1.5.10) | **None on current evidence.** `--help` shows resume (`-c/--continue`, `--conversation`), one-shot `--print` and NDJSON stream turn drivers, remote-control daemon — no loop/cron/schedule verb or documented in-session self-wake [bin F27]; repo matrix: native lifecycle is poll-only, no push daemon [repo]. | No native engagement step. Enrolment as Codex (launch spec is claude/codex-only in the store, so agy agents enrol without a launch spec — relaunch uses the generic guarded paths, F11/F14). | Loop store + presence poll + tick verdicts. External one-shot turns (`agy --print`) exist but are a *driver*, not an engaged loop — the panel must not label a one-shot run as `↻ native`. | h2a objective loop (`↻ h2a`) + drumbeat poll relance, as Codex. |
| **Muse** (`muse` 1.4.23) | In-session goal continuation (session goal + progress/complete/blocked), scheduled prompts (cron), monitors and multi-agent workflows as session tools [sess — observed in Muse sessions; this spec's own session runs on Muse]. No outer loop verb: `--help` exposes `resume`, `exec` (one headless prompt), `sessions --json [--watch]` (liveness), `trace` [bin F27]. Goal/cron state is **not** exposed by any probed CLI verb. | At launch: initial prompt instructs the agent to create a session goal naming the objective + loop id, `h2a_loop_join`, and attest engagement (§5.4). Running session: `h2a send` engage request as Claude. `muse exec` one-shots are drivers, not engagement (same rule as agy). | Enrolment + attestation + `h2a_loop_report` (incl. goal progress the agent chooses to report); `muse sessions --json` corroborates liveness only. No direct goal-state read exists on probed surfaces — panel shows attestation age and decays stale ⇒ NOT ENGAGED, exactly as Claude. | h2a objective loop (`↻ h2a`) when no attestation is forthcoming (e.g. headless `exec` sessions, which have no persistent goal to engage). |
| `vibe` / `gemini` (restore tools beyond the owner's four) | Out of the R21 inventory scope (owner named Claude Code, Codex, agy, Muse). Repo doc already classes gemini with “no `/loop`” [repo F17]. | Enrolment only. | As Codex/agy. | h2a objective loop. A future inventory row needs the same [bin] probe discipline before any `↻ native` label is allowed. |

Two cross-CLI consequences:

- **`↻ native` is an attested label, not a capability label.** A CLI *having* a mechanism (Claude, Muse) never renders `↻ native` by itself; only the §5.4 engagement record for that (session, loop) pair does. Conversely `↻ h2a` on Claude/Muse is a legitimate, visible state (native declined, unavailable, or owner preference) — R21 is native-*first*, not native-*only*, and lot L6 records which path was taken and why (mechanism field, §11).
- **Self-wake limits are displayed, not papered over.** Native loops cannot recover exited sessions [repo F17]; when presence dies for a native-engaged pair, the state becomes NOT ENGAGED (or terminal per loop status) with reason “session not live”, and recovery — if the owner triggers it — goes through the existing guarded relaunch (§8), after which engagement must be re-attested.

### 5.4 Engagement protocol (lot L6; read model first in L2)

The default rule (R19) meets a coded safety rule: auto-ticking is opt-in per loop precisely so that enabling infrastructure does not resurrect every loop at once (F13). This spec resolves the tension as **expected + alerted + one explicit action to engage** — the panel never silently flips `autoTick`, never starts a native loop by typing into a PTY behind the owner's back, and never hides the gap. Whether binding alone should auto-engage is OQ-10 (recommendation: no silent enrolment; see §13).

Engaging a bound (session, objective) pair from the panel (`/a` is answers; loop actions live in the session/objective expander — keys in §9.2) performs, in order:

1. **Ensure the h2a loop exists and is bound.** If the objective has no loop yet, offer creation with the objective's refs pre-filled (`h2a loop create --track <refs>`, F11) — the owner confirms (`Enter`); the panel creates nothing on a bare keystroke. If the session is not enrolled, enrol it (`h2a loop join` semantics: idempotent, conflict = shown error, never overwrite a different recorded enrolment).
2. **Native-first (R21).** If the session's CLI has a native mechanism (§5.3): send the *engage request* — launch-prompt instruction for new sessions, `h2a send` for-info message for running ones (same signed-inbox channel as §7, marked as a loop-engage request carrying loop id, objective refs, and the attestation expected back). The agent itself starts its native loop/goal and attests by `h2a_loop_report` (or the MCP/CLI equivalent) with mechanism `native`. Until attestation arrives the state stays NOT ENGAGED with sub-state text `engage requested <time>` — the request is visible, not counted as engagement.
3. **h2a fallback / choice.** If the CLI has no native mechanism, or the engage request is declined/times out (proposal: no attestation within 2× `tickMs`), or the owner chooses h2a explicitly: offer `loop enable-auto-tick` for that loop (per-loop opt-in, F13) — again `Enter`-confirmed, with the supervisor consequence named in the confirm line (“requires the loop supervisor; currently: attended/unattended”). Enabling opt-in without a running supervisor yields UNATTENDED (§5.2), which is the correct visible outcome, not a failure toast.
4. **Record.** Every step writes through existing surfaces only (loop store events `loop.created/track-linked/agent-joined/auto-tick-enabled`, agent reports; `h2a send` exit evidence shown like §7). The panel adds no second engagement journal; the *mechanism* per agent (`native|h2a`, attested-at) is derived from the latest engagement report event for that agent (§11) — if the store needs one additive event payload field for this, L6 adds it to the report event, not a new file.
5. **Disengage/stop.** Symmetric explicit actions: stop native (for-info request + attestation decays), disable auto-tick (store write, event), `loop stop` (terminal, human-confirmed). `blocked` recovery stays explicit and CLI-only as the engine already requires (F14) — the panel links to it, never one-key “unblocks”.

Guardrails inherited, not reinvented: human-typing guard + R3 idle gate for any wake injection (F14); single-writer executor lease for ticks (F13); kill-switch supremacy (engaging while frozen records opt-in but renders `frozen`, §5.2); no PTY writes to a session the panel merely observes (F4).

### 5.5 Multi-project objectives at meta-workspace level (R22)

- **Attachment level.** An objective is attached to a **meta-workspace** (panel tab, §4.2) when its refs'/repos' projects intersect that tab's projects, or when any bound session lives in the tab. The objective renders **once** in the tab's objectives list even when it spans several of the tab's projects; if it also touches projects in another tab, it renders once per concerned tab with a `also in <tab>` marker — identity is the loop id, so the two renderings can never diverge into “two objectives”.
- **Per-project citation, no silent copy.** Each ref row in the objective expander cites its source: `repoKey · workspace · aggregateKind/id · track-dir · journal head (short) · resolved status`. Reads are per-ref against that project's store (F15); the panel never copies events between journals, never writes Track except through §7's answer commands, and shows `unknown` per ref when that one store is unreadable while other refs still resolve.
- **Aggregate rollup (explicit, worst-first).** Objective-level state = the worst of its refs under this fixed order: `unknown` (any primary/target unresolvable) is *reported alongside*, not averaged away — the row shows `n/m refs resolved`. Satisfaction follows the store's own semantics: refs map to `accepted|done|pending|rejected|blocked|stale|unknown` (tick rollup vocabulary, F14/F15); the objective is *closable* only under the loop's `successCriteria` + `decisionGatePolicy` (F11) evaluated by the tick engine — the panel displays the engine's verdict (§5.6), it does not compute a second closure rule. `decision-gate` refs surface as the blocking decision rows (§4.3) with a back-link to the objective.
- **Per-session state stays per session.** Aggregation never hides a pair state: the objective row shows `↻ 2 engaged · 1 NOT ENGAGED *` style counts over its bound sessions, and expanding lists each (session, state, mechanism, attestation/heartbeat age). A multi-project objective with one neglected project session therefore alerts exactly where R22 requires: per session *and* aggregated.

### 5.6 What is displayed: iteration, last verdict, freshening

Derived read-only from the loop store (F14 — no stored counter exists):

- **Iteration** = count of `loop.tick` events in `events.jsonl` for the loop (dry-run ticks counted and marked `dry` on the last one if applicable). Native-loop internal iterations are not countable from outside (§5.3); for native-engaged pairs the expander shows `h2a ticks: n · native iterations: not observable` rather than inventing a number, plus the agent's last report note/time.
- **Last verdict** = last `loop.tick` outcome + degraded flag + planned action types, with reasons shown in the expander; when the tick engine's fuller plan is needed, `h2a_loop_status`'s last-tick observation is the existing read surface — the panel consumes the same derivation, not a re-implementation of `planLoopTick` in the attach process. No tick ever recorded ⇒ `no tick yet`.
- **Freshening.** The panel snapshot (§11) re-reads stores on the bar's cadence (≤1 Hz time-driven, F1) plus immediately after any panel action. File reads are bounded (the bar counter's 64 KiB bounded-read posture, F16) and a torn/oversized `state.json` degrades that loop to `unknown`, never crashes attach. L2 owns the F16 reconciliation so bar `L` and panel loop tokens derive from one vocabulary; until then the panel is the correct surface and the bar counter's possible `L?` is a known, documented limitation — not silently “fixed” by display tricks.

## 6. Track pane (R6/R13)

- **Content.** `track report --status-table` (F21) for a chosen period: `today`, `week`, `month`, `all`, `last-week` (the status-table default), `last-day`, or explicit `--since/--until` — the exact F21 selector set, no panel-invented periods, `--since`/`--period` mutual exclusion preserved in the UI. The pane renders the four sections in panel width, then the summary block. L0 ships the `/t` view as an explicit “not in L0” placeholder (B1); the real pane is lot L4.
- **Which journal(s) — multi-project correction.** The pane is scoped to the **selected session's workspace by default**, switchable to any project in the current tab; each rendering header cites `workspace · track-dir · period · journal revision (events/head short)` (F15/F21). For a multi-project objective (§5.5) the pane offers one report **per concerned project** (tabbed/stacked, each cited) — never a merged cross-journal report, because Track has no cross-repo report semantics to reuse (F18) and inventing one in the panel would create the silent-copy R22 forbids.
- **Summary route (named, no new keys).** The chosen period's report JSON is summarised by a low-cost third-party model **through the existing local gateway only**: model `gemini-3.8-flash` (alias `flash`, F22 catalog) called on the local gateway base URL resolved exactly as the status snapshot resolves it (F22). No provider key in the panel, no direct provider call, no new config file. Input is bounded (status-table JSON + period payload, fixed scalar cap, truncation marked in the prompt) and instructed to summarise *from the recent status* (movement inside the window) while **carrying active objectives through verbatim**: the prompt enumerates active objectives (F19-filtered titles/ids) as must-keep lines and acceptance checks their presence in the output (§12 L4) — a summary that drops one is rejected and the raw report shown instead.
- **Enablement & privacy.** Summarisation sends project text to a third-party model via the gateway; therefore it is **opt-in per workspace, default off** (recommendation carried into OQ-7 for owner confirmation; the route itself is not in question). With opt-in off the pane is the raw report only — fully functional, no nagging.
- **Cache & degraded states.** One summary per (workspace, period selector, journal revision `count+head`, F21); a moved journal invalidates. In order: opt-in off → no summary block; gateway posture direct/off or base URL unresolvable → `summary unavailable (gateway off)` + raw report; gateway/model error or must-keep check failed → `summary unavailable` + raw report. The summary never blocks, delays or overwrites the raw report, and is labelled as machine-generated, with model id + generation time.

## 7. Asynchronous decisions (R7)

### 7.1 Principle and boundary

A decision answered in the panel is answered **asynchronously** w.r.t. the concerned session: the session is *informed*, never interrupted, never presented with a blocking question by the panel. This complements the 2026-11-07 owner-gate spec (a decision blocking a session *now* still uses that session's native question surface with its durable pending record); the panel is the async path and must not be used to bypass a live native gate — if the concerned session is currently blocked on this very decision through its native surface, the panel row says so and `/a` routes the owner to that session instead of double-answering.

### 7.2 Answer flow (`/a`, lot L5)

1. Owner selects a decision/question row, then an option (structured dossier) or confirms the outcome (unstructured dossier) — the affordances Track's canevas already advertises (F20). Free-text answers to `qa[]` questions are recorded as dossier QA answers through the existing Track write surface where one exists; where Track offers no QA-answer event, `/a` on a pure question records nothing in Track and only informs the session (step 3) — the row states which case applies before confirming. (L5 verifies the exact Track verb set; inventing a Track event from the panel is forbidden.)
2. **Track records first** (decisions): `track decision select <decisionId> <optionId>` (or `decision outcome`) against the decision's **own** project store (§4.3 citation). Track write failure ⇒ nothing is sent, failure shown on the row; the answer exists nowhere else. The h-cond single-writer rule for the live store is untouched: the panel invokes the same CLI surface any operator would, in the workspace the owner is attached to.
3. **Then h2a informs:** `h2a send <target> <message>` (F24), marked for-info, carrying decision id + title, chosen option id + title (or QA answer), answer time, and dossier locator (`track focus <id>` / artifact ref / loop id when the decision gates an objective, §5.5). Ordinary signed message body — no new envelope type; a message never proves consent or a native question (owner-gate boundary).
4. **Evidence wording is exact.** `h2a send` exit 0 ⇒ row shows `deposited in inbox · <time>` — **not** “seen” or “applied” (F24). Failure (unknown/ambiguous target, key/inbox error — exit 1/2/3 mapped to their meanings) ⇒ `not sent — <reason>` + retry; the Track record stands, never rolled back, and retry never duplicates the Track event. When the decision gates a loop, the next tick's `route-decision`/verdict (§5.6) is the observable “loop noticed” signal and the objective expander links to it.

### 7.3 Concerned-session resolution (no guessing)

Deterministic, in order: (a) loop `decision-gate` target / gating loop's enrolled agent(s) for that workspace (F11/F14); (b) decision `accountable` / linked item `accountable|responsible` matching exactly one live session instance (F19/F20); (c) exactly one live session in the decision's `workspace`. Zero or several matches at every tier ⇒ Track answer still recorded, row marked `no live session — not sent`, owner picks the target from the session list before retry. Title-substring matching is forbidden. Multi-project decisions resolve per the decision's own workspace (its journal of record), even when the gating objective spans further projects (§5.5).

## 8. Gateway switch (`/gw`) and configuration (`/c`) (R10/R14/R16, lot L7)

### 8.1 What `/gw` can actually switch (F23 correction applied)

`/gw` on the selected session offers **only the levers that exist per session**:

1. **Posture toggle** `gateway ↔ direct` — the recorded launch pin (F22). Takes effect by restarting the same session (§8.2); the pin is re-emitted (`--gw/--no-gw`) exactly as restore does.
2. **Launch model choice** — relaunch with a different `--model` from the gateway catalog/aliases or the CLI's native model ids (F22/F10). The confirm line shows current observed route (`requested→upstream`, F6) vs. the requested new model; the *effective* upstream after restart is whatever the gateway then reports — the panel displays it, never promises it.
3. **Display-only (global) mappings.** PR #462 `modelRewrites` and routing `activeProfile` are gateway-host-global, startup-loaded (F23): the panel *shows* the effective rewrite for the session's last route when the gateway reports one and links to the config/restart procedure (`h2a llm-mesh restart`), but offers **no per-session rewrite editing** in v1. Until PR #462 is merged this block reads `model rewrites: unavailable (PR #462 not merged)` — never a guessed mapping. Making rewrites per-session would be a gateway-host design change; it is OQ-11, not assumed here.

### 8.2 Same-session restart semantics

Applying §8.1.1/§8.1.2 restarts **the same conversation** (R10): verify identity first (native: exact incarnation under controller lease; tmux-legacy: F25 safety — indeterminate evidence means *do not kill*, show the refusal), stop, relaunch via the centralised resume argv (F10) with the new pin/model, same cwd/label. The panel shows `restarting…` then the new observed `gw`/route state from the snapshot. Hard rules: `Enter` confirmation every time (OQ-12 default); sessions without a resolvable conversation id (attach-live rows, F7/F25), remote/SCW sessions, and dual-host-ambiguous identities show `/gw unavailable — <reason>`; no code path force-kills; restarting the *attached* session from its own panel first returns focus/geometry cleanly (the attach survives as observer of the restart or re-attaches — L7 picks one and byte-tests it; silently detaching the owner is a failure). Loop bindings survive restart (enrolment is by instance, F11) but native engagement must be re-attested (§5.3) — the row shows NOT ENGAGED until it is, which is correct, not a bug to smooth over.

### 8.3 `/c` configuration

Panel-local settings only: width (20–60, applied next open), opener key (`F12` default, `F9` alternative — §9), summary opt-in per workspace (§6), sub-pane fraction (§4.3). Persisted in the same remote config file the bar flag already lives in (F5 shape: `rightPanel: { enabled, width, opener?, … }`; env still wins over config per B2 precedence). `/c` never edits gateway-host config (`llm-mesh.json`), Track data, or loop policy — those keep their own surfaces (§8.1.3, §5.4).

## 9. Keyboard and mouse (R3/R15/R16)

### 9.1 Verified terminal facts (F26: VTE 0.84)

| # | Fact | Consequence |
|---|---|---|
| K1 | A bare `Ctrl+Shift` press emits **no bytes** on a pty (modifier-only press has no keysym to encode). | The wished “Ctrl+Shift opens the panel” cannot exist as stated; the opener must be a real key/chord. |
| K2 | Without kitty negotiation on the **outer** terminal, VTE sends `Ctrl+Shift+<letter>` identically to `Ctrl+<letter>` (single control byte). VTE 0.84 does not negotiate kitty progressive flags with the attach process (F3's kitty state is inner, CLI↔model). | Any `Ctrl+Shift+<letter>` opener would also fire on the CLI's own `Ctrl+<letter>` bindings. Rejected. |
| K3 | gnome-terminal/ptyxis consume `Ctrl+Shift+C/V/T/N/W/Q/F` at emulator level; those chords never reach the pty. | Unavailable regardless of K2. |
| K4 | `F12` arrives as `ESC [ 24 ~`, distinct and unambiguous; `F9` as `ESC [ 20 ~`. Function keys are unbound by default in Claude Code, Codex, agy and Muse; every printable/`Ctrl`/`Alt` class and `/…` at a CLI prompt collide with CLI bindings (slash commands, edit/interrupt/history classes). L0 re-verifies F-key freedom against the then-installed binaries before freezing (§12) — the constraint is the collision classes, not any single binding. | Opener = F12 (OQ-1 confirmation; F9 fallback via `/c`). The owner's `/x` grammar is realistic **only while the panel has focus**, which is how B1 already implements it. |
| K5 | VTE supports SGR mouse reporting (DECSET `1006`, with `1000` button reporting); with mouse reporting on, unmodified drag reports to the application and **Shift+drag** is the emulator-level text-selection bypass. Wheel events arrive as buttons 64/65 in SGR encoding. | Mouse contract in §9.3; Shift-selection must keep working end-to-end (R15 addendum wording). |

### 9.2 Keyboard scheme (owner grammar kept, opener corrected)

- **Capture order in `runAttach` (new, next to F2):** (1) `DETACH_BYTE` wins over everything, in any focus — detach is never shadowed by the panel; (2) opener sequence (`F12`/`F9`, incl. split-sequence buffering per B1: a partial opener prefix is held, never leaked to the CLI; a held prefix that completes as something else is forwarded whole); (3) SGR mouse sequences (§9.3); (4) in panel focus, panel grammar; (5) otherwise forward byte-identical. With the feature flag off, steps 2–4 do not exist.
- **Opener:** `F12` toggles open/close from any focus (B1). Opening moves input focus to the panel; closing returns focus to the CLI. `Esc` in panel focus returns focus to the CLI **without closing** (B1 — the panel stays visible as a read-only board while the owner types in the CLI; F12 or a panel click refocuses/closes per §9.3). While the CLI has focus, *only* the opener and detach byte are captured; while the panel has focus, nothing is forwarded to the child (its screen stays live behind).
- **In-panel grammar = owner's, unchanged (R16):** `/s` sessions (default view), `/d` decisions/questions, `/t` Track, `/a` answer (§7, lot L5 — before L5 it renders its lot marker, never a dead key), `/gw` (§8, L7), `/c` (§8.3, L7). `Tab` next meta-workspace tab, `Shift+Tab` (`CSI Z`, distinguishable in panel focus) previous. Row navigation: `↑/↓` (and `j/k` as aliases *inside panel focus only*, where they cannot collide), `Enter` activate/confirm, `→/←` or `Space` expand/collapse (`delegated`, `objective/loop`, `restorable`). Loop actions (§5.4, L6) live in the expanded row: `e` engage.., `x` disengage/stop.. — both open a confirm line; **no state-changing action fires without `Enter` confirmation**, and destructive ones (restart, stop, send) always confirm. Free text is accepted only where a field is open (`/a` answer text); stray typing in panel focus is consumed and shown as ignored, never forwarded by accident.
- **Equivalence rule:** everything clickable is keyboard-reachable and vice versa (R15 is *in addition to* the keyboard). Lot acceptance includes a keyboard-only walkthrough and a mouse-only walkthrough of the same actions.

### 9.3 Mouse contract (R15 — every panel and bottom-bar element clickable)

- **Reporting mode.** While the feature is enabled, the attach layer enables SGR mouse reporting on the **outer** terminal (`?1000h ?1006h`) for the *whole attach* — open **and collapsed** — because the collapsed marker and the bottom-bar toggle (§4.4) must be clickable when closed (this closes the gap noted in B3, where enabling on open alone makes collapsed clicks undeliverable in a real terminal). On detach/exit the child's exact prior mode set is restored (F3 symmetry: h2a's reporting is switched off, then the child's tracked modes re-emitted — never the reverse order). Trade-off stated plainly: with the feature on, outer-terminal text selection needs **Shift+drag** (K5); with the feature off, mouse behaviour is byte-identical to today. Restricting reporting to open-only (losing collapsed click-to-open) is OQ-5; recommendation: whole-attach as above, since R15 explicitly demands the bottom-bar marker be clickable.
- **Parsing.** Incremental SGR parser (`ESC [< b ; x ; y M/m`) over the input stream, split-sequence safe (incomplete tail buffered, B3); malformed/oversized sequences are dropped as panel input and never forwarded as garbage to the child. Press (`M`) acts; release (`m`) is consumed without acting (except drag-end for future use); motion reports are not requested (`1002/1003` are not enabled by h2a on the outer terminal).
- **Routing by coordinates (B3 zones, 1-based `x,y` as reported):**
  - `x > childCols` and `y < rows` (panel or marker column): **panel zone** — h2a handles it, nothing forwarded. Hit-testing is by rendered cell ranges (tab label spans on row 1 select *that* tab — L0's interim “tab-row click cycles” behaviour (B3) is tightened to direct selection in L1; row hits select, second click/`Enter`-equivalent double-click activates (dossier/sub-pane, expander toggle on the `▸` cell)). Clicking the collapsed marker column toggles the panel open.
  - `y = rows` (bottom-bar row): **status-marker zone** on the marker span (toggles the panel); elsewhere on the bar — delegated-names span selects that delegated session's parent row (L1+), gateway span opens the panel on the selected session (read-only jump; `/gw` still needs its confirm). Bar clicks never reach the CLI (the row is reserved, F1).
  - `x ≤ childCols` and `y < rows`: **CLI zone** — forwarded to the child **only if the child itself enabled mouse tracking** (F3 accessor: any of `1000/1002/1003` on). Forwarding transcodes to the child's negotiated encoding: verbatim SGR bytes when the child enabled `1006`; re-encoded X10/`1015` forms otherwise; event classes the child did not subscribe to (e.g. wheel without the corresponding mode, motion) are dropped, not approximated. Coordinates need no translation (panel is right of the child area, child origin stays at 1,1; the reserved bottom row is already outside the child's rows). When the child has no mouse tracking, CLI-zone clicks are consumed (they belong to h2a's reporting session) — the owner's selection path is Shift+drag, next bullet.
  - **Shift-modified events** (button code bit 4): `native-selection` — never acted on by the panel, never forwarded; combined with VTE's emulator-level Shift bypass (K5) this keeps native text selection working. (Where VTE swallows the Shift+drag entirely at emulator level, no event arrives — also correct.)
  - **Wheel** (buttons 64/65): in panel/marker zone, scrolls the panel list (and the sub-pane when the pointer is over it) by 3 rows per notch; in CLI zone, forwarded under the same child-subscription rule as clicks; over the bottom bar, ignored.
- **Focus on click.** A panel-zone click while the CLI has focus selects *and* gives the panel keyboard focus (so `/a` etc. work immediately); `Esc` returns keyboard focus without closing (§9.2). Clicking in the CLI zone returns keyboard focus to the CLI (forwarding still governed by child mouse state — focus and mouse-forwarding are independent axes and the spec keeps them so).

## 10. Accessibility (owner colour-blindness is a design input, R12)

Colour is never the only channel. Every state is **symbol + colour + `*`/word**:

| State | Symbol | `*` | Notes |
|---|---|---|---|
| running / working | `●` | — | |
| idle / waiting input | `○` | — | |
| waiting (CI/agent/tick) | `◐` | — | loop `waiting-agent` reuses this + token word (§5.2) |
| paused | `⏸` | — | wide glyph — L1 verifies column accounting with wide/ambiguous-width glyphs (F6 width function) and falls back to `\|\|` if a fixture terminal disagrees |
| blocked / failed | `✖` | `*` when actionable | loop `blocked/failed` always `*` (§5.2) |
| decision pending | `◆` | `*` always | |
| question unanswered | `?` (+ word on selection) | `*` always | distinct from unknown by the `*` + selection word |
| loop NOT ENGAGED / unattended | `↻` + words `NOT ENGAGED` / `unattended` | `*` always | words, not hue, carry the R20 alert |
| unknown / degraded | `?` muted + literal word `unknown` | — | never shares a rendering with “question” once selected (selection line always spells the state word) |

Rules: `*` ⇔ owner attention required (decision, question, actionable block, loop gap) — it is the primary scan signal; selection uses reverse video, not a hue change; the lit marker pairs background with `*`; panel and bottom bar share one symbol vocabulary (§4.4/§5.6) so the two reserved areas cannot disagree; monochrome/`NO_COLOR` loses nothing (symbols, `*`, words carry full state); all glyphs must be width-stable under the existing display-column accounting (F6) — a glyph that breaks column math is replaced, not padded around.

## 11. Snapshot / read-model contract (what lots build against)

One snapshot derivation feeds open panel, collapsed marker and (from L2) the bar loop token. Field names already fixed by the L0 lane (B4) are kept; later lots extend additively — renaming an L0 field after L0 ships requires a spec amendment, not a silent refactor.

- **L0 shape (B4):** `workspaces[] {title, sessions[] {id, label, status, delegated?}}`, `decisions[] {id, title, kind, sessionId?, dossierLink?}`, `attentionCount` (§4.5 definition), `collapsedLit`, `degraded`. Status enum L0: `running|idle|waiting|paused|blocked|failed|question|decision|unknown` (glyph table §10).
- **Additive extensions by lot:** L1 — `delegatedNames` per session (for §4.4), `restorableCount`, per-project `decisionsDegraded` (replacing the single global `degraded` for decisions; global `degraded` remains the OR for the marker); L2 — per-session `loop?: {state (§5.2), mechanism?: native|h2a, loopId?, objectiveLabel?, attestedOrHeartbeatAgeMs?, lastTick?: {n, outcome, at, dryRun}}`, top-level `objectives[]` (§5.5 rows with per-ref citations + resolved counts), `frozen: boolean` (kill-switch), per-source degradation (`sources: {restore, track, loops, presence}` each `ok|degraded` + reason) so `unknown` always names its source; L4 — Track pane payload stays out of the 1 Hz snapshot (fetched per period/workspace on view, cached per §6) to keep the attach loop light.
- **Derivation rules:** every field is either observed or explicitly `unknown`/absent-with-reason — no defaults that read as facts (F6 posture); liveness, binding and engagement follow §4.2/§5.1/§5.2 evidence rules; snapshot building never writes (no store creation, no Track writes, no sends) and never throws out of attach (per-source try/degrade, F16 bounded reads).

## 12. Lots (smallest first; each independently shippable)

Global rules for every lot: targeted tests only (new files named per lot + adjacent existing suites: `native-terminal/op.test.ts`, `native-terminal/terminal-modes.test.ts`, status-projection tests, `restore*.test.ts`); fixtures in temporary directories only (lane `TMPDIR`, never real `/tmp`, never real h2a/Track state — a test that skips for missing real state counts as failed); fake PTYs and fake session/loop/Track stores, no real accounts, no network (gateway tests use a local test double); red-before/green-after per regression; root typecheck + build + no-python + public-contract checks per lot; full repo suite is the conductor's integration step, not a lot step. “Acceptance” below names the test that proves each clause — Annex C indexes them per requirement.

### L0 — Read-only panel behind a flag (the 0.98 cut; identical to the parallel build lane)

Scope (§4.1, §4.2 sans loop token, §4.3 list-only, §4.5, §9.2/§9.3 L0 subset, §11 L0 shape): reserved-column geometry wired into `runAttach` (child resize via `client.resize`, column clamping, restore symmetry); flag surface B2 default OFF; F12 toggle + collapsed/bottom-bar marker click; meta-workspace tabs from restore groups; active sessions with symbol+colour+`*`, delegated hidden; Track pending decisions/questions with dossier-link *text*; `/s` `/d` `/t` (Track = “not in L0” placeholder), `Tab`, `Esc`-focus; SGR mouse (panel select, CLI forwarding per child mouse state via the F3 accessor, Shift→native-selection); 1-column collapsed marker lit per §4.5. Explicitly out (named in the L0 PR body as next lots): loop tokens/objectives, `/a`, Track pane+summary, dossier opening/sub-pane, `/gw`, `/c`, delegated expanders beyond hiding, direct tab-span hit-testing (L0 interim: tab-row click cycles — must be *labelled interim* in the PR).

Acceptance:
1. Flag off ⇒ attach byte-identical (existing `op`/status-bar suites green unchanged; recorded input/output byte-diff harness shows zero deltas). Flag on ⇒ child PTY reports `cols−32` open / `cols−1` collapsed through the headless model; alternate-screen, mouse-reporting and kitty-flag fixture children render and restore byte-identical across open/close/resize/detach/reconnect.
2. Rows equal the fixture restore inventory exactly (same sessions, same `groupSessions` tabs; delegated fixtures absent from human rows) and the fixture Track set (pending/deferred only, unanswered-`qa` ⇒ question, link text present). `attentionCount`/`collapsedLit` table-tested incl. dedup (§4.5), attached-session-only ⇒ unlit, unreadable source ⇒ `?`.
3. Input proofs (byte-diff): F12 (incl. split across chunks) never reaches the child; detach byte wins in panel focus; panel-focus bytes never reach the child; CLI-focus bytes (except opener/detach) reach the child unmodified; Esc returns focus without closing.
4. Mouse proofs (real-PTY functional test, not only unit routing): enabling reporting for the whole attach (collapsed click on marker/bottom-bar opens), panel click selects tab/session and surfaces `open-link` target text, CLI-zone click forwarded verbatim only when the fixture child enabled `1006` (and dropped otherwise), Shift event never acted on/forwarded, detach restores the child's exact mouse/kitty/margin modes.
5. Below 40 child columns open is refused with marker intact; below 10 rows neither reserved area paints; `?69`-ignoring fixture terminal still renders correctly via absolute addressing.
6. F12/F9 freedom re-verified against installed `claude`/`agy`/`muse` binaries (Annex D commands re-run; result recorded in the PR). `codex` absence, if still absent, recorded as unverified-there with the K4 class argument — not claimed as probed.

Tests: `native-terminal/right-panel.test.ts` (exists in lane), `native-terminal/right-panel.functional.test.ts` (real PTY child), `terminal-modes.test.ts` accessor cases, snapshot-builder tests over restore/Track fixtures.

### L1 — Navigation complete: direct hit-testing, expanders, bottom-bar delegated names

Scope: tab-span direct selection (replaces L0 cycle interim), row navigation keys (§9.2), delegated + restorable expanders (§4.2), selected-session delegated names in the bottom bar (§4.4), wheel scrolling (§9.3), multi-store decisions reading (§4.3) if L0 shipped single-store, wide-glyph width verification (§10).

Acceptance:
1. Clicking each tab label span selects exactly that tab; Tab/Shift+Tab cycle the same set; keyboard-only and mouse-only walkthroughs perform every L0+L1 action (§9.2 equivalence).
2. Expanders show F9-provenanced delegated executions under the right parent only; unattributed work renders `deleg ?`; no sub-session ever promotes to a human row across the fixture matrix.
3. Selecting a session re-renders the bar with its delegated names (truncation order §4.4 fixture-tested at several widths); deselect/close restores count form byte-identically.
4. Decisions aggregate every tab-project store with per-project citation; one unreadable store ⇒ that project's `unknown (?)` line + others intact.
5. Wheel over panel/sub-pane-less list scrolls 3/notch, clamps at ends, and never leaks wheel bytes to a non-subscribed child.

Tests: `right-panel.test.ts` additions (hit-map, expander state machine), status-bar rendering tests for the names form, multi-store fixture tests.

### L2 — Objective & loop visibility, read-only (R19/R20/R22 display half)

Scope: §5.1 binding resolution, §5.2 state machine, §5.5 objectives list + per-ref citation/rollup display, §5.6 iteration/verdict/frozen rendering, §11 L2 extensions, bar loop token (§4.4), F16 reconciliation (one loop vocabulary for bar + panel). No writes of any kind.

Acceptance:
1. Fixture matrix over (binding tier × loop status × opt-in × attendance × attestation age × kill-switch) renders exactly the §5.2 table, incl. stale-attestation decay ⇒ NOT ENGAGED, frozen fleet rendering, and per-source `unknown` naming its source.
2. Multi-project fixture (one loop, refs in ≥2 project stores, sessions in both): objective appears once per concerned tab with `also in` marker, per-ref citations correct, one store removed ⇒ that ref `unknown` + `n/m` count drops, other refs unaffected; aggregate counts match per-pair states.
3. Iteration = `loop.tick` count over a fixture `events.jsonl` (dry-run marked); native-engaged pair shows “native iterations: not observable”; no-tick loop shows `no tick yet`.
4. Canonical store fixtures that the old bar counter (F16) degraded now render correctly in panel **and** bar `L` (regression pair red→green); panel and bar never disagree on the shared fixtures.
5. Snapshot building performs zero writes (store mtimes/content unchanged across renders, fixture-asserted) and a torn `state.json` degrades only its loop.

Tests: `native-terminal/right-panel-loops.test.ts` (state machine + multi-project), status-projection loop-counter regression tests, binding-tier fixture tests.

### L3 — Dossier opening + observer sub-pane (R5/R18)

Scope: §4.3 activation routes per artifact kind (md text in sub-pane, `track focus` render, external refs via system opener), sub-pane observer over `attachObserver`/`readOutput` (F4), sub-pane header/scroll (wheel zone §9.3), not-live rendering.

Acceptance:
1. Each F20 artifact kind takes its §4.3 route on fixtures; missing/unreadable artifact shows ref + reason, never blank; embedded md/html content is rendered as inert text (no execution, no escape-sequence injection into the outer terminal — sanitisation fixture with embedded CSI/OSC proves neutralisation).
2. Observed session renders live read-only; every panel input class (keys, clicks, wheel, paste-like bursts) produces **zero bytes** on the observed PTY (byte-diff) and never acquires its controller lease; the observed session's human controller is undisturbed (fixture asserts lease ownership throughout).
3. Non-live concerned session ⇒ last-known-state + “not live — no sub-pane”; session exiting mid-observation degrades to that state without attach crash.

Tests: `native-terminal/right-panel-subpane.test.ts` (observer isolation + artifact routes + sanitisation), `track focus` invocation contract fixtures.

### L4 — Track pane + gateway summary (R6)

Scope: §6 complete (period chooser, per-workspace/per-project reports with citations, `gemini-3.8-flash` summary via local gateway, revision cache, opt-in gate, degraded lines).

Acceptance:
1. Every F21 period renders byte-identical report content to `track report --status-table --format json` over the same fixture journal (per workspace); active objectives present in every period; header citation matches (workspace, track-dir, revision).
2. Gateway test double records exactly one summary request per (workspace, period, revision) with model `gemini-3.8-flash` and bounded prompt (truncation marker past cap); moved journal ⇒ exactly one new request; no request leaves the local gateway base URL; opt-in off ⇒ zero requests.
3. Must-keep gate: a double returning a summary missing an active objective ⇒ summary rejected, raw report intact; gateway off/unreachable/model-error each render their §6 degraded line with raw report intact and no retry storm (≤1 request per render).
4. Summary block carries model id + time + machine-generated label; raw report renders before/without summary completion (no blocking fixture: hanging double ⇒ raw visible, summary line pending→unavailable).

Tests: `native-terminal/right-panel-track.test.ts` (parity, cache, degraded matrix, must-keep), gateway double contract test.

### L5 — Asynchronous answers `/a` (R7)

Scope: §7 complete (Track-first recording per own-store, for-info `h2a send`, evidence wording, retry, §7.3 resolution tiers, native-gate coexistence check). Gate: L3 (dossier reading precedes answering).

Acceptance:
1. Success path: exactly one Track option/outcome event in the correct project journal **then** exactly one signed inbox deposit to the resolved instance (order asserted); body contains decision/option ids + dossier locator (+ loop id for gates); row reads `deposited in inbox · <time>`.
2. Failure matrix: Track failure ⇒ zero sends; send exit 1/2/3 each ⇒ Track stands, row `not sent — <mapped reason>`, retry sends without a second Track event; ambiguous/absent target at all §7.3 tiers ⇒ manual pick required, zero sends before pick.
3. Answering writes zero bytes to any concerned PTY and raises no native question (PTY byte-diff + no controller acquisition); session blocked natively on the same decision ⇒ `/a` refuses with the route-to-session message (§7.1 fixture).
4. Pure-QA path states its recording case before confirm (Track-recorded vs inform-only, §7.2.1) — fixture covers whichever Track verb set L5 verified; if inform-only, no Track event is fabricated.

Tests: `native-terminal/right-panel-answer.test.ts` (ordering, failure matrix, resolution tiers), `h2a send` contract reuse.

### L6 — Loop engagement actions (R19/R21 action half)

Scope: §5.4 complete (create-with-refs offer, enrol, native engage request + attestation handling incl. timeout→fallback offer, per-loop `enable-auto-tick`, disengage/stop, mechanism recording), engage/disengage keys + clicks with confirms (§9.2). Gates: L2 (state machine), L5's send evidence patterns reused. **Pre-freeze gate:** Annex D probes re-run on then-installed binaries (incl. `codex` if present by then); §5.3 rows updated by spec amendment if a surface changed — code ships against probed surfaces only.

Acceptance:
1. Claude-fixture flow: engage ⇒ enrolment event + one for-info engage deposit; state stays NOT ENGAGED/`engage requested` until a fixture attestation report lands ⇒ `↻ native` with fresh age; attestation aged past 3×`tickMs` (fixture clock) ⇒ decays to NOT ENGAGED. No PTY bytes written to the session at any point (byte-diff).
2. No-native fixture (agy/codex-shaped): engage goes straight to the h2a offer; confirming writes `autoTick:true` + `loop.auto-tick-enabled` event exactly once (idempotent re-engage); with no supervisor fixture ⇒ UNATTENDED; with a beating supervisor fixture (single-beat driver) ⇒ `↻ h2a` + heartbeat age shown; kill-switch on ⇒ `frozen` rendering and zero ticks.
3. Native timeout (2×`tickMs`, fixture clock) ⇒ fallback offer appears, state never flaps to engaged in between; owner declining both paths leaves NOT ENGAGED with the decline visible in the expander (no nagging re-prompts).
4. Disengage/stop: stop requires confirm, writes terminal status via existing store path, tick engine subsequently plans no actions (fixture tick = no-op); `blocked` loop offers no panel unblock (link text only).
5. Create-with-refs: pre-filled refs validate through the store's own validation (bad ref fixture ⇒ store error surfaced verbatim, nothing half-created: no loop dir left behind).

Tests: `native-terminal/right-panel-engage.test.ts` (flows over fixture stores + fake inbox + beat driver), loop-store contract reuse from `packages/h2a/test/loop*.test.js` fixtures where applicable.

### L7 — `/gw` restart switch + `/c` configuration (R10)

Scope: §8 complete. Gate: posture+model path needs no PR; the §8.1.3 display block's live form needs PR #462 merged (until then the unavailable wording ships and is tested as such).

Acceptance:
1. Controlled native fixture session: `/gw` posture toggle restarts the **same** conversation id with the flipped pin (relaunch argv asserted per F10 profile); model choice relaunches with the chosen `--model`; bar then shows the newly observed route from the fixture ledger. Refusal fixtures (indeterminate liveness, attach-live/no-convId, remote, ambiguous) ⇒ zero kills, reason shown (F25).
2. Attached-session self-restart: owner's attach ends in the L7-chosen posture (observer-survives or re-attach) with geometry/modes byte-clean; loop binding intact, native attestation correctly decayed to NOT ENGAGED until re-attested (§8.2).
3. `/gw` on a session the gateway reports a PR #462 rewrite for (fixture header/ledger) displays `requested→target (gateway rewrite, global)` read-only; pre-#462 build displays the unavailable line; no fixture can make the panel write `llm-mesh.json` (file unchanged asserted).
4. `/c`: width/opener/opt-ins persist across attaches (config fixture), env still overrides (B2), moving opener F12→F9 frees F12 to the child (byte-diff) and captures F9 instead; invalid persisted values fall back to defaults without crashing attach.

Tests: `native-terminal/right-panel-gateway.test.ts` (relaunch/refusal matrix), config persistence + opener-remap byte-diffs.

## 13. Open questions for the owner (options + recommendation each)

Defaults are chosen so that answering nothing still yields a coherent L0→L2 path. “Blocks” names the first lot that needs the answer.

| # | Question | Options | Recommendation (default until answered) | Blocks |
|---|---|---|---|---|
| OQ-1 | Opener key: F12 as built by L0? (§9, K1–K4: `Ctrl+Shift` alone is impossible) | (a) F12 · (b) F9 · (c) both active | **(a) F12**; `/c` can move it at L7. Pick (b) only if your window manager captures F12. | L0 freeze |
| OQ-2 | Panel width default 32 (clamp 20–60, B2)? | (a) fixed 32 · (b) 25 % of cols, clamped · (c) last-used persisted | **(a) now**, (c) via `/c` at L7 — predictable tree layout for 0.98. | L7 |
| OQ-3 | After the 0.98 trial, should the flag stay default-OFF? | (a) stay opt-in · (b) default ON for native attach · (c) default ON but collapsed-only until first open | **(a)** until L2 lands and mouse-whole-attach (OQ-5) has lived a release; geometry+mouse changes earn their default. | post-0.98 |
| OQ-4 | Collapsed marker: 1 column (`*` only) or 2 columns (`*` + count digit)? (§4.5) | (a) 1 col · (b) 2 cols | **(a)** — count lives in panel header + bar; 1 col is what L0 ships. | L1 |
| OQ-5 | Mouse reporting while collapsed (needed for marker/bar click-to-open; cost: selection becomes Shift+drag while the feature is on)? (§9.3) | (a) whole-attach reporting · (b) open-only (collapsed opens by F12 only) | **(a)** — R15 asks for the bottom-bar element clickable; (b) silently breaks that when closed. | L0 |
| OQ-6 | Sub-pane: read-only observer forever, or interactive take-over later? (§4.3) | (a) observer in v1, take-over as its own later design · (b) interactive from L3 | **(a)** — single-controller lease semantics (F4) make take-over a separate safety design. | L3 |
| OQ-7 | Track summary to `gemini-3.8-flash` via gateway: enablement scope? (§6) | (a) all workspaces · (b) per-workspace opt-in, default off · (c) never (raw only) | **(b)** — reports carry sensitive project text; route stays, consent is per workspace. | L4 |
| OQ-8 | Tabs: restore windows only, or + a derived “Attention” tab across workspaces? (§4.2) | (a) restore only · (b) restore + Attention | **(b) at L1/L2** (it is the lit marker's expanded form; adds no config) — not in L0. | L1 |
| OQ-9 | Should *unbound candidate* objectives also raise the per-session `*`? (§5.1/§5.2) | (a) no — bound-only alerts, candidates listed · (b) yes — any pursuable objective alerts its workspace's sessions | **(a)** — (b) alerts every session in any busy repo permanently and destroys the signal R20 wants. | L2 |
| OQ-10 | Default rule strength: alert + one-action engage (this spec), or binding auto-engages (native request sent / `autoTick` set without asking)? (§5.4 vs F13 blast-radius rule) | (a) explicit engage action · (b) auto-engage on binding · (c) auto-engage only loops created from the panel | **(a)** — F13's opt-in exists because silent enrolment resurrects fleets; revisit only with per-workspace policy + supervisor proof. (c) is the acceptable middle if you want less clicking. | L6 |
| OQ-11 | Per-session gateway rewrites: is display-only (global PR #462 config) enough, or should the gateway host grow per-session rewrites? (§8.1) | (a) display-only in v1 · (b) specify per-session rewrites as a gateway-host follow-up | **(a)** for this spec; (b) deserves its own gateway spec (session keying, validation, restart semantics) — not smuggled into a panel lot. | L7+ |
| OQ-12 | `/gw` restart confirmation each time? (§8.2) | (a) confirm every restart · (b) once per session per attach · (c) none | **(a)** — a restart kills a running CLI process; one keystroke is the right price. | L7 |
| OQ-13 | Who runs the durable loop supervisor (without it, h2a-engaged loops read UNATTENDED, F13)? | (a) owner-launched (e.g. systemd `--user` unit, as the supervisor module anticipates) · (b) panel offers “start supervisor” action · (c) `loop watch` per loop, manually | **(a) + panel displays attendance either way**; (b) only as a separate, explicitly-confirmed action in a later lot — the attach process must not become a hidden daemon spawner. | L6 |
| OQ-14 | Track pane defaults: preselected workspace + period? (§6) | (a) selected session's workspace, `last-week` · (b) last-chosen pair persisted, initial (a) · (c) attached session's workspace, `today` | **(b) with initial (a)** — matches `--status-table`'s own default, then remembers. | L4 |
| OQ-15 | Binding tier 2 (Track `accountable/responsible` ⇒ bound, §5.1): on by default? | (a) on — RACI assignment is a real engagement · (b) off — only loop enrolment (tier 1) binds; RACI shown as candidate | **(a) but only when the RACI value is the session's exact instance/actor id** (never a human name match) — if your Track RACI fields name humans rather than instances, pick (b) or tier 2 stays empty in practice, which L2's diagnostics will show. | L2 |

## Annex A — Code map (folded)

<details>
<summary>Implementation seams per lot</summary>

| Seam | File / surface | Lots |
|---|---|---|
| Reserved geometry, input capture order, repaint, child resize | `packages/h2a-runtime/src/native-terminal/op.ts` (`NativeStatusBarController`, `runAttach`, `DETACH_BYTE`) | L0–L7 |
| Panel controller, snapshot builders, SGR parsing/routing (L0 lane) | `packages/h2a-runtime/src/native-terminal/right-panel.ts` (+ `.test.ts`, + `.functional.test.ts` from L0) | L0–L7 |
| Child mode tracking + mouse accessor | `packages/h2a-runtime/src/native-terminal/terminal-modes.ts` (`TerminalModeTracker`, `isMouseTrackingEnabled` added L0) | L0 |
| Observer sub-pane | `packages/h2a-runtime/src/native-terminal/client.ts` (`attachObserver`, `readOutput`; never `acquireController` for observation) | L3 |
| Bar snapshot/render, delegations, gateway observation, loop-counter reconciliation | `packages/h2a-runtime/src/status-projection.ts` (`readNativeStatusBarSnapshot`, `renderNativeStatusBarLine`, `projectDelegatedExecutions`, `readLoopsStatusCount`→canonical in L2) | L0–L2, L7 |
| Panel flag/config | `packages/h2a-runtime/src/config.ts` (`rightPanel` next to `statusBar`/`isStatusBarEnabled` shape) | L0, L7 |
| Session inventory + groups + human gating | `packages/h2a-runtime/src/restore.ts` (`discoverSessions`, `registrySessions`, `mergeDiscovered`, `groupSessions`, `isHumanFacingSession`) | L0–L1 |
| Resume argv per CLI | `packages/h2a-runtime/src/profiles.ts` (`resumeArgsFor`) | L7 |
| Relaunch safety (tmux-legacy) | `packages/h2a-runtime/src/relaunch.ts` (`decideRelaunchSafety`, `isRelaunchKillable`, `planRelaunch`) | L7 |
| Loop store + enrolment + opt-in | `packages/h2a/src/runtime/loop/index.ts` (`listObjectiveLoops*`, `joinObjectiveLoop`, `enableObjectiveLoopAutoTick`, `isLoopAutoTickEligible`, status sets) | L2, L6 |
| Attendance + supervisor beat (read side in panel) | `packages/h2a/src/runtime/loop/supervisor.ts` (`loopAttendance`, `readExecutorHeartbeat`) | L2, L6 |
| Tick verdict derivation (consume, never re-implement in attach) | `packages/h2a/src/runtime/loop/engine/{tick,decision,adapters}.ts`; MCP/CLI `loop status/list` | L2, L6 |
| Track decisions/dossiers/answers | `packages/track/src/model/decision.ts`; CLI `track decision select/outcome`, `track focus` | L0, L3, L5 |
| Track objectives/refs/report | `packages/track/src/read/contract.ts` (`TrackObjectiveRef`), `packages/track/src/read/commands.ts` (`reportText`), CLI `track report --status-table`, `track query` | L2, L4 |
| Gateway catalog/aliases, routing, PR #462 rewrites (display) | `packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts`, `packages/h2a-runtime/src/routing-preferences.ts`, `packages/h2a-runtime/src/gateway-host/config-file.ts` (rewrites after PR #462) | L4, L7 |
| For-info messaging (answers + engage requests) | `h2a send` (`packages/h2a/src/cli-contract.ts`, `packages/h2a/src/cli.ts` `cmdSend`) | L5, L6 |

</details>

## Annex B — Keyboard / mouse byte reference (folded)

<details>
<summary>Sequences relied on by §9 (VTE, `TERM=xterm-256color`)</summary>

| Input | Bytes / encoding | Note |
|---|---|---|
| `F12` / `F9` | `ESC [ 24 ~` / `ESC [ 20 ~` | opener / fallback (§9.2); split-safe buffering required |
| `Shift+Tab` | `ESC [ Z` | panel-focus only |
| `Esc` alone | `ESC` (ambiguity window vs. `ESC`-prefixed sequences — reuse the attach parser's existing split handling) | focus return, panel focus only |
| `Ctrl-\` | `0x1c` | existing detach byte (F2), always wins |
| `Ctrl+Shift+<letter>` | identical to `Ctrl+<letter>` without outer kitty negotiation | K2 — never bound |
| Bare `Ctrl+Shift` | *(no bytes)* | K1 — cannot be bound |
| SGR mouse report | `ESC [< b ; x ; y M` (press) / `m` (release); `b` bits: 4 Shift, 8 Meta, 16 Ctrl, 32 motion, 64 wheel (64 up / 65 down) | §9.3 parser; enable with `?1000h ?1006h`, restore child modes after |
| X10 mouse report (child without `1006`) | `ESC [ M Cb Cx Cy` (bytes +32, coords ≤223) | transcode target only; coords >223 cannot be represented ⇒ drop, never wrap |
| DECLRMM margins | `?69h` + `ESC [ Pl ; Pr s`, restore `?69l` | optimisation only (§4.1); correctness never depends on it |

</details>

## Annex C — Traceability: owner requirement → spec → lot → acceptance (folded)

<details>
<summary>Full R1–R23 mapping (acceptance ids are §12 lot + item numbers)</summary>

| Req | Spec sections | Lot(s) | Acceptance test(s) |
|---|---|---|---|
| R1 retractable panel | §4.1, §9.2 | L0 | L0.1 geometry open/collapsed, L0.5 minimums |
| R2 sessions/workspaces + tabs (mockup A) | §4.2 | L0, L1 | L0.2 inventory/tabs; L1.1 direct tab hit-testing |
| R3 clickable + no shortcut conflicts | §9.1–§9.3 | L0, L1 | L0.3 input byte-diffs, L0.4 mouse PTY proofs, L0.6 F-key probes; L1.1 equivalence |
| R4 decisions/blocking/questions visible | §4.3, §4.5, §10 | L0, L1 | L0.2 Track fixtures + attention table; L1.4 multi-store |
| R5 dossier reachability (md/Sentropic/Claude artifacts) | §4.3 | L0 (link text), L3 (open) | L0.2/L0.4 `open-link` target; L3.1 per-kind routes + sanitisation |
| R6 Track report by period + low-cost LLM summary | §6 | L0 (`/t` placeholder), L4 | L4.1 parity, L4.2 single gateway call/cache, L4.3 must-keep + degraded, L4.4 labelling/non-blocking |
| R7 async decisions via h2a message | §7 | L5 | L5.1 order + deposit wording, L5.2 failure matrix, L5.3 zero PTY bytes, L5.4 QA case |
| R8 meta-workspaces like restore groups | §4.2, §5.5 | L0, L2 | L0.2 `groupSessions` equality; L2.2 multi-project attachment |
| R9 active sessions as restore sees them | §4.2 | L0, L1 | L0.2 live-subset fixtures; L1.2 restorable expander |
| R10 per-session gw switch + model mapping, same-session restart | §8.1–§8.2 (F23 scope) | L7 | L7.1 restart/refusal matrix, L7.2 self-restart, L7.3 global-rewrite display-only |
| R11 loops + sub-sessions browsable, sub-sessions hidden by default | §4.2, §5.6 | L0 (hide), L1 (deleg expander), L2 (loop expander) | L0.2 delegated absent; L1.2 provenance; L2.1–L2.3 loop browsing |
| R12 colour + `*` attention | §10, §4.5, §5.2 | L0–L2 | L0.2 glyph/attention fixtures; L2.1 `*` states; §10 monochrome fixtures in L1 (wide glyphs) |
| R13 Track keeps active objectives | §5.1, §6 | L2, L4 | L2.1 active/terminal fixtures; L4.1 objectives in every period + L4.3 must-keep |
| R14 gw in bottom bar + delegated names of selected session | §4.4 | L1 (names), L7 (`/gw` drives bar controls) | L1.3 names/truncation; L7.1 observed route after restart |
| R15 mouse click everywhere (panel + bottom bar) | §9.3, §4.4 | L0, L1 | L0.4 whole-attach reporting + marker/bar clicks; L1.1/L1.5 hit-testing + wheel; L3 sub-pane wheel zone |
| R16 keyboard grammar checked for realism | §9.1–§9.2 | L0–L7 per key (`/s/d/t/Tab/Esc` L0; `/a` L5; `/gw`,`/c` L7) | L0.3/L0.6; L5 `/a` flows; L7.4 opener remap; lot-marker rendering before each key's lot |
| R17 collapsed bar lights for *another* blocked/questioned session | §4.5 | L0, L2 (loop gaps join) | L0.2 lit table; L2.1 NOT ENGAGED/UNATTENDED as subjects |
| R18 decision → dossier or session in bottom sub-pane | §4.3 | L3 | L3.1 dossier routes, L3.2 observer isolation, L3.3 not-live |
| R19 Track = objective source; loop by default iff objective engaged | §5.1, §5.2, §5.4 | L2 (display rule), L6 (engage action) | L2.1 state machine; L6.1–L6.3 engage flows; OQ-10 records the no-silent-enrolment reading |
| R20 loop state always explicit per session, panel + bottom bar, gap = `*` | §5.2, §4.4, §10 | L2 | L2.1 matrix incl. decay/frozen/unknown; L2.4 bar/panel agreement |
| R21 engage via each CLI's native loop, else h2a loop | §5.3, §5.4 | L6 (probes gate first) | L6.1 native attestation (Claude-shaped), L6.2 h2a fallback (no-native-shaped), L6.3 timeout→fallback; Annex D re-probe record |
| R22 objectives span projects, meta-level, per-project citation | §5.5, §4.3, §6 | L2, L4 | L2.2 multi-store objective; L4.1 per-project reports (no merged journal) |
| R23 fast first version for next 0.98 | §12 L0 (= build-lane brief) | L0 | L0.1–L0.6 complete; PR body names every deferred item as its lot |

</details>

## Annex D — CLI / terminal probe log, 2026-11-17 (folded)

<details>
<summary>Exact probes behind F26/F27 and §5.3 [bin] claims (re-run at L0.6 and L6 gate)</summary>

| Probe | Observed result |
|---|---|
| `gnome-terminal --version` | GNOME Terminal 3.58.0 using VTE 0.84.0 → F26 |
| `claude --version` / `claude --help` | 2.1.327; resume/continue forms present; no loop/cron/schedule outer verb → native loop is in-session (§5.3 Claude row, [repo]+[sess] for `/loop`) |
| `codex --version` | **not found on PATH** → Codex row is [repo]-only; “none on current evidence”, re-probe gate at L6 (do not upgrade this row without a binary) |
| `agy --version` / `agy --help` (+ `agy help`) | 1.5.10; `-c/--continue`, `--conversation`, `--print`, stream-json turn input, `remote-control` daemon; no loop/cron/schedule surface → §5.3 agy row |
| `muse --version` / `muse --help` / `muse sessions --help` / `muse trace --help` | 1.4.23; `resume`, `exec`, `sessions --json [--watch]` (sessionId/name/workspaceLabel/attachable — liveness only), `trace inspect`; no loop/goal/cron outer verb → goal/cron/monitor are [sess]-only in §5.3 |
| L0 lane worktree read (`feat/native-right-panel-l0`) | `right-panel.ts` (549 lines) + `right-panel.test.ts` (271 lines) uncommitted; no `op.ts` wiring yet → B1–B4, incl. whole-attach mouse gap and tab-cycle interim that §9.3/L1 close |
| `gh pr view 443 / 462 / 463` + `gh pr diff 462` | #443 merged (bottom bar); #462 open `feat/gw-model-rewrite` (global `modelRewrites`, startup-validated, restart-to-apply → F23); #463 open (this spec) |

Probe discipline for build lots: help-text absence proves “no outer verb” only; in-session surfaces ([sess]) are re-verified in a throwaway fixture session per CLI version at lot gates, and any newly found native mechanism enters §5.3 by spec amendment **before** code labels it `↻ native`.

</details>

## Non-goals restated

No product code in this PR. No new provider keys, no direct provider calls (local gateway route only, §6). No silent loop enrolment and no hidden parallel loop mechanism (R21/§5.4). No per-session gateway-rewrite editing until a gateway-host design says otherwise (F23/OQ-11). No change to Track's writer rules or journal ownership (panel writes only via existing Track CLI surfaces in the decision's own workspace, §7; reads never copy between journals, §5.5). No new kill path (F25). No Python in any lot. Tests in lane temporary directories only, never the real `/tmp`, never real h2a/Track state.










