# Disponibilité des sièges, rotation des comptes et délégation selon les provisions

Analyse indépendante du 18 octobre 2026. Aucun code, commit, appel de modèle, accès à un coffre, lecture de secret ou de jeton. Les tests ci-dessous sont des propositions, **pas des tests exécutés**. Les passages normatifs proposés sont en anglais. Cette analyse ne revendique aucun consensus avec l'autre analyse parallèle.

**Recommandation : cluster-mesh doit exposer une capacité pérenne de disponibilité et d'admission des sièges, consommée par h2a via son SDK et par les agents via le registry MCP.** Elle rapproche l'identité du siège, ses usages autorisés, ses quotas, ses réservations et ses détenteurs. llm-mesh conserve les comptes, les transports et leur cycle d'authentification ; h2a conserve l'exécution des CLI et le conducteur. Le MCP donne une vue explicable ; l'admission atomique rend la décision exécutable.

Le changement de siège et le changement de modèle sont deux opérations différentes. On peut proposer une sélection automatique entre deux sièges Claude ou deux sièges Muse pour un nouveau lancement. On ne peut pas promettre aujourd'hui un changement de compte transparent au milieu d'une session : les preuves natives manquent. Un remplacement de Muse par Sol change également la CLI, le modèle et potentiellement l'éligibilité au rôle de revue.

## Périmètre des observations

Sources Git lues par objets, sans checkout ni fetch :

| Dépôt | Référence locale observée | Portée |
|---|---|---|
| h2a | `origin/main = 7ebbcf266e1988c18624d0158936949a214f9fd8` | Comprend #348 (`7670fbed6`), #373 (`46b82b427`), #352/R4 et #359/agy-Claude. |
| sentropic | `origin/main = 9ed96eb83cd77da710f1adeb83a19e425d6c4910` | Registry local, composition MCP, transports de comptes, catalogue et évolutions Vibe/Muse. |

Ces références sont les bases de cette analyse, pas une attestation de l'état déployé ou de npm au moment de la lecture. Aucun contrôle authentifié des six comptes n'a été effectué. Les sources documentaires et les journaux sont référencés en fin de fichier.

## A. Besoin, limites et sens de « disponibilité »

### A1. Ce que la demande engage

La demande du 18/10 engage trois résultats : une vue MCP des modèles effectivement accessibles sur les sièges enrôlés ; une sélection automatique des comptes d'un même fournisseur dans les CLI ; une politique de délégation adaptée aux provisions. La demande du 17/10 ajoute une finalité qui demeure : cinq fournisseurs, chacun qualifié séparément pour CLI et llm-mesh. La maintenance quotidienne devient un consommateur supplémentaire de cette même capacité.

L'inventaire propriétaire est **deux sièges Claude, un Codex, deux Muse et un agy**, soit six provisions annoncées. Vibe reste dans le contrat à cinq fournisseurs ; aucun siège Vibe supplémentaire n'est déclaré dans cette demande. Il faut le montrer comme non déclaré/non enrôlé selon l'état réel, sans l'ajouter fictivement et sans supprimer son support.

Ne sont pas impliqués : de nouveaux abonnements, un crédit API de secours, un second coffre dans h2a, une nouvelle table d'équivalence de modèles, une seconde matrice native, un remplacement du registry ou une refonte du moteur de revue. La disponibilité n'autorise ni l'utilisation d'un compte personnel non enrôlé ni une modification des droits attachés aux rôles. La demande n'établit pas non plus un plafond « six agents » : un siège, un modèle, une famille de renouvellement et un emplacement concurrent sont des objets différents.

### A2. Capital existant et vraie distance à la cible

| Capital vérifié | Réutilisation | Limite à conserver |
|---|---|---|
| #348 : `SeatBundle`, codecs des cinq CLI, matérialisation, familles/générations, flux sérialisés et tests synthétiques | Identité et projections d'un siège, environnement privé, refus de renouvellement chez le consommateur | Les codecs déclarent eux-mêmes leurs hypothèses natives non vérifiées. Le script direct est toujours un stub de refus. [H1–H3] |
| h2a `llm-mesh-accounts.ts` | Import par la façade cluster-mesh, validation locale et refus avant lecture d'entrée si L1 manque | La façade importée ne possède pas magiquement l'API attendue. À la base sentropic inspectée, `importSeatBundle` n'est pas dans la façade publique ; le garde h2a reste pertinent. [H4, S2] |
| llm-mesh `account-transports.ts` | Comptes, affinité, lease, réservation, poids, état `active/cooldown/reauth_required/disabled`, résultat d'exécution | Coordinateur en mémoire ; la réservation de transport n'est pas une réservation du budget quotidien partagé. Le service persiste des états de compte, pas toute l'autorité de capacité. [S1–S3] |
| llm-mesh route planner et route health | Inventaire exécutable, diagnostics de disponibilité, choix de routes, portée d'échec et règles de repli | Ne décrit pas les sièges natifs ni toutes les fenêtres de provision. Le cache de santé et le budget métier sont distincts. [S4] |
| #373 : catalogue h2a embarqué | Normalisation des alias de lancement connus, alignée sur llm-mesh | Un nom de modèle accepté ne prouve ni compte, quota ni modèle effectivement servi. [H5] |
| Registry cluster-mesh + mcp-platform ; R4/R5/R6 | Enregistrement/sélection/configuration/compilation, politiques et publication standard | R4 est sur main ; R5/R6 restent des travaux de migration/extension, pas des capacités natives toutes livrées. [S5, R1–R3] |

Attention à l'histoire des documents : `docs/cli-seat-l2s.md` conserve des phrases anciennes « PR must remain a draft ». #348 est pourtant bien fusionnée dans la base examinée. Leur utilité est de documenter les réserves techniques, pas de prouver un statut GitHub actuel. De même, une API source de #681 citée à un commit n'est ni une publication ni une adoption par h2a.

### A3. Une disponibilité composée, pas un booléen

La clé utile est au minimum **propriétaire vérifié × siège × usage × transport × modèle**, rattachée à la bonne génération. Plusieurs de ces routes peuvent dépenser la même provision.

| Dimension | Données non secrètes requises | Pourquoi |
|---|---|---|
| Enrôlement | `seatRef`, fournisseur/transport, état d'enrôlement, epoch/generation, provenance vérifiée, dernière livraison | Un compte annoncé, un import réussi et une projection effectivement livrée ne sont pas équivalents. |
| Droit d'usage | Usages CLI/mesh autorisés et qualifiés séparément, entitlement, classe de facturation, modèles et efforts supportés | Une clé de service Muse n'est pas une preuve de login CLI ; un modèle Claude servi par agy n'est pas un siège Claude Code. |
| Santé | Auth valide/expirée/à réauthentifier, panne réseau/transport, période d'attente ; source et horodatage | Un `401`, un `429`, une panne réseau et un siège occupé appellent des actions différentes. |
| Provision | Fenêtres applicables, périmètre du quota, unité, total/reste connus ou inconnus, réservations locales, seuil de réserve | Un reste en requêtes, un pourcentage et des unités de tests ne s'additionnent pas. |
| Réouverture | `providerResetAt`, `retryNotBefore`, précision/confiance, heure d'observation | Une date passée signifie « à réévaluer », pas « quota restauré ». |
| Occupation | Détenteurs autorisés, usage, tâche/session opaque, lease/expiration, exclusivité éventuelle, renouvellement en cours | Un accès consommateur peut être parallèle ; une famille renouvelable doit rester sous un seul détenteur autorisé. |
| Décision | Éligibilité à la demande, raisons de refus, politique/révision, fraîcheur, prochaine action utile | Le conducteur doit expliquer pourquoi il attend, change de siège ou choisit un repli. |

Il faut distinguer le **holder de la famille de renouvellement**, le **holder d'une exécution CLI** et les **réservations d'inférence**. L'affinité du transport existant ne suffit pas à prouver l'exclusivité native. Une expiration de lease ne prouve pas qu'un processus isolé ou déconnecté a cessé d'exécuter : fencing, arrêt confirmé ou protocole de reprise sont nécessaires avant de réattribuer une capacité exclusive.

Les observations doivent être typées : `known`, `unknown`, `stale`, avec leur source. Afficher `remaining: unknown` est correct ; le convertir en quota illimité ou en zéro mesuré est faux. **L'admission peut refuser un quota inconnu tout en conservant cette distinction dans la réponse.** Les quantités de provision fournisseur sont séparées des plafonds de tests et des réservations encore non réconciliées.

