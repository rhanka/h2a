# L2 0.98 port — merge-request declarations (written 2026-09-24, rebased 2026-10-02)

Branch `port/mcp-pagination-identity-098` carries the 0.98 line rebased onto main 0.97.11 (`5a3eec57`): cluster-mesh 0.13.0, the cluster-mesh send backend with verified receive, the two-phase mesh activation on main's deferred identity, and release 0.98.0. L1 pagination and the L2 deferred identity are main's own (`4be46caf`, `02c69dbb`, then #288/#289/#291/#292); the former L1 port is dropped and the former L2 port is reduced to the activation commit. It is PUSHED, not merged — 0.98 is push-only under owner policy. When a merge request is eventually raised it MUST carry BOTH declarations below, explicitly.

## 1. PUBLIC CONTRACT CHANGE — name it, do not bury it in a port
On the 0.98 line ONLY, `IdentityFailureCode` gains `messaging_backend_failed` (factory/import/principal/backend preparation failures now carry this typed cause in `h2a_identity_status` and guarded-tool identity-failure responses; key-read failures keep `identity_storage_failed`). The cause is PERMANENT: main's bounded on-demand retry (#291) re-attempts `identity_timeout` only. The MCP tool surface is main's (60 tools) and `docs/contracts/golden/mcp-tools.json` is unchanged versus main; the dispatch help golden changes only by the two ` [--backend local|cluster-mesh]` usage flags (+62 bytes). No consumer is affected today (0.98 is unpublished; we push, not merge) — but the cause must be named in the merge request, not discovered at review.

## 2. CANARY criterion 4 — validated in LOOPBACK only
The canary was re-run on the rebased line (canary PASS 2026-10-02 — P1 deux phases présentes et ordonnées, P2 un seul binding après aller-retour, P3 mutation 60→55 rouge à la l.88 ; pass=13, loopback) over a LOOPBACK/HTTP mesh (the `mcp-mesh-activation` harness), NOT a live cluster-mesh endpoint (none was configured).
- ESTABLISHED: the mesh binds on the FINAL identity signer; an outbound signed delivery is accepted by the peer VERIFIER; a signed inbound reaches the sidecar inbox and invokes the wake driver.
- NOT ESTABLISHED: acceptance of those signatures by a real REMOTE peer over a live endpoint. For a feature whose purpose is the mesh, this is PARTIAL coverage — live-remote-peer acceptance must be validated before/at production deployment.

## Known limits already recorded (carry them too)
- Shutdown in-flight drain can persist + ACK after shutdown — pre-existing 0.98, deliberately OUT of this line's scope (the cluster-mesh adapter contract is unchanged). Deferred: Track `01M38WKD2MREEF18WVQBQCXTPQ`.
- The 2026-09-24 canary ran on a fresh SCRATCH bus: it validates the two-phase CORRECTION (registry-size-independent logical properties), it does NOT measure the production regime; its `messaging_bind` span (23.780 ms) is off-scale there and does NOT inform OQ-3 (the ~17 MB registry read/parse hypothesis). OQ-3 is measured only in the threshold-triggered paired capture (still due). Track `01M38NYH7X3TVBV5TA4KJS3Q8W`.
- Drive consent between distinct roots over the mesh: not covered.

## Technical status
Rebased per design v3.1: static gate, lockfile content gate, focused suites and canary green on the rebased line (canary PASS 2026-10-02 — P1 deux phases présentes et ordonnées, P2 un seul binding après aller-retour, P3 mutation 60→55 rouge à la l.88 ; pass=13, loopback). Held by owner policy on 0.98 (push-only), not by a gap.
