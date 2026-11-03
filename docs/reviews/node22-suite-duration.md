# Node 22 : épuisement du budget de la suite Node

## Décision adoptée et implémentation — 1 novembre 2026

Le conducteur adopte le découpage en trois invocations séquentielles : corpus,
`native-*`, reste. `partitionNodeTestFiles()` applique les prédicats ci-dessous
à la découverte triée, sans liste de fichiers maintenue à la main ; les chemins
Windows sont normalisés pour la sélection. Chaque invocation conserve le
backstop **600000 ms**, le préchargement d'isolation et les deux reporters.
Les plafonds extérieurs de 21 minutes et de 25 minutes ne changent pas.

Les trois rapports ont des chemins distincts. Leur agrégation avec Track
passe par `verifyNodeTrackExecution()` : inventaire complet, identités de
fichiers uniques, compteurs et statuts recomptés, déclarations non-tests et
42 contrats cleanse inchangés. Un rapport absent ou malformé, un fichier
dupliqué ou un code de sortie non nul fait échouer l'entrée. Les autres
invocations et gates continuent. Chaque groupe publie sa durée murale et
son code de sortie, puis l'inventaire agrégé confirmé est journalisé.

La régression indépendante dans `run-test-gates.test.js` vérifie union,
disjonction et ajout futur par règle, puis exécute l'entrée réelle dans un
laboratoire à frontière de processus simulée. RED : export absent ; puis
l'ancienne invocation unique est refusée. GREEN : les trois tests ciblés
passent, avec quatre injections de défaut de preuve/code de sortie.
Commande : `node --test --test-name-pattern='Node buckets partition|Node bucket evidence|C9 A04: execute' packages/h2a/test/run-test-gates.test.js`,
TMPDIR privé `run-858qUw` ; 3 pass, 0 fail, 0 skip, 2678 ms sur Node 22.
Les jobs 22/24 et trust-root utilisent automatiquement cette entrée commune.
Qualification locale ciblée : `run-test-gates`, `gate-execution-evidence`,
`lane-test-scope`, `prepared-npm-cache` et `native-spawn-guard` : **128/128**,
zéro skip/todo, sous Node 22.22.1 (17,765 s) et Node 24.22.0 (13,255 s).
La suite locale complète n'a pas été exécutée. Revue indépendante indisponible :
aucun outil h2a MCP dans le confinement ; aucun consensus revendiqué.
Les mesures CI et la qualification ciblée finale figurent dans le rapport
conducteur `tmp/h-cond/node22-split-last.md` et le corps de la PR #405.

## Diagnostic préalable

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

## Proposition initiale au conducteur (adoptée le 1 novembre)

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

## Addendum R4 (2026-11-03, PR #354) : dépassement node-22 ×2, croissance retirée sans hausse de budget

Run [41609982366](https://github.com/rhanka/h2a/actions/runs/41609982366),
job node-22 `125863903880` (attempt 2) : étape `tests` tuée à 1260,3 s sans
exit ; vitest h2a-runtime 559,5 s avec 5 échecs (2 timeouts 5 s + 3
crash-safety). Node 24 vert de bout en bout au même HEAD.

| Mesure (logs CI) | main `bf5b685d1` (run 41304247550) | branche node-24 | branche node-22 |
| --- | --- | --- | --- |
| Fichiers node:test | 363 | 479 | 479 |
| Étape `tests` | 839,9 s, exit 0 | 1249,4 s, exit 0 | tuée à 1260 s |
| Bucket rest | — | 442 fichiers, 1036,2 s | ≈1060 s (orphelin) |
| vitest h2a-runtime | 163,4 s | 184,1 s | 559,5 s (échec) |
| Suites > 60 s (locales) | 9 (node) + 1 (runtime) | 19 (node, preuves M17/bulk incluses) + 1 | 3 (runtime) |

Croissance introduite par la lane (heures locales node-24, bucket rest) :
`registry-packed-layout` 325 s (NOUVEAU, pack-candidate en before),
`registry-plugin-declarations` 298,8 s (NOUVEAU, même pack),
`succession-lock-seam-guard` 290,6 s (main < 56 s ; packRelease sous
contention), `workspace-scope-guard` 200,2 s (main 94 s).
Les durées M17 (1056,5 s) et bulk importées via preuves ne sont pas du
travail local. Le kill à 1260 s laisse des orphelins `node --test` qui
concurrencent l'étape h2a-runtime suivante : c'est cette contention, et non
le code, qui fait flancher les 5 tests vitest (verts sur 24).

Retrait (aucune assertion relâchée, aucun budget relevé) :
`packages/h2a/test/helpers/shared-pack-candidates.mjs` — un seul
pack-candidate par état d'arbre (clé = HEAD + `git status` + producteurs +
versions), verrou inter-processus, repli en pack privé ; les trois suites
consommatrices gardent leurs noms de tests et assertions.
`mh-l3-recovery` (échec réel node-22, 77,3 s ; vert sur 24 en 45,2 s) :
boucle de stabilisation bornée en temps réel + suppression du assert
dur mid-drive (attachement tardif) ; contrat final inchangé.
Budgets explicites vitest : test tsc live-disclosure 120 s, pagination
live-github 60 s, `eventually` crash-safety en temps réel (30 s) + timeouts
de tests 60 s (bottes tsx lentes sous charge).