### A4. État à présenter par fournisseur et par usage

| Fournisseur / provision annoncée | Usage CLI | Usage llm-mesh | Particularité de disponibilité |
|---|---|---|---|
| Claude ×2 | Deux identités de sièges sélectionnables ; authentification et reprise à qualifier sur les binaires retenus | Deux comptes/projections indépendants à conserver après redémarrage et renouvellement | Quotas potentiellement partagés entre CLI/mesh d'un compte ; ne pas confondre avec Claude via agy. |
| Codex ×1 | `CODEX_HOME` et cache/keyring natif ; famille renouvelable à protéger | Transport Codex et catalogue de modèles rattachés au même compte | Un seul abonnement n'impose pas un seul modèle ; plusieurs identifiants de modèle ne créent pas plusieurs budgets ni plusieurs reviewers indépendants par eux-mêmes. |
| Muse ×2 | Login natif et sélecteur d'environnement à mesurer ; aucun hot switch prouvé | Chemin natif/import/device et clé de service distingués du chemin API facturé | Les `429` observés doivent être attribués au compte/fenêtre réel, pas à toutes les routes Muse sans preuve. |
| agy/cloud-code ×1 | Keyring natif isolé ; route et modèle explicitement sélectionnés | Projection cloud-code qualifiée séparément | Quota Claude/Opus peut être épuisé tandis qu'une route Gemini reste utilisable. La portée réelle du quota doit être fournie, pas inférée du seul nom `agy`. |
| Vibe, quantité non annoncée | Profil natif et clé d'origine plan à qualifier | Transport Mistral correspondant, sans confusion avec un crédit API de secours | Une clé statique peut permettre du pay-as-you-go ; sa présence ne prouve pas une provision admise. |

Cette table décrit les exigences, **pas dix qualifications réelles**. Le modèle de #348 autorise justement `nativeUse: unavailable` à côté d'une projection mesh. La cible duale reste due ; un premier incrément ne doit pas fabriquer des cases vertes.

### A5. Ce que prouvent les quotas de cette semaine

Les extraits opérationnels montrent :

- `lane088b.log:3` et `ptyspec3.log:3` : `Subscription quota exhausted`, réouverture annoncée `2026-10-18T10:53:24Z`.
- `diag2w.log:3`, `orph.log:3`, `ptycode.log:3` : réouverture `2026-10-18T15:55:01Z`.
- `rel0987-muse429.log:3`, `rv371fix.log:3`, `l6r1b-muse429.log:3` : réouverture `2026-10-19T00:00:00Z`.
- `velosol.log:1636` : le conducteur rapporte agy Opus épuisé « ~146 h ». `agyopus.log:30` contient la forme `RESOURCE_EXHAUSTED` / `Resets in 156h32m24s` reprise comme fixture. Ce sont des observations de dates/contextes différents, pas deux mesures simultanées contradictoires. [Q1–Q2]

Conséquences : une disponibilité « connecté/non connecté », une sonde permanente ou un retry fixe toutes les minutes seraient insuffisants. **Ces journaux ne donnent pas le reste quantitatif, l'identité de chacun des deux sièges Muse ni la cause de la variation des dates.** On ne peut en déduire une période fixe ni affirmer que les deux sièges ont été épuisés. L'indication propriétaire « Claude via agy jusqu'à environ 23/10 » reste une estimation ; une date absolue ne doit être produite qu'avec une observation horodatée exploitable.

Le pool actuel applique 60 secondes d'attente par défaut sans `retryAfterMs`, et le cache de route borne sa rétention à une heure. Ils restent utiles pour les pannes transitoires ; ils ne doivent pas effacer une observation métier d'épuisement de plusieurs jours. Le module agy-Claude existant conserve déjà une observation et refuse d'assimiler une date passée à un crédit revenu : ce comportement est à généraliser. [S1, S4, H6]

**Proposed specification — availability**

> Availability MUST be evaluated for a verified owner, seat, usage, transport and requested model. Enrollment, native qualification, authentication health, provider quota, local budget and execution occupancy MUST remain separate dimensions. Every observation MUST carry its scope, source and observation time. Unknown or stale quota MUST NOT be represented as unlimited capacity. A provider reset estimate MUST NOT by itself restore an exhausted seat to an admitted state. CLI and mesh projections of the same entitlement MUST reference shared quota buckets where their common scope is established.

## B. Propriété pérenne et consommation par h2a

### B1. Répartition recommandée

| Propriétaire | Responsabilité durable | Frontière |
|---|---|---|
| sentropic / cluster-mesh | Contrat public de disponibilité, rapprochement sièges/provisions/usages, admission transversale et publication MCP | Expose une autorité cohérente ; n'implémente pas les protocoles OAuth des fournisseurs. |
| sentropic / llm-mesh | Comptes, catalogue canonique, transports, observations fournisseur, cycle de credential et L1 | Fournit une projection explicitement sans secret. Ne pas sérialiser `AccountTransportAccount` ou `AccountTransportAcquisition`, qui contiennent du matériel d'authentification. |
| Runtime de custody/admission du programme sièges | Hébergement de l'autorité, stockage, renouvellement unique, livraison et reprise | Le programme L3 propose un dépôt privé ; ce runtime consomme le contrat cluster-mesh et ne maintient pas un compteur concurrent. |
| h2a | Résolution de lancement, profil privé, attachement de la réservation au processus, changement de siège, queue du conducteur | Conserve les références et reçus nécessaires ; aucun coffre fournisseur ni décision de quota indépendante. |
| Méthode / harness | Règles de rôle, qualité minimale, complémentarité, nombre de revues et politique de repli | Demande une capacité compatible ; une pénurie ne modifie pas implicitement les règles. |

**Bibliothèque et autorité déployée sont deux niveaux différents.** Un module dans cluster-mesh ne crée pas à lui seul une autorité globale. Tous les conducteurs et jobs utilisant une même provision doivent rejoindre le même état d'admission, même depuis plusieurs machines. Les factories de registry restent locales à leur composition ; elles accèdent à cette autorité par un port de confiance, sans transformer le registry en service mondial de comptes.

Le L3 existant est encore une spécification de dépôt privé, avec `src/seat-admission.ts` et ses tests prévus. Il ne faut ni déclarer ce service déjà déployé ni créer un second ledger dans cluster-mesh « en attendant ». Le lot d'intégration doit fixer un seul backend transactionnel et une seule source des compteurs ; le runtime L3 en devient l'hôte/adaptateur. Si une autorité a été livrée depuis cette lecture, elle est raccordée ou migrée explicitement, jamais doublée. [P1, P2]

### B2. Le chemin registry standard

Je propose un provider MCP **`sentropic.seats`**, publié par cluster-mesh, avec un premier outil de lecture **`seats_availability`** ; ces noms restent des propositions à figer dans le contrat. Une explication de sélection peut être incluse dans cette réponse pour éviter de multiplier les outils au premier lot.

Le provider suit les mêmes obligations que R4/R5/R6 :

1. Descripteur package-owned dans `registry/entries.v1.json`, export JSON `./registry/manifest`, définition pure et export de définition connu statiquement ; assets, schémas, versions et digests inspectés depuis le tarball.
2. `register → select → configure → compile` via `@sentropic/cluster-mesh/mcp/registry`, avec le noyau unique de mcp-platform. Catalogue sans activation, appel fournisseur ou scan de HOME.
3. Binding d'autorité injecté par le code de composition. Le nom opaque d'un binding ne donne aucun pouvoir ; aucun endpoint, chemin d'authentification ou credential en paramètre d'agent.
4. Schémas fermés/bornés, collision des noms refusée, fournisseur non sélectionné absent de la liste **et** du dispatch. Politique effective et autorisation de l'objet vérifiées à chaque appel.
5. h2a compose cette sélection sur son endpoint et sa clé de serveur **`h2a`**. Pas de MCP `seats` supplémentaire installé séparément dans chaque CLI, pas d'ajout clandestin à la liste statique de `h2a_*`.
6. Les informations métier changent sans changer les descripteurs. Une baisse de quota met à jour le résultat de l'outil ; elle ne fait pas disparaître l'outil ni ne requiert une recompilation du registry.

L'outil est en lecture seule, scoped au propriétaire et éventuellement à ses workspaces autorisés. Il peut filtrer usage, modèle, rôle ou classe de travail ; **le principal et les plafonds ne viennent pas des arguments du modèle**. Le détenteur visible est une référence de tâche/session autorisée, sans email, chemin serveur, donnée d'un autre propriétaire ni référence exploitable vers un secret.

