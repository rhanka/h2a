# PR #267 — cluster-mesh messaging, N2, release 0.98.0

## Objective and scope

Finish `feat/consume-cluster-mesh-0.10.0` rebased on origin/main 0.97.1.
Consume cluster-mesh 0.10.1, extend the existing send primitive and CLI/MCP
adapters, verify received envelopes before inbox/wake, and prepare 0.98.0 in
this PR. Owner authorized push with force-with-lease; no merge or tag push.

Allowed: h2a dependency/lockfile; send/cluster-mesh messaging and existing
CLI/MCP adapters/exports/help; focused messaging tests and CI gate; this plan
and messaging spec; lockstep version files changed by scripts/release.mjs.
`.track/**` remains single-writer and is forbidden in this worktree.

## Lots

- [x] Rebase onto origin/main and record incremental progress externally.
- [x] Pin cluster-mesh 0.10.1 and share the existing send preparation.
- [x] Implement configurable mesh send and verified receive before inbox/wake.
- [x] Verify real store round-trip, tamper rejection and unchanged local behavior.
- [x] Build, typecheck, full test gate, public-contract gate and diff review.
Final sequence after the feature commit: run release.mjs for 0.98.0, then
push the branch with an explicit force-with-lease. Release/push receipts live
in the incremental external report so they can be written after the final
release commit without adding a post-release bookkeeping commit.

## Design and evidence

See docs/specs/2026-09-15-SPEC_EVOL_cluster-mesh-send.md. Incremental owner
report: codex-267-098-report.md beside the supplied brief in its scratchpad.
Local command logs and review launch failures: tmp/cm267/ (ignored).

Two complementary peer review launches were rejected by automatic approval
review (potential gateway code export). No consensus verdict is claimed.

## Verification results before release

- `npm run build` and `npm run typecheck`: passed.
- Messaging/local/stdio targeted suite: 37 passed, zero skip or TODO.
- N2 mutation: bypassing the upstream verifier makes both outer-kind/no-wake
  tests fail; restoring it makes both pass.
- `REMOTE_CLI_CONFIG_HOME=$PWD/tmp/cm267/runtime-home npm test`: passed.
  Node gate: 2,114 passed, zero failures, 17 existing skips and 21 existing
  TODOs (2,152 total). Track Vitest: 87 files, 1,193 tests passed.
- `scripts/check-public-contract.sh`: passed (53 tools, 99 verbs, anti-cycle).
- Updated help golden: 13,246 bytes, SHA-256
  `9a4723ccf963c9140cd2cdf1429476b4f45f11e2628ac0ecbdc6077edec86b28`.
- Full test execution needs write permission for a sibling temporary workspace
  fixture. The runtime config override isolates tests from real native sessions.

- CI native-terminal selection: 4 files passed, 56 tests passed, 1 existing skip.
- `npm run audit:security`: passed, including the separate focus audit.
