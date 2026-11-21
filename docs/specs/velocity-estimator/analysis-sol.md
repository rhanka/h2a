# Estimateur de délai IA — analyse indépendante

Étude du 18 octobre 2026. Analyse et collecte en lecture seule ; aucun code produit, test de dépôt, commit, push, appel au runtime h2a ou lancement d’un autre agent. Les propositions de spécification sont en anglais (§ C.6). Les autres propositions restent à réconcilier par le conducteur avec l’analyse indépendante parallèle.

**Recommandation : étendre le capital `@sentropic/agent-stats`, avec des calculs déterministes et une sélection de comparables assistée par l’IA. La skill de planification consomme ces résultats ; Track conserve le rattachement et les références ; le paquet de connaissance versionné conserve les observations et prévisions reproductibles.** Aucun nouveau moteur de mémoire ni ordonnanceur h2a n’est nécessaire au premier incrément.

Le délai mesuré ouverture → fusion de 20 PR h2a est **P50 2 h 45, P80 3 h 41, P95 12 h 59**, avec un maximum de 30 h 03. Cela permet un amorçage en heures réelles. Cela ne mesure encore ni l’ensemble « demande → livraison », ni le travail actif des agents, et ne justifie aucun engagement probabiliste calibré.

## A — Exigences owner et propositions

| Statut | Contenu | Conséquence pour la mission |
| --- | --- | --- |
| Exigence directe, relayée par gr-conductor | « Il faut développer via h2a un estimateur de délai avec l'IA sur la base de la vélocité effective que nous avons. Donne-lui la mission. » | Livrer une capacité consommable par les agents h2a, utilisant des observations effectives. Un prompt produisant seul un chiffre ne suffit pas. |
| Exigence directe, même relais | « arrêter les estimations de délai débiles de 45 j pour des trucs dev par l'IA… c'est lassant » | Abandonner les calendriers nominaux de développeur humain appliqués aux agents ; mesurer les horloges pertinentes. Cela n’autorise pas à remplacer 45 jours arbitraires par 45 minutes arbitraires. |
| Exigence liée, texte vérifié dans l’étude sentropic | « la référence des temps estimée devra être une connaissance utilisée par le conductor pour l'optimisation des plan d'intégration et ameliorre la skill de planification » ; connaissance « spécifique a capitaliser pour le repo » ; CI/CD et architecture « committés comme sous-graphe typé » | Prévoir une référence versionnée et réutilisable, un consommateur dans la planification et le raccord au programme de connaissance existant. Ne pas recommencer une étude indépendante de stockage mémoire. |
| Proposition de gr-conductor | Mesures par lot/PR, premier commit → ouverture → fusion, modèles, tours de revue, CI, attentes owner, quotas ; P50/P80/P95 par lot et chemin critique ; retour estimé/réel à chaque fusion | Bon périmètre candidat, **pas une liste de fonctionnalités déjà ratifiées par l’owner**. Le premier livrable peut être plus petit ; les données manquantes doivent rester visibles. |
| Contrainte de cette analyse | Pas de code, commit ou Python ; confinement ; tests uniquement ciblés et temporaires lors de l’implémentation | Aucune exécution des workflows de brainstorm/plan qui écrivent dans Track, aucun lancement de pair. Le fichier présent est le seul livrable permanent créé. |

Sources : [DECISIONS-owner.md:182](../DECISIONS-owner.md), [demande owner sentropic](/home/antoinefa/src/sentropic/.tmp/ci-knowledge-study/OWNER-REQUEST.md:1). Le journal [PIPELINE.md:380](/home/antoinefa/src/graphify/.graphify/scratch/design/memory-finalization/PIPELINE.md:380) reformule la mission avec davantage de détails ; cette reformulation ne transforme pas ces détails en verbatim owner.

L’item existe déjà : `01M57KSPC5VJN455J69W4A4ZH3`, créé le `2026-10-18T13:39:10.343Z`, parent `01KWWXCD9PYZZBZR5E6JQAK6T6` (« Tracking & record », WP8 selon le journal conducteur). Cette étude ne crée ni nouvel item ni nouveau WP. Le rattachement de pilotage n’impose pas que le calcul vive dans le package Track.

À exclure : conversion jours-homme × facteur « IA », LOC/heure ou commits/heure comme productivité universelle, modèles attribués depuis l’auteur Git, temps CI ajouté une seconde fois au délai de PR, attente inconnue remplacée par zéro, somme des P95 des lots présentée comme P95 du programme, réduction des tests ou des portes de revue pour faire tenir une date. Une estimation n’autorise ni fusion, ni déploiement, ni changement de modèle ou de quota.

## B — Faisabilité prouvée et qualité des données

### B.1 — Références réellement examinées

| Surface | Référence observée | Limite |
| --- | --- | --- |
| Checkout demandé `/home/antoinefa/src/h2a` | HEAD `0d6b2eaf5884834ca5a7498477c6efdfba24a3de`, branche `docs/org-raci-wp7-hinfra`, nombreux changements préexistants | Code local ancien, versions 0.91.0 ; ce n’est pas une preuve du comportement actuel de `main`. Aucune modification. |
| Source GitHub h2a | `main` épinglé à `46b82b42781709f2a2ab1bec6707ba58131248f0`, commit du `18/10 07:48:56Z` ; arbre complet, `truncated:false` | Les chemins de conception ci-dessous ont été vérifiés sur cette référence, sans fetch/rebase ni lecture d’un dist installé. |
| Track local | 1 919 événements, premier `09/06 23:39:18.101Z`, dernier `18/10 13:39:10.343Z` lors de la lecture | Journal plus récent que le HEAD local : distinguer code, journal et GitHub. Aucun rapport CLI compilé/exécuté, aucune validation d’intégrité revendiquée. |
| Journaux conducteurs | PIPELINE.md, DECISIONS-owner.md ; 642 `.log` et 474 `.done` à la racine du scratchpad autorisé | Inventaire de fichiers, **pas** 642 travaux indépendants : relances, fichiers de tests et continuations peuvent se recouvrir. |
| Programme de connaissance | `ci-knowledge-study/OWNER-REQUEST.md`, `study.md`, `reconciliation.md`, retour cité `repo-knowledge-sol.out` | Études et contrats proposés, pas preuve de déploiement. Les durées en jours de `study.md:304–320` ne doivent pas être reprises comme référence de vélocité IA. |

La collecte GitHub a commencé vers `13:44:58Z`. L’échantillon h2a est exactement le résultat de `gh pr list --state merged --limit 20` : **20 PR fusionnées récemment créées, dans l’ordre de création renvoyé par gh**, et non une garantie des 20 dernières fusions de tout l’historique. Fenêtre d’ouverture : `16/10 23:55:38Z → 18/10 06:58:10Z`. Fenêtre des fusions : `17/10 04:32:52Z → 18/10 07:48:57Z`.

### B.2 — Mesures h2a, 20 PR

Toutes les dates du tableau sont en **2026, UTC** ; durées en `hh:mm:ss`. « CI » désigne le workflow `ci` du **dernier SHA de la branche** : ce n’est ni le cumul de toutes les tentatives depuis l’ouverture, ni la totalité des checks obligatoires du dépôt.

`PR elapsed = mergedAt − createdAt`.

`CI trigger → job end = max(completed_at des jobs non skipped) − workflow.created_at`, seulement pour une première tentative cohérente.

`CI job span = max(completed_at) − min(started_at)` ; cela inclut les espaces entre jobs et les attentes internes, sans être une somme de temps machine.

