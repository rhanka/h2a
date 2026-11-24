# Diagrammes de dossiers : analyse indépendante et programme proposé

18 octobre 2026 — Analyse uniquement. Aucun code produit, commit, exécution Python, écriture Track ou message inter-agent. Les tests RED ci-dessous sont des tests proposés, pas des tests exécutés. Texte de spécification proposé en anglais ; analyse en français.

**Recommandation : brancher maintenant le moteur du design system, étendre maintenant Focus aux preuves volumineuses, et réaliser dans le design system un programme complet de couverture des algorithmes ELK.** La remise en état du dossier CI/CD demande aussi des composants de comparaison et de navigation, ainsi qu'un modèle CI/CD exact. Le remplacement du placeur ne fournit pas ces deux derniers éléments.

Les choix suivants sont déjà décidés par le propriétaire et ne sont pas à remettre en consultation :

- Utiliser le moteur DS actuel ; planifier la réimplémentation de tous les algorithmes ELK.
- Mettre l'optimisation géométrique dans le moteur ; ne pas demander au skill de déplacer les flèches.
- Étendre focus build immédiatement pour les annexes et sources.
- Présenter les parcours et l'avant/après dans un même diagramme principal, avec heat map DS, groupes développables et plan cliquable.
- Refaire le plan CI/CD à partir du retour du 18/10. PR #696 « Lot 1 » est fermée, sa branche supprimée ; ce lot ne constitue ni un acquis ni un travail en cours.

## Base de preuve et limites du constat

Lectures de référence effectuées avant de juger :

| Repère | Source examinée | Portée |
| --- | --- | --- |
| H | h2a origin/main, **46b82b42781709f2a2ab1bec6707ba58131248f0** | packages/focus, packages/h2a/focus-kit, focus-build.ts, documentation du dossier portable. |
| D | sent-tech-design-system origin/main, **25c0f3d33c258fc2b906a4b85219ffce5f67eccc** | diagram-core, moteur diagram-canvas #178/#179, spécification L-R1..L-R11, catalogue graph/dataviz, HeatmapChart et primitives d'interaction. |
| B | h2a docs/dossier-diagrammes, **f76f46df93eedcc55554d5aaab5a1b77281d9417** | plan-design-system.md r4/r4.1, conception-profil-placement-frame-v3.md, suivi de transition ; sous docs/decisions/2026-09-18-dossier-diagrammes/plan/. |
| P | Les deux analyses antérieures diagskill/analysis-wonder.md et diagskill/analysis-astra.md | Lues intégralement. Leurs propositions sont confrontées aux demandes plus récentes, sans consulter l'analyse parallèle du présent exercice. |
| O | sentropic/.tmp/focus-ci-efficiency-kit/owner-feedback-v3/OWNER-FEEDBACK-V3.md | **Lu intégralement**, ajout tardif compris. Captures 8.png, 11.png et 13.png examinées visuellement. |
| C | Dossier portable et sources du kit CI/CD | Observation complémentaire, non assimilée à un commit stable ni à la version exacte de chaque capture. |

Les chemins des deux dépôts sont /home/antoinefa/src/h2a et /home/antoinefa/src/sent-tech-design-system. Les chemins relatifs cités ci-dessous désignent **les références Git ci-dessus**, pas nécessairement les fichiers du checkout courant. Les arbres de travail ont des travaux en cours ; aucun checkout, nettoyage ou fetch n'a été réalisé.

Empreinte du portable au moment de la lecture : **d5be245c8d028a78e5a35fad836aede6e143711840c4ac61d617063b119baa04**, fichier /home/antoinefa/src/sentropic/.tmp/focus-ci-efficiency-kit/dist/ci-cd-sentropic-portable.html. Les sources du consommateur évoluent pendant l'analyse : cette empreinte ne prouve pas que le portable correspond aux captures du retour propriétaire.

**Constats essentiels.** H rend encore les scènes avec interim-nodes.js et les smoothstep de SvelteFlow, minZoom 0,15. Il n'appelle pas le moteur L-R1..L-R11. D contient un vrai placeur déterministe, mais diagram-canvas est encore private:true et sans renderer/framework. Le placeur peut retourner une scène avec avertissements de routage ou de labels ; « moteur fusionné » ne signifie donc ni « connecté à Focus », ni « tous les dessins sont sûrs ». Dans le kit CI/CD observé, ArchitectureCanvas utilise aussi SvelteFlow, avec un minZoom de 0,0001 et un composant recréé par changement de scene ; cela permet un aperçu illisible et peut perdre le repère spatial.

Le plan r4 avait déjà corrigé une erreur de cadrage : optimiser la lisibilité, pas seulement réduire l'aire du graphe. Le programme DS possède déjà un inventaire ELK, et HeatmapChart existe déjà. Il faut compléter ces capitaux, pas créer une troisième étude concurrente.

## A. Inventaire ELK, couverture existante et réimplémentation indépendante

### A1. Ce que veut dire « tous les algorithmes »

Le catalogue D **docs/graph-dataviz-reference-catalog.md**, avec son JSON homonyme, recense déjà **21 entrées algorithmiques ELK, 60 groupes d'options et 286 entrées d'options / 279 identifiants distincts** au 15/09. Chaque entrée est traçable ; les capacités restent planifiées sous la clé de rapprochement **GD-M5-PROCESSING**. Ce n'est pas un inventaire à recommencer ni une preuve d'implémentation.

Trois niveaux doivent rester distincts :

1. **Algorithmes de placement** : layered, force, stress, arbres, radial, packing, etc.
2. **Phases, stratégies et traitements intermédiaires** : cycle breaking, variantes de ranking, ports, labels, compaction, hiérarchie, routage, incrémental, etc. Une case « layered livré » ne couvre pas toutes ces variantes.
3. **Fournisseurs/adaptateurs** : les cinq entrées Graphviz, Draw2D et libavoid ne sont pas sept algorithmes propriétaires d'ELK. Leur fonction observable doit entrer dans la couverture ; leurs runtimes et interfaces Eclipse ne doivent pas être copiés par défaut.

Le catalogue distingue déjà ELK Java d'elkjs : tous les 21 fournisseurs ne sont pas présents dans le bundle JavaScript. « Réimplémenter elkjs layered » n'accomplirait pas la demande « tous les algorithmes ELK ».

Le snapshot documentaire du catalogue n'est pas certifié identique au tag v0.12.0. Les pages officielles consultées aujourd'hui peuvent aussi avoir évolué. Premier livrable du programme : figer cette matrice puis enregistrer les différences, avec version/document/empreinte. Ne pas transformer le nombre 21 en plafond permanent, ni assimiler les dix moteurs Graphviz du catalogue général aux cinq exposés dans l'inventaire ELK.

### A2. Les 21 entrées et leurs familles scientifiques

Dans le tableau, les identifiants courts sont préfixés par org.eclipse.elk., sauf les fournisseurs explicités. Les références [R…] sont détaillées en fin de document. « Partiel » signifie parenté de capacité, pas conformité à ELK.

| Entrée ELK | Fonction et source publiée | Capital DS constaté | Écart et place dans le programme |
| --- | --- | --- | --- |
| layered | Dessin dirigé en couches, famille Sugiyama [R1–R12]. | Moteur L-R1..L-R11 : cycles, rangs, barycentres, placement contraint, routage orthogonal, ports, labels, nesting. | **Priorité dossier**. Compléter les stratégies, les ports/labels complexes, les hubs, le routage global et l'incrémental ; détail A3. |
| force | Ressorts/répulsion, notamment Eades et Fruchterman–Reingold [R13]. | ForceGraph et autres solveurs DS apparentés ; le catalogue M0 documente notamment des primitives force/Barnes–Hut. | Qualifier les modèles de force, tailles, contraintes, graine, arrêt, composantes ; une simulation DS n'est pas une équivalence démontrée. |
| stress | Optimisation des distances, stress majorization [R14]. | Pas de conformité stress établie dans le moteur dossier. | Solveur autonome, composantes déconnectées, positions contraintes, convergence et post-traitement des collisions. |
| mrtree | Arbres généraux ; fondation Walker [R15]. | Primitives hiérarchiques apparentées dans packages/graph. | Tidy tree tenant compte des dimensions, extraction documentée d'arbre si entrée non arborescente, orientation et routing. Ne jamais faire disparaître les liens hors arbre. |
| radial | Arbres/structures radiales ; Eades, Drawing Free Trees [R16]. | layout-radial et primitives de hiérarchie. | Racines, secteurs, allocation angulaire selon taille/sous-arbre, recouvrements et labels ; couverture à qualifier. |
| box | Empaquetage simple de composantes/rectangles sans exploiter leurs liens. Fondations packing ; les détails sont documentés par ELK, pas par un article unique identifié. | Grille/shelf et packing simple apparentés. | Ordre, ratio cible, taille, padding ; ne pas le déclarer équivalent à Rectangle Packing. |
| rectpacking | Packing préservant l'ordre et évitant les trous, Domrös et al. [R17]. | Shelf/scene layout partiels. | Réimplémenter l'objectif et les variantes publiées, avec contraintes de taille et ordre. |
| disco | Disposition de composantes connectées, avec formes/polyominos, Cyruk [R18]. | Primitives de composantes et packing, sans conformité DisCo. | Garder la géométrie interne, combiner rotations autorisées et contours des composantes, mesurer espace et temps. |
| fixed | Conservation de positions imposées ; utilitaire, pas un nouveau résultat scientifique. | Les ViewDocument peuvent porter des positions. | Contrat exact de non-déplacement, validation, routes et labels restant à traiter. |
| random | Placement pseudo-aléatoire de référence. | Aucune parité qualifiée. | Graine/version reproductibles, domaine borné ; benchmark/utilitaire, jamais placeur automatique par défaut d'un dossier. |
| sporeOverlap | Suppression des recouvrements par croissance d'un arbre, Nachmanson et al. [R19]. | Séparation de nœuds dans le placement par rang ; pas solveur général équivalent. | Delaunay/arbre couvrant/croissance, tailles rectangulaires, dégénérescences ; rerouter après déplacement. |
| sporeCompaction | Réduction d'espace, variante ShrinkTree documentée par ELK [R19, R28]. | Fill de rangs et compactions locales partielles. | Définir et prouver les contraintes du compacteur. **Article propre à cette variante non établi** : ne pas inventer une citation ni prétendre une reproduction exacte. |
| topdownpacking | Composition descendante de graphes imbriqués ; Kasperowski/von Hanxleden [R20]. | L-R6 compose actuellement de l'intérieur vers l'extérieur. | Placer avec des enveloppes hiérarchiques déterminées depuis le haut ; couplage au zoom sémantique. Le papier ne livre pas l'UI. |
| vertiflex | Arbres avec positions verticales prescrites [R28]. | Pas de conformité identifiée. | Spécifier les contraintes de niveaux/positions et cas incompatibles. **Publication spécifique non retrouvée** ; lot de recherche borné, entrée maintenue dans le programme. |
| conn.gmf.layouter.Draw2D | Fournisseur de layout Draw2D ; famille de dessins dirigés. | Un moteur dirigé existe, pas le fournisseur GMF. | Couvrir la capacité graphique avec un solveur indépendant ; inventorier les particularités documentées. Aucune nécessité produit démontrée pour réimplémenter l'infrastructure Eclipse. |
| graphviz.dot | Hiérarchique dirigé ; Gansner et al. [R3]. | Partiel, via L-R1..L-R11. | Partager les implémentations NS/ordering/routing avec layered, garder une ligne de qualification dot distincte. |
| graphviz.neato | Stress majorization et variante Kamada–Kawai [R14]. | Pas de conformité qualifiée. | Partager les briques stress mais couvrir les modes/contraintes propres ; ne pas le réduire à FR. |
| graphviz.fdp | Forces, famille Fruchterman–Reingold [R13, R28]. | Solveurs force apparentés. | Décomposer les comportements, tailles et composantes ; pas d'équivalence sur le seul nom « force ». |
| graphviz.circo | Layout circulaire, blocs biconnectés ; Six/Tollis 1999, références publiées par Graphviz [R21]. | Radial apparenté uniquement. | Circularisation et décomposition par blocs distinctes du radial. |
| graphviz.twopi | Distances à une racine, cercles concentriques ; Wills/NicheWorks [R21]. | Radial apparenté. | Racine, niveaux BFS, secteurs, composantes, séparation. La documentation mentionne Wills 1997 et référence la publication de 1999 : conserver cette distinction. |
| alg.libavoid | Routage orthogonal/polyline autour d'obstacles ; Wybrow/Marriott/Stuckey [R9]. | Routeur A* orthogonal sur grille de visibilité partielle apparenté. | Router indépendant, nudging des voies partagées, checkpoints, contraintes de ports, mise à jour incrémentale. **libavoid a sa propre licence**, pas celle d'ELK. |

