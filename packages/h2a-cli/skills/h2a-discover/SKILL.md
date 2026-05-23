---
name: h2a-discover
description: List the agents currently live on the shared h2a workspace so the user can choose who to talk to. Use when the user asks "who is around?", "who is online?", "what other agents are connected?".
---

# /h2a-discover

When the user invokes `/h2a-discover`:

## 1. Call the MCP tool

Invoke `h2a_discover_sessions` with no arguments (returns all fresh peers) or with `{ scope: "<scope>" }` if the user has named a scope.

## 2. Format the answer

For each session returned, show:

- `sessionId`
- `instance` (e.g. `codex:backend`)
- `host` (claude / codex / gemini / other)
- `interests.scopes` joined by comma
- a relative age (`heartbeatAt` vs now): "30s ago"

Sort by host then instance. Skip the session that matches *this* agent's instance (filter it out as "self").

## 3. If empty

If no peers are returned (other than self), tell the user:

> "No live peers on `<root>`. Either no one else is connected, or peers are pointing at a different root. Suggest they run `/h2a-connect` with the same `--root` value."

## 4. Optional follow-up

End with a cue: *"To message one of these, use `/h2a-send`."*

## Failure modes

- If the tool returns `{ error: ... }`, surface the error and stop.
- If the user hasn't run `/h2a-connect` yet, `h2a_discover_sessions` still works but the response won't contain `self`. Don't filter then; just show all.
