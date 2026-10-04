# Central MCP default for Claude

Branch: `feat/mcp-central-default-claude`, based on `origin/main` at `5ca5c7bc`.
Owner decision: 2026-10-04, implement L-H before L-A. No push, PR, publish,
tag, attribution, Python, owner session/config/native host access, or `.track` writes.
Real processes run only with isolated HOME, runtime directories and stores.

- [x] L-H: remove implicit project/host/config writes from run and restore;
  decouple state root from workspace; neutral daemon cwd and environment whitelist.
- [x] L-H: explicit host writer preserves all bytes outside the h2a value,
  backs up existing files and requires `--allow-tracked` for tracked files.
- [x] L-H: retain live shim stdio on restart, operator status/stop and rollback semantics.
- [x] L-H: report-only inventory of old central configs and repo store sentinels.
- [x] L-A: lightweight `mcp-serve` switch, Claude only; causal conversation
  identity, independent attachments, shared store, private discovery, idle exit.
- [ ] Qualification: two workspaces, restart identity continuity, T4 cohorts,
  latency/RSS comparison, focused regressions and at most one final root suite.

Evidence: ignored `tmp/mcp-evidence/`. Published 0.98.0 retains an ordinary
graphify-ts entry in the supplied-shaped fixture, removes standalone Track and
reformats surrounding bytes. Exact production graphify loss is not reproduced;
do not claim otherwise. No launch-index exists on this main revision: reuse the
existing identity storage and leave index integration to L-C, without a parallel index.

Focused qualification passes: central/core 27; attachment/identity/stdio/wake/CLI
130 passed and 16 intentional skips; T4 central 5/5 with four sessions; host
writer 6/6. The initial performance sample has four distinct synthetic sessions:
stdio 435.4 MiB RSS, central + shims 420.2 MiB; shim 73.7–73.9 MiB, central
125.1 MiB. Warm initialize 109–122 ms versus stdio 227–235 ms; cold 443 ms.
The proposed 50 MiB shim and 18-session aggregate budgets are not qualified.
Final root gate and acceptance report are pending. No peer consensus is claimed:
the installed-session review route conflicts with the owner isolation constraint.

## Historical plans (superseded for this branch)

# Session launch latency

Branch: `fix/mcp-identity-burst-tail`, based on `origin/main` at `ab7ff40e`
(v0.98.1). Scope: the burst and startup-contention laboratory tests, their
bounded on-demand recovery helper, deterministic regression, and evidence.
No production deadline or identity contract change. No push, PR, publication,
tag, real owner identity/token store access, or `.track` write.

Validation: deterministic RED/GREEN on the real Node 20 binary, ten sequential
burst runs pinned to one CPU, focused sibling checks, and at most one full
root test gate at the end. Qualification: `docs/reviews/mcp-identity-burst-tail.md`.
Completed: RED 1/2, GREEN 2/2; burst 10/10 (50 passes, no failures/skips);
siblings 62 passes, 1 EROFS environment skip; one final root `npm test` passed
(Node: 2,456 passed / 32 skipped / 21 TODO; Track: 1,193 passed). Test fix:
`e75e835f`. All execution receipts are under ignored `tmp/burst-evidence/`.
Prior branch plans below are historical and grant no delivery authorization.

# Native host generations — phase A

Branch: `fix/native-host-generations`. Owner decision: 2026-10-03,
side-by-side native hosts, phase A only. The prior plan below is historical.
No push, PR, publication, tag, owner host/session access, or `.track` write.

Scope: native host selection, the two known endpoint inventories, per-name
owner routing, creation admission, guard/receipt socket ownership, native
restore/drive wiring, their focused tests, and qualification documentation.
Phase B (durable catalog/admission, migration and retirement) is excluded.

- [x] A1: preserve the historical socket; select `native-terminal.lf1.sock`
  for fenced launches when the historical host lacks `launchFence`.
- [x] A2: resolve existing owners, refuse ambiguous owners, and preserve
  unknown/incomplete inventories across native operations, restore and drive.
- [x] A3/A5: admit agent and sidecar names before creation; prove no
  containment registry write on a refused same-name launch.
- [x] A4: retain `socketPath` in launch ownership, guard cleanup and receipts.
- [x] Historical RED becomes GREEN; isolated MCP launches/delivers once.

Qualification and limitations: `docs/reviews/native-host-generations-phase-a.md`.
All real-host qualification uses checked private `/tmp/h2a-qual-*` fixtures.
Only handles created by the fixture are signaled during teardown. The owner
runtime is rejected before filesystem access or process startup. No harness
recorder runs here: `.track` has another writer.

