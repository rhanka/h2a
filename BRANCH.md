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
