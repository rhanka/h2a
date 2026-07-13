# SPEC_STUDY — Resource governance for local h2a sessions

Rung: **STUDY** — open questions, options, and a recommendation for each. This is not a
committed EVOL and makes no irreversible choice.

## Grounding

The pain is tracked by `01KXC2W2K7TJAYXPA7SYVS3AY1` (parent WP7, “Infra, deploy & MCP”):
the 2026-07-12 incident left about 985 MB free on a 59 GB machine and the OOM killer chose
unrelated processes. This checkout has no cgroup/resource supervisor yet.

The local launch tree is not one uniform process: `h2a run` uses `node-pty` directly
(`packages/h2a-runtime/src/run.ts`, `pty.ts`); managed local runs create a tmux session with
`LOCAL_WRAPPER`, persist a relaunch command and pane (`tmux.ts`); `startH2aWindow` may add an
`h2a mcp-serve` side window; and delegated jobs also use local tmux. `H2ALaunchContext` and
presence record the tmux/pid facts, while `SessionRegistry` heartbeats every 5 seconds and
presence expires after 90 seconds. `lastMcpActivityAt` (normally a 10-minute activity window)
is advisory, not proof that an agent is safe to freeze. Drumbeat has durable stop records and
local-tmux/headless/remote relaunchers, but no resource lifecycle.

Terminology follows WP13: a **session descriptor** is the placeable unit; placement/backend is
`local` or `pod` (and later sentropic-native). “Deport to k8s” means re-place the same session
descriptor, not move a process. The existing control-plane persists descriptors, provisions
Pods through `remote-k8s-orchestrator`, refreshes with resume arguments, and the existing
`migrate.ts` already demonstrates workspace/conversation push-pull. WP13’s finding applies:
PTY live migration is approximately impossible.

## Open questions and recommendations

1. **What is “under h2a governance”?**

   Options: (a) only sessions h2a launched, plus their descendants; (b) every locally
   discoverable presence/pid/tmux pane; (c) a hybrid with explicit adoption of an existing
   session. Presence is an inventory signal, not consent: a pid can be stale or remote, and
   a shared tmux server is not an ownership proof.

   **Recommendation:** start with (a), with an explicit opt-in/adoption path from (c) only
   after proving same-user ownership, exact launch context, and a complete process boundary.
   A governed session must include the CLI, its h2a MCP server/window, and child/subagent
   processes in one owned cgroup. Never freeze, move, or kill a merely discovered process.

2. **Which cgroup mechanism, and what if it is unavailable?**

   Options: (a) direct cgroup v2: an h2a parent slice with `memory.high`/`memory.max` and
   per-session child cgroups, using `cgroup.freeze`; (b) user-owned
   `systemd-run --user --scope -p Slice=… -p MemoryMax=…` scopes, with cgroup v2 for
   inspection/freeze; (c) fallback to RSS polling plus SIGSTOP/SIGTERM, or refuse admission.

   **Recommendation:** prefer (b), backed by a small capability probe, and use (a) only inside
   a delegated user subtree. Put the configurable 36 GB aggregate ceiling on the h2a parent;
   give every session a child scope and use `memory.high` as an early-pressure signal,
   `memory.max` as containment, and `memory.current`/`memory.events` for accounting. The
   launch boundary must own a dedicated tmux server (or otherwise place the server itself in
   the scope); today’s default shared tmux server makes “client scope captures all panes” an
   unsafe assumption. If the probe fails, there is no hard local quota: fail closed to
   refuse-new/deport and only perform best-effort graceful lifecycle actions. RSS/SIGSTOP is
   not an equivalent aggregate quota.

3. **Who enforces the aggregate quota, and what is inactive?**

   Options: (a) sum `/proc` RSS; (b) let only kernel `memory.max` decide; (c) one per-host
   quota manager that samples each child cgroup and applies policy. Over-quota choices are
   freeze inactive, deport eligible sessions to `pod`, or refuse new sessions.

   **Recommendation:** (c). Use each child’s `memory.current` as the authoritative charged
   usage (RSS summing double-counts shared pages), parent usage as the aggregate, and pressure/
   events for hysteresis. The action order should be: refuse-new before harming an active
   session; freeze explicitly paused/standby sessions; deport only sessions with a durable
   descriptor/workspace/resume path; keep the hard parent cap as the last containment wall.
   Define inactive as explicit `workStatus: paused`/standby, or sustained absence of MCP
   traffic beyond a configurable idle grace *and* no attached/recently active human tmux
   client. `heartbeatAt` alone is insufficient; `drumbeat`’s stall heuristic is useful
   evidence but is not a memory policy.

