# Native cleanse L0 — PR #396, round 3

Remplace les conclusions de gate du [round 2](native-cleanse-l0-r2.md).
Périmètre : L0 de `tmp/h-cond/spec-native-cleanse-a.md`, SHA-256
`bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`.
Aucune implémentation produit L1–L6.

| Constats Astra / Sol | Correction vérifiée |
|---|---|
| P1 : RED absorbés dans les gates | Les 42 contrats ont chacun un test littéral obligatoire dans l'inventaire npm. Chaque test exige une observation produit, exécute l'assertion désirée et ne reconnaît que son erreur exacte : nom, code, opérateur, actual, expected et message. |
| P1 : faux succès malgré un autre défaut | Les contrats d'installation vérifient aussi les digests/configurations figés avant npm, indépendamment du produit. Une autre obsolescence, une erreur inconnue ou une observation absente échoue en mode normal. Un contrat réparé produit directement GREEN. |
| P2 : MCP `version` / `echo` acceptés | Résolution de l'exécutable et de ses arguments, unicité des routes, vrai échange stdio `initialize` et `tools/list`, identité/version du candidat. Contrôle positif exécuté sur le candidat réellement installé. |
| P2 : texte / `echo` accepté comme hook | Parsing du hook PreToolUse sélectionné, matcher/type/activation/arguments et ancrage ; comparaison des trois helpers et exécution du helper enregistré sur entrée malformée, avec refus structuré observé. |
| P2 : cache plugin incomplet / cache Codex deviné | Comparaison des manifests et de tous les fichiers skills/hooks, incluant helpers et ressources. Codex : résolution de la marketplace sélectionnée, source du plugin, version et cache qui en découle ; `main` et cache candidat non sélectionné restent non courants. `enabled=false` est conservé. |

Les contrôles indépendants de `run-test-gates.test.js` exigent les 48 identités
baseline et les six identités d'oracle dans la découverte et l'inventaire.
Ils vérifient que chacun des 42 contrats absent du rapport, skipped, todo ou
failed bloque le vérificateur réel du step `tests`. Deux mutations retirent
respectivement l'assertion désirée et la vérification des bytes historiques :
le probe externe échoue dans les deux cas.

## Commandes et sorties

Toutes les commandes utilisent le TMPDIR privé indiqué ci-dessous, HOME/XDG/npm
privés et aucun bus propriétaire. Prérequis de chaque source de contrôle :
`npm run build -w @sentropic/track`, puis `npm run build:h2a`.

```sh
node --test packages/h2a/test/native-cleanse-oracle.test.js
# mêmes contrôles avec helpers de d45120064 : 6 tests, 1 pass, 5 fail, 0 skip/todo
# helpers corrigés : 6 tests, 6 pass, 0 fail, 0 skip/todo

node --import ./packages/h2a/test/helpers/native-isolation.js --test \
  --test-reporter=tap --test-reporter=./scripts/node-evidence-reporter.mjs \
  --test-reporter-destination=<log> --test-reporter-destination=<report.json> \
  packages/h2a/test/native-cleanse-baseline.test.js \
  packages/h2a/test/native-cleanse-oracle.test.js
# 54 tests, 54 pass, 0 fail, 0 skip/todo ; 42 KNOWN-MISSING RED exacts
# verifyNodeTrackExecution(report, fichiers) : []
# declarationFailures(checkout, inventaire) : []

node --test packages/h2a/test/run-test-gates.test.js
# 44 tests, 44 pass, 0 fail, 0 skip/todo

H2A_CLEANSE_STRICT=1 node --import ./packages/h2a/test/helpers/native-isolation.js \
  --test packages/h2a/test/native-cleanse-baseline.test.js
# main 912dd3035, rc.7 8d588db05 et head : chacun 48 tests,
# 6 pass, 42 fail, 0 skip/todo ; même première erreur contractuelle :
# L0 contract: claude installed skill bytes — false !== true
```

Reproduction combinée exacte du round 2 : huit MCP réglés sur `version`,
deux hooks sur `echo`, helpers plugin absents et marketplace Codex initiale
toujours sur `main`, avec cache candidat ajouté. Ancien oracle : 31/31 GREEN ;
nouvel oracle : 12 artefacts non courants et échec de gate normal.
Les contrôles séparés couvrent aussi commentaires sans hooks, désactivation,
dépendance manquante, doublon MCP et réponse sans protocole MCP.

La vérification indépendante avec l'ancien inventaire (six identités seulement)
échoue : les 42 assertions contractuelles ne peuvent plus disparaître derrière
les six parcours généraux.

Rejeu round 1 : formats rc.7 conservés (UUID v4, maps tabulées/flock, claim
SHA-256, registre complet). Les vrais run frais/reprise et restore des vingt
UUID exécutent dispatcher/flock et acquittements PTY sur main et rc.7.
Lock-id, lignes humaines/non classées et barrières non attribuables sont
préservés. Cela ne démontre pas une panne de disponibilité identique à
l'incident ; les contrats d'archivage/convergence restent manquants.

L1 rendra GREEN les huit contrats de récupération ; L3 les trois contrats
du paquet ; L3/L4 les 31 contrats d'installation. L2, L5 et L6 restent séparés.
Le mode normal prouve l'état L0 exact ; il ne qualifie pas ces lots comme livrés.

Logs conservés sous `tmp/h-cond/fix-native-cleanse.r3-*.log`.
Les dépendances npm de test utilisent le binding node-pty déjà compilé via
un preload privé `--require <TMPDIR>/precompiled.cjs` : npm/lifecycle produit
restent actifs, aucune compilation native/Python n'est revendiquée.
Les premières tentatives de build des copies sans leurs node_modules de
workspace ont échoué ; après copie des dépendances locales, les builds ont
réussi. Ces erreurs d'environnement ne sont pas comptées comme RED contractuels.

Suite locale complète non exécutée. Pas de nouveau consensus de pairs revendiqué.
TMPDIR `/home/antoinefa/.cache-tmp/h2a-test/run-JVcxYc` : fixtures/processus privés
nettoyés ; répertoire supprimé et absence vérifiée à la livraison.
Aucun état propriétaire, binaire h2a installé, merge, tag ou trailer d'attribution.