La réponse distingue : vide établi ; quota inconnu ; données périmées ; autorité indisponible ; refus d'accès. Une panne n'est jamais convertie en « aucun siège ». Les assertions sensibles de santé/quota proviennent d'adaptateurs de confiance ; un texte d'agent disant « mon siège est libre » ne peut rendre un compte admissible.

### B3. Lecture MCP et décision de lancement

Le conducteur peut consulter le MCP pour choisir et expliquer. Le lancement h2a utilise ensuite le **même service via un SDK/port de confiance** pour obtenir une admission atomique. Passer par un dialogue MCP pour chaque sous-opération interne n'est pas nécessaire.

La réponse de lecture n'est pas un verrou. Entre sa lecture et le lancement, un autre conducteur peut consommer le dernier budget. L'admission refait donc la sélection ou vérifie le candidat sur la version courante, réserve les budgets applicables et retourne un reçu lié à la tâche, au siège, à la génération et à la politique. Un `leaseRef` public est un identifiant, jamais un bearer transférable.

L'API de lecture est la tranche MCP initiale. Réserver, renouveler, libérer et rapporter un résultat restent des opérations internes authentifiées. Les publier plus tard comme outils de mutation demanderait des politiques propres ; l'étiquette MCP « readOnly » ne suffit pas à autoriser une réservation.

**Proposed specification — ownership and registry**

> Cluster-mesh MUST own the public seat availability and admission contract. Llm-mesh MUST remain the authority for provider accounts, transport capabilities and credential lifecycle. H2a MUST consume these contracts without creating a provider credential store or an independent quota ledger. The availability provider MUST use the standard package-owned registry entry, selection and compiled dispatch path. Registry discovery MUST have no credential, provider-call or activation side effect. A read-only availability result MUST NOT grant admission; launch MUST revalidate and atomically reserve against the shared authority.

## C. Changement automatique de siège et mécanisme GitHub

### C1. Le mécanisme « gh » trouvé, avec ses limites

**Preuve directe, sans lecture de compte :** `/usr/bin/gh`, version `2.46.0`, aide locale `gh auth switch --help`. La commande sélectionne le compte actif d'un hôte déjà authentifié ; avec exactement deux comptes, l'absence de `--user` bascule vers l'autre, avec davantage il faut désambiguïser. `gh auth setup-git --help` explique l'utilisation de gh comme credential helper Git. `gh help environment` établit que `GH_TOKEN`/`GITHUB_TOKEN` priment sur le compte stocké et que `GH_CONFIG_DIR` sélectionne le répertoire de configuration. Aucune de ces aides ne réalise de changement. [G1]

La propriété réutilisable est **« identités enrôlées une fois, sélection par référence non secrète, résolution d'authentification par le composant de confiance »**. gh n'apporte pas la politique de quota, le changement en milieu de session ou une transaction commune avec une CLI de modèle. Son sélecteur actif est partagé par les commandes utilisant la même configuration ; le modifier globalement pour deux sessions concurrentes créerait précisément la course à éviter.

Recherche ciblée dans les deux bases : aucune occurrence de `gh auth switch` ni contrôleur h2a/cluster-mesh de rotation multi-compte trouvé. Dans h2a, `auth-tools.ts` fournit bien un mécanisme **distinct** d'export opt-in des outils auxiliaires : il récupère le credential gh en interne pour reconstruire la configuration d'un Pod ; `cred-health.ts` fournit une sonde et une réparation de credentials. Ce sont du transport et de la santé d'authentification, pas une sélection de siège selon sa provision. [H7]

**Conclusion de preuve :** la référence la mieux étayée est le multi-compte natif de gh, avec sa séparation sélection/résolution. L'intention exacte du propriétaire pourrait viser un autre mécanisme local non présent dans les deux bases ; elle n'est pas établie. Il ne faut pas transformer le bundling gh historique en coffre ou en export visible par le modèle.

### C2. Ce que les CLI permettent, et ce qui reste à qualifier

Les éléments ci-dessous sont les capacités observées dans le code et la documentation déjà capitalisée ; aucune nouvelle exécution authentifiée n'a été réalisée.

| CLI | Support établi ou documenté | Ce qui n'est pas démontré |
|---|---|---|
| Claude Code | Sélection de configuration par `CLAUDE_CONFIG_DIR` dans le codec ; authentification native ; reprise `--resume <id>` / `--continue` dans les profils h2a | Un équivalent multi-compte atomique de `gh auth switch`, le rechargement garanti du credential dans un processus vivant, la reprise sur l'autre profil sans perte de contexte. |
| Muse | Login navigateur ou clé ; priorité de `META_API_KEY` ; reprise `muse resume <id>` ; paramètres modèle/raisonnement gérés par h2a | Le sélecteur `XDG_CONFIG_HOME` du codec est une **hypothèse synthétique** : le lecteur mesh utilise `homedir()/.config/muse/auth.json`. Aucun changement automatique de compte natif ni portabilité du login par clé de service n'est prouvé. |
| Codex | Répertoire `CODEX_HOME`, cache natif ou keyring ; reprise `codex resume <id>` ; sélection du modèle par `-m` | Un profil de configuration n'est pas une identité de compte ; ni l'import access-only ni un changement de compte transparent ne sont qualifiés par les fixtures. La rotation de refresh rend la copie concurrente dangereuse. |
| agy | Profils d'authentification en keyring ; le chemin structuré h2a utilise `--conversation <id>` ; modèle explicite et traitement d'épuisement Claude déjà présents | Changer seulement HOME ne prouve pas l'isolation du keyring. ADC/Gemini/API key ne remplace pas le siège agy. Le helper générique de profils et le chemin structuré n'emploient pas tous les mêmes arguments de reprise : qualifier le chemin réellement utilisé. |
| Vibe | Login navigateur/clé ; fichier `.env`, priorité de `MISTRAL_API_KEY`, configuration propre et `VIBE_HOME` dans le codec ; reprise `--resume` | Les profils et réglages de modèle ne démontrent pas un switch multi-compte ni l'absence de surcoût. Aucun mécanisme de rotation de quota automatique n'est qualifié. |

Sources : [H2, H8–H9, P1 §5]. L'absence de preuve n'est pas l'affirmation qu'aucune version du fournisseur ne le permet. Le livrable doit comporter une matrice native version/OS/mode et un adaptateur capable de dire « non supporté ».

### C3. Comportement automatique recommandé

Pour une **nouvelle exécution**, h2a demande un siège éligible du fournisseur choisi. La politique peut privilégier l'affinité tant qu'elle est compatible, puis les provisions réellement indépendantes les moins engagées. Le pool actuel privilégie d'abord l'enrôlement le plus récent : réutiliser son exécution n'oblige pas à reprendre ce classement comme politique d'optimisation. On réserve avant de matérialiser le seul profil choisi, puis on lie le reçu au processus effectivement créé.

Pour une **session existante** :

1. Conserver le siège tant que la tâche et ses réservations restent valides. Ne pas faire osciller les comptes à chaque tour pour consommer un reste marginal.
2. Sur épuisement fiable, cesser les nouvelles admissions pour le bon bucket ; attendre un point de reprise sûr. Un `429` dans une sortie citée par le modèle n'est pas une preuve provider.
3. Identifier ce qui a déjà été exécuté : réponse partielle, outils, modifications de fichiers et appels externes. Ni un timeout ni un échec après engagement n'autorisent une réexécution aveugle.
4. Arrêter/drainer le processus concerné et accomplir, si nécessaire, la capture du successeur du détenteur renouvelable. Une perte ambiguë maintient le fence.
5. Acquérir le siège de remplacement et reprendre par l'interface native **si cette combinaison version/OS/profil/reprise a été qualifiée**. Sinon, une nouvelle session reçoit un checkpoint de tâche autorisé, avec la rupture de continuité explicitement annoncée.
6. Conserver la trace ancien siège/nouveau siège/raison/point de reprise et l'identité h2a logique si son protocole le permet. Ne pas modifier le compte global de l'utilisateur ni les sessions voisines.

Le caractère « automatique » est atteignable pour les tâches gérées par h2a et les CLI lancées via un adaptateur équipé. Une CLI lancée directement depuis un terminal hors de ce circuit ne devient pas supervisée parce qu'un MCP de lecture existe. Il faut fournir le raccord au lancement natif et annoncer précisément sa couverture ; des instructions demandant au modèle de copier des fichiers d'authentification ne sont pas une intégration.

