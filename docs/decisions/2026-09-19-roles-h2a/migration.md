# Migration proposée — aucune exécution

## 6 · Migration sans perte

Les étapes suivantes sont préparées pour une future exécution autorisée. Aucun renommage ni transfert n’a été appliqué.

Nous proposons de privilégier les noms existants. Renommer tous les points de contact ajouterait un risque sans réduire le nombre de mandats.

Nous proposons qu’un ancien nom devienne une correspondance de transition, sans créer un deuxième A ni une deuxième instance propriétaire du même WP.

La table détaillée de transfert décrit B. Dans A, Cadre reprend Architecture et Assurance ; dans C, Agents reprend WP11 et WP13.

| Ancien point de contact | A · cinq | B · six | C · sept |
| --- | --- | --- | --- |
| h-cond | h-cond | h-cond | h-cond |
| h-arch | h-arch · Cadre | h-arch | h-arch |
| h-runtime | h-runtime | h-runtime | h-runtime |
| h-portal | h-portal | h-portal | h-portal |
| h-infra + h-plugins | h-infra | h-infra | h-infra |
| h-harness + track + cyber | h-arch · Cadre | h-harness · Assurance | h-harness · Assurance |
| h-agents + memory | h-runtime | h-runtime | h-agents |
| coop + gateway | h-runtime | h-runtime | h-runtime |

| Ordre | Responsable futur | Action préparée | Condition de passage |
| --- | --- | --- | --- |
| 0 · Figer la décision | Conduite et propriétaire | Choisir une orientation ; obtenir avis arch et revues autorisées. Résoudre WP7 et les règles de revue contradictoires. | Dossier révisé, avis cités, périmètre de ratification explicite. |
| 1 · Inventorier sans déplacer | Assurance | Exporter sujets, identifiants, liens, branches, révisions, décisions, recettes et blocages. Identifier le seul écrivain Track. | Table source → cible complète ; aucune tâche recréée pour changer son propriétaire. |
| 2 · Préparer les mandats | Conduite, Architecture, Assurance | Modifier ensemble RACI.md, org.h2a.yaml, tests du manifeste et renvois de gouvernance, dans une future branche dédiée. | Un A par WP ; un conducteur ; propriétaire conservé ; responsabilités de revue séparées. |
| 3 · Préparer les alias | Moteur et Plateforme | Relier nom durable, instance active et mandat. Conserver les anciennes adresses pendant le drainage. | Résolution unique ; accusé de réception ; aucune nouvelle clé créée par simple renommage. |
| 4 · Piloter deux sujets | Moteur et Expérience | Transférer MCP et Focus pendant dix jours ouvrés. Conserver les autres files jusqu’à leur reprise explicite. | Un A, un exécutant, une prochaine preuve et un remplaçant par sujet pilote. |
| 5 · Transférer le reste | Chaque repreneur ; Assurance écrit Track | Appliquer la table par identifiant durable. Vérifier la capacité réelle du CLI à changer les affectations. | Pas d’écrasement du journal. Si le CLI manque, garder le registre de transfert et traiter le manque avant bascule. |
| 6 · Activer progressivement | Propriétaire pour les droits ; Plateforme exécute | Vérifier les effets réels du provisionnement. Activer un mandat à la fois ; drainer ensuite les anciennes sessions. | Diff attendu, accès minimal, reprise contrôlée, retour arrière prêt. Aucun arrêt massif. |
| 7 · Mesurer et clôturer | Conduite ; propriétaire accepte | Comparer délai de prise en charge, sujets orphelins et sollicitations humaines avec le relevé initial. | Aucun sujet perdu ; aucune auto-revue ; bilan de charge accepté. |

| Sujet | Références à conserver | Responsable cible | Transfert | Preuve de reprise |
| --- | --- | --- | --- | --- |
| MCP au démarrage | 01M2AWJRVJZZNA41MCX88GG24K ; #249/#250/#253 | Moteur | Distinguer correctifs fusionnés et panne encore reproduite ; joindre scénario et version. | Redémarrage réel, outil appelé, réponse reçue ; résultat attaché à la bonne révision. |
| MCP central | 01M0SSNGNSRS9RAA8GM1JPX6Q4 ; famille 01M0KWB… | Moteur pilote ; Plateforme construit le service | Un pilote d’incident ; sous-lots distincts pour client, service et authentification. | Premier lancement, réutilisation du serveur, reprise et refus d’accès contrôlés. |
| --gw et --bare | 0cc1e59d ; port/gw-keep-native-tools-098 | Moteur | Conserver correction 0.97.2 et portage 0.98 ; relever les sessions encore anciennes. | Tester direct, --gw, --gw --bare, reprise et restauration. |
| Focus et diagrammes | 01M1VCKJCGF414RG738N23SDAZ ; 01M2KJRBRDW820DTEDTB7Y30C5 ; 52652cd1 | Expérience | Rassembler plans et décisions ratifiées ; conserver les responsabilités du DS. | Un scénario de dossier, un responsable de chaque dépendance, aucun contrat concurrent. |
| Cluster mesh | origin/feat/consume-cluster-mesh-0.10.0 ; ec27026e | Plateforme | Moteur garde le lot consommateur h2a ; le fournisseur externe conserve son mandat. | Contrat fournisseur identifié, envoi reçu, signature vérifiée, retour de version préparé. |
| Permissions de construction | 01KYJ4GJK9W3EAWC7T0GAZN2BM | Moteur | Plateforme porte la distribution ; Assurance examine la politique. | L’environnement autorisé peut installer et construire sans nouvelle extension implicite des droits. |
| Track et méthode | 01KYQXJG77DQC368F4G2B2VGD8 ; 01M2AWJS6HTKNDN2AN6QX3FQ1J | Assurance | Conserver identifiants, dépendances, décisions, recettes et journal append-only. | Les mêmes sujets restent retrouvables ; chaque transfert possède un accusé du repreneur. |
| Plugins, infra et release | 01M06N825JFPQXGDJ7QV8Q2VJR ; S6 | Plateforme | Réunir les files h-infra et h-plugins ; distinguer préparation et publication. | Paquets installables ; version connue dans la même PR ; publication explicitement autorisée. |
| Sécurité | 06835a8d ; S5 ; S9 | Assurance pour audit ; rôle touché pour correction | Conduite ou propriétaire fixe la portée d’audit ; le déployeur ne la choisit pas seul. | Audit indépendant, exclusions expirantes et décision explicite pour tout risque accepté. |
| Mémoire et agents | WP11 ; WP13 ; 01M0GXK7CVFW5RKN7MGGM0WJD8 | Moteur dans A/B ; Agents dans C | Préserver les engagements Graphify et les tests de caractérisation existants. | Reprise avec contexte et comportement natif observés ; aucune annulation silencieuse. |
| Outils natifs RTK et JEV | 01M2WV7C6CAM36VA3H0FTN5HTP ; S22 ; S14 ; 0cc1e59d · #275 | Moteur | Recoder RTK dans h2a, sans emballage ; apporter JEV par le plugin en s’appuyant sur le juge du llm-mesh. Plateforme distribue par le plugin ; Assurance vérifie la matrice --gw/--bare ; Architecture consultée pour le contrat des outils. Retirer ensuite les installations manuelles intérimaires. | Sortie compressée et mesurée sous direct, --gw et --gw --bare. Juge appelé par le plugin sans installation manuelle. Clé et sortie réseau gardées par le llm-mesh. |

