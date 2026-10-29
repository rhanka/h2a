---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: 56b679ebeff7da6ae6e8a9a081ef669e5a7528bc
observed-failure: No h2a_run MCP tool is available in this confinement; installed h2a and owner host state are forbidden. Exact author model and effort are not exposed. No eligible peer selection or consensus verdict is claimed.
---

# L1 — installation du skill mémoire producteur

`install-skills` résout uniquement `skills/engram-memory/SKILL.md` depuis
le package installé `@sentropic/engram`, sans importer son code. Le résumé et
le reçu `.h2a-source.json` exposent package, version, chemin et SHA-256 source ;
le reçu ajoute le SHA-256 du rendu installé. Agy conserve le TOML et son hint
d’import ; ses ressources utilisent la version du producteur hors du catalogue
des commandes. Les quatre hôtes Markdown conservent les octets du producteur.

Une réinstallation identique ne réécrit rien. Les fichiers personnalisés ou
étrangers restent protégés. Une source mémoire absente apparaît avec
`status: missing`, `count: 0`, le chemin manquant et un diagnostic stderr. Les
autres sources restent installables ; les fichiers Engram précédemment gérés
restent présents, sans désactiver le nettoyage des anciens fichiers h2a.

## Commandes et résultats locaux

Toutes les commandes ont utilisé `TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-h9B2Ks`.
Les tests ont utilisé un HOME et un XDG_RUNTIME_DIR isolés. Aucun hôte réel,
état propriétaire, binaire h2a installé ou suite locale complète n’a été utilisé.

```sh
rtk npm ci --ignore-scripts --no-audit --no-fund
rtk npm run build -w @sentropic/track
rtk npm run build:h2a
rtk node --test packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js
```

RED avant modification du produit : **23 pass, 5 fail, 0 skipped**. Les cinq
nouveaux témoins échouaient sur la source Engram, son absence non signalée,
le rendu Agy, le plugin et le tarball. Le témoin supplémentaire de nettoyage
ciblé a ensuite échoué sur `an optional missing producer must not disable core
pruning` : **18 pass, 1 fail, 0 skipped**, avant correction de ce périmètre.

```sh
rtk npm run build:h2a
rtk node --test --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-convergence.test.js
rtk git diff --check
```

GREEN final : build code **0**, **53 pass, 0 fail, 0 skipped**, diff-check code
**0**. Cette exécution utilise seulement comme fixture externe le texte validé
via `H2A_MEMORY_SKILL_FIXTURE=/home/antoinefa/src/graphify/.graphify/scratch/design/memory-skill/SKILL.md`,
SHA-256 `dd4f17695844a65ae10fa7c9b023578f0c9f8688b446e5ba790fbb39f3abfbaf`.
Le texte n’est pas livré dans h2a. Les quatre premières suites ont aussi été
rejouées sans cette variable : **28 pass, 0 fail, 0 skipped** avec une petite
fixture synthétique autonome. Le test tarball extrait réellement h2a et Track
depuis `npm pack --ignore-scripts` puis lance l’artefact dans un HOME isolé.

Le contrôle `rtk node packages/h2a/dist/bin.js harness verify --category static`
avec BRANCH.md, les onze chemins modifiés et les noms de branche attendu/réel
a initialement signalé les chemins inconnus : la liste narrative ne suivait pas
le format du parser. Après déclaration explicite `Allowed Paths`, sa sortie est
`PASS harness verify (static): 2 check(s)` (C1 branche et C2 périmètre).

Un essai intermédiaire a dépassé la limite subprocess de 15 s (`ETIMEDOUT`,
17 pass / 2 fail / 0 skipped). La même commande a été rejouée sans modifier
la limite ; les exécutions finales ci-dessus passent. Une ponctuation invalide
dans la fixture de ressource a également été corrigée, sans changer le renderer.

## Limites de qualification

`rtk npm view @sentropic/engram@0.22.1 version dist.integrity exports dependencies files --json`
a renvoyé **E404**. Le consommateur est donc qualifié avec un package producteur
isolé portant la version `0.22.1`, un export ESM imbriqué et un module qui lève
si importé. Cela ne prouve ni la publication du package réel ni l’activation des
outils mémoire MCP : le tuple publié relève de L0 et le dispatch de L2.

La revue consensus exigée par `harness/review` n’a pas pu être lancée : aucune
capacité MCP h2a n’est disponible et les règles du propriétaire interdisent
d’accéder à l’installation réelle. Aucun avis indépendant n’est revendiqué.

## Correctif du blocage CI de nettoyage

