# M17 CI execution partition — 0.98.8

Owner scope: repair PR #355 and its registry descendant #354 without weakening
tests, using targeted local files and disposable CI only. No runtime contract,
package version, branch protection or 25-minute job budget changes here.

## Evidence and decision

The complete backend campaign has eight simultaneous actors, 1250 iterations
per actor and at least 10000 mutations in each domain. Multiple complete CI
runs reached the 1200-second outer backstop with 701–1001 iterations per actor;
their full logs are retained in the owner report. Other suites contend for the
same CPUs and filesystem. A standalone Node 24 run completed the unchanged
case in 1134.189 seconds. Smaller samples and microbenchmarks are diagnostics,
not acceptance. Qualification of the new topology remains pending CI.

| Option | Benefit | Cost / limit |
|---|---|---|
| Further runtime optimizations | Retains same-machine contention | Changes production code without measured assurance of meeting the CI budget |
| Raise the job budget | Small workflow change | Conflicts with the fixed 25-minute integration budget; does not remove contention |
| Mandatory complete companion campaigns | Preserves the whole case and job budget | Changes orchestration assurance; needs exhaustive same-run proof and two additional jobs |

D1. Use the third option as a reversible correction within the authorized CI
work. Run the original M17 test file, assertions, eight actors, all mutations,
and the 1200-second process backstop in Node 22/24 companion jobs.

D2. Keep default `npm test` complete. Explicit GitHub import mode alone may
partition M17, after complete discovery and validation of a closed envelope.
Require disjoint/exhaustive file identities and then the existing full
execution-inventory verifier. Invalid explicit configuration fails immediately.

D3. Bind immutable artifact names to run/attempt/Node and envelope provenance
to repository, workflow, actual checkout SHA, run/attempt, exact Node version,
platform/architecture and source hashes. Require a clean tracked checkout;
the commit binds all tracked helpers, runtime and build inputs. Import only the
exact relative file and original title once, passed, with coherent counters,
complete backend reconciliation, observed locks and tmpfs evidence.

D4. Publish only after test exit zero, no surviving recorded PID/birth, private
state removal and successful real volume cleanup. Pending reports cannot be
imported. Failure teardown uses only owned identities and verifies exit after
TERM/KILL before removing its state. No live owner state is consulted.

D5. Existing required consumers use `always()` and explicitly fail on any
non-successful producer result. This prevents dependency skips from satisfying
branch protection. They also validate actual proof; a dependency verdict alone
is insufficient. The direct trust-root wiring test remains outside the runner.
YAML graph controls reject skipped/optional dependencies and stale artifacts.

## Independent reviews and reconciliation

Two independently spawned reviews examined correctness and operational risk;
no model diversity or complete harness-review consensus is claimed. Both
accepted the design subject to the above invariants. Risk review identified
the GitHub skipped-required-check issue, which D5 addresses. Both reviews
identified incomplete failed-producer teardown; the implementation now wraps
the whole ownership lifetime, checks birth identities and verifies exit after
KILL. Correctness re-review found that issue resolved. A real child ignoring
TERM exercises the failure path in a private synthetic producer fixture.

The synthetic fixture also executes the actual public Node runner, reporter
and preload with eight short-lived children, rejects early sealing, dirty
sources, symlinks and stale output, and imports only the finalized proof.
It does not exercise backend stress. The exact per-case negative controls and
complete inventory remain mandatory in the production test policy.

## Limits and rollback

There are two real M17 campaigns per PR; Node 22 proof is shared by two
consumers. This does not measure contention with the other suites or execution
on their same machine. Run provenance is not a defense against malicious
source changes in the tested commit. Full disk performance, power-loss
persistence and normative M17 across eight protocol surfaces remain outside
this backend campaign. No green is claimed until current-head CI succeeds.

Rollback is one CI orchestration commit: default local execution remains
complete, so removing explicit import configuration restores the original
same-machine campaign. No persisted product data or public schema migration.
