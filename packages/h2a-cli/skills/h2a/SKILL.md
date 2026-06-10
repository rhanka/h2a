---
name: h2a
version: 0.66.0
description: Coordinate with other CLI agents (Claude Code, Codex, Gemini) via the h2a protocol — open a live session, list peers, exchange messages, drive a signed negotiation. Use when the user wants the current CLI to interact with another agent through a shared workspace.
---

# /h2a

When invoked, parse the arguments and dispatch to the matching subcommand below. If no subcommand is given, default to `status`.

```
/h2a                           → status (alias)
/h2a connect [root]            → bootstrap a live session in this conversation
/h2a status                    → show current session state and health summary
/h2a discover [scope]          → list live peer agents
/h2a conductor [workspace]          → who owns/conducts a workspace right now (null = none yet)
/h2a conductor claim                → claim conductor for a workspace (earliest live claimant wins)
/h2a conductor release              → release conductor claim (frees it for the next claimant)
/h2a conductor-launch-check [workspace]  → DRY-RUN: polls track; recommends launching a conductor if stalled + none live
/h2a conductor-launch [workspace]        → EMIT a launch REQUEST to remote when stalled+no conductor; capped 1/30min, requires --confirm; h2a never spawns
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
4. **Resolve YOUR perennial identity — do NOT invent it.** Run `h2a connect --host <h> --root <root>`; it returns the perennial instance id `host:slug(label):uuid12` (DEC-114/116), bound per `(host, workspace)` and reclaimed on reconnect — the same workspace always gets the same id (never mint `host:workspace-leaf` by hand; that bare `host:label` form is the *channel* alias, see "Identity & addressing"). Use the returned `instance`.
5. Call the MCP tool `h2a_session_open` with `{ instance, host, interests: { scopes: ["scope:default"], negotiations: [] } }` (instance = the resolved perennial id from step 4).
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

**Peer resolution rule — always use `h2a_discover_sessions`, never grep the registry:**
To reach a peer by PURPOSE/role, RESOLVE it via `h2a_discover_sessions` filtering on `scope` (the canonical purpose key) or `name` (case-insensitive substring match on the agent's display name) — e.g. `{ scope: "scope:chat" }` or `{ name: "radar" }`. NEVER grep the registry for a free-text name: instance ids are workspace-derived (`host:slug(workspace):uuid`), so a name grep misses. If several sessions match, list them and let the user pick (or pick the single live one); if none match, the agent has not advertised that scope/name yet.

Steps:

1. Call `h2a_discover_sessions` with `{ scope }` (omit if no argument); add `{ name: "<substring>" }` when the user asks to find a peer by friendly name.
2. Filter out the current agent's own session (compare against `h2a_session_open`'s `sessionId` if known).
3. For each remaining session, print: `instance`, `host`, `name` (if set), `interests.scopes` (comma-joined), a relative heartbeat age ("12s ago"), and `sessionId`.
4. Sort by host then instance.
5. If empty: say so and suggest the user check that the other CLIs ran `/h2a connect` against the same root.

End with: *"To message one of these: `/h2a send <instance> \"<text>\"`."*

### `/h2a conductor [workspace]`

Resolve who owns/conducts a workspace right now. Call `h2a_conductor` (MCP) or `h2a conductor --workspace <id|path>` (CLI).

- `conductor` = the earliest live active-claimant (WP-G1b, claim-based election), or a live in-workspace agent registered with role `CONDUCTOR` (back-compat), or `null` if none. **Null is the normal/expected state** today — agents auto-register as `AGENTS`, not `CONDUCTOR`. Do NOT treat `null` as an error; it means "no designated owner yet."
- `claimedBy` = the instance that won via claim-based election, or `null` if resolved by role or absent.
- `candidates` = all in-workspace live agents (anyone who has a fresh presence record for that workspace), regardless of role.
- `live` = `true` if at least one candidate is present.
- `workspace` argument: a `ws:<uuid>` workspace id or a filesystem path (resolved via the same derivation presence uses). Defaults to cwd.

**When to use it:** call `h2a_conductor` before acting in a workspace on behalf of another agent, to check whether a designated conductor is already live. If `conductor` is non-null, coordinate with them first rather than acting unilaterally.

### `/h2a conductor claim [--instance <self>] [workspace]`

Claim the conductor role for a workspace (WP-G1b — additive, reversible). Appends a `claim` event; returns the post-claim `conductorFor` result. The caller should be itself if it won (earliest live claimant wins; a later claimant is listed in candidates but does not displace the earlier one as long as it is still live).

CLI: `h2a conductor claim --instance <self> [--workspace <id|path>] [--root <path>]`
MCP: `h2a_conductor_claim { instance, workspaceId|workspacePath }`

