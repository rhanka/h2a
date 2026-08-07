# PR #178 native terminal host — final consensus dossier

## Exact target under review

- PR: `rhanka/h2a#178`
- Base: `origin/main@83bc1fa609fd0458833a2dcebc1bf56476657a56`
- Target commit: `0a20b7cbddb1e4a7ff986668274105c5d03d6a20`
- Target diff SHA-256: `af56965a97f9e369176852873b19a6c393f09e7f56c08a7ef66ef2049824480b`

## Author identity

- Host/model: Codex `gpt-5.6-sol`, effort `xhigh`.
- Provenance: explicit conductor routing for end-to-end ownership of PR #178.

## Prior consensus and reconciliation

The initial valid independent reviews both returned NO-GO on the pre-hardening target; their complete reports are preserved in commit `114dbdcb`. The final code adds truthful controller-owned TERM-to-KILL escalation, bounded/recyclable sessions, socket UID/type/mode and inode checks, atomic publication, request deadlines, signal validation, bounded startup backoff with diagnostics, portable CI commands and corrected PTY test doubles. Main was then rebased exactly onto `83bc1fa609fd0458833a2dcebc1bf56476657a56`; all evidence must target the resulting `0a20b7cb`.

## Independent legs on `0a20b7c`

| Leg | Host | Model | Effort | Artifact | Status |
|---|---|---|---|---|---|
| correctness | Codex native | `gpt-5.6-sol` | xhigh | `docs/reviews/pr178-native-terminal-correctness.md` | **NO-GO** |
| security | Codex native | `gpt-5.6-sol` | xhigh | `docs/reviews/pr178-native-terminal-security.md` | **NO-GO** |

Both reviewers independently verified the exact base, target and diff hash and executed the four-file native-terminal suite (23/23). The correctness leg additionally proved the compiled default-spawn/adoption path with one persistent host and one direct PTY child; the security leg revalidated the private-socket and resource-boundary claims.

## Reconciled findings

1. **Malformed response containment — MEDIUM, confirmed by both legs.** The client accepts a partial envelope, does not enforce protocol version or the success/error discriminant, and can throw after removing a matching pending request. Required remediation: strict response parsing before touching pending state, fail the connection closed, and raw-peer regressions for incompatible version, missing/invalid error fields and malformed success.
2. **Exact-limit invalid request containment — MEDIUM, security leg.** An exactly 32 MiB request with an overlong raw ID reaches the parser error path, which reflects that unbounded ID and throws while framing the response. The exception escapes the socket callback and terminates the standalone shared host. Required remediation: bounded fallback correlation/error fields, exception-safe per-socket handling, and a real-process regression proving the host and an existing PTY survive.

## Consensus verdict

**NO-GO on `0a20b7cbddb1e4a7ff986668274105c5d03d6a20`.** The reports are independent and materially convergent. Both findings are actionable and block readiness. Their complete evidence is preserved in the two leg artifacts; corrections require a new target SHA and two fresh independent reviews. The owner explicitly requested no merge.
