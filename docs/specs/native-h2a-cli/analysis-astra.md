# Analyse indépendante — première CLI agentique native h2a

Date de référence : 18 octobre 2026, America/Toronto.  
Statut : **analyse indépendante, recommandation provisoire pour confrontation par le conducteur avec l’autre analyse**. Ce document n’est ni une décision owner, ni une spec ratifiée, ni la double revue réconciliée demandée pour D-063.

**[JUDGMENT] L’owner attend un agent de travail qu’il lance avec h2a, capable de lire un dépôt, modifier des fichiers, exécuter ses vérifications, retrouver sa mémoire et reprendre sa session, en utilisant ses modèles et ses sièges via le gateway, sans dépendre de Claude Code.** Le produit manque encore ; les fondations sont substantielles. Le chemin recommandé est un moteur portable appartenant à sentropic, extrait et complété à partir de chat-core, consommé par le serveur local h2a. Un nouveau wrapper autour d’un terminal fournisseur ne suffirait pas.

**[JUDGMENT] Première livraison proposée : un pilote local explicite « h2a run native », avec deux transports qualifiés sans Claude Code, mémoire engram réellement activée pour le workspace pilote, Track et Focus raccordés, arrêt et reprise vérifiés. Cible : T0 + 48 heures murales agent ; enveloppe de prévision 36–60 heures.** T0 est le GO sur ce périmètre avec affectation effective des exécutants et des relecteurs. Pour un T0 le 18/10 à 22 h Toronto, la cible est le **20/10/2026 à 22 h Toronto**, avec une fenêtre du 20/10 à 10 h au 21/10 à 10 h. Ce n’est pas une durée déjà mesurée pour cette fonctionnalité ; la calibration et ses limites sont détaillées en D.

## Périmètre et qualité des preuves

- **[FACT] Sources de code h2a :** lectures par git show/git grep sur origin/main, relevé à **d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188**, paquet h2a/runtime 0.98.7.
- **[FACT] Sources de code sentropic :** origin/main à **81deb7bd78d99bca8d51f67c4f1d4424fb772d75**.
- **[FACT] Engram :** le checkout local s’appelle encore **/home/antoinefa/src/graphify** ; origin/main à **01697527c49e26a3d40d4917384f15d08fd36243**, paquet **@sentropic/engram 0.20.0**.
- **[FACT] Track :** lecture du fichier demandé, **/home/antoinefa/src/h2a/.track/events.jsonl**, y compris ses événements non committés. Les dates d’origine citées dans les reconstitutions ne sont pas les dates d’ajout au journal.
- **[FACT] Brouillons historiques :** les études de serveur en scratchpad et le dossier agentique de septembre existent dans l’arbre de travail ; leur statut est distingué des sources committées.
- **[TRANSMIS] Mesures de vélocité :** P50 ouverture→fusion de 2 h 45 sur 20 PR h2a ; chaîne mémoire engram contrats→release d’environ 21 h murales. Données de la saisine, non recalculées ici.
- **[FACT] Méthode :** inspection de sources et des licences ; aucun lancement de modèle, build, test, installation, modification de dépôt, commit ou Python. Les tests RED ci-dessous sont **à écrire et exécuter**, pas des résultats obtenus. La commande de consultation du graphe engram était indisponible ; aucune conclusion ne repose sur son index ancien.
- **[INCONNU]** Aucune preuve de l’état des services déployés, des quotas instantanés ni de la réussite d’un tour avec outils sur les sièges réels. Une dépendance déclarée ou un test présent ne prouve pas le fonctionnement en production.