Les algorithmes triviaux (fixed/random/box) n'ont pas besoin d'une fausse référence académique. Les entrées sans publication précise sont des **écarts documentaires explicites** à résoudre avant d'en revendiquer la parité, pas un motif pour les effacer.

### A3. Décomposition de layered : ce qui est réellement couvert

La littérature décrit une chaîne de phases et de traitements associés. ELK n'est pas simplement un barycentre suivi d'un routeur. Inversement, l'existence d'une option ELK n'est pas une garantie de lisibilité de tout graphe.

| Phase/capacité | Références et stratégies à couvrir | D #178/#179 : observation | Écart concret |
| --- | --- | --- | --- |
| Préparation et composantes | Décomposition, tailles, normalisation des ports, classification des liens, composantes ; Sugiyama/ELK [R1, R27]. | Validation generic@1 et construction d'un LayoutGraph ; composition de niveaux imbriqués. | Capability matrix de tous les cas : ports, hyperedges, liens inter-niveaux, disconnected graphs, self-loops, labels source/centre/cible. |
| Cycle breaking | Heuristique greedy de feedback arc set d'Eades/Lin/Smyth [R2], DFS, SCC, ordre de modèle, contraintes interactives. | rank.ts construit un ordre déterministe par identifiants et retourne les liens nécessaires pour classer sans cycle. | Pas un feedback arc set pondéré ni les stratégies SCC/modèle d'ELK. Ne pas renverser la sémantique : seule la vue de ranking peut inverser temporairement un lien. |
| Layer assignment | Longest path ; **network simplex pour les rangs** [R3] ; Coffman–Graham [R4] ; minimum width, promotion, stretch [R5]. | Plus long chemin, tri topologique de Kahn ; dummies sur les liens longs. | Optimisation largeur/hauteur, longueur pondérée, minlen, contraintes de rangs, promotion et variantes interactives. Coffman–Graham n'est pas une preuve de largeur optimale pour nos cartes variables. |
| Crossing minimization | Sweeps barycentre/médiane, transpositions/greedy switching, contraintes de groupes/ports [R1, R6] ; comptage efficace [R7]. | 24 balayages alternés par barycentres ; retient le meilleur comptage des segments abstraits entre rangs adjacents. | Contraintes de ports/groupes, médiane, recherche locale, hiérarchie, optimisation du coût de comptage ; **auditer aussi les croisements des routes finales**. Le comptage de rank.ts n'est pas ce dernier audit. |
| Node placement | Brandes–Köpf [R8], avec **erratum 2020 obligatoire** ; network simplex sur graphe auxiliaire [R3] ; linear segments [R10] ; variantes tailles/ports [R11]. | place.ts rapproche les voisins sous séparation minimale par régression isotone/PAVA, dans des passes déterministes. Il remplit/aligne les rangées de conteneurs. | Ni BK ni NS. Réutiliser le PAVA existant comme candidat, puis comparer les objectifs ; pas de remplacement aveugle de tout le moteur. Distinguer NS de placement et NS d'affectation des rangs. |
| Routage orthogonal | Manhattan en couches [R10], routage d'obstacles/visibility graph [R9], distribution des couloirs, coûts longueur/coudes/croisements. | A* avec état de direction ; rectangles augmentés ; coût lexicographique coudes puis longueur pondérée ; encombrement existant pénalisé ; orientation LR/TB. | Route globale, réservation de canaux, reroutage, nudging, fan-in organisé. Le fallback elbow peut traverser un obstacle et reste retourné avec route-obstructed. Il ne satisfait donc pas une garantie de sortie sûre. |
| Polyline et spline | Polyline, canaux libres, courbes de Bézier/B-splines et contrôle de collision [R3, R12]. | Orthogonal seulement. Les smoothstep actuels de Focus sont ceux du renderer, pas une implémentation de cette phase DS. | Ajouter des routages qualifiés distincts ; tenir compte des courbes dans la géométrie peinte. Lisser des waypoints ne prouve pas l'absence d'obstacles. |
| Port constraints | FREE, FIXED_SIDE, FIXED_ORDER, FIXED_RATIO, FIXED_POS ; ports hiérarchiques [R11]. | L-R1 choisit un côté selon la géométrie ; extrémité seule au milieu ; L-R2 distribue symétriquement et agrandit si nécessaire ; traitement des ports et liens parallèles. | Contrats de contraintes explicites, ordre optimisé avec crossing minimization, ports de conteneurs et repli. « Tous les liens au même point central » n'est pas une solution générale. |
| Compound graphs | Layout récursif, ports de bord, liens inter-hiérarchies, order constraints [R11, R20]. | Enfants placés avant parents ; liens entre descendants remontés pour ordonner les conteneurs ; obstacles des tiers respectés sauf fallback. | Optimisation croisée des niveaux, alternance top-down/bottom-up, projection d'un groupe replié, agrégats et stabilité pendant expansion. |
| Node/port/edge labels | Labels réservés avant layout, label dummies, contraintes de source/centre/cible ; Schulze et al. [R22]. | Mesure injectée ; label d'arête sur segment assez long ; évite cartes, titres et autres labels ; élargissement limité, diagnostics d'échec. | Labels de ports et extrémités, réservation globale, éviter aussi les **autres routes** et marqueurs ; pas de disparition silencieuse d'un label. Le budget épuisé n'est pas une preuve d'impossibilité. |
| Hubs, hyperedges, bundles | Routage concentré et dégroupage ; Rüegg et al. [R23]. | L-R9 sépare les liens d'une même paire ; pas un traitement générique du fan-in vers ci-gate. | Construire corridors et jonctions visuelles traçables ; éventuellement exposer un vrai join sémantique fourni par le consommateur. L'option ELK highDegreeNodes seule ne livre pas toute cette fonction. |
| Compaction, wrapping, forme | Prescribed drawing areas, compaction 1D, wrapping [R24] ; packing A2. | Deux candidats LR/TB ; fill de rangées ; préférence LR s'il tient, sinon TB s'il tient, sinon largeur. | Portfolio avec score de qualité, ratio/hauteur, vraie compaction contrainte ; overview replié si pleine scène illisible. Le plan frame est un capital de composition, pas un nouveau profil métier. |
| Incrémental et stabilité | Layout incrémental et ordre explicite [R25]. | Déterminisme sur une même entrée ; positions de vue possibles. | Conserver identité, caméra et ordre lors d'avant/après/étape ; position précédente comme contrainte souple. Déterminisme sur entrée identique ≠ stabilité entre deux graphes. |

Les variantes exposées dans les pages ELK lues doivent devenir des lignes de couverture, pas des options sans implémentation : cycle breaking greedy/DFS/SCC/model-order ; rangs LONGEST_PATH et LONGEST_PATH_SOURCE, NETWORK_SIMPLEX, COFFMAN_GRAHAM, STRETCH_WIDTH, MIN_WIDTH, INTERACTIVE, ordres BFS/DFS ; crossing LAYER_SWEEP, MEDIAN_LAYER_SWEEP, INTERACTIVE, NONE ; placement SIMPLE, INTERACTIVE, LINEAR_SEGMENTS, BRANDES_KOEPF, NETWORK_SIMPLEX. Les variantes supplémentaires du snapshot retenu doivent être intégrées lors du gel documentaire.

Les processeurs auxiliaires sont aussi à inventorier : composants déconnectés, boucles, liens longs et inversés, multiplicité, ports/labels, partitionnement, direction, wrapping, compaction. Les options de debug, progression et sérialisation ne sont pas des algorithmes de dessin, mais leur traitement doit être explicite dans la compatibilité.

### A4. Programme clean-room et licences

La demande actuelle rejoint le mandat déjà inscrit dans le catalogue DS : implémentations autonomes, sans copie de code tiers et sans ajout automatique de runtime ELK/Graphviz/libavoid.

Plan concret :

1. **Registre de couverture** : reprendre le JSON existant ; relier chaque entrée et stratégie à une spécification comportementale, un article/document public, un propriétaire, des fixtures originales, des limites et une preuve de qualification.
2. **Dossier algorithmique indépendant** : expliquer les variables, objectifs, contraintes, pseudo-code rédigé depuis les publications, complexité, arrêts et tie-breaks. Identifier les détails non publiés ; les décider et les documenter, sans prétendre reproduire un secret d'implémentation.
3. **Séparation de provenance** : aucune lecture/transcription du Java ELK ou JavaScript généré dans les tâches d'implémentation clean-room ; ne pas donner ces fichiers à une IA pour « traduire en TypeScript ». Relecteur de provenance distinct, journal des sources utilisées. Renommer une traduction ne la rend pas indépendante.
4. **Implémentation mutualisée dans DS** : rankers, ordonnancement, placement, routeurs, labels et packing partagés ; les 21 lignes ne justifient pas 21 bases de code séparées.
5. **Qualification** : fixtures créées pour nos invariants, cas dégénérés, performance, déterminisme, qualité finale et interaction. Des sorties de référence obtenues ultérieurement avec un ELK correctement licencié peuvent servir de comparaison boîte noire ; elles ne sont ni le code à copier ni une obligation d'égalité bit à bit.
6. **Livraison progressive** : les capacités qualifiées rejoignent le moteur actuel ; le programme reste ouvert jusqu'à couverture déclarée de toutes les lignes. Ne pas bloquer le dossier sur les familles sans utilité immédiate, ni annoncer « ELK réimplémenté » après le seul layered.

ELK est sous EPL-2.0. Cette licence permet l'usage commercial ; elle n'impose pas automatiquement sa licence à tout un dépôt. La distribution de code couvert/modifié entraîne des obligations sur ce code, sa source et ses notices [L1]. Une copie, traduction ou compilation n'est pas une réimplémentation indépendante. Le plan r4.1 relève pour elkjs 0.12.0 une expression EPL-2.0 OR GPL-3.0-or-later : choisir explicitement la branche applicable, vérifier l'artefact exact et ne pas conclure à une obligation GPL automatique. La bibliothèque libavoid est distinctement sous LGPL ; les fournisseurs Graphviz/Draw2D ont leurs propres composants/licences à inventorier.

Les algorithmes mathématiques publiés peuvent servir de fondement à un code original ; le texte, les figures, le code accompagnant un article et ses jeux de tests gardent leurs droits. Le clean-room ne constitue ni une analyse de brevets ni une garantie juridique absolue. Pour ce programme, conserver les droits et notices de chaque dépendance réelle et qualifier la provenance du code avant publication MIT.

**Proposed specification — coverage and provenance**

> The design-system layout engine shall remain the production layout authority for dossier diagrams. The ELK capability program shall cover every algorithm entry and documented algorithmic strategy in a pinned reference inventory, including provider-backed entries. Coverage shall state implemented behavior, constraints, source publications, test evidence and limitations. Provider coverage shall not imply binary, plugin or byte-for-byte compatibility.
>
> Implementations shall be independently authored from published algorithms and original behavioral specifications. ELK source code, generated code, comments and test fixtures shall not be copied, translated or used as implementation templates. Unsupported capabilities shall be reported explicitly; they shall not silently fall back to an unrelated algorithm.

## B. Qualité géométrique : mesures, politique et prévention

### B1. Ce que les captures permettent de conclure

Dans la capture 8, de nombreuses arêtes arrivent à ci-gate dans une bande étroite ; certaines passent devant du contenu de cartes et les éléments à gauche sont coupés. Dans 11, la juxtaposition de graphes minuscules ne permet pas de lire les dépendances ni le parallélisme. Dans 13, les liens et éléments estompés ajoutent une forte charge visuelle au parcours sélectionné ; cela ne répond pas à la demande d'une comparaison lisible au même endroit.

