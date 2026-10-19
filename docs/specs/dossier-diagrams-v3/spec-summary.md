# Résumé — SPEC EVOL dossier diagrammes v2

Spec : [SPEC_EVOL_DOSSIER_DIAGRAMS.v2.md](SPEC_EVOL_DOSSIER_DIAGRAMS.v2.md) ; suivi des dix remarques P1/P2 : [v2-changes](SPEC_EVOL_DOSSIER_DIAGRAMS.v2-changes.md), toutes fondées et traitées.
Décisions propriétaire conservées : moteur DS maintenant et programme complet ELK dans notre JS propre, depuis les publications ; aucun runtime ELK imposé.
Tout diagramme est un graphe, toute représentation une synthèse ; gigogne complémentaire selon les usages, sans priorité universelle ; source des « deux principes » toujours manquante (OQ3).
Qualité : prévention puis audit de la scène finale peinte, invariants durs à zéro, croisements minimisés, hub `ci-gate` traité sans perte de relations.
Un explorateur : heat map DS, parcours cliquables, avant/après sur le même diagramme, groupes `+`, plan et gains marginaux/cumulés par cas ; #696 reste abandonnée.
H1 livre immédiatement sources/citations/annexes embarquées offline, compatibilité et publication du HTML atomique, sans attendre DS/CDN/H3 ; v1 immuable, aucun contenu perdu silencieusement.
Sortie H1 : ouverture à froid, citations, recherche, DOM borné et mémoire mesurés sur petits/gros dossiers ; protocole/budgets figés avant qualification, résultats conservés (G5a).
H2 raccorde DS et CDN ; H3 ajoute les interactions liées ; H4 qualifie seulement les capacités de chaque incrément. Offline ≈32 Mo acceptés, sans plafond arbitraire de taille.
Atomicité : une révision cohérente publiée ; échec partiel/résultat périmé sans mutation ni écrasement. Transactions diagram-core réutilisées ; calcul incrémental proposé, distinct de cette garantie.
Lots DS/H/S : témoins purs, jsdom et navigateur séparés ; paquet, chemins, configuration, commande ciblée et assertion RED affectés en §7.4 ; nouveaux targets Make sentropic explicitement proposés.
Suites complètes exclusivement en CI, une fois à l'intégration par le conducteur, avec lien et sortie ; localement fichiers ciblés et racines temporaires seulement.
OQ1–OQ6 restent ouvertes sur les principes/usages, avec pistes combinables ; conventions techniques réversibles tracées sans nouvel arbitrage inutile.
Non couvert : aucun code/test logiciel/mesure exécuté ; qualification réelle, budgets numériques, publications manquantes, compatibilité API/pixels ELK, impression et vérité des gains CI/CD restent à produire.
