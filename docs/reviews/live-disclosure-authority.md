---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 8f4b1fb4881387e8deee822466ca5cb741159c45
observed-failure: >-
  Exact author model/effort are not exposed in this session. The prescribed
  installed h2a/mesh reviewer launch is forbidden by the owner's confinement.
  No reviewer was launched and no independent consensus is claimed.
---

# Live disclosure authority qualification — Tour 2

Reference: rhanka/engram e417c33c, plan/09 Δ-L7a/L8/G4,
SPEC_LIVE_GIT_INDEXING §§8–10, 12 and Read side (2026-10-17).
This revision addresses all five findings in the owner's rev367 review.

## Exclusions and batch integrity

The independent L4b-2 floor now includes all five normative secret rules:
AWS access keys, GitHub tokens, private-key blocks (including digits and
multiple algorithm words), credential assignments and credentialed URLs.
The existing additional sk-token protection remains. There are no word-boundary
anchors that would hide tokens when fragments concatenate. Every fragment
and the complete concatenation pass both the deterministic floor and the
mandatory host policy; composed origins are preserved for that policy.

Protected paths include the .env prefix, .pem/.key suffixes, id_rsa/id_dsa/
id_ecdsa/id_ed25519, credentials.json, secrets.json, service-account.json,
the secret/secrets/credentials segments, and secret-bearing path text.
Existing stricter .ssh/.p12/.pfx/case-insensitive exclusions remain. Explicit
consent never overrides exclusions or withheld provenance.

Every returned evidence fragment carries its host evidenceId. All requested
IDs must be represented, and unrequested IDs are refused even at equal counts.
Several fragments may belong to one requested ID; an incomplete composed batch
never reaches transport. Evidence and the copied request are frozen.

## Atomic emission boundary

A sequence of independently mutable screen/check callbacks cannot establish
atomicity. The final handoff therefore requires acquireEmissionSnapshot: a
host-owned coherent read transaction covering both verified proofs and their
revocation/trust, declaration/latest state, independent read permission,
policy decisions for each fragment and their concatenation, time and actual
provider routing. Its lease must fence all relevant writers, including
reentrant audit callbacks, until synchronous send returns. The send method
must be bound to the snapshot's provider; later unguarded routing is forbidden.

The authority validates only copied snapshot data, records emit-attempt after
all final refusals, checks local reentrant grant revocation and immediately
hands the same frozen texts to the leased send method. It never calls mutable
auth/read/policy/route/clock ports again on the successful handoff path.
The lease ends at synchronous handoff; awaiting delivery does not hold it.
Missing or failed snapshot acquisition returns authority-unavailable; there
is no legacy unlocked fallback. Host policy acquisition failures remain
policy-unavailable, route/send failures transport-failed. A release failure
is contained and may be reported after an already-audited handoff: an attempt
receipt is never a delivery acknowledgement.

The isolated test host owns and fences its temporary in-memory state. Tests
prove that state/clock/policy/read/route/proof changes during audit are refused,
and that no mutable ports are consulted between snapshot validation and send.
The production host adapter is not implemented or qualified here. As before,
G4 remains closed with policy-unavailable until the actual L8 contract exists;
it does not substitute caller booleans for publication authority.

## Authentication and audit

Only registered Ed25519 host proofs with the live audience may grant/revoke/
emit. Session/enrollment/read access never creates disclosure authority.
Authentication precedes grant lookup, so unverified callers cannot probe IDs.
Refusal receipts correlate known opaque grant IDs, including denied revokes.
A revoke still verifies proof validity, trusted owner/host/tenant, signed
repository and revoke operation; declaration/root/policy evolution does not
prevent the same owner from revoking. Foreign repository requests are rejected
before readState is consulted. Revocation remains effective if audit fails.

Audit requires durable synchronous append. No content, path, proof or raw
exception enters receipts. Grants/proofs are memory-only and restart denies
old IDs. No snapshot archive or content cache is introduced.

## Verification

Three targeted files only: gateway-host/live-auth.test.ts (15),
live-disclosure.test.ts (132), live-registration.test.ts (23).
Linux Node 22.22.1 and 24.18.0: **170/170 each, zero skipped**, exit 0.
verifyRuntimeExecution accepts both reports with zero proof failures. The
previous four same-named secret cases now have unique parameterized names;
this fixes the observed execution-not-proven CI failures without changing gates.

Replaying the new tests on the pre-fix rebased source produces **65 behavioural
failures, 105 passes, zero skips** (exit 1). This includes every reported race,
missing exclusion, evidence mismatch, refusal/audit and revoke regression.
The baseline execution proof additionally rejects three duplicate identities.
Strict explicit test typecheck and npm run typecheck exit 0; git diff --check
exits 0. Compiler annotation errors were fixed separately and are not RED proof.
The G4 test compiles into a disposable directory and probes a separate Node
process without reading installed h2a or owner state. Test HOME/XDG/TMP roots
are temporary; no provider call, Python, installed h2a or third-party process.

## Unverified boundaries

- Production snapshot transaction/fence and complete L7a identity/key custody,
  declaration/read adapters and durable audit backend await host integration.
- L8 publication policy and actual MCP/provider wiring remain unavailable;
  G4 stays closed. Storage/key/SQLite/WAL/Postgres/web lifecycles are outside scope.
- No full local suite, local macOS/Windows run, real provider, independent peer
  consensus or owner UAT. Per-job CI results belong in the requested owner report.
- First-tour hook bypass was replaced before its original push. Tour 2 commits
  use the configured hooks, conventional English subjects and no attribution.