4. **Freeze/standby and presence honesty.**

   Options: (a) cgroup v2 `cgroup.freeze`; (b) SIGSTOP the known process tree; (c) terminate
   and later relaunch. Thaw could be driven by inbox arrival, human attach/input, or an
   explicit resume command.

   **Recommendation:** use `cgroup.freeze` for an owned child scope; reserve SIGSTOP for a
   diagnostic fallback because it races process-tree changes and cannot establish ownership.
   Every wake path (`InboxWakeHandler`, signed `drive`, local-tmux send-keys, attach) must
   thaw first, then inject input. A frozen process must not be reported as a dead session:
   preserve presence but expose a distinct resource standby/frozen condition rather than
   overloading the current `opening|live|draining|closed|expired` lifecycle. The keepalive
   prober may refresh `heartbeatAt` from a live pane even while MCP is frozen, so the quota
   manager must suppress drumbeat relaunch and routing as “active” until thawed. This is a
   presence-honesty seam, not a cosmetic status field.

5. **What does deport-to-k8s mean for a running local session?**

   Options: (a) live process/PTY migration; (b) checkpoint context/workspace, stop local,
   and re-instantiate the descriptor with backend `pod`; (c) start a fresh remote session
   without continuity.

   **Recommendation:** (b), reusing WP13’s placement seam and the existing control-plane/
   `remote-k8s-orchestrator`. Before stopping local, capture the descriptor, current CLI
   session/resume id, workspace state, and required auth/capabilities; provision the Pod,
   wait for announce/ready, then stop the local cgroup with reason `policy-evict` or
   `policy-deport`. If workspace/conversation checkpointing or remote capacity is not
   proven, do not deport automatically: freeze or refuse-new. Never describe this as live
   migration.

6. **Graceful stop, relaunch, and stop reason.**

   Options: (a) kill the largest process when pressure rises; (b) one generic “stopped” path;
   (c) an ordered, reason-aware lifecycle. Victim selection can be LRU-by-inactivity,
   largest usage, or a weighted combination.

   **Recommendation:** (c) with at least `user-stop`, `policy-evict`, `crash`, and `OOM`
   (plus `policy-freeze`/`policy-deport` as lifecycle causes). Transition to `draining`,
   persist launch context and resume/checkpoint facts, request graceful exit, wait a bounded
   interval, then signal only the owned cgroup; record whether escalation was needed. A
   user-stop must not auto-relaunch. Crash/OOM may relaunch under a capped policy; policy
   eviction should remain dormant until quota permits or a wake/placement decision occurs.
   Select only inactive victims: oldest inactivity first, then largest `memory.current` to
   reclaim enough space; never use largest RSS alone. Extend the durable drumbeat stop record
   so it does not collapse policy eviction, crash, OOM, and user intent into today’s generic
   `stopped` finding.

7. **Configuration surface.**

   Options: an environment variable, a CLI flag, or a persisted per-host config. A single
   global value is simple but unsafe across machines.

   **Recommendation:** default the local h2a aggregate to **36 GB**, overrideable per host
   by a CLI flag and environment variable (flag > env > host config > default), with explicit
   units and validation. Candidate names are `--local-memory-max` and
   `H2A_LOCAL_MEMORY_MAX`; the exact names and GB-vs-GiB interpretation remain EVOL work.
   The quota applies only to the owned h2a parent, never the whole user slice, and must leave
   non-h2a GNOME/system headroom.

## Highest-risk assumption and honest blocker

**Single highest-risk assumption:** a freshly launched local session can be placed in a
user-owned systemd/cgroup-v2 tree that contains the CLI, the h2a side window, the dedicated
tmux server, and every child process, while the manager can freeze/thaw that tree without
root. The current host proves cgroup v2 and user-owned child-scope files, but the user service
parent is not delegated and the current launcher uses a shared tmux server. This needs a
one-host capability/containment proof before EVOL.