Exit 1 if `--instance` is missing.

### `/h2a conductor release [--instance <self>] [workspace]`

Release the conductor claim for a workspace (WP-G1b — additive, reversible). Appends a `release` event; returns the post-release `conductorFor` result (conductor is the next live claimant, or null if no other claimant is live).

CLI: `h2a conductor release --instance <self> [--workspace <id|path>] [--root <path>]`
MCP: `h2a_conductor_release { instance, workspaceId|workspacePath }`

Exit 1 if `--instance` is missing.

### `/h2a conductor-launch-check [workspace] [--idle-ms <ms>]`

**DRY-RUN (D3).** Polls `track workspace-activity` and returns a recommendation to launch a conductor if work is durably stalled and no conductor is live.

**h2a does NOT spawn anything.** A `recommendation === "launch"` result is purely advisory. The actual launch is **parked** pending a spawn-policy decision and remote-trigger support.

CLI: `h2a conductor-launch-check [--workspace <id|path>] [--root <path>] [--idle-ms <ms>]`
MCP: `h2a_conductor_launch_check { workspaceId|workspacePath, idleMs? }`

Return shape: `{ workspaceId, trackAvailable, conductor, conductorLive, pending, stalled, recommendation, reason, suggestedHosts? }`

- `recommendation` is `"launch"` when: no conductor is live AND track reports at least one stalled item.
- `suggestedHosts` = `["claude", "codex", "agy"]` (user preference order) when `recommendation === "launch"`.
- `trackAvailable: false` when `track` is not installed or errors — graceful, `recommendation` stays `"none"` (no false positives).
- `--idle-ms` is the stall threshold passed to `track workspace-activity` (default 86400000 = 24h).

A one-liner stderr note is emitted when `recommendation === "launch"` reminding callers this is a DRY-RUN.

### `/h2a conductor-launch [workspace] [--idle-ms <ms>] [--confirm] [--remote <instance>] [--instance <self>]`

**D3 EMISSION.** When `conductorLaunchCheck` returns `recommendation="launch"`, emits a `conductor-launch-request` envelope to a live remote agent.

**h2a NEVER spawns a process.** It only puts a request envelope in the remote's inbox; the remote agent executes the actual spawn.

**Gates (both must pass to emit):**
1. **Human confirmation:** without `--confirm`, only preview the request (`action: "would-emit"`). With `--confirm`, emit + record the marker.
2. **Cap/cooldown:** at most 1 emission per 30 minutes per workspace (`action: "cooldown"` if too recent).

`--instance <self>` is required with `--confirm` (identifies the sender/signer).

**Host preference in the request:** `["claude", "codex", "agy"]`.

CLI: `h2a conductor-launch [--workspace <id|path>] [--root <path>] [--idle-ms <ms>] [--confirm] [--remote <instance>] [--instance <self>]`
MCP: `h2a_conductor_launch { workspaceId|workspacePath, idleMs?, confirm?, remote?, instance? }`

Return shape (all cases exit 0 except user errors):
- `{ action: "none", reason, ...check }` — recommendation is not "launch".
- `{ action: "cooldown", reason, lastSpawnAt }` — cooldown not elapsed.
- `{ action: "would-emit", request, note }` — preview (no --confirm).
- `{ action: "no-remote", reason }` — no live remote agent found (--confirm but no remote).
- `{ action: "emitted", to, request }` — emitted + marker recorded.

### `/h2a send <peer> "<text>"`

Compose and route an envelope to a named peer.

**Resolve-before-send rule (0.59.0+):** Always resolve the peer to its LIVE full id (`host:label:uuid12`) via `h2a_discover_sessions` BEFORE sending. A bare `host:label` sent to an ambiguous target (>1 live agent sharing that alias) or a phantom target (0 live, 0 registered) is now **REFUSED** by `h2a_inbox put` / `h2a` CLI with exit 1. Never invent a sub-label. The safe pattern is: discover → pick the exact live `host:label:uuid12` → send to that. A bare alias is only acceptable for a dormant/wake-drop or exactly 1 live match (the tool surfaces the live candidate in `liveCandidate`).

Steps:

