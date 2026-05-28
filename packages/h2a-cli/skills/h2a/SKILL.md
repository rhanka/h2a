---
name: h2a
description: Coordinate with other CLI agents (Claude Code, Codex, Gemini) via the h2a protocol — open a live session, list peers, exchange messages, drive a signed negotiation. Use when the user wants the current CLI to interact with another agent through a shared workspace.
---

# /h2a

When invoked, parse the arguments and dispatch to the matching subcommand below. If no subcommand is given, default to `status`.

```
/h2a                           → status (alias)
/h2a connect [root]            → bootstrap a live session in this conversation
/h2a status                    → show current session state and health summary
/h2a discover [scope]          → list live peer agents
/h2a send <peer> "<text>"      → put a message envelope in a peer's inbox
/h2a receive                   → read this agent's inbox and react to new envelopes
/h2a negotiate <verb> ...      → drive a negotiation lifecycle (open|offer|sign|stabilize)
/h2a model "<situation>"       → propose a tailored h2a model for an org/situation
/h2a disconnect                → cleanly close the current session
/h2a help                      → print this command map
```

The user's raw arguments arrive appended below the prompt; treat anything after `/h2a` as the routing token.

---

## Routing

### `/h2a connect [root]`

Bootstrap a live session so this agent can cooperate with other CLI agents.

Steps:

1. Verify the `h2a` binary is on PATH (`h2a --help`). If absent, instruct the user to run `npm i -g @sentropic/h2a-cli@latest` and stop.
2. Decide the shared root. If `[root]` was passed, use it; otherwise prefer `<this-workspace>/.h2a`, else `~/h2a-workspace/.h2a`. Confirm with the user only if ambiguous.
3. Run `h2a init --root <root>` (idempotent).
4. Pick an instance id. Default: `<host>:<workspace-leaf>` (host = claude|codex|gemini|agy; workspace-leaf = `basename <cwd>`).
5. Call the MCP tool `h2a_session_open` with `{ instance, host, interests: { scopes: ["scope:default"], negotiations: [] } }`.
6. Print a short summary: instance id, session id, peers currently live, the four notification topics this session is subscribed to.

End with the cue: *"Connected. Try `/h2a discover` to see who else is around, or `/h2a send <peer> \"hi\"` to message someone."*

### `/h2a status`

Show the current connectivity state. Steps:

1. If no session has been opened yet in this conversation, say so and suggest `/h2a connect`.
2. Otherwise call `h2a_discover_sessions` and find the session whose `sessionId` matches the one returned by `h2a_session_open`.
3. Print: instance id, session id, state (`opening|live|draining|closed|expired`), `heartbeatAt`, count of peer sessions, count of unread inbox envelopes (call `h2a_inbox` with `action: "read"` and report length).
4. If anything looks stale (no recent heartbeat, no peers when peers were expected), suggest `/h2a connect` to re-open.

### `/h2a discover [scope]`

List currently-live peer agents.

Steps:

1. Call `h2a_discover_sessions` with `{ scope }` (omit if no argument).
2. Filter out the current agent's own session (compare against `h2a_session_open`'s `sessionId` if known).
3. For each remaining session, print: `instance`, `host`, `interests.scopes` (comma-joined), a relative heartbeat age ("12s ago"), and `sessionId`.
4. Sort by host then instance.
5. If empty: say so and suggest the user check that the other CLIs ran `/h2a connect` against the same root.

End with: *"To message one of these: `/h2a send <instance> \"<text>\"`."*

### `/h2a send <peer> "<text>"`

Compose and route an envelope to a named peer.

Steps:

1. If `<peer>` is missing, call `h2a_discover_sessions` and ask the user to pick.
2. If `"<text>"` is missing, prompt the user for the content.
3. Compose an `H2AEnvelope` JSON:
   ```json
   {
     "protocol": "sentropic.h2a",
     "version": "0.1",
     "id": "env:<epoch-ms>:<4hex>",
     "type": "event",
     "actor": {
       "instance": "<this-agent-instance>",
       "role": "<this-agent-role-or-AGENTS>",
       "scope": "<shared-scope-or-default>"
     },
     "body": { "kind": "message", "text": "<text>" },
     "createdAt": "<ISO-8601-now>"
   }
   ```