Défaillances à couvrir : login environnemental prioritaire sur le profil choisi ; deux labels pour le même compte/bucket ; profil mutable partagé entre deux processus ; réauthentification `401` prise pour un quota ; second siège également épuisé ; historique absent dans le nouveau profil ; bail perdu mais processus vivant ; changement de génération pendant la sélection ; redémarrage pendant un switch ; prompt ou secret divulgué dans argv/env/MCP ; contexte d'organisation incompatible entre deux comptes.

La protection doit couvrir les outils que le modèle peut lancer, pas seulement la réponse MCP. Un fichier `0600` sous le même utilisateur et un filtrage de variables d'environnement ne suffisent pas à interdire sa lecture par un shell. Le processus natif de confiance doit pouvoir consommer sa capacité d'authentification ; les outils du modèle, sous-processus ordinaires et tests candidats ne doivent pas pouvoir la lire par fichier, environnement, descripteur, socket ou `/proc`. Cette frontière doit être qualifiée sur le vrai chemin d'exécution, avec contrôles positifs et canaris inventés. Les garanties synthétiques de #348 ne constituent pas cette preuve native. Un secret éventuellement transmis par un canal privé d'authentification ne doit jamais rejoindre un environnement générique de sous-outil, un prompt, une commande visible ou un reçu.

**Proposed specification — account switching**

> Automatic same-provider selection MUST operate on enrolled seat references and qualified per-process authentication bindings. It MUST NOT mutate the owner's shared default login. Existing sessions MUST remain bound to their admitted seat until a qualified safe handoff. In-flight or ambiguously committed work MUST NOT be replayed automatically. Native resume across seat profiles MUST be claimed only for positively qualified CLI/version/platform combinations. Credential resolution and materialization MUST remain outside model-visible inputs, outputs and tools. Trusted native authentication and model-invoked tools MUST have separately enforced access boundaries; environment filtering and file permissions alone MUST NOT qualify that separation. Credential renewal MUST retain its single authority and family fencing across switches.

## D. Délégation « max en fonction des provisions »

### D1. Deux dimensions de « max »

Le mot peut viser **l'effort de raisonnement maximal** et **le parallélisme maximal admissible**. Les deux doivent être représentés séparément. Deux sièges de plus ne prouvent ni que l'effort `max` est accepté par une CLI ni que davantage de travail peut être lancé aujourd'hui.

État réel : `agent-launch-args.ts` et `h2a_run` exposent `low|medium|high|xhigh`. Le skill `h2a-run` traduit « max » vers `xhigh` pour Claude/Codex/Muse ; le catalogue gateway possède ses propres mappings, et agy-Claude possède une normalisation `max → high`. Le skill contient encore une consigne agy plus restrictive que le code récent. **Il faut réconcilier ces contrats et enregistrer intention, argument effectivement appliqué et éventuelle observation provider**, pas faire croire qu'un même mot est une garantie uniforme. [H5–H6, H9–H10]

### D2. Sélection par rôle, puis admission selon les ressources

Le conducteur suit cet ordre :

1. Charger une politique versionnée de tâche : rôle `spec/build/review/challenge`, candidats autorisés, qualité minimale, effort demandé, diversité et contraintes de données/coût. Les directives de tâche du propriétaire prévalent sur un ancien document de modèles.
2. Résoudre les modèles et capacités par le catalogue canonique llm-mesh, en passant par cluster-mesh. Le catalogue embarqué #373 est un capital de compatibilité de lancement, pas une seconde autorité d'inventaire vivant.
3. Filtrer les candidats par disponibilité **pour l'usage réel**, autorisation du fournisseur et du compte, qualification native, entitlement et restrictions du rôle.
4. Former un ensemble cohérent auteur/reviewers ; ne pas choisir chaque rôle indépendamment si cela rend la fin du cycle impossible.
5. Réserver atomiquement la capacité nécessaire ; seulement ensuite lancer. Une réponse MCP périmée déclenche une réévaluation bornée, pas une boucle de lancement.
6. Enregistrer les identités demandées et observées, les consommations/réservations, les échecs et le prochain réveil. L'absence d'attestation reste `unknown`.

Le parallélisme maximal est le plus grand ensemble de tâches respectant **toutes** les contraintes : plafonds du conducteur, capacité des hôtes, places autorisées par siège/famille, budgets par classe et reste sûr dans chaque fenêtre fournisseur. Il n'est ni la somme des sièges ni le nombre de modèles listés. Une admission peut autoriser plusieurs usages access-only d'un compte si cette concurrence est qualifiée ; elle doit alors décompter leur provision commune.

**Replis proposés, à versionner dans la méthode :** préserver un niveau de qualité minimal par rôle ; tenter les sièges admissibles du même modèle/fournisseur ; si la politique l'autorise, choisir un autre couple CLI/modèle adapté au rôle ; sinon mettre en attente avec une raison et une date utile. Ne jamais réduire automatiquement deux revues à une, autoriser l'auto-revue ou transformer une revue de conception en simple revue de code pour rentrer dans le budget.

### D3. Exemple Muse → Sol, avec les vrais obstacles

| Situation | Action compatible |
|---|---|
| Nouveau travail de code, Muse A épuisé, Muse B admissible et indépendant | Réserver Muse B, même intention de modèle/effort si elle est supportée. |
| Les deux routes Muse sont inadmissibles ; politique de code autorisant Sol | Nouvelle admission Codex/Sol, avec identité et motif de repli explicites. Le compteur Muse n'est pas « effacé » ; le budget Codex est vérifié séparément. |
| Muse a partiellement exécuté une tâche | Reprendre depuis un checkpoint qualifié ; ne pas envoyer aveuglément le même brief à Sol. |
| Auteur Codex/Sol, revue destinée à Muse, repli envisagé vers Codex/Sol | Inéligible si la règle interdit le host ou le modèle de l'auteur. Chercher une autre jambe admissible ou attendre ; deux sièges Codex ne changeraient pas cette règle. |
| agy Claude/Opus épuisé, Gemini encore disponible | Ce n'est pas un switch de siège : réévaluer un autre modèle selon la politique du rôle. Le module agy-Claude actuel interdit justement une substitution silencieuse vers Argon. |

Il existe une dette documentaire avérée : le skill de revue limite encore les profils de sélection à `claude|codex|vibe`, alors que `h2a_run` en accepte cinq ; le document de gouvernance d'août impose une ancienne liste de modèles exhaustive. La spec maintenance propose désormais un auteur Muse et deux modèles Codex différents, sans déclarer ce pool validé. **La disponibilité seule ne rend pas ce pool conforme à la méthode actuelle.** Le lot méthode doit expliciter les règles applicables et les extensions autorisées ; un simple changement de liste dans le conducteur serait insuffisant. [H10–H11, P2 §3–4]

Ne pas confondre diversité de modèles et diversité de comptes. Les règles de complémentarité auteur/reviewer et d'indépendance des jambes s'appliquent au pool effectivement autorisé. Les reçus de lancement prouvent une demande/argument, pas forcément le modèle servi par un gateway. Une substitution peut aussi invalider une preuve de revue ; elle doit être détectée ou déclarée non attestable.

### D4. Équité avec tests et maintenance

Les décisions existantes sont déjà substantielles : plafond **10 unités par CLI et jour UTC**, agrégé entre acteurs/OS/familles du programme ; réserve fournisseur **strictement supérieure à 20 % dans chaque fenêtre applicable** ; quota illisible = aucune inférence de test/maintenance. Une invocation/tour native compte une unité selon le contrat ; chaque requête/retry mesh compte individuellement. Une tâche longue ou multi-tour n'est pas forcément une unité. [P1 §3.3, §10]

Le choix du propriétaire **« A · Partager la maintenance »** est acquis : les corrections utilisent les **deux unités de maintenance Codex**, partagées avec la qualification/maintenance native ; les **six CI et deux enrôlement restent protégées**. Ce split ne doit être ni redemandé ni contourné en rebaptisant une correction « CI ». Le contrat impose de réserver le cycle auteur + deux revues avant l'auteur. [P2 D6–D7]

