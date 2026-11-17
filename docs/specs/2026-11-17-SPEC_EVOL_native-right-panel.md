# SPEC EVOL — Retractable right panel for the native terminal (sessions, decisions, Track)

Date: 2026-11-17
Status: specification only. This document adds no product code, no test code and no configuration.
Owner source: verbatim of 2026-11-17 (evening), mockup **A · Tree + tabs** selected by the owner.
Owner notes override the mockup wherever they differ (see §2). Schemas come first, per owner layout rule of 2026-11-16; long technical tables are folded in the annexes.

## Layout schema (mockup A, as amended by the owner notes)

```text
┌──────────────────────────────────────────────────────────┬─────────────────────────────┐
│ CLI (child PTY, reduced width)                           │ [ws-1] [ws-2] [shared]  ⇄   │  meta-workspace tabs
│                                                          │ ─────────────────────────── │
│                                                          │ SESSIONS                    │
│                                                          │ ● h2a · conductor     gw→f5 │
│                                                          │ ◆* sentropic · api    direct│  * = decision/question
│                                                          │ ✖  h2a · lane-3       gw    │
│                                                          │   ▸ 2 delegated (hidden)    │
│                                                          │   ↻ loop build-0989  ◐      │
│                                                          │ DECISIONS / QUESTIONS       │
│                                                          │ ◆* D12 gateway posture  →   │
│                                                          │ ?  Q3  which base image  →  │
│                                                          │ TRACK · week                │
│                                                          │ 14 done · 3 blocked · …     │
│                                                          │ ┌─ selected session ──────┐ │
│                                                          │ │ (bottom sub-pane)       │ │
│                                                          │ └─────────────────────────┘ │
├──────────────────────────────────────────────────────────┴─────────────────────────────┤
│ claude · h2a-conductor · attached   J 4·1* I 1 L 2   gw active fable→… · deleg lane-3,lane-7 │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Collapsed mode (panel closed): the CLI keeps its full width and a 2-column strip stays reserved on the right edge:

```text
┌────────────────────────────────────────────────────────────────────────────┬──┐
│ CLI (full width minus strip)                                               │*3│  lit strip: count + *
└────────────────────────────────────────────────────────────────────────────┴──┘
```

## 1. Purpose and scope

The bottom status bar shipped in PR #443 (`feat/native-statusbar`, merged) proved the pattern: the native terminal host reserves screen space the child CLI never sees, and renders h2a state there. The owner now asks for the same pattern on the right: a retractable panel that makes the fleet of sessions, the pending decisions/questions and the Track state visible and actionable without leaving the current CLI.

In scope: one reserved right column area in the native attach view; read models reused from `h2a restore`, the status projection, Track and the loop inventory; a Track pane summarised through the existing gateway; asynchronous decision answers over h2a messaging; a keyboard scheme that survives the owner's real terminal (VTE 0.84).

Out of scope for this spec: any implementation (lots in §9 are the implementation contract, not code); a new provider, a new credential or a new network route; changes to the bottom bar other than the delegated-session list of §4.4; tmux-hosted sessions beyond what the existing projections already report; mobile or web rendering.

## 2. Owner decisions already taken (not open questions)

Source: the 2026-11-17 verbatim and the owner's annotations on mockup A.

| # | Decision | Consequence for this spec |
|---|---|---|
| O1 | Mockup A: tree + tabs, meta-workspace tabs on top, sessions with badges, decisions, Track summary | Layout of §4 follows A |
| O2 | Colour **plus** `*` marks attention on a session's decision/question stakes | §4.2 and §8: symbol + colour + `*`, never colour alone |
| O3 | Track keeps the "active" objectives | §5: terminal roots excluded, open work never dropped by the period filter |
| O4 | Gateway handling "as in the bottom bar" | §4.4: the gw/model switch stays in the bottom bar; the panel only drives the same control |
| O5 | The bottom bar lists the **delegated sessions of the selected session** | §4.4 replaces the bare `deleg <n>` count for the selected session |
| O6 | On a decision: go to the dossier **or** open the session in a bottom sub-pane of the right panel | §4.3 and §6.3 |
| O7 | Collapsed mode: the right bar lights up as soon as **another** session is blocked or has a question | §4.5 (the selected/current session does not light its own strip) |
| O8 | "In progress" sessions = the active sessions, as `h2a restore` sees them | §4.2: same discovery, same grouping, no second inventory |
| O9 | Sub-sessions are not shown by default in the human main sessions; objective loops and sub-sessions remain browsable | §4.2 |
| O10 | Each session can be switched (gw) with a model-mapping switch; `/gw` restarts the same session | §6.4 and §7.4 |
| O11 | Proposed in-panel grammar: `/s` (sessions, default), `/d`, `/t`, `/a` (answer), `Tab` next tab, `Esc` back to the CLI, `/gw`, `/c` (configuration) — to be checked against reality | §7 assesses it and keeps it, with one opener change |

## 3. Grounded facts (code as of origin/main, 2026-11-17)

These are facts read in the repository, with their source. Design choices below cite them as F-numbers.

| # | Fact | Source |
|---|---|---|
| F1 | The bottom bar is rendered by `NativeStatusBarController` in the attach path: it reserves exactly one row (`childRows()` returns `rows - 1`), clamps the child scroll region with DECSTBM, repaints at most every 1 s, and requires ≥ 10 rows (`STATUS_BAR_MIN_ROWS`) | [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:466) |
| F2 | The bar's data is `NativeStatusBarSnapshot`: cli, session name, link state, role, workload counters `j/i/l` each with a `degraded` flag, `delegatedSessions`, and `gateway` (`H2AGatewayStatusV1` with `requestedModel → upstreamModel`, provider, account label) | [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:690) |
| F3 | `renderNativeStatusBarLine` already renders `gw <state>` plus the route token `requested→upstream`, and `deleg <n>` as a bare count | [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:1497) |
| F4 | `h2a restore` discovery returns `DiscoveredSession[]` (project, tool claude/codex/agy/muse/vibe, sid, cwd, origin registry/scan, `gatewayMode` pin, `restoreClass: human \| unclassified`); `groupSessions` groups them into `LayoutWindow[]` (title + `LayoutTab[]`) from `LayoutConfig.groups` | [restore.ts](../../packages/h2a-runtime/src/restore.ts:64), [config.ts](../../packages/h2a-runtime/src/config.ts:49) |
| F5 | Human-facing gating exists: registry rows are `human` only when `isHumanFacingSession` passes; scan rows are always `unclassified`; delegated/background work is a separate projection (`H2ADelegatedExecutionV1` with `delegatorTmuxSession`, state pending/running/throttled/failed) | [restore.ts](../../packages/h2a-runtime/src/restore.ts:273), [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:60) |
| F6 | Loop statuses are a closed set (`running`, `waiting-ci`, `waiting-review`, `waiting-human`, `paused`, `blocked`, `done`, `failed`, …); attention = `waiting-human`, `blocked`, `failed`, `paused`, `stalled`, `degraded`; `h2a loop list` is the inventory verb | [status-projection.ts](../../packages/h2a-runtime/src/status-projection.ts:732), [cli-contract.ts](../../packages/h2a/src/cli-contract.ts:196) |
| F7 | Track decisions are `DecisionState` items: `outcome: pending \| go \| no-go \| deferred`, a `Dossier` (context, options, qa, recommendation) and `artifacts[]` discriminated as `h2a-decision-dossier` (negotiationRef + hash), `rendered-view` or `mockup` (viewRef); `track focus <id>` renders one dossier; answers are recorded by `track decision select <decisionId> <optionId>` | [decision.ts](../../packages/track/src/model/decision.ts:12), [index.ts](../../packages/track/src/cli/index.ts:93) |
| F8 | `track report --status-table` is the validated report over `--period today\|week\|month\|all\|last-week\|last-day` (or `--since/--until`); `--status-table` defaults to a rolling last-week window; the period filter bounds events/deliveries and never makes open work disappear; `--active-roster` omits terminal roots only | [commands.ts](../../packages/track/src/read/commands.ts:281), [index.ts](../../packages/track/src/cli/index.ts:489) |
| F9 | `h2a send <target> <message>` sends one signed message through the local peer inbox (or `--backend cluster-mesh`); target may be an exact instance or a unique registered/live display name; exit codes 0/1/2/3 distinguish delivery outcomes | [cli-contract.ts](../../packages/h2a/src/cli-contract.ts:168) |
| F10 | The gateway posture is a per-session launch pin (`gatewayMode: gateway \| direct`, re-emitted as `--gw/--no-gw` on restore); the model mapping lives in the gateway host: PR #462 (open, `feat/gw-model-rewrite`) adds configurable model rewrites on top of `LlmMeshRoutingConfig` (policy/profiles/activeProfile) in the gateway-host config file; gateway model ids and aliases are a closed catalog (`gemini-3.8-flash` alias `flash`, `gemini-4-argon`, `claude-fable-5-*`, `muse-*`) | [restore.ts](../../packages/h2a-runtime/src/restore.ts:74), [config-file.ts](../../packages/h2a-runtime/src/gateway-host/config-file.ts:7), [model-catalog.ts](../../packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts:12) |
| F11 | Restarting a session in place is an existing guarded operation: relaunch safety checks identity before any kill, and a forced restart kill/recreates an eligible session resuming the same conversation | [relaunch.ts](../../packages/h2a-runtime/src/relaunch.ts:556) |
| F12 | The attach path already intercepts exactly one byte for itself: `DETACH_BYTE` 0x1c (`Ctrl-\`) is consumed by `runAttach` and never reaches the child; all other input is parsed and forwarded byte-identical | [op.ts](../../packages/h2a-runtime/src/native-terminal/op.ts:64) |
| F13 | The native host already tracks kitty keyboard-protocol and `modifyOtherKeys` state pushed **by the child CLI** (`TerminalModeTracker`), per screen (main/alternate) — but that negotiation is between the CLI and h2a's headless model, not between h2a and the outer terminal | [terminal-modes.ts](../../packages/h2a-runtime/src/native-terminal/terminal-modes.ts:62) |
| F14 | The owner's terminal is VTE 0.84.0 (GNOME Terminal 3.58.0, verified on this machine: `gnome-terminal --version` → "using VTE 0.84.0"), `TERM=xterm-256color`; ptyxis is the other VTE frontend in scope | local probe, 2026-11-17 |

## 4. Layout contract

### 4.1 Reserved geometry, mirroring the bottom bar

The right panel is a second reserved area owned by the attach layer, exactly as the bottom bar is (F1). The child PTY never learns the full terminal size:

- Panel open: the child receives `cols - panelWidth` columns and `rows - 1` rows (the bottom bar keeps its row). Panel width is fixed per open (default in OQ-1), not draggable in v1.
- Collapsed: the child receives `cols - 2` columns and `rows - 1` rows; the 2-column strip is always reserved while the native attach is live, so toggling the panel never triggers a child resize storm beyond the two states.
- Minimums follow the F1 pattern: the panel requires a minimum total width (proposal: 100 columns; below it the panel cannot open and the strip shows the attention state only), and the existing ≥ 10 rows rule for the bottom bar is unchanged.
- Rendering reuses the bottom-bar machinery: a headless model sized to the child area, scroll-region clamping on the row axis and column clipping on the column axis, absolute cursor addressing for the panel area, repaint on snapshot change and at most one repaint per second for time-driven changes (F1 rates).
- Resize, detach, exit and reconnect restore the full geometry and the child terminal modes exactly as the status bar does today (`resetSequence`/`restoreSequence` symmetry, F13); a panel crash must degrade to "panel unavailable" text in the strip, never corrupt the child screen. This is the same failure posture as the bar: degraded data shows `?`, never a fabricated zero (F2).

The one new engineering risk is the column axis: the current controller only shrinks rows. §9 L0 exists to prove the column reservation (child `SIGWINCH`, wrap, alternate-screen CLIs, mouse modes 1000/1002/1003/1006 tracked in F13) before any content lot builds on it.

### 4.2 Meta-workspace tabs and the session tree

- One tab per `LayoutWindow` produced by the same grouping `h2a restore` uses (F4): explicit `LayoutConfig.groups` first, then the shared windows. Tab label = window title. There is no second, panel-specific grouping configuration in v1 (OQ-8 if the owner wants one).
- Sessions listed are the active sessions restore sees (O8): `discoverSessions` + registry sessions merged, restricted to the tab's projects. A session appears in exactly one tab.
- Each row shows: status symbol + colour (§8 table), session label, tool, and its gateway posture short form (`gw` + route arrow when the gateway snapshot carries one, `direct` otherwise, `gw ?` when unknown — the F3 vocabulary).
- Sub-sessions (delegated executions, F5) are **hidden by default** under their delegating human session (O9): a `▸ n delegated` line expands in place. They never appear as top-level rows in the human list.
- Objective loops (F6) are browsable the same way: a `▸ loops` expander per session or workspace listing loop name + status symbol; `waiting-human`/`blocked` loops carry `*`.
- Selection: the panel has one selected session (highlight row). Selecting a session drives §4.4 and §4.3's sub-pane; it never steals the CLI's input focus (§7).

### 4.3 Decisions / questions list

- Source: Track decisions with `outcome` `pending` or `deferred` (F7), plus questions: decision `qa[]` entries without an answer and loops in `waiting-human` (F6). One list, decisions first, then questions, oldest first within each class.
- Each row: `◆` (decision) or `?` (question) symbol, `*` while unanswered, short title, age, and the concerned session/workspace when known (F7 `workspace`, `targets`, `accountable`).
- Activating a row (O6) offers exactly two targets: (a) the dossier — a local md file opens in the bottom sub-pane as read-only text; a Focus artifact opens via `track focus <id>` rendering; a `rendered-view`/`mockup` artifact or an external (claude.ai) link opens through the system browser opener; (b) the concerned session, opened in the bottom sub-pane of the right panel.
- The sub-pane is a read-only observer view of that session's screen in v1 (the native host already distinguishes controller and observer attachments); taking control is out of v1 scope (OQ-5). A session that is not live shows its last known state plus "not live — no sub-pane" instead of a blank pane.

### 4.4 Bottom bar (unchanged home of gw/model, plus O5)

- The gw/model-mapping switch stays in the bottom bar (O4): the bar keeps showing `gw <state>` and `requested→upstream` (F3). Nothing about gateway state moves into the panel.
- For the **selected** session, the bar's `deleg <n>` count expands to the delegated session names (comma-separated, truncated with `…` past the available width, in the F3 degradation order: route drops before deleg names). For the attached session with no panel selection, today's count rendering is unchanged.
- The panel's `/gw` (§7) acts on the selected session by driving the same posture + mapping controls the bar displays; it does not introduce a panel-local gateway state.

### 4.5 Collapsed strip

- The strip is lit when **another** session (not the attached one, not the selected one) is blocked (`blocked`/`failed`), has a pending decision, or an unanswered question (O7). Lit = filled background colour + `*` + count of concerned sessions, per §8.
- Unlit strip: 2 blank columns with the panel opener hint shown only in the `/c` configuration view, keeping the collapsed state visually silent.
- The strip state derives from the same snapshot as the panel; a degraded (unknown) fleet state shows `?` in the strip instead of pretending all-clear.

## 5. Track pane

- Content: `track report --status-table` (F8) rendered for a chosen period. Period choices in the pane: `today`, `week` (rolling last-week, the `--status-table` default), `month`, `all`, plus explicit since/until dates — the exact F8 selector set, no panel-invented periods.
- The pane shows the four-section report (fait / à-faire / blocked / decisions) in the panel width, then a summary block.
- **Summary route (named, no new keys):** the report JSON for the chosen period is summarised by a low-cost third-party model **through the existing gateway**: model id `gemini-3.8-flash` (alias `flash`) from the F10 catalog, called on the local gateway base URL (the same route resolution the status snapshot already uses for the gateway probe). Credentials stay upstream in the gateway host; the panel adds no provider key, no direct provider call, no new config file.
- The summariser input is bounded: the status-table JSON payload (report + period payload: `eventsInWindow`, `from`, `to`), capped at a fixed scalar budget with truncation marked in the prompt; it is instructed to summarise "from the recent status" (open/blocked/delivered movement in the window) and to **keep the active objectives**: terminal roots are already excluded by `--active-roster` semantics and the period projection never drops open work (F8), so the prompt lists active objectives verbatim and the summary must carry them through unchanged.
- Caching: one summary per (period, journal revision) — the revision pair (event count, head) that Track already exposes for resolve-context pinning. A moved journal invalidates; re-render without a new LLM call shows the raw report.
- Degraded states, in order: gateway off/direct posture → summary line reads `summary unavailable (gateway off)` and the raw report still renders; gateway unreachable or model error → `summary unavailable` + the raw report; summary never blocks, overwrites or delays the raw report. The pane labels the summary as machine-generated, with model id and generation time.

## 6. Asynchronous decisions

### 6.1 Principle

A decision answered in the panel is answered **asynchronously** with respect to the concerned session (owner verbatim): the session is informed, it is not interrupted, and it is never presented with a blocking question by the panel. This complements, and does not replace, the native-question gate contract of the 2026-11-07 owner-gate spec (a decision that blocks a session *now* still goes through that session's native question surface; the panel is the async path).

### 6.2 Answer flow (`/a`)

1. The owner picks a decision/question row, then an option (structured dossier) or confirms the recorded outcome (unstructured dossier) — the same two affordances the Track canevas advertises (F7).
2. **Track records first:** `track decision select <decisionId> <optionId>` (or `decision outcome`) writes the `decision.option-selected`/`decision.outcome` event. If the Track write fails, nothing is sent and the panel shows the failure; the answer is not recorded anywhere else.
3. **Then h2a informs the session:** `h2a send <target> <message>` (F9) to the concerned session's instance. The message is marked for-info and carries: decision id and title, the chosen option id + title, the answer time, and a dossier locator (`track focus <id>` / artifact ref). It is an ordinary signed message body — no new envelope type, no consent semantics (per the owner-gate spec's boundary, a message never proves consent or a question).
4. Delivery evidence is the `h2a send` exit code (F9). Failure (target unknown, ambiguous name, inbox error) is shown on the row as `not sent — <reason>` with a retry action; the Track record stands and is never rolled back. Success shows `sent · <time>` on the row until the decision leaves the pending list.

### 6.3 Concerned-session resolution

The target is resolved deterministically: decision `workspace` + linked session instance whose workspace matches and which is live in the restore inventory; ties or no match → the panel records the Track answer and marks the row `no live session — not sent`, letting the owner pick the target from the session list before retry. The panel never guesses a target from a title substring.

### 6.4 Gateway switch and same-session restart (`/gw`)

`/gw` on a selected session toggles its posture (`gateway` ↔ `direct`) and optionally selects a model mapping (a gateway routing profile / model rewrite entry per F10, PR #462). Applying either change **restarts the same session** (O10): the existing relaunch guard (F11) verifies process identity, terminates, and relaunches with the new pin re-emitted (`--gw`/`--no-gw`, plus `--model` when a mapping was chosen), resuming the same conversation id. The panel shows `restarting…` then the new `gw`/route state as the bottom bar reports it; a relaunch refusal leaves the session untouched and shows the refusal reason. Sessions the attach client does not control (remote/SCW, attach-live without resume id per F4) show `/gw` as unavailable with the reason, never a forced kill.

## 7. Keyboard

### 7.1 Verified facts about the owner's terminal (F14)

| # | Fact | Consequence |
|---|---|---|
| K1 | VTE 0.84 transmits **no bytes for a bare Ctrl+Shift press**: a terminal reports key events, and a modifier-only press has no keysym to encode. (Any keyboard-driven terminal behaves this way; there is no "Ctrl+Shift" event on a pty.) | The owner's "Ctrl+Shift opens the panel" cannot exist as stated. An opener must be a real key or chord that produces bytes. |
| K2 | Without the kitty keyboard protocol, VTE sends `Ctrl+Shift+<letter>` exactly like `Ctrl+<letter>` (legacy encoding: both are the single control byte, e.g. `Ctrl+Shift+A` = `0x01`). VTE 0.84 does not negotiate the kitty progressive-enhancement flags on the outer terminal, so the attach process cannot distinguish the two. | Any `Ctrl+Shift+<letter>` opener would fire on plain `Ctrl+<letter>` too — colliding with the CLI's own `Ctrl+<letter>` bindings and interrupting the CLI. Rejected. |
| K3 | gnome-terminal/ptyxis already consume `Ctrl+Shift+C/V` (copy/paste), `Ctrl+Shift+T/N` (new tab/window), `Ctrl+Shift+W/Q` (close), `Ctrl+Shift+F` (find) at the emulator level; those chords never reach the pty. | They are unavailable even where K2 did not already rule them out. |
| K4 | The kitty state h2a tracks in F13 is between the CLI and h2a's headless model. It does not upgrade what VTE sends to the attach process. | No opener may rely on kitty flags arriving from the outer terminal. |
| K5 | The attach path already reserves one byte for itself, `Ctrl-\` (detach, fact F12), consuming it before the child sees it. | A host-captured opener has an existing, tested seam; the panel reuses that seam. |

### 7.2 Keys the CLIs already use (collision inventory)

Inventory as shipped in the current CLI generations; exact bindings drift between versions, so L0 re-verifies each row against the installed binaries before the opener is frozen (the spec's constraint is the collision classes, not any single row).

| Key | Claude Code | Codex | agy | Muse |
|---|---|---|---|---|
| `Esc` | interrupt / dismiss | interrupt | interrupt | interrupt / dismiss |
| `Esc Esc` | rewind / clear input | (used) | (used) | clear / rewind class |
| `Tab` | completion / toggle | completion | completion | completion |
| `Shift+Tab` (`CSI Z`) | permission-mode cycle | mode cycle | mode cycle | mode cycle |
| `Ctrl+C/D/L/R/O/B/T/G` class | interrupt, exit, clear, history, transcript, background, … | same classes | same classes | same classes |
| `Alt+<letter>` (Meta prefix) | word/edit actions | edit actions | edit actions | edit actions |
| `/…` at prompt | slash commands | slash commands | slash commands | slash commands |
| `F1`–`F12` | not bound by default | not bound by default | not bound by default | not bound by default |

Two structural conclusions: (1) any printable/`Ctrl`/`Alt` opener chord collides with a CLI class above; (2) `/x` sequences are safe **only** while the panel itself has input focus — typed at a CLI prompt they are slash commands. The owner's grammar is therefore kept verbatim, but as an in-panel grammar (§7.4), not as global chords.

### 7.3 Opener candidates

| Candidate | VTE 0.84 bytes | CLI collision | Emulator collision | Verdict |
|---|---|---|---|---|
| `F12` | `ESC [ 24 ~` — distinct, unambiguous | none by default (§7.2) | none in gnome-terminal/ptyxis defaults | **Selected** |
| `F9` | `ESC [ 20 ~` | none by default | none by default; more often bound by window managers/desktop apps | Fallback |
| `Ctrl+\` | `0x1c` | none in CLIs | — | Rejected: already the detach byte (F12) |
| `Alt+Space`, `Alt+/` | Meta sequences | CLI Meta/edit class | window menu (`Alt+Space` on many desktops) | Rejected |
| `Ctrl+Shift+<letter>` | = `Ctrl+<letter>` (K2) | yes (K2) | partly (K3) | Rejected |
| Bare `Ctrl+Shift` | no bytes (K1) | — | — | Impossible |

### 7.4 Proposed scheme (closest realistic to the owner's)

- **Opener: `F12`** toggles the panel. The attach layer captures `ESC [ 24 ~` exactly like it captures the detach byte today (K5) — in both directions (open and close), whether the CLI or the panel has focus. No CLI loses a key it uses: F12 is unbound in all four CLIs (§7.2), and if a future CLI binds it, `/c` lets the owner move the opener to F9 without a code change.
- **Focus model:** opening the panel moves input focus to the panel; `Esc` (or F12 again) returns focus to the CLI. While the CLI has focus, every byte except `F12` and `Ctrl-\` is forwarded untouched — the panel captures nothing. While the panel has focus, the attach layer captures all input for the panel and forwards nothing to the child; the CLI's screen stays live behind it.
- **In-panel grammar = the owner's, unchanged:** `/s` sessions (default view), `/d` decisions/questions, `/t` Track, `/a` answer the selected decision/question, `/gw` gateway + model-mapping switch with same-session restart (§6.4), `/c` configuration (panel width, opener key F12/F9, strip behaviour). `Tab` = next meta-workspace tab, `Shift+Tab` = previous tab (added for symmetry; `CSI Z` is distinguishable inside panel focus). `Esc` = back to the CLI. Free text after `/a` is the answer input; `Enter` confirms any destructive step (restart, send) — no action fires on a bare keystroke.
- Mouse: rows and tabs are clickable (the owner's "clicable") when the terminal reports mouse events; clicking selects, double-click activates (dossier/sub-pane). Mouse capture follows the same focus rule and is released on `Esc`/detach so CLI mouse modes (F13) are restored byte-identical.

## 8. Accessibility

The owner is colour-blind; colour is therefore never the only channel (O2). Every state is a triple **symbol + colour + text/`*`**:

| State | Symbol | Colour (name) | `*` | Text |
|---|---|---|---|---|
| running / active | `●` | green | — | state word on selection |
| idle / waiting input | `○` | neutral | — | |
| waiting (CI/review/loop tick) | `◐` | blue | — | |
| paused | `⏸` | amber | — | |
| blocked / failed | `✖` | red | `*` if actionable | |
| decision pending | `◆` | violet | `*` always | |
| question unanswered | `?` | amber | `*` always | |
| unknown / degraded | `?` in muted style + `unknown` | none | — | literal `unknown` |

Rules: `*` is present exactly when owner attention is required (decision, question, actionable block) — it is the primary scan signal and does not depend on hue; the selected row additionally uses reverse video, not a colour change; the lit collapsed strip pairs its background with `*` + a count digit; every colour in the panel also appears as its state symbol in the bottom-bar vocabulary where one exists, so the two reserved areas never disagree. A monochrome terminal (or `NO_COLOR`) must lose nothing: symbols, `*` and text carry the full state.

## 9. Lots (smallest first; each lot is independently shippable)

Global rules for every lot: targeted tests only (new files named below, plus the existing adjacent suites), temporary directories only for fixtures, red-before/green-after on regressions, no full-suite run inside a lot. Existing suites touched by every lot: `native-terminal/op.test.ts`, `native-terminal/terminal-modes.test.ts`, `status-projection` tests, `restore*.test.ts`.

### L0 — Read-only panel: geometry proof + active sessions + pending decisions

Scope: column reservation in the attach layer (§4.1) behind a config flag, default off; panel renders §4.2 session rows and §4.3 decision/question rows read-only; F12 opens/closes (capture seam only), `Esc` returns focus; no actions, no sending, no Track pane, no sub-pane; strip reserved but unlit logic limited to §4.5 state display.

Acceptance criteria:
1. With the flag on, the child PTY reports `cols - panelWidth` while open and `cols - 2` while collapsed, verified through the headless model; alternate-screen, mouse-reporting and kitty-flag children (F13) render and restore byte-identical on open/close/resize/detach.
2. Rows match a fixture restore inventory exactly (same sessions, same tab grouping as `groupSessions` output) and a fixture Track decision set (pending/deferred only).
3. F12/`Esc` never reach the child while captured; every other byte reaches the child unmodified (byte-diff harness on recorded input).
4. Below minimum width, open is refused and the strip shows `?`/attention state instead of corrupting layout.
5. Flag off = byte-identical behaviour to today (existing op/status-bar suites green, unchanged).

Tests: `native-terminal/right-panel.test.ts` (geometry, capture, rendering), `native-terminal/right-panel.functional.test.ts` (real PTY child: vim-class alternate screen + mouse), fixture-driven projection tests reusing restore/status test fixtures.

### L1 — Navigation: tabs, expanders, collapsed attention

Scope: Tab/Shift+Tab across meta-workspace tabs, sub-session and loop expanders (§4.2), selected session, §4.5 lit strip, §4.4 bottom-bar delegated names for the selected session, mouse selection.

Acceptance criteria:
1. Tab cycles exactly the `groupSessions` windows; expanders reveal delegated executions and loops with F5/F6 states and never promote a sub-session to a top-level human row.
2. Selecting a session re-renders the bottom bar with its delegated names (truncation per §4.4); deselecting restores the count form.
3. Collapsed: another session blocked/question/decision lights the strip (`*` + count); the attached/selected session alone never lights it; degraded fleet shows `?`.
4. Keyboard-only operation of everything in L0+L1 (no mouse required).

Tests: `right-panel.test.ts` additions (tab/expander state machine), status-bar rendering tests for the delegated-names form, strip-state table tests over F2 snapshot fixtures.

### L2 — Decisions browsing: dossier and sub-pane (read-only)

Scope: §4.3 activation: md dossier in the sub-pane, Focus-artifact rendering via `track focus`, external artifact links via the system opener, concerned session in the sub-pane as a read-only observer.

Acceptance criteria:
1. Each F7 artifact kind opens through its §4.3 route; a missing/unreadable artifact shows its ref + reason, never a blank pane.
2. Sub-pane shows the concerned session's live screen read-only: panel input cannot reach that session while it is observed; a non-live session shows the §4.3 not-live state.
3. Dossier content is rendered without executing embedded content (plain-text/md rendering only).

Tests: sub-pane observer tests (input-isolation proof), artifact-route table tests over dossier fixtures, `track focus` invocation contract tests.

### L3 — Track pane with gateway summary

Scope: §5 complete: period chooser, raw status-table render, `gemini-3.8-flash` summary through the gateway, revision-keyed cache, degraded lines.

Acceptance criteria:
1. Every F8 period renders the same bytes as `track report --status-table --format json` for the same journal fixture; active objectives are present in every period.
2. Summary is requested exactly once per (period, journal revision); a moved journal re-summarises; gateway off/unreachable/error each produce their §5 degraded line with the raw report intact.
3. No network call leaves the local gateway route; a test double at the gateway base URL records the model id `gemini-3.8-flash` and the bounded prompt (truncation marker present past the cap).
4. The summary block carries model id + generation time + machine-generated label.

Tests: `right-panel-track.test.ts` (period parity vs Track CLI fixtures, cache, degraded matrix), gateway test-double contract test.

### L4 — Asynchronous answers (`/a`)

Scope: §6.2/§6.3 complete: Track-first recording, `h2a send` for-info message, delivery evidence on the row, retry.

Acceptance criteria:
1. A successful answer produces exactly one `decision.option-selected` (or outcome) event and exactly one signed `h2a send` to the resolved instance, in that order; the message body contains decision id, option id/title and the dossier locator.
2. Track failure → no message sent, failure shown. Send failure → Track record stands, row shows `not sent — <reason>` and retry re-sends without duplicating the Track event.
3. Ambiguous or absent target → §6.3 no-guess behaviour; manual target choice is required before any send.
4. Answering never raises a native question and never writes into the concerned session's PTY (inbox delivery only, proven by PTY byte-diff).

Tests: `right-panel-answer.test.ts` (ordering, failure matrix, target resolution table), `h2a send` contract reuse from the CLI contract tests.

### L5 — Gateway switch (`/gw`), model mapping, configuration (`/c`)

Scope: §6.4 restart flow, PR #462 mapping selection, `/c` (width, opener F12/F9, strip), persistence of panel preferences.

Acceptance criteria:
1. `/gw` on a controlled session restarts the same conversation with the new posture pin (and `--model` when a mapping is chosen); the bar then shows the new state/route. Relaunch refusal = no kill, reason shown.
2. `/gw` is shown unavailable, with reason, for remote/attach-live sessions (§6.4); no code path force-kills them.
3. Depends on PR #462 being merged: until then `/gw` offers posture toggle only and the mapping list reads `mapping unavailable (PR #462)`, never a guessed mapping.
4. `/c` changes persist across attach sessions and apply without restarting the CLI; moving the opener to F9 frees F12 to the child (byte-diff proof).

Tests: `right-panel-gateway.test.ts` (relaunch-identity fixtures, refusal matrix), config persistence tests, opener-remap byte-diff tests.

## 10. Open questions for the owner

Each question has options and a recommendation. Defaults are chosen so answering nothing still yields a coherent L0.

| # | Question | Options | Recommendation |
|---|---|---|---|
| OQ-1 | Default panel width? | (a) 32 cols fixed · (b) 25 % of terminal width, min 28 / max 44 · (c) owner-set in `/c`, default 32 | (c) with default (a): predictable layout for the tree, adjustable later |
| OQ-2 | Opener confirmation: F12 (§7.3)? | (a) F12 · (b) F9 · (c) both active | (a); `/c` can move it (L5). Note: desktop environments sometimes reserve F-keys — if your WM takes F12, pick (b) |
| OQ-3 | Track summary: is sending the status-table JSON to a third-party model via the gateway acceptable for all workspaces? | (a) yes, `gemini-3.8-flash` everywhere · (b) per-workspace opt-in, default off · (c) local-catalog models only | (b): the report can carry sensitive project text; the route stays §5's, the enablement is per workspace |
| OQ-4 | Default Track period in the pane? | (a) `week` (status-table default) · (b) `today` · (c) last chosen period, persisted | (c), initial (a) |
| OQ-5 | Bottom sub-pane: read-only observer (v1) or interactive take-over? | (a) read-only in v1, take-over as a later lot · (b) interactive from L2 | (a): single-controller semantics of native PTYs make take-over a separate design |
| OQ-6 | `/gw` restart: confirm every time? | (a) confirm each restart (`Enter`) · (b) confirm once per session per attach · (c) no confirmation | (a): a restart kills a running CLI process; the cost of one keystroke is the right price |
| OQ-7 | Decision→session mapping when `workspace` matches several live sessions? | (a) never auto-send, owner picks (§6.3) · (b) send to the session that raised the decision's linked item when recorded · (c) broadcast to all matches | (a) in v1; (b) becomes possible once decisions record their raising session — proposed as a Track follow-up, not assumed here |
| OQ-8 | Meta-workspace tabs: strictly the restore windows (F4), or panel-specific tabs? | (a) restore windows only · (b) restore windows + a panel-only "Attention" tab (blocked/questions across workspaces) | (b) with (a) as the base: the Attention tab is the collapsed strip's natural expanded form; it adds no new grouping config |

## Annex A — Code map (folded)

<details>
<summary>Implementation seams per lot</summary>

| Seam | File | Used by |
|---|---|---|
| Reserved geometry, input capture, repaint | `packages/h2a-runtime/src/native-terminal/op.ts` (`NativeStatusBarController`, `runAttach`) | L0–L5 |
| Child terminal modes (kitty/modifyOtherKeys/mouse) | `packages/h2a-runtime/src/native-terminal/terminal-modes.ts` | L0, L1 |
| Fleet + gateway snapshot | `packages/h2a-runtime/src/status-projection.ts` (`readNativeStatusBarSnapshot`, `projectStatusForH2a`) | L0–L5 |
| Session discovery + grouping | `packages/h2a-runtime/src/restore.ts` (`discoverSessions`, `groupSessions`, `isHumanFacingSession`) | L0, L1 |
| Delegated executions | `status-projection.ts` (`projectDelegatedExecutions`) | L1 |
| Loops inventory | `h2a loop list` (`packages/h2a/src/cli-contract.ts`) + loop statuses in `status-projection.ts` | L1 |
| Decisions, dossier, focus | `packages/track/src/model/decision.ts`, `packages/track/src/read/contract.ts` (canevas), `track focus` / `track decision select` CLI | L2, L4 |
| Track report | `packages/track/src/read/commands.ts` (`reportText`, `--status-table`) | L3 |
| Gateway model catalog + routing/rewrite config | `packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts`, `packages/h2a-runtime/src/gateway-host/config-file.ts` (PR #462) | L3, L5 |
| Messaging | `h2a send` (`packages/h2a/src/cli-contract.ts`, `packages/h2a/src/cli.ts` `cmdSend`) | L4 |
| Same-session restart | `packages/h2a-runtime/src/relaunch.ts` | L5 |

</details>

## Annex B — Keyboard byte reference (folded)

<details>
<summary>Sequences relied on by §7</summary>

| Input | Bytes on the pty (VTE, `TERM=xterm-256color`) | Note |
|---|---|---|
| `F12` | `ESC [ 24 ~` | opener candidate, §7.3 |
| `F9` | `ESC [ 20 ~` | fallback opener |
| `Shift+Tab` | `ESC [ Z` | panel-focus only (§7.4) |
| `Esc` alone | `ESC` (with the usual ambiguity window vs. sequences starting with `ESC`) | panel-focus return key; the attach parser already handles split sequences (F1 machinery) |
| `Ctrl+\` | `0x1c` | existing detach byte (F12), unchanged |
| `Ctrl+Shift+<letter>` | identical to `Ctrl+<letter>` (single control byte) without kitty negotiation | K2 — never used by the panel |
| Bare `Ctrl+Shift` | *(no bytes)* | K1 — cannot be bound |

</details>

## Non-goals restated

No product code in this PR. No new provider keys, no direct provider calls (gateway route only, §5). No change to Track's writer rules (the panel records answers through the existing Track CLI surface; the h-cond single-writer rule for the live `.track` store is untouched). No Python anywhere in any lot. Tests in temporary directories only, never the real `/tmp`.
