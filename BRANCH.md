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
- [ ] Une suite `npm test` complète, sans autre runner h2a actif.
- [ ] Commit et push de `fix/test-flakes-central-drive`.

## Preuves

`docs/reviews/test-flakes-central-drive.md` et instruments ignorés
`tmp/h-cond-evidence/`, `tmp/h-cond-campaign.mjs`, `tmp/h-cond-order.cjs`.
Décision h-cond pour la livraison : aucune nouvelle campagne de charge.
Attendre la fin du build release/v0.97.12 et vérifier avec `ps` qu’aucun
`scripts/run-tests.mjs` n’a un cwd sous `/home/antoinefa/src/h2a` avant chaque
suite complète. La suite externe bpmn-canvas (groupe 933523) est exclue de
cette contrainte et reste intacte. Exécuter les deux branches en séquence.
La synchronisation finale intègre `origin/main` à `8c1912d7` par avance rapide.