Une version minimale Muse-auteur + deux revues Codex coûte déjà deux unités de maintenance Codex, sans compter reprises ou tours supplémentaires. **Si elles sont libres, la borne théorique est donc un cycle minimal par jour pour l'ensemble des dépôts prêts, pas un par dépôt.** Cela ne promet pas qu'un cycle pourra être admis : quota, qualité, autre maintenance et provision Muse peuvent le refuser.

Il faut conserver un plafond de programme par CLI : ajouter ou changer de siège ne multiplie pas le cap de 10. À l'inverse, les fenêtres fournisseur de deux comptes ne doivent être fusionnées que si leur partage est établi. Les deux contraintes se superposent ; l'une ne remplace pas l'autre.

Équité proposée : files par classe de travail et dépôt ; réserves protégées ; rotation/ancienneté au sein de la part maintenance ; réservation du cycle complet ; visibilité du travail différé et du temps d'attente. Commencer par une règle déterministe simple, puis mesurer la privation de capacité. Les jobs en attente de checks ou de maturation reprennent leur état sans refaire auteur et revues déjà terminés. Les échecs ambigus gardent une charge/réservation conservatrice jusqu'à réconciliation.

Les travaux de développement personnels et les délégations hors programme de tests doivent également publier leurs engagements sur la provision commune pour ne pas masquer la consommation. **Leur droit à utiliser la réserve personnelle ou les unités protégées n'est pas donné par cette demande.** La politique doit garder des classes distinctes et faire arbitrer les principes de partage, sans étendre silencieusement le split Codex à toutes les activités et tous les fournisseurs.

**Proposed specification — delegation and fairness**

> Delegation MUST select a role-qualified execution plan before reserving resources. Model quality, requested reasoning effort and allowed parallelism MUST be independent policy inputs. Scarcity MUST NOT weaken author exclusion, review diversity, required review count or explicit model constraints. Every fallback MUST identify its policy, reason and requested execution target. All consumers of an entitlement MUST share provider quota accounting. Switching seats MUST NOT reset program counters. Maintenance MUST retain the adopted Codex allocation of six CI units, two protected enrollment units and two shared maintenance units, and MUST reserve the complete author-and-review cycle before author execution. Unknown quota MUST refuse test and maintenance inference under the existing seat policy.

## E. Lots par propriétaire, fichiers exacts et RED proposés

**Statut des chemins :** les fichiers existants cités sont ceux des bases Git ci-dessus. Les chemins marqués **nouveaux** sont des livrables proposés, pas des fichiers prétendument trouvés. Cette analyse n'ouvre aucune branche et n'exécute aucun test. Chaque lot d'implémentation devra refiger son SHA de départ, ses interfaces et ses commandes avant code.

### S1 — sentropic / llm-mesh : projection publique et observations de provision

Fichiers existants :

- `packages/llm-mesh/src/account-transports.ts`
- `packages/llm-mesh/src/service/local-account-transport-service.ts`
- `packages/llm-mesh/src/service/facade.ts`
- `packages/llm-mesh/src/enrollment/contracts.ts`
- `packages/llm-mesh/src/route-health.ts`
- `packages/llm-mesh/src/routing-contracts.ts`

Nouveaux proposés : `packages/llm-mesh/src/service/account-availability.ts`, `packages/llm-mesh/src/service/quota-observations.ts`, `packages/llm-mesh/tests/service/account-availability.test.ts`, `packages/llm-mesh/tests/service/quota-observations.test.ts`. Les adaptateurs fournisseur existants ne sont modifiés que pour les sources de quota effectivement qualifiées ; aucune URL de quota hypothétique n'est spécifiée.

**RED positif initial :** avec deux comptes synthétiques d'un propriétaire, deux usages et un modèle, la façade doit renvoyer une projection sans secret incluant fenêtres, état inconnu et occupation ; la façade actuelle ne fournit pas cette projection. Puis régressions distinctes : épuisement Opus n'interdit pas Gemini sans portée commune ; quota de 146 h survit à la rotation du cache de santé ; reset passé reste à revalider ; événement ancien ne remplace pas une génération plus récente ; suppression/révocation immédiatement visible ; deux propriétaires isolés ; matériau d'authentification absent de tous résultats/erreurs/logs.

**Démarrable maintenant :** contrat/projection et tests synthétiques. La lecture numérique réelle de chaque fournisseur est une qualification dédiée ; ce lot peut honnêtement retourner `unknown` sans l'inventer.

### S2 — sentropic / cluster-mesh : disponibilité, admission et état partagé

Nouveaux proposés :

- `packages/cluster-mesh/src/seats/contracts.ts`
- `packages/cluster-mesh/src/seats/availability.ts`
- `packages/cluster-mesh/src/seats/admission.ts`
- `packages/cluster-mesh/src/seats/store.ts`
- `packages/cluster-mesh/src/seats/index.ts`
- `packages/cluster-mesh/tests/seats-availability.spec.ts`
- `packages/cluster-mesh/tests/seats-admission.spec.ts`
- `packages/cluster-mesh/tests/seats-recovery.spec.ts`

Intégration dans `packages/cluster-mesh/package.json` et, si le découpage de module le requiert, `src/modules/{contracts,catalog}.ts`. Réutiliser le port transactionnel/stockage qualifié du dépôt, notamment `src/storage/root-facade.ts` et les backends existants, sans réimplémenter ce noyau. `seats/store.ts` contient le raccord du domaine, pas un nouveau coffre. Le binding vers le backend réellement déployé doit être fixé avec le propriétaire L3 avant activation.

**RED positif initial :** deux clients indépendants demandent en concurrence le dernier cycle complet disponible : exactement un reçoit l'admission et l'autre une raison structurée. Le résultat doit résister à un nouveau processus et à un redémarrage de l'hôte. La primitive actuelle de réservation de transport en mémoire ne satisfait pas cette capacité.

Régressions : cap 10 agrégé malgré rotation sur deux sièges ; frontières `<`, `=`, `>` 20 % dans plusieurs fenêtres ; totalité auteur/reviews réservée ou aucun lancement ; idempotence de la même demande ; annulation avant engagement versus résultat ambigu ; libération exactement une fois ; frontière UTC sans double crédit ni effacement d'un engagement précédent ; expiration de bail sans preuve d'arrêt ; révocation/génération entre lecture et acquisition ; panne du backend sans admission locale de secours ; fairness de deux dépôts sous rareté.

**Démarrable maintenant :** domaine, ports et concurrence sur stockage synthétique/qualifié. La production attend le raccord unique au runtime d'autorité et la livraison L1 nécessaire aux projections réelles. Ce n'est pas un lot pour contourner L3.

### S3 — sentropic / cluster-mesh : publisher MCP standard

Nouveaux proposés : `packages/cluster-mesh/registry/entries.v1.json`, `packages/cluster-mesh/src/registry/definitions.ts`, `packages/cluster-mesh/src/seats/mcp.ts`, `packages/cluster-mesh/tests/seats-mcp.spec.ts`, `packages/cluster-mesh/tests/packaging/seats-registry-consumer.spec.ts`. Fichiers existants à faire évoluer : `packages/cluster-mesh/package.json`, `packages/cluster-mesh/tests/mcp-registry.spec.ts`, `packages/cluster-mesh/tests/mcp-composition.spec.ts`. Un asset manifest/schema additionnel devra avoir son chemin exact déclaré dans l'entry et être présent dans le tarball ; pas de schéma dupliqué dans h2a.

**RED positif initial :** un consommateur isolé installe le tarball, lit le manifest, sélectionne `sentropic.seats`, compile avec le binding de confiance et appelle l'outil exact via le dispatcher standard. Cette entrée n'existe pas à la base inspectée.

Régressions : import/catalogue sans effet ; non-sélection = aucun chargement ni dispatch ; binding absent/inadmissible = refus avant activation ; collision = compilation refusée ; schéma/digest/export manquant = refus ; principal forgé ou autre propriétaire = aucun accès ; autorité en panne distincte du vide établi ; aucune donnée secrète ou chemin serveur dans les résultats.

**Démarrable maintenant :** descriptor/definition/fixtures après fixation des noms et de la projection S1/S2. La migration h2a finale dépend du contrat R5 compatible ; R6/UI n'est pas un prérequis de l'outil de lecture. Sérialiser les écritures de package/registry avec la lane registry existante.

### C1 — runtime privé custody/admission : intégrer la même autorité

Propriétaire : mainteneur CI/custody du programme sièges. Dépôt prévu par L3 : **`rhanka/sentropic-seat-custody`**, dont l'existence/déploiement reste à vérifier par cette lane ; aucun checkout local n'est inventé ici.

