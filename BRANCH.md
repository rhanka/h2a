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
power-loss images reconstructed from synchronized writes, full R8 matrix,
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
experiment. Final qualification, pushed commits and remaining limitations are
recorded there; no merge is authorized while a reserve remains.

The second full integration exposed a deterministic supervisor election race:
a contender can exit with the live-owner publication refusal before the winning
host answers health. Continue the existing readiness loop under its original
deadline for that exact refusal; never respawn or bypass the health/containment
gate. The regression also checks unrelated startup errors, no healthy winner,
and backoff. The owner's two-full limit is exhausted; another full requires an
explicit extension. No final-green claim is made without that additional run.

## Release candidate CI repair

Owner scope 2026-10-13: repair PR #330 CI on Node 22/24, provision historical
fixtures in shallow checkouts, build native qualification in workspace order,
and prove fixture host/journal teardown on success, failure and timeout.
The owner abolished the out-of-gate native kernel qualification and authorized
one final full integration run for this repair. No merge or release is authorized.

CI exposed additional blocking fixtures after the historical builds ran:
the namespace registry parent was absent, the reaper probed a group before
checking its frame, mandatory host configuration oracles were not installed,
the 30x24 lock stress reloaded the full API per worker, and Node 24 selected
the spec reporter for a nested timeout proof. Targeted checks cover the fixes;
the stress load and 120-second deadline stay unchanged. The single local full
run passed before these CI follow-ups; final acceptance belongs to head CI.


## Main CI repair — 2026-10-16

Current branch: `fix/main-ci-green`, based on `origin/main` at `58f111b3`.
Owner scope supersedes the historical branch's dependency-range restriction:
repair B5 scheduling, restore the exact published R6 pair, and pin internal
h2a / h2a-cli / h2a-runtime / track dependencies and peers to exact versions.
Keep release preparation, lockfile and release/rehearsal gates in lockstep.

- B5 is a scheduling-dependent test assumption: a 300 ms pause reproduces
  the CI's 250 ms incomplete-inventory refusal. Completeness uses a test-only
  monotone clock. Six boundary cases retain refusal at and beyond both the
  inventory cap and a shorter attempt deadline; product evidence is unchanged.
- R6's published core 0.98.5 must install runtime 0.98.5 explicitly; both
  real election orders fail before the pin and pass after it.
- Exact internal requirements prevent future npm resolution from combining
  incompatible patch releases. Version preparation preserves pins, and
  release verify/publish reject floating or mismatched internal requirements.
- Targeted source-built identity lane: 70 passed, 0 failed/skipped.
  Release helper/workflow/order checks: 60 passed, 0 failed/skipped.
  Red/green commands and outputs are retained in the owner's final report.

Only named test files run locally under temporary HOME/XDG/H2A roots. No
installed h2a, native host, foreign PID, full local suite, merge or publication.
CI on the PR is the integration authority. External review through the real
h2a/mesh is excluded by the owner's confinement; no consensus is claimed.


## Main CI repair — Tour 2

Owner scope: integrate #338 and origin/main (#333) through normal merge
commits, without rebase or force-push. This supersedes the historical merge
restriction above. No merge into main or real publication is authorized.

The rejected offline workaround is removed. Rehearsal stamps the disposable
CI workspace after build and before pack with
`<version>-rehearsal.<run_id>.<attempt>`, rewriting all internal manifest pins
and the independent smoke literal. The exact-version gate still runs before
pack and accepts those exact prerelease pins. Release manifests and lockfile
stay at 0.98.6 in git; the real release path is unchanged.

Publish parity permits only --dry-run and the explicit default prerelease
tag; no offline/cache exception remains. Execution tests retain all four
publish bodies, default/backfill selection and npm failure propagation.
The owner report records strict-test red/green, broken-package rejection,
targeted regressions and final PR CI. No full local suite is authorized.


## RC on npm next — owner decision 2026-10-16, part B

Branch: feat/release-rc-next, based on origin/main at d2e0cfdc.
Owner scope: require a successful same-source-tree RC before every stable
release; no tag push, npm publication, main write or full local suite.

- Keep stable versions in Git; stamp disposable RC manifests, all internal
  exact pins and the independent artifact smoke literal after the test gate.
- Publish the four verified tarballs on next only for vX.Y.Z-rc.N, preserving
  the same verify/pack/smoke and strict publish-rehearsal body parity.
- Record a repository/run/attempt/commit/tree attestation only after completed
  post-publish install/doctor smoke, all four next tags and registry integrity
  matching the verify-built tarballs. This also protects idempotent skips.
- Stable publication (backfill included) requires a successful RC push run
  from release.yml, a nonexpired artifact for its current attempt, matching
  release train/tree and corroboration from GitHub's Git commit API.
- Operator docs require owner installation of @sentropic/h2a@next and a real
  machine reboot before tagging the stable version on the same merged commit.

Targeted red/green evidence is retained in tmp/release-rc-evidence and in the
owner's requested scratchpad report. npm/GitHub publication is simulated;
GitHub metadata inspection is read-only. No installed h2a is invoked locally.
Native h2a/mesh consensus review is excluded by the owner's confinement;
review metadata/eligible hosts cannot be established, so no consensus is claimed.
CI on the PR is the integration authority; machine reboot remains owner UAT.

## RC review reserves — owner scope 2026-10-16

Close both P2 findings from the independent review of PR #345: document the
explicit exact-version stable installation after publication because upgrade
rejects prerelease versions, and make generated release instructions follow
RC publication, attestation and owner reboot acceptance before the stable tag.
Both tags retain signing and target the same verified merged commit.

The operator-flow regressions failed before the fix (27 passed, 3 failed,
0 skipped) and passed after it (30 passed, 0 failed/skipped). Merge origin/main
through a normal merge commit, run named release regression files only, and
push this branch. No main write, tag push, publication or installed CLI run.
Evidence and final CI job results are appended under "Réserves Astra" in the
owner's scratchpad report; physical reboot and real publication remain owner UAT.
