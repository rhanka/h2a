# VOL — h2a_run tmux session cleanup

## Evidence

`h2a_run` invokes the structured `h2a run` path, not `delegate`. Its agent
pane exits through `STRUCTURED_LOCAL_WRAPPER`; interactive runs also create an
`h2a mcp-serve` sidecar window, which keeps the enclosing tmux session alive.
Headless delegate runs do not leak because their wrapper writes `result.json`
and then exits their only session pane.

## Decisions

1. The canonical MCP bridge emits an internal `--h2a-run-worker` marker. The
   runtime persists that marker before the worker begins. No reaper infers
   ownership from a session name, profile, background class, or registry row.
2. Marked interactive workers use a dedicated structured wrapper. On worker
   exit it kills its own exact tmux session, so the sidecar exits too.
3. `h2a run reap` is a manual crash/unknown-launch backstop. It requires the
   marker, the existing idle-shell witness, and the existing two-sample,
   generation-guarded no-descendant liveness proof. Any unreadable, changed,
   busy, or idle-at-composer worker is retained.

## Scope limit

The reaper intentionally cannot reclaim pre-marker sidecar-only zombies: their
agent pane has already ended, so the evidence is indeterminate. Deterministic
cleanup prevents that primary leak for all new h2a_run workers.

## Adversarial review reconciliation

Two independent reviews agreed that post-launch MCP attestation is too late for
timeout/unknown launches and that the session's selected pane can be the
sidecar. The retained design therefore stamps ownership before worker startup,
uses the recorded agent pane for liveness and keeps any unmarked or
indeterminate session.
