# Changements — diagrammes de dossier v3

Livrable : [SPEC_EVOL_DOSSIER_DIAGRAMS.v3.md](SPEC_EVOL_DOSSIER_DIAGRAMS.v3.md). Base conservée : [SPEC_EVOL_DOSSIER_DIAGRAMS.v2.md](SPEC_EVOL_DOSSIER_DIAGRAMS.v2.md), SHA-256 `e7b55921c6fc00868415ae06cbd9ff81bab6e225d3782b5d6942ecdf7a50b00e`.

Intégration documentaire des deux propos du propriétaire du 18/10, relayés par s-conductor. La v3 reste en anglais comme la v2 ; cette table est en français. Aucun code, générateur ou état réel h2a n'est exécuté ou modifié.

| Source / demande | Changement minimal dans la v3 | Décisions et limites conservées |
| --- | --- | --- |
| « Mets le bouton (DANS le diagramme) : avant/après, cas, événement, options de groupes » ; capture [20.png](/home/antoinefa/src/sentropic/.tmp/focus-ci-efficiency-kit/owner-feedback-v3/20.png) examinée | **D15**, §5 : les quatre familles de commandes font partie du contrat du renderer DS et s'utilisent dans le même canevas. Focus fournit les choix et bindings déclaratifs ; l'événement devient un axe explicite de l'état local et de la publication atomique. Visibilité, non-masquage, pan/zoom/resize, clavier/tactile et focus sont à qualifier. | D8 : un seul explorateur, avant/après au même endroit, groupes réversibles ; exploration sans approbation ni écriture Track. Barre/overlay et boutons locaux sont des mécanismes `[prop]`, aucun champ JSON magique n'est supposé livré. |
| « demande à diagramme de mutualiser […] capitalise ce dossier pour une bonne segmentation modèle graph engram / modèle de layout et rendu / style. » | **D16**, §2 : trois couches explicites avec responsabilités et frontières. Les deux nouveaux verbatims sont reproduits intégralement en D15/D16. Le modèle de graphe relève d'engram ; layout et rendu relèvent du DS ; le style reste une couche DS distincte. | Les distinctions fonctionnelles graphe/synthèse/layout/présentation de la v2 restent valables dans cette segmentation. La composition de dossier Focus est conservée, sans second modèle ni moteur. |
| Propriétaire : « Il doit etre le gardien de toutes les ontologies de dev » ; [brainstorm guardian](/home/antoinefa/src/graphify/.graphify/scratch/design/ontology-guardian/brainstorm/README.md), positions `design-system.md`, `design-system-layers.md`, `h2a.md` | §2 : corrige l'attribution du modèle sémantique au DS en distinguant responsabilité cible d'engram et capital actuel `diagram-core`. Profils versionnés, identités, validation, transactions et sortie #368 sont préservés ; résolution offline sans MCP dans le chemin de rendu. | Le transfert des seules définitions ou du paquet entier, le lieu de la machinerie partagée et les modalités de migration restent ouverts en concertation. Aucune migration matérielle n'est annoncée accomplie. |
| « à part les flèches mal centrées » ; séparation du style | D16, §2 : style = thèmes/tokens, typographie, couleurs, icônes et emphase ; les catégories sémantiques restent typées dans le graphe, les métriques de police alimentent le rendu. | D4 et §4.1 inchangés : centrage et géométrie restent au layout optimizer. Pas de correction des flèches par un skill, l'auteur ou le CSS. |
| [DIAGRAM-GENERATOR.md](../positions/DIAGRAM-GENERATOR.md), état factuel du 18/10 | §2.2 : inventaire court du capital et des écarts, puis mutualisation des contrats/modèle, moteur, renderer/commandes, style et chaîne de build. DS headless, composants Svelte, `focus build`, focus-kit, **#368** et exemples consommateurs sont distingués. | Les générateurs ne sont pas raccordés et aucun n'est présenté comme livrant déjà l'explorateur complet. L'intention derrière « notre générateur » reste non attribuable avec certitude. Le relevé complète les références v2 sans les remplacer ni refaire l'enquête npm. |
| s-conductor : cible DS, capitaliser le kit h2a puis le déclarer obsolète | §2.2 et tag **`[conductor]`** : analyse deux trajectoires combinables — conserver Focus comme compilateur/hôte avec renderer DS partagé ; extraire les capacités de rendu et étudier le retrait de l'implémentation remplacée. Comparaison sur le capital #368, les contrats à préserver, la provenance, la migration et les preuves d'équivalence. | **L'obsolescence du kit n'est ni une décision du propriétaire, ni une exigence, ni une gate.** Un renderer de diagrammes ne remplace pas à lui seul schéma, template, validation, preuves, compilation et portabilité. D9 reste immédiat. La question de provenance/portage n'est pas tranchée. |
| Rendre les exigences vérifiables sans étendre le chantier | §7/§8 : DS4, H3 et S2 portent les commandes dans le canevas, l'axe événement et la capture 20 ; G4/G9 les qualifient à l'incrément qui les livre. DS2/DS4/H2/H4 tracent la carte de mutualisation dans leurs lots existants. | Aucun nouveau lot, fichier de test ou appel de test. H1 reste indépendant du renderer DS, du CDN et de H3 ; témoins ciblés, RED→GREEN futur, état temporaire et suites complètes CI-only restent prescrits. Aucun résultat de logiciel n'est revendiqué. |
| Conserver les décisions et les questions de principes | D1–D14 conservées intégralement ; OQ1–OQ6 et leur cadrage du §10 inchangés. §9 ajoute la limite explicite sur mutualisation/transfert/obsolescence non réalisés. | Programme JS propre couvrant l'inventaire ELK, clean-room, géométrie, réactivité/atomicité, Focus versionné, offline, données métier et clôture #696 restent décidés. Aucun principe ouvert n'est fermé par défaut ou par proposition technique. |