| PR | Ouverture UTC | Fusion UTC | Ouverture → fusion | CI trigger → job end | CI job span | Run |
| --- | --- | --- | --- | --- | --- | --- |
| [#373](https://github.com/rhanka/h2a/pull/373) | 10-18T06:58:10 | 10-18T07:48:57 | 00:50:47 | 00:17:31 | 00:15:23 | [39107663703](https://github.com/rhanka/h2a/actions/runs/39107663703/attempts/1) |
| [#368](https://github.com/rhanka/h2a/pull/368) | 10-17T23:23:08 | 10-18T00:49:06 | 01:25:58 | 00:20:42 | 00:19:17 | [39082867694](https://github.com/rhanka/h2a/actions/runs/39082867694/attempts/1) |
| [#367](https://github.com/rhanka/h2a/pull/367) | 10-17T22:53:50 | 10-18T01:39:08 | 02:45:18 | 00:35:59 | 00:31:49 | [39084635217](https://github.com/rhanka/h2a/actions/runs/39084635217/attempts/1) |
| [#366](https://github.com/rhanka/h2a/pull/366) | 10-17T21:30:17 | 10-17T23:25:50 | 01:55:33 | 00:19:02 | 00:16:42 | [39075234904](https://github.com/rhanka/h2a/actions/runs/39075234904/attempts/1) |
| [#365](https://github.com/rhanka/h2a/pull/365) | 10-17T21:20:53 | 10-17T23:05:50 | 01:44:57 | 00:31:15 | 00:20:21 | [39075326978](https://github.com/rhanka/h2a/actions/runs/39075326978/attempts/1) |
| [#364](https://github.com/rhanka/h2a/pull/364) | 10-17T20:41:10 | 10-17T23:46:01 | 03:04:51 | 00:23:02 | 00:22:07 | [39078527806](https://github.com/rhanka/h2a/actions/runs/39078527806/attempts/1) |
| [#363](https://github.com/rhanka/h2a/pull/363) | 10-17T20:20:23 | 10-17T20:44:20 | 00:23:57 | 00:19:10 | 00:16:29 | [39066286995](https://github.com/rhanka/h2a/actions/runs/39066286995/attempts/1) |
| [#362](https://github.com/rhanka/h2a/pull/362) | 10-17T19:49:37 | 10-17T21:43:55 | 01:54:18 | 00:24:53 | 00:18:46 | [39070280330](https://github.com/rhanka/h2a/actions/runs/39070280330/attempts/1) |
| [#360](https://github.com/rhanka/h2a/pull/360) | 10-17T18:08:38 | 10-17T18:24:30 | 00:15:52 | 00:13:41 | 00:13:39 | [39056806792](https://github.com/rhanka/h2a/actions/runs/39056806792/attempts/1) |
| [#359](https://github.com/rhanka/h2a/pull/359) | 10-17T15:25:20 | 10-17T19:06:00 | 03:40:40 | 00:18:27 | 00:15:38 | [39058407295](https://github.com/rhanka/h2a/actions/runs/39058407295/attempts/1) |
| [#358](https://github.com/rhanka/h2a/pull/358) | 10-17T15:22:20 | 10-17T16:38:33 | 01:16:13 | 00:37:15 | 00:19:45 | [39047575280](https://github.com/rhanka/h2a/actions/runs/39047575280/attempts/1) |
| [#357](https://github.com/rhanka/h2a/pull/357) | 10-17T15:13:23 | 10-17T18:49:27 | 03:36:04 | 00:17:05 | 00:16:09 | [39058284940](https://github.com/rhanka/h2a/actions/runs/39058284940/attempts/1) |
| [#356](https://github.com/rhanka/h2a/pull/356) | 10-17T14:36:38 | 10-17T15:52:59 | 01:16:21 | 00:25:50 | 00:16:23 | [39044104386](https://github.com/rhanka/h2a/actions/runs/39044104386/attempts/1) |
| [#352](https://github.com/rhanka/h2a/pull/352) | 10-17T01:58:22 | 10-17T04:53:08 | 02:54:46 | 00:30:40 | 00:19:55 | [39001206356](https://github.com/rhanka/h2a/actions/runs/39001206356/attempts/1) |
| [#351](https://github.com/rhanka/h2a/pull/351) | 10-17T01:39:33 | 10-17T04:32:52 | 02:53:19 | 00:28:03 | 00:14:32 | [39000861226](https://github.com/rhanka/h2a/actions/runs/39000861226/attempts/1) |
| [#350](https://github.com/rhanka/h2a/pull/350) | 10-17T01:35:40 | 10-17T14:35:10 | 12:59:30 | 00:15:47 | 00:14:50 | [39006760763](https://github.com/rhanka/h2a/actions/runs/39006760763/attempts/1) |
| [#349](https://github.com/rhanka/h2a/pull/349) | 10-17T01:32:20 | 10-17T04:53:00 | 03:20:40 | Quarantaine | Quarantaine | [38999547594 / attempt 2](https://github.com/rhanka/h2a/actions/runs/38999547594/attempts/2) |
| [#348](https://github.com/rhanka/h2a/pull/348) | 10-17T00:50:30 | 10-18T06:53:27 | 30:02:57 | 00:31:38 | 00:19:01 | [39084653784](https://github.com/rhanka/h2a/actions/runs/39084653784/attempts/1) |
| [#347](https://github.com/rhanka/h2a/pull/347) | 10-17T00:49:49 | 10-17T04:52:51 | 04:03:02 | 00:21:47 | 00:19:52 | [39001969920](https://github.com/rhanka/h2a/actions/runs/39001969920/attempts/1) |
| [#346](https://github.com/rhanka/h2a/pull/346) | 10-16T23:55:38 | 10-17T05:32:47 | 05:37:09 | 00:20:26 | 00:19:11 | [39004328537](https://github.com/rhanka/h2a/actions/runs/39004328537/attempts/1) |

Quantiles **nearest-rank**, rang `ceil(p × n)` dans la série triée ; pour n=20, P50 est le rang 10, pas la moyenne des rangs 10 et 11. Méthode explicitement versionnée : ne pas mélanger avec l’upper-median ou une interpolation d’un autre outil.

| Mesure | n | P50 | P80 | P95 | Statut |
| --- | ---: | ---: | ---: | ---: | --- |
| h2a, ouverture → fusion | 20 | 2:45:18 | 3:40:40 | 12:59:30 | Descriptif, toutes tailles/types confondus |
| h2a, CI trigger → dernière fin de job | 19 | 0:21:47 | 0:31:15 | 0:37:15 | Dernier SHA, tentative 1, workflow `ci` seulement |
| h2a, fenêtre des jobs CI | 19 | 0:18:46 | 0:19:55 | 0:31:49 | Inclut les espaces internes, exclut l’attente avant le premier job |
| engram, ouverture → fusion | 10 | 0:39:49 | 1:00:40 | 3:19:34 | Petit contrôle externe ; aucun mélange avec h2a |
| sentropic, ouverture → fusion | 10 | 12:17:18 | 20:45:30 | 36:55:14 | Petit contrôle externe ; autres lots et portes |

Échantillons externes : engram `#390–#399` ; sentropic `#697, #691, #688, #684, #683, #682, #679, #678, #675, #672`. Ils ne sont pas appariés en taille ou en nature : **aucun classement de productivité des dépôts ou modèles n’en découle**. Ils suffisent à réfuter l’existence d’un coefficient universel de vitesse IA.

Deux sondes CI externes ont aussi été lues : engram [#399 / run 39112482544](https://github.com/rhanka/engram/actions/runs/39112482544), 15 jobs dont 12 success et 3 skipped, trigger → dernière fin non skipped **10 min 13 s** ; sentropic [#697 / run 39130767419](https://github.com/rhanka/sentropic/actions/runs/39130767419), 84 jobs dont 57 success et 27 skipped, **20 min 42 s**. Les `skipped` sont conservés comme états GitHub ; cette analyse n’atteste pas que la sélection de ces jobs satisfait les portes métier.

### B.3 — Ce que l’échantillon révèle avant tout modèle

1. **Premier commit ≠ départ du travail.** Dans 10 PR sur 20, le plus ancien `committedDate` des commits actuellement attachés arrive après l’ouverture : `#368, #367, #366, #365, #364, #362, #359, #358, #357, #348`. Exemple #368 : ouverture `17/10 23:23:08Z`, plus ancien committer-date courant `23:51:26Z`. Le rebase réécrit l’horloge. L’author-date de #373 remonte au `17/10 01:59:57Z`, bien avant son ouverture le lendemain : ce n’est pas davantage une preuve de temps actif. Conserver les deux dates et leur sémantique ; ne pas corriger les valeurs négatives par zéro.
2. **Zéro revue GitHub n’est pas zéro revue réelle.** `reviews: []` sur les 20 PR ; les journaux montrent pourtant des revues et changements d’auteur. L’API prouve l’absence de reviews enregistrées dans GitHub, pas l’absence de travail de revue. Les 20 auteurs GitHub sont `rhanka` : impossible d’en déduire les modèles.
3. **Les tentatives CI doivent avoir une lignée explicite.** 105 runs de workflows ont été retrouvés sur les 20 derniers SHA ; les jobs des 20 runs `ci` représentent 117 lignes. Pour #349, l’endpoint `/attempts/2/jobs` renvoie cinq jobs démarrés avant leur propre `created_at` : par exemple `npm-test-trust-root`, début `03:55:00Z`, fin `04:08:04Z`, création `04:09:41Z`. Les résultats réutilisés/reruns demandent une interprétation documentée ; les agrégats « dernière tentative » sont mis en quarantaine. La PR reste valide pour ouverture → fusion. Utiliser `updated_at` comme fin de calcul ou `run_started_at − created_at` comme file d’attente aurait caché ce problème.
4. **L’attente résiduelle n’est pas automatiquement une attente owner.** Pour #350, la dernière fin de job CI précède la fusion de **8 h 44 min 50 s** ; pour #348, de **5 h 24 min 51 s**. Ce sont des résidus inexpliqués : autre check, disponibilité du conducteur, revue, GO ou autre cause. Ne pas les supprimer ni les étiqueter sans preuve.
5. **Biais de survivants et fenêtre courte.** Les derniers SHA fusionnés ont une CI finale réussie. On ne mesure pas ici le coût de tous les échecs, abandons, anciens pushes ou PR toujours ouvertes. Les P95 sur 20 PR d’environ deux jours sont des rangs empiriques fragiles, pas des délais garantis. Les changements CI récents, notamment #360, sont également des changements de régime à séparer au pilote.
6. **Attention aux jointures temporelles.** À l’ouverture des sept plus anciennes PR du tableau, aucune autre PR de cet échantillon n’était encore fusionnée ; à l’ouverture de #356, seulement six l’étaient. Un backtest utilisant les 20 PR pour prédire chacune des 20 lirait le futur. Aucun taux de calibration n’est revendiqué ici.

### B.4 — Fiabilité par source et données accessibles aujourd’hui

| Source | Mesurable aujourd’hui | À ne pas lui faire dire |
| --- | --- | --- |
| GitHub PR/API | `createdAt`, `mergedAt`, SHA, transitions/timeline disponibles, taille finale, commits attachés, reviews GitHub, jobs/runs/tentatives et conclusions | Taille finale utilisable a posteriori, pas comme caractéristique connue au lancement. « Draft ready » est une horloge distincte. Pas de modèle auteur/reviewer ni de cause d’inactivité garantis. |
| Git local | Ancestry, SHA, dates auteur/committer, chemins et changements ; preuve par `git log` | Date de début d’une mission, durée active, auteur IA. Le checkout consulté ne contient pas forcément tous les commits GitHub récents. |
| Track, journal brut + contrat | Liens item/lot/WP, décisions, blockers, transitions, acceptation, réouvertures, priorité. Lecture observée : 492 `item.created`, 264 transitions de réalisation, 94 ouvertures/71 résolutions explicites de blockers, 76 créations de décision, 51 sélections d’option, 64 outcomes | Un intervalle de blocker est une observation de blocage seulement si le lien et les deux horloges sont fiables. Pas une déduction universelle d’attente owner. `by` n’est pas le modèle exécutant. |
| Track, timestamps de transition | 99 couples enregistrés `in-progress → done`, sans intervalle négatif dans ce relevé | Les trois premiers couples durent 55, 52 et 60 **millisecondes** : compatibles avec une documentation groupée de travail déjà réalisé, pas une preuve de vélocité de développement. Leur provenance `cli/local-user` ne prouve pas la date d’exécution réelle. `at` est informatif, l’ordre officiel est position + seq. Qualifier le sens de l’horloge, au-delà de la seule provenance, avant entraînement. |
| `agent-stats` | `SessionFact.startedAt/endedAt/models`, actions Git horodatées, SHA/URL prouvés par sorties d’outils, liens et niveaux de confiance ; jointures Track existantes | Début/fin de session ≠ activité continue ; les parseurs actuels couvrent `claude|codex|agy`, pas Muse/Vibe. `effort`, rôle reviewer et waits typés ne sont pas tous disponibles. |
| Journaux conducteurs autorisés | Séquences de lots, revues, réaffectations, demandes GO et certains resets quota ; confirmations recoupables avec PR/SHA | Pas de chronomètre exhaustif. Une ligne minute/« ~ » ou un tick de 20/30 min donne un intervalle approximatif ; le fuseau doit être explicite ou marqué inféré. |
| Fichiers `.log` / `.done` | Horodatages et en-tête modèle de quelques runs ; proxy local possible, démontré en D.2 | `mtime` du log ne donne pas son début ; un `.done` ne prouve ni acceptation ni fusion. `birthtime` dépend du stockage/copie et reste une preuve faible, non portable. |

Le contrat WSJF existant calcule `(business value + criticality + risk reduction)/jobSize` : il classe le travail, il ne fournit aucune unité de temps. Le relevé local contient d’ailleurs zéro `priority.assessed`. Ne pas convertir silencieusement `jobSize` en heures ni modifier les priorités avec l’estimateur.

### B.5 — Commandes et sorties vérifiables

Commandes de collecte effectivement exécutées, toutes via RTK ; pagination complète vérifiée pour les jobs de cet échantillon :

```sh
rtk git -C /home/antoinefa/src/h2a status --short --branch
rtk git -C /home/antoinefa/src/h2a log -3 --format='%H %cI %s'
rtk gh api repos/rhanka/h2a/commits/main --jq '{sha,committed:.commit.committer.date}'
rtk gh pr list --repo rhanka/h2a --state merged --limit 20 --json number,title,createdAt,mergedAt,url,additions,deletions,changedFiles,headRefOid,mergeCommit,author,labels
rtk gh pr view 373 --repo rhanka/h2a --json number,commits,reviews,headRefOid
rtk gh api 'repos/rhanka/h2a/actions/runs?head_sha=532ddee5f88515d74575232e94389536b7e4087f&per_page=100'
rtk gh api 'repos/rhanka/h2a/actions/runs/39107663703/attempts/1/jobs?per_page=100'
rtk gh api 'repos/rhanka/h2a/actions/runs/38999547594/attempts/2/jobs?per_page=100'
rtk gh pr list --repo rhanka/engram --state merged --limit 10 --json number,title,createdAt,mergedAt,url,headRefOid
rtk gh pr list --repo rhanka/sentropic --state merged --limit 10 --json number,title,createdAt,mergedAt,url,headRefOid
```

Les deux commandes PR view / actions ont été répétées pour les **20 numéros et SHA** du snapshot ; les jobs pour leurs 20 runs `ci`. Résultat shell : **40/40 collectes PR/runs et 20/20 collectes jobs, exit 0**. Les requêtes source sont des `gh api contents/<path>?ref=46b82b...` avec Accept raw, sans exécution de code téléchargé.

Sortie de l’agrégation Node sur les JSON sauvegardés (minutes ; collecte/arithmétique, pas test de régression) :

```json
{
  "n": 20,
  "openMerge": {"p50": 165.3, "p80": 220.66666666666666, "p95": 779.5, "max": 1802.95},
  "runsOnFinalHeads": 105,
  "ciJobRowsBeforeQuarantine": 117,
  "githubReviews": 0,
  "ciEligibleRuns": 19,
  "ciIncludingQueue": {"p50": 21.783333333333335, "p80": 31.25, "p95": 37.25},
  "ciJobSpan": {"p50": 18.766666666666666, "p80": 19.916666666666668, "p95": 31.816666666666666},
  "quarantinedPr": 349,
  "negativeCommitToOpenIntervals": 10
}
```

Éléments bruts conservés temporairement dans [/tmp/h2a-velocity-analysis.cSaAdz](/tmp/h2a-velocity-analysis.cSaAdz), sans secret/transcript natif collecté : `prs.json`, `details-<PR>.json`, `runs-<PR>.json`, `jobs-<PR>.json`, contrôles externes, arbre source et agrégats. Ce dossier est une preuve de travail temporaire, **pas le stockage durable proposé**. Le tableau ci-dessus reste lisible sans lui.

| Fichier de preuve | SHA-256 |
| --- | --- |
| `prs.json` | `cbb8c8cc9fb3721359bb993695388d2f18cb07c6fa25703001be040755bedd93` |
| `rows-audited.json` | `f44e5784cffe8ac3b05ef5d2bdf00388a49cfd5c739d6a3056b30a2a34f6aa27` |
| `audit-summary.json` | `ec93178a9a5ec53bc44f3183025c95d49cde167659c15d9d49ac38b0e8a46722` |
| `evidence-manifest.json` | `295d4d2b462a7dfacac2f640a7cba0281d0baed29d259fe2792111cee7bff703` |

## C — Conception et insertion dans l’existant

### C.1 — Capital à réutiliser et frontières

| Existant vérifié | Réutilisation proposée | Frontière conservée |
| --- | --- | --- |
| [`packages/agent-stats/README.md`](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/agent-stats/README.md), [`src/types.ts`](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/agent-stats/src/types.ts), `correlate.ts`, `git-evidence.ts`, `track-join.ts`, `vendor/pr.ts` | Source d’attribution existante ; nouveaux modules purs `src/velocity/*`, commandes dédiées dans `src/cli.ts` ; entrées explicitement exportées et runners injectés | Ne pas appeler les fonctions globales de découverte/sync : elles découvrent les transcripts et le registre natifs. Le package est `private:true` 0.1.0 au snapshot, sa distribution publique n’est pas acquise. |
| [`packages/track/src/events/types.ts:173`](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/track/src/events/types.ts#L173), `model/blocker.ts`, `model/priority.ts`, seam harness/Track gelée | Lire les événements/projections et conserver les ULID ; joindre les artefacts de prévision à l’item déjà existant | Track reste record-only, append-only, single writer ; pas de collecte GitHub/LLM dans `report`, pas de réécriture d’événement ni de nouvel event `estimate.*` à l’amorçage. |
| [`packages/h2a/skills/harness/plan/SKILL.md`](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/h2a/skills/harness/plan/SKILL.md) | Après qualification des lots : charger la référence, déclarer les ressources, produire un artefact de prévision et un knowledge-lock, citer le résultat dans le plan | Garder BRANCH.md selon son format de checkboxes ; ne pas y maintenir un deuxième état de réalisation. Modifier la source, jamais le cache du plugin. |
| Skills `harness/track-report` et [`packages/track/skills/track-report/SKILL.md`](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/packages/track/skills/track-report/SKILL.md) | Afficher un bref délai sourcé dans le contexte/prochaine action et proposer le lien de prévision ; conserver finalité owner, WP, attendus, période, étapes, statuts et décisions | Le rapport déterministe ne calcule pas via IA ni réseau. Les `item report-set` sont des remplacements complets : le writer autorisé doit préserver les métadonnées non modifiées. |
| `governance/conductor.ts`, `h2a-runtime/src/conductor-launch.ts` | Le conducteur reçoit un résultat dans son paquet de planification ; éventuellement il émet les faits de phase explicites | Élection, présence, launch et relance restent les mécanismes existants. Ne pas les remplacer par un ordonnanceur d’estimation ; aucune lecture de l’état natif pendant cette analyse. |
| [Réconciliation CI/knowledge](/home/antoinefa/src/sentropic/.tmp/ci-knowledge-study/reconciliation.md:20) | Réutiliser `TimingObservation`, `TimingSeries`, `TimingEstimate`, `PlanPrediction`, régime de configuration, quatre horloges, manifeste et ressources ; ajouter le profil de vélocité à ce contrat commun | Ce sont des propositions en cours. Faire un raccord de contrat, pas imposer un second format incompatible parce qu’il porte un autre nom. Les budgets de CI ne deviennent pas des observations. |
| [Retour engram cité](/home/antoinefa/src/graphify/.graphify/scratch/design/memory-finalization/repo-knowledge-sol.out:1) | Git pour les faits techniques et prévisions ; engram pour les leçons admises et autorisées, liées à ces références | Graph import ≠ admission mémoire. D3 : journal canonique seul maître de la mémoire ; D10 : projection filtrée, courante, autorisée. Aucun champ arbitraire dans les six outils MCP gelés. |

La demande owner sur les rapports a encore évolué le 18/10, `DECISIONS-owner.md:177–179` : conserver le rapport validé avec WP/périodes en ajoutant étape et statut. [PR #374](https://github.com/rhanka/h2a/pull/374) était ouverte à la lecture. Le lot d’intégration doit repartir de sa version intégrée, sans figer l’ancien tableau de `main` contre cette demande.

Attention à l’homonymie : le [dossier design-only du 27 juin](https://github.com/rhanka/h2a/blob/46b82b42781709f2a2ab1bec6707ba58131248f0/docs/specs/2026-06-27-h2a-agent-stats-integration.md) décrit un produit analytics fédéré et son `agent-stats-core`. Ce n’est pas la preuve que le module privé importé d’engram F12 possède ses mesures de quota ou sa distribution npm. La recommandation vise précisément le module F12 observé ici. La première livraison est un outil du checkout h2a ; l’existence de `registerAgentStatsCommands` ne prouve pas son raccord à un h2a installé. L5 doit vérifier la consommation réelle des artefacts par la skill, sans promettre un verbe CLI public ni publier un nouveau package par défaut. La portabilité hors checkout reste un critère de livraison distinct à qualifier.

### C.2 — Options d’estimation

| Option | Meilleur argument | Limite | Avis |
| --- | --- | --- | --- |
| Comparables statistiques explicites | Reproductibles, explicables, utiles immédiatement ; pas de modèle entraîné nécessaire | Cohortes pauvres et effets de régime ; description des lots encore manuelle | Baseline obligatoire |
| IA pour qualifier/apparier, calcul déterministe | Comprend la nature d’un contrat, d’une migration ou d’un lot de tests ; cite des analogies au-delà des mots du titre | Risque de choisir seulement les cas rapides, d’inventer un modèle/auteur ou de lire des caractéristiques finales | **Cible recommandée**, comparée à la baseline en observation |
| Régression quantile/survie ou modèle hiérarchique multi-repo | Peut traiter plus de facteurs, l’inachèvement et le manque local de données | Volume, labels et suivi temporel insuffisants aujourd’hui ; complexité de calibration | Après corpus qualifié et preuve de gain ; pas MVP |
| LLM seul donnant une durée | Très peu de préparation | Aucun audit numérique, variance du prompt, retour aux jours nominaux | Ne satisfait pas la mission |

L’IA propose une classification et des comparables dans un corpus admissible : dépôt, phase, type de travail, surfaces contractuelles, nouveauté, ordre de grandeur **prévu** de la taille, environnements de test, modèles et effort si attestés. Le moteur vérifie les identifiants, affiche aussi les exclus et calcule les nombres. Pas de multiplicateur secret « modèle X = 3× ». Un comparable d’un autre dépôt est un prior déclaré, jamais une fusion silencieuse des populations.

Sur une cohorte pauvre : élargir selon une règle versionnée, déclarer les changements de régime, ou rendre `incomplete`. Le fait que « h2a a déjà livré vite » ne comble pas un nouveau domaine inconnu. L’IA utilise le contexte du conducteur déjà autorisé ; le rapport Track n’ouvre aucune nouvelle session modèle.

### C.3 — Horloges, données et calcul

Conserver des secondes et des instants UTC, avec fuseau/source d’origine. Séparer :

- **Livraison écoulée** : événements explicitement nommés, par exemple mission acceptée → PR ouverte, PR ouverte → fusion, fusion → package disponible, ou demande → recette/déploiement. Ce sont des métriques distinctes.
- **Travail agent** : somme des intervalles exécutés par agent, avec rôle. Deux agents occupés une heure font deux heures-agent ; ils peuvent livrer en une heure écoulée.
- **Temps actif** : uniquement quand des intervalles instrumentés le prouvent ; une session ouverte n’en est pas la preuve. Sinon valeur absente.
- **Attentes et CI** : file/éligibilité, exécution de jobs, corrections/revues, dépendance, owner GO, quota, indisponibilité de lane. Conserver les chevauchements ; leur union retire au plus une fois une durée au calendrier, et seulement avec couverture complète. Une cause inconnue reste inconnue.

Identités stables : dépôt + PR/lot + occurrence de phase ; run/tentative/job/matrice/workflow pour CI ; `factId` et liens prouvés pour attribution ; ULID Track pour pilotage. Une PR peut réaliser plusieurs lots, un lot plusieurs PR : jointure explicite, pas un compteur PR = compteur lot. Réouverture et changement de périmètre créent une nouvelle occurrence/révision sans réécrire l’ancienne.

Régime : versions modèles/effort observés, workflow et dépendances transitives, runner, toolchain, suites/shards, concurrence, règle de revue, publication. Ne pas mélanger des jobs homonymes de dépôts, workflows ou matrices différents. Pour CI, préférer dépôt + chemin workflow + identifiant de job + tuple de matrice ; un nom affiché seul ne suffit pas.

Les prévisions sont figées **avant** l’exécution avec les seules entrées alors connues. Distinguer heure de l’événement, collecte, publication du snapshot et révision à laquelle la connaissance s’applique. GitHub décrit une taille finale ; elle peut expliquer le réalisé, pas devenir rétroactivement l’entrée du plan. Conserver les observations annulées, échouées et ouvertes, avec censure/statut, au lieu d’y voir des livraisons très rapides.

Pour le programme : n’ordonner que les dépendances d’exécution/qualification/publication et les exclusivités d’écriture. Parent WP et relation `IMPLEMENTS` ne sont pas des précédences. Simuler les ressources finies déclarées : auteurs, reviewers, runners, verrous, quotas et GO externes. Tirer des trajectoires cohérentes de phases, avec corrélations par journée/provider lorsque le corpus le permet. Conserver graine, nombre de tirages, politique d’ordonnancement et empreinte des capacités pour rejouer exactement la simulation. Calculer les quantiles du **résultat du calendrier**, pas ceux d’une somme de P95. Un DAG sans capacité donne un scénario sans contrainte, pas une date de lancement promise.

Deux modes compatibles, à ne pas additionner : (1) distribution historique bout en bout, qui contient déjà CI/revues/attentes usuelles ; (2) simulation de phases disjointes explicitement mesurées. En présence d’un terme inconnu sur le chemin critique, conserver le sous-total et le terme nommé ; pas de total fini attesté. Pour un travail déjà en cours, estimer conditionnellement à sa survie jusqu’à maintenant, ou afficher l’absence de modèle de restant ; ne pas faire simplement `P80 − temps écoulé`.

### C.4 — Restitution et boucle de calibration

Vue conducteur par lot : `but · phase/début/fin · P50/P80/P95 écoulés · date conditionnelle · support/n/fenêtre · 3 comparables · inconnues · prochaine observation`. Vue programme : jalon, graphe de précédence, ressources, goulets, chemin critique de chaque scénario, quantiles du calendrier, attentes externes et date relative au départ connu. `P95` désigne un quantile prédit, pas un intervalle de confiance à 95 %.

Exemple **factuel de bootstrap**, en anglais pour le contrat candidat, alimenté uniquement par le tableau B.2 :

```json
{
  "schema": "velocity-forecast/1",
  "repo": "rhanka/h2a",
  "targetPhase": {"start": "pr-opened", "end": "pr-merged"},
  "support": "historical-bootstrap",
  "calibrated": false,
  "sampleCount": 20,
  "quantileMethod": "nearest-rank/1",
  "wallSeconds": {"p50": 9918, "p80": 13240, "p95": 46770},
  "activeSeconds": null,
  "ownerWaitSeconds": null,
  "quotaWaitSeconds": null,
  "tailQualification": "insufficient-independent-history",
  "evidenceSnapshotSha256": "cbb8c8cc9fb3721359bb993695388d2f18cb07c6fa25703001be040755bedd93",
  "unknowns": ["pre-PR work", "unclassified waits", "model and reviewer attribution"]
}
```

Cet exemple n’est pas une prévision du projet entier. Le contrat définitif doit être aligné avec `TimingEstimate/PlanPrediction` du programme de connaissance, sans multiplier les schémas concurrents.

À chaque fusion : rapprochement idempotent `(repo, lot occurrence, forecast revision, merge SHA)` ; conserver prévision initiale et réestimations, enregistrer le réalisé sur les **mêmes événements de début/fin**, écart et causes attestées. Un changement de périmètre n’efface pas l’erreur de la prévision initiale. Une nouvelle prévision termine un nouvel horizon ; elle ne remplace pas le score de la première.

Mesurer biais signé, erreur absolue médiane/MAE, perte quantile, couverture des bornes P50/P80/P95 avec dénominateurs et incertitude, taux d’abstention/données manquantes, défauts par type/régime et délai de mise à jour. Une bonne couverture obtenue en refusant tous les lots difficiles n’est pas un succès : publier l’abstention et la largeur des délais. Réserver des lots futurs au contrôle ; pour un rejeu, n’utiliser que les observations déjà closes et connues à l’instant de prévision. Le bootstrap de deux jours n’est pas un backtest de production.

Détecter les changements de régime sans facteur universel de correction ; comparer baseline et appariement IA sur les mêmes lots futurs. Garder l’IA seulement si elle améliore la précision/calibration à couverture comparable. Les seuils de volume, fraîcheur et dérive sont une politique versionnée réversible, pas une garantie statistique déduite du nombre de PR. La proposition knowledge « ≥20 observations / ≥7 jours provisoires » n’est même pas satisfaite en durée par l’échantillon h2a présent.

### C.5 — Capitalisation

Réutiliser la disposition proposée par l’étude commune : `knowledge/manifest.json`, `knowledge/profiles/*.json`, `knowledge/ci/{graph,timings}.json`, `knowledge/architecture/graph.json`, `knowledge/evidence/manifests/*`, et `plan/<integration>/knowledge-lock.json`. Proposer **dans ce même manifeste**, après raccord de contrat, `knowledge/velocity/{observations,series}.json` et les prévisions/réalisés référencés par digest. Ce sont des chemins proposés, pas des fichiers déjà livrés.

Le paquet commité contient les faits numériques normalisés, méthode, identités, provenance, sélection et référence des preuves ; les gros logs bruts restent dans une rétention d’artefacts immuables avec manifestes/digests. L’artefact de prévision contient suffisamment de valeurs et de sélection pour reproduire son résultat, même si GitHub évolue. Aucun chemin temporaire seul ne constitue sa preuve durable. Un rafraîchissement remplace un snapshot par une révision reliée, sans réécrire une ancienne prévision.

Le graphe typé projette les relations observation → phase/PR/lot → repo et prévision → observation, avec provenance. Les profils et nœuds/relations sont validés selon les contrats de connaissance/DS retenus ; pas d’écriture directe d’un `graph.json` mémoire supposé canonique. Engram peut recevoir une **leçon bornée** (« ce régime ralentit tel type de revue », avec références immuables), via ses outils existants et admission autorisée. Une observation par job ne devient pas automatiquement un souvenir. Le nom du dépôt n’accorde aucun scope ; le host fournit autorisation, scope et provenance. Une mémoire indisponible ne bloque pas la lecture des faits Git épinglés.

### C.6 — Proposed specification text (English)

> **Status: proposed study contract, not owner-ratified implementation scope.** The initial delivery is read-only and must reuse the existing h2a agent-stats, harness, Track and repository-knowledge boundaries.
>
> **V1. Objective.** Provide evidence-based delivery forecasts for AI-executed lots and integration plans. An LLM MAY classify work and propose comparable records; deterministic code MUST validate eligibility and compute every numeric forecast. Nominal human-day conversions MUST NOT be used.
>
> **V2. Clock contract.** Every observation and forecast MUST identify its start event, finish event, unit, source and quality. Elapsed delivery seconds, agent-work seconds, active seconds, CI execution and waits MUST remain distinct. Unobserved time MUST NOT become zero or an inferred wait cause.
>
> **V3. Input authority.** GitHub observations, validated Track exports, explicitly supplied SessionFacts and conductor phase records are admissible inputs. Collection MUST NOT discover native host state or user transcripts implicitly. Track remains read-only to this consumer; writes remain with its designated CLI writer.
>
> **V4. Identity and lineage.** Records MUST retain repository identity, PR/lot occurrence, phase, evidence identifiers and immutable digests. CI records MUST additionally retain workflow/job/matrix identity and run-attempt lineage. Rebases, retries, duplicate delivery and renamed jobs MUST NOT silently create independent work samples.
>
> **V5. Attribution.** Agent/model attribution MUST cite observed session or execution evidence and a confidence level. Git/GitHub authorship, prompt mentions and missing GitHub reviews MUST NOT establish agent identity or zero review rounds. Unsupported hosts and unknown effort MUST be explicit residuals.
>
> **V6. Cohorts.** Eligibility MUST be defined by a versioned policy over repository, phase, known work features and execution regime. An LLM MUST NOT invent observations or numeric adjustments. Selected and excluded records and fallback populations MUST be inspectable. Cross-repository borrowing MUST be labelled.
>
> **V7. Temporal validity.** Forecasts MUST be frozen before their target work and retain the feature, knowledge, model, estimator and policy revisions used. Final diff size or later observations MUST NOT leak into historical predictions. Ongoing, cancelled and abandoned work MUST retain status/censoring rather than a fabricated completion time.
>
> **V8. Quantiles and support.** Results MUST expose P50/P80/P95 where support permits, sample counts, window, quantile method, regime applicability and calibration status. A historical-bootstrap result MAY show descriptive tails, but MUST NOT claim calibrated probability or a conservative deadline. Missing support MUST yield an explicit incomplete result or labelled fallback.
>
> **V9. Composition.** A full lifecycle forecast and an additive phase forecast are alternative models. CI, review or waits already included in a lifecycle MUST NOT be added again. Plan quantiles MUST be computed from a resource-aware schedule distribution, not from sums/maxima of independently reported phase quantiles.
>
> **V10. Planning contract.** Scheduling requires explicit execution, qualification, release and exclusive-writer precedences, start conditions and capacity assumptions. Simulation seed, draw count, scheduling-policy version and capacity fingerprint MUST be retained for replay. WP containment is not precedence. Unknown critical-path terms MUST remain named unknowns. Unknown capacity yields an unconstrained scenario, not a promised start date.
>
> **V11. Current work.** Remaining-time forecasts MUST condition on elapsed time and known phase state, or declare that no residual model is available. Subtracting elapsed time from an unconditional quantile MUST NOT be presented as a calibrated residual forecast.
>
> **V12. Output and reporting.** Machine-readable results MUST preserve evidence and policy references; human output MUST state the milestone, elapsed time, conditional date, support and unknowns. Track reports MUST remain local and deterministic, preserve approved WP/period/status/decision semantics, and MUST NOT call an LLM or GitHub to render a report.
>
> **V13. Feedback.** Each merge MUST idempotently link actuals to previously frozen predictions on the same clock and milestone. Original forecasts MUST remain immutable. Calibration MUST use chronological/prospective evaluation and publish coverage, quantile loss, error, abstention and missingness by regime.
>
> **V14. Repository knowledge.** Versioned numeric snapshots and prediction locks MUST integrate with the existing repository-knowledge contract. Engram lessons MUST use its existing scoped capture/admission lifecycle. Graph import MUST NOT become memory admission or a second canonical memory authority. Frozen Track/MCP schemas MUST NOT be extended incidentally.
>
> **V15. Verification and rollout.** New behavior MUST have targeted fixture-based RED-before/GREEN-after evidence, isolated temporary directories and injected clock/process/network ports. Missing live state MUST NOT cause silent test skips. Start in shadow mode; forecasts MUST NOT bypass acceptance, security, review, owner GO, model-routing policy or release gates.

## D — Lots proposés, RED et première date

### D.1 — Découpage exécutable, sans écrire de plan dans cette mission

Les chemins `src/velocity/*` et `tests/velocity-*` ci-dessous sont **nouveaux, proposés** sous `packages/agent-stats/`. Les autres chemins existent au snapshot GitHub. Le plan final doit être produit par le conducteur après réconciliation ; une PR par lot logique, subdivisée en commits courts conformes à harness/plan. Aucun lot n’est réputé lancé.

| Lot et sortie observable | Fichiers exacts proposés | RED comportemental à obtenir avant correction | Dépendances |
| --- | --- | --- | --- |
| L0 — Contrat et échantillon figés | `docs/specs/2026-10-18-SPEC_STUDY_agent-velocity.md`, `BRANCH.md` ; fixture minimisée et expurgée `packages/agent-stats/tests/fixtures/velocity/github-sample.json` | Revue du contrat et des horloges ; pas de faux test RED pour un document. Ne pas présenter l’étude indépendante comme une spécification gelée. | Réconciliation des analyses et raccord au programme knowledge |
| L1 — Collecteur factuel en lecture seule, première PR utilisable | `packages/agent-stats/src/velocity/observations.ts`, `packages/agent-stats/src/velocity/github.ts`, `packages/agent-stats/src/cli.ts`, `packages/agent-stats/tests/velocity-github.test.ts` | Pagination tronquée non signalée ; double comptage PR/run ; #349 interprété comme tentative homogène ; `updated_at` pris pour une fin CPU ; API manquante convertie en durée zéro. Chaque fixture doit exposer le mauvais résultat attendu, pas seulement un import de module absent. | L0 ; runner gh injecté, corpus explicite |
| L2 — Jointures et phases fiables | `packages/agent-stats/src/velocity/join.ts`, `packages/agent-stats/src/velocity/intervals.ts`, `packages/agent-stats/tests/velocity-attribution.test.ts` | Attribuer tous les commits à rhanka comme agent ; prendre un committer-date rebasé pour le départ ; compter deux fois des sessions qui se chevauchent ; traiter les transitions Track de 55 ms comme développement. Absence de modèle/reviewer doit rester unknown. | L1 ; réemploi de `types.ts`, `correlate.ts`, `track-join.ts` sans modifier leur ancien sens |
| L3 — Baseline, appariement IA contrôlé, prévision de lot | `packages/agent-stats/src/velocity/cohort.ts`, `packages/agent-stats/src/velocity/estimate.ts`, `packages/agent-stats/tests/velocity-estimate.test.ts`, `packages/agent-stats/tests/velocity-matching.test.ts` | Reproduire exactement les quantiles B.2 ; refuser un comparable inventé, une taille finale future et un mélange de phases ; n=0 ne doit pas produire 0 min ; un P95 peu étayé doit être marqué non qualifié. L’IA ne peut injecter un nombre arbitraire. | L1–L2 ; port IA injecté, pas de modèle réel dans les tests déterministes |
| L4 — Calendrier de lots à ressources déclarées | `packages/agent-stats/src/velocity/schedule.ts`, `packages/agent-stats/tests/velocity-schedule.test.ts` | Deux tâches de 10 et 8 min suivies de 3 min : 13 min à capacité 2, 21 min à capacité 1 ; cycle explicite refusé ; propriétaire WP non traité comme prédécesseur ; attente externe inconnue empêche un total attesté ; CI non ajoutée deux fois. | L3 ; données de phases suffisantes, sinon sortie incomplete |
| L5 — Référence repo et consommation par le plan/rapport | `packages/agent-stats/src/velocity/knowledge.ts`, `packages/agent-stats/src/velocity/report.ts`, `packages/agent-stats/tests/velocity-knowledge.test.ts`, `packages/agent-stats/tests/velocity-planning.test.ts`, `packages/h2a/skills/harness/plan/SKILL.md`, `packages/h2a/skills/harness/track-report/SKILL.md`, `packages/track/skills/track-report/SKILL.md` ; artefacts `knowledge/velocity/observations.json`, `knowledge/velocity/series.json`, `plan/velocity-pilot/knowledge-lock.json` selon contrat commun | Un digest/régime modifié invalide l’applicabilité ; import de connaissance n’écrit jamais la mémoire ; le rapport reste possible sans réseau/LLM ; enrichissement ne perd ni WP, période, attendus, métadonnées existantes ni état Track. | L3 ; L4 pour dates programme ; intégrer la version approuvée de #374 |
| L6 — Réalisés, calibration, pilote et raccord des leçons | `packages/agent-stats/src/velocity/actuals.ts`, `packages/agent-stats/src/velocity/calibration.ts`, `packages/agent-stats/tests/velocity-actuals.test.ts`, `packages/agent-stats/tests/velocity-calibration.test.ts`, `packages/agent-stats/src/cli.ts` ; prévisions/réalisés sous `plan/velocity-pilot/` | Même fusion reçue deux fois ne compte qu’une fois ; ancienne prévision inchangée après réestimation ; ouvert/abandonné conserve son statut ; replay avec données futures refusé ; mémoire denied/stale/superseded ne change pas les faits numériques. | L5 ; admission engram réelle seulement après qualification du host par gr-conductor |

Ordre minimal : `L0 → L1 → L2 → L3 → L5 → L6` ; L4 suit L3 et peut avancer en parallèle de la partie connaissance de L5 si les lanes sont autorisées. **La mission owner complète n’est pas close avec L1** : l’usage IA, la consommation plan/rapport et le retour réel restent à livrer. Aucun total de projet n’est déduit en multipliant six médianes de PR.

Commandes ciblées prévues, **non exécutées dans cette analyse**. Depuis le futur checkout à jour, cwd `packages/agent-stats` :

```sh
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-github.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-attribution.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-estimate.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-matching.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-schedule.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-knowledge.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-planning.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-actuals.test.ts
rtk npx --no-install vitest run --config vitest.config.ts tests/velocity-calibration.test.ts
```

Compatibilité de l’attribution existante : `rtk npx --no-install vitest run --config vitest.config.ts tests/agent-stats.test.ts tests/agent-stats-h2a-evidence.test.ts` dans ce même cwd, seulement si les jointures existantes sont modifiées. Si le lot L5 doit modifier le code Track plutôt que seulement ses consommateurs, ajouter les checks ciblés `src/read/commands.period.test.ts` et `src/report/validated-report-shape.test.ts` depuis `packages/track`, puis le test de rapport concerné de la version intégrée de #374. Pas de suite complète.

Chaque nouveau test utilise `mkdtemp`, un `XDG_RUNTIME_DIR` temporaire et des entrées explicites ; runners/process/clock injectés, aucune découverte des homes natifs. Les preuves RED/GREEN doivent conserver commande, sortie, code retour et nombre de skips. Une réussite conditionnée à l’absence d’état réel vaut échec. Les tests d’intégration n’attestent pas une revue humaine ni une politique de routage modèle ; ils attestent leurs frontières déterministes.

### D.2 — Première livraison et date fondée sur les mesures

**Premier livrable proposé : L1, un collecteur de faits rejouable, 20 PR h2a et leur CI, manifestes de preuve et anomalies visibles, avec tests ciblés RED/GREEN ; une seule PR à relire.** Il ne promet pas encore un estimateur de programme. La preuve de faisabilité et les valeurs de référence sont déjà dans le présent dossier.

Pour ne pas utiliser uniquement ouverture → fusion comme si cela incluait le développement, trois logs autorisés ont été joints à leur PR. Le début est ici le **birthtime du log**, proxy local faible, et la fin `.done` ou GitHub selon la colonne. Les en-têtes des trois logs indiquent `gpt-6.1-sol`, effort high. Ce n’est pas une preuve d’activité continue ni de transférabilité vers tous les modèles.

| Run local / PR | Début proxy UTC, 17/10 | Fin `.done` UTC | Début → ouverture PR | Début → `.done` | Début → fusion |
| --- | --- | --- | ---: | ---: | ---: |
| `cibudget` / #360 | 18:04:34.536 | 18:23:51.165 | 4,06 min | 19,28 min | 19,92 min |
| `trackstatus` / #365 | 21:10:56.961 | 21:27:03.775 | 9,93 min | 16,11 min | 114,88 min |
| `scopeguard` / #364 | 20:24:05.655 | 20:57:09.841 | 17,07 min | 33,07 min | 201,92 min |

**Scénario de bootstrap explicite pour L1 :** une lane auteur disponible et une lane de revue selon la politique existante ; pas de nouvelle dépendance/service, droits gh accessibles, périmètre borné au collecteur ; démarrage hypothétique **18/10/2026 à 16:00 UTC, soit 12:00 Toronto**. Ce créneau n’est ni réservé ni autorisé par cette étude.

Méthode reproductible : croiser les **3** délais proxy début → ouverture avec les **20** délais ouverture → fusion de B.2 ; trier les 60 sommes et prendre nearest-rank. Cela suppose l’indépendance des deux phases et leur transférabilité ; les 60 résultats sont des scénarios, **pas 60 observations indépendantes**. On ajoute le seul travail pré-PR, sans ajouter `.done` ou une nouvelle fois la CI.

| Niveau descriptif du scénario | Écoulé depuis le lancement | Date UTC si T0 = 18/10 16:00Z | Toronto |
| --- | ---: | --- | --- |
| P50 bootstrap | 177,37 min ≈ 2 h 57 | 18/10 vers **18:57Z** | 18/10 vers **14:57** |
| P80 bootstrap | 237,74 min ≈ 3 h 58 | 18/10 vers **19:58Z** | 18/10 vers **15:58** |
| P95 bootstrap | 796,57 min ≈ 13 h 17 | 19/10 vers **05:17Z** | 19/10 vers **01:17** |

**Cible de planification proposée pour la première PR fusionnée : T0 + environ 4 heures, donc 18/10 vers 19:58 UTC dans ce scénario.** C’est un ordre de grandeur mesuré pour un incrément borné, pas un engagement « 80 % sûr ». n=3 pour l’avant-PR, birthtime faible, corpus hétérogène, régime non qualifié et waits non séparés empêchent cette affirmation. Le P95 expose la queue observée ; il ne borne pas une nouvelle crise quota ou une attente GO. Si la lane commence plus tard, déplacer T0 ; si le périmètre change, refaire la prévision au lieu d’inventer une nouvelle date.

Le point « chaîne mémoire engram ≈21 h » est une observation narrative utile de chaîne complète, avec un seul cas et des frontières à confirmer. Il doit devenir un comparable de **chaîne** une fois ses événements normalisés ; il ne remplace pas une distribution par lot. Aucune preuve ne permet aujourd’hui de dater l’ensemble L0–L6 avec un P95 calibré.

## E — Questions owner à préparer et incertitudes

Ces questions sont **à rapprocher d’abord des décisions déjà consignées**, puis à relayer seulement si la réponse manque. Elles ne sont pas posées comme une nouvelle demande de permission dans cette mission d’analyse. Les paramètres réversibles de collecte, méthode quantile, chemins et cadence relèvent des mainteneurs ; pas besoin d’un GO owner sur chaque fichier.

| Question et contexte | Options et conséquences | Recommandation proposée |
| --- | --- | --- |
| Quel événement rend une promesse de délai satisfaite ? Ouverture, fusion et disponibilité réelle sont séparées ; le chiffre « 45 j » concernait une chaîne d’intégration. | A : fusion par lot, puis jalon intégré explicite pour le programme — mesurable immédiatement ; B : seulement PR prête — plus tôt mais ignore intégration ; C : déploiement/recette partout — répond à la livraison utilisateur mais exige les événements correspondants. | A pour le pilote ; tout programme doit nommer son jalon utilisateur final. Vérifier si cette règle existe déjà avant de solliciter l’owner. |
| Comment restituer les attentes extérieures dans une date ? Les queues 13–30 h existent, leurs causes ne sont pas toutes connues. | A : durée réelle bout en bout + scénario conditionnel sur attentes explicites — complet mais moins précis au départ ; B : travail agent seul — utile pour l’effort, insuffisant pour une date ; C : seulement bout en bout — simple, masque l’action permettant de réduire le délai. | A. Pas d’exclusion des attentes owner/quota par défaut, pas d’attribution de responsabilité sans preuve. |
| Quelle capacité et quelle priorité peuvent alimenter le pilote ? Une vague de quatre branches ne signifie pas quatre auteurs, reviewers et runners disponibles. | A : utiliser la capacité et politique modèle déjà autorisées, sinon scénario déclaré d’une lane auteur et d’une revue ; B : demander une capacité dédiée plus élevée — nécessite arbitrage réel de ressources ; C : annoncer seulement les durées relatives tant que la capacité manque. | A si les données existent ; C pour toute date où elles manquent. L’estimateur ne choisit pas seul une nouvelle dépense ou un modèle de repli. |
| Quel élargissement du pilote est prioritaire ? On dispose de données sur trois dépôts, mais les cohortes/régimes diffèrent. | A : h2a instrumenté d’abord, sondes engram/sentropic et contrat partagé en parallèle — réduit le coût de validation ; B : trois dépôts opérationnels dès la première livraison — compare plus tôt mais augmente les raccords et données manquantes. | A ; définir le lot d’extension tri-repo sans reporter la capitalisation commune ni prétendre que L1 clôt l’ensemble. |

Le choix de capitaliser la connaissance repo a déjà été demandé ; il ne faut pas le remettre au vote. Le raccord hybride Git + leçons engram doit suivre le circuit de contrat existant avec gr-conductor, sans rouvrir D3/D10 ou les décisions de la chaîne MCP. L’analyse parallèle et sa réconciliation restent nécessaires avant une spécification gelée : aucun consensus de pairs n’est revendiqué ici.

| Incertitude restante | Effet | Action observable pour la lever |
| --- | --- | --- |
| Temps pré-PR qualifié ; birthtime actuellement proxy | Prévision de lancement encore faible | Émettre `lot.started`, `pr.opened`, `phase.started/ended` dans un ledger conducteur explicite, avec lot/session et horloge attestée ; exporter des faits, sans découvrir l’état natif. |
| Muse/Vibe, efforts et rôles non couverts par les parseurs actuels | Attribution et cohortes incomplètes | Commencer par les exports conducteurs autorisés ; qualifier ensuite des adaptateurs propres, avec fixtures. Ne pas étendre l’énumération au hasard ni lire les homes réels. |
| Waits owner, quotas et reprises non exhaustifs | Impossible d’isoler travail actif et attentes | Événements blocage/reprise typés et reliés à la phase ; mesure de couverture ; sinon total réel avec cause unknown. |
| Historique CI complet et résultats réutilisés | Coût d’échec/retry et queue encore biaisés | Pagination temporelle, anciens SHA, tentatives 1..N, conclusions, état des jobs attendus et règle de lignée ; expliquer le cas #349. |
| Matching et tails | Aucune amélioration IA/calibration démontrée | Prévisions prospectives figées, baseline commune, pertes quantiles/couverture et abstention avec dénominateurs ; élargir la fenêtre, séparer les régimes. |
| Sémantique/implémentation du paquet knowledge et host engram | Raccord non déployé par cette étude | Handoff de fixtures valides/stale/denied/superseded à leurs responsables ; premier mode Git lisible sans mémoire disponible. |
| Module F12 privé et raccord à un host installé | La présence du code ne prouve pas une commande distribuée | L5 : vérifier depuis un consommateur propre la lecture du knowledge-lock et des prévisions ; qualifier séparément le chargement du moteur hors checkout. Ne pas confondre le produit analytics homonyme avec ce module. |
| Rapport en cours de correction, #374 | Risque de régression WP/période/attendus | Repartir de la version owner approuvée intégrée ; ciblage des tests de rapport et de période, pas refonte de l’interface. |

## Vérifications et limites de cette mission

| Rubrique | Résultat |
| --- | --- |
| Commits poussés | **Aucun** ; aucune modification du dépôt, de sa branche, de Track ou des caches installés. |
| Tests de dépôt exécutés | **Aucun**, conformément à la mission d’analyse. Les RED/GREEN du § D sont prévus, pas réalisés. |
| Collecte exécutée | gh/git en lecture seule, 20 PR h2a détaillées, 105 runs sur derniers SHA, jobs des 20 workflows `ci`, 10 PR par dépôt externe et une sonde CI par dépôt ; sorties et anomalies ci-dessus. |
| Contrôles arithmétiques | Scripts Node temporaires : JSON lisibles, nombres de jobs égaux à `total_count`, quantiles nearest-rank, contrôle des horloges, jointures locales explicites et SHA-256. Aucun résultat de test produit revendiqué. |
| Non couvert | Runtime natif, état réel h2a, anciens pushes/tentatives complets, toutes les portes CI, attribution complète, effort actif, coûts/quota instrumentés, calibration prospective, exactitude de l’ordonnanceur futur et intégration mémoire déployée. |
| Écart de méthode explicite | Échantillon de 20 PR récemment créées et fusionnées, pas un tri exhaustif des 20 dernières fusions ; 19 séries CI retenues après quarantaine de #349. Une première sonde engram avec SHA abrégé a rendu 0 et a été remplacée par la requête au SHA complet `d2acfc43571a433d29ac43dae2860d49daf1b508` : aucune absence traitée comme réussite. |
| Écart à la mission | Aucun. Pas de code produit, commit, Python/Perl, appel h2a installé, accès aux états interdits, inspection/arrêt de processus tiers ou délégation. Les choix et dates proposés restent des hypothèses documentées. |
