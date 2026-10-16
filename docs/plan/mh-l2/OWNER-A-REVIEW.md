---
status: selection-failed
target-ref: 9f34f124593f43c9025ed73f8b6be8b4a10aba0e
base-ref: 642a82f9
target-branch: feat/0.98.7-mh-l3
review-author:
  host: codex
  model: unknown-exact-model
  effort: unknown-exact-effort
observed-failure: Owner confinement forbids installed h2a/real-host review dispatch; exact author model and effort are not exposed. No independent reviewer was launched and no consensus verdict is claimed.
---

# Owner A — independent amendment review handoff

The owner explicitly requires independent re-review of the MH-L2 amendment
before MH-L3 continues. The conductor must dispatch eligible confined reviewers
using its known author/launch metadata. This author cannot infer an exact model
or effort from the CLI and cannot use installed h2a to select or contact peers.
This dossier records the missing gate; it is not an independent review.

Review the complete amendment range `642a82f9..9f34f124`. The contract change is
separate from implementation and proof commits. Final qualification receipts are
in `OWNER-A-QUALIFICATION.md` and `evidence/owner-A-*`; later documentation/proof
commits do not change this code target.

Suggested independent lenses:

| Lens | Required scrutiny |
|---|---|
| Authorization/provenance | Connection-bound request, complete source/target markers, selected image/precheck, canonical ACTIVE/DELEGATED H4 journal, private receipt/ticket and possession MAC; invalid/stale tuples must not grant mutation. |
| Irreversibility/ownership | Durable PUBLISHED before FROZEN→TRANSFERRING, fsync uncertainty/reconciliation order, no reopen on marker contradiction/expiry/pause, exact checkpoint and acquired G1 owner/control tuple, independent G0 operation rights. |
| Integration/regression | Real packaged old central, large reply after publication while the distinct G1 peer admits work, source-only drain/reconciliation after publication, G1 marker/presence/control/work preserved, no public stepId collision, final target/entry/precheck revalidation, cold path and existing L2/L4 guards on both Node profiles. |

The .7 product has no live authorization producer, publication strategy, target
acquisition/restoration or semantic compatibility verifier. The conformance peer
supplies private fixtures. MH-L3 logical shim, evidence consumption, transfer and
M21 remain to implement after this gate; this amendment's real-source test does
not claim M21 or an actual .7→.8 release transition.

The initial broad reference search exposed an unrelated duplicate declaration in
`dispatch-characterization-goldens.test.js` and obsolete runtime-only starter
mocks. Command-name-only matches were excluded from the corrected module-path
gate. `central-mcp.test.ts` is restored exactly to the base. Only the directly
referencing historical `central-mcp-0980.test.ts` fixture is adapted; its exact
project-byte, metadata and Git-status assertions are retained. The conductor's
full-suite integration gate remains required; these observations are not hidden
behind a local-green claim.

The optional legacy `mcp-central.test.js` supplement has no changed-module
reference and retains a v1 HTTP-reclaim oracle contrary to the frozen v2
process-authority contract. Its interrupted run is retained, including the exact
own-worker PID/PPID/startTime stop receipt. Actual module references and all
existing L2/L4 files remain in the required gate. Attachment startup/wake/SDK
diagnostic failures are retained separately; see qualification for the precise
profile, commands and final status. No timeout or v2 guard was weakened.
