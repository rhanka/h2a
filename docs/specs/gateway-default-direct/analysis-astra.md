Analyse du défaut gateway — 19 octobre 2026 — WP14, bug `01M5AANHQWK4RZRCXT5VVA2CM6`.

**Le défaut direct existe déjà pour un lancement neuf, mais il ne gouverne pas tous les chemins.** Le restore global et les jobs délégués consultent encore `llmMesh.enabled`. Les reprises rejouent les anciens pins sans connaître leur provenance. Deux correctifs pertinents, du 30 juillet et du 17 septembre, existent dans Git **sans être intégrés à main**. Une simple modification supplémentaire du défaut du lanceur ne résoudrait donc pas l’ensemble.

Le message « gateway was stopped; started… » prouve le démarrage du daemon. Il ne prouve pas, à lui seul, le routage de Claude : un `run` actuel sans pin nettoie ensuite son environnement. Le chemin **pin `gateway` → restore → `--gw` → injection dans le PTY** explique directement le symptôme décrit. Identifier lequel a servi le 19 octobre demanderait une preuve d’état local, volontairement hors périmètre ici.

**Périmètre et références.** Lecture des règles, du code et de Git uniquement ; aucun h2a installé, host réel, état personnel, Python, test, build ou commit exécuté. Seul ce rapport est écrit. Les tests cités ont été lus, pas exécutés ; aucun résultat vert n’est revendiqué.

| Source | Référence examinée | Portée |
|---|---|---|
| `origin/main` | `dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`, 19/10, merge #380 | Baseline **B** de toutes les lignes de code ci-dessous. |
| `main` local | `ec09dac96dd7417c73d251799598aa243d43f2d3`, 26/09, v0.97.9 | Même défaut direct, même préparation globale du restore ; ref locale plus ancienne. |
| Checkout partagé | `docs/org-raci-wp7-hinfra`, HEAD `0d6b2eaf5884`, nombreux fichiers modifiés | Modifications en cours exclues des conclusions sur main ; rien déplacé ni corrigé. |
| Journal Track | Version Git B et fichier de travail `.track/events.jsonl` | Le premier contient le GO de septembre ; le second contient D-034 et le bug du 19/10. Ne pas confondre leurs numéros de ligne. |

