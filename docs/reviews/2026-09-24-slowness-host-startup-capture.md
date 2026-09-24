# Slowness investigation — host-startup identity acquisition (installed 0.97.6)

Track: investigation `01M38NYH7X3TVBV5TA4KJS3Q8W`, method `01M38QQ4EJJE5NKFGN8T9PNCXK`. Measured 2026-09-24. Investigation only; no code, merge, publication, or tag.

## Result, correctly scoped: an UNPAIRED baseline — NOT a refutation of the 20 s failure

Three real identity acquisitions of the INSTALLED global 0.97.6 (`/home/antoinefa/.npm-global/lib/node_modules/@sentropic/h2a/dist/bin.js`), against the real bus `~/h2a-workspace/.h2a` (`registry/instances.jsonl` 17,530,315 bytes / 26,965 rows), completed identity in **700.079 / 663.794 / 643.983 ms**.

**These were captured in a CALM condition, not the failing one.** At capture: loadavg1 **8.41–11.98**, CPU PSI some avg10 **0.06–0.47 %**. The failure that motivated this capture occurred under a SPIKE: loadavg **24**, CPU PSI some avg10 **23.72 %** (the h2a_run launches that returned `identity_failed / identity_timeout`, 3 in a row, 55–56 concurrent `mcp-serve`, 275 MB bus). **A negative result obtained OUTSIDE the failing condition does not refute the positive: it says nothing about the 20 s.** "Not reproduced" here must NOT be read as "does not exist" — the paired capture is still DUE (see below).

**Corroborating was not establishing.** The registry read/parse (OQ-3, the ~17 MB parent read hypothesis) was NOT observed to dominate: every instances read ran in the identity worker, totalling **229.239–273.981 ms** per acquisition; no multi-second memory/IO registry stall (memory PSI ~0 %, registry spans 0 major faults); binding-lock waits **1 ms**. So OQ-3 is a candidate, NOT established.

## The baseline IS the missing negative control

644–700 ms is the NOMINAL identity-acquisition cost at this fleet scale and real bus size. The 20 s overrun under the spike is therefore a **factor ~30**, i.e. a discrete failure under scheduling/pressure spikes, NOT a continuous drift. This bounds what the paired capture must explain.

## STILL DUE: a threshold-triggered PAIRED capture

The decisive next evidence is the same phase + PSI instrumentation attached to an acquisition INSIDE the failing window. It cannot be scheduled by time (that replays the calm condition, where the system is fine). It must be armed on a THRESHOLD observer: arm the capture when `loadavg1 > ~20` OR CPU PSI some avg10 > ~15 %, then launch the acquisition within that window, retaining the full pending → timeout window and worker tail, plus the actual launcher/plugin-load context and provider binding.

At the SAME instant, record the three numbers without which a slow acquisition stays unattributable: the concurrent `mcp-serve` count, their TOTAL RSS, and PSI memory+CPU. And measure the per-sidecar STARTUP cost (how much of the ~138 MB median RSS is the Node runtime vs the 17 MB registry materialized per instance) — that is what says whether the floor below is reducible or structural.

## Fleet floor at rest (2026-09-24, machine idle) — the standing hypothesis

