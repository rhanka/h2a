---
status: selection-failed
target-ref: poc/multi-workspace-terminal/
observed-failure: Exact author model/effort not attested; required installed h2a MCP reviewer dispatch conflicts with owner confinement.
---

# Revue de conception et adaptations

Les skills using-harness, brainstorm, test, debug et review ont été lus.
L'owner impose les écritures POC dans ce seul répertoire : aucun recorder
harness, BRANCH.md racine ou .track n'a été modifié. La sélection de reviewers
complémentaires selon le skill review a été arrêtée : pas de lancement via le
h2a installé/MCP, pas de découverte d'état réel, pas de consensus revendiqué.

Deux agents intégrés distincts ont relu la conception puis les sources,
l'un sur la correction/VT, l'autre sur l'isolation. Ils n'ont exécuté aucun
test et n'ont écrit aucun fichier. Leur relecture constitue un contrôle de
conception, sans attestation de la procédure h2a review.

| Constat | Décision et preuve |
|---|---|
| Replay borné seul insuffisant au changement d'onglet | Accepté : émulateurs chauds par session, un terminal visible, avertissement si gap à l'attache |
| Capture de stubs ne prouve pas les onglets | Accepté : capture du PTY du véritable client via op native, exclu des métadonnées |
| Risque de course focus/entrée/create | Accepté : queue commune aux polls, commandes, resize et entrées ; preuve de deux créations concurrentes réconciliées |
| Bail déjà invalidé sur exit | Accepté après échec réel, corrigé et prouvé rouge/vert dans integration.test.ts |
| UTF-8 par chunk et liens sur endpoint | Acceptés après deux tests rouges, corrigés et prouvés verts dans model.test.ts |
| Le cleanup d'un spawn sans PID pourrait attendre indéfiniment | Réfuté par test : Node renseigne exitCode avant close ; cleanup existant termine |
| Socket de focus après fermeture | Vérifié par intégration : Server.close retire le socket, lock retiré, nouveau run relance le client |
| Réponses VT hors focus et premier lancement concurrent | Déférés : limites explicites du POC, besoins production dans README |

Les corrections sont confinées au POC. Le protocole natif et le code de
production restent inchangés. Aucun merge/fermeture de branche n'est réalisé.
