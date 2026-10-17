# Owner purpose and delivery status table

Owner request: 2026-10-17, branch `feat/track-report-status-table`.

The report must keep the owner's purpose visible, distinguish delivery stage from work health, and
retain the exact decision expected from the owner. A version/PR is supporting evidence, never a purpose.

Decisions: add an explicit `--status-table` view rather than change existing report contracts; one row
per item, including completed/suspended work, five exact columns; preserve DÉCISIONS and decision
expectations. Persist full replacement metadata as `item.report-updated`; leave historical events,
hashes, realization and acceptance untouched. The canonical skill ships in `packages/track/skills`.

Independent design reviews covered correctness and owner value. Reconciled findings: require stage
evidence, distinguish publication/deployment, flag historical missing status in orange, preserve the
native decision dossier as authority, surface stale/conflicting declarations, document full replacement.
No owner decision remains open for these reversible implementation choices.

Validation: temporary event stores, targeted `status-table.test.ts` with red-before/green-after logs,
existing report/scoping/skill-install tests, package build. Read-only sample from the owner register WP
`01M515ED3S5WVMD3GVQ6E9WM5G`; never import/write that register from this worktree.

Review limitation: the harness-review skill requires exact author model/effort metadata and two
complementary h2a MCP legs. Those launch inputs are not exposed in this session, and the owner forbids
reaching the hidden host or installed h2a. No complementary harness consensus is claimed. Design peer
feedback above is advisory and is not an attestation of effective model identities.