Cela fournit des cas de non-régression **visuelle et fonctionnelle**. Une capture isolée ne prouve cependant ni le nombre exact de dépendances métier, ni les coordonnées sémantiques, ni si le cadre coupé résulte de l'état initial ou d'un pan manuel. Les fixtures doivent être dérivées du graphe source et associées à l'état d'interaction reproduit.

Les travaux de Purchase et Huang [R26] soutiennent l'importance des croisements et de leur angle pour des tâches de lecture. Ils ne fournissent pas une valeur magique « trois croisements autorisés », un score global universel ou une police minimale universelle. Les seuils numériques ci-dessous sont donc soit des invariants géométriques, soit des paramètres de produit à qualifier, clairement distincts.

### B2. Métriques sur la géométrie finale

La scène auditée doit inclure rectangles des cartes et titres, labels, chemins complets, épaisseur des traits, pointes de flèche, ports et transformée de caméra. Pour les splines, utiliser une intersection de courbe ou une approximation à erreur bornée ; ne tester que le polygone de contrôle serait insuffisant. Mesurer en coordonnées monde pour les collisions, puis en pixels CSS pour la perception.

| Dimension | Mesure proposée | Politique proposée | Prévention et capital |
| --- | --- | --- | --- |
| Conservation sémantique | Références visibles, projetées dans un agrégat, ou explicitement exclues ; conservation du sens et de la multiplicité des relations. | Zéro relation perdue sans projection/explication. Une géométrie jolie ne justifie pas de supprimer des dépendances. | Validation diagram-core ; projection de vue traçable avant layout. |
| Nœud–nœud | Nombre et aire des intersections entre rectangles peints ; séparation minimale. | Zéro chevauchement involontaire. L'inclusion déclarée parent/enfant est une exception structurelle, pas une collision. | Taille calculée avant placement, PAVA/séparation existants ; BK/NS contraints ; overlap removal seulement avec reroutage ensuite. |
| Arête–nœud | Nombre de pénétrations et longueur de chemin dans l'intérieur d'une carte tierce augmentée de la marge. | Zéro ; extrémité propre et passages autorisés de frontière d'ancêtre exclus de façon explicite. Jamais d'exception pour traverser le titre d'un conteneur. | Obstacle routing, couloirs réservés, ajout d'espace/replacement si échec. L-R8 existe, mais route-obstructed doit déclencher reprise/refus de présentation. |
| Labels | Intersections label–label, label–carte, label–titre, label–route étrangère et label–marqueur ; label non placé ; troncature. | Zéro masquage involontaire et zéro label requis perdu. Un label sur **sa propre arête** est admissible avec masque contrôlé, comme dans r4 ; pas une collision à refuser systématiquement. | Réserver les labels au ranking/placement, dummies si utile, candidats de segments, reflow, reroutage autour des labels. L-R10 est une base ; son audit des routes étrangères manque. |
| Croisements | Nombre d'intersections transversales entre arêtes indépendantes, dédupliquées ; angle minimal ; densité locale ; ratio sur les paires éligibles. | Objectif de minimisation, pas hard gate « zéro » sur tous graphes. Zéro exigible sur les fixtures simples où une solution sans croisement est connue ; régression documentée sur le corpus difficile. | Sweeps contraints, médiane/barycentre, transpositions, choix de ports, routing global. Les endpoints communs et jonctions déclarées ne comptent pas comme croisements indépendants. |
| Arêtes superposées | Longueur commune non déclarée, points de jonction ambigus, voies indiscernables au zoom accepté. | Zéro superposition ambiguë hors bundle explicitement représenté. Ne pas réduire le score de croisements en empilant toutes les arêtes. | Nudging, espacement des voies, tronc commun avec identité de bundle et sorties distinctes ; L-R9 couvre seulement un sous-cas. |
| Coudes et détours | Coudes non colinéaires par arête, maximum/p95 ; longueur réelle / borne directe ; retours contre le flux. | Coût souple après sécurité/lisibilité ; pas de plafond arbitraire « deux coudes ». Un détour sûr est préférable à une traversée de carte. | Node placement, straightening BK/NS, routeur multicritère, suppression des points colinéaires, compaction préservant les canaux. |
| Ports et centrage | Extrémité sur le bord prévu ; écart du port unique au milieu du côté ; écart du centroïde des slots multiples au milieu ; ordre et séparations. | Port unique centré si compatible ; slots multiples centrés collectivement et séparés ; contraintes explicites prioritaires et diagnostic si incompatibilité. | Optimiseur dock.ts et ordonnancement ; l'auteur ne dessine pas les coordonnées. Le centre visé est celui du **côté d'attache**, pas l'intérieur de la carte. |
| Fan-in/fan-out | Degré, nombre de voies par couloir, espacement minimal en pixels CSS, concentration de croisements/labels près du hub, traçabilité des branches. | Déclenchement d'un traitement de hub, pas refus sur un degré universel. Un hub de 30 liens doit rester explorable sans fausse dépendance. | Regroupement sémantique disponible, ports/voies, bundles ou hiérarchie ; détails B3. |
| Clipping | Enveloppe peinte après transformée moins viewport intérieur réel ; labels/markers/ports coupés ; accès aux bornes en pan. | Zéro clipping involontaire à l'ouverture du mode overview et après « ajuster à la vue ». En zoom de détail, le hors-champ volontaire est normal, mais tout élément reste atteignable. | Bornes avec xmin/ymin négatifs, dimensions mesurées après fonts, fit incluant strokes/markers, marge intérieure et ResizeObserver. L-R7 fournit une partie de ce contrat. |
| Lisibilité | Plus petite police effectivement affichée = taille source × zoom, visibilité des titres, contrastes et différenciation hors couleur. | Plancher DS versionné par rôle/mode ; ne pas utiliser un minZoom comme substitut au plancher de police. | Repli d'un niveau de détail, labels courts fidèles plus détails accessibles, zoom local ; éviter de miniaturiser toute la scène. |
| Stabilité | Déplacement des références communes, inversions d'ordre, changement de caméra et de sélection lors d'une transition. | Highlight seul : zéro déplacement. Comparaison : stabilité maximale sous contraintes de lisibilité ; transitions explicables. | Layout d'union borné ou incrémental avec positions de référence ; état contrôlé, IDs stables. |

L-R2 utilise actuellement un slotSpacing de 12 unités, edgeClearance 8 et edgeLabelMargin 4 ; ces valeurs monde sont du capital d'implémentation, pas une validation perceptuelle. Le zoom minimal DS de 0,75 donne par exemple 9 pixels CSS à une police source de 12 : le fait de respecter 0,75 ne démontre pas sa lisibilité.

Les calculs géométriques ont besoin d'une tolérance numérique documentée, relative à leur échelle. La tolérance raster, par exemple de l'ordre d'un demi-pixel CSS pour un bord anticrénelé, relève d'un autre test. Aucune de ces tolérances ne doit masquer plusieurs pixels de texte coupé.

### B3. Traitement préventif de ci-gate

**Le défaut ne se résout ni en centrant 30 flèches au même point, ni en agrandissant indéfiniment ci-gate.** Avec 30 slots et une exigence de type (n + 1) × 12, un côté atteint déjà 372 unités avant même les besoins des labels. Une telle solution peut être sans collision locale et mauvaise dans le cadre.

Chaîne proposée :

1. Le consommateur fournit les vraies dépendances, les familles de jobs et la signification du gate. Le moteur n'invente pas que toutes les branches sont alternatives ou qu'une seule suffit.
2. L'ordonnancement rapproche les branches apparentées, réserve un couloir avant le hub et ordonne les slots selon les sources pour réduire les inversions.
3. Les branches indépendantes gardent des attaches distinctes, distribuées symétriquement. Une éventuelle entrée de bundle est centrée ; son agrégat garde la liste exacte des relations représentées.
4. Si un groupe de tests est replié, la vue représente les relations de frontière par des arêtes agrégées traçables et un compteur intelligible. Le bouton + rétablit branches et labels avec les mêmes références.
5. Un clic de parcours met en évidence les branches concernées et, au besoin, déploie leur détail. Le fond reste lisible et les liens inutiles au parcours ne forment pas une masse opaque.
6. Le moteur peut reprendre ranking/ports/routing, puis changer le niveau de détail. Il ne réussit pas en supprimant les entrées de ci-gate.

**Bundle visuel, hyperedge et join métier sont trois concepts différents.** Le bundle change une représentation ; un join peut exprimer « toutes ces validations doivent réussir » ; un hyperedge a sa propre sémantique. Le poster [R23] étudie un cas de flux de données, pas une autorisation générale de les confondre. Toute réduction transitive doit également être explicitement qualifiée : pour une CI, un lien direct peut porter un contrat important même si une autre chaîne relie les mêmes jobs.

ELK documente un traitement highDegreeNodes, avec seuil par défaut 16, et des options de fusion d'arêtes. Ce seuil est un réglage de son algorithme, **pas une limite humaine prouvée**, et ce traitement aménage notamment des voisins/arborescences : il ne remplace pas tout le contrat de bundle, de provenance et de clic décrit ici.

### B4. Optimiser puis diagnostiquer, avec des limites honnêtes

Le moteur devrait produire plusieurs candidats déterministes : variantes LR/TB, rangs longest-path/NS/width-aware, barycentre/médiane et amélioration locale, placement PAVA/BK/NS, puis routing/labels. Il évalue la géométrie peinte de chaque candidat, reprend les phases impliquées et conserve le meilleur candidat **admissible**.

La sélection actuelle « LR tient en largeur, donc LR » n'est pas cette optimisation. La politique proposée est d'abord de satisfaire les invariants sémantiques et géométriques ; ensuite de respecter la lisibilité et la stabilité requises par le mode ; enfin de comparer croisements, détours/coudes et usage du cadre. Un score pondéré ne doit jamais compenser une collision avec un bon taux de remplissage. Les compromis entre objectifs souples se calibrent sur le corpus, avec résultats par critère.

Réutiliser **tools/elk-corpus-measure/README.md**, measure.mjs et evidence/ dans D : cet outil distingue gaspillage de placement et impossibilité par borne d'aire, sur un cadre de référence 1440 × 900. Une borne utile est s_max ≤ sqrt(A_frame / A_cards), en ignorant couloirs et ratio. Pour une hiérarchie, A_cards doit éviter de compter deux fois parents et enfants ; il faut utiliser les surfaces disjointes pertinentes. Une borne supérieure sous le zoom requis prouve qu'une pleine vue à ce niveau de détail ne peut pas tenir. Une borne supérieure suffisante ne prouve pas qu'une solution existe.

Le plan B r4 mentionne 11 pixels CSS et 7 points A4 comme seuils de travail ; ce ne sont pas des constantes de la littérature. Le README de mesure qualifie le cadre 1440 × 900 de ratifié. Garder ce cadre comme baseline, qualifier le viewport intérieur réel, et finaliser séparément les minima typographiques et le comportement petit écran. Ne pas perdre les conclusions r4 en revenant au simple taux d'occupation.

Diagnostics distincts proposés :

- violation précise, avec références et coordonnées : collision, ambiguïté, label absent, clipping ;
- budget de recherche épuisé : aucun candidat admissible trouvé, sans preuve d'impossibilité ;
- contraintes contradictoires ou borne d'impossibilité démontrée ;
- vue de détail requise : projection overview proposée sans perte de contenu ;
- capacité non supportée, avec identifiant et besoin de migration.

Un budget de calcul doit être déterministe autant que possible, avec limite d'itérations/travail, et accompagné d'une garde temporelle opérationnelle. Le résultat doit inclure version d'algorithme, métriques, paramètres, dimensions, mesures de texte et état de projection pour être reproductible. La calibration de performance demande des mesures ; elle n'a pas été exécutée ici.

**Proposed specification — geometry and presentation**

> Layout shall optimize before refusing presentation. No successful presentation result may contain an unresolved node overlap, an edge passing through an unrelated node, an obscured required label, an ambiguous undeclared shared route, or involuntary initial viewport clipping.
>
> Crossing minimization shall be evaluated both during ordering and on final routed geometry. Shared endpoints and declared bundle junctions shall be classified separately. A crossing-free result shall not be promised for every input graph.
>
> A single unconstrained attachment shall use the midpoint of its selected node side whenever feasible. Multiple independent attachments shall use an ordered, separated slot arrangement centered on that side. Attachment geometry shall be owned by the layout optimizer.
>
> The engine shall distinguish search exhaustion from proven infeasibility. It shall report the violated constraints and attempted remedies. A warning-bearing fallback shall not be presented as a geometrically qualified dossier.
>
> Presentation acceptance shall evaluate the complete painted scene and the effective inner viewport. Explicit user pan or detail zoom may crop the overview; reset-to-fit shall restore a qualified overview or an explicit, lossless collapsed projection.

