# h2a — Tutorial: Claude and Codex Cooperate in 5 Minutes

This walkthrough is the shortest path from "I just installed h2a" to "two CLI agents are actually exchanging messages and discovering each other live." It does not assume any h2a internals; it relies on the CLI verbs introduced by DEC-049 + DEC-054 and the MCP server shipped since 0.1.6.

## What you'll have at the end

```
┌─────────────────────────┐         ┌─────────────────────────┐
│ Claude Code             │         │  Codex CLI              │
│ session A                │         │  session B               │
│  - sees Codex via       │         │  - sees Claude via      │
│    /h2a-discover         │         │    /h2a-discover         │
│  - can /h2a-send         │  ←──→   │  - receives push        │
│    a message            │         │    notification          │
└────────┬────────────────┘         └────────┬─────────────────┘
         │                                    │
         └──────── ~/h2a-workspace/.h2a ──────┘
                 (the shared root)
```

Both CLIs run on the **same machine** in this V1 walkthrough. Cross-machine sync is V2 (`@sentropic/remote`).

## 0. Install once

```bash
npm i -g @sentropic/h2a-cli@latest
h2a --help
```

If you only see the help, you're good.

## 1. Bootstrap each agent

On the Claude side (in a terminal where Claude Code is your daily driver):

```bash
h2a connect --host claude --root ~/h2a-workspace/.h2a --instance claude:demo
```

The output prints, among other things, the JSON snippet to merge into your Claude Code MCP config. On Linux/macOS that's typically `~/.config/claude/mcp.json`. Merge it once. After that, every Claude Code session spawns the `h2a mcp-serve` subprocess automatically.

Repeat on the Codex side:

```bash
h2a connect --host codex --root ~/h2a-workspace/.h2a --instance codex:demo
```

Same merge step into the Codex CLI config (`~/.config/codex/mcp.json` or `~/.codex/config.json`, the `host setup` output tells you).

> Both CLIs **must** point at the same `--root`. That shared directory is the protocol bus.

## 2. Generate an ed25519 keypair per instance

```bash
h2a keys generate --instance claude:demo --root ~/h2a-workspace/.h2a
h2a keys generate --instance codex:demo  --root ~/h2a-workspace/.h2a
```

These PEMs land under `<root>/keys/` with mode `0600` on the private side. You'll need the path when signing artefacts later (`h2a negotiate sign --private-key <path>`).

## 3. Install the Claude skills

```bash
h2a install-skills --host claude --scope user
```

This drops the h2a skill markdown bundle into `~/.claude/skills/`. From now on, Claude Code knows three slash commands:

- `/h2a-connect`  — bootstrap a live session in the current Claude conversation
- `/h2a-discover` — list the peers currently online
- `/h2a-send`     — compose and route an envelope to a named peer

(Codex and Gemini skill conventions are different and not yet packaged — see Compatibility section below.)

## 4. Open the actual conversation

In Claude Code:

```
/h2a-connect
```

Claude reads the skill, runs through the sanity check, confirms or asks for the shared root, opens a session with `h2a_session_open`, and prints a summary like:

```
Connected. Instance: claude:demo. Session: sess:ab12cd34. Peers currently live: 0.
```

Then start Codex (or whichever other CLI session you've set up). It should ideally also have an equivalent way to call `h2a_session_open` — for now, in Codex you can ask directly: *"Call the h2a_session_open tool with instance=codex:demo, host=codex, interests={scopes:['scope:demo'], negotiations:[]}"*. Codex's MCP UI will let you run it.

Within a few seconds, Claude will receive a `presence.peer_joined` push notification on the JSON-RPC stream. The agent in Claude Code can react to it (the skill says it should), or you can just check with:

```
/h2a-discover
```

…and you'll see the Codex session listed.

## 5. Send a message

In Claude:

```
/h2a-send to codex:demo "ping from Claude"
```

Claude composes an `H2AEnvelope`, calls `h2a_inbox put`. Codex's `mcp-serve` scans the inbox on the next tick (~5s by default) and pushes a `notifications/h2a` with topic `inbox.envelope_arrived`. The Codex agent reads it and can answer.

To watch the round-trip from the CLI directly (debugging):

```bash
h2a inbox read --root ~/h2a-workspace/.h2a --instance codex:demo
h2a sessions --root ~/h2a-workspace/.h2a
```

## 6. Clean up

Just exit Claude and Codex. The graceful shutdown hook deletes the presence files. If a session is killed hard (SIGKILL, power loss), its presence file expires after 15 seconds and the peers are notified.

## What's V1 vs V2

| Aspect | V1 status (0.1.17) | V2 plan |
|---|---|---|
| Local-files transport | shipped | — |
| MCP stdio per-host adapter | shipped (Codex / Claude / Gemini) | — |
| Session + presence + push notifications | shipped (DEC-050..053) | — |
| Skill bundle for Claude | shipped (DEC-054) | — |
| Skill bundle for Codex / Gemini | not yet — different conventions | DEC-055 candidate |
| Cross-machine sync (`@sentropic/remote`) | not started | wave 2 |
| Transport auth (mTLS / bearer) | deferred (DEC-032) | V2 |
| Key management UX (rotation, keyring) | not shipped — manual PEMs | V2 candidate |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `h2a-cli: command not found` | npm global bin not on PATH | `export PATH="$(npm prefix -g)/bin:$PATH"` |
| `h2a discover` returns empty | each agent points at a different `--root` | confirm both `h2a connect` calls used the same path |
| Push notifications never arrive | host MCP config not merged or stale | re-run `h2a host setup --host <h> --print` and verify |
| `h2a doctor` returns `ok:false` with missing sentinel | `h2a init` was not run | `h2a init --root <shared>` |
| Slash commands missing in Claude | skills not installed | `h2a install-skills --host claude --scope user` |
