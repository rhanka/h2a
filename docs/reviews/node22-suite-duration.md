# Node 22 : épuisement du budget de la suite Node

Diagnostic du HEAD `ccb7549456790863aee01a7ba07b1e01af086aeb` et des runs
signalés pour les PR #401, #402 et #403. Aucun plafond modifié.

## Cause établie et limites

`scripts/run-tests.mjs:437` soumet les **349 fichiers** à une seule invocation
`node --test`. Le délai de 600000 ms concerne cette invocation entière.
`runSuite`, lignes 406–410, transforme tout `ETIMEDOUT` en message « HUNG » :
ce message ne prouve ni une absence de progression, ni une fuite de processus.

La suite est proche de son budget sur les machines lentes : le run #402
termine les 349 fichiers en **599719,947 ms sur Node 22**, et en
**589587,776 ms sur Node 24**. Ces deux jobs échouent sur quatre assertions
L0, pas sur une expiration. Son job trust-root termine la suite Node en
392722,218 ms. Il ne faut pas attribuer ces échecs d'assertion à un hang.

Le corpus différentiel de `drive-consent-index.test.js:19–59` exécute dix
graines × quarante fixtures × soixante opérations, avec projections de journal,
réouvertures et vérifications cryptographiques. Il coûte 115–126 s dans les
runs verts et 224–230 s dans les runs coupés. D'autres fichiers ralentissent
aussi. Aucun enfant ni handle fuyant n'a été identifié dans les logs historiques.
Les sondes ciblées ci-dessous recherchent explicitement les descendants encore
vivants après la sortie ; elles ne peuvent pas reconstituer les handles des
anciens runners CI.

## Preuves CI

Logs acquis avec `gh run view --log` / `--log-failed`, tentatives explicites,
et `gh api repos/rhanka/h2a/actions/jobs/<id>/logs` pour les jobs déjà terminés
d'un run encore en cours de relance.