## C. Types de diagramme et composants d'interaction

### C1. Répartition des responsabilités

Le « diagramme des usecases » demandé ici est une **carte des parcours d'exécution dans le graphe de dépendances CI/CD**. Il n'y a pas de demande d'un diagramme UML à acteurs et ellipses. Appeler les scénarios des usecases ne justifie pas un nouveau profil UML.

| Besoin propriétaire | Type et données | Diagram-core / moteur DS | Composant DS | Focus kit / consommateur |
| --- | --- | --- | --- | --- |
| Heat map conforme DS | Matrice numérique, par exemple jobs/étapes × scénarios ou états, avec secondes, statut et provenance. | Pas un nouveau profil de graphe. Le modèle dataviz existant porte les cellules ; références croisées typées vers le graphe. | Étendre HeatmapChart : domaine stable, valeurs absentes distinctes, sélection contrôlée et clavier, unité/échelle. | Focus organise la vue liée ; sentropic fournit mesures et sens des axes. |
| Un diagramme, parcours cliquables | Graphe dirigé, scénario = ensemble explicite de nœuds **et de relations**, avec éventuelles branches parallèles. | generic@1 suffit pour les identités et liens de base ; un profil d'exécution réutilisable peut typer ensuite les conditions/statuts. La sélection n'est pas une mutation métier. | DiagramCanvas/contrôles de sélection, états selected/related/dimmed, légende et détail accessibles. Renderer DS à livrer, pas seulement moteur headless. | Boutons nommés par cas, état de scénario, données de correspondance ; pas calcul arbitraire d'un « shortest path ». |
| Avant/après dans le même diagramme | Deux snapshots comparables, même namespace d'identité et correspondance des ajouts/suppressions. | ViewDocument/placements, projection de comparaison, contraintes incrémentales ; aucune coordonnée métier dans SemanticDocument. | Toggle accessible, marques ajout/modification/retrait et maintien du repère spatial. | Focus coordonne scenarioId + version ; sentropic fournit baseline/proposition et hypothèses de durée. |
| Cases groupables avec + et zoom | Contenance métier ou groupe visuel déclaré, membres et relations de frontière. | Distinction contains / visual group ; projection repliée traçable avec occurrences agrégées. | Expand/collapse, zoom-to-group, retour, focus clavier, maintien du contexte. | Focus conserve expandedGroupIds localement ; sentropic déclare e2e matrix et autres sous-étapes. |
| Plan visuel cliquable | Graphe de dépendances des étapes, et correspondance étape → éléments CI/CD modifiés. | generic@1 peut rendre le plan ; profil plan seulement si des invariants métier réutilisables le justifient. Les bénéfices ne sont pas déduits des coordonnées. | Composant de plan/step selection et mise en évidence de delta via les mêmes primitives. | Focus synchronise étape, scénario, comparaison et preuves ; sentropic calcule gains marginaux/cumulés et hypothèses. |

La composition « heat map + contrôles + diagramme principal + plan + preuves » est une recette de dossier Focus. Les composants visuels réutilisables et les interactions géométriques appartiennent au DS. Les temps de jobs, matrices de tests, conditions de merge et règles CI/CD appartiennent à sentropic. Un nouveau profil diagram-core n'est nécessaire que pour des invariants sémantiques stables ; le créer pour chaque bouton serait une erreur.

### C2. Ce qui existe vraiment

**HeatmapChart existe.** Dans D, packages/components-svelte/src/lib/HeatmapChart.svelte accepte x/y/value, un tone optionnel, et des échelles catégorielle ou séquentielle avec tokens DS. Il dispose d'une alternative textuelle ChartDataList. Il ne fournit pas aujourd'hui le contrat de sélection de cellule/clavier, un domaine numérique imposé commun à plusieurs états, ni des statuts distincts unknown/not-run/skipped. Son domaine est dérivé des données de chaque rendu. Le wrapper packages/dataviz-svelte/src/lib/HeatmapChart.svelte ne relaie pas toute cette configuration, notamment scale dans la version lue. Primitives de hover/crossfilter/store présentes dans dataviz-core : les réutiliser sans déclarer la recette complète déjà livrée.

Une heat map où une durée inconnue est traitée comme zéro, ou où chaque bascule recalcule ses couleurs, peut donner une comparaison trompeuse. Le contrat doit distinguer 0 mesuré, inconnu, non exécuté et non applicable ; montrer unité, fenêtre de mesure et nature observée/estimée ; fixer un domaine comparable entre les états. Une palette divergente a du sens pour un delta signé, une palette séquentielle pour une durée positive. La teinte seule ne porte pas la conclusion.

**Le repli existe au niveau de visibilité, mais pas comme agrégation complète.** D packages/diagram-canvas/src/visibility.ts masque les membres d'un groupe collapsed et les relations dont les endpoints deviennent invisibles. Le code annonce explicitement qu'il ne crée ni boîte synthétique ni lien agrégé. Le présenter comme « groupes zoomables déjà livrés » ferait perdre des relations à l'écran.

**Le profil frame est une conception de placement.** B distingue nature du sous-graphe, contenance et groupement visuel, puis intentions de vue et placement. Son suivi de transition constate aussi des problèmes de sidecar/import. Réutiliser ces distinctions, la composition hiérarchique et les réservations d'espace ; ne pas demander à l'auteur Focus un FRAME_PLAN détaillé de directions cardinales et de coordonnées. Cela déplacerait de nouveau la responsabilité du moteur vers le skill.

**Focus sait déjà porter une scene, pas la qualifier complètement.** Dans H, DiagramNode.scene est un Record opaque au niveau du modèle principal. focus-build.ts restreint ensuite generic@1 de façon ad hoc et refuse notamment les ports/ressources/extensions non vides. Cela suffit au kit actuel, pas à des profils enrichis. Il faut un routage par versions/capacités et les validateurs diagram-core, en maintenant la frontière de confiance.

**Les labels exigent aussi un branchement explicite.** Le ViewDocument retourné ne stocke pas à lui seul tous les rectangles de labels d'arêtes. D exporte notamment placeEdgeLabels et les primitives associées pour rejouer leur placement déterministe. L'adaptateur doit consommer cette même géométrie et les mêmes mesures, ou un résultat DS enrichi, au lieu de laisser SvelteFlow recentrer librement les labels après l'audit.

### C3. Contrat de navigation recommandé

État de présentation contrôlé : scénario, snapshot avant/après, étape de plan, groupes développés, référence sélectionnée et caméra. Ces états ne sont pas des commandes d'approbation h2a. Les affordances décisionnelles du dossier portable restent désactivées ; navigation, filtrage et exploration sont possibles localement sans écrire un événement de décision.

- Un parcours explicite peut contenir un sous-graphe de branches parallèles. Inférer toutes les arêtes du sous-graphe induit par les seuls nœuds risque d'allumer des dépendances étrangères au cas.
- La sélection seule ne relance pas le layout. Les références ont des IDs stables indépendants des labels, du numéro de rang et de la position.
- L'avant/après conserve caméra, sélection et groupes quand leurs références existent. Construire une union pour stabiliser la géométrie si elle reste lisible ; sinon utiliser un layout incrémental avec ancrages communs et changements locaux explicites. Ne pas imposer une union géante illisible.
- Les éléments absents ont un état déclaré : ajouté, retiré ou non applicable. L'estompage de tous les liens du graphe complet n'est pas systématiquement la meilleure vue de contexte.
- Le groupe replié annonce ses membres/relations agrégés ; l'expansion restitue les identités originales et les sélections. Le focus ne disparaît pas dans un composant détruit.
- La heat map et les étapes de plan ciblent ces mêmes références. Le plan peut avoir son propre petit diagramme ; il commande le diagramme CI/CD principal, il ne génère pas une série de diagrammes CI/CD séparés.
- Clavier, noms accessibles, focus visible et liste/table équivalente doivent permettre d'accomplir les mêmes tâches sans suivre uniquement des couleurs ou des hover.

Le render conditionné par une clé scene dans le consommateur doit être réexaminé : reconstruire tout le canvas à chaque bascule est incompatible avec une promesse de stabilité non vérifiée.

### C4. Le modèle temporel est une responsabilité métier

Un rang de layout ne représente pas une minute. Pour estimer une durée murale, utiliser le graphe réel d'exécution, les conditions et ressources, les dépendances et la durée des jobs ; dans le cas DAG sans contraintes de ressources supplémentaires, la durée d'un chemin critique se calcule par max des prédécesseurs puis ajout de la durée. La somme des durées de toutes les cases est un coût de travail, pas le délai total.

Un plan qui accélère une branche non critique peut économiser des runner-minutes sans réduire le délai. Les gains d'étapes successives ne sont généralement pas additifs : le chemin critique peut changer. Montrer **gain marginal et gain cumulé par scénario**, hypothèses, mesures disponibles et inconnues ; ne pas convertir une absence de mesure en zéro. Une mesure p95 ne s'obtient pas en additionnant les p95 des jobs indépendamment.

Le retour O impose notamment :

| Attente exacte dans son contexte | Conséquence de modèle / preuve |
| --- | --- |
| Objectif « 10 min max même quand il y a du e2e » | Garder l'objectif visible ; délimiter début/fin, mesure réelle et proposition, ne pas le remplacer par un objectif plus lâche. |
| typechecklit api / smoke idp screen, environ deux minutes questionnées | Décomposer installation, démarrage Docker, attente, exécution ; exposer le matrixage et les durées mesurées. |
| Mutualisation avec validate cluster mesh, cinq minutes contestées | Représenter les étapes réellement partagées et celles dupliquées ; ne pas créer une mutualisation imaginaire par proximité graphique. |
| Parallélisme et publication de manifeste | Représenter les dépendances nécessaires, les verrous/ressources et le détail des étapes longues. |
| Build et publish Docker lors du merge | Inclure le CD pertinent au parcours ; un dossier présenté comme CI/CD ne peut omettre cette branche. |
| Mocker les LLM, vrais LLM au maximum en daily | Plan neuf avec distinction tests déterministes / validations réelles planifiées et effets sur les parcours. |
| Tout élément supérieur à une minute doit faire l'objet d'une optimisation | Inventaire exhaustif de ces éléments, action proposée ou limite justifiée, preuve du bénéfice attendu. |
| Cas logo à supprimer du dossier ou rendre cliquable dans le principal | Aucun diagramme séparé de ce cas ; éventuellement un scénario parmi les autres. |
| Ancien lot 1 non validé ; bénéfices visibles à chaque étape | Partir d'une baseline réelle, pas du statut de PR #696 ; nouvelles étapes, effets et cas concernés accessibles en permanence. |

Le fichier consumer scripts/contract-evidence.mjs observé lit des workflows et calcule un chemin critique, mais ses exclusions de sélection et ses données doivent être réauditées contre **CI et CD**, notamment publication/déploiement et coûts de bootstrap. Le moteur DS ne peut pas corriger une omission métier de son entrée.

**Proposed specification — linked diagram interaction**

> A dossier execution map shall expose one primary graph canvas with scenario selection and a before/after control. Scenarios shall reference explicit entity and relation sets and may contain parallel branches.
>
> Scenario highlighting shall not alter layout. Snapshot and plan-step transitions shall preserve stable identities, applicable selection, expansion state and camera context. Added, removed and inapplicable elements shall remain distinguishable.
>
> Collapsed groups shall preserve the traceability of every represented member and boundary relation. Expansion shall restore original references without changing dependency semantics.
>
> Plan steps shall link to affected graph references and expose per-scenario marginal and cumulative time effects, with evidence or explicit estimation status. Heat-map cells shall use a declared comparable scale and distinguish missing observations from measured zero.

## D. Étendre focus build maintenant aux dossiers riches en preuves

### D1. Limites observées