| Livraison / limites | État |
| --- | --- |
| Fichiers produits | Uniquement la v3 et cette table ; v2, analyses et résumé antérieur conservés. |
| Commits poussés | Aucun : scratchpad hors dépôt Git ; aucune branche modifiée. |
| Tests logiciels exécutés | Aucun : tâche de spécification sans code. Les témoins de régression restent prescrits pour les futurs lots ; aucune preuve RED→GREEN de logiciel n'est prétendue obtenue. |
| Non couvert | Implémentation, exécution des générateurs, rendu/navigateur, mesures de performance, publication/distribution réelles, transfert des ontologies et décision de déprécier le kit. OQ1–OQ6 restent ouvertes ; détail au §9. |
| Écart à la demande | Aucun. La proposition du conducteur est analysée sans devenir une exigence du propriétaire. |

Contrôle documentaire exécuté : `rtk node --input-type=module`, script transmis par here-document sur l'entrée standard, sur copies des trois documents dans `mkdtemp` avec `XDG_RUNTIME_DIR` temporaire ; nettoyage en sortie. Code retour **0**. Sorties constatées :

```text
CONSERVATION: D1–D14 et OQ1–OQ6 identiques; sections 0/3/4/6 et références identiques; citations antérieures conservées.
AJOUTS: 2/2 verbatims; 3 couches; contrat renderer et option du conducteur distingués; capital Focus/#368 explicite.
PLAN: 17 lots, 46 commandes ciblées et 12 gates conservés; H1 et chemin critique inchangés.
FORME: 23 tableaux cohérents; 5 liens locaux résolus.
BASE: SHA-256 v2 inchangé: e7b55921c6fc00868415ae06cbd9ff81bab6e225d3782b5d6942ecdf7a50b00e.
PORTÉE: contrôle documentaire sur copies temporaires; aucun test logiciel ni gate exécuté.
TEMPORAIRE: copies et XDG_RUNTIME_DIR supprimés.
```

Les empreintes/égalités et la structure documentaire sont contrôlées ; elles ne constituent aucune qualification du logiciel. Le diff documentaire a également été relu avec `rtk proxy git diff --no-index --unified=0 -- SPEC_EVOL_DOSSIER_DIAGRAMS.v2.md SPEC_EVOL_DOSSIER_DIAGRAMS.v3.md` ; son code retour 1 indique les différences attendues, pas un échec de test.