Dans les références ci-dessous, **H/** désigne h2a au SHA ci-dessus, **S/** sentropic à son SHA et **E/** engram à son SHA. Les chemins « nouveaux » de D sont des propositions exactes de localisation, pas des fichiers prétendument existants.

## A. Sens de la demande owner

### A1. Verbatim retrouvé et provenance

**[FACT] 6 juillet — demande initiale, événement de création de x9**, item 01KWVNYNHVJGA8CCW566PG4WMH, journal ligne 252 au moment de la lecture :

> x9. et puis, quand est ce qu'on lance notre propre cli ? deja concu avec l'architecte (x9 mais devait deja exister)

**[FACT] La prémisse « déjà conçu avec l’architecte » a ensuite été corrigée dans Track**, même item, spec.amended du 29/07 à 22:11:03Z, ligne 756 : trois études existaient, mais leur co-validation avec l’architecte n’était pas attestée. Les questions avaient été déposées à une cible enregistrée mais non vivante. Cela explique un défaut de coordination ; ce n’est ni une annulation de la demande, ni une preuve que l’owner devait redemander le produit.

**[FACT] 13 juillet — orientation reprise dans la création d’un WP**, item 01KYNAXT7BX7PMFPMZKJ30WPB4, événement du 28/07 :

> notre propre cli devrait être articulée via sentropic avec le lane agents... Ça me semble valoir un workpackage en propre, et j'aimerais le débuter.

La citation contient déjà une ellipse dans le journal ; je ne prétends pas avoir retrouvé les mots omis.

**[FACT] 30 juillet, 7 août, 12 août — D-008**, item 01M53PPRSDQ2HSGNG660Z03YM8, reconstitution ajoutée le 17/10, ligne 1640 :

> ok faut bien prioriser l'avancement sur memory, et la cli. ou en est on pour la cli native (agents) stp ?

> et la cli native ???? personne ne bosse ou ne drumbleat (/loop des lanes + la tienne + objective loop) je ne comprends pas

> la on a un urgence liée a la migration tmux, les demandes récentes sont prioritaires, ce qui n'empeche pas de travailler sur la cli native et sur la mémoire e

La troisième phrase est explicitement marquée « tronqué à la source ». Elle démontre néanmoins que l’urgence PTY ne supprimait pas le travail CLI/mémoire.

**[FACT] 9 août — D-028**, item 01M53PQ0VAP8RJPVG93V1XTWDW, ligne 1676 :

> tes quesfions sonf mal instruites. h2a devrait perenniser d ores et deja les etats en sqlite. d ailleurs on parle de pg - avec l extension graphe ? et j ai deja dit que pour moi h2a etait un sentropic local. il faut penser dans cette direction on ira bcp plus vite

> en local, je prefererais que h2a repose sur du sqlite plutot que du postgres (cf thread graphify / memory)

**[FACT] 14 août — D-029**, item 01M53PQ1J69R6NM8XZWBQ1YV4Z :

> ya t il un putain de server h2a qui tourne. j'avais demandé que le mcp, que le focus et que les sessions soient portées par un putani de serveur h2a. on a 50 process autour des pty alors que peut être qu'un suffirait, avec un serveur on pourrait utiliser la communication interserveur fluide. a t on un putain de serveur h2a

> lance l'architecte qu'il lance l'étude de mutualiser un putain de serveur h2a persistant qui s'autoupgrade a chaque upgrade. ce serveur devrait être basé mostly sur une api commune avec sentropic ou en tout cas partager un coeur commun d'api. un 5.6sol max + revue agy gemini 3.6 high + revue focus 5 xhigh

**[FACT] 24 août — même D-029**, précision d’expérience utilisateur :

> en fait il faut que le serveur démarre seul et que je n'ai aps besoin de respécifier les ENDpoint pour de nouvelles sessions. s'il n'y en a pas en place, il faut le démarrer, sinon faut pas relancer ex quand je fais le premier h2a run... ou quand je fais h2a restore... si y a pas ca c'est inutilisable en pratique

**[FACT] 28 septembre — D-063**, item 01M53PQF40E43WRJSTVPER37KQ, reconstitution ajoutée le 17/10 à 01:13:25Z :

> pour la cli agentique: j'attends un décision dossier - revue opus 5.5 max + muse 1.3 xhighi - format h2a focus design system, avec des schema comme les schema récents capitalisés merci

> pour la cli agentique je veux un decision dossier. claude 5.5 xhigh + relecture muse 1.3 max merci - comme deja dis c un dossier h2a focus format design system avec des diagrammes d'archi que je veux

Les heures originales indiquées sont 00:40 et 23:37. Le journal reconstitué dit « statut selon les traces : inconnu » ; **la non-livraison à l’owner est fournie par la présente saisine**. L’existence d’un Markdown préparatoire ne la contredit pas.

**[FACT] 18 octobre — sièges**, item 01M58BBQN4RBDXY0T2BHTAT09W, créé à 20:30:58Z :

> Je voudrais que tu ajoutes un mcp de dispo des models enrolés (sieges) pour optimisation de gestion. On a deux sieges claude, 1 codex 2 muse et 1 agy. Faudrait gerer ca dans cluster mesh de facon perennes pour par exemple gere autom le switch dans les cli (eg switch de claude / muse puisqu il y en a 2) en reutilisant le mecanisme utilise ppur gh, mais aussi pour gerr les policy de delegation max en gonction des provisions (18/10)

**[TRANSMIS — verbatim de la saisine, non retrouvé mot pour mot dans les événements consultés] :**

> et la cli h2a ? c pour quand ??

> n'utilise plus claude code

La mission donne également engram comme gardien des ontologies de développement et de la mémoire, ainsi que le rattachement au stream S7. Ce sont des contraintes de cette analyse, même sans leur événement original retrouvé.

### A2. Outcome attendu et inférences

**[JUDGMENT] Le scénario d’acceptation implicite est le suivant :**

1. L’owner ouvre son dépôt et lance h2a ; il obtient une conversation de travail.
2. L’agent sait retrouver les instructions du dépôt et la mémoire autorisée, lire, chercher, modifier et lancer des commandes.
3. Le modèle provient du catalogue mesh ; le siège et le transport sont choisis par les politiques du gateway, avec une disponibilité explicite.
4. Le travail, les demandes de décision et les preuves passent par Track, h2a et Focus.
5. L’owner peut interrompre, fermer le terminal puis revenir à sa session sans réexpliquer son contexte.
6. Le fonctionnement ne dépend ni d’un processus Claude Code caché ni d’un assemblage manuel d’URLs et de démons.

Ce scénario est une synthèse. Les mots « shell », « reprise après fermeture » ou « deux transports qualifiés » ne sont pas tous dans les deux premières citations : ils dérivent des études et des demandes connexes, ou du périmètre recommandé.

**[FACT] Les études de juillet avaient déjà corrigé une confusion décisive :**

- la boucle **LLM↔outils d’une session** est le sujet de WP13 ;
- la boucle **conductor/objective/relance** relève d’une autre responsabilité ;
- la **supervision de processus/PTY** constitue encore une autre boucle.

Le backbone du 13/07, section « Owner clarification », fixe le moteur détenu par sentropic, option B. Sa recommandation antérieure « wrapper maintenant, boucle plus tard » est donc dépassée **dans le même document**. La reprendre aujourd’hui inverserait la clarification.

### A3. Ce qui n’est pas nécessaire pour le premier usage

**[JUDGMENT] Ne sont pas des prérequis à une première livraison utile :**

- créer ou entraîner un modèle ; réécrire llm-mesh, les transports, l’enrôlement ou la rotation des comptes ;
- disposer d’un terminal plein écran aussi complet que les CLIs établies ;
- livrer simultanément les 123 fonctionnalités, 33 E2E et 9 waves du brouillon maximal de septembre ;
- achever la fédération, le déplacement local↔K8s↔app, le fork temporel et les sous-agents dans une session ;
- remplacer tous les agents fournisseurs déjà installés, tous les PTY existants et tous les démons historiques lors du canari natif ;
- reconstruire un moteur mémoire, une ontologie locale concurrente, un autre Track ou un autre design system Focus ;
- basculer immédiatement les formes implicites « h2a » et « h2a run ».

**Limite de cette proposition :** différer ces capacités ne retire pas la cible de qualité de juillet, notamment « dépasser le moteur actuel de sentropic ». Il faut un **incrément explicitement nommé**, avec les limites affichées, et non rebaptiser une démonstration limitée « parité complète ».

**[JUDGMENT] « Ne plus utiliser Claude Code » n’implique pas à lui seul une interdiction de tous les modèles Anthropic.** En revanche, il interdit de présenter comme indépendant un moteur dont le transport appelle encore le CLI Claude. Le pilote recommandé exclut ce chemin ; un éventuel transport Anthropic indépendant serait une qualification ultérieure.

## B. Capital réel et écart à combler

### B1. Inventaire au niveau de preuve disponible

| Capital | État constaté [FACT] | Conséquence |
|---|---|---|
| Études WP13 | H/docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md ; H/docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md ; EVOL du 29/07 révision 3 | Intentions, exigences et migration sont déjà étudiées. L’EVOL se déclare « paper only » et reconnaît 33 clauses sur 35 sans mécanisme de rejet. Ce n’est pas un moteur livré. |
| Track WP13 | Racine **01KXDPBR505FKNV9XCZ45P638H**, code WP13 attribué le 13/07 ; x9, serveur unifié, D-008, D-063 et goldens y sont rattachés | La demande n’est pas orpheline. La racine concurrente 01KYNAXT… a été annulée après retour de x9 à WP13 : ne pas confondre dédoublonnage et abandon de l’agent natif. |
| Caractérisation du dispatch | H/packages/h2a/test/dispatch-characterization-goldens.test.js existe ; item 01M0GXK7… passé done le 18/10 | Un test de comportement actuel est un capital de non-régression, pas un test démontrant la boucle native. |
| Entrée CLI | H/packages/h2a/src/cli.ts:7711 renvoie l’aide sans commande ; H/packages/h2a-runtime/src/index.ts:6070 déclare « run <profile> [path] » | Pas de chemin natif implicite opérationnel dans ces sources. |
| Profils et lancement | H/packages/h2a-runtime/src/profiles.ts:11 contient shell, codex, opencode, claude, agy, gemini, mistral, muse, vibe ; pas de profil agent natif. H/.../run.ts:79 résout un profil et appelle un spawner PTY | Un profil est actuellement une commande externe. Le lancement et les événements terminal sont réutilisables, mais ne pensent ni n’exécutent la boucle d’agent. |
| « Native host » | H/packages/h2a-runtime/src/native-host.ts:1 décrit le remplacement de tmux par native-terminal ; H/.../native-terminal/host.ts, supervisor.ts, journal.ts, replay-buffer.ts | Capital de cycle de vie, PTY et reprise d’affichage. Le terme « native » ne prouve aucune autonomie LLM. |
| Moteur sentropic | S/api/src/services/chat-service.ts:3178 et :3579 contiennent runAssistantGeneration et son while ; chat-core possède runtime-tool-dispatch.ts, runtime-finalization.ts, runtime-run-prepare.ts, context-budget.ts et les ports de stockage/stream | Boucle réelle, outillage de conversation réel, extraction déjà avancée. La boucle complète n’est pas encore une bibliothèque de coding-agent prête à instancier dans h2a. |
| Outils locaux sentropic | S/packages/chat-core/src/runtime-tool-dispatch.ts:816 traite les outils locaux ; le bridge Cowork expose types/protocole/permissions | Il existe un chemin « demander un outil local puis recevoir son résultat ». Cela ne fournit pas automatiquement un exécuteur shell/fichiers prêt pour le CLI. |
| Persistance et reprise sentropic | Ports MessageStore, SessionStore, StreamBuffer, CheckpointStore ; adaptateurs Postgres ; S/api/src/services/queue-reaper.ts:14 échoue/finalise les chat_message abandonnés ; fork/tag lèvent encore une erreur dans postgres-checkpoint-adapter.ts:209–213 | Sauvegarder une conversation et rejouer un flux ne suffisent pas à reprendre un effet externe interrompu. La reprise sûre doit être spécifiée. |
| Gateway h2a | H/.../gateway-host/host.ts compose cluster-mesh et son namespace gateway ; CodexRuntimeClient, CloudCodeRuntimeClient, MuseRuntimeClient et autres transports sont injectés | Capital utilisable pour les sièges. Les routes LLM et l’authentification restent dans ces composants. |
| API gateway | S/packages/llm-gateway/src/router/index.ts expose Messages, Chat Completions, Responses et /v1/models filtré selon l’appelant | Pas besoin de construire un nouveau proxy. Le protocole retenu doit être éprouvé sur un aller-retour d’outil, pas seulement sur une réponse textuelle. |
| Catalogue | H/.../gateway-model-catalog/model-catalog.ts ; merge #373 **46b82b427** ; S/packages/llm-mesh/src/catalog.ts | Muse Spark/Wonder, Sol/Astra et Argon sont déclarés. Déclaration, droit d’usage d’un compte et capacité effective de tool-use sont trois preuves différentes. |
| Mémoire | E/package.json 0.20.0 exporte ./memory-tools ; E/src/memory-tools/{reads,writes}.ts et E/engram-memory/{engine,sqlite,reads,recall}.ts | Six opérations mémoire et un moteur existent ; les fonctions attendent les ports et le contexte fiable du host. L’import ne démarre aucun service et n’active rien. |
| Consommation mémoire | S/packages/cluster-mesh/src/memory.ts expose encore H2aGraphifyMemoryPort/createGraphifyMemoryAdapter ; H/packages/h2a/src/runtime/memory/ contient encore l’adaptation historique | Le raccordement au nouveau contrat MCP n’est pas démontré. Les anciennes formes ne doivent pas être utilisées comme substitut silencieux. |
| Track et Focus | Track est une dépendance du core h2a ; H/packages/h2a/src/runtime/mcp/ sert les outils ; H/.../runtime/focus/serve.ts sert le Focus packagé ; #377 est fusionnée | On peut consommer ces surfaces. Il faut encore prouver qu’un agent natif les découvre, les appelle et reçoit la décision correspondante. |

**[FACT] Versions à ne pas confondre :** h2a 0.98.7 déclare **cluster-mesh 0.16.0**, **llm-gateway 0.20.0**, **llm-mesh 0.26.0**. Le source sentropic observé porte **cluster-mesh 0.19.1** et **chat-core 0.1.7**. « Présent dans sentropic main » ne signifie pas « déjà consommé dans h2a ». Le plan doit qualifier la combinaison de paquets distribués.

### B2. Les trois écarts qui changent le plan

**1. La disponibilité du moteur est partielle, pas nulle et pas complète.**

**[FACT]** Le while demeure dans chat-service, et une partie du dispatch reçoit des callbacks de domaine app. MeshDispatchPort transporte encore des formes opaques. ChatRuntime fournit déjà la consommation de streams, les résultats d’outils, des zones de budget et de nombreuses opérations de session. Ce sont des éléments concrets à réutiliser.

**[JUDGMENT]** Copier chat-service dans h2a serait le mauvais raccourci. Il faut extraire une boucle portable qui garde les services de l’app derrière leurs ports. Le risque principal de l’option recommandée est le coût de cette extraction, à mesurer dès L0/L1.

**[FACT]** Le chemin chat historique invoque le runtime applicatif via S/api/src/services/chat/mesh-dispatch-adapter.ts. Sentropic possède désormais aussi gateway-route-plane.ts et gateway-wire-adapter.ts : la phrase de juillet « pas de gateway dans sentropic » serait donc trop large aujourd’hui. En revanche, cela **ne prouve pas** qu’une session h2a native serait déjà médiée par le gateway local, ni que tous les execution features sont supportés ; gateway-route-plane.ts déclare explicitement des capacités non servies. D’où un adaptateur gateway et une qualification dédiés.

**2. Les six sièges ne constituent pas six moteurs utilisables de façon équivalente.**

**[FACT]** H/.../gateway-host/claude-seat-client.ts:1 construit ClaudeCodeRuntimeClient sur OfficialClaudeCodeCliRunner, qui résout « claude » dans PATH. H/.../claude-code-cli-runner.ts:253 refuse les requêtes contenant des outils clients, faute de transport d’outils qualifié. Cette route pose donc **deux** problèmes pour ce pilote : dépendance à Claude Code et incapacité déclarée à servir ces outils.

**[FACT]** Les clients Codex et Muse de llm-mesh utilisent des transports HTTP dans leurs sources, sans lancer leur CLI d’agent pour chaque tour. Ils sont des candidats crédibles au premier pilote. Le login/import d’un siège reste distinct de l’exécution de la boucle.

**[JUDGMENT]** Qualifier d’abord **un modèle Codex (Sol ou Astra) et un modèle Muse**, avec outils, streaming, annulation et rejeu de résultats. Argon/ag y suit la même qualification, sans être une condition au premier usage. Ne pas imposer un transport inconnu pour « utiliser les six sièges », ni encoder un quota à partir du nombre de comptes.

**3. Engram 0.20.0 n’est pas une preuve d’activation chez h2a.**

**[FACT]** E/src/mcp/memory/contracts.ts fixe les noms :

- engram_memory_search ;
- engram_memory_get ;
- engram_memory_capture ;
- engram_memory_request_admission ;
- engram_memory_withdraw ;
- engram_memory_forget.

**[FACT]** E/src/mcp/memory/topology.ts annonce explicitement : tools_default_enabled=false, opt-in persistant du host et du tenant, pas de fallback silencieux, stockage embedded-local SQLite, releases de consommation séparées. Les décisions D11 de revue restent dans AdmissionPolicy/EvidenceVerifierPort du host ; une capture n’est pas une admission.

**[FACT]** Le manifeste cluster-mesh 0.19.1 consulté n’exporte pas encore le sous-chemin ./memory attendu par cette topologie. Son index principal réexporte le fichier memory.ts historique. Il manque donc aussi une surface distribuée conforme, pas seulement une ligne de configuration h2a.

**[FACT]** L’export public ./memory-tools contient les façades et des types. L’engram-memory interne est privé ; le manifeste principal ne publie pas une entrée explicite de construction du runtime SQLite. Le test packed des lectures injecte des facets de test ; celui des écritures importe son moteur depuis une fixture du dépôt. Cela démontre les façades empaquetées, **pas une installation h2a autonome ouvrant un vrai store**.

**[JUDGMENT]** Il faut traiter la consommation distribuée du moteur comme un point à prouver, avec un lot borné d’export public si nécessaire. Ne pas résoudre ce manque par une copie de source, un import d’un checkout voisin ou un « mock » baptisé mémoire active.

### B3. Serveur unifié, S7 et dossier manquant

**[FACT]** Les études de serveur retrouvées comprennent :

- scratchpad/ETUDE-serveur-unifie-20260814T223519Z.md ;
- scratchpad/ETUDE-serveur-unifie-FABLE5-20260815T013021Z.md ;
- scratchpad/PLAN-BUILD-serveur-unifie-REV4-20260816T160535Z.md ;
- docs/specs/2026-08-20-SPEC_integration-cluster-mesh-serveur-local-v5.2.md.

Elles distinguent déjà **un service d’administration unique** et la possibilité d’un carrier PTY séparé pour survivre aux upgrades. Elles interdisent de confondre replay de terminal et état sémantique d’agent.

**[FACT]** Aujourd’hui, les sources observées montrent encore des constructions distinctes : gateway-host, mcp-central (opt-in), native-terminal, Focus serve. Le gateway-host dit expressément que ses ports de session-control sont indisponibles, H/.../gateway-host/host.ts:281. Il ne faut pas confondre son /v1/sessions — registre de routage gateway — avec l’API du futur agent.

**[INCONNU]** Le nom de stream « S7 » n’a pas été rattaché à une définition probante dans ces sources. Les occurrences S7 dans des identifiants Track ou dans les index de sources mémoire ne sont pas une preuve de ce stream. La direction serveur unique est, elle, abondamment attestée. Le conducteur doit fournir le lien précis de S7 pour raccorder les lots ; cela ne justifie pas une nouvelle étude générale.

**[FACT]** docs/specs/2026-09-28-DOSSIER_agentic-cli-maximal.md et la STUDY r2.2 du 27/09 sont présents mais non suivis dans ce checkout et absents d’origin/main. Le dossier porte encore des réserves de contrôle de corrections. C’est un capital de conception, pas un dossier dont la présentation, la décision ou la mise en œuvre sont prouvées.

**[JUDGMENT]** Le défaut observable est donc un passage incomplet **exigences → contrat consommable → intégration → usage owner**, aggravé par la confusion entre infrastructures natives et agent natif. Le nombre de specs ou de tests de host ne mesure pas cet outcome.

## C. Options, licences et recommandation

### C1. Comparaison

Les durées ci-dessous sont des **prévisions [JUDGMENT]**, pas des mesures propres à ces options.

| Option | Meilleur argument POUR | Meilleur argument CONTRE | Dépendances, licence, réversibilité | Coût relatif pour le même outcome |
|---|---|---|---|---|
| **A — Extraire/compléter le moteur sentropic et le consommer dans h2a** | Réutilise orchestration, outils, budget de contexte et ports ; respecte l’ownership déjà demandé ; permet à l’app et au CLI de partager les corrections | L’extraction BR14b est incomplète ; elle peut entraîner du domaine app et des régressions ; aucun shell coding ni crash-resume complet n’est offert prêt à l’emploi | Sources sentropic et chat-core MIT, h2a MIT. Dépend des releases sentropic et de ports réellement autonomes. Réversible si la façade SessionPort reste stable ; investissement en extraction peu jetable | **36–60 h** pour le pilote décrit en D si extraction bornée ; estimation invalide si elle requiert une refonte du chat |
| **B — Adopter un moteur d’une CLI ouverte dans un paquet sentropic** | Boucle coding, outils, expérience interactive et historique déjà éprouvés ; réduit le travail d’exécution ; peut produire vite un canari | Sémantique de sessions/permissions/compaction amont à concilier avec h2a ; intégration mémoire, Focus et sièges toujours à faire ; fork lourd = maintenance continue | Pi et OpenCode MIT vérifiés sur leurs sources publiques. Pi fournit un SDK TypeScript in-process ; OpenCode est déjà un profil externe de h2a. Pin de version et audit des dépendances requis avant adoption ; licence du code ≠ droit d’accès aux sièges | Canari coding potentiellement **12–24 h** ; outcome complet plutôt **32–60 h**, car mémoire et composition restent sur le chemin critique |
| **C — Construire une boucle neuve à partir de h2a-runtime** | Maîtrise immédiate du CLI, du PTY et des conventions locales ; dépend moins de l’extraction app ; petite boucle texte/outils rapide à démontrer | Duplique le moteur appartenant à sentropic ; tous les problèmes de contexte, durabilité, contrôle et outils sont à reconstruire ; le prototype peut figer la mauvaise frontière | h2a MIT et dépendances gateway existantes. Faible dépendance initiale, forte dette ensuite ; déplacer plus tard un état de session déjà utilisé coûte cher | Démo **8–16 h** concevable ; pilote comparable **40–72 h ou plus**, sans avantage démontré de qualité |

**[FACT — licences consultées]**

- h2a : LICENSE à son SHA ; MIT, copyright 2026 Fabien Antoine.
- sentropic, chat-core, llm-mesh, cowork-bridge : LICENSE/manifeste à leur SHA ; MIT.
- engram : manifeste à son SHA ; MIT.
- OpenCode : [LICENSE](https://github.com/anomalyco/opencode/blob/dev/LICENSE), MIT.
- Pi : [LICENSE](https://github.com/badlogic/pi-mono/blob/main/LICENSE), MIT ; [SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md), intégration TypeScript, sessions, événements, outils et modèle injectables. Le README actuel renvoie vers earendil-works/pi et @earendil-works/pi-coding-agent : vérifier l’identité exacte du paquet au pin, plutôt que figer un ancien nom de mémoire.

Ces lectures portent sur les licences de tête de dépôt ; aucune nomenclature exhaustive des dépendances transitives n’a été établie. L’intégration MIT doit conserver les notices. Aucune option n’autorise à reproduire le code de Claude Code ni à inventer un nouveau mode d’authentification fournisseur.

**[JUDGMENT] Une CLI ouverte comme simple sous-processus fournit un pont utile, mais « h2a run opencode » ne devient pas, par changement de nom, la boucle que sentropic possède.** L’option B satisfaisante est un moteur adopté sous une frontière sentropic maîtrisée, avec garanties testées. Son code peut rester amont ; maîtriser ne signifie pas tout réécrire.

### C2. Recommandation et critère de renversement

**[JUDGMENT] Recommandation A**, avec un engagement de preuve très tôt : un consommateur isolé doit pouvoir effectuer un vrai cycle fake LLM→outil→LLM avec le paquet extrait, sans importer api/, sans Postgres et sans serveur central. Les transports réels sont qualifiés en parallèle.

Le périmètre de l’extraction est **le noyau de contrôle d’un tour et ses ports**, pas une migration générale des milliers de lignes du chat. Les branches de domaine app restent des callbacks de l’app. Le nouvel usage natif et l’usage app doivent partager ce noyau ; il ne faut pas maintenir deux while divergents derrière le nom chat-core.

**Argument le plus fort contre A :** ce moteur conversationnel peut rester trop couplé à l’app. Une extraction précipitée risquerait de prendre plus de temps qu’intégrer un SDK coding existant, tout en livrant une ergonomie et des outils moins bons. L’historique depuis juillet donne du poids à ce risque.

**Ce qui ferait préférer B :** à T0 + 4 h, l’extraction réclame des services métier, une migration générale de schéma ou la réécriture de la moitié du cycle ; et un spike Pi prouve, sur le gateway réel, les outils injectés, le contrôle des autorisations, l’arrêt et la récupération des événements, sans deuxième autorité de session. Le conducteur présenterait cette preuve comparative et ferait appliquer l’arbitrage owner sur la dépendance amont. Ce n’est pas un basculement silencieux autorisé par le présent texte.

**Pourquoi pas C :** ses gains initiaux concernent surtout le prototype. Pour l’owner, l’état durable, la mémoire gouvernée et la maintenance comptent davantage que quelques heures gagnées sur un premier prompt.

**Réversibilité :** garder stables le contrat de session, les IDs d’événements, les références d’artefacts et les ports d’outils/gateway permet de changer le noyau avant généralisation. Une fois de vraies sessions persistées, toute substitution doit préserver les données ou fournir une migration explicite ; pas de promesse de rollback par simple downgrade.

**Pré-mortem [JUDGMENT] :** six mois plus tard, cet effort aurait échoué si nous avions de nouveau renommé une brique « native », empilé des exigences sans canari owner, ou livré un moteur parallèle qui ne partage ni mémoire ni contrôle avec sentropic. L’autre risque est le canari déclaré terminé sur un mock alors que le paquet publié, le siège réel ou l’admission mémoire ne fonctionne pas. L’acceptation proposée exige précisément ces preuves externes au code de la boucle.

**Intérêt du présentateur :** prolonger les specs et choisir le code que je viens de lire serait le chemin le plus confortable pour mon analyse. Cela ne prouve pas que l’extraction soit le meilleur moteur. **Intérêt owner :** obtenir un outil utilisable, garder l’autorité sur les données et les effets, réutiliser les investissements et limiter la dépendance durable à un fournisseur ou à un fork.

## D. Premier incrément utilisable, lots et date

**[PROPOSITION] Architecture du pilote :** les boîtes désignent des responsabilités et des modules, pas un processus imposé par boîte. La composition ci-dessous est à réaliser ; elle ne décrit pas le déploiement actuel.

~~~mermaid
flowchart TB
    U["Owner"] --> CLI["h2a native CLI"]
    U --> F["Focus client"]
    subgraph LOCAL["Local h2a service · common lifecycle"]
        G["Authenticated session control"]
        LOOP["Sentropic portable agent loop"]
        STATE["Ordered session events · SQLite adapter"]
        MCP["Scoped MCP tool surface"]
        GW["Gateway · mesh routing and seats"]
        MEM["Sentropic memory binding · Engram runtime"]
        TOOLS["Local tool policy and executor"]
        G --> LOOP
        LOOP --> STATE
        LOOP --> GW
        LOOP --> MCP
        LOOP --> TOOLS
        MCP --> MEM
    end
    CLI --> G
    F --> G
    MCP --> TR["Track · existing read tools and authorized CLI writer"]
    MEM --> DB["Engram SQLite store · memory authority"]
    GW --> MODELS["Qualified model transports"]
    TOOLS --> WS["Workspace and supervised tool processes"]
~~~

### D1. Expérience livrée

**[PROPOSITION — texte de spec en anglais]**

> **Native Agent Pilot — Local execution**
>
> The pilot SHALL provide an explicit native session through “h2a run native”. It SHALL support an interactive prompt and an explicit headless form. Native model selection SHALL be a gateway intent, never a vendor CLI selector.
>
> The pilot SHALL run a Sentropic-owned portable LLM/tool loop, with workspace instructions and selected skills, file read/search/edit tools, bounded shell execution, streaming output, interruption, and persisted session history.
>
> The initial qualification matrix SHALL include one Codex-seat model and one Muse-seat model. Every model call, including compaction or auxiliary model calls, SHALL pass through the configured gateway. Route selection SHALL preserve the requested model unless a separately configured policy authorizes a substitution. No native request or failover path SHALL launch Claude Code.
>
> One local h2a service SHALL own native session control and expose the native client, MCP, gateway and Focus integration through a common lifecycle and authenticated local endpoint. The first native launch SHALL start or reuse this service without manual endpoint configuration. The pilot SHALL NOT require a new per-session agent CLI, MCP daemon or LLM gateway process. Existing vendor PTY carriers may remain under their current lifecycle during the staged rollout.
>
> Each session SHALL have an authenticated principal, stable agent identity, workspace binding, model intent, versioned state, single-writer ownership, ordered events and an explicit stop reason. Reconnecting a terminal SHALL not replay completed tool effects. A crash after an effect starts but before its outcome is durably known SHALL produce an unresolved-effect state; the engine SHALL NOT automatically repeat that effect.
>
> Engram SHALL remain the authority for memory records, lifecycle and ontology semantics. The host SHALL compose the published memory tools with a real local SQLite store and trusted host policy. Memory SHALL be disabled unless the required host and tenant activation is persisted. Capture SHALL create a candidate, not self-approve an accepted fact. Admission SHALL obey the existing evidence and review policy.
>
> The agent SHALL be able to read its Track context, attach execution evidence through the authorized single-writer path, and present a Focus decision linked to the same pending request. Tool execution SHALL never treat a model claim or a relayed response as a principal authorization.
>
> Native readiness SHALL fail before session creation when the engine, route capabilities, required memory profile or package contract is unavailable. The CLI SHALL state the missing capability and SHALL NOT silently fall back to a vendor, an ungoverned provider connection or legacy memory.
>
> The pilot SHALL preserve explicit vendor routes. Bare “h2a” and exact “h2a run” SHALL switch together only in the later coordinated contract migration, after the explicit native path is qualified and the migration notice has shipped.
>
> Full fork/time-travel, transparent recovery of arbitrary external effects, in-session subagents, remote placement, federation and fleet-wide legacy retirement are outside this pilot. Their existing target requirements remain tracked.

**[JUDGMENT] Exemple d’usage prévu :** « h2a run native --model gpt-6.1-sol », puis une demande réelle dans un workspace pilote. Une deuxième exécution utilise « --model muse-wonder-1.0 » si cette route passe la qualification. Ces commandes sont **cibles**, pas des instructions prétendument utilisables aujourd’hui.

**[PROPOSITION] Limite de sécurité à faire décider, sans vocabulaire trompeur :** le canari peut viser un workspace local de confiance, avec politiques et consentement pour les commandes à effet. Un contrôle de chemins ou une confirmation avant shell ne constitue pas un sandbox OS. Si l’owner exige l’isolation forte dès ce premier usage, le plan doit intégrer le backend correspondant et la prévision de 36–60 h devient conditionnelle à sa disponibilité.

### D2. Lots avec fichiers exacts et tests RED

Les scopes suivants forment un plan proposé, à rattacher au WP13 existant. **N = nouveau ; E = existant.** Les fichiers de production ne sont modifiés qu’après le RED correspondant. Les responsabilités sont des rôles de dépôts, pas des titulaires vivants supposés.

**L0 — Contrat du pilote et preuve de consommation. Responsable : h-agents + owner du moteur sentropic ; conduite : h-cond.**

- **h2a :** N docs/specs/2026-10-18-SPEC_EVOL_native-agent-first-increment.md ; N packages/h2a/test/native-agent-contract.test.js.
- **sentropic :** N packages/chat-core/src/agent-session-port.ts ; N packages/chat-core/tests/agent-session-contract.test.ts ; E packages/chat-core/src/index.ts.
- **RED proposé :** “An isolated consumer can negotiate native capabilities and normalize a launch intent without importing the application, opening a database or spawning a vendor CLI.” Cas moteur absent, version incompatible, modèle sans tool-use : aucun CreateSession.
- **Sortie :** schéma minimal Create/Attach/Input/Interrupt/Resume/Stop, événements, autorisations, budgets et refus ; preuve de l’import isolé. Le contrat réutilise les types existants quand ils conviennent.
- **Dépendances :** décision de périmètre du pilote. Le conducteur reconnecte le contrat aux questions A1–A4/Q1–Q5 de juillet, avec un responsable joignable ; pas d’attente indéfinie d’une ancienne session.

**L1 — Boucle portable réellement partagée. Responsable : sentropic agents/chat.**

- **sentropic :** N packages/chat-core/src/runtime-agent-loop.ts ; E packages/chat-core/src/runtime.ts, runtime-tool-dispatch.ts, runtime-finalization.ts, runtime-run-prepare.ts, mesh-port.ts, index.ts ; E api/src/services/chat-service.ts.
- **Tests :** N packages/chat-core/tests/runtime-agent-loop.test.ts ; N api/tests/services/chat-agent-loop-parity.test.ts ; réutilisation des tests runtime-tool-loop, runtime-stream-consumer, runtime-finalize-turn et context-budget existants.
- **RED proposé :** “A scripted model requests a read, receives the result, requests an edit, receives the result, and produces a final answer; cancellation, malformed arguments, tool refusal, iteration exhaustion and a truncated stream cannot become successful completion.”
- **Preuve de non-duplication :** le consommateur app et le consommateur natif appellent le même noyau ; la fixture app conserve ses événements observables. Pas de copie intégrale de chat-service.
- **Dépendances :** L0. Toute dérive vers une refonte générale déclenche l’arbitrage A/B, pas une extension silencieuse du scope.

**L2 — Gateway, sièges et protocoles d’outils. Responsable : h-runtime ; sentropic mesh/gateway si un défaut amont est démontré.**

- **h2a :** N packages/h2a-runtime/src/native-agent/gateway.ts ; N packages/h2a-runtime/src/native-agent/gateway.test.ts ; E packages/h2a-runtime/src/gateway-host/host.ts, sessions.ts ; E packages/h2a-runtime/src/routing-preferences.ts seulement pour porter la politique native.
- **sentropic, qualification :** N packages/llm-gateway/tests/native-agent-tool-roundtrip.test.ts. Les fichiers transport/codex-runtime-client.ts et transport/muse-runtime-client.ts de llm-mesh restent consommés tels quels, sauf échec identifié.
- **RED proposé :** “The caller receives fragmented tool arguments intact, returns the matching tool result, continues on the same authorized route, and cancels the transport. Catalog-only, unavailable-seat and unsupported-tool routes fail before execution.”
- **Preuve interdiction Claude Code :** qualification avec binaire claude indisponible, trace de processus et test de sélection/failover ; aucun branchement native vers OfficialClaudeCodeCliRunner. Pas de secret fournisseur dans le transcript.
- **Dépendances :** L0 ; parallèle à L1. Le MCP global d’inventaire/provisions des sièges est une extension utile, pas un prétexte pour réécrire le route planner avant ce tour qualifié.

**L3 — Exécuteur local et durabilité native. Responsable : h-runtime, contrat de session possédé par sentropic.**

- **h2a :** N packages/h2a-runtime/src/native-agent/tools.ts, tool-policy.ts, session-store.ts, instructions.ts ; N packages/h2a-runtime/src/native-agent/tools.test.ts, tool-policy.test.ts, session-store.test.ts, instructions.test.ts. Les noms abrégés partagent le même répertoire native-agent/.
- **Contrats réutilisés :** SessionPort de L0, ports chat-core et identité/génération cluster-mesh. L’adaptateur SQLite h2a ne décide pas une seconde sémantique de session.
- **RED proposé :** “Workspace and nested directory instructions apply to the intended files; selected skills are loaded without becoming execution grants. A denied edit changes no file; a symlink escape is rejected; shell cancellation terminates the supervised process group; bounded output cannot exhaust the context; reopening the store preserves transcript and event order.”
- **RED de reprise :** tuer le worker avant effet, après effet mais avant receipt, et après receipt. Aucun effet terminé n’est répété ; un effet ambigu reste explicitement unresolved. Deux writers concurrents ne peuvent pas commander la même session.
- **Acceptation :** arrêt explicite, limites de tours/temps/sortie, plafond de contexte ; une limite financière n’est annoncée que si le gateway fournit les données et garanties nécessaires.
- **Dépendances :** L0 ; en parallèle du noyau, puis assemblage avec L1.

**L4a — Engram consommable depuis un paquet installé. Responsable : engram.**

- **engram, si la preuve de consommation confirme le manque d’export :** N src/memory-runtime.ts ; E package.json, tsup.config.ts ; N tests/memory-runtime-packed.test.ts.
- **Réutilisation sans duplication :** engram-memory/engine.ts, sqlite.ts, reads.ts, recall.ts et store-factory.ts. La façade nouvelle expose la construction autorisée, jamais les fonctions internes permettant de marquer artificiellement un store comme fenced.
- **RED proposé :** “A clean installed-package consumer opens a real temporary SQLite store, captures a candidate, closes the runtime, reopens it and obtains an authorized result using the public memory tools, without source aliases, a sibling checkout or an in-memory fixture.”
- **Acceptation :** gardes d’identité/policy et lock réel conservés, aucune activation par simple import. Nom proposé d’export : ./memory-runtime ; l’owner engram peut conserver une entrée publique équivalente déjà distribuée s’il en fournit la preuve.
- **Dépendances :** contrat mémoire 0.20.0 existant ; pas de redesign d’ontologie. Si une entrée utilisable est déjà prouvée, ce sous-lot se réduit à la qualification et ne crée aucun nouvel export.

**L4b — Consommation mémoire par cluster-mesh et h2a. Responsables : sentropic cluster-mesh puis h-runtime.**

- **sentropic :** N packages/cluster-mesh/src/compose/memory.ts ; E packages/cluster-mesh/src/memory.ts, index.ts, package.json ; N packages/cluster-mesh/tests/memory-native-consumer.spec.ts.
- **h2a :** N packages/h2a-runtime/src/native-agent/memory.ts ; N packages/h2a-runtime/src/native-agent/memory.test.ts ; E packages/h2a/src/runtime/mcp/tools.ts, handlers.ts, server.ts pour l’exposition/injection des outils autorisés.
- **RED proposé :** “Before persisted activation, the native session sees no memory tools; after activation, the six canonical tool names use trusted host scope and real SQLite. A forged principal, another workspace, a stale page or an unavailable module never reaches the store.”
- **RED d’admission :** une capture n’apparaît pas comme accepted_current ; un modèle ne peut forger une preuve de revue ; redémarrage, retry et idempotency key ne créent pas de double mutation.
- **Migration :** aucune invocation native des anciens ports Graphify ; aucune rétrogradation vers recall V2. La disposition M8 d’engram prévoit leur retrait global, y compris les huit fichiers legacy listés dans topology.ts. Le pilote ne se déclare pas migration globale achevée tant que les autres consommateurs n’ont pas été basculés et vérifiés.
- **Dépendances :** L4a ou preuve d’export équivalente, publication sentropic qualifiée, configuration d’activation du workspace pilote. Une nouvelle release engram n’est pas exigée si 0.20.0 est déjà consommable telle quelle.

**L5 — Composition du service et CLI ; Track/Focus dans le parcours. Responsables : h-runtime + h-agents, appui h-plugins/Focus sur leurs surfaces.**

- **h2a runtime :** N packages/h2a-runtime/src/local-server.ts ; N packages/h2a-runtime/src/native-agent/session-service.ts, cli.ts, mcp-client.ts ; E packages/h2a-runtime/src/index.ts, central-mcp.ts, gateway-host/host.ts.
- **h2a core :** E packages/h2a/src/bin.ts, bin-routing.ts, cli.ts, cli-contract.ts ; E packages/h2a/src/runtime/mcp-central.ts et runtime/focus/serve.ts pour exposer leurs fabriques au lifecycle commun plutôt que lancer un listener autonome supplémentaire.
- **Tests :** N packages/h2a-runtime/src/local-server.test.ts ; N packages/h2a/test/native-agent-dispatch.test.js ; N packages/h2a/test/native-agent-track-focus.test.js.
- **RED proposé :** “Two concurrent first launches create one service; one native session can use gateway, memory, h2a/Track and Focus without a per-session sidecar. Detaching the terminal leaves the session inspectable; attaching from a cursor has no silent event gap.”
- **RED autorité :** la décision Focus corrèle la bonne demande et le bon principal ; un autre workspace ou un retour obsolète ne débloque pas l’action. Les écritures Track utilisent la voie CLI autorisée et le writer désigné, jamais une réécriture de .track.
- **Compatibilité :** le routeur distingue une session native d’un profil fournisseur avant la résolution PTY. Les core/runtime restent liés par la frontière versionnée et les fabriques injectées ; pas de dépendance statique cyclique.
- **Dépendances :** L1–L4 pour l’acceptation finale ; le squelette de composition peut être préparé en parallèle. La bascule de toute la flotte PTY, le handoff sans interruption de tous les anciens démons et la fédération restent dans les lots serveur/S7 correspondants.

**L6 — Qualification owner, distribution et avis de migration. Responsable : h-cond pour la réception ; builders et reviewers distincts.**

- **h2a :** N packages/h2a/test/native-agent-e2e.test.js ; N scripts/native-agent-smoke.mjs ; E packages/h2a/test/dispatch-characterization-goldens.test.js ; E packages/h2a/package.json, packages/h2a-runtime/package.json, package-lock.json ; N docs/specs/evidence/2026-10-18-native-agent-pilot.md ; E README.md et CHANGELOG.md.
- **Autres manifestes :** chaque repo publie seulement les paquets réellement modifiés ; leurs manifests/lockfiles et exports sont vérifiés dans leurs lots, avec ordre engram → sentropic → h2a si L4a a nécessité une release.
- **RED proposé :** “From installed tarballs and a fresh isolated workspace, the owner can request a small code change, inspect the diff, run its test, capture a cited memory candidate, read Track, receive a Focus decision, interrupt, restart and resume on two qualified routes.”
- **Preuve attendue :** versions exactes, IDs de routes non secrets, effets de fichiers, exit codes, stop reasons, receipts mémoire et absence de processus Claude Code. Tests déterministes aux frontières puis canari live limité ; un mock ne clôture pas la qualification live.
- **Release :** aucune bascule implicite anticipée. Le canari est livré installable et documenté ; les versions et l’éventuelle annonce du futur changement de défaut sont coordonnées.
- **Dépendances :** L5 et les releases consommables. Aucun « done » fondé uniquement sur la rédaction de ce plan.

**[JUDGMENT] Les fichiers d’intégration proposés restent bornés par leurs responsabilités.** Les fonctions existantes de policy, de routage, de mémoire et de rendu doivent être appelées, non recopiées. Les scopes exacts seront revus après le RED de L0 ; une découverte de coût ne donne pas mandat pour modifier arbitrairement d’autres packages.

### D3. Chemin critique et calendrier en temps mural agent

~~~mermaid
flowchart LR
    L0["L0 · contrat et preuve portable"]
    L1["L1 · moteur sentropic"]
    L2["L2 · gateway et deux routes"]
    L3["L3 · outils et état local"]
    E["L4a · paquet mémoire consommable"]
    M["L4b · cluster-mesh et activation host"]
    L5["L5 · service et client, Track, Focus"]
    L6["L6 · paquet installé et canari owner"]
    L0 --> L1
    L0 --> L2
    L0 --> L3
    L0 --> E
    E --> M
    L1 --> L5
    L2 --> L5
    L3 --> L5
    M --> L5
    L5 --> L6
~~~

**[TRANSMIS] Les deux étalons :** 2 h 45 = 165 minutes de médiane PR ouverte→fusion ; environ 21 h pour une chaîne mémoire réelle traversant contrats et release.

**[JUDGMENT] Modèle de prévision :**

- quatre passages de revue/intégration séquentiels sur le chemin critique représentent un repère de **4 × 2 h 45 = 11 h** ;
- construction avant ouverture des PR, avec moteurs/outils/gateway et mémoire traités en parallèle : **14–22 h** sur le chemin critique ;
- assemblage client/service et corrections d’intégration : **6–10 h** ;
- canari de paquets installés et disponibilité de publication : **3–5 h** ;
- réserve explicite pour incompatibilité de paquet ou reprise de revue : **4–8 h**.

Total de scénario : **38–56 h**, élargi à **36–60 h** pour éviter une précision injustifiée ; cible de conduite **48 h**. Ces postes sont à chronométrer séparément afin de ne pas compter une même attente deux fois. Les sous-lots ne correspondent pas obligatoirement chacun à une release ; les éléments d’une même release sentropic peuvent converger ensemble.

**La médiane d’une PR ne mesure pas sa construction et ne se somme pas comme un percentile garanti.** Elle n’est ni un P90, ni une preuve que les lots de cette fonctionnalité ont la même distribution. Les 21 h d’engram sont un contrôle de plausibilité d’une chaîne multi-contrats ; il ne faut ni les ajouter mécaniquement aux 11 h ni prétendre refaire gratuitement toute cette chaîne.

| Jalon de conduite proposé | Échéance depuis T0 [JUDGMENT] | Preuve attendue |
|---|---:|---|
| Extraction et surface mémoire qualifiables | +4 h | Consommateur isolé, liste fermée des manques ; choix A maintenu ou comparaison B instruite |
| Boucle, outils et deux routes réunis en canari technique | +16 à +24 h | Tour avec effet observable et annulation ; ce jalon ne clôture pas le produit |
| Mémoire installable/activée et service assemblé | +30 à +42 h | Vrai SQLite, contrats publiés consommés, Track/Focus dans le parcours |
| Pilote utilisable livré | **+48 h cible ; +36 à +60 h enveloppe** | Paquets installés + canari owner de L6 |
| Bascule de « h2a » et « h2a run » | Release coordonnée ultérieure | Préannonce, compatibilité et rollback vérifiés ; pas de date inventée avant le canari |

**Hypothèses de capacité :** deux à trois constructeurs effectifs en parallèle, et revue indépendante disponible sans Claude Code. Les deux sièges Muse et le siège Codex sont une provision à vérifier, pas un droit à trois exécutions illimitées ; agy peut compléter la revue si sa route est disponible. Aucun calcul ne suppose six builders continus.

**Conditions qui invalident la cible :** extraction du moteur non bornée ; transport sans roundtrip d’outils ; absence de construction publique de mémoire nécessitant un changement de contrat plus large ; activation mémoire sans port d’identité/policy réel ; exigences supplémentaires de sandbox fort, migration complète de flotte ou fédération avant le pilote.

**[JUDGMENT] La réponse au « quand » doit être une date de conduite suivie par le conducteur**, avec mesures début→RED→vert→PR→fusion→paquet→canari, et une correction immédiate de prévision à +4 h puis à chaque gate. Ne pas laisser l’échec d’une hypothèse transformer de nouveau une date en attente indéfinie.

## E. Questions de principe pour l’owner et incertitudes

Ces questions sont **ouvertes**. Les recommandations ne constituent pas des réponses à sa place. Elles sont à présenter dans le dossier Focus réconcilié ; cette analyse ne sollicite aucune autorisation d’exécution.

### Lot de décision 1 — ce qui rend la première livraison acceptable

**Q1 — Quel usage doit vous faire dire « cette première version est enfin notre CLI » ?**

Contexte : la demande de juillet vise une vraie boucle native ; celle de septembre décrit une cible beaucoup plus large. Le pilote proposé permet travail local, mémoire, Track, Focus, arrêt et reprise, avec des limites explicites.

**Recommandation :** accepter comme premier incrément un travail réel de bout en bout dans un dépôt pilote, puis fixer une courte liste d’améliorations prioritaires à partir de cet usage. Garder les exigences maximales comme cible sans conditionner le premier usage à toutes les waves. Une capacité indispensable omise doit être nommée maintenant ; le délai doit être recalculé si elle change le chemin critique.

**Q2 — Quelle dépendance à un moteur open source externe considérez-vous compatible avec « notre propre CLI » ?**

Contexte : l’ownership du moteur par sentropic est déjà demandé. Il reste une question distincte : sentropic doit-il implémenter tout le noyau ou peut-il posséder son contrat et intégrer un SDK MIT ?

**Recommandation :** privilégier l’extraction sentropic si elle reste bornée ; accepter l’évaluation d’un SDK ouvert sous une frontière sentropic stable si les preuves montrent un coût ou une qualité nettement meilleurs. Refuser le fork massif et le simple renommage d’un launcher. Ce qui compte à décider est la maîtrise nécessaire du comportement, de l’état et du cycle de mise à jour.

**Q3 — Quel niveau d’autonomie et d’isolation doit être garanti dès le pilote ?**

Contexte : lire et éditer dans un workspace, puis lancer des tests, implique une autorité d’exécution réelle. Une confirmation de commande n’isole pas le système de fichiers ou le réseau.

**Recommandation :** premier canari local de confiance, actions permises bornées, refus/confirmation pour les autres, arrêt fiable et traces des effets ; aucune promesse de sandbox fort sans preuve. Si l’owner exige une isolation OS dès le premier usage, en faire un critère explicite avec backend vérifié et nouveau chiffrage, plutôt qu’un drapeau « safe » sans mécanisme.

**Q4 — Quelle continuité attendez-vous entre sessions, dépôts et machines dès ce premier usage ?**

Contexte : agent durable, conversation, checkpoint et mémoire ne sont pas le même objet. Engram 0.20.0 annonce un usage embedded-local, et la mémoire entre hosts n’y est pas active par défaut.

**Recommandation :** identité durable, mémoire locale scoped et reprise locale ; partage inter-dépôts et inter-machines uniquement par une politique de divulgation explicite. Les captures restent des candidats ; l’admission conserve les règles existantes. Le pilote ne doit ni aspirer tous les historiques ni inventer une mémoire universelle pour donner l’impression de continuité.

### Lot de décision 2 — principes non indispensables à redemander avant tout travail préparatoire

**Q5 — Quand un modèle ou un siège manque, quelle priorité donnez-vous à la fidélité du modèle demandé, au coût et à la continuité du travail ?**

Contexte : la demande du 18/10 souhaite les bascules entre sièges et des politiques de délégation selon les provisions. Un second siège du même modèle n’est pas le remplacement de ce modèle par un autre.

**Recommandation :** utiliser la rotation autorisée de sièges à modèle constant ; suspendre avec une raison claire si aucun siège éligible ne reste ; autoriser un changement de modèle seulement par une politique explicite et visible. La CLI affiche demandé/résolu et la limitation, le mesh décide le routage. Les bornes de dépense/concurrence viennent de l’owner et des capacités mesurées, pas du nombre de comptes.

**Q6 — Quelles propriétés du « serveur unique » sont non négociables pour votre premier usage ?**

Contexte : une unité de service commune évite de configurer et redémarrer plusieurs composants ; imposer un PID littéralement unique complique la conservation de PTY pendant un upgrade. Les études d’août avaient identifié ce compromis.

**Recommandation :** un lancement, une adresse locale authentifiée, une autorité de session, une supervision et un état de santé communs ; aucun démon par session native. Permettre des workers ou un carrier internes quand l’isolation ou la continuité le justifient. La convergence de la flotte existante reste un résultat serveur/S7 distinct à ne pas déclarer réalisé par le pilote.

### E1. Incertitudes qu’un agent doit lever, sans les déléguer à l’owner

| Incertitude | Responsable proposé | Preuve de levée |
|---|---|---|
| Couplage résiduel du while sentropic | Owner agents/chat | Consommateur isolé et fixture app de L1 |
| Compatibilité réelle de deux routes avec outils | Mesh/gateway + h-runtime | Appel réel, résultat d’outil, continuation, annulation, trace du modèle résolu |
| Surface distribuée pour créer le store mémoire | Engram + consommateur sentropic | Test packed sur vrai SQLite hors checkout |
| Activation locale et autorité mémoire | Host h2a + cluster-mesh | Opt-in persistant, refus inter-workspace, receipts, reprise |
| Lien exact de S7 et réception des questions de juillet | Conducteur + architecte | Référence stable, responsable disponible, réponse au contrat borné |
| État déployé du serveur unifié et de Focus | h-runtime/infra + Focus | Preuve sur service et paquet effectivement installé |
| Quotas/provisions disponibles | Mesh | Inventaire autorisé sans secrets, fraîcheur et échecs explicites |
| Distribution des délais au-delà du P50 fourni | Conducteur | Mesures des nouveaux lots et historique PR complet, sans convertir un P50 en garantie |

### E2. Attendus de l’owner, couverture et limites

| Attendu | Source | Couvert par | Limite conservée |
|---|---|---|---|
| Notre agent CLI, boucle que nous maîtrisons | x9, WP13, clarification 13/07 | L0, L1, L5, L6 | Moteur à extraire ; pas livré aujourd’hui |
| Priorité mémoire + CLI | D-008 | L4 et chemin critique commun | Pas de mémoire globale ni auto-admission |
| H2a comme sentropic local, SQLite | D-028, études serveur | Ports communs, état local L3, mémoire L4 | Pas de dépendance Postgres pour le pilote |
| Un serveur qui démarre seul | D-029 | L5 | Migration complète des vieux PTY distincte |
| Sièges et catalogue mesh | Demande 18/10, #373 | L2 | Deux routes qualifiées au départ ; disponibilité instantanée inconnue |
| Sans Claude Code | Saisine | Profil natif et test de non-recours L2/L6 | Les sièges Claude actuels ne satisfont pas ce chemin |
| Engram gardien de mémoire/ontologies | Saisine, contrat 0.20.0 | L4, aucun moteur mémoire concurrent | Export et activation consommateurs à qualifier |
| Track et Focus dans le travail | D-063 et capital h2a | L5/L6 | Ce Markdown n’est pas la présentation Focus réconciliée |
| Réponse datée et concrète | Relance 18/10 | T0+48 h, jalons et canari | Prévision conditionnelle, aucune mesure live inventée |
| Niveau final au-delà du moteur actuel | Étude 18/07 | Progression native observable + backlog cible conservé | Le pilote ne prétend pas déjà satisfaire fork, fédération et tous les R1–R15 |

## Références principales reproductibles

**Sources committées :** utiliser git show avec le SHA indiqué en tête et le chemin concerné. Les liens ci-dessous figent les sources déterminantes plutôt que pointer les fichiers locaux en cours de modification.

- [Backbone WP13, y compris la correction du sens de « boucle »](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md)
- [Étude moteur et session du 18 juillet](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md)
- [EVOL papier, révision 3](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md)
- [Profils actuellement exécutables](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/packages/h2a-runtime/src/profiles.ts)
- [PTY runner, distinct du moteur agent](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/packages/h2a-runtime/src/run.ts)
- [Gateway host et ports session-control indisponibles](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/packages/h2a-runtime/src/gateway-host/host.ts)
- [Dépendance du siège Claude au CLI](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/packages/h2a-runtime/src/gateway-host/claude-seat-client.ts)
- [Refus des outils clients par ce runner](https://github.com/rhanka/h2a/blob/d0b1afa38a3f9cf86c6cbe48b4d2a9c2b086a188/packages/h2a-runtime/src/claude-code-cli-runner.ts#L253)
- [Boucle applicative sentropic](https://github.com/rhanka/sentropic/blob/81deb7bd78d99bca8d51f67c4f1d4424fb772d75/api/src/services/chat-service.ts#L3178)
- [Dispatch d’outils déjà extrait](https://github.com/rhanka/sentropic/blob/81deb7bd78d99bca8d51f67c4f1d4424fb772d75/packages/chat-core/src/runtime-tool-dispatch.ts)
- [Ancien contrat mémoire encore dans cluster-mesh](https://github.com/rhanka/sentropic/blob/81deb7bd78d99bca8d51f67c4f1d4424fb772d75/packages/cluster-mesh/src/memory.ts)
- [Topologie et activation mémoire engram 0.20.0](https://github.com/rhanka/engram/blob/01697527c49e26a3d40d4917384f15d08fd36243/src/mcp/memory/topology.ts)
- [Façades mémoire distribuées](https://github.com/rhanka/engram/blob/01697527c49e26a3d40d4917384f15d08fd36243/src/memory-tools/index.ts)

**[FACT] Aucun état de réalisation ni aucune décision Track n’a été écrit par cette analyse.** Le conducteur conserve la responsabilité de confronter les deux analyses indépendantes, d’exposer les désaccords, de présenter le dossier Focus demandé et d’enregistrer uniquement les décisions effectivement prises.