Dans H, packages/focus/src/model.ts et schemas/decision-dossier-document.v1.schema.json décrivent un document fermé, identifié 1.0.0. Les six types de section sont prose, question, optionSet, outcome, amendmentTrace et diagram. Aucun contrat d'annexe/source/citation n'existe. Le validateur reconstruit les objets autorisés ; ajouter des propriétés au JSON ou au renderer seul ne suffit pas.

packages/focus/src/validation/readability.ts compte le contexte partagé et les libellés du diagramme avec les questions. Ses budgets sont 2/8/30 minutes selon les enjeux, à 180 mots/minute, et une question ne doit pas dépasser deux minutes. Il contrôle aussi les acronymes/codes visibles. Copier des workflows, logs, longues sources ou diffs dans prose fait donc exploser le budget ou produit undefined_code. Mettre une grande prose dans un details HTML ne change pas ce contrat.

packages/h2a/src/focus-build.ts valide, développe la scene, applique le contrôle de lisibilité et injecte les données dans le renderer portable. Il impose au moins un diagramme et un sous-ensemble generic@1 borné, actuellement jusqu'à 80 entités et 240 relations. Ces limites de graphe ne sont pas des limites pertinentes pour la taille d'une source annexe.

Conclusion : **le bon changement porte sur le modèle, sa validation, le budget de lecture, le renderer et la distribution ensemble**. L'exception « dossier lourd donc kit autonome » proposée dans une analyse antérieure est maintenant contredite par « Étendre focus build tout de suite ».

### D2. Contrat minimal livrable indépendamment du moteur avancé

Je recommande une version explicite **1.1 pour les preuves**, avec conservation intégrale de la lecture 1.0. Les noms ci-dessous sont une proposition de contrat, pas des champs déjà disponibles. Une évolution ultérieure pourra ajouter le binding typé des interactions de C ; les annexes ne doivent pas attendre cette évolution.

| Élément proposé | Contenu et invariants | Responsabilité |
| --- | --- | --- |
| formatVersion | Discriminant explicite pour les nouveaux formats. Absence = document legacy 1.0, selon la règle documentée. Version inconnue refusée. | Focus modèle et validator ; pas le composant DS. |
| sources | Catalogue par ID stable : titre, origine/version/commit éventuels, mediaType, encodage, octets embarqués et empreinte de contenu. Les URLs sont des références d'origine, pas des fetch implicites. | Focus contrat d'intégrité ; consommateur pour authenticité et choix des sources. |
| citations | Référence à une source, plage de lignes inclusive pour le texte, ou locator typé adapté au support ; libellé intelligible. IDs uniques, références/plages résolues. | Validation pure et navigation de preuve. |
| annexes | Blocs de support séparés des sections de décision : titre/résumé, contenu documentaire, tableaux simples et références aux sources/citations. Pas de question ou option cachée dans une annexe. | Focus contrat et renderer. |
| citationRefs des sections concernées | Liens explicites vers les preuves ; éventuellement binding depuis une référence du diagramme, via un contrat versionné. | Focus ; pas de parsing fragile de liens Markdown pour établir l'intégrité. |
| Métadonnées de build | Version du renderer/validator, formats/profils supportés, empreinte du payload et des assets. Distinctes du hash source de décision. | h2a packaging/build. |

Le premier incrément doit au moins supporter textes UTF-8, logs, YAML/JSON/diffs et annexes textuelles structurées ; il peut inclure les captures PNG/JPEG comme pièces binaires inertes. Une pièce non rendue n'est pas silencieusement perdue : elle reste identifiée et téléchargeable si son type est autorisé. Le rendu de PDF ou autres formats riches peut être une capacité ultérieure, annoncée explicitement.

Pour conserver les sources, définir les empreintes sur **les octets d'origine**. L'échappement JSON/HTML et le rendu du texte ne doivent pas changer les octets restitués ; conserver les fins de ligne pour les citations. Le renderer peut proposer une vue décodée et une recherche sans modifier la pièce jointe. L'empreinte garantit une correspondance de contenu, pas la vérité de la source ni l'approbation du propriétaire.

La voie immédiate peut utiliser des sources embarquées dans le document. Un résolveur optionnel de fichiers au build relève de h2a, hors du validateur pur ; il doit être explicite sur le répertoire de base, résoudre les références avant packaging et ne jamais embarquer un fichier arbitraire par découverte automatique. Le HTML final reste autonome et fonctionne hors ligne, sans chemin local nécessaire chez le destinataire.

### D3. Budget de lecture sans dégrader la décision

Conserver les règles de lisibilité du **parcours de décision principal** : demande littérale, enjeux, vraie question, options comparables, recommandation, risques déterminants, conclusions et résumés des preuves. Les annexes et octets de sources ont un volume mesuré séparément, pas une exemption accordée à n'importe quelle prose.

- Les textes bruts de sources ne passent pas par le contrôle des acronymes de la prose éditoriale ; les titres, résumés et explications visibles de l'annexe restent intelligibles.
- Rendre une section de décision repliable ne l'exclut pas du budget.
- Une nouvelle option, un risque qui change le choix ou une réserve importante doit apparaître dans la décision principale, même si sa démonstration est longue en annexe.
- Exposer le nombre de sources, leur volume, le temps estimé du parcours principal et la présence de preuves consultables ; ne pas dire « deux minutes de lecture » pour l'intégralité d'un corpus de milliers de lignes.
- Pour un diagramme à états multiples, distinguer informations indispensables à la comparaison et détail de preuve optionnel. Les options de décision ne disparaissent pas du budget parce qu'une autre bascule les révèle.

Le schéma seul ne peut pas prouver qu'un risque substantiel a été caché dans une annexe ; ce point reste une responsabilité de l'auteur/revue. Le typage, l'interface et la validation doivent rendre ce contournement visible, sans prétendre le résoudre par une regex.

### D4. Pipeline, rendu et compatibilité

Pipeline recommandé : reconnaître la version → valider la structure pure et les références → résoudre explicitement les pièces de build éventuelles → vérifier octets/empreintes/plages → compiler scènes et bindings → appliquer le budget principal → composer le bundle → écrire atomiquement après succès.

Le renderer propose index d'annexes/sources, ouverture depuis une citation, lignes numérotées, retour au contexte, recherche et téléchargement brut. La quantité de DOM doit rester bornée : chargement/rendu différé des longues sources, plutôt qu'afficher des dizaines de milliers de lignes à l'ouverture. Aucun besoin de réintroduire HTML libre, JavaScript auteur ou dépendance réseau pour cela ; la protection existante de jsonForHtml contre la fermeture d'un script reste nécessaire.

Pour la géométrie, ne pas annoncer que le build valide un rendu qu'il n'a pas mesuré. Le branchement DS doit définir un fournisseur de mesures lié aux polices et tokens réellement embarqués, puis calculer la vue de référence avec les mêmes contraintes que le renderer. Les tests navigateur vérifient la correspondance avec les fontes chargées et le viewport réel. Si la mesure de build reste approximative à une étape de migration, le rapport doit le dire ; elle ne peut attester seule la lisibilité finale. Le navigateur réévalue le layout lors d'un changement de dimensions/fonts et évite de montrer une scène connue comme invalide. Aucun téléchargement de navigateur ne doit être imposé au lecteur du HTML portable.

Compatibilité proposée :

| Situation | Comportement |
| --- | --- |
| Ancien document 1.0, nouveau build | Accepter selon ses règles historiques ; même demande, mêmes sections, même sens des hashes et des affordances. Aucun besoin d'ajouter artificiellement des annexes. |
| Nouveau document 1.1, nouveau build | Valider sources/annexes ; les rendre hors ligne avec citations résolues et budget principal séparé. |
| Nouveau document, ancien build | Refus de version/champs incompatibles. **Ne pas promettre une compatibilité dans ce sens** et ne pas retirer les preuves silencieusement pour obtenir un succès. |
| Export Markdown/terminal | Donner des références/annexes lisibles ou un diagnostic explicite de capacité ; aucun drop silencieux à cause d'un switch incomplet. |
| Scene legacy et source de secours | Continuer à accepter les formats déjà supportés ; source et alt restent disponibles, le compilateur produit les représentations dérivées. |
| Dossier avec comprehensionEvidence | Respecter la liaison au hash de document et à l'autorité existante. Une compilation technique ne fabrique pas une nouvelle attestation ; un changement substantiel ne recycle pas une ancienne approbation. |
| Validation refusée | Ne pas écraser le fichier de sortie précédent. Message avec chemin/source/citation en cause. |

Ne pas modifier rétroactivement la définition du schéma 1.0. Publier une ressource versionnée supplémentaire, les exports correspondants et un dispatch explicite dans la validation. L'ajout d'une union TypeScript peut affecter les consommateurs exhaustifs : traiter le versionnage de package et les changements de signatures selon leur impact, sans supposer qu'un numéro de schéma 1.1 garantit à lui seul une release non cassante.

Les copies embarquées du schéma et du validateur dans packages/h2a/focus-kit doivent être régénérées depuis packages/focus, avec leurs empreintes. La documentation portable décrit déjà cette chaîne ; la contourner laisserait une CLI qui valide un format différent du renderer.

**Proposed specification — evidence-rich dossiers**

> Focus shall support versioned, closed-world source, citation and annex records. Evidence payloads shall be embedded or explicitly resolved at build time, integrity-checked, and available in the offline artifact. No evidence shall be fetched implicitly when the dossier is opened.
>
> Decision reading budgets shall apply to the complete primary decision path, including material risks, alternatives and evidence summaries. Raw source payloads and supporting annex detail shall have separate volume accounting. Collapsing ordinary decision content shall not exempt it from readability validation.
>
> Every citation shall resolve to an existing source and a valid locator. The artifact shall preserve source bytes and distinguish integrity from authenticity and owner approval.
>
> The new build shall accept supported legacy dossiers without semantic changes. Older consumers may reject newer formats; no consumer shall silently discard unsupported evidence or diagram capabilities. Validation failure shall leave an existing output artifact unchanged.

## E. Lots par dépôt, dépendances et tests RED

### E1. Ordre de travail

Les lots ci-dessous sont des unités de réalisation proposées. Ils doivent se rattacher au programme DS existant et aux plans h2a déjà présents, sans effacer leur historique. Le statut Track n'a pas été consulté ou modifié dans cette analyse.

**Peuvent démarrer maintenant et indépendamment** : H1 (preuves), D1 (inventaire/provenance), D2 (distribution du moteur déjà fusionné), D3 (géométrie préventive) et S1 (modèle/mesures CI/CD). H2 peut préparer son adaptateur contre le contrat D existant ; il n'attend pas toutes les familles ELK.

