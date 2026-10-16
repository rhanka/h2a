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
- [x] Cohesive authorization/retirement and proof archives may exceed 150 lines / 15 files; selective staging, revert by commit, no unrelated cleanup.
- [x] No product live conductor, target restoration or semantic compatibility verifier; no dependencies or release metadata changes.
- [x] No installed h2a/dist, native host, real owner state, unrelated process, Python, global test suite or force push.
- [x] English conventional commits, no attribution trailers; only this branch may be pushed.
- [ ] Regression red/green and mutation proofs; explicit affected test files on Node 22/24.
- [ ] Prefix-sensitive tests from clean git archive + npm ci/build under umask 022.
- [ ] Before push, enumerate every test file referencing touched files and run it.

## Lot A — source contract amendment
- [x] Dated contract amendment with owner decision and exact spec references.
- [ ] Durable authenticated reservation with complete source/target/controller/inventory bindings.
- [ ] Authenticated concordant publication, MH-L4 checkpoint fencing, preserved G0 drain, safe retirement.
- [ ] Nominal/refusal mutation proofs and all existing MH-L2/MH-L4 tests on both Node profiles.
- [ ] Separate commits pushed and handed to conductor for independent re-review.

## Lot B — MH-L3 (after independent review)
- [ ] Shim, resume/quarantine, IDs/progress/cancellation, catalogue, evidence/transfer and M21.
- [ ] Qualification, mutations and affected targeted regressions on both Node profiles.

## Feedback / delivery
- [x] bwrap fails before command execution; reviewed shell commands stay on authorized files and private temporary test state.
- [x] Owner confinement overrides installed harness/Track recorders and installed h2a review dispatch; conductor owns independent review.
- [ ] French report mhl3b-report.md with separate amendment commits, evidence, uncovered scope, deviations and agent-hour/review-round estimates.
