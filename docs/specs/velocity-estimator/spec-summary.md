# Résumé — estimateur de délai par vélocité mesurée, v2

[Spécification v2](SPEC_EVOL_VELOCITY_ESTIMATOR.v2.md) ·
[Traitement des 16 remarques P2](SPEC_EVOL_VELOCITY_ESTIMATOR.v2-changes.md).
La v1 reste intacte. Aucune décision owner changée : estimateur IA via
h2a sur vélocité effective, heures d'agent **et tours de revue**, fusion
et installé séparés, connaissance capitalisée, ontologies sous engram.

| Sujet | Contrat corrigé |
| --- | --- |
| Mesures et cible L1 | Sur 20 PR h2a, ouverture→fusion P50 ≈ 2 h 45, mais queues dépendantes de la cohorte. Pour départ→fusion, scénario Sol P80 ≈ 3 h 58 / P95 ≈ 13 h 17 ; scénario Astra P80 ≈ 13 h 17 / P95 ≈ 30 h 20. Les deux restent non calibrés ; aucune cible unique de 4 h sans règle d'éligibilité préalable. |
| Tours de revue | Une soumission/vague = un tour, même avec plusieurs relecteurs parallèles. Prévision et réalisé distincts, couverture documentée ; sans preuve, comptes inconnus. Comparaison au réalisé en L6. |
| Installé | Cible, version/artefact, filiation du merge, installation et smoke réussis prouvés. `installedAt` = fin du smoke sur cette cible. Un runner qualifié ne prouve pas l'installation du poste propriétaire. |
| Contrat engram et reçus | L0-D documentaire séparé de L0-C : fichiers upstream proposés, artefact versionné, pin SHA/digests et validation hors ligne. L2 nomme wrapper/producteur, raccord de lancement, destination et RED sur interruption sans fin normale. #400 ne livre pas ce profil. |
| Calcul et temps | `nearest-rank/1` pour poids unitaires ; `weighted-ecdf/1` défini pour poids positifs, avec fixtures non uniformes. Exécution, collecte, publication, révision applicable et disponibilité attestées : aucune preuve tardive admise au cutoff. |
| Gates | Vitest ciblé pour agent-stats/Track ; Node ciblé après build isolé pour h2a. Goldens et gate publique explicites. Zéro nouveau skip requis ; non-tests owner préexistants exclus nommément, jamais comptés comme preuves. |

Lots L0-D/L0-C puis L1–L7 : référence rejouable, collecte prospective,
prévisions, scénarios de capacité, connaissance/plan/rapports, calibration,
distribution et preuve d'installation. Les trois sources SKILL sont
nommées. Track reste hors ligne, sans changement de WSJF ni de réalisation ;
prévisions immuables et calcul déterministe, comparables proposés par l'IA.
Engram conserve ses cohortes séparées : 60 PR enrichies, P95 6,66 h ;
121 anciennes, P95 67,87 h. Premier commit jamais assimilé au début de lot.

Questions ouvertes : usages et critères de réussite du pilote ; principes
d'autorité, de fraîcheur et de limites de la capacité ; conditions d'une
extension inter-dépôts. Les exemples techniques restent réversibles.

Non couvert par cette révision : implémentation, tests applicatifs et
leurs RED/GREEN, installation réelle, calibration prospective et nouvelle
double revue de la v2. Temps actif, attentes owner/quota chiffrées et
classement de modèles restent non établis. Aucun code, commit ou push.