| Lot / propriétaire | Résultat concret et fichiers concernés | RED à écrire d'abord | Dépendances / sortie |
| --- | --- | --- | --- |
| **D1 — DS : couverture et provenance** | Mettre à jour docs/graph-dataviz-reference-catalog.md et .json, docs/graph-dataviz-ds-audit.md, docs/graph-dataviz-checkpoint.md et spec/SPEC_EVOL_DS_JSON_RENDER_STANDARD.md. Conserver GD-M5-PROCESSING ; enregistrer L-R1..L-R11 comme implémentation partielle qualifiable. Dossiers de sources par famille, dont lacunes VertiFlex/ShrinkTree/Draw2D. | Test de complétude du registre : les 21 IDs et les stratégies du snapshot ont source, statut et preuve ou écart explicite ; échoue si layered est coché complet sans les sous-capacités. Tester la détection d'une nouvelle option/entrée lors de rafraîchissement. | Aucun préalable d'implémentation. Ne pas exécuter/copier du code ELK pour rédiger le registre. |
| **H1 — h2a / Focus : sources et annexes immédiatement** | packages/focus/src/model.ts, src/validation/index.ts, src/validation/readability.ts ; nouveau schemas/decision-dossier-document.v1.1.schema.json ; exports package ; src/render/html.ts, md.ts, terminal.ts. packages/h2a/src/focus-build.ts ; focus-kit/src/App.svelte et composants d'évidence nouveaux ; template, docs/focus/portable-dossiers.md. | Source de 20 000 lignes + décision courte valide : aujourd'hui aucun contrat accepté. Citation inconnue/hors plage/hash erroné refusés ; longs codes de source ne deviennent pas undefined_code dans la prose ; vraie option cachée ne devient pas valide par simple repli. Ancienne fixture inchangée acceptée. | Indépendant de D2–D8. Livrer le chemin build/HTML complet, pas seulement des types. |
| **D2 — DS : rendre le moteur consommable** | packages/diagram-core/package.json, packages/diagram-canvas/package.json, exports/build/release du dépôt. Public API : modèle, validation, layout, mesures, diagnostic et transformations. Assainir publication/dépendances exactes ; le caractère public est déjà prévu dans la spécification DS. | Consommateur isolé depuis les tarballs publiables : import types/runtime et layout d'une fixture, sans alias de workspace, private package ni chemin src. Vérifier licence, assets et aucune dépendance runtime ELK introduite. | Moteur actuel disponible ; qualification packaging avant consommation distribuée. Pas besoin d'attendre le solveur NS. |
| **H2 — h2a : adopter maintenant le moteur DS** | packages/h2a/focus-kit/src/Canvas.svelte, EcosystemNode.svelte, interim-nodes.js ; package.json/lock ; packages/h2a/src/focus-build.ts. Remplacer le placement intermédiaire, consommer les ports/waypoints/labels DS, puis retirer le générateur provisoire. | Même scene parent/enfant + lien entre conteneurs : canvas reflète la vue DS, routes et ports effectifs ; pas une grille suivie d'un smoothstep recalculé. Source fallback toujours consultable. Scène avec diagnostic bloquant non annoncée qualifiée. | D2 pour distribution. Adapter le renderer actuel est possible sans attendre tous les nouveaux composants ; aucun deuxième algorithme de placement dans Focus. |
| **D3 — DS : sécurité géométrique et hub réel** | packages/diagram-canvas/src/layout/engine.ts, rank.ts, place.ts, dock.ts, route.ts, labels.ts, types.ts ; module de qualité proposé src/layout/quality.ts. Choix de candidats, audit final, reprise route/label, slot ordering et canaux de hub. | Fixture 30→ci-gate, labels longs et boîtes imbriquées ; une route étrangère ne peut traverser un label. Cas où le premier routage échoue mais l'élargissement/replacement réussit. Aucun fallback dangereux accepté. Cas sans solution trouvée ≠ preuve d'impossibilité. | Part du moteur actuel ; D1 fournit provenance des nouveaux algorithmes. Cas CI prioritaires, sans attendre force/stress. |
| **D4 — DS : projection et interactions de diagramme** | packages/diagram-core/src/view.ts, refs.ts et contrats versionnés si nécessaire ; packages/diagram-canvas/src/visibility.ts, scene.ts, transform.ts ; nouveaux modules de projection/comparaison. Composant proposé packages/components-svelte/src/lib/DiagramCanvas.svelte et contrôles associés, avec exports publics. | Groupe contenant des nœuds connectés à l'extérieur : collapse conserve une représentation traçable des relations ; expand restaure les mêmes IDs. Highlight ne déplace pas. Toggle avec ajout/retrait conserve contexte. Clavier/zoom-to-group sans perte de focus. | D3 pour qualité des nouveaux états ; peut commencer sur fixtures génériques avec D2. Réutiliser contains/group, pas les fusionner. |
| **D5 — DS : heat map liée** | packages/components-svelte/src/lib/HeatmapChart.svelte ; wrapper packages/dataviz-svelte/src/lib/HeatmapChart.svelte ; primitives dataviz-core pertinentes ; documentation et parité des wrappers concernés. | Une valeur identique conserve sa couleur entre deux états ; unknown ≠ zero ≠ skipped ; clic/clavier émet la même référence contrôlée ; sélection externe visible ; liste accessible équivalente. | Indépendant du layout ; le format de références lié se coordonne avec D4/H3. Réutiliser tokens/rampes existants. |
| **H3 — h2a : recette interactive de dossier** | packages/focus/src/model.ts et validation pour binding versionné ultérieur ; focus-kit/src/App.svelte, Canvas.svelte et nouveaux contrôleurs de scénario/compare/plan ; template. Ne pas mélanger navigation locale et affordances de décision. | Un seul canvas CI/CD ; trois scénarios dont un parallèle, bascule avant/après, groupe e2e, étape de plan et cellule de heat map pilotent les mêmes IDs. Aucune approbation ni écriture serveur au clic. State/camera préservés. | H2 + D4/D5. H1 peut déjà être livré ; ne pas coupler sa release à cette recette. |
| **S1 — sentropic : baseline et plan frais** | Sources de preuve sous .tmp/focus-ci-efficiency-kit/evidence ; scripts/contract-evidence.mjs et scripts/contract-diagrams.mjs comme points actuels à remplacer/adapter. Retrouver le chemin pérenne selon conventions du dépôt avant promotion ; .tmp n'est pas un contrat public. | Scénario merge comprend build/publish Docker et CD attendu ; shared setup compté une fois selon la vraie exécution ; durées inconnues visibles ; deux branches parallèles ne sont pas sommées en temps mural. Chaque élément >1 min a une proposition examinable. | Démarre maintenant. Aucune modification de CI ni restauration de l'ancien lot n'est autorisée par cette analyse. |
| **S2 — sentropic : reconstruire le dossier avec Focus étendu** | Modèle de dossier canonique à créer dans le chemin pérenne choisi ; migration des données du kit, pas fork permanent de son renderer. Réemployer les sources/annexes et le plan frais ; générer le portable par focus build. | Rejouer les tâches propriétaire de 8/11/13 et tout O : heat map DS, cas logo intégré ou absent, parcours/compare même diagramme, détail e2e, étape→modifications→gain, sources accessibles. Pas de nœud coupé au fit initial. | H1 + H3 + D3/D4 ; données S1. Vérification du véritable artifact, pas seulement des captures de composants isolés. |
| **H4 — h2a : distribution et méthode cohérentes** | scripts/vendor-focus.mjs, scripts/focus-vendor-lib.mjs, scripts/check-focus-vendor.mjs, scripts/build-focus-dossier.mjs ; focus-kit/dossier.schema.json, validator.mjs, renderer.html, renderer-manifest.json, templates et hashes. packages/focus/skills/focus/SKILL.md et entrées de registre ; intégrer le parcours dans le skill de présentation concerné sans imposer des coordonnées. | Paquet installé isolément : focus template puis focus build ouvre hors ligne le dossier avec preuves/interactions. Hashes vendor à jour, aucune importation locale manquante, tests d'installation/registry synchronisés. | Cette vérification accompagne chaque release H1/H2/H3 ; la ligne H4 n'est pas une excuse pour retarder la distribution à la fin. |
| **D6–D8 — DS : terminer la couverture ELK** | Algorithmes mutualisés dans packages/graph et moteur diagram-canvas selon frontière solveur/projection ; registre D1 et nouvelles suites par famille. Détails E2. | Propriétés et cas adverses propres à chaque famille ; aucune équivalence annoncée par simple screenshot. | Programme parallèle au chemin critique dossier. Dépend de D1 pour les sources, de la matrice de contraintes pour les qualifications. |

Les tests RED sont attendus au vu des fonctions absentes, mais **aucun échec n'a été exécuté ici**. Pour une faiblesse géométrique, commencer par une fixture témoin qui reproduit effectivement le défaut. Si elle passe déjà, conserver le test existant et chercher le vrai écart ; ne pas inventer une régression pour justifier le lot.

### E2. Programme algorithmique ordonné dans DS

| Vague | Capacités livrées et rapprochement avec l'inventaire | RED discriminants |
| --- | --- | --- |
| **D3 / priorité immédiate** | Final-scene audit, route/label retry, ordre de ports, canaux pour hubs, comptage des routes finales, orientation choisie par qualité. Réutilisation de PAVA/A* existants ; premières améliorations crossing/ranking justifiées par le corpus. | Label couvert par une arête tierce, fan-in 30, fallback dangereux, viewport négatif/marqueurs, graphes de petite taille avec optimum connu. |
| **D6a — layered complet, phases fondamentales** | Feedback arc heuristics ; NS pour ranking ; Coffman–Graham/min-width/promotion ; barycentre+médiane+switching contraints ; BK corrigé et NS de placement ; linear segments ; stratégies modèle/interactives. Sert aussi la couverture dot et Draw2D. | Cycle avec poids/priorités sans inversion métier ; exemple où longest-path gaspille la largeur ; port-order contraint ; fixture des deux défauts identifiés par l'erratum BK, recréée indépendamment ; contraintes incompatibles explicites. |
| **D6b — routage, labels, hiérarchie, incrémental** | Orthogonal complet, polyline/spline, canaux/nudging/checkpoints, labels centre/source/cible/ports, compound inter-niveaux, bundles ; compaction/wrapping ; continuité avant/après. Couvre le besoin libavoid sans l'embarquer. | Courbe dont les points de contrôle paraissent sûrs mais qui touche un obstacle ; ports fixés sur côtés opposés ; self-loop ; arêtes parallèles/antiparallèles ; trois niveaux de nesting ; une insertion locale ne bouleverse pas toute la carte. |
| **D7a — force et distances** | force/FR/Eades ; stress majorization ; mode Kamada–Kawai ; fdp/neato comme contrats de fournisseur s'appuyant sur ces briques. | Graine reproductible ; positions fixes respectées ; composantes infiniment distantes traitées ; stress non croissant pour le solveur exact qualifié ; terminaison ; séparation après traitement d'overlaps ; conservation de toutes les arêtes. |
| **D7b — arbres et circulaire** | MrTree/Walker ; radial/Eades ; VertiFlex ; circo/blocs biconnectés ; twopi/niveaux autour d'une racine. | Arbre large avec tailles variables sans recouvrement ; racine imposée ; positions verticales imposées et conflit ; graphe cyclique ne perd pas ses liens hors arbre ; cercle/radial différenciés ; disconnected input documenté. |
| **D8a — packing, composantes et hiérarchie descendante** | box, rectpacking order-preserving, DisCo, topdownpacking. | Ordre conservé, rectangles de rapports extrêmes, composantes non rectangulaires, contraintes parent/enfant, test de taille impossible ; packing ne déforme pas les routes internes sans reroutage. |
| **D8b — overlap/compaction et utilitaires** | SPOrE overlap/GTree, SPOrE compaction/ShrinkTree qualifié ; fixed ; random. | Rectangles superposés et colinéarité, suppression de collisions sans perte d'identité, contraction sans réintroduire collision ; fixed ne déplace rien ; random respecte graine/bornes. |

Les prérequis bibliographiques non résolus de D7/D8 démarrent en D1, pas à la veille du dernier lot. Les briques packing/fixed simples peuvent être livrées plus tôt si elles facilitent D4 ; l'ordre des vagues exprime la priorité dossier, pas une interdiction de paralléliser le programme.

La clôture de « tous les algorithmes » exige une matrice couvrant les 21 entrées, les stratégies promises et leurs combinaisons qualifiées. Une incompatibilité documentée n'est pas une capacité terminée. Si un comportement reste indéterminé dans les publications, le lot de spécification reste ouvert jusqu'à définition d'un équivalent fonctionnel assumé.

### E3. Emplacements de tests et critères de sortie

**DS.** Capital existant : packages/diagram-canvas/tests/layout/rules.test.ts, contract.test.ts, determinism.test.ts, performance.test.ts, ac-l8-geometry.test.ts, amended.test.ts, h2a.test.ts et suites sol/spec ; packages/diagram-canvas/tests/visibility.test.ts, transform.test.ts, scene.test.ts ; packages/diagram-core/tests/invariants.test.ts, rejected-cases.test.ts et valid-fixtures.test.ts. Ajouter, si ces responsabilités n'ont pas de maison existante, tests/layout/quality.test.ts, hub-routing.test.ts, labels-final-scene.test.ts et tests/comparison-projection.test.ts. Ce sont des **noms proposés**. Pour HeatmapChart, ajouter packages/components-svelte/src/HeatmapChartInteraction.test.ts à côté des tests des autres charts et compléter les tests du wrapper.

**Focus/h2a.** Étendre packages/focus/tests/schema.spec.ts, readability.spec.ts, render.spec.ts et packaging.spec.ts ; ajouter une fixture de preuves volumineuses originale. Étendre packages/h2a/test/focus-build.test.js et packages/h2a/focus-kit/test/browser.test.mjs. Les tests doivent porter sur le contrat de l'artefact :

