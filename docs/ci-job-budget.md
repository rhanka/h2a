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
Sharding is deferred here because the independent trust root pins the complete
production invocation and its execution proof. Splitting that contract needs
its own proof of exhaustive shard coverage; extending the measured job budget
does not change it.

The 0.98.8 lane adds a 10,000-mutation-per-domain backend campaign. On the
shared runner disk it still exceeded the 1,200-second Node backstop, reaching
only 701–801 of 1,250 iterations per actor. One contended writer also hit its
unchanged five-second kernel-lock deadline. The private eight-actor diagnostic
with 400 mutations per domain took 25.2 seconds on disk and 6.1 seconds on
tmpfs. It is a diagnostic, not the full stress acceptance.

Both Linux integration jobs now create an invocation-owned, 1 GiB tmpfs data
volume for M17 alone. The real APIs, eight actors, 10,000 acknowledgements,
per-domain totals, fresh quota checks, journal verification, kernel-lock
boundaries and all assertions are unchanged. Invalid configured directories
fail before any backend state is created; no fallback or test skip is allowed.
The helper reports the actual filesystem type and configured-volume witness.
Cleanup requires the same owned mount identity and an empty volume, then
unmounts and removes only that temporary directory. This qualifies concurrency
on tmpfs; it does not claim power-loss persistence or performance on disk.
Other tests and packaging continue using their ordinary private disk fixtures.

The 36-process identity startup file runs before the backend campaign, with
its original cohort size and handshake deadlines. All four cold files finish
before the overlapping backend/protocol phase; package work still waits for
the remaining protocol barrier. CI jobs remain capped at 25 minutes.

Required check names remain **`build-and-test (ubuntu-latest, 22)`**,
**`build-and-test (ubuntu-latest, 24)`**, and **`npm-test-trust-root`**.
No branch-protection update is needed. All other jobs and their budgets remain
unchanged; no suite, assertion, platform or runtime is removed by this change.
