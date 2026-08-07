# PR #178 native terminal host — R3 review reconciliation

## Exact target reviewed

- Base / merge-base: `83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Exact implementation target: `c005e61c63c270a9341ec14c6cbf0ee363deafa5`
- Target binary-diff SHA-256: `52aa4a8d52f471dda26e00205e57880207a48dcb3595c641781ac547dffb454c`

## Legs

| Leg | Launch | Result | Artifact/status |
|---|---|---|---|
| correctness | native Codex direct, assigned `gpt-5.6-sol`/xhigh | exit 0, **NO-GO** | `docs/reviews/pr178-native-terminal-correctness.md` complete |
| security | native Codex direct, assigned `gpt-5.6-sol`/xhigh | exit 1 before verdict; model safety filter interrupted a local backpressure probe | PENDING stub; **does not count as a review** |

The correctness leg verified the immutable target, ran typecheck, 30/30 native tests, 6/6 historical tests, emitted default-spawn and adversarial probes, and confirmed the preceding incarnation/replay findings resolved.

## Reconciled actionable findings

1. **HIGH — supervisor-owned child survives readiness timeout.** A spawned child that remains alive without publishing a healthy socket is neither terminated nor cleared after the five-second startup deadline. It suppresses replacement indefinitely after backoff. Required: bounded TERM→KILL reaping only for supervisor-owned children, await exit, clear ownership, then apply backoff; add a real-child replacement regression.
2. **HIGH — outbound backpressure is unbounded.** `socket.write()` backpressure is ignored; a paused client can pipeline legal replay requests and queue responses without a per-connection byte/request cap or accepted-connection cap. The correctness probe reached about 64 MiB queued; the conductor independently measured RSS growth from 68 MiB to 190 MiB under 400,000 tiny pings while the host remained live. Required: hard outbound queue/pipeline and connection limits, stop frame consumption when the budget is reached, and prove another real PTY/client survives.

## Verdict

**NO-GO on `c005e61c63c270a9341ec14c6cbf0ee363deafa5`.** One complete independent leg found two actionable HIGH defects; the failed security leg supplies no consensus vote. Corrections require a new exact target and two fresh complete independent legs. No merge is authorized.