4. Call `h2a_inbox` with `{ action: "put", instance: "<peer>", envelope }`.
5. Print: envelope id + recipient + *"Delivered. They will see a push notification if their session is subscribed."*

For richer payloads (file pointer, deliverable, status update), set `body.kind` to a category and add the relevant fields; ask the user if ambiguous.

### `/h2a receive`

Read this agent's inbox and react to whatever is new.

Steps:

1. Call `h2a_inbox` with `{ action: "read", instance: "<this-agent-instance>" }`.
2. For each envelope, print: sender (`actor.instance`), `body.kind`, a short summary of the content, and the envelope id.
3. Ask the user what to do with each (reply via `/h2a send`, mark read by calling `h2a_inbox` with `action: "pop"`, or ignore).
4. If a `notifications/h2a` message with `topic: inbox.envelope_arrived` was just observed in the JSON-RPC stream, react immediately rather than waiting for the user to type `/h2a receive`.

### `/h2a negotiate <verb> ...`

Drive a step of the h2a negotiation lifecycle. The subverb is one of:

- `/h2a negotiate open <id> <scope> <parties> "<subject>"` — call `h2a_open_negotiation` with a fresh `H2ANegotiationRecord`.
- `/h2a negotiate offer <id> <artifact-json>` — call `h2a_offer`.
- `/h2a negotiate counter <id> <artifact-json>` — call `h2a_counteroffer`.
- `/h2a negotiate sign <id> <artifact-json> [--key <pem-path>]` — call `h2a_sign` (the private key PEM path defaults to `<root>/keys/<instance>.key.pem` from `h2a keys generate`).
- `/h2a negotiate stabilize <id>` — call `h2a_stabilize` once the quorum is signed.
- `/h2a negotiate journal <id>` — print the journal entries.

For each verb, validate the required arguments, surface any tool error verbatim, and print a one-line confirmation with the latest journal entry id.

### `/h2a model "<situation>"`

Propose a **tailored h2a model** for a free-form organization or situation (e.g. *"a hospital coordinating with insurers and a regulator"*, *"a 3-team scaled-agile delivery with AI agents"*). This is an **advisory mapping**, not a protocol action — it emits a design, it does not write to the store.

Method (follow it faithfully — do not invent vocabulary):

1. **Ground in the canonical model first.** Read `VOCABULARY.md` for the frozen roles (`PRINCIPAL`, `EXECUTIF`, `CONDUCTOR`, `AGENTS`, `CONTROL`, `MANDATAIRE`) and substrate (`SCOPE`, `CONTRACT`, `POLICY`, `ENGAGEMENT`, `MANDATE`, `SLOT`, `BINDING`, `NEGOTIATION`, `AUTHORITY`), and skim `evaluations/README.md` (the common grid) plus the closest existing use-case in `evaluations/` (A enterprise, B ecosystem, C government, D 15-conductors, E agentic squad). Reuse their patterns; do not coin new roles or artifacts.
2. **Map the situation** against the common grid: actors→roles, scopes, authority/mandate/signature, CONTRACT vs ENGAGEMENT vs POLICY, obligations/rights/clauses, controls, escalations, audit, deadlocks/precedence, gaps.
3. **Respect the invariants** (these are load-bearing):
   - A `SCOPE` never signs; a **mandated INSTANCE** signs for a party/scope.
   - `ENGAGEMENT` *has* a scope — it is **not** the scope. Name both.
   - Anything that must be *owned* needs a `PRINCIPAL` (e.g. architecture ownership) — `CONTROL` only audits/vetoes, it owns nothing.
   - `POLICY` is a durable rule (standalone *or* a clause of a CONTRACT); prefer expressing rules as engagement clauses unless they are cross-cutting/imposed.
   - Delegated AI agents are `AGENTS` (or `SUBAGENTS`, parent-addressed) via `MANDATE`+`BINDING`, default **execution-only / non-signing**.
   - `MANDATAIRE` presents/records, never judges; escalation targets the scope's competent authority.
