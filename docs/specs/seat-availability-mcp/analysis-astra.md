Analyse indépendante — disponibilité des sièges, bascule CLI et délégation selon les provisions

18 octobre 2026. Analyse documentaire uniquement ; aucun code modifié, commit, appel d’inférence, enrôlement, basculement de compte ou lecture de secrets. Les commandes natives consultées se limitent aux aides et versions. Les journaux ont été interrogés pour leurs diagnostics de quota. Aucun résultat de l’autre analyse indépendante n’a été consulté.

La demande appelle un **service durable de disponibilité et d’admission composé par cluster-mesh**, exposant un outil MCP au standard du registry. Il doit permettre à h2a de sélectionner un siège autorisé, de lancer effectivement ce siège, puis de réagir aux changements de capacité. Une liste de modèles ou un compteur « deux Claude, deux Muse » ne suffit pas. Le capital existant fournit l’identité des sièges, des projections CLI, le routage des comptes et le registry ; il manque leur raccordement à une observation de quota fiable et à une admission commune aux usages.

La première livraison utile peut être une lecture fidèle, avec des états `unknown` et `unverified`. **La demande complète inclut ensuite l’admission, la bascule entre sièges et les règles de délégation** : ces comportements ne doivent pas être présentés comme livrés avec le seul MCP de lecture.

**Références et niveau de preuve**

Les références suivantes désignent les objets Git locaux lus, sans prétendre vérifier l’état actuel de GitHub, de npm ou d’un déploiement :

| Repère | Dépôt et référence inspectée | Ce que cela établit |
|---|---|---|
| H | h2a, `origin/main`, `7ebbcf266e1988c18624d0158936949a214f9fd8` | Socle #348, catalogue #373, profils et politique agy présents dans cette source. |
| S | sentropic, `origin/main`, `9ed96eb83cd77da710f1adeb83a19e425d6c4910` | Comptes, route planner, registry cluster-mesh et ports de budget décrits ci-dessous. |
| HR | h2a, `origin/feat/0.98.7-registry-r5r6`, `e8508e394ad2a3f772bb36cc51c2007af549a64e` | R5/R6 disponibles sur une branche ; ce commit n’est pas ancêtre de H. |
| S1 | sentropic, `origin/feat/ci-seat-import`, `7293130ee3f6bfc6dd1e2fefcc07b3bd4d751a99` | L1/#681 et import générique ; ce commit n’est pas ancêtre de S. |
| SC | sentropic, `origin/spec/github-seat-credential-custody`, `2224250b6b706c0b384fbc45340a53da5ca5b668` | Étude de custody #596 et amendements F596 ; texte de conception, pas preuve de déploiement. |
| V | [SPEC_EVOL_VULN_FIX_ACTIVATION.v2.md](../act371/SPEC_EVOL_VULN_FIX_ACTIVATION.v2.md), notamment lignes 230–289 | Décision de capacité A, distinction entre verbatim propriétaire et propositions des analyses. |

Dans H, `packages/h2a-runtime/package.json` fixe cluster-mesh **0.16.0**, llm-mesh **0.26.0** et llm-gateway **0.20.0**. Dans S, les sources annoncent cluster-mesh **0.19.1** et llm-mesh **0.27.0**. Cela ne démontre ni publication ni compatibilité de la combinaison installée. La documentation #348 relate un raccordement à une source précise de #681 et signale elle-même l’écart avec les API alors publiées. Le `service/facade.ts` de S n’expose toujours pas l’import générique de S1. La qualification d’une combinaison de versions publiée constitue donc un lot réel. [H-seat] [H-package] [S-facade] [S1-import]

**A — Ce que la demande impose et le sens de « disponible »**

Le périmètre couvre les six sièges déclarés par le propriétaire : **Claude ×2, Codex ×1, Muse ×2, agy ×1**. Ce sont des quantités déclarées, pas un inventaire d’enrôlements vérifié pendant cette analyse. Vibe fait partie du contrat à cinq CLI demandé le 17/10 ; aucune quantité Vibe n’est donnée le 18/10. Il faut donc supporter Vibe sans inventer un siège disponible ou conclure qu’il n’en existe aucun.

Un siège est une identité de compte/entitlement enrôlée, avec sa lignée de credentials. Ce n’est ni un modèle, ni une fenêtre de terminal, ni un abonnement supplémentaire par interface. Le même siège peut offrir une projection native CLI et une projection llm-mesh, partager leurs quotas et ne disposer que d’une autorité de renouvellement. Deux profils qui désignent le même compte ne créent pas deux provisions. Inversement, un siège ne signifie pas nécessairement un seul processus : certaines formes d’accès permettent plusieurs consommateurs, tandis qu’un flux natif renouvelable peut exiger une exclusivité stricte. [S-seat] [H-materialization] [V, D2/D8]

Le `SeatBundle` existant porte déjà `seatRef`, `ownerScope`, `refreshFamilyRef`, provider/CLI, provenance, epoch/generation, expiry et autorité de renouvellement. Il distingue notamment custodian, consumer et native-store, ainsi que les projections native et mesh. **Ce bundle n’est pas le DTO public du MCP** : ses références de matériel et d’accès restent dans la frontière de credentials. [S-seat]

| Dimension à exposer | Information nécessaire | Piège à éviter |
|---|---|---|
| Inventaire/enrôlement | Identité diagnostique opaque, provider, compte lié, état d’enrôlement, binding du consommateur, révision de lignée. | Assimiler six sièges déclarés à six accès fonctionnels. |
| Usage et qualification | `cli` ou `llm-mesh`, version native qualifiée, modèle/capacités réellement compatibles, portée workspace/consommateur. | Déduire le succès CLI d’un import mesh, ou l’inverse. |
| Santé | Auth valide, reauth requise, révoqué, désactivé, indisponibilité transport, fraîcheur de projection et de livraison. | Traiter une expiry renouvelable ordinaire comme une révocation, ou autoriser un consumer custody à renouveler. |
| Quota fournisseur | Toutes les fenêtres applicables, unité, portée compte/organisation/famille de modèles, restant mesuré ou inconnu, source et date. | Transformer un 429 en estimation fictive du solde ; supposer deux comptes indépendants sans preuve. |
| Reset et attente | Reset fournisseur ou durée relative observée, limite de fraîcheur, prochain contrôle, autres causes de blocage. | Annoncer « disponible à minuit » alors qu’une autre fenêtre reste épuisée ou qu’une réauthentification est nécessaire. |
| Occupation et leases | Réservations actives, titulaire(s) autorisé(s), usage, expiration/heartbeat, exclusivité de famille lorsqu’elle s’applique. | Confondre affinité de routage, réservation de travail et droit de renouvellement. |
| Admission selon la politique | Travaux/roles permis, réserves protégées, capacité déjà promise, budget financier si applicable, motif de refus. | Présenter l’observation comme une promesse de pouvoir démarrer. |

La disponibilité doit donc répondre à une demande contextualisée : **ce modèle, via cet usage, pour cette phase de travail, sous ce principal vérifié et cette politique**. Une réponse générale peut exposer les dimensions ; elle ne peut promettre une capacité globale sans préciser les contraintes.

Les états inconnus doivent rester visibles. « Aucun épuisement observé » ne signifie pas « quota restant connu ». Une source silencieuse ou périmée ne doit ni annoncer zéro siège enrôlé, ni affirmer que tous les sièges sont libres. Si plusieurs fenêtres bloquent, leur échéance commune ne peut précéder la plus tardive ; si l’une est inconnue, exposer un prochain contrôle plutôt qu’une heure garantie de retour. Un reset atteint invite à réévaluer ; il ne répare pas l’authentification.

