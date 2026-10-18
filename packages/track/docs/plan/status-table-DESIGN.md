# Owner purpose and delivery status table — SUPERSEDED by amendment D1–D14 (criteria 28–41)

> Superseded by the 2026-10-18 amendment appended to
> `docs/specs/2026-07-29-track-report-period.md` (criteria 28–41, tracing
> owner decisions D1–D14). The current contract below is history: the
> incompatible decisions are struck through in place and kept visible, not
> deleted. The surviving rules (stage-evidence requirements, reopening guards,
> mandatory red proposal, native decision dossiers) live on as derivation
> rules D5–D7 of that amendment.

Owner request: 2026-10-17, branch `feat/track-report-status-table`.

The report must keep the owner's purpose visible, distinguish delivery stage from work health, and
retain the exact decision expected from the owner. A version/PR is supporting evidence, never a purpose.

## Current contract (history — superseded where struck)

Decisions (original 2026-10-17 text, with amendment rulings):

- ~~add an explicit `--status-table` view rather than change existing report contracts~~ —
  withdrawn by D1: `--status-table` selects the validated four-section report, no second projection.
- ~~one row per item, including completed/suspended work~~ — withdrawn by D1/D3: the validated
  sections keep their membership; stage/status annotate identifiable tracked items per-row in À-FAIRE.
- ~~five exact columns~~ (`# · Ta demande · Étape · Statut · Où ça en est / prochaine action`) —
  withdrawn by D1/D3: À-FAIRE has exactly seven columns
  `WP · av. · stage · status · à faire · bloqué · prochaine action`.
- preserve DÉCISIONS and decision expectations — KEPT (D12).
- Persist full replacement metadata as `item.report-updated`; leave historical events,
  hashes, realization and acceptance untouched — KEPT as read-compatible (P1); derivation is primary (D2).
- ~~The canonical skill ships in `packages/track/skills`~~ — withdrawn by D13: the canonical skill is
  `packages/h2a/skills/harness/track-report/SKILL.md` alone; the duplicate is removed from the bundle.
- ~~flag historical missing status in orange~~ — withdrawn by D8: absence of qualification renders
  `not-qualified` without colour; 🟠 keeps the owner meaning of an unforeseen event that occurred.

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
