# Central MCP, drive PTY et nouveaux signalements

Branche : `fix/test-flakes-central-drive`.
Base intégrée : `origin/main`, `4a314f785ba9d590db4ad626fd88bcc37a9435ab`.

## Central MCP : cause et correctif RED-first

Le test original attendait 3 000 ms la barrière exclusive après avoir lancé
un processus Node. Le démarrage et ses imports consommaient cette attente.
`origin/main` synchronise maintenant le bootstrap, mais attend encore la
publication pendant 3 000 ms après ce premier signal.

Retarder de 3 100 ms le contender 2 dans `beforeExclusiveMarkerPublish`, après
bootstrap et avant publication, reproduit exactement « contender 2 staged
its exclusive publication », `false !== true`, sur cette base intégrée.
Le correctif émet un message `staged` après création du fichier de barrière.
Le parent observe ce message, puis vérifie le fichier. Résultat ou sortie
avant publication échoue. Les autres attentes de 3 000 ms sont conservées.

Le contrôle d’exclusivité reste exécuté : la mutation temporaire de la
publication atomique `temp + link` en `open(wx)` puis écriture produit
`4 !== 1` sous Node 22 et Node 20. Le contrôle conserve les assertions sur le
successeur unique, les endpoints vivants et la génération enregistrée.
Le fichier central complet corrigé compte 20 tests réussis, 0 échec,
0 annulation, 0 ignoré, 0 TODO sur la base intégrée.

## Drive PTY : cause et correctif RED-first

La fixture publiait `H2A_NATIVE_TARGET_SESSION` puis terminait normalement.
Le contrôle ultérieur du lanceur trouvait donc un sidecar sorti. Retarder de
500 ms son deuxième probe reproduit le refus original. La trace réelle
observe `status: exited`, `exitCode: 0` avant correction et `status: running`
après. Le produit refuse correctement le sidecar déjà sorti.

La fixture reste active après publication du marqueur. Le test vérifie cet
état, conserve la livraison signée unique et le report après activité humaine,
puis arrête la bonne incarnation du sidecar dans le `finally`. La restauration
de l’environnement demeure garantie même si ce nettoyage échoue.

La durée du scénario est mesurée séparément de la collecte/import Vitest.
Sous quatre workers CPU sur les cœurs 0,1, un passage corrigé sans injection
prend 5,27 / 5,62 / 9,32 / 6,11 / 6,86 s sur Node 22. Le budget global local de 15 s couvre le scénario entier ;
les attentes de préparation et la fenêtre d’activité humaine ne changent pas.
Cette mesure de la reprise confirme le dépassement de l’ancien budget de 5 s.

## Taux de cette reprise

Une tentative désigne le scénario ciblé exécuté dans un processus neuf.
Chaque campagne emploie quatre workers CPU au maximum. Les tests et la charge
sont épinglés avec `taskset`. Les campagnes anciennes à huit workers ou plus
sont conservées localement, mais exclues des taux de cette reprise.

Campagnes contrôlées, cœurs 0–3, cinq passages par version :

| Version | Central échecs avant → après | Drive échecs avant → après |
| --- | --- | --- |
| Node 22.22.1 | 5/5 → 0/5 | 5/5 → 0/5 |
| Node 20.20.2 | 5/5 → 0/5 | 5/5 → 0/5 |

Par scénario : 10/10 (100 %) → 0/10 (0 %).
Total : 20/20 échecs avant → 0/20 après.

Campagne corrigée sans injection, quatre workers sur les cœurs 0,1 :
central 0/10 échec et drive 0/10 échec (cinq passages par version).
Les comptes de la suite complète figurent ci-dessous. Le runner racine ne couvre pas `drive.functional` :
ce scénario est donc vérifié explicitement par ces campagnes.

## Point 4 : Track

Le test signalé est le premier rendu de `packages/track/src/cli/focus.test.ts`.
Son appel charge dynamiquement le renderer vendored et son reader dans le
budget de 5 000 ms. Les appels suivants bénéficient du chargement préalable.

Le plugin Vite de diagnostic retarde de 5 100 ms le seul import du renderer.
Avant : le premier test expire ; les neuf suivants passent. Après chargement
de ces dépendances pendant la collecte : dix tests réussissent. Une exécution
avant et après sur chaque version, soit pour le test signalé 2/2 échecs avant
et 0/2 après. Sur les fichiers : 18/20 réussites avant et 20/20 après.
Aucun délai n’est modifié ; une erreur d’import échoue toujours à la collecte.

