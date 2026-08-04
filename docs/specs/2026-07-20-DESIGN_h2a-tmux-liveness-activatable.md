# DESIGN — tmux-aware `activatable` liveness for h2a presence

Root-cause + phased design answering `2026-07-20-CR_h2a-tmux-liveness-activatable.md`.
Produced by an independent Opus 4.8 xhigh pass. All paths under `packages/h2a/`.

## 1. Root cause

**Liveness at query time is computed *only* from presence-heartbeat freshness; the
tmux pane is never probed on the query path.**

The inbox-put "is the recipient live?" answer is membership in `listPresence()`
matched by canonical instance:
- MCP: `src/runtime/mcp/handlers.ts:228-248` — `recipientLive = freshSessions > 0`.
- CLI: `src/cli.ts:782-786` — `recipientLive = listPresence(root).some(...)`.

`listPresence` (`presence.ts:119-161`) drops any session where `isSessionExpired`
(`session.ts:256-267`): closed/expired, or `now - heartbeatAt > 90_000ms`
(`session.ts:36`). Heartbeat is refreshed only by a connected `mcp-serve` or the
out-of-band keepalive prober *if running* (`cli.ts:5849-5872`).

**Observed llm-mesh case:** pane attached & alive, agent idle at prompt
(mcp-serve suspended → no heartbeat) and keepalive not covering that pane →
`heartbeatAt` ages past 90s → dropped → `freshSessions:0` → `recipientLive:false`
→ `resolveRecipient` returns `deliver-dormant` (`paths.ts:282-288`). The path never
consults `launchContext.tmux.pane`, though the pane is alive and pokeable.

Corrections to the CR framing: the signal-0 pid probe (`presence.ts:211`) is used
only in reap (delete-dead), not in the positive `recipientLive` decision;
`connectionConfidence`/`lastMcpActivityAt` is advisory and never gates routing.

## 2. Instance → tmux mapping (crux) — already exists

`H2ASession.launchContext.tmux = { session, window?, pane }` (`session.ts:75-83,106`):
- captured at launch/stop by the host stop-hook `src/hosts/plugin.ts:119-122`
  (`--tmux-session`, `--tmux-pane $TMUX_PANE` = stable `%N` id);
- written to presence at session-open `src/runtime/mcp/sessions.ts:132`;
- already the instance→pane resolver for wake: `latestLaunchContext(root, instance)`
  picks the freshest session's `launchContext` (`src/runtime/drive/index.ts:703-707`;
  dup at `cli.ts:3011`); `keepaliveOnce` reads it (`cli.ts:5860`).

⇒ **No new persisted field for the tmux case.** Mapping = `instance →
latestLaunchContext(root, instance).tmux.pane`.

