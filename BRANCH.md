# MH-L3 continuation — passive MH-L2 amendment first

## Objective and authority
- [x] Deliver MH-L3 against the amended source contract, including M21 against the real compiled old central and shim; independent MH-L3 review belongs to the conductor.
- [x] Owner 2026-10-15 chooses bounded option A: .7 accepts an externally conducted live transfer, never initiates one.
- [x] Independent MH-L2 review revl2amend-r2.md declares 513312b8 FUSIONNABLE; owner authorizes MH-L3 continuation.

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
- [x] Expanded reference gate was NOT_GREEN at 501ea371; the 2026-10-16 finding closure now qualifies attachments and affected references on Node 22/24. Historical failures remain archived; independent review still belongs to the conductor.

## Lot A — source contract amendment
- [x] Dated contract amendment with owner decision and exact spec references.
- [x] Durable authenticated reservation with complete source/target/controller/inventory bindings.
- [x] Authenticated concordant publication, MH-L4 checkpoint fencing, preserved G0 drain, safe retirement.
- [x] 63 live + 2 real-source + 12 cold mutation pairs per profile, zero skips. Existing MH-L2 15/15 and MH-L4 29/29 in each profile's file campaign; initial cold image restoration failures and successful reruns remain explicit qualifications.
- [x] Separate contract/source commits and review dossier prepared for conductor handoff; own-branch push receipt belongs in mhl3b-report.md.

## Lot B — MH-L3 (after independent review)
- [x] Shim, resume/quarantine, IDs/progress/cancellation, catalogue, evidence/transfer and M21 against the real compiled old central and shim.
- [x] Node 22.22.1 / 24.21.0: 45 explicit files and 236 tests per profile; 43 killed/restored mutation pairs per profile; zero skips, cancellations or remaining own children. Byte audit compares 45 source/test/script/schema files and 19 compiled runtime files.

## Feedback / delivery
- [x] bwrap fails before command execution; reviewed shell commands stay on authorized files and private temporary test state.
- [x] Owner confinement overrides installed harness/Track recorders and installed h2a review dispatch; conductor owns independent review.
- [x] French report mhl3b-report.md with separate amendment commits, evidence, uncovered scope, deviations and agent-hour/review-round estimates; update push receipt after delivery.

## Independent MH-L2 review closure — 2026-10-16
- [x] Previous correction run closed the six findings in revl2amend.md; MH-L3 started only after the owner supplied the independent R2 acceptance.
- [x] Scope includes the directly blocking identity/live.ts and identity/worker.ts contention fixes, their deterministic regressions, and bounded proof runners.
- [x] Contradictions are persisted before authority exceptions and observed without a barrier deadline; ABORTED grants no successor authority.
- [x] Expired barriers permit authenticated concordant forward recovery while keeping delegation, selection, entry, precheck, checkpoint, ownership and drain guards.
- [x] DELETE is refused during closed admissions; participant transfer/acquisition requires durable PUBLISHED.
- [x] Key generation is outside the writer lock; publication rechecks the gate and competing keys; workers retry only the named contention error and classify budget exhaustion as identity_timeout.
- [x] Direct central fixture supports private temporary fallback and separates its workspace from OS scratch without changing the product workspace guard.
- [x] Original red failures and subsequent diagnostics are retained; no failed/cancelled qualification is called green.
- [x] Node 22/24: 33 explicit affected files / 288 tests per profile, including all 20 MH-L2/MH-L4 files / 114 tests; six findings covered by 12 killed/restored mutations per profile, zero skips or cancellations.
- [x] Owner supplied revl2amend-r2.md: 513312b8 is FUSIONNABLE for the MH-L2 amendment. That verdict does not review this MH-L3 implementation; installed h2a, harness/Track recorders and real owner state remain inaccessible by owner instruction.

## MH-L3 continuation — 2026-10-16
- [x] Scope extends to lightweight shim state, generated descriptor, request mapping, authenticated control capacity, attachment transports, source acknowledgements, cold baselines, catalogue and passive transfer consumption; associated schemas, explicit fixtures/runners and docs are necessary.
- [x] No live conductor or semantic compatibility verifier. M21 uses a separate test executable against the real compiled old central and shim; its fixture verdict is not a .8 product claim.
- [x] Registry owner decision (16/10): all h2a MCP selections should use cluster-mesh MCP registry. Discovery is deferred to its pending contract; preserve the discovery boundary and physical/authenticated authority checks, with no fixed endpoint or future-build allowlist.
- [x] Local initialization survives absent/invalid discovery; discovery failure still forbids connection, and only ENOENT permits autostart. The initial automatic-review rejection is retained as a diagnostic, not bypassed by accepting invalid discovery.
- [x] Automatic review also rejected removing descriptor/contract checks at source registration; both remain in force. The ordinary catalogue reader is qualified independently against durable H4; wider future-source registration belongs to its contract.
- [x] Final targeted Node 22/24 qualification and all mutation/restoration receipts audited against identical bytes; raw negative diagnostics remain archived in docs/plan/mh-l3.
- [x] Delivery is split into implementation and qualification/review handoff commits. Push receipts and the French final report belong in the owner's external mhl3c-report.md; independent MH-L3 review remains with the conductor under owner confinement.
