# MH-L3 continuation — passive MH-L2 amendment first

## Objective and authority
- [ ] Deliver MH-L3 against the amended source contract, including M21 against the real old central.
- [x] Owner 2026-10-15 chooses bounded option A: .7 accepts an externally conducted live transfer, never initiates one.
- [ ] Independent review of separate MH-L2 amendment commits MUST precede MH-L3 implementation.

## Scope / Guardrails
- [x] Branch feat/0.98.7-mh-l3 from 642a82f9; main and .track untouched.
- [x] Amendment scope: runtime/handover/{administration,participants,schemas,live-source,ownership,launch-memo}.js; runtime/mcp-central{,-attachment}.ts; minimal local transport cleanup if required; MH-L2 tests/helpers/scripts/docs; additive schema export; BRANCH.md.
- [x] Required-reference exception: runtime central-mcp-0980.test.ts fixture follows the existing qualified core starter; original project-byte/metadata oracles stay intact and product code is unchanged.
- [x] Reference gate matches actual module filenames; command-name-only matches are excluded. Initial overbroad diagnostic and the unrelated duplicate declaration in dispatch-characterization-goldens are retained as uncovered observations; central-mcp.test.ts is restored byte-for-byte to the base.
- [x] Optional mcp-central.test.js has no changed-module reference (rg code 1) and retains v1 HTTP-reclaim oracles incompatible with L2's frozen process-authority contract. Its blocked worker is stopped only by its proven PID/PPID/startTime; the failed supplement is retained, never called green or used to weaken v2 guards. Actual module references and L2/L4 files remain mandatory.
- [x] Cohesive authorization/retirement and proof archives may exceed 150 lines / 15 files; selective staging, revert by commit, no unrelated cleanup.
- [x] No product live conductor, target restoration or semantic compatibility verifier; no dependencies or release metadata changes.
- [x] Qualification runners pin umask 022, including direct single-file reruns; an earlier repeat inherited 002 and is retained only as a diagnostic, without attributing its failures to that setting.
- [x] No installed h2a/dist, native host, real owner state, unrelated process, Python, global test suite or force push.
- [x] English conventional commits, no attribution trailers; only this branch may be pushed.
- [x] Regression red/green and mutation proofs: 154/154 audited pairs on Node 22/24; initial cold restoration failures retained alongside two successful bounded reruns.
- [x] Prefix-sensitive tests from clean git archive + npm ci/build under umask 022; all 20 qualified source/test/runner/schema/contract files match the worktree after restoration.
- [x] Before push, enumerate every test file referencing touched files and run it; alternate spec naming checked too, no omitted references.
- [ ] Expanded reference gate is NOT green: intermittent attachments failures remain unresolved; no merge/acceptance claim.

## Lot A — source contract amendment
- [x] Dated contract amendment with owner decision and exact spec references.
- [x] Durable authenticated reservation with complete source/target/controller/inventory bindings.
- [x] Authenticated concordant publication, MH-L4 checkpoint fencing, preserved G0 drain, safe retirement.
- [x] 63 live + 2 real-source + 12 cold mutation pairs per profile, zero skips. Existing MH-L2 15/15 and MH-L4 29/29 in each profile's file campaign; initial cold image restoration failures and successful reruns remain explicit qualifications.
- [x] Separate contract/source commits and review dossier prepared for conductor handoff; own-branch push receipt belongs in mhl3b-report.md.

## Lot B — MH-L3 (after independent review)
- [ ] Shim, resume/quarantine, IDs/progress/cancellation, catalogue, evidence/transfer and M21.
- [ ] Qualification, mutations and affected targeted regressions on both Node profiles.

## Feedback / delivery
- [x] bwrap fails before command execution; reviewed shell commands stay on authorized files and private temporary test state.
- [x] Owner confinement overrides installed harness/Track recorders and installed h2a review dispatch; conductor owns independent review.
- [x] French report mhl3b-report.md with separate amendment commits, evidence, uncovered scope, deviations and agent-hour/review-round estimates; update push receipt after delivery.