**Probe (extend keepalive's format):**
`tmux list-panes -aF '#{pane_id} #{pane_dead} #{session_attached} #{pane_pid} #{pane_current_command}'`, keyed by `pane_id`:
- `tmuxAlive` = pane present AND `pane_dead==0`.
- **bg vs fg** (owner ask #1) = `session_attached` (≥1 fg/attached, 0 bg/detached);
  both activatable — the flag is reported, not gating.
- idle vs busy ≈ existing MCP-traffic axis (`connectionConfidence`).
- anti-reuse guard = cross-check `pane_pid`/`pane_current_command` vs `session.pid`.

## 3. Liveness model — `live | activatable | dormant | dead`

New **orthogonal** `reachability` axis, per instance (union across sessions),
leaving `recipientLive`/`connectionConfidence` untouched. tmux/pid are local-host
only (a `mirroredAt` cross-host session skips them).

Predicates (top-down):
- **`live`** ⇔ `heartbeatFresh && mcpActive` — the only state that promises an answer.
  Mirrored sessions can reach at most `live`, never `activatable`.
- **`activatable`** ⇔ `!live && (tmuxAlive || (pidAlive && sameHost))` — a concrete
  local wake-handle, target proven up but not heartbeating-with-traffic. Includes
  the exact llm-mesh case `!heartbeatFresh && tmuxAlive`. Reports `tmux:{alive,attached}`.
- **`dormant`** ⇔ `registered && !live && !activatable` — known id, no live local
  handle (today's `deliver-dormant`, now narrowed to the no-pane case).
- **`dead`** ⇔ `pidLocal && !pidAlive && !tmuxAlive` (reap target), or no
  registration+no presence (phantom → refuse).

**Anti-false-live discipline:** tmux-alive only ever yields `activatable`, NEVER
`live`, and NEVER flips `recipientLive`. A live pane proves the terminal/process is
up, not that the agent will process a message. `recipientLive` keeps its exact
current meaning (`= heartbeatFresh`) → honest-presence preserved, no new false-live.
`classifyReachability(inputs)` is a pure function (injected pane-probe), unit-testable
without real tmux.

## 4. Surfacing + wake

- **resolveRecipient** (`paths.ts:216`): new kind `deliver-activatable` (0 heartbeat-
  fresh but ≥1 tmux-alive), ranked between `deliver` and `deliver-dormant`. New
  OPTIONAL input `tmuxLiveInstances`; absent ⇒ behaves exactly as today. Destination
  never changes — `activatable` is a label, not a re-route.
- **inbox-put** (`handlers.ts:248`, `cli.ts:782`): additive `reachability` +
  `tmux:{alive,attached}`; `recipientLive`/`freshSessions` byte-identical; `dormant:true`
  only when truly dormant.
- **`h2a status`**: bare `{ok,root,counts,direct,indirect}` FROZEN — untouched.
  Enrichment behind opt-in `--reachability` (adds `counts.activatable` + per-instance
  annotation). Snapshot test proves default byte-unchanged.
- **discover `--live` / discover_sessions**: additive `reachability` + `tmux`, plus an
  `--activatable` filter ("who can I wake now?").
- **Wake-on-demand — reuse proven transport:** pane via `latestLaunchContext`; send via
  `localTmuxDriver` (`drive/index.ts:481-508`) / `localTmuxRelauncher` +
  `tmuxSendSubmit` (`relaunchers.ts:139-161`), guarded by `paneHasRecentHumanActivity`
  (never clobber a human mid-type); fallback `chainRelauncher` tmux→headless, cross-host
  → signed `wake-request` (`cli.ts:4398`). New verb **`h2a wake --to <instance>`**
  generalizing EVO-1 self-wake to on-demand peer wake.

## 5. Phased plan (each independently mergeable)

| Lot | Scope | Test |
|---|---|---|
| **0 data-model** | No migration (`launchContext.tmux` already persisted). Pure types `H2AReachability`, `H2ATmuxLiveness`. Verify llm-mesh presence carries `tmux.pane`; flag hosts that don't. | type-guard; presence-fixture |
| **1 detection** | Pure injectable `probeTmuxLiveness(runtime,panes)`. Fail-closed: no tmux ⇒ empty map. | parse fixture; empty-on-no-tmux |
| **2 classification** | Pure `classifyReachability → 4-state`. No I/O. | full truth table incl `!heartbeatFresh && tmuxAlive ⇒ activatable` |
| **3 surface (read)** | discover/discover_sessions + `status --reachability` opt-in + put `reachability` + `resolveRecipient deliver-activatable`. | golden bare-status unchanged; back-compat |
| **4 wake-on-demand** | `h2a wake --to <instance>` reusing localTmuxDriver + human-active defer; headless + wake-request fallback. | injected driver fires/defers/falls-back |

Lots 0-2 pure (no behavior change), 3 opt-in read, 4 new verb.

**The one irreversible/risky decision: auto-wake on send.** Typing into a live pane
is an irreversible side effect (interrupt human/busy agent — sibling of the PARKED
auto-route-to-live). **Recommendation: keep wake EXPLICIT** (`h2a wake` verb / `--wake`
opt-in), never implicit in put/resolve. Everything else is additive and reversible.

## 6. Failure modes (fail-closed)

1. **Stale/reused pane** — `pane_dead==1` filters exited; for reuse, cross-check
   `pane_pid`/`pane_current_command` vs `session.pid` ⇒ mismatch → not activatable →
   dormant. Under-claim, never over-claim.
2. **Pane alive but agent wedged** — `activatable` = *wakeable*, not *delivered*;
   `recipientLive` stays false; human-active defer applies.
3. **Cross-host** — mirrored session's pane invisible locally ⇒ never `activatable`;
   wake routes via `wake-request`.
4. **Multiple sessions/instance** — union: activatable if any pane alive; wake targets
   freshest tmux-alive pane.
5. **`launchContext.tmux` absent** — no pane ⇒ pidAlive same-host → activatable(headless)
   else dormant.
6. **Keepalive interaction** — keepalive-refreshed agents keep `recipientLive:true` as
   today; the nuance rides on `reachability` only (no contract shift).

## Owner decision needed before implementation
- GO/NO-GO on the phased plan (Lots 0-4).
- Confirm the explicit-wake recommendation (no implicit auto-wake on put).
