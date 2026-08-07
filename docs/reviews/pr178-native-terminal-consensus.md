# PR #178 native terminal host — R4 review reconciliation

## Exact target reviewed

- Base / merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Exact implementation target: `f40e24cc7e23a7bd88fef0a78325816cb4c22388`
- Target binary-diff SHA-256: `2ae714233d14b31baa5daafe1bf1dd77b6448acaadf97a20e20bdb9a529e9c61`

## Independent legs

| Leg | Native Codex session | Result | Artifact |
|---|---|---|---|
| correctness/lifecycle | `pr178-codex-correctness-r4`, direct `gpt-5.6-sol`/xhigh | **NO-GO**; two HIGH findings | `docs/reviews/pr178-native-terminal-correctness.md` |
| local security/resource reliability | `pr178-codex-reliability-r4`, direct `gpt-5.6-sol`/xhigh | **NO-GO**; one HIGH and one MEDIUM finding | `docs/reviews/pr178-native-terminal-security.md` |

Both reviewers independently verified the exact target and base, ran the 33-test native suite and six compatibility tests, and used bounded local real-process probes. Both reproduced the fatal-host orphan independently. The correctness leg additionally ran the full root suite, security audit, queue/connection probes and losing-supervisor convergence probe.

## Reconciled actionable findings

1. **HIGH — losing supervisor-owned host leaks after winner adoption.** A supervisor may return a healthy foreign host while retaining its own distinct live startup child. It must boundedly reap only that losing owned child before completing adoption and remain able to restart after the winner exits.
2. **HIGH — hard/frozen host death orphans signal-resistant PTYs.** A real PTY that ignores HUP/TERM/INT survives host `SIGKILL` and forced readiness reaping under PID 1. The Linux path needs a kernel-enforced owner-death boundary that does not depend on host JavaScript running, with a real-PTY crash regression covering the whole workload.
3. **MEDIUM — socket replacement has a compare/unlink TOCTOU.** Separate inode validation and pathname unlink operations allow legitimate concurrent publishers to remove or misattribute a replacement socket. Publication/removal must be serialized or made ownership-safe, and the published inode must be proven to be the staged inode.

The R4 reviewers confirmed the earlier startup-timeout and outbound-backpressure blockers were otherwise resolved: queue budgets, connection limits, malformed-peer isolation, controller/incarnation fencing, replay bounds, one-host/multi-PTY operation and no per-operation Node spawn storm all passed.

## Verdict

**NO-GO on `f40e24cc7e23a7bd88fef0a78325816cb4c22388`.** Three actionable findings remain. Corrections require a new exact implementation target, rerun local execution/CI gates, and two fresh complete independent native Codex reviews. No merge is authorized.
