# h2a wake (#3 idle-agent wake) — what works, proven live, + the launcher contract

Status: **transport proven live (0.44.0); auto-pane-capture shipped (0.45.0)**. This
documents what actually wakes an idle agent, with the demonstrated evidence, and the
contract a launcher (e.g. `remote`, becoming the official local launcher) must meet.

## Demonstrated facts (live E2E, 2026-06-05)

A real idle **codex** (npm `codex-cli` 0.137) and a real idle **claude** (Opus 4.8)
were each woken by injecting the signed drive line into their tmux pane:
- codex answered `WAKE-OK-CODEX`; claude answered `WAKEOK42` (= 6×7, only present in
  the reply, not the prompt → a genuine turn, not an echo).

Three fragilities were proven and addressed:
1. **Native push is unavailable here.** `codex app-server proxy` needs a remote-control
   daemon, which requires the **standalone** codex install (`curl … install.sh`); the
   npm `codex-cli` cannot start it. So the only working transport on this setup is
   **local-tmux** (keystroke injection into the agent's pane).
2. **`--wake` ignored the auto chain** → fixed: `--wake` now takes
   `logging|native|local-tmux|headless|auto`; `auto` falls back native→local-tmux→headless.
3. **Submit needed two Enters** on modern codex/claude TUIs (one left the input
   buffered) → the local-tmux driver now sends literal + **two** Enters.

## The wake modes (by what actually reaches the agent)

| Mode | Works when | On this setup |
|---|---|---|
| **native** (app-server/remote-control inject) | codex *standalone* install in remote-control mode; claude `--remote-control` | ✗ (npm codex, no daemon) |
| **local-tmux** (keystroke into the pane) | the agent runs in an **addressable tmux pane** | ✅ **proven** |
| **headless** (spawn a fresh agent) | always | spawns a NEW agent — does **not** wake the existing one |
| **logging** | always | proves the wake *decision* fires; injects nothing |

→ **`--wake auto` is the right default**: it uses native where available and falls back
to local-tmux (the proven path) otherwise.

## Why it now needs **zero launcher config** (0.45.0)

`mcp-serve` is spawned as the agent's MCP server, so it **inherits the agent's
`$TMUX_PANE`**. At `--auto-open` it auto-detects that pane (`detectTmuxLaunchContext`)
and records it as the session's `launchContext`. `latestLaunchContext` then feeds it to
the local-tmux driver, which targets the pane (`tmux send-keys -t %id`). So an agent
launched **inside a tmux pane** becomes wakeable automatically — the launcher does not
have to pass anything. Outside tmux, `launchContext` is absent and wake gracefully
no-ops (native fails, local-tmux has no pane).

## The launcher contract (for `remote`, the official local launcher)

To make agents wakeable, the launcher only has to:
1. **Launch each agent inside a named tmux pane** (so `$TMUX_PANE` is set and the pane
   is addressable). This is the single hard requirement — there is no external-inject
   path for a plain-terminal interactive agent on npm codex.
2. Run the agent's `h2a mcp-serve` with **`--auto-open --wake auto`** (it inherits
   `$TMUX_PANE` → records the pane → wake works). The Stop-hook/host-plugin remain
   useful for relance but are **not** required for wake anymore (auto-capture covers it).
3. Nothing else — no pane id needs to be threaded; h2a self-detects.

Limitation to keep honest: an agent **not** in a tmux pane cannot be woken by injection
(only `headless` could spawn a *new* one). If `remote` ever runs agents outside tmux
(e.g. a bare sidecar), wake there needs the native/remote-control path or a poll-based
Stop-hook, not local-tmux.

## Install default (planned)

`h2a host setup` should render `--wake auto` in the mcp-serve args by default, with a
`--no-wake` opt-out + a warning (wake is essential to coordination). Documented here so
opting out is a conscious choice.
