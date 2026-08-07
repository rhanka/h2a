# PR #178 native terminal host — final consensus dossier

## Exact target reviewed

- PR: `rhanka/h2a#178`
- Base / merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Exact implementation target: `fbd1839369faaeb13cd785623667bee0993cf714`
- Target binary-diff SHA-256: `cb837a214cb4665da1187e04507aa040ba7f40f3537389f5c79339b8b5104683`

## Independent review legs

| Leg | Launch identity | Self-reported identity | Artifact | Verdict |
|---|---|---|---|---|
| correctness | native Codex, `gpt-5.6-sol`, xhigh, direct | native Codex, `gpt-5.6-sol`, xhigh; opaque fallback not attestable | `docs/reviews/pr178-native-terminal-correctness.md` | **NO-GO** |
| security | native Codex, `gpt-5.6-sol`, xhigh, direct | native Codex; exact deployed model/effort not exposed in-session | `docs/reviews/pr178-native-terminal-security.md` | **NO-GO** |

Both sessions were launched independently after `fbd18393`, verified the exact HEAD, merge-base and binary-diff hash before inspection, were forbidden from reading the sibling/consensus artifact, modified only their assigned report, and completed with exit code 0. Both ran typecheck, the four-file native-terminal suite (25/25, including six Linux real-process cases), the historical run surface (6/6), and separate emitted/default-spawn and adversarial probes.

## Reconciled findings

1. **HIGH — stale controller lease resurrection after exited-ID reuse (correctness).** A replacement session resets `controllerEpoch` while retaining the host generation and user-selected session/controller IDs; the old connection retains the old lease. The resulting leases are byte-identical. The stale connection wrote and resized the replacement PTY and released its rightful controller in both real transport/stub and emitted standalone-host/real-PTY probes. Required: a server-minted non-reused session incarnation (or equivalent proven invariant) throughout state/replay/observer/lease ownership and checks, plus a two-connection real-PTY regression covering write, resize, release and stop.
2. **MEDIUM — fragmented replay violates memory and wire bounds (both legs).** Replay charges payload bytes but retains one object per callback. At 1,300,000 one-byte chunks, only 1.3 MiB of the 4 MiB payload allowance is used, yet the response is about 33.99 MiB, exceeds the 32 MiB frame, consumes roughly 180–193 MiB heap, and closes the reader. Snapshot paths also materialize replay merely to obtain `latestSeq`. Required: bound/coalesce metadata, ensure every admitted replay is representable or explicitly paginated, expose `latestSeq` without replay materialization, and add deterministic fragmented-output execution coverage.

The preceding malformed-response and exact-limit request findings are independently confirmed resolved on this target: all five malformed variants reject without uncaught exceptions, and the exact 33,554,432-byte request leaves the host and active real PTY alive.

## Consensus verdict

**NO-GO on `fbd1839369faaeb13cd785623667bee0993cf714`.** The two reports are materially convergent and both findings are actionable. Their full commands, measurements and evidence are preserved in the leg artifacts. Corrections require a new exact target and two fresh independent reviews. The owner explicitly requested no merge.