## Point 4 : blocage Node, loop et M02

Les anciens instruments décrivent des descendants de `loop-tick-cli` qui
consultaient le registre runtime réel et sondaient ses sessions natives.
Le code confirme ce chemin : `readAgents` appelle `projectAgentsForH2a`, puis
`listLocalForLs`, avec des probes natives synchrones bornées à 15 s chacune.
Cela expose le test au nombre et à l’état des sessions externes. Le scénario
M02 natif possède déjà son propre registre et son propre socket.

La cause exacte d’une durée supérieure à 600 s n’a pas été prouvée par une
nouvelle reproduction. La seule présence de ces deux fichiers encore actifs
ne suffit pas à attribuer le blocage à M02. Aucun correctif produit ni délai
supplémentaire n’est ajouté sur ce diagnostic incomplet.

Pour prouver la cause, il faut capturer une occurrence réelle du blocage avec
horodatage des débuts/fins de tests, arbre PID/PPID et cwd des descendants,
état des sessions et du registre consulté, et trace des probes natives
(entrée, sortie, durée et attente système). Ces traces doivent identifier
l’opération qui empêche la terminaison. Une reproduction conservant cet état,
comparée au même scénario avec registre runtime isolé, doit ensuite reproduire
puis supprimer le blocage en changeant uniquement la cause identifiée.

Exécution ciblée avec `REMOTE_CLI_CONFIG_HOME` jetable : 19 tests au total,
13 réussites, 0 échec, 0 annulation, 0 ignoré, 6 TODO existants, en 32,182 s.
Les neuf tests loop passent ; les quatre scénarios M02 exécutables passent.
Un témoin avec un registre synthétique et un socket muet termine également :
il ne reproduit pas le blocage et ne constitue pas une preuve de sa cause.

## Validation et livraison

`npm ci` depuis le lockfile intégré, puis `npm run build` : réussis.
Relecture locale du diff et contrôle de la mutation d’exclusivité effectués.
Une seule suite `npm test` complète a été exécutée sur cette branche, avant
celle de `fix/uat-doctor-interrupt-flake`, avec configuration runtime jetable.
Synchronisation finale : `origin/main` à
`8c1912d7dfed785272d7cfe5feae79333ca3919b`, par avance rapide. Les événements
Track restent ceux de la base ; aucun changement `.track` n’est livré.
Le build et la suite release h2a avaient terminé avant cette exécution.
Décision h-cond : avant chaque suite, contrôle `ps` des runners et de leur cwd
sous `/home/antoinefa/src/h2a`. La suite externe bpmn-canvas, groupe 933523,
ne compte pas dans cette contrainte. Aucune nouvelle campagne de charge.

Commande : `REMOTE_CLI_CONFIG_HOME=<répertoire jetable> npm test`, Node
22.22.1, commit testé `bea07d97`. Contrôle `ps` à 02:01:17 UTC le 3 octobre
2026 : aucun runner, suite npm ni build h2a actif. Exécution de 02:01:17 à
02:05:18 UTC ; code de sortie 1.

| Suite | Total | Réussites | Échecs | Annulations | Ignorés | TODO |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node | 2 453 | 2 410 | 1 | 0 | 21 | 21 |
| Track (87 fichiers) | 1 193 | 1 193 | 0 | 0 | 0 | 0 |

Durées : Node 207 369,812368 ms ; Track 11,02 s. Les étapes build et contrôles
focus ont réussi. L’unique échec est `uat-doctor should clean its temporary
tree and return 130 when interrupted by SIGTERM`, attente `doctor-started`
expirée après 5 000 ms ; l’enfant retourne 130 après le scénario 3. Ce
correctif est livré séparément dans `fix/uat-doctor-interrupt-flake`.
La suite n’a pas été relancée et n’a pas atteint la limite de 600 s.

Preuves locales : `tmp/h-cond-final-npm-test.log`,
`tmp/h-cond-final-preflight.json`, `tmp/h-cond-final-npm-test.exit` et
`tmp/h-cond-final-process-snapshot.jsonl`. Les changements ultérieurs sont
limités à ce rapport et à `BRANCH.md`. Livraison autorisée vers
`https://github.com/rhanka/h2a.git`, uniquement la branche nommée.

Journaux et instruments reproductibles : `tmp/h-cond-evidence/`,
`tmp/h-cond-campaign.mjs`, `tmp/h-cond-order.cjs`, `tmp/wx-*`,
`tmp/track-cold-import.config.mjs`. Aucun instrument temporaire n’est livré.