The operation most likely to require privileges we do not have is creating or modifying a
parent cgroup outside the delegated user subtree, enabling controllers there, attaching
already-running/shared-tmux PIDs, or freezing/killing processes not owned by an h2a scope.
On this host `/user.slice/user-1000.slice/user@1000.service` is root-owned for key parent
controls, reports unlimited `memory.max`, and already shows 26 cgroup OOM kills. If user
systemd scope creation or delegation cannot provide the required boundary, the honest blocker
is **no hard local quota / no arbitrary adoption**, not a pretend RSS-and-SIGSTOP substitute.

## Double-consensus reconciliation (Opus 4.8 + gpt-5.5, 2026-07-13)

**Verdict (both legs): GO as a STUDY, NOT EVOL-ready.** Both agree the single gate before EVOL is
an **EXECUTABLE cgroup capability/containment PROBE** — "without that, the rest is policy fiction."

**Lot 0 (the gate) — the probe must be an acceptance test, not prose.** It must PROVE, on this host,
without root: (a) `systemd-run --user --scope -p MemoryMax=…` creates an *enforcing* cgroup (the memory
controller is delegated to the user subtree); (b) a dedicated tmux server + panes + CLI + h2a MCP
side-window + all descendants are charged to the intended child cgroup; (c) `memory.current` /
`memory.events` / OOM attribution work; (d) exceeding `MemoryMax` throttles/kills ONLY the governed
scope; (e) `cgroup.freeze` is writable and thaw works; (f) the quota-manager itself runs OUTSIDE the
cap and survives a child OOM. The 26 existing cgroup OOM kills are NOT proof of any of this. Its result
DECIDES the whole WP: enforce a hard 36 GB cap, or fall back to graceful-only + refuse-new/deport.

**Must be addressed before EVOL (folded from both legs):**
- **System-wide pressure**, not only the 36 GB h2a aggregate: react to `MemAvailable` / global PSI /
  swap pressure (else h2a stays "under quota" while the host OOMs — the actual 2026-07-12 failure mode).
- **`memory.high` = reclaim/throttle, not eviction** — can make an agent appear *hung*; the manager
  must act at a pre-high threshold with hysteresis, not treat `memory.high` as the eviction lever.
- **Manager survivability** — it must live OUTSIDE the governed cap (a protected control scope), or
  parent `memory.max` kills the very component that recovers; + startup **reconciliation** (rebuild
  cgroup/frozen/draining state after a manager crash) and a **leader lock** (concurrent `h2a run` must
  not start competing managers).
- **Hard-cap partial-kill** — bare `memory.max` OOM can kill an arbitrary pane/subprocess and corrupt a
  session while presence still says live: need `memory.oom.group` + per-session scopes + an OOM policy.
- **Frozen-tmux wake** — if the tmux server is inside the frozen scope, `attach`/`send-keys` blocks
  until thaw, so wake detection/thaw MUST be driven by an external manager/wrapper, never the frozen
  server.
- **"Inactive" is unsafe as a heuristic** — a long build/test/model job has no MCP traffic and no human
  attached yet is NOT idle. Auto-freeze/evict requires EXPLICIT `paused`/standby or a lease expiry, not
  idleness inference.
- **Victim selection needs reclaimability, not charge** — `memory.current` counts file cache that won't
  free anon memory; use `memory.stat` (anon/file/kernel/swap) + PSI to pick a victim that actually
  reclaims.
- **Deport split-brain** — "provision pod, wait ready, then stop local" can run two live placements on
  one descriptor/inbox: need a **placement epoch / exclusive lease** (drain+checkpoint local → acquire
  lease → start remote), reusing WP13's placement seam.
- **Adoption plan for the ~23 existing live sessions** — inventory-only for discovered sessions; govern
  only via manual relaunch into a governed scope; never adopt a shared-tmux session without full
  provenance + process-boundary proof.

Next: Lot 0 probe (buildable, cheap — delegate to 5.6-luna) → its result gates EVOL. No commitment yet.
