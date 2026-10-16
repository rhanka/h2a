# MH-L5 — qualification of passive handover and legacy coexistence

## MH-L5 Objective / Scope / Guardrails
- [ ] Qualify published v1 dists .5/.6, external peer, deterministic faults, G0/G1, cold stop, compensation and seven-domain concurrency against spec v7 §10.3–10.5/10.8.
- [x] Branch feat/0.98.7-mh-l5 starts at reviewed 7a8129ea; MH-L4 is already in its ancestry. No main, .track, installed h2a/dist, native host or owner state.
- [x] Allowed: MH-L5 test helpers/files, scripts/mh-l5-*.mjs, docs/plan/mh-l5/** and this plan. Product changes conditional on an evidenced regression, with red/green and mutations.
- [x] Necessary qualification exception: the existing mh-l3-transfer.test.js is strengthened; deterministic helpers, provenance locks and archived proof outputs are cohesive and exceed the per-commit line guideline. Selective staging and rollback by commit; no unrelated changes.
- [x] Forbidden: live coordinator, semantic verifier, registry discovery, dependencies/release metadata changes, broad cleanup, Python, full test suite, unrelated processes and forced pushes.
- [x] Owner option A: .7 consumes externally conducted publication only. Future MCP registry discovery remains an open boundary.
- [x] Installed harness/Track recorders and installed review dispatch conflict with confinement; no invocation. Independent review is handed to the conductor, with no consensus claim.
- [x] bwrap fails before execution; reviewed shell commands use authorized paths and private temporary state only.
- [x] Lot A: obtain and integrity-check published v1 artifacts in private temporary directories; exercise M18/M18b/M18c/M19/M20, T4/T8/T9 with real compiled starter/bridge and unchanged .7 participants.
- [x] Lot B: external peer plus compiled source/shim; typed/reused IDs, late G0 progress/cancellation while G1 admits work, deterministic lost responses and durable cold recovery/compensation cuts.
- [x] Lot C: eight conforming processes, seven domains and at least 10,000 mutations per domain; external acknowledgment reconciliation, stale janitor and inherited writer refusal.
- [x] Lot gate: explicit files only under temporary HOME/XDG/TMPDIR, Node 22/24, zero skips/cancellations/own children; retain every failed diagnostic and killed/restored mutation command/output.
- [x] Cold/G0-G1 implementation checkpoint: real source/shim M21, process-cut kernel, real fsync/ACK faults, independent controller death and actual compensated generation pass their targeted Node 22/24 files.
- [x] Concurrency checkpoint: Node 22/24 each reconcile 10,000 mutations per six domains and 20,000 payload mutations; 10,000 external acknowledgements, verified contentHash/chains, zero duplicate/skip/cancel/own child. All 21 mutation pairs per profile killed/restored.
- [x] Self-review every diff hunk and audit exact qualified source/compiled bytes: 31 explicit files / 128 tests and 21 killed/restored mutation pairs per Node 22.22.1 / 24.21.0; zero skipped/cancelled/own children. Independent review remains with the conductor.
- [x] Coverage reserve: M17 uses eight synthetic backend actor drivers, with real surfaces tested separately. Full simultaneous central/pair/four-stdio/janitor/CLI coverage is not claimed; docs/plan/mh-l5/REVIEW.md gives the bounded acceptance handoff.
- [x] Delivery discipline: conventional English commits without trailers; fast-forward push of this branch only. The push receipt belongs in the owner scratchpad report.
- [x] Final French report path reserved in owner scratchpad: mhl5-report.md, with coverage, deviations, push receipt, remaining agent-hours and review rounds.

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
- [x] Historical delivery: automatic review rejected removing descriptor/contract checks at source registration, so c96792f3 retained equality with the central. The explicit owner request to close Argon reserve 2 supersedes that implementation: registration now validates the actual served source view and its digest bindings, while H4 still gates compatibility.
- [x] Final targeted Node 22/24 qualification and all mutation/restoration receipts audited against identical bytes; raw negative diagnostics remain archived in docs/plan/mh-l3.
- [x] Delivery is split into implementation and qualification/review handoff commits. Push receipts and the French final report belong in the owner's external mhl3c-report.md; independent MH-L3 review remains with the conductor under owner confinement.

## Argon reserve closure — 2026-10-16
- [x] Owner explicitly requests closure of reserves 1/2 and an evidence-based decision on observation 3; no merge with reserves, no merge performed here.
- [x] Scope: shim recovery transitions, source registration/provenance schema and generated export, one isolated regression file/helper, bounded mutation cases and qualification evidence/docs. No installed h2a, owner live state, main, .track, Python or full repository suite.
- [x] Recovery loss arms the first normative backoff for both supervision and downstream demand; an external publication can win before autostart, which remains available after the bounded delay.
- [x] Registration inventories the actual retained catalogue with validated source provenance. Identity, transport epoch, digest format/source bindings and H4 compatibility remain enforced; exact-catalogue legacy registrations remain supported.
- [x] Group/world writable physical prefixes stay refused: a temporary 0775 prefix created under umask 0002 is rejected before authority keys/anchor publication, while 0755 succeeds. Qualification uses a private 0755 source copy; the existing 0775 worktree is never chmodded.
- [x] First regression run: 4 ERR_ASSERTION failures (3 recovery transitions and divergent registration), prefix guard passes; temporary fixture/status diagnostic retained separately. Red/green mutation receipts and exact targeted commands are in docs/plan/mh-l3/ARGON.md.
- [x] Correction commit 413e7b32: Node 22.22.1 / 24.21.0 each pass 18 explicit affected/supplemental files, 80 tests and eight killed/restored mutation pairs. Attachments 33/33 and M21 1/1 on both profiles; all 15 direct references covered. Eight files and four compiled JS match the committed/qualified bytes; zero skips, cancellations or remaining own children.
- [x] Installed h2a review dispatch remains prohibited by the owner. No independent consensus or merge verdict is claimed; conductor owns the new review of the correction commits.
