# #371 — rendre le job quotidien activable

Analyse indépendante, en lecture seule, 18 octobre 2026, observations arrêtées à 13:50 UTC. [FACT] Aucun code modifié, test exécuté, siège interrogé, secret lu, service activé, commit ou push. Cette passe est une entrée pour la confrontation des deux analyses demandées ; elle ne revendique aucun consensus avec l'autre IA.

Notation : [FACT] = constat sourcé ; [JUDGMENT] = interprétation ou proposition ; **inconnu** = information opérationnelle non observée dans ce confinement.

## 1. Décision à préparer

**[JUDGMENT] #371 n'est pas activable de bout en bout dans l'état livré. Le propriétaire a raison de demander la présentation des sièges et du chemin de mise en service avant une nouvelle proposition de fusion dormante.** Le manque dépasse un fichier de configuration et un timer : il reste des raccords logiciels, une capacité explicitement affectée et une qualification d'exécution.

| Question | Réponse courte | Fondement |
|---|---|---|
| A — Activable aujourd'hui ? | [FACT] Détection et orchestration existent ; autorité réelle, identité du siège exécuté et qualification opérationnelle ne sont pas livrées ensemble. Aucun chemin complet démontré. | J1–J4, M1–M4 |
| B — Présentation manquante ? | [JUDGMENT] Présenter le pool commun aux tests GW, tests CLI et correctifs, son coût en quotas, les opérateurs, les dépôts, les pouvoirs GitHub et le déclenchement. | O1, O2, S1 |
| C — Plus petit chemin ? | [JUDGMENT] Un pool conforme sans Claude Code pour les travaux, une autorité partagée raccordée à une véritable identité d'exécution, un dépôt pilote, puis le timer. Conserver la livraison des cinq fournisseurs × deux usages comme objectif distinct et explicite. | J2–J4, O2, M1 |
| D — Décision humaine bloquante ? | [JUDGMENT] L'affectation des sièges de laboratoire et de leur capacité commune. Les intégrations manquantes sont du travail des mainteneurs, pas des réglages à faire deviner au propriétaire. | S1, J2 |

**[JUDGMENT] Recommandation : option P1 décrite en §4, avec un engagement de livraison activable et une preuve sur un dépôt.** Une fusion purement technique reste possible si le propriétaire accepte expressément cet intermédiaire ; son dernier message ne fournit pas cet accord.

## 2. Contexte et capital conservé

### Sources et révisions

