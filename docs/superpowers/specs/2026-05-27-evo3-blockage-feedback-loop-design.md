# EVO-3 — Agent-blockage feedback loop — design

> Spec for EVO-3 (`docs/evolution-intentions.md`). The **third signal** alongside the drumbeat stall (silent → relance) and escalation (→ competent authority): a **blockage** is broadcast to **peer agents** (FYI / help request). Distinct from escalation (DEC-040, authority-targeted) and from the drumbeat (DEC-084, silent stall). `workStatus: "blocked"` is already a non-stall the drumbeat skips (DEC-085) — EVO-3 makes it actionable.

## Decision

Model the blockage as a **dedicated durable registry** parallel to the drumbeat, with notification via the existing MCP push mechanism (DEC-052) and a per-host delivery adapter layer for disconnected peers.

## Phase A — protocol layer (shippable)

1. **Core `@sentropic/h2a` (`blockage.ts`)**: pure.
   - `H2ABlockage` = `{ instance, scope, reason, needs?, raisedAt, resolvedAt?, resolvedBy? }`.
   - `blockageEnvelope({ blockage, actor, cleared? })` → signed-able `event` envelope, `body.kind: "blockage" | "blockage-cleared"` (parity with the NHI attestation; reuses `createEnvelope`). Lets a blockage be signed/journalled if a caller wants.
   - `isActiveBlockage(b)` helper (`resolvedAt === undefined`).

2. **Durable registry (cli runtime `runtime/blockage/`)**, mirroring `runtime/drumbeat/registry.ts`:
   - `<root>/.h2a/blockage/<safe-instance>.json`.
   - `raiseBlockage(root, {instance, scope, reason, needs?})` (upsert, sets `raisedAt`, clears any prior `resolvedAt`), `listBlockages(root)`, `readBlockage(root, instance)`, `resolveBlockage(root, instance, {by?})` (sets `resolvedAt`/`resolvedBy`; idempotent).
   - `LocalStorePaths` gains `blockage` (dir).

3. **Notification topics**: add `peer.blocked` and `peer.unblocked` to `H2A_SESSION_NOTIFICATION_TOPICS` (core). The `NotificationDispatcher` diffs the blockage registry each tick and pushes `peer.blocked` (a peer raised/active) / `peer.unblocked` (resolved) to subscribed sessions **in the same scope** (skip the blocked instance's own session). Parallels `presence.peer_joined/left`.

4. **Surface**:
   - CLI: `h2a blockage raise --instance <id> --reason <text> [--scope <s>] [--needs <text>] [--root]`; `h2a blockage list [--scope <s>] [--active] [--root]`; `h2a blockage resolve --instance <id> [--by <id>] [--root]`.
   - MCP tools: `h2a_blockage_raise`, `h2a_blockage_list`, `h2a_blockage_resolve` (mirror the CLI through the same registry).

→ Connected peers on all four hosts (claude/codex/gemini/agy all consume MCP) receive the push immediately.

## Phase B — disconnected-peer delivery (adapter layer)

Mirrors the drumbeat relauncher adapters (DEC-091). The in-repo half — the host config wiring itself is D6/install-time.

- `runtime/blockage/notifiers.ts`: `BlockageNotifier` interface `notify(blockage, peer) → boolean`, behind an injectable `NotifierRuntime` (`run(file,args)` / `note(line)`).
  - `loggingNotifier` (dry-run default).
  - `commandNotifier({ runtime, command })` — wakes a disconnected peer by running a configured per-host wake command (claude wake / codex remote-control / gemini hooks). The template substitutes `{instance} {reason}`.
  - `pollingNotifier` — no-op push; documents the **agy fallback** (agy has no daemon per the capability matrix → its imported plugin polls `h2a blockage list`).
  - `chainNotifier(...)` — first to deliver wins.
- `notifyBlockedPeers(root, notifier, { now })` tick helper: scan active blockages, fan out to the *other* live peers (from presence) that are not connected MCP subscribers. CLI exposure deferred to D6 wiring; the adapter + helper ship now with injected-runtime tests.

## Per-host compatibility (from `docs/plugin-capability-matrix.md`)
- **claude / codex / gemini**: connected → MCP push; disconnected → `commandNotifier` (wake/remote-control/hooks).
- **agy**: connected → MCP push (embeds MCP); disconnected → **polling fallback** (no daemon) — the known gap.

## Testing
- Core: `blockageEnvelope` build + verify round-trip (sign→verify, tamper-detect); `isActiveBlockage`.
- Registry: raise→list→resolve, idempotent resolve, upsert clears prior resolution.
- Dispatcher: a peer raising a blockage pushes `peer.blocked` to a subscribed peer in scope, not to the blocked instance itself; resolve pushes `peer.unblocked`; no duplicate push on a second unchanged tick.
- Notifiers: `commandNotifier` builds the expected argv (fake runtime); `pollingNotifier` is a no-op; `chainNotifier` falls through.
- CLI contract + MCP server tests for the three verbs/tools.

## Out of scope (later)
- The actual per-host plugin config that registers the wake handler (D6 / EVO-1).
- Auto-raising a blockage from `workStatus → blocked` (keep raise explicit, with a reason).

## Consequence
Additive public surface (core `blockage.ts` exports + cli registry/notifier exports + 2 topics + 3 CLI verbs + 3 MCP tools) → minor bump. DEC-092.
