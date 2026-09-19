# Rôles h2a : cinq, six ou sept responsables

r2 · 19 septembre 2026

Dossier produit ; relecture Fable 5.1 de r1 appliquée en r2 ; orientation provisoire ; avis h-arch à obtenir

Aucune modification du dépôt. Aucun message envoyé. Aucun choix humain enregistré. Relecture Fable 5.1 de r1 appliquée en r2 ; r2 sans nouvelle relecture indépendante.

Architecture : 595d2f13dff95fe520ac76c590a9e660a07bc58934bc90caa43721be72dc4f24

## 1 · Décision préparée

Choisir A, B ou C : cinq, six ou sept rôles durables, hors propriétaire humain et constructeurs temporaires.

Nous recommandons B : six rôles gardent l’architecture indépendante et donnent un porteur explicite à Focus, au moteur, à la plateforme et aux outils natifs.

Le dossier est livré pour examen. Aucune réorganisation, ratification, attribution de droits ou publication n’a été exécutée.

La relecture Fable 5.1 de la révision r1 est réalisée ; ses corrections C1 à C5 sont appliquées dans cette révision r2.

L’avis h-arch sur ce dossier reste à obtenir. Le brief interdit les échanges entre sessions.

Les champs de réponse préparent une orientation. Ils ne signent aucun engagement et n’enregistrent rien dans Track.

Ce que nous ne savons pas : le dossier reste provisoire pour ratification. La révision r2 a été corrigée par le relecteur lui-même ; elle n’a pas reçu de nouvelle relecture indépendante.

## 2 · État actuel et preuves

Référence initiale lue : origin/main à 0cc1e59d284442cbafb2d3f113987201d256ef40 (S1 à S21). Le checkout courant pointe sur 0d6b2eaf, dans docs/org-raci-wp7-hinfra.

Les sources suivies ont été lues avec git show. Les deux études locales non suivies (S10, S11) sont distinguées des règles publiées.

Aucun rafraîchissement réseau de origin/main n’a été exécuté. La photographie porte sur cette référence locale du 19 septembre 2026.

Pendant la préparation, origin/main a avancé à c0b9e863, sans action de cette session. L’objectif stratégique RTK et JEV (S22) apparaît dans Track.

Ce changement ne touche pas les règles de gouvernance. Les chiffres et empreintes du dossier restent ancrés sur la référence initiale ; S22 est cité à part.

S1 et S2 décrivent douze acteurs, plus Fabien. Le statut global attend encore une ratification.

S9 consigne une décision ultérieure : h-infra construit WP6 et WP7 ; arch conçoit et réexamine le construit.

S9 existe sur la branche locale de gouvernance, sans appartenir à origin/main. Les deux états ne sont donc pas alignés.

Nous estimons que compter les noms masque trois objets différents : responsabilité durable, type du protocole et session temporaire.

| Acteur durable | Type du protocole | WP sur main | Mandat écrit | Correspondance actuelle |
| --- | --- | --- | --- | --- |
| cond | CONDUCTOR | WP4 | Gouvernance, ordre du travail, délégation et escalade. | h-cond ; activité nominative non confirmée par la présence. |
| arch | AGENTS | WP6 sur main | Identité et arbitrage des frontières dans le RACI. | h-arch ; S9 limite ensuite arch à la conception et au contrôle du construit. |
| harness | CONTROL | WP9 | Méthode et contrôles requis. | h-harness ; doctrine du conducteur aussi confiée à cette session. |
| cyber | CONTROL | Sécurité, sans WP sur main | Politique de sécurité, audit et réparations. | Aucune session cyber nominative confirmée ; S9 rattache sa livraison à WP7. |
| coop | AGENTS | WP1, WP2, WP3 | Protocole, adressage, présence et coordination. | Aucune session coop nominative confirmée ; mutualisation avec runtime encore en décision. |
| runtime | AGENTS | WP5 | Lancement, cycle de vie et exécution. | h-runtime ; MCP, passerelle et permissions débordent la seule étiquette WP5. |
| track | AGENTS | WP8 | Journal, état du travail et décisions. | Une session track publie sa présence. |
| plugins | AGENTS | WP10 | Distribution, interface de commande et empaquetage. | h-plugins déclaré dans le brief ; intégration de nouveaux hôtes tracée. |
| memory | AGENTS | WP11 | Mémoire et contexte des agents. | Aucune session memory nominative confirmée ; sujet à garder explicitement. |
| portal | AGENTS | WP12 | Intégration sentropic, exposition des sessions et dossiers. | h-portal ; Focus explicitement rattaché par les actes du RACI. |
| agents | AGENTS | WP13 | Interface native et moteur des agents. | h-agents déclaré dans le brief ; tests de caractérisation du dispatch tracés. |
| gateway | AGENTS | WP14 | Routage des modèles et pools de comptes. | Pas de session gateway nominative confirmée ; une mutualisation reste pending dans Track. |

| Session | Présence observée | Périmètre étayé | Preuve |
| --- | --- | --- | --- |
| h-cond | Déclarée dans le brief ; absente du relevé nominatif. | Pilotage et arbitrages techniques dans Track ; doctrine de délégation à formaliser. | 01M2AWJS6HTKNDN2AN6QX3FQ1J ; S4 |
| h-runtime | Présence publiée ; activité MCP ancienne. | MCP au lancement, reprise des sessions, permissions et passerelle. | 01M2AWJRVJZZNA41MCX88GG24K ; 01M0SSNGNSRS9RAA8GM1JPX6Q4 ; S14 |
| h-portal | Présence publiée ; activité MCP ancienne. | Tests Focus, dossiers et exposition vers sentropic. | 01M05Y86SDYYX0H3Q66NMVRERS ; S1 § B |
| h-infra | Déclarée dans le brief ; absente du relevé nominatif. | Construction identité et infrastructure selon S9 ; opération de purge historique tracée. | 43002a77 ; 01M2AWJSFDQW02GEYD53BCHKDB |
| h-arch | Présence publiée ; activité MCP ancienne. | Architecture transverse, identité, étude Focus et diagrammes. | 01M1VCKJCGF414RG738N23SDAZ ; S9 |
| h-harness | Présence publiée ; activité MCP ancienne. | Politique des modèles, contrôles et doctrine conducteur. | 01M0GXK6ZJ76QPXVDA4W54D5DK ; 01M2AWJS6HTKNDN2AN6QX3FQ1J |
| h-plugins | Déclarée dans le brief ; absente du relevé nominatif. | Adaptateurs des hôtes et distribution du plugin. | 01M06N825JFPQXGDJ7QV8Q2VJR |
| h-agents | Déclarée dans le brief ; absente du relevé nominatif. | Moteur natif et caractérisation des commandes de lancement. | 01M0GXK7CVFW5RKN7MGGM0WJD8 ; #229, b3844726 |
| track et ponctuelles | track, fable-review, fable-mcp et plusieurs noms h2a publiés. | La présence ne rattache pas automatiquement ces sessions à un mandat durable. | S13 ; aucun message envoyé. |

