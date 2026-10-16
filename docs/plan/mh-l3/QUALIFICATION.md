# Qualification ciblée MH-L3 — 2026-10-16

Historique de la livraison `c96792f3`. La clôture des réserves Argon, commit
`413e7b32`, possède sa qualification bornée et ses preuves dans [ARGON.md](ARGON.md).

Implémentation : `b47e9443150d1301c5f6d185c32c80134cfd78a2`, base
`513312b88766852572f515b3d3a7b71a0fcc2c27`, branche `feat/0.98.7-mh-l3`.
Le verdict FUSIONNABLE fourni par l'owner concerne l'amendement MH-L2 à la base.
La revue indépendante de MH-L3 reste à faire : voir [REVIEW.md](REVIEW.md).

| Commande réellement exécutée / périmètre | Résultat observé |
|---|---|
| `npm run build`, copie privée 022 | Sortie 0 ; compilation et `generate-mcp-descriptor.mjs --check` ; [sortie](evidence/final-build-node22.log) |
| `/usr/bin/node scripts/mh-l3-regressions.mjs` | Node 22.22.1 : 44 fichiers explicitement lancés, 232 tests, sortie 0 |
| `/home/antoinefa/.npm/_npx/387698761821791d/node_modules/node/bin/node scripts/mh-l3-regressions.mjs` avec son répertoire en tête de PATH | Node 24.21.0 : mêmes 44 fichiers et 232 tests, sortie 0 |
| Sur chaque Node, `scripts/mh-l3-test.mjs packages/h2a/test/mh-l0-formats.test.js qualified` dans le worktree Git | 4/4, sortie 0 ; total **45 fichiers, 236 tests par profil** |
| Même runner, `packages/h2a/test/mcp-central-attachments.test.js qualified` | **33/33 par profil**, sortie 0 ; inclus dans les totaux ci-dessus |
| Même runner, `packages/h2a/test/mh-l3-transfer.test.js qualified` | **M21 1/1 par profil**, sortie 0 ; vrai ancien central et vrai shim compilés, pair enfant séparé |
| Même runner, `packages/h2a/test/mh-l3-recovery.test.js qualified` | **1/1 par profil**, 32 vrais shims, PID conservés, vingt reprises de transport au minimum, une activation par shim |
| `scripts/mh-l3-mutate.mjs` avec les cas explicitement sélectionnés, dans la copie privée, sur chaque Node | **43 paires par profil** : chaque rouge sort 1 avec `ERR_ASSERTION`, puis le même oracle restauré passe 1/1 et sort 0 |
| `node scripts/mh-l3-audit.mjs /tmp/mh-l3-qualification-bUCXsb/source`, avant et après le commit produit | Sortie 0 ; **45 fichiers** source/tests/scripts/schéma et **19 JS compilés** identiques ; 86 paires vérifiées au total |
| `git diff --cached --check` sur le commit produit | Sortie 0 |
| Même contrôle sur l'archive brute ; contrôle excluant les `.log` | Sortie 2 limitée aux espaces/lignes vides des sorties brutes ; documents/JSON sortie 0 ; reçu `format-check.json` |

Les manifestes [Node 22](regressions-node22.json) et [Node 24](regressions-node24.json)
donnent chaque commande développée, fichier et reçu. Les journaux TAP/Vitest
complets sont dans `evidence/`. Aucun skip, todo, test annulé ou enfant restant
n'est accepté. Les tests reçoivent uniquement des racines temporaires HOME/XDG,
h2a et scratch. Chaque sous-processus utilise le Node du profil courant.
Aucune suite globale n'a été exécutée.

Les manifestes [mutations Node 22](mutations-node22.json) et
[Node 24](mutations-node24.json) relient chaque paire à son oracle et au SHA-256
du fichier produit final. Les campagnes ont été complétées par cas après les
dernières corrections ; tous les mutants visant un fichier produit modifié ont
été rejoués. [L'audit](proof-audit.json) refuse un mutant survivant, un rouge sans
assertion, une restauration différente, une omission de cas ou un reçu invalide.
Les diagnostics initiaux restent séparés : [lecture des preuves](EVIDENCE.md).

M21 traverse les vraies routes source de réservation, H4, barrière, checkpoint,
preuve, ACK, publication externe, fencing, drain et retrait. Il refuse sept offres
invalides, perd la réponse ACK après sa persistance et réconcilie l'acceptation.
Le pair acquiert l'ownership sous CAS après PUBLISHED. Un catalogue cible de
révision discordante n'ouvre ni catalogue servi ni travail G1 ; la correction
permet l'installation, `listChanged` et l'appel du nouvel outil. Deux appels G0
restent admis ; l'annulation vise G0 pendant G1, la réponse G0 tardive est conservée
avec récupération du payload, et le retrait préserve marker, présence et ownership
G1. Le travail métier est synthétique derrière le véritable handler `h2a_run` ;
aucun agent externe réel n'est lancé.

| Non couvert / limite | Relais |
|---|---|
| Revue indépendante MH-L3, au moins deux regards ; aucun consensus revendiqué | Conducteur, dossier lié au commit exact |
| Vrai Claude, interopérabilité d'une release .8, vérificateur sémantique produit et restauration produit | MH-L5/MH-L8 et release future |
| M09 complet : 75 secondes d'absence, vingt cycles froids avec dix secondes de service sain ; RSS/FD/endurance | Campagnes CI/REL restantes ; le test accéléré qualifie seulement la reprise avec G0 vivant |
| Suite globale et matrice d'intégration/release convergée | Conducteur, une fois à l'intégration |
| Ancien supplément v1 sans référence à un module touché | Réserves MH-L2 conservées dans EVIDENCE.md ; aucun nouveau verdict |
| Découverte par le registre MCP cluster-mesh | Contrat sentropic attendu ; frontière de découverte préservée, aucune découverte implémentée ici |

Extensions additives : lecture du statut d'attachment liée au contexte et à
l'epoch pour récupérer une identité inconnue, attestations d'ACK et de fin de
génération, inventaire des transports. Les gardes source/digests, autorité,
publication, identité attendue et durabilité restent en force. Les adaptations
d'anciens tests suivent l'initialisation locale et la durée de vie logique de
l'attachment, sans augmenter les délais produit.

Deux propositions ont été refusées par la revue automatique d'approbation :
absorber des erreurs de découverte autres qu'ENOENT, puis retirer les contrôles
des deux digests de registration. Les alternatives livrées gardent ces refus de
connexion et ces contrôles ; aucune approbation ne reste nécessaire pour elles.
Les hooks installés h2a/Track sont désactivés pour les commits et le push en
application du confinement owner ; les contrôles ciblés ci-dessus restent tracés.

Reste estimé pour revue/corrections MH-L3 : **4–8 heures d'agent, deux tours de
revue**, hors attente du conducteur, I/O et travaux des autres lots.
