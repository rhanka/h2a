# h2a_run readiness and timeout cleanup — 2026-10-02

Track: 01M3JPMG8NQ6P3PW94M7KY96ZC / 01M3JPSXBHPKN3R5N7VMK84J16.
Branch: fix/h2a-run-launch-readiness, based on origin/main.

## Proven cause

The MCP subprocess bridge had a 30,000ms deadline, while the runtime allowed
90,000ms to reach readiness, then 8,000ms for paste rendering and 30,000ms for
activity. Killing that runtime owner bypassed its partial-session cleanup.

With the unmodified build, Codex returned unknown after 30,039ms. Its native
session was still running, the screen contained model/cwd status and the passive
warning banner, and `.h2a/runs/<name>` did not exist. The prompt had not been
submitted. Muse reproduced the same 30,038ms outer timeout on a workspace trust
screen, which the prior generic modal detector did not recognize.

Native capture compounded the problem: it stripped ANSI rather than executing
cursor moves/erasures, concatenated rows/words, and could retain erased loading
text. The generic readiness predicate required three nonempty lines and a CPU
rate below 0.3 core. Muse 1.4.2 reached its empty composer in 3–4s yet its process
tree used 1,130ms CPU/2.2s at rest, so the CPU predicate refused a ready host.

A launch with a 45s delayed MCP server took 55,119ms, including 48,581ms for
observed prompt delivery, and successfully wrote its witness. This is a measured
launch longer than the former outer deadline, rather than a hypothetical delay.

## Corrective behavior

- Native capture replays the terminal through `@xterm/headless`, then reads the
  current visible screen. No ad-hoc VT parser is introduced.
- Codex and Muse recognize their composer and model/cwd footer, explicitly reject
  Codex model loading, and recheck availability immediately before paste.
- A drawn profile composer observed across CPU sampling is readiness evidence;
  the measured idle rate remains the baseline for proving subsequent CPU work.
- Readiness budgets: Codex/Muse 180s, Claude/AGY 90s. Runtime outer deadlines:
  270s and 180s respectively. MCP waits at most 49s, then returns `launching`
  while the asynchronous runtime continues; repeated names read the same launch.
- The runtime starts an independent guard owning the created native generation
  and preallocated incarnation before creation (including its sidecar), or tmux pane/pid. Launcher death
  closes the guard pipe; it stops those owned sessions and writes an atomic
  receipt. A successful launch disarms it.
- MCP cleanup receipts are fenced by an attempt nonce. Stopped launches retain
  `retrySafe:false`: cleanup cannot undo effects of an already submitted task.
- The prompt is pasted once and submitted once. No delivery retry is added.
- Provider quota refusal after submission has a distinct `provider-blocked`
  failure, with `prompt.delivered:true` and the observed cleanup outcome.

## Replayable in vivo test

```sh
rtk npm run build
rtk node scripts/uat-h2a-run-launch.mjs --mcp-delay-ms=45000
```

The script runs the built canonical MCP bridge/runtime against real Muse and
Codex CLIs, owns a dedicated native host/registry/bus, creates unique witnesses,
trusts the owned Muse worktree only for the test run, and cleans its sessions and
host. A temporary delayed MCP server and a 55s Codex startup delay exercise the
49s response budget and subsequent polling. The cancellation leg kills the
runtime as soon as the receipt owns both sessions, during sidecar creation or
verification. Its 60s deadline is only a backstop for a missing ownership boundary.

Exit codes: 0 all passed; 1 launch/cancellation failure; 2 provider-blocked with
otherwise passing legs. Provider credentials remain with their CLIs; the script
does not read authentication files or print environment credentials.

Round 1 campaign: `tmp/launch-uat-1790980499688/results.json` (local evidence).

| Leg | Result | Observed evidence |
| --- | --- | --- |
| Codex 0.160.0, requested gpt-6.1-sol/high | passed | Ready at 10,033ms; receipt at 15,546ms; prompt delivered; witness contains H2A_LAUNCH_WITNESS; run directory exists. |
| Muse 1.4.2 | provider-blocked | Ready at 3,516ms; delivery proved in 4,434ms; provider returned Usage limit reached, reset Oct 4 at 8:00 PM; agent and sidecar exited; run directory exists. |
| Codex forced timeout | passed | Bridge forced to 4s; cleanup receipt at 5,014ms; agent and sidecar exited; no witness and no re-submission. |

All campaign hosts were stopped; their host logs contain process-group reaping
results. These receipts attest the requested model/effort and launch behavior,
not an independently attested effective provider identity.

## Round 1 verification

- RED: three profile readiness/modal assertions failed against the original
  implementation. A later race test failed because text was pasted after
  readiness disappeared; it passes with the pre-paste recheck.
- Build and typecheck: pass.
- Focused runtime: 74/74 pass in five files (delivery, guard, rendered screen,
  native op, native-host policy).
- Focused MCP bridge: 16/16 pass; these tests are also part of the root Node gate.
- Full npm test final campaign: Node 2,374 tests (2,331 pass, 21 skipped, 22 TODO, 0 fail, 0 cancelled) in 261 files; Track 1,193/1,193 pass in 87 files. Both complete campaigns passed; the final one ran after all runtime hardening was compiled.
- Harness verification returned pass with zero checks and unknown commit/branch;
  it adds no test coverage and is not counted as acceptance evidence.

## Unverified

- A successful Muse provider response and file witness are blocked by the measured
  usage quota. Its launch, submission and cleanup are verified separately.
- Independent two-peer consensus review: selection failed. The live llm-mesh
  catalog exposed only muse-spark-1.3 and muse-spark-1.3-contributor, with no two
  eligible Claude-hosted legs. The local selection dossier is
  `tmp/review-launch-readiness.md`; no consensus verdict is claimed.
