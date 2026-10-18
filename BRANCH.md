# PTY Phase B — PR #375, continuation 2026-10-18

Owner scope: apply the approved amendments, close B4, repair the three Linux CI jobs, implement B5, then stop. No Phase L or second standing PTY owner. Start: af46490d8, origin/main initially 46b82b427; subsequently rebased without conflicts onto 7ebbcf266 before publication. Temporary test roots only; targeted files only; no installed h2a, owner state, Python or foreign processes.

## Owner-approved continuation — 2026-10-18 (092bcaecb)

Only the intersection of rvptyam2a-last.md and rvptyam2s-last.md is authorized. Both exact amendment wordings are preserved below. Apply the stricter combined requirements: 26 declarations (23 Node + 3 runtime; 3 skipped + 23 TODO); no retirement without an atomic admission fence on every existing/new connection; explicit nonempty conductor enrollment with binary/version/seat/platform/isolated configuration; all four complete B5 files, no skip/TODO/cancellation; Linux Node 22/24 then macOS ARM64 Node 22/24 after BM. The B4 Linux keepalive exception does not extend to B5.

Source: rvptyam2a-last.md

> Ajouter `scripts/test-non-tests-0986.json` et `packages/h2a/test/gate-execution-evidence.test.js` au périmètre B4, exclusivement pour retirer l’identité supervisor désignée dans le diff et synchroniser les comptes : **26 entrées, 23 Node, 3 runtime**. Conserver les contrôles de disparition, changement de statut et ignore non déclaré.

> Un hôte pré-B sans fermeture effective de toutes les admissions reste accessible et inventorié ; son retrait automatique est explicitement différé. Un marqueur client ou une observation ponctuelle de liste vide ne l’autorise pas. Les critères B5 d’admission et de retrait restent ouverts jusqu’à preuve couvrant les connexions v1 déjà établies et les créations concurrentes.

> Avant exécution, le conducteur fixe une cohorte non vide de vrais CLI, leurs versions, sièges et plateformes. Tous les membres enrôlés et les quatre fichiers B5 doivent réussir ; absence, indisponibilité, ignore, TODO ou annulation empêchent le verdict vert. La qualification nomme exactement les CLI et plateformes prouvés. L’exception keepalive reste limitée à B4 Linux.

Source: rvptyam2s-last.md

> Ajouter à l’allow-list B4 `scripts/test-non-tests-0986.json` et `packages/h2a/test/gate-execution-evidence.test.js`, exclusivement pour retirer l’entrée supervisor désignée par le diff et synchroniser les comptes : **26 entrées, 23 Node + 3 runtime, 3 skipped, 23 TODO**. Conserver les contrôles de disparition, d’activation et d’ignores non déclarés.

> Pour un propriétaire pré-B sans gel atomique d’admission couvrant toutes les connexions, y compris v1 déjà ouvertes, le retrait automatique reste `deferred`. Conserver les sessions, leur endpoint et les installations nécessaires. Une observation `list` vide n’autorise aucun signal d’arrêt. Le critère B5 interdisant les créations après drainage reste obligatoire et bloquant.

> Avant le gate, le conducteur consigne une liste **non vide** de CLI/sièges réellement enrôlés, leurs binaires, versions et configurations isolées dans `H2A_TEST_PHASE_B_CLIS`. Exécuter chaque entrée dans le fichier B5 nommé. Zéro entrée signifie qualification incomplète avec échec explicite. Qualifier Linux d’abord ; qualifier macOS ARM64 après BM. Chaque verdict exige les quatre fichiers B5 complets, tous les cas requis réussis, zéro ignore, TODO ou annulation. Aucun lot L ne démarre avant le vert B5 de sa plateforme.

The rejected marker-only contract and the unsafe draft monitor are not accepted. Pre-B admission and retirement criteria remain OPEN until an atomic barrier or a new reviewed contract exists; an empty list or owner handshake is never permission to signal. Real CLI availability is not inferred from synthetic seat fixtures. No Phase L work.

### Amendment execution proof

- Registry RED: `rtk node tmp/pty-am2-run.mjs pty-am2-registry-red node --test packages/h2a/test/gate-execution-evidence.test.js` → 71 tests, 69 pass, 2 fail (27≠26 and 4≠3), zero skip/TODO/cancellation, exit 1. The two cardinality expectations were updated before removing the manifest entry.
- Actual supervisor report: `rtk node tmp/pty-am2-run.mjs pty-am2-supervisor-before node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=4 packages/h2a-runtime/src/native-terminal/supervisor.test.ts` → 16/16 pass, zero skips, exit 0. `rtk node tmp/pty-am2-verify.mjs pty-am2-verifier-red` → exactly one `declared non-test disappeared` error, exit 1.
- Minimal repair removes only the obsolete supervisor declaration and synchronizes the registry test counts. `rtk node tmp/pty-am2-run.mjs pty-am2-registry-green node --test packages/h2a/test/gate-execution-evidence.test.js` → 71/71 pass, zero skip/TODO/cancellation, exit 0. `rtk node tmp/pty-am2-verify.mjs pty-am2-verifier-green` → zero verifier errors, exit 0, same supervisor report. Its added undeclared-ignore negative control is rejected both before and after. Production verifier and all lifecycle assertions are untouched.
- A first wrapper setup used a nonconforming temporary qualification-root name and executed zero tests. It is a setup failure, not regression RED; the corrected wrapper uses a fresh `/tmp/h2a-qual-*` plus temporary HOME/XDG directories, with the unchanged isolation helper.
- origin/main is already an ancestor of this branch (22 branch-only commits at the initial fetch); no rebase required. No installed host/state accessed, no full local suite.

## Approved amendments (verbatim)

The two AMENDEMENTS-GO reviews below are accepted by the owner. Their fixture addition applies to the reopened B2 regression and the Linux B4 gate. The single keepalive exception is limited to B4 Linux; all other gate cases require zero skips, TODOs or cancellations.

Source: revptyama-last.md

> Par exception à D27/§5, le gate **B4 Linux uniquement** distingue comme non-test préexistant `packages/h2a/test/cli-contract.test.js :: keepalive emits a action envelope on the happy path`. La commande complète reste exécutée sans filtrage ; son ignore reste affiché dans les comptes bruts. Tous les autres cas requis doivent réussir, sans ignore, TODO ni annulation. Cette exception cesse à sa réactivation ; elle ne modifie ni DEC-034 ni les autres gates.

> Ajouter `packages/h2a/test/native-inventory-absence.test.js` à l’allow-list et au gate Linux B4, uniquement pour adapter l’observation et le nettoyage au split B2. Après les assertions, terminer les seules sessions créées par la fixture, observer la fin du propriétaire effectif et garantir le nettoyage de ses descendants privés, y compris sur échec. Préserver les scénarios historiques et toutes les assertions d’inventaire, d’identité et de refus. Utiliser le helper d’isolation sans le modifier. Exiger une preuve rouge puis verte du fichier complet, avec le build historique temporaire provisionné et zéro ignore.