La CI du commit `701feac72` a terminé avec **14 checks passants, 1 échec** :
`npm-test-trust-root`, run `40879335502`, job `123466338764`. L’unique test
en échec est `startup-latency: restoring ten resumes with 500 registry rows
converges within 30 seconds` : les dix reprises retournent 0 en 1 663 ms, puis
`restart-lab.js:63` échoue avec `ENOTEMPTY` en supprimant le HOME temporaire.

Le laboratoire envoyait SIGKILL aux PID privés enregistrés mais attendait
seulement la fermeture de ses enfants directs. Un témoin retarde la fin d’un
descendant enregistré : le helper supprimait déjà son HOME alors qu’il était
encore vivant. Le helper attend désormais l’arrêt des descendants enregistrés,
en conservant la vérification PID/date de naissance et en relisant les reçus
privés avant suppression. Aucun changement du runtime, du délai des tests ou
des gates ; aucune suppression avec retry qui masquerait un écrivain actif.

```sh
rtk node --test --test-reporter=spec --test-name-pattern='^incident lab waits' packages/h2a/test/native-host-crash-recovery.test.js
rtk node --test --test-reporter=spec packages/h2a/test/native-host-crash-recovery.test.js
```

RED du témoin avant correction : **0 pass, 1 fail, 0 skipped**, assertion
`a pending descendant can still write into its HOME`. GREEN après correction :
**17 pass, 0 fail, 0 skipped** sur le fichier complet, avec les dix reprises
réussies en 653 ms. Le premier essai complet local a exposé l’absence de
`pty.node` après `npm ci --ignore-scripts` ainsi qu’une erreur d’API du mock,
corrigées avant ce RED probant. Le module local a été compilé directement en
C++ sans lancer de script d’installation ni utiliser l’installation réelle :

```sh
rtk mkdir -p node_modules/node-pty/build/Release
rtk g++ -shared -fPIC -O2 -std=c++17 -DNAPI_CPP_EXCEPTIONS -DNODE_GYP_MODULE_NAME=pty -I/usr/include/node -Inode_modules/node-addon-api node_modules/node-pty/src/unix/pty.cc -lutil -o node_modules/node-pty/build/Release/pty.node
```

## Tour 2 — réconciliation des deux P2 sur d04e3eb24

Les avis fournis portent tous deux sur `d04e3eb24fa0b3deff99a2be26776f7c2fea51db` :
Sol indique FUSIONNABLE, Astra NON-FUSIONNABLE. Les deux constats d’Astra sont
acceptés après reproduction locale avant modification du produit :

| Constat | RED observé | Correction |
|---|---|---|
| Agy, TOML personnalisé puis Engram 0.22.1 → 0.22.2 | Code 2 et TOML conservé, ancienne ressource supprimée | Conserver la génération de ressources et le reçu encore associés au TOML refusé |
| Muse/Vibe, SKILL.md personnalisé puis nouveau texte et version producteur | Code 2 et skill conservé, reçu remplacé par celui de 0.22.2 | Préserver le reçu et les ressources de la version réellement installée |

La convergence observe les conflits avant de planifier les écritures. Le skill,
ses ressources et son reçu partagent la cible du skill ; un conflit préserve
ces fichiers et empêche le nettoyage de leur ancienne provenance dans le
manifeste. Les autres skills restent installables. Une mise à jour réussie
continue de retirer les anciennes ressources gérées.

Les reproductions sont pérennisées dans `native-host-shared-skills.test.js`,
avec Claude et Codex comme contrôles. Chaque hôte subit deux refus successifs,
puis une mise à jour explicite avec `--force` et une réinstallation identique.
Les tests vérifient les octets conservés, les ressources utilisables, les reçus
source/rendu, le nettoyage après succès et l’idempotence. Le témoin de mise à
jour Agy sans personnalisation reste passant.

Toutes les commandes utilisent
`TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-YlDOoZ` ; HOME, USERPROFILE et les
répertoires XDG sont privés. Les campagnes finales utilisent `env -i` avec ces
chemins explicites et un PATH limité aux outils nécessaires. Aucun Python,
état propriétaire, binaire h2a installé ou suite complète locale.

```sh
rtk npm run build -w @sentropic/track
rtk npm run build:h2a
rtk node --test --test-reporter=spec packages/h2a/test/native-host-shared-skills.test.js
```

RED avant correction : **7 pass, 3 fail, 0 skipped** ; assertions
`the preserved command must not lose its referenced resource` (Agy) et
`a refused skill update must retain its installed source receipt` (Muse/Vibe).
GREEN après correction : build code **0**, **10 pass, 0 fail, 0 skipped**.