## Historical branch plan

# Synchronisation 0.98 — décision owner

Intégrer origin/main (Lot 4 2a–2e et stabilisation des tests) à partir de
98f15b4664e223c2d85549407380298a1921ddf0, conserver h2a 0.98.0 et
cluster-mesh 0.13.0, fixer llm-mesh 0.22.3 et llm-gateway 0.19.1.
Une seule copie physique de llm-mesh ; build puis deux npm test complets
séquentiels, sans autre runner h2a actif. Aucun test de charge.
Le push est autorisé uniquement vers feat/consume-cluster-mesh-0.10.0,
avec le lease exact 98f15b4664e223c2d85549407380298a1921ddf0.

Scope actuel : intégration de main, manifestes/lockfile des dépendances,
artefact Focus si son contrôle le requiert, et correctifs directement
bloquants des tests. Les scopes et résultats ci-dessous sont historiques.
La propriété single-writer de .track reste applicable : aucune écriture ici.

## Historique de la ligne 0.98

# PR #267 — cluster-mesh messaging, N2, release 0.98.0

## Objective and scope

Finish `feat/consume-cluster-mesh-0.10.0` rebased on origin/main 0.97.11 (`5a3eec57`).
Consume cluster-mesh 0.13.0, extend the existing send primitive and CLI/MCP
adapters, verify received envelopes before inbox/wake, and prepare 0.98.0 in
this PR. Owner authorized push with force-with-lease; no merge or tag push.

Allowed: h2a dependency/lockfile; send/cluster-mesh messaging and existing
CLI/MCP adapters/exports/help; focused messaging tests and CI gate; this plan
and messaging spec; lockstep version files changed by scripts/release.mjs.
`.track/**` remains single-writer and is forbidden in this worktree.

## Lots

- [x] Rebase onto origin/main and record incremental progress externally.
- [x] Pin cluster-mesh 0.13.0 and share the existing send preparation.
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

## Historique de la stabilisation intégrée depuis main

# Stabilisation central MCP, drive PTY et rendu Track

## Objectif

Reprendre les changements interrompus, intégrer `origin/main`, prouver les
causes et comparer les taux avant/après. Une seule suite `npm test` complète
sur cette branche, puis commit et push vers `origin` de cette branche nommée.

## Scope

**Allowed Paths**
  - `packages/h2a/test/mcp-central.test.js`
  - `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts`
  - `packages/track/src/cli/focus.test.ts`
  - `BRANCH.md`
  - `docs/reviews/test-flakes-central-drive.md`

**Forbidden Paths**
  - `.track/**`
  - `package*.json`
  - `packages/*/package.json`

## Lots

- [x] Lire et sauvegarder l’état interrompu ; intégrer `origin/main`.
- [x] Conserver les attentes d’identité MCP déjà corrigées sur `main`.
- [x] Reproduire la publication centrale retardée après le bootstrap.
- [x] Synchroniser la publication effective et conserver le contrôle `4 !== 1`.
- [x] Maintenir et nettoyer la fixture sidecar PTY.
- [x] Mesurer la durée du scénario avant de conserver son budget global local.
- [x] Reproduire et corriger le premier rendu Track sans changer son délai.
- [x] Vérifier les signalements loop/M02 et consigner les limites du diagnostic.
- [x] Terminer les campagnes sans injection : 0/20 échec.
- [x] Une suite `npm test` complète, sans autre runner h2a actif : Node
  2 410 réussites, 1 échec UAT SIGTERM, 21 ignorés, 21 TODO ; Track 1 193/1 193.
- [x] Un commit par correctif ; préparer la livraison de `fix/test-flakes-central-drive`.

## Preuves

`docs/reviews/test-flakes-central-drive.md` et instruments ignorés
`tmp/h-cond-evidence/`, `tmp/h-cond-campaign.mjs`, `tmp/h-cond-order.cjs`.
Décision h-cond pour la livraison : aucune nouvelle campagne de charge.
Attendre la fin du build release/v0.97.12 et vérifier avec `ps` qu’aucun
`scripts/run-tests.mjs` n’a un cwd sous `/home/antoinefa/src/h2a` avant chaque
suite complète. La suite externe bpmn-canvas (groupe 933523) est exclue de
cette contrainte et reste intacte. Exécuter les deux branches en séquence.
La synchronisation finale intègre `origin/main` à `8c1912d7` par avance rapide.