| Fournisseur / usage | Capital constaté | Conséquence pour la disponibilité |
|---|---|---|
| Claude natif ×2 | Codec avec profil isolé ; preuve synthétique. Pas de commande multi-compte dans l’aide Claude inspectée. | Deux bindings qualifiés séparément ; détecter quota et santé par compte, sans recopier le profil quotidien. |
| Claude via llm-mesh | Comptes/transport mesh et catalogue ; projection de siège prévue par L1. | Qualifier import, entitlement, modèle et cycle de credentials séparément du CLI. |
| Codex natif + mesh ×1 | Codec `CODEX_HOME`, format d’enrôlement et comptes mesh. | CLI et mesh consomment le même entitlement lorsqu’ils proviennent du même siège ; les compter ensemble. Vérifier aussi l’isolation du daemon natif. |
| Muse natif + mesh ×2 | Codec XDG et import Meta ; compteurs de quota complets non démontrés. | Deux bindings ne prouvent pas deux fenêtres indépendantes. `META_API_KEY` peut prendre priorité sur le login sélectionné. |
| agy / cloud-code ×1 | Correspondance de siège agy→package cloud-code ; diagnostic spécifique agy-Claude dans h2a. | Conserver le transport et la famille de modèles dans la clé de quota ; ne pas propager un épuisement Claude via agy aux sièges Claude directs ni à tous les modèles agy sans preuve. |
| Vibe natif + mesh | Codec, compte Mistral, capacité prévue par le contrat cinq CLI ; quantité non déclarée. | Restituer la qualification et la classe de facturation réellement établies ; ne pas assimiler une clé statique à une provision incluse illimitée. |

Pour agy, le contrat de sièges identifie notamment le client Antigravity et l’endpoint cloud-code ; une normalisation générale « cloud-code = Gemini » perdrait cette information. Les aliases de modèles restent ceux du catalogue llm-mesh, pas une seconde table dans le MCP. [S-seat] [H-codecs] [H-catalog]

Les observations de cette semaine démontrent le besoin de fenêtres précises, mais pas l’état présent de tous les sièges :

- [ptyspec3.log, ligne 3](../ptyspec3.log) : diagnostic Muse `Subscription quota exhausted`, reset **2026-10-18T10:53:24Z** ; également rencontré dans `reclass2.log` et `lane088b.log`.
- [diag2w.log, ligne 3](../diag2w.log) : reset **2026-10-18T15:55:01Z** ; diagnostics analogues dans `ptycode.log`, `velow.log`, `orph.log`.
- [agyopus-muse429.log, ligne 3](../agyopus-muse429.log) : reset **2026-10-19T00:00:00Z** ; également dans `presdec-muse429.log` et `focusread-muse429.log`.
- [agyopus.log, ligne 30](../agyopus.log) relaie un diagnostic agy `RESOURCE_EXHAUSTED` avec **156h32m24s** avant reset. Le brief indique environ **146 h** et environ le 23/10 ; ces durées ne sont pas le même constat horodaté. Sans horloge de l’observation initiale, ne pas fabriquer un reset absolu précis à partir de cette ligne.

Ces extraits ne donnent pas une attribution fiable à Muse-A ou Muse-B. Ils ne prouvent donc ni que les deux sont épuisés simultanément, ni que les trois dates concernent le même compte. Les reprises de ces diagnostics dans du code de test ou dans des comptes rendus ne sont pas de nouvelles observations fournisseur.

La demande ne crée pas une autorisation d’acheter des abonnements, d’utiliser des crédits payants en secours, de contourner une limite fournisseur ou d’enrôler automatiquement les logins quotidiens. Elle n’exige pas de rendre chaque CLI compatible avec tous les modèles mesh, ni de supprimer leurs restrictions natives. L’automatisation demandée porte sur des sièges et routes autorisés, dont les limites deviennent explicites.

**B — Propriété durable et exposition au registry**

La frontière recommandée conserve les responsabilités déjà inscrites dans le capital :

| Propriétaire | Responsabilité |
|---|---|
| llm-mesh et bibliothèque de custody, dépôt sentropic | Identité des comptes/sièges, modèle et transport, autorité de renouvellement, projections, observations fournisseur et éligibilité de route. |
| cluster-mesh, dépôt sentropic | Façade durable de disponibilité, composition des sources, politique d’éligibilité et ports d’admission partagés, publication de la capacité MCP. |
| Hôte de confiance de l’autorité, dépôt sentropic | Authentification du principal, stockage durable, transactions/réservations, horloge, reprise et permissions d’exécution. Le choix d’un package ne remplace pas ce service déployé. |
| llm-gateway et adaptateur financier de l’hôte | Admission monétaire, pricing, holds et settlement existants. Ce budget se compose avec la disponibilité des sièges. |
| h2a | Consommation du contrat, plan de délégation, lancement du siège admis, supervision et remontée d’observations fiables ; aucun coffre de comptes ou compteur global concurrent. |

Le capital mesh est utile mais ne satisfait pas encore le contrat demandé. `AccountTransportCoordinator` gère active/cooldown/reauth/disabled, réservations et affinités ; son cooldown par défaut vaut 60 s et son ordre favorise le dernier enrôlement, puis priorité/charge. Ce n’est pas un choix selon quota restant. L’interface d’outcome possède un champ `quota`, mais l’application de l’outcome n’en fait pas un état de provisions exploitable. Le coordinateur de base conserve ses réservations en mémoire. Le service local persiste cependant des états de comptes, et le route planner sait utiliser un store d’affinité durable : il serait faux de présenter tout le système comme uniquement transitoire. [S-pool] [S-local] [S-route]

`listModels()` et `describeAvailability()` donnent déjà des modèles et diagnostics de routes, utiles à composer ; ils ne fournissent pas les soldes, les fenêtres et l’occupation nécessaires ici. Les fallbacks mesh ont aussi une politique existante : par défaut, rotation des comptes équivalents et substitution de modèles ne sont pas activées. Une nouvelle politique de gestion de provisions doit explicitement s’y raccorder. [S-route] [S-routing-policy]

Il existe par ailleurs un `BudgetAdmissionPort` du gateway et un adaptateur transactionnel dans `api/src/services/llm-metering/budget-admission.ts`. Le premier réserve la responsabilité financière maximale des tentatives et distingue le travail envoyé du travail jamais envoyé. Il faut **composer** ces garanties, sans assimiler dollars, pourcentage fournisseur et unités de travail quotidiennes. L’autorité déployée commune aux tests CLI, tests gateway et maintenance n’a pas été identifiée comme opérationnelle par cette lecture ; la spec V la réclame encore. [S-budget] [S-budget-host]

Pour la custody, F596-2 décrit déjà le raccordement d’un catalogue à la santé, fraîcheur, révocation et binding du consommateur, sans credentials et sans deuxième store. F596-3 distingue la génération canonique du siège des accusés de livraison par consommateur. C’est précisément le capital à prolonger : un siège sain peut rester indisponible dans un dépôt qui n’a pas reçu sa projection. Le dépôt d’étude SC ne prouve pas que cette livraison existe aujourd’hui. [SC-catalog]

**Proposition d’outil et de raccordement.** Noms de travail : entrée publiée `sentropic.seat-availability`, outil `seat_availability`. Leur stabilité doit être fixée avec le contrat registry ; ils n’existent pas dans la source inspectée.

