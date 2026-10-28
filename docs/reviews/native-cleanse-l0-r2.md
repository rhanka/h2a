# PR #396 — correction des témoins L0

Portée : lot L0 de `tmp/h-cond/spec-native-cleanse-a.md` (SHA-256
`bb04ea7385588cd2421fd1f5e3b64fc50ef5bd417c94c05de6811aec2ce22d08`).
Le commit poussé `9f4b16d49` est conservé. Aucun correctif produit L1–L6,
changement de version ou duplication du hotfix #394.

| Finding des deux revues | Correction | Preuve |
|---|---|---|
| P1, assertions inversées | Assertions du résultat attendu, sans recherche de mots dans les sources. Le mode strict lève les vraies erreurs ; la lane L0 les publie comme diagnostics RED nommés. Un contrat corrigé est accepté GREEN. | 42 assertions attendues RED sur les chemins exécutés ; six témoins stricts en échec. |
| P1, parcours produit absent | Candidat installé : vrais `run` frais/reprise et `restore` non dry-run. La frontière GUI lance les argv du dispatcher produit ; un wrapper appelle le vrai `/usr/bin/flock`. | Deux endpoints, 20 UUID originaux lancés une fois, maps consommées, PTY ready + acquittement d'entrée, un propriétaire par session. |
| P1, paquet non testé | Vrai `release-candidate prepare → prepack → npm pack → npm install -g --prefix`, lifecycle actif, cinq tarballs locaux de la même RC synthétique `0.98.7-rc.999`. HOME/XDG/npm/PATH isolés avant ces commandes. | Digests des tarballs et identités installées contrôlés ; inventaire indépendant de 31 observations sur huit adaptateurs. |
| P2, fixture incompatible rc.7 | UUID v4 privé conservé en octets/inode ; maps tabulées, fichier flock vide, noms SHA-256(convId), publication pending et hard-link reclaim aux formats réels ; champs obligatoires du registre et frame du boot précédent. | Les commandes passent publication, parsing et I/O sur le commit rc.7. La barrière legacy sans attribution conserve son inode et ne lance aucun second writer. |

## Assertions RED et lots qui les rendent GREEN

| Témoin | Résultat baseline réellement observé | Lot |
|---|---|---|
| Installation : 31 observations | 8 skills, 8 ressources liées, 8 résolutions MCP, 2 helpers, 2 registrations de hooks, import Agy et 2 caches plugin effectifs restent anciens après npm. Le plugin Codex désactivé et les sentinelles tierces sont conservés. | L3 moteur de convergence + L4 lifecycle |
| RC emballée : 3 assertions | Les deux plugin.json restent `0.98.7`, le manifeste d'intégration manque dans le tarball RC. | L3 |
| Run frais/reprise : 2 assertions | I/O réussie, mais pas d'archive du claim mort ni de retrait sauvegardé de la ligne background prouvée morte. | L1 |
| Restore réel : 1 assertion | Les 20 conversations fonctionnent ; les deux endpoints ne sont pas prêts à la frontière GUI avant le premier dispatcher. | L1 |
| Sockets persistants : 4 assertions | Les vrais hosts ont été lancés puis tués par leur propre handle ; le run suivant fonctionne, mais les deux inodes initiaux ne sont pas en quarantaine et aucun journal ne les référence. | L1 |
| Reclaim legacy : 1 assertion | Aucun nouveau writer ; exit 0 « already being resumed », au lieu du refus codé non zéro. | L1 |

Les fichiers interrompus et les maps legacy dont les consommateurs ne sont pas
prouvés morts restent en place. Leur rétention n'est pas une lacune RED.
La fixture ne transforme pas l'incident exact du 28/10 en panne supposée :
la disponibilité existante reste une assertion positive.

L'inventaire utilise des attentes figées et les octets du candidat, jamais la
liste ou les reçus produits par le synchroniseur. Les chemins Claude/Codex/Vibe
sont configurés ; Agy partage le store Gemini, mais son état importé est observé
séparément via une CLI fixture qui effectue les copies. Le workspace Muse et
ses hooks sélectionnés sont enregistrés. Les commandes MCP sont parsées et
résolues vers le préfixe effectif ; les caches plugin incluent leurs hooks.
Les fixtures rendues Gemini/Hermes/OpenCode ne constituent pas une qualification
vendor réelle. Les hooks optionnels non sélectionnés ne sont pas activés.
La migration MCP distincte reste hors portée.

## Commandes et résultats

Prérequis dans chaque checkout de contrôle : `npm run build -w @sentropic/track`
puis `npm run build:h2a`. Tous les tests utilisent le TMPDIR privé indiqué
ci-dessous.

```sh
H2A_CLEANSE_STRICT=1 node --test packages/h2a/test/native-cleanse-baseline.test.js
# origin/main 912dd3035 : 6 tests, 0 pass, 6 fail, 0 skipped, 0 todo
# rc.7 8d588db05 : 6 tests, 0 pass, 6 fail, 0 skipped, 0 todo

node --test packages/h2a/test/native-cleanse-baseline.test.js
# branche corrigée : 6 tests, 6 pass, 0 fail, 0 skipped, 0 todo
# 42 diagnostics RED, pas une qualification GREEN des lots futurs
```

La première assertion stricte est `claude installed skill bytes (L3+L4)`
(`false !== true`). Toutes les premières erreurs des six témoins sont des
contrats manquants, pas des erreurs de fixture ou de build.
Logs complets privés : `tmp/h-cond/fix-native-cleanse.r2-red-main.log`,
`fix-native-cleanse.r2-red-rc7.log`, `fix-native-cleanse.r2-baseline.log`
et `fix-native-cleanse.r2-gate.log`.

Les six identités sont dans `scripts/test-inventory.json` ; découverte par
`scripts/run-tests.mjs` et step `tests` de `scripts/run-test-gates.mjs`.
Vérification ciblée de la découverte et des déclarations : six identités,
`declarationFailures: []`. Le contrôle avec le preload `native-isolation.js`
et le reporter `node-evidence-reporter.mjs` vérifie aussi leur exécution.

La lane L0 garde ses diagnostics de lacunes pour permettre les PRs des lots
séparés ; elle ne demande jamais que le défaut persiste. Le mode strict est
destiné à l'acceptance des contrats après L1/L3/L4 ; L5 câblera les gates du
candidat final, L6 sa qualification. Les assertions d'infrastructure, d'I/O,
d'unicité et de préservation échouent normalement dans les deux modes.

Confinement : `/home/antoinefa/.cache-tmp/h2a-test/run-9LhaJz`, nettoyé à la
livraison, ainsi que le checkout détaché de contrôle. Seuls les PID démarrés par
la fixture sont arrêtés, après vérification de leur génération. Aucun binaire
h2a propriétaire, état réel, Python, suite locale complète, tag ou merge.
Pas de nouvelle revendication de consensus indépendant ; les deux revues du
round 1 ont été réconciliées finding par finding.