Pour garder les tableaux courts : **R/** = `packages/h2a-runtime/src/` ; **H/** = `packages/h2a/src/` ; **K/** = `packages/remote-k8s-orchestrator/src/` ; **C/** = `apps/control-plane/src/`. Ainsi `R/index.ts:2418` désigne `packages/h2a-runtime/src/index.ts:2418` dans B, consultable avec `git show B:chemin`. **E** désigne le journal de travail ; **E@B** le journal commité.

**1. Chemins d’activation : installation, configuration et décisions de lancement.**

| Chemin et preuve | Déclencheur | Résolution actuelle / constat |
|---|---|---|
| Primo-install : `R/config.ts:418`, `:527` ; `R/profiles.ts:11` | Aucun fichier de configuration ni ancien état | Config absente → `{}` ; `llmMesh.enabled` → `false`. Profil Claude = commande `claude`, args vides, aucun flag gateway. **Pas de défaut neuf actif trouvé sur main.** |
| Migration de configuration : `R/index.ts:2700` ; `R/config.ts:327`, `:353`, `:379` | Premier lancement h2a avec ancien répertoire `remote-cli` | Déplace le répertoire et pose un lien de compatibilité ; ne réécrit ni `enabled:true` ni les pins. Une « nouvelle installation » avec ancien état n’est pas un primo-install vierge. |
| Install / doctor / upgrade : `H/hosts/upgrade-equipment.ts:7`, `:17` ; `H/hosts/installation-doctor.ts:205` | Installation/réparation des plugins et endpoints MCP | Pas d’écriture activant le routage LLM trouvée dans ces surfaces. L’upgrade lance notamment `doctor --repair`. La détection des anciens fichiers de comptes est informative ; ce n’est pas une migration de consentement gateway. |
| Options et profil : `R/index.ts:2145` ; `R/protocol-local.ts:17`, `:37` | `run` / `resume`, absence de `--gw` et `--no-gw` | Parseur → `auto` ; helper Claude : `auto` → **direct**. Autres profils → direct. Les profils actuels n’ont pas de champ d’opt-in gateway. |
| `llm-mesh start` / `restart` : `R/index.ts:10956`, `:10965`, `:11030` | Démarrage ponctuel, y compris daemon déjà démarré | Écrit aussi `llmMesh.enabled:true`. Le consentement à démarrer le service devient une autorisation persistante de réactivation. `stop` (`:11000`) ne remet pas ce booléen à false. |
| `llm-mesh enable` / `disable` : `R/index.ts:10976`, `:10988` | Action explicite de configuration | Écrit true/false. Ce choix global ne dit pas quelles instances doivent être routées ; le booléen ne distingue pas `enable` d’un ancien `start`. |
| Jobs `delegate` / file d’attente : `R/index.ts:1398`, `:1546`, `:1560`, `:1571` | Démarrage d’un job Claude avec runtime enabled et gateway disponible | **Contourne le helper direct.** Acquiert une session gateway selon le booléen global, sans choix du job. Ne démarre pas lui-même le daemon ici ; si acquisition absente, nettoie l’environnement et reste direct. |

**Reprises et MCP.**

| Chemin et preuve | Déclencheur | Ce que devient `auto` / choix conservé |
|---|---|---|
| Restore global : `R/index.ts:9955`, `:9995`, `:2404` | `h2a restore` sans flag, `llmMesh.enabled:true` | `forceGateway` absent → préparation en `auto` ; `:2418` laisse passer si enabled. Peut démarrer le daemon **même sans instance ayant choisi la gateway**. |
| Injection / auto-start : `R/index.ts:2218`, `:2228`, `:2236`, `:2240` | Appel brut en `auto` avec enabled, ou mode `gateway` | `auto` signifie encore « utiliser la gateway si enabled ». Si acquisition échoue, `startGateway(config ?? {})` ; message exact à `:2246`. Mode `direct` sort avant ces effets. |
| Restore par onglet : `R/restore.ts:676`, `:918` ; `R/launch-layout.ts:75` | Ancien enregistrement avec `gatewayMode:"gateway"` | Copie le pin jusqu’à `tabCommand`, qui émet **`--gw`**. Un pin hérité est ainsi présenté au nouveau lanceur comme un flag explicite. Sans pin : pas de flag, donc direct via le lanceur actuel. |
| `resume` et `run --resume` : `R/index.ts:5749`, `:6517` | Pas de flag actuel mais pin registre présent | `gatewayMode === "auto" ? entry.gatewayMode ?? "auto" : gatewayMode`, puis helper. Pin gateway → gateway ; absence de pin → direct. |
| Restart natif : `R/native-restart.ts:144` ; `R/index.ts:2324`, `:8916`, `:8946` | `restart` sans `--gw on/off` | Reprend `session.gatewayMode ?? "auto"`. `on`/`off` remplacent explicitement le choix ; absence de pin → direct après préparation. Prépare puis restaure l’environnement du caller autour de chaque enfant. |
| Relaunch natif / tmux : `R/index.ts:9095`, `:9432` | Recréation d’une instance existante | Reprend le même pin, sinon auto → direct. Pas de migration distinguant pin explicite et implicite. |
| `restore --no-gw` : `R/index.ts:9967`, `:9995` ; `R/launch-layout.ts:225` | Override direct | Empêche le préchauffage global et force les **nouveaux** processus en direct. Une session vivante est rattachée et conserve sa posture : ce n’est pas une bascule de processus. |
| MCP `h2a_run` : `H/runtime/mcp/agent-launch.ts:194`, `:317`, `:351`, `:431` | Champ absent ou `gateway:"auto"` | Pas de flag CLI ajouté ; nouveau lancement → direct. Le validateur exige un résultat direct. `required` ajoute `--gw`, `off` ajoute `--no-gw`. Le worker hérite initialement de l’env MCP, nettoyé ensuite par le runtime normal. |
| Auto-relance de boucle : `H/runtime/loop/engine/adapters.ts:528`, `:559` | Spec persistée de lancement | `required` réémet `--gw` ; auto ne met aucun flag. **Contrat de résultat moins strict que MCP** : pour Claude auto, accepte encore gateway ou direct. Ce n’est pas une activation à lui seul, mais une protection manquante. |

**Environnement, PTY et déploiements.**

| Chemin et preuve | Déclencheur | Effet et limite de la preuve |
|---|---|---|
| Env parent → lancement courant : `R/index.ts:2223`, `:2259` | `ANTHROPIC_BASE_URL` / `AUTH_TOKEN` hérités | En direct, suppression des deux ; conservation d’une `ANTHROPIC_API_KEY` utilisateur. Un lancement courant neuf via `run` n’active donc pas la gateway par simple héritage de ces deux variables. |
| Env tmux : `R/tmux.ts:325`, `:335`, `:1014`, `:1196` | Ancien serveur tmux ayant conservé des variables | Purge avec `env -u` **seulement si aucune des trois variables Anthropic n’est présente chez le caller**. Une API key utilisateur conservée suffit à désactiver cette purge : BASE_URL/AUTH_TOKEN du serveur peuvent réapparaître. Cas déduit du code, non testé ici. Le `bash -lc` peut aussi relire une configuration exportant ces variables. |
| Enfant natif : `R/native-host.ts:397`, `:625`, `:685` | Création CLI, headless ou sidecar | Copie l’env du caller, ou celle du seat fourni. Pas de politique gateway propre. Le chemin normal est protégé en amont ; un appel direct de ce niveau peut transporter une env polluée. |
| Primitive PTY : `R/native-terminal/op.ts:833` | `create` sans `--env-file`, ou fichier contenant la gateway | Copie `process.env` par défaut ; aucune résolution de `auto`. C’est une primitive générique, à ne pas confondre avec le lanceur Claude. |
| Env du daemon PTY : `R/native-terminal/supervisor.ts:232`, `server.ts:175`, `host.ts:951` | Host démarré depuis un parent sous gateway | Le daemon hérite bien du parent, **mais le spawn PTY emploie `options.env`, sans fusion avec l’env du daemon**. Pas de fuite démontrée du seul host vers une requête déjà nettoyée. |
| Upgrade / re-exec : `H/runtime/upgrade/index.ts:934`, `:946` | Usage du helper de re-exec | Conserve argv et env du processus ; ne crée pas d’opt-in. L’upgrade ne remet pas à zéro les pins/configurations ; une recréation de CLI repasse par les chemins ci-dessus. Aucune preuve que ce helper a été emprunté lors de l’incident. |
| Soft-refresh : `R/soft-refresh.ts:404`, `:418` | Refresh d’un **pod distant**, respawn tmux | Script de reprise sans résolution gateway ni purge ; réutilise l’environnement du pod/tmux. Ce chemin ne correspond pas au redémarrage du host natif local. |
| `migrate` et fichiers de profil : `R/migrate.ts:658`, `:678` ; `R/attach.ts:683` ; `R/auth-bundle.ts:18`, `:85`, `:125` | Migration locale → pod ou copie des credentials/settings | Pas de choix gateway dans cette requête de création. `settings.json` Claude est copié après retrait des hooks seulement : un éventuel champ `env` portant la gateway survit. Source conditionnelle de routage, pas preuve de son existence chez l’owner. |
| Control-plane / k8s : `C/index.ts:127` ; `C/routes/sessions.ts:417` ; `K/k8s/provisioner.ts:108` ; `K/k8s/spec.ts:728`, `:813` | `LLM_GATEWAY_URL` configurée et acquisition de token réussie | URL globale → acquisition pour chaque session → BASE_URL + **API_KEY** dans le pod, sans opt-in par instance. URL/token absents → aucune injection explicite. `envFrom` peut aussi transporter ces clés. Le token k8s utilise une autre variable que le chemin local. |
| Déploiement commité : `deploy/scw/configmap.example.yaml:6`, `:26` | Manifeste d’exemple livré | Pas de `LLM_GATEWAY_URL` / `ANTHROPIC_BASE_URL` dans cet exemple. `H2A_BROKER_MODE:false` concerne le broker **MCP/OIDC**, pas le routage LLM : ce booléen ne prouve rien sur la configuration locale de l’owner. |
| Instructions de lancement : `packages/h2a/skills/h2a-run/SKILL.md:50`, `:54` ; historique `a49bfa419` | Agent traduisant un modèle nommé | Avant le correctif documentaire : gateway « on » par défaut pour un flavor nommé. Un agent pouvait donc produire un `--gw` sans demande gateway distincte de l’owner. Le texte actuel dit direct, mais propose encore de démarrer la gateway pour interroger le catalogue à l’étape 2. |

**2. Demandes antérieures retrouvées.** Les quatre citations d’août/septembre sont dans D-034 (`01M53PQ37XZ9RFT6HQ0NG1RQ0P`, **E:1686**), reconstitution enregistrée le 17/10 ; ce ne sont pas quatre événements contemporains indépendants.

| Date de la demande | Trace vérifiable | Objet exact |
|---|---|---|
| 30/07 | Message de `b1a37adce` / `5dadf86b7`, référence `01KYSTGGF57MET8WETDDV6G1W4` | Défaut OFF et configurable. Trace indirecte par le commit ; cet ID n’a pas été retrouvé dans les événements Git accessibles ni dans E. |
| 14/08 18:26 | E:1686 | « j’ai lancé h2a restore --no-gw […] en gw » ; demande d’une bascule avec redémarrage. |
| 19/08 11:04 | E:1686 | « place ma config locale en --no-gw par défaut ». |
| 23/08 02:33 | E:1686 | Restart d’une CLI ou de toutes avec changement gw/no-gw ; vrais tests e2e demandés dans #231. |
| 14/09 13:12 | E:1686 ; **E@B:1482, 1489, 1491, 1492** | « toujours un mode --gw par défaut […] ce devrait être l’inverse » ; config déployée sur main. Le journal commité enregistre la décision `01M2GY6BNED8RPXY23GRBA74SN`, option et outcome GO. |
| 19/10 | E:2437, bug fourni | Primo-install **et** configuration locale ; récidive au restart. |

Il y a donc cinq traces antérieures concordantes, dont trois portent explicitement sur le **défaut OFF**, les deux autres sur la fidélité du restore/la bascule. Cela documente la répétition ; cela ne permet pas d’affirmer que quatre correctifs complets ont été mergés. Le GO de septembre n’apparaît pas dans le même snapshot Track que D-034 : consulter les deux versions est nécessaire.

**Correctifs et raisons pour lesquelles la demande reste ouverte.**

| Commit / intégration | Changement réel | Limite / cause de non-tenue |
|---|---|---|
| `b1a37adce` et `5dadf86b7`, 30/07 | `defaultGateway`, fallback direct ; priorité flag > config > défaut ; MCP délègue le défaut au CLI | **Non intégrés à B** ; branches `origin/fix/h2a-gateway-default-config` et `fix/h2a-gateway-default-config`. Restore laissé volontairement intact. Test limité au fallback ; aucune preuve de déploiement owner. |
| `1743549f7`, merge **#180 `024676a35`**, 07/08 | Préparation du restore compatible avec l’évolution des comptes ; échec bloquant si gateway explicitement requise | Conserve `auto + runtimeEnabled → gateway`. Ce correctif ne promettait pas le défaut OFF. Trace : E:1017 ; recette historique E:1018–1022, pas une recette du bug actuel. |
| `c61205b48`, merge **#231 `b81c668f4`**, 23/08 | `restart --gw on/off`, préflight, remplacement d’env, bascule explicite des CLI natives | Résout la commande de bascule ; sans option reprend le pin/auto. Ni migration des anciens états ni défaut global de restore modifié. Le rattachement d’une session vivante par restore demeure distinct. |
| `df92c0f7c`, merge **#261 `5b406f378`**, 15/09 | Helper auto → direct, nettoyage env ; contrat MCP direct ; test de `resume` sans pin | **Bien intégré.** Ne touche pas le préchauffage global, `startJob`, les états persistés ou la config locale réelle. Le test mocke le lancement tmux : il ne voit pas l’env finale d’un vrai enfant ni une API key combinée à un serveur tmux pollué. |
| `4a718c056`, 17/09 | Restore global seulement sur `--gw` ; test auto/direct avec enabled=true | **Non intégré à B**, présent seulement sur `fix/restore-gateway-opt-in` / `origin/fix/restore-gateway-opt-in`. Le code et le test correctifs n’ont donc pas protégé main. |
| **#275 `0cc1e59d2`**, 19/09 | `--bare` devient opt-in ; reprise du pin dans `resume`/`run --resume` ; persistance du mode effectif | Élargit la réutilisation des anciens pins, et remplace « écrire uniquement le choix explicite » par « écrire le résultat ». Aucune provenance ajoutée. **Ne remet pas un lancement neuf auto en gateway** ; risque de confusion effet/consentement, pas preuve d’un retour du défaut neuf à ON. |
| `a49bfa419`, merge **#315 `adba3fc75`**, 10/10 | Documentation et skill : nouveaux lancements directs, retrait de la règle « flavor nommé → gw » | Ne migre pas les anciens pins générés par cette règle. La documentation préserve explicitement restore/delegate. |

Les chemins du restore global et des jobs ne résultent pas d’une réintroduction récente : `git blame` attribue la condition du restore à `1743549f7`, et celle des jobs à `8bacdcf98` (juillet). L’élargissement des pins est visible dans le diff de `0cc1e59d2`. Aucune preuve trouvée d’une migration de consentement déjà livrée puis annulée.

Preuve d’intégration : appels en lecture seule à `git merge-base --is-ancestor <commit> dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`, résultat 0 = ancêtre, 1 = absent :

| Commit | Résultat |
|---|---|
| `b1a37adce`, `5dadf86b7`, `4a718c056` | 1, 1, 1 |
| `1743549f7`, `c61205b48`, `df92c0f7c`, `0cc1e59d2`, `a49bfa419` | 0, 0, 0, 0, 0 |

**3. État persistant : ce qu’il porte, et ce qu’une migration doit traiter.** Les chemins personnels ci-dessous proviennent du code ; ils n’ont pas été ouverts.

| Support | Ce qu’une ancienne version peut y avoir écrit | Traitement cible |
|---|---|---|
| `~/.config/sentropic/{remote-cli,h2a}/config.json` | `llmMesh.enabled:true` par `start`, `restart` ou `enable` ; copies/symlink conservés par migration | Séparer capacité/démarrage du service et consentement de routage. Ce booléen seul ne doit plus autoriser une session. Conserver les choix explicites documentés, versionner la migration, sauvegarder les valeurs d’origine. |
| Même fichier : éventuel `defaultGateway` | Champ proposé par la branche non intégrée de juillet, si elle a été déployée | Rechercher dans les données brutes lors de la future migration : le parseur main actuel ne conserve pas ce champ. Ne pas affirmer sa présence locale ni jeter un éventuel choix explicite. |
| `registry.json`, `R/registry.ts:334`, `:1292` | `gatewayMode`; avant #275 écrit depuis un flag brut ; depuis #275 mode effectif écrit systématiquement | Ajouter provenance/scope/version de décision. Garder les opt-in prouvés ; supprimer seulement l’autorité des pins implicitement produits, avec trace de migration. `undefined` ne suffit pas pour effacer : l’upsert reprend `prev.gatewayMode`. |
| Reprises/manifeste `LayoutTab`, `R/restore.ts:676`, `:918` | Copie du pin en mémoire, réémis sous forme `--gw` | Transporter l’origine du choix, pas seulement le booléen ni un flag reconstruit. Un flag généré par restore ne doit pas devenir une nouvelle preuve d’opt-in humain. |
| `layout-last.json`, `R/restore.ts:1176`, `:1202` | Commandes calculées avec `tabCommand(t)` | **Historique consultatif**, lu par `layout show` (`R/index.ts:10140`), pas entrée automatique du restore. De plus, l’écriture ne transmet pas `forceGateway` : la commande mémorisée peut ne pas décrire l’override exécuté. Préserver l’archive, produire un reçu exact après migration ; ne pas l’utiliser comme consentement. |
| Config/launch de profils et specs de boucles | Profil gateway voulu, settings Claude `env`, ou `gateway:required` synthétisé par ancien skill | Les profils runtime livrés n’ont actuellement aucun flag gateway ; ce champ serait à créer. Pour les autres supports, distinguer choix explicite d’une valeur générée. Conserver l’original et migrer le schéma avant réutilisation. |
| `~/.sentropic/llm-mesh.json`, PID/token metadata | Port/routing et auparavant inventaires/comptes ; ancien `llm-mesh-token.json` pouvait contenir un bearer | Capacité et découverte ne sont jamais un consentement. B persiste seulement `{baseUrl,pid}` (`R/gateway-host/daemon.ts:160`) et réacquiert le token. Ne pas supprimer comptes/keyrings pour « désactiver le défaut ». |
| Env tmux / processus ; IPC PTY | URL/token conservés en mémoire ; fichier `env.json` temporaire | Construire l’env finale par enfant. Le fichier IPC est supprimé après création (`R/native-host.ts:438`) ; ce n’est pas un manifeste à migrer. Le registre PTY conserve l’identité/PGID (`native-terminal/host.ts:982`), pas une recette de routage. |
| Pod/spec/Secret/config profil distant | BASE_URL + API_KEY, variables `envFrom`, settings recopiés | Versionner le choix de routage dans le descripteur de session ; recréer/respawn selon ce choix. Ne pas effacer les credentials natifs ou les opt-in existants en nettoyant les valeurs implicites. |

**Limite irréductible : `gatewayMode:"gateway"` n’identifie pas son auteur ni son intention.** L’historique main antérieur à #275 épinglait les flags explicites ; il ne démontre pas qu’un simple auto y écrivait gateway. Mais un ancien skill ou restore pouvait lui-même produire ce flag. Depuis #275 le schéma mélange en plus choix et résultat effectif. Ni la date, ni l’URL localhost, ni la présence d’un token ne prouvent l’opt-in owner.

La migration doit classer **explicite prouvé / implicite prouvé / origine inconnue**. Explicite : conserver le choix. Implicite : revenir au défaut direct, sans pin artificiel. Inconnu : conserver intégralement la donnée et suspendre la recréation automatique de l’instance concernée jusqu’à qualification ; ne choisir silencieusement ni gateway ni direct à sa place. C’est la seule proposition qui respecte simultanément « aucune gateway implicite » et « aucun opt-in effacé » lorsque l’information manque. Les nouveaux lancements et les autres instances peuvent continuer en direct.

**4. Contrat cible : un défaut unique direct, une décision explicite transportée de bout en bout.**

Un résolveur pur commun doit produire `{mode, source, scope, decisionRef}`. Le helper existant peut en devenir le point d’entrée ; son contrat doit être partagé avec MCP, jobs et provisioning, sans importer le moteur gateway. `auto` signifie **absence de nouveau choix**, jamais découverte d’une gateway disponible. Les effets de démarrage/acquisition n’acceptent que le résultat résolu et vérifié, pas un `auto` brut.

| Priorité | Source faisant autorité | Résultat |
|---|---|---|
| 1 | Choix courant explicite : CLI `--gw`/`--no-gw`, restart on/off, MCP required/off | Choix de l’opération ; enregistré avec son origine et sa portée. |
| 2 | À la reprise : choix explicite propre à cette instance | Conservé, y compris direct ; ne pas emprunter le pin d’une autre instance partageant la conversation. |
| 3 | Profil volontairement sélectionné, avec flag gateway explicite | Opt-in traçable ; profils livrés sans ce flag. |
| 4 | Aucun choix explicite | **Direct**, quels que soient daemon, comptes, tokens, env parent ou ancien enabled global. |
| Cas à qualifier | Ancienne valeur à provenance inconnue | Pas de routage automatique de cette instance ; donnée conservée. |

Conséquences concrètes :

- Restore calcule d’abord les décisions par instance ; ne prépare la gateway que pour les instances effectivement autorisées. Zéro besoin gateway → zéro acquisition/démarrage, y compris daemon arrêté, layout vide ou mode dry-run.
- `llm-mesh start/restart` gère le service sans modifier le défaut des sessions. Une préférence de démarrage du daemon reste distincte d’un opt-in de routage.
- `run`, `resume`, restart/relaunch, jobs immédiats/différés, boucles, MCP et k8s utilisent le même contrat. Une URL du control-plane ne vaut pas choix de session. Un modèle nommé ne suffit pas non plus.
- L’environnement est construit **par enfant**, après résolution, sans mutation globale temporaire servant de politique. Direct retire le routage h2a hérité, conserve l’auth native reconnue et résiste au tmux pollué. Le traitement des endpoints personnalisés doit suivre le principe owner ci-dessous.
- Gateway explicitement demandée mais indisponible → échec avant lancement, sans bascule silencieuse vers un autre fournisseur. Le reçu expose mode effectif et origine, jamais token.
- Restore qui rattache un processus vivant annonce qu’il conserve sa posture ; une vraie bascule passe par restart. L’historique de layout décrit l’action réellement exécutée.

**Non-régression à exiger, au-delà du helper.** Chaque scénario doit observer l’environnement/argv du véritable enfant de test et les effets gateway, avec fixtures isolées. Tests ciblés uniquement ; preuve rouge avant correction, verte après. Matrice proposée, non exécutée ici :

| Couverture | Scénario décisif | Oracle |
|---|---|---|
| **Lib primo-install** | Config absente/vide, profils livrés, anciens chemins absents ; run CLI/MCP sans option | Direct ; aucune URL/token h2a dans l’enfant ; aucun start/acquire ; aucun enabled=true écrit. |
| **Déploiement local** | Installation/upgrade/doctor du paquet qualifié dans un HOME/XDG temporaire ; env de launcher déjà polluée | Même oracle sur l’artefact installé, après restart du host de test et restore. Les vérifications sur `deploy/scw` seules sont insuffisantes. |
| Ancien enabled | `llmMesh.enabled:true`, comptes et métadonnées présents, daemon vivant puis arrêté, zéro pin explicite | Restore normal/dry-run/layout vide, jobs et nouveaux lancements n’acquièrent ni ne démarrent la gateway. |
| Persistance / migration | Instances explicites gateway/direct, implicites et inconnues ; deuxième passage ; config canonique et legacy | Opt-in explicites inchangés ; implicites libérés ; inconnus conservés/qualifiés ; idempotence ; aucune réintroduction par upsert ou hook. |
| Toutes les reprises | `resume`, `run --resume`, restore, restart, relaunch ; deux instances partageant une conversation | Chaque instance garde son choix explicite ; l’absence de choix reste directe ; le rendu `--gw` ne change pas la provenance. |
| Environnement tmux / PTY | Serveur tmux pollué + caller sans BASE_URL mais avec API_KEY utilisateur ; daemon PTY pollué + requête propre | URL/token h2a absents de l’enfant direct ; API key utilisateur conservée ; pas de fusion cachée avec le daemon. |
| Mélange d’instances | Lot gateway explicite → direct → gateway explicite, puis ordre inversé | Aucun transfert d’env ou de token entre instances ; reçus conformes. |
| MCP / jobs / boucle | auto/off/required et défaut absent ; job immédiat puis différé ; nom de modèle natif | Le même résolveur et les mêmes effets s’appliquent. Le validateur de boucle refuse une gateway implicite. |
| k8s / migrate / refresh | URL serveur configurée sans opt-in, envFrom pollué, settings Claude avec env ; soft-refresh et recréation pod | Aucun routage implicite, y compris après refresh ; descripteur et env effectifs cohérents. Tester aussi l’opt-in positif. |
| Opt-in préservé | `--gw`, profil explicitement gateway, MCP required ; service disponible/indisponible | Disponible : routage gateway voulu. Indisponible : échec avant enfant. Aucun « correctif » ne supprime globalement la capacité gateway. |
| Sessions vivantes / reçus | Restore forced-direct sur instance vivante et sur instance absente | Vivante : rattachement annoncé, pas de bascule prétendue. Absente : nouvel enfant direct ; `layout show` décrit cette action. |

Points de départ existants : `R/config.test.ts:147` vérifie déjà enabled=false ; `R/conv-guard-wiring.test.ts:1522` protège un resume sans pin avec launcher mocké ; `R/restore.test.ts:435` protège la réémission des pins ; `R/structured-gateway.test.ts:39` couvre surtout l’opt-in requis. Le test d’absence de bootstrap global reste sur `4a718c056`, pas sur B. `K/k8s/spec.test.ts:386` vérifie aujourd’hui URL+token, sans consentement de session. Ces assertions ne couvrent pas l’exigence complète lib + déploiement local.

**5. Questions de principe à présenter à l’owner.** Le défaut direct est déjà décidé ; ces questions ne le rouvrent pas.

| Principe restant à préciser | Question ouverte |
|---|---|
| Autorité du choix | Quelles traces doivent faire foi pour un opt-in ancien : commande owner, profil volontaire, instruction donnée à un agent, configuration personnalisée ? Quelle portée accorder aux `--gw` générés par les anciens skills ? |
| État ancien ambigu | Quelle règle de continuité appliquer lorsqu’une instance porte un pin sans origine démontrable, afin de conserver le choix potentiel tout en empêchant une gateway implicite ? Proposition : qualification ciblée avant sa recréation, sans bloquer les autres. |
| Durée du consentement | Un choix fait à la création doit-il rester propre à l’instance, suivre les révisions d’un profil choisi, ou expirer selon une règle ? Quelle portée donner à un override d’un restore groupé ? |
| Sens de « non configurée » | Quelle frontière souhaite-t-on entre un service gateway installé/enrôlé mais inactif et une session autorisée à l’utiliser, notamment après `llm-mesh start` ? |
| Authentification personnalisée | Comment reconnaître et préserver les endpoints/tokens tiers délibérément configurés, tout en empêchant les valeurs h2a héritées de devenir un consentement ? Le même principe doit couvrir settings Claude, shells et secrets k8s. |

Passage de relais proposé : **runtime + gateway (WP14)** portent le résolveur et la migration ; **plugins/deploy** vérifie l’artefact installé, avec le provisioning k8s pour le chemin distant. Acceptation observable : installation vierge et ancien déploiement simulé restent directs après restore/restart, sans démarrage gateway implicite, tandis que chaque opt-in prouvé survit. L’état réel et la version effectivement utilisés le 19/10 restent à qualifier dans une intervention séparément autorisée ; cette analyse n’a appliqué aucun changement local.