L’outil accepte des filtres bornés — usage, provider, modèle, phase/purpose, pagination et exigence de fraîcheur — et retourne une vue versionnée, les dimensions d’état, leurs dates/sources, les raisons d’inéligibilité et les réservations visibles. Le principal vient du contexte d’invocation vérifié, jamais d’un `ownerScope` librement fourni dans les arguments. Les références diagnostiques sont opaques et limitées au périmètre autorisé ; elles ne sont pas des droits d’accès. Ni email de compte, ni chemin de profil, ni `materialRef`/`accessRef`, ni payload d’enrôlement ne traverse cette réponse. La projection hébergée masque aussi les chemins serveur et les titulaires non autorisés.

Une lecture ne réserve rien, ne renouvelle rien et ne lance pas d’inférence de contrôle. Les collecteurs de l’autorité peuvent actualiser les observations hors du chemin de lecture, avec cadence bornée et source explicite. L’admission passe par un port de confiance distinct, appelé par le lanceur : décision atomique, vérification de génération, réservation et liaison à l’exécution. Une éventuelle API MCP mutante ultérieure doit avoir sa propre capacité ; elle ne peut être dissimulée dans un outil annoncé en lecture seule ni dans le profil hébergé R6.

Le standard à suivre comporte deux niveaux qu’il faut réellement adapter :

1. Dans cluster-mesh, utiliser la façade `mcp/registry.ts` et son noyau mcp-platform : définition statique, loader sélectionné, `register → select → configure → compile`, erreur typée si le binding manque. `catalog().available` y décrit une capacité MCP/configuration, pas le quota d’un modèle. [S-registry]
2. Pour la distribution h2a, publier un descripteur de package au contrat registry **1.1.4**, comme R4/Focus et HR : identité du publisher, versions/compatibilité, schémas bornés, assets et empreintes, bindings et profils de capacité. Le module de métadonnées doit rester léger ; le handler se charge après validation. Le descriptor appartient au publisher cluster-mesh, pas à une copie de ses règles dans `sentropic.h2a`. [H-focus-registry] [HR-definitions]
3. Le bridge h2a expose exactement les outils sélectionnés par le registry. Le prototype interne `runtime/mcp-registry/broker.ts`, limité à son outil de recherche, n’est pas le chemin de publication à étendre pour contourner R5. [HR-registry]
4. R6 conserve l’intersection publisher/profil lecture seule/allowlist et le confinement tenant. Son code inspecté compose explicitement h2a et Track ; l’ajout d’un troisième publisher mérite un test de composition, pas seulement une ligne d’allowlist. [HR-hosted]
5. HR refuse encore les définitions `remote-bound` et reporte R2/R7a/R3. Il ne faut pas annoncer que l’ajout d’une URL active déjà le service central distant. Une définition locale peut être qualifiée avec un port de service injecté ; le transport partagé entre hôtes doit passer par la voie registry/bridge supportée et testée. Cette dépendance est un lot de raccordement, pas un stub silencieux. [HR-registry]

La durabilité nécessite un stockage partagé des observations et admissions, des mises à jour monotones, des opérations idempotentes et des transactions tenant compte de toutes les limites applicables. Deux instances h2a lisant la même disponibilité peuvent demander la dernière unité : une seule admission doit réussir. Une partition rend l’admission indisponible ou soumise à une délégation de capacité préallouée et bornée ; elle ne permet pas à chaque hôte de recréer librement le budget.

Il faut séparer trois objets : l’affinité qui préfère un compte, la réservation de capacité qui promet du travail, et le lease exclusif éventuel de la famille renouvelable. L’expiration d’un TTL ne prouve pas qu’un ancien CLI et ses descendants ont cessé d’utiliser des credentials. La reprise d’une famille renouvelable exige arrêt/fencing et vérification de succession ; un processus dont l’état est incertain ne libère pas magiquement ce droit. Le mécanisme `serialized-stream` de #348 est un point de départ, pas la preuve d’un arbitrage distribué déjà livré. [H-materialization] [V, D8]

**Proposed specification text — identity, availability and registry**

> AV-1. Cluster-mesh SHALL own the public seat-availability capability and compose the existing account, custody, routing and admission authorities. h2a SHALL consume this capability and SHALL NOT maintain a competing account store, refresh authority or global capacity ledger.
>
> AV-2. One enrolled seat MAY expose native-CLI and llm-mesh projections. Projections SHALL retain a common canonical identity and shared quota scopes where applicable. Aliases, profiles and consumer repositories SHALL NOT multiply the underlying provision.
>
> AV-3. Availability SHALL be evaluated for a verified consumer, usage, model and work purpose. Enrollment, usage qualification, credential health, quota observations, active reservations and policy eligibility SHALL remain distinguishable. Unknown, stale, exhausted and unsupported SHALL NOT be collapsed into a boolean.
>
> AV-4. Each quota observation SHALL identify its authority, observation time, validity bound, quota scope, applicable window and unit. Remaining capacity and reset time MAY be unknown. The service SHALL NOT infer a positive balance from silence, elapsed time alone, or an enrolled account count.
>
> AV-5. The read-only MCP tool SHALL return bounded, versioned, metadata-only results through the standard registry lifecycle. Verified caller identity SHALL determine visibility. Results SHALL exclude credential material, credential-bearing references, private profile paths and unauthorized holder identities. Listing SHALL NOT reserve capacity, refresh credentials or perform model inference.
>
> AV-6. Admission SHALL revalidate eligibility and reserve capacity atomically at the shared authority. A read snapshot or diagnostic seat reference SHALL NOT authorize execution. Accepted execution SHALL be bound to the admitted seat, generation, consumer, purpose and policy revision; that binding SHALL be enforced at launch.
>
> AV-7. Observation ingestion SHALL accept trusted supervisor/provider evidence, reject stale generations and deduplicate repeated events. Model-authored text and unbound transcript excerpts SHALL NOT update authoritative quota state. Financial budget holds, provider quota constraints and local work-unit budgets SHALL remain separate constraints.

**C — Bascule automatique et mécanisme « gh »**

L’hypothèse la mieux étayée est **le sélecteur multi-compte natif de GitHub CLI, combiné à la délégation de credentials à un helper** :