```sh
H2A_MEMORY_SKILL_FIXTURE=/home/antoinefa/src/graphify/.graphify/scratch/design/memory-skill/SKILL.md rtk node --test --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-recovery.test.js
```

Sortie : **61 pass, 0 fail, 0 skipped**. Les sept suites du tour 1 sont
rejouées, avec six nouveaux tests et les deux témoins existants de reprise du
journal. Le test d’artefact extrait à nouveau les tarballs h2a/Track et installe
la fixture producteur sur les cinq hôtes, sans repli vers le checkout.
La référence externe garde son SHA-256 validé ; aucun contenu mémoire vendored.

```sh
rtk node --test --test-reporter=spec packages/h2a/test/native-host-crash-recovery.test.js
rtk node --test --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js
rtk node packages/h2a/dist/bin.js harness verify --category static --current-branch feat/memory-skill-install --expected-branch feat/memory-skill-install --branch-md BRANCH.md --staged-files 'BRANCH.md,packages/h2a/src/hosts/native-skills.ts,packages/h2a/src/hosts/native-artifacts.ts,packages/h2a/test/native-host-shared-skills.test.js,docs/reviews/memory-skill-install.md'
rtk git diff --check
```

Sorties : reprise native **17 pass, 0 fail, 0 skipped** ; quatre suites sans
`H2A_MEMORY_SKILL_FIXTURE` **34 pass, 0 fail, 0 skipped** ;
`PASS harness verify (static): 2 check(s)` ; diff-check code **0**.
Au total, **78 tests distincts passants**, dont tous les 70 du premier tour.
Aucune modification de gate, dépendance, délai ou runtime.

Cette réconciliation ne constitue pas une nouvelle revue indépendante du
correctif. La sélection MCP demeure indisponible selon le contrat du skill
`harness/review` ; aucun nouveau verdict de consensus n’est revendiqué.
La publication du producteur et l’activation MCP restent hors qualification L1.

## Tour 3 — aucun reçu pour une installation refusée

Les deux avis fournis sur `2c088f62322f400b94412e91533a0d9375ecb34a`
retiennent le même nouveau P2. La boucle directe de `cmdInstallSkills`
préservait le point d’entrée personnalisé, mais installait les ressources et
créait un reçu attribuant les octets du producteur jamais installés. Le cas
concerne Claude/Codex en portée utilisateur et les cinq hôtes en portée projet.

La reproduction est pérennisée sur les dix combinaisons hôte/portée, avec et
sans reçu préexistant, puis deux refus successifs. Avant toute modification
du produit, sur la tête revue :

```sh
rtk node --test --test-reporter=spec --test-name-pattern='refused first install' packages/h2a/test/install-skills-hosts.test.js
```

Sortie RED : **6 pass, 14 fail, 0 skipped**, code **1**. Les sept chemins
directs créent un faux reçu absent ou installent des ressources de la génération
refusée ; les six contrôles de convergence native préservent déjà l’ensemble.
Les reçus antérieurs restent inchangés dans les deux chemins.

La boucle directe observe désormais tous les artefacts d’un skill producteur avant la
première écriture. Tout conflit préserve cet ensemble ; un conflit observé
ensuite interrompt aussi la boucle avant le reçu. Les écritures sont relues
et comparées aux octets attendus ; ressources puis point d’entrée précèdent
le reçu. Le test du paquet extrait couvre aussi les dix combinaisons : refus
sans reçu, installation réussie, hashes source/rendu et réinstallation sans
écriture. Les témoins du tour 2 conservent les mises à jour forcées et le
nettoyage Agy après succès.

```sh
rtk npm run build:h2a
rtk node --test --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js
```

Sorties : build code **0**, `vendor-engram-live mirror OK` ; installeur
**39 pass, 0 fail, 0 skipped**, code **0**.

Toutes ces commandes utilisent `env -i`, un PATH explicite et
`TMPDIR=/home/antoinefa/.cache-tmp/h2a-test/run-tV6A2U`, avec HOME, USERPROFILE,
XDG_RUNTIME_DIR et les répertoires XDG privés. Le préfixe d’isolation est omis
dans les exemples. Aucun Python, état propriétaire ou binaire h2a installé.

La réconciliation accepte le P2 commun après reproduction. Aucune nouvelle
revue indépendante n’est revendiquée : `status: selection-failed`, absence
de `h2a_run` MCP et métadonnées exactes modèle/effort auteur inconnues.
La cible du tour 3 est le diff des trois fichiers code/tests par rapport à
`2c088f623` (`git diff HEAD --no-ext-diff -- packages/h2a/src/cli.ts packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-package.test.js`),
SHA-256 `3e3e2bc5f9bdc07b71974dfcb33c16abe6dac8e229a346a1553725eeccfb882b`.