- entrée legacy et nouvelle entrée ; rejet explicite d'une version future ;
- sources intactes après transport/échappement, lignes CRLF/UTF-8, titres accentués, citation invalide, ID dupliqué et tampering ;
- texte contenant une fermeture de script ou du HTML traité comme donnée ; aucun fetch réseau nécessaire à l'ouverture ;
- longue preuve indépendante du budget principal, mais longue décision toujours refusée ;
- échec avant remplacement de la sortie existante ;
- contrôles clavier, états avant/après et références croisées ; affichage des preuves sans bloquer toute l'interface ;
- polices réellement chargées, thème clair/sombre, viewport de référence 1440 × 900 et dimensions intérieures plus étroites ; vérifier l'enveloppe peinte, pas uniquement les bounding boxes des nœuds.

**Corpus algorithmique.** Construire des familles originales : chaîne, diamond, cycle, K3,3/non-planarité, self-loops, multi-arêtes, hub 30, groupes imbriqués, labels très longs, graphes déconnectés, tailles asymétriques. Le K3,3 évite de « prouver » un zéro-croisement universel. Sur petites instances, un oracle exact indépendant ou une solution constructive connue peut tester la qualité ; sur grandes instances, comparer distributions de métriques et régressions. Les tests de déterminisme, permutation de l'ordre d'entrée et stabilité après petite modification testent des propriétés différentes.

**Mesure de performance.** Reprendre les tests et fixtures de D et les limites réelles du build. Fixer machine, version, graine, tailles et nombre de répétitions ; suivre temps, mémoire, annulation et absence de résultat obsolète après une nouvelle révision. Un seuil de timeout ou une promesse de fluidité n'a pas été mesuré ici. Ne pas présenter un benchmark d'ELK comme une mesure du futur moteur DS.

**Sentropic.** Respecter les commandes de qualification du dépôt, en particulier l'entrée make prescrite par rules/MASTER.md. La preuve finale associe la source de dossier, son hash, les références de workflows/mesures, le HTML généré et les captures des tâches utilisateur. Le consommateur valide le sens des parcours et le calcul des bénéfices ; DS valide layout/interactions ; h2a valide compilation/portabilité/contrat.

### E4. Chemin critique et critères de fin

Chemin court : **D2 → H2**, pendant que **H1** et **S1** progressent ; puis **D3 + D4 + D5 → H3 → S2**. H4 accompagne chaque livraison. **D1 → D6/D7/D8** constitue le programme complet ELK ; il ne retarde pas H1 ni l'adoption du moteur déjà fusionné.

Le dossier CI/CD est terminé lorsque les tâches du retour propriétaire sont réalisables sur le véritable portable avec données justifiées et géométrie qualifiée. Le programme ELK est terminé selon sa matrice de couverture, pas selon la qualité de ce seul dossier. La livraison de H1 est terminée dès qu'un dossier riche en sources se construit et se consulte par le chemin standard, avec compatibilité et tests, même si de nouvelles familles de layout restent planifiées.

## F. Questions restantes, recommandations et incertitudes

### F1. Questions à présenter au propriétaire, sans bloquer le travail acquis

Ces questions sont préparées pour le prochain arbitrage ; elles ne constituent pas une demande de permission d'étudier ou de commencer H1/D1/D2/S1. Certaines disposent déjà d'une recommandation suffisamment claire pour avancer en explicitant l'hypothèse.

| Question avec contexte | Options réelles | Recommandation et effet |
| --- | --- | --- |
| **Que couvre précisément le maximum de dix minutes ?** Le retour exige aussi la présence du build/publish Docker et du CD. Le diagramme doit séparer attente, CI, publication et déploiement pour éviter de cacher une partie du délai. | A : jusqu'au gate autorisant le merge ; B : jusqu'à la publication de l'artefact livrable ; C : jusqu'à un déploiement prêt. Préciser aussi départ au déclenchement ou au début effectif du workflow. | Préparer la mesure complète jusqu'à publication, avec toutes les phases et l'attente visibles, puis faire ratifier la frontière. Garder dix minutes comme objectif maximal dans le périmètre retenu ; p50/p95/max observés documentent la preuve, ils ne remplacent pas ce maximum. |
| **Le critère doit-il garantir une impression autonome, ou l'exploration interactive constitue-t-elle l'acceptation principale ?** Le retour présent privilégie clics, bascules et zoom ; le plan frame antérieur contient aussi une piste A4. | A : interactif prioritaire, export explicatif secondaire ; B : interactif et dossier imprimé autonome, avec détail paginé ; C : chaque état détaillé sur une seule page. | A pour réparer immédiatement le dossier. Si B est maintenu dans le périmètre, le traiter explicitement avec pagination/projections lisibles. C peut être mathématiquement impossible à taille de texte raisonnable ; ne pas le promettre. Cette question ne rouvre pas le cadre de référence DS de 1440 × 900. |
| **« Réimplémenter tous les algorithmes » exige-t-il aussi une API de substitution à ELK ?** Les capacités scientifiques peuvent être couvertes par l'API native DS ; reproduire toutes les conventions de fournisseurs Eclipse/Graphviz est un autre coût. | A : toutes les capacités algorithmiques via API DS ; B : A + adaptateur des entrées/options ELK utilisées ; C : compatibilité étendue des fournisseurs/plugins en plus. | A comme contrat de base, sans retirer aucune famille de l'inventaire ; B si un consommateur concret en a besoin. Ne pas engager C sans cas d'usage. La question porte sur l'interface et le coût de compatibilité, pas sur l'autorisation de réduire le programme à layered. |
| **Quand on clique une étape du plan, l'après représente-t-il toutes les étapes acquises jusque-là ?** La demande de bénéfices à chaque étape implique de traiter les interactions entre optimisations et les prérequis. | A : état cumulé, avec gain marginal de l'étape et gain cumulé ; B : chaque optimisation isolément sur la baseline. | A, avec B disponible dans la preuve si utile. Cette convention peut être adoptée et tracée dès maintenant : elle rend visibles les gains non additifs et conserve les parcours à chaque étape. |

Il n'y a pas à redemander « ELK ou DS ? », « seulement layered ? », « faut-il vraiment étendre Focus maintenant ? », « avant/après côte à côte ? » ou « peut-on conserver l'ancien lot 1 ? ». Les réponses sont déjà dans la demande.

Les détails techniques — ordre des ports, choix entre BK et PAVA selon métriques, découpage des modules, tolérances numériques, réemploi du chart — relèvent des équipes et des preuves de qualification, pas d'un formulaire supplémentaire au propriétaire.

### F2. Incertitudes à conserver visibles

1. **Distribution** : private:true et versions proviennent de D ; aucune disponibilité npm actuelle ni chaîne de release complète n'a été qualifiée pendant cette analyse. Le lot D2 doit prouver l'installation depuis l'artefact exact.
2. **Correspondance des snapshots** : référence documentaire ELK, tag v0.12.0 et pages web courantes ne sont pas garantis identiques. Le catalogue contient déjà des empreintes ; le programme doit fixer la version qu'il couvre et suivre les écarts.
3. **Sources bibliographiques incomplètes** : pas de publication spécifique établie pour VertiFlex, certaines variantes ShrinkTree/Draw2D et tous les raffinements de toutes les options. Les bases mathématiques ne suffisent pas à revendiquer la parité des détails. Certains articles ont été vérifiés par leur publication/résumé et leur lien primaire, pas relus intégralement ici.
4. **Qualité effective du moteur** : code/spec/tests inspectés, sans exécuter de corpus ni de navigateur. Les lacunes signalées sont fondées sur les branches et contrats lus ; les contre-exemples chiffrés doivent être matérialisés par les RED.
5. **Mesure du texte** : il reste à qualifier la fidélité entre callback de mesure DS, polices/tokens embarqués, DOM/SVG et zoom. Une boîte mesurée avec une police différente invalide la preuve de non-chevauchement.
6. **Seuils perceptuels** : aucun article cité ne ratifie nos valeurs de police, densité ou budget de lecture. Les bornes 11 px / 7 pt du plan et le choix du mode overview doivent être réconciliés avec les tokens DS et l'usage réel, puis testés sur les tâches propriétaire.
7. **Données métier** : les fichiers du consommateur sont en évolution ; les captures de feedback ne constituent pas une trace d'exécution CI. Les durées, coûts Docker, dépendances CD et mutualisations nécessitent un relevé fixé par commit/run et une fenêtre de mesure.
8. **Faisabilité des dix minutes** : aucune optimisation de layout ne prouve ce délai. Il faut le modèle complet, les contraintes de ressources et des mesures avant de conclure qu'il est atteint ou hors d'atteinte.
9. **Volume des preuves** : les budgets d'octets, temps d'ouverture et mémoire du futur HTML avec annexes ne sont pas mesurés. Les fixer à partir du corpus réel et de la fixture longue ; un plafond sur la taille du graphe ne remplace pas ce travail.
10. **Coût du programme complet** : réimplémenter toutes les familles et variantes est un programme de bibliothèque, bien plus large qu'un patch de dossier. Pas d'estimation de délai sérieuse sans matrice décomposée et qualification initiale. Cela n'empêche pas les lots immédiats.

### F3. Note prête à relayer à h-cond

Le type requis pour CI/CD est une carte de dépendances/exécution avec parcours sélectionnables, et non une collection de schémas séparés par usecase. Il lui faut un contrôle avant/après sur le même canvas, une projection de groupes repliés conservant les relations, une heat map DS liée et un plan dont les étapes mettent en évidence les modifications et les gains par cas. Le moteur DS existe et doit être branché maintenant ; il manque sa distribution/connexion Focus, plusieurs garanties géométriques finales et les composants d'interaction. Focus doit recevoir immédiatement sources et annexes dans son contrat normal. Sentropic garde la responsabilité des dépendances CI/CD et des durées, avec un plan frais excluant PR #696. Le programme de réimplémentation de tous les algorithmes ELK s'adosse au catalogue DS déjà présent.

Cette note est un contenu préparé dans le fichier demandé ; aucun envoi à h-cond ou à un autre agent n'a été effectué.

## Références scientifiques, techniques et de provenance

Les liens sont des sources pour concevoir et vérifier les implémentations ; ils ne sont pas une autorisation de copier du code ou les figures. Lorsqu'une année de conférence diffère de l'année des actes, les deux sont indiquées.

### Publications