- `gh auth switch` change le compte actif d’un host ; avec deux comptes il peut basculer implicitement, et `--user` sélectionne un compte explicitement. Pour une automatisation, la sélection explicite est préférable au toggle dépendant de l’état courant. [Documentation officielle](https://cli.github.com/manual/gh_auth_switch).
- `gh auth setup-git` configure Git pour déléguer à GitHub CLI la fourniture de credentials. C’est un mécanisme distinct de la sélection du compte. [Documentation officielle](https://cli.github.com/manual/gh_auth_setup-git).
- `GH_TOKEN`/`GITHUB_TOKEN` prennent priorité sur les credentials enregistrés ; `GH_CONFIG_DIR` choisit le répertoire de configuration. Un switch de profil peut donc être sans effet si une source prioritaire reste injectée. [Documentation officielle](https://cli.github.com/manual/gh_help_environment).
- Le transport GitHub existant de h2a déclare explicitement que `gh` seul possède les credentials et reçoit un exécutable absolu et un répertoire de service approuvés. Il ne constitue pas un gestionnaire de sièges ni un switch automatique. [H-gh, lignes 1–5]

La recherche dans les sources suivies des deux `origin/main` n’a pas retrouvé de gestionnaire h2a/cluster-mesh exécutant déjà `gh auth switch` pour plusieurs comptes. Le binaire résolu est `/usr/bin/gh`, version 2.46.0. Cela n’exclut pas un outil personnel ou un dispositif hors de ces sources ; **le référent précis du propriétaire reste à confirmer**, sans prétendre avoir découvert une implémentation interne réutilisable.

Une deuxième notion de « GitHub » existe dans le capital : la custody par GitHub Actions Secrets, avec un seul refresher et des projections access-only. Elle est documentée dans S et approfondie dans SC. Elle fournit la persistance et le cycle des credentials ; elle ne constitue pas un mécanisme de sélection multi-compte CLI. Les deux peuvent se compléter et ne doivent pas être confondus. [S-custody] [SC-catalog]

La réutilisation recommandée porte donc sur **identités enrôlées persistantes + sélection explicite + résolution privée par un composant de confiance**. Elle ne consiste ni à appeler `gh` pour des comptes LLM, ni à reproduire le changement d’un profil global partagé par des sessions concurrentes.

| CLI examiné | Support natif constaté | Ce qui reste à qualifier |
|---|---|---|
| Claude 2.1.302 | `auth login/logout/status`, reprise de session ; pas de sous-commande `auth switch` dans l’aide. `CLAUDE_CONFIG_DIR` est documenté ; le codec #348 utilise un profil privé. | Isolation effective de tous les états d’auth/MCP/keyring, fonctionnement access-only, reprise avec une autre identité. |
| Muse 1.4.10-R6427.1 | Login/logout, `auth set` avec entrée privée, reprise ; aucune commande de switch découverte. L’aide du login indique la priorité de `META_API_KEY`. | Deux profils XDG réellement distincts, source prioritaire neutralisée, indépendance des quotas, reprise et renouvellement natifs. |
| Codex 0.163.0 | Login/status ; `--profile` désigne de la configuration. La doc indique un cache de credentials fichier ou keyring partagé par les usages CLI/IDE. | `CODEX_HOME` et daemon/keyring doivent être qualifiés ensemble ; un profil TOML n’est pas une identité de compte. |
| agy | Reprise et sélection de modèle dans l’aide ; aucune sélection de compte exposée dans les commandes consultées. | Le codec prévoit HOME/keyring isolés ; la qualification native ne peut être déduite d’un fichier JSON ou d’un login Gemini/ADC. |
| Vibe installé | `VIBE_HOME` et reprise exposés par l’aide ; aucun switch multi-compte découvert. | Facturation/entitlement et mode natif exact. L’aide du binaire observé décrit un TUI Rust ; le format synthétique ne suffit pas comme preuve d’usage réel. |

Sources : aides locales non mutantes ; [H-codecs] [H-profiles] ; [Claude settings](https://code.claude.com/docs/en/settings), [Codex authentication](https://developers.openai.com/codex/auth), [Codex advanced configuration](https://developers.openai.com/codex/config-advanced). L’absence de commande dans ces aides n’est pas une preuve d’impossibilité technique ; elle empêche de promettre un switch natif déjà supporté.

Le contrat de lancement documenté dans H impose aussi des limites indépendantes du quota : lancement direct par défaut ; `gateway: required` réservé au profil Claude ; Muse et Vibe refusés en mode headless ; paramètres modèle/effort sans effet sur l’argv Vibe. Un siège sain ne rend donc pas automatiquement admissible toute combinaison profil/modèle/mode d’exécution. Ces capacités doivent figurer dans le filtrage du planificateur, puis être qualifiées contre les versions réellement installées. [H-run-skill]

La bascule au lancement peut suivre un protocole déterministe : choisir un compte éligible ; obtenir une admission ; résoudre sa projection dans la frontière privée ; construire le profil et l’environnement fermés ; lancer et vérifier la liaison d’identité ; conserver un reçu diagnostique du choix. Les champs publics de `h2a_run` ne comportent actuellement ni sélection de siège ni admission. Le câblage `metadata.seat` plus bas dans le runtime existe et possède des tests synthétiques, mais il ne prouve pas que ce protocole public est livré. [H-launch] [H-native] [H-wiring]

La bascule **en cours de session** est un besoin distinct, à conserver au périmètre :

1. Classer l’échec à partir d’un diagnostic fournisseur fiable, attaché au compte effectivement lancé. Distinguer rate limit bref, quota d’une fenêtre, 401 et erreur de transport.
2. Chercher un autre siège du même provider, autorisé pour le même modèle et ne partageant pas le quota bloquant. Limiter les tentatives et mémoriser la fenêtre ; ne pas alterner les deux comptes à chaque 429.
3. Si le CLI permet une bascule documentée au prochain tour, l’effectuer sous contrôle et confirmer l’identité. Sinon, arrêter proprement à une frontière de tour, attendre les outils/enfants, conserver le checkpoint et relancer avec la nouvelle projection admise.
4. Vérifier si la reprise native survit au changement de profil et de compte. À défaut, créer une nouvelle session avec un passage de relais explicite. Le dossier de conversation peut être lié au profil précédent ; ne pas copier aveuglément un répertoire contenant l’auth.
5. Ne jamais rejouer automatiquement le prompt complet après un échec ambigu ayant pu produire un commit, une écriture ou un appel externe. Conserver l’état des effets et du travail restant ; si la reprise sûre n’est pas établie, rendre un état suspendu exploitable par le conducteur.

Un changement de modèle/provider est un fallback séparé. Le switch Claude-A→Claude-B n’autorise pas implicitement Claude→Sol. La fidélité à un modèle demandé, les capacités outils et l’indépendance des reviewers doivent être vérifiées avant cette substitution.

Deux risques demandent une preuve réelle : un client peut garder ses credentials en mémoire ou dans un daemon malgré un changement de fichier ; et les permissions 0700/0600 ne protègent pas à elles seules contre un outil lancé sous le même UID. Le secret doit rester hors des arguments, logs, réponses MCP, contexte modèle et environnements des sous-outils non autorisés. Les protections de scope et les canaris #348 doivent être exercés sur le chemin natif effectivement lancé. Les tests synthétiques ne prouvent pas cette séparation sur tous les CLI. [H-codecs] [H-materialization] [H-seat]

Pour les consommateurs access-only, un 401 ou une expiry ne donne pas le droit de renouveler. Un autre siège peut être envisagé par le superviseur dans une nouvelle admission ; le consumer défaillant ne se réauthentifie pas et ne retombe pas sur le login ambiant. Si un CLI exige un flux renouvelable natif, la voie `serialized-stream` impose le ticket de famille, la capture de succession après arrêt des descendants et la sauvegarde durable avant réutilisation. C’est une qualification L1/L2, pas une simple copie de credentials. [V, D8] [H-materialization]

**Proposed specification text — switching**

> SW-1. Automatic seat selection SHALL select an explicit enrolled identity and enforce it for the launched process. Ambient credentials SHALL NOT override the admitted identity. Concurrent runs SHALL NOT switch a shared global login profile.
>
> SW-2. Same-provider seat rotation and cross-model fallback SHALL be separate policy decisions. Rotation SHALL respect shared quota scopes, usage qualification and bounded retry policy. A mid-session switch SHALL preserve completed effects and SHALL NOT replay an ambiguously completed operation.
>
> SW-3. Where native hot switching is unqualified, the supervisor SHALL use a qualified turn-boundary restart or an explicit session handoff. Unsupported continuity SHALL be reported. Refresh ownership and family fencing SHALL remain valid across the transition.

**D — « Max en fonction des provisions » : politique de délégation**

Je recommande d’interpréter « max » comme **le maximum de travail utile finançable sous un niveau de qualité et des réserves définis**, plutôt que comme un nombre de sous-agents égal au nombre de sièges ou comme l’envoi littéral de `effort: max` partout. Ce sens reste un principe à faire préciser par le propriétaire.

L’effort est une autre dimension. Le skill `h2a-run` publié dans H traduit encore « max » en xhigh pour Claude/Codex/Muse et dit qu’agy refuse max ; le code agy de H traduit pourtant max en high. L’aide Muse observée expose aussi max/ultra au-delà de l’énumération h2a. Il faut réconcilier contrat, documentation et version native ; « niveau le plus élevé supporté » ne doit pas devenir une valeur universelle inventée. Le skill de lancement précise déjà qu’il ne choisit pas le meilleur modèle : la politique du conducteur doit précéder cette traduction. [H-run-skill] [H-agy]

Le planificateur suit un ordre explicable :

1. Identifier phase, purpose, confidentialité/partage autorisé, contraintes outils, fidélité de modèle et qualité minimale. Les phases méthode `specification/implementation/review` ne sont pas aujourd’hui trois valeurs du champ `role` de `h2a_run` ; son enum est `review/challenge/build`. Prévoir une correspondance sémantique explicite, sans étiqueter un build « review » pour obtenir une réserve.
2. Filtrer les candidats par identité autorisée, usage qualifié, santé, modèle effectivement supporté et fenêtres de quota. Appliquer les limites de travail et les réserves, puis le budget financier lorsqu’il existe.
3. Choisir parmi les candidats admissibles selon qualité attendue pour la phase, marge disponible, horizon de reset, latence et équité. Utiliser le catalogue/council llm-mesh pour les identifiants et équivalences, sans table de modèles divergente dans chaque skill.
4. Réserver le travail nécessaire à l’achèvement, dont les reviews requises. Réévaluer les étapes non commencées quand quota, génération ou politique change ; ne pas préempter arbitrairement une session en plein effet externe.
5. Tracer raison du choix, modèle demandé, modèle résolu au lancement, modèle effectivement observé si disponible, policy revision, réservations et fallback. Un modèle servi non attesté reste inconnu ; l’alias demandé n’est pas une preuve.

| Phase | Recommandation de politique | Conséquence pratique |
|---|---|---|
| Spécification / arbitrage | Maintenir le seuil de raisonnement et prévoir la revue contradictoire avant d’épuiser le pool. | Si un modèle fort manque, utiliser une équivalence autorisée ou différer l’arbitrage ; ne pas masquer une baisse de qualité. |
| Code / tâches séparables | Allouer la capacité admissible aux tâches indépendantes ; fallback de code vers Sol si la politique et ses réserves le permettent. | Muse-A en quota n’interdit pas Muse-B si son quota est indépendant ; si les deux sont bloqués, Sol reste un candidat, jamais une garantie. |
| Review / challenge | Protéger la capacité des reviewers et leur indépendance vis-à-vis de l’auteur. | Un unique siège Codex peut éventuellement faire deux reviews séquentielles avec des modèles/sessions distincts ; il ne devient pas deux sièges. |
| agy-Claude | Respecter la règle existante réservant cette ressource aux reviews/challenges, build avec opt-in explicite. | L’épuisement observé rend cette route inéligible pendant sa fenêtre ; il ne vaut pas épuisement de Claude direct. |

Le launcher de conducteur choisit actuellement principalement selon disponibilité des exécutables hôtes ; il n’est pas un scheduler de provisions. La gouvernance contient également une recommandation de lancement dont la politique automatique est explicitement mise de côté. Le nouveau MCP ne doit pas activer indirectement ce chantier distinct. Le raccordement demandé concerne les décisions de délégation et leurs lancements déjà autorisés. [H-conductor] [H-launch-check]

Pour les tests et la maintenance, préserver précisément le capital V :

- **Décision D6, attribuée au propriétaire** : A « Partager la maintenance », dans les **deux unités Codex de maintenance**, avec répartition **6 CI / 2 enrôlement protégées / 2 maintenance**, plafond de **10 unités par CLI et par jour UTC, tous consommateurs confondus**. Ne pas multiplier ce plafond par les profils, dépôts ou projections ; ne pas l’étendre automatiquement parce qu’un deuxième siège existe. La maintenance de qualification et la correction de vulnérabilités se disputent ce même compartiment.
- **D7, attribué aux analyses dans V** : une autorité commune, réserve fournisseur strictement supérieure à 20 % dans chaque fenêtre, quota inconnu = aucune inférence, réservation auteur + deux reviews avant l’auteur. Ce sont des contraintes proposées dans ce dossier, pas une nouvelle citation du propriétaire. Elles doivent être réconciliées dans le contrat commun ; leur généralisation à toute délégation personnelle reste une question de principe.
- **D9, interdiction attribuée au propriétaire pour ce job** : aucun sous-traitant Claude Code auteur/reviewer de remédiation. Claude reste un fournisseur à tester. Un droit `test-cli` n’accorde donc pas automatiquement un droit `vulnerability-remediation`.
- **D9, composition encore proposée** : auteur Muse et deux reviewers Codex de modèles distincts. Avec deux unités Codex de maintenance, ce schéma peut limiter à un candidat quotidien partagé, avant autres consommations. Si l’auteur bascule lui aussi sur Codex et chaque rôle coûte une unité dans ce schéma, les trois unités nécessaires ne tiennent pas dans ce compartiment. Le fallback doit alors attendre ou produire un plan autorisé différent, pas emprunter les unités d’enrôlement.

Les tests diagonaux de la matrice inter-CLI exigent eux-mêmes des sièges/familles distincts ; cloner un profil ne satisfait pas cette condition. L’admission doit pouvoir représenter une demande groupée et refuser un scénario irréalisable avec l’inventaire courant. Le nombre de sièges ne se convertit donc pas directement en nombre de tests parallèles. [H-materialization] [H-seat]

Pour l’équité, proposer une file commune avec classes de travaux, réserves du propriétaire, parts explicites et vieillissement des tâches en attente. Une fonction de score réversible peut être choisie par l’implémentation ; les droits de préemption ou d’emprunt entre compartiments sont une décision de politique. Afficher la réserve occupée, l’attente et le prochain réexamen. Le consommateur ne peut se déclarer « CI » pour contourner sa classe : purpose et droits proviennent du workflow vérifié.

Enfin, une réservation locale ne réserve pas réellement le quota chez Meta/Anthropic/Google/OpenAI. Un usage extérieur au service peut encore le consommer. Le contrat doit promettre une admission cohérente avec ses dernières preuves, puis réconcilier les observations ; il ne peut garantir un solde fournisseur figé. Une issue incertaine après dispatch ne doit pas rembourser automatiquement toute la capacité ou le hold financier.

**Proposed specification text — delegation and fairness**

> DP-1. Delegation policy SHALL maximize admissible useful work subject to explicit role-quality requirements, protected reserves, usage permissions and provider constraints. Model choice, reasoning effort, seat identity and concurrency SHALL be independent decisions.
>
> DP-2. Required downstream reviews SHALL be included in whole-cycle admission where the workflow requires funded completion. A fallback SHALL preserve the applicable role and budget constraints. Capacity reserved for enrollment SHALL NOT fund remediation.
>
> DP-3. Cross-model fallback SHALL use an explicit permitted equivalence and SHALL report the resolved choice. A caller's exact-model requirement SHALL be preserved unless its governing policy authorizes substitution. Existing restrictions on agy-Claude build usage and remediation subcontractors SHALL remain effective.
>
> DP-4. Unknown quota SHALL never imply unlimited capacity. Fully automated lab and maintenance work SHALL follow the shared authority's explicit unknown-quota rule. Any different treatment for interactive delegation SHALL be a separate, bounded owner policy.
>
> DP-5. All admitted consumers SHALL charge the same relevant quota scopes and work-unit budgets. Local aliases, retries, repositories and CLI/mesh projections SHALL NOT create additional allowance. Reservations and settlement SHALL be idempotent and survive authority restart.

**E — Lots par propriétaire, fichiers et tests RED**

Les chemins sont relatifs au dépôt indiqué, sur la référence H/S/HR/S1 annoncée. **[N] désigne un fichier proposé, non existant dans la preuve actuelle.** Les tests ci-dessous sont à écrire et à constater RED avant réalisation ; aucun n’a été exécuté dans cette analyse. Une entrée de test manquante ou un import cassé ne suffit pas comme RED : il faut observer le comportement incorrect ciblé.

**S0 — sentropic / cluster-mesh : contrat commun et composition de lecture.**

Fichiers : [N] `spec/SPEC_EVOL_SEAT_AVAILABILITY.md`, [N] `packages/cluster-mesh/src/seats/contracts.ts`, [N] `packages/cluster-mesh/src/seats/availability.ts`, [N] `packages/cluster-mesh/tests/seats/availability.spec.ts` ; couture existante `packages/cluster-mesh/src/integrations/llm-mesh/facade.ts` et export dans `packages/cluster-mesh/package.json`.

RED : fixture de six sièges déclarés dont un CLI non qualifié et un compte mesh sain mais au quota inconnu ; la sortie distingue les états et ne promet pas six accès disponibles. Une double projection et deux aliases ne doublent pas la capacité. Un principal ne voit ni le siège ni le titulaire d’un autre owner. Une livraison périmée chez un consommateur ne dégrade pas artificiellement la génération canonique chez les autres.

Commence maintenant avec des ports et fixtures non secrets. Ce lot ne dépend pas d’une connexion fournisseur réelle et peut rendre les inconnues utiles dès la première livraison.

**S1 — sentropic / llm-mesh et custody : observations typées et identité commune.**

Fichiers existants : `packages/llm-mesh/src/account-transports.ts`, `src/route-planner.ts`, `src/routing-contracts.ts`, `src/service/facade.ts`, `src/service/local-account-transport-service.ts`, `src/enrollment/seat-bundle.ts` ; dans ce paragraphe, tous les `src/…` sont sous `packages/llm-mesh/`. Ajouts proposés : [N] `packages/llm-mesh/src/quota-observations.ts`, [N] `packages/llm-mesh/tests/quota-observations.test.ts`. Étendre `packages/llm-mesh/tests/account-transports.test.ts`, `tests/route-planner.test.ts`, `tests/service/local-account-transport-service.test.ts`.

RED : un épuisement Muse à 15:55:01Z ne redevient pas disponible après le cooldown générique de 60 s ; plusieurs fenêtres sont conservées ; une observation ancienne ou d’une autre génération ne remplace pas une observation récente ; quota Claude via agy ne bloque pas Claude direct ; résultat inconnu ne devient pas solde positif ; persistance/restart conserve le blocage. Un texte modèle contenant « 429 » ne suffit pas, et les doublons n’ajoutent pas des consommations.

L1/#681 fournit déjà `packages/llm-mesh/src/enrollment/cli-seat-import.ts` sur S1 et l’import de façade : intégrer cette voie, sans en créer une troisième dans h2a. Le raccordement aux métadonnées custody prolonge F596-1/2/3 dans `spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md` sur SC. Les mécanismes provider réellement capables de lire un solde complet restent à qualifier ; en leur absence, livrer l’observation partielle et `unknown`, jamais un endpoint supposé.

**S2 — sentropic / autorité partagée : admission durable, budget et occupation.**

Fichiers proposés : [N] `packages/cluster-mesh/src/seats/admission.ts`, [N] `packages/cluster-mesh/tests/seats/admission.spec.ts`. Coutures existantes : `packages/llm-gateway/src/ports/budget.ts`, `api/src/services/llm-metering/budget-admission.ts`, `api/src/services/llm-account-transports.ts`. Tests existants à composer : `packages/llm-gateway/tests/budget-admission.test.ts`, `api/tests/unit/llm-budget-admission-native.test.ts` ; [N] `api/tests/api/llm-seat-admission.test.ts` pour la preuve entre clients concurrents.

L’emplacement de l’autorité opérationnelle des dix unités doit être établi avant d’affecter son stockage : V décrit une exigence, pas un adaptateur local à recopier. Si l’hôte API existant en devient le propriétaire, emplacement proposé [N] `api/src/services/llm-seats/admission-store.ts`, avec évolution ciblée de `api/src/db/control-schema.ts` après audit du schéma existant. Ce choix est conditionnel ; aucune migration fictivement « exacte » n’est attribuée avant d’avoir choisi la source de vérité. Le port et les cas de concurrence peuvent être spécifiés dès maintenant, la qualification durable exige le vrai backend.

RED : deux clients/hôtes demandent simultanément la dernière unité, une seule réussite ; une demande auteur + deux reviews est tout ou rien ; le budget protégé reste intact ; crash avant/après dispatch puis reprise ne crée ni double débit ni remboursement indu ; expiration du lease de travail ne permet pas un second refresher encore concurrent ; retrait d’un binding empêche un ancien reçu de lancer. Les preuves de concurrence doivent inclure stockage/transaction réels, pas seulement deux appels à une Map.

**S3 — sentropic / cluster-mesh et registry : capacité MCP publiée.**

Fichiers existants : `packages/cluster-mesh/src/mcp/registry.ts`, `src/compose/mcp.ts`, `src/integrations/mcp/artifacts.ts` comme exemple de builtin, `src/modules/catalog.ts`, `package.json` dans ce package. Ajouts proposés : [N] `packages/cluster-mesh/src/integrations/mcp/seats.ts`, [N] `packages/cluster-mesh/src/registry/definitions.ts`, [N] `packages/cluster-mesh/registry/entries.v1.json`, [N] `packages/cluster-mesh/registry/manifest.seats.json`, [N] `packages/cluster-mesh/tests/seats/mcp.spec.ts`. Vérifier les surfaces dans `packages/cluster-mesh/tests/mcp-registry.spec.ts`, `tests/packaging/mcp-registry-consumer.spec.ts` et `tests/packaging/mcp-tuple.spec.ts`.

RED : l’entrée sélectionnée expose exactement `seat_availability` ; sans sélection ou binding, aucun handler ne tourne ; catalogue sans chargement du runtime ni lecture des credentials ; validation avant loader, conflit de nom et empreinte erronée refusés ; requête inter-tenant refusée ; aucune admission provoquée par une lecture ; aucune donnée secrète/path privée dans sorties, erreurs ou schémas publics. Tester depuis le package construit/packagé, pas seulement un import source.

La compatibilité entre l’objet `RegistryDefinition` de mcp-platform et le descripteur de distribution h2a 1.1.4 doit être prouvée par l’adaptateur prévu. Ne pas utiliser la ressemblance des noms comme preuve d’interchangeabilité. La combinaison de versions et les exports sont livrés ensemble.

**H0 — h2a / R5-R6 : consommation de l’entrée cluster-mesh.**

Sur la base HR à intégrer, fichiers : `packages/h2a/src/registry/registry.ts`, `src/registry/host-bootstrap.ts`, `src/registry/hosted.ts`, `src/registry/descriptors.ts` dans `packages/h2a/` ; `packages/h2a/src/runtime/mcp-http/readonly-allowlist.ts` ; `packages/h2a/package.json` et `packages/h2a-runtime/package.json`, avec leur lockfile de dépôt si la combinaison de dépendances évolue. Tests existants HR : `packages/h2a/test/registry-r5-descriptors.test.js`, `registry-r5-host-bootstrap.test.js`, `registry-r5-lifecycle.test.js`, `registry-r6-hosted.test.js` dans le même répertoire.

RED : troisième publisher sélectionné visible dans le bridge avec la même surface qu’annoncée ; désélection retire l’outil ; échec de compilation conserve la génération active ; R6 ne révèle ni chemin ni holder étranger ; une définition distante non supportée reste explicitement refusée. Aucun changement de logique de comptes dans `sentropic.h2a`. Ce lot peut commencer avec un publisher fixture ; la livraison réelle dépend de S3, de l’intégration R5/R6 et de la voie de binding distant retenue.

**H1 — h2a / runtime : lancer le siège admis, puis basculer sans perdre la session.**

Fichiers existants : `packages/h2a/src/runtime/mcp/agent-launch.ts`, `packages/h2a/src/runtime/mcp/tools.ts`, `packages/h2a-runtime/src/native-host.ts`, `src/cli-seat-codecs.ts`, `src/cli-seat-materialization.ts`, `src/profiles.ts` sous `packages/h2a-runtime/`. Ajouts proposés : [N] `packages/h2a-runtime/src/seat-launch.ts`, [N] `packages/h2a-runtime/src/seat-switch.ts`, [N] `packages/h2a-runtime/src/seat-switch.test.ts`, [N] `packages/h2a/test/seat-admitted-run.test.js`. Étendre `packages/h2a-runtime/src/cli-seat-runtime-wiring.test.ts`, `cli-seat-output-hygiene.test.ts`, `cli-seat-serialized-stream.test.ts` dans le même répertoire.

RED : le siège admis A est bien celui exécuté malgré des credentials ambiants B ; aucune source prioritaire Muse ne réintroduit B ; deux lancements Claude/Muse n’écrasent pas leur profil ; changement de génération entre lecture et lancement refusé ; expiration/401 d’un consumer ne déclenche aucun refresh ; panne ambiguë après effet externe ne rejoue pas le prompt ; reprise confirmée ou handoff explicite ; canaris absents d’argv/logs/MCP/environnements de sous-outils. Tester aussi refus de lancement après révocation et récupération contrôlée après arrêt des enfants.

Les scénarios synthétiques peuvent commencer maintenant. La recette réelle Claude ×2/Muse ×2 dépend de bindings enrôlés distincts, L1 publié/compatible, autorité S2 et qualifications natives. `scripts/e2e-cli-seats-direct.mjs` est actuellement un refus explicite de preuve live ; son nom n’autorise pas à annoncer une matrice réelle réussie. Les fichiers de recette sont `scripts/e2e-cli-seats-direct.mjs`, `packages/h2a/test/cli-seat-direct-matrix.test.js` et `docs/cli-seat-l2s.md`. Les faire évoluer dans leur lot de qualification, en distinguant receipt natif, mesh et bascule.

**H2 — h2a / conducteurs et méthode : décisions selon provisions.**

Ajouts proposés : [N] `packages/h2a-runtime/src/delegation-capacity.ts`, [N] `packages/h2a-runtime/src/delegation-capacity.test.ts`. Coutures existantes : `packages/h2a-runtime/src/delegate.ts`, `src/conductor-launch.ts`, `src/agent-launch-args.ts` sous ce package ; `packages/h2a/src/runtime/agy-claude.ts`. Méthode publiée : `packages/h2a/skills/harness/brainstorm/SKILL.md`, `harness/plan/SKILL.md`, `harness/review/SKILL.md`, `harness/test/SKILL.md` et `packages/h2a/skills/h2a-run/SKILL.md` ; les trois chemins abrégés restent sous `packages/h2a/skills/`.

RED : Muse-A épuisé choisit Muse-B seulement si admissible et indépendant ; deux Muse bloqués permettent Sol uniquement si fallback autorisé et cycle finançable ; modèle explicitement fixé sans équivalence permise rend un refus ; réserve de reviews conservée ; un job de remédiation ne détourne pas la capacité d’enrôlement et n’emploie pas Claude Code ; `max` est traduit selon capacité qualifiée, sans assimiler effort et nombre de délégués. Ajouter une assertion de trace indiquant le modèle résolu et les raisons de l’attente.

Le fichier global `agy-claude-quota.json` actuellement décrit par le code h2a manque de portée siège/owner/modèle pour cette autorité commune. Conserver éventuellement une projection de compatibilité, mais déplacer la vérité vers les observations S1 ; ne pas faire de ce fichier une seconde autorité. Préserver la classification fournisseur du code existant et son refus de retry automatique ambigu. [H-agy]

**I0 — consommateurs voisins : jobs quotidiens, tests et custody.**

Le contrôleur de vulnérabilités doit appeler l’admission commune avant l’auteur et recevoir les mêmes bindings que les reviewers. V décrit des travaux #371 hors du main inspecté ; aucun chemin de contrôleur supposé présent sur H n’est inventé ici. Les fichiers précisément affectables dès maintenant sont la spec V, la recette `scripts/e2e-cli-seats-direct.mjs`, son test `packages/h2a/test/cli-seat-direct-matrix.test.js`, et les specs sentropic `spec/SPEC_EVOL_CI_SEATS.md`, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` et SC `spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md`. Affecter le contrôleur #371 à ses fichiers réels au moment du rebase de sa branche.

RED d’intégration : un test gateway, un test CLI et un job de maintenance se disputent une même provision sans double compte ; deux dépôts ne créent pas chacun deux unités de maintenance ; une delivery custody manquante bloque seulement le consommateur concerné ; un cycle de remédiation sans ses deux reviews ne commence pas. Les autres dépôts consommateurs reçoivent une configuration/binding autorisé, pas une copie du coffre ni un quota local. Le détail de leur rollout dépend de l’inventaire réel des consommateurs.

Les lots S0/S1, le contrat de S2, les fixtures S3/H0, la politique H2 et les scénarios de switch H1 peuvent démarrer immédiatement sans sièges réels. L’activation exige ensuite **autorité commune effective → packages/registry compatibles → lancement lié à l’admission → preuves natives et mesh → recette entre consommateurs**. Ne pas attendre la matrice native complète pour rendre l’inventaire inconnu lisible ; ne pas utiliser cette première livraison pour annoncer une bascule qualifiée.

Pour les futures vérifications sentropic, utiliser les cibles existantes `make test-cluster-mesh SCOPE=…`, `make test-llm-mesh SCOPE=…` et `make test-mcp-platform SCOPE=…`, avec isolation de l’environnement et preuve des suites réellement exécutées. Pour h2a, conserver le runner de gates `scripts/run-test-gates.mjs` et son contrôle d’exécution du runtime ; des tests seulement découverts ou sautés ne sont pas des preuves. La combinaison publiée doit aussi passer une recette de consommation indépendante du monorepo. [H-test-gates]

**F — Questions ouvertes au propriétaire et incertitudes techniques**

Les questions suivantes portent sur les principes et restent ouvertes ; elles ne sont pas des choix binaires ni des demandes de secrets. Les lots indépendants ci-dessus ne sont pas suspendus à leurs réponses.

1. **Quelle réussite veux-tu maximiser quand tu dis « délégation max » : rapidité de fin, quantité de travaux achevés, profondeur de raisonnement, diversité de revue, ou réserve disponible pour ton travail à venir ?** Contexte : ces objectifs divergent quand un seul siège Codex ou une fenêtre Muse devient rare. Recommandation : qualité minimale et financement des reviews d’abord, puis maximum de parallélisme utile sous une réserve explicite.

2. **Quelle part des provisions souhaites-tu protéger pour l’usage interactif, les tests, l’enrôlement et la maintenance, et selon quels principes autoriser l’emprunt ou la priorité en cas d’urgence ?** Contexte : A fixe déjà le partage de la maintenance Codex ; il ne décrit pas toutes les futures délégations personnelles ni la manière d’étendre le pool. Recommandation : conserver 6/2/2 dans son périmètre actuel, rendre les conflits visibles et n’autoriser les emprunts qu’à travers une politique commune tracée.

3. **Quelle continuité attends-tu d’un switch automatique pendant un travail engagé, et quelle interruption acceptable privilégier quand le CLI ne sait pas changer d’identité en place ?** Contexte : une reprise avec autre profil peut perdre l’historique natif ou rejouer un effet. Recommandation : sélection automatique au lancement, puis redémarrage à frontière sûre/handoff documenté ; pause contrôlée si l’état des effets est incertain.

4. **Quels écarts de modèle, d’effort et de composition des reviewers considères-tu acceptables pour chaque phase lorsque le modèle préféré manque de provisions ?** Contexte : « Muse indisponible → Sol » peut convenir au code mais prendre toute la réserve de reviews ; deux reviewers sur un seul compte ne garantissent pas la diversité souhaitée. Recommandation : définir des familles de fallback par phase avec seuil de qualité et indépendance explicites ; garder le modèle demandé lorsqu’aucune équivalence n’est autorisée.

5. **Comment souhaites-tu arbitrer l’usage d’un siège dont l’authentification est saine mais dont le quota restant est inconnu ou périmé ?** Contexte : les diagnostics 429 donnent parfois un reset sans solde, et tous les providers ne fournissent pas forcément une observation complète. Recommandation : affichage honnête `unknown`, règle stricte du dossier commun pour tests/maintenance automatiques ; éventuelle tolérance interactive distincte, bornée, sans généraliser silencieusement un probe consommant des provisions.

6. **Dans le mécanisme utilisé pour gh, quelle expérience souhaites-tu retrouver précisément : sélection d’une identité déjà enrôlée, absence de reconnexion, isolation par contexte, bascule automatique au refus, ou administration commune des accès ?** Contexte : les sources montrent le switch/helper natif de gh et, séparément, une custody GitHub des sièges ; aucun switch multi-compte interne réutilisable n’a été retrouvé. Recommandation : conserver la sélection explicite sans exposer de credentials, avec profils d’exécution isolés ; raccorder une éventuelle implémentation existante dès qu’elle est identifiée.

Les autres inconnues sont à résoudre par l’implémentation et des preuves techniques, sans les transférer au propriétaire sous forme de choix de bibliothèque :

| Incertitude | Preuve à obtenir |
|---|---|
| Comptes réellement enrôlés et indépendance des deux sièges Claude/Muse | Inventaire de métadonnées autorisé, provenance et scopes de quota ; pas lecture des secrets par les agents. |
| Source de quota fiable par provider | API/diagnostic natif documenté, unité et portée, fixtures horodatées, fraîcheur, absence d’inférence payante cachée. Aucun endpoint de solde universel n’est démontré ici. |
| Autorité de capacité déjà déployée | Localisation du service propriétaire des dix unités, stockage et contrat de réservation ; empêcher tout doublon avant d’ajouter un backend. |
| Native access-only, renouvellement et keyrings | Receipts par CLI/version/OS ; daemon, enfants, priorité d’environnement et succession de famille effectivement testés. |
| Continuité entre comptes | Reprise/handoff Claude et Muse sans répétition des effets ; aucune promesse fondée sur la seule présence d’un flag `--resume`. |
| Livraison L1 et registry | Combinaison de packages effectivement publiée, adaptation de descriptor, R5/R6 intégrés et binding distant supporté. Un commit de branche ne vaut pas une installation qualifiée. |
| Portée du quota agy-Claude | Horodatage source et association compte/famille ; remplacer le cache global h2a comme autorité sans perdre les observations utiles. |
| Capacité financière et modèle servi | Coordination des holds existants avec la réservation de travail ; preuve distincte entre modèle demandé, résolu et réellement observé. |

[H-seat]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/docs/cli-seat-l2s.md
[H-package]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/package.json
[H-codecs]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/cli-seat-codecs.ts#L3
[H-materialization]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/cli-seat-materialization.ts#L3
[H-catalog]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts#L1
[H-focus-registry]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/focus/registry/entries.v1.json
[H-gh]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/gateway-host/live-github.ts#L1
[H-profiles]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/profiles.ts#L24
[H-launch]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a/src/runtime/mcp/agent-launch.ts#L18
[H-native]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/native-host.ts#L347
[H-wiring]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/cli-seat-runtime-wiring.test.ts
[H-run-skill]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a/skills/h2a-run/SKILL.md#L31
[H-agy]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a/src/runtime/agy-claude.ts#L5
[H-conductor]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a-runtime/src/conductor-launch.ts#L151
[H-launch-check]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/packages/h2a/src/runtime/governance/launch-check.ts#L1
[H-test-gates]: https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/scripts/run-test-gates.mjs#L1
[HR-definitions]: https://github.com/rhanka/h2a/blob/e8508e394ad2a3f772bb36cc51c2007af549a64e/packages/h2a/src/registry/definitions.ts#L1
[HR-registry]: https://github.com/rhanka/h2a/blob/e8508e394ad2a3f772bb36cc51c2007af549a64e/packages/h2a/src/registry/registry.ts#L1
[HR-hosted]: https://github.com/rhanka/h2a/blob/e8508e394ad2a3f772bb36cc51c2007af549a64e/packages/h2a/src/registry/hosted.ts#L1
[S-seat]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/enrollment/seat-bundle.ts#L13
[S-facade]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/service/facade.ts#L79
[S1-import]: https://github.com/rhanka/sentropic/blob/7293130ee3f6bfc6dd1e2fefcc07b3bd4d751a99/packages/llm-mesh/src/enrollment/cli-seat-import.ts#L1
[S-pool]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/account-transports.ts#L129
[S-local]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/service/local-account-transport-service.ts#L831
[S-route]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/route-planner.ts#L73
[S-routing-policy]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/routing-policy.ts#L53
[S-budget]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-gateway/src/ports/budget.ts#L1
[S-budget-host]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/api/src/services/llm-metering/budget-admission.ts#L1
[S-registry]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/cluster-mesh/src/mcp/registry.ts#L1
[S-custody]: https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md#L137
[SC-catalog]: https://github.com/rhanka/sentropic/blob/2224250b6b706c0b384fbc45340a53da5ca5b668/spec/SPEC_STUDY_GITHUB_SEAT_CREDENTIAL_CUSTODY.md#L191
