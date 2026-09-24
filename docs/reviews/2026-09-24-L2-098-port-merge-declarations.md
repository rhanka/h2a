# L2 0.98 port — merge-request declarations (written 2026-09-24, context-fresh)

Branch `port/mcp-pagination-identity-098` ports two MCP fixes onto the 0.98 line (base `ec27026e` "release: v0.98.0"): L1 pagination (`4381d5b6`) and L2 identity two-phase activation (`94502e25`). It is PUSHED, not merged — 0.98 is push-only under owner policy. When a merge request is eventually raised it MUST carry BOTH declarations below, explicitly. A known limit written the day of costs a tenth of one rediscovered at review.

## 1. PUBLIC CONTRACT CHANGE — name it, do not bury it in a port
On the 0.98 branch ONLY, `IdentityFailureCode` gains `messaging_backend_failed` (factory/import/principal/backend preparation failures now carry this typed cause in `h2a_identity_status` and guarded-tool identity-failure responses; key-read failures keep `identity_storage_failed`). This changes the `h2a_identity_status` output contract and the `docs/contracts/golden/mcp-tools.json` golden (55 tools: L1 +`h2a_read_payload` → 54, L2 +`h2a_identity_status` → 55). No consumer is affected today (0.98 is unpublished; we push, not merge) — but a port that changes the public contract is no longer just a port. It must be named in the merge request, not discovered at review.

## 2. CANARY criterion 4 — validated in LOOPBACK only
The L2 canary (2026-09-24, PASS 5/5) validated mesh send/receive over a LOOPBACK/HTTP mesh (the `mcp-mesh-activation` harness), NOT a live cluster-mesh endpoint (none was configured).
- ESTABLISHED: the mesh binds on the FINAL identity signer; an outbound signed delivery is accepted by the peer VERIFIER; a signed inbound reaches the sidecar inbox and invokes the wake driver.
- NOT ESTABLISHED: acceptance of those signatures by a real REMOTE peer over a live endpoint. For a feature whose purpose is the mesh, this is PARTIAL coverage — live-remote-peer acceptance must be validated before/at production deployment.

## Known limits already recorded (carry them too)
- Shutdown in-flight drain can persist + ACK after shutdown — pre-existing 0.98, deliberately OUT of this port's scope (opus55 scope governs; the cluster-mesh adapter contract is unchanged). Deferred: Track `01M38WKD2MREEF18WVQBQCXTPQ`.
- The canary ran on a fresh SCRATCH bus: it validates the two-phase CORRECTION (registry-size-independent logical properties), it does NOT measure the production regime; the `messaging_bind` span (23.780 ms) is off-scale there and does NOT inform OQ-3 (the ~17 MB registry read/parse hypothesis). OQ-3 is measured only in the threshold-triggered paired capture (still due). Track `01M38NYH7X3TVBV5TA4KJS3Q8W`.

## Technical status
Pushed; cross-family review clean (no MUST-FIX, 4 nits); canary 5/5 with the two limits above. Nothing technical outstanding — held by owner policy on 0.98 (push-only), not by a gap.
