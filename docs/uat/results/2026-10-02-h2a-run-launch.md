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
- Readiness budgets: Codex/Muse 180s, Claude/AGY 90s. MCP outer budgets: 270s and
  180s respectively, including paste, activity, RPC and cleanup time.
- The runtime starts an independent guard owning the created native generation
  and incarnation (including its sidecar), or tmux pane/pid. Launcher death
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
host. A temporary delayed MCP server exercises startup. A third leg forces the
outer bridge deadline to 4s, exercising cleanup rather than waiting 270s.

Exit codes: 0 all passed; 1 launch/cancellation failure; 2 provider-blocked with
otherwise passing legs. Provider credentials remain with their CLIs; the script
does not read authentication files or print environment credentials.

Final campaign: `tmp/launch-uat-1790980499688/results.json` (local evidence).

| Leg | Result | Observed evidence |
| --- | --- | --- |
| Codex 0.160.0, requested gpt-6.1-sol/high | passed | Ready at 10,033ms; receipt at 15,546ms; prompt delivered; witness contains H2A_LAUNCH_WITNESS; run directory exists. |
| Muse 1.4.2 | provider-blocked | Ready at 3,516ms; delivery proved in 4,434ms; provider returned Usage limit reached, reset Oct 4 at 8:00 PM; agent and sidecar exited; run directory exists. |
| Codex forced timeout | passed | Bridge forced to 4s; cleanup receipt at 5,014ms; agent and sidecar exited; no witness and no re-submission. |

All campaign hosts were stopped; their host logs contain process-group reaping
results. These receipts attest the requested model/effort and launch behavior,
not an independently attested effective provider identity.

## Verification

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
