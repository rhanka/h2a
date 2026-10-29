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