> Ajouter `packages/h2a-runtime/src/native-terminal/publication-refusal.ts` à BM, exclusivement pour le refus `H2A_PUBLICATION_LOCK_PATH_UNUSABLE`, son diagnostic stable et le code de sortie 3. Les refus existants et les gates BM restent inchangés.

> Ajouter `packages/h2a-runtime/src/native-terminal/owner-process.ts` à BM, uniquement pour admettre Darwin dans `assertOwnerFrontendSupported` et adapter le diagnostic associé. L’admission repose sur le substrat et les preuves exigés par BM ; Linux reste inchangé, les autres plateformes restent refusées. Aucune modification du cycle de vie owner/frontend n’est autorisée par cet ajout.

> jusqu’à BM

Source: revptyams-last.md

> Par exception à §5/D27, seul `keepalive emits a action envelope on the happy path`, dans `packages/h2a/test/cli-contract.test.js`, est déclaré non-test pour B4 Linux. Les quatre fichiers restent exécutés intégralement ; les comptes bruts sont publiés ; tout autre ignore, TODO, échec ou annulation bloque le gate. Le contrat et l’implémentation de `keepalive` restent hors du chantier PTY.

> Réouvrir la régression B2 avant B5 : ajouter `packages/h2a/test/native-inventory-absence.test.js` à son allow-list et à son ensemble Linux. Adapter exclusivement l’observation des sorties et le nettoyage aux propriétaires B : terminer les seules sessions créées par la fixture, puis attendre la sortie effective du propriétaire drainé. Conserver les démarrages historiques explicites en `process.js`, les assertions d’inventaire et le helper d’isolation inchangés. Preuve ciblée avant/après ; fichier entier vert, zéro ignore, avec le build historique isolé requis.

> Ajouter à l’allow-list BM `packages/h2a-runtime/src/native-terminal/publication-refusal.ts`, exclusivement pour `H2A_PUBLICATION_LOCK_PATH_UNUSABLE`, son diagnostic et son refus avec code de sortie 3. Conserver tous les refus existants ; vérifier le dépassement du budget du chemin du verrou et les régressions Linux.

> Ajouter à l’allow-list BM `packages/h2a-runtime/src/native-terminal/owner-process.ts`, uniquement pour admettre `darwin` dans `assertOwnerFrontendSupported` après le port du substrat BM, et adapter le diagnostic associé. Toute autre plateforme reste refusée. Aucune modification de lifecycle, drain, confinement ou transfert n’est autorisée par cet ajout. Les gates BM restent exigées.

## Work and evidence

- [x] Amendments recorded before the fixture/B5 changes; original spec remains unchanged.
- [x] B4 complete file gates, raw keepalive non-test count visible.
- [x] Reopened B2 inventory fixture: full RED/green with isolated historical build.
- [ ] B5: legacy drain, Bash/readline, scripted real attach; enrolled real CLI list requested from conductor.
- [ ] Linux Node 22/24 + trust-root CI and macOS ARM64 Node 22/24 outcomes.

## Continuation evidence

- B4 builds: `rtk npm run build -w @sentropic/h2a-runtime` and `rtk npm run build -w @sentropic/h2a`, exit 0; logs `tmp/pty-b4-build-{runtime,cli}.log`.
- B4 installed-artifact RED: four complete-file failures (58 tests: 54 pass, 4 fail, 0 skip), missing CLI facade dependency in the disposable candidate. The qualification now packs and installs the actual built runtime/CLI/Track tarballs in one temporary prefix, attesting all versions. Intermediate ETARGET for unreleased Track was a failed setup, never a green gate.
- B4 after that repair, also after B5 supervisor changes: `rtk node tmp/pty-run.mjs node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=4 packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts packages/h2a-runtime/src/native-terminal/journal.test.ts packages/h2a-runtime/src/native-terminal/supervisor.test.ts`: 4 files, 58 pass, 0 fail, 0 skip, exit 0 (`tmp/pty-b4-post-b5.log`).
- Node B4: `rtk node tmp/pty-run.mjs node --test packages/h2a/test/upgrade.test.js packages/h2a/test/upgrade-swap.test.js packages/h2a/test/upgrade-boot-worker.test.js packages/h2a/test/cli-contract.test.js`: 167 tests, 166 pass, 0 fail, 0 cancelled, 1 skip (the exact approved keepalive non-test), 0 TODO, exit 0 (`tmp/pty-b4-post-b5-node.log`).
- Inventory root: all three original Linux CI jobs run the same failing fixture. Its missing owner exit receipt and incomplete teardown produce suite errors, followed by execution-proof refusals. No trust-root, inventory allowlist or ci.yml change is proposed.
- Inventory RED on af46490d8: full file, isolated historical build `89bbd9af1033153b6654c272e126d91e0fa42683^`, 37 tests, 23 pass, 14 fail, 0 skip, exit 1 (`tmp/pty-inventory-red-clean.log`). This short-root diagnostic additionally exposes two MCP workspace refusals under /tmp. A second baseline resolves imports from the original file directory and uses the ordinary repo .q fixture root, so MCP's durable-workspace refusal is preserved without changing its assertions.
- Inotify allocation fails with EMFILE in this environment; the original watcher is emulated by a polling-only temporary preload for baseline observation. Product and isolation helper stay untouched. The first mixed build/test diagnostic is invalid and is not used as RED evidence. Final fixture observation polls receipts directly; its deadline follows B2's 10-second frontend-channel close plus bounded journal flush.
- Failed baseline campaigns left private descendants. They were stopped only from their recorded private proc receipts and verified pinned identities, never by a process-name pattern. Final fixture cleanup uses the unchanged helper in a finally block, including on assertion failure.
- B5 initial legacy RED: 4 fail, 0 pass, 0 skip, exit 1 (`tmp/pty-b5-legacy-red.log`); after implementation 22/22 with fleet/op unit suites, zero skips. A further pinned ensure-host regression: 1 fail, 3 pass, 0 skip (`tmp/pty-b5-pinned-red.log`), then fixed for both explicit and selected endpoints.
- B5 Bash/readline and the three scripted D21 cuts already pass on the B4 base (4 pass). The scripted qualification exchanges 32 numbered inputs per cut through real attach and preserves actual CLI/owner births. With no enrolled real CLI, the fifth case FAILS explicitly; it is never skipped or counted green (`tmp/pty-b5-agent-red.log`). The conductor's enrollment list/configuration has been requested; Phase B qualification cannot be claimed until supplied.
- Inventory of v1 pre-B fused hosts exposes loadedVersion=unknown because those hosts never advertised their build; the observer never substitutes its own version. B owners/frontend versions are reported from their actual handshake.
- No Phase L, PTY transfer, guardian-v2 backend, second standing owner, or real-state access. No full local suite. Full CI remains the conductor/integration lane.