Chemins déjà prévus par L3 : `src/seat-admission.ts`, `src/seat-stream.ts`, `src/seat-maintenance.ts`, `src/seat-receipts.ts`, `config/consumers.json`, `config/seats.json`, `.github/workflows/seats.yml`, `tests/seat-admission.test.ts`, `tests/seat-crash-recovery.test.ts`, `tests/seat-serialized-stream.test.ts`, `tests/e2e/seat-persistent-delivery.test.ts`. Nouveau raccord proposé : `src/seat-cluster-mesh-adapter.ts` et `tests/seat-cluster-mesh-adapter.test.ts`.

**RED positif initial :** un job gateway et un job CLI, puis le job maintenance, voient la même réservation et ne peuvent dépenser deux fois la dernière capacité après reprise. Le split A est appliqué dans l'autorité réelle, pas seulement dans la configuration d'un client. Le test de redémarrage conserve les deux comptes Claude, puis le changement de génération d'un compte sans écraser l'autre. L3 a déjà nommé ce dernier test : l'étendre, ne pas créer un système de persistance dans le harness de test.

**Démarrable maintenant :** contrat de raccord et qualification synthétique du L3. Activation authentifiée conditionnée à l'existence de son runtime, aux preuves de custody, de facturation et de quota ; les autres lots ne revendiquent pas sa livraison.

### H1 — h2a : consommateur cluster-mesh et visibilité sur l'endpoint commun

Existant : `packages/h2a/src/runtime/mcp/server.ts`, `packages/h2a/src/runtime/mcp/tools.ts` pour les points actuels de composition/parité, et `packages/h2a-runtime/src/llm-mesh-accounts.ts` pour le raccord de façade. Au point R5, fichiers **prévus par cette lane mais absents de la base main examinée** : `packages/h2a/registry/entries.v1.json`, `packages/h2a/src/registry/{definitions,central-binding,session-profile}.ts`.

Nouveaux proposés : `packages/h2a-runtime/src/seat-capacity-client.ts`, `packages/h2a-runtime/src/seat-capacity-client.test.ts`, `packages/h2a/test/seats-registry-composition.test.js`.

**RED positif initial :** deux hôtes pointant sur le seul serveur `h2a` voient le provider sélectionné et le même état propriétaire ; h2a n'a ni descripteur copié ni réponse fabriquée si l'autorité manque. Régressions : sélection/retrait, identité qualifiée, erreurs, endpoint hosted autorisé seulement par son profil, binding absent, aucune configuration MCP supplémentaire.

**Démarrable maintenant :** SDK client et conformance sur faux port. La mise à disposition finale suit R5 et les versions publiées compatibles ; ne pas annoncer l'outil simplement parce qu'une fonction locale existe.

### H2 — h2a : liaison siège-processus et changement de compte

Fichiers existants concernés :

- `packages/h2a-runtime/src/index.ts` — commande de lancement et passage des paramètres au processus ;
- `packages/h2a-runtime/src/native-host.ts` — possède déjà les paramètres de siège aux points interactif/headless/MCP ;
- `packages/h2a-runtime/src/tmux.ts` — autre backend de lancement à raccorder, sans héritage de credential global ;
- `packages/h2a-runtime/src/cli-seat-codecs.ts`, `cli-seat-materialization.ts`, `profiles.ts`, `agent-launch-args.ts` ;
- `packages/h2a/src/runtime/mcp/agent-launch.ts`, `packages/h2a/src/runtime/mcp/tools.ts` — évolution explicite du contrat de lancement, sans lease fourni comme autorité par le modèle.

Nouveaux proposés : `packages/h2a-runtime/src/seat-selection.ts`, `seat-switch.ts`, `seat-selection.test.ts`, `seat-switch.test.ts`, `packages/h2a/test/mcp-seat-launch.test.js`. Réutiliser `cli-seat-runtime-wiring.test.ts`, `cli-seat-output-hygiene.test.ts` et `cli-seat-serialized-stream.test.ts` ; ne pas remplacer leurs garanties par un nouveau mock plus permissif.

**RED positif initial :** deux sièges synthétiques Claude puis Muse, premier inadmissible, second admis : la commande complète doit exécuter le processus avec l'identité réservée sur native **et** tmux, pas seulement retourner le bon label. Le chemin actuel de lancement structuré n'acquiert pas cette admission et ne passe pas automatiquement un siège sélectionné aux points déjà capables d'en recevoir un.

Autres RED : la sélection ne change pas une session voisine ; environnement prioritaire hostile refusé ; compte B sans historique ne prétend pas avoir repris A ; échec engagé sans répétition d'outils ; génération perdue avant spawn = aucun spawn ; redémarrage pendant le switch sans deuxième acteur ; capture/successeur avant libération d'une famille renouvelable. Les canaris synthétiques doivent aussi être inaccessibles aux vrais descendants/outils par environnement, fichiers et canaux de processus, avec contrôles positifs prouvant que le scénario s'exécute. La qualification native positive version/OS est ensuite portée par le programme L2/L2a/L7 existant et son `scripts/e2e-cli-seats-direct.mjs`, pas par une nouvelle matrice. Premier incrément Claude/Muse, autres fournisseurs gardés explicitement non qualifiés jusqu'à leur preuve.

**Démarrable maintenant :** tests intégrés avec faux binaires/projections inventées et contrats de reprise. Les sondes natives réelles restent un lot opérateur admis, séparé de cette analyse et des fixtures.

### H3 — h2a : sélection des délégations et queue selon les provisions

Existant : `packages/h2a-runtime/src/delegate.ts`, `index.ts`, `conductor-launch.ts`, `registry.ts`, `agent-launch-args.ts`, `packages/h2a/src/runtime/mcp/agent-launch.ts`. Nouveau : `packages/h2a-runtime/src/delegation-capacity-policy.ts`, `delegation-capacity-policy.test.ts`, `packages/h2a/test/delegation-capacity-flow.test.js`.

**RED positif initial :** Muse en quota, politique de code autorisant Sol, Codex admissible : un plan explicite Sol est réservé puis lancé avec motif ; une politique ou un rôle interdisant ce repli reste en attente. Aujourd'hui AIMD/plafond local et backoff ne sélectionnent pas ce plan transversal.

Régressions : auteur exclu des reviews malgré deux comptes ; deux modèles qui se résolvent au même modèle ne créent pas deux jambes ; réserve d'un cycle avant auteur ; plafonds partagés entre deux conducteurs ; succès d'une jambe conservé après reprise ; quota épuisé avec reset futur ne boucle pas en backoff court ; aucun contournement de `agy-claude-quota-exhausted`. Réutiliser AIMD comme limite locale pour le transitoire, pas comme preuve de capacité globale.

**Démarrable maintenant :** planificateur pur et faux service d'admission après résolution des règles de rôle M1. L'activation du lancement dépend de S2/H2.

### M1 — méthode/harness et maintenance : une seule politique applicable

Propriétaires : lane méthode/harness, conducteur h2a, conducteur maintenance. Fichiers existants h2a : `docs/governance/model-assignment.md`, `packages/h2a/skills/harness/review/SKILL.md`, `packages/h2a/skills/harness/brainstorm/SKILL.md`, `packages/h2a/skills/h2a-run/SKILL.md`. Sources méthodologiques sentropic : `packages/harness/skills/review/SKILL.md`, `packages/harness/skills/brainstorm/SKILL.md`. Le lot doit identifier les copies générées/installées et mettre à jour leur source selon le mécanisme de livraison existant, sans dérive manuelle des miroirs.

Livrable : contrat versionné rôles/candidats/effort/replis, référencé par les skills et consommé mécaniquement par H3. Nouveau document canonique proposé dans h2a : `docs/governance/delegation-capacity-policy.md`. Sa représentation exécutable doit être définie avec H3 ; ne pas créer deux listes de modèles concurrentes.

**RED comportemental avec H3 :** le pool auteur Muse + deux reviewers Codex autorisé par une politique qualifiée peut être sélectionné ; le même pool interdit par une autre politique échoue explicitement. Une simple liste de sièges ne doit pas contourner les anciennes restrictions du sélecteur. La normalisation d'effort doit passer le vrai validateur et le vrai builder de lancement. Des tests qui cherchent seulement une phrase dans un skill ne prouvent pas l'application de la méthode.

