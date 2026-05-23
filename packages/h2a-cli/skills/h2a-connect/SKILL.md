---
name: h2a-connect
description: Bootstrap a live h2a session so this CLI agent can cooperate with other agents (Claude/Codex/Gemini) over the h2a protocol. Use when the user wants to start coordinating with peers via shared workspace or message passing.
---

# /h2a-connect

When the user invokes `/h2a-connect`, follow these steps in order. Do not skip — each step depends on the previous.

## 1. Sanity check

Run `h2a --help` in the shell. If the binary is missing, instruct the user:

```
npm i -g @sentropic/h2a-cli@latest
```

…and stop. Do not proceed until the user confirms installation.

## 2. Decide the shared root

The shared root is the filesystem directory that all cooperating CLI agents must point at. Ask the user:

- if they already have a shared root (e.g. `~/h2a-workspace/.h2a`), use it
- otherwise suggest `~/h2a-workspace/.h2a` and confirm

Run `h2a init --root <chosen-root>` to bootstrap the directory layout. If it already exists, the verb is idempotent and returns `ok: true`.

## 3. Pick an instance id

The instance id identifies this agent on the shared bus. Format:

```
<host>:<short-workspace-name>
```

Examples: `claude:project-alpha`, `codex:backend`, `gemini:research`.

Ask the user to confirm or override the default.

## 4. Generate a signing key

Run `h2a keys generate --instance <id> --out <root>/keys/`. This produces a PEM keypair and updates the registry entry with the public key.

If the user has an existing PEM elsewhere, skip and let them register manually with `h2a register`.

## 5. Open the live session

Call the MCP tool `h2a_session_open` with:

```json
{
  "instance": "<id>",
  "host": "<host>",
  "interests": { "scopes": ["<scope-of-interest>"], "negotiations": [] }
}
```

The default subscribed topics include presence and inbox events, so the agent will be notified automatically of peers joining/leaving and incoming messages.

## 6. Print a summary

Show the user:

- the chosen root
- the instance id
- the session id returned by `h2a_session_open`
- the peers currently live (from the same response)
- a one-line cue: *"You are now connected. Tell me when you want to send a message (`/h2a-send`) or look at who else is around (`/h2a-discover`)."*

## Failure modes

- `h2a init` fails → filesystem permission, surface the error verbatim.
- `h2a keys generate` fails → check `--out` is writable; do not retry silently.
- `h2a_session_open` returns `{ error: ... }` → display the error and stop; do not assume the session is open.
