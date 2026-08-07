# Feature: native multi-session terminal host foundation

## Objective

- [x] Establish a typed, bounded terminal replay contract for a single-process multi-session PTY host.
- [x] Prove a persistent local transport, independent real-PTY lifecycle and fail-closed controller arbitration without changing the tmux default.

## Scope / Guardrails

**Allowed Paths (implementation scope)**

- [ ] `BRANCH.md`
- [ ] `docs/specs/2026-08-06-SPEC_EVOL_native-multisession-terminal-host.md`
- [ ] `docs/reviews/native-terminal-host-lot1.md`
- [ ] `packages/h2a-runtime/src/native-terminal/**`
- [ ] `packages/h2a-runtime/src/pty.ts` (BR178-EX1)
- [ ] `packages/h2a-runtime/src/index.ts` (BR178-EX2)
- [ ] `.github/workflows/ci.yml` (BR178-EX3)
- [ ] `docs/reviews/pr178-native-terminal-*.md` (BR178-EX4)
- [ ] `packages/h2a-runtime/src/run.test.ts` (BR178-EX5)
- [ ] `packages/h2a-runtime/src/run-ws-surface.test.ts` (BR178-EX5)

**Forbidden Paths (must not change)**

- [ ] `.track/**`
- [ ] `package.json`
- [ ] `package-lock.json`
- [ ] `Makefile`
- [ ] `docker-compose*.yml`
- [ ] `.cursor/rules/**`
- [ ] `packages/h2a-runtime/src/tmux.ts`
- [ ] production terminal backend call sites

**Conditional Paths (require a recorded BRxx-EXn exception)**

- [ ] `packages/h2a-runtime/src/index.ts`
- [ ] `packages/h2a-runtime/src/run.ts`
- [ ] local-server transport and supervision files

**Recorded scope exceptions**

- [x] **BR178-EX1 — `packages/h2a-runtime/src/pty.ts`:** expose the real PTY PID for lifecycle/process-attribution proofs and use `createRequire(import.meta.url)` so the existing lazy `node-pty` load works from emitted ESM. Impact is additive to the internal `PtyHandle`; rollback removes the PID from the new native host state.
- [x] **BR178-EX2 — `packages/h2a-runtime/src/index.ts`:** export the native host client/supervisor seam so the existing local server can own one supervisor in a later opt-in wiring lot. No CLI route or tmux call site changes; rollback removes the exports.
- [x] **BR178-EX3 — `.github/workflows/ci.yml`:** execute the native-terminal unit, socket-integration and Linux real-PTY functional suite in both supported CI Node jobs. Impact is one focused Vitest invocation per build-and-test matrix leg; rollback removes that single step.
- [x] **BR178-EX4 — `docs/reviews/pr178-native-terminal-*.md`:** retain the exact-target two-leg consensus dossier required before readiness. Impact is review evidence only; rollback removes the three PR-specific review artifacts.
- [x] **BR178-EX5 — `packages/h2a-runtime/src/run.test.ts`, `packages/h2a-runtime/src/run-ws-surface.test.ts`:** keep existing `PtyHandle` test doubles type-correct after BR178-EX1 made the real PTY PID part of the internal handle contract. Impact is two inert fixture fields; rollback removes them with BR178-EX1.

## Plan / Todo (lot-based)

- [x] **Lot 1 — sequenced bounded replay**
  - [x] Add `replay-buffer.ts` with monotonic session-local sequence assignment and a strict byte budget.
  - [x] Add `replay-buffer.test.ts` for ordered replay, eviction gaps, oversized chunks and invalid cursors.
  - [x] Gate: focused replay tests and runtime TypeScript check pass.
- [x] **Lot 2 — independent multi-session PTY lifecycle**
  - [x] Add host create/list/stop lifecycle over injected `PtySpawner` without transport or daemon logic.
  - [x] Add host tests proving two PTYs have independent output, exit and stop state.
  - [x] Gate: focused host tests and runtime TypeScript check pass.
- [x] **Lot 3 — controller epoch and versioned contract**
  - [x] Add single-controller acquisition with an incrementing epoch and observer-only attachment.
  - [x] Reject stale input and resize epochs through an in-process typed contract.
  - [x] Gate: focused native-terminal tests and root typecheck pass.