| ID | Source consultée | Ce qu'elle permet d'affirmer |
|---|---|---|
| O1 | Verbatim de la mission : demande du 17/10, réaction du 18/10, double usage des sièges. | Finalité demandée, sans autorisation implicite de consommer n'importe quel compte. |
| O2 | [DECISIONS-owner.md](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/DECISIONS-owner.md:162), notamment lignes 18–20, 64–98 et 162–171. | OAuth par défaut + imports CLI/token ; cinq fournisseurs, deux usages ; demandes quotidiennes remplaçant les six questions ; plus de sous-traitant Claude Code ; NO GO #371. |
| S1 | [study-v5.md](/home/antoinefa/src/sentropic/.tmp/vuln-autofix/study-v5.md:17), §§1, 5, 7, 8 et 12. | Capital quotas, autorité unique, distinction CI/remédiation, VA1–VA6 et limites d'activation. Le titre interne du fichier dit encore « v4 ». |
| S2 | [HTML v6](/home/antoinefa/src/sentropic/.tmp/vuln-autofix/dossier-vuln-autofix-v6.html) et [dossier h2a](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/vuln/dossier.json). | Les six choix, recommandations B/B/A/A/B/A, absence de choix propriétaire enregistré dans le dossier JSON. |
| M1 | [Contrat #348 sur origin/main](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/docs/cli-seat-l2s.md). | Lot L2-s synthétique ; raccord source à L1 ; réserves de publication et de qualification réelle encore documentées. |
| M2 | [Import consommateur](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/src/llm-mesh-accounts.ts#L312) et [commande d'enrôlement](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/src/index.ts#L10732). | Modes, entrée privée, frontière L1, refus si API absente, routage OAuth séparé. |
| M3 | [Codecs](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/src/cli-seat-codecs.ts#L51), [matérialisation](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/src/cli-seat-materialization.ts#L264). | Cinq identités, projections, environnement enfant, familles, custodie et refus de refresh côté consommateur ; mise en œuvre qualifiée ici comme synthétique. |
| M4 | [Voie réelle refusée](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/scripts/e2e-cli-seats-direct.mjs), [matrice synthétique](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a/test/cli-seat-direct-matrix.test.js). | Le programme réel est un stub qui sort avec 2 ; les 25 paires × 4 scénarios sont synthétiques. |
| M5 | [Dépendances épinglées](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/package.json), [contrat de lancement](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/src/agent-launch-args.ts#L129). | cluster-mesh 0.16.0, llm-mesh 0.26.0 ; refus headless Muse/Vibe dans le constructeur partagé. |
| J1 | [SPEC #371](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/docs/specs/SPEC_EVOL_DAILY_VULN_FIX.md), [référence opérateur](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/skills/vuln-fix/references/operator.md). | Contrat annoncé et étapes documentées ; une spécification n'atteste pas une intégration réelle. |
| J2 | [Admission des sièges](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/seats.mjs:25), [runner natif](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a-runtime/src/vuln-seat.ts:36). | Autorité externe obligatoire, profils Claude/Codex, lancement avec environnement hérité, absence de liaison à la matérialisation #348. |
| J3 | [Politique](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/policy.mjs:44), [contrôleur](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/controller.mjs:12). | Sélection auteur/deux relecteurs, quotas locaux, claims durables ; dry-run avant admission des sièges. |
| J4 | [Dépôts et publication](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/repository.mjs:35), [provenance et âge](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/verify.mjs:25), [timer](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/cli.mjs:20). | Conditions réelles d'admission d'un dépôt et d'un candidat ; timer rendu uniquement. |
| R1 | [Rapport de réalisation](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/vulnfix-report.md), [rev371](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/rev371.md), [rev371b-last](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/rev371b-last.md). | Historique des défauts et vérifications ; ne vaut pas revue fraîche du HEAD. |
| R2 | [Dossier explicatif #371](/home/antoinefa/.cache-tmp/claude-1000/-home-antoinefa-src-h2a/902cb8f7-eb8e-4897-9640-8b9653fc7d0e/scratchpad/0985/explain/dossier-371.json), [consensus enregistré](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/docs/reviews/vuln-fix/consensus.md). | Le dossier annonce une CI 15/15 historique mais aucune activation et une revue fraîche manquante ; le consensus conservé vise un ancien SHA et dit selection-failed. |

[FACT] origin/main observé : **46b82b42781709f2a2ab1bec6707ba58131248f0**. #348 : **7670fbed6870fb7e5b985a1315ff55776b362fd8**, ancêtre de cette référence. #371, worktree et référence distante locale : **3e0cbc7e319a0c831fae26f8b3ebd8b71923c01d** ; ce HEAD n'est pas ancêtre d'origin/main. Worktree #371 propre. Aucun fetch effectué dans cette analyse : ce sont les références locales observées, pas un contrôle GitHub temps réel.

### Acquis, interprétations et inconnues

| Statut | Élément |
|---|---|
| [FACT — O1/O2] Acquis | Jobs quotidiens sur sièges, toutes sources de failles, d'abord npm HIGH/CRITICAL des composants ; harnais strict, double revue ; rotation demandée dans la demande initiale. |
| [FACT — O2] Acquis | Les sièges doivent servir CLI **et** llm-mesh pour Claude, Codex, Muse, Vibe, agy/cloud-code. OAuth par défaut ; imports CLI et token nécessaires. |
| [FACT — O2] Instruction plus récente | Aucun sous-traitant Claude Code pour les travaux ; priorité Muse, secours Sol pour le code durant l'indisponibilité Muse annoncée jusqu'au 19/10 02:00. Claude reste requis comme fournisseur **testé** dans la matrice. |
| [FACT — S1, capital documentaire] Bornes conservées | Dix unités par CLI/jour UTC tous consommateurs confondus, réserve fournisseur strictement >20 %, quota inconnu = zéro inférence ; renouvellement sous autorité unique. Leur état opérationnel courant est inconnu. |
| [JUDGMENT] Choix d'implémentation | systemd local, pilote de verrous seuls et fusion manuelle sont les choix de la SPEC #371. Le verbatim « jobs daily avec des sièges » ne tranche pas à lui seul l'hôte, systemd ni toute la politique de fusion. |
| Inconnus | Inventaire des comptes de laboratoire, capacité libre, autorité déployée, versions réellement disponibles sur l'hôte futur, credentials déjà enrôlés, opérateur et dépôts effectivement admis. Aucun de ces inconnus ne signifie « absent chez le propriétaire ». |

## 3. A — Conditions concrètes d'activation

### Ce qu'apporte #348 et ce qui manque encore

| Surface | Existe dans origin/main [FACT — M1–M5] | Manque pour un usage opérationnel [FACT/JUDGMENT] |
|---|---|---|
| Modèle cinq fournisseurs | Identité de siège, provenance, autorité, classes access-only/static-key/renewable, projections nativeUse et meshUse, métadonnées de cycle de vie et de famille. | [FACT] Une déclaration de projection n'atteste pas l'acceptation de l'authentification par le vrai binaire ou service. |
| Imports | CLI/token pour les cinq fournisseurs dans le consommateur h2a ; OAuth produit conservé séparément. | [FACT] La voie attend les parsers publics L1 et facade.importSeatBundle ; les dépendances épinglées précèdent le contrat documenté. Publication compatible, adoption et recette restent à prouver. |
| Protection des consommateurs | Validation, refus d'escalade d'autorité/refresh, profils temporaires, environnement contrôlé, sérialisation par famille, nettoyage et canaris synthétiques. | [FACT] Résolution réelle des références, coffre/refresh de confiance et keyring natif agy restent hors de la preuve synthétique. |
| Tests CLI | 100 cellules synthétiques ; refus exécutables des entrées et admissions invalides. | [FACT] La voie NxN réelle est un stub de refus. Aucune matrice native réussie ne peut être déduite de la fusion #348. |
| Tests GW | Frontière de comptes llm-mesh et projections mesh. | [FACT] Importer n'est pas prouver une route GW, son entitlement, son quota ni une inférence sur le fournisseur attendu. Il faut des reçus GW séparés. |
| Job #371 | Interface LocalSeats et runner natif séparés. | [FACT] Ils n'appellent pas la matérialisation #348 et ne résolvent aucun accountId/seatRef importé en identité d'exécution. |

[FACT — M1/M2/M5] Le dossier #348 conserve un dernier contrôle historique disant que même llm-mesh 0.26.1/cluster-mesh 0.18.0 ne publiaient pas encore les trois API attendues. Les pins de l'origin/main observé sont différents et plus anciens : 0.26.0/0.16.0. **Aucun état actuel du registre npm n'a été interrogé ici.** S'il existe désormais une publication compatible, elle réduit le travail de publication ; elle ne remplace pas son adoption dans les pins ni la recette.

### Sièges à présenter, fournisseur par fournisseur

Toutes les lignes suivantes sont requises pour la finalité globale « sièges pour tests GW et CLI ». Elles ne sont pas cinq obligations de qualification préalable au premier pilote du job.

| Fournisseur et profil CLI [FACT — M2/M3] | Usage CLI à qualifier | Usage llm-mesh à qualifier | Situation #371 [FACT — J2] |
|---|---|---|---|
| Claude ; claude → claude-code | Projection d'accès d'un siège de laboratoire, sans refresh consommateur ; isolation native à prouver. | Compte consommateur claude-code, import et route GW vérifiés. | Adaptateur prévu ; **interdit comme sous-traitant de ce job selon O2**, conservé comme cible de tests. |
| Codex ; codex → codex | Profil d'accès isolé, famille/expiration respectées. Plusieurs modèles ne multiplient pas le quota de la CLI. | Compte codex, import/route et allocation commune aux tests vérifiés. | Adaptateur prévu ; admission extérieure et authentification effective à raccorder. |
| Muse ; muse → muse | Projection Muse, versions natives et mode de lancement du job à qualifier. | Compte muse ; ne pas ressusciter l'ancien alias d'enrôlement muse-code rejeté par la CLI. | Refusé. Le constructeur partagé refuse aussi le headless stdin ; supprimer seulement l'allowlist ne suffit pas. |
| Vibe ; vibe → mistral-vibe | Modèle synthétique static-key ; entitlement et facturation d'un vrai accès à démontrer, sans le confondre avec du crédit API autorisé. | Compte mistral-vibe, source et route qualifiées. | Refusé ; contrat headless stdin non qualifié lui aussi. |
| agy ; agy → cloud-code | Keyring isolé et vrai binaire agy à qualifier ; aucun remplacement par Gemini CLI. | Compte cloud-code et route GW qualifiés. | Refusé ; extension des restrictions natives et qualification à faire. |

[JUDGMENT] Le registre public des sièges doit décrire, sans valeur secrète : référence du siège, propriétaire du compte, fournisseur, usages permis CLI/GW/correctifs, modèles exacts et rôles permis, classe d'entitlement, expiration/génération, référence de custodie, état de qualification et capacité. **Dix combinaisons fournisseur × usage ne signifient pas dix abonnements à acheter.** Une même souscription peut fournir deux projections si le contrat le permet, avec un seul propriétaire du renouvellement et une capacité partagée.

[FACT — M3/M4] Les diagonales de la matrice synthétique emploient deux sièges distincts et, pour les accès renouvelables, deux familles distinctes. [JUDGMENT] Le besoin réel de deux acteurs indépendants pour ces cellules doit apparaître dans la présentation de capacité ; compter deux copies du même refresh token comme deux sièges serait faux. Le nombre de comptes nécessaires dépend des scénarios et du contrat de sérialisation qualifié.

### Pool minimal du job et incompatibilité actuelle

[FACT — J3] La sélection exige un auteur et deux couples profil/modèle distincts ; chaque relecteur doit avoir **un profil différent de celui de l'auteur et un modèle différent du sien**. Les deux relecteurs peuvent partager leur profil s'ils ont des modèles distincts. Un simple compte avec trois noms de sièges ne prouve donc aucune capacité supplémentaire.

| Pool | Faisabilité |
|---|---|
| Exemple de #371 : un modèle Codex, deux modèles Claude | [FACT — J1/J3] Un auteur Codex est sélectionnable ; les deux auteurs Claude ne le sont pas faute de deux modèles Codex. Cet exemple ne fait pas tourner tous les auteurs. |
| Deux modèles Codex et deux modèles Claude | [FACT — J3] Rotation des auteurs possible si les admissions/quotas le permettent ; [FACT — O2] recours à Claude interdit pour les travaux actuels. |
| Muse auteur + deux modèles Codex distincts, par exemple Sol/Astra aux identités exactes qualifiées | [JUDGMENT] Plus petit pool compatible avec l'absence de sous-traitant Claude, après livraison Muse. Un seul auteur admissible : c'est un **pilote**, pas la rotation complète des cinq fournisseurs. |
| Pool avec plusieurs auteurs admissibles, sans Claude | [JUDGMENT] Étendre ensuite les combinaisons réellement qualifiées : deux modèles par hôte pour une rotation à deux hôtes, ou au moins trois hôtes avec des couples complémentaires. Ne pas inventer un modèle ou détourner Muse Wonder de son rôle de spec pour remplir une case. |

**[JUDGMENT fondé sur J2/J3/O2] Avec #371 tel quel, l'interdiction de Claude laisse seulement Codex ; aucun auteur Codex ne peut alors obtenir ses deux relecteurs sur un autre profil. Il n'y a aucun pool de travaux conforme utilisable par simple configuration.** Le secours Sol ne répare pas cette absence de relecteurs complémentaires.

[FACT — M5/J3] Les efforts normalisés acceptés sont low/medium/high/xhigh. [JUDGMENT] La traduction de la demande « max » doit être explicite et qualifiée pour chaque modèle natif ; ni un libellé flatteur ni un ajout arbitraire de la chaîne max ne constituent cette preuve.

### Enrôlement : qui fait quoi, avec quels droits

| Acteur | Action et matériau autorisé [FACT/JUDGMENT — O2, M1–M3] | Limite |
|---|---|---|
| Propriétaire des comptes | [JUDGMENT] Désigne les comptes de laboratoire, leurs usages, la capacité affectée et réalise le consentement/MFA fournisseur quand requis. | Aucun secret demandé dans un rapport ou dans la conversation. |
| Mainteneur Sentropic L1/custodie | [FACT — architecture M1/M2] Possède la persistance et la lignée. [JUDGMENT] Fournit la publication compatible, l'export/import de confiance, le renouvellement unique et les références d'accès consommateur. | Aucun renouvellement concurrent CLI/GW/job ; expiration/401 consommateur = accès indisponible, sans refresh ni repli. |
| Opérateur de laboratoire / conducteur h2a | [JUDGMENT] Effectue les enrôlements et le déploiement sur l'hôte dédié avec les commandes et références approuvées ; produit les reçus non secrets. | Le propriétaire n'a pas à écrire la configuration ni à brancher lui-même une autorité logicielle manquante. |
| Consommateur llm-mesh | [FACT — M2] OAuth par défaut ; --from cli/--cli lit le fichier privé --seat-profile explicitement choisi ; --from token/--token lit un **SeatBundle consommateur**, entrée masquée/stdin borné à 48 Kio. | Le profil CLI est un manifeste L1, pas un ordre de fouiller le HOME du propriétaire. Le token n'est pas un simple jeton nu ni une valeur argv. |
| Consommateur CLI natif | [JUDGMENT] Reçoit une projection native résolue par l'autorité, dans un profil privé par exécution ; reprend les primitives #348 après qualification réelle. | Un import de compte llm-mesh ne connecte pas automatiquement la CLI ; une CLI connectée ne crée pas automatiquement une route GW. |
| Contrôleur du job | [JUDGMENT] Garde ses droits Git/GitHub de branche et de PR séparés de ceux des modèles et tests. | Ni droits de fusion automatique, ni credentials writer/refresh remis aux modèles ou à des sorties de test. |

[FACT — J2] Aujourd'hui, le runner utilise le profil comme nom d'exécutable, le modèle/effort comme paramètres, puis hérite de process.env en retirant une liste de clés. Le seat.id ne sélectionne aucun HOME, CODEX_HOME, profil privé ou accessRef. L'exécutable d'admission ne renvoie pas non plus un environnement d'exécution exploité par le runner. [JUDGMENT] Une autorité qui répond simplement « ce siège est disponible » ne suffit donc pas à garantir **quel compte sera consommé**. Il faut lier la réservation et le lancement à la même identité réelle, en réutilisant #348 plutôt qu'en créant un second magasin de comptes.

### Quotas, périmètre et autorité

| Dimension | État livré [FACT] | Condition d'activation [JUDGMENT] |
|---|---|---|
| Admission | J2 appelle un exécutable externe status/reserve, purpose vulnerability-remediation, unité 1, siège/profil/modèle, workspace exact, digest du bundle de garde. | Brancher une autorité réelle qualifiée ; un JSON statique ou un miroir de la requête est explicitement insuffisant. |
| Périmètre | Reçu au workspace exact, hôte exact, bundle exact, qualification de moins de 24 h ; plugin h2a@sentropic exigé sur Codex. | Qualification sur l'auteur **et chacun des worktrees de revue**. Une qualification générique du dépôt ne correspond pas aux chemins aléatoires créés par le contrôleur. |
| Capacité commune | J3 conserve ses usages locaux, plafonnés à dix par profil/jour UTC ; J2 exige réservation atomique externe. | Un ledger partagé avec tests GW, tests CLI, qualification et enrôlement ; fraîcheur du quota fournisseur et réserve >20 % vérifiées par cette autorité. Trois stateDir distincts ne doivent pas créer trois plafonds indépendants. |
| Allocation Codex | S1 conserve 6 CI / 2 enrôlement protégées / 2 natif-maintenance ; remédiation = zéro tant que l'amendement VA4 n'est pas promu. | Affectation ratifiée et appliquée dans l'autorité existante, sans consommer les deux unités d'enrôlement et sans requalifier silencieusement la remédiation en test CI. |
| Réservation du cas | J3 précompte localement auteur + deux revues ; J2 réserve auprès de l'autorité au départ de chaque tâche. | Conserver la réservation partagée du cas entier prévue par S1, ou expliciter et prouver une équivalence. Une disponibilité initiale ne réserve pas les deux revues face aux autres consommateurs. |
| Coût réel | Le contrôleur compte au moins trois tâches de modèle par candidat, hors reprises. | Qualifier la correspondance avec les unités natives/fenêtres fournisseur ; ne pas assimiler une session outillée à une unique requête fournisseur sans preuve. |

[JUDGMENT] Pour le petit pool Muse auteur + deux revues Codex, il faut au minimum **une tâche Muse et deux tâches Codex** par candidat. Si l'amendement autorise seulement les deux unités Codex de maintenance, cela donne **au plus un candidat minimal/jour tous dépôts confondus**, seulement si elles sont encore libres et si la mesure des tours le confirme. « Un essai par dépôt/jour » est une limite anti-répétition, pas une promesse de corriger tous les dépôts chaque nuit.

[FACT — S1] Le fallback crédit admis pour certains tests CI ne s'étend pas à l'écriture/relecture des correctifs. [JUDGMENT] Ne pas ouvrir cette décision ni modifier le plafond global par convenance d'activation.

### Hôte, timer et dépôts

| Élément | Constat [FACT — J1/J4] | Ce qui reste [JUDGMENT] |
|---|---|---|
| Hôte | La voie livrée est Linux/systemd utilisateur ; Node ≥22 selon O2, npm, Git, gh, flock et CLIs qualifiées nécessaires. Aucun hôte choisi. | Désigner un environnement de laboratoire restant disponible la nuit, avec identité de service, réseau registry/OSV/GitHub et stockage d'état appropriés. Réutiliser un hôte existant avant de créer une infrastructure. |
| Cadence | Les unités rendues imposent 03:00 **dans le fuseau de la machine**, jitter ≤15 min, Persistent=true. La limite d'essai est calculée en jour UTC. | Écrire le fuseau, vérifier la disponibilité du user manager et la politique de lingering. La routine 07:17 UTC proposée dans S1 n'est pas ce timer ; réconcilier toute fenêtre de quotas conservée. |
| Activation | timer écrit des fichiers et dit « not activated ». Aucun enable n'est exécuté. | Le conducteur installe, fait un pilote et active le timer sur l'hôte autorisé ; pas dans ce confinement. |
| Dépôts | Config explicite, chemins canoniques, origin/push URL correspondant à rhanka/repo, main récupéré en worktree détaché, répertoires temporaires ignorés. Aucun inventaire réel configuré n'est livré. | Convertir la portée familiale demandée en liste exacte approuvée et en recettes par dépôt ; pas de découverte privilégiée cachée. |
| Composants h2a | origin/main suit trois locks : racine, apps/focus/package-lock.json, packages/h2a/focus-kit/package-lock.json. | Les trois domaines doivent figurer dans la preuve du pilote ; « h2a » ne signifie pas seulement le lock racine. |
| Famille Sentropic | J1 cite h2a, sentropic, radar-immobilier, graphify et les autres dépôts applicables. S1 relève des conventions et obstacles différents. | Inventaire candidat, pas allowlist déjà ratifiée. Confirmer notamment graphify/engram, dépôts privés, fixtures et surfaces partagées avec les modèles/scanners. |

[FACT — J4] Un dépôt sans lock npm v2/v3 qualifié, manifest non représenté, baseline non installable ou tests ciblés non exécutables sera bloqué. Le job ne modifie que des locks existants compatibles ; il refuse nouveaux paquets/majeurs et certaines origines. [JUDGMENT] Les préparations Sentropic relevées dans S1 — régénération sans stack, peers/overrides, fixtures et manifests sans lock — doivent être vérifiées dépôt par dépôt, sans prétendre qu'ajouter leur nom à la configuration résout ces problèmes.

[FACT — J4] L'âge minimal de sept jours et la présence intégrité/signatures/provenance sont bloquants avant ready. L'allowlist attestée des builders n'est pas implémentée dans cette voie. [JUDGMENT] Le pilote doit choisir un correctif qui satisfait réellement les contrôles ; un patch publié la veille peut rester en brouillon. Ce job quotidien n'est donc pas une promesse de traitement zero-day autonome.

[FACT — J3] Le dry-run s'arrête avant la recherche/admission des sièges quand un correctif serait à tenter. **Un dry-run réussi ne prouve ni l'enrôlement, ni les quotas, ni les hooks natifs, ni les deux revues.**

## 4. B/D — Présentation et questions au propriétaire

### Réemploi des six choix, sans les lui reposer à l'identique

[FACT — O2] Le registre dit expressément que la directive quotidienne remplace les six questions. [JUDGMENT] Conserver leur raisonnement utile, pas leur statut artificiel de six décisions encore bloquantes.

| Choix historique | Options du capital | Traitement maintenant [JUDGMENT] |
|---|---|---|
| VA1 — organisation | A Dependabot groupé ; B lots cohérents ; C global dépôt ; D rattrapage puis B. | La direction est tranchée : contrôleur quotidien sur sièges, toutes sources. Ne pas reproposer Dependabot comme condition du démarrage. Réutiliser le stock existant sans écraser ses branches. |
| VA2 — taille | Un groupe ; ≤5 ; 10 puis 5 pour rattrapage. | Garder le bornage de risque. #371 produit un candidat compatible par dépôt, pas une partition implémentée en cinq groupes cohérents. Commencer petit ; ne solliciter un arbitrage que si le volume réel dépasse la capacité de revue. |
| VA3 — fusion | Accord à chaque fois ; routine déléguée ; routine + urgences ciblées. | Le job livré ne fusionne pas. Désigner le conducteur qui reprend les PR selon l'autorité du dépôt. Toute délégation automatique et ses effets de publication/déploiement restent un vrai choix séparé ; elle ne conditionne pas un pilote à fusion manuelle. |
| VA4 — capacité | A partager ≤2 maintenance ; B 4 CI / 2 enrôlement / 2 routine-maintenance / 2 urgentes ; C remédiation Codex=0. | **Décision de capacité encore matérielle.** Recommander A pour le pilote sans augmenter dix ni réduire six CI, à condition de mesurer le solde et de promouvoir l'amendement. B seulement si la priorité urgente justifie son coût sur les tests. C reste effectif tant que rien n'est appliqué. |
| VA5 — détection | Poll public ; cluster toutes les 5 min ; événements GitHub ; nuit + humain. | Le quotidien est acquis. La voie locale quotidienne livre le premier besoin. Le service urgent cinq minutes/objectif 15 min reste une évolution ; aucun Kubernetes obligatoire pour activer le premier job. |
| VA6 — âge du paquet | Sept jours ; 72 h ; quatorze jours, avec règles urgentes liées à VA3. | Sept jours est le comportement concret actuel, à annoncer. Une exception urgente exige une politique exacte et un contrôle du candidat, pas un contournement pour faire passer le pilote. |

### Dossier à présenter réellement

[JUDGMENT] La présentation propriétaire doit reprendre le format Focus DS demandé par O2. Le présent Markdown est une analyse préparatoire, pas un remplacement de ce dossier. Le diagramme doit montrer les trois consommateurs — GW, CLI, correctifs — convergeant vers **la même custodie et le même ledger**, puis deux projections d'accès, le contrôleur et la reprise humaine de la PR. Un deuxième parcours doit montrer ce qui reste bloqué faute de siège/quota/qualification ; aucun simple schéma « fusion puis activation plus tard ».

| Option | Meilleur argument POUR | Meilleur argument CONTRE | Coût / réversibilité | Ce qui la ferait gagner |
|---|---|---|---|---|
| **P1 — pool labo partagé, capacité de remédiation explicitement affectée** | [JUDGMENT] Réutilise les sièges et l'autorité prévus pour les tests ; pas de souscriptions supplémentaires présumées ; un seul inventaire et un seul compte des unités. | [JUDGMENT] Concurrence avec qualification et maintenance ; débit possiblement limité à un candidat minimal/jour ; nécessite de terminer les raccords. | [JUDGMENT] Intégration et deux revues par changement ; arrêter les nouvelles admissions coupe le coût futur. Pas de chiffre d'abonnement inventé. | [JUDGMENT] Le solde permet au moins un cas complet sans retirer les réserves/tests convenus. |
| P2 — capacité labo davantage dédiée aux correctifs | [JUDGMENT] Prévisibilité et protection des tests ; possibilité d'un débit utile multi-dépôts ; responsabilité d'exploitation plus claire. | [JUDGMENT] Coût éventuel de comptes, créneaux ou arbitrage d'usage ; les plafonds globaux ne sont pas multipliés par les comptes ; mêmes raccords logiciels nécessaires. | [JUDGMENT] Réserver des créneaux est réversible ; achat/contrat nécessite prix et conditions réels préalables. | [JUDGMENT] L'inventaire prouve que P1 est systématiquement privé de capacité et que le bénéfice justifie l'affectation supplémentaire. |
| P3 — détection quotidienne seule en transition | [JUDGMENT] Valeur immédiate sans inférence ; état réel de la dette et de la couverture ; aucun arbitrage de quota urgent. | [JUDGMENT] Ne répond pas à la correction par sièges ; charge humaine entière ; peut pérenniser le mode dormant. | [JUDGMENT] Mise en service plus légère, entièrement stoppable ; dette de correction non résolue. | [JUDGMENT] Aucun siège légalement/techniquement admissible ou aucune capacité disponible aujourd'hui, avec un terme et un responsable pour la transition. |

### Questions encore ouvertes : contexte, options, recommandation

| Sujet | Contexte et options | Recommandation et caractère bloquant |
|---|---|---|
| **Sièges et quota** | [FACT/JUDGMENT — S1/O2] Les mêmes accès servent déjà deux familles de tests. P1/P2/P3 ci-dessus ; désigner des références non secrètes, l'opérateur et l'allocation, pas demander des tokens. | [JUDGMENT] **P1**, en préservant les bornes actuelles et en faisant ratifier/promouvoir l'admission de la remédiation. Seul arbitrage humain immédiatement bloquant ; inventaire préparé par le conducteur avant la question. |
| Périmètre exact des dépôts/données | [FACT — O1/S1] Finalité familiale déjà demandée ; liste opérationnelle et confidentialité non validées ici. Options : pilote h2a puis déploiement par dépôt ; admission simultanée après qualification de chacun. | [JUDGMENT] Pilote h2a puis extension de la liste familiale, sans réduire l'objectif à h2a. Validation des exclusions/données propres à chaque dépôt avant son admission. |
| Reprise et fusion | [FACT — J4] Brouillon puis ready ; aucun merge. Options : reprise par conducteur selon règles existantes ; validation humaine supplémentaire si requise ; délégation automatique future. | [JUDGMENT] Reprise par conducteur et fusion manuelle selon autorité existante ; préciser les effets préprod/npm en Sentropic. Ne pas confondre permission de commande gh et politique d'auto-fusion. |
| Heure/hôte | [FACT — J4] Daily acquis ; hôte et fuseau inconnus ; timer 03:00 local. Options : environnement Linux labo existant ; autre ordonnanceur si indisponible. | [JUDGMENT] Choix technique réversible par le conducteur, annoncé dans le runbook. Nouvelle dépense, machine ou changement d'autorité système seulement si effectivement nécessaire. |
| Urgences et maturation | [FACT — J4/S1] Sept jours ; pas de fast path livré. Options : garder ce pilote ; politique urgente exacte avec détection plus fréquente et âge réduit. | [JUDGMENT] Garder le pilote, afficher le délai ; soumettre VA3/VA5/VA6 ensemble seulement si le besoin urgent est demandé. Pas de promesse de SLA zero-day. |

## 5. C — Recommandation et lots exécutables

[JUDGMENT] Réutiliser l'orchestrateur, le scan et les gardes de #371. Ne pas reconstruire une usine CI privée pour le pilote local, ni un second coffre/allocateur dans h2a. Les lots suivants sont des handoffs documentaires ; aucun item Track ni branche créé par cette analyse.

| Lot / porteur | Livraison bornée | Fermeture observable | Placement |
|---|---|---|---|
| **L0 — conducteur h2a** | Remettre à jour SPEC, exemple et dossier : sièges réellement nécessaires, absence de Claude pour les travaux, identité/capacité, statut de L1 et étapes opérateur. Séparer acquis owner et choix locaux. | Présentation cohérente avec O2, un pool faisable, responsable de mise en service, statut par dépôt ; aucune « simple config » présentée pour un code absent. | Dans #371 avant nouvelle demande de fusion ; documentation, aucun test artificiel à ajouter. |
| **L1 — Sentropic L1 puis consommateur h2a** | Publier ou identifier la publication qui contient les parsers/importSeatBundle ; adopter les versions compatibles et leur contrat de refresh externe. Réutiliser le raccord de #348. | Cinq fournisseurs × deux sources CLI/token via packages réellement publiés, persistance/lignée/idempotence et refus expiry/401 prouvés sans appel de refresh. | PRs ciblées amont + adoption h2a. Dépendance de la finalité double usage ; un pilote CLI direct ne peut la déclarer acquise par contournement. |
| **L2 — mainteneur custodie/quotas + h2a** | Raccorder l'autorité globale existante ; lier réservation, référence du siège et profil exécuté ; projection native et environnement privé par tâche. Étendre #348 après qualification, sans lui faire passer de faux secrets pour des credentials réels. | Les trois consommateurs ne dépassent pas le plafond commun ; le bon compte est exécuté ; refus avant envoi si quota/scope/famille/expiry non admis ; aucun writer/refresh dans le consommateur. | Suivi logiciel indispensable, soit petit delta #371, soit PR dépendante explicitement nécessaire à la mise en service. |
| **L3 — mainteneur h2a natif** | Livrer un pool auteur/deux relecteurs conforme sans Claude. Priorité adaptateur Muse sûr : contrat d'entrée explicite, restrictions outils/scope, sélection de modèle/effort et nettoyage. Une voie --prompt-file privée est une piste à qualifier, pas un stdin supposé. | Auteur Muse et deux modèles Codex exacts sur le même candidat, reçus distincts ; aucune bascule silencieuse Claude/crédit. Prévoir ensuite plusieurs auteurs admissibles pour la rotation effective. | Suivi court ou delta #371 ; supprimer deux allowlists sans remplacer le refus du constructeur partagé échouerait. |
| **L4 — conducteur + opérateur labo** | Inventaire concret, configuration privée hors candidats, permissions GitHub limitées, qualification des trois exécutions, premier correctif manuel sur h2a. Vérifier les frontières d'environnement des tests et modèles. | Audit rouge baseline / vert candidat, installation et tests ciblés exécutés, deux revues même SHA, PR puis reprise humaine. Aucun état « prêt » fondé sur un dry-run seul. | Runbook et recette. Corriger dans une PR bornée seulement les défauts directement révélés par cette recette. |
| **L5 — conducteur + opérateurs concernés** | Activer et observer le timer sur l'hôte dédié ; étendre aux autres dépôts qualifiés. En parallèle, terminer la qualification CLI/GW des cinq fournisseurs et la matrice native par scénarios ciblés. | Premier tick planifié observé, rapport exploitable, manque de capacité visible, arrêt/reprise éprouvés ; tableau CLI/GW complet seulement avec preuves réelles. | Exploitation + PRs de qualification. Les extensions ne doivent pas disparaître derrière le succès d'un pilote à un auteur. |

### RED requis là où le code évolue

**[JUDGMENT] Ce tableau prescrit des scénarios RED, non exécutés dans cette mission. Aucun résultat rouge ou vert n'est revendiqué.** Pour chaque modification, conserver commande exacte, SHA, code de sortie et sortie avant/après ; distinguer test d'acceptation d'une nouvelle capacité et reproduction d'une régression existante.

| Lot | Fichier et commande ciblée proposés | RED attendu → GREEN requis |
|---|---|---|
| L1 | Nouveau fichier proposé : rtk npx --no-install vitest run packages/h2a-runtime/src/cli-seat-published-l1-contract.test.ts | API réellement résolue absente ou contrat incompatible → dix imports via la frontière publiée, pas une façade injectée qui contourne le blocage ; zero refresh/fallback sur expiry/401. |
| L2 — identité | rtk npx --no-install vitest run packages/h2a-runtime/src/vuln-seat.test.ts | Deux seatRef d'un même profil héritent encore de la même identité ambiante → deux profils résolus distincts, réservation et compte liés, aucune auth ambiante concurrente. |
| L2 — admission partagée | rtk node --test packages/h2a/test/vuln-fix-seats.test.js ; fichier d'intégration proposé : rtk node --test packages/h2a/test/vuln-fix-seat-authority.test.js | Implémentation partagée non raccordée ou course entre job/GW/CLI → dernière unité attribuée une seule fois, cas entier réservé, refus à 20 %/quota inconnu, mauvais workspace/digest/génération refusé, crash débité. Test de l'implémentation réelle de l'autorité en état temporaire, pas seulement de son imitation. |
| L3 — capacité native | rtk npx --no-install vitest run packages/h2a-runtime/src/vuln-seat.test.ts ; rtk npx --no-install vitest run packages/h2a-runtime/src/agent-launch-args.test.ts | Muse est refusé avant lancement → voie sûre effectivement construite/exécutée dans le labo ; pas de contenu sensible en argv ; restrictions et nettoyage qualifiés. Conserver les refus Vibe/agy non qualifiés. |
| L3 — politique | rtk node --test packages/h2a/test/vuln-fix-policy.test.js ; rtk node --test packages/h2a/test/vuln-fix-controller.test.js | Une configuration de travaux Claude reste admissible, ou aucun triplet sans Claude n'est réalisable → politique de rôles conforme, deux relecteurs complémentaires ; absence/quota insuffisant d'une jambe bloque avant inférence. |
| L4 — séparation des credentials | rtk node --test packages/h2a/test/vuln-fix-repository.test.js | Le source actuel copie process.env pour les tests : un canari d'autorité du parent reste visible → environnement de test isolé, aucun writer/refresh/provider secret ; pas de fuite dans rapports ou revues. Ne pas appeler cela un exploit reproduit tant que le test n'a pas tourné. |
| L4 — chaîne complète | rtk node --test packages/h2a/test/vuln-fix-controller.test.js ; rtk node --test packages/h2a/test/vuln-fix-repository.test.js | Ajouter une acceptation du raccord réellement choisi : indisponibilité/policy non promue → zéro départ ; raccord complet → baseline/candidat/revues/publication cohérents sur remotes temporaires. Le test existant à runners factices ne qualifie pas les comptes live. |
| L5, seulement si calendrier modifié | rtk node --test packages/h2a/test/vuln-fix-cli.test.js | L'heure/fuseau demandé ne peut pas être rendu par le calendrier figé → unité correcte, échappement des chemins, aucun enable implicite ; jour UTC et rattrapage n'autorisent pas une seconde tentative. Aucun nouveau test pour la seule installation documentée. |

[JUDGMENT] Les tests sont limités à ces fichiers, avec mkdtemp et XDG_RUNTIME_DIR temporaires, aucun état propriétaire, aucun skip de réussite. La qualification native réelle est effectuée séparément par l'opérateur sur des **comptes de laboratoire** avec refus explicite si le prérequis manque. La suite complète reste à l'intégration du conducteur.

### Avant fusion de #371

| Condition | Avis |
|---|---|
| Refus owner non levé | [FACT — O1/O2] Bloquant de gouvernance. Ne pas reproposer « fusionnez, vous configurerez plus tard » comme si cela répondait à la demande. |
| Dernier correctif de revue | [FACT — R1 et git show HEAD] Les anciens défauts JSON/troncature/TODO ont des corrections correspondantes dans 3e0cbc7e3. Les verdicts NON-FUSIONNABLE précédents portent sur d'anciens octets. [JUDGMENT] Obtenir une revue fraîche indépendante sur le HEAD final, puis les deux revues requises selon O2 et les preuves CI de ce SHA ; ne pas maintenir artificiellement les anciens P1 comme démontrés sur HEAD. |
| Présentation des intégrations | [JUDGMENT] L0 et dépendances L1–L3 doivent être concrètes : propriétaires, versions, pool réalisable, tests et sortie de recette. Une commande /absolute/trusted-seat-authority fictive n'est pas une livraison activable. |
| Preuve de valeur avant acceptation finale | [JUDGMENT] Fermer au moins L2–L4 pour un dépôt et obtenir son accord de capacité avant de qualifier le résultat livré d'activable. Les changements peuvent vivre dans des PR dépendantes ; le critère porte sur la chaîne disponible, pas sur leur numéro. |
| Ce qui ne doit pas devenir un nouveau gate général | [JUDGMENT] Ni toute la matrice multi-OS/cinq fournisseurs, ni Kubernetes, ni auto-fusion, ni tous les scanners d'images avant le premier pilote npm. Garder leurs limites/engagements visibles ; ne pas rebâtir la porte de qualification labo supprimée par O2. |

[JUDGMENT] Si une fusion de socle est nécessaire pour publier les briques dépendantes, présenter ce besoin précis au propriétaire et conserver l'acceptation fonctionnelle ouverte. S'il accepte cette séquence, la fusion de socle n'autorise toujours aucun lancement. À défaut de cette exception explicite, recommander de garder le NO GO jusqu'à la démonstration du chemin minimal.

## 6. Coût, réversibilité et runbook d'activation

[JUDGMENT] Le risque irréversible porte surtout sur la consommation d'abonnements, la divulgation de secrets et la publication/fusion de code. Un timer et une configuration sont réversibles ; des unités consommées et une version déjà diffusée ne le sont pas. Cela justifie une présentation des sièges, sans transformer chaque réglage réversible en demande d'autorisation.

| Coût | Ce qui est défendable maintenant |
|---|---|
| Inférence | [FACT/JUDGMENT — J3/S1] Minimum trois tâches par candidat ; quotas réellement consommés à mesurer. Le scénario pilote Muse + deux Codex peut plafonner à un cas minimal/jour. |
| Travail | [JUDGMENT] Petits lots de raccord, qualification et exploitation, avec deux tours de revue indépendants par modification de spec/code selon O2. Estimation en heures d'agent après inventaire L0 et constat de la publication L1 ; aucune durée en jours humains recopiée de l'ancienne étude. |
| Infrastructure/abonnements | Inconnus. [JUDGMENT] Réutiliser le labo existant et le pool prévu ; aucun achat, crédit de remédiation ou nouveau service public présumé. |
| Retour arrière | [JUDGMENT] Désactiver le timer et les nouvelles admissions, laisser terminer/drainer ses propres tâches, conserver claims, dépenses et preuves, réconcilier toute branche/PR ambiguë ; ne jamais réinitialiser le compteur pour refaire partir un essai. |

Runbook proposé, **à exécuter ultérieurement par le conducteur/opérateur autorisé sur l'hôte de laboratoire, jamais par cette analyse confinée** :

1. [JUDGMENT] Geler les versions livrées et vérifier le contrat publié L1 ; inventorier les références publiques de sièges et les modèles exacts, deux usages et trois familles de consommateurs. Faire ratifier l'affectation de capacité préparée, pas des secrets.
2. [JUDGMENT] Enrôler les comptes de laboratoire par le circuit officiel choisi. Consentement humain si nécessaire ; imports par manifeste privé ou SeatBundle sur entrée protégée. Enregistrer dans la custodie de confiance, avec propriétaire unique du renouvellement, projections et qualification d'entitlement. Ne pas importer silencieusement les comptes quotidiens du propriétaire.
3. [JUDGMENT] Qualifier l'auth native et les routes GW séparément. Confirmer que le lancement est lié au seatRef réservé. Pour le job, vérifier les hooks/outils sur l'auteur et ses deux worktrees de revue, expiration/401 et absence de repli. Les résultats GW ne sont pas une preuve CLI ni l'inverse. [FACT — M2, index.ts lignes 10837–10843] Le code avertit que le GW charge les comptes au démarrage. [JUDGMENT] Prévoir sa prise en compte des nouveaux comptes par redémarrage contrôlé du **seul GW de laboratoire**, sans toucher au host natif du propriétaire.
4. [JUDGMENT] Déployer l'autorité commune et l'amendement de quota ratifié ; prouver le débit des trois consommateurs, la réserve fournisseur et la conservation des réservations après incident. Garder le ledger de production hors candidats.
5. [JUDGMENT] Le conducteur écrit la configuration privée : état hors dépôts, chemins exacts, identités autorisées, références de l'autorité, modèles/rôles, tests ciblés et scanners pour h2a d'abord. Identité GitHub capable de publier la branche dédiée et gérer une PR ; règles du dépôt et secrets du contrôleur séparés des tests/modèles.
6. [JUDGMENT] Faire un scan sans inférence puis **un pilote manuel complet**. Exemples de commandes futures, avec chemins absolus remplacés par la release revue sur le labo ; aucune de ces commandes n'a été exécutée ici :

   ~~~sh
   rtk node /ABS/release-revue/bin.js vuln-fix run --config /ABS/config.json --dry-run
   rtk node /ABS/release-revue/bin.js vuln-fix run --config /ABS/config.json
   ~~~

   [JUDGMENT] Conserver la sortie et les preuves baseline/candidat, admissions, identité, double revue, head distant, URL de PR et limites de couverture. Choisir un vrai correctif admissible ; si le dépôt est propre, démontrer la voie corrective sur une fixture temporaire vulnérable et laisser la recette réelle de correction comme non observée. Ne jamais introduire une faille dans un dépôt réel pour fabriquer un succès.
7. [JUDGMENT] Quand la recette est concluante, rendre les unités avec les chemins explicites de Node, de la release revue et de la configuration ; installer puis activer le timer utilisateur de laboratoire. Observer son **premier déclenchement planifié**, le service, la sortie et le rapport ; vérifier la disponibilité nocturne, le fuseau et le rattrapage. Conserver une action d'arrêt documentée limitée à ce service et à ses propres processus.
8. [JUDGMENT] Le conducteur reprend les PR, applique les règles de revue/CI/fusion du dépôt, et suit la correction jusqu'à sa diffusion quand elle est pertinente. Ajouter ensuite les autres dépôts qualifiés, surveiller les refus et la capacité. Conserver une rotation effective parmi les auteurs éligibles et une réévaluation des fournisseurs inéligibles.

[FACT — J4] La commande timer existe déjà pour rendre les unités et documente l'installation ; aucune preuve d'installation n'est fournie par le rendu. [JUDGMENT] Un rapport quotidien lisible par le conducteur et un état d'échec visible suffisent au premier pilote ; une promesse de notification automatique ou de délai de quinze minutes demanderait une livraison supplémentaire.

## 7. Attendus, limites et incertitudes

| Attendu propriétaire | Source | Couvert aujourd'hui | Écart à fermer |
|---|---|---|---|
| Chercher chaque jour les failles de plusieurs composants | O1/O2 | [FACT — J1/J4] Scan npm/OSV, tous locks suivis, scanners additionnels et timer rendu. | [JUDGMENT] Inventaire, préparation par dépôt, installation et observation. |
| Corriger avec des sièges | O1 | [FACT — J2] Appels natifs et seam d'admission. | [JUDGMENT] Autorité réelle, identité liée au compte, pool conforme et qualification. |
| Ne pas perdre les tests GW/CLI | O1/O2 | [FACT — M1–M4] Modèle cinq fournisseurs, deux projections, matrice synthétique. | [JUDGMENT] Contrat L1 publié/adopté, enrôlement/usage réels, matrice native et quotas communs ; Claude testé mais pas employé comme sous-traitant. |
| Harnais strict et double revue | O2 | [FACT — J2–J4] Garde de workspace, deux couples complémentaires et SHA fixé ; refus sur preuves de tests manquantes. | [JUDGMENT] Qualification native et vraie sélection conformes à la politique actuelle ; revue fraîche du HEAD #371. |
| npm HIGH/CRITICAL, toutes sources | O1/O2 | [FACT — J1/J4] npm + OSV hydraté, findings unknown visibles, scanners configurables. | [FACT] Les arbres npm ne couvrent pas images/OS, vendored/généré, autres écosystèmes. « Toutes sources » ne doit pas devenir une couverture universelle revendiquée. |
| Réduire l'exposition | O1, demande initiale S1 | [FACT — J4] Candidat puis PR ; pas de fusion. | [JUDGMENT] Reprise humaine, merge et diffusion. Mesurer alerte → candidat → PR → merge → déploiement, pas seulement le nombre de PR. |

| Incertitude | Conséquence et moyen de lever |
|---|---|
| Autorité commune déjà disponible hors du confinement ? | [JUDGMENT] Inventaire public et interface par son mainteneur. Si oui, L2 devient un adaptateur plutôt qu'un nouveau service ; ne pas déclarer son inexistence universelle. |
| Publication L1 plus récente ? | [JUDGMENT] Vérifier sa version/API et faire l'adoption contrôlée dans le lot, sans lire la distribution installée du propriétaire. |
| Capacité et conditions des comptes ? | [JUDGMENT] Seul le titulaire/l'opérateur peut fournir état d'entitlement et références de quota. La fiche synthétique de Vibe ou d'agy ne tranche pas leur facturation réelle. |
| Identité effective du modèle ? | [FACT — J1/J2] Identité demandée enregistrée, modèle effectivement servi non attesté. [JUDGMENT] Garder cette limite, qualifier les preuves disponibles ; aucun alias de lancement ne devient une attestation. |
| Muse annoncé indisponible jusqu'au 19/10 02:00 ? | [FACT — O2] Annonce dans le registre, non interrogation de quota actuelle. [JUDGMENT] Ne pas transformer cette date en preuve de réouverture ; sans pool alternatif complémentaire, attendre l'admission réelle. |
| Capacité totale suffisante pour la famille de dépôts ? | [JUDGMENT] Mesurer temps/tours et vieillissement des files lors du pilote. Un candidat minimal/jour partagé peut ne pas suffire à « les différents composants ». |
| Dernières revues/CI #371 ? | [FACT — R1/R2] Sources à SHA/dates différents. [JUDGMENT] Collecter sorties et verdicts sur le HEAD de fusion ; aucune fraîcheur GitHub revendiquée dans cette analyse. |

**[JUDGMENT] Meilleur argument contre P1 :** avec une enveloppe partagée déjà saturée, le job produira des rapports et des refus chaque nuit sans corriger assez vite. P2 gagne si une mesure réelle démontre cette saturation et si l'affectation supplémentaire respecte les plafonds et les conditions des comptes. L'existence d'une autorité déjà qualifiée et de packages L1 compatibles raccourcirait nettement les lots ; elle ne supprime pas la preuve native du pool.

**[JUDGMENT] Pré-mortem :** dans six mois, le dispositif a échoué parce qu'on a appelé « sièges » trois lignes pointant au même login ambiant, consommé le budget des tests, laissé tous les patchs récents en brouillon, puis compté des PR non fusionnées comme des failles corrigées. Les fermetures observables de L2/L4/L5 et les mesures d'exposition visent précisément ces échecs.

**[JUDGMENT] Biais du présentateur :** le chemin le plus court pour clore techniquement une branche serait la fusion dormante. Il facilite le travail des agents sans donner au propriétaire son job utile. La recommandation retient le raccord et la preuve du pilote pour cette raison, sans demander d'achever toute l'architecture CI avant la première valeur.

## 8. Décision minimale et compte rendu de cette passe

[JUDGMENT] Le conducteur doit d'abord compléter la fiche concrète des sièges disponibles ; demander au propriétaire de choisir entre des comptes ou quotas imaginaires reproduirait la présentation manquante. Une fois cette fiche prête, **une seule question immédiatement bloquante**, avec le contexte/options de §4 :

> Acceptez-vous d'affecter les sièges de laboratoire identifiés au pool commun tests GW/tests CLI/correctifs, avec la remédiation admise dans le solde des deux unités Codex de maintenance, les six unités de tests et les deux d'enrôlement préservées — option P1 recommandée, ou P2 capacité davantage dédiée, ou P3 détection seule provisoire ?

[JUDGMENT] Une réponse P1 ne remplace ni l'amendement effectif/promu de l'autorité, ni le consentement fournisseur, ni la qualification, ni le GO de fusion actuellement refusé. Le conducteur exécute le runbook et revient avec une preuve de fonctionnement ; le propriétaire tranche les droits et la capacité, pas les détails d'implémentation.

| Commits poussés par cette passe | Tests exécutés par cette passe | Résultat |
|---|---|---|
| Aucun | Aucun — mission d'analyse uniquement | Aucun vert ni RED revendiqué ; le tableau §5 décrit des preuves à obtenir. |

| Contrôle en lecture seule effectué | Commande exacte | Sortie observée |
|---|---|---|
| Révisions disponibles | rtk git --no-optional-locks -C /home/antoinefa/src/h2a rev-parse HEAD origin/main origin/feat/daily-vuln-fix 7670fbed6 | 0d6b2eaf5884834ca5a7498477c6efdfba24a3de ; 46b82b42781709f2a2ab1bec6707ba58131248f0 ; 3e0cbc7e319a0c831fae26f8b3ebd8b71923c01d ; 7670fbed6870fb7e5b985a1315ff55776b362fd8 ; exit 0. Le checkout principal n'est pas origin/main ; les lectures M1–M5 utilisent explicitement origin/main. |
| #348 contenu dans main observé | rtk git --no-optional-locks -C /home/antoinefa/src/h2a merge-base --is-ancestor 7670fbed6870fb7e5b985a1315ff55776b362fd8 origin/main | exit 0 ; stdout vide. Contrôle d'ascendance, pas un test fonctionnel. |
| HEAD #371 non contenu | rtk git --no-optional-locks -C /home/antoinefa/src/h2a merge-base --is-ancestor 3e0cbc7e319a0c831fae26f8b3ebd8b71923c01d origin/main | exit 1 ; stdout vide, résultat négatif attendu pour cette question d'ascendance. |
| Worktree #371 | rtk git --no-optional-locks -C /home/antoinefa/src/h2a/tmp/worktrees/vulnfix status --porcelain=v1 --untracked-files=normal | exit 0 ; stdout vide. |

| Non couvert | Déviation par rapport à la mission |
|---|---|
| Enrôlement, secrets, état réel, quota actuel, inférence native/GW, publication npm actuelle, état GitHub temps réel, timer, double revue de cette analyse, correction/fusion/déploiement réels. | Aucun de ces éléments n'a été tenté ou déclaré réussi. Seul le présent fichier est créé ; aucun code, commit, Track, service, processus tiers ou Python. |
| Régressions et CI décrites dans le capital | Historiques attribués à leurs sources, jamais présentés comme des commandes rejouées. Les écarts de livraison de #348/#371 sont explicités ci-dessus ; aucune modification de leur spécification n'est effectuée ici. |
