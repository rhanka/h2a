# Révision v2 — traitement des revues de la spécification #371

Date : 18 octobre 2026. Travail documentaire uniquement : aucune
implémentation, aucun test logiciel, aucune qualification live ni
activation. Les RED/GREEN de la v2 sont des preuves à produire par les
lots futurs, pas des résultats obtenus pendant cette révision.

La [v2](SPEC_EVOL_VULN_FIX_ACTIVATION.v2.md) reprend les 18 remarques P1/P2
des deux revues, vérifiées dans les sources ci-dessous. A désigne Astra
max, dans l'ordre de sa liste numérotée ; S désigne Sol max, dans l'ordre
de ses neuf puces. Les remarques communes gardent chacune leur ligne.
Le [résumé français](spec-summary.md) est mis à jour ; la v1 reste intacte.

| Document d'entrée | SHA-256 constaté avant modification |
|---|---|
| SPEC_EVOL_VULN_FIX_ACTIVATION.md | `c476ca3a9f3bd7d753f9e59afad27aa9ae6d60384cc00b89ca1654c6db27725f` |
| ../rv371a-last.md | `f6b0419163fc7ea8f1edc581380d99574b9ceb19261b75552dc4355e59e62526` |
| ../rv371s-last.md | `761489e9f61d8e7261de5546b1c45a0202a436a02198615aee2c640b0cdf2f5d` |

## Remarque → traitement