- **[R1]** K. Sugiyama, S. Tagawa, M. Toda, **Methods for Visual Understanding of Hierarchical System Structures**, IEEE Transactions on Systems, Man, and Cybernetics 11(2), 109–125, 1981. [DOI 10.1109/TSMC.1981.4308636](https://doi.org/10.1109/TSMC.1981.4308636). Fondement du dessin en couches ; ne prescrit pas une solution optimale générale.
- **[R2]** P. Eades, X. Lin, W. F. Smyth, **A fast and effective heuristic for the feedback arc set problem**, Information Processing Letters 47(6), 319–323, 1993. [DOI](https://doi.org/10.1016/0020-0190(93)90079-O). Source pour le cycle breaking greedy ; distinct du tri déterministe actuellement utilisé par DS.
- **[R3]** E. R. Gansner, E. Koutsofios, S. C. North, K.-P. Vo, **A Technique for Drawing Directed Graphs**, IEEE TSE 19(3), 214–230, 1993. [Article intégral chez Graphviz](https://graphviz.org/documentation/TSE93.pdf), [DOI](https://doi.org/10.1109/32.221135). Rangs et placement par network simplex, réduction des croisements et routage de graphes dirigés.
- **[R4]** E. G. Coffman, R. L. Graham, **Optimal scheduling for two-processor systems**, Acta Informatica 1, 200–213, 1972. [DOI](https://doi.org/10.1007/BF00288685). Fondement de l'ordonnancement sous contrainte de largeur ; ses garanties originales ne se transfèrent pas automatiquement à nos boîtes de tailles variables.
- **[R5]** N. S. Nikolov, A. Tarassov, J. Branke, **In search for efficient heuristics for minimum-width graph layering with consideration of dummy nodes**, ACM JEA, 2005. [DOI](https://doi.org/10.1145/1064546.1180618). Complément : Nikolov/Tarassov, **Graph layering by promotion of nodes**, Discrete Applied Mathematics, 2006, [DOI](https://doi.org/10.1016/j.dam.2005.05.023).
- **[R6]** M. Forster, **A fast and simple heuristic for constrained two-level crossing reduction**, GD 2004, actes LNCS 3383, 206–216, 2005. Référence identifiée dans la [bibliographie de l'article ELK](https://arxiv.org/html/2311.00533v1). À lire intégralement dans le dossier de conception des contraintes d'ordre ; les noms d'options seuls ne suffisent pas.
- **[R7]** W. Barth, P. Mutzel, M. Jünger, **Simple and Efficient Bilayer Cross Counting**, JGAA 8(2), 179–194, 2004. [Publication et PDF](https://jgaa.info/index.php/jgaa/article/view/paper88), [DOI](https://doi.org/10.7155/jgaa.00088). Comptage efficace des croisements bilayer ; ce problème reste distinct de l'audit de routes orthogonales complètes.
- **[R8]** U. Brandes, B. Köpf, **Fast and Simple Horizontal Coordinate Assignment**, GD 2001, actes 2002. [PDF primaire](https://kim246.wwwdns.kim.uni-konstanz.de/publications/bk-fshca-01.pdf). **U. Brandes, J. Walter, J. Zink, Erratum: Fast and Simple Horizontal Coordinate Assignment**, 2020, [arXiv:2008.01252](https://arxiv.org/abs/2008.01252). L'erratum identifie deux défauts ; toute réimplémentation doit intégrer les corrections, en particulier la compaction.
- **[R9]** M. Wybrow, K. Marriott, P. J. Stuckey, **Orthogonal Connector Routing**, GD 2009, actes LNCS 5849, 219–231, 2010. [Notice primaire Monash](https://research.monash.edu/en/publications/orthogonal-connector-routing/), [DOI](https://doi.org/10.1007/978-3-642-11805-0_22). Fondement du routage évitant les obstacles ; ne pas confondre libavoid et le routeur layered interne à ELK.
- **[R10]** G. Sander, **A fast heuristic for hierarchical Manhattan layout**, GD 1995, actes LNCS 1027, 447–458, 1996. [DOI](https://doi.org/10.1007/BFb0021828). Layout hiérarchique Manhattan et travail sur les segments ; la borne de coudes de son modèle n'est pas un seuil universel pour nos contraintes.
- **[R11]** C. D. Schulze, M. Spönemann, R. von Hanxleden, **Drawing Layered Graphs with Port Constraints**, JVLC 25(2), 89–106, 2014. [PDF primaire Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf). Complément : U. Rüegg, C. D. Schulze, J. J. Carstens, R. von Hanxleden, **Size- and Port-Aware Horizontal Node Coordinate Assignment**, GD 2015, [DOI](https://doi.org/10.1007/978-3-319-27261-0_12).
- **[R12]** T. W. Sederberg, **Computer Aided Geometric Design**, notes de cours, 2012. [Dépôt primaire BYU](https://scholarsarchive.byu.edu/facpub/1/). Fondement pour courbes/B-splines ; à combiner avec les contraintes de canaux/obstacles, ce n'est pas seul un algorithme de routage sûr. Voir aussi [R3].
- **[R13]** P. Eades, **A heuristic for graph drawing**, Congressus Numerantium 42, 149–160, 1984 ; T. M. J. Fruchterman, E. M. Reingold, **Graph drawing by force-directed placement**, Software: Practice and Experience 21(11), 1129–1164, 1991, [DOI](https://doi.org/10.1002/spe.4380211102). Familles de forces à distinguer dans les contrats et tests.
- **[R14]** E. R. Gansner, Y. Koren, S. C. North, **Graph Drawing by Stress Majorization**, GD 2004, actes LNCS 3383, 239–250, 2005. [PDF primaire Graphviz](https://www.graphviz.org/documentation/GKN04.pdf), [DOI](https://doi.org/10.1007/978-3-540-31843-9_25). Variante antérieure : T. Kamada, S. Kawai, **An algorithm for drawing general undirected graphs**, IPL 31(1), 7–15, 1989, référencée par la [documentation neato](https://graphviz.org/docs/layouts/neato/).
- **[R15]** J. Q. Walker II, **A node-positioning algorithm for general trees**, Software: Practice and Experience 20(7), 685–705, 1990. [Publication Wiley / DOI](https://onlinelibrary.wiley.com/doi/10.1002/spe.4380200705). Reingold–Tilford et l'optimisation de Buchheim/Jünger/Leipert sont des extensions bibliographiques utiles au programme ; ne pas affirmer sans vérification que toutes leurs variantes sont celles d'ELK MrTree.
- **[R16]** P. Eades, **Drawing Free Trees**, Bulletin of the Institute of Combinatorics and its Applications 5, 10–36, 1992. [Scan de l'article](https://treevis.net/scans/Eades1992.pdf). Famille radiale et allocation de secteurs.
- **[R17]** S. Domrös, D. Lucas, R. von Hanxleden, K. Jansen, **On Order-preserving, Gap-avoiding Rectangle Packing**, IVAPP 2021. [PDF primaire Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/ivapp21.pdf), [DOI](https://doi.org/10.5220/0010186400380049). Couverture à rapprocher des variantes ultérieures du catalogue, pas de tout packing bin/strip imaginable.
- **[R18]** M. Cyruk, **Graph Layout of Connected Components**, mémoire, 2017. [PDF primaire Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/mic-mt.pdf). Source pour DisCo et l'agencement de composantes ; ce n'est pas seulement l'empilement de bounding boxes.
- **[R19]** L. Nachmanson, A. Nocaj, S. Bereg, L. Zhang, A. Holroyd, **Node Overlap Removal by Growing a Tree**, prépublication 2016, JGAA 2017. [arXiv:1608.02653](https://arxiv.org/abs/1608.02653), [notice primaire Microsoft Research](https://www.microsoft.com/en-us/research/publication/node-overlap-removal-growing-tree/). Source de GTree ; l'équivalence exacte de ShrinkTree nécessite une spécification supplémentaire.
- **[R20]** N. Kasperowski, R. von Hanxleden, **Top-Down Drawings of Compound Graphs**, 2023. [arXiv:2312.07319](https://arxiv.org/abs/2312.07319), [PDF primaire Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/arxiv23b.pdf). Composition descendante et navigation de graphes composés.
- **[R21]** J. M. Six, I. G. Tollis, **A Framework for Circular Drawings of Networks**, GD 1999, LNCS 1731, 107–116, [DOI](https://doi.org/10.1007/3-540-46648-7_11) ; également **Circular Drawings of Biconnected Graphs**, ALENEX 1999, cités dans la [documentation circo](https://graphviz.org/docs/layouts/circo/). G. J. Wills, **NicheWorks—Interactive Visualization of Very Large Graphs**, JCGS 8(2), 190–212, 1999, [publication](https://www.tandfonline.com/doi/abs/10.1080/10618600.1999.10474810), référence de [twopi](https://graphviz.org/docs/layouts/twopi/).
- **[R22]** C. D. Schulze, U. Wechselberg, R. von Hanxleden, **Edge Label Placement in Layered Graph Drawing**, Diagrams 2018, 71–78, [DOI](https://doi.org/10.1007/978-3-319-91376-6_10). C. D. Schulze, **Text in Diagrams: Challenges to and Opportunities of Automatic Layout**, thèse, 2019, [PDF primaire](https://macau.uni-kiel.de/servlets/MCRFileNodeServlet/macau_derivate_00001082/christoph_daniel_schulze.pdf), DOI 10.21941/kcss/2019/4.
- **[R23]** U. Rüegg, C. D. Schulze, T. Sprung, U. Wechselberg, R. von Hanxleden, **Edge Bundling for Dataflow Diagrams**, GD 2016, **poster de trois pages**, [PDF primaire](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/gd16-poster-paper.pdf). À employer comme base ciblée et à qualifier sur notre modèle, pas comme preuve générale pour tous les hubs CI/CD.
- **[R24]** U. Rüegg, **Sugiyama Layouts for Prescribed Drawing Areas**, thèse, 2018, [PDF primaire](https://macau.uni-kiel.de/servlets/MCRFileNodeServlet/macau_derivate_00003364/kcss_2018_01_print.pdf). Rüegg et al., **Using one-dimensional compaction for smaller graph drawings**, 2016, [DOI](https://doi.org/10.1007/978-3-319-42333-3_16). Sources pour aire prescrite, compaction et wrapping, à interpréter avec les contraintes de lisibilité.
- **[R25]** U. Rüegg, R. Lakkundi, A. Prasad, A. Kodaganur, C. D. Schulze, R. von Hanxleden, **Incremental diagram layout for automated model migration**, MODELS 2016, 185–195, [DOI](https://doi.org/10.1145/2976767.2976805). Compléments sur l'ordre de modèle : Domrös/von Hanxleden, 2022, [DOI](https://doi.org/10.5220/0010833800003124) ; Domrös/Riepe/von Hanxleden, **Model order in Sugiyama layouts**, 2023, [DOI](https://doi.org/10.5220/0011656700003417).
- **[R26]** H. C. Purchase, **Which aesthetic has the greatest effect on human understanding?**, GD 1997, [notice de l'autrice](https://eprints.gla.ac.uk/35804/). W. Huang, **An Eye Tracking Study into the Effects of Graph Layout**, 2008, [arXiv:0810.4431](https://arxiv.org/abs/0810.4431). Indications empiriques sur croisements et lecture ; pas de seuil produit universel.
- **[R27]** S. Domrös, R. von Hanxleden, M. Spönemann, U. Rüegg, C. D. Schulze, **The Eclipse Layout Kernel**, 2023, [arXiv:2311.00533](https://arxiv.org/abs/2311.00533), [version HTML et bibliographie](https://arxiv.org/html/2311.00533v1). Vue d'ensemble et aiguillage vers les publications des phases.

### Documentation de référence et licences

- **[R28]** [Index officiel des algorithmes ELK](https://eclipse.dev/elk/reference/algorithms.html) ; [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) ; [présentation des cinq phases, 21/08/2025](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html).
- Pages de stratégies consultées : [cycle breaking](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-cycleBreaking-strategy.html), [layering](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layering-strategy.html), [crossing minimization](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-strategy.html), [node placement](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html), [port constraints](https://eclipse.dev/elk/reference/options/org-eclipse-elk-portConstraints.html).
- Cas spécifiques : [SPOrE Compaction](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-sporeCompaction.html), [VertiFlex](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-vertiflex.html), [high degree nodes](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-highDegreeNodes-treatment.html). Ces pages documentent des capacités/options ; ce ne sont pas des preuves de garanties perceptuelles.
- **[L1]** [Texte officiel EPL-2.0](https://www.eclipse.org/legal/epl/epl-v20.html), notamment définitions et obligations de distribution ; [licence elkjs](https://github.com/kieler/elkjs/blob/master/LICENSE.md). L'expression et les notices sont à vérifier sur l'artefact exact retenu, pas sur master au moment d'une release future.

### Capital interne à conserver

- D : docs/graph-dataviz-reference-catalog.md et .json ; docs/graph-dataviz-ds-audit.md ; docs/graph-dataviz-checkpoint.md ; spec/SPEC_EVOL_DS_JSON_RENDER_STANDARD.md, notamment L-R1..L-R11 ; tools/elk-corpus-measure/README.md et evidence/.
- B : docs/decisions/2026-09-18-dossier-diagrammes/plan/plan-design-system.md ; conception-profil-placement-frame-v3.md ; SUIVI-transition-profil-frame.md. Les prescriptions anciennes favorisant elkjs comme moteur d'exécution sont supplantées par la demande actuelle DS immédiat + réimplémentations ; les exigences de lisibilité et distinctions de modèles restent utiles.
- H : docs/focus/portable-dossiers.md ; packages/focus/src/model.ts et validation/ ; packages/h2a/src/focus-build.ts ; packages/h2a/focus-kit/src/Canvas.svelte et App.svelte ; scripts de vendoring/build.
- [Retour propriétaire intégral](/home/antoinefa/src/sentropic/.tmp/focus-ci-efficiency-kit/owner-feedback-v3/OWNER-FEEDBACK-V3.md). Les lignes littérales, y compris l'ajout tardif, priment sur leur synthèse dans cette analyse.
