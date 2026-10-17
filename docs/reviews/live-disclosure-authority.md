---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: da1446321cf3eecd5c9678583c7e0623b2cc2b7a
observed-failure: >-
  Exact author model/effort are not exposed in this session. The prescribed
  installed h2a/mesh reviewer launch is forbidden by the owner's confinement.
  No reviewer was launched and no independent consensus is claimed.
---

# Live disclosure authority qualification

Reference: rhanka/engram e417c33c, plan/09 Δ-L7a/L8/G4 and
SPEC_LIVE_GIT_INDEXING §§8–10, 12 and Read side (2026-10-17).

The new disclosure authority verifies registered Ed25519 host proofs with a
separate live audience. Trust records, revocations and current declarations
are injected host ports; missing inputs deny. Explicit grant calls bind one
opaque clone identity, provider, exact source paths, output surfaces and an
exclusive expiry bounded by the issuing proof. Activation, enrollment,
sessions and read/MCP access never mint grants. No signing key is created here.

An independent verified read gate is required before loading evidence and
again at handoff; missing, denied, throwing or revoked read authority refuses.
Every emission reloads host evidence, including warm-cache provenance, and
rechecks both the issuing proof and the emission proof. All composed origins
must fit one grant. Current declaration/policy/latest-state revisions, L4b
withheld provenance, protected paths and mandatory host secret policy are
checked before handoff. Known-token scanning is additional defence only.
The synchronous transport handoff is the tested boundary; later routing or
fallback must obtain a separate authorization for its actual destination.

Audit append is synchronous and fail-closed, with opaque grant/event IDs and
constant refusal codes. `emit-attempt` does not assert delivery. Refusals
correlate only known host-minted grant IDs. Content, paths, exceptions and
proofs never enter receipts. Grants/proofs stay in memory; restart loses all
grants and denies old IDs. No content cache or snapshot archive is created.
The injected audit sink must provide durable append; the test exercises a
flushed temporary file, not a production host receipt backend.

Behavioural RED evidence: initial auth 14 failures and initial disclosure 39
failures. Additional real regression failures preceded fixes for final-policy
latest-state replacement, async audit acceptance, throwing clock, revoked
issuing proof with fresh emission proof, grant start-time rollback, and
independent read authority missing from emission, and late provider redirection.
Compiler/test-type failures were also fixed; they are not behavioural RED proof.

Targeted qualification: auth (14), disclosure (53), registration (23), all
90 passing on Linux Node 22.22.1 and Node 24.18.0 with zero skips. The disclosure
file compiles the consumer into a temporary installation and runs it in a
separate Node process; absent L8 returns `policy-unavailable` before any
evidence/transport port. Repository and explicit strict test typechecks pass.

## Unverified boundaries

- L8 publication policy is absent in the supplied sentropic checkout. G4 is
  deliberately closed; no caller-supplied allow flag substitutes for it.
- Full installed L7a supervision, actual identity/key custody, production
  declaration/latest-state and audit adapters, L4b storage/key lifecycle, and
  application MCP/provider wiring await their owning integration lots. The
  existing registration default remains unverifiedLocalLiveAuthority.
- No actual provider call, Postgres/web publication, full local suite,
  macOS/Windows qualification, independent peer consensus or owner UAT.
- First commit invocation disabled hooks temporarily; that commit was replaced
  using a normal amend with the configured hooks, and every retained commit
  used the normal hook path. No hook or guard file was changed.