- Native Linux was exercised in vivo. Other operating systems and real tmux
  provider launches were not exercised in this campaign.
- Unreachable hosts / OS refusal to reap remain explicit cleanup-failed/unknown
  results, never reported as a successful stop. An old runtime without a guard
  receipt still returns conservative unknown; no destructive name-only fallback
  is attempted.

## Round 2 corrections and evidence

`origin/main` at `59ea984852e8856e3116381afffd55c1fd159f39` was merged first.

1. Agent and sidecar generation/incarnation are recorded before `create`. The
   native host checks the reserved generation and adopts the reserved incarnation.
   Older hosts without the advertised capability are refused before creation.
   The guard allows a bounded in-flight create op to settle before certifying absence.
2. The MCP runtime uses asynchronous `spawn`; heartbeat/notification timers keep
   running. Stdio and central transports await the result without blocking.
3. The server waits at most 49s. Pending launches return
   `{state:"launching",launchId,retrySafe:false}`. A name registry retains pending
   and final results for the server lifetime; duplicate calls never spawn or
   submit again. Provenance is recorded when the launch completes, including
   after the initial response. Tool description and spec document this contract.
4. The guard's error handler checks `completed` before cleanup.
5. Failure paths use the guard's explicit stop/final receipt. Exited owned
   sessions count as stopped without another kill; completed cleanup is not
   mislabeled `cleanup-failed`. The native guard starts before creation, removing
   the unguarded post-create attestation throw. Tmux attestation failure cleans up.
6. `drive.functional.test.ts` is unchanged. Exact test:
   `h2a drive native PTY backchannel > should submit a signed line to a real native PTY and defer after human activity`.
   Signature: `AssertionError: Expected values to be strictly equal: false !== true`,
   at line 173, the `startNativeH2aSidecar(...) === true` assertion. The fixture
   launches a script that writes the target marker and exits, while the launcher
   deliberately requires a running sidecar at its final probe. The assertion
   therefore races script exit: a scheduling-dependent fixture defect, rather
   than evidence of failed native drive delivery. The same default sidecar path
   exists on main. Main passed eight unmodified isolated replays; a branch run
   under additional test load reproduced the signature. No fix is included.

RED evidence: agent/sidecar pre-creation ownership (2 failures), guard lifecycle
(2 failures), guard EOF receipt fencing/completion (2 failures), reserved host
identity (1 failure), and old-host refusal (1 failure).
The MCP registry/async tests failed before their exports existed. Regression tests
also advance the production timer to 49,000ms and exercise an actual subprocess
after MCP request cancellation and transport close: one runtime, one received brief.

Final UAT: `tmp/launch-uat-1790985711687/results.json`, exit **2** exclusively for
the observed Muse provider quota; no launch or cancellation failure.

| Leg | Result | Evidence |
| --- | --- | --- |
| Codex, gpt-6.1-sol/high, startup delayed 55s | passed | Initial `launching` at 49,052ms; ready 62,149ms; prompt observation waited 58,810ms; witness at campaign elapsed 82,201ms; receipt owns agent and sidecar. |
| Muse | provider-blocked | Ready 4,037ms; prompt observation waited 21,013ms; response 28,359ms; quota refusal; agent and sidecar exited; cleanup receipt `stopped` owns both. |
| Codex cancellation at sidecar ownership boundary | passed | 2,510ms; both sessions exited; no witness; fenced `stopped` receipt owns both; `retrySafe:false`. |

Runtime full suite: **1,512 passed, 5 skipped, 0 failed** (1,517 total) in 103 files.
Runtime focused suite: **149 passed, 1 skipped, 0 failed** in nine files. Baseline
archives under `tmp/` are excluded from discovery. MCP bridge: **20/20 passed**.
The first root Node gate hit its 600s backstop; a second run in the shared local
configuration was stopped after identifying `loop-tick-cli` as the remaining
blocker. That file passed **9/9 in 12.6s** with an isolated native configuration
and socket. The final root gate uses that isolation; its exact counts follow.

Two completed root campaigns exposed timing failures outside these corrections:

- Default file concurrency: Node 2,406 total, 2,361 passed, 2 failed,
  21 skipped, 22 TODO, 0 cancelled. Track 1,193/1,193 passed in 87 files.
  `mcp-central.test.js` failed `finding-1: an in-progress reclaim lock never admits
  a second live owner`, line 821: `contender 2 staged its exclusive publication`
  (the 3s fixture barrier). `pty-native-messaging.test.js` failed `should round-trip
  codex to codex through real native openpty sessions at tmux envelope parity`:
  `codex native sidecar identity did not become observable; last=undefined`.
- Four-CPU affinity: Node 2,406 total, 2,362 passed, 1 failed, 21 skipped,
  22 TODO, 0 cancelled. The same central barrier failed for contender 3.
  Track 1,193/1,193 passed. No out-of-scope fixture or timeout was modified.
- Targeted replay of both files: 22 total, 21 passed, 1 TODO, zero failures.

The final `npm test` campaign uses isolated configuration/socket plus two Node
files concurrently, with all CPUs available. A temporary preload adjusts only
the root runner's `--test-concurrency`; no test is filtered and no deadline is
changed. Local log: `tmp/round2-npm-two.log`.

Final root gate: **exit 0**. Node: **2,406 total, 2,363 passed, 21 skipped,
22 TODO, 0 failed, 0 cancelled** in **264 files**, 187.328s. Track:
**1,193/1,193 passed** in **87 files**, 4.13s. The build and all three Focus
static checks preceding the runner also passed. Runtime Vitest remains a
separate gate; its counts are not part of root `npm test`. MCP's 20 tests are
already included in the root Node count.