Aucune hausse de budget proposée : le volume pack dupliqué (≈2 packs de
~250 s contentionnés) est supprimé à la source. Si node-22 dépasse encore
1260 s après ce retrait, la décision budget revient au conducteur avec les
mesures ci-dessus.

## Complément R4b : chevauchement du pack + 4e producteur supprimé

Le run R4 ([41630476086](https://github.com/rhanka/h2a/actions/runs/41630476086))
montre la limite du seul partage : node-22 vert (`tests` 970,0 s, rest
783,4 s, h2a-runtime 162,2 s) mais node-24 au-dessus (rest 1079,4 s, kill à
1260,2 s en phase Track ; un bound vitest de 2 s a flanché sous les orphelins,
mécanisme déjà vu en R3). Le mur ne bouge presque pas car les 3 packs
chevauchés coûtaient déjà ~250 s de mur : il faut sortir le pack du chemin
critique, pas seulement le dédupliquer.
`scripts/warm-pack-candidates.mjs`, lancé fire-and-forget par
`run-tests.mjs` avant les buckets et moissonné dans le `finally` (kill borné
30 s, verrou à reprise sur propriétaire mort) : le pack (~250 s) recouvre le
bucket natif (~150 s) au lieu de s'empiler dans rest. Le garde-fou
`succession-lock-seam-guard` (4e packRelease esbuild) qualifie désormais le
tarball candidat partagé — même octets publiés, assertions inchangées, repli
pack privé. Économie attendue : ~200-250 s de mur sur rest + 4e presseur CPU
en moins, donc moins de variance. Cibles : `tests` ≈ 1090 s sur base
node-24. Si le kill persiste, décision budget conducteur (pas de hausse
aveugle ici).

## Complément R4d : clé gelée + enveloppe B + lab

Le run R4b montre deux reps : (1) le lab `node-track-observation` épingle la
structure exacte des enfants — le spawn warmer y est admis (hors compteur
des 4 suites, marqueur dédié), preuve locale 55/55 sur
`run-test-gates.test.js` ; (2) un 2e pack mid-run (clé recalculée par
processus sur un `git status` volatil) annule le gain : la clé est désormais
gelée par `run-tests.mjs` (`H2A_SHARED_PACK_KEY`, import dynamique
transparent pour le lab) et chaque pack écrit `key-inputs.json` pour nommer
tout futur basculement. Enveloppe du B incident lane 2 s → 10 s (timers
RPC à 2 s et assertions reclaim/instance inchangés ; bound mesuré >2 s sous
charge lane + 3 suites vitest) — même classe que T4 en R3. Note : le lane ne
copie jamais `vendor/` dans le candidat, d'où la mention stderr
`integrity_mismatch` permanente (non fatale par conception, §7.2) ; écart de
fidélité signalé au conducteur, hors périmètre ici.

Revue indépendante : non réalisée ; aucun outil `h2a_run` n'est disponible
dans ce confinement, et l'accès à l'hôte installé est interdit. Aucun consensus
n'est revendiqué.