## 6.1 · Documents et registre à modifier ensemble

RACI.md devra contenir la nouvelle liste, les cartes des WP, les actes et les exclusions de revue.

org.h2a.yaml devra décrire les mêmes A, les types existants, les périmètres et les liens de communication.

Dans B, nous proposons que cond garde CONDUCTOR ; arch, runtime, portal et infra gardent AGENTS ; assurance utilise CONTROL.

Le rôle CONTROL d’Assurance ne doit pas transformer toute la construction de Track en autorité d’audit automatique.

Un délégué constructeur utilise les droits d’exécution nécessaires. Le contrôle reste séparé, même lorsque le rôle durable possède ces deux activités.

Architecture garde le périmètre racine et ses mandats transverses. Elle ne revendique pas les scopes WP détenus par les constructeurs.

Les droits d’audit sécurité restent dans le périmètre sécurité. Ne pas doubler le scope propriétaire WP7 pour exprimer une consultation.

S18 contient la liste figée des douze acteurs. La future PR doit adapter ce test, en conservant l’unicité et la concordance des WP.

Nous proposons de vérifier aussi les références de noms dans les prompts, les skills, les règles de release et les engagements encore ouverts.

S2 documente des limites historiques du provisionnement. Aucun essai actuel de provisionnement n’a été exécuté dans cette mission.

Ne pas confondre validation du YAML et attribution sûre des droits. Examiner le diff et les prérequis avant chaque activation.

L’état défini, actif ou confirmé doit être observable dans le registre de transition. Ne pas ajouter un champ YAML inconnu sans vérifier son schéma.

Track dépasse désormais WP14. Les conteneurs suivants apparaissent dans la projection, même lorsque leur file est vide.

| Conteneurs supplémentaires | Cible proposée | Précaution |
| --- | --- | --- |
| WP15, WP16, WP19, WP21, WP22, WP23 | Moteur | Contrôle du plugin, statut, erreurs passerelle, mise à niveau, messagerie et boucle. |
| WP17, WP20 | Expérience | Intégration et Focus ; rattachements à confirmer par leurs identifiants durables. |
| WP18 | Moteur dans A/B ; Agents dans C | Deuxième conteneur historique des agents natifs ; conserver sa filiation. |
| S1, S7 | Plateforme | Infrastructure et étude du serveur local. |
| S2, S3, S5 | Conduite | Feuille de route, migration transverse et gouvernance entre projets ; Architecture consultée. |
| S4 | Moteur | Passerelle des modèles. |
| S6, S8 | Assurance dans B/C ; Cadre dans A | Pratique de lancement et politique des modèles. |

## 6.2 · Retour arrière et critères du pilote

Avant bascule, conserver table des mandats, identités, adresses et derniers responsables ayant accusé reprise.

En cas d’échec, restaurer les anciennes correspondances et reprendre chaque sujet au dernier engagement confirmé.

Restaurer les affectations par événements compensateurs. Ne jamais réécrire le journal, effacer les décisions ou recréer les mêmes tâches.

Toute clé révoquée suit sa procédure propre. Un retour organisationnel ne restaure pas automatiquement des secrets ou des droits supprimés.

Coût perdu principal : préparation des fiches, nouvelles correspondances et temps de revue. Les preuves et identifiants restent réutilisables.

Le pilote vise zéro sujet sans A, zéro transfert sans reprise et zéro revue du constructeur sur son propre lot.

Une session est joignable si elle accuse réception en moins de dix minutes pendant les plages de travail. Sinon Conduite désigne un remplaçant et le note dans Track.

Pendant ces plages, quatre battements de dix minutes sans avance déclenchent une reprise par Conduite, conformément au rythme de S4.

Relever avant et après : délai de reprise, nombre de relances humaines et blocages aux frontières. Aucun pourcentage de gain n’est présumé.

Le choix B devient C si les travaux Agents ou Mémoire stagnent derrière les urgences Moteur selon le seuil de la section 5.


