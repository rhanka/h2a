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