| ID | Priorité et remarque | Vérification dans les sources | Traitement dans la v2 et preuve exigée |
|---|---|---|---|
| A1 | P1 — L5 impose une baseline fonctionnelle rouge | Confirmé : v1 L674–676 ; E1 et E2 exigent normalement des tests baseline verts et réservent `redBefore` aux régressions explicites. | L5 point 4, son premier RED et G3 distinguent audit RED → GREEN, tests ordinaires GREEN → GREEN et régression applicable RED → GREEN. La recette positive doit accepter un correctif dont les tests passaient déjà. |
| A2 | P1 — Pas de reprise après attente des checks | Confirmé : E3 court-circuite toute PR ouverte vers le conducteur ; E1 ne fournit qu'un passage draft → ready, sans fusion. | D11, L4, L5, L6 et G3 prévoient des candidats persistants et une réévaluation autonome. Test : checks en attente → arrêt/redémarrage → checks verts au même SHA/base → une fusion, sans nouvel auteur/relecteur ni nouvelle facturation des tâches déjà réalisées. |
| A3 | P1 — Le canari d'environnement ne prouve pas D10 | Confirmé : E1 conserve l'environnement parent ; E4 explique explicitement qu'un worktree/HOME privé ne sépare pas un test Node arbitraire des credentials du contrôleur. Aucune exploitation réelle n'a été tentée. | D10 et L3 imposent une frontière effective fichiers/processus/capacités réutilisant l'adaptateur existant identifié par L0. Canaris env, fichier, processus synthétique lancé par le test, FD/socket/capacité, avec témoins positifs. Env seul ne ferme plus G2 ; adaptateur manquant = prérequis bloquant. |
| A4 | P2 — D10 interdit les credentials nécessaires à la CLI | Confirmé : D8/L2 et E5 nécessitent une capacité d'auth native ; E5/E6 prévoient déjà la délégation sérialisée. L'interdiction indistincte de la v1 est excessive. | D8/D10 définissent séparément contrôle de publication, custodie/délégué natif, CLI de confiance, outils/MCP et vérificateur. Projection admise pour la CLI, aucun writer pour les agents, aucun credential pour les tests ; chemin `serialized-stream` explicite sous l'autorité centrale, sans renouvellement concurrent. |
| A5 | P2 — GH-1/GH-2/GH-3 faussement exclusifs et question binaire | Confirmé : OQ1 v1 laisse GH-3 compatible avec les deux lieux d'exécution, alors que L4 les dit alternatives ; E7 recadre les questions de conception sur les principes. | OQ1 reste une question ouverte sur les responsabilités/résultats attendus de GitHub. Orchestration, exécution, traçabilité, custodie et fusion sont séparées. Combinaisons illustratives : service labo, Actions hébergées, Actions sur runners labo administrés ; contrôleur ou plateforme pour la fusion. L4/G1 exigent ensuite la combinaison complète, ordonnanceur compris. |
| A6 | P2 — Sources/tests/commandes non résolus mais G0 permissif | Confirmé : v1 L397–400, L451–457, L559–564, L624–642 et L779–784 autorisent contreparties source, dépôt inconnu et répertoires vagues. Ces chemins ne sont pas établis par les analyses fournies. | §6 et L0 imposent avant chaque lot sa fiche exacte : dépôt/base, sources/tests existants ou nouveaux, interfaces, cwd, commande ciblée et assertion RED attendue. L1/L3/L3-R/L4/L6 restent bloqués sur leurs dépendances non résolues ; un inventaire documentaire peut progresser sans autoriser de code. G0 global exige toutes les fiches nécessaires à la première activation. |
| A7 | P2 — D3/G5 contradictoires sur le préalable de fusion | Confirmé : D3 v1 exige G4 dans « activable » avant fusion, G5 permet G4 après release ; cette séquence technique n'est pas citée par l'owner dans E7. | D3 sépare le verbatim owner de la séquence proposée : activabilité pré-fusion G0–G3 + dossier G5, activation planifiée après release G4, acceptation de l'autonomie réelle G6. Le NO GO owner reste explicite ; une réussite technique ne le révoque pas. Aucun accord par fusion de correctif n'est ajouté. |
| A8 | P2 — Deux revues de code « maximum-effort » mal attribuées | Confirmé : E7, entrée du 18/10 ~03:25, distingue spec Astra max + Sol 6.1 max et code Sol 6.1 xhigh + Astra max. | §2, D13, OQ3, G0 et G5 reprennent les deux couples exacts. La traduction technique reste à qualifier, sans réduction silencieuse. Les revues de v1 ne deviennent pas une approbation de v2. |
| A9 | P2 — G7 clôturable sans preuve positive de la finalité | Confirmé : le G7 v1 n'exige qu'un reçu par cellule déjà verte ; un tableau entièrement non couvert passe cette implication. E8 impose les quatre scénarios N×N, et L7 v1 promet la rotation. | L7/G7 séparent progression et clôture : dix usages positifs, 25 paires ordonnées × quatre scénarios natifs Linux = 100 reçus, rotation exercée d'au moins deux auteurs admissibles sans Claude. Toute preuve manquante maintient sa partie ouverte ; autres OS explicitement ouverts. Cela ne bloque pas la première activation. |
| S1 | P1 — Correctifs bloqués si tests baseline déjà verts | Confirmé : mêmes E1/E2 et passage v1 que A1. | Même correction L5/G3 ; le premier cas positif de la nouvelle fusion utilise expressément audit rouge et tests fonctionnels verts avant/après. |
| S2 | P1 — Frontière d'isolation insuffisante et credential CLI interdit | Confirmé : E1/E4 montrent la limite de l'environnement/HOME ; E5 exige la projection authentifiante. Le canari seul n'atteste pas d'une séparation fichiers/processus. | D10/L3/G2 distinguent CLI de confiance, outils du modèle et tests ; réutilisation des rôles séparés de E6 et d'un adaptateur réellement qualifié. Canaris fichier/processus/capacité en plus de l'environnement, sans toucher un processus ou un état réel de l'owner. |
| S3 | P1 — Pas de reprise autonome des blocages transitoires | Confirmé : E3 effectue un handoff pour PR ouverte ; E9 renvoie `ok=false` avant sept jours sans dispositif de reprise du candidat dans E3. | L5 couvre `waiting-checks`, `waiting-age`, admission temporaire, revalidation et fusion persistante/idempotente ; L4 nomme le réveil effectif et L6 le rapporte. Tests de maturation à horloge contrôlée, redémarrage, minuit UTC et événements dupliqués ; preuves invalidées si SHA/base changent, pas de nouvel auteur simplement pour attendre. |
| S4 | P2 — Renouvellement/livraison sans lot ni preuve ; sérialisation omise | Confirmé : L6 v1 se contente de « single-owner renewal » ; E5 contient les primitives et E6 exige sauvegarde, livraison et vérification ultérieure avant prochaine consommation. Les analyses ne prouvent aucun déploiement. | Nouveau sous-lot obligatoire L3-R sur la ligne de custodie existante : maintenance centrale, successeur, livraison/vérification et consommation suivante ; sérialisation si nécessaire, capture même après échec, fence/reprise sans rejeu ambigu. G2 exige cette preuve pour le pool initial, y compris dans V3 ; L7 garde les fournisseurs supplémentaires ouverts. |
| S5 | P2 — Lots non exécutables sans chemins source exacts | Confirmé : mêmes passages v1 que A6 ; les artefacts observés ne fournissent pas les chemins source/test propriétaires. | Fiches L0 obligatoires avant le lot concerné et G0 non permissif. Les nouveaux points d'entrée/gate h2a proposés sont nommés explicitement ; workflow et composants amont exigent encore dépôt/ref/source/test/commande résolus avant code. Aucune contrepartie source inventée. |
| S6 | P2 — OQ1 enferme la réponse et confond des dimensions compatibles | Confirmé : OQ1/L4 v1 et E7 ; une ordonnance Actions peut utiliser des runners administrés au labo, et la fusion plateforme est une dimension indépendante. | OQ1 reste ouverte sur les principes ; L4 compose exécution, ordonnanceur et fusion, avec runners Actions hébergés ou administrés. La réponse owner ne doit pas être une sélection binaire technique ; les conducteurs en tirent le contrat vérifiable. |
| S7 | P2 — Affectations/efforts de revue inexacts | Confirmé par E7, comme A8. | D13/G0/G5 et OQ3 reproduisent spec Astra max + Sol 6.1 max ; code Sol 6.1 xhigh + Astra max, sur la révision finale pertinente. |
| S8 | P2 — Contradiction préalable de fusion et faux verbatim | Confirmé par D3/G5 v1 et l'absence de cette séquence dans E7, comme A7. | Critère owner conservé, séquence technique étiquetée proposition, phases pré-fusion / après release / production distinctes et cohérentes dans D3, L4/L6 et G3–G6. Le NO GO initial n'est pas levé par rédaction de la spec. |
| S9 | P2 — RED de fusion satisfait par une absence totale de fusion | Confirmé : E3 ne fusionne jamais ; E1 s'arrête à `ready`. « Aucun merge » peut donc déjà passer avant tout ajout de garde. | §6/L4/L5 imposent un RED positif initial : toutes les conditions remplies → exactement un merge commit, qui échoue sur le capital dormant. Les refus restent des tests de garde ; aucun refus déjà satisfait n'est présenté comme une régression reproduite. Reprise et maturation ont leurs propres scénarios positifs RED → GREEN. |