Le raccord #371 utilise, après rebase/intégration par sa propre lane, les chemins **effectivement nommés par la spec v2** : `packages/h2a/src/vuln-fix/seats.mjs`, `policy.mjs`, `controller.mjs`, `repository.mjs`, ainsi que `packages/h2a-runtime/src/vuln-seat.ts` et `cli-seat-materialization.ts`. Tests nommés : `packages/h2a/test/vuln-fix-seats.test.js`, `vuln-fix-policy.test.js`, `vuln-fix-controller.test.js`, `vuln-fix-repository.test.js`, et le nouveau `vuln-fix-seat-authority.test.js` de sa spec. Ils ne sont pas déclarés présents sur main par cette analyse. Avant code, cette lane résout les chemins sur son HEAD réel et leur classification existant/nouveau ; l'autorité est appelée pour le cycle complet et la reprise respecte les charges déjà engagées. Aucun module d'autorité absent n'est remplacé par une imitation locale h2a.

**Démarrable maintenant :** réconciliation documentaire et contrat de politique, puis tests de sélection. Le déploiement autonome #371 reste soumis à sa propre spec, à ses gates et à l'autorité de merge existante ; ce nouveau besoin ne les déclare pas satisfaits.

### E1. Ordre de travail et vérification

Séquence technique proposée : projection S1 + contrat de politique M1 → autorité S2/raccord C1 → publisher S3 et client H1 → liaison native H2 → délégation H3 → qualifications réelles et intégration maintenance. Les travaux de contrats et fixtures peuvent avancer sans comptes ; les publications et la mise en production doivent prouver leurs dépendances réelles. La cible reste cinq fournisseurs × deux usages ; un MVP Claude/Muse ne clôt pas cette finalité.

Commandes de développement proposées, à revalider dans la révision du lot, avec les fichiers effectivement créés : `rtk make test-llm-mesh SCOPE=tests/service/account-availability.test.ts ENV=test-seat-capacity` et `rtk make test-cluster-mesh SCOPE=tests/seats-admission.spec.ts ENV=test-seat-capacity` depuis sentropic ; `rtk node --test packages/h2a/test/mcp-seat-launch.test.js` et `rtk node --test packages/h2a/test/delegation-capacity-flow.test.js` depuis h2a. Les cibles Make existent sur la base inspectée ; vérifier que le wrapper cluster-mesh adopté propage le sélecteur, sinon livrer le raccord ciblé conforme avant code. Les tests Node h2a doivent employer les modules runtime réellement compilés par son circuit et être enregistrés dans son inventaire/preuve d'exécution. Les fichiers runtime `.test.ts` proposés doivent eux aussi être raccordés explicitement à un runner exécuté ; leur seule présence ne compte pas comme couverture. Pas de suite complète locale ; intégration complète en CI, avec les gates du dépôt.

Il faut distinguer le **RED initial d'une capacité positive absente** des **tests de garde** qui peuvent déjà réussir sur un système ne lançant jamais rien. Par exemple, « aucune fuite quand aucune exécution n'a lieu » ne prouve pas le changement de siège. Le reçu final doit inclure une sélection positive, le processus exécuté avec cette identité et sa consommation réconciliée, puis les refus et reprises autour de ce chemin fonctionnel.

**Proposed specification — owner-visible acceptance**

> The selected registry tool MUST expose the owner's six declared provisions without treating declarations as verified enrollment, and MUST report native and mesh readiness separately. Missing Vibe provisioning MUST remain visible without creating a fictitious seat. Positive live acceptance MUST demonstrate qualified same-provider selection on both Claude seats and both Muse seats, including the supported safe-handoff boundary and isolation from neighboring sessions. A Muse-to-Sol fallback MUST obey the selected role policy and produce an explicit execution record. Concurrent gateway tests, CLI tests and maintenance MUST use one admission state that survives restart and preserves the adopted maintenance allocation. Partial provider or platform coverage MUST remain explicitly open; synthetic imports and launch receipts alone MUST NOT close live dual-use acceptance. No acceptance artifact may disclose credentials or claim a served model identity that was not established.

## F. Questions ouvertes de principe et incertitudes

Les quatre questions suivantes sont un dossier à présenter au propriétaire, **pas un questionnaire binaire ni une demande de permission pour lire ou produire cette analyse**. Elles n'annulent pas les choix déjà acquis : cluster-mesh comme propriétaire, double usage, plafonds de tests, réserve et option A de maintenance.

### F1. Quel résultat veux-tu maximiser quand la provision devient rare : profondeur de raisonnement, nombre de travaux terminés, délai ou diversité des avis, et quels rôles doivent conserver un minimum incompressible ?

Contexte : « max » peut augmenter le coût d'un tour alors que les revues ont des exigences de diversité ; un fallback Sol ne convient pas à chaque rôle. **Recommandation :** fixer des minima par rôle, conserver les deux revues et leur indépendance, puis maximiser le débit avec les sièges et replis admissibles ; attendre plutôt que dégrader silencieusement une exigence explicite. Les noms exacts et efforts sont une politique versionnée, pas une table éternelle dans un skill.

### F2. Comment souhaites-tu partager la capacité entre ton travail interactif, les délégations de développement, les tests et la maintenance, notamment quand plusieurs dépôts attendent la même provision ?

Contexte : six provisions annoncées ne disent pas si chaque siège est personnel, de laboratoire ou partagé ; le split Codex 6/2/2 et la réserve fournisseur sont déjà décidés pour le programme existant. **Recommandation :** conserver ces protections, déclarer les classes/sièges réellement mutualisables, privilégier la continuité du travail interactif et faire tourner la part maintenance entre dépôts prêts avec visibilité de l'attente. Aucun emprunt aux réserves par défaut. L'équipe implémente les mécanismes ; le propriétaire arbitre les priorités et l'étendue du partage.

### F3. Quel niveau de continuité et de visibilité attends-tu d'un switch automatique, et quelles limites veux-tu poser au transfert de contexte entre comptes ou fournisseurs ?

Contexte : choisir Muse B pour un nouveau travail est simple conceptuellement ; reprendre Muse A au milieu d'effets de bord ou transférer son contexte à Sol change les garanties et parfois le périmètre des données. **Recommandation :** automatiser la sélection initiale et les passages sûrs qualifiés dans le même fournisseur ; annoncer les changements en cours de tâche ; autoriser les replis entre fournisseurs par politique de rôle et de données déjà consentie, avec checkpoint et traçabilité. Aucune répétition aveugle d'effets ni transfert de contexte d'organisation implicite.

### F4. Quelle règle souhaites-tu appliquer aux délégations ordinaires quand la provision n'est pas mesurable ou que l'autorité est indisponible, tout en conservant les interdictions déjà fixées pour tests et maintenance ?

Contexte : les `429` donnent une preuve d'épuisement mais pas un solde ; la lisibilité machine n'est pas prouvée pour tous les fournisseurs. La règle existante interdit déjà l'inférence de test/maintenance si le quota est illisible. **Recommandation :** visibilité `unknown/stale`, absence de nouvelle admission automatique garantie, file d'attente et action opérateur explicite ; pour d'éventuelles exceptions au travail interactif, définir une classe et une limite bornée séparées. Ne pas inventer un quota depuis un abonnement ni financer un repli API non autorisé. Les mainteneurs restent responsables de livrer les sondes et la récupération, pas le propriétaire de coder l'intégration.

### F5. Incertitudes à résoudre par les mainteneurs, sans les convertir en choix techniques imposés au propriétaire

- Quel mécanisme local précis le propriétaire désigne par « gh » si ce n'est pas `gh auth switch` ? La preuve trouvée et le pattern réutilisable sont documentés ; aucune implémentation custom n'a été trouvée dans les bases.
- Quels sièges sont réellement enrôlés, quelles identités opaques les distinguent, et quelles fenêtres sont communes CLI/mesh ou entre comptes ? L'annonce de quantité ne le démontre pas.
- Quelles interfaces fournisseur donnent reste/total/reset sans inférence, avec quelle fraîcheur ? Les dates `429` sont utiles mais insuffisantes pour appliquer la réserve de 20 %.
- Quelles commandes natives/version/OS prennent en charge l'isolation d'authentification, l'accès non renouvelable, la reprise entre profils et l'absence de rechargement global ? Muse/XDG et agy/keyring sont des inconnues importantes.
- Où en sont aujourd'hui la publication L1/#681, l'adoption de ses versions par h2a et l'autorité L3 ? Les sources inspectées montrent leurs frontières ; elles ne prouvent pas une publication ou un déploiement ultérieur.
- Quel est le contrat registry effectivement intégré au lancement du lot ? Le v3 h2a décrit historiquement v7 comme copie de v6, mais le v7 lu ici a une correction et un digest différent. Il faut refaire l'intake des documents actuels, pas reprendre une phrase historique comme vérité courante.
- Quelles règles de rôle sont en vigueur pour chaque tâche ? La directive propriétaire actuelle, le skill de revue, la gouvernance d'août et la spec maintenance ne forment pas encore un contrat machine unique. Cela doit être réconcilié avant d'activer les replis.
- Quels plafonds de concurrence réels les fournisseurs autorisent-ils, et comment les processus hors h2a sont-ils comptés ? Sans raccord ni observation, l'autorité peut garantir ses propres admissions, pas toute la consommation externe.