4. **Output**, mirroring the `evaluations/*.md` structure:
   - a **Mermaid diagram** of roles/scopes/contract flows;
   - a **mapping table** (real element → h2a construct → note);
   - **contracts vs policies**, a multi-actor case, **gaps**, and a one-paragraph **compatibility hypothesis**;
   - the **nearest built-in profile** id (`A_ENTERPRISE` / `B_ECOSYSTEM` / `C_GOVERNMENT_CITIZEN` / `D_SAFE`) and how the situation differs from it.
5. **Offer to persist**: ask whether to save the proposal as a new `evaluations/<slug>.md` (same format) for review. Only write the file if the user agrees.

Keep it a proposal: surface assumptions and the genuine design forks (e.g. one scope with co-principals vs sub-scopes) rather than silently deciding them.

### `/h2a disconnect`

Cleanly close the current session.

Steps:

1. Call `h2a_session_close` with `{ sessionId, state: "closed" }`.
2. Confirm.

This is rarely needed manually — the session auto-closes when this CLI process exits, via the mcp-serve shutdown hook (DEC-051). Use it if the user wants to release the slot before exiting.

### `/h2a help`

Print the command map at the top of this file. Concise, no extra prose.

---

## Defaults and conventions

- **Auto-connect (recommended)**: register the MCP server with `mcp-serve --auto-open --host <h>` so a session opens at host startup (EVO-6/DEC-105); `/h2a disconnect` leaves early. `/h2a connect` stays available for manual/explicit connect.

- **Shared root**: same `<root>/.h2a/` for every cooperating CLI. If the user has not declared one, look for `<cwd>/.h2a/`, then `~/h2a-workspace/.h2a`, ask if neither exists.
- **Instance id**: `<host>:<workspace-leaf>`. Don't ask for confirmation if the default looks sensible.
- **Subscriptions**: when opening a session, subscribe to all four canonical notification topics (`presence.peer_joined`, `presence.peer_left`, `inbox.envelope_arrived`, `negotiation.event_appended`) unless the user narrows the scope.
- **JSON-RPC notifications**: `notifications/h2a` messages arrive on stdout interleaved with tool responses. They have no `id` field and use `method: "notifications/h2a"`. React to them in real time rather than polling.

## Failure modes

- Tool returns `{ error: ... }` → surface the error verbatim, stop the current subcommand.
- `h2a` binary missing → install instruction + stop.
- Root not initialized → suggest `/h2a connect`.
- Session not open → suggest `/h2a connect` (do not silently bypass).
- Peer not in `h2a_discover_sessions` → name it, suggest checking the spelling or that the peer ran `/h2a connect` against the same root.

## Related commands shipped by `@sentropic/h2a-cli`

These can be invoked directly from the shell at any time, outside the slash-command flow:

- `h2a doctor [--root <path>]` — quick health probe.
- `h2a sessions [--root <path>]` — same listing as `/h2a discover` but from the shell.
- `h2a keys generate --instance <id>` — produce an ed25519 PEM keypair.
- `h2a install-skills --host <claude|codex|gemini|agy>` — re-install or update this skill on another host. *(For **agy**/Antigravity the skill is written to the shared `~/.gemini/commands/h2a.toml`; the command then prints an `importHint` — run `agy plugin import gemini` (then `agy plugin enable h2a`) to pull it into agy. DEC-096/101.)*

**Operational surfaces** (also shell-invocable; matching `h2a_*` MCP tools where noted):

- `h2a nhi report|inventory|attest|offboard|export` — Non-Human-Identity posture / inventory / signed attestation / coordinated offboard / SPIFFE-bundle export (`h2a_nhi_*`, DEC-087..090/094).
- `h2a blockage raise|list|resolve` — the peer blockage feedback loop, distinct from the drumbeat and from escalation (`h2a_blockage_*`, DEC-092). Subscribed sessions get `peer.blocked`/`peer.unblocked` pushes.
- `h2a drumbeat record|scan|clear|escalations|watch` — anti-stall relance daemon + escalation-to-PRINCIPAL (DEC-086/091/095).
- `h2a sysml verify --json <env> --public-key <pem>` — verify a SysML-v2 ref embedded in a signed envelope (commit-trust + content-integrity, DEC-099).
- `h2a host setup|status|plugin --host <codex|claude|gemini|agy>` — render the per-host MCP config / stop-hook glue (DEC-093/096).
