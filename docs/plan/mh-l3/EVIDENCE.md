# Lecture des preuves MH-L3

Les journaux bruts conservent la commande développée, la version Node, la racine
temporaire, la sortie et un reçu JSON. `invalid:false` exige au moins un test,
aucun skip/todo/annulation et aucun enfant propre encore vivant à la sortie.
Le runner enregistre PID et naissance de ses seuls enfants ; il ne cherche ni
n'arrête de processus par motif. HOME, XDG, état h2a et scratch sont temporaires.

| Artefact | Sens |
|---|---|
| `regressions-node{22,24}.json` | Fichiers explicitement sélectionnés par références de modules et suppléments nommés ; commande et reçu de chacun |
| `mutations-node{22,24}.json` | Mutants tués par assertion, mêmes oracles restaurés verts, SHA-256 du fichier produit testé |
| `proof-audit.json` | Comparaison des sources/tests/scripts et des JS compilés entre worktree et copie privée ; couverture des reçus |
| `evidence/*-qualified.log` | Dernier passage complet du fichier ciblé, sans filtre de cas |
| `evidence/*-red.log`, `*-green.log` | Un seul cas enregistré, sans skip des autres cas ; suppression du garde puis restauration dans une copie privée |
| `evidence/*-resumed-progress-before.log` | Régression reproduite avant correction : progression absente après reprise, `ERR_ASSERTION`, sortie 1 |
| `early-evidence/`, `*diagnostic*.log`, `*qualification-red-v7-fixture.log` | Échecs et diagnostics préliminaires conservés ; ils ne valent pas qualification verte |
| `evidence/mcp-central-attachments.test.js-node22-attachments-corrected.log` | Passage préliminaire 26/33, sortie 1 ; conservé séparément des deux fichiers finaux `*-qualified.log`, chacun 33/33 |
| `evidence/final-build-node22.log` | Build final et contrôle du descripteur généré ; commande, sortie et code |

Un ancrage obsolète de `lost-initialize-activation` a aussi interrompu un pilote
avec `mutation_anchor_not_unique`, avant écriture du mutant. L'ancrage a été
ajusté à la nouvelle sonde d'identité ; seules ses paires effectivement tuées et
restaurées sont comptées. Les deux diagnostics de mutant avec exception de type
ou erreur non enveloppée restent distincts des rouges par assertion retenus.

Les adaptations d'anciens tests suivent les contrats locaux nouveaux : une
réponse locale `initialize`/`tools/list` ne prouve plus qu'un attachment a été
admis ; les tests attendent un appel réel. Un bail expiré avec propriétaire
vivant conserve l'activation ; le test d'idle demande ensuite une déconnexion
explicite. Leurs oracles de présence, drain, démarrage et isolation sont conservés.

La suite globale n'est pas exécutée. Le supplément historique v1
`mcp-central.test.js`, sans référence à un module modifié, garde les réserves du
rapport MH-L2 : ses oracles de reprise HTTP contredisent l'autorité v2 gelée.
Ses anciens résultats ne sont pas requalifiés par cette campagne.
