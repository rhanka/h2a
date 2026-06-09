# h2a governance slice 1 — Mission + wake gatekeeping (DRAFT, under double review)

Date: 2026-06-09. Status: DRAFT pending Opus-4.8 + Codex-5.5-xhigh review, then user go-ahead to implement.
Parent vision: the h2a governance/RACI layer (memory h2a_governance_vision). This is the keystone slice;
clearance (CoI), conductor-mailbox, and the suggestion ladder build on it later.

## Problem
Across ~50 repos, concurrent agents wake/act in workspaces with no coordination owner. Two failure shapes:
(a) an agent works in / answers for a workspace it has no responsibility over; (b) N idle agents (or N h2a)
independently wake the same agent. We need: a known CONDUCTOR per workspace, a liveness check h2a owns, and
a single authorized waker when no conductor is live.

## Build on what EXISTS (no reinvention)
- Roles `CONDUCTOR / PRINCIPAL / AGENTS / …` (types.ts), per-instance via registration.
- Presence carries `workspace {id,path,label}` + is liveness-filtered (90s).
- Atomic single-holder claims already done via `withLockSync` (bindings.ts).
- Wake path: `createInboxWakeHandler` / drumbeat relaunchers (local-tmux).
- Cross-agent request emission: discover→full-id→inbox put (the keepalive request pattern).

## Model (MVP scope for slice 1)

### M1 — Conductor-of-workspace = DERIVED (no new declaration burden)
"The CONDUCTOR of workspace W" = a live session whose instance is registered with role `CONDUCTOR` and whose
presence `workspace.id === W`. Resolver: `conductorFor(root, workspaceId)` → the live CONDUCTOR session(s) for W
(via listPresence ∩ registry roles ∩ workspace). Optional explicit override later; derivation first.
- New: `h2a conductor --workspace <id|path>` (CLI) + `h2a_conductor` (MCP) → `{ workspaceId, conductor: <instance|null>, live: bool, candidates: [...] }`.

### M2 — Gatekeeper lease (single missioned h2a when no conductor)
When NO conductor is live for W, exactly one h2a may act as the wake gatekeeper. A lease file
`<root>/missions/<safe(workspaceId)>.json = { gatekeeper: <instance>, leaseUntil: <iso>, at: <iso> }`, claimed
under `withLockSync` (first-claimant; renew while held; expires after TTL e.g. 120s so a dead gatekeeper frees it).
- `claimGatekeeper(root, W, instance, now)` → `{held: bool, holder}`. Idempotent renew for the holder.
- Multi-h2a case (vision pt 5/6): the lease IS the election — losers see `held:false, holder:<other>` and yield.

### M3 — Wake gate (the load-bearing rule)
Before waking instance X in workspace W (in the wake/relaunch path), gate:
1. If a CONDUCTOR is live in W → ALLOW (conductor coordinates; status quo wake).
2. Else → the waker must HOLD the gatekeeper lease for W; if it does → ALLOW; if not → DENY (yield to the
   holder) and log. This stops N idle agents/h2a from duplicate-waking.
- Must NOT regress the keepalive/self-wake we shipped: a session waking ITSELF (from==to self-wake) is exempt
  (you may always wake your own pane). The gate applies to waking ANOTHER agent.

### M4 — Conductor invocation via remote (when none live)
When no conductor is live AND this h2a holds the lease, it MAY emit a request to `remote` to launch a CONDUCTOR
for W, host preference **claude > codex > agy**. Slice-1 deliverable = the request EMISSION (h2a composes +
sends the envelope to the live remote, like the keepalive request) + a documented contract; the actual spawning
is remote's side (not built here). Behind a flag/opt-in; never auto-spawns without the lease.

## Out of scope for slice 1 (later slices)
Cross-workspace clearance/CoI gate (reuse MANDATE + postureConflit); async conductor-mailbox; graphify/track/
harness suggestion ladder; track↔h2a RACI; stp-as-centralizer. Captured in h2a_governance_vision.

## Decisions to confirm (in this spec)
- D1 Conductor resolution: DERIVED from (live + role CONDUCTOR + workspace). Préco: yes, derive; explicit
  override deferred.
- D2 Election: lease-based single-holder (first-claimant + TTL renew). Préco: lease (matches bindings pattern).
- D3 Remote invocation in slice 1: emit-the-request only (remote spawns). Préco: yes, emit only.
- D4 Wake-gate default when the feature is OFF / no missions file: ALLOW (backwards-compatible; gate is
  opt-in per root or per --govern flag) so we never break existing wakes on rollout. Préco: opt-in, default allow.

## Work packages
- WP-G1: `conductorFor` resolver + `h2a conductor` CLI/MCP + tests. (read-only, safe)
- WP-G2: gatekeeper lease (`claimGatekeeper`/`renew`/`release` under lock) + `missions/` store + tests.
- WP-G3: wake-gate in the wake/relaunch path (self-wake exempt; opt-in; default-allow) + tests.
- WP-G4: remote conductor-invocation request emission (compose+send; documented contract) + tests.
Release per WP. Reversible (opt-in, default-allow); the only sharp risk is M3 regressing wakes → guarded by
self-wake exemption + opt-in + tests.
