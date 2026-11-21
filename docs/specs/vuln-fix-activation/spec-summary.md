# Résumé v2 — Job quotidien de correctifs (#371) : activable et autonome

La [spécification v2](SPEC_EVOL_VULN_FIX_ACTIVATION.v2.md) traite les
18 remarques P1/P2 d'Astra max et Sol max, vérifiées dans les sources.
La [table remarque → traitement](SPEC_EVOL_VULN_FIX_ACTIVATION.v2-changes.md)
conserve chaque remarque et ses preuves. La v1 reste intacte. Cette
révision est documentaire : aucun code, test logiciel, siège réel ou
job n'a été exécuté ou activé ; aucune porte n'est déclarée franchie.

| Sujet | Contrat conservé ou précisé |
|---|---|
| Décisions owner | Capacité A : correctifs dans les deux unités maintenance, CI et enrôlement préservés ; « Tous les dépôts prêts » ; correctif, revue et fusion autonomes sans accord pour chaque correctif ; aucun sous-traitant Claude Code, mais Claude reste dans les tests des cinq fournisseurs. |
| Question ouverte « Dans gh » | Attentes de principes sur les responsabilités de GitHub : orchestration, exécution, traçabilité, fusion et garde des accès. Les conducteurs en dérivent une combinaison complète ; Actions sur runners labo administrés est aussi envisageable. Lieu d'exécution et mécanisme de fusion se combinent. Aucun choix binaire ni réponse implicite. |
| Lots exécutables | L0 doit résoudre dépôt/base, fichiers source/tests exacts, interfaces, commande ciblée, cwd et RED attendu avant chaque lot dépendant. Une inconnue documentée permet l'inventaire, pas le démarrage du code. L1 import publié ; L2 identité/CLI Muse ; L3 autorité commune et réservation de tout le cycle. |
| Accès et renouvellement | D10 distingue contrôleur, CLI authentifiée de confiance, outils du modèle et tests. La CLI reçoit sa capacité admise ; outils/tests n'accèdent pas aux credentials. L3 exige des canaris env/fichier/processus/capacité sur une vraie frontière. L3-R rend obligatoires renouvellement central, livraison et consommation suivante ; `serialized-stream` si nécessaire, sans second coffre ni refresh concurrent. |
| Preuve du correctif | Audit rouge → vert ; tests fonctionnels ordinaires verts → verts ; régression rouge → verte seulement lorsqu'elle est explicitement applicable (`redBefore`). Le RED initial de la nouvelle fusion est un candidat entièrement admissible qui doit fusionner exactement une fois. Les refus déjà obtenus ne constituent pas ce RED. |
| Autonomie durable | L4 place ordonnanceur et exécuteur de fusion. L5 reprend automatiquement les PR appartenant au job après attente des checks, maturation ou redémarrage : SHA/base et portes revérifiés, fusion idempotente, pas de nouvel auteur/relecteur pour une simple attente ni de quota effacé à minuit. L6 affiche blocages, échéances, capacité et équité entre dépôts prêts. |
| Revues exactes | Spec : Astra max + Sol 6.1 max ; code : Sol 6.1 xhigh + Astra max. OQ3 qualifie les identifiants/efforts techniques sans réduction silencieuse. Les revues de v1 ne valent pas approbation de v2. |
| Séquence d'acceptation proposée | Pré-fusion : activabilité démontrée par G0–G3 et dossier G5, sans lever automatiquement le NO GO owner de #371. Après release : activation planifiée observée G4. En production : correctif réel jusqu'à livraison G6. Les modalités techniques sont des propositions distinctes du verbatim owner. |
| Clôture L7 | Progression partielle autorisée, clôture exigeante : dix usages CLI/mesh positifs, 25 paires × quatre scénarios natifs Linux (100 reçus), et rotation effectivement exercée d'au moins deux auteurs admissibles. Toute preuve manquante garde sa partie ouverte ; macOS/Windows restent explicitement à qualifier. L7 ne bloque pas la première activation. |

Non couvert à la première activation : autres écosystèmes/images/OS,
majeurs et nouveaux paquets, correctifs de moins de sept jours,
détection plus rapide que quotidienne, matrice complète et rotation
étendue. Aucun achat, crédit de remédiation ou usage des sessions
personnelles n'est présumé. Les questions OQ1–OQ5 restent ouvertes
dans leur périmètre, notamment les principes d'une éventuelle urgence.