```sh
H2A_MEMORY_SKILL_FIXTURE=/home/antoinefa/src/graphify/.graphify/scratch/design/memory-skill/SKILL.md rtk node --test --test-concurrency=1 --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-recovery.test.js
```

Sortie : **81 pass, 0 fail, 0 skipped**, code **0**, dont les 20 nouveaux
témoins et les huit suites du tour 2. La référence externe conserve son
SHA-256 validé ; aucun contenu producteur n’est ajouté au dépôt.

Un premier lancement simultané des huit fichiers et de la campagne de reprise
a produit deux `spawnSync /usr/bin/node ETIMEDOUT` dans l’installeur
(**79 pass, 2 fail**) et quatre reprises refusées avec
`terminal host create request timed out after 5000ms` dans un cas de reprise
(**16 pass, 1 fail**). Les huit fichiers ci-dessus ont ensuite été rejoués
successivement sur les mêmes octets ; aucun délai, assertion ou gate n’a changé.

```sh
rtk node --test --test-reporter=spec packages/h2a/test/native-host-crash-recovery.test.js
```

Reprise native seule : **17 pass, 0 fail, 0 skipped**, code **0** ; les dix
reprises réussissent en **628 ms**. Total des neuf fichiers : **98 tests
distincts passants**, dont les 78 du tour 2 et les 20 nouveaux cas.

```sh
rtk node packages/h2a/dist/bin.js harness verify --category static --current-branch feat/memory-skill-install --expected-branch feat/memory-skill-install --branch-md BRANCH.md --staged-files 'BRANCH.md,packages/h2a/src/cli.ts,packages/h2a/test/install-skills-hosts.test.js,packages/h2a/test/native-host-package.test.js,docs/reviews/memory-skill-install.md'
rtk git diff --check
```

Sorties : `PASS harness verify (static): 2 check(s)` ; diff-check code **0**.

```sh
rtk node --test --test-concurrency=1 --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js
```

Rejeu avec la fixture autonome, sans `H2A_MEMORY_SKILL_FIXTURE` :
**54 pass, 0 fail, 0 skipped**, code **0**.

### Suivi CI — conserver le remplissage des ressources cœur

La CI de `aff742e29` a exposé une extension trop large de la protection :
les douze cas existants `preserves existing files and fills missing resources:
upgrade` de `native-question-mode.test.js` attendent toujours le remplissage
des ressources manquantes d’un skill cœur dont le point d’entrée est préservé.
Ces skills ne portent aucun reçu producteur. Les deux jobs `scoped-hosts`
Node 22/24 échouent sur ces cas ; aucune assertion n’a été modifiée.

```sh
rtk node --test --test-reporter=spec packages/h2a/test/native-question-mode.test.js
```

RED local, avant cette correction : **32 pass, 12 fail, 0 skipped**, code **1**,
avec `ENOENT .../present-decision/assets/native-questions.md`.
Le précontrôle d’ensemble, l’arrêt avant reçu et la relecture concernent
désormais uniquement les skills producteur (`skill.producer`). Le remplissage
historique des ressources cœur est conservé, avec leur garde individuelle.

Cible de ce suivi : `git diff HEAD --no-ext-diff -- packages/h2a/src/cli.ts`
par rapport à `aff742e29`, SHA-256
`47f77a754e3b69517b0b1f6e6b96cb25675fdf6192bfe9393763635ed5c33e5a`.
La sélection de revue reste indisponible pour les mêmes raisons explicites.

```sh
rtk npm run build:h2a
H2A_MEMORY_SKILL_FIXTURE=/home/antoinefa/src/graphify/.graphify/scratch/design/memory-skill/SKILL.md rtk node --test --test-concurrency=1 --test-reporter=spec packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/native-host-package.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-recovery.test.js packages/h2a/test/native-question-mode.test.js
```

GREEN : build code **0**, `vendor-engram-live mirror OK` ; **125 pass,
0 fail, 0 skipped**, code **0**, dont les 44 questions natives. Les tests
existants restent intacts, ainsi que les 20 nouveaux témoins de refus mémoire.

La reprise native est rejouée séparément après cette correction : **17 pass,
0 fail, 0 skipped**, code **0**. Total final : **142 tests distincts verts**.
Le rejeu autonome des quatre suites installation/package est également répété :
**54 pass, 0 fail, 0 skipped**, code **0**. Périmètre/branche :
`PASS harness verify (static): 2 check(s)` ; `git diff --check` code **0**.
