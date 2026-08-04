# CR — Presence liveness must recognize a live tmux session as *activatable*, not "dormant"

- **Reported by:** owner (rhanka), 2026-07-20
- **Status:** intent captured — pending analysis/spec (1× Opus 4.8 xhigh assigned)
- **Priority:** high (blocks reliable inter-agent coordination, e.g. agy/llm-mesh)

## Problem (observed)

h2a decided the `llm-mesh` agent was **dormant** / `recipientLive:false, freshSessions:0`
when an inbox envelope was put to `claude:llm-mesh:e5f8b95941e9`. But `llm-mesh` is
**not dormant** — its tmux session is live:

```
tmux list-sessions → remote-llm-mesh: 1 windows (created Fri Jul 17 12:31:02 2026) (attached)
```

The session is *stalled* (the agent is idle at its prompt / not heartbeating MCP),
but the terminal + agent process are alive. h2a conflates "not heartbeating" with
"dormant/unreachable", which is wrong and produces the coordination ping-pong the
owner is fighting: directives get queued to an identity h2a believes is dead,
instead of **waking the live session**.

## Owner's requested change

1. **Distinguish tmux terminal bg vs fg** (backgrounded/detached vs attached/foreground).
2. A tmux session that is **live** (agent process + session up) must NOT be reported
   as "dormant" merely because it is backgrounded or not heartbeating — it should be
   classified as **activatable**.
3. h2a **should be able to wake such a session via tmux on demand** (per need), and
   the liveness/reachability model + `status`/presence outputs must reflect
   `live | activatable(bg/idle, tmux-wakeable) | dormant(no session) | dead`.

## Grounding (current code)

- `presence.ts`: liveness = presence-file freshness within `H2A_SESSION_DEFAULT_EXPIRY_MS`
  (≈90s) + a signal-0 pid probe; `lastMcpActivityAt`/`connectionConfidence` add an
  `idle-uncertain` tier. None of this knows about a live tmux session.
- `paths.ts`: already models a `deliver-dormant` outcome and states "we intentionally
  wake dormant agents" — so the **wake path exists**; the *classification* is what lies.
- Drumbeat has a `local-tmux` relauncher (the proven wake transport) — the activation
  primitive already exists; it is not fed into the liveness/status projection.

## Ask for the 4.8xhigh

Root-cause the current liveness/reachability computation, then design a
**tmux-aware, bg/fg-aware, activatable** liveness model: how to detect a live tmux
session for an instance (map instance→tmux session/pane), how to classify
`activatable` distinctly from `dormant`, how `resolveRecipient`/`status`/inbox-put
should report and (optionally) auto-wake, and the minimal seams to implement it
without breaking the frozen `status` JSON contract. Fail-closed and honest-presence
principles apply. Output: root-cause + phased design proposal.

## Related

- [[wake_transport_reality]] (local-tmux = the only proven wake transport)
- [[mcp_disconnect_false_live]] (presence can lie: heartbeat blind + no auto-reconnect)
- [[reflect_host_native]] (h2a reflects native host state)
