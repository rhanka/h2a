# PR #396 — L0, correction round 6

Lot L0 « Baseline witnesses », spec SHA-256
`bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`.
Réception du P2 Astra sur `208e59ef17fb0cd00453caa8a1142c5f8da38b24`.

Le probe MCP partage son cache par argv. Seul Vibe vérifiait l'activation
avant ce cache : un MCP Codex avec `enabled=false` restait accepté GREEN.
L'oracle compare maintenant, pour les huit adaptateurs, l'activation aux choix
figés par `seedHosts` avant installation. `enabled=false`, `disabled=true` et
les valeurs non booléennes sont contrôlés avant tout accès au cache. Une
entrée initialement désactivée conserve sa sélection et sa cible actuelle,
sans exiger de handshake. Le transport stdio de Vibe reste obligatoire.

Les huit contrôles littéraux couvrent Claude, Codex, Gemini, Agy, Hermes,
OpenCode, Muse et Vibe : état sain implicite/explicite, deux désactivations
imprévues, mauvais types, sélection initialement désactivée, réactivation
interdite et cible périmée. Le contrôle de réactivation restaure d'abord le
serveur sain et exige que la mutation ait changé le fichier. Le helper de
fixture préserve les flags JSON/YAML lorsqu'il actualise les argv.
La reproduction exacte Codex forme un neuvième contrôle permanent.

Les neuf identités sont obligatoires dans `scripts/test-inventory.json` et
dans la trust root indépendante de `run-test-gates.test.js`. Le ledger de
42 contrats et le code produit restent inchangés.

## Preuves

Toutes les campagnes utilisent un TMPDIR privé et
`H2A_TEST_QUALIFICATION_ROOT=$TMPDIR`. Prérequis :
`npm run build -w @sentropic/track`, puis `npm run build:h2a`, exit 0.

| Commande / reproduction | Résultat observé |
|---|---|
| `node --test packages/h2a/test/native-cleanse-oracle.test.js`, reproduction Astra avant correctif | 13 PASS / 1 FAIL ; `true !== false` pour Codex désactivé. |
| Même fichier avec les huit contrôles ajoutés, ancien observateur | 13 PASS / 9 FAIL ; un négatif RED par adaptateur, plus la reproduction Codex. |
| Baseline + oracle après correction via le vrai `runGates`, reporter et vérificateur du step npm `tests` | **70/70 PASS**, gate 0, 42 RED exacts transmis. |
| `node --test packages/h2a/test/{run-test-gates,gate-execution-evidence,prepared-npm-cache}.test.js` | **120/120 PASS**. |
| `node "$TMPDIR/mutations.mjs"`, copie privée et assertion locale neutralisée | a/b/c : gates **1/1/1**, malgré **48 PASS** dans chaque enfant ; réparation + ledger GREEN : gate **0**. |
| `node "$TMPDIR/packaged-disabled.mjs"`, vrai candidat installé, contrat MCP Codex déclaré GREEN | Ancien helper : activé et désactivé **48/48, gate 0**. Correctif : activé **48/48, gate 0** ; désactivé **47 PASS / 1 FAIL, gate 1**, contrat observé RED. |
| `node "$TMPDIR/race.mjs"`, verrou énuméré puis supprimé avant stat | Ancien témoin : **43 PASS / 5 FAIL**, gate 1 ; témoin corrigé : **48/48**, gate 0, 42 contrats. |
| `node "$TMPDIR/repeat.mjs"`, corps du témoin sockets inchangé, dix répétitions avec quatre contrats chacune | **50/50 PASS**. |
| `node "$TMPDIR/history.mjs"`, reconstructions de main `912dd3035` puis rc.7 `8d588db05`, baseline via la même gate | Chacune **48/48 PASS**, gate 0, mêmes 42 signatures RED. |
| `node --require "$TMPDIR/precompiled.cjs" --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/native-host-crash-recovery.test.js packages/h2a/test/identity-binding-contention.test.js` | **19/19 PASS**. |
| `node node_modules/vitest/vitest.mjs run --config packages/h2a-runtime/vitest.config.ts packages/h2a-runtime/src/terminal-reset.functional.test.ts` | **6/6 PASS**. |

Zéro skip/todo. Le driver privé conserve le vrai step `tests` de
`scripts/run-test-gates.mjs`, son reporter et son vérificateur, en limitant
les fichiers exécutés aux témoins autorisés :