Aucune remarque n'est réfutée : les 18 constats sont fondés. Deux nuances
de preuve sont conservées : la fuite par fichiers/processus est une
limite de frontière déduite des sources, pas une exploitation live
démontrée ici ; `serialized-stream` est du capital à raccorder et
qualifier, pas une raison de créer une seconde custodie.

## Sources contrôlées

Les lignes de v1 renvoient au fichier original de SHA vérifié ci-dessus.
Les fichiers #371 ont été lus directement en source, sans exécution.
Les sources #348 ont été lues par `rtk git -C /home/antoinefa/src/h2a show
46b82b42781709f2a2ab1bec6707ba58131248f0:<chemin-source>` ; cette révision
fixe évite de les confondre avec un checkout ou une installation live.

| Réf. | Source et fait contrôlé |
|---|---|
| E1 | [repository.mjs](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/repository.mjs:82) : `tests()` hérite de `process.env`, remplace les répertoires XDG mais pas le HOME ; `expectedRed` uniquement pour `phase === 'before' && redBefore === true` ; `ready()` ne fait que rendre la PR prête. SHA-256 `c7e796795ad6abe509c54a819c00a88acd63b4c2472fc00c5ce762cf6a8e95d3`. |
| E2 | [operator.md](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/skills/vuln-fix/references/operator.md:55) : audit rouge/vert ; tests baseline verts par défaut ; exception `redBefore` explicite ; skips/TODOs bloquent. |
| E3 | [controller.mjs](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/controller.mjs:41) : `existingPr()` produit un motif « conductor resolution » puis `continue` ; fin de la chaîne = `repo.ready()`, aucune fusion. SHA-256 `6ac5bef5f2ef55c30fba781c46c417a4133f5b4b98571e302e3cee72bd1488b0`. |
| E4 | [analysis-astra.md](analysis-astra.md:113) : séparation env/HOME insuffisante ; distinction entre frontière requise et exploitation non démontrée, explicitée à la ligne 115. |
| E5 | [cli-seat-materialization.ts à 46b82b42](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a-runtime/src/cli-seat-materialization.ts#L264) : `materializeSeatBundle()` exige délégation et ticket pour un canonique renouvelable ; `mcpChildEnv()` filtre les enfants ; `beginSerializedStream`, `captureSerializedResult` et `validateStreamClearance` existent déjà. `cli-seat-materialization.test.ts` existe aussi dans cet arbre (vérifié par `git ls-tree`). Cela ne prouve pas une custodie centrale déployée. |
| E6 | [spec-v10.md](/home/antoinefa/src/sentropic/.tmp/ci-seats-v4/spec-v10.md:177), §§3.3–3.5 : autorité temporelle unique, `serialized-stream`, sauvegarde canonique puis projections, continuation nouvellement mise en file et consommation suivante ; séparation des rôles/runners, perte de protection des repository secrets explicitement acceptée. SHA-256 `9db694f19f5fbc548b70cb7ad22e211d0c9ed6a693878276ae0f607726a1471c`. Document de conception, pas preuve d'implémentation/déploiement. |
| E7 | [DECISIONS-owner.md](../DECISIONS-owner.md:176) : couples de revue du 18/10 ~03:25 ; [recadrage sur les principes](../DECISIONS-owner.md:184) du 18/10 ~10:20 ; réponses capacité A, tous dépôts prêts, autonomie et « Dans gh ». SHA-256 initial `72629f391f28c9aefaf7443c0045ad708cb3175588ec4fe9f9b313b9451d44cb` ; préfixe initial vérifié intact après les deux ajouts externes décrits ci-dessous. |
| E8 | [DECISIONS-owner.md](../DECISIONS-owner.md:66) : vrais binaires, N×N message/indisponibilité/boucle/négociation, Linux puis macOS puis Windows ; modèles simulés en priorité quand possible. [Stub natif à 46b82b42](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/scripts/e2e-cli-seats-direct.mjs#L1) : refuse explicitement tout live ; listes des cinq CLI et quatre scénarios. |
| E9 | [verify.mjs](/home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/verify.mjs:6) : `supplyChain()` refuse âge inconnu ou inférieur à sept jours et conserve `ok=false` en cas d'erreur ; contrôle intégrité/signature/provenance. |

## Décisions préservées et limites de la révision

| Sujet | État |
|---|---|
| Décisions owner | Capacité A, six unités CI et deux d'enrôlement préservées, tous les dépôts prêts, correctif/revue/fusion autonomes dans GitHub sans accord par correctif, absence de sous-traitant Claude Code, double usage des cinq fournisseurs et merge commit conservés. Le NO GO de #371 reste une autorité distincte des critères techniques. |
| Questions ouvertes | OQ1 reste ouverte sur les responsabilités de GitHub ; OQ2 inventaire/consentements ; OQ3 qualification technique modèles/efforts ; OQ4 principes d'une éventuelle urgence ; OQ5 proposition d'exploitation. Aucune réponse owner n'est inventée. |
| Ce qui reste à établir | Dépôts/source/tests/commandes des composants amont ou adaptateurs inconnus, frontière réellement déployée, comptes/quota/renouvellement réels, revue indépendante de la v2, implémentation et tous les reçus G0–G7. Les chemins non établis restent bloquants pour les lots concernés. |
| Portée documentaire | Deux fichiers créés (v2 et présente table), résumé français remplacé ; v1 et sources non modifiées par cette révision. Aucun code, secret, état h2a réel, binaire h2a installé, service ou processus tiers utilisé ; aucun Python. |
| Commits poussés | Aucun : répertoire de livrables hors dépôt Git. Aucun changement de branche, commit ou push. |
| Écart à la demande de révision | Aucun ; aucune approbation de réalisation, activation ou résultat de test logiciel n'est déduite de ces documents. |

## Contrôles documentaires exécutés

Ces contrôles ne remplacent pas les futures preuves RED/GREEN des lots et
ne qualifient aucune propriété d'exécution.

| Commande exécutée depuis act371 | Code et sortie |
|---|---|
| `rtk node` — assertions documentaires en lecture seule fournies sur stdin, sans fichier de code créé | 0 ; sortie reproduite ci-dessous : v1/verbatims, 18 identifiants et priorités, structure, liens et forme des trois livrables. |
| `rtk sha256sum SPEC_EVOL_VULN_FIX_ACTIVATION.md ../rv371a-last.md ../rv371s-last.md ../DECISIONS-owner.md /home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/repository.mjs /home/antoinefa/src/h2a/tmp/worktrees/vulnfix/packages/h2a/src/vuln-fix/controller.mjs /home/antoinefa/src/sentropic/.tmp/ci-seats-v4/spec-v10.md` | 0 ; v1, deux revues, sources #371 et spec-v10 identiques aux empreintes consignées. Journal owner devenu `dfda2350752ad15aeaa1678097097a4ef722d4f8811e1ebc66768cefc4bff2aa` à cette relecture : deux entrées ajoutées pendant le travail, diagrammes et release #374, hors périmètre de cette révision. |
| `rtk node` — assertion sur stdin : le préfixe du journal avant l'entrée « 18/10 ~15:50 » retrouve exactement son SHA-256 initial E7 | 0 ; `OK — journal owner : prefixe initial intact ; deux ajouts hors perimetre #371.` Les décisions utilisées n'ont pas changé ; le cut-off reste celui de la v1. |
| `rtk git rev-parse --show-toplevel` | 128 ; `fatal: not a git repository (or any of the parent directories): .git`. Explique l'absence de commit/push ; aucun dépôt de sources n'a été modifié pour y déposer ces livrables. |
| Tests logiciels et qualifications live | Aucun exécuté : mandat documentaire. Aucun résultat RED/GREEN, quota, isolation, renouvellement ou fusion n'est revendiqué. |

Sortie du contrôle documentaire :

```text
OK — v1 intacte ; bloc des verbatims owner conserve octet pour octet.
OK — 18 remarques distinctes : 6 P1 et 12 P2, chacune traitee une fois.
OK — structure conservee : D1-D14, OQ1-OQ5, L0-L7 + L3-R, G0-G7.
OK — 13 liens locaux resolus ; UTF-8, fins de ligne et espaces controles.
Documentation uniquement : aucun test logiciel ni recu live produit.
```
