# PR #395 — correction du round 5

Le P2 commun aux deux revues de `8b0a895c3` est reproduit avant modification
produit : `--gw` sous un nouveau nom enregistre bien le choix, mais la reprise
suivante redevient directe face à une ancienne ligne direct/auto/sans pin.

Cause : `packages/h2a-runtime/src/resume-launch-options.ts:43` comparait tous
les modes sans leur provenance. La différence legacy/explicite déclenchait
l'élagage des deux lignes mortes avant la préférence de `index.ts:6562`.

Le prédicat compare désormais les modes explicites lorsqu'il en existe pour
la même identité convId/cwd/tool. Les valeurs legacy restent conservées, sans
créer de faux conflit de routage. Le choix explicite gateway ou direct survit
à la reprise, indépendamment de l'ordre. Les conflits de bare et les désaccords
entre choix explicites gardent les règles de liveness existantes.

## RED puis GREEN

Les sondes originales sont récupérées dans `r4-rv395a.log` (patch
`consent-transition.ts`, lignes 12178–12200) et `r4-rv395s.log` (sonde
`independent R4 explicit changes beside legacy rows`, lignes 12820–12838).
Elles utilisent les fixtures du test durable par overlay Vitest, avec la
configuration exacte du gate. Leurs assertions ne sont pas modifiées.

Avec `T=/home/antoinefa/.cache-tmp/h2a-test/run-Fs3Vkp` :

```sh
rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" \
  H2A_TEST_REPORT_PATH="$T/reviewers-red.json" node "$T/reviewers-r4.mjs"
rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" \
  H2A_TEST_REPORT_PATH="$T/durable-red.json" node_modules/.bin/vitest run \
  --config packages/h2a-runtime/vitest.config.ts \
  packages/h2a-runtime/src/gateway-off-default.test.ts
```

| Preuve | Avant correction | Après correction |
| --- | --- | --- |
| Quatre sondes originales des reviewers | **4 FAIL / 0 PASS / 0 skip**, exit 1 ; gateway → direct à la seconde reprise | **4 PASS / 0 FAIL / 0 skip**, exit 0 |
| Matrice durable, avant les quatre contrôles de conflits supplémentaires | **24 FAIL / 74 PASS / 0 skip**, exit 1 | **98 PASS / 0 FAIL / 0 skip**, exit 0 |
| Matrice finale, contrôles de conflits inclus | — | **102 PASS / 0 FAIL / 0 skip**, exit 0 |

Les 44 cas supplémentaires sont découverts par le gate h2a-runtime de
`npm test` : transitions vers gateway/direct, pins legacy absents/auto/direct/
gateway, bare absent/false/true, deux ordres et override `--no-gw`. Les assertions
contrôlent aussi le registre après reprise ; un simple retour en direct ne
suffit pas à valider la conservation d'un choix direct explicite. Les quatre
contrôles de conflits refusent les choix explicites incompatibles et les pins
bare incompatibles pour une liveness live ou unknown, sans supprimer de ligne.

## Vérification et replays

```sh
rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" \
  H2A_TEST_REPORT_PATH="$T/scoped.json" node_modules/.bin/vitest run \
  --config packages/h2a-runtime/vitest.config.ts \
  packages/h2a-runtime/src/{gateway-off-default,structured-gateway,tmux-wrapper-scrub,remote-gateway-consent,soft-refresh,registry,tmux,conv-guard-wiring,attach,restore,crash-log,run,relaunch}.test.ts
rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" \
  node --test packages/h2a/test/{run-test-gates,test-inventory,loop-launch,resume-conflict-selfheal}.test.js
rtk env TMPDIR="$T" node_modules/.bin/tsc -b packages/h2a-runtime --pretty false
```

| Commande / oracle observé | Résultat |
| --- | --- |
| 13 fichiers runtime ci-dessus | **558 PASS / 0 FAIL / 0 skip / 0 todo**, exit 0 |
| Quatre fichiers Node ci-dessus | **56 PASS / 0 FAIL / 0 skip / 0 todo**, exit 0 |
| Compilation runtime | exit 0 |
| Vrai export `verifyRuntimeExecution`, rapports scoped et replays | `executionProofErrors: []` pour les deux, exit 0 |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" node "$T/r1-verify.cjs"` | Base 912dd3035 : **5 PASS / 11 FAIL** ; sources courantes : **16 PASS / 0 FAIL**, aucun skip |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" node "$T/r1-shell.cjs"` | Deux enfants : `url:null`, `bearerPresent:false`, `nativeKeyPreserved:true`, exit 0 |
| `rtk env -i PATH=/usr/bin:/bin TMPDIR="$T" H2A_TEST_QUALIFICATION_ROOT="$T" H2A_TEST_REPORT_PATH="$T/replays.json" node "$T/replays.mjs"` | **18 PASS / 0 FAIL / 0 skip / 0 todo**, exit 0 |

Les scripts R1/R2/R3 sont récupérés à l'identique des patches des journaux
fournis, avec les mêmes corrections de fixtures déjà appliquées au round 4
(bare=false, bootstrap simulé, oracle des modes). Les 18 sondes incluent les
deux vérifications de confidentialité/historique sous vrais shells et PTY.
Aucun gate, seuil, workflow, dépendance ou inventaire modifié.

## Limites et livraison

Faux CLI, vrais shells/PTY ; HTTP/k8s simulés. Aucun état personnel, binaire
h2a installé, gateway, fournisseur ou cluster réel exercé. Suite complète
locale interdite par le brief. Nouvelle revue h2a : `status: selection-failed`,
`observed-failure: installed h2a MCP unavailable; real host/provider forbidden`.
Aucun nouveau consensus indépendant revendiqué ; les deux revues fournies
sont traitées par reproduction et tests.

TMPDIR privé `/home/antoinefa/.cache-tmp/h2a-test/run-Fs3Vkp`, à supprimer après
livraison et retrait à confirmer dans le rapport final. Rebase origin/main,
push avec `--force-with-lease` ; head et CI terminale consignés dans la PR.
Aucun merge, tag ou trailer d'attribution.
