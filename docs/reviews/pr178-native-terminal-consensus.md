# PR #178 native terminal host — consensus dossier

## Exact target

- PR: `rhanka/h2a#178`
- Base: `origin/main@2544b16b81994563630fdb6d3d4f859806b9d2fb`
- Target commit: `a6e46cf08a62af41afede2f423c4004e150cecc4`
- Target diff SHA-256: `ed6bf6945d1eeea7826958a1430d219c30e692850d176d8c3167236c3814464a`

## Author identity

- Host: `codex`
- Model: `gpt-5.6-sol`
- Effort: `xhigh`
- Provenance: explicit conductor routing for PR #178 in the active conversation.

## Required independent legs

| Leg | Host | Model | Effort | Lens | Artifact | Status |
|---|---|---|---|---|---|---|
| correctness | claude | claude-opus-5 | xhigh | lifecycle, process ownership, generation/races, execution proof | `docs/reviews/pr178-native-terminal-correctness.md` | NO-GO |
| security | claude | claude-sonnet-5 | observed effort 80 (dispatch: xhigh) | protocol/socket/controller boundaries, resource bounds, Greywall claims | `docs/reviews/pr178-native-terminal-security.md` | NO-GO |

## Reconciliation

The initial Terra/Luna attempts created no review artifact and exited before review on a fail-closed llm-mesh transport-constraint error. They do not count as review legs.

Both replacement legs independently rejected `a6e46cf`. The blocking findings are:

- controller-authorized per-session stop must support TERM→KILL escalation;
- the persistent host needs bounded/recyclable session records;
- socket filesystem ownership/type/mode must be verified on both server and client trust paths;
- request liveness and repeated failed host starts must be bounded.

The detailed artifacts also record the stale-socket publish race, signal validation, CI command portability and stale `PtyHandle` test doubles. No consensus verdict is available until those findings are reconciled in code and two new independent reviewers validate the new exact target.