```sh
node --require "$TMPDIR/precompiled.cjs" \
  --import ./packages/h2a/test/helpers/native-isolation.js --test \
  --test-reporter=tap --test-reporter=./scripts/node-evidence-reporter.mjs \
  --test-reporter-destination=<tap> --test-reporter-destination=<report.json> \
  packages/h2a/test/native-cleanse-baseline.test.js \
  packages/h2a/test/native-cleanse-oracle.test.js
```

Les copies historiques utilisent les dépendances déjà présentes de ce checkout,
liées au niveau racine et au niveau des paquets. Un premier rebuild dépourvu
des liens locaux a échoué à résoudre cluster-mesh/commander ; il n'est pas
compté comme RED produit. Les deux reconstructions et gates finales passent.

Les rounds 1–5 sont rejoués : formats rc.7, cinq tarballs réellement
préparés/prepackés/installés, vrais run/reprise sur deux endpoints, restore
de vingt UUID via dispatcher/flock et acquittements PTY, préservation du
lock-id et des lignes humaines/inconnues ; anciens faux GREEN MCP version,
echo et protocole, hooks fictifs/désactivés/doublonnés, ressources et caches
Codex, activation Agy, MCP du plugin actif et collisions binaires ; sélection
et transport Vibe, parcours ENOENT avec refus d'EACCES, teardown et contention,
ordre stty/ready et assertions termios.

Les PASS L0 attestent la conformité au ledger : les contrats manquants
restent RED pour L1 (récupération), L3 (paquet) et L3/L4 (intégrations).
L2/L5/L6 restent séparés. Les fixtures d'adaptateurs ne qualifient pas les
CLI fournisseurs réels ; les distinctions de la matrice d'intégration restent
applicables. La disponibilité sur rc.7 ne prouve pas l'incident exact du 28/10.

L'oracle a pris 73 s lors de la campagne concurrente locale, dont les nouveaux
contrôles complets des huit adaptateurs. Le seuil de 60 s du reporter est un
diagnostic ; aucun budget CI, timeout, retry ou garde n'a été augmenté.
Binding node-pty précompilé fourni par preload privé pour respecter
l'interdiction de Python ; lifecycles npm produit actifs, recompilation native
locale non qualifiée. Suite complète locale et nouveau consensus de pairs
non revendiqués : MCP h2a absent et dispatch installé interdit par le
confinement propriétaire.

Logs : `tmp/h-cond/fix-native-cleanse.r6-*`. TMPDIR privé :
`/home/antoinefa/.cache-tmp/h2a-test/run-TSffAe`, à supprimer après suivi CI.
Aucun état propriétaire ni binaire h2a installé utilisé. Aucun merge, tag ou
trailer d'attribution.

## Correction du blocage CI Node 24

Premier push `064a7f7e0` : **18/19 checks verts**. Les neuf nouveaux
contrôles MCP passent aussi dans le job Node 24, mais le témoin
`native-foreign-host-probe.test.js` échoue dans `legacyHost` :
`ENOENT stat /proc/21449/fd/24`. Un listener vivant peut fermer un FD de
démarrage entre son énumération et son inspection.

La correction reste dans la fixture : une entrée qui disparaît ne retient
plus le répertoire ; toute autre erreur de stat remonte. L'énumération du
répertoire FD, la comparaison device/inode, l'assertion d'absence de pin,
les vrais listeners et les preuves LIVE/UNKNOWN restent inchangés.

Le nouveau contrôle permanent ouvre un vrai fichier privé, énumère son FD,
le ferme puis l'inspecte ; il vérifie aussi qu'un FD de répertoire ouvert
reste détecté et qu'EACCES n'est pas absorbé. Il est déclaré dans l'inventaire
npm. Sous Node **24.22.0**, avant traitement d'ENOENT : **18 PASS / 1 FAIL**,
erreur procfs exacte. Après correction, le fichier complet est **19/19 PASS**
sous Node **22.22.1 et 24.22.0**, zéro skip/todo.

```sh
node --require "$TMPDIR/precompiled.cjs" \
  --import ./packages/h2a/test/helpers/native-isolation.js --test \
  --test-reporter=tap packages/h2a/test/native-foreign-host-probe.test.js
```

Logs : `fix-native-cleanse.r6-ci-node24-first.log`,
`fix-native-cleanse.r6-fd-red.log` et
`fix-native-cleanse.r6-fd-node{22,24}-green.log` sous `tmp/h-cond`.
Aucun retry, délai, garde d'isolation ou code produit modifié.