Schéma : voir la carte illustrée dans [index.html](index.html#section-2).

## 2.1 · Ce que la présence et Track prouvent

Le relevé MCP (S13) publie h-runtime, h-portal, h-arch et h-harness. Leur indicateur reste idle-uncertain, avec une activité MCP ancienne.

h-cond, h-infra, h-plugins et h-agents sont annoncées par le brief, mais absentes de ce relevé nominatif.

Une session track est également visible. Les comptes cinq, six et sept visent des mandats permanents, pas tous les processus observés.

Le journal de main (S12) contient 1 511 événements. Sa projection donne 238 TO-DO, 9 AWAITED, 12 DROPPED et aucun DONE accepté.

La lecture MCP initiale utilisait le journal local plus ancien. La synthèse retient la copie isolée du journal de main.

Les commits et branches examinés portent surtout le nom humain de Fabien. Leur auteur Git ne permet pas d’identifier le modèle constructeur.

Les affectations nominatives proviennent donc surtout de Track. Les commits confirment les travaux et leurs révisions, sans inventer d’attribution.

Ce que nous ne savons pas : une absence du relevé ne prouve pas un arrêt. Une présence publiée ne prouve pas qu’une session répond. Les catégories Track évaluent aussi l’acceptation à la révision choisie ; elles ne signifient pas que le travail est inexistant ou défectueux. Le binaire Track existant a produit cette projection sans recompilation ; les extraits conservent la méthode et son empreinte.

## 2.2 · Doublons, trous et incidents

Nous estimons que les doublons principaux touchent MCP, Focus, distribution et contrôle. Les trous concernent surtout la disponibilité réelle, la relève, la mémoire et les outils natifs.

S14 a supprimé le --bare implicite sous --gw dans main. Ce changement ne garantit pas la mise à niveau des sessions anciennes.

S22 fixe un objectif stratégique : recoder RTK dans h2a et apporter JEV par le plugin via le juge du llm-mesh. Aucun acteur écrit ne le porte aujourd’hui.

WP7 est encore vide dans Track. Le test du manifeste (S18) assimile les scopes WP à une propriété unique.

Nous estimons qu’ajouter simultanément WP7 à cyber et h-infra, comme S9, entrerait en conflit avec cet invariant actuel.

Nous proposons que la migration distingue propriété du WP, droits d’audit et participation à sa livraison.

| Cas | Fait ou signalement | Défaut de responsabilité | Réponse organisationnelle proposée | Source |
| --- | --- | --- | --- | --- |
| Conducteur qui construit lui-même | Signalement du brief. Track demande une doctrine explicite de délégation. | Pilotage et réalisation se confondent. | Conduite nomme un exécutant et une preuve attendue. Elle ne remplace pas silencieusement cet exécutant. | S4 ; 01M2AWJS6HTKNDN2AN6QX3FQ1J |
| Sessions injoignables sous --gw | S14 corrige le --bare implicite. Le relevé voit encore plusieurs versions 0.97.1. | Une session vivante est prise pour un interlocuteur disponible. | Moteur pilote la joignabilité. Une session est joignable si elle accuse réception en moins de dix minutes pendant les plages de travail. Sinon Conduite désigne un remplaçant et le note dans Track. Un accusé de reprise précède le transfert du travail. | 0cc1e59d ; S13 |
| Focus sans porteur clair | S1 donne déjà son exposition à portal. Track constate la séparation problématique du skill et du rendu. | Architecture, rendu et distribution revendiquent la même livraison. | Expérience porte le résultat Focus. Le DS garde ses bibliothèques communes. | S1 § B ; S16 ; S17 |
| Construction bloquée par les permissions | Le défaut de sandbox au lancement reste in-progress dans Track. Ce statut ne revalide pas la panne. | Le lanceur, le plugin et la politique de sécurité se renvoient le problème. | Moteur pilote le lancement. Plateforme distribue les réglages ; Assurance examine les changements de politique. | 01KYJ4GJK9W3EAWC7T0GAZN2BM ; 01KYR051B0ADGQ51NYFYY5CPTV |
| Correctif MCP sans porteur actif | La durée vient du brief. Une affectation h-runtime est tracée, et des réparations ont été fusionnées. | Affectation écrite et prise en charge effective ne coïncident pas. | Moteur reçoit les incidents MCP. Conduite vérifie la prise en charge et nomme un remplaçant si nécessaire. | S15 ; 01M2AWJRVJZZNA41MCX88GG24K |
| Plan DS publié en parallèle | L’absence de concertation vient du brief. S17 prouve un rapprochement ultérieur, sans prouver un accord complet. | Deux plans partent sans interface ni calendrier communs. | Expérience consolide les dépendances. Architecture consulte le DS ; Conduite obtient un engagement explicite entre projets. | Brief ; S17 ; S10–S11 |

## 2.3 · Règles des modèles à conserver ou clarifier

S4 demande une revue unique et cite Opus. S3 exige deux modèles autorisés et exclut Opus de la revue.

S1 et S5 exigent aussi deux jambes indépendantes pour les fusions concernées. Ces textes ne peuvent pas être présentés comme déjà harmonisés.

Nous proposons que S3 régisse les profils de ce dossier. La future modification devra expliciter la supersession de la phrase contradictoire de S4.

Le brief autorise Astra pour cette analyse. Fable 5.1 n’est pas assimilé silencieusement à claude-fable-5 dans le catalogue permanent.

Nous convenons que les noms courts Sol, Terra, Fable et Gemini renvoient exclusivement aux identifiants du tableau suivant.

Ce que nous ne savons pas : le modèle et l’effort demandés ne constituent pas une attestation indépendante du modèle effectivement servi.

| Usage | Modèle recommandé | Limite ou repli |
| --- | --- | --- |
| Conduite | gpt-5.6-sol · xhigh | Proposition de ce dossier. S3 ne fixe pas explicitement le modèle du conducteur. |
| Conception | gpt-5.6-sol · xhigh | Repli si indisponible : claude-fable-5, puis gemini-3.7. |
| Construction | gpt-5.6-terra · xhigh | Replis : gemini-3.7 high, puis opus-5 xhigh. Cas simples seulement : replis limités de S3. |
| Relecture d’une construction Terra | gpt-5.6-sol · xhigh + claude-fable-5 | Deux instances distinctes du constructeur, deux modèles distincts, sans passerelle. |
| Relecture d’une conception Sol | claude-fable-5 + gemini-3.7 | L’auteur Sol ne devient pas son propre relecteur. Efforts non spécifiés par S3 pour ces deux modèles. |
| Mandat du présent dossier | Astra demandée ; Fable 5.1 demandée dans le verbatim | Exception limitée à cette demande. Relecture Fable 5.1 de r1 réalisée, corrections appliquées en r2 ; aucun élargissement permanent du catalogue. |

## 3 · Enjeux et limites communes

Nous estimons que réduire les rôles doit réduire les sujets sans porteur et les interruptions humaines. Le nombre de sessions seul ne mesure pas ce progrès.

Nous proposons que Conduite reste le contact principal. Les alertes de sécurité et l’avis architectural gardent un accès direct au propriétaire.

Le propriétaire ne compte pas parmi les cinq à sept rôles. Aucun nouveau type du protocole n’est proposé.

Nous proposons que chaque WP et chaque acte possèdent un A unique. Un rôle peut déléguer le travail sans déléguer sa responsabilité finale.

S5 limite la fusion autonome à une classe précise : contrôles verts, deux revues indépendantes et aucun changement visible par le propriétaire.

Ailleurs, nous proposons de conserver les décisions existantes. Ni publication, ni extension de droits, ni suppression irréversible ne découle du choix d’une architecture.

S6 impose la version dans la PR fonctionnelle lorsque cette version est déjà connue. Changer de responsable ne modifie pas cette règle.

L’avis arch reste obligatoire pour modifier le RACI (S1). Le regroupement A doit conserver cette fonction, ses objections et sa trace.

Nous estimons qu’un relecteur temporaire n’est pas un nouveau rôle durable. Son mandat, son indépendance et son modèle doivent rester identifiables.

Nous proposons que, si Assurance construit Track ou un contrôle, elle ne compte pas parmi les jambes qui relisent ce changement.

Dans A, nous proposons que le rôle Cadre ne certifie pas ses propres conceptions. Deux relecteurs indépendants restent nécessaires.

Nous proposons que la sécurité puisse interrompre un lot pour produire une alerte motivée. Le déployeur ne clôt pas seul cette alerte.

| Relation entre projets | Règle proposée pour A, B et C | Niveau de garantie |
| --- | --- | --- |
| Autre projet avec plusieurs clients | Il conserve son propriétaire et ses priorités. Expérience ne devient pas son conducteur. | Convention ; aucun mécanisme nouveau livré. |
| Demande de priorité externe | Conduite négocie un engagement explicite. Aucun ordre unilatéral. | Accord enregistré à prévoir. |
| Refus de l’autre projet | Conserver le refus et sa cause ; proposer un délai ou une autre solution. | Convention ; pas de contournement. |
| Propriétaires différents | Chaque conducteur remonte à son propriétaire ; arbitrage conjoint si nécessaire. | Pas de super-propriétaire inventé. |
| Échange agent à agent | Mandat et périmètre autorisés avant communication externe. | Les commEdges actuels ne constituent pas une autorisation. |

## 4 · Trois propositions comparables

Tous les tableaux de cette section sont des propositions. Les limites communes de la section 3 s’appliquent à chaque rôle.

Les WP historiques restent identifiés. WP7 reçoit un responsable cible, sans déplacement implicite des tâches déjà reclassées.

Les outils natifs RTK et JEV (S22) reçoivent le même porteur unique dans les trois options : Moteur. Plateforme, Assurance et Architecture restent en interface.

Les estimations mesurent la préparation organisationnelle, sans mesure de charge. Elles excluent les réparations logicielles, l’attente humaine et le temps des revues externes.

### Cinq rôles · regroupement fort

Un contact principal : h-cond. Cinq sessions durables visées, contre les huit noms du brief.

| Rôle et session | Mission | WP | Décide seul | Consulte ou demande | Modèles |
| --- | --- | --- | --- | --- | --- |
| Conduite · h-cond | Ordonne le travail, délègue les réalisations et présente les décisions au propriétaire. | WP4 | Ordre des lots dans les priorités fixées, délégation, reprise et remplacement. | Architecture sur le RACI ; propriétaire pour priorités, acceptation et actes irréversibles. | Pilotage Sol ; conception Sol ; construction déléguée ; revue indépendante. |
| Cadre et assurance · h-arch | Réunit architecture, méthode, Track et contrôle de sécurité dans un même rôle durable. | WP8, WP9 | Contrats internes et méthode, sous les mandats existants. | Deux relecteurs indépendants pour ses productions ; propriétaire pour RACI, droits et dérogations. | Conception Sol ; construction Terra déléguée ; revue externe Fable et Gemini des textes Sol. |
| Moteur · h-runtime | Rend les sessions, la coordination et les agents utilisables de bout en bout. | WP1, WP2, WP3, WP5, WP11, WP13, WP14 | Réparations et choix internes du cycle de vie, dans les contrats approuvés. | Architecture pour interfaces ; Assurance pour sécurité ; Expérience pour effets visibles. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Expérience · h-portal | Porte Focus, les diagrammes et les interfaces utilisables par le propriétaire. | WP12 | Conception et réalisation dans les parcours et contrats approuvés. | DS pour composants partagés ; Architecture pour contrats ; propriétaire pour recette et changement visible. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Plateforme · h-infra | Livre les services, identités, plugins et versions nécessaires aux autres rôles. | WP6, WP7, WP10 | Construction, empaquetage et préparation des livraisons dans les mandats existants. | Architecture pour identité ; Assurance pour audit ; Conduite pour calendrier ; propriétaire pour publication. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |

| Sujet | A | Interfaces |
| --- | --- | --- |
| MCP au lancement et reprise | Moteur | Plateforme pour service et identité ; Expérience pour connecteurs visibles. |
| --gw, --bare et joignabilité | Moteur | Plateforme distribue ; Cadre et assurance vérifie la matrice des modes. |
| Focus et diagrammes | Expérience | DS garde les bibliothèques ; Cadre et assurance arbitre les contrats. |
| Cluster mesh : intégration de service | Plateforme | Moteur porte le consommateur h2a ; fournisseur externe consulté. |
| Track, journal et projection | Cadre et assurance | Conduite utilise les états ; Expérience présente les dossiers. |
| Plugins et installation des skills | Plateforme | Cadre et assurance possède la doctrine des skills ; rôle métier possède leur contenu spécialisé. |
| Infrastructure et release | Plateforme | Conduite fixe le calendrier ; propriétaire autorise la publication. |
| Sécurité et audit | Cadre et assurance | Le rôle concerné livre le correctif ; aucun déployeur ne valide son propre audit. |
| Mémoire et agents natifs | Moteur | Architecture du contrat Graphify consultée ; aucun engagement externe implicite. |
| Permissions d’une session | Moteur | Plateforme distribue les réglages ; Cadre et assurance examine la politique. |
| Outils natifs de la passerelle : RTK et JEV (S22) | Moteur | Plateforme distribue par le plugin ; Cadre et assurance vérifie la matrice --gw/--bare et le contrat des outils ; llm-mesh consulté pour le juge. |

| Acte | A | R | C | I |
| --- | --- | --- | --- | --- |
| Priorités et acceptation utilisateur | Propriétaire | Propriétaire | Conduite | Tous |
| Ordre des lots et reprise d’un sujet | Conduite | Conduite | Rôle concerné | Propriétaire au bilan |
| Proposition de RACI | Conduite | Conduite | Cadre et assurance ; rôles concernés | Tous |
| Ratification et nouveaux droits | Propriétaire | Conduite prépare | Cadre et assurance ; Cadre et assurance | Tous |
| Architecture et frontières | Cadre et assurance | Cadre et assurance | Rôles concernés ; DS si touché | Conduite |
| Livraison d’un WP | Rôle indiqué dans sa carte | Constructeur délégué | Cadre et assurance ; Cadre et assurance | Conduite |
| Recette technique et revue | Cadre et assurance | Deux relecteurs indépendants | Rôle concerné ; Cadre et assurance | Conduite |
| Modification d’un contrôle requis | Cadre et assurance | Constructeur distinct | Architecture et audit indépendants du lot | Tous |
| Audit de sécurité | Cadre et assurance | Auditeur indépendant | Rôle audité ; portée fixée par Conduite ou propriétaire | Conduite et propriétaire |
| Correction de sécurité | Rôle propriétaire du composant | Constructeur délégué | Cadre et assurance | Conduite |
| Préparation d’une version | Plateforme | Constructeur ou intégrateur délégué | Cadre et assurance ; Conduite | Tous |
| Autorisation de publication | Propriétaire | Plateforme exécute | Cadre et assurance ; Conduite | Tous |
| Écriture du journal Track | Cadre et assurance | Écrivain unique désigné | Rôle du sujet ; Conduite | Tous |
| Engagement entre projets | Conduite pour h2a | Rôle technique concerné | Autre conducteur ; Cadre et assurance | Propriétaires concernés |

Pour : Cinq mandats durables à maintenir. Architecture, méthode et preuve partagent une seule file. Les échanges administratifs diminuent.

Contre : Le même rôle conçoit et organise le contrôle. Track, sécurité et architecture peuvent se bloquer mutuellement. La relève du rôle Cadre devient difficile.

Risques : Contrôle capturé par les urgences de conception. Sept WP historiques restent réunis dans Moteur.

Coût : Élevé : fusionner architecture, harness, Track et cyber exige une nouvelle séparation des tâches. 3 à 5 journées de préparation, puis 10 jours ouvrés de pilote.

Retour : Séparer de nouveau Cadre en Architecture et Assurance, en gardant les identités historiques.

### Six rôles · architecture séparée

Un contact principal : h-cond. Six sessions durables visées, avec accès direct aux preuves et aux alertes.

| Rôle et session | Mission | WP | Décide seul | Consulte ou demande | Modèles |
| --- | --- | --- | --- | --- | --- |
| Conduite · h-cond | Ordonne le travail, délègue les réalisations et présente les décisions au propriétaire. | WP4 | Ordre des lots dans les priorités fixées, délégation, reprise et remplacement. | Architecture sur le RACI ; propriétaire pour priorités, acceptation et actes irréversibles. | Pilotage Sol ; conception Sol ; construction déléguée ; revue indépendante. |
| Architecture · h-arch | Définit les contrats communs et vérifie leur respect dans le résultat construit. | Transverse ; aucun WP de construction | Choix internes réversibles et arbitrage technique dans les mandats existants. | Équipes touchées avant toute frontière ; propriétaire pour droits ou contrats publics. | Conception Sol ; aucune construction ; relecture Fable et Gemini de ses propres textes. |
| Moteur · h-runtime | Rend les sessions, la coordination et les agents utilisables de bout en bout. | WP1, WP2, WP3, WP5, WP11, WP13, WP14 | Réparations et choix internes du cycle de vie, dans les contrats approuvés. | Architecture pour interfaces ; Assurance pour sécurité ; Expérience pour effets visibles. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Expérience · h-portal | Porte Focus, les diagrammes et les interfaces utilisables par le propriétaire. | WP12 | Conception et réalisation dans les parcours et contrats approuvés. | DS pour composants partagés ; Architecture pour contrats ; propriétaire pour recette et changement visible. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Plateforme · h-infra | Livre les services, identités, plugins et versions nécessaires aux autres rôles. | WP6, WP7, WP10 | Construction, empaquetage et préparation des livraisons dans les mandats existants. | Architecture pour identité ; Assurance pour audit ; Conduite pour calendrier ; propriétaire pour publication. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Assurance · h-harness | Tient Track, la méthode et les preuves de qualité, avec un audit de sécurité indépendant. | WP8, WP9 | Méthode, critères existants, diagnostic sécurité et désignation des vérificateurs indépendants. | Architecture et relecteurs externes au lot pour ses propres changements ; propriétaire pour dérogations. | Conception Sol ; construction Terra déléguée ; revue externe au lot ; jamais sa propre jambe. |

| Sujet | A | Interfaces |
| --- | --- | --- |
| MCP au lancement et reprise | Moteur | Plateforme pour service et identité ; Expérience pour connecteurs visibles. |
| --gw, --bare et joignabilité | Moteur | Plateforme distribue ; Assurance vérifie la matrice des modes. |
| Focus et diagrammes | Expérience | DS garde les bibliothèques ; Architecture arbitre les contrats. |
| Cluster mesh : intégration de service | Plateforme | Moteur porte le consommateur h2a ; fournisseur externe consulté. |
| Track, journal et projection | Assurance | Conduite utilise les états ; Expérience présente les dossiers. |
| Plugins et installation des skills | Plateforme | Assurance possède la doctrine des skills ; rôle métier possède leur contenu spécialisé. |
| Infrastructure et release | Plateforme | Conduite fixe le calendrier ; propriétaire autorise la publication. |
| Sécurité et audit | Assurance | Le rôle concerné livre le correctif ; aucun déployeur ne valide son propre audit. |
| Mémoire et agents natifs | Moteur | Architecture du contrat Graphify consultée ; aucun engagement externe implicite. |
| Permissions d’une session | Moteur | Plateforme distribue les réglages ; Assurance examine la politique. |
| Outils natifs de la passerelle : RTK et JEV (S22) | Moteur | Plateforme distribue par le plugin ; Assurance vérifie la matrice --gw/--bare ; Architecture consultée pour le contrat des outils ; llm-mesh consulté pour le juge. |

| Acte | A | R | C | I |
| --- | --- | --- | --- | --- |
| Priorités et acceptation utilisateur | Propriétaire | Propriétaire | Conduite | Tous |
| Ordre des lots et reprise d’un sujet | Conduite | Conduite | Rôle concerné | Propriétaire au bilan |
| Proposition de RACI | Conduite | Conduite | Architecture ; rôles concernés | Tous |
| Ratification et nouveaux droits | Propriétaire | Conduite prépare | Architecture ; Assurance | Tous |
| Architecture et frontières | Architecture | Architecture | Rôles concernés ; DS si touché | Conduite |
| Livraison d’un WP | Rôle indiqué dans sa carte | Constructeur délégué | Architecture ; Assurance | Conduite |
| Recette technique et revue | Assurance | Deux relecteurs indépendants | Rôle concerné ; Architecture | Conduite |
| Modification d’un contrôle requis | Assurance | Constructeur distinct | Architecture et audit indépendants du lot | Tous |
| Audit de sécurité | Assurance | Auditeur indépendant | Rôle audité ; portée fixée par Conduite ou propriétaire | Conduite et propriétaire |
| Correction de sécurité | Rôle propriétaire du composant | Constructeur délégué | Assurance | Conduite |
| Préparation d’une version | Plateforme | Constructeur ou intégrateur délégué | Assurance ; Conduite | Tous |
| Autorisation de publication | Propriétaire | Plateforme exécute | Assurance ; Conduite | Tous |
| Écriture du journal Track | Assurance | Écrivain unique désigné | Rôle du sujet ; Conduite | Tous |
| Engagement entre projets | Conduite pour h2a | Rôle technique concerné | Autre conducteur ; Architecture | Propriétaires concernés |

Pour : Architecture reste un contrepoids distinct du conducteur. Focus et infrastructure ont chacun un porteur explicite. Deux regroupements absorbent les frontières les plus fréquentes.

Contre : Moteur rassemble sept WP historiques. Assurance mélange construction de Track et organisation des contrôles. Mémoire perd un interlocuteur durable dédié.

Risques : Moteur devient la nouvelle file d’attente centrale. Assurance pourrait certifier ses propres outils sans exclusion explicite.

Coût : Moyen : réunir infra et plugins ; absorber agents, mémoire et passerelle dans Moteur. 2 à 4 journées de préparation, puis 10 jours ouvrés de pilote.

Retour : Rétablir h-agents comme septième rôle si le moteur sature.

### Sept rôles · agents natifs séparés

Un contact principal : h-cond. Sept sessions durables visées ; les constructeurs temporaires restent possibles.

| Rôle et session | Mission | WP | Décide seul | Consulte ou demande | Modèles |
| --- | --- | --- | --- | --- | --- |
| Conduite · h-cond | Ordonne le travail, délègue les réalisations et présente les décisions au propriétaire. | WP4 | Ordre des lots dans les priorités fixées, délégation, reprise et remplacement. | Architecture sur le RACI ; propriétaire pour priorités, acceptation et actes irréversibles. | Pilotage Sol ; conception Sol ; construction déléguée ; revue indépendante. |
| Architecture · h-arch | Définit les contrats communs et vérifie leur respect dans le résultat construit. | Transverse ; aucun WP de construction | Choix internes réversibles et arbitrage technique dans les mandats existants. | Équipes touchées avant toute frontière ; propriétaire pour droits ou contrats publics. | Conception Sol ; aucune construction ; relecture Fable et Gemini de ses propres textes. |
| Moteur · h-runtime | Rend fiables le lancement, la présence, la coordination et le routage des sessions. | WP1, WP2, WP3, WP5, WP14 | Réparations et choix internes du cycle de vie, dans les contrats approuvés. | Architecture pour interfaces ; Assurance pour sécurité ; Expérience pour effets visibles. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Agents · h-agents | Porte le moteur natif des agents, leur mémoire et leur contexte. | WP11, WP13 | Boucle native et intégration mémoire dans les contrats approuvés. | Moteur pour lancement ; Architecture pour interfaces ; Expérience pour parcours visibles. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Expérience · h-portal | Porte Focus, les diagrammes et les interfaces utilisables par le propriétaire. | WP12 | Conception et réalisation dans les parcours et contrats approuvés. | DS pour composants partagés ; Architecture pour contrats ; propriétaire pour recette et changement visible. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Plateforme · h-infra | Livre les services, identités, plugins et versions nécessaires aux autres rôles. | WP6, WP7, WP10 | Construction, empaquetage et préparation des livraisons dans les mandats existants. | Architecture pour identité ; Assurance pour audit ; Conduite pour calendrier ; propriétaire pour publication. | Conception Sol ; construction Terra ; revue Sol et Fable après construction. |
| Assurance · h-harness | Tient Track, la méthode et les preuves de qualité, avec un audit de sécurité indépendant. | WP8, WP9 | Méthode, critères existants, diagnostic sécurité et désignation des vérificateurs indépendants. | Architecture et relecteurs externes au lot pour ses propres changements ; propriétaire pour dérogations. | Conception Sol ; construction Terra déléguée ; revue externe au lot ; jamais sa propre jambe. |

| Sujet | A | Interfaces |
| --- | --- | --- |
| MCP au lancement et reprise | Moteur | Plateforme pour service et identité ; Expérience pour connecteurs visibles. |
| --gw, --bare et joignabilité | Moteur | Plateforme distribue ; Assurance vérifie la matrice des modes. |
| Focus et diagrammes | Expérience | DS garde les bibliothèques ; Architecture arbitre les contrats. |
| Cluster mesh : intégration de service | Plateforme | Moteur porte le consommateur h2a ; fournisseur externe consulté. |
| Track, journal et projection | Assurance | Conduite utilise les états ; Expérience présente les dossiers. |
| Plugins et installation des skills | Plateforme | Assurance possède la doctrine des skills ; rôle métier possède leur contenu spécialisé. |
| Infrastructure et release | Plateforme | Conduite fixe le calendrier ; propriétaire autorise la publication. |
| Sécurité et audit | Assurance | Le rôle concerné livre le correctif ; aucun déployeur ne valide son propre audit. |
| Mémoire et agents natifs | Agents | Architecture du contrat Graphify consultée ; aucun engagement externe implicite. |
| Permissions d’une session | Moteur | Plateforme distribue les réglages ; Assurance examine la politique. |
| Outils natifs de la passerelle : RTK et JEV (S22) | Moteur | Plateforme distribue par le plugin ; Assurance vérifie la matrice --gw/--bare ; Architecture consultée pour le contrat des outils ; llm-mesh consulté pour le juge. |

| Acte | A | R | C | I |
| --- | --- | --- | --- | --- |
| Priorités et acceptation utilisateur | Propriétaire | Propriétaire | Conduite | Tous |
| Ordre des lots et reprise d’un sujet | Conduite | Conduite | Rôle concerné | Propriétaire au bilan |
| Proposition de RACI | Conduite | Conduite | Architecture ; rôles concernés | Tous |
| Ratification et nouveaux droits | Propriétaire | Conduite prépare | Architecture ; Assurance | Tous |
| Architecture et frontières | Architecture | Architecture | Rôles concernés ; DS si touché | Conduite |
| Livraison d’un WP | Rôle indiqué dans sa carte | Constructeur délégué | Architecture ; Assurance | Conduite |
| Recette technique et revue | Assurance | Deux relecteurs indépendants | Rôle concerné ; Architecture | Conduite |
| Modification d’un contrôle requis | Assurance | Constructeur distinct | Architecture et audit indépendants du lot | Tous |
| Audit de sécurité | Assurance | Auditeur indépendant | Rôle audité ; portée fixée par Conduite ou propriétaire | Conduite et propriétaire |
| Correction de sécurité | Rôle propriétaire du composant | Constructeur délégué | Assurance | Conduite |
| Préparation d’une version | Plateforme | Constructeur ou intégrateur délégué | Assurance ; Conduite | Tous |
| Autorisation de publication | Propriétaire | Plateforme exécute | Assurance ; Conduite | Tous |
| Écriture du journal Track | Assurance | Écrivain unique désigné | Rôle du sujet ; Conduite | Tous |
| Engagement entre projets | Conduite pour h2a | Rôle technique concerné | Autre conducteur ; Architecture | Propriétaires concernés |

Pour : Les agents natifs conservent un responsable spécialisé. Mémoire et boucle native avancent dans une file propre. Le périmètre du moteur devient plus petit.

Contre : Une session durable supplémentaire par rapport à B. Lancement et boucle native exigent encore une coordination. Le regroupement Track, méthode et sécurité reste nécessaire.

Risques : Le renvoi de responsabilité revient entre Moteur et Agents. La réduction des interlocuteurs reste limitée.

Coût : Faible à moyen : conserver h-agents, réunir infra et plugins, clarifier les contrôles. 2 à 3 journées de préparation, puis 10 jours ouvrés de pilote.

Retour : Fusionner Agents dans Moteur après mesure d’une faible charge autonome.

## 4.1 · Comparaison symétrique

Chaque option possède trois avantages, trois inconvénients et deux risques. Les coûts sont des fourchettes de préparation estimées sans mesure de charge.

| Option | Pour | Contre | Risques | Coût et délai | Quand elle gagne |
| --- | --- | --- | --- | --- | --- |
| A · 5 | Cinq mandats durables à maintenir. / Architecture, méthode et preuve partagent une seule file. / Les échanges administratifs diminuent. | Le même rôle conçoit et organise le contrôle. / Track, sécurité et architecture peuvent se bloquer mutuellement. / La relève du rôle Cadre devient difficile. | Contrôle capturé par les urgences de conception. / Sept WP historiques restent réunis dans Moteur. | Élevé : fusionner architecture, harness, Track et cyber exige une nouvelle séparation des tâches. 3 à 5 journées de préparation, puis 10 jours ouvrés de pilote. | Gagnerait si les demandes d’architecture et d’audit restent rares, avec des relecteurs indépendants disponibles. |
| B · 6 | Architecture reste un contrepoids distinct du conducteur. / Focus et infrastructure ont chacun un porteur explicite. / Deux regroupements absorbent les frontières les plus fréquentes. | Moteur rassemble sept WP historiques. / Assurance mélange construction de Track et organisation des contrôles. / Mémoire perd un interlocuteur durable dédié. | Moteur devient la nouvelle file d’attente centrale. / Assurance pourrait certifier ses propres outils sans exclusion explicite. | Moyen : réunir infra et plugins ; absorber agents, mémoire et passerelle dans Moteur. 2 à 4 journées de préparation, puis 10 jours ouvrés de pilote. | Gagnerait si la plupart des urgences concernent les frontières entre équipes et la prise en charge. |
| C · 7 | Les agents natifs conservent un responsable spécialisé. / Mémoire et boucle native avancent dans une file propre. / Le périmètre du moteur devient plus petit. | Une session durable supplémentaire par rapport à B. / Lancement et boucle native exigent encore une coordination. / Le regroupement Track, méthode et sécurité reste nécessaire. | Le renvoi de responsabilité revient entre Moteur et Agents. / La réduction des interlocuteurs reste limitée. | Faible à moyen : conserver h-agents, réunir infra et plugins, clarifier les contrôles. 2 à 3 journées de préparation, puis 10 jours ouvrés de pilote. | Gagnerait si agents natifs et mémoire portent plusieurs livraisons indépendantes simultanées. |

## 5 · Recommandation et conditions de révision

Nous recommandons six rôles, parce que ce découpage sépare l’architecture de l’assurance et nomme un porteur pour Focus, le moteur et la plateforme.

Meilleur argument contre B : Moteur réunit sept WP et peut absorber la mémoire, les agents natifs et les outils RTK et JEV.

Nous proposons de préférer C, avec h-agents autonome, si deux lots Agents ou Mémoire restent retardés par les urgences runtime pendant le pilote.

Nous estimons que A peut réduire davantage les coûts de coordination si architecture et audit occupent durablement peu de capacité.

Nous proposons de revoir B si Assurance ne peut assurer Track et les audits sans relire ses propres changements.

Nous faisons l’hypothèse que le problème dominant est la perte de responsabilité aux frontières, davantage que le manque de constructeurs. Le pilote doit vérifier cette hypothèse.

Échec possible à six mois : les noms changent, mais les reprises restent implicites et Conduite continue de construire les urgences.

Moteur sature alors ; Assurance laisse vieillir les preuves ; le propriétaire doit de nouveau suivre chaque session.

Intérêt du présentateur : B facilite le classement des sujets dans une carte compacte. Cela ne prouve aucun gain pour le propriétaire.

Intérêt du propriétaire : moins de relances, une responsabilité visible, des preuves lisibles et la possibilité de revenir au découpage précédent.

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

## 7 · Attendus du propriétaire

| Critère | Origine | Couverture | Écart restant |
| --- | --- | --- | --- |
| État actuel documenté | Brief | Douze acteurs, sessions, Track et historique. | Disponibilité effective non testée, sans messages. |
| Deux ou trois propositions | Brief | A : cinq ; B : six ; C : sept. | Aucun choix humain enregistré. |
| Rôles, WP, décisions et modèles | Brief | Cartes, sujets, RACI et profils par usage. | Textes de gouvernance contradictoires à harmoniser ultérieurement. |
| Outils natifs RTK et JEV | Track S22 | Porteur Moteur dans A, B et C ; transfert et preuve de reprise. | Contrat des outils à concevoir ; aucune réalisation engagée. |
| Comparaison et recommandation | Brief ; present-decision | Arguments symétriques, risques, coûts et conditions de révision. | Charge réelle insuffisante pour une prévision chiffrée. |
| Migration sans perte | Brief | Table de reprises, ordre, prérequis et retour arrière. | Aucune migration exécutée. |
| Focus v4 autonome | Brief | JSON, page HTML, décisions et bloc de copie. | Compatibilité d’import dans une application Focus non testée. |
| Astra et Fable 5.1 | Verbatim dans le brief | Analyse Astra ; relecture Fable 5.1 de r1 ; corrections C1 à C5 appliquées en r2. | r2 corrigée par le relecteur lui-même ; aucune nouvelle relecture indépendante. |
| Aucun changement du dépôt | Brief | Écriture limitée au scratchpad et aux fichiers temporaires. | Activité des autres sessions non contrôlée. |

## 8 · Réponses préparables

D1 choisit le découpage ; D2 précise la conduite ; D3 encadre les modèles ; D4 choisit la transition.

Aucun choix n’est présélectionné. Les recommandations ne sont pas des réponses du propriétaire.

Chaque question possède un seul commentaire. La copie inclut question, choix, texte de réponse, remarque historique et commentaire.

Avant tout amendement effectif, compléter l’avis architectural et les revues indépendantes applicables. La page ne déclenche aucune action.

### D1 · Combien de rôles durables retenir ?

Les douze acteurs écrits ne correspondent plus aux sessions utilisées. Le choix porte sur des responsabilités, hors propriétaire et constructeurs temporaires.

| Choix | Effet | Pour | Contre | Coût | Risque |
| --- | --- | --- | --- | --- | --- |
| A · Cinq rôles | Réunir architecture et assurance. | Moins de mandats et de transitions administratives. | Charge et indépendance du rôle Cadre. | Préparation estimée sans mesure de charge : 3 à 5 journées, puis pilote de dix jours ouvrés. Élevé. | La conception peut absorber les contrôles. |
| B · Six rôles | Séparer Architecture, Moteur, Expérience, Plateforme et Assurance autour de Conduite. | Contrepoids architectural distinct ; responsabilités lisibles. | Charge du Moteur et exclusion des auto-revues d’Assurance. | Préparation estimée sans mesure de charge : 2 à 4 journées, puis pilote de dix jours ouvrés. Moyen. | Le Moteur peut devenir une file d’attente. |
| C · Sept rôles | Ajouter Agents aux six rôles. | Mémoire et boucle native gardent leur propre file. | Frontière de prise en charge entre Agents et Moteur. | Préparation estimée sans mesure de charge : 2 à 3 journées, puis pilote de dix jours ouvrés. Faible à moyen. | Les renvois entre équipes peuvent persister. |

Proposition : B · Six rôles séparent architecture et assurance tout en donnant des porteurs explicites à Focus, à la plateforme et aux outils natifs RTK et JEV.

### D2 · Le conducteur peut-il construire ?

Le mode actuel lui demande de faire intégrer et de déléguer. Le brief signale des exécutions manuelles répétées.

| Choix | Effet | Pour | Contre | Coût | Risque |
| --- | --- | --- | --- | --- | --- |
| A · Délégation systématique | Le conducteur nomme un exécutant, un remplaçant et une preuve attendue. | Préserve la capacité de pilotage. | Il faut un exécutant réellement disponible. | Faible : formaliser la reprise des lots. | Délai de mobilisation en urgence. |
| B · Exception d’urgence bornée | Autoriser une réalisation limitée par le conducteur, avec mandat et durée explicites. | Permet de traiter une urgence sans constructeur disponible. | Cette exception modifie la doctrine actuelle. | Moyen : mandat, relais de conduite et revue externe. | Les exceptions peuvent devenir la règle. |

Proposition : A · Maintenir une conduite centrée sur la délégation, la preuve et le déblocage.

### D3 · Faut-il élargir la politique des modèles ?

La politique publiée n’inclut ni Astra ni Fable 5.1. La demande actuelle les nomme, pour ce dossier seulement.

| Choix | Effet | Pour | Contre | Coût | Risque |
| --- | --- | --- | --- | --- | --- |
| A · Politique conservée | Sol conçoit, Terra construit ; deux modèles autorisés relisent indépendamment. | Aucune évolution de droits implicite. | Le catalogue devra suivre les changements réels de disponibilité. | Faible : clarifier les documents contradictoires. | Une politique vieillissante peut réduire les choix utiles. |
| B · Préparer une évolution séparée | Charger Assurance de qualifier Astra et Fable 5.1 avant une nouvelle politique. | Permet une évolution documentée du catalogue. | Ne leur confère aucun droit permanent immédiatement. | Moyen : qualification et nouvelle décision. | Travail supplémentaire avant bénéfice opérationnel. |

Proposition : A · Garder le catalogue exact pour le fonctionnement courant et tracer l’exception de ce dossier.

### D4 · Comment migrer les responsabilités ?

Les affectations écrites, les noms actifs et les états Track divergent. La transition doit conserver les sujets et leurs preuves.

| Choix | Effet | Pour | Contre | Coût | Risque |
| --- | --- | --- | --- | --- | --- |
| A · Pilote MCP et Focus | Valider les deux frontières les plus visibles avant généralisation. | Permet de corriger les mandats avant une bascule large. | Les anciens noms coexistent temporairement. | Préparation de l’option choisie, puis dix jours ouvrés. | Confusion si la table de correspondance n’est pas tenue. |
| B · Bascule coordonnée | Transférer toutes les files après satisfaction des mêmes prérequis. | Réduit la durée de coexistence des noms. | Tous les repreneurs doivent être disponibles ensemble. | Préparation plus concentrée ; reprise globale. | Un défaut de routage touche plusieurs sujets à la fois. |
| C · Reporter la bascule | Conserver les mandats actuels et compléter les avis manquants. | Évite d’activer une organisation insuffisamment examinée. | Les ambiguïtés actuelles restent à traiter. | Faible maintenant ; coût de coordination prolongé. | Les sujets orphelins peuvent persister. |

Proposition : A · Piloter MCP et Focus pendant dix jours ouvrés, puis transférer les autres files avec accusé de reprise.

## Annexe · Sources et glossaire

Les identifiants courts renvoient aux sources ci-dessous. Les chemins origin/main décrivent la révision figée en tête du dossier ; S22 est postérieure.

Les incidents rapportés par le brief restent signalés comme tels lorsque leur durée ou leur cause n’est pas indépendamment prouvée.

| Référence | Source | Chemin ou identifiant | Portée |
| --- | --- | --- | --- |
| S1 | RACI de référence | origin/main:docs/governance/RACI.md | § A, § B, contrepoids arch et limites. Ratification globale encore attendue. |
| S2 | Manifeste machine | origin/main:org.h2a.yaml | Douze acteurs et Fabien. Les liens de communication restent indicatifs. |
| S3 | Politique des modèles | origin/main:docs/governance/model-assignment.md | § A, § B, § C. Modèles autorisés, indépendance, lancement direct et preuve de compilation. |
| S4 | Mode de travail | origin/main:docs/governance/working-mode.md | Délégation, décisions, intégration, limites de charge et coopération entre dépôts. |
| S5 | Fusion déléguée | origin/main:docs/governance/merge-delegation-policy.md | Contrôles requis verts, deux relectures indépendantes, aucune modification visible par le propriétaire. |
| S6 | Livraison | origin/main:docs/governance/agent-release-policy.md | Version connue : augmentation dans la proposition de modification fonctionnelle. |
| S7 | Invariants de surface | origin/main:docs/governance/surface-invariants.md | Identité durable, preuve distinguée de déclaration, vue distincte du détenteur, capacités connues, résultat explicite. Accord entre équipes seulement. |
| S8 | Carte dérivée du RACI | 5d23e519232d29f834633bddc10a560722df5235 | Le test dérive les responsables des WP. Un WP possède exactement un responsable final. |
| S9 | Décision h-infra | 43002a7707fbec8c81e2d4c729fa18a7f167929e | WP6 et WP7 construits par h-infra. Architecture séparée. Audit cyber indépendant. Commit absent de origin/main. |
| S10 | Dossier entre projets | docs/specs/2026-08-18-INTER-PROJETS-RACI-DOSSIER.md | Fichier local non suivi. Quatre options ; les relations typées sont proposées, sans contrat déjà livré. |
| S11 | Étude entre projets | docs/specs/2026-08-18-SPEC_STUDY_interprojets-raci.md | Fichier local non suivi. Cinq cas : plusieurs clients, priorité, refus, arbitrage, autorité des échanges. |
| S12 | Track sur main | origin/main:.track/events.jsonl | 1 511 événements. Projection isolée avec le binaire existant, sans recompilation. Extraits joints. |
| S13 | Présence publiée | sessions-observees.json | Lecture du 19 septembre, 12:45 UTC. Aucune sollicitation des sessions. |
| S14 | Outils natifs sous --gw | 0cc1e59d · #275 | Version 0.97.2 : --bare devient explicite. Les sessions déjà lancées ne sont pas requalifiées par ce commit. |
| S15 | Réparations MCP | dd5be59f · #249 ; a46ebcd8 · #250 ; 0d6b2eaf | Des correctifs sont fusionnés. Le dernier commit local consigne aussi #253. Cela ne prouve pas chaque démarrage actuel. |
| S16 | Focus et système de design | 2e524d6f ; 01M2KJRBRDW820DTEDTB7Y30C5 | Le problème de dissociation entre skill et rendu est inscrit dans Track le 15 septembre. |
| S17 | Rapprochement des plans | 52652cd1:docs/decisions/2026-09-18-dossier-diagrammes/plan/plan-design-system.md | Branche docs/dossier-diagrammes. Le plan rapproche les lots du DS ; le consensus demandé reste distinct des relectures existantes. |
| S18 | Tests du manifeste | origin/main:packages/h2a/test/org-manifest-committed.test.js | Liste des douze acteurs figée. Carte des WP dérivée. Modifier seulement les deux documents ne suffira pas. |
| S19 | Format des dossiers | origin/main:docs/focus/decision-dossier-format.md | Présenter la substance et les revues réelles. Une présentation ne constitue pas une signature. |
| S20 | Forme Focus v4 locale | ../focus-render-kit/dossier.json ; ../dossier-mcp-demarrage/dossier.json | Forme observée des cartes v4. Aucun schéma générique v4 retrouvé dans origin/main. |
| S21 | Cluster mesh préparé | origin/feat/consume-cluster-mesh-0.10.0 · ec27026e | La branche prépare h2a 0.98.0. main reste sur 0.97.2 ; une branche ne prouve pas un déploiement. |
| S22 | Objectif stratégique RTK et JEV | origin/main:.track/events.jsonl · 01M2WV7C6CAM36VA3H0FTN5HTP | Événement du 19 septembre, présent à c0b9e863, postérieur à la référence figée. Verbatim owner : recoder RTK entièrement dans h2a ; apporter JEV par le plugin via le juge du llm-mesh. Accountable cond ; aucun porteur technique écrit. |

| Terme | Sens |
| --- | --- |
| Rôle durable | Responsabilité qui survit au remplacement d’une session. |
| Session | Processus de travail temporaire portant un mandat. |
| WP | Workpackage : ensemble durable de travaux liés. Son numéro ne remplace pas son identifiant Track. |
| RACI | Répartition des responsabilités : réalise, répond du résultat, consulté avant, informé après. |
| A / R / C / I | A : responsable final unique. R : exécutant. C : consultation obligatoire. I : information. |
| Owner / propriétaire | Fabien : arbitre les priorités, les droits et l’acceptation humaine. |
| PRINCIPAL / CONDUCTOR | Types du protocole pour le propriétaire et le conducteur. Les nouveaux noms métier ne les remplacent pas. |
| AGENTS / CONTROL | Types du protocole pour exécution et contrôle. Un nom de session ne confère aucun droit. |
| MCP | Model Context Protocol : liaison entre un assistant et ses outils. |
| CLI | Command Line Interface : interface en ligne de commande. |
| --gw / --bare | --gw active la passerelle. --bare retire des fonctions natives de Claude lorsqu’il est explicitement demandé. |
| Cluster mesh | Couche reliant des services et agents répartis entre plusieurs environnements. |
| Track | Journal et projection des travaux, décisions, dépendances et preuves. |
| Focus | Présentation des travaux et décisions au propriétaire. |
| DS | Design System : bibliothèques et règles visuelles communes. |
| Skill / plugin | Skill : consignes spécialisées. Plugin : ensemble installable de consignes et outils. |
| Build / release | Build : construction du logiciel. Release : version préparée puis éventuellement publiée. |
| PR / CI / UAT | PR : proposition de modification. CI : contrôles automatisés. UAT : recette utilisateur. |
| NHI | Non-Human Identity : identité technique d’un agent ou service. |
| CSP | Content Security Policy : règles du navigateur limitant scripts, styles et ressources. |
| JSON / YAML / HTML | Formats de données structurées, de configuration et de page web. |
| SHA / empreinte | Identifiant de contenu permettant de vérifier la révision examinée. |
| Accusé de reprise | Confirmation explicite du nouveau responsable, avec sa prochaine action et sa preuve attendue. |
| RTK | Outil qui compresse la sortie des commandes pour réduire les tokens consommés (rtk-ai/rtk). Objectif S22 : recodage complet dans h2a, pas un emballage. |
| JEV | Juge « System One » de TypeSafe AI. Objectif S22 : apporté nativement par le plugin h2a, via la capacité juge du llm-mesh, sans installation manuelle. |
| llm-mesh | Maillage de modèles de sentropic. Sa capacité juge garde la clé et la sortie réseau utilisées par JEV. |
| Session joignable | Session qui accuse réception en moins de dix minutes pendant les plages de travail. Sinon Conduite désigne un remplaçant dans Track. |
