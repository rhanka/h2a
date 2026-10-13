# Identity lock recovery 0.98.6 — FINAL v6, A + B

Branch: `fix/0.98.6-identity-lock-recovery`.
Base: `e3fc1a52` (0.98.5); first attempt: `4c5c6596`.
Owner decision D1 = B: provenance recovery and bounded independent recovery
of canonical epoch-bearing legacy binding locks ship together.

## Scope

- Identity v2/v4/legacy discrimination, qualified death proofs and per-link authorization.
- Existing succession election, durable repair before retiring the original generation.
- Durable possession receipts, exclusive binding CAS slots and roll-forward of all relevant slots.
- Complete-line readers, bounded monotone waits and safe release/exit behavior.
- Identity operator and cull verifier use the common fence; destructive cull stays disabled.
- MCP contention IPC, parent diagnostic HMAC, retry conditions and current/previous attempt handling.
- Test-only isolated builds, real-process concurrency, legacy producer and private reboot simulations.

Upgrade keeps its 0.98.5 serializer, classifier and default election bindings.
No dependency or version range change, installed h2a invocation, main mutation,
force-push, generic GC or public anchor/inventory spoofing option.

## Verification

Run only named test files with `test/helpers/identity-isolated-run.mjs`.
The runner builds repository sources into mkdtemp, uses temporary XDG/H2A roots,
and enforces a checked guard against production state and unowned PIDs.
Reboot/procfs and capability fixtures remain outside src/dist/package exports.
Typecheck runs in that same source copy via `identity-isolated-typecheck.mjs`.
The conductor owns the full integration suite and release cut.

## Release gates still external

Native B qualification on an isolated initial-namespace CI host/KVM lab,
power-loss images reconstructed from synchronized writes, full R8+B9 matrix,
Darwin/Windows native qualification, and independent final re-review are not
inferred from scoped green tests. The build report records exact commands,
outputs, simulations and remaining qualification gaps. A+B has no release GO
until the FINAL v6 B10 gate is satisfied.

## Release candidate round 6

Owner scope: F1–F10 and interrupted PTY teardown. Tests use private temporary
HOME/XDG roots, owned processes only, and named files until the explicit final
`npm test` integration exception (at most two runs). No installed h2a, main
changes, dependency version changes, Python, merge, tag or publication.

- PTY reincarnation waits for the observed exit within the product stop bound.
  Teardown discovers created trees before host death, kills entire groups, and
  verifies no live descendant; fault-injected failure and timeout are qualified.
- Legacy predicate regressions cover Threads: 1, hostname/collection, inode
  protections, time namespaces, and exact civil-date/boot agreement margins.
- Published 0.98.5 `identity unlock` races the candidate in both election orders
  through the real exclusive filesystem publication, using a private npm prefix.
- The isolated typecheck creates a fresh source lane and preserves npm workspace
  dependency resolution; a previous test run is no longer a prerequisite.
- The four runtime placeholders are declared non-tests alongside the 38 Node
  placeholders. Their exact identities, statuses and continued presence are
  required by the execution gate; none is claimed as coverage.
- Native qualification records real initial procfs anchors and owned PID churn.
  A global NSpid census over unowned processes, suspend/KVM and physical power
  loss remain outside this confinement; B10 is not inferred from partial evidence.

The external round-6 report preserves every command/output, mutant and failed
experiment. Final qualification, pushed commits and remaining B9 limitations are
recorded there; no merge is authorized while a reserve remains.

The second full integration exposed a deterministic supervisor election race:
a contender can exit with the live-owner publication refusal before the winning
host answers health. Continue the existing readiness loop under its original
deadline for that exact refusal; never respawn or bypass the health/containment
gate. The regression also checks unrelated startup errors, no healthy winner,
and backoff. The owner's two-full limit is exhausted; another full requires an
explicit extension. No final-green claim is made without that additional run.