1. **Resolve the target + check liveness FIRST (`h2a_discover_sessions`).** Pick the addressing form (see "Identity & addressing"):
   - target is a **specific live agent** → use its **full perennial id** `host:slug:uuid12` from discover (NOT the bare `host:label`, which is ambiguous when several agents share a workspace);
   - target is a **role/channel or a known-dormant peer** → use the **channel** form `host:label`.
   - If the user names a peer by PURPOSE/role, call `h2a_discover_sessions` with `{ scope: "<purpose>" }`. If the user names a peer by FRIENDLY NAME, call `h2a_discover_sessions` with `{ name: "<substring>" }`. NEVER grep the registry for a name: instance ids are workspace-derived (`host:slug(workspace):uuid`) so a text search misses. If several match, list and ask; if none, the agent hasn't advertised that scope/name.
   - If `<peer>` is missing, list discover and ask the user to pick.
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
4. **Hard rule: the recipient MUST be host-qualified (`<host>:<label>`, e.g. `claude:radar-immobilier`). A bare label (e.g. `radar-immobilier`) is rejected — the same label can live on several hosts (claude, codex, …), so a bare label is ambiguous and routes to an orphan inbox nobody reads.**

   Call `h2a_inbox` with `{ action: "put", instance: "<peer>", envelope }`.

   **Conversation threading (optional, lightweight):** To continue an existing back-and-forth as a thread, add two top-level fields to the envelope JSON before putting it:
   - `"threadId": "<id>"` — reuse the `threadId` from the peer's previous envelope, or mint a fresh one as `thr:<epoch-ms>:<4hex>` to start a new thread.
   - `"replyTo": "<prev-envelope-id>"` — the `id` of the envelope you are replying to.

   To reconstruct the ordered fil of a thread (for supervision or before opening a formal negotiation):
   ```sh
   h2a thread --id <threadId> --instance <self-instance> --root <root>
   ```
   This returns the envelopes (from your inbox + outbox) that share that `threadId`, sorted ascending by `createdAt`, deduped. No new store — storage is derived on the fly.

5. **Report honestly per the target's liveness** (h2a writes the inbox unconditionally — it does NOT yet error on a dead target, so YOU must say which it was):
   - target was **live** in discover → *"Delivered to `<peer>` (live) — push fires if subscribed."*
   - target was **NOT live** → *"`<peer>` is dormant — envelope deposited for its wake (no live session; it will only see this once woken)."* Never claim "Delivered" to a dormant/unknown peer.

For richer payloads (file pointer, deliverable, status update), set `body.kind` to a category and add the relevant fields; ask the user if ambiguous.

### `/h2a receive`

Read this agent's inbox and react to whatever is new.

Steps:

1. Call `h2a_inbox` with `{ action: "read", instance: "<this-agent-instance>" }`.
2. For each envelope, print: sender (`actor.instance`), `body.kind`, a short summary of the content, and the envelope id.
3. Ask the user what to do with each (reply via `/h2a send`, mark read by calling `h2a_inbox` with `action: "pop"`, or ignore).
4. If a `notifications/h2a` message with `topic: inbox.envelope_arrived` was just observed in the JSON-RPC stream, react immediately rather than waiting for the user to type `/h2a receive`.

**Pop after processing (hygiene rule):** Once you have acted on an envelope, call `h2a_inbox` with `{ action: "pop", instance: "<this-agent-instance>", envelopeId: "<id>" }` to remove it from the inbox. `read` is non-destructive — an un-popped envelope resurfaces on every subsequent poll and masks genuinely new arrivals. Pop as soon as the envelope is handled, not just when explicitly instructed.

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

## Keepalive (optional, launcher-side)

When the launcher or remote infrastructure runs `h2a keepalive [--root <path>] [--interval <ms>]`, it acts as an external presence prober: it lists the live tmux panes via `tmux list-panes -aF '#{pane_id}'` and refreshes the `heartbeatAt` of every presence file whose `launchContext.tmux.pane` is still alive. This keeps pane-alive agents visible on the bus even if the host suspends the MCP child process's heartbeat interval. The `--once` flag does a single pass (useful for testing and scripting); without it, the prober loops on an unref'd interval. h2a works without it — keepalive is purely additive.

---

## Identity & addressing (DEC-114/116 — read before sending)

There are **two addressable forms**; pick deliberately:

- **Agent (perennial, specific):** `host:slug(label):uuid12` — e.g.
  `claude:sentropic:cbf32fe0800b`. This is YOUR identity (resolved by `h2a
  connect`, reclaimed per `(host, workspace)`) and how you address **one specific
  live agent**. Get a peer's full id from `/h2a discover` — never guess the uuid.
- **Channel (role / alias):** `host:label` — e.g. `claude:sentropic-scale`. The
  bare `host:label` form is a **named mailbox/alias**, not a specific agent; use
  it for a role, a known-dormant peer you want to leave a message for, or a wake
  drop. A perennial agent also reads its own `host:label` alias inbox (dedup), so
  channel messages reach whichever agent adopts that label.

**Resolution rule — discover, never grep:** To reach a peer by PURPOSE/role, filter `h2a_discover_sessions` on `scope` (the canonical purpose key). To reach a peer by FRIENDLY NAME, filter on `name` (case-insensitive substring match on `session.name`). NEVER grep the registry file for a free-text name: instance ids are workspace-derived (`host:slug(workspace):uuid`), so a name grep misses. If several sessions match, list them and pick/ask; if none match, the agent hasn't advertised that scope/name yet.

