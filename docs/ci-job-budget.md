# CI integration job budget

Measured on 2026-10-17 using `gh run view <id> --json jobs`, the jobs
REST endpoint (step timestamps), and timestamped job logs. Durations exclude
queue time. The original 15-minute job deadline cancels legitimate work.

| Main run / commit | Node 22 job | Node 24 job | Trust root | npm test, Node 22 / 24 |
| --- | --- | --- | --- | --- |
| [39050298532](https://github.com/rhanka/h2a/actions/runs/39050298532), `3e5e27a7` | cancelled, 15m06s | success, 14m43s | success, 13m39s | 13m04s / 12m44s |
| [39051125266](https://github.com/rhanka/h2a/actions/runs/39051125266), `59636390` | cancelled, 15m03s | success, 14m19s | success, 12m08s | 12m59s / 12m21s |

The second run's Node 22 log reports Node/Track at 596.0s and runtime at
159.1s. Its additional terminal-host step takes 73.2s. The first run's
corresponding figures are 603.1s, 156.0s and 74s (interrupted). The trust root's
direct production invocation takes 777s / 695.4s respectively; its independent
wiring test adds 11s / 9.3s. The two trust-root jobs did **not** time out in
these runs; their remaining margin was small.

Both integration jobs now have a **25-minute hard deadline**:

| Component | Planning allowance |
| --- | --- |
| Checkout, dependency/oracle installation, typecheck | 2m |
| Root build and readiness checks | 1m |
| Node, Track, AgentStats, Focus, isolated identity lane | 12m |
| Runtime TypeScript suites | 5m |
| Additional messaging, terminal and consumer checks | 2m |
| Reporting and runner cleanup | 1m |
| Contingency | 2m |
| Total | 25m |

This is a job budget, not permission to extend individual test deadlines.
Existing subprocess/test timeouts, test discovery, inventory/execution proof,
oracle installation and commands stay intact. In an abnormal run, accumulated
child deadlines can still exceed the job deadline; the job remains a bounded
backstop for leaks (DEC-061), rather than a promise to wait out every timeout.

Each production gate prints its ten slowest suites before removing its
invocation-scoped evidence, including reports from failed runs. The Node
reporter records summed top-level durations (nested test time is included once);
Vitest supplies suite start/end timestamps. Track, AgentStats and Focus also
print rankings from their separate reports. Suites above 60 seconds emit a
warning; missing timing is disclosed rather than invented. These diagnostics
never change a test verdict or replace execution verification. The identity
lane and additional standalone workflow steps retain their existing timing
logs; they are not included in this report-based ranking.

Investigate warnings and job-time growth before raising this budget again.
The 0.98.8 lane partitions the complete M17 campaign as described below.
The complete discovery and execution inventory remains mandatory.

The 0.98.8 lane adds a 10,000-mutation-per-domain backend campaign. On the
shared runner disk it still exceeded the 1,200-second Node backstop, reaching
only 701–801 of 1,250 iterations per actor. One contended writer also hit its
unchanged five-second kernel-lock deadline. The private eight-actor diagnostic
with 400 mutations per domain took 25.2 seconds on disk and 6.1 seconds on
tmpfs. It is a diagnostic, not the full stress acceptance.

The two dedicated Linux M17 qualification jobs create an invocation-owned, 1 GiB tmpfs data
volume for M17 alone. The real APIs, eight actors, 10,000 acknowledgements,
per-domain totals, fresh quota checks, journal verification, kernel-lock
boundaries and all assertions are unchanged. Invalid configured directories
fail before any backend state is created; no fallback or test skip is allowed.
The helper reports the actual filesystem type and configured-volume witness.
Cleanup requires the same owned mount identity and an empty volume, then
unmounts and removes only that temporary directory. This qualifies concurrency
on tmpfs; it does not claim power-loss persistence or performance on disk.
Other tests and packaging continue using their ordinary private disk fixtures.

The remaining Node suites retain the four cold qualifications, protocol/bulk
barrier, original assertions and 1200-second outer backstop. M17 executes the
original file alone with a 1350-second producer backstop, eight simultaneous actors and
1250 iterations per actor. No test case is filtered or shortened. Each job
remains capped at 25 minutes.

The first isolated Node 24 campaign passed completely; Node 22 reached
1201/1250 iterations per actor just before its former 1200-second backstop.
This is observed active work, not a product timeout. Its measured 37-second
setup plus the new 1350-second allowance leaves about 113 seconds for cleanup
and upload under the fixed 1500-second job budget. The original M17 case has
no individual timeout; every assertion, actor, mutation and the five-second
kernel-lock deadline remains unchanged. The ordinary Node suite still has
its 1200-second backstop. A controlled-clock fixture forces the real producer
watchdog, refuses acceptance and verifies all eight owned children stopped.

The Node 22 and Node 24 producers publish a closed execution envelope only
after the real temporary volume and private process state have been removed
and every recorded PID/birth has stopped. Its immutable artifact name includes
workflow run, attempt and Node. Consumers compare repository, workflow, run,
attempt, actual checkout SHA, exact Node version, architecture and source input
hashes, and require a clean tracked checkout. The SHA binds all tracked runtime,
helper and build inputs; the supplementary hashes do not replace that binding.
The exact M17 case must pass once, with 10000 ACK, zero duplicates, all seven
domains complete, eight actors and the observed kernel locks. A provisional,
missing, stale, malformed, failed or skipped report is rejected.

Default npm test still executes every local file. Only explicit GitHub proof
mode partitions M17 after complete discovery. The local/external sets must be
disjoint and exhaustive; their merged report passes the unchanged complete
inventory verifier. Import configuration is removed from test descendants.
Existing required jobs run with always() and explicitly fail if either producer
fails or is cancelled, so a skipped dependency cannot manufacture a green check.
The trust root still runs its direct wiring guard outside the production runner.

Required check names remain **build-and-test (ubuntu-latest, 22)**,
**build-and-test (ubuntu-latest, 24)**, and **npm-test-trust-root**. Two additional
**m17-qualification (22/24)** jobs are mandatory through those fail-closed
consumers; no branch-protection change is required. There are two actual M17
campaigns per PR: the Node 22 result is shared by two consumers. This proves
the same test on the same code, but no longer measures M17 under contention
from other suites or on the same machine as those suites. Run provenance is
not protection against maliciously changed source in the tested commit.

The subsequent lane Node 24 campaign exceeded 1350s at 1201/1250, while the
other three same-head campaigns reconciled completely. The limit remains
1350s. An eight-contender diagnostic of 4000 real OFD flock acquisitions per
sample found avoidable unused-output pipe allocation (median 795.6ms with
pipes versus 729.2ms with ignored outputs, one slower ignore sample). The
mutation primitive now ignores both outputs it never consumed; FD 3, trusted
tool resolution, exclusive locking, five-second acquisition deadline, status
checks and release are identical. This is a measured resource optimization,
not proof that the complete backend meets the CI budget. Full current-head
CI reconciliation and cleanup remain mandatory. Quota/expiry traversal,
stamp-tuple and cache-epoch variants were measured and not retained.