## Références et preuves reproductibles

Les chemins h2a ci-dessous s'entendent à `7ebbcf266e1988c18624d0158936949a214f9fd8` ; les chemins sentropic à `9ed96eb83cd77da710f1adeb83a19e425d6c4910`. Une lecture reproductible est `rtk git -C <repo> show <sha>:<path>` ; les numéros sont ceux du fichier à ce SHA, pas nécessairement du checkout de travail.

| Réf. | Source |
|---|---|
| H1 | h2a `docs/cli-seat-l2s.md`, notamment limites synthétiques, Tour 3 et publication ; `scripts/e2e-cli-seats-direct.mjs:2`, refus final à `:58`. [Contrat](https://github.com/rhanka/h2a/blob/7ebbcf266e1988c18624d0158936949a214f9fd8/docs/cli-seat-l2s.md). |
| H2 | h2a `packages/h2a-runtime/src/cli-seat-codecs.ts:17` et `:64` : hypothèses, sélecteurs, priorité et marqueurs non vérifiés. |
| H3 | h2a `packages/h2a-runtime/src/cli-seat-materialization.ts:264` ; tests `cli-seat-runtime-wiring.test.ts`, `cli-seat-serialized-stream.test.ts`, `cli-seat-output-hygiene.test.ts` ; `native-host.ts:347`, `:398`, `:596`, `:670`. |
| H4 | h2a `packages/h2a-runtime/src/llm-mesh-accounts.ts:312`, `:354`, `:362`, `:412` ; h2a/runtime package pins cluster-mesh `0.16.0`, llm-mesh `0.26.0`. |
| H5 | h2a `packages/h2a-runtime/src/gateway-model-catalog/model-catalog.ts:1`, `:68` ; `src/index.ts:6588` : normalisation des alias de lancement. |
| H6 | h2a `docs/agy-claude-models.md:32` et `:73` : épuisement typé, aucun repli implicite, observation durable et reset estimé ; implémentation `packages/h2a/src/runtime/agy-claude.ts`. |
| H7 | h2a `packages/h2a-runtime/src/auth-tools.ts:30`, `:85`, `:159`, `:175` ; `cred-health.ts:17`, `:43` : bundling/health gh, pas de switch multi-compte. Le code a été lu, ses fonctions d'authentification n'ont jamais été appelées. |
| H8 | h2a `packages/h2a-runtime/src/profiles.ts:23` ; `agent-launch-args.ts:96`, `:110`, `:129`, `:147` ; `delegate.ts:193` : reprise et limites headless. |
| H9 | h2a `packages/h2a-runtime/src/agent-launch-args.ts:6`, `:86` ; `packages/h2a/src/runtime/mcp/agent-launch.ts:10`, `:18`, `:47` : profils, efforts et validation fermée. |
| H10 | h2a `packages/h2a/skills/h2a-run/SKILL.md:37`, `:47`, `:56` ; `packages/h2a/skills/harness/review/SKILL.md:12`, `:30`, `:49`, `:122` : résolution, sélection et limites d'enforcement. |
| H11 | h2a `docs/governance/model-assignment.md`, directive datée du 20/08, listes exhaustives et distinction demande/attestation ; `delegate.ts:268`, `:578` : AIMD et slots locaux. |
| S1 | sentropic `packages/llm-mesh/src/account-transports.ts:20`, `:39`, `:55`, `:70`, `:187`, `:340`, `:464`. [Pool](https://github.com/rhanka/sentropic/blob/9ed96eb83cd77da710f1adeb83a19e425d6c4910/packages/llm-mesh/src/account-transports.ts#L187). |
| S2 | sentropic `packages/llm-mesh/src/service/facade.ts:79`, `:96`, `:104`, `:140` ; `enrollment/contracts.ts:74` : administration publique actuelle ; `enrollment/seat-bundle.ts:65` : identité et projections. |
| S3 | sentropic `packages/llm-mesh/src/service/local-account-transport-service.ts:586`, `:696`, `:831`, `:879` : projection d'administration limitée, lifecycle, inventory et persistance de résultat. |
| S4 | sentropic `packages/llm-mesh/src/route-planner.ts:73`, `:94` ; `route-health.ts:18`, `:48`, `:89` ; `routing-contracts.ts:175` : portées, TTL et engagement. |
| S5 | sentropic `packages/cluster-mesh/src/mcp/registry.ts:41`, `:61`, `:117`, `:150` ; `compose/mcp.ts:1`, `:90` ; `integrations/llm-mesh/facade.ts:1` ; `integrations/mcp/artifacts.ts` : exemple de builtin et frontière. |
| R1 | h2a `packages/focus/registry/entries.v1.json`, format `sentropic.registry-entry/v1`, contrat `1.1.4` ; `src/registry/definitions.ts` et tests de packaging : R4 livré. |
| R2 | `/home/antoinefa/src/sentropic/.tmp/registry-contract/registry-entry-contract-v7.md`, §§2, 3.1, 3.3, 5.1, 6–9. SHA-256 observé `1a5a9cd5156e7709dd0ef31acf95348bbeafc9dd032ad0975c3ada2658d9e08b`. Contrat de travail, pas preuve de publication de tous ses lots. |
| R3 | `…/0985/registry-h2a/spec-h2a-registry-v3.md:80`, `:148`, `:166`, `:281` : propriétaire, R5, parité et R6. SHA-256 `3e17700411cf153317550795c3bf20f271b381eb37e4b7977cacb82f936d2010`. Ses bases historiques sont antérieures aux deux main examinés. |
| P1 | `/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/spec-v10.md:154`, `:160`, `:178`, `:283`, `:607`, `:646`, `:689` : état de custody, Q1/Q3, limites natives et L3. SHA-256 `9db694f19f5fbc548b70cb7ad22e211d0c9ed6a693878276ae0f607726a1471c`. Les références fournisseur de son §11 sont datées ; aucune nouvelle vérification web des comptes n'est prétendue ici. |
| P2 | `…/0985/act371/SPEC_EVOL_VULN_FIX_ACTIVATION.v2.md:180`, `:209`, `:230`, `:244`, §§6/L3/L7 : double usage, autorité commune, capacité A, cycle et couverture finale. SHA-256 `624146043693f553cd50cd4c6f3f618242f1066866511eba09f76009dcc58593`. |
| Q1 | Journaux directs `…/0985/lane088b.log:3`, `ptyspec3.log:3`, `diag2w.log:3`, `orph.log:3`, `ptycode.log:3`, `rel0987-muse429.log:3`, `rv371fix.log:3`, `l6r1b-muse429.log:3`. Lecture ciblée de `429`/`quota`, sans extraction d'identifiants d'authentification. |
| Q2 | `…/0985/velosol.log:1636` : résumé conducteur ~146 h ; `agyopus.log:30` : forme du diagnostic historique `Resets in 156h32m24s`. Ne pas prendre ses nombreuses copies de fixture pour autant d'appels provider. |
| G1 | Aides locales lues seulement : `rtk gh auth switch --help`, `rtk gh auth setup-git --help`, `rtk gh help environment`, `rtk gh auth login --help`. Références publiques : [switch](https://cli.github.com/manual/gh_auth_switch), [setup-git](https://cli.github.com/manual/gh_auth_setup-git), [environment](https://cli.github.com/manual/gh_help_environment). Ni `auth switch`, ni `auth status`, ni `auth token`, ni lecture de configuration utilisateur n'ont été exécutés. |

Dans les chemins abrégés `…/0985`, le préfixe est `/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad`. La seule écriture de cette tâche est ce fichier d'analyse.