- [x] **Lot 4 — persistent private local host transport**
  - [x] Add a bounded versioned JSON-lines protocol over a private Unix socket (`0700` parent, `0600` socket).
  - [x] Add a persistent client and connect-or-start supervisor that coalesces concurrent callers and reconnects to the same host generation.
  - [x] Bind controller leases to the owning connection and release them on disconnect without stopping PTYs.
  - [x] Add a separately executable Node host process using the real `node-pty` spawner.
- [x] **Lot 5 — local execution evidence**
  - [x] Execute two real shell PTYs in one host and prove independent replay/input/exit.
  - [x] Disconnect/reconnect the client and prove the host PID and PTY PIDs remain stable with one host spawn.
  - [x] Stop one PTY without affecting the other, then crash the host and prove its remaining PTY disappears.
  - [x] Gracefully stop the host and prove bounded TERM→KILL drain of a non-cooperative PTY, code-0 exit, socket removal and a distinct next generation.
  - [x] Race two supervisors against one socket and prove convergence on one host without repeated spawns.
  - [ ] Gate: full root suite and CI pass on the final commit.
- [x] **Lot 6 — first-consensus lifecycle and security hardening**
  - [x] Make controller-owned stop truthful and repeatable so `TERM` can escalate to `KILL`, while observers remain read-only.
  - [x] Bound retained sessions, recycle exited IDs, validate signals and add deadlines to every client request.
  - [x] Validate socket parent/socket UID, type and exact modes; publish the canonical Unix socket atomically and guard cleanup by inode identity.
  - [x] Bound startup retries with backoff and retained stderr diagnostics so repeated host failures cannot create a Node spawn storm.
  - [x] Add unit/socket tests plus Linux real-PTY execution tests for multi-session lifecycle, stop escalation, host crash, restart convergence and startup backoff.
  - [x] Gate: native-terminal `4 files / 23 tests`, historical PTY-double `2 files / 6 tests`, runtime typecheck, compiled default-spawn smoke, security audit, package dry-run and isolated full root suite pass locally.
- [x] **Lot 7 — exact-target protocol, incarnation and replay hardening**
  - [x] Strictly parse response version/discriminants before pending-state mutation and contain malformed-frame failures to one connection.
  - [x] Bound invalid response IDs/messages and prove an exact 33,554,432-byte invalid request cannot kill the host or an active real PTY.
  - [x] Add a server-minted session incarnation to state, replay, observer and controller contracts so exited-ID reuse cannot resurrect a stale connection lease.
  - [x] Bound replay by payload bytes, serialized wire bytes and retained chunk count; expose `latestSeq` without materializing replay.
  - [x] Add deterministic fragmented-output transport coverage plus a two-connection/two-real-PTY recycled-ID test covering stale write, resize, release and stop.
  - [x] Reap supervisor-owned children that miss readiness with bounded TERM→KILL before backoff/replacement; leave adopted hosts unsignalled.
  - [x] Bound accepted connections and pending response count/bytes per connection and globally; drop only the slow peer on backpressure.
- [ ] **Lot 8 — fatal ownership and publication-race closure**
  - [x] Put each Linux PTY workload behind one non-Node guardian with a kernel parent-death signal and process-group TERM→KILL forwarding; fail closed if the fixed `setpriv` boundary is unavailable.
  - [x] Reap a distinct supervisor-owned startup loser before adopting a healthy winning host, then prove later replacement remains possible.
  - [x] Serialize legitimate socket publishers/closers with a private crash-released Linux abstract-socket lock and verify staged/published inode identity.
  - [x] Add real-process regressions for a HUP/TERM/INT-resistant PTY tree after hard host death and forced reaping, losing-child adoption, and competing publication over a stale socket.
  - [ ] Gate: native-terminal `4 files / 36 tests`, historical PTY-double `2 files / 6 tests`, typecheck, compiled default-spawn/adoption smoke, security audit, full root suite, CI and fresh two-leg consensus all pass on the final target.

## Feedback Loop

- [x] Owner explicitly authorized the private local socket and separately supervised host process in this PR; default-backend cutover and Greywall enforcement remain forbidden.
- [x] Record every required out-of-scope path as a BRxx-EXn exception with reason, impact and rollback.
- [ ] Re-run two independent native Codex consensus legs on the final exact target before marking this PR ready.
