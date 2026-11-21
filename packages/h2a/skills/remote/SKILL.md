---
name: remote
description: Steer a workstation's sessions from the remote-control site — report state, stop sharing a session, or cut remote control entirely. Use when the user asks what is shared, wants a session hidden from the site, or wants remote control stopped. Enrolling, starting or switching the agent on is never an agent action: print the terminal command for the human instead.
---

# h2a remote

## What you may do as an agent

You have exactly three remote-control MCP tools, the safe directions only:

- `h2a_remote_status` — report link, agent and kill-flag state (same service as the `h2a remote status` CLI verb).
- `h2a_remote_off` — stop sharing one session from the site (same service as the `h2a remote off` CLI verb).
- `h2a_remote_kill` — release remote leases, close the link, stop the agent and set the local kill flag (same service as the `h2a remote kill` CLI verb).

Every tool needs `H2A_REMOTE_CONTROL=1` on the workstation. When it is off, report the refusal as-is; do not retry around it.

## What is terminal-only, never an agent action

Enrolling, starting or switching the agent on, and revoking the node key, are terminal-only verbs for the human at an interactive terminal. There is no MCP tool for them by construction. Never run them yourself from Bash and never ask the user to type them into this chat. Print the command and stop:

- `h2a remote enrol --confirm enrol` — enroll this workstation node on the remote-control site.
- `h2a remote up --confirm up` — start the per-account agent.
- `h2a remote on <session> --confirm on` — share a session with the site.
- `h2a remote revoke --confirm revoke` — revoke the node key on the site, then delete it locally.

Each of those needs an interactive terminal and the typed `--confirm <verb>` word. Site-side approval is the human boundary.

## When to use this

- The user asks what is currently shared with the site: call `h2a_remote_status`.
- The user asks to stop sharing one session: call `h2a_remote_off` with that session.
- The user asks to cut remote control: call `h2a_remote_kill`. After a kill, a non-terminal `up` cannot clear the flag; the documented recovery is the terminal command above.
- The user asks to enroll, start or share: print the terminal command above, do not run it.