## Final inventory proof before rebase

- Baseline af46490d8 complete file in the repository temporary fixture root: `rtk env H2A_TEST_REQUIRE_LEGACY_HOST=1 node --input-type=module` launches `node --import ./tmp/pty-watch-fallback.mjs --test --test-force-exit tmp/pty-inventory-baseline.test.mjs` with the historical build; original assertions/code, only import paths and repo constant resolved from the original directory. Output: 37 tests, 23 pass, 14 fail, 0 cancelled, 0 skip, 0 TODO, exit 1 (`tmp/pty-inventory-red-reporoot.log`).
- A complete intermediate run exposed a disappeared-descendant proc-open race during cleanup: 36 pass, 1 fail, 0 skip. Retry is limited to ENOENT/ESRCH while pinning; all other failures remain errors and the helper still requires every private writer gone.
- Final command: `rtk node tmp/pty-run.mjs node --test packages/h2a/test/native-inventory-absence.test.js`. Output: 37 tests, 37 pass, 0 fail, 0 cancelled, 0 skip, 0 TODO, exit 0, 358700.255211ms (`tmp/pty-inventory-final2.log`). No force-exit or polling preload in this green command.
- The fixture now observes owner-process.js as well as explicit historical process.js; closes its clients, ends only sessions on its own endpoints, observes actual owner exit within B2's shutdown bound, and always reaps its private descendants through the unchanged isolation helper. All historical scenarios and inventory/identity/refusal assertions are unchanged.
- B5's complete four-file Linux run: 27 pass, 1 fail, 0 skip, exit 1; the sole failure explicitly reports no conductor-enrolled real CLI (`tmp/pty-b5-gate.log`). The added routing regression and explicit-socket admission checks pass. B5 implementation/qualification remains pending, never claimed complete.
- origin/main advanced to 7ebbcf266 (#374) during qualification. Rebase required before push; no PTY file overlaps in the new base. Dedicated macOS CI stays the BM/B3/B4 gate until the B5 enrollment is available.

## CI root analysis on 467dff4e0 / pending bounded amendment

- Actual Linux CI 39159982115 is RED on all three jobs. The fixture assertions pass, but the Node campaign exceeds its unchanged 600000ms backstop; its missing final JSON causes the broad NEVER EXECUTED cascade. This is not a green CI claim.
- A fenced launch against a B owner also starts an idle second B owner on lf1. New real-upgrade regression: 10 pass, 1 fail, 0 skip, exit 1; the mate socket exists after a frontend upgrade (tmp/pty-single-owner-red2.log). This violates the single-owner goal and adds redundant startup/teardown cost to inventory qualification. Repair stays in op.ts (B5 scope) and the existing B4 upgrade-contract file; historical fused-host assertions remain unchanged. Fixture-owned endpoint shutdown is observed concurrently, all results settled before cleanup. No test or CI timeout is increased.
- Independent execution-proof failure: supervisor.test.ts's empty skipped placeholder was removed in the inherited Phase B diff, but its versioned non-test declaration remains. The unchanged production verifier rejects the 16/16 passing targeted report solely with declared non-test disappeared. A temporary proposed manifest removes exactly that obsolete entry; the same verifier then returns zero failures. Proposed six-line diff: tmp/pty-ci-declaration-amendment.diff; proof: tmp/pty-ci-declaration-proof.log. No tracked manifest edit has been made.
- REQUESTED, NOT APPROVED/APPLIED: add scripts/test-non-tests-0986.json to B4 exclusively to remove that obsolete supervisor placeholder entry. No active test, other declaration or gate changes. Spec §5 requires an amendment before any file outside the closed list is edited. Native owner question is pending.
- B5 adversarial RED: a real pre-B v1 connection accepts create after the launcher marker (tmp/pty-b5-legacy-admission-red.log: 5 pass, 1 fail, 0 skip). A client-side marker cannot fence that legacy server. The B5 draft is withheld and now refuses automatic retirement of an uncapable fused host, preserving its sessions. This limitation is not approved as a reduction of D5, and B5 is not complete. The actual enrolled CLI list is also still missing.
- present-decision calibration: the obsolete-ledger removal is a local reversible scope-maintenance ask, with no change to real coverage. The legacy admission contract remains a separate unresolved safety criterion; no reduction is silently chosen, no complete decision dossier or independent review is claimed. Scope/confinement prohibit Track/installed-h2a writes; evidence stays in these notes and the PR.

## Linux CI root fixes after 467dff4e0

- The successful frontend startup left a referenced 10000ms deadline alive. With no sessions and all channels closed, the owner still could not exit until that timer elapsed. The new empty-owner regression fails before correction: `rtk node tmp/pty-run.mjs node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=4 packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts`, 12 tests, 11 pass, 1 fail, 0 skip, exit 1 (`tmp/pty-owner-empty-red-clean.log`). The launcher regression on its preceding base was 11 tests, 10 pass, 1 fail, 0 skip, exit 1 (`tmp/pty-single-owner-red2.log`), same complete-file command.
- Repair: always cancel the startup deadline after its ready/timeout race; a certified B endpoint is sufficient for launch admission without starting an empty mate owner. No owner is signalled by upgrade. Inventory fixture host shutdown settles both private endpoints concurrently; the receipt deadline is restored to its original 3000ms. Neither CI's 600000ms backstop nor any product shutdown deadline is increased.
- Static gate: `rtk npm run build -w @sentropic/h2a-runtime` and `rtk npm run build -w @sentropic/h2a`, exit 0 (`tmp/pty-timer-build-runtime.log`, `tmp/pty-timer-build-cli.log`).
- GREEN runtime command: `rtk node tmp/pty-run.mjs node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts --maxWorkers=4 packages/h2a-runtime/src/native-terminal/upgrade-pty-contract.test.ts packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts packages/h2a-runtime/src/native-terminal/journal.test.ts packages/h2a-runtime/src/native-terminal/supervisor.test.ts packages/h2a-runtime/src/native-terminal/owner-frontend.functional.test.ts`. Output: 5 files passed, 67 tests passed, 0 failed/skipped, exit 0, 42.74s (`tmp/pty-timer-gate.log`, JSON `tmp/pty-timer-gate.json`). These are the four B4 files plus the B2 owner lifecycle file.
- GREEN Node command: `rtk node tmp/pty-run.mjs node --test packages/h2a/test/upgrade.test.js packages/h2a/test/upgrade-swap.test.js packages/h2a/test/upgrade-boot-worker.test.js packages/h2a/test/cli-contract.test.js`. Output: 167 tests, 166 pass, 0 fail/cancelled/TODO, 1 skip (only the approved keepalive non-test), exit 0 (`tmp/pty-timer-node-b4.log`).
- GREEN complete inventory command: `rtk node tmp/pty-run.mjs node --test packages/h2a/test/native-inventory-absence.test.js`. Output: 37 tests, 37 pass, 0 fail/cancelled/skipped/TODO, exit 0, 278299.647571ms (`tmp/pty-timer-inventory-green.log`), against the provisioned historical build. No forced exit or baseline preload. This is local targeted evidence, not a full Linux CI verdict.
- Published CI at 467dff4e0: Linux run 39159982115 has three failed jobs; macOS ARM64 run 39159981983 has two successful jobs (Node 22 and 24, each 111 runtime + 61 Node tests, zero skips). The new source fixes require fresh CI. The obsolete non-test ledger amendment above is still pending; that independent verifier failure remains until explicitly authorized.
- Scope audit: these source changes touch only op.ts (B5), owner-process.ts and upgrade-pty-contract.test.ts (B4/B2), and the explicitly amended inventory fixture. No shipped helper, gate policy, unlisted source or Phase L code is changed. B5 legacy admission and enrolled CLI qualification remain unresolved; the safe incomplete draft is saved in stash da2057db031db79417da3af88ac68b8e18b26f16, not published.

# Inherited branch notes

# Dossier diagrams — h2a lots

## Objective
- [ ] Deliver H1 evidence and matching H4; prepare H2 at its published DS boundary.

## Scope / Guardrails
- [x] Branch feat/dossier-diagrams; immutable v1, explicit schemaVersion: 2.
- [x] Named test files only; disposable HOME/XDG/TMP; no Python or owner state.
- [x] Allowed: packages/focus/{src,tests,schemas,skills,registry,package.json}; packages/h2a/{src/focus-build.ts,focus-kit,test/focus-build.test.js,test/distribution-increments.test.js,package.json}; scripts/{build-focus-dossier,focus-vendor-lib,vendor-focus,check-focus-vendor}.mjs; generated packages/track/src/focus-vendor; packages/track/skills/present-decision; docs/focus; docs/reviews/dossier-diagrams.md; .github/workflows/focus-dossier.yml; BRANCH.md.
- [x] Forbidden: other repos, main, installed h2a, native host, owner state, unrelated processes, workflow changes outside Focus qualification.
- [x] BRDG-EX3: docs/focus/diagram-renderer-contract.md and docs/reviews/dossier-diagrams/** hold the dependency handoff and qualification evidence; generated vendor commits may exceed the file-count guideline.
- [x] BRDG-EX2: frozen corpus/calibration manifests and old-validator fixture are generated qualification artifacts; their commits may exceed 150 lines.
- [x] BRDG-EX1: generated schemas/vendor/renderer/locks may exceed the harness 150-line limit; regenerate reproducibly, rollback by regeneration from prior sources. No Makefile exists; selective git commits replace make commit.
- [x] PR #377 correction scope: scripts/run-tests.mjs and its prepared-npm-cache.test.js / node-track-observation-lab.js witness preserve the prepared cache through HOME isolation.

## Lots
- [x] H1a contract: model, byte integrity, closed validation, version schema; tests/evidence.spec.ts, schema.spec.ts.
- [x] H1b reading/export: summaries counted, raw bytes separately accounted; readability.spec.ts, render.spec.ts.
- [x] H1c build: atomic output, explicit evidence template, metadata; test/focus-build.test.js.
- [x] H1d renderer: offline citation/search/download/back and bounded DOM; evidence-browser.test.mjs.
- [x] H1e qualification: frozen numeric small/large policy and real corpus; evidence-performance-browser.test.mjs.
- [ ] H2 blocked: npm E404 for @sentropic/diagram-core and @sentropic/diagram-canvas 0.1.0; DS2 exact tarballs required.
- [ ] H3 blocked: H2 + DS4/DS5 renderer/control exports; no Focus toolbar substitute.
- [x] H4-H1: regenerated assets/vendor, capability manifest, skills/docs, fresh tarball template/build/open; packaging.spec.ts, distribution-increments.test.js.
- [x] Delivery: targeted gates, one draft PR #377, own-branch push, per-job CI report; full integration checks remain visible in PR.

## Feedback Loop
- [x] rv377 A/S P1: prepared cache lost with isolated HOME; targeted production-entry witness RED 0/1 (run-g0jSGX) → GREEN 1/1 (run-kpLhOI), distribution 1/1 (run-KsxQ1q), zero skips. Logs: /home/antoinefa/.cache-tmp/diag377-evidence-B189hY.
- [x] rv377 S P2 schema: image metadata conditional parity; schema 3 RED / 46 → 46/46 GREEN, registry and vendor digests regenerated; no v1 change.
- [x] rv377 A/S P2 navigation and S P3 annex: stale search/actual viewport/latest opener/colliding app id, browser 4 RED / 5 → 5/5 GREEN at 320/390/1440px, keyboard/touch; run-e7kyZs → run-3k7fBu.
- [x] rv377 qualification: 195 targeted tests pass, zero skips; G5a run-CMDhRx passes unchanged budgets on corrected assets, review377-metrics.json retains all samples/hashes.
- [x] rv377 CI shallow checkout: exact frozen corpus reference fetched without changing the tested tree; depth-one clone witness 0/1 RED (run-iunwUR) → 1/1 GREEN (run-x3Rgqq), original 1,731 blobs/bytes retained, no numeric budget change. Final targeted total 196.
- [x] H4 méthode : témoins install-skills 17/17 et shared-skills 3/3 ; budget present-decision 1/13 RED → 13/13 GREEN, instructions 835 mots et audit sous 300, seuils conservés.
- [x] Race RSS : statm du même PID confirme un espace vide avant l'état zombie ; instrumentations vivantes/absentes toujours bloquantes. 2/6 RED → 6/6 GREEN ; G5a 30/30 aux mêmes budgets.
- [x] CI corpus : remplacement de la dépendance aux fichiers de travail par 1 731 blobs de sources techniques figés ; recalibration et qualification 30/30 GREEN aux mêmes budgets, run-BttLAh.
- [x] CI second passage : retrait des faux prérequis de développement/musl ; cache basé sur la fermeture runtime et os/cpu/libc, 190 tarballs, 1/1 distribution et 2/2 navigateur GREEN, zéro skip.
- [x] CI initiale : ENOTCACHED @hono/mcp ; fermeture npm verrouillée et cache temporaire sans métadonnées registre, RED commander puis 1/1 distribution et 2/2 navigateur GREEN, zéro skip.
- [x] Supplied spec reviews agree GO-CODE at 34b0b43a.
- [x] Implementation review selection-failed: owner confinement forbids installed h2a/live mesh; docs/reviews/dossier-diagrams.md.

# Inherited origin/main history

# Live disclosure authority — owner decision 2026-10-17

- [x] Scope: Δ-L7a on `feat/live-disclosure-authority`, based on origin/main.
- [x] Reference: engram plan/09 and SPEC_LIVE_GIT_INDEXING at e417c33c,
  including the Read side amendment (repository/provider/scope/duration).
- [x] Allowed implementation: gateway-host/live-{auth,disclosure,host}.ts,
  live-auth.test.ts and live-disclosure.test.ts; branch/review evidence only.
- [x] Guardrails: temporary test roots, Node 22/24, targeted files only;
  no installed h2a, owner state, Python, Track writes or provider calls.
- [x] Lot A: registered Ed25519 host proof, live audience, current declaration,
  host-local tenant, expiry, operations and revocation; default denial.
- [x] Lot A evidence: 14 behavioural failures before implementation, then
  14/14 pass; no session or enrollment fallback.
- [x] Lot B: explicit grants, exact paths/surfaces, mandatory L4b policy,
  before-handoff revalidation, opaque audit receipts, no snapshot archive.
- [x] Lot C: G4 fails with policy-unavailable until an actual L8 contract
  exists; isolated emitted consumer proof and targeted Node 22/24 checks.
- [x] Lot B/C evidence: 39 behavioural failures before grants/audit, then
  53/53 disclosure tests. Seven additional regressions observed red then green:
  final-policy state replacement, async audit, throwing clock, revoked issuing
  proof with fresh emit proof, backwards grant start, and independent read
  authority missing from emission, and late provider redirection. Compiler
  and test-type errors were corrected separately, not counted as RED evidence.
- [x] Qualification: exact auth/disclosure/registration files, 90/90 on
  Node 22.22.1 and 24.18.0, zero skips; repository and test typechecks pass.
- [x] Lot D: English conventional commits, own-branch push and PR #367; CI job
  outcomes and remaining qualification limits in the requested owner report.
- [x] Feedback: #342/#343 deliver declarations/GitHub/retention, not L7a
  verified authority or L8 policy. The old unverified registration guard stays.
- [x] Feedback: installed h2a/mesh review launch is forbidden by confinement;
  record selection failure and claim no independent consensus or merge gate.

## Tour 2 — independent review rev367

- [x] Rebased onto origin/main; no merge of main. Push uses the owner-required
  force-with-lease exception for this rebase, only on our feature branch.
- [x] L4b-2 exhaustive deterministic exclusions at engram e417c33c: five secret
  rules, all protected basenames/prefix/suffix/segments, secret-bearing paths;
  each rule/alternative on all surfaces and every two-fragment split.
- [x] Final emission requires one host snapshot lease spanning authority,
  revocation, state, read access, content decisions, clock and bound transport.
  Data-only validation and synchronous send share that lease; no unlocked fallback.
- [x] Correct refusal codes and attempt ordering; authentication before grant
  lookup, correlated revoke refusals, revoke survives policy/declaration drift;
  no foreign state lookup before signed repository scope verification.
- [x] Complete evidence ID coverage is required, including composed fragments.
- [x] Snapshot authorizations must match the exact caller and issuing proof IDs;
  same-owner proof substitution produced 2 RED failures before its guard.
- [x] RED baseline: 67 behavioural failures / 172 tests, zero skips; execution
  proof also rejects the old duplicate test names. GREEN: 172/172 on Linux
  Node 22.22.1 and 24.18.0, zero skips; production execution-proof verifier
  accepts each three-file targeted report; strict test and repo types pass.
- [x] Fixed the duplicate parameterized secret-test identity that caused the
  three previous CI execution-not-proven failures; no gate was weakened.
- [x] No production snapshot adapter or independent peer consensus claimed;
  missing snapshot authority denies emission and G4 stays policy-unavailable.

# Inherited branch context

# Focus publication — owner decision 2026-10-17

Branch: feat/focus-publish. Implement the accepted release-wave decision:
focus 0.5.0 is independent of the h2a 0.98.7 train. RC suffix follows the
h2a tag; all five verified tarballs and versions enter the same-tree proof.
Backfills must refuse an older four-package prepare helper before publication.
Scope: release/rehearsal workflows, release/candidate/rehearsal helpers and
qualified execution snapshot, named release tests, release documentation.
No tag, npm publication, installed h2a, owner state, Track writes or full
local suite. Tests use disposable HOME/XDG/TMP directories.

- [x] Red regression evidence: 48/61 then 25/32; no skips.
- [x] Initial six targeted Node test files: 93/93, zero skips; actual focus tarball
  dry-run without node_modules exit 0. Packed schema/validator and registry
  digests checked; logs: /home/antoinefa/.cache/focuspub-{red,contract-red,green,rehearsal}.log.
- [x] Legacy-preparation regression: 12/14 red before the focus-version
  handoff guard, then six files 95/95 green with zero skips; same-tree focus
  preparation is required for RC and stable.
Publication: conventional commits, own-branch push and English PR; per-job
CI outcomes are maintained in the owner-requested focuspub-report.md.

Harness consensus review is selection-failed: the required installed h2a/mesh
access is forbidden by the owner's confinement. No peer consensus claimed.
See docs/reviews/focus-publish.md.

# Inherited context from origin/main

# Claude seat on the common seat model (realign 2026-10-13, r8)

Branch: `feat/claude-seat-h2a-lots` (worktree `claude-seat-lots`).
Scope: Claude subscription seat for llm-mesh, realigned on the model every
other seat follows (owner decision 2026-10-13, DEC-118): same facade
enrollment shape, mesh-side storage/refresh, gateway registry wiring, same
test families — nothing Claude-specific.

State: **enrolled seats route through the mesh; serving needs the official
`claude` CLI on `PATH`**. The gateway always composes mesh
`ClaudeCodeRuntimeClient` on the h2a runner into the provider registry via
`AnthropicAdapter`, with no per-seat configuration. The runner resolves
`claude` from `PATH` per attempt (generic spawn safety only: no version
pin, no digest, no attestation). A seat with no enrolled account (or no
`claude` on `PATH`) never serves a route — fail-closed per attempt, like
every other seat. The pre-acquire seam halt is gone — account locking
lives in the mesh directory like every other seat.

Removed without replacement (no other seat carries them): egress/netns
guard (`egressNetnsReader`, `H2A_CLAUDE_EGRESS_ENFORCED`, `/proc` netns
checks), org-proof handoff, managed-config + registry/MDM guards, h2a-side
account lease lock, seam-gate attempt binding, seat-qualification env
configuration (`H2A_CLAUDE_BINARY_PATH` / `H2A_CLAUDE_BINARY_DIGEST`),
version pin + digest/attestation machinery.

Kept: facade enrollment (OAuth default + `--from cli` official store +
`--from token` secret-manager pipe, DEC-119), mesh keyring
storage/refresh, transport-specific hygiene of the CLI seat
(identity-proven sweep, sandbox transport, cleanup blocking the result,
root-level static error boundary (inherited by every subcommand —
commander never prints its own text: `outputError` is a no-op,
`exitOverride` writes a static message chosen ONLY from `err.code`
(unknown option, unknown command, too many arguments, missing argument,
option argument missing, required option not specified, conflicting option,
invalid argument, fallback); no declared name kept, no counts, no suggestion;
multi-line values ending a line with `'` or `.`, unknown commands with
newline, `remove` with a dotted first line all static; proven by a 34-form
property canary with exact static-shape asserts for every form),
masked TTY input / piped-token boundary (never
argv, never logged). The startup sweep runs at every gateway
composition even with no Claude account enrolled.

Import note (differs from muse by mesh limitation 0.25.0): `--from cli`
is a point-in-time COPY — the mesh never writes the official store file,
but its copy refreshes independently, so re-run `--from cli` when the
grant rotates. Linux store file only; macOS keychain unverified.

Follow-ups (not built here, other seats unchanged): `--from cli` on
codex/cloud-code/mistral-vibe, `--from token` on
codex/cloud-code/mistral-vibe/muse, a mesh-side Claude store leg
(CLI sole writer, mesh re-reads at refresh), the shared GitHub-secret +
cron refresh/re-enroll circuit (exists for NO seat today).

Validation: `tsc -b` clean; seat suites green
(`claude-code-cli-*`, `claude-seat-input`, `llm-mesh-accounts`,
`gateway-host/claude-code-seat-wiring`, `gateway-host/host`,
`runtime-llm-mesh-account`); `gh pr checks 327 -R rhanka/h2a` green.
Reports under `.h2a/` stay untracked; the r8 report lives in
`.h2a/build/claude_seat_r8_report.md` (untracked) and the seat-model
inventory in `.h2a/build/seat_model_inventory.md` (untracked).

# Inherited context from updated origin/main

# Focus decision dossier kit
# L2-s — PR 348 Tour 3

Owner scope: rev348-r2.md, root corrections with targeted red/green evidence,
rebase onto origin/main, own-branch push with lease, per-job CI and Tour 3 report.
No main, Track, scanner, allowlist, real native host or installed h2a access.

- Native interactive/headless IPC preserves non-seat authentication. Seat
  launches consume the materializer environment; sanitization searches values
  only for explicitly supplied secrets.
- Serialized-only renewable fixtures delegate canonical references under
  trusted custody and exclusive family tickets. Native access references and
  canonical material reach the synthetic file/keyring payloads distinctly.
- Native Vibe TOML editor update/removal regression; 16 serialized matrix cells
  with disposal, capture and persisted clearance; strict lifecycle validation.
- Public fixture/codec/materialization exports have a runtime red/green test.
- Finding 3: real L1 PR 681@7293130ee3f6 discovered and pinned. All five
  CLI cli/token sources route to its consumer parser/importSeatBundle API,
  never to renewable product imports. Private profile and bounded stdin only.
  Ten imports/reload/expiry/401/explicit-refresh tested against pinned L1
  sources with zero provider calls. Publication remains an external gate;
  older installed APIs refuse before input. Details: docs/cli-seat-l2s.md.
- Sources/declarations and native op compiled only into disposable proof dirs.
  No full local suite. No peer consensus: installed/native dispatch forbidden.

# Earlier branch records

# Focus publication — owner decision 2026-10-17

Branch: feat/focus-publish. Implement the accepted release-wave decision:
focus 0.5.0 is independent of the h2a 0.98.7 train. RC suffix follows the
h2a tag; all five verified tarballs and versions enter the same-tree proof.
Backfills must refuse an older four-package prepare helper before publication.
Scope: release/rehearsal workflows, release/candidate/rehearsal helpers and
qualified execution snapshot, named release tests, release documentation.
No tag, npm publication, installed h2a, owner state, Track writes or full
local suite. Tests use disposable HOME/XDG/TMP directories.

- [x] Red regression evidence: 48/61 then 25/32; no skips.
- [x] Initial six targeted Node test files: 93/93, zero skips; actual focus tarball
  dry-run without node_modules exit 0. Packed schema/validator and registry
  digests checked; logs: /home/antoinefa/.cache/focuspub-{red,contract-red,green,rehearsal}.log.
- [x] Legacy-preparation regression: 12/14 red before the focus-version
  handoff guard, then six files 95/95 green with zero skips; same-tree focus
  preparation is required for RC and stable.
Publication: conventional commits, own-branch push and English PR; per-job
CI outcomes are maintained in the owner-requested focuspub-report.md.

Harness consensus review is selection-failed: the required installed h2a/mesh
access is forbidden by the owner's confinement. No peer consensus claimed.
See docs/reviews/focus-publish.md.

# Inherited context from origin/main
# L2-s — PR 348 Tour 2

Owner scope: rebase onto origin/main, address every finding in rev348.md with
red/green targeted tests, push this branch with lease, append Tour 2 and every
CI job to the requested report. No main/Track/guard/allowlist edits.

Allowed correction scope: cli-seat-{codecs,fixtures,materialization}.ts and
their named tests, cli-seat-direct-matrix.test.js; native-host.ts,
llm-mesh-accounts.ts and its temporary-directory tests, index.ts aliases,
cli-seat-runtime-wiring.test.ts, this record and docs/cli-seat-l2s.md.

- Explicit channel authority, unavailable refusal, strict pinned envelope.
- Native credential/MCP paths, private XDG/no-follow files, injected agy keyring.
- Closed MCP environment, separate profile, three sanitized native captures.
- Real materializer matrix, independent diagonal actors, lab billing admission.
- Exclusive family journal, unique stream ids, exact persisted handoff.
- Scenario/codec tool gate, adversarial canaries, precedence/base64/401 guards.
- Targeted baseline controls retain 71/80 red regressions, 13/13 wiring red,
  20/20 diagonal failures and a cross-process admission failure; final tests/typechecks are in the owner report.
- Finding 3 remains partially blocked by the published L1 facade: no generic
  five-provider cli/token import with external refresh policy. Preserve its
  refusal, do not fabricate an API or duplicate the store. Explicit owner,
  scope and acceptance are in docs/cli-seat-l2s.md. No mergeability claim.
- Confinement forbids installed/native h2a review dispatch; no new consensus.
  All test children are synchronous/owned, HOME/XDG are disposable; no full
  local suite, provider state, Python or real credentials.

# L2-s — PR 348 CI repair

- Owner scope: rebase `feat/cli-seat-l2s` onto `origin/main`, repair the three
  failed CI jobs without weakening tests, push with lease, and append `CI` to
  the owner's `l2s-report.md`. No main or Track writes.
- Rebased onto `3113014fe`; all three original jobs fail the same gateway
  eradication ratchet on three provider references introduced by L2-s.
- Minimal repair scope: fixture provenance comments, live-stub receipt
  diagnostics, its targeted regression in `cli-seat-direct-matrix.test.js`,
  and `docs/cli-seat-l2s.md`. Keep the scanner and allowlist unchanged.
- Named tests only, temporary HOME/XDG/TMP roots, no installed h2a/native host,
  provider credentials, Python, foreign process access or full local suite.
- Native h2a/mesh review dispatch remains forbidden by the owner's confinement;
  no external consensus is claimed.
- Evidence: `node --test packages/h2a/test/gateway-eradication.test.js`:
  3/4 before, 4/4 after. The final direct-matrix regression against the old
  stub fails 103/104 on Node 22 and 24, then passes 104/104 after repair.
  Six named `cli-seat-*.test.ts` files pass 76/76 on both Node versions.
  No skips; scanner/allowlist unchanged. Detailed commands, logs and per-job
  CI results are retained in the owner's report.
- L1 update: npm 0.26.1 now exports the bundle via its public node entry.
  Five-CLI seat import and external refresh-policy APIs remain absent from
  the inspected facade contract; exact handoff: `docs/cli-seat-l2s.md`.

# Inherited main context

# Claude seat on the common seat model (realign 2026-10-13, r8)

Branch: `feat/claude-seat-h2a-lots` (worktree `claude-seat-lots`).
Scope: Claude subscription seat for llm-mesh, realigned on the model every
other seat follows (owner decision 2026-10-13, DEC-118): same facade
enrollment shape, mesh-side storage/refresh, gateway registry wiring, same
test families — nothing Claude-specific.

State: **enrolled seats route through the mesh; serving needs the official
`claude` CLI on `PATH`**. The gateway always composes mesh
`ClaudeCodeRuntimeClient` on the h2a runner into the provider registry via
`AnthropicAdapter`, with no per-seat configuration. The runner resolves
`claude` from `PATH` per attempt (generic spawn safety only: no version
pin, no digest, no attestation). A seat with no enrolled account (or no
`claude` on `PATH`) never serves a route — fail-closed per attempt, like
every other seat. The pre-acquire seam halt is gone — account locking
lives in the mesh directory like every other seat.

Removed without replacement (no other seat carries them): egress/netns
guard (`egressNetnsReader`, `H2A_CLAUDE_EGRESS_ENFORCED`, `/proc` netns
checks), org-proof handoff, managed-config + registry/MDM guards, h2a-side
account lease lock, seam-gate attempt binding, seat-qualification env
configuration (`H2A_CLAUDE_BINARY_PATH` / `H2A_CLAUDE_BINARY_DIGEST`),
version pin + digest/attestation machinery.

Kept: facade enrollment (OAuth default + `--from cli` official store +
`--from token` secret-manager pipe, DEC-119), mesh keyring
storage/refresh, transport-specific hygiene of the CLI seat
(identity-proven sweep, sandbox transport, cleanup blocking the result,
root-level static error boundary (inherited by every subcommand —
commander never prints its own text: `outputError` is a no-op,
`exitOverride` writes a static message chosen ONLY from `err.code`
(unknown option, unknown command, too many arguments, missing argument,
option argument missing, required option not specified, conflicting option,
invalid argument, fallback); no declared name kept, no counts, no suggestion;
multi-line values ending a line with `'` or `.`, unknown commands with
newline, `remove` with a dotted first line all static; proven by a 34-form
property canary with exact static-shape asserts for every form),
masked TTY input / piped-token boundary (never
argv, never logged). The startup sweep runs at every gateway
composition even with no Claude account enrolled.

Import note (differs from muse by mesh limitation 0.25.0): `--from cli`
is a point-in-time COPY — the mesh never writes the official store file,
but its copy refreshes independently, so re-run `--from cli` when the
grant rotates. Linux store file only; macOS keychain unverified.

Follow-ups (not built here, other seats unchanged): `--from cli` on
codex/cloud-code/mistral-vibe, `--from token` on
codex/cloud-code/mistral-vibe/muse, a mesh-side Claude store leg
(CLI sole writer, mesh re-reads at refresh), the shared GitHub-secret +
cron refresh/re-enroll circuit (exists for NO seat today).

Validation: `tsc -b` clean; seat suites green
(`claude-code-cli-*`, `claude-seat-input`, `llm-mesh-accounts`,
`gateway-host/claude-code-seat-wiring`, `gateway-host/host`,
`runtime-llm-mesh-account`); `gh pr checks 327 -R rhanka/h2a` green.
Reports under `.h2a/` stay untracked; the r8 report lives in
`.h2a/build/claude_seat_r8_report.md` (untracked) and the seat-model
inventory in `.h2a/build/seat_model_inventory.md` (untracked).

# Inherited workspace scope guard record from origin/main

# Workspace scope guard

- [ ] Objective: default portable Focus design-system dossiers with mobile ecosystem canvases.
- [ ] Scope: h2a Focus CLI, isolated Svelte consumer, reusable catalog, template, skill and targeted tests.
- [x] Guardrails: owner confinement; no installed h2a, host state, Python, full local suite or main writes.
- [x] Allowed: packages/h2a/focus-kit/**, src/focus-build.ts, bin.ts, CLI help, package metadata;
      packages/track/skills/present-decision/**; named tests; build script, CI and documentation.
- [x] Forbidden: reference kit writes, other runtime behavior and long-term DS renderer ownership.
- [x] Design: use h2a focus build, a native Focus extension, and bundle @sentropic/focus/validate unchanged.
- [x] Lot 1: closed document template, ecosystem catalog, validator/build command; focus-build.test.js.
- [x] Lot 2: DS Svelte renderer, light/dark, cards, pinch zoom, portable artifact; browser fixture.
- [x] Lot 3: default skill, exact command, documentation, targeted skill and schema tests.
- [ ] Lot 4: package verification, push own branch, English PR, per-job CI report.
- [x] Feedback: harness review selection-failed; installed h2a/mesh access forbidden by owner.
- [x] Feedback: no Track writes through installed tools; no consensus or review identity claimed.
- [x] Feedback: generated renderer and lockfile exceed suggested commit size; bounded to requested consumer.
- [x] Tour 2 scope: optional plain-JSON diagram-core SemanticDocument on Focus DiagramNode;
      canonical schema/validator/readability, catalog, interim xyflow consumer and targeted regressions.
- [x] Design contract: generic@1, semantic records only; no Focus scene model, view, geometry or layout hint.
- [x] Layout L-R1..L-R11 remains DS-owned; interim placement exists only inside the xyflow adapter.
- [x] Rebase origin/main: already up to date at the start of Tour 2.
- [x] Final rebase includes #364; only BRANCH.md conflicted; Focus scope retained.
- [x] Direct delivery dependencies: regenerate Focus registry digests and Track focus-vendor
      after changing canonical schema/validation. Red vendor drift and packed digest proofs recorded.
- [x] Last round #368: close nested semantic records; regenerate authoritative Mermaid fallback;
      budget displayed scene labels once while retaining opaque-code checks.
- [x] Last round #368: reuse canonical question/option grouping and recommendation naming;
      resolve local selections across linked sets; browser coverage at 320px and 390px.
- [x] Regression proofs: all five reviewer findings reproduced red, then CLI/browser 32/32 green;
      readability 69/69 green; isolated temporary state and no skipped tests.

## Objective
- [x] Enforce workspace ownership in shipped development hooks.

## Scope / Guardrails
- [x] Own worktree only; no live h2a state, installed binary or full local suite.
- [x] No version bump, attribution or main mutation.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/hooks/**, targeted scope tests, hosts/plugin.ts,
  hosts/vibe-equipment.ts, hosts/vibe-discovery.ts, hosts/native-convergence.ts,
  hosts/native-files.ts, hosts/native-toml.ts, hosts/native-inspection.ts, cli.ts, plugin manifests,
  test/native-host-convergence.test.js, test/native-host-review-regressions.test.js,
  test/host-plugin.test.js, test/native-host-shared-skills.test.js,
  docs/workspace-scope-guard.md, docs/specs/SPEC_EVOL_WORKSPACE_SCOPE_GUARD.md,
  docs/reviews/workspace-scope-guard/**, BRANCH.md.
- [x] Direct CI blocker: scripts/test-inventory.json (host-plugin normative title).
- [x] Forbidden: live host state, unrelated sources, dependency/version changes.

## Lot 1
- [x] Classifier, signed grants, typed audit and owner command.
- [x] Red/green: workspace-scope-guard.test.js.

## Lot 2
- [x] Host plumbing and targeted workspace-scope-hosts.test.js.

## Lot 3
- [x] Documentation, review outcome, push, PR and individual CI reporting.

## Feedback Loop
- [x] Independent security/coverage design reviews: pin launch identity, inspect
  remote destinations and committed bumps, preserve private packages.
- [x] h2a consensus unavailable: no h2a MCP in confinement; do not reach live host.

- [x] Preserve read-only npm version and private package versioning; published siblings still require release authority.
- [x] Restrict helper execution and manual session initialization while preserving source inspection.

## Tour 2 — Independent review #364
- [x] R1: agy native payloads and SessionStart/PreToolUse; Muse project hooks verified against the public Meta CLI; six-host enforcement/grant/version matrix.
- [x] R2: scoped shell cwd/environment, executable heredocs/substitutions, git/gh options, package script aliases.
- [x] R3: shell redirections before every executable/builtin; runtime/helper protection; static Codex envelopes and dynamic refusal.
- [x] R4: root-relative manifests, pinned session baseline, path commits, matching refspecs, MultiEdit and separate foreign/release grants.
- [x] R5: startup-pinned plugin key, normalized grant options/repositories, Vibe native-session journal and refreshed explicit trust.
- [x] R6: quoted prose, own --all, native test runner flags, current PR resolution, branch reads, literal patch envelopes.
- [x] R7: exact repo/action/ref/session in both refusal channels.
- [ ] Fresh author-complementary h2a consensus: unavailable in confinement (no h2a MCP; no real-state access authorized).

## Tour 3 — Independent review rev364-r2.md
- [x] R1: agy global-hook cwd, native workspacePaths SessionStart binding, JSON startup output, multi-session --write installation; explicit Muse project installation only.
- [x] R2: fail-closed shell grammar/state, wrappers, balanced cwd stacks, HOME/OLDPWD/directory stack, continuations, stdin/runtime paths and independent Git directory selectors.
- [x] R3: protect hook configuration, installer metadata, helper code and journals; destination options, destructive Git commands and indirect/reflective JS capability access.
- [x] R4: inspect index independently of commit operands, enumerate pushed refs, match full patch paths and honor native line ranges.
- [x] R5: lex JS strings/comments separately and decode literals before shell classification; preserve legitimate commit messages.
- [x] CI blocker: normative inventory follows the existing agy/Muse installation test, without removing its execution requirement.
- [ ] Fresh h2a consensus remains unavailable; no independent verdict claimed for the new diff.

## Tour 4 — Fail closed on uncertainty (conductor decision)
- [x] Remove heredoc preprocessing and executable substitution/shell-script interpretation; refuse opaque protected intent with a typed request for the plain explicit form or owner grant.
- [x] Check dynamic sensitive argv before action selection; cover runtime stdin/eval, independent Git directories, symlinks, file destination options and Git mutation forms from rev364-r3.md.
- [x] Preserve explicit own copy/move/mkdir operations, conditional own cwd alternatives, plain protected actions and valid JavaScript escapes; reject duplicate command members using the shared lexer.
- [x] Compare complete proposed/base manifests, preserve baseline publication across private toggles, and inspect the union of explicit pushed refs and tags; bind sessions before recording baselines.
- [x] Targeted regression proof: 76 T4 tests on original HEAD (7 pass, 69 fail, 0 skipped), then 76 pass, 0 fail, 0 skipped after correction.
- [x] Centralize symlink uncertainty before canonicalization, including env/npm selectors and dangling effective copy destinations: three additional red/green regressions.
- [ ] Full native sessions, remote mutations and independent h2a consensus remain outside confinement qualification; full repository suite is reserved for the conductor.

# L2-s — PR 348 Dernier tour

- Owner scope: rev348-r3.md, minimal correction, rebase onto origin/main,
  own-branch lease push and per-job CI in the owner report.
- Rebased onto df5652b18; only BRANCH.md conflicted. Both branch records
  were retained, including the complete workspace scope guard record.
- The sole finding is still externally blocked: Sentropic PR 681 is OPEN;
  registry latest is llm-mesh 0.26.1 / cluster-mesh 0.18.0. An isolated
  install of those published packages fails all three API availability
  assertions (3 failed, 0 skipped). No green-after or closure is claimed.
- Keep the fail-closed import guard and dependency lock unchanged. Do not
  merge with this reserve. L1 must publish its import API, then h2a can pin
  compatible published versions and qualify all ten cli/token imports.
- Targeted post-rebase enrollment/dispatch/regression suites: 6 files,
  118 passed, 0 skipped. Full local suite and native/installed h2a forbidden.
