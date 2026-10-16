# MH-L5 — preuves de coexistence et de récupération

Base : `7a8129ea` (MH-L3 R2 FUSIONNABLE ; MH-L4 déjà dans la lignée).
Autorité : spec v7 §§7/10.2–10.5/10.8 et décision propriétaire A.
Les résultats finaux, hashes et commandes sont dans [proof-audit.json](proof-audit.json),
les index `regressions-node{22,24}.json` et les six index `mutations-*-node*.json`.

| Périmètre | Oracle et fichier |
|---|---|
| M18/M18b/M18c/M19/M20/T4/T8/T9 | Vrais dists publics .5/.6, starter/bridge complets, marker compatible fixed/discovered, contrôle invalide récupéré, secret leurre sans autorité, POST après arrêt fermant v1, stdio initial et redécouverte du même shim : `mh-l5-v1.test.js` |
| M17 héritage | Vrais writers .5/.6 ; refus avant gel, disparition seule insuffisante, fermeture d'admission maintenue puis retour d'éligibilité : `mh-l5-legacy-writer.test.js` |
| M21/T3 | Source et shim compilés, pair exécutable distinct MH-L3, ACK perdu, G0 conservé pendant G1 ; IDs `17`/`"17"`, progression G0 signée injectée sur son transport réel, annulation G0 et réutilisation après règlement : `mh-l3-transfer.test.js` renforcé |
| M22/M23/M24/M25 | Six morts de processus autour des fsync/rename/close/nettoyage, expiration et commit retardé, pause maintenue, huit prétendants et trois essais partagés : `mh-l5-cold.test.js` |
| M23/M24 réseau | Vrai central : faute fsync fichier/répertoire et ACK de commit perdu ; contrôleur indépendant mort puis deux starters, un seul successeur réservé : `mh-l5-cold-network.test.js` |
| M25 compensation | Vraie image source vérifiée et vrai starter ; nouveau contrôleur H4 de fixture, nouveaux epochs et nouvelle génération, ancienne transaction toujours en échec : `mh-l5-compensation.test.js` |
| M17 charge | Huit processus conformes utilisant les API compilées ; 10 000 mutations par domaine et 20 000 payloads, acquittements externes, hashes/chaînes relus, zéro doublon : `mh-l5-concurrency.test.js` |
| Mutations métier | Même oracle sur campagne courte distincte, perte injectée dans chacun des sept domaines : `mh-l5-concurrency-oracles.test.js` |
| Régressions | 30 fichiers explicitement listés, dont les huit références directes du shim et les dix fichiers MH-L4 : `scripts/mh-l5-regressions.mjs` |

Seul changement produit : T9 expose `legacy_requires_cold_upgrade`, conserve ce
diagnostic pendant le backoff, puis l'efface après connexion réussie. L'état stdio
reste ouvert. Les contrôles physiques, d'identité, de MAC, d'epoch et de preuve
restent en place ; la frontière de découverte est conservée pour le MCP registry.

Les tarballs publics sont vérifiés par SHA-512 ; les locks v1 conservés rendent
leurs dépendances exactes reproductibles par `scripts/mh-l5-artifacts.mjs` avec
`npm ci --ignore-scripts`. Deux préparations privées produisent les mêmes hashes
de tarballs, modules centraux et locks ; voir `artifacts*.json` et leurs logs.
Le code central publié .5/.6 a le même SHA-256, dans deux distributions distinctes.

Les tests ont un HOME/XDG/TMPDIR privés créés par mkdtemp. Le runner impose les
fichiers explicites, refuse zéro test/skips/annulations, journalise ses seuls
enfants avec naissance `/proc`, et vérifie leur disparition. Les mutations
refusent de s'exécuter hors copie privée et restaurent les octets en `finally`.
La copie source umask 022 protège la garde sur le préfixe physique ; le worktree
du propriétaire n'est jamais chmoddé. Aucune invocation du h2a installé.

Les premiers diagnostics restent conservés : fichier/import de fixture absent,
boot de marker contradictoire, valeurs `PRECHECKED`/`transaction_aborted`, nettoyage
masquant l'assertion du ping mutant. La première charge passait sans contrôler le
bon champ de hash ; l'oracle renforcé a échoué sur cet acquittement, puis les
charges finales ont été rejouées avec `contentHash` et `verifyJournalChain`.
Ces diagnostics ne sont pas comptés comme des qualifications vertes.

| Limite | Frontière de la preuve |
|---|---|
| Distribution .7 | Image prototype construite depuis les sources ; artefacts finaux et packaging release MH-L8 |
| M18 | Absence après arrêt extérieur qualifiée ; marker v1 mort sans provenance durable toujours refusé. Aucune origine machine/boot inventée ; le producteur de preuve d'activation H4 relève de MH-L6 |
| M17 | Charge de writers backend synthétiques, avec rôles central/pair/stdio/janitor/CLI ; elle ne simule pas huit clients complets de bout en bout. Les surfaces réelles sont exercées séparément par M21 et les tests d'attachments |
| Coupures | Crash de processus et erreurs fsync déterministes ; aucune certification de coupure électrique/filesystem |
| H4 et vivant | Contrôleur, fermeture d'admission et verdicts du pair sont des fixtures. Aucun coordinateur vivant produit ni vérificateur sémantique .8 |
| Consommateurs | Vrai Claude, M20b, charge/endurance MH-L8, vraie transition .7 → .8 et découverte registry hors qualification de ce lot |
| Revue | Revue indépendante à réaliser par le conducteur ; les outils installés de dispatch sont interdits par le confinement propriétaire. Aucun verdict de consensus revendiqué |

Reproduction : préparer les artefacts, construire une copie privée umask 022 avec
`scripts/mh-l3-qualification-copy.mjs`, synchroniser les fichiers du lot puis
lancer chaque fichier via `scripts/mh-l5-test.mjs <fichier> <label>` avec
`MH_L5_ARTIFACTS=<mkdtemp vérifié>`. Le runner de régressions énumère les fichiers ;
il n'appelle jamais `npm test` ni une suite de dépôt. La charge normative est un
fichier séparé, sans réduction du nombre de mutations.