| Run / job | Node | Résultat de la suite Node |
| --- | --- | --- |
| [main, 124671954748](https://github.com/rhanka/h2a/actions/runs/41246851120/job/124671954748) | 22 | 409,687 s, zéro échec |
| [main, 124671954854](https://github.com/rhanka/h2a/actions/runs/41246851120/job/124671954854) | 24 | 418,476 s, zéro échec |
| [main trust-root, 124671954761](https://github.com/rhanka/h2a/actions/runs/41246851120/job/124671954761) | 22 | coupée à 600 s |
| [#401 tentative 1, 124680982422](https://github.com/rhanka/h2a/actions/runs/41249880160/job/124680982422) | 22 | coupée à 600 s |
| [#401 tentative 4, 124692515840](https://github.com/rhanka/h2a/actions/runs/41249880160/job/124692515840) | 22 | 394,301 s, zéro échec, même SHA `32e5795d9` |
| [#402, 124689090843](https://github.com/rhanka/h2a/actions/runs/41252615306/job/124689090843) | 22 | 599,720 s, quatre assertions L0 échouées |
| [#402, 124689090757](https://github.com/rhanka/h2a/actions/runs/41252615306/job/124689090757) | 24 | 589,588 s, quatre assertions L0 échouées |
| [#403 tentative 1, 124695250110](https://github.com/rhanka/h2a/actions/runs/41254689012/job/124695250110) | 22 | coupée à 600 s, 75 assertions L0 déjà passées |
| [#403, 124699268758](https://github.com/rhanka/h2a/actions/runs/41254689012/job/124699268758) | 24 | 454,348 s, zéro échec |

Durées par fichier, issues des tableaux `Slowest suites: tests` des logs.
Les colonnes main portent sur le même SHA, celles #402 sur le même SHA entre
Node 22 et 24. Ces durées ne s'additionnent pas au temps mural : les fichiers
s'exécutent en concurrence.

| Fichier sous `packages/h2a/test/` | main Node 22 | main Node 24 | #402 Node 22 | #402 Node 24 |
| --- | ---: | ---: | ---: | ---: |
| `drive-consent-index.test.js` | 125,9 s | 118,9 s | 225,2 s | 221,4 s |
| `native-inventory-absence.test.js` | 109,4 s | 114,3 s | 131,4 s | 133,3 s |
| `native-host-generations.test.js` | 69,3 s | 69,4 s | 75,7 s | 75,9 s |
| `workspace-scope-guard.test.js` | 69,2 s | 71,3 s | 89,6 s | 91,2 s |
| `mcp-identity-readiness.test.js` | 43,0 s | 46,6 s | 53,7 s | 55,3 s |
| `native-cleanse-oracle.test.js` | 40,8 s | 43,9 s | 64,5 s | 64,5 s |

Dernières sorties avant les coupures : `wake.test.js` sur main trust-root et
#401 tentative 1 ; `workspace-scope-hosts.test.js` sur #403 tentative 1, après
`workspace-scope-guard.test.js`. Le reporter spec restitue les fichiers dans
l'ordre ; il ne journalise pas leurs débuts. Le JSON de
`scripts/node-evidence-reporter.mjs` n'est émis qu'à la fin du flux. Une coupure
perd donc aussi ce rapport. Ces logs ne permettent pas de nommer un fichier
« démarré mais jamais terminé » ni un PID encore vivant. La ligne générique
`Cleaning up orphan processes` ne contient aucun PID de test identifié.

## Reproduction ciblée

Node local : `/usr/bin/node`, v22.22.1. Node de comparaison : v24.22.0,
obtenu par npm et exécuté depuis son cache. Construction locale :
`rtk npm ci --ignore-scripts`, réutilisation du seul binding node-pty déjà
construit, puis `rtk npm run build` : sortie 0, `vendor-engram-live mirror OK`.
Le build historique vient de `git archive 89bbd9af1033153b6654c272e126d91e0fa42683^`,
transpilé dans le répertoire jetable avec le TypeScript du checkout.

Les commandes passent par une sonde temporaire : HOME/XDG/H2A_ROOT privés,
préchargement de `native-isolation.js`, `--test --test-concurrency=3
--test-reporter=spec`, suivi uniquement des descendants du runner lancé.
Leurs répertoires `/proc/<pid>` sont épinglés pour éviter de confondre une
réutilisation de PID avec un survivant. Un processus Z/X est mort ; les autres
sont vérifiés après la fermeture du runner. Cet échantillonnage ne garantit
pas l'observation d'un enfant qui se détache entre deux relevés.

Commandes de preuve, depuis ce worktree, avec
`TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-Pvuxaq` :

```sh
rtk node "$TMPDIR/probe.mjs" /usr/bin/node node22-corpus-isolated packages/h2a/test/drive-consent-index.test.js
rtk node "$TMPDIR/probe.mjs" /usr/bin/node node22-crash-isolated packages/h2a/test/native-host-crash-recovery.test.js
H2A_TEST_LEGACY_HOST_DIR="$TMPDIR/legacy" H2A_TEST_REQUIRE_LEGACY_HOST=1 rtk node "$TMPDIR/probe.mjs" /usr/bin/node node22-native-generations-required packages/h2a/test/native-host-generations.test.js
rtk node "$TMPDIR/probe.mjs" /usr/bin/node node22-scope-isolated packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js
rtk node "$TMPDIR/probe.mjs" /usr/bin/node node22-mcp-oracle-isolated packages/h2a/test/mcp-identity-readiness.test.js packages/h2a/test/native-cleanse-oracle.test.js
```

| Sonde Node 22 | Sortie observée | Durée Node | PID observés | Survivants observés |
| --- | --- | ---: | ---: | ---: |
| corpus | exit 0, pass 15, fail 0, skipped 0 | 339,854 s | 2 | 0 |
| crash-recovery, dont les deux contrôles de writer tardif | exit 0, pass 19, fail 0, skipped 0 | 19,698 s | 361 | 0 |
| generations, build historique obligatoire | exit 0, pass 13, fail 0, skipped 0 | 77,081 s | 253 | 0 |
| scope guard + hosts | exit 0, pass 347, fail 0, skipped 0 | 167,548 s | 1962 | 0 |
| readiness MCP + oracle L0 | exit 0, pass 32, fail 0, skipped 0 | 147,047 s | 953 | 0 |

Le corpus a continué à créer et supprimer ses fixtures pendant plusieurs
minutes ; il ne lance aucun enfant au-delà du processus de fichier de test.
Les contrôles crash-recovery vérifient aussi la mort de leurs writers enregistrés
avant de supprimer les fixtures. Total : **426 assertions passées dans sept
fichiers**, zéro skip/todo, sans modification de produit ni de test.

Campagnes exploratoires initiales : corpus + scope sous Node 22 et 24 se
terminent en 384,808 et 335,138 s, sans survivant observé, mais une assertion
de refus de version Codex échoue (`workspace-scope-guard.test.js:763`). Une
campagne simultanée crash/MCP/oracle termine en 162,409 s avec une assertion
de restauration échouée (`native-host-crash-recovery.test.js:313`, créations
PTY expirées à 5000 ms), sans survivant observé. Les replays ci-dessus sont
verts sans changer une assertion ou un délai. Ces premières campagnes ne sont
pas comptées comme des passes. Un premier appel generations sans build historique
a ignoré les cas historiques : résultat rejeté, puis remplacé par le run
`H2A_TEST_REQUIRE_LEGACY_HOST=1`, 13/13 réellement exécutés.

**RED → GREEN observé** : les CI coupées à 600 s, puis la relance #401 au même
SHA à 394,301 s et les terminaisons ciblées ci-dessus. Ce n'est pas une preuve
avant/après d'un correctif de fuite : aucune fuite n'a été reproduite, aucun
correctif de fuite n'est proposé. Le blocage CI nécessite la mesure et la
réalisation du découpage par le conducteur.

## Proposition précise au conducteur

Responsable : conducteur h-cond. Implémenter trois invocations Node séparées,
chacune conservant le backstop **600000 ms**, depuis `discoverTestFiles()` trié :

| Groupe | Prédicat exact | Fichiers au HEAD diagnostiqué |
| --- | --- | ---: |
| corpus | `file.endsWith('/drive-consent-index.test.js')` | 1 |
| native | `/\/native-[^/]+\.test\.js$/.test(file)` | 27 |
| reste | complément des deux prédicats | 321 |

La partition a été calculée sur le checkout : total 349, union 349,
aucun doublon. Les nouveaux fichiers continuent d'être découverts.
Cette proposition est à implémenter et à mesurer par le conducteur ; son
efficacité globale n'est pas attestée par les seuls tests ciblés.

Conserver les arguments d'isolation et de reporters, produire un rapport
distinct par groupe, agréger leurs résultats avant la vérification existante
de l'inventaire et des 42 contrats L0. Refuser un rapport absent, une identité
dupliquée, une partition incomplète ou un groupe non nul. Garder le trust-root
indépendant, les suites Vitest et la lane identité. Si les groupes sont exécutés
séquentiellement, mesurer aussi le budget extérieur existant de 21 minutes ;
aucune augmentation de celui-ci n'est proposée sans cette mesure.

Acceptation : CI Node 22/24 et trust-root terminent avec l'inventaire complet,
les trois durées publiées et aucun enfant de test survivant. Répéter le run
CI pour couvrir la variabilité observée. Ajouter les contrôles de partition
et de rapports manquants au trust-root. Aucun skip, retrait d'assertion ou
changement de plafond n'est inclus dans ce diagnostic.

Revue indépendante : non réalisée ; aucun outil `h2a_run` n'est disponible
dans ce confinement, et l'accès à l'hôte installé est interdit. Aucun consensus
n'est revendiqué.