Consequences to respect:
- **Addressing is case-insensitive; the label is slugified** (0.40.0+). The handle
  is canonicalized as `lower(host):slugify(label)[:lower(uuid)]`, so `claude:matchID`
  ≡ `claude:matchid` — both reach the one inbox. The canonical channel for a label
  is therefore `host:slugify(label)` (lowercased, `[a-z0-9._-]`), **not** the raw
  display case. Don't tell a peer to address you by a mixed-case label; it resolves
  the same either way. (Pre-0.40.0 deposits in a raw mis-cased dir are still read.)
- **One perennial id per `(host, workspace)`** — several *concurrent sessions* of
  the same agent share that id and its inbox (they are distinguishable in
  `/h2a discover` by `sessionId`, but inbox delivery is per-agent, not
  per-session). To reach "whoever is working in project X", address the agent id;
  there is no per-session inbox today.
- **Liveness is not enforced on send** — `h2a_inbox put` writes even to a dead
  target. Always `/h2a discover` first and report truthfully (see `/h2a send`):
  *delivered (live)* vs *deposited for wake (dormant)*.
- **`recipientLive:false` / "dormant" ≠ "not working"** — liveness means only
  "has a fresh `mcp-serve` presence session", i.e. *reachable by a push now*. An
  agent doing real work **headless** (e.g. `codex exec`, a one-shot review) runs
  with **no presence session** and so shows as not-live while it is busy. **Never
  relaunch, reassign, or duplicate a task just because a peer reads as not-live.**
  Before assuming a peer is idle: check its `workStatus` (`working|blocked|…` in
  discover/`h2a status`, if it sets one), look for a recent delivery/report from
  it, or ask the human — do not infer "free" from "not-live". Liveness gates
  *delivery*, not *work in progress*.

## Defaults and conventions

- **Auto-connect (recommended)**: register the MCP server with `mcp-serve --auto-open --host <h>` so a session opens at host startup (EVO-6/DEC-105); `/h2a disconnect` leaves early. `/h2a connect` stays available for manual/explicit connect.

- **Shared root**: same `<root>/.h2a/` for every cooperating CLI. If the user has not declared one, look for `<cwd>/.h2a/`, then `~/h2a-workspace/.h2a`, ask if neither exists.
- **Instance id**: the **perennial** `host:slug(label):uuid12` resolved by `h2a connect` (reclaimed per `(host, workspace)`) — do NOT hand-mint `host:workspace-leaf`; that bare form is the channel alias.
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
- `h2a status [--root <path>] [--scope <s>] [--instance <i>]` — inventory of connected sessions split **direct** (local mcp-serve heartbeat) vs **indirect** (mirrored in from a remote/sidecar), with counts.
- `h2a keys generate --instance <id>` — produce an ed25519 PEM keypair.
- `h2a install-skills --host <claude|codex|gemini|agy>` — re-install or update this skill on another host. *(For **agy**/Antigravity the skill is written to the shared `~/.gemini/commands/h2a.toml`; the command then prints an `importHint` — run `agy plugin import gemini` (then `agy plugin enable h2a`) to pull it into agy. DEC-096/101.)*

**Operational surfaces** (also shell-invocable; matching `h2a_*` MCP tools where noted):

- `h2a nhi report|inventory|attest|offboard|export` — Non-Human-Identity posture / inventory / signed attestation / coordinated offboard / SPIFFE-bundle export (`h2a_nhi_*`, DEC-087..090/094).
- `h2a blockage raise|list|resolve` — the peer blockage feedback loop, distinct from the drumbeat and from escalation (`h2a_blockage_*`, DEC-092). Subscribed sessions get `peer.blocked`/`peer.unblocked` pushes.
- `h2a drumbeat record|scan|clear|escalations|watch` — anti-stall relance daemon + escalation-to-PRINCIPAL (DEC-086/091/095). Gov D2/D4 (0.64.0): a claimed conductor owns its workspace's relances — peers defer on fresh stalls (relanceCount=0); a failsafe lets a peer step in if the conductor leaves an agent stuck (relanceCount>=1, preventing workspace freeze). Cross-workspace relances emit a CoI advisory (warn, not blocked). Both behaviors are opt-in and default-allow: pass `--instance <self>` to `h2a drumbeat watch` to activate them.
- `h2a sysml verify --json <env> --public-key <pem>` — verify a SysML-v2 ref embedded in a signed envelope (commit-trust + content-integrity, DEC-099).
- `h2a host setup|status|plugin --host <codex|claude|gemini|agy>` — render the per-host MCP config / stop-hook glue (DEC-093/096).