Not a leak (PR #166 "h2a_run tmux session leak" ruled out: the 54 `mcp-serve` have 54 DISTINCT PPIDs, none at PPID 1, only one tmux session — every sidecar has a live parent). Instead a PERMANENT FLOOR: **54 live `mcp-serve`, median RSS 138 MB (61–169), total 7,047 MB** (~22 % of the 31,940 MB used; 58,876 MB total, 26,935 available), avg age 1.8 h. At rest PSI memory some+full = 0, CPU some avg300 = 0.57 %, loadavg 4.75. The floor causes nothing on its own (all zero at rest); the hypothesis is that it reduces the available margin, so a scheduling spike a bare machine would absorb pushes this one past the 20 s acquisition deadline — consistent with the 644–700 ms calm / failure-on-spike split above. If it holds, the lever is not to accelerate acquisition but to lower the floor: the per-sidecar cost, or the number of simultaneous sidecars (54 × 17 MB registry ≈ 918 MB of same-file copies IF each instance materializes it — to verify, not asserted). Treat as hypothesis, not cause, until the paired capture attributes a real 20 s overrun.

## Method / exact command

A probe drives `node <artifact>/dist/bin.js mcp-serve --auto-open --host codex --wake auto --root <bus>` with `H2A_MCP_TRACE=1`, sends JSON-RPC `initialize` / `notifications/initialized` / `tools/list`, polls `h2a_identity_status`, and a separate Node process samples `/proc/pressure/{cpu,memory,io}` + loadavg + the concurrent `mcp-serve` count. Node v22, Linux, 32 CPUs. Cold = fresh process; warm = reused identity. No load was manufactured to force a failure. No Python.

Caveat (obtained differently): the CAPTURING agent ran via `codex exec` direct (no h2a identity for itself, because h2a_run was failing on identity_timeout); the host launch it instruments IS the real production identity path.

## Raw artifacts (may be purged from cache — named here per the archival rule)

Under `/home/antoinefa/.cache-tmp/host-startup/`: `capture.cjs`, `probe.cjs`, `analyze.cjs`, `write-report.cjs`, `summary.json`, full `report.md`, and three capture directories with raw `stderr.log` / timestamped `capture.jsonl` / per-pid `probe-<pid>.jsonl`. Trace attempt IDs: capture-1 `cd174af8-488f-4e52-b06e-5583afce1313`; capture-2-warm `cf3639f8-73f8-4a86-a68f-4aa1b0cbab48`; capture-3-warm `1f815056-4318-4f43-9f69-ad308bfc18e4`. Installed `dist/bin.js` SHA-256 `c6f502d84fc163c0aea7fcbf52dbecb8c18dc898e8aede73bd8cb8d24833cdb0`.

## 2026-09-24 differential — the added path, not the registry (reorients the fleet-floor hypothesis)

A `h2a_run` launch (profile `claude`, gateway required) failed `identity_timeout` TWICE, once in a CONFIRMED CALM window: CPU PSI some avg10 **0.00 %**, loadavg1 **6.23**. This is a direct COUNTER-EXAMPLE to the fleet-floor / restart-herd hypothesis above: a herd that materializes the 17 MB registry across ~48 simultaneous lanes would explain failures AT A SPIKE; it does NOT explain a failure AT CALM. The floor hypothesis is thereby WEAKENED (not disproven — it may still contribute at spikes), and the standing "hypothesis, not cause" caveat now has a concrete calm-window failure it does not cover.

What the calm failure ISOLATES — the cleanest differential of this investigation. Same host, same 26,965-row registry, same calm instant, two acquisition paths that diverge by a factor of ~30:
- `mcp-serve` direct → identity ready in **644–700 ms** (the calm baseline above);
- `h2a_run` profile `claude` **with gateway** → exceeds the **20 s** deadline (`identity_timeout`).

The variable is therefore neither the registry, nor the load, nor the parse. It is **what `h2a_run` + gateway do IN ADDITION to `mcp-serve`** — gateway cold-start, profile resolution, a service wait, or whatever the added path contains.

Consequence on the order of the still-due experiments (deferred behind the drive-consent publication; NOT run here): the DIFFERENTIAL comes BEFORE the variable-N acquisition curve (N ∈ {1, 4, 16, 48}). Read the `h2a_run` gateway-profile code path and instrument only what it adds over `mcp-serve`. If the added path explains the 20 s, the N-curve becomes secondary; if the added path is cheap, the calm-window failure stays unexplained and the N-curve regains its full meaning. Either way the next step is determined — which was not true before this differential. (Note: this is code-reading plus a few traces, not a campaign.)

Caveat on attribution: the `codex exec`-direct channel used for delegation does NOT go through h2a identity acquisition at all, which is why it never hits this timeout — a third data point consistent with "the cost is in the h2a identity/gateway path, not in the work itself."
