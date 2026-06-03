# Durable bugs / design gaps (reported 2026-06-03)

Status: **captured, not yet fixed.** Three durable issues from field use. #1 is
critical. Each has my read + a candidate direction; the fix is a separate
decision.

---

## BUG 1 (CRITICAL) — concurrent sessions on the same workspace are indistinguishable

**Report:** with several sessions on the same project=workspace, ids are "lost".
Proposed addressable shape: `{cli:claude|codex}:{workspace=projet}:{sessionId|sessionLabel}`.

**My read.** The 2026-06-02 fix (commit `c479353`) collapsed the **perennial
agent id** onto `(host, workspaceId)` to stop per-launch proliferation. That was
right for *identity / NHI* ("which agents exist"), but it **conflates agent
identity with the addressable endpoint**: the inbox is keyed on the instance id,
so N concurrent sessions in one workspace share ONE inbox/handle and cannot be
addressed (or told apart) individually. presence files (`presence/sess__*.json`)
do distinguish sessions, but addressing/routing does not use them.

**Tension to resolve (NOT a simple revert):**
- pre-fix: per-session random uuid → proliferation (the bug we removed);
- post-fix: one id per workspace → concurrent sessions indistinguishable (this bug).

**Candidate direction.** Separate the two concepts:
- **Agent/NHI identity** stays perennial: `cli:workspace:uuid` (unchanged).
- **Addressable session endpoint** becomes session-aware:
  `cli:workspace:<sessionLabel>` where `sessionLabel` is **stable + meaningful**
  (assignable, e.g. `--name`/a slug), *not* a random per-launch uuid — so it is
  distinguishable AND does not proliferate garbage. A message can target the
  agent (any/all of its sessions) OR a specific session (label).

Updates the `identity-stability-unit` memory: per-(host,workspace) is correct for
identity, but session addressing is an open critical gap. Needs a design pass
before code (do NOT just re-add providerSessionId to the binding key).

---

## BUG 2 — session keepalive not maintained → messages sent to dead agents, silently

**Report:** session keepalive isn't kept, so sends go to the wrong/dead target
(e.g. `codex:sentropic` is not alive; it even misled *me* into messaging it).
h2a should **return an error when the target agent is not alive.**

**My read.** Two compounding faults:
1. **No liveness gate on the send path.** `h2a inbox put` / remote accept / the
   MCP `h2a_inbox put` write to the target's inbox regardless of whether the
   target has a fresh session — so a dead/unknown target silently "succeeds".
   *(I did exactly this — relance to `claude:sentech-forge`, pointer to
   `codex:sentropic` — assuming alive. h2a never warned.)*
2. **Keepalive not refreshed** — `heartbeatAt` isn't maintained (compounded by
   BUG 3: idle agents aren't woken to heartbeat), so even live agents can look
   stale and dead ones linger until TTL sweep.

**Candidate direction.** On the send path, look up the target's fresh presence
(`scanFresh`/`listPresence` within TTL); if none → **return a structured error /
warning** (`recipient-not-alive`) instead of a silent write (or write + flag).
Cheapest, most contained of the three; also stops agents (and me) from
misrouting. Keepalive itself depends on BUG 3.

---

## BUG 3 — idle agents are never woken by the inbox (passive bus)

**Report:** even with nothing to do, agents aren't woken on inbox arrival — a
real blocker. Want a **terminal wrapper** that does the wake (like a relance) but
injects a **clear h2a-tagged wake reason**, e.g. `/h2a check inbox` or a neutral
line `automatic msg by h2a after <event>: inbox`. (User unsure of the CLI's exact
injection semantics by name.)

**My read.** This is the recurring **passive-bus** problem and the core of
**EVO-1 (self-drive / drive injection)** — partly built (E1a–E1d: signed drive
instruction, native-backchannel/headless/tmux drivers, `h2a drive
serve/receive`). The missing piece the user names: a **terminal wrapper** around
`claude`/`codex` that watches the inbox and **injects a wake prompt tagged with
the h2a wake reason**, so the human sees *why* the agent woke (inbox / event).

**Candidate direction.** Ship the wrapper as the EVO-1 deliverable: wrap the host
CLI, watch the instance's inbox (+ presence keepalive), and on arrival inject a
verify-before-act, h2a-tagged line (reusing the signed-drive gate). The wake text
should be explicit, e.g. `automatic msg by h2a — wake reason: inbox (<from>, <topic>)`
or a `/h2a inbox` slash. This also fixes the keepalive of BUG 2 (the wrapper
heartbeats while alive). Biggest of the three (a packaged wrapper per host).

---

## Suggested order (when we decide to fix)

1. **BUG 2** — contained, immediate value, stops misrouting (incl. mine).
2. **BUG 1** — critical but needs a design pass (identity vs addressing seam).
3. **BUG 3** — the wrapper (EVO-1) — largest; subsumes BUG 2's keepalive.
